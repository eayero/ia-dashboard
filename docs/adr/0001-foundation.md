# ADR-0001 — Autoridad y límites de ACC

Estado: aceptado por especificación v1.1 y acuerdos Q1–Q40. Fecha: 2026-11-02.

Monolito modular NestJS; SPA Vite estática y gateway MCP como adaptadores.
PostgreSQL decide permisos, estado y propiedad. Redis distribuye después del
commit mediante outbox. Compartir dominio y contratos, no copiar negocio en MCP/UI.

Claims usan locks de fila, reloj DB y fencing monotónico. Todas las escrituras
de implementación validan propiedad vigente dentro de la transacción. Contadores
por proyecto y registros idempotentes se confirman junto con auditoría/outbox.
PostgreSQL real es obligatorio para acreditar carreras; SQLite y mocks no bastan.

Versión optimista separada de revisión de trabajo. Aprobaciones humanas se
vinculan a esta última y al contenido evaluado. El heartbeat no cambia esa revisión.

Una organización inicial; membresías y roles acumulables por proyecto. Keycloak
local OIDC; BFF con PKCE/cookie/CSRF. Agentes no pueden aprobar gates humanos.
Infraestructura local no constituye configuración segura para producción.
