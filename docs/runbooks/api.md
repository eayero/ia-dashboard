# API local autenticada

Instancia vigente: commit `55fdb94`, migraciones **012/013** y **34 herramientas MCP**, desplegados en http://localhost:55173. [Informe verificado](../requirements/SPRINT_GOVERNANCE_DEPLOYMENT.json). Las notas de versiones anteriores conservan su alcance histórico.

Antes de trabajar, elegir requisito principal cuando sea ambiguo y asignar el requisito a un sprint ACTIVE. La tarea hereda el sprint; el servidor impide claim/inicio/escritura productiva fuera de ejecución. Preguntas y decisiones ya están disponibles; solo humanos confirman respuestas y aprueban decisiones.

La continuación local de creación de tareas exige `requirementIds` y migración
010; API/MCP y UI deben actualizarse juntos. El retiro del último vínculo devuelve 409. Ver [contrato y reglas](../requirements/TASK_REQUIREMENT_API.md).

NestJS ejecuta autenticación propia, administración de identidades, tareas,
sesiones ACC y contexto/delta. El [gateway MCP](mcp.md) comparte servicios y
autorización; el [dashboard](web.md) usa cookies mediante proxy del mismo origen.
El [worker outbox](events.md) publica eventos por separado y Socket.IO entrega
notificaciones autorizadas. La creación general de proyectos sigue pendiente.

## Contrato OpenAPI

`GET /api/v1/openapi.json` descarga OpenAPI 3.1.1 sin autenticar, con JSON directo
(sin envelope ACC), no-store y el mismo proxy del origen público. Describe las
55 operaciones REST en el código local actual, en 49 paths; MCP y WS conservan sus
propios protocolos. La instancia previa desplegada conserva su contrato hasta actualizarse.
No incluye URLs de base de datos/Redis, configuración privada ni secretos reales.
El servidor relativo `/` permite usarlo desde el origen donde se descarga.

Artefacto [openapi.json](../openapi.json), generado desde
`apps/api/src/openapi/document.ts` y contratos compartidos. Para regenerar y comprobar:

```powershell
node --import tsx scripts/export-openapi.mjs
node --import tsx scripts/export-openapi.mjs --check
```

La exportación no necesita servicios ni secretos.
La entrega de requisitos necesita migración 008 antes de arrancar su API;
ya se aplicó a la instancia local en el despliegue de `ee55b37`.
Ver [uso de requisitos](../requirements/VERSIONED_REQUIREMENTS_API.md).
El código local añade inicio/pausa de tiempo por agente y consulta diaria por tarea;
requiere migración 009. Ver [tiempo registrado](../requirements/TASK_WORK_TIME_API.md).
Las pruebas comparan el inventario de controllers Nest y comandos concretos con
el documento, resuelven sus referencias y validan muestras reales de respuestas.

Cookie `acc.sid` más `x-csrf-token` y Origin exacto para POST humano; Bearer con
audiencia API y scopes para agentes. Login empieza obteniendo cookie/CSRF anónimos
mediante auth/session. Las operaciones administrativas/propias y validar DONE
exigen usuario humano. Idempotency-Key se exige en comandos transaccionales de
proyecto, tareas y sesiones; cuentas/credenciales no ofrecen ese replay.

Los esquemas de entrada se convierten desde Zod. Sus refinamientos de negocio y
normalización se documentan como validaciones adicionales del servidor; no se
pretende que JSON Schema las replique por completo. Las respuestas incluyen modelos
de recursos y envelope; Mutation documenta campos comunes con extensiones propias
de cada comando. [Resultado de verificación](../OPENAPI_RESULT.json).

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

Usuarios son identidades humanas que entran con contraseña/sesión; agentes son
automatizaciones que usan tokens API/MCP. Ambos tienen membresías por proyecto.
Varias credenciales pueden pertenecer al mismo agente; emitir otra credencial no
implica necesariamente otra identidad. Solo las personas pueden dar el OK humano
posterior a DONE; los agentes pueden ejecutar el resto del flujo autorizado.

Cada agente tiene un usuario propietario obligatorio. «Mis agentes» permite a
cada usuario consultar/crear sus agentes, emitir varias credenciales, asignar
proyectos y retirar acceso o revocar credenciales propias. El administrador puede
gestionar todos. La lista global de usuarios incluye sus agentes y el contexto de
proyecto identifica nombre del agente/propietario. Un token no elige ni suplanta
al propietario: se resuelve desde la BD en cada autenticación.

| Método   | Ruta bajo /api/v1                          | Operación                                      |
| -------- | ------------------------------------------ | ---------------------------------------------- |
| GET/POST | `/agents`                                  | Lista propia o creación con credencial inicial |
| POST     | `/agents/:agentId/credentials`             | Otra credencial para la misma identidad        |
| POST     | `/agents/:agentId/projects/:projectId`     | Asignar/retirar proyecto con versión           |
| POST     | `/agents/credentials/:credentialId/revoke` | Revocar credencial propia; ADMIN puede todas   |
| GET      | `/admin/agent-identities`                  | Identidades y propietarios globales para ADMIN |

Crear recibe label, projectIds (uno o varios), scopes, audiences y expiresInDays.
ADMIN puede indicar ownerUserId; un usuario solo puede elegir su propio ID. Se
mantiene projectId singular en el endpoint anterior por compatibilidad. Una
credencial adicional no crea otro agente. Las asignaciones reciben
`{active,scopes,expectedVersion}` y exigen acceso suficiente del propietario.
Deshabilitar al usuario bloquea sus agentes; retirar su acceso por proyecto los
restringe y termina sesiones/claims afectados. Eventos nuevos incluyen actorUserId
como atribución, además de actorId; los anteriores conservan atribución desconocida.

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

### Catálogo de repositorios (código desde migración 011)

`GET /api/v1/projects/:projectId/repositories` acepta `limit` (20 inicial,
máximo 100) y cursor firmado vinculado al recurso, proyecto y principal. Devuelve
`{data:{items:[{id,name,url}],nextCursor},meta}` en orden UUID. Accesible con
cookie humana o bearer de agente con acceso de lectura al proyecto.

`POST` en la misma ruta exige cookie/CSRF, Idempotency-Key y humano
OWNER/ADMIN/MANAGER del proyecto. Entrada estricta:

```json
{
  "name": "dashboard",
  "url": "https://github.com/eayero/ia-dashboard"
}
```

Nombre NFC/espacios normalizados (1–120 caracteres); URL HTTPS absoluta de hasta
2048 caracteres sin credenciales, query, fragmento, whitespace o barras invertidas.
Se normaliza mediante URL estándar conservando mayúsculas del path y `.git`.
Solo registra metadatos; no clona ni solicita el recurso remoto.

La URL normalizada identifica el repositorio dentro del proyecto. Si existe,
devuelve su ID y nombre original sin modificarlo ni generar otro evento; la misma
clave y payload devuelve la respuesta original. Otra intención con la misma clave
devuelve 409. El rol vigente se valida antes de recuperar respuestas anteriores.
Una alta nueva devuelve 201 con `{data:{id,name,url,projectSeq},meta}` y confirma
repositorio, auditoría `repository.registered` y outbox en la misma transacción.

Los agentes no registran repositorios mediante sus permisos `task:write`; los
descubren por GET o por registros REPOSITORY del contexto MCP ya existente. Usar
el ID para evidencias CODE/TEST con el mismo commit publicado completo. No hay
edición/borrado ni herramienta MCP nueva. Migración 011 y API/worker/UI deben
actualizarse juntos para reconocer el discriminador de eventos REPOSITORY; las
migraciones anteriores se conservan. Una duplicidad histórica de URL detiene la
migración para revisión explícita, sin fusionar IDs ni perder evidencias.

Estado de entrega y verificación:
[REPOSITORY_REGISTRY_RESULT.json](../requirements/REPOSITORY_REGISTRY_RESULT.json).

### Tareas y sesiones

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

## Estados autónomos y validación posterior

El agente con task:write puede mover tareas por todos los estados válidos hasta
DONE, cancelar y reabrir; se mantienen evidencias técnicas, dependencias, versiones
y claims. La evidencia elegible declarada satisface los gates sin aceptación
humana previa. Los endpoints antiguos approve/accept-evidence se conservan para
compatibilidad e historial, pero ya no bloquean las transiciones.

`POST /api/v1/projects/:projectId/tasks/:taskId/validate` recibe
`{expectedVersion,workRevision,note?}`, Idempotency-Key y CSRF de la sesión humana.
Exige humano con rol OWNER/ADMIN/MANAGER/REVIEWER y estado DONE. Registra un OK
append-only con autor/fecha/revisión/finalización; no cambia estado ni revisión,
pero incrementa versión técnica y emite task.validated junto con outbox. Un OK
por finalización; conflicto devuelve TASK_ALREADY_VALIDATED (409). Agentes y
VIEWER reciben 403; antes de DONE devuelve TASK_NOT_DONE (422). La reapertura
conserva el registro como histórico. Detalle expone validations/current y
completionVersion; contexto incluye registros VALIDATION. No hay herramienta MCP
de agente que pueda emitir el OK humano.

## Comprobar

Ver los comandos de [verificación local](local.md). Las integraciones usan
PostgreSQL/Redis locales y esquemas aislados; Keycloak no es necesario.
`local-auth.test.ts` cubre login/CSRF, cambio obligatorio, reset, administración,
roles, revocación y límites. `bootstrap.test.ts` comprueba conservación de estado,
concurrencia y rollback cuando faltan secretos. Las suites REST/MCP comprueban
claims, fencing, flujo autónomo y validación posterior. La administración nueva
también se revisó por navegador en escritorio y móvil; ver
[resultado](../ADMIN_BROWSER_RESULT.json), con alcance y simulaciones explícitos.
La propiedad de agentes, permisos y uso de una credencial MCP en varios proyectos
se verifican en `local-auth.test.ts` y la conservación de identidades legadas en
`agent-migration.test.ts`. Ver [resultado](../AGENT_OWNERSHIP_RESULT.json).

Socket.IO `/ws/v1` comparte sesiones y autorización de proyecto con REST. Usa
REDIS_URL opcional para las notificaciones del outbox; REST sigue operativo sin
Redis. No ofrece comandos de escritura por WS. Protocolo, revocación y recuperación:
[eventos](events.md).

Instancia local actualizada: UI de requisitos y tiempo explícito desplegados con
migración 009 y 22 herramientas MCP. Ver [despliegue](../requirements/TASK_WORK_TIME_DEPLOYMENT.json).

Instancia local actualizada con el contrato obligatorio y migración 010, commit
`94d7a34`; las notas anteriores de despliegue pendiente son históricas.
Ver [despliegue verificado](../requirements/TASK_REQUIREMENT_DEPLOYMENT.json).
