# Task 8 Outcome — Cross-actor journey `admin-subscription-lifecycle` (REQ-9)

**Date**: 2026-09-19
**Branch**: `feat/admin-subscription-management` (no commits made — per sandbox discipline)
**Scope (1 new file)**: `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts`

---

## 1. Summary

The standalone cross-actor journey implementing the plan's cross-actor journey design EXACTLY (its eleven-step table, steps 1-11) is written TEST-FIRST and green against the shipped service surface. One student's Hifz subscription travels the full admin-owned lifecycle across three REAL actors — a producer admin, the owning student, an unrelated student — through the real gated services (`SubscriptionAdminService.extendSubscription / cancelSubscription / renewSubscription / changeSubscriptionPlan`, plus `SubscriptionPurchaseService.listOwn` as the student's `mySubscriptions`-equivalent owner read), with the four audit rows pinned per action (Update/Suspend/Create/Override shapes per the census-pinned contracts), the two idempotency claims located and pinned, the replay proven to mint NOTHING, both denial probes (`catchJourneyError` + localized FORBIDDEN substrings) proven to mint nothing, and a zero-dispatch notification spy guarding the whole journey (the feature deliberately emits NO notifications — documented in the journey header).

**NOTIFICATIONS (deliberate zero)**: no step in this lifecycle fans out to any channel. `NotificationEngine.publishReceipts` is spied for the WHOLE journey and asserted zero calls at every step AND in `afterAll` — a future stray publish fails this suite loudly.

## 2. Step-by-step results (11 steps → 11 tests, declaration order)

| Step | Actor | Journey assertion highlights | Result |
|---|---|---|---|
| 1 | System | Cast + 2 same-lane plans + active S (window 2030-01-01→01-31) committed in ONE transaction; owner lane seeded 4; `tracked.size` 9; clean audit slate for all three actors | ✅ |
| 2 | Admin | `extend +30d` → row `end_date = 2030-03-02` EXACTLY (ms); lanes byte-identical; exactly one `Update` row on S, details `{ previousEndDate, newEndDate, addedDays }` ISO+int | ✅ |
| 3 | Student | `listOwn` sees S extended+active; unrelated student's `listOwn` = `[]` (cross-actor visibility both directions) | ✅ |
| 4 | Admin | `cancel` → status `cancelled`, window untouched, all four lanes byte-identical (balance-preserving); exactly one appended `Suspend` row, details `{ fromStatus, toStatus, reason }` (run-unique reason verbatim) | ✅ |
| 5 | Student | Lane still 4 (no booking-denial mutation from the cancel op itself); owner read shows the terminal state; zero new audit rows; student actor still zero-mint | ✅ |
| 6 | System | Expired S2 fixture (run-clock-anchored window, genuinely past-dated) + drained lane in one committing transaction | ✅ |
| 7 | Admin | `renew S2` → NEW active S3 (id ≠ S2), fresh window = now + exactly 30d, null gateway payload; lane 0 → 8 (full `sessionCount` credit); junction row for S3; exactly one claim keyed `subscription-admin:renew:<S2>` backfilled with S3; exactly one `Create` row on S3, details `{ renewedFromSubscriptionId, planId, creditedSessions, intervalDays }`; S2 anchors nothing | ✅ |
| 8 | Admin | `renew S2` REPLAY → returns S3 (equal id); lane/junction/claim/audit all unchanged (nothing new anywhere) | ✅ |
| 9 | Admin | `plan-change S3 → smaller plan` (unit 25.00 → 12.50 pins Downgrade) → S3 `cancelled` (plan unchanged), S4 active on the new plan (fresh 30d window, null gateway payload), lane settles 8 → 4 (excess 8 forfeited, carry 0); junction = [S3, S4]; exactly one claim keyed `planChangeClaimKey(S3, target)` backfilled with S4; exactly one `Override` row on S4, details `{ direction, fromSubscriptionId, fromPlanId, toPlanId, carrySessions, forfeitedExcess }`; S3 still carries only its renew `Create` row | ✅ |
| 10 | (denial) Student | `cancelSubscription` on own row via the STUDENT's actor id → `ForbiddenError` with localized `tErrors.forbidden` substring (via `catchJourneyError`; NEVER `.rejects.toThrow`); S4 byte-identical, lanes untouched, zero mint (per-actor + per-entity audit oracles) | ✅ |
| 11 | (BOLA) Other student | `listForAdmin(student.userId, otherStudent.userId)` → `ForbiddenError` + localized substring BEFORE any touch (`spyOn(SubscriptionRepository, "listByUserId")` observation-only spy: `mock.calls` length 0 — then restored); owner's read shows the exact 4-row lifecycle (S cancelled, S2 expired, S3 cancelled, S4 active); `tracked.size` 14 | ✅ |

## 3. Teardown + residue proof

`afterAll` ordering (FK-safe, audit-first):
1. Zero-dispatch assertion + `publishSpy.mockRestore()`.
2. Audit rows swept FIRST under `withAuditDeleteTriggersSuspended` (`actor_id` is ON DELETE RESTRICT; append-only trigger suspension is the only sanctioned mutation path) — actor sweep + defensive user-entity raw sweep.
3. Defensive notification sweep by user ids.
4. `deleteUsersByIds(journeyUserIds)` — the user-led sweep first among the row sweeps (RESTRICT-gated subscriptions + users; role-children cascade).
5. `tracked.cleanup()` — reverse-registration hard-delete of everything still present (claims → S4 → S3 → S2 → S → plans; already-absent users/subs tolerated) with MANDATORY zero-residue existence probes baked in.
6. Post-teardown probes: `countUsersByIds === 0`; admin's audit rows === 0; audit rows for each of the four subscription entity ids === 0; junction rows for both students === 0; claims for the journey users === 0.

**Idempotent re-run proven**: two consecutive green runs (per-run `jrn_billing_<8hex>` prefix; run 2 recreates the full cast and observes none of run 1's rows — teardown totality).

## 4. Run results (runner-mandated; postgres 127.0.0.1:5432/app_db)

| Suite | Result |
|---|---|
| `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts` (run 1) | ✅ 11 pass / 0 fail (135 expect) — 367 ms |
| same (run 2 — idempotency proof) | ✅ 11 pass / 0 fail (135 expect) — 373 ms |
| `test/workflows/billing` (layer) | 53 pass / 5 skip (LIVE paymob, env-gated) / 1 fail — the fail is `financial-safety-verification` step F, pre-existing environmental (below), NOT this journey |
| `test/workflows/admin` (layer) | ✅ 82 pass / 0 fail (1709 expect) — includes the census journey's subscription-admin legs |
| `test/workflows` (full layer) | 340 pass / 5 skip / 3 fail across 34 files (12.3 s) — all 3 fails pre-existing environmental (below); this journey green inside the sweep |

**Pre-existing environmental failures (evidence, not regressions)** — both reproduce in isolation on files this task never touched:
- `financial-safety-verification` step F + the session state-machine race leg expect the append-only immutability triggers; direct psql probe over the sandbox DB returns **0 user triggers on `teacher_transaction`** (`SELECT tgname FROM pg_trigger WHERE tgrelid='teacher_transaction'::regclass AND NOT tgisinternal` → 0 rows) — the shared DB is `bun db push`-provisioned, which per `test/helpers/db-cleanup.ts` carries NO trigger family. Tamper-attempt probes therefore don't throw and the exactly-once race posture degrades.
- 5 skips are the LIVE-tunnel paymob journey (env-gated by design).

Sandbox note: this worktree exhibited another session concurrently flipping `main` ↔ `feat/admin-subscription-management` mid-session (observed via `git reflog`); every Bash call re-asserted the branch per the runbook and reads of branch-divergent files were snapshotted via `git show 02bd9aa:<path>` to stay immune.

## 5. QL / SEC / SR / IV

- **8.QL**: `sub-loop.ts <file> --lifecycle duplicates` → exit 0 (oxlint ✅, biome:check ✅, lint:type-aware ✅ — includes project-wide tsgo filtered to the file; check:duplicates outside jscpd scope → passed). Full `bun tsgo` → exit 0, 0 errors (run twice, after the last edit).
- **8.TE**: the journey IS the test — green ×2 consecutive runs + the layer runs above.
- **8.SEC**: both denial probes ride the REAL `assertActorAdmin` gate (real student actors, never monkey-patched) with per-actor AND per-entity zero-mint audit oracles; the BOLA probe additionally proves the gate denies BEFORE the owner-scoped read via an observation-only spy (original behavior preserved, restored immediately); localized substrings only (`tErrors.forbidden`), never raw key echoes, never `.rejects.toThrow`.
- **8.SR**: plan-artifact grep (`REQ-`, `Task`, `tasks.md`, `plan.md`, `specs.md`, `ai/plans`, `§`, `Phase N`) over the new file → 0 hits; statuses/verbs/directions flow from enum members (`SubscriptionStatus.*`, `AuditActionType.*`, `ProrationDirection.*`) — no runtime literals; `git status` = exactly the one in-scope file; no commits/pushes.
- **8.IV**: `test/workflows/AGENTS.md` honored in full — no `runInRollback`, one committing setup transaction (+ one committing mid-journey System step), TrackedFixtures registration of every fixture AND service-minted row (incl. both claims), real actor-context cast, `catchJourneyError` + localized substrings, notification boundary spied, run-prefix uniqueness, `bun:test` + `@/` aliases, runner-only execution (never raw `bun test`). `tests.instructions.md`: the `runInRollback` rule is superseded by the documented journey-layer exception; its DB rules (entity-setup helpers with verified signatures — `createTestPlan`/`createTestSubscription` read before use, no seed data, try/catch denial pattern, process-locked runners) are honored.

## 6. Carry-forward

- **Task 10 (frontend drawer)**: the journey pins the service-level contract behind each action (payload shapes, replay equality semantics, lane settlement arithmetic) — mirror these in the drawer's success copy; the wire surface itself is pinned by Task 7's integration suite.
- **Task 11 (final gate)**: the full `test/workflows` sweep carries 3 pre-existing environmental failures rooted in the sandbox DB's missing immutability triggers (`bun db push` provisioning) — either re-provision via migrations or record the env caveat; 5 LIVE-tunnel skips are by-design. The port-3066 eviction runbook (outcome/7) applied before suite runs.
- The zero-dispatch notification contract is now journey-pinned: if this feature ever grows a notification, this suite fails by design — extend the header + spy assertions deliberately.
