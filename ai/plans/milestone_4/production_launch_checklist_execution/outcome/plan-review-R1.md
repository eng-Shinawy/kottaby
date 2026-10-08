- **H3 [backend/graphql] IP-keyed login limiter unimplementable in the resolver.** The GraphQL Context (`backend/graphql/gqlContextFactory.ts:49-99`) exposes no client IP; wiring `loginIpLimiter` in `auth.mutation.ts` would require an undeclared `gqlContextFactory.ts` edit (a pinned-context-contract file).
  **Fix:** account-keyed limiter only — `loginAccountLimiter(): RateLimiterConfig` factory keyed by the normalized login identifier from the mutation input, lazily resolved per check (so `resetEnvironmentCache()` is observable); transport-level IP throttling = the existing gateway-wide per-IP limiter recorded as 4.2.5 evidence; a login-specific per-IP limiter folded into ledger **D14**. `loginIpLimiter` removed from all files; no context edit planned.
- **H4 [schema] Phantom `teacher.user_id` index.** `teacher` links to users via its own primary key (`teacher.ts:22-24` — `id` `.references(() => users.id)` as PK; no `user_id` column exists), as do students/parents/admin; 4 of the original "7 unindexed FKs" were shared-PK-covered.
  **Fix:** true-coverage probe design (shared-PK / composite-PK-leading-column / unique-backed FKs count as covered); the reviewer's candidate list was itself re-verified and corrected — genuine unindexed FKs (4, not 3): `broadcasts.sent_by_id`/`stopped_by_id` (`broadcasts.ts:45,49`), `subscription_purchase_idempotency.subscription_id` (`subscription-purchase-idempotency.ts:32`), `session_request_idempotency.session_id` (`session-request-idempotency.ts:32`) — `index()` added for exactly those via `bun run db push` (the plan's ONE plain schema change; `student-subscriptions.student_id` is composite-PK covered, dropped).

### MEDIUM

- **M1 [DB-test layout]** Three new tests sat at `backend/db/test/logic/` root (the root holds only AGENTS.md; tests live in sub-directories; cross-cutting → `shared/`). **Fix:** rehomed to `backend/db/test/logic/shared/{data-integrity.probe,retention-anti-drift,schema-registry-census}.test.ts`; `backend/db/test/logic/AGENTS.md` already documents `shared/` in its Layout, so no third AGENTS.md edit is needed; .IV subtasks now cite `backend/db/test/logic/AGENTS.md`.
- **M2/L8 [traceability]** A.7 negative pin had no explicit home. **Fix:** `backend/db/schema/users/users-governance.static-assertions.test.ts` (DB-free `getTableColumns` pin; pattern `report-homework-schema.static-assertions.test.ts`) — specs REQ-010 AC-4, plan C12, tasks 2.12.
- **M3 [J1]** Raw-SQL probe must be environment-branched: on push-provisioned DBs the trigger is absent and DELETE fails via FK RESTRICT (different error class). **Fix:** trigger-presence branch per `audit-immutability.test.ts:339,427` (`describeTriggerTier`), with the C1 GUC bracket on migrate-provisioned DBs.
- **M4 [J1]** Financial fixtures are DELETE-blocked on migrate-provisioned DBs. **Fix:** fixture-tracking + afterAll `withImmutabilityTriggersSuspended(["student_payments","teacher_transaction"])` note (34-file convention, e.g. `subscription-expiry.journey.test.ts:469`); users rows exempt via the GUC opt-out.
- **M5 [J2]** "Spied fanout transport" + "frame arrives on the NEW socket" were mutually exclusive as written. **Fix:** explicit ruling — rule 5's intent (nothing reaches real email/SMS/push/Redis/FX) is satisfied in-process; a **recording-and-forwarding transport wrapper** (records dispatch AND delivers) proves the frame on the new socket; leakage legs via sibling-silence + inbox row-count deltas (`notification-ws-server.test.ts:517-541`); sidecar booted on `port: 0` and MUST shut down in afterAll (`backend/ws/AGENTS.md:35`).
- **M6 [i18n]** `RateLimitExceededError` message unspecified. **Fix:** resolves via `ctx.t("errors")` → `rateLimitExceeded` (parity-pinned key `shared/locale/en/errors/index.ts:9`; precedent `cron-endpoint.ts:131` translated string).
- **M7 [plan-self]** tasks 5.2 said "the single sanctioned AGENTS.md edit" while 2.9/C14 mandate the `frontend/graphql/test/AGENTS.md` Layout entry. **Fix:** 5.2 enumerates exactly the two sanctioned additive edits — (1) root AGENTS.md Essential Commands one-liner, (2) `frontend/graphql/test/AGENTS.md:36` Layout entry for the new `billing/` subdir; "Do NOT touch any other AGENTS.md".

### LOW

- **L1** SAVEPOINT bracket discipline added to the RAISE-probe specs (`wallet.repository.test.ts:15`, `financial-immutability.test.ts:16-18` docblocks; `runInRollback` deliberately has no savepoint).
- **L2** `data-integrity.probe.test.ts` scoped to the NEW users-guard guarantee; payments/ledger/audit trigger legs = run-and-record citations of the existing immutability suites.
- **L3** `shared/constants/launch-constant-pins.test.ts` CANCELLED (3 of 4 pins duplicate existing green pins at `session-fees.constants.test.ts:96-107,137-140` + `re-evaluation.constants.test.ts:53,105`); new `evaluation-rubric.constants.test.ts` pins only the unpinned `RUBRIC_PASS_THRESHOLD === 80` (`evaluation-rubric.constants.ts:18`).
- **L4** Task 0.2's `[x]` referenced this file before it existed — resolved by filing this record in the same session (the R2 verifier's closing observation).
- **L5** Tasks preamble mischaracterized a raw layer sweep; corrected — layer sweep runs via `bun run test/scripts/run-test.ts test/workflows` (the bunfig `test-runner-guard.ts` blocks raw `bun test`; `test/workflows/AGENTS.md:100-107`); all four files swept clean.
- **L6** Scripts logging ambiguity resolved — bare `console.log` record lines are lawful for `scripts/**/*.ts` under the ESLint carve-out (`eslint.config.mjs:237,244`; precedents `quality-gate.ts:68,142`, `restore-verify.ts:99-100,213`); the hard no-console rule is kept only for `backend/**`.
- **L7** Limiter config resolved lazily per check (factory signature), so `resetEnvironmentCache()` (`backend/lib/env.ts:460`) is observable in override tests.
- **L9** Notification census explicitly EXTENDS the existing `CANONICAL_VALUES` (9 → 10 members, adding `applicant_outcome`; `notification-type.enum.test.ts:17`, pgEnum `enums.ts:101-112`) — extending, not duplicating.

## Fix Subagents Dispatched

| Subagent | Target Files | Findings Fixed | Status |
|---|---|---|---|
| orchestrator (surgical Edits) | specs.md, plan.md, deferred-items.md, outcome/research-10 | 6 line anchors, split ledger table, path slash, research-10 erratum | ✅ Complete |
| fix-all-findings (single coordinated agent) | specs.md, plan.md, tasks.md, deferred-items.md | C1, H1–H4, M1–M7, L1–L3, L5–L7, L9 (+ D17 ledger row, D14 extension) | ✅ Complete |

**Ruling adaptations during the fix wave (all verified before writing):**
1. **C1 mechanism** — node-postgres `Pool` has no `afterCreate` hook (verified `@types/pg` `index.d.ts:49-60`); the opt-out rides the existing startup-options packet seam at `backend/db/client.ts:168` (`options: "-c timezone=UTC"` gains `-c kottaby.users_delete_guard=off` under the test predicate) + the PGlite init pin (`pglite-pool.ts:199`). An `ALTER DATABASE` route was rejected: no repo-owned test-only provisioning seam exists (CI DB is created by the GitHub Actions `postgres:16` service container; local sandbox by `scripts/pg-start.sh:41`; `bun run db migrate` resolves to the shared production path `scripts/dbActions/cli-entry.ts` → `backend/db/scripts/migrate.ts:24`).
2. **H4 candidate list** — re-walked all 34 `.references(` columns across `backend/db/schema/**`: four genuine unindexed FKs (the two idempotency-table set-null FKs the reviewer missed, minus `student-subscriptions.student_id` which is composite-PK covered).
3. **M7 scope** — `backend/db/test/logic/AGENTS.md:15` already documents `shared/`, so exactly two AGENTS.md edits are sanctioned, not three.

---

## Post-Fix Verification (R2 — verify-fixes-R2 agent)

- [x] All 21 cluster findings independently re-verified RESOLVED with exact-citation spot-checks (every code line re-checked by the verifier: `client.ts:168`, `pglite-pool.ts:199`, `rate-limit.ts:34-48`, `booking.ts:139-149`, `subscription-admin.service.ts:159/:299`, the four FK columns, `evaluation-rubric.constants.ts:18`, handshake `:255,280,376`, AGENTS/eslint/locale/migration anchors)
- [x] REQ traceability loop → empty output (REQ-000..REQ-013 + legacy REQ-043 evidence citation all resolve in tasks.md)
- [x] `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` → 0 (D1–D17 all resolved-pointers; D17 = users_delete_guard GUC signed launch note)
- [x] All four plan files end cleanly (specs 379 · plan 498 · tasks 466 · deferred-items 110 lines)
- [x] Anti-pattern grep → only prohibition/correction mentions (no `Translation.` enum usage, no `@/frontend/utils/logger`, no `env-config-keys.ts`, no raw single-journey `bun test`, no UI/bottom-nav, no `next-intl`/`shared/messages/`)
- [x] **R2 verdict: "Plan passes all AGENTS.md rules for affected layers."**

**Verification commands:**
```bash
for r in $(grep -oE 'REQ-[0-9]+' ai/plans/milestone_4/production_launch_checklist_execution/specs.md | sort -u); do grep -q "$r" ai/plans/milestone_4/production_launch_checklist_execution/tasks.md || echo MISSING: $r; done
grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_4/production_launch_checklist_execution/deferred-items.md
```

---

## Lessons for Future Plans

- **Research greps must be scoped to the whole test tree, not one tier** — H1 arose because a gap-premise grep covered `repo/students/` only while the coverage lived in `logic/students/`. Section researchers should always cross-check the sibling tier before declaring a gap.
- **A new DB trigger is a test-infrastructure event, not just a schema event** — C1's blast radius (~50 journey teardown paths across five helper lanes) was only visible by reading how CI provisions test DBs (all jobs `bun run db migrate`) and how teardown actually flows. Any plan adding a trigger MUST audit every hard-delete path for the guarded table before choosing the suspension scope — or design a connection-seam opt-out up front.
- **Journey assertions must be derived from the as-built denial code, not the planning document** — H2: the checklist vocabulary (`INSUFFICIENT_BALANCE`) and the as-built precedence (`SUBSCRIPTION_EXPIRED`) diverged; always read the booking gate + its pinning test before writing a journey step.
- **Verify shared-PK/composite-PK coverage before declaring an FK "unindexed"** — H4: 4 of 7 "unindexed" FKs were PK-backed; the reviewer's own correction list also needed correcting (4 genuine, not 3).
- **Plan files must not cite the process-guide templates' stale examples** — the templates still show `Translation.` enum usage and two-arg `getTranslations`; the plan encodes the real signatures (`shared/locale/server.ts:15`, `use-app-translation.ts:8-9`) instead.

---

## Traceability

**Plan files modified:** `specs.md` (375→379), `plan.md` (462→498), `tasks.md` (462→466), `deferred-items.md` (110; D1–D17), `outcome/research-10-harness-signoff.md` (erratum block).

**Outcome knowledge base updated:** this report saved as `ai/plans/milestone_4/production_launch_checklist_execution/outcome/plan-review-R1.md` — it is the evidence backing task 0.2's `[x]`.

---

## Next Steps

- [x] Review verdict recorded (R2 clean) — plan files are the post-fix state; commit them with the planning work
- [ ] Proceed to implementation (Task 0.1 baseline → Phase 1 harness)
- [ ] Implementation agents MUST read `outcome/` (13 research files + this report) before starting any task
