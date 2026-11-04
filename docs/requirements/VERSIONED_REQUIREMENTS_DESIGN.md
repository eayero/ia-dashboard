# Requisitos versionados — FR-004

Fecha: 2026-11-04. Estado: aprobado por el usuario para implementar.
Trabajo: ACC-LOCAL-014 / TASK-15. El usuario eligió continuar con requisitos
versionados por API/MCP y aprobó expresamente este diseño para implementar.

## Objetivo y alcance

Registrar requisitos funcionales y no funcionales por proyecto, vincularlos a
tareas y conservar qué revisión fue aprobada y cuál fue evaluada al implementar.
Fuentes vinculantes: SPECIFICATION FR-004/FR-015/FR-016 y DECISIONS Q23/Q24.

Primera entrega: persistencia, comandos, REST, MCP, OpenAPI y contexto/delta.
Las pantallas de gestión requieren un diseño visual posterior. Decisiones y
preguntas permanecen como bloques siguientes del MVP.

## Alternativas y elección propuesta

1. Entrega completa de requisitos, decisiones y preguntas juntos: permite probar
   toda la trazabilidad, pero mezcla tres ciclos de vida y aumenta el alcance.
2. Requisitos como entrega vertical sobre los comandos actuales: permite verificar
   aprobación, historial e impacto de extremo a extremo con el stack existente.
3. Solo tabla de requisitos: rápida, pero deja fuera permisos, MCP e impacto.

Se propone la opción 2. El usuario eligió requisitos versionados como prioridad;
la implementación técnica y las reglas detalladas siguientes son propuestas.
No hace falta incorporar dependencias ni cambiar la arquitectura.

## Modelo y ciclo de vida

- Identidad estable UUID, publicId REQ-n por proyecto y externalRef opcional única.
- Tipo FUNCTIONAL o NON_FUNCTIONAL; título y descripción normalizados y acotados.
- Revisiones numeradas, con autor y fecha; contenido inmutable por revisión.
- Crear o proponer sucesora produce una revisión DRAFT. Una nueva propuesta no
  reemplaza automáticamente la revisión aprobada vigente.
- OWNER/ADMIN/MANAGER humano aprueba una revisión concreta con expectedVersion.
  Agentes con permiso de escritura proponen; no aprueban (Q23 sigue vigente).
- Al aprobar una sucesora, la anterior queda SUPERSEDED; se conserva íntegro su
  contenido, autor y aprobación. No se elimina historial ni se edita lo aprobado.
- Una identidad admite una propuesta pendiente a la vez. Ediciones sucesivas de
  esa propuesta se registran como nuevas revisiones para conservar trazabilidad.

## Vínculos e impacto

Un vínculo identifica requisito, tarea y revisión aprobada evaluada. Solo humanos
con OWNER/ADMIN/MANAGER administran vínculos y confirman su evaluación motivada.
Las FK compuestas y las consultas prohíben vínculos entre proyectos.

Aprobar una nueva revisión marca pendientes los vínculos afectados. El servidor
recalcula impact_pending por tarea considerando todos sus requisitos; evaluar uno
no elimina el pendiente de los demás. Review, QA y DONE respetan el gate existente.
Las tareas DONE reciben una alerta persistente y conservan su estado y OK histórico;
la aprobación de un requisito no las reabre automáticamente (Q24).

La aprobación inicial también marca impacto si ya hay tareas vinculadas. Crear
un vínculo con una revisión vigente exige evaluación explícita antes de avanzar.
No se permite evaluar contra una revisión supersedida, ni confirmar impacto con
una versión de tarea/requisito obsoleta. La evaluación conserva nota, actor y fecha.

## Integración técnica

- Migración SQL nueva; conservar checksums de 001–007 y todos los datos actuales.
- Reutilizar autorización e idempotencia de CoordinationStore, contador REQ y
  transacciones PostgreSQL. Serializar aprobación/vínculos/evaluación con el lock
  de grafo del proyecto y bloquear tareas en orden estable para evitar carreras.
- Requisito/revisión/vínculo/impacto, auditoría y outbox se confirman juntos.
- Extender validación de entidades de auditoría para REQUIREMENT conservando la
  pertenencia al proyecto; guardar actor y propietario humano mediante lo existente.
- REST por proyecto: crear/listar/detalle, proponer revisión, aprobar revisión,
  vincular/desvincular y evaluar impacto. Entradas Zod estrictas, comandos con
  Idempotency-Key y expectedVersion; lecturas paginadas con cursor firmado.
- MCP: registrar/listar/detalle y proponer revisiones. La aprobación y evaluación
  humana se exponen en REST; MCP no permite suplantar al aprobador.
- Contexto incluye requisitos/revisiones/vínculos e impactos pendientes. Eventos
  sirven por delta y WS usando el outbox actual, sin duplicar lógica de negocio.
- OpenAPI describe operaciones, contratos, errores, autorización e idempotencia.

## Validación y límites

Pruebas de contratos y dominio; PostgreSQL real para aprobación concurrente,
reintentos, versiones obsoletas, aislamiento entre proyectos, permisos de agente,
supersesión, dos impactos sobre una tarea y preservación de DONE. Comprobar rollback
si falla outbox. Integraciones HTTP y MCP verifican el mismo comportamiento y
snapshot/delta. Ejecutar suites aplicables, tipos, lint, formato y build.

No instalar, publicar, hacer commit/push, desplegar ni emitir validaciones humanas.
El cierre formal dependerá de evidencia elegible real; no fabricar enlaces HTTPS.
La revisión de este diseño es propia, sin delegación ni revisión independiente.
