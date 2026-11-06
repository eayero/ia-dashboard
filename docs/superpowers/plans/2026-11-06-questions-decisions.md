# Questions and Decisions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. Native execution only; delegation is not authorized.

**Goal:** Deliver questions, human-confirmed answers, versioned decisions, linked task blocking/impact and human inbox together.
**Architecture:** Add migration 013 and focused governance modules. The existing command transaction, project graph lock, ACL, idempotency and audit/outbox remain the authority. REST/MCP share commands; React uses existing components.
**Tech Stack:** TypeScript, PostgreSQL, NestJS, Zod, React/Vite, MCP SDK. No new dependencies.
**Spec:** docs/requirements/QUESTIONS_DECISIONS_DESIGN.md, approved by user on 2026-11-06.

## Constraints

- Preserve current uncommitted sprint delivery and migrations 001–012.
- Agents propose; humans confirm/approve. VIEWER reads only. Historical rows are immutable.
- Existing sprint, dependency, manual block and requirement-impact controls remain effective.
- No install, delegation, commit, push or deployment authorized.

## 1. Contracts and durable history

- [x] RED: tests for strict create/revise/answer/resolve/link/impact schemas and missing migration.
- [x] Add contracts/governance.ts; export in index.ts; migration 013 questions/answers/resolutions, decision revisions/links/impact/alerts and Q/DEC counters.
- [x] Enforce composite project FKs, immutable history and server identity. Run focused contract/migration tests GREEN.

## 2. Transactional commands and task guards

- [x] RED: real PostgreSQL scenarios for answer acceptance, permission replay, supersession and block/claim races.
- [x] Add db/governance.ts with question and decision commands. Adapt CoordinationStore through shared command wrapper and explicit human-role checks before idempotent replay.
- [x] Include open hard questions in dependenciesMet. Reconcile task BLOCKED/READY and claim/time revocation without clearing manual blocks or other dependencies; DONE alerts preserved.
- [x] Approved decision revision changes require per-task human impact evaluation before review/QA/DONE. Preserve completed tasks and technical revision.
- [x] Check rollback, cross-project IDs, optimistic versions, simultaneous resolves/approvals and stopping work.

## 3. REST/MCP, query and context surfaces

- [x] RED: HTTP and native SDK contracts, CSRF/human-only actions, pagination scope and strict identity rejection.
- [x] Add API governance queries/controller with resource/principal-bound signed cursors and project authorization.
- [x] Expose proposal/read MCP tools, context records, delta/WS entity types, task detail blockers/impact and OpenAPI routes/models.
- [x] Regenerate OpenAPI and check actual inventory and strict MCP schemas.

## 4. Web and inbox

- [x] Implement tables/filter/detail/forms for questions and decisions using existing UI; inbox includes open questions and highlights critical priority.
- [x] Human answer confirmation and decision approval/supersession/impact controls; actionable task link warnings and gate descriptions.
- [x] Verify actual desktop/mobile happy paths, empty/error/stale/permission states and nonzero historical participation.

## 5. Closure

- [x] Complete unit/integration suites, types/foundation, lint, format, five-package build and requirements coverage.
- [x] Self-review only, update result/design/status/tasks/handoff/config and native MCP summary.
- [x] End sessions/claims; reconcile full context/delta; keep publication/deployment pending explicit authorization.

## Closure and rulings

- Approved design executed natively; no independent reviewer/delegation was authorized.
- Reused the project graph lock and task dependency predicate for hard question blockers; decision impact is computed independently so requirement reviews cannot clear it.
- Question status changes preserve resolution history; a human answer proposal requires explicit confirmation. No automatic approval is inferred from a relationship.
- Final verification: 154 real integration tests and 77 unit tests, five-package types/build, foundation types, lint, OpenAPI equality and coverage 31/31 with zero orphans. Browser owner/viewer desktop/mobile and injected 503/409 recovery verified.
- Kept migrations 012/013 local; habitual instance remains 011. Publication and formal HTTPS evidence remain outside authorization.
- See QUESTIONS_DECISIONS_RESULT.json for exact checks, artifacts, limitations and final native MCP reconciliation.

- Final explicit QuestionList/QuestionDetail/DecisionList/DecisionDetail OpenAPI payload schemas checked against serialized query responses; full suite 154/154 passes. Native reconciliation complete through 491: 3 context pages / 299 records, 27 delta events since 464; implementation and closure sessions ended, no owned claims.
