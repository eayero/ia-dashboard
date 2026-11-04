# Requirements UI Implementation Plan

> Native execution in this session with superpowers:executing-plans and test-driven-development. Design A approved by user. No delegation; self-review.

**Goal:** Complete the human requirements workflow in the existing dashboard.

**Architecture:** Derive the catalog and attention from complete project snapshots; read selected requirement details through existing REST. Reuse command idempotency, optimistic versions and project query invalidation. No backend changes or migrations.

**Tech Stack:** Existing React, TypeScript, TanStack Query/Router and CSS.

**Spec:** docs/requirements/REQUIREMENTS_UI_DESIGN.md.

## Global Constraints

- Preserve Q23 human requirement approval and Q24 impact evaluation.
- Keep existing project membership, archived/offline/stale-data restrictions.
- No installations, delegation or production actions.
- Preserve prior local design preparation and deployed service during development.

## Review Focus

- Proposal revision and approved scope must never be confused.
- Multiple requirement impacts on a task remain independent.
- Stale task/requirement versions require review rather than automatic retries.
- Deep links and identity/project changes must not mix private data.
- Desktop and mobile dialogs must retain focus, keyboard operation and readable content.

### Task 1: Snapshot selection and routes

Files: apps/web/src/requirements-data.ts, requirements-data.test.ts, project-search.ts,
project-search.test.ts; extend data.ts TaskDetail with requirement links.

Interfaces: requirementCatalog(state), requirementAttention(state), filterRequirements(items,search,type,filter),
parseProjectSearch(value). Requirement types match existing REST/context contracts.

- [x] Write failing tests for latest proposal/approved distinction, pending impacts, historical alerts and deep-link validation.
- [x] Implement selectors, types and URL parsing; run tests through native Node.

### Task 2: Catalog, drawer and mutations

Files: apps/web/src/requirements.tsx, requirement-detail.tsx, requirement-form.tsx;
components.tsx Modal optional className; api.ts messages; style.css.

Interfaces: Requirements consumes snapshot/permissions/identity/csrf and selected
requirementId, with open/close callbacks. Drawer reads detail via project query key;
forms use existing REST schemas and useCommand, preserving entered content on conflicts.

- [x] Implement table/search/type/status filters, counts, empty/read-only states and create form.
- [x] Implement content/tasks/history and new revision, exact-content approval confirmation,
      link/remove/evaluate with reasons and both expected versions.
- [x] Block mutations for stale snapshots/details/tasks, in-flight reads or unavailable permission.
- [x] Review component layout and types against published contracts.

### Task 3: Dashboard integration and real-browser QA

Files: app.tsx, task-detail.tsx, api.ts; docs/requirements/REQUIREMENTS_UI_RESULT.json;
project status, tasks, handoff and ACC mirror.

- [x] Add navigation/deep links and requirements in attention/task details, preserving existing task flows.
- [x] Run types, lint, format, full unit/integration/protocol suites and build.
- [x] Start an isolated local preview of changed web code with existing API; real-browser flows:
      create/revise/approve/link/evaluate/remove/history and stale conflict without losing input.
- [x] Verify query-only role, errors/offline/empty and revoked access; test keyboard/Escape/focus
      and direct-link reload at 1440x900 and 390x844. Capture screenshots under output/playwright.
- [x] Record real results/limitations, self-review, update ACC under live claim and reconcile/end session.

## Execution ledger

Pre-flight: Task 2 consumes Task 1 types; Task 3 consumes its catalog/drawer and
route parser. All project cache keys retain the existing ['project',projectId] prefix.
Ruling: preserve the current feature checkout and earlier local design files; no
second writer or worktree is needed because delegation is prohibited.

Result: implementation and real-browser flows verified locally. Regression evidence is recorded in the linked result documents; no commit/push/deployment of this continuation.
