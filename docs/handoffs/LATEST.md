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

Siguiente bloque: diseño visual de gestión de requisitos o preguntas/decisiones,
concretando el encargo del usuario. ACC-LOCAL-014 permanece IN_PROGRESS porque
agrupa otras entidades; ya tiene evidencia publicada del bloque de requisitos.

La migración ECC previa está publicada y DONE; su auditoría de hashes describe
la adopción anterior, no una prohibición permanente del desarrollo autorizado actual.
Su resultado y pendientes permanecen en
[RESULT.json](../process/migrations/2026-11-04-ecc/RESULT.json).
