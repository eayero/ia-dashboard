# Repository Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Project rules forbid delegation without authorization; execute in this session and report self-review as non-independent.

**Goal:** Register immutable project repositories through authenticated human REST commands so agents can discover IDs and attach traceable code/test evidence.

**Architecture:** Reuse CoordinationStore's transaction/ACL/idempotency/event boundary. Add a focused repository command helper and query class; expose REST through the existing project controller and consume repositories through the existing context MCP tool. Extend the event discriminator with a new migration.

**Tech Stack:** TypeScript, Zod, NestJS, PostgreSQL, pnpm; no dependencies added.

**Spec:** [Approved design A](../../requirements/REPOSITORY_REGISTRY_DESIGN.md).

## Global Constraints

- Preserve migrations 001–010, data, audit history, credentials and task criteria.
- POST accepts only `{name,url}`; HTTPS URL without credentials, query or fragment; metadata only, no network fetch.
- GET page size defaults to 20, maximum 100; stable UUID order and project authorization.
- Mutation restricted to HUMAN OWNER/ADMIN/MANAGER, cookie/CSRF at REST, mandatory Idempotency-Key.
- Exact normalized project/URL identity; no provider guessing, editing, deleting or automatic merging.
- No new UI or MCP write capability. No requirement approval/impact or human audit acknowledgement by the agent.
- Current implementation authorization does not authorize a new commit, push or deployment. Prepare reviewable code and verification first.

## Review Focus

- Concurrent requests using different keys for the same URL must return one ID and emit one event.
- A read-only or revoked caller must not recover a previous privileged result through idempotency replay.
- URL normalization must reject hidden credentials/query/fragment delimiters and preserve path case and `.git` distinctions.
- Repository audit records must belong to the same project and roll back with failed writes.
- Signed pagination cursors must be bound to resource, project and principal; context/delta must accept REPOSITORY events.

### Task 1: Contract and transaction

**Files:** create `packages/contracts/src/repositories.ts`, `packages/contracts/src/repositories.test.ts`, `packages/db/src/repositories.ts`, `packages/db/migrations/011_repository_registry.sql`; modify `packages/contracts/src/index.ts`, `packages/db/src/index.ts`, `packages/db/src/events.ts`; test `tests/integration/repositories.test.ts`.

**Interfaces:** `registerRepositorySchema`, `repositoryQuerySchema`; `CoordinationStore.registerRepository(context,key,payload)` returns `{id,name,url,projectSeq}`. Helper receives the existing transaction client and actor. Register normalizes URL with the standard URL parser after strict input validation; exact normalized URL is unique per project.

- [x] Write contract and PostgreSQL tests: valid name/URL, invalid URLs/extra fields, default/maximum pages, registration missing operation RED, concurrency, idempotency mismatch, ACL, archived project, rollback, cross-project audit/evidence.
- [x] Run contracts with `node --experimental-strip-types --test packages/contracts/src/repositories.test.ts` and integration with `node --env-file=.env --import tsx --test tests/integration/repositories.test.ts`; confirm missing behavior fails.
- [x] Add the schemas, migration, transactional command, event union and tests until focused suites pass.
- [x] Preserve existing event semantics and do not retrofit registration onto historical repositories.

### Task 2: REST query and contract

**Files:** create `apps/api/src/projects/repository-queries.ts`; modify `apps/api/src/context.ts`, `apps/api/src/app.ts`, `apps/api/src/projects/controller.ts`, `apps/api/src/openapi/document.ts`, `apps/api/src/openapi/models.ts`, `apps/api/src/openapi.test.ts`, `docs/openapi.json`; extend `tests/integration/repositories.test.ts`.

**Interfaces:** `RepositoryQueries(projects,secret).list(projectId,principalId,query)` returns `{items:[{id,name,url}],nextCursor}`. GET/POST `/api/v1/projects/:projectId/repositories`; POST invokes the store and rejects bearer callers. No new MCP tool.

- [x] Add REST tests expecting 201/200 for authorized registration/listing, 403 agent/VIEWER/REVIEWER/cross-project, CSRF rejection, cursor tampering/resource/project/principal mismatch, pagination, context/delta, no duplicate event.
- [x] Run the focused integration suite; observe route/contract failures before implementing.
- [x] Implement the query, controller methods, runtime wiring and migration preflight; update OpenAPI response/input models and generate `docs/openapi.json` through the existing generator.
- [x] Focused suites must pass with a real PostgreSQL schema and the full API.

### Task 3: Verification, evidence preparation and continuity

**Files:** update `docs/runbooks/api.md`, `docs/requirements/REPOSITORY_REGISTRY_RESULT.json`, `docs/project/STATUS.md`, `docs/tasks/TASKS.md`, `docs/handoffs/LATEST.md`, `docs/ACC_WORK_SYNC.json`, `docs/acc-tasks.json`, `config/project.json` as affected.

- [x] Run `pnpm test`, `pnpm test:integration`, protocol tests, typecheck, lint, format, OpenAPI equality and build using the installed `.tools/node_modules/pnpm/pnpm.exe`; no installation.
- [x] Self-review permissions, concurrency, migration, cursor binding and event consumers; record actual evidence and NOT_RUN limits.
- [x] Prepare TASK-26 CODE/TEST payloads for the published commit and test report with exact matching commit; do not claim unpublished changes are published or tests ran on a different commit.
- [x] Run requirements:check, mirror authorized work by native MCP, reconcile all context/delta pages, release claims and end session.
- [x] Leave commit/push/deploy and live repository registration as explicit pending actions until authorized; do not approve requirements or impact.

## Execution ledger

- Design A approved; implementation in the existing checkout to preserve the preceding authorized document changes. No subagents, installations or independent review.
- Planning does not require a second implementation approval: the user's affirmative reply explicitly authorized implementation of A. Native execution follows project delegation restrictions.
- Completed: 70/70 unit, 127/127 real PostgreSQL integration, 16/16 protocol; types, lint, format, OpenAPI and build PASS. First full integration run caught the migration-count expectation; repeated suite passes.
- Self-review confirmed permission checks before replay, exact URL identity, no network requests, project/audit isolation and transaction rollback. Review is not independent; no subagents authorized.
- Native MCP: TASK-29 version 7/revision 2, IN_PROGRESS; context/delta complete through 413. Session ended explicitly; claim revoked. Pause retry returned SESSION_INACTIVE after expiry; readback confirms 769256 ms bounded by real lease expiry, no backfill.
- Publication, deployment and live registration remain pending explicit authorization. TASK-26 evidence prepared, not attached. No requirement approval or human impact review issued.
