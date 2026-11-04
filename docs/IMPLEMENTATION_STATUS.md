# Estado de implementación — bootstrap

## Publicación y conciliación confirmadas

Por petición «haz el push», publicado `0c347e0df945e8db02dea8adc2a20fd8aa9aaa26`
en `origin/feat/acc-foundation`: flujo autónomo/validación posterior, agentes de
usuarios con varios proyectos, WebSocket, OpenAPI y revisión de administración.
Comprobaciones: 56 unitarias, 92 integraciones, tipos, lint, formato y build.

BOOT-006 y ACC-LOCAL-011/013/016/017/018 están en DONE con evidencia HTTPS del
commit, conservando IDs/criterios. Se verificaron seis detalles, dos páginas de
contexto y delta completo en secuencia 180. Sesión finalizada y claims liberados.
El agente no emitió validación humana; se conserva la validación previa de Compose.
[Registro](PUBLICATION_RESULT.json) y [copia MCP](ACC_WORK_SYNC.json).
El resto del MVP sigue pendiente. Los apartados siguientes y los snapshots de
los informes conservan la comprobación previa a publicar; la sección publication
de cada informe refleja la publicación y el cierre actuales.

## OpenAPI de las rutas REST implementadas

Completado localmente el pendiente OpenAPI de BOOT-006: contrato 3.1.1 público en
`/api/v1/openapi.json`, con 45 operaciones, 40 paths y 57 esquemas. Incluye entradas
generadas desde Zod, autenticación cookie/CSRF/Origin y bearer API, permisos humanos,
idempotencia real, paginación y modelos de respuestas/errores. El inventario se
compara con los controllers registrados por la API; los comandos concretos usan
el mismo registro que el dispatch REST. Artefacto reproducible:
[openapi.json](openapi.json), exportado con
`node --import tsx scripts/export-openapi.mjs` y comprobado añadiendo `--check`.

Las transformaciones/refinamientos de negocio se explican como validaciones
adicionales del servidor; Mutation describe campos comunes con extensiones por
comando. No se añaden entidades pendientes al documento. El contrato no contiene
configuración privada ni habilita mutaciones sin permisos. Se comprobaron muestras
reales de identidad, usuarios/agentes, tareas, contexto/delta y errores.

Pasan 56 unitarias y 92 integraciones, tipos API/integraciones, lint, formato y
build de cinco paquetes. La prueba nueva dejaba inicialmente una tarea BACKLOG
en el esquema aislado y afectaba un conteo anterior: ahora la cancela por API;
suite HTTP y global pasaron sin modificar las aserciones previas.
La API compilada responde 200 por proxy y directamente, coincide con el artefacto,
no crea cookie y no refleja Host ni configuración privada. Comandos de exportación
directos con Node; manifiestos y dependencias sin cambios. El build conjunto tuvo
un timeout de Docker Hub; el build API posterior pasó, incluyendo comprobación de
políticas pnpm y compilación de cinco paquetes. API/UI/worker locales restaurados.
[Plan](superpowers/plans/2026-11-04-openapi.md), [operación](runbooks/api.md) y
[resultado](OPENAPI_RESULT.json). BOOT-006 conserva IN_PROGRESS hasta publicar
evidencia formal; resumen duplicado por MCP, sesión finalizada y claim liberado.
Sin nuevo commit/push. Siguientes pendientes: requisitos/decisiones/preguntas e
impacto, creación general de proyectos y revalidación del cliente Claude.

## WebSocket autorizado y recuperación comprobados

Implementado localmente ACC-LOCAL-013: Socket.IO `/ws/v1` comparte autenticación
y permisos de proyecto con REST; consume Redis Streams con cursores por proceso.
Reautoriza conexiones abiertas antes de entregar eventos y cada segundo en reposo.
Logout, reset, caducidad, cambio obligatorio, membresía retirada o propietario
deshabilitado cortan el acceso; no se exponen credenciales Redis ni fencing.

El dashboard invalida contexto/detalle, recupera por delta y mantiene consulta
REST de cinco segundos como respaldo. La comprobación del navegador detectó que
la pérdida de red podía dejar el socket esperando su timeout: se corrigió con
cierre/reconexión explícitos en offline/online y el recorrido repetido pasó.
Evento visible en 836 ms en una muestra local; nueva conexión autorizada y cambio
creado durante desconexión recuperados. No acredita p95 ni carga objetivo.

Pasan 53 unitarias, 90 integraciones, tipos API/web/integraciones, lint, formato y
build Docker de cinco paquetes. API/UI/worker actualizados localmente. Revisión
1440×900 y 390×844 sin desbordamiento; tareas sintéticas canceladas al terminar.
[Plan](superpowers/plans/2026-11-04-websocket.md),
[protocolo](runbooks/events.md) y [resultado](WEBSOCKET_RESULT.json).
Resumen duplicado por MCP, sesión finalizada y claim liberado. ACC-LOCAL-013
permanece IN_PROGRESS hasta publicar evidencia formal; sin nuevo commit/push.
Siguientes bloques pendientes: OpenAPI, entidades de requisitos/decisiones/preguntas
e impacto y la revalidación del cliente Claude con autenticación propia.

## Agentes de usuarios y múltiples proyectos comprobados

Implementado localmente: cada usuario gestiona sus agentes en **Mis agentes** y
los asigna a proyectos donde tiene permisos; ADMIN gestiona todos y ve los agentes
de cada usuario. La identidad se conserva al emitir varias credenciales API/MCP.
Una configuración MCP accede a varios proyectos asignados. Autenticación, contexto
y auditoría identifican agente y propietario; los permisos vigentes del usuario
limitan el acceso y la escritura del agente.

Migración 007 aplicada sin alterar las identidades, credenciales ni membresías
existentes; configuración MCP original sigue operativa. Pasaron 50 pruebas
unitarias, 81 integraciones, tipos, lint y build Docker. Navegador real comprobó
gestión propia, dos proyectos, dos credenciales de la misma identidad, retiro de
proyecto y revocación independiente. Pantallas 1440×900, 1024×768 y 390×844 sin
desbordamiento ni solapamientos. Usuario sintético deshabilitado y credenciales
revocadas; se conserva proyecto sintético para trazabilidad.

[Diseño](AGENT_OWNERSHIP_DESIGN.md) y [resultado](AGENT_OWNERSHIP_RESULT.json).
ACC-LOCAL-018 tiene resumen verificado por MCP; permanece IN_PROGRESS mientras
la evidencia está local sin publicar. Sesión finalizada y claim liberado. Sin
nuevo commit/push. Las notas siguientes conservan resultados anteriores.

## Conciliación MCP del trabajo publicado

ACC-LOCAL-010 y ACC-LOCAL-012 ya están en DONE con evidencias del commit `c273f4d`.
El agente no las validó. Una lectura posterior registra OK humano para
ACC-LOCAL-012; ACC-LOCAL-010 seguía sin validación. Se usaron sesión, claims, resúmenes, evidencias y transiciones
MCP nativas; se confirmó el resultado por lectura. Ver
[ACC_WORK_SYNC.json](ACC_WORK_SYNC.json). ACC-LOCAL-011 ya tiene revisión de navegador
completada y resumen duplicado; su cierre formal espera publicar la evidencia.
Sesión finalizada y claim liberado. Las referencias siguientes a BACKLOG o habilitación humana
conservan contexto histórico y no sustituyen este registro actual.

## Administración web y móvil comprobada

La revisión real cubre creación/asignación VIEWER, login/cambio obligatorio,
rechazo a reutilizar contraseña temporal, permisos, logout, reset y
deshabilitación/reactivación. Reset/deshabilitación invalidan la sesión abierta.
La pérdida/caducidad de cookie se simuló en el contexto aislado; no se esperó una
hora. Credencial mostrada al emitir, ausente tras cerrar/recargar y de storage,
revocada por UI y rechazada por API. Recursos sintéticos deshabilitados/revocados.

Corregido el solapamiento real de logo/botones en la cabecera móvil con una fila
propia para la marca. Se reprodujo antes y midió cero solapamientos después, sin
desbordamiento, en 1440×900 y 390×844. Lint, formato, tipos web y build de cinco
paquetes en Docker pasaron. [Resultado](ADMIN_BROWSER_RESULT.json). Sin nuevo
commit/push; ACC-LOCAL-011 permanece IN_PROGRESS hasta publicar evidencia formal.

## Flujo autónomo y validación posterior a DONE

Implementado localmente por instrucción del usuario: agentes con task:write pueden
recorrer todos los estados válidos hasta DONE, cancelar y reabrir sin aprobaciones
humanas previas. Evidencias declaradas elegibles conservan los gates técnicos.
Una persona con permisos puede validar en DONE sin cambiar estado ni revisión;
solo avanzan versión técnica y auditoría/outbox. El OK es append-only y se liga a
la finalización; reapertura conserva el historial y deja la siguiente sin validar.

Migración 006 aplicada, REST validate y lecturas de detalle/contexto disponibles;
UI distingue completada/validada. Recorrido sintético por MCP nativo hasta DONE y
validación por interfaz comprobados en 1440×900 y 390×844, sin desbordamiento.
Diseño: [AGENT_WORKFLOW_DESIGN.md](AGENT_WORKFLOW_DESIGN.md). Evidencia y seguimiento
MCP: [AGENT_WORKFLOW_RESULT.json](AGENT_WORKFLOW_RESULT.json). Sin commit/push de
este cambio. Las notas de gates humanos siguientes son históricas y quedan
sustituidas por esta decisión.

MCP directo de Codex comprobado con seis herramientas nativas: proyecto accesible,
15 referencias del catálogo conservadas, títulos/criterios e IDs coincidentes,
reintentos sin duplicados y contexto/delta completos en secuencia 35. Evidencia:
[CODEX_MCP_RESULT.json](CODEX_MCP_RESULT.json). Las 15 tareas siguen en BACKLOG.
Reinicio/idempotencia de Compose comprobados; guías operativas, ADR y sustituciones
de Q8/Q36 actualizadas para autenticación propia. Siguiente acción: validar
administración web/móvil. La migración se publicó en `c273f4d` en
`origin/feat/acc-foundation`; la ampliación posterior del flujo MCP sigue local.

## Duplicación obligatoria de todo el trabajo

La guía compartida exige duplicar cada bloque de trabajo por MCP. Conciliación
actual de 16 referencias: [ACC_WORK_SYNC.json](ACC_WORK_SYNC.json). ACC-LOCAL-016
registra la nueva instrucción y el resumen de avances/publicación de las 15 tareas
anteriores, sin modificar sus criterios ni estados. BOOT-009 ya estaba en
IN_PROGRESS y se conservó. Sesión de conciliación finalizada y delta comprobado.
Las evidencias formales por tarea siguen pendientes de los estados/claims exigidos;
no se declara sincronización completa de esos campos ni aprobación humana.

## Verificación posterior — Compose y bootstrap

Bootstrap repetido y reinicio de PostgreSQL/Redis/API/worker/UI conservaron los
datos comparados y los archivos de credenciales. API/UI/PG/Redis saludables,
worker activo y migrate/bootstrap con salida 0. Proxy, CSP, 404 de assets y smoke
MCP de 15 herramientas comprobados. [Evidencia](COMPOSE_VERIFICATION.json).

Tres integraciones nuevas prueban bootstrap concurrente, conservación de
contraseñas cambiadas, permisos retirados, cuentas deshabilitadas y credenciales
revocadas/expiradas; rollback sin secretos guardados y rechazo fuera de local.
Pasan 52 unitarias, 76 integraciones, tipos de foundation/integraciones y lint.
No se modificaron migraciones aplicadas ni se borraron volúmenes.

Documentación de autenticación actualizada en decisiones, especificación, ADR y
runbooks local/API/MCP/web/eventos. El recorrido visual anterior queda identificado
como histórico; administración/móvil nuevos siguen pendientes. Las tareas espejo
siguen en BACKLOG: no se atribuyen aprobaciones ni cierre a estas comprobaciones.
La evidencia ya tiene URL HTTPS en el commit publicado. Su asociación formal a
ACC-LOCAL-012 y ACC-LOCAL-010 sigue pendiente de habilitación humana desde BACKLOG
y del claim exigido; el avance está duplicado como contexto en ACC-LOCAL-016.

## Seguimiento duplicado en ACC

Por petición del usuario, los archivos siguen como referencia principal y se
duplica el seguimiento en el proyecto local de ACC. Catálogo de 15 tareas:
[acc-tasks.json](acc-tasks.json). Correspondencias y comprobaciones reales:
[ACC_MIRROR_RESULT.json](ACC_MIRROR_RESULT.json). Procedimiento y límites:
[ACC_MIRROR.md](ACC_MIRROR.md). La copia no acredita cierre ni aprobación humana.

## Reanudación — autenticación propia y Compose completo

Trabajo reanudado por petición del usuario. Compose compilado y arrancado: API,
UI, PostgreSQL y Redis saludables, worker activo, migrate/bootstrap con salida 0.
Smoke MCP oficial correcto (15 herramientas, contexto y delta). Pasan 52 unitarias,
73 integraciones, tipos/build de cinco paquetes, lint, formato y diff check.
Corregida reutilización de contraseña temporal (API y formulario), con regresión
que conserva el cambio obligatorio. Nginx devuelve 404 en assets inexistentes.
Login de escritorio revisado en navegador. Administración y móvil siguen
pendientes; el reinicio/bootstrap y las guías de autenticación se comprobaron y
actualizaron después, según el registro anterior. Sin commit ni push.

### Registro de la pausa anterior

Desarrollo detenido por petición expresa del usuario el 2026-11-03. Cambios de
autenticación y contenedores guardados localmente, sin commit/push de este hito.
Detalle, verificación y siguientes pasos: [RESUME_LOCAL_AUTH.md](RESUME_LOCAL_AUTH.md).

La decisión aprobada sustituye Keycloak por acceso propio de ACC e incorpora API/UI
a Compose. Migración 005 aplicada localmente; pasaron 52 unitarias, 73 integraciones
y build/tipos. Login/administración web pendientes de revisión visual. Los builds y
descargas Docker activos se interrumpieron al pausar; arranque completo sin validar.
Las secciones siguientes registran hitos anteriores y no sustituyen estas notas.

Este archivo registra trabajo comprobable hasta que ACC pueda almacenar su propio
estado. IDs BOOT preservables por importación idempotente. No son IDs emitidos por ACC.

| ID       | Objetivo                                        | Estado       | Evidencia/pendiente                                                                              |
| -------- | ----------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| BOOT-001 | Registrar especificación y acuerdos Q1–Q40      | Implementado | SPECIFICATION.md, DECISIONS.md                                                                   |
| BOOT-002 | Monorepo y herramientas verificables            | Implementado | pnpm 12.16.1/lockfile; tipos y build globales de cinco paquetes comprobados                      |
| BOOT-003 | PostgreSQL/Redis/Keycloak locales reproducibles | Implementado | Tres servicios saludables; migración local aplicada                                              |
| BOOT-004 | Dominio y contratos con pruebas                 | En curso     | 50/50 unitarias; dominio, contratos, runtime y recuperación de caché web                         |
| BOOT-005 | Persistencia y carreras reales                  | En curso     | 67/67 integraciones; workflow, HTTP/MCP, contexto y recuperación Redis; resto pendiente          |
| BOOT-006 | REST autenticado y flujo OIDC                   | En curso     | BFF humano y JWT agentes reales; tareas/sesiones REST; administración general/OpenAPI pendientes |
| BOOT-007 | MCP y smoke real de clientes                    | En curso     | 15 herramientas; SDK y conexión Claude probados; Codex y recorridos completos pendientes         |
| BOOT-008 | Diseño UI, dashboard e inbox                    | En curso     | SPA real revisada en escritorio/móvil; tareas, atención y sesiones; otras vistas pendientes      |
| BOOT-009 | Recorrido E2E hasta DONE                        | En curso     | REST, MCP/SDK y recorrido humano web probados; clientes completos y WS pendientes                |

## Entrega autorizada

Fundación y primer slice hasta DONE. Resto del MVP sigue pendiente.
Commit y push de los cambios del proyecto autorizados por petición expresa del
usuario: «continua y sube los cambios al repo». Se mantiene feat/acc-foundation;
no se autorizó merge ni despliegue.

## Dashboard y subida de la fundación — 2026-11-03

- SPA React/Vite con TanStack Router/Query, diseño aprobado, selección de proyecto,
  resumen, tabla, búsqueda/filtros, atención y sesiones. Usa datos reales.
- Crear tareas, detalle/versiones, claims, implementación, informes/evidencias,
  aceptación humana, revisión, QA, cierre y devolución motivada. Roles y gates
  siguen validados por la API; no se persisten tokens OIDC en el navegador.
- Snapshot completo y delta cada cinco segundos; no aplica payloads parciales.
  Datos incompletos/desactualizados, desconexión y conflictos bloquean acciones.
  Rutas conservan proyecto/tarea tras recarga; cachés separadas por identidad.
- Expiración corregida con reproducción negativa en navegador y regresión unitaria:
  un 401 cancela consultas, retira datos privados y muestra acceso inmediatamente.
- Proxy local de API/MCP/discovery y reserva WS; web y API compiladas ejecutables.
  Build/tipos globales, tipos de integraciones, lint/formato, 50 unitarias y 67
  integraciones reales comprobados.
- Playwright CLI: tarea sintética OTHER hasta DONE con evidencia aceptada y
  aprobaciones humanas separadas; sesión de trabajo finalizada. Escritorio 1440x900,
  móvil 390x844, recarga, foco/Escape, desconexión y estados inyectados de error/consulta.
  [Operación y límites de la revisión](runbooks/web.md).
- Preview compilado, persistencia tras reiniciar API y logout comprobados. MCP y
  discovery también probados a través del proxy del origen público.
- Esta entrega usa la rama feat/acc-foundation, con commit/push autorizados;
  credenciales, cachés, navegador y artefactos locales excluidos. Consultar el
  historial y seguimiento remoto de Git para el SHA y estado de publicación.

Siguiente paso: WS autorizado y reconciliación tras reconexión; pruebas completas
Codex/Claude, skill portable y adaptador ECC. También faltan administración,
OpenAPI, preguntas/decisiones/requisitos/impacto, edición web de alcance/dependencias
y gestión de alertas. El hito no completa todo el MVP ni acredita producción.

## Hito anterior: gateway MCP autenticado — 2026-11-03

Trabajo local en feat/acc-foundation, sin commit ni publicación.

- Streamable HTTP `/mcp` integrado en NestJS con SDK oficial estable 1.32.2.
  Transporte sin estado: no confunde conexión MCP con sesión ACC explícita.
- Quince herramientas de proyectos, contexto/delta, tareas, claims, sesiones,
  transiciones y evidencia; contratos estrictos compartidos con REST y comandos
  transaccionales existentes. Errores estables con isError/structuredContent.
- Bearer validado en cada petición, audiencia propia `${PUBLIC_ORIGIN}/mcp`,
  Origin exacto y discovery de recurso OAuth. Tokens solo REST y cookies BFF
  rechazados. Scopes insuficientes usan HTTP 403 con challenge; las membresías
  activas y los gates humanos se siguen resolviendo en PostgreSQL.
- Bootstrap idempotente añade scope opcional `acc:mcp` con mapper de audiencia;
  conserva permisos/revocaciones. No requiere migración nueva.
- Pasan 47 unitarias y 67 integraciones reales, incluyendo siete MCP con cliente
  oficial: contratos, delta, reintentos, dos clientes/claim, fencing, evidencia,
  gates hasta DONE y revocación. Tipos/build, lint y formato comprobados.
- API compilada probada con cliente SDK: quince herramientas y contexto/delta.
  Claude Code 2.1.317 confirmó conexión HTTP mediante configuración aislada en
  `.cache`, sin cambiar ajustes globales. Esto no acredita su recorrido de tareas.
- Codex CLI no disponible en PATH; faltan su smoke y los recorridos completos de
  ambos clientes. Login interactivo MCP, skill portable y adaptador ECC pendientes.
  [Operación, herramientas y límites](runbooks/mcp.md).

Siguiente paso: SPA con la dirección visual aprobada, proxy del origen público y
WS; completar smoke de clientes y recorrido E2E. Siguen pendientes administración
general, OpenAPI, preguntas, decisiones, requisitos/impacto y otras entidades.
El gateway funcional no completa todavía la primera entrega de producto.

## Hito anterior: contexto y outbox — 2026-11-03

Trabajo local en feat/acc-foundation, sin commit ni publicación.

- Contexto materializado en PostgreSQL con snapshot REPEATABLE READ, paginación
  estable, TTL de diez minutos y cursor reanudable entre instancias de API.
- Delta ordenado por secuencia BIGINT decimal, con límite superior por tanda.
  Cursores firmados ligados al proyecto/principal; cada lectura vuelve a autorizar.
  Huecos, expiración o secuencias adelantadas solicitan un snapshot nuevo.
- El contexto excluye credenciales y sesiones HTTP. Solo el propietario recibe
  fencing; el envelope público de eventos lo omite y conserva la auditoría original.
- Publicador independiente con leases, tokens de intento, reintentos y Redis
  Streams. Las mutaciones no esperan a Redis; PostgreSQL permite recuperar eventos
  aunque el stream se pierda. Entrega al menos una vez, con posibles duplicados.
- Migración 004 aplicada localmente; migraciones anteriores intactas. API y worker
  compilados comprobados juntos: evento consultado por delta, recibido en Redis y
  confirmado en outbox. La sesión sintética usada quedó cerrada.
- Verificación: 47 unitarias y 60 integraciones; tipos/build de API y foundation,
  lint y formato. Regresiones cubren permisos, privacidad, BIGINT, concurrencia,
  pérdida de ACK, indisponibilidad de Redis y recuperación desde PostgreSQL.
- [Operación y límites](runbooks/events.md). API y worker arrancados localmente;
  comprobar procesos antes de iniciar otra instancia.

Siguiente paso en ese hito: MCP autenticado y smoke con cliente real; después SPA y WS con
recorrido E2E. También faltan administración general, OpenAPI, preguntas,
decisiones, requisitos/impacto y otras entidades del slice. La primera entrega
completa sigue pendiente. La dirección visual está aprobada.

## Hito anterior: API autenticada OIDC/REST — 2026-11-03

Trabajo local en feat/acc-foundation, sin commit ni publicación.

- NestJS modular ejecutable: auth, proyectos/tareas/sesiones y health. Controllers
  reutilizan los contratos y comandos de coordinación; no duplican gates.
- BFF Code + PKCE S256 con Keycloak real, state/nonce, rotación de sesión y CSRF.
  Cookie HttpOnly/Lax, Secure con HTTPS/producción, sesión HTTP persistida en PG.
  Tokens OIDC no se persisten; issuer/sub preaprovisionado identifica al principal.
- Agentes: JWT RS256/JWKS, issuer, audiencia, expiración y scopes; autorización
  activa por proyecto. Revocar acceso termina sesiones ACC e invalida claims con
  fencing/auditoría/outbox. Se probó revocación concurrente con adquisición de claim.
- Bootstrap local idempotente de owner, proyecto y dos service accounts; conserva
  permisos y revocaciones. Credenciales en archivos ignorados, nunca en logs o auditoría.
- Rutas de tareas y sesiones, detalle consistente, paginación firmada, errores
  estables, JSON limitado, Helmet, no-store y rate limit local por proceso.
- Migración 003 aplicada localmente; 001/002 intactas. Pasan 42 unitarias y 48
  integraciones reales, lint, tipos/build de API y foundation. Trece integraciones
  HTTP prueban login real, gates, dos agentes, permisos y casos de seguridad.
- API compilada arrancada en loopback 53000: readiness 200, proyectos anónimos 401.
  Comprobar si sigue activa antes de arrancar otra. [Guía operativa](runbooks/api.md).

Siguiente paso en ese hito: contexto/snapshot/delta y publicador outbox, MCP y SPA con E2E.
Siguen pendientes administración general de proyectos/credenciales, OpenAPI,
preguntas, decisiones, requisitos/impacto y el resto del slice. El backend probado
no equivale aún a la primera entrega completa. La dirección visual ya está aprobada.

## Hito anterior: flujo transaccional persistido — 2026-11-03

Trabajo local en feat/acc-foundation, sin commit ni publicación.

- Liberación por propietario vigente y revocación por OWNER/ADMIN con motivo,
  fencing y auditoría. Actualización del trabajo exige sesión, lease, token y versión.
- Dependencias DAG, bloqueos automáticos, recuperación READY y alertas persistentes
  para tareas DONE cuyo prerrequisito se reabre. Cambiar alcance humano revoca claims
  y aprobaciones afectadas; los bloqueos manuales se conservan independientemente.
- Evidencias ligadas a criterios/revisión con aceptación humana. CODE exige pruebas
  PASS del mismo repositorio/commit y hashes completos SHA-1/SHA-256. Resultados
  fallidos se conservan como evidencia, pero no satisfacen criterios de ninguna tarea.
- REVIEW, QA y CLOSURE se aprueban por separado y se vinculan a work_revision.
  Agentes no aprueban ni aceptan evidencia, también protegido por FK en PostgreSQL.
- Migración 002 aplicada localmente; 001 conserva su checksum. Build y tipos de
  foundation, lint, 40 unitarias y 32 integraciones pasan. Se comprobaron carreras
  entre aprobaciones, dependencias opuestas, claims/reapertura y cierre/reapertura.
- Revisión propia con pruebas de regresión; no se delegó la revisión.

Siguiente paso en ese hito: OIDC real y REST sobre estos comandos, gestión de identidades/sesiones,
contexto/snapshot/delta y publicador outbox; después MCP y SPA con E2E autenticado.
Faltan también preguntas, decisiones, requisitos e impacto del resto del slice.
El recorrido interno probado no acredita aún una aplicación completa ni el E2E de producto.

## Hito anterior: reanudación de la fundación — 2026-11-03

Trabajo reanudado por petición expresa. Rama feat/acc-foundation, cambios locales
sin commit. Registro del hito: [FOUNDATION_PROGRESS.md](FOUNDATION_PROGRESS.md).

- Instalación completa y `pnpm install --frozen-lockfile` exitoso. PATH de pnpm
  local documentado en [runbook](runbooks/local.md).
- pnpm 12 usa `allowBuilds`: Prisma/esbuild permitidos, Scarf denegado. Las skills
  de dependencias siguen sin aprobarse. Excepciones de antigüedad por versiones
  exactas fueron registradas por pnpm durante la primera resolución.
- Contratos Zod estrictos, dominio inicial, migración SQL con checksum y
  coordinación interna: crear tareas, adquirir/renovar claims, fencing, versiones,
  identidad externa, membresía, sesiones y mutación/evento/outbox transaccionales.
- Verificados: 34 pruebas unitarias, 14 integraciones PostgreSQL reales, lint,
  tipos/build de foundation y tipos de integración. Se probaron 100 claims
  concurrentes, 100 reintentos, fallos de outbox y aislamiento entre proyectos.
- Migración inicial aplicada localmente. Las pruebas usan esquemas aleatorios
  aislados y los eliminan al finalizar; no se borraron volúmenes.
- UI aprobada en dirección visual; implementación y revisión responsive pendientes.

Siguiente paso en ese hito: completar release/revocación y escrituras protegidas, dependencias,
aprobaciones/evidencias y transiciones persistidas; después OIDC/REST y recorrido
real por MCP/SPA. No hay API pública, aplicación completa ni publicador Redis.
No confundir el outbox persistente con eventos ya distribuidos.

## Pausa solicitada por el usuario — 2026-11-02

Registro histórico; la sección de reanudación anterior refleja el estado vigente.

Trabajo detenido por petición expresa. Rama: feat/acc-foundation. Sin commit ni publicación.

- Especificación y 40 acuerdos en docs/SPECIFICATION.md y docs/DECISIONS.md.
- Manifiestos del monorepo y configs creados; pnpm 12.16.1 instalado localmente
  en .tools/node_modules/pnpm/pnpm.exe. Instalación del workspace sin confirmar.
- Docker Compose y secretos locales preparados; descarga de imágenes interrumpida
  al pedir pausa. No imprimir .env ni credenciales de .cache. No borrar volúmenes.
- Dominio inicial: 16/16 pruebas pasan con
  node --experimental-strip-types --test packages/domain/src/domain.test.ts.
  Se comprobó fallo antes de implementar. Faltan contratos y pruebas adicionales.
- No ejecutados: lint, typecheck, build, integración PostgreSQL, auth, MCP ni E2E.
- Maqueta docs/design/overview.html creada; pendiente de revisión del usuario.
- Interrumpidas sesiones de instalación pnpm y Docker con Ctrl+C. Al retomar
  comprobar servicios, procesos y archivos antes de reiniciar instalaciones.
- Entorno aislado observó Node 24.20.0; ampliado Node 22.22.2. Fijar workdir
  D:\Dashboard y comprobar ejecutables. pnpm 12 usa binario nativo, no pnpm.cjs.
- Registro npm global tuvo ECONNRESET; .npmrc local usa registro público.

Siguiente paso al pausar: completar fundación, contratos, migración PostgreSQL y carreras
reales. Revisar diseño antes de implementar UI. La primera entrega no está terminada.
