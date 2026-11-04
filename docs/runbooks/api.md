# API local autenticada

NestJS ejecuta autenticación propia, administración de identidades, tareas,
sesiones ACC y contexto/delta. El [gateway MCP](mcp.md) comparte servicios y
autorización; el [dashboard](web.md) usa cookies mediante proxy del mismo origen.
El [worker outbox](events.md) publica eventos por separado. Creación general de
proyectos, OpenAPI y servidor WS siguen pendientes.

## Preparar y ejecutar

El [entorno local](local.md) describe Compose completo y desarrollo nativo.
Con PostgreSQL activo y API/UI de Compose detenidas cuando ocupen los puertos:

```powershell
pnpm db:migrate
pnpm local:bootstrap
pnpm --filter @acc/api dev
```

Bootstrap preaprovisiona el usuario `owner`, el proyecto de demostración y dos
agentes locales. Conserva identidades, permisos y credenciales existentes.
Credenciales iniciales humanas en `.cache/local-login.txt`; tokens API/MCP de
agentes en `.cache/local-agents.json`. No imprimir ni versionar estos archivos.
Las contraseñas cambiadas no se restauran al repetir bootstrap.

Alternativa compilada: `pnpm build:foundation`, `pnpm build:api` y
`node --env-file=.env apps/api/dist/main.js`. API_HOST es 127.0.0.1 por defecto;
Compose usa 0.0.0.0 internamente con publicación host loopback.
Puerto API_PORT: 53000. Readiness: `/api/v1/health/ready`.

## Autenticación y permisos

- Humanos sin registro público. Primero `GET /api/v1/auth/session` establece
  cookie y devuelve CSRF; después `POST /api/v1/auth/login` recibe
  `{username,password}`, Origin exacto, cookie y `X-CSRF-Token`.
- Login rota el ID de sesión y CSRF. Cookie `acc.sid` HttpOnly, SameSite=Lax,
  Secure con HTTPS o producción. Sesión PostgreSQL de duración absoluta de una
  hora. Cada petición comprueba cuenta habilitada y versión de credenciales.
- `GET /api/v1/auth/me` devuelve principal, usuario y CSRF de la sesión humana.
  Mutaciones humanas requieren JSON, Origin igual a PUBLIC_ORIGIN y CSRF vigente.
  `POST /auth/logout` con `{}` destruye la sesión y retira la cookie.
- `POST /auth/password` recibe `{currentPassword,newPassword}`, rota sesión e
  invalida cookies anteriores. La nueva debe ser distinta y tener 15–128
  caracteres. Una contraseña temporal obliga a cambiarla antes de usar proyectos
  o administración. No se puede completar el cambio reutilizando la temporal.
- Contraseñas derivadas con scrypt y sal aleatoria. Login fallido no revela si la
  cuenta existe o está deshabilitada. Límites PostgreSQL: 10 intentos por cuenta
  y 50 por IP en quince minutos; exceso devuelve 429.
- Agentes usan Bearer opaco `acc_<uuid>.<secreto>`. Solo se guarda SHA-256;
  el secreto se devuelve al emitir. Caducidad de 1–30 días, scopes
  `task:read`/`task:write` y audiencias `api`/`mcp`.
- Cada petición valida vigencia, revocación, cuenta habilitada y audiencia.
  La membresía activa del proyecto y los scopes se comprueban aparte. Un Bearer
  presente nunca hereda la identidad ni permisos de una cookie.
- OIDC/JWT y cookies anteriores no autentican. Las tablas OIDC históricas se
  conservan para no perder referencias. No hay servidor OAuth propio.

## Administración

Solo un humano con sesión y rol global ADMIN vigente, sin cambio de contraseña
pendiente, puede administrar usuarios, membresías y credenciales. El rol global
no da acceso al contenido de proyectos sin membresía.

| Método   | Ruta bajo /api/v1                      | Operación                       |
| -------- | -------------------------------------- | ------------------------------- |
| GET/POST | `/admin/users`                         | Listar o crear usuarios         |
| POST     | `/admin/users/:id/password`            | Restablecer contraseña temporal |
| POST     | `/admin/users/:id/status`              | Habilitar o deshabilitar cuenta |
| POST     | `/admin/users/:id/projects/:projectId` | Asignar roles y acceso          |
| GET/POST | `/admin/agents`                        | Listar o emitir credenciales    |
| POST     | `/admin/agents/:id/revoke`             | Revocar credencial              |

La asignación usa `{active,roles,expectedVersion?}`: versión 0 para alta y versión
actual para una membresía existente. No se puede deshabilitar la propia cuenta
ni retirar al último propietario activo. Reset invalida las cookies anteriores.
Deshabilitar cuentas, retirar acceso o revocar credenciales invalida sesiones ACC
y claims afectados. Las acciones de identidad tienen auditoría transaccional.
Las listas no devuelven hashes ni secretos; una credencial perdida debe sustituirse.

## Coordinación y consultas

| Método   | Ruta bajo /api/v1                                             | Operación                             |
| -------- | ------------------------------------------------------------- | ------------------------------------- |
| GET      | `/health/live`, `/health/ready`                               | Probes sin autenticación              |
| GET      | `/projects`                                                   | Proyectos con membresía activa        |
| GET/POST | `/projects/:projectId/tasks`                                  | Consultar o crear tareas              |
| GET      | `/projects/:projectId/tasks/:taskId`                          | Detalle consistente                   |
| POST     | `/projects/:projectId/tasks/:taskId/:command`                 | Comando de tarea                      |
| GET/POST | `/projects/:projectId/agent-sessions`                         | Consultar o registrar sesión ACC      |
| POST     | `/projects/:projectId/agent-sessions/:sessionId/heartbeat`    | Renovar presencia, sin renovar claims |
| POST     | `/projects/:projectId/agent-sessions/:sessionId/end`          | Terminar sesión y sus claims          |
| POST     | `/projects/:projectId/agents/:principalId/revoke`             | OWNER/ADMIN retira acceso del agente  |
| GET      | `/projects/:projectId/context`, `/projects/:projectId/events` | Snapshot/delta                        |

Comandos de tarea: `claim`, `heartbeat`, `release`, `revoke`, `work`, `revise`,
`transition`, `evidence`, `accept-evidence`, `approve` y `dependency`.
Las mutaciones de coordinación requieren Idempotency-Key; modificaciones existentes,
expectedVersion. Aprobaciones incluyen workRevision; implementación usa sessionId
y fencingToken decimal. El cliente no declara identidad ni gates verificados.

Consulta: limit inicial 20/máximo 100, status opcional y cursor firmado vinculado
al proyecto/filtro. Respuesta `{data:{items,nextCursor},meta}`, orden por UUID.
El detalle usa REPEATABLE READ. Ver [contexto y eventos](events.md).

Éxitos `{data,meta:{requestId,version?,projectSeq?}}`; errores
`{error:{code,message,details?,requestId}}`. Códigos: validación 400, autenticación
401, permisos/CSRF 403, ausente 404, conflicto 409, gates 422 y límites 429.
Respuestas no-store, Helmet, JSON hasta 32 KiB y límite por proceso de 600
solicitudes/minuto por IP. No se devuelven SQL, stacks ni tokens en errores.

## Comprobar

Ver los comandos de [verificación local](local.md). Las integraciones usan
PostgreSQL/Redis locales y esquemas aislados; Keycloak no es necesario.
`local-auth.test.ts` cubre login/CSRF, cambio obligatorio, reset, administración,
roles, revocación y límites. `bootstrap.test.ts` comprueba conservación de estado,
concurrencia y rollback cuando faltan secretos. Las suites REST/MCP comprueban
claims, fencing y gates humanos. La revisión web/móvil de la administración nueva
sigue pendiente y no queda acreditada por estas pruebas.
