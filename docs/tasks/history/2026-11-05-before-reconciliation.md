# Tareas y autoridad de estado

Catálogo estable: [acc-tasks.json](../../acc-tasks.json). Espejo leído/verificado:
[ACC_WORK_SYNC.json](../../ACC_WORK_SYNC.json). Fuente de alcance: archivos;
sesiones/claims y estados operativos: ACC real. No mantener un segundo backlog.

Trabajo actual: **ACC-LOCAL-014 / TASK-15** — requisitos versionados, primer bloque
de entidades pendientes del MVP. MCP taskId `d001e794-fc3e-4b42-86a6-60a45d413180`.
Usuario aprobó [diseño](../../requirements/VERSIONED_REQUIREMENTS_DESIGN.md) e implementación.
Estado y verificaciones en [resultado](../../requirements/VERSIONED_REQUIREMENTS_RESULT.json).
La tarea agrupa decisiones/preguntas todavía pendientes y se conserva IN_PROGRESS.

Continuación de UI: alternativa A aprobada e implementada;
[resultado real](../../requirements/REQUIREMENTS_UI_RESULT.json), con revisión de
escritorio/móvil, historial, permisos e impacto. La tarea general permanece en curso
por decisiones/preguntas pendientes.

Trabajo adicional: **ACC-LOCAL-020 / TASK-26** — tiempo por tarea, agente y día.
MCP taskId `f3c2ee73-1716-403e-86a8-1762290f9a60`. Usuario eligió inicio/pausa
explícitos y aprobó [diseño](../../requirements/TASK_WORK_TIME_DESIGN.md).
[Resultado](../../requirements/TASK_WORK_TIME_RESULT.json): implementación local,
sin publicación/despliegue de esta continuación ni tiempos históricos inventados.

Trabajo previo publicado y DONE: **ACC-LOCAL-019 / TASK-25** — adopción estática del protocolo universal ECC.
MCP taskId `bfa5b03c-955b-46e5-8c21-dd6e22e12bde`. Criterios, alcance y plan:
[PLAN](../../process/migrations/2026-11-04-ecc/PLAN.md). Resultado y limitaciones:
[RESULT.json](../../process/migrations/2026-11-04-ecc/RESULT.json).

Conservar todos los IDs/criterios anteriores. No agregar placeholders T-0001 ni
reimportar el historial como DONE. Los estados son IN_REVIEW e IN_QA, con los
demás estados vigentes en config/project.json. DONE no implica OK humano.

La autorización posterior permitió publicar y cerrar la adopción estática ECC con
evidencia HTTPS real. Requisitos están publicados y desplegados localmente;
no constituye aprobación de los otros diseños pendientes.
[Procedimiento MCP](../../ACC_MIRROR.md).

Publicación y despliegue de esta continuación completados por orden expresa del usuario:
commit `02e232f` en origin/feat/acc-foundation, http://localhost:55173, migración 009,
22 herramientas MCP y servicios saludables. [Resultado](../../requirements/TASK_WORK_TIME_DEPLOYMENT.json).
Las referencias anteriores a cambios locales/008/19 herramientas describen el estado previo.
ACC-LOCAL-020 conserva IN_PROGRESS hasta registrar repositorio y evidencia CODE/TEST
pareada exigida por el servidor; implementación entregada sin eludir gates.

Sincronización solicitada de requisitos/tareas completada: 20 propuestas FR, 27 vínculos
a 13 tareas, 2 tareas faltantes creadas en BACKLOG (TASK-27 webhooks y TASK-28 export/backups).
[Resultado y correspondencias](../../requirements/ACC_REQUIREMENTS_SYNC.json). Requisitos DRAFT:
pendientes de aprobación e impacto humano, sin modificar estados DONE ni validaciones.
Segunda pasada sin duplicados; snapshot completo de 3 páginas y delta hasta secuencia 339.
ACC-LOCAL-015 registra este trabajo y queda IN_PROGRESS pendiente de evidencia publicada.

Regla posterior aplicada: toda tarea tiene requisito. [Cobertura completa](../../requirements/TASK_REQUIREMENT_COVERAGE.json):
28/28 tareas, 0 huérfanas, 23 requisitos y 42 vínculos, incluidas pruebas históricas
y canceladas. Tres propuestas NFR documentan arquitectura/build, operación y
trazabilidad; aprobación/impacto siguen pendientes. `pnpm requirements:check`
audita todas las tareas por MCP y falla si alguna carece de requisito.
Guía y auditor local actualizados; la creación atómica con requisito aún no es
un gate del servidor. No hay commit/push/despliegue nuevos de estos archivos.

Implementado localmente por orden posterior del usuario: la API/MCP exige
`requirementIds` al crear tareas y confirma sus vínculos en la misma transacción.
Retirar el último vínculo devuelve 409; PostgreSQL impone la invariante diferida
mediante migración 010. Formulario, importador, OpenAPI y flujo MCP actualizados.
[Resultado](../../requirements/TASK_REQUIREMENT_API_RESULT.json): 67 unitarias, 118
integraciones, 16 protocolo, tipos/lint/build y navegador escritorio/móvil.
No publicado/desplegado: el servicio habitual sigue en 009; actualizar clientes
y API/UI junto con 010. La limitación anterior de solo control operativo queda
resuelta en el código local, pendiente de actualizar la instancia.

Publicación/despliegue de requisitos obligatorios completados: `94d7a34`,
migración 010, datos y credenciales conservados; smokes 400/409 y cobertura 28/28.
[Informe](../../requirements/TASK_REQUIREMENT_DEPLOYMENT.json). ACC-LOCAL-015 permanece
IN_PROGRESS por impacto pendiente del requisito, sin eludir aprobación humana.
