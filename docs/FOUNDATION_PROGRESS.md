# Continuación de la fundación — 2026-11-03

Autoridad: SPECIFICATION.md y DECISIONS.md. Rama existente feat/acc-foundation;
se conservan todos los cambios locales. Sin commit ni publicación autorizados.

1. Reanudar instalación, generar lockfile y verificar herramientas.
2. Contratos estrictos de comandos y paginación, con pruebas de entradas hostiles.
3. Migración inicial PostgreSQL y ejecutor transaccional con checksum.
4. Claims con fencing e idempotencia, evento y outbox en una transacción;
   comprobar carreras reales, rollback y aislamiento entre proyectos.
5. Registrar verificaciones y límites del hito. Auth, MCP y UI siguen pendientes.

Preflight: contratos y dominio definen los estados y versiones que consumirá DB.
La persistencia usa tiempo PostgreSQL; no acepta gates declarados por clientes.
Decisión de ejecución: trabajar en la rama existente para preservar el bootstrap;
mantener este registro porque aún no se permiten commits. Revisión propia sin
delegación, según COMO-TRABAJAMOS.md.

Evidencia inicial: 28/28 pruebas del dominio; servicios Compose saludables.
Instalación pnpm reanudada con permisos de red; registro lento.

## Resultado del hito

- Instalación completa y segunda instalación `--frozen-lockfile` exitosa.
  `allowBuilds` sustituye la opción obsoleta `onlyBuiltDependencies` de pnpm 12.
  Scripts de Prisma/esbuild autorizados; telemetría de Scarf denegada.
  No se aprobaron ni instalaron skills de dependencias.
- Contratos: se observaron errores al convertir tokens y URLs inválidos;
  validación secuencial corregida y 34/34 pruebas unitarias pasan.
- PostgreSQL real: 14/14 integraciones, incluidas carreras de 100 solicitudes,
  fencing, sesiones, aislamiento, rollback y auditoría append-only.
- Build y typecheck de dominio/contratos/DB y tipos de integración pasan.
  Lint pasa. Migración aplicada en la BD local sin tocar datos ajenos.
- Revisión propia: consultas parametrizadas, orden de locks, membresía antes de
  replay idempotente y sesiones bloqueadas durante mutaciones. Aún no se expone
  esta capa por red: faltan autenticación y gates persistidos de dependencias.
- Usuario aprobó la dirección visual de overview.html el 2026-11-03.
  No equivale a una UI implementada o verificada.

Pendiente al cierre de ese hito: release/revocación y escrituras protegidas,
dependencias, aprobaciones/evidencias y transiciones persistidas, OIDC/REST,
publicador outbox, MCP y SPA con recorrido E2E hasta DONE. El hito actual no es
una entrega completa de producto.

## Continuación: flujo persistido hasta DONE

Alcance de este paso: release/revocación, actualización protegida del trabajo,
dependencias DAG, evidencias con aceptación humana, aprobaciones por revisión y
transiciones. Se comprueba en PostgreSQL real; no sustituye el E2E REST/MCP/UI.

Orden: claims → contratos y schema incremental → evidencias/aprobaciones y
transiciones → grafo/dependencias → carreras y regresión completa.
La migración 001 ya aplicada no se modifica. La 002 añade las nuevas entidades.
Gates se derivan de registros, nunca de booleanos aportados por el cliente.
El grafo usa advisory lock compartido para comandos normales y exclusivo para
cambios de dependencias/estados; evita carreras entre reapertura, claim y DONE.
Se conserva la rama y revisión propia; sin delegación, commit ni publicación.

Resultado: claims y workflow implementados; 40 unitarias y 32 integraciones pasan.
Migración incremental 002 aplicada; build/tipos de foundation y lint pasan.
Pruebas reales cubren DONE, gates fallidos, fencing, revisiones invalidadas,
aprobaciones concurrentes, DAG, bloqueo/desbloqueo, reapertura y alertas de DONE.
No se modificó la migración 001 ni se borraron datos/volúmenes existentes.

Revisión final propia (sin delegación, conforme a COMO-TRABAJAMOS.md):

- Se reprodujo y corrigió el uso de TEST FAIL como evidencia satisfactoria en
  tareas no técnicas; ahora solo TEST PASS es elegible para cualquier criterio.
- Se reprodujo y corrigió la conservación de un claim tras un cambio humano de
  dependencias satisfechas; ahora revoca fencing/aprobaciones y vuelve a READY.
- Se comprobó que un bloqueo nuevo en BACKLOG pasa a BLOCKED, y que resolver
  dependencias no elimina bloqueos manuales. Pruebas negativas primero, luego suite verde.
- Decisión reversible de planificación: revisión humana de contenido vuelve a
  BACKLOG; cambio de grafo vuelve a READY si ya está satisfecho, o BLOCKED si no.
  Siempre revoca propiedad activa. Coste: el ejecutor debe adquirir otro claim.
- Fuera de este paso: OIDC/REST/MCP/SPA, publicación de outbox e integración CI;
  no se declara listo el slice de producto por tener el recorrido interno probado.

## Continuación: OIDC y REST

Objetivo: servir los comandos existentes desde NestJS, con Code + PKCE real de
Keycloak, sesión BFF persistida en PostgreSQL, CSRF, autorización por objeto y
sesiones ACC explícitas. Ningún alta pública ni identidad elegida por el cliente.

Plan: configuración validada → migración de identidades/sesiones HTTP → bootstrap
local explícito → login/callback/logout y guards → lecturas y comandos REST →
recorrido HTTP real y pruebas negativas de autenticación/CSRF/permisos.
Las identidades locales se preaprovisionan por issuer/sub; no por email o username.
Los tokens OIDC se descartan tras validar la identidad. El secreto del cliente y
las credenciales sintéticas no se imprimen ni entran en auditoría/idempotencia.
Se reutilizan Zod y los comandos transaccionales; sin duplicar gates en controllers.

Resultado: OIDC y REST implementados para tareas y sesiones, con dos service accounts
reales en Keycloak. Migración 003 aplicada sin cambiar 001/002; bootstrap local
repetible y API compilada arrancada en 53000. Pasan 42 unitarias y 48 integraciones,
además de tipos/build de API y foundation, lint y formato.

Revisión propia y correcciones reproducidas con pruebas negativas:

- CSRF Unicode provocaba una comparación de buffers de distinta longitud; ahora
  compara tamaños en bytes y devuelve 403, sin excepción interna.
- Un Bearer acompañado de cookie podía invocar logout sobre la sesión humana;
  ese endpoint ahora exige modo COOKIE y mantiene la sesión ajena intacta.
- La identidad de una sesión BFF de otro issuer podía seguir aceptándose tras un
  cambio de configuración; ahora se exige también el issuer configurado vigente.
- El bootstrap retenía una conexión mientras pedía otra al pool; se liberó antes
  de aprovisionar agentes. Probado con pool de una conexión y preservación de revocaciones.
- JSON inválido se normalizaba como error genérico de Nest; el handler temprano
  conserva INVALID_JSON/PAYLOAD_TOO_LARGE sin revelar el cuerpo recibido.
- Un esquema de auth sin migrar permitía arrancar la API; ahora se comprueban las
  tablas/columnas necesarias antes de inicializar OIDC, middleware o readiness.
- Orden de locks: grafo antes de ACL y filas de entidades. La revocación exclusiva
  no puede esperar por una membresía retenida por un claim que espera el mismo grafo.
  Se probó claim/revocación concurrentes sin pérdida de propiedad ni deadlock.

Decisiones operativas: los scopes OAuth reales son client scopes de Keycloak,
la autorización del proyecto permanece en PostgreSQL, y el bootstrap conserva
membresías inactivas. Coste: reactivar permisos exige una operación administrativa
explícita; no basta con volver a ejecutar el bootstrap.

Pendiente: administración general de proyectos/credenciales y OpenAPI,
contexto/snapshot/delta, publicador Redis, MCP/SPA y entidades del resto del slice.
La prueba HTTP real hasta DONE no acredita interoperabilidad MCP ni una UI terminada.

## Continuación: contexto y publicación de eventos

Objetivo: snapshot consistente y paginado + delta por secuencia, y publicación
del outbox en Redis sin acoplar disponibilidad de Redis a las mutaciones.

Plan: contratos de secuencias/envelopes → snapshot materializado de los recursos
existentes → delta con watermark fijo y cursores firmados → leases de outbox →
Streams Redis con reintentos → worker independiente y pruebas HTTP/recuperación.

Decisiones: snapshots en caché PostgreSQL por diez minutos, vinculados a proyecto
y principal; solo la última página habilita el cursor de cambios. No se copia
ninguna sesión HTTP, token OIDC o client secret al contexto. Delta vuelve a
autorizar cada lectura y fija un límite superior por tanda. Redis entrega al
menos una vez; eventId permite deduplicación y seq orden/reconciliación contra PG.
Los streams tendrán MAXLEN aproximado de 10000 y TTL de siete días; PostgreSQL
conserva el historial y permite recuperar lo que ya no esté en Redis.
El publicador corre separado de la API, con lease/token de intento y backoff.
No hay commit, publicación externa ni delegación autorizados.

Resultado: contexto/delta y worker independiente implementados. Migración 004
aplicada sin modificar las anteriores. Pasan 47 unitarias y 60 integraciones reales,
tipos/build de API y foundation, lint y formato. API y worker compilados comprobaron
juntos una sesión ACC sintética: evento leído por delta, recibido en Redis y
confirmado en PostgreSQL. La sesión quedó cerrada.

Revisión propia, sin delegación, con regresiones negativas antes de corregir:

- El envelope público copiaba fencing del payload auditado. Ahora lo omite sin
  modificar la auditoría original; el contexto lo limita al principal propietario.
- El arranque compilado detectó una propiedad de parámetro TypeScript no admitida
  por Node nativo al importar DB. Se reprodujo en un proceso sin tsx y se corrigió;
  DB exige `erasableSyntaxOnly` para impedir que reaparezca.
- Se comprobaron snapshots inmutables entre instancias, autorización en cada página,
  expiración, watermark fijo, secuencias BIGINT, huecos y cursores manipulados.
- Cien intentos concurrentes adquieren una única entrega; dos workers toman eventos
  distintos. Perder el ACK permite duplicados y los tokens viejos no confirman ni
  invalidan el intento recuperado. Redis inaccesible conserva el evento para reintento.
- Eliminar solo un stream sintético no impide recuperar por delta desde PostgreSQL.
  La limpieza de caché elimina únicamente snapshots expirados en lotes acotados.

Consecuencias: clientes deben deduplicar por eventId y reconciliar secuencias;
un snapshot expirado exige comenzar de nuevo. El estado canónico sigue en PG.
Pendientes: MCP con cliente real, SPA aprobada, WS, carga objetivo, administración
general, OpenAPI y entidades restantes. Este hito no completa el slice de producto.

## Continuación: gateway MCP autenticado

Objetivo: exponer los comandos existentes por Streamable HTTP y comprobarlos con
cliente oficial, manteniendo identidad, scopes, autorización y gates del servidor.

Plan ejecutado: consultar SDK/protocolo oficiales y fijar dependencia estable →
pruebas de endpoint/discovery negativas → Bearer con audiencia propia y Origin →
herramientas sobre servicios existentes → cliente oficial, carreras y seguridad →
arranque compilado y comprobación de conexión de un cliente instalado.

Resultado: quince herramientas en `/mcp`, alojadas en la API para compartir runtime,
autenticación y cierre de recursos. No existe todavía un proceso `apps/mcp` separado.
Sesiones de transporte sin estado; registro/heartbeat/fin de sesiones ACC explícitos.
JSON Schema de entrada deriva de los mismos Zod estrictos; refinamientos se ejecutan
en servidor. Se comparte el normalizador de errores con REST y no se reenvían tokens.

Verificación: 47 unitarias y 67 integraciones, tipos/build de API y foundation,
lint y formato. SDK oficial 1.32.2 probado contra API compilada: quince herramientas,
snapshot y delta. Claude Code 2.1.317 confirmó Connected con `mcp list` en un
CLAUDE_CONFIG_DIR aislado dentro de `.cache`; no hubo sesión de agente delegada,
consumo de modelo ni cambios de configuración global. Codex CLI no aparece en PATH.

Revisión propia, sin delegación:

- Pruebas iniciales fallaron por `/mcp` inexistente; después por herramientas y
  errores estructurados ausentes. Se implementaron hasta obtener verde.
- El primer control de scopes de mutación devolvía error de herramienta HTTP 200.
  Una regresión reprodujo el incumplimiento: ahora se comprueban antes del transporte
  y responden HTTP 403 con challenge insufficient_scope y scopes requeridos.
- Discovery también anuncia `acc:mcp`: el scope opcional añade audiencia solo cuando
  se solicita. Los tokens REST ordinarios se rechazan en MCP; identidad deshabilitada,
  membresía y scopes continúan verificándose por cada petición/operación.
- Un cliente sintético de solo lectura, con token real emitido por Keycloak y
  membresía de escritura, pudo leer pero no registrar sesiones. Se eliminó solo ese
  cliente de prueba al terminar. Una cookie humana real tampoco autenticó MCP.
- Dos clientes oficiales compitieron por un claim: solo uno ganó. Se comprobaron
  heartbeat, liberación/recuperación, fencing obsoleto, escritura ajena, evidencia
  declarada, aprobación humana y cierre. QA/DONE siguieron reservados a humanos.
- Repetir una clave conserva identidad; cambiar proyecto o inyectar principal
  falla. Revocar membresía bloquea también replays desde el cliente ya conectado.

Límites: preaprovisionamiento/client_credentials; login interactivo MCP y registro
dinámico no implementados. Conexión Claude no equivale a ejecución de tareas; faltan
smoke Codex y recorridos completos de ambos. Proxy público, SPA/WS, skill portable,
adaptador ECC y entidades restantes pendientes. Sin commit ni publicación externa.

## Continuación: SPA y subida autorizada

El usuario autorizó continuar y subir los cambios al repositorio. Se conserva la
rama existente feat/acc-foundation; commit/push quedan incluidos en ese alcance.
No se hace merge a main ni despliegue. Las restricciones de publicación de los
hitos anteriores son registro histórico, sustituidas por esta autorización.

Objetivo: implementar la dirección visual aprobada sobre datos y comandos reales,
verificar escritorio/móvil y el recorrido humano hasta DONE, y publicar el trabajo.

Resultado: SPA con Router/Query, selección de proyecto, resumen, tareas, filtros,
atención y sesiones. Crear/planificar/reclamar/renovar/liberar, resumen e informes,
aceptación humana, revisión, QA, cierre y devolución usan REST con CSRF y claves
idempotentes. El contexto se obtiene completo, se actualiza con delta y se reconcilia
desde snapshots; no hay mutaciones optimistas ni tokens OIDC en storage del navegador.

Revisión propia, sin delegación:

- Dos unitarias comprobaron snapshot de varias páginas, secuencia BIGINT exacta y
  rechazo de páginas mezcladas/incompletas/cíclicas.
- El flujo real por proxy OIDC generó la cookie HttpOnly de revisión sin imprimir
  credenciales; se cargó esa cookie en Playwright aislado. La redirección de acceso
  se comprobó en navegador; el intercambio de login se automatizó por cliente HTTP.
- El navegador creó una tarea sintética OTHER y recorrió sesión, claim, resumen,
  evidencia, aceptación humana, revisión/QA/cierre y DONE. La sesión ACC quedó cerrada.
- Se revisaron 1440x900 y 390x844, tabla desplazable sin overflow del documento,
  detalle tras recarga y foco dentro del diálogo/restaurado tras Escape.
- Desconexión real del navegador bloqueó mutaciones. Respuestas de error y roles
  de consulta fueron inyectadas para comprobar los estados visuales y el reintento;
  la autorización real permanece cubierta por las integraciones de backend.
- Un 401 dejaba a observadores de Query ligados a la consulta eliminada: limpiar
  toda la caché y crear otra entrada me no notificaba inmediatamente a la vista.
  Se reprodujo el fallo en navegador antes de corregirlo. Ahora se cancela, se
  conserva la consulta observada en estado anónimo y se eliminan las otras cachés.
  Prueba unitaria del observador y repetición de navegador pasan.
- Se separó el detalle por principal; datos parciales/desactualizados, permisos
  insuficientes y conflictos de versión deshabilitan las acciones correspondientes.

Pasaron 50 unitarias, 67 integraciones, tipos/build globales de los cinco paquetes,
tipos de integraciones, lint y formato. Artefactos de Playwright, estado de sesión,
credenciales y cachés se mantienen ignorados; no se afirma auditoría WCAG completa
ni suite de navegador permanente. Se documentó detener web para integraciones,
que usan 55173. WS, clientes completos y entidades del resto del MVP pendientes.

Comprobación final de artefactos: preview compilado sobre la API reiniciada conservó
el detalle DONE tras recarga; logout eliminó datos privados inmediatamente. Discovery
y cliente MCP funcionaron también a través de 55173. Revisión de archivos candidatos
contra secretos locales y claves privadas sin coincidencias; artefactos ignorados
fuera del commit. La publicación usa origin/feat/acc-foundation y se verifica con Git,
sin merge ni despliegue.
