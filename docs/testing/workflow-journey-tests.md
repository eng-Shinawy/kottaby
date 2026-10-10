# Workflow / Journey Tests (`test/workflows/`)

Cross-actor **journey tests**: sequential, actor-attributed workflows where actor A (e.g. a
teacher) performs an action that changes shared state, and actor B (e.g. a supervisor) observes
and responds — executed through the **real service layer** against the **real test database**.

> **Status:** The journey layer is live: `test/workflows/helpers/` (cast builders +
> tracked-id cleanup registry, scaffolded by the session-lifecycle work) and the first journey
> implementations under `test/workflows/sessions/` (the J1 Full Happy
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
argument. There is no HTTP server and no Apollo client — resolver machinery (HTTP transport,
cookies) stays with the GraphQL integration layer. The one sanctioned GraphQL touch is the
**in-process parity harness**: execute the real `graphQLSchema` with a hand-built context to
prove a scope gate or field parity on the GraphQL surface, copying the harness from an existing
journey verbatim (see "Enum encoding" below for its main gotcha).

## Where this layer sits

| Layer | Location | Scope |
|---|---|---|
| DB logic | `backend/db/test/logic/` | Cross-cutting business logic & constraints, `runInRollback` |
| **Journey (this layer)** | `test/workflows/` | **Cross-actor workflows through real services, committed fixtures** |
| Service unit | `backend/services/**/*.test.ts` | Single service, mocked externals, heavy mocking allowed |
| GraphQL integration | `test/integration/` | Resolvers, schema, authorization over HTTP |
| E2E | `test/ui/e2e/` | Browser-driven Paymob checkout flow (the sole UI E2E suite) |

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
- **Immutable/append-only tables are never tracked — swept under trigger suspension.**
  `student_payments` and `teacher_transaction` are DELETE-blocked by immutability triggers and
  `audit_logs` by the audit trigger, and their rows can RESTRICT-delete rows the tracked
  cleanup must remove (e.g. a teacher wallet an earning row points at). Count/read them in
  assertions instead of tracking. When the journey's own steps commit rows there, `afterAll`
  sweeps them by the suite's own ids under `withImmutabilityTriggersSuspended([...])` /
  `withAuditDeleteTriggersSuspended` **before** `tracked.cleanup()`, re-probing zero after each
  sweep.
- **Never pin the tracked-registry size in end-state assertions.** The suite-end
  `TrackedFixtures.size` is environment-dependent — cohort waves register one row per
  governance-clean admin the database happens to hold, and seeded populations vary. Only a
  registry-size pin asserted before the journey's service calls begin is stable.

## Authorization resolves honestly

Actors are real users holding their **real roles** (the `role` enum on `users` plus its
role-child rows), so authorization resolves through the real code path. **Never** monkey-patch
role/permission resolution in a journey — that defeats the layer's purpose. Negative steps
(wrong actor, missing permission) must therefore throw naturally; assert them with a try/catch
helper and translated substrings from `getServerTranslations("en").errorsTranslations` —
**never** `expect(...).rejects.toThrow()`.

Denial steps are **oracle-safe by construction**: a non-owner's access collapses into exactly
what a nonexistent resource would return — `SESSION_NOT_FOUND` on session surfaces, the parent
portal's constant 403 (foreign ≡ nonexistent; see `docs/parents/monitoring-portal.md`) — so the
denial leaks nothing about the row's existence. Every denial proves the full **zero-write
bundle**: the target row byte-identical (status, stamps, `updatedAt`), the retry idempotency
key NOT burned (no claim row for the denied key), a fresh publish spy recording zero
dispatches, and a both-way inbox audit (the denied actor and every non-participant unchanged).

Proving **content absence** inside a JSON `details` column takes two assertions: assert the
presence flag (`notePresent === true`) AND that the content itself never entered the trail —
`expect(JSON.stringify(parsedDetails)).not.toContain(note)`. The flag alone does not prove the
content stayed out.

## Notification spying

**Nothing in a journey may reach a real external channel** (email/SMS/push). Spy the
notification dispatch boundary — the concrete dispatch helper is identified and wired when the
first journey lands (namespace import + `spyOn` from `bun:test`; if interception empirically
fails, fall back to `mock.module(...)` and restore in `afterAll`). Assert both that a dispatch
happened **and which userIds it targeted** — targeting the wrong actor is exactly the bug class
journeys exist to catch.

**Two interception seams — never a standing suite-wide namespace spy.** Services that accept
injected notification options are intercepted at the **injection seam**: pass
`{ transport: SpiedFanoutTransport, cache: InMemoryClaimCache }` and assert on the transport's
recorded calls. Lifecycle and arbitration methods without that options seam publish through the
`NotificationEngine.publishReceipts` namespace member and need `spyOn`. The gotcha: the
optioned services publish through the **same namespace member** via their injected transport,
so a standing suite-wide `spyOn(NotificationEngine, "publishReceipts")` swallows those
publishes and the spied transport records nothing. The safe pattern in a suite that mixes both
seams (established by the consolidated student journey): a **fresh per-step spy** installed
around the triggering call and restored in the same step's `finally` — every step's spy starts
at zero, so its publish count is step-local. Install the spy even on steps expected to publish
nothing (denials, silent cancellations, confirmations): the zero-publish proof is only as
strong as a spy that was armed for the call.

**Publish-window discipline (spied receipt assertions).** Post-commit publishes
(`NotificationEngine.publishReceipts`) are asynchronous *relative to the step that caused them*:
a spy window opened BEFORE the preceding step's `await` has fully flushed will swallow that
step's own receipt (e.g. a `session_completion` publish from a completion helper) and inflate
the count your assertion receives. Open the window AFTER the triggering await resolves, then
assert the exact window delta (typically `publishesBefore + 1`) and that the one receipt in the
window targets the intended recipient. Diagnose count mismatches by capturing the actual
publishes seen in the window (type + userId + entityId) before touching the assertion.

**Admin-cohort waves are membership-based.** Waves that address an admin cohort (e.g.
dispute-opened) fan out to **every governance-clean admin in the database** — seeded fixture
admins included — so the recipient set is environment-dependent. Assert **membership** (the
cast admin present, every other cast member absent), never set-equality. The foreign admins'
wave rows are still the suite's own writes: register them for teardown, because the cast
cascade cannot reach them.

## Runner gotcha: dynamic-import specifiers need `@/` aliases

Dynamic `import()` specifiers inside journeys (e.g. a `SERVICE_PATH`-style constant feeding
`await import(SERVICE_PATH)`) MUST use the `@/` alias convention used by sibling journeys.
A relative specifier (`../../backend/...`) never resolves under the test runner — the import
fails at runtime, not at type-check, so the failure surfaces only when the suite executes.
Mirror the sibling journeys' specifier form verbatim.

## File organization

- One journey file per cross-actor workflow, grouped by domain subdirectory:
  `test/workflows/<domain>/<workflow>.test.ts`.
- Shared cast/scaffolding lives in `test/workflows/helpers/` (never per-file duplicates), with a
  pure `export *` barrel.
- Layer rules for AI agents: `test/workflows/AGENTS.md`.
- Run the suite with `bun run test/scripts/run-test.ts test/workflows`; while iterating on a
  single journey use `bun run test/scripts/run-test.ts test/workflows/<domain>/<workflow>.test.ts`.

## Diagram documentation (mandatory)

Every journey ships with a Mermaid diagram in its domain's diagram file
(`test/workflows/<domain>/DIAGRAMS.md`): one section per journey test — a heading named after the
test file, a 1-2 sentence intro, and a single ```` ```mermaid ```` block (`sequenceDiagram` for
actor flows, `stateDiagram-v2` for state machines, `flowchart` for decision logic). Actor and
step names must match the real service calls. Create or update the diagram in the **same change**
as the journey, and validate before finishing:

```bash
bun run validate:mermaid test/workflows/<domain>/DIAGRAMS.md   # every block must report OK
```

Existing example: `test/workflows/sessions/DIAGRAMS.md`.

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

## Consolidated chained journeys

A ticket chain (one ticket's full end-to-end story across its actors) gets **one** consolidated
journey file that walks the whole chain in order. The per-domain journey files remain
**authoritative** for their individual scenarios — the consolidated file reuses the same real
services, oracles, and cast helpers, and adds nothing new; it proves the chain composition.

Canonical examples:

- `test/workflows/parents/parent-full-journey.journey.test.ts` — the full parent ticket chain:
  registration → handshake → link-request contention/expiry → confirm (with sibling expiry) →
  re-request collapse → session booking/completion → report fan-out deep-link wave → all
  monitoring surfaces → read-only enforcement for a non-linked parent.
- `test/workflows/billing/subscription-full-lifecycle.journey.test.ts` — the full subscription
  ticket chain: purchase → webhook settle → webhook replay → booking on the credited lane →
  expiry sweep → sweep replay → renew → renew replay → plan change → plan-change replay →
  downgrade → cancel → admin-gate denials → tenant isolation.
- `test/workflows/students/student-full-journey.journey.test.ts` — the full student ticket chain:
  registration → catalog/purchase/webhook settlement + replay → parent link chain → teacher
  browse → session booking/lifecycle/dual confirmation → report + parent portal reads → edge
  legs (insufficient-balance denial, cancellation + terminal-state replay, post-confirmation
  dispute with Refund arbitration) → final end-state consistency sweep.

## Backdated time control

When a journey leg needs "the past" (link-request TTL expiry, subscription `end_date` expiry),
**never fake timers**. Instead, backdate the row: write the `expires_at` / `end_date` column to a
past timestamp (second-precision) via a direct repository/`db` update, then invoke the real
service (`ParentLinkRequestService` confirm, `SubscriptionExpiryService.expireDue()`) and assert
it behaves exactly as if wall-clock time had passed. This keeps authorization, sweep scope, and
the debit ladder on the real code path while making the time trigger deterministic.

## Replay-leg idempotency matrix

Every state-mutating leg that can be retried gets a paired **replay leg**: invoke the same
service call a second time and assert the honest replay outcome. The matrix used by the
subscription lifecycle chain:

| ID | Replay | Expected outcome |
|---|---|---|
| C3 | Webhook settle replay | `{ processed: true, replayed: true }`; zero double credit; decided rows byte-identical |
| C4 | Expiry-sweep replay | `{ expired: 0, lanesZeroed: 0 }`; nothing flips twice |
| C5 | Renew replay | Same subscription row returns; lane, idempotency claim, and audit rows all frozen |
| C6 | Plan-change replay | Same row returns; direction is re-derived (`ProrationDirection` asserted); **`carrySessions` is `0` by contract** — the replay path has no remainder to carry (the original change consumed it), so a replay assertion must not expect the original carry value |

## Proration assertions: session units, not money

Journey assertions on plan-change proration are made **in session units only**: compute the
expected carry with the service's exact formula using integer minor-unit price constants and
`Math.min(..., MAX_SESSION_COUNT)`, then assert `carrySessions` / `forfeitedSessions` / the
resulting lane. Never assert wallet/monetary balances in a proration leg — money lives in the
financial-audit suites.

Specs for single-actor features do not need journey sections.

## Money semantics in journey assertions (session fees)

Session-fee money moves **hold-as-debit** along the booking ladder: `createSession` decrements
the trial lane first, then the subscription's paid lane, and marks the fee held
(`fee_held = true`). Dual confirmation releases the hold and credits the teacher wallet
exactly once — balance AND `total_earning`, one `earning` ledger row, zero publishes.
Participant cancellation refunds the **same lane exactly once** (`fee_held = false`) and is
notification-silent. A `Refund` arbitration reverses by debiting the wallet balance by exactly
the fee while `total_earning` keeps every earned credit — the lifetime counter is unchanged by
the reversal — leaving exactly one compensating `ArbitrationReversal` ledger row, keyed to the
session. Assert amounts as verbatim string values or arithmetic against the frozen fee
constants (`SESSION_FEE_HIFZ`), never hand-written money literals; a final end-state sweep
re-reads every money row as one table so any cross-domain money regression fails loudly.

## Enum encoding: GraphQL wire names vs storage values

Pothos serializes enum members by **name** on the GraphQL wire, while storage columns (and
service-layer returns) hold the enum's **value**: a plan's `balanceLane` crosses an in-process
GraphQL parity leg as `"Hifz"` but is stored and returned by services as `"hifz"`
(`SubscriptionCreditLane.Hifz`). When a journey asserts a GraphQL result against a
VALUE-imported enum, compare against the member name (or case-insensitively); when asserting a
service return or a raw row, compare against the value.

## Propagation notes

- **Root `AGENTS.md` "five SDL queries" is stale for the parent monitoring portal.** The portal
  actually exposes **seven** queries (`docs/parents/monitoring-portal.md:7,30`). `AGENTS.md`
  files are hand-curated and are never edited from plan work; the canonical count lives in
  `docs/parents/monitoring-portal.md`.
