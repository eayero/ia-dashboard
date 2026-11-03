# Contexto y publicación de eventos

La API entrega contexto/cambios desde PostgreSQL; un proceso separado publica el
outbox en Redis Streams. Las mutaciones no esperan a Redis. [Guía de API](api.md).

## Recuperar contexto

1. `GET /api/v1/projects/:projectId/context?limit=20` materializa recursos y
   `projectSeq` en el mismo snapshot REPEATABLE READ. Límite inicial 20/máximo 100
   registros por página, no solo tareas.
2. Continuar con `context?cursor=...` mientras exista `nextCursor`. El tamaño queda
   fijado al iniciar. Las páginas no cambian con escrituras posteriores y se pueden
   retomar tras reiniciar la API.
3. Solo la última página devuelve `complete:true` y `changesCursor`. Antes de eso
   el contexto está parcial y no debe tratarse como una restauración completa.
4. Consultar `GET /api/v1/projects/:projectId/events?cursor=...`. Cada tanda fija
   `throughSeq`; nuevas escrituras quedan para la siguiente. Agotar `nextCursor`
   y conservar el `changesCursor` final para volver a consultar. También se acepta
   `afterSeq=0` o una secuencia decimal, con límite 20/máximo 100 eventos.

El snapshot cubre PROJECT, MEMBER, TASK, REPOSITORY, SESSION (ACC), CLAIM,
EVIDENCE, EVIDENCE_LINK, APPROVAL, DEPENDENCY y ALERT. No copia sesiones HTTP,
tokens, client secrets ni identidades OIDC. El fencing solo se entrega al propietario
por contexto/detalle/comandos; se omite del envelope público de eventos.
Preguntas, decisiones, requisitos e iteraciones siguen pendientes.

Snapshots: TTL diez minutos; cursores firmados y vinculados a proyecto/principal.
Cada página comprueba de nuevo la membresía. `CONTEXT_EXPIRED`, `CURSOR_AHEAD` y
`EVENT_GAP` devuelven 409 con `details.snapshotRequired:true`. `CURSOR_INVALID`
devuelve 400 con la misma indicación. En esos casos obtener un snapshot nuevo.
Las secuencias BIGINT son strings decimales: no convertirlas a Number de JavaScript.

Envelope: `eventId`, `projectId`, `seq`, `schemaVersion:1`, `type`, `occurredAt`,
`entity:{id,type}`, `actorId`, `sessionId`, `traceId`, `payload`.
Los payloads son señales auditables, no reemplazos completos de entidades.
Reconciliar tareas con su detalle REST, sesiones con el listado y miembros con un
contexto actualizado. Comparar versiones antes de reemplazar datos ya cargados.
Permisos, gates, versión y lease se validan otra vez al mutar, aunque el snapshot
anterior mostrara propiedad vigente.

## Ejecutar publicador

Con la migración aplicada, desde la raíz y el PATH local de pnpm preparado:

```powershell
pnpm outbox:dev
```

Versión compilada:

```powershell
pnpm build:foundation
pnpm build:api
pnpm outbox:start
```

API y worker corren en terminales separadas; pueden existir varios workers.
Variables: `DATABASE_URL`, `REDIS_URL`, `OUTBOX_POLL_MS` opcional (250 ms inicial;
50–30000 ms). No requiere credenciales OIDC.

- PG adquiere un intento mediante `FOR UPDATE SKIP LOCKED`, UUID y lease de quince
  segundos. Confirma la adquisición antes de llamar a Redis.
- Redis recibe el envelope en `acc:events:<projectId>`. Un script ejecuta XADD con
  MAXLEN aproximado de 10000 y renueva TTL de siete días desde la última entrega.
- Solo el intento vigente confirma `published_at`. Fallos conservan el evento y
  aplican backoff de 1, 2, 4… hasta 60 segundos. El código de error persistido es
  fijo; no incluye URLs, credenciales ni mensajes de excepción.
- Redis tiene conexión/socket/cola limitados a dos segundos, sin cola offline
  ilimitada. El worker usa timeout SQL de cinco segundos y conexión de dos segundos.
- Al interrumpirse un publicador, otro recupera el intento al expirar el lease.
  Perder el ACK después de la entrega puede producir un duplicado. Deduplicar por
  `eventId`, ordenar/reconciliar por `seq`: varios workers pueden entregar fuera
  de orden. No se promete exactamente una vez.
- `published_at` acredita aceptación por Redis. La recuperación duradera usa PG,
  incluso tras recorte, expiración o pérdida del stream.
- El worker elimina snapshots expirados en lotes de hasta cien por segundo, con
  sus páginas por FK. No elimina tareas, auditoría ni eventos de dominio.

Redis es transporte interno. WS y autorización de rooms siguen pendientes;
sus credenciales no se entregan al navegador.

## Verificación

`pnpm test:integration` requiere PG, Keycloak y Redis locales. Usa esquemas
temporales y elimina solo streams con UUID sintéticos de las pruebas. Comprueba
snapshots, permisos, cursores/BIGINT, cien adquisiciones concurrentes, dos workers,
reintento, pérdida de ACK y recuperación por delta tras perder el stream.
La indisponibilidad se inyecta mediante un endpoint inaccesible; no se detiene
ni se vacía el Redis compartido.

También se comprobaron API/worker compilados como procesos separados: una sesión
ACC sintética creada y cerrada por REST produjo un evento consultable por delta,
recibido en Redis y confirmado en outbox. No acredita aún la carga objetivo,
un consumidor WS ni interoperabilidad MCP.
