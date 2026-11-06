# Preguntas, decisiones e inbox: contrato implementado

Entrega local ACC-LOCAL-025 / TASK-31; requiere migración 013 y la entrega 012.
La instancia habitual conserva migración 011 hasta autorizar su publicación y
despliegue. [Diseño aprobado](QUESTIONS_DECISIONS_DESIGN.md) y
[resultado verificable](QUESTIONS_DECISIONS_RESULT.json).

Todas las rutas siguientes tienen prefijo `/api/v1/projects/{projectId}`.
Cada POST requiere `Idempotency-Key`. Las mutaciones existentes requieren
`expectedVersion`; los vínculos y evaluaciones también `taskVersion`.
Cookie humana exige Origin y CSRF. Los Bearer mantienen audiencia y scopes.

| Ruta                                                                                  | Método | Acceso                                                   |
| ------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `/questions`, `/decisions`                                                            | GET    | Miembros autorizados, cursor/limit/status/priority       |
| `/questions/{id}`, `/decisions/{id}`                                                  | GET    | Detalle, historia y relaciones del proyecto              |
| `/inbox`                                                                              | GET    | Preguntas OPEN; leer no cambia estado                    |
| `/questions`                                                                          | POST   | Propuesta humana o de agente                             |
| `/questions/{id}/revise`, `/questions/{id}/answer`                                    | POST   | Escritura autorizada; pregunta OPEN                      |
| `/questions/{id}/resolve`                                                             | POST   | Humano OWNER/ADMIN/MANAGER/REVIEWER                      |
| `/questions/{id}/status`, `/questions/{id}/links`                                     | POST   | Humano OWNER/ADMIN/MANAGER                               |
| `/decisions`                                                                          | POST   | Propuesta humana o de agente                             |
| `/decisions/{id}/revise`                                                              | POST   | Nueva revisión propuesta; mantiene la aprobación vigente |
| `/decisions/{id}/approve`, `/decisions/{id}/links`, `/decisions/{id}/evaluate-impact` | POST   | Humano OWNER/ADMIN/MANAGER                               |

Crear pregunta: `title`, `description`, `priority` (LOW/NORMAL/HIGH/CRITICAL),
`externalRef` opcional y arrays opcionales `taskIds`/`requirementIds`. Los vínculos
iniciales a tareas son informativos. Responder usa `{expectedVersion,text}` y
devuelve `answerId` y nueva versión. Confirmar usa
`{expectedVersion,answerId,reason}`. Una propuesta, incluso humana, requiere esa
confirmación explícita para resolver. Reabrir/cancelar usa
`{expectedVersion,to:"OPEN"|"CANCELLED",reason}` y conserva las resoluciones anteriores.

Vínculo de pregunta: `{expectedVersion,taskId,taskVersion,hard,operation,reason}`;
`operation` es ADD o REMOVE. Un bloqueo duro OPEN revoca claim/contador y bloquea
el trabajo. Al resolver no se eliminan otros bloqueos ni restricciones del sprint.
DONE conserva su estado y recibe alerta. Se devuelve la nueva `taskVersion`.

Crear decisión: `title`, `context`, `alternatives` (2–12 opciones distintas),
`choice` (una de ellas), `rationale`, `externalRef` opcional y arrays opcionales
`taskIds`, `requirementIds`, `questionIds`. Revisar agrega `expectedVersion` y
`reason`; las relaciones se conservan. Aprobar usa
`{expectedVersion,revision,reason}`. La aprobación sustituye la revisión vigente
atómicamente; un borrador posterior no sustituye por sí solo lo aprobado.

Vincular decisión usa `{expectedVersion,taskId,taskVersion,operation,reason}`.
Evaluar impacto usa `{expectedVersion,taskId,taskVersion,revision,reason}` con la
revisión aprobada. Leer de nuevo decisión/tarea después de aprobar para obtener
sus versiones actuales. Impacto pendiente impide review/QA/cierre; no reabre DONE.

MCP agrega diez herramientas: `acc_list_questions`, `acc_get_question`,
`acc_register_question`, `acc_revise_question`, `acc_answer_question`,
`acc_list_decisions`, `acc_get_decision`, `acc_register_decision`,
`acc_revise_decision`, `acc_get_inbox`. Total implementado: 34. No hay herramientas
de resolución/aprobación humana. Las credenciales del mismo agente mantienen su
identidad; el cliente no envía creador, aprobador ni propietario.

Cursores firmados vinculan recurso, proyecto, principal y filtros. Cambiarlos o
añadir segmentos produce CURSOR_INVALID. UUID ajeno no enlaza entidades entre
proyectos. Auditoría/outbox, respuestas, resoluciones y revisiones mantienen su
historia. Contexto/delta/WS y OpenAPI reflejan las entidades nuevas. La UI incluye
preguntas, decisiones e inbox, con controles según rol y explicación del impacto.
