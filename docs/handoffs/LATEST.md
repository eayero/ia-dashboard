# Continuidad de sesión

Trabajo: ACC-LOCAL-014 / TASK-15, requisitos versionados FR-004 aprobados por el
usuario. Base publicada `edaf57d`, rama feat/acc-foundation. No hay permiso para
commit/push, merge, despliegue, instalaciones ni delegación.

Leer AGENTS o CLAUDE, guía compartida, config/project.json, STATUS y TASKS. Después
del diagnóstico de stack, consultar solo perfiles relevantes. Diseño y plan:
[requisitos](../requirements/VERSIONED_REQUIREMENTS_DESIGN.md),
[implementación](../superpowers/plans/2026-11-04-versioned-requirements.md).

Resultado actual: [VERSIONED_REQUIREMENTS_RESULT.json](../requirements/VERSIONED_REQUIREMENTS_RESULT.json).
Entrega: contratos, migración 008, comandos PostgreSQL, REST/MCP, vínculos, impacto,
historial, contexto/delta y OpenAPI. Pruebas HTTP usan puerto efímero: el proxy local
55173 permanece disponible. No reiniciar ni actualizar servicios por leer el handoff.

Siguiente bloque: diseño visual de gestión de requisitos o preguntas/decisiones,
concretando el encargo del usuario. La API nueva requiere migración 008 al actualizar
la instancia; no fue aplicada al esquema local en servicio. ACC-LOCAL-014 permanece
IN_PROGRESS porque agrupa otras entidades y falta publicación de evidencia formal.

La migración ECC previa sigue local y sin publicar; su auditoría de hashes describe
la adopción anterior, no una prohibición permanente del desarrollo autorizado actual.
Su resultado y pendientes permanecen en
[RESULT.json](../process/migrations/2026-11-04-ecc/RESULT.json).
