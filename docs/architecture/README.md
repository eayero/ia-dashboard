# Mapa de arquitectura existente

Mapa de navegación, sin decisiones de arquitectura nuevas. Autoridad:
[ADR-0001](../adr/0001-foundation.md), [especificación](../SPECIFICATION.md) y sus
[sustituciones aprobadas](../DECISIONS.md).

| Necesidad                           | Fuente / módulo                                                       |
| ----------------------------------- | --------------------------------------------------------------------- |
| API y autenticación                 | apps/api/src/app.ts, auth/ y [runbook API](../runbooks/api.md)        |
| Contratos públicos                  | packages/contracts/src y [OpenAPI](../openapi.json)                   |
| Dominio y coordinación              | packages/domain/src, packages/db/src, migraciones SQL                 |
| Agentes e identidad                 | [propiedad](../AGENT_OWNERSHIP_DESIGN.md) y auth/                     |
| Estados y OK humano                 | [flujo vigente](../AGENT_WORKFLOW_DESIGN.md)                          |
| MCP / WS / outbox                   | apps/api/src/mcp, realtime, outbox y [eventos](../runbooks/events.md) |
| SPA y diseño                        | apps/web/src y [diseño aprobado](../design/README.md)                 |
| Infraestructura local               | infra/ y [runbook local](../runbooks/local.md)                        |
| Pruebas                             | packages/_/src, apps/_/src, tests/integration                         |
| Protocolo y herramientas de agentes | config/project.json, agents/, scripts/agents/                         |

SQL parametrizado mantiene mutación/evento/outbox en una transacción; Redis es
posterior y recuperable. MCP/REST reutilizan comandos. No se deriva un refactor
de la selección de una skill. [Índice ADR](../adr/README.md).
