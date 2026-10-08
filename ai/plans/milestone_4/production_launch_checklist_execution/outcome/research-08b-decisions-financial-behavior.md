# Research: PRODUCTION_READINESS Section 8 rows 8.11–8.21 (decisions B.1–B.11, behavioral/financial)

Date: 2026-10-08

## Area

All eleven assigned decision rows (8.11–8.21, PRODUCTION_READINESS.md:318-328) are implemented in the codebase, and ten of the eleven already have behavioral test coverage. The planning vocabulary diverges from the implementation in four load-bearing ways the launch plan must record: (1) B.1's "80% evaluation pass threshold" is implemented as a **per-submission minimum score of 80** (of a 0–100 integer band; every one of five rubric submissions must be ≥80 — it is not a mean and not "80% of evaluators"); (2) B.3's "fee determined by plan/subject" is actually **fee determined by session intent** (`hifz`/`tajweed`, both "25.00" EGP as an interim platform policy); (3) B.4's escrow is a **prepaid session-count-lane model** — the student's integer lane IS decremented at booking and refunded on cancel, while `fee_held` is the escrow marker and money moves only at dual confirmation (teacher wallet credit); (4) B.6's applicants table is the lifecycle home for **all** teacher applicants (pending/in_evaluation/failed/passed), with `failed` as one status value carrying cooldown. Row 8.21 (B.11, already ✅) citation resolves: `docs/curriculum/surah-juz-ref-vocabulary.md` exists, `surahJuzRef` pgEnum lives at `backend/db/schema/enums.ts:124`, columns at `backend/db/schema/classes/home-work.ts:33,37`. The single true launch-blocking gap is operational, not code: the B.2 auto-cancel sweep is exposed only via `GET /api/cron/sweep-sessions` (bearer-gated by `CRON_SECRET`) and no in-repo evidence wires an external scheduler to call it.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 8.11 | B.1: 80% evaluation pass threshold | `shared/constants/evaluation-rubric.constants.ts:18` `RUBRIC_PASS_THRESHOLD = 80 as const`; verdict at `backend/services/teachers/evaluation-rubric.helpers.ts:295` `submissions.every(row => row.score >= RUBRIC_PASS_THRESHOLD) ? "passed" : "failed"`; score band 0–100 int at `backend/services/teachers/evaluation-rubric.service.ts:105`; consistency gates at `:124,133` | VERIFIED (mapping: per-submission min score 80, not a %) |
| 8.12 | B.2: 24-hour dual confirmation timeout | `shared/constants/session-fees.constants.ts:40` `SESSION_CONFIRMATION_WINDOW_MS = 86_400_000`; set at `backend/services/classes/session-lifecycle.booking.ts:185`; column `backend/db/schema/classes/session.ts:74`; sweeper `backend/services/classes/session-lifecycle.service.ts:804-836`; cron route `app/api/cron/sweep-sessions/route.ts:29-31` (docblock `:4` names "The B.2 dual-confirmation timeout sweep") | VERIFIED (scheduler wiring MISSING in-repo — see Gaps) |
| 8.13 | B.3: Platform-set session fees | `shared/constants/session-fees.constants.ts:27-30` `SESSION_FEE_HIFZ = "25.00"`, `SESSION_FEE_TAJWEED = "25.00"`, `SESSION_FEE_CURRENCY = "EGP"`; applied server-side `backend/services/classes/session-lifecycle.booking.ts:182` `fee: sessionFeeForIntent(input.intent)`; guard `backend/services/classes/session-lifecycle.guards.ts:83-85`; caller input whitelist = teacherId+intent only (`booking.ts:97-115`) | VERIFIED (mapping: fee by session intent, not plan/subject) |
| 8.14 | B.4: Escrow hold-at-request, decrement-at-completion | hold written `backend/services/classes/session-lifecycle.booking.ts:183-184` (`feeHeld: true, heldBalanceLane`); lane debit ladder `booking.ts:127-159` (`StudentRepository.decrementLaneIfAvailable`); consume+credit at dual confirmation `backend/services/classes/session-lifecycle.confirmation.ts:129-141` (`fee_held=false` + `creditTeacherEarning` → `WalletRepository.creditEarningOnce`, fee verbatim); refund primitives `session-lifecycle.service.ts:516` (cancel) and `:815` (sweep); schema docblock `backend/db/schema/classes/session.ts:36-46` | VERIFIED (mapping: prepaid-lane model, see Gaps) |
| 8.15 | B.5: Re-evaluation paid by teacher wallet deduction | fee `shared/constants/re-evaluation.constants.ts:28` `RE_EVALUATION_FEE = "100.00"`; debit `backend/services/teachers/teacher-re-evaluation.service.ts:144-153` `WalletRepository.debitAdjustmentOnce({ walletId, amount: RE_EVALUATION_FEE, ... })`, guarded `WHERE balance >= amount` (docblock `:21-26`); admin gate via `assertActorAdminActive` (`:67` import) | VERIFIED (mapping: service lives in services/teachers/, admin-gated) |
| 8.16 | B.6: applicants table for failed applicants | `backend/db/schema/teachers/applicants.ts:17-32` `pgTable("applicants")`, shared PK=users.id FK, `status` varchar(50) default "pending" (pending/in_evaluation/failed/passed, service-enforced), `cooldown_until`, `re_evaluation_started_at`; transitions in `backend/db/repo/teachers/applicant.repository.ts` (`:144 create`, `:411 transitionToInEvaluation`, `:460 reopenForReEvaluation`, `:504 transitionToFailed`, `:543 finalizeOnCertification`) | VERIFIED (mapping: lifecycle table for ALL applicants) |
| 8.17 | B.7: teacher record only after verification | schema docblock `applicants.ts:9-11` "A `teacher` row is created only after passing"; minted on rubric pass `backend/services/teachers/evaluation-rubric.helpers.ts:347-355` (`finalizeRubricPass` → `TeacherRepository.insertColdStartCertified`); admin override certify `applicant-lifecycle.override-arms.ts:77`; cold-start `backend/services/admin/cold-start-certification.service.ts:119`; repo primitive `backend/db/repo/teachers/teacher.repository.ts:248`; registration creates only an applicants row (`backend/services/shared/user-provisioning.helpers.ts:91`) | VERIFIED |
| 8.18 | B.8/C.2: subscriptions.user_id generic | `backend/db/schema/billing/subscriptions.ts:32-34` `userId: integer("user_id").notNull().references(() => users.id, { onDelete: "restrict" })`; docblock `:10-12` "owned by a generic `user_id` … purchaser (any role — parent, teacher, or self-paying student)"; multi-student coverage via junction `backend/db/schema/billing/student-subscriptions.ts:20-34` | VERIFIED |
| 8.19 | B.9: Offline payment fields on subscriptions | `subscriptions.ts:41-43` `paymentMethod: paymentGateway("payment_method")`, `paymentReference varchar(255)`, `paymentVerifiedAt timestamp`; offline enum values `backend/db/schema/enums.ts:67-77` (`offline_cash`, `bank_transfer`, `scholarship`, `other`, plus gateway values); partial unique index `subscriptions.ts:54-56`; writers `backend/db/repo/billing/subscription.repository.ts:158-170` (`activatePendingOnce` patches `paymentVerifiedAt`), `backend/services/billing/subscription-activation.service.ts:385`, `backend/services/admin/student-onboarding.helpers.ts:159` | VERIFIED |
| 8.20 | B.10: On-demand matching model (no fixed assignments) | ABSENCE confirmed: grep `assignment|allocate|allocation|match` over `backend/db/schema/**/*.ts` returns only per-session `home_work` docblocks and matcher comments — no student→teacher assignment/allocation table; on-demand browse `backend/services/teachers/teacher-matching.service.ts:2-15` (`browseAvailableTeachers`, one public method); booking is student-chosen `teacherId` (`booking.ts:97-115`); PR #304 confirmed in git (`ac54b644 feat(matching): on-demand teacher matching — filter/sort pipeline`); nuance: `adminReassignTeacher` mutation exists (per-session admin correction, pinned in `backend/graphql/test/schema-surface.test.ts:515`) — not a fixed-assignment model | VERIFIED |
| 8.21 | B.11: Surah/Juz enum for homework (already ✅) | citation resolves: `docs/curriculum/surah-juz-ref-vocabulary.md` exists ("The 144-Member Mushaf Canon", 114 surahs + 30 juz); pgEnum `backend/db/schema/enums.ts:124` `surahJuzRef`; columns `backend/db/schema/classes/home-work.ts:33,37` (`current_surah_juz`, `revision_surah_juz`) | VERIFIED (citation confirmed) |

**Counts: VERIFIED 11 / PARTIAL 0 / MISSING 0 / DEFERRED 0** (4 of the VERIFIED rows carry planning-vocabulary mapping caveats recorded above; 1 ops-level gap in Gaps).

## Existing Coverage

Behavioral evidence already exists for 10 of 11 rows (8.21's enum parity is pinned by the curriculum suite from PR #300; see B.11 doc).

| Row(s) | Test artifact | What it asserts |
|---|---|---|
| 8.11 (B.1) | `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` (docblock `:9-23`) | PASS: five distinct evaluators, all scores ≥80 with the 80 boundary included, 5th submission finalizes → teacher row minted; FAIL: a tajweed-79 / hifz-79 cycle → `failed` with cooldown ≈ now+30d/90d, "NO teacher row, NO students row" |
| 8.11 (B.1) | `backend/services/teachers/evaluation-rubric.service.test.ts` | Rubric submission gates: score band 0–100 (`:105` source), failing-score-requires-weakness-area / passing-score-forbids-it (`:124,133` source) |
| 8.12 (B.2) | `backend/services/classes/session-lifecycle.service.test.ts:1118` | "deadline boundary: confirmationDeadline = captured now + 86_400_000 ms EXACTLY (bracketed)" |
| 8.12+8.14 (B.2+B.4) | `test/workflows/sessions/session-dual-confirmation.journey.test.ts` (docblock `:13-26`) | confirm-and-pay: both stamps, escrow released, wallet credited exactly the session fee once; timeout-and-refund: real service sweeper cancels an expired completed session, held unit returns to provenance lane exactly once, one auto-cancel notice, re-sweep matches zero rows; confirm-vs-sweep race |
| 8.12 (B.2) | `app/api/cron/sweep-sessions/test/sweep-sessions-route.test.ts` | Route envelope: GET-only, CRON_SECRET bearer, `{cancelled, refunded}` counts |
| 8.13+8.14 (B.3+B.4) | `backend/services/classes/session-lifecycle.service.test.ts` (escrow tiers, ~`:2823-3302`) | booking writes platform fee + `feeHeld:true` + provenance lane; fabricated past-deadline rows swept and refunded |
| 8.14 (B.4) | `backend/db/test/repo/classes/session.repository.test.ts`, `backend/db/test/logic/billing/financial-immutability.test.ts`, `test/workflows/billing/financial-safety-verification.journey.test.ts` | repo-level `feeHeld`/`heldBalanceLane` transitions; wallet ledger immutability; end-to-end financial safety journey |
| 8.14 (B.4) | `backend/types/contracts/session-completion-escrow.contract.types.ts` | compile-time contract pinning `feeHeld`/`confirmationDeadline` shapes on the completion-escrow surface |
| 8.15 (B.5) | `backend/services/teachers/teacher-re-evaluation.service.test.ts` (`:359` ledger row, `:394` low-balance denial) | debit creates exactly one `withdrawal/completed` ledger row with the composed description; wallet `balance >= amount` guard; `total_earning` untouched |
| 8.15 (B.5) | `test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts` (docblock `:10-19`) | verbatim "100.00" fee + "EGP" + post-debit "400.00" balance; exactly ONE withdrawal/completed ledger row (session_id NULL); teacher de-certified; applicant re-opened `passed → in_evaluation`; LOW-BALANCE (40.00 < 100.00) denied |
| 8.15 (B.5) | `shared/constants/re-evaluation.constants.test.ts`, `backend/graphql/test/admin-re-evaluation.wire.test.ts` | fee constant pins; GraphQL wire shape |
| 8.16 (B.6) | `backend/db/test/repo/teachers/applicant.repository.test.ts`, `applicant.repository.transition.test.ts`, `applicant.repository.re-evaluation.test.ts`, `test/workflows/teachers/cooldown-state-machine.test.ts` | applicants lifecycle transitions (pending → in_evaluation → failed/passed), cooldown stamping, re-evaluation re-open |
| 8.17 (B.7) | `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` | PASS mints the teacher row; FAIL writes NO teacher row (same journey as 8.11) |
| 8.17 (B.7) | `test/workflows/teachers/applicant-student-conversion.journey.test.ts`, `backend/services/teachers/applicant-conversion.service.test.ts` | failed-applicant → student conversion and `restoreTeacherRole` on later certification |
| 8.18+8.19 (B.8+B.9) | `test/workflows/billing/subscription-purchase.journey.test.ts`, `subscription-full-lifecycle.journey.test.ts`, `subscription-expiry.journey.test.ts`, `subscription-admin-lifecycle.journey.test.ts` | purchase → activation (credit lanes) → expiry; parent/self-paying purchaser over generic `user_id`; offline settle path |
| 8.19 (B.9) | `backend/db/test/logic/billing/subscription.repository.test.ts` (`:131,277,560`), `backend/services/billing/subscription-activation.service.test.ts` (`:435,1806` stamp pins) | `activatePendingOnce` patches `startDate/endDate/paymentVerifiedAt`; activation stamps `payment_verified_at` |
| 8.20 (B.10) | `test/workflows/teachers/on-demand-matching.journey.test.ts` | real-teacher-caller browse journey: point-in-time pure read, zero-dispatch assertion on the publish boundary |
| 8.20 (B.10) | `backend/services/teachers/teacher-matching.service.test.ts` | hard filters (Qira'ah certification, subject), language hard-filter only for non-Arabic speakers, soft country tier, sort keys |
| 8.21 (B.11) | `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` + curriculum suite (PR #300, per `docs/curriculum/surah-juz-ref-vocabulary.md`) | `surahJuzRef` pgEnum (144 members) and the two nullable homework columns |

## Gaps

No assigned decision row is MISSING in code. The gaps are (a) one operational dependency, (b) planning-vocabulary mismatches that would produce a false-negative verification if the launch script tests the planning wording instead of the implemented invariant, and (c) the absence of a consolidated launch-evidence run.

1. **Cron scheduler wiring for B.2 (launch-blocking, ops-level).** `app/api/cron/sweep-sessions/route.ts:29-31` exposes the sweep only as an externally-triggered, `CRON_SECRET`-gated GET endpoint (factory `backend/lib/gateway/cron-endpoint.ts`; docblock cites cron rules R1-R11 in `backend/services/fx/README.md`). No in-repo artifact (vercel.json, systemd unit, crontab, GitHub workflow) proves anything calls it in production. Without an external trigger, the 24h auto-cancel + held-fee refund never fires. Needed: ops verification that a deployed scheduler hits `/api/cron/sweep-sessions` (and its `expire-subscriptions` sibling) with the secret, plus one live probe of the `{cancelled, refunded}` envelope.
2. **B.1 vocabulary risk.** "80% evaluation pass threshold" reads as "80% of evaluators must pass" or "average 80%". Implemented semantics: every one of five rubric submissions must score ≥ 80 on a 0–100 integer band (`RUBRIC_PASS_THRESHOLD`, per-evaluation minimum, not a mean — `evaluation-rubric.constants.ts:5-18`). A verification script testing a "4-of-5 pass" reading would pass trivially and prove nothing. The launch check must pin: 80 passes / 79 fails per submission, and one sub-80 submission fails the cycle.
3. **B.3 vocabulary risk.** Checklist 2.2.6/8.13 says "fee is determined by plan/subject". Implemented: `sessionFeeForIntent` (`session-lifecycle.guards.ts:83-85`) keys only on session intent, both intents priced "25.00" EGP as an explicit interim policy (`session-fees.constants.ts:27-30`). Also note fees are decimal STRINGS carried verbatim (no arithmetic). The launch check should pin the constant source, and the plan should flag the provisional pricing to the product owner as a sign-off input.
4. **B.4 model mismatch.** Checklist 2.2.2 says "Balance is held (not decremented) at request". Implemented: the student's prepaid integer lane IS decremented at booking (`booking.ts:133-138` trial-first ladder) and refunded on cancel/sweep; the escrow markers are `fee_held` + `held_balance_lane` (`session.ts:68-69`); money moves only at dual confirmation as the teacher wallet credit (`confirmation.ts:58-69,129-141`). The launch verification must test the implemented invariant (INV-S3/INV-W4 posture), not the planning sentence.
5. **No consolidated decision-evidence harness.** Coverage for B.1–B.11 is spread across ~15 suites in four directories (`backend/db/test/`, `backend/services/*/`, `test/workflows/`, `app/api/cron/*/test/`). Nothing today produces a single signed-off artifact enumerating "all 33 decisions verified". The launch ticket needs a one-command evidence run + a schema-probe script (see Harness Recommendations).
6. **B.5 pricing is explicitly provisional.** `RE_EVALUATION_FEE = "100.00"` is marked "PROVISIONAL … until the product owner confirms the final re-evaluation pricing" (`re-evaluation.constants.ts:24-28`). Launch sign-off should route this through the product owner, same as the session fee.
7. **B.6/B.7 verification depends on journey tests, not DB probes.** No static schema probe asserts "applicants.status vocabulary" or "teacher row absent while status=failed" directly against a live DB; the guarantees live in service-layer tests. A `information_schema` probe adds defense in depth for the sign-off run.

## Harness Recommendations

1. **Consolidated decision-evidence suite**: `test/workflows/launch/decisions-b1-b11.journey.test.ts` — one file that, in ordered `test()` blocks, replays the decisive journeys already proven (rubric 80-boundary pass/fail, booking→deadline pin, booking→cancel refund, booking→confirm→wallet credit, re-evaluation debit, applicants lifecycle, offline settle, matching browse) and asserts the load-bearing facts for each row. This gives the sign-off a single `bun run test/scripts/run-test.ts test/workflows/launch/decisions-b1-b11.journey.test.ts` artifact.
2. **Schema probe script**: `scripts/launch/verify-decisions.ts` (or extend `scripts/health/`) — a read-only probe against the migrated production-candidate DB that asserts, via `information_schema` + Drizzle schema introspection: `subscriptions.user_id` column + FK + NOT NULL; `payment_method`/`payment_reference`/`payment_verified_at` + partial unique index; `applicants` table + shared-PK FK; `session.fee/fee_held/held_balance_lane/confirmation_deadline/confirmed_by_*` columns; `surah_juz_ref` enum member count (144); `payment_gateway` offline members; and ABSENCE of any `*_assignment`/`*_allocation` table. Prints one PASS/FAIL line per decision for the sign-off record.
3. **Constant pin checks (static)**: a tiny assertion module (e.g. alongside `shared/constants/re-evaluation.constants.test.ts`) pinning `RUBRIC_PASS_THRESHOLD === 80`, `SESSION_CONFIRMATION_WINDOW_MS === 86_400_000`, `SESSION_FEE_HIFZ === SESSION_FEE_TAJWEED === "25.00"`, `RE_EVALUATION_FEE === "100.00"` — so a pricing edit fails loudly before launch rather than silently changing behavior under the checklist's sign-off.
4. **Cron ops probe**: a documented launch step (runbook or `scripts/launch/verify-cron.ts` using the same envelope as `test/scripts/run-server-tests.ts`) that curls the deployed `/api/cron/sweep-sessions` and `/api/cron/expire-subscriptions` with the production secret and records the `{cancelled, refunded}` envelope; plus a checklist line confirming the external scheduler's schedule. Env seam: `CRON_SECRET` (see `app/api/cron/sweep-sessions/route.ts:8`).
5. **Reuse, don't rewrite**: the existing journeys in `test/workflows/sessions/`, `test/workflows/teachers/`, and `test/workflows/billing/` already verify the behavior; the launch plan should RUN them as the Section 8 evidence (via `bun run test/scripts/run-test.ts <path>` for log capture per root AGENTS.md) and only add the consolidated wrapper + probes above. New bespoke tests should be limited to the ops-level gaps (cron wiring, live-DB probes).

## Evidence Appendix

**B.1 — threshold constant + verdict (per-submission minimum, not a mean):**
```ts
// shared/constants/evaluation-rubric.constants.ts:18
export const RUBRIC_PASS_THRESHOLD = 80 as const;
// backend/services/teachers/evaluation-rubric.helpers.ts:295
return submissions.every(row => row.score >= RUBRIC_PASS_THRESHOLD) ? "passed" : "failed";
```

**B.2 — 24h window constant + deadline set at booking:**
```ts
// shared/constants/session-fees.constants.ts:40
export const SESSION_CONFIRMATION_WINDOW_MS = 86_400_000;
// backend/services/classes/session-lifecycle.booking.ts:185
confirmationDeadline: new Date(now.getTime() + SESSION_CONFIRMATION_WINDOW_MS),
```

**B.2 — sweeper + cron route (docblock names the decision):**
```ts
// backend/services/classes/session-lifecycle.service.ts:810-815
const expiredScheduled = await SessionRepository.sweepExpiredScheduledOnce(now, tx);
const expiredCompleted = await SessionRepository.sweepExpiredCompletedOnce(now, tx);
const refunded = await refundSweptHolds([...expiredScheduled, ...expiredCompleted], tx);
// app/api/cron/sweep-sessions/route.ts:4,29-30
 * The B.2 dual-confirmation timeout sweep as an externally-triggered job endpoint
export const GET = createCronSweepEndpoint({ run: () => SessionLifecycleService.sweepExpiredSessions(), ...
```

**B.3 — platform-set fee, server-owned, by intent:**
```ts
// shared/constants/session-fees.constants.ts:27,30 + guards.ts:83-84
export const SESSION_FEE_HIFZ = "25.00";   export const SESSION_FEE_TAJWEED = "25.00";
export function sessionFeeForIntent(intent) { return intent === SessionIntent.Hifz ? SESSION_FEE_HIFZ : SESSION_FEE_TAJWEED; }
// backend/services/classes/session-lifecycle.booking.ts:182-184 (insert payload)
      fee: sessionFeeForIntent(input.intent),  feeHeld: true,  heldBalanceLane: heldLane,
```

**B.4 — escrow columns + consume-and-credit at dual confirmation:**
```ts
// backend/db/schema/classes/session.ts:68-69,72-74
    feeHeld: boolean("fee_held").default(false),
    heldBalanceLane: varchar("held_balance_lane", { length: 20 }).$type<HeldBalanceLane>(),
    confirmedByStudentAt: timestamp("confirmed_by_student_at"),
    confirmedByTeacherAt: timestamp("confirmed_by_teacher_at"),
    confirmationDeadline: timestamp("confirmation_deadline"),
// backend/services/classes/session-lifecycle.confirmation.ts:59-65 (after confirmStudentCompletionOnce flips fee_held=false)
const teacherWallet = await WalletRepository.ensureWalletOnce(confirmed.teacherId, tx);
await WalletRepository.creditEarningOnce({ walletId: teacherWallet.id, sessionId: confirmed.id, amount: fee, ...
```

**B.5 — wallet deduction for re-evaluation:**
```ts
// shared/constants/re-evaluation.constants.ts:28
export const RE_EVALUATION_FEE = "100.00" as const;
// backend/services/teachers/teacher-re-evaluation.service.ts:150-151
const ledger = await WalletRepository.debitAdjustmentOnce(
  { walletId, amount: RE_EVALUATION_FEE, description: composeReEvaluationDescription(normalizedReason) }, tx);
```

**B.6+B.7 — applicants table docblock pins both decisions:**
```ts
// backend/db/schema/teachers/applicants.ts:9-11,17,26
 * A row is moved here when a teacher applicant fails verification. A `teacher`
 * row is created only after passing.
export const applicants = pgTable("applicants", {
  ...
  status: varchar("status", { length: 50 }).default("pending"),
// backend/services/teachers/evaluation-rubric.helpers.ts:355 (teacher row minted ONLY on pass)
    await tx.transaction(sp => TeacherRepository.insertColdStartCertified(applicantUserId, false, sp));
```

**B.8+C.2 / B.9 — generic owner + offline payment columns:**
```ts
// backend/db/schema/billing/subscriptions.ts:32-34,41-43
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    paymentMethod: paymentGateway("payment_method"),
    paymentReference: varchar("payment_reference", { length: 255 }),
    paymentVerifiedAt: timestamp("payment_verified_at"),
// backend/db/schema/enums.ts:72-74 (offline members of payment_gateway)
  "offline_cash", "bank_transfer", "scholarship", "other",
```

**B.10 — on-demand browse is the matching surface (no assignment tables exist):**
```ts
// backend/services/teachers/teacher-matching.service.ts:2,5
 * TeacherMatchingService — the student-facing on-demand matching browse.
 *   - `browseAvailableTeachers` — ONE public method ...
// git: ac54b644 feat(matching): on-demand teacher matching — filter/sort pipeline (#304)
```

**B.11 — citation resolves (checklist row 8.21 already ✅):**
```ts
// backend/db/schema/enums.ts:124
export const surahJuzRef = pgEnum("surah_juz_ref", [
// backend/db/schema/classes/home-work.ts:33,37
    currentSurahJuz: surahJuzRef("current_surah_juz"),
    revisionSurahJuz: surahJuzRef("revision_surah_juz"),
// docs/curriculum/surah-juz-ref-vocabulary.md — "The 144-Member Mushaf Canon" (114 surahs + 30 juz)
```

**Cross-reference (contracts echo the decisions):** `backend/types/contracts/session-request.contract.types.ts:6` — "Hifz/Tajweed, 24h confirmation deadline, platform-set fee"; `:28` "NOW() + 24h, computed by the producing service".
