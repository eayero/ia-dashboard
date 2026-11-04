# Agent Control Center (ACC)

Control de proyectos con agentes, coordinación transaccional y validación humana posterior a DONE.
Aplicación local ejecutable con API, gateway MCP y dashboard autenticados.
El MVP completo continúa en construcción.

Entrega local nueva: requisitos versionados por REST/MCP, aprobación humana,
supersesión, vínculos a tareas e impacto. Ver [uso](docs/requirements/VERSIONED_REQUIREMENTS_API.md)
y [resultado](docs/requirements/VERSIONED_REQUIREMENTS_RESULT.json). Sin publicar;
la instancia en servicio conserva la versión anterior y la UI de requisitos queda pendiente.

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
- [API local: autenticación, rutas y comprobaciones](docs/runbooks/api.md)
- [Contrato OpenAPI REST](docs/openapi.json)
- [Verificación del contrato OpenAPI](docs/OPENAPI_RESULT.json)
- [Contexto, delta y publicador de eventos](docs/runbooks/events.md)
- [Verificación de WebSocket y recuperación tras desconexión](docs/WEBSOCKET_RESULT.json)
- [Gateway MCP: herramientas, autenticación y comprobaciones](docs/runbooks/mcp.md)
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
La adopción es local, sin cambios del producto ni publicaciones; no instala ni
ejecuta agentes automáticamente.
