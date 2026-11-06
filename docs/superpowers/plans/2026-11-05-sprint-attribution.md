# Sprint Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execution is native in the current feature checkout; project rules prohibit delegation without authorization.

**Goal:** Show authenticated authors and participants with recorded time, and enforce execution in the sprint inherited from a task's primary requirement.

**Architecture:** PostgreSQL remains the transactional authority. Add migration 012, focused sprint/attribution modules, shared store guards, and REST/MCP adapters. Extend the existing React UI and explicit work-time model without new dependencies.

**Tech Stack:** TypeScript, PostgreSQL, NestJS, Zod, React, Vite, MCP SDK.

**Spec:** `docs/requirements/SPRINT_ATTRIBUTION_DESIGN.md` (approved by user “continua” after design review).

## Global Constraints

- Preserve migrations 001–011, credentials, task states and immutable evidence.
- One ACTIVE sprint per project; primary requirement determines inherited sprint.
- Never infer work duration or historical transport/ownership without evidence.
- No new dependency, installation, delegation, commit/push or deployment.
- Current feature checkout contains this work's documentation; preserve it.
- Use existing explicit intervals; management remains human-only.

## Review Focus

- Pausing a sprint concurrently with claim/start must revoke or reject work atomically (Task 2).
- A reused credential for the same agent must not create a second participant (Task 3).
- Multiple requirement links must not assign a primary by arbitrary ordering (Task 1).
- Reassignment must not move historical time or lose secondary links (Tasks 2–3).
- Backlog and disabled-account history must remain readable without allowing unauthorized writes (Tasks 3–4).

## Task 1: Contracts and migration

Files: create `packages/contracts/src/iterations.ts`, `packages/contracts/src/iterations.test.ts`, `packages/db/migrations/012_sprint_attribution.sql`, `tests/integration/iterations.test.ts`; modify `packages/contracts/src/index.ts`, `packages/db/src/events.ts`.

Interfaces: createIterationSchema, transitionIterationSchema, assignRequirementSprintSchema,
assignPrimaryRequirementSchema; persisted iterations, primary_requirement_id, sprint_id,
audit transport/identity snapshot and interval attribution.

- [x] Add and run failing contracts and isolated PostgreSQL migration tests.
- [x] Implement strict schemas, primary-in-links validation and migration integrity.
- [x] Test singleton backfill, ambiguous legacy links, cross-project constraints and immutable history.
- [x] Verify focused contracts and migration tests pass. Record results; no commit authorized.

## Task 2: Sprint commands and execution guards

Files: create `packages/db/src/iterations.ts`; modify `packages/db/src/index.ts`,
`packages/db/src/requirements.ts`, `packages/db/src/work-time.ts`; extend `tests/integration/iterations.test.ts` and the test-only requirement fixture.

Interfaces: CoordinationStore.createIteration/updateIteration/transitionIteration,
assignRequirementSprint/assignPrimaryRequirement/prepareSprintExecution;
assertTaskSprintActive(client, projectId, taskId).

- [x] Add failing command tests for PLANNED/ACTIVE/PAUSED/COMPLETED/CANCELLED, human management, versions and idempotency.
- [x] Implement project-serialized sprint lifecycle and assignments with audit/outbox.
- [x] Guard claim/heartbeat/start/update/evidence/progress; permit stopping and planning.
- [x] Pause/finish/cancel atomically closes intervals and invalidates claims; record snapshots when starting time.
- [x] Test competing activations, start/pause race, stale fencing, reassignment with running work, and preparation command preserving task history.
- [x] Verify focused suites. Adapt synthetic fixtures to create real planned/active requirements without weakening production guards.

## Task 3: Authorship and participation queries

Files: create `packages/db/src/attribution.ts`, `apps/api/src/projects/planning-queries.ts`;
modify store event/context transport plumbing, project/requirement queries and snapshot SQL.

Interfaces: readEntityAttribution(client, projectId, entityId, entityType, timeZone),
PlanningQueries.iterations/participants; task/requirement detail fields creator,
primaryRequirementId, sprint, executionBlock; attribution response direct participants,
task collaborators and exact task/requirement agent and owner time.

- [x] Add failing tests for agent creation, owner snapshot, successful actions only and historical unknown identity.
- [x] Implement scoped audit aggregation; no read tracking and no duplicate idempotent participation.
- [x] Aggregate explicit time with historical principal/sprint snapshots; secondary links do not double count.
- [x] Verify multiple credentials, disabled-account history, cross-project denial, reassignment history and zero recorded time.

## Task 4: REST, MCP, events and OpenAPI

Files: modify `apps/api/src/projects/controller.ts`, `apps/api/src/projects/commands.ts`,
`apps/api/src/mcp/tools.ts`, `apps/api/src/app.ts`, `apps/api/src/context.ts`,
`apps/api/src/openapi/document.ts`, `apps/api/src/openapi/models.ts`,
`packages/contracts/src/index.ts`, relevant protocol/openapi tests.

Interfaces: authenticated human REST iteration management and assignment commands;
MCP acc_list_iterations and acc_get_participants; task creation primary requirement;
ITERATION snapshot/event type and consistent transport attribution.

- [x] Add failing HTTP/MCP contract tests including permissions, CSRF, strict primary creation and reads.
- [x] Wire shared store/query operations and runtime migration preflight.
- [x] Add ITERATION to context/delta/WS schemas and expose planning/identity in detail reads.
- [x] Export OpenAPI and verify route/schema inventory, cursor scope and MCP tool schemas.

## Task 5: Web interface

Files: create `apps/web/src/iterations.tsx`, `apps/web/src/participants.tsx`;
modify app/navigation, requirements catalog/detail, task creation/detail, data types and work-time UI.

Interfaces: existing style/components, versioned REST management, inherited sprint display,
creator/participants/time and explicit blocked-action explanations.

- [x] Add meaningful pure UI-data tests for primary inheritance, grouping and block explanations; watch RED.
- [x] Implement sprint management table, assignment controls and primary selector.
- [x] Show authenticated creator, direct participants and recorded task time per agent/owner.
- [x] Validate loading/empty/error/permission/stale states, responsive 1440x900 and 390x844 real browser.

## Task 6: Verification and continuity

- [x] Run complete unit/integration/protocol suites, typecheck/foundation, lint, format, OpenAPI equality and five-package build.
- [x] Audit 30 tasks/requirements coverage; keep MCP native tracking on deployed migration 011 separate from isolated 012 QA.
- [x] Self-review migration, concurrency, permission replay and temporal attribution; no independent review claimed.
- [x] Update design status, result, tasks, STATUS and handoff with evidence and NOT_RUN items.
- [x] End session/claims and reconcile complete native context/delta. Leave code locally reviewable; no unauthorized publication or deployment.

## Rulings and progress

- User continuation approves design and authorizes implementation; execute natively per project prohibition on delegation. No additional execution-method prompt.
- Work in current feature checkout; all existing dirty files belong to this task. No worktree switch that would separate the approved uncommitted design from implementation.
- Each task is RED→GREEN; no commits despite generic skill examples because this new feature has no publication authorization.

## Verification closure (2026-11-06)

Completed locally; see docs/requirements/SPRINT_ATTRIBUTION_RESULT.json for commands, counts and explicit visual-coverage limits. 140 integration / 74 unit tests pass, with five-package types/build, foundation checks, lint, OpenAPI equality and zero orphan tasks. Actual browser QA at 1440x1000 and 390x844 covers the central flows. Complete visual empty/error/stale/disabled matrix and nonzero-time screenshots were not separately run; no full visual matrix claim. Self-review only. Native MCP context/delta complete through 464, session ended, no owned claim. No commit/push/deployment. Task remains IN_PROGRESS for publication/evidence and existing human impact decisions.
