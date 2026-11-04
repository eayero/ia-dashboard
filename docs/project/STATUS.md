# Estado actual de ACC

Producto: IMPLEMENTING; MVP incompleto. Instancia local: http://localhost:55173.
Código publicado en `origin/feat/acc-foundation`: `94d7a34`.

Entrega actual publicada y desplegada: tareas obligatoriamente asociadas a
requisitos por REST/MCP, creación atómica, protección del último vínculo y
restricción diferida PostgreSQL. Migración **010** aplicada. API/UI/PG/Redis
saludables, worker activo, migrate/bootstrap salida 0; 22 herramientas MCP.
[Contrato](../requirements/TASK_REQUIREMENT_API.md),
[resultado](../requirements/TASK_REQUIREMENT_API_RESULT.json) y
[despliegue](../requirements/TASK_REQUIREMENT_DEPLOYMENT.json).

Datos verificados: **28 tareas, 23 requisitos, 42 vínculos, cero tareas huérfanas**.
Se conservaron identidades, permisos, credenciales y tres validaciones humanas.
Los requisitos importados siguen DRAFT y su impacto pendiente: asociar trabajo
no aprueba requisitos ni acredita implementación. ACC-LOCAL-015 / TASK-16 sigue
IN_PROGRESS por ese gate humano; resumen/evidencia releídos en ACC, sesión
finalizada y claims liberados. [Espejo](../ACC_WORK_SYNC.json).

Verificación: 67 unitarias, 118 integraciones, 16 protocolo, tipos, lint, formato,
OpenAPI y build de cinco paquetes; navegador de escritorio/móvil. En despliegue,
REST y MCP rechazan tareas sin requisito, el último vínculo devuelve 409 y los
activos compilados coinciden. DockerHub falló por TLS/DNS: se usaron runtimes
locales verificados con fuentes exportadas y compilados actuales, tras comprobar
seis manifiestos, lockfile y políticas sin cambios. Detalle y corrección del
empaquetado documentados en el informe. Producción no configurada.

También disponibles: requisitos versionados con UI, aprobación/supersesión e
impacto; tiempo explícito por tarea/agente/día; tareas/claims/idempotencia;
identidad propia, agentes por usuario y varios proyectos; contexto/delta,
outbox/WS y OpenAPI. Entregas anteriores:
[UI/tiempo](../requirements/TASK_WORK_TIME_DEPLOYMENT.json),
[requisitos](../requirements/VERSIONED_REQUIREMENTS_DEPLOYMENT.json),
[publicación base](../PUBLICATION_RESULT.json) y
[protocolo ECC estático](../process/migrations/2026-11-04-ecc/RESULT.json).

Pendientes del MVP: preguntas/decisiones, iteraciones, gestión general de
proyectos/repositorios, resto de métricas/export/operación/CI y cliente Claude.
ACC-LOCAL-014 conserva ese alcance amplio; ACC-LOCAL-020 necesita catálogo de
repositorios/evidencia CODE/TEST y resolución de impacto para cerrar sus gates.
No reinstalar OIDC ni gates humanos previos de estados; preservar migraciones
001–010, auditoría, datos y credenciales. No hay merge, instalaciones o subagentes.

[Tareas](../tasks/TASKS.md), [handoff](../handoffs/LATEST.md),
[decisiones](../DECISIONS.md), [historial inicial](../IMPLEMENTATION_STATUS.md).
