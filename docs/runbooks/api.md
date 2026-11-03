# API local autenticada

Estado: NestJS ejecutable con OIDC, tareas, sesiones y contexto/delta.
El [gateway MCP](mcp.md) comparte autenticación y servicios; el [dashboard](web.md)
usa el BFF mediante proxy del mismo origen. WS y administración general de
identidades/proyectos siguen pendientes.
El [worker de outbox](events.md) publica eventos de forma independiente.
Entorno y PATH de pnpm: [local.md](local.md).

## Preparar y ejecutar

Desde la raíz, con PostgreSQL y Keycloak locales saludables:

```powershell
pnpm db:migrate
pnpm local:bootstrap
pnpm --filter @acc/api dev
```

El bootstrap está restringido a desarrollo y hosts loopback. Preaprovisiona el
usuario sintético `owner`, el proyecto de demostración y dos service accounts
`acc-local-agent-a/b`. Resuelve subjects mediante la administración de Keycloak;
el login de la API solo busca la identidad exacta issuer/sub, sin registro público.
Repetirlo conserva permisos existentes y accesos revocados. Solo administra clientes
y scopes marcados como propios del bootstrap; rechaza colisiones con otros recursos.

Credenciales humanas en `.cache/local-login.txt`; credenciales de service accounts
en `.cache/local-agents.json`. Son archivos locales ignorados. No imprimirlos,
versionarlos ni copiarlos a auditoría. Los client secrets solo los utiliza el
cliente para obtener su token en Keycloak; ACC no los guarda en PostgreSQL.

Alternativa compilada:

```powershell
pnpm build:foundation
pnpm build:api
node --env-file=.env apps/api/dist/main.js
```

Escucha exclusivamente en loopback, puerto `API_PORT` (53000 local). Probe:
`http://localhost:53000/api/v1/health/ready`. Comprobar si ya hay una instancia
antes de arrancar otra. La sesión de implementación arrancó esta versión compilada.

La URL OIDC registrada es `http://localhost:55173/api/v1/auth/callback`, prevista
para el mismo origen de la futura SPA. Mientras falta ese proxy, la suite HTTP
levanta la API en 55173 y ejecuta el flujo completo sin sustitutos de autenticación.
El puerto 55173 debe estar libre durante las integraciones; la API en 53000 puede
seguir funcionando. El dashboard aún no está disponible en ninguno de esos puertos.

## Autenticación y permisos

- Humanos: `GET /api/v1/auth/login`, Code + PKCE S256, state y nonce; callback
  validado por openid-client, rotación del ID de sesión y cookie HttpOnly/SameSite=Lax.
  Secure se activa en HTTPS y producción. HTTP solo se permite en loopback de desarrollo.
- Sesión BFF en PostgreSQL, con expiración absoluta limitada por el ID token y
  un máximo de quince minutos. Access, ID y refresh tokens no se persisten.
  El estado PKCE temporal expira a los cinco minutos.
- `GET /api/v1/auth/me` entrega el principal y el token CSRF de una sesión humana.
  Sus mutaciones requieren `Origin` igual a PUBLIC_ORIGIN y `X-CSRF-Token` válido.
  `POST /api/v1/auth/logout` destruye esa sesión HTTP; no es un logout del proveedor SSO.
- Agentes: Bearer JWT verificado con JWKS, RS256, issuer, audiencia `acc-api`,
  expiración y antigüedad máxima de diez minutos. Cada petición exige `task:read`
  o `task:write` según la operación, y autorización de proyecto en PostgreSQL.
  Los service accounts locales emiten tokens de cinco minutos y scopes reales de Keycloak.
- Un Bearer presente nunca hereda la identidad o permisos de la cookie. Solo una
  sesión humana puede cerrar su sesión HTTP mediante el endpoint logout.
- `OWNER/ADMIN` puede revocar acceso de agente por proyecto: termina sesiones ACC,
  incrementa fencing, revoca claims y registra auditoría/outbox en una transacción.
  La membresía inactiva impide acceso del JWT vigente al proyecto. El bootstrap
  no la reactiva. El aprovisionamiento general y rotación de credenciales por API
  siguen pendientes; el bootstrap es exclusivamente local.

## Rutas disponibles

Todas bajo `/api/v1`, excepto las URLs del propio proveedor OIDC.

| Método   | Ruta                                                       | Operación                                                      |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| GET      | `/health/live`, `/health/ready`                            | Probes sin autenticación                                       |
| GET      | `/auth/login`, `/auth/callback`, `/auth/me`                | Login y sesión BFF                                             |
| POST     | `/auth/logout`                                             | Logout BFF con CSRF                                            |
| GET      | `/projects`                                                | Proyectos con membresía activa                                 |
| GET/POST | `/projects/:projectId/tasks`                               | Consultar o crear tareas                                       |
| GET      | `/projects/:projectId/tasks/:taskId`                       | Detalle consistente con evidencia, aprobaciones y dependencias |
| POST     | `/projects/:projectId/tasks/:taskId/:command`              | Comando transaccional de tarea                                 |
| GET/POST | `/projects/:projectId/agent-sessions`                      | Consultar o registrar sesiones ACC explícitas                  |
| POST     | `/projects/:projectId/agent-sessions/:sessionId/heartbeat` | Renovar presencia de sesión; no renueva claims                 |
| POST     | `/projects/:projectId/agent-sessions/:sessionId/end`       | Terminar sesión y revocar sus claims                           |
| POST     | `/projects/:projectId/agents/:principalId/revoke`          | OWNER/ADMIN revoca acceso de agente al proyecto                |

También disponibles: `GET /projects/:projectId/context` y `GET /projects/:projectId/events`.
Sus contratos y recuperación se describen en [contexto y eventos](events.md).

Comandos de tarea: `claim`, `heartbeat`, `release`, `revoke`, `work`, `revise`,
`transition`, `evidence`, `accept-evidence`, `approve` y `dependency`. Sus entradas
se validan con los contratos Zod compartidos; los controllers delegan al store.

Las mutaciones de coordinación requieren `Idempotency-Key`. Las que modifican
entidades existentes exigen `expectedVersion` en JSON; las aprobaciones también
`workRevision`. Los claims/escrituras de implementación incluyen `sessionId` y
`fencingToken` decimal, ligado al principal autenticado. Los cuerpos rechazan campos
desconocidos, incluidos booleanos de gates o identidades suministradas por el cliente.

Consulta de tareas: `limit` inicial 20/máximo 100, `status` opcional y `cursor` firmado
vinculado al proyecto/filtro. La respuesta es `{data:{items,nextCursor},meta}`.
Orden estable por UUID. El detalle se lee con snapshot REPEATABLE READ.
El snapshot/delta cubre los recursos implementados del proyecto, con secuencia fija
entre páginas. El resto de entidades de producto sigue pendiente.

Éxitos `{data,meta:{requestId,version?,projectSeq?}}`. Errores
`{error:{code,message,details?,requestId}}`: validación 400, autenticación 401,
permisos/CSRF 403, recurso ausente 404, versión/propiedad/idempotencia 409 y gates 422.
Respuestas `no-store`, request ID propio, Helmet, JSON hasta 32 KiB y límite local
por proceso de 600 solicitudes/minuto por IP. No se devuelve SQL, stack ni tokens
en errores. El rate limiting distribuido y configuración de publicación quedan pendientes.

## Comprobar

```powershell
pnpm test
pnpm test:integration
pnpm lint
pnpm format:check
pnpm typecheck:foundation
pnpm typecheck:api
pnpm build:foundation
pnpm build:api
```

La suite usa PostgreSQL y Keycloak reales. BD: esquemas aleatorios eliminados al
finalizar. Keycloak: reutiliza los dos clientes sintéticos y sus scopes locales,
que permanecen en el realm. No utiliza usuarios/credenciales de producción.
Incluye PKCE/rotación, state/nonce, falta de preaprovisionamiento, issuer antiguo,
firma JWT ajena, CSRF malformado, permisos VIEWER, separación cookie/Bearer,
dos agentes concurrentes, revocación y flujo HTTP hasta DONE con gates negativos.
No acredita aún interoperabilidad MCP ni revisión visual/E2E de la SPA.
