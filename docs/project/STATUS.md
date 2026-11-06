# Estado actual de ACC

Publicado y desplegado localmente el 2026-11-06: **55fdb94**, rama `feat/acc-foundation`, http://localhost:55173. Migraciones **012/013**, autoría/participantes/tiempo, sprint heredado, preguntas, decisiones versionadas e inbox humano. API/UI/PG/Redis saludables; worker activo; migrate/bootstrap salida 0. Datos y credenciales conservados. 77 unitarias y 154 integraciones pasan; OpenAPI y 34 herramientas MCP comprobados; navegador real escritorio/móvil sin errores. [Informe de entrega](../requirements/SPRINT_GOVERNANCE_DEPLOYMENT.json).

Planificación pendiente: 9 tareas sin requisito principal inequívoco y 0 sprints; el servidor bloquea correctamente la ejecución. TASK-30 y TASK-31 conservan IN_PROGRESS y sus evidencias CODE/TEST publicadas de `1911904`; adjuntar evidencia del ajuste `55fdb94` y actualizar su resumen exige resolver primero esos gates. No se asignaron sprints ni se emitieron aprobaciones/impactos humanos. MCP nativo: 4 páginas completas y delta 491–506, 31 tareas, 23 requisitos, 53 vínculos, sin huérfanas ni claims activos; sesión terminada.

Producto: IMPLEMENTING; MVP incompleto. Publicación de código y despliegue local completados; producción no configurada. La corrección de empaquetado fija la raíz TypeScript e incorpora `node scripts/check-api-dist.mjs` para comprobar el contrato del artefacto que arranca realmente. Dependencias y lockfile conservados.

Pendientes del MVP: gestión general de proyectos/repositorios, métricas restantes, webhooks, exportación/backups, operación/CI y cliente Claude. Las aprobaciones humanas anteriores continúan pendientes; el despliegue no cierra tareas automáticamente.

[Tareas](../tasks/TASKS.md), [handoff](../handoffs/LATEST.md), [espejo MCP](../ACC_WORK_SYNC.json) e [historial anterior](history/2026-11-06-before-governance-deployment.md).
