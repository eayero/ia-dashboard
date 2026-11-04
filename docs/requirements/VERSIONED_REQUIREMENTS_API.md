# Uso de requisitos versionados

Base REST: `/api/v1/projects/{projectId}/requirements`.

| Método/ruta                           | Comportamiento                                                 |
| ------------------------------------- | -------------------------------------------------------------- |
| GET base                              | Listado con limit/cursor firmado y ligado a identidad/proyecto |
| GET /{requirementId}                  | Revisiones, aprobaciones, vínculos y evaluaciones              |
| POST base                             | Crear DRAFT o recuperar externalRef exacta                     |
| POST /{requirementId}/revise          | Nueva revisión DRAFT con expectedVersion y reason              |
| POST /{requirementId}/approve         | Aprobar revision con expectedVersion                           |
| POST /{requirementId}/link            | ADD/REMOVE con taskId, taskVersion, expectedVersion y reason   |
| POST /{requirementId}/evaluate-impact | Evaluar revision aprobada con ambas versiones y reason         |

Crear requiere title, description y type (FUNCTIONAL/NON_FUNCTIONAL), con
externalRef opcional. Revisar conserva campos y exige motivo. Todos los POST
requieren Idempotency-Key. La respuesta devuelve id/publicId, version, revision,
approvedRevision y projectSeq; vínculos/evaluación incluyen taskVersion actualizada.
Reintentos idénticos conservan respuesta; reutilizar clave para otro contenido falla.

Humanos usan cookie/CSRF/Origin; agentes usan credencial con audiencia API y scopes
task:read/task:write. Aprobar, vincular y evaluar requieren humano OWNER/ADMIN/MANAGER.
Q23 conserva esta aprobación de requisitos aunque los agentes puedan cerrar tareas.

Nueva revisión propuesta conserva la aprobada vigente. Aprobar sucesora conserva
contenido e historial anterior como SUPERSEDED y marca impacto de tareas vinculadas.
Evaluar un requisito no limpia los pendientes de otros. Se bloquean review/QA/DONE
hasta resolverlos; las tareas ya DONE conservan cierre/OK y reciben alerta persistente.
Retirar un vínculo conserva auditoría y evaluaciones históricas.

MCP: acc_register_requirement, acc_revise_requirement, acc_list_requirements y
acc_get_requirement. No hay herramientas MCP de aprobación humana. Contexto incluye
REQUIREMENT, REQUIREMENT_REVISION, REQUIREMENT_LINK, REQUIREMENT_IMPACT_REVIEW y
REQUIREMENT_IMPACT_ALERT; delta/WS incluyen eventos REQUIREMENT y TASK.

Contrato exacto: [OpenAPI](../openapi.json). Resultado:
[verificaciones](VERSIONED_REQUIREMENTS_RESULT.json). Esta entrega es API/MCP;
las pantallas de requisitos siguen pendientes de diseño visual.
