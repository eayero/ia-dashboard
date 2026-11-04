# Versioned Requirements Implementation Plan

> Execution: native in this session using superpowers:executing-plans. Local rules prohibit unapproved delegation; review is self-review. User approved design and implementation on 2026-11-04.

**Goal:** Deliver FR-004 requirements with immutable revisions, task traceability and impact review through REST/MCP.

**Architecture:** Extend the existing coordination command boundary and PostgreSQL transactions. Share Zod contracts between REST, MCP and OpenAPI; extend snapshot and outbox events.

**Tech Stack:** Existing Node/TypeScript, PostgreSQL, NestJS, Zod and MCP SDK; no new dependencies.

**Spec:** docs/requirements/VERSIONED_REQUIREMENTS_DESIGN.md (approved).

## Global Constraints

- Preserve applied migrations 001–007 and local ECC changes.
- Q23: agents propose; OWNER/ADMIN/MANAGER humans approve requirements.
- Q24: new approved revisions require task impact review; DONE stays DONE.
- No installations, delegation, commit/push or deployment.

## Review Focus

- Concurrent approvals: expectedVersion permits exactly one effect.
- Several pending requirements: evaluating one must not clear others.
- Superseded content: preserve revisions and reject stale evaluation.
- Cross-project links: reject with server authorization and composite FK.
- Failed event/outbox: roll back revision, task impact and idempotency together.

### Task 1: Strict contracts and immutable persistence

Files: packages/contracts/src/requirements.ts and requirements.test.ts;
packages/db/migrations/008_requirements.sql; packages/db/src/requirements.ts;
packages/db/src/index.ts; tests/integration/requirements.test.ts.

Interfaces: CoordinationStore.createRequirement(context,key,payload),
reviseRequirement(context,key,id,payload), approveRequirement(context,key,id,payload),
linkRequirement(context,key,id,payload), evaluateRequirementImpact(context,key,id,payload).
Results identify requirement, version, revision and projectSeq; link/evaluate also
return taskVersion. Commands reuse the private transaction, role and event helpers.

- [x] Write contracts rejecting actor injection, invalid revisions, empty content and unknown fields; run and observe missing exports.
- [x] Implement Zod schemas and export from contracts index; run unit tests.
- [x] Write PostgreSQL tests for revisions, idempotency, ACL, concurrency, impact and rollback; observe missing store commands.
- [x] Add migration and focused requirement command module using existing transactional callbacks; extend counters/audit entity handling.
- [x] Run requirement integrations; verify latest draft supersedes only drafts and approved content remains immutable.

### Task 2: REST/MCP and consistent reads

Files: apps/api/src/requirements/controller.ts; apps/api/src/requirements/queries.ts;
apps/api/src/context.ts and app.ts; apps/api/src/mcp/tools.ts;
apps/api/src/projects/context-sql.ts; packages/contracts/src/index.ts;
packages/db/src/events.ts; apps/api/src/openapi/document.ts and models.ts;
apps/api/test/openapi-fixtures.ts; docs/openapi.json.

Interfaces: RequirementQueries.list(projectId,principalId,query),
detail(projectId,principalId,id). List cursor binds project/principal/filter and
detail returns revisions, links and historical impact evaluations.

- [x] Add HTTP/MCP assertions using existing integration fixtures for create/revise/list/detail and rejection of agent approval.
- [x] Expose requirement routes and human link/approval/evaluation commands; register controllers/runtime.
- [x] Add MCP tools for proposing and reading; extend snapshot records and event entity schema.
- [x] Document exact operations/models in OpenAPI and regenerate artifact.
- [x] Run HTTP/MCP/context/OpenAPI checks and reject unauthorized or stale operations.

### Task 3: Verification and continuity

Files: docs/project/STATUS.md, docs/handoffs/LATEST.md, docs/tasks/TASKS.md,
docs/requirements/VERSIONED_REQUIREMENTS_RESULT.json, docs/ACC_WORK_SYNC.json.

- [x] Run full unit/integration suites, types, lint, formatting and build with existing local tools.
- [x] Review SQL lock order, FK integrity, approval provenance and task gates against design; fix findings.
- [x] Record actual commands/results and limitations, update ACC under live claim, reconcile detail/delta and end session.
- [x] Leave publication-dependent formal closure pending without fabricated evidence.

## Execution record

Native implementation completed and self-reviewed; no delegation or commits.
58 unit tests, 101 PostgreSQL/HTTP/MCP/WS integrations, 16 protocol tests,
types, lint, format and build passed. The HTTP fixture uses port 0 and cancels
its synthetic task through API to preserve the existing pagination assertions.
Migration 008 was applied only to isolated test schemas. Running local service
was preserved. Publication and remaining entities keep ACC-LOCAL-014 IN_PROGRESS.
