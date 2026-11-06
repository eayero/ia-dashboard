# Estado actual de ACC

Encargo actual: **ACC-LOCAL-025 / TASK-31**. El usuario eligió preguntas y decisiones juntas y aprobó el diseño. Implementación local completa: preguntas/respuestas con confirmación humana, decisiones versionadas con aprobación/supersesión, impacto, bloqueos duros e inbox. Migración 013, REST/MCP/contexto/WS/OpenAPI y UI preparados. Ver [contrato](../requirements/QUESTIONS_DECISIONS_API.md) y [resultado](../requirements/QUESTIONS_DECISIONS_RESULT.json). Se preserva la entrega local 012 y se corrigieron dos casos de identidad/tiempo de participantes. La instancia habitual mantiene migración 011; las entregas 012/013 no están publicadas ni desplegadas.

Producto: IMPLEMENTING; MVP incompleto. Instancia local: http://localhost:55173.
Código publicado y desplegado: `8cb9417`, rama `feat/acc-foundation`.

El catálogo REST de repositorios está desplegado con migración **011**. API, UI,
PostgreSQL y Redis saludables; worker activo; migrate/bootstrap salida 0.
Se conservaron las filas completas de 14 tablas, las migraciones 001–010 y los
archivos de credenciales. OpenAPI coincide con el artefacto publicado.
El build de cinco paquetes pasa; tras timeout TLS de DockerHub se reutilizaron
runtimes locales verificados con fuentes, compilados y migraciones actuales,
sin cambiar dependencias, lockfile o políticas. Respaldo privado previo conservado.
[Informe de despliegue](../requirements/REPOSITORY_REGISTRY_DEPLOYMENT.json).

Dashboard registrado por REST humano autorizado con ID
`ce3490c4-a6cf-44f7-a223-933d369c031d`; repetición idempotente y contexto MCP
nativo confirman el mismo repositorio. CODE/TEST adjuntas a TASK-26, revisión 5,
y TASK-29, revisión 3, con repositorio y commit pareados. Se conservan las
evidencias históricas de revisiones anteriores.

TASK-26 y TASK-29 siguen IN_PROGRESS: el servidor rechazó IN_REVIEW con
`IMPACT_REVIEW_REQUIRED`. Pendientes humanos: REQ-19 para TASK-26,
REQ-1/REQ-16 para TASK-29 y REQ-23 para TASK-16. El agente no aprueba requisitos,
evalúa impacto humano ni emite el OK posterior a DONE.

Verificación de esta continuación: nueve integraciones de repositorios con
PostgreSQL real pasan; cobertura 29/29 tareas, 23 requisitos, 44 vínculos,
cero huérfanas. El informe del commit de implementación conserva los resultados
históricos de 70 unitarias, 127 integraciones y 16 pruebas de protocolo;
no se presentan como nuevas ejecuciones. Sin cambios de flujo UI.

MCP reconciliado: 29 tareas (11 DONE, 5 IN_PROGRESS, 9 BACKLOG, 4 CANCELLED),
un repositorio, contexto de tres páginas y delta completo hasta secuencia 432.
Sesión terminada, sin claims activos. [Espejo](../ACC_WORK_SYNC.json).

Disponibles: autenticación propia, administración web/móvil, agentes por usuario
y varios proyectos, tareas/claims/idempotencia, requisitos versionados con UI,
tiempo explícito por tarea/agente/día, contexto/delta, outbox/WebSocket y OpenAPI.

Implementadas localmente y pendientes de publicar/desplegar: iteraciones y preguntas/decisiones.
Pendientes del MVP: gestión general de
proyectos/repositorios, métricas restantes, webhooks, exportación/backups,
operación/CI y cliente Claude. Producción no configurada. No merge,
instalaciones ni subagentes autorizados. Conservar datos, credenciales y decisiones.

[Tareas](../tasks/TASKS.md), [handoff](../handoffs/LATEST.md),
[decisiones](../DECISIONS.md), [estado anterior preservado](history/2026-11-05-before-registry-deployment.md).
