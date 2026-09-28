# Round R5 — Independent Review Outcome

- Scope: `git diff 94160b9..HEAD` (backend cooldown state machine: TS enum + guard, guarded repo UPDATE, service derivation/extension + BFLA gate + audit, admin GraphQL mutation, Pothos enum/field, i18n en/ar, generated SDL, and all new/modified test suites).
- Iteration: R5, formed from the code alone (no other round files read).
- Environment constraint honored: `bun quality-gate` / `bun oxlint` / `bun lint:type-aware` (direct) / `bun biome:check` (direct) NOT run. Used: `bun tsgo`, per-file sub-loop, per-file `run-test.ts`, git/rg.

---

## Perspective 1 — review-types (naming / duplicates / aliases / imports / coherence)

Evidence:
- `ApplicantCooldownState` + `isApplicantCooldownState` (`backend/enum/teachers/applicant-cooldown-state.enum.ts`) byte-mirrors the canonical sibling pattern `applicant-status.enum.ts` (pre-allocated `ReadonlySet`, fail-closed string guard, no throw). Barrel re-export added in sorted position (`backend/enum/teachers/index.ts`).
- No duplicate GraphQL registrations: `ApplicantCooldownStatePothosEnum` registered exactly once (`shared/enum.pothos.ts`); `ApplicantProfilePothosObject` maps the 8th field through it; doc header updated 7→8 fields coherently.
- Import discipline: `applicant.types.ts` keeps both enums as `import type` with the corrected note; runtime consumers (service, pothos, mappers) hold their own value imports. `AdminUserDetailReturnType.applicant` reuses `ApplicantProfileReturnType`, so the admin detail snapshot inherits `cooldownState` type-coherently (`tsgo` clean).
- Cross-service import `user-management.mappers.ts → deriveCooldownState` has in-repo precedent (`evaluation-rubric.helpers → expandCooldownTemplate`) and creates no cycle (lifecycle service imports only repo/lib/admin-guards/audit.service).
- `bun tsgo --noEmit` → 0 errors (run twice: pre- and post-fix).

Result: **0 findings.**

## Perspective 2 — review-backend (races / dead code / tx atomicity / error discipline)

Evidence:
- `extendCooldownOnce` (`applicant.repository.ts:540-581`): ONE guarded UPDATE, required `tx` (no `tx ?? db` branch), non-terminal pre-states folded into the WHERE predicate so a concurrent certification re-evaluates at write time; writes only `cooldownUntil` + `updatedAt`.
- `extendApplicantCooldown` (`applicant-lifecycle.service.ts:433-532`): BFLA gate (`assertActiveActorAdmin`) → bounds validation → `withTransaction(outerTx, …)` containing guard read → never-shorten math (`max(stored, now) + days`) → guarded write → audit insert → re-shaped profile re-read; the audit row shares the write's commit/rollback fate; post-commit event logged once. All denials are typed `DomainError` subclasses with localized messages; the bounds rejection stays silent (pure input validation) — verified by log-spy assertions.
- Error-discipline note (accepted, documented): a guarded-write miss collapses onto `APPLICANT_ALREADY_CERTIFIED` even if the stored status were corrupt (out-of-model: every writer uses `ApplicantStatus` members; the write itself stays fail-closed). The service docstring documents this collapse deliberately; changing it would alter the documented contract and the chaos-probe semantics for data unreachable via any shipped writer. Recorded as an accepted edge, not a defect.
- `isApplicantCooldownState` is currently consumed only by tests — it is the plan-mandated vocabulary authority for future transport surfaces (same contract shape as the used `isApplicantStatus`); not dead code per plan scope.
- No `console.*` added; no plan-artifact refs added (the `REQ-060` mention in `admin-governance.mutation.ts` is pre-existing context at 94160b9).

Result: **0 findings.**

## Perspective 3 — review-frontend (generated-SDL integrity)

Evidence:
- Regenerated: `bun run generate:gqlSchema` → rewrote `frontend/graphql/generated/schema.graphql` (61105 bytes); `git diff` on the file after regeneration is EMPTY (byte-identical), verified additionally with a pre-copy `diff` — `SDL REGEN: NO DIFF`. Nothing to revert; working tree carries only the R5 test fix.

Result: **0 findings.**

## Perspective 4 — pentester (authz chain / BOLA / injection / leakage / abuse)

Evidence:
- Authz chain is four-deep for the mutation: inlined `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (pinned verbatim off `pothosOptions.authScopes` in two suites) → `requireAdminUser(ctx)` → service-tier strict `assertActiveActorAdmin` (deleted/blocked/actively-suspended ladder) → `requirePositiveIntId` on the target arg. Anonymous→UNAUTHORIZED and teacher→FORBIDDEN pinned over real HTTP with zero side effects.
- BOLA: the target id is an explicit admin-arg by design (governance surface); the self surface (`myApplicantProfile`) derives identity exclusively from `ctx.user.id`; the smuggled-`actorId` wire probe dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver (no caller-supplied identity surface; audit actor is the session id — pinned).
- Injection: repo write fully parameterized; static pins forbid `${` interpolation, status string literals, prepared statements in the extend slice.
- Leakage: audit `details` carry field NAME + ISO instants + day count only; bounds copy pinned zero-ICU-placeholder in BOTH locales; error messages byte-equal to locale leaves.
- Abuse: bounds `[1, 3650]` server-side (`Number.isInteger` + range); terminal-status guard; audit FK actor never forgeable.

Result: **0 findings.**

## Special focus — TEST QUALITY & ASSERTION STRENGTH sweep (all new/modified suites)

Suites swept: `applicant-cooldown-state.enum.test.ts`, `applicant.repository.test.ts`, `applicant-lifecycle.service.test.ts`, `admin-applicant-cooldown.wire.test.ts`, `schema-surface.test.ts`, `sdl-static-assertions.test.ts`, `errors-namespace.parity.test.ts`, `cooldown-state-machine.test.ts` (12-step), `audit-completeness.journey.test.ts`.

- (a) Vacuous assertions: none found. Error probes capture typed errors and assert class + code + byte-equal localized message; log spies assert exact call counts with `?? []` destructuring that fails loudly on absence; row-oracle reads are independent of the service; `expect.unreachable` used correctly; `Promise.allSettled` race tests branch on both outcomes (fulfilled/rejected) and pin the invariant both orders guarantee.
- (b) Fake/hardcoded entity data: none — all entities via `createTestUser`/`createTestApplicant`/sanctioned provisioners; absent ids derived `max+1_000_000`; wire fixtures use real logins and per-run UUID markers.
- (c) Missing negative cases: **1 FINDING** (below).
- (d) Time-dependence: bounded everywhere — pure derivation tests use fixed instants; fresh-window probes bracket `Date.now()` before/after; journey uses ±5s `CLOCK_SKEW_MS`; wire/journey exactness rides verbatim honored future bases (no clock math). The "EXACTLY now" profile probe seeds `new Date()` and relies on monotonic-forward reads within the await gap — documented in-test; theoretical reverse clock-step risk accepted (no unbounded skew).
- (e) Cleanup/residue: journey teardown sweeps notifications → suspended-trigger ledger legs → tracked rows → cast registry (audit sweep covers actor- and user-entity legs, which subsumes the extension's audit row since the acting admin is cast-registered) → load-bearing zero-residue probes for 8 tables. Wire teardown deletes audit/notifications/applicants/admin/users FK-safe with a users-count probe. Teardown guarded for aborted `beforeAll`.

### Finding 1 (fixed)

`[LOW] backend/services/teachers/applicant-lifecycle.service.test.ts — missing negative case: the new bounds guard's `!Number.isInteger(additionalDays)` arm is never exercised. The suite header claims "full-branch coverage on new logic", and the existing bounds probes (0, -5, 3651, 1, 3650) are all integers, so they exercise only the range conjunct; a fractional/NaN day count reaching the service tier would take an untested branch.`

Fix applied: added test `rejects a NON-INTEGER additionalDays (fractional) with the bounds code before any database contact` — probes `additionalDays: 2.5` against an ABSENT applicant id (proving validation precedes any DB contact), asserting `ValidationError` / `APPLICANT_COOLDOWN_EXTENSION_INVALID` / byte-equal localized message / zero log calls. (+26 lines; mirrors the adjacent zero-day probe's shape.)

Verification after fix:
- `bun run test/scripts/run-test.ts backend/services/teachers/applicant-lifecycle.service.test.ts` → 57 pass / 0 fail (was 56).
- `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → biome:check ✅, lint:type-aware ✅, check:duplicates ✅.
- `bun tsgo --noEmit` → clean.
- Full affected-surface re-run (all green): enum suite 22/0; repo suite 17/0; wire suite 12/0; schema-surface 93/0; sdl-static-assertions 57/0; locale parity 50/0; 12-step journey 12/0; audit-completeness journey 19/0.

---

## Verdict

**R5: 1 finding (fixed)** — 0 remaining. Files modified by this round: `backend/services/teachers/applicant-lifecycle.service.test.ts` (+26). No commits made; SDL regeneration left the tree byte-identical.
