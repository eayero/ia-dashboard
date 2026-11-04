# Task Work Time Implementation Plan

> Native execution with executing-plans and TDD; user approved explicit start/pause and design. No delegation; self-review.

**Goal:** Accumulate verifiable task work intervals per agent and calendar day.

**Architecture:** New PostgreSQL ledger and lifecycle triggers reuse claim/session transactions. Shared start/pause commands serve REST/MCP; authorized reads aggregate intervals using timezone-aware day boundaries. Task UI displays the read model.

**Tech Stack:** Existing PostgreSQL, TypeScript, NestJS, Zod, MCP, React.

**Spec:** docs/requirements/TASK_WORK_TIME_DESIGN.md.

## Global Constraints

- Explicit agent start/pause only; no inferred historical time or manual durations.
- PostgreSQL clock, session/claim/fencing and active membership are authoritative.
- America/Caracas default daily report, UTC optional; midnight and DST boundaries are real instants.
- Preserve applied migrations 001–008 and the separate requirements UI work.
- No installations, delegation, production changes or invented evidence.

## Review Focus

- An expired timer cannot resume through heartbeat or acquire more time.
- Concurrent starts and replayed requests cannot double count.
- Release/revocation/session termination close timers even outside task commands.
- Midnight splitting must preserve exact per-agent/day/task sums.
- Read model must preserve attribution without exposing fencing or credentials.

### Task 1: Ledger and lifecycle

Files: packages/contracts/src/work-time.ts and work-time.test.ts; db migrations/009_task_work_time.sql;
packages/db/src/work-time.ts and index.ts; tests/integration/work-time.test.ts.

Interfaces: CoordinationStore.startWork(context,key,taskId,input), pauseWork(context,key,taskId,input);
readTaskWorkTime(client,projectId,taskId,timeZone) returns asOf, totalMilliseconds,
agents, days and intervals. Mutations use heartbeatClaimSchema inputs.

- [x] Write failing strict-contract and PostgreSQL tests for start/pause, replay, concurrency,
      human rejection, expiry, heartbeat, revocation, rollback and timezone boundaries.
- [x] Add migration with immutable interval metadata, one active agent/project interval,
      claim/session closure triggers and deadline renewal without resurrection.
- [x] Implement shared commands with lease/version checks and audit/outbox; implement exact daily aggregation.
- [x] Run new unit and real DB tests, fixing causes without weakening existing tests.

### Task 2: REST/MCP and task UI

Files: projects/controller.ts, commands.ts, context-sql.ts; mcp/tools.ts;
openapi models/document and artifact; task-time.tsx and task-detail.tsx.

- [x] Expose task time read and start-work/pause-work commands plus three MCP tools; add interval context records.
- [x] Extend OpenAPI and HTTP/MCP integration assertions for real shared behavior.
- [x] Add task total, agent/day table and expandable intervals; handle empty/loading/error and running asOf.
- [x] Ensure UI is read-only for humans and refreshes when time/claim events occur.

### Task 3: Verification and continuity

- [x] Run full unit/integration/protocol suites, types, lint, format, OpenAPI and build.
- [x] Verify task time in a real browser at desktop/mobile using isolated seeded intervals.
- [x] Record both UI and time results, update local state and ACC, reconcile details/context/delta and end session.

## Execution ledger

Pre-flight: Task 2 consumes Task 1 contracts/read model and existing project-query authorization.
Ruling: automatic closures are claim/session triggers; expiry is also bounded on read so no
background worker is required for correct totals. Expired open intervals are finalized before a new start.

Result: implementation and real-browser flows verified locally. Regression evidence is recorded in the linked result documents; no commit/push/deployment of this continuation.
