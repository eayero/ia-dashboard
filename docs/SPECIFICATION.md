# Agent Control Center — especificación v1.1

Fecha de origen: 2026-11-02. Fuente: especificación entregada por el usuario en la
sesión de inicialización. Esta es una transcripción estructurada de sus requisitos,
no una copia literal. Los cambios acordados después están en [DECISIONS.md](DECISIONS.md).

## Propósito y límites

Control plane para proyectos con agentes: estado verificable para humanos,
API/MCP para agentes y coordinación transaccional entre sesiones. PostgreSQL es
fuente de verdad; Redis distribuye eventos, jobs y caché. No ejecuta modelos, no
genera código automáticamente, no sustituye Git ni guarda prompts o secretos.
Skills orientan; permisos, claims y gates se imponen en servidor.

## Requisitos funcionales

| ID     | Alcance                                                             | Prioridad |
| ------ | ------------------------------------------------------------------- | --------- |
| FR-001 | Crear/archivar proyectos; repositorios y rama por defecto           | P0        |
| FR-002 | Iteraciones con metas, fechas, estado y tareas                      | P0        |
| FR-003 | Tareas versionadas, responsable, prioridad, criterios y evidencias  | P0        |
| FR-004 | Requisitos funcionales/no funcionales versionados y vinculados      | P0        |
| FR-005 | Decisiones con contexto, alternativas, aprobación y supersesión     | P0        |
| FR-006 | Preguntas, respuestas, prioridad y bloqueo de dependientes          | P0        |
| FR-007 | Idempotencia/exactos; candidatos semánticos sin fusión automática   | P0        |
| FR-008 | Identidades, capacidades, sesiones y heartbeat                      | P0        |
| FR-009 | Claim atómico con lease, renovación, liberación y expiración        | P0        |
| FR-010 | Máquina de estados y concurrencia optimista                         | P0        |
| FR-011 | DONE condicionado por criterios, evidencias y aprobaciones          | P0        |
| FR-012 | Dashboard consistente de tareas, bloqueos, decisiones y sesiones    | P0        |
| FR-013 | Detalles, filtros, búsqueda, Kanban y tabla                         | P1        |
| FR-014 | Inbox humano y preguntas críticas                                   | P0        |
| FR-015 | Restauración de contexto mediante snapshot y delta con cursor       | P0        |
| FR-016 | Eventos/evidencias trazables: commits, PR, pruebas, logs redactados | P0        |
| FR-017 | Políticas por proyecto: QA, aprobación y permisos                   | P1        |
| FR-018 | GitHub/GitLab opcional mediante webhook verificado                  | P1        |
| FR-019 | Throughput, ciclo, bloqueos, reabiertas, tiempo y coste opcional    | P2        |
| FR-020 | Export Markdown/JSON y backups programados                          | P1        |

## Arquitectura vinculante

Monorepo pnpm + Turbo: `apps/web`, `apps/api`, `apps/mcp`; paquetes `contracts`,
`db`, `domain`, `ecc-adapter`, `config`; `infra`, `docs`, `tests`.

- Web: React 19, TypeScript estricto, Vite, TanStack Router/Query/Table,
  Tailwind/shadcn, React Hook Form/Zod, Recharts cuando se necesiten gráficos.
  Zustand solo presentación efímera. Sin Next.js, SSR, RSC ni segundo backend.
- NestJS modular: auth, proyectos, iteraciones, tareas, requisitos, decisiones,
  preguntas, agentes/sesiones/claims, aprobaciones, evidencias, actividad,
  notificaciones, integraciones, métricas y health.
- Prisma para persistencia convencional; SQL parametrizado para atomicidad,
  fencing, contadores, dependencias, idempotencia y outbox.
- Mutación, evento e outbox en la misma transacción PostgreSQL. Redis fuera de
  esa transacción; fallar Redis no revierte ni pierde cambios confirmados.
- REST `/api/v1`; WS `/ws/v1`; gateway MCP `/mcp`. Mismo origen mediante proxy.
- SPA estática; fallback solo en rutas cliente. Assets/backend inexistentes no
  deben devolver index.html. CSP y caché diferenciada index/assets con hash.

## Datos y consistencia

UUID para IDs internos; IDs públicos TASK/REQ/DEC/Q/ITER por proyecto y tipo,
asignados mediante contador transaccional. Fechas TIMESTAMPTZ, autor y versión.
Archivado/cancelación habitual; no borrado de auditoría.

Entidades: users/principals, project_members, agent_identities, agent_sessions,
projects, repositories, iterations, work_items, task_dependencies, requirements,
decisions, questions, entity_links, task_claims, approvals, evidence,
project_counters, idempotency_records, audit_events, event_outbox, webhook_inbox.

FK compuestas y autorización prohíben relaciones cross-project. Un índice parcial
impone una iteración ACTIVE por proyecto. Dependencias forman DAG; cambios del
grafo se serializan por proyecto para impedir ciclos concurrentes.

Eventos append-only: event_id, project_id, seq BIGINT por proyecto, actor/sesión,
entidad, acción, payload, schema_version=1, fecha y trace_id. Contador transaccional
de eventos; cliente soporta repetición, huecos y reordenación defensivamente.

Requisitos/decisiones aprobados se revisan mediante supersesión. Mutaciones
validan expectedVersion o If-Match; conflictos devuelven 409 VERSION_CONFLICT.

## Máquina de estados

BACKLOG → READY → IN_PROGRESS → IN_REVIEW → IN_QA → DONE.
IN_PROGRESS → BLOCKED → READY. Rechazos de review/QA vuelven a IN_PROGRESS.
DONE → READY solo reapertura autorizada con motivo. No terminal → CANCELLED
requiere gestión y motivo. Cada transición valida autorización, versión, bloqueos
y gates. Review/QA liberan claim. DONE exige criterios obligatorios, evidencias,
dependencias y aprobaciones satisfechas; UI enumera gates fallidos.

## Claims e idempotencia

Bloquear work_item FOR UPDATE y claim en orden estable. Lease ajeno vigente
devuelve TASK_ALREADY_CLAIMED; recuperación incrementa fencing_token monotónico.
Escrituras de implementación requieren sesión, token, versión y lease vigente.
Token viejo falla incluso si el worker de expiración no corrió. Reloj PostgreSQL;
lease inicial diez minutos, heartbeat de claim sugerido cada sesenta segundos.

Clave idempotente por proyecto, principal y comando lógico; hash canónico del
payload. Misma clave/hash devuelve misma respuesta; payload diferente produce
IDEMPOTENCY_KEY_REUSED. Registro y efectos se confirman juntos. En progreso:
espera acotada o REQUEST_IN_PROGRESS. external_ref exacto tiene unicidad estable.
Normalización NFC/trim/espacios; títulos similares no son unicidad de negocio.

## Contratos REST y eventos

Éxito `{data,meta:{requestId,version?,projectSeq?}}`; error
`{error:{code,message,details,requestId}}`. Auth y autorización por objeto siempre.
Creaciones/efectos no idempotentes requieren Idempotency-Key. Cursor estable,
límite inicial 20/máximo 100; filtros proyecto/iteración/estado/prioridad/owner/texto.

Recursos `/projects`, `/iterations`, `/tasks`, `/requirements`, `/decisions`,
`/questions`, `/approvals`, `/agent-sessions`; comandos claim/heartbeat/release,
transition, answer, resolve, evidence. Por proyecto: context, events con afterSeq,
dashboard y metrics. Probes `/health/live` y `/health/ready`.

WS: rooms autorizadas project:{id}/agent:{id}; envelope eventId, projectId, seq,
schemaVersion, type, occurredAt, payload. Entrega al menos una vez. Tipos incluyen
task.updated, claim.changed, question.answered, decision.approved, agent.presence,
iteration.changed, approval.requested. TanStack Query reconcilia contra REST;
reconexión consulta delta y cursor inválido recarga snapshot consistente.

## MCP e integración de agentes

SDK oficial estable y compatibilidad probada; Streamable HTTP autenticado con
Origin, audiencia, scopes y credenciales opacas propias de ACC. No confundir sesión MCP con sesión ACC.
Sin lógica de negocio duplicada. Herramientas propuestas:

`acc_get_context`, `acc_list_tasks`, `acc_find_or_create_task`, `acc_claim_task`,
`acc_heartbeat_task`, `acc_update_task`, `acc_transition_task`, `acc_release_task`,
`acc_register_requirement`, `acc_register_decision`, `acc_find_or_create_question`,
`acc_list_questions`, `acc_request_approval`, `acc_register_session`,
`acc_heartbeat_session`, `acc_add_evidence`, `acc_get_changes`.

JSON Schema estricto; errores estables, isError y structuredContent según SDK.
Skill portable agent-project-control: autenticar/registrar sesión, obtener
contexto, buscar antes de crear, reclamar antes de escribir, renovar, adjuntar
evidencias, pedir revisión, liberar y reconciliar al retomar. Sin conexión no
inventar estados ni declarar éxito. Hooks ECC opcionales reales y configuraciones
locales; no modificar ECC ni configuraciones globales del usuario.

## Seguridad y operación

Autenticación propia de ACC, sin registro público: usuario/contraseña, sesión
PostgreSQL con cookie HttpOnly/Secure/SameSite y CSRF; no tokens browser en storage.
ADMIN gestiona usuarios y membresías; recuperar acceso emite contraseña temporal
con cambio obligatorio. Agentes con identidad, tokens opacos, scopes, audiencias
API/MCP, TTL y revocación. El rol global no sustituye la membresía de proyecto.
Esta decisión posterior sustituye OIDC/Keycloak de Q8/Q36; se conserva el historial. RBAC y autorización por objeto en REST/MCP/WS.
Validación estricta, SQL parametrizado, límites/rate limiting, Markdown sanitizado,
HTTPS, CORS exacto, CSP, logs redactados y prevención de SSRF/prompt injection.

Webhooks con firmas y replay prevention. Backups cifrados y restauración probada.
OTEL trace_id y métricas de claims/conflictos/stale fencing/outbox lag/sesiones/
bloqueos/dashboard/MCP. SLO propuestos, no medidos: API 99.5%, dashboard p95 <1s
a 50k tareas, claim p95 <300ms, WS p95 <2s, RPO ≤15min y RTO ≤4h.

## Pruebas y aceptación

Unitarias de estados/permisos/gates/normalización. PostgreSQL real para carreras:
100 claims → uno; 100 reintentos idempotentes → un efecto; clave reutilizada con
otro payload rechazada; stale fencing tras expiración; heartbeat/expiración;
dependencias opuestas sin ciclo; dos aprobaciones → una resolución; Redis caído
sin pérdida; outbox tras crash; DONE sin pruebas/aprobación rechazado.

Contratos REST/OpenAPI y MCP, aislamiento cross-project, tokens/Origin/WS,
Vitest/RTL/MSW/axe y Playwright con deep links y reconexión. Carga controlada:
100 agentes/10k eventos por minuto; migraciones y restauración en staging.

DoD producto: recorrido API/MCP completo hasta DONE, dashboard tras reinicio,
auth, preguntas/decisiones, auditoría, CI, runbooks, recuperación y demo de dos
agentes. No confundir la primera entrega con cumplimiento de todo el MVP.

## Plan por dependencias

| Fase | Historias de origen | Alcance                                                                      |
| ---- | ------------------- | ---------------------------------------------------------------------------- |
| 0    | ACC-001…004         | Monorepo, Compose, ADR, skeleton Nest/Vite/contratos                         |
| 1    | ACC-101…105         | Schema, autenticación propia/RBAC, proyectos, contadores/outbox, iteraciones |
| 2    | ACC-201…205         | Tareas/dependencias, claims/fencing, idempotencia, estados, carreras         |
| 3    | ACC-301…305         | Requisitos, decisiones, preguntas, evidencias, contexto/delta                |
| 4    | ACC-401…405         | MCP, tools, skill, adaptador ECC y smoke real                                |
| 5    | ACC-501…507         | SPA, resumen, tareas/inbox/agentes, WS, pruebas UI                           |
| 6    | ACC-601…605         | Git, métricas, OTEL, seguridad/restore/carga, export/retención               |

Implementar slices verticales, no capas desconectadas. `docs/IMPLEMENTATION_STATUS.md`
usa IDs BOOT hasta disponer de ACC; importador idempotente preservará esas refs.
Versiones estables compatibles y lockfile; cada hito exige lint/typecheck/test,
integración DB y E2E pertinentes. No modificar BD para eludir claims/auth/versiones.

## Referencias del documento de origen

- ECC: https://github.com/affaan-m/ECC
- MCP: https://modelcontextprotocol.io/specification/2026-07-28
- MCP legacy: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Changelog: https://modelcontextprotocol.io/specification/draft/changelog

v1.1 reemplaza Next.js por SPA React/Vite; v1.0 fue la versión inicial.
