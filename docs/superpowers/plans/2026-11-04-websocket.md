# WebSocket autorizado y reconciliación

**Objetivo:** completar ACC-LOCAL-013 según la especificación vigente, manteniendo
contexto/delta REST como fuente de recuperación duradera.

**Arquitectura:** Socket.IO ya está instalado en API y web. El servidor `/ws/v1`
autoriza una suscripción de proyecto por conexión y asigna únicamente rooms
`project:{id}` y `agent:{id}` de la identidad autenticada. Lee Redis Streams del
outbox; cada proceso API consume sus propios cursores, sin consumer groups que
repartan eventos entre instancias. El dashboard usa eventos como invalidaciones,
reconcilia con REST y conserva consulta periódica como respaldo.

**Especificación:** `docs/SPECIFICATION.md`, sección contratos/eventos, Q9 y
`docs/runbooks/events.md`. No se cambian migraciones ni se añaden dependencias.
Las decisiones de intervalo, límites y nombres de mensajes son de implementación.
Commit/push permanecen pendientes de autorización según la guía del repositorio.

## Riesgos a comprobar

- Origin ajeno, identidad ausente, proyecto ajeno o contraseñas temporales: rechazar.
- Logout, reset, caducidad o retiro de permisos en una conexión abierta: cortar;
  reautorizar antes de entregar eventos y periódicamente aunque no haya cambios.
- Redis caído o stream perdido: no bloquear REST ni perder recuperación por delta.
- Duplicados, secuencias grandes/fuera de orden: invalidar y recuperar desde REST,
  sin aplicar payloads parciales ni convertir secuencias a Number.
- Cambio de proyecto/usuario: cerrar conexión anterior y aislar cachés; límites
  de payload/conexiones/colas y cierre de recursos al apagar API.

## Ejecución en esta sesión

- [x] Escribir y ejecutar integración que falle al no existir `/ws/v1`.
- [x] Implementar gateway en `apps/api/src/realtime/gateway.ts` y lector Redis en
      `streams.ts`; reutilizar sesión HTTP, AuthService y ProjectQueries.
- [x] Probar entrega real worker → Redis → Socket.IO, rechazo y revocación,
      aislamiento de proyectos, reconexión y recuperación REST con Redis perdido.
- [x] Añadir cliente en `apps/web/src/realtime.ts`, con pruebas de invalidación y
      deduplicación; conectarlo al dashboard sin introducir una nueva pantalla.
- [x] Pasar tipos, lint, formato, pruebas y build; comprobar navegador real con
      proxy y reconexión, documentar resultados y duplicarlos/verificarlos por MCP.

Referencias de implementación: documentación oficial de Socket.IO sobre
[sesiones](https://socket.io/how-to/use-with-express-session),
[middleware](https://socket.io/docs/v4/middlewares/) y
[opciones](https://socket.io/docs/v4/server-options/).
