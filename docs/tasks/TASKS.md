# Tareas y autoridad de estado

Archivos = referencia de alcance; ACC real = estado operativo, sesiones y claims.
Catálogo estable: [acc-tasks.json](../acc-tasks.json). No reimportar como DONE ni
crear tareas sustitutas. DONE y OK humano posterior son hechos separados.

## Estado reconciliado el 2026-11-05

MCP nativo: 29 tareas, 11 DONE, 5 IN_PROGRESS, 9 BACKLOG y 4 CANCELLED.
Hay 23 requisitos DRAFT y 44 vínculos; todas las tareas tienen requisito. El catálogo de
repositorios está vacío. Estos estados incluyen trabajo histórico y pruebas
sintéticas; no miden por sí solos el avance del MVP.

| Tarea                   | Estado      | Entregado y pendiente real                                                                                                                                                          |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-LOCAL-014 / TASK-15 | IN_PROGRESS | Requisitos versionados y UI publicados/desplegados; preguntas y decisiones pendientes dentro del alcance amplio.                                                                    |
| ACC-LOCAL-015 / TASK-16 | IN_PROGRESS | Seguimiento, cobertura y requisito obligatorio REST/MCP/DB publicados/desplegados; REQ-23 DRAFT e impacto pendientes de decisión humana. Reconciliación documental actual en curso. |
| ACC-LOCAL-020 / TASK-26 | IN_PROGRESS | Tiempo explícito publicado y desplegado; falta repositorio y evidencia CODE/TEST del mismo commit, más aprobación/evaluación de impacto de REQ-19.                                  |
| BOOT-009 / TASK-10      | IN_PROGRESS | Recorrido histórico hasta DONE; conservar criterios y evidencias, sin cierre retroactivo por entregas posteriores.                                                                  |
| ACC-LOCAL-021 / TASK-27 | BACKLOG     | Webhooks GitHub/GitLab verificados.                                                                                                                                                 |
| ACC-LOCAL-022 / TASK-28 | BACKLOG     | Exportación Markdown/JSON y backups programados.                                                                                                                                    |
| ACC-LOCAL-019 / TASK-25 | DONE        | Adopción estática ECC publicada; no acredita ejecución independiente de agentes.                                                                                                    |

## Entregas publicadas y desplegadas

Trabajo actual **ACC-LOCAL-023 / TASK-29, IN_PROGRESS**: diseño A aprobado,
catálogo REST implementado y verificado, migración 011 pendiente de
publicación/despliegue. Vinculada a FR-001/FR-016; impacto humano pendiente.
[Resultado](../requirements/REPOSITORY_REGISTRY_RESULT.json).

- Requisitos versionados: `ee55b37`, migración 008,
  [resultado](../requirements/VERSIONED_REQUIREMENTS_RESULT.json) y
  [despliegue](../requirements/VERSIONED_REQUIREMENTS_DEPLOYMENT.json).
- UI y tiempo de trabajo: `02e232f`, migración 009,
  [UI](../requirements/REQUIREMENTS_UI_RESULT.json),
  [tiempo](../requirements/TASK_WORK_TIME_RESULT.json) y
  [despliegue](../requirements/TASK_WORK_TIME_DEPLOYMENT.json).
- Requisito obligatorio por tarea: `94d7a34`, migración 010,
  [resultado](../requirements/TASK_REQUIREMENT_API_RESULT.json) y
  [despliegue](../requirements/TASK_REQUIREMENT_DEPLOYMENT.json).
- Registro documental posterior: `c241322`, confirmado en remoto; no es una
  nueva compilación del producto.

## Resolución prioritaria

1. Preparar aprobación/impacto humanos de REQ-19 y REQ-23 con alcance explícito:
   [paquete de revisión](../requirements/PENDING_CLOSURE_REVIEW.md).
2. Publicar/desplegar el catálogo implementado tras autorización y registrar
   dashboard mediante REST, sin escrituras directas a BD:
   [resultado](../requirements/REPOSITORY_REGISTRY_RESULT.json).
3. Registrar evidencia real CODE/TEST y recorrer revisión/QA/DONE únicamente
   cuando el servidor confirme todos los controles.
4. Continuar el resto del MVP según prioridad: preguntas/decisiones, iteraciones,
   proyectos/repositorios, métricas, exportación/backups, operación/CI y Claude.

## Historia preservada

Las notas anteriores de implementación local, instancias 008/009 y publicaciones
pendientes describían momentos anteriores. Se conservan completas en
[seguimiento anterior](history/2026-11-05-before-reconciliation.md) y en los
informes de cada entrega. No representan el estado operativo actual.

[Estado](../project/STATUS.md), [espejo](../ACC_WORK_SYNC.json),
[procedimiento MCP](../ACC_MIRROR.md), [handoff](../handoffs/LATEST.md).
