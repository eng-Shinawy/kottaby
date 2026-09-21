# Trackable Tasks: Parent Session Completion Notification Display

**Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display`
**Specs:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/specs.md`
**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/plan.md`
**Deferred-items ledger:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/`

> Source of truth: `specs.md` (REQ-000..REQ-061 as frozen in `outcome/research-00-planning-basis.md` §5) + `plan.md` (rulings R-A..R-K, decisions D1..D6). Display-only slice: the SessionCompletion parent row gains a deep link landing on the portal's session report view; emission substrate byte-frozen (R-A).

## Document Information

- **Feature Name**: Parent Session Completion Notification Display
- **Ticket**: `docs/planning/TICKETS.md:2038-2075` (Milestone 3 — Parent Portal & Admin Governance, Dev 1 stream, 3 SP; both blocker tickets shipped)
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-17
- **Author**: Tasks author (Phase 3 of spec-driven development)
- **Related Documents**: Requirements `specs.md` · Design `plan.md` · Ledger `deferred-items.md` · Research basis `outcome/research-00-planning-basis.md` (binding contract)

### Numbering & Traceability Conventions

- Task ids `X.Y` follow the frozen task map (research-00 §6); every implementation task carries the pipeline `.QL` → `.TE` → `.SEC` → `.SR` → `.IV` in strict order; no skipping.
- Outcome files: `outcome/<task-id>-outcome.md` per task (MANDATORY before `[x]`).
- `_Requirements:` lines list REQ ids EXPANDED — no ranges — grep-verifiable against `specs.md`.
- Test runners: journeys, service suites, resolver suites, and frontend container suites via `bun run test/scripts/run-test.ts <path>` ONLY; wire tests via `bun run test:graphql` (`package.json:36`); NEVER raw `bun test` on journeys (no general `test:workflows` script exists — `package.json:32` is paymob-only); `KOTTABY_TEST_RUNNER_OK=1` is a debugging bypass and NEVER appears as a task runner.
- Anti-patterns (research-00 §9) are binding on this file: no `Translation.` enum (handle constants `ParentMonitoring`/`Notifications` from `@/shared/locale`), no two-arg `getTranslations`, no `@/frontend/utils/logger` (frontend logger is `@/frontend/lib/logger`), Mobile Bottom Nav: N/A — none exists (R-B), no next-intl/`getBackendTranslations`/`shared/messages/`, no widening of the frozen payload/emitter/`notifications` copy (R-A), no new Drizzle schema/mutations/env keys (R-K).

---

## Non-Negotiable Execution Protocol for All Tasks

1. **P1 — Pre-Execution Outcome Read.** Before executing ANY task, read ALL files under `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/` (starting with `research-00-planning-basis.md` and `0-baseline-outcome.md`). Prior findings are authoritative — do not re-research what an outcome already settled.
2. **P2 — Per-File Quality Verification Loop.** Whenever a file is created/modified, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and reach exit code 0 (progressive tsgo → oxlint → biome → lint:type-aware → check:duplicates, short-circuits at first failure) BEFORE touching the next file. NEVER clear caches; never add `oxlint-disable`/`jscpd:ignore`.
3. **P3 — Semantic Review Before `[x]`.** Before marking any subtask complete, run the X.Y.SR checklist (authz/tenancy, race conditions, env-config, dead code, cross-layer imports, enum value imports, deferred items logged). `sub-loop.ts` covers mechanics only; it cannot catch semantic bugs. Code comments MUST NOT contain REQ ids, task ids, or plan paths.
4. **P4 — Outcome File Per Task.** After each task completes (implementation + quality checks), write `outcome/<task-id>-outcome.md` (research findings, changes, cross-file dependencies, carry-overs).
5. **P5 — Checkbox Tracking.** Flip `[ ]` → `[x]` in THIS file only after the pipeline for the task is complete.
6. **P6 — Instruction-File Reality.** `sub-loop.ts` auto-discovers and prints the applicable AGENTS.md + `.agents/instructions/*.instructions.md` files for each target; the executing agent MUST read ALL printed files before editing and respect the Fix-Or-Report rule (fix in-file; report cross-file dependencies to the orchestrator — never edit unassigned files).

## Mandatory Subtask Pipeline (every implementation task, strict order)

```
QL → TE → SEC → SR → IV → mark [x]
```

- **`X.Y.QL` Quality Loop (per file):** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`; exit 0 = pass; fix and re-run until clean.
- **`X.Y.TE` Test Engineering (4-Tier Framework):**
  - **Tier 1 (Branch & Statement Coverage)**: 100% of new logic branches/methods.
  - **Tier 2 (Boundary Value Analysis)**: empty/absent `relatedEntityId`, nullability arms, unicode/RTL Arabic copy, non-integer/non-positive `sessionId`.
  - **Tier 3 (Monkey & Chaos)**: fuzz payloads, concurrent/overlapping resolution calls (`Promise.allSettled`), out-of-order navigation states (session-resolution vs auto-select race — R-D).
  - **Tier 4 (Security & Abuse)**: forged ids/roles, unauthenticated rejections, constant-denial oracle uniformity (nonexistent ≡ foreign ≡ unlinked — R-C); SQL/LIKE wildcards N/A (integer arg only).
  - Layer rules enforced: journey tests (`test/workflows/`) → real services + real DB, committed `beforeAll` fixtures + FK-safe tracked `afterAll` cleanup, NO `runInRollback` (`docs/testing/workflow-journey-tests.md:55-58,64-70`); wire tests → `setupTestServerLifecycle()` + `testClient`, never raw fetch; service tests → mock external seams, follow the file's existing mocking conventions.
- **`X.Y.SEC` Security & Tenancy Audit:** BOLA/IDOR (identity from `ctx.user.id` only; caller cannot resolve foreign sessions), BOPLA (no `{ ...input }` spread — this plan ships zero writes, R-K), BFLA (admin/teacher/student rejected pre-service via `$all` authScopes, R4 §4), composite relations (session row's `studentId` gated via `requireLinkedChild`), input sanitization (malformed `sessionId` collapses to `ValidationError` at the service or constant denial at the field — never a 500).
- **`X.Y.SR` Semantic Review:** no client-supplied identity without ownership assertion; no read-then-write races; no module-level mutable state without bounds; no dead branches; no cross-layer imports (`shared/` never imports `@/frontend`/`@/backend`); enums imported as VALUES at runtime; all deferred items logged in `deferred-items.md`.
- **`X.Y.IV` Instruction Verification:** read ALL AGENTS.md + `.agents/instructions` files printed by `sub-loop.ts` discovery for every touched path; validate the file against them; report cross-file blockers via Fix-Or-Report.

**Scoping rule:** doc-only / process tasks (Task 0, Task 4.5, Task 9 review wave, Task 10) mark `TE`/`SEC` **N/A** inline with the reason, keep QL (or doc equivalent), SR, and IV.

## Layer-to-Instructions Mapping (applicable to this plan)

| Touched paths (this plan) | AGENTS.md to read | `.agents/instructions/` files |
|---|---|---|
| root (all tasks) | `AGENTS.md` | — |
| `shared/locale/{types,en,ar}/parentMonitoring/**`, `shared/locale/parentMonitoring-namespace.parity.test.ts` | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | `tests.instructions.md` (parity test) |
| `backend/types/parents/**` | `backend/AGENTS.md`, `backend/types/AGENTS.md` | `backend.instructions.md` |
| `backend/services/parents/**` | `backend/AGENTS.md`, `backend/services/AGENTS.md` | `backend.instructions.md` |
| `backend/graphql/query/parents/**`, `backend/graphql/test/**` | `backend/AGENTS.md`, `backend/graphql/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `frontend/graphql/sharedDocuments/parents/**` | `frontend/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md` | `frontend.instructions.md` |
| `frontend/providers/apollo/**` | `frontend/AGENTS.md`, `frontend/graphql/AGENTS.md` | `frontend.instructions.md` |
| `frontend/lib/notification-route-resolution*.ts` | `frontend/AGENTS.md` | `frontend.instructions.md` |
| `frontend/views/notifications/**`, `frontend/components/ui/NotificationDrawerBody.tsx`, `frontend/views/parent/monitoring/**` | `frontend/AGENTS.md`, `frontend/views/AGENTS.md` | `frontend.instructions.md` |
| `app/(dashboard)/parent/children/page.tsx` | `app/AGENTS.md` | `frontend.instructions.md` |
| `test/workflows/parents/**` | `test/workflows/AGENTS.md` | `tests.instructions.md` |
| `docs/parents/monitoring-portal.md` (Task 10) | root `AGENTS.md` | — |

---

## Implementation Overview

Test-first display-only slice, sequenced foundation → backend → frontend. The journey J1 contract (research-00 §7) is authored FIRST and stays RED until Tasks 3-6 land, pinning the full cross-actor assertion set before any consumer exists. The backend read surface (`parentSessionTarget`) then feeds SDL regen + wire matrix; frontend follows: documents → resolver Parent cell → portal-root two-hop resolution (R-D) → tab session threading (R-G); review waves and knowledge propagation close the plan. Zero Drizzle schema changes, zero mutations, zero emitter changes (R-K); the `notifications` i18n namespace is byte-frozen (R-A) — exactly ONE new `parentMonitoring` key ships (R-H).

### Implementation Strategy

- **Resolver suite history, recorded as fact:** `frontend/lib/notification-route-resolution.test.ts` was RED at planning time (stale type-first argument order; 5 pass / 2 fail, verified 2026-09-17) and was RECONCILED OUT-OF-BAND the same day, pre-implementation (a standalone fix outside this plan, per the user's request): it now runs 8 pass / 0 fail via `bun run test/scripts/run-test.ts frontend/lib/notification-route-resolution.test.ts`, with `bun run scripts/health/sub-loop.ts frontend/lib/notification-route-resolution.test.ts --lifecycle duplicates` exit 0. Task 0 records the current (green) baseline plus this RED→green history; Task 6 ADDS the Parent-cell coverage on the green suite (R-F).
- **Two-hop navigation (R-D):** the resolver is a synchronous pure leaf (no Apollo) returning `/parent/children?session=<id>`; the portal ROOT container resolves via `parentSessionTarget` and `router.replace`s to the canonical R16 URL `/parent/children/<studentId>?tab=reports&session=<id>` (`docs/parents/monitoring-portal.md:207`). While `?session=` is present and unresolved, the session flow owns navigation — never races the first-child auto-select.
- **Constant-denial oracle (R-C/D4):** nonexistent / foreign / unlinked session ids all yield the SAME constant localized `ForbiddenError`; denial log context carries `{ code, entity: "sessions", entityId, locale }` ONLY — no session row fields (R4).
- **One link, three tabs (R-G/D5):** reports tab stays the R16 landing; the session highlight threads to homework + evaluations tabs using the same mechanism as `ReportsTab.parts.tsx:54-79`.

### Development Approach

- **Testing Strategy:** TDD at the journey level (J1 test-first), interleaved per-layer suites (service, wire, resolver, container, tabs), all through approved runners.
- **Integration Strategy:** GraphQL SDL regen (`bun run generate:gqlSchema` + `bun codegen`) is the backend→frontend seam (R-J); Apollo cache registration (`ParentSessionTarget: { keyFields: false }`, R-I) precedes any view consumption.
- **Deployment Strategy:** no env keys, no migrations, no config (R-K) — deploy rides the standard app build.

---

## Implementation Plan

### Task 0 — Pre-Implementation Baseline (MANDATORY)

- [x] 0.1 Record baseline + create deferred-items ledger
  - Record baseline error counts BEFORE any implementation:
    ```bash
    bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt
    bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt
    bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
    ```
  - Record the resolver-suite status at implementation start in the outcome: `frontend/lib/notification-route-resolution.test.ts` was RED at planning (5 pass / 2 fail, stale type-first argument order — research-00 §2 history) → RECONCILED out-of-band 2026-09-17, pre-implementation (standalone fix outside this plan): now green, 8 pass / 0 fail via `bun run test/scripts/run-test.ts frontend/lib/notification-route-resolution.test.ts`. Record the CURRENT counts in the outcome so Task 6's Parent-cell additions are provably regression-free. Do NOT run raw `bun test` as a task step here — the fact is already verified in `research-00` §2.
  - Create ledger: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/deferred-items.md` (template `.agents/spec-process-guide/templates/deferred-items-template.md`); pre-seed the known forward items (e.g. DEV1-017 display-contract doc extension lands in Task 10).
  - Read ALL files in `outcome/` (research-00..04) before proceeding.
  - [x] 0.1.QL **Quality Loop**: N/A — no runtime code changed (ledger + outcome are `.md`)
  - [x] 0.1.TE **Test Engineering**: N/A — process task; baseline counts recorded verbatim
  - [x] 0.1.SEC **Security & Tenancy Audit**: N/A — no code surface
  - [x] 0.1.SR **Semantic Review**: baseline deltas attributable before implementation; ledger rows intact with zero `❌`/`⚠️`
  - [x] 0.1.IV **Instruction Verification**: read root `AGENTS.md` in full
  - Write outcome: `outcome/0-baseline-outcome.md`
  - _Requirements: REQ-000_

### Task 1 — Journey J1 (TEST-FIRST)

- [x] 1.1 Author journey J1: parent session-completion deep link
  - CREATE `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` encoding research-00 §7 EXACTLY, TEST-FIRST (RED until Tasks 3-6 land):
    - Read `test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md` FIRST; precedent deep-link journey `test/workflows/parents/parent-monitoring.journey.test.ts:790-807`.
    - **Step 1** Teacher submits the session report → emission receipts prepared for student + linked parent, published post-commit — SPY the notification dispatch boundary (`docs/testing/workflow-journey-tests.md:86-92`), NEVER real channels.
    - **Step 2** System: parent inbox contains the row with `relatedEntityType="session"`, `relatedEntityId=<sessionId>`, wire type `SessionCompletion`.
    - **Step 3** Parent: `ParentMonitoringService.getSessionTarget(parentId, sessionId)` → `{ sessionId, studentId }` with studentId = the LINKED child.
    - **Step 4** Parent: reports read for that child contains the session's report row (`sessionId`, `teacherNotes`, `studentRatingByTeacher`) — the R16 URL `/parent/children/<studentId>?tab=reports&session=<id>` is constructible and lands on the highlighted row.
    - **Step 5** Negative: unlinked child's session → NO parent emission (fail-closed).
    - **Step 6** Negative: foreign parent → `getSessionTarget` throws the constant localized `ForbiddenError`, byte-identical to the nonexistent-session case.
    - Honest role auth via real user roles + localized error substrings (`docs/testing/workflow-journey-tests.md:77-84`); committed `beforeAll` fixtures + FK-safe tracked `afterAll` teardown (`:64-70`); NO `runInRollback` (`:55-58`).
  - Runner: `bun run test/scripts/run-test.ts test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` — NEVER raw `bun test` on journeys; no `test:workflows` script exists.
  - [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts test/workflows/parents/parent-session-completion-deep-link.journey.test.ts --lifecycle duplicates` exit 0
  - [x] 1.1.TE **Test Engineering**: the journey IS the cross-tier contract (Tier 1: all six steps; Tier 2: absent/empty `relatedEntityId` row, foreign-session boundary; Tier 3: emission-before-read ordering; Tier 4: foreign-parent + unlinked-child denial probes)
  - [x] 1.1.SEC **Security & Tenancy Audit**: cross-actor table from research-00 §7 asserted verbatim (teacher cannot resolve parent sessions; student cannot resolve targets; parent cannot resolve foreign sessions)
  - [x] 1.1.SR **Semantic Review**: cleanup airtight (afterAll hard-deletes tracked fixtures even on failure); dispatch spy never leaks to real channels
  - [x] 1.1.IV **Instruction Verification**: `test/workflows/AGENTS.md` + `tests.instructions.md` read
  - Write outcome: `outcome/1.1-journey-outcome.md`
  - _Requirements: REQ-051, REQ-016_

### Task 2 — i18n key triple (`sessionTargetUnavailableNotice`)

- [x] 2.1 Add the single `parentMonitoring` key family (R-H)
  - MODIFY `shared/locale/types/parentMonitoring/index.ts` — add `sessionTargetUnavailableNotice: string` to the labels shape.
  - MODIFY `shared/locale/en/parentMonitoring/index.ts` — English copy.
  - MODIFY `shared/locale/ar/parentMonitoring/index.ts` — full Arabic parity, RTL-correct string.
  - `shared/locale/notifications-namespace.parity.test.ts` is byte-frozen (NOT touched — the `notifications` namespace is byte-frozen, R-A); the parity belt EXTENDED is `shared/locale/parentMonitoring-namespace.parity.test.ts` (the `parentMonitoring` namespace parity test) — extend it so the new key is pinned en/ar.
  - NO new namespace; NO `Translation.` enum (none exists); handle constants (`ParentMonitoring`) from `@/shared/locale` per `ParentChildrenRootContainer.tsx:22` convention; NO changes to `shared/locale/types/notifications/` or `en/ar/notifications/` copy.
  - [x] 2.1.QL **Quality Loop**: sub-loop exit 0 on all three touched files + the parity test file
  - [x] 2.1.TE **Test Engineering**: parity test extension proves en/ar key/shape parity for `sessionTargetUnavailableNotice` (Tier 1) including the RTL Arabic string (Tier 2); run via `bun run test/scripts/run-test.ts <parity-test-path>`
  - [x] 2.1.SEC **Security & Tenancy Audit**: N/A — copy-only; verify no session/child data strings hardcoded in the notice
  - [x] 2.1.SR **Semantic Review**: shared layer purity (no `@/frontend`/`@/backend` imports); exactly ONE key family added — nothing else in the namespace changed
  - [x] 2.1.IV **Instruction Verification**: `shared/AGENTS.md` + `shared/locale/AGENTS.md` + `tests.instructions.md` read
  - Write outcome: `outcome/2.1-i18n-outcome.md`
  - _Requirements: REQ-041_

### Task 3 — Backend read surface (`parentSessionTarget`)

- [x] 3.1 Type + service + query field (R-C, signatures frozen in research-00 §4)
  - MODIFY `backend/types/parents/parent-monitoring.types.ts` — append verbatim:
    ```typescript
    export interface ParentSessionTargetReturnType {
      readonly sessionId: number;
      readonly studentId: number;
    }
    ```
  - MODIFY `backend/services/parents/parent-monitoring.service.ts` — add namespace member:
    `getSessionTarget(parentActorId: number, sessionId: number, locale: string, tx?: DBTransaction): Promise<ParentSessionTargetReturnType>`.
    Flow (research-00 §4): `isPositiveSafeInt(sessionId)` else `ValidationError` → `requireActor(parentActorId, UserRole.Parent, locale, tx, false)` → `enforcePortalRateLimit(parentActorId, locale)` → ONE repeatable-read transaction: `SessionRepository.findById(sessionId, tx)` → null ⇒ constant `ForbiddenError` via `getServerTranslations(locale)` denial copy; log context `{ code, entity: "sessions", entityId: sessionId, locale }` ONLY via `@/backend/lib/logger` `logDomainError` — never session row fields (R4) → `requireLinkedChild(parentActorId, row.studentId, locale, tx)` → return `{ sessionId: row.id, studentId: row.studentId }`.
    NO new repository method; NO new table (R-C/R-K).
  - MODIFY `backend/graphql/query/parents/parent-monitoring.query.ts` — add field `parentSessionTarget(sessionId: Int!): ParentSessionTarget!` (wire name; TS interface stays `ParentSessionTargetReturnType`) with `authScopes: parentOnlyAuthScopes` (the shared parent-scoped const at `parent-monitoring.query.ts:102-107` used by all five portal fields — NOT an inline duplicate object; load-bearing `$all` conjunction, portal R13); resolver delegates to `ParentMonitoringService.getSessionTarget(ctx.user.id, args.sessionId, ctx.locale)`; `UserRole` VALUE import. Register the `ParentSessionTarget` objectRef as `.objectRef<ParentSessionTargetReturnType>("ParentSessionTarget")` beside the existing parent-monitoring object refs — locate the registration file via the query file's existing imports; do NOT invent a location.
  - [x] 3.1.QL **Quality Loop**: sub-loop exit 0 per file, order: types → service → query file
  - [x] 3.1.TE **Test Engineering**: EXTEND `parent-monitoring.service.test.ts` per research-00 §8 — happy path; missing session → constant denial; foreign → constant denial; non-positive/non-integer `sessionId` → `ValidationError`; rate-limit passthrough; follow the file's existing mocking conventions. Run via `bun run test/scripts/run-test.ts <path>`. Tier 2: `sessionId` 0/-1/fractional/2^31; Tier 4: oracle-uniformity (nonexistent ≡ foreign copy byte-identical, en AND ar)
  - [x] 3.1.SEC **Security & Tenancy Audit**: BOLA — identity from `ctx.user.id` only, no parent-id arg; BFLA — non-parent roles denied pre-service by `$all` authScopes; composite relation — `requireLinkedChild` gates `row.studentId` before return; denial carries zero session fields (BOPLA output side)
  - [x] 3.1.SR **Semantic Review**: exactly one bounded log per denial; single transaction (gate + read sealed); enum VALUE imports; no dead branches
  - [x] 3.1.IV **Instruction Verification**: `backend/types|services|graphql AGENTS.md` + `backend.instructions.md` read per sub-loop discovery
  - Write outcome: `outcome/3.1-backend-read-surface-outcome.md`
  - _Requirements: REQ-020, REQ-030_

### Task 4 — SDL regen + schema pin + wire matrix

- [x] 4.1 Codegen + SDL surface pin + wire tests (R-J)
  - Run `bun run generate:gqlSchema` then `bun codegen`; commit the regenerated output (required after every schema change).
  - MODIFY `backend/graphql/test/schema-surface.test.ts` — the parent-monitoring field list (`:531-535` area) gains `parentSessionTarget`; pin arg shape `(sessionId: Int!)` and return type `ParentSessionTarget!` (wire name).
  - MODIFY `backend/graphql/test/parent-monitoring.wire.test.ts` — extend the role matrix per research-00 §8: anonymous → 401; wrong role (student/teacher/admin) → 403; parent + nonexistent session → constant FORBIDDEN; parent + foreign session → constant FORBIDDEN; parent + linked child's session → `{ studentId }`; en/ar denial copy parity. Real test server via the layer's `testClient` + `setupTestServerLifecycle` (matrix precedent `backend/graphql/test/parent-monitoring.wire.test.ts:669-1234`).
  - Run via `bun run test:graphql` (`package.json:36`).
  - [x] 4.1.QL **Quality Loop**: sub-loop exit 0 on both test files (generated output excluded from lint by config — verify, never hand-edit)
  - [x] 4.1.TE **Test Engineering**: the matrix IS Tier 1-4 (boundary: malformed/zero/negative `sessionId`; chaos: repeated probes; security: forged-role tokens, BFLA pre-service denial asserted via zero service invocation). Tier 4 includes the rename-drift probe: a deliberate temp rename of the field fails the SDL pin, then revert
  - [x] 4.1.SEC **Security & Tenancy Audit**: error envelopes carry `extensions.code`, no stack/session-field leaks; public-operations allowlist NEEDS NO new entries (authenticated field, never anonymous)
  - [x] 4.1.SR **Semantic Review**: generated diff reviewed — no schema churn beyond `parentSessionTarget` + the new object type
  - [x] 4.1.IV **Instruction Verification**: `backend/graphql/AGENTS.md` codegen rules + `tests.instructions.md` read
  - Write outcome: `outcome/4.1-sdl-wire-outcome.md`
  - _Requirements: REQ-021, REQ-031_

### Task 4.5 — Mid-Point Backend Review Gate

- [x] 4.5 Backend-scoped review wave over Task 3-4 files (blocking before frontend work)
  - Dispatch review subagents in parallel, SCOPED to Task 3-4 files only: **review-backend** (`backend/services/parents/parent-monitoring.service.ts` + test, `backend/graphql/query/parents/parent-monitoring.query.ts`), **review-types** (`backend/types/parents/parent-monitoring.types.ts`), **review-config** (codegen/SDL regen artifacts — no env-config or drizzle changes should exist; assert that).
  - Grep-locks asserted and recorded: (a) `git diff backend/db/schema/` is EMPTY (R-K); (b) zero `Mutation` fields added (R-K); (c) zero changes in `session-report-notification.service.ts` / engine / WS envelope (R-A); (d) zero changes under `shared/locale/{types,en,ar}/notifications/` (R-A).
  - Aggregate findings; dispatch per-file fix subagents using `.agents/instructions/backend.instructions.md` as guardrails; re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per fixed file; iterate until zero backend-specific findings.
  - TE: N/A (review wave; Task 3-4 suites already green) · SEC: this gate IS the backend security audit of record (R4 log discipline re-checked)
  - [x] 4.5.SR **Semantic Review**: reviewers' findings cross-checked against research-00 §3 rulings R-C/R-K and §4 frozen signatures — every mitigation has a verifying artifact
  - [x] 4.5.IV **Instruction Verification**: reviewers cite the layer AGENTS.md/instructions their findings derive from
  - Write outcome: `outcome/midpoint-review-R1.md`
  - _Requirements: REQ-060_

### Task 5 — Frontend documents + Apollo cache

- [x] 5.1 `parentSessionTargetQueryDocument` + cache policy (R-I, R-J)
  - MODIFY `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts` — add `parentSessionTargetQueryDocument` (naming `{Field}QueryDocument`) selecting `sessionId` + `studentId` exactly; `TypedDocumentNode`-typed against generated types; docblock; NO `useLazyQuery` (stateful `useQuery` only). Document sends ONLY `sessionId` — never identity/role hints.
  - MODIFY `frontend/providers/apollo/apolloCache.ts` — append `ParentSessionTarget: { keyFields: false }` beside the existing portal no-id entries (`:114-118`); the type carries NO `id` (closed two-field projection).
  - [x] 5.1.QL **Quality Loop**: sub-loop exit 0 on both files (documents first, then cache)
  - [x] 5.1.TE **Test Engineering**: EXTEND `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.test.ts` — shape/selection assertions for the new document; run via `bun run test/scripts/run-test.ts <path>` (Tier 1; Tier 2: no `id` in the selection — cache policy holds)
  - [x] 5.1.SEC **Security & Tenancy Audit**: REQ-021 — grep-check the request body: no parent id / role / auth fields, only `sessionId`
  - [x] 5.1.SR **Semantic Review**: selection set matches the closed projection (no over-fetch); cache entry exactly the one new type — nothing more
  - [x] 5.1.IV **Instruction Verification**: `frontend/graphql/sharedDocuments/AGENTS.md` + `frontend/graphql/AGENTS.md` + `frontend.instructions.md` read
  - Write outcome: `outcome/5.1-documents-cache-outcome.md`
  - _Requirements: REQ-031_

### Task 6 — Resolver Parent cell + call sites + Parent-cell test coverage (R-E/R-F)

- [x] 6.1 4th parameter, builder cell, both call sites, Parent-cell test coverage
  - MODIFY `frontend/lib/notification-route-resolution.ts`:
    - Signature becomes `resolveNotificationRoute(relatedEntityType, notificationType?, role?, relatedEntityId?: string | number | null)` (wire rows carry `number | null`).
    - Matrix value type widens to `string | ((relatedEntityId: string) => string)`.
    - Parent/SessionCompletion cell becomes the builder `parentSessionCompletionEntry` applied ONLY when the id is a non-empty string — absent/empty id falls to the feed (the matrix never fabricates); builder yields `/parent/children?session=<id>`.
    - Existing Student/Teacher cells stay static strings; the role-less type stage is byte-unchanged.
    - New exported constant `PARENT_PORTAL_ROOT_ROUTE = "/parent/children"`.
  - MODIFY both call sites to pass the row's `relatedEntityId`: `frontend/views/notifications/feed/NotificationList.tsx` AND `frontend/components/ui/NotificationDrawerBody.tsx`.
  - MODIFY `frontend/lib/notification-route-resolution.test.ts` — the stale-arg reconciliation landed OUT-OF-BAND 2026-09-17, pre-implementation (suite green, 8/8 — do NOT redo it); ADD Parent-cell coverage: SessionCompletion + Parent + id → entry URL built; absent id → feed; empty-string id → feed; other types + Parent → feed; Student/Teacher cells unchanged (static strings).
  - [x] 6.1.QL **Quality Loop**: sub-loop exit 0 on all four files
  - [x] 6.1.TE **Test Engineering**: resolver cases above (Tier 1); Tier 2 boundary: `relatedEntityId` `null`/`undefined`/`""`/`"0"`/numeric-string/numeric; Tier 3: concurrent resolution calls stateless (pure function — assert); Tier 4: fabricated types/roles fall to feed, never a fabricated URL
  - [x] 6.1.SEC **Security & Tenancy Audit**: builder output is a static route family — no unencoded interpolation of foreign data beyond the numeric session id; the feed/drawer rows for foreign tenants were never receivable (substrate, unchanged)
  - [x] 6.1.SR **Semantic Review**: role-less stage byte-unchanged; no dead branches; baseline vs Task 0 — suite stays green with the new Parent-cell cases passing and NOTHING else regressed
  - [x] 6.1.IV **Instruction Verification**: `frontend/AGENTS.md` + `frontend.instructions.md` (+ views AGENTS.md for call sites) read
  - Write outcome: `outcome/6.1-resolver-outcome.md`
  - _Requirements: REQ-010, REQ-015, REQ-060_

### Task 7 — Portal-root session resolution flow (R-D)

- [x] 7.1 Extract `?session=` + two-hop resolve in the root container
  - MODIFY `app/(dashboard)/parent/children/page.tsx`: extract `?session=` from `searchParams` using the existing firstValueOf pattern and pass it through as a plain prop; server shell stays guard-only (no data fetch, no redirect on the server).
  - MODIFY `frontend/views/parent/monitoring/ParentChildrenRootContainer.tsx` (+parts/body files as needed):
    - Skip-guarded `useQuery(parentSessionTargetQueryDocument)` when `?session=` is present.
    - On success: `router.replace` to the canonical R16 URL `/parent/children/<studentId>?tab=reports&session=<id>` (root-container `router.replace` navigation precedent `ParentChildrenRootContainer.tsx:25-35`).
    - On FORBIDDEN failure: show a transient localized notice using the Task 2 key (`useAppTranslation(ParentMonitoring)` handle constant), then fall through to the existing first-child auto-select.
    - Race suppression: while `?session=` is present and unresolved, the session flow owns navigation — the auto-select effect must not fire (R-D).
  - Container tests: success replace, failure notice + fallback, no auto-select race (mirror the existing root-container test conventions; run via `bun run test/scripts/run-test.ts <path>`).
  - [x] 7.1.QL **Quality Loop**: sub-loop exit 0 on every touched file (page shell, container, parts, tests)
  - [x] 7.1.TE **Test Engineering**: Tier 1 all three flow branches; Tier 2 absent/empty/malformed `?session=` value (non-numeric → treated as failure notice path, never a crash); Tier 3 auto-select-vs-resolution race (resolution pending ⇒ auto-select suppressed; resolution done ⇒ replace fired exactly once); Tier 4 unlinked-session probe renders zero child data
  - [x] 7.1.SEC **Security & Tenancy Audit**: resolution failure reveals nothing beyond the constant notice (existence non-disclosure client-side); no session fields rendered before the gate passes
  - [x] 7.1.SR **Semantic Review**: no parallel URL state divergence; MUI v9 `sx` only, no style props, no hardcoded colors; `next/navigation` conventions verified against `node_modules/next/dist/docs/` before writing
  - [x] 7.1.IV **Instruction Verification**: `app/AGENTS.md` + `frontend/views/AGENTS.md` + `frontend.instructions.md` read
  - Write outcome: `outcome/7.1-portal-root-resolution-outcome.md`
  - _Requirements: REQ-011, REQ-012_

### Task 8 — Tab session threading (R-G)

- [x] 8.1 Thread the session highlight to homework + evaluations tabs
  - MODIFY `frontend/views/parent/monitoring/ParentChildDetailContainer.tabs.tsx` — `renderTabContent` (`:34-50`) passes the `session` highlight pointer to `HomeworkTab` and `EvaluationsTab`.
  - MODIFY `HomeworkTab*` and `EvaluationsTab*` files — apply the SAME highlight + `scrollIntoView` mechanism as `ReportsTab.parts.tsx:54-79`.
  - VERIFY `ParentHomeworkEntryReturnType` carries `sessionId`; if missing, add it to the closed projection + mapper + documents + codegen (research-00 R-G "verify at implementation").
  - Content promise (REQ-014): ONE link surfaces report + homework + evaluation — report row carries `teacherNotes` + `studentRatingByTeacher`; homework row carries the assignment. The `notifications` copy stays byte-frozen (R-A).
  - Tab tests mirroring the ReportsTab highlight pattern (`ReportsTab.parts.tsx:54-79`); run via `bun run test/scripts/run-test.ts <path>`.
  - [x] 8.1.QL **Quality Loop**: sub-loop exit 0 on every touched file (tabs first, then parts, then any types/mapper, then tests)
  - [x] 8.1.TE **Test Engineering**: Tier 1 highlight branches on both tabs; Tier 2 session id absent from the page data (no crash, no scroll); Tier 3 rapid tab switches while highlight pending (no stale scroll); Tier 4 no data leaks for a session not in the child's own rows
  - [x] 8.1.SEC **Security & Tenancy Audit**: highlight only ever matches rows already gated to the linked child (no new fetch, no id widening)
  - [x] 8.1.SR **Semantic Review**: highlight mechanism identical to ReportsTab (no divergent second highlight implementation — duplicates gate); if `sessionId` was added to the projection, the SDL/codegen regen from Task 4 was re-run and committed
  - [x] 8.1.IV **Instruction Verification**: `frontend/views/AGENTS.md` + `frontend.instructions.md` (+ backend types instructions if the projection changed) read
  - Write outcome: `outcome/8.1-tab-threading-outcome.md`
  - _Requirements: REQ-013, REQ-014_

### Task 9 — Post-Implementation Review Wave + Final Quality Gates

- [x] 9.1 Review wave + final gate + ledger enforcement
  - Dispatch review subagents in parallel, SCOPED to files this plan created/modified: **review-types** (`backend/types/parents/parent-monitoring.types.ts`), **review-backend** (service + query module + wire/schema tests), **review-frontend** (documents, cache, resolver, call sites, root container, tabs, page shell), **security-probing** (constant-denial oracle uniformity en/ar, `$all` authScopes, R4 log discipline, no payload/emitter widening).
  - Grep-locks re-asserted: (a) `git diff backend/db/schema/` EMPTY (R-K); (b) zero mutations added; (c) emitter / engine / WS envelope / drawer-feed-badge-toast components byte-unchanged outside the two authorized call sites (R-A); (d) zero `Translation.` enum references, zero two-arg `getTranslations`, zero `@/frontend/utils/logger`, zero next-intl/`getBackendTranslations`/`shared/messages/` anywhere in the plan delta.
  - Fix findings per-file; re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` until zero findings; nits → `deferred-items.md`.
  - Final quality gate: run `bun quality-gate` end-to-end; compare counts against `/tmp/baseline-*.txt` (Task 0) — new errors MUST be zero or fully attributed to this plan's files.
  - Deferred-items enforcement (BLOCKING): `grep -c "❌\|⚠️" ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/deferred-items.md` = 0 unresolved.
  - Re-run the journey lane to confirm J1 is green end-to-end: `bun run test/scripts/run-test.ts test/workflows/parents/parent-session-completion-deep-link.journey.test.ts`.
  - TE: N/A (review wave; all suites already green) · SEC: this task IS the security audit of record
  - [x] 9.1.SR **Semantic Review**: outcome directory complete (one file per task); no orphan carry-overs
  - [x] 9.1.IV **Instruction Verification**: quality-gate rules respected (no cache clearing anywhere in this plan)
  - Write outcome: `outcome/9.1-post-implementation-review-outcome.md`
  - _Requirements: REQ-060, REQ-020, REQ-021_

### Task 10 — Knowledge Propagation (MANDATORY final task)

- [x] 10.1 Extend the monitoring-portal canonical doc + outcome synthesis
  - EXTEND `docs/parents/monitoring-portal.md` DEV1-017 display-contract section (`:307` area): the SessionCompletion deep-link contract — entry URL `/parent/children?session=<id>`, canonical R16 landing `/parent/children/<studentId>?tab=reports&session=<id>` (`:207`), two-hop resolution (R-D), the constant-denial oracle, and the one-link-three-tabs content promise (R-G). "Link invite, not content mirror" per `docs/sessions/session-report-homework.md:81`.
  - Read ALL outcome files in `outcome/` to synthesize carry-over knowledge.
  - AGENTS.md files and `.agents/instructions/*.instructions.md` are hand-curated: plan work NEVER creates or updates them. Durable knowledge goes to `docs/parents/monitoring-portal.md` and this plan's outcome files ONLY.
  - TE: N/A (documentation task) · SEC: N/A (docs only — verify no session/child PII in examples)
  - [x] 10.1.QL **Quality Loop**: sub-loop exit 0 on the edited `.md` (doc lint lanes apply)
  - [x] 10.1.SR **Semantic Review**: doc matches the SHIPPED behavior (cross-check against outcomes, not plan intent alone); markdown link integrity verified
  - [x] 10.1.IV **Instruction Verification**: `.agents/spec-process-guide/` docs conventions followed
  - Write outcome: `outcome/10-knowledge-propagation-outcome.md`
  - _Requirements: REQ-061_

---

## Traceability Map (REQ → tasks)

| REQ | Task(s) |
|---|---|
| REQ-000 | 0.1 |
| REQ-001 | 0.1 (protocol P1-P6, header conventions), 9.1 (grep-lock d) |
| REQ-010 | 6.1 |
| REQ-011 | 7.1 |
| REQ-012 | 7.1 |
| REQ-013 | 8.1 |
| REQ-014 | 8.1 |
| REQ-015 | 1.1, 6.1 |
| REQ-016 | 1.1 |
| REQ-020 | 3.1, 9.1 |
| REQ-021 | 4.1, 9.1 |
| REQ-030 | 3.1 |
| REQ-031 | 4.1, 5.1 |
| REQ-040 | 7.1, 8.1 (zero new routes/nav — R-B holds throughout) |
| REQ-041 | 2.1 |
| REQ-050 | 1.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1 (runner discipline on every `_Requirements` test lane) |
| REQ-051 | 1.1 |
| REQ-060 | 4.5, 6.1, 9.1 |
| REQ-061 | 10.1 |

(Every REQ id defined in `specs.md` per research-00 §5 appears in at least one `_Requirements:` line above — zero misses.)

---

## Task Execution Checklist

Use this checklist when executing each task:

### Before Starting
- [ ] Requirements (`specs.md`) and design (`plan.md`) reviewed; research-00 rulings R-A..R-K re-read
- [ ] ALL files in `outcome/` read (P1) — prior findings not re-researched
- [ ] Task scope, files, and acceptance criteria clear; dependencies shipped

### During Implementation
- [ ] Code follows repo patterns; MUI v9 `sx` only; theme palette only (no hardcoded colors)
- [ ] Tests written alongside implementation; approved runners used (`bun run test/scripts/run-test.ts <path>` / `bun run test:graphql`; NEVER raw `bun test` on journeys)
- [ ] Edge cases considered (absent `relatedEntityId`, malformed `sessionId`, resolution-vs-auto-select race)
- [ ] Frozen surfaces untouched: emitter, engine, WS envelope, `notifications` copy, Drizzle schema, nav

### Before Completion
- [ ] All acceptance criteria met; `_Requirements:` REQ ids verified against `specs.md`
- [ ] **Quality Loop passed**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 per modified file
- [ ] **Test Engineering**: 4-tier obligations met for the task's lane
- [ ] **Security & Tenancy Audit** and **Semantic Review** checklists executed
- [ ] **Instruction Verification**: all sub-loop-printed AGENTS.md + `.agents/instructions` files read and validated

### Task Completion
- [ ] Feature works end-to-end: notification row → link → R16 landing → highlighted session across tabs
- [ ] No regressions (baseline comparison vs Task 0; resolver suite green (out-of-band reconciliation 2026-09-17), Parent-cell coverage added, nothing regressed)
- [ ] `outcome/<task-id>-outcome.md` written; checkbox flipped `[ ]` → `[x]` in this file

---

## Completion Definition

ALL of the following MUST hold before the plan is marked finished:

- [x] Every task checkbox in this file is `[x]` with its `outcome/<task-id>-outcome.md`.
- [x] `bun quality-gate` green end-to-end; baseline deltas vs Task 0 are zero or fully attributed.
- [x] Journey J1 green via `bun run test/scripts/run-test.ts test/workflows/parents/parent-session-completion-deep-link.journey.test.ts`; service/wire/resolver/container/tab suites green via their approved runners.
- [x] R-A: emission substrate byte-frozen (diff-proof recorded in 4.5/9.1); `notifications` copy unchanged.
- [x] R-K: `git diff backend/db/schema/` empty; zero new mutations, seeds, env keys.
- [x] R-F: Parent-cell coverage added to the already-reconciled (out-of-band 2026-09-17) suite — `frontend/lib/notification-route-resolution.test.ts` fully green.
- [x] R-D/R-B: entry link `/parent/children?session=<id>` → canonical `/parent/children/<studentId>?tab=reports&session=<id>`; zero new routes/nav; Mobile Bottom Nav: N/A — none exists.
- [x] `deferred-items.md` has zero unresolved `❌`/`⚠️` rows.
- [x] `docs/parents/monitoring-portal.md` DEV1-017 display-contract section extended; AGENTS.md/`.agents/instructions` untouched.
