# Agent Control Center (ACC)

Control de proyectos con agentes, coordinación transaccional y validación humana posterior a DONE.
Aplicación local ejecutable con API, gateway MCP y dashboard autenticados.
El MVP completo continúa en construcción.

Entrega publicada y desplegada localmente desde `8cb9417`, migración 011:
[catálogo REST de repositorios para evidencias](docs/requirements/REPOSITORY_REGISTRY_RESULT.json).
Diseño A aprobado; migración nueva 011 y dos operaciones REST. Los agentes
consultan el catálogo mediante el contexto MCP existente; el registro exige
permisos humanos de gestión. La instancia habitual tiene migración 011. Ver [despliegue y pendientes humanos](docs/requirements/REPOSITORY_REGISTRY_DEPLOYMENT.json).

Entrega publicada y desplegada localmente: [requisitos obligatorios al
crear tareas por API/MCP](docs/requirements/TASK_REQUIREMENT_API.md). Incluye
asociación atómica y protección PostgreSQL. Migración 010 aplicada, 28 tareas
asociadas a requisitos y cero huérfanas. [Despliegue verificado](docs/requirements/TASK_REQUIREMENT_DEPLOYMENT.json),
commit `94d7a34`, en http://localhost:55173.

Entrega publicada y desplegada localmente: [interfaz de requisitos](docs/requirements/REQUIREMENTS_UI_RESULT.json)
y [tiempo de trabajo de agentes por tarea y día](docs/requirements/TASK_WORK_TIME_RESULT.json),
con inicio/pausa explícitos. Migración 009 aplicada, 22 herramientas MCP disponibles.
[Despliegue verificado](docs/requirements/TASK_WORK_TIME_DEPLOYMENT.json) en http://localhost:55173, commit `02e232f`.

Entrega publicada y desplegada localmente: requisitos versionados por REST/MCP, aprobación humana,
supersesión, vínculos a tareas e impacto. Ver [uso](docs/requirements/VERSIONED_REQUIREMENTS_API.md)
y [resultado](docs/requirements/VERSIONED_REQUIREMENTS_RESULT.json).
[Despliegue verificado](docs/requirements/VERSIONED_REQUIREMENTS_DEPLOYMENT.json)
en http://localhost:55173 desde el commit `ee55b37`; entrega anterior conservada como evidencia histórica.

La entrega de administración web/móvil, flujo autónomo, agentes por usuario,
WebSocket y OpenAPI está publicada en `feat/acc-foundation` mediante el commit
[`0c347e0`](https://github.com/eayero/ia-dashboard/commit/0c347e0df945e8db02dea8adc2a20fd8aa9aaa26).
Las seis tareas completadas tienen evidencia publicada y estado DONE en ACC;
la validación humana sigue siendo un OK separado. Ver el
[registro de publicación](docs/PUBLICATION_RESULT.json). Antes de continuar,
leer el [estado actual](docs/project/STATUS.md). Las guías operativas ya
describen autenticación propia; las [notas de pausa](docs/RESUME_LOCAL_AUTH.md)
conservan el contexto histórico anterior.

- [Especificación v1.1 estructurada](docs/SPECIFICATION.md)
- [Decisiones aprobadas Q1–Q40](docs/DECISIONS.md)
- [Flujo autónomo y validación humana posterior](docs/AGENT_WORKFLOW_DESIGN.md)
- [Agentes de usuarios y acceso a varios proyectos](docs/AGENT_OWNERSHIP_DESIGN.md)
- [Verificación de propiedad, permisos y múltiples proyectos](docs/AGENT_OWNERSHIP_RESULT.json)
- [Estado actual y punto de continuación](docs/project/STATUS.md)
- [Historial de implementación preservado](docs/IMPLEMENTATION_STATUS.md)
- [Continuación inmediata: MCP directo en Codex](docs/CONTINUE_CODEX_MCP.md)
- [Resultado de la comprobación nativa de MCP en Codex](docs/CODEX_MCP_RESULT.json)
- [Seguimiento duplicado en archivos y ACC](docs/ACC_MIRROR.md)
- [Conciliación de todo el trabajo mediante MCP](docs/ACC_WORK_SYNC.json)
- [Arquitectura](docs/adr/0001-foundation.md)
- [Entorno local](docs/runbooks/local.md)
- [Comprobación de reinicio y persistencia de Compose](docs/COMPOSE_VERIFICATION.json)
- [API local: autenticación, rutas y comprobaciónes](docs/runbooks/api.md)
- [Contrato OpenAPI REST](docs/openapi.json)
- [Verificación del contrato OpenAPI](docs/OPENAPI_RESULT.json)
- [Contexto, delta y publicador de eventos](docs/runbooks/events.md)
- [Verificación de WebSocket y recuperación tras desconexión](docs/WEBSOCKET_RESULT.json)
- [Gateway MCP: herramientas, autenticación y comprobaciónes](docs/runbooks/mcp.md)
- [Dashboard: ejecución, acciones y revisión visual](docs/runbooks/web.md)
- [Revisión de administración en escritorio y móvil](docs/ADMIN_BROWSER_RESULT.json)
- [Dirección visual aprobada](docs/design/README.md)
- [Cómo trabajamos](COMO-TRABAJAMOS.md)

Monorepo pnpm: React SPA/Vite, API NestJS, PostgreSQL y Redis; autenticación propia de ACC.
Consultar el estado antes de ejecutar comandos: hay componentes pendientes.

## Protocolo universal de agentes

Entradas compartidas: [AGENTS](AGENTS.md), [Claude](CLAUDE.md) y
[guía de trabajo](COMO-TRABAJAMOS.md). [Equipo y generación](agents/README.md),
[skills ECC verificadas](docs/process/ECC-SKILLS.md),
[diagnóstico y plan](docs/process/migrations/2026-11-04-ecc/DIAGNOSIS.md) y
[resultado de migración](docs/process/migrations/2026-11-04-ecc/RESULT.json).
La adopción estática del protocolo se publicó con autorización posterior en
`ee55b37`; no instala ni ejecuta agentes automáticamente.
