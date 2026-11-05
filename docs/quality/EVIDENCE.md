# Evidencias y alcance de verificación

Continuación local: [UI de requisitos](../requirements/REQUIREMENTS_UI_RESULT.json)
y [tiempo por tarea/agente/día](../requirements/TASK_WORK_TIME_RESULT.json).
Incluyen navegador real con datos aislados y suites de esa entrega. La publicación
y el despliegue posteriores constan en TASK_WORK_TIME_DEPLOYMENT.json.

Requisitos FR-004: [resultado local](../requirements/VERSIONED_REQUIREMENTS_RESULT.json)
incluye pruebas PostgreSQL/REST/MCP, historial, impacto, tipos/lint/build y límites.
No atribuye revisión independiente; publicación y despliegue constan en su informe.

Publicación y despliegue posteriores autorizados:
[VERSIONED_REQUIREMENTS_DEPLOYMENT.json](../requirements/VERSIONED_REQUIREMENTS_DEPLOYMENT.json).
Confirma migración 008, imágenes, conservación de datos y smoke MCP del proxy real.

Resultados anteriores publicados: [PUBLICATION_RESULT](../PUBLICATION_RESULT.json)
enlaza flujo, propiedad, administración, WS y OpenAPI. Se conservan fechas, commits,
entornos y límites en esos informes; no se presentan como una corrida nueva.

Migración ACC-LOCAL-019: [RESULT.json](../process/migrations/2026-11-04-ecc/RESULT.json)
registra cada comando, PASS/FAIL/NOT_RUN y conservación de código/arquitectura.
Pruebas de generador y migración viven en tests/agents-setup.test.mjs y
tests/agent-protocol.test.mjs; su éxito no acredita QA independiente ni ejecución
de agentes. No se lanza el producto ni sus suites de infraestructura por adoptar
instrucciones. [Comandos pertinentes](COMMANDS.md).

- [Publicación y despliegue UI/tiempo](../requirements/TASK_WORK_TIME_DEPLOYMENT.json): migración 009, 22 tools, persistencia y navegador compilado.

- [Sincronización real de requisitos y tareas](../requirements/ACC_REQUIREMENTS_SYNC.json): 20 requisitos, 27 vínculos, verificación bidireccional y segunda pasada sin mutaciones.

- [Cobertura completa tarea-requisito](../requirements/TASK_REQUIREMENT_COVERAGE.json): 28/28 tareas y cero huérfanas, incluidas pruebas canceladas; segunda pasada sin mutaciones.

- [Requisito obligatorio en API/MCP/DB](../requirements/TASK_REQUIREMENT_API_RESULT.json): 67 unitarias, 118 integraciones, transacciones/concurrencia y creación web real. Publicado y desplegado con migración 010 según el informe siguiente.

- [Despliegue de requisitos obligatorios](../requirements/TASK_REQUIREMENT_DEPLOYMENT.json): migración 010, contrato MCP, rechazos 400/409, persistencia y activos compilados verificados.

- [Revisión de cierres pendientes](../requirements/PENDING_CLOSURE_REVIEW.md): alcance y evidencia preparados para REQ-19/REQ-23; no constituye aprobación humana.

- [Catálogo REST de repositorios](../requirements/REPOSITORY_REGISTRY_RESULT.json): diseño A aprobado, implementación local verificada con PostgreSQL real; publicado y desplegado desde `8cb9417`; [informe](../requirements/REPOSITORY_REGISTRY_DEPLOYMENT.json).

- [Evidencia CODE/TEST de TASK-26 preparada](../requirements/TASK_WORK_TIME_EVIDENCE_READY.json): commit y resultados históricos coincidentes; no enviada sin ID de repositorio real.
