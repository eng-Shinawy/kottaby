# Workflow / Journey Tests (`test/workflows/`)

Cross-actor **journey tests**: sequential, actor-attributed workflows where actor A (e.g. a
teacher) performs an action that changes shared state, and actor B (e.g. a supervisor) observes
and responds — executed through the **real service layer** against the **real test database**.

> **Status:** The journey layer is live: `test/workflows/helpers/` (cast builders +
> tracked-id cleanup registry, scaffolded by DEV3-004 task 2.1) and the first journey
> implementations under `test/workflows/sessions/` (DEV3-004 task 2.2: the J1 Full Happy
> Lifecycle cross-actor workflow) exist. The plan-generator invariant holds: every
> cross-actor workflow in the requirements maps to exactly one
> `test/workflows/<domain>/<journey>.test.ts` task.

## What a journey is

A journey is an ordered series of steps, each attributed to an actor:

```text
Step 1  teacher    → ReportService.submitReport(...)        → report PENDING_REVIEW
Step 2  supervisor → ReportService.getPendingReviews(...)    → sees the report
Step 3  supervisor → ReportService.approveReport(...)        → APPROVED + teacher_due + notification to teacher
Step 4  teacher B  → submitReport on teacher A's class       → rejected (honest authorization failure)
Step 5  teacher + supervisor → submit → rejectReport(...)    → REJECTED + refund + notification
```

Each step calls a service function directly with the actor's identity (`actorUserId`) as an
argument. There is no HTTP server, no GraphQL resolver, no Apollo client — resolver machinery
(DataLoader, cookies) stays with the GraphQL integration layer.

## Where this layer sits

| Layer | Location | Scope |
|---|---|---|
| DB logic | `backend/db/test/logic/` | Cross-cutting business logic & constraints, `runInRollback` |
| **Journey (this layer)** | `test/workflows/` | **Cross-actor workflows through real services, committed fixtures** |
| Service unit | `backend/services/**/*.test.ts` | Single service, mocked externals, heavy mocking allowed |
| GraphQL integration | `test/integration/` | Resolvers, schema, authorization over HTTP |
| E2E | `test/ui/e2e/` | Browser-driven user flows |

Journeys fill the gap between service unit tests (one actor, mocked boundaries) and E2E (full
stack, browser): they prove that a multi-step workflow behaves correctly when each step is taken
by a *different actor* with *real authorization resolution* against *real committed rows*.

Use a journey test when:
- The workflow spans **multiple actors** (teacher → supervisor, parent → admin, …).
- You need to assert **cross-actor visibility** (A's action appears/disappears for B) and
  **cross-actor side effects** (notifications, dues, refunds targeting *another* user).
- Honest authorization checks matter (no monkey-patching of role/permission resolution).

Use a different layer when:
- A single service method in isolation suffices (service unit test with mocks).
- You only exercise repositories/constraints (db logic test with `runInRollback`).
- You need resolver wiring, HTTP, or browser behavior (GraphQL / E2E).

## Rule: NO `runInRollback` in journeys

Services use the global `db` and spawn their **own top-level transactions**. Wrapping a journey
in an outer rollback transaction would deadlock or silently miss committed rows. This layer is
the documented exception to the `backend/db/test/` `runInRollback` rule — an exception that
applies **only inside `test/workflows/`**, never in `backend/db/test/`.

## Fixture lifecycle

- **`beforeAll`**: provision the full actor "cast" in a short `db.transaction(...)` that
  **commits**. Use `backend/db/test/entity-setup.ts` helpers (`createTestUser`,
  `createTestStudent`, `createTestParent`, `createTestApplicant`, `createTestAdmin`) — verify
  their signatures before calling; they vary.
- **Track every created row id** in the cast object (including rows the *services* create during
  the journey: reports, dues, credit transactions, idempotency-keyed rows).
- **`afterAll`**: hard-delete everything in FK-safe order via the cast helper's cleanup function
  (`test/workflows/helpers/`, scaffolded by the first journey).
- **UUID-prefix discipline**: every suite generates a unique prefix
  (`const prefix = \`jrn_<domain>_${randomUUID().slice(0, 8)}\``) used in names/notes so parallel
  or repeated runs never collide.
- **Never use demo/seeded rows as fixtures.** Always create your own entities.

## Authorization resolves honestly

Actors are real users holding their **real roles** (the `role` enum on `users` plus its
role-child rows), so authorization resolves through the real code path. **Never** monkey-patch
role/permission resolution in a journey — that defeats the layer's purpose. Negative steps
(wrong actor, missing permission) must therefore throw naturally; assert them with a try/catch
helper and translated substrings from `getServerTranslations("en").errorsTranslations` —
**never** `expect(...).rejects.toThrow()`.

## Notification spying

**Nothing in a journey may reach a real external channel** (email/SMS/push). Spy the
notification dispatch boundary — the concrete dispatch helper is identified and wired when the
first journey lands (namespace import + `spyOn` from `bun:test`; if interception empirically
fails, fall back to `mock.module(...)` and restore in `afterAll`). Assert both that a dispatch
happened **and which userIds it targeted** — targeting the wrong actor is exactly the bug class
journeys exist to catch.

## File organization

- One journey file per cross-actor workflow, grouped by domain subdirectory:
  `test/workflows/<domain>/<workflow>.test.ts`.
- Shared cast/scaffolding lives in `test/workflows/helpers/` (never per-file duplicates), with a
  pure `export *` barrel.
- Layer rules for AI agents: `test/workflows/AGENTS.md`.
- Run the suite with `bun run test/scripts/run-test.ts test/workflows`; while iterating on a
  single journey use `bun run test/scripts/run-test.ts test/workflows/<domain>/<workflow>.test.ts`.

## Recording journeys from specs

Cross-actor journeys are part of the spec workflow — integrated in
`.agents/skills/spec-driven-development/SKILL.md` and the `.agents/spec-process-guide/` templates:

- **Requirements phase** (`requirements-template.md` → "Cross-Actor Workflow Scenarios
  (Journeys)"): capture an **actor table** (actors, their roles, and what each can/cannot do) and
  an ordered **step list** (`actor → action → expected shared-state change + side effects`), with
  EARS criteria phrased from the perspective of the actor who OBSERVES the outcome. These map 1:1
  onto a journey's steps.
- **Design phase** (`design-template.md` → "Cross-Actor Journey Design"): record the
  **shared-entity state machine** (e.g. `PENDING_REVIEW → APPROVED | REJECTED`), the
  **side-effect matrix** per transition (rows created, notifications dispatched, credits moved,
  idempotency keys), and **cross-actor visibility** per state. These become the journey test's
  assertions.
- **Tasks phase** (`tasks-template.md` → "Journey Test Tasks"): write the journey test **first**
  (test-driven), then implement the service surface until the journey passes. The journey file is
  named after the workflow and lives under the domain subdirectory derived from the spec.

Specs for single-actor features do not need journey sections.
