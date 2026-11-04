# Agent Control Center (ACC)

Control de proyectos con agentes, coordinación transaccional y aprobación humana.
Aplicación local ejecutable con API, gateway MCP y dashboard autenticados.
El MVP completo continúa en construcción.

**Desarrollo reanudado por petición del usuario.** La autenticación propia de ACC y
el Compose completo están en migración local, sin publicar. Antes de continuar,
leer el [estado actual](docs/IMPLEMENTATION_STATUS.md). Las guías operativas ya
describen autenticación propia; las [notas de pausa](docs/RESUME_LOCAL_AUTH.md)
conservan el contexto histórico anterior.

- [Especificación v1.1 estructurada](docs/SPECIFICATION.md)
- [Decisiones aprobadas Q1–Q40](docs/DECISIONS.md)
- [Estado y punto de continuación](docs/IMPLEMENTATION_STATUS.md)
- [Continuación inmediata: MCP directo en Codex](docs/CONTINUE_CODEX_MCP.md)
- [Resultado de la comprobación nativa de MCP en Codex](docs/CODEX_MCP_RESULT.json)
- [Seguimiento duplicado en archivos y ACC](docs/ACC_MIRROR.md)
- [Arquitectura](docs/adr/0001-foundation.md)
- [Entorno local](docs/runbooks/local.md)
- [Comprobación de reinicio y persistencia de Compose](docs/COMPOSE_VERIFICATION.json)
- [API local: autenticación, rutas y comprobaciones](docs/runbooks/api.md)
- [Contexto, delta y publicador de eventos](docs/runbooks/events.md)
- [Gateway MCP: herramientas, autenticación y comprobaciones](docs/runbooks/mcp.md)
- [Dashboard: ejecución, acciones y revisión visual](docs/runbooks/web.md)
- [Dirección visual aprobada](docs/design/README.md)
- [Cómo trabajamos](COMO-TRABAJAMOS.md)

Monorepo pnpm: React SPA/Vite, API NestJS, PostgreSQL y Redis; autenticación propia de ACC.
Consultar el estado antes de ejecutar comandos: hay componentes pendientes.
