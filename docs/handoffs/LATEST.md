# Continuidad de sesión

Trabajo: ACC-LOCAL-014 / TASK-15, requisitos versionados FR-004 aprobados por el
usuario. Código publicado `ee55b37`, rama feat/acc-foundation. Commit/push y
despliegue local autorizados y ejecutados; no merge, instalaciones ni delegación.

Leer AGENTS o CLAUDE, guía compartida, config/project.json, STATUS y TASKS. Después
del diagnóstico de stack, consultar solo perfiles relevantes. Diseño y plan:
[requisitos](../requirements/VERSIONED_REQUIREMENTS_DESIGN.md),
[implementación](../superpowers/plans/2026-11-04-versioned-requirements.md).

Resultado actual: [VERSIONED_REQUIREMENTS_RESULT.json](../requirements/VERSIONED_REQUIREMENTS_RESULT.json).
Entrega: contratos, migración 008, comandos PostgreSQL, REST/MCP, vínculos, impacto,
historial, contexto/delta y OpenAPI. Pruebas HTTP usan puerto efímero: el proxy local
55173 permanece disponible. El despliegue actual ya incluye migración 008 y 19 tools.
[Resultado del despliegue](../requirements/VERSIONED_REQUIREMENTS_DEPLOYMENT.json).
No reiniciar ni actualizar servicios por leer el handoff.

Siguiente bloque de entidades: preguntas/decisiones,
concretando el encargo del usuario. ACC-LOCAL-014 permanece IN_PROGRESS porque
agrupa otras entidades; ya tiene evidencia publicada del bloque de requisitos.

La continuación solicitada implementó la alternativa A de requisitos, aprobada por
el usuario, y el registro de tiempo explícito ACC-LOCAL-020 / TASK-26. Leer
[resultado UI](../requirements/REQUIREMENTS_UI_RESULT.json) y
[resultado tiempo](../requirements/TASK_WORK_TIME_RESULT.json). El registro ofrece
inicio/pausa por API/MCP y total/día/agente en el detalle de tarea; no usa todo el
tiempo del claim ni reconstruye tiempos anteriores.

Cambios locales sin commit/push/despliegue de esta continuación. Antes de actualizar
la instancia se requiere migración 009; no modificar 001–008. El servidor desplegado
sigue con la entrega anterior y 19 herramientas; el código nuevo tiene 22. El entorno
de navegador usó esquemas/usuarios sintéticos, preservando la instancia habitual.

La migración ECC previa está publicada y DONE; su auditoría de hashes describe
la adopción anterior, no una prohibición permanente del desarrollo autorizado actual.
Su resultado y pendientes permanecen en
[RESULT.json](../process/migrations/2026-11-04-ecc/RESULT.json).

Publicación y despliegue de esta continuación completados por orden expresa del usuario:
commit `02e232f` en origin/feat/acc-foundation, http://localhost:55173, migración 009,
22 herramientas MCP y servicios saludables. [Resultado](../requirements/TASK_WORK_TIME_DEPLOYMENT.json).
Las referencias anteriores a cambios locales/008/19 herramientas describen el estado previo.
ACC-LOCAL-020 conserva IN_PROGRESS hasta registrar repositorio y evidencia CODE/TEST
pareada exigida por el servidor; implementación entregada sin eludir gates.

Sincronización solicitada de requisitos/tareas completada: 20 propuestas FR, 27 vínculos
a 13 tareas, 2 tareas faltantes creadas en BACKLOG (TASK-27 webhooks y TASK-28 export/backups).
[Resultado y correspondencias](../requirements/ACC_REQUIREMENTS_SYNC.json). Requisitos DRAFT:
pendientes de aprobación e impacto humano, sin modificar estados DONE ni validaciones.
Segunda pasada sin duplicados; snapshot completo de 3 páginas y delta hasta secuencia 339.
ACC-LOCAL-015 registra este trabajo y queda IN_PROGRESS pendiente de evidencia publicada.

Regla posterior aplicada: toda tarea tiene requisito. [Cobertura completa](../requirements/TASK_REQUIREMENT_COVERAGE.json):
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
[Resultado](../requirements/TASK_REQUIREMENT_API_RESULT.json): 67 unitarias, 118
integraciones, 16 protocolo, tipos/lint/build y navegador escritorio/móvil.
No publicado/desplegado: el servicio habitual sigue en 009; actualizar clientes
y API/UI junto con 010. La limitación anterior de solo control operativo queda
resuelta en el código local, pendiente de actualizar la instancia.
