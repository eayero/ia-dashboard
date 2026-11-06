# Preguntas, respuestas, decisiones e inbox humano

Estado: diseño aprobado para implementar por el usuario el 2026-11-06.
Continuación de ACC-LOCAL-014 / TASK-15; FR-005, FR-006, FR-012 y FR-014.

## Resultado esperado

Las personas y agentes plantean preguntas y proponen respuestas o decisiones.
Las preguntas abiertas aparecen en la bandeja humana. Una respuesta humana
confirmada resuelve la pregunta; una respuesta de agente requiere aceptación humana
(Q13). Las decisiones registran contexto, alternativas, elección y justificación;
solo OWNER/ADMIN/MANAGER las aprueba (Q23). Lo aprobado conserva su historia.

Se desarrollan ambos módulos juntos, manteniendo la arquitectura y los permisos
actuales. No se incluyen notificaciones externas, instalaciones ni publicación.

## Preguntas y respuestas

- Pregunta Q-n: título, descripción, prioridad LOW/NORMAL/HIGH/CRITICAL, versión,
  creador y fecha. Estados OPEN, RESOLVED y CANCELLED. Cancelar requiere gestor
  humano y motivo; reabrir requiere gestor, motivo y versión vigente.
- Respuestas append-only con texto y actor autenticado. Un humano con permisos
  de escritura puede confirmar una respuesta propia o aceptar una propuesta de
  agente; VIEWER solo consulta. Agentes nunca aceptan ni resuelven por sí solos.
- La resolución conserva el ID de respuesta aceptada, actor y fecha. Reabrir no
  borra respuestas ni resoluciones anteriores. Idempotencia evita duplicados.
- Una pregunta puede relacionarse con requisitos y tareas del mismo proyecto.
  Un enlace de tarea se marca informativo o bloqueo duro mediante gestión humana.
  Crear una pregunta no bloquea todas las tareas por su prioridad automáticamente.
- Un bloqueo duro abierto pasa la tarea a BLOCKED y revoca su claim/contador
  (Q25). Resolver o cancelar quita ese bloqueo; READY solo cuando no quedan
  preguntas, dependencias ni bloqueo manual. DONE conserva estado y recibe alerta.
  Resolver una pregunta no evita las restricciones del sprint ni los demás gates.

## Decisiones versionadas

- Decisión DEC-n con revisiones DRAFT, APPROVED y SUPERSEDED; contexto, al menos
  dos alternativas, elección y justificación. Las referencias a preguntas,
  requisitos y tareas son explícitas y limitadas al proyecto.
- Agentes proponen y revisan borradores con permisos de escritura. Aprobar exige
  humano OWNER/ADMIN/MANAGER, expectedVersion y revisión actual. Una aprobación
  no cambia estados de tareas ni aprueba requisitos por implicación.
- Revisar una decisión aprobada crea un nuevo borrador conservando la aprobación
  anterior vigente. Aprobar el reemplazo supersede la revisión anterior de forma
  atómica. Historial inmutable; no edición destructiva ni borrado.
- Enlazar una decisión con una pregunta no la resuelve automáticamente. El humano
  confirma la respuesta elegida de forma explícita; ambos hechos son auditables.
- La evaluación de impacto de requisitos existente sigue vigente. Aprobar una
  nueva revisión de una decisión vinculada exige evaluar su impacto antes de
  review/QA/cierre (Q24). La evaluación guarda revisión, humano, tarea y motivo.
  DONE recibe alerta sin reapertura automática. Una propuesta sin aprobar no
  sustituye la revisión evaluada ni bloquea por sí sola.

## Contratos, interfaz y consistencia

REST y MCP comparten comandos de dominio. Crear, responder y proponer decisiones
son accesibles a agentes autorizados. Las operaciones de aprobación, resolución,
reapertura/cancelación y bloqueos duros quedan en REST humano con cookie/CSRF.
MCP consulta preguntas, decisiones e inbox y ve las restricciones vigentes.

La UI mantiene tabla, filtros y detalle: navegación Preguntas y Decisiones;
bandeja Atención pendiente incluye preguntas abiertas, con prioridad crítica
destacada. Leer no resuelve. Detalles muestran autoría, respuestas, revisión,
historial y enlaces. Formularios versionados explican conflictos, permisos y
estados vacíos/errores en escritorio y móvil.

Migración 013 aditiva, IDs Q/DEC transaccionales, FK compuestas, versiones,
identidad obtenida en servidor, auditoría/outbox en la misma transacción. Grafo,
preguntas y transiciones de tareas se serializan por proyecto. No se cambian
migraciones aplicadas ni datos de la instancia habitual. Contexto/delta/WS y
OpenAPI incluyen ambas entidades, respuestas y resoluciones históricas.

## Verificación y entrega

Pruebas PostgreSQL real: dos respuestas/aceptaciones concurrentes, replay tras
retirar permisos, enlaces cross-project, escritura de agente frente a resolución
humana, bloqueos múltiples/manuales/dependencias/sprints, cierre concurrente con
apertura de pregunta, supersesión y rollback de outbox. Suite REST/MCP, tipos,
lint, build y revisión real de UI en escritorio/móvil. Creador/procedencia y
respuestas históricas no se reescriben.

El usuario confirmó desarrollar ambos módulos juntos y aprobó este diseño con
«Aprobar e implementar». Publicación y despliegue siguen fuera del encargo.
