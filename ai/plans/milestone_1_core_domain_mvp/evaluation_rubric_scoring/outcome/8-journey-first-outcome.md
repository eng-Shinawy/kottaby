# Task 8 Outcome — Journey Test Authored (test-first RED discipline) + First-Run Results

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Branch (content):** feature commits on the sandbox-stable working tree

---

## Summary

Authored the full cross-actor journey `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` (1311 lines, 16 tests, 381 expect() calls) encoding specs §6 + plan §5.5: a five-evaluator verdict loop with PASS and FAIL (tajweed/hifz) trajectories, a typed-denial battery, terminal-verdict idempotency, and cross-actor visibility — against the REAL database with committed fixtures, no `runInRollback`, and the notification fan-out spied at the engine publish boundary.

## Fixture Provisioning

- `createJourneyFixtures(prefix)` with a per-run unique prefix, cast provisioned in `beforeAll` (committed fixtures): 1 verification plan row, applicant A (PASS cast), fail casts B (tajweed) and C (hifz), FIVE distinct certified evaluators + 1 non-evaluator certified teacher.
- Tracked `afterAll` cleanup + residue probes; the publish spy is installed/restored in before/afterAll.
- Notifications asserted as DB rows for the applicant + spied at `NotificationEngine.publishReceipts` (never published during the test body's read windows).

## Trajectory Inventory (all pinned)

1. System: committed cast + five evaluators + fail casts + plan; rubric slate empty.
2. Applicant A: verification purchase + confirmed webhook opens the cycle (`in_evaluation`).
3. A books E1–E5: five distinct scheduled evaluation sessions; credits drained.
4. E1–E4 complete; completed rows populate pending reads; E5's scheduled row stays off them.
5. E1 submits rubric 92: quorum 1/5; row leaves E1's pending read, stays on E2's; applicant unchanged.
6. E2–E4 submit 85/80/100: quorum 4/5, 80-boundary recorded; no verdict writes.
7. Denial battery: 8 typed denials (non-assigned teacher → `SESSION_NOT_FOUND`; student → FORBIDDEN; duplicate → `EVALUATION_ALREADY_SUBMITTED`; non-completed → `RUBRIC_SESSION_NOT_COMPLETED`; <80 w/o weakness → `RUBRIC_WEAKNESS_REQUIRED`; ≥80 w/ weakness → `RUBRIC_WEAKNESS_NOT_ALLOWED`; invalid weakness → `RUBRIC_WEAKNESS_INVALID`; malformed ids → `VALIDATION`) — zero rows, silent.
8. E5's fifth (exactly 80) finalizes PASS: teacher row minted (`is_approved=true, is_evaluator=false`), `passed`, `cooldown_until` NULL, exactly one `evaluation_result` notification, publish window contains exactly the rubric receipt.
9–12. Tajweed cast: purchase/book/complete; E1 records tajweed-79 → fifth finalizes FAIL with cooldown ≈ now+30d; strict-boundary re-purchase denial AT the instant; NO teacher/students/`users.suspended*` writes; one fail notification.
13–15. Hifz cast: same loop; cooldown ≈ now+90d.
16. Terminal verdict: a post-finalization submission is rejected with zero rows.

## RED Discipline Outcome (first-run documentation)

The service and GraphQL layers were completed in Tasks 6–7 BEFORE this journey ran, so the classic RED phase (authoring against absent production code) was absorbed upstream: the authoring-time expected-failing list is EMPTY — every trajectory's production behavior already existed. The first execution nonetheless exposed ONE genuine defect — a test-authoring defect, not a service defect:

- **RED finding (step 8):** the publish-count window opened BEFORE `await completeEvaluationSession(fifthSession)`, so the completion flow's own `session_completion` receipt publish landed inside the window and the assertion `publishSpy.mock.calls` = `publishesBefore + 1` received 12 instead of 11. Diagnostic run captured the two publishes in the window: `session_completion` (userId 44, session 46) + `evaluation_result` (userId 44, session 46) — the rubric service itself publishes exactly ONE receipt (its in-tx `emitForUser` runs with a caller `tx`, which by engine contract returns the receipt unpublished; the single post-commit `publishReceipts` is the service's own).
- **Fix:** the publish window now opens AFTER the completion await flushes, so the window contains exactly the rubric submission's post-commit receipt publish. Intent preserved (ONE evaluation_result receipt, published strictly post-commit, to the applicant ONLY).

## Verification Evidence

- `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` → **16 pass / 0 fail** (381 expects, ~1s suite after server boot).
- `bun run scripts/health/sub-loop.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts --lifecycle duplicates` → **exit 0** (all five stages).
- Fixture cleanup verified by the suite's own residue probes (no leakage across the three casts).
- `SERVICE_PATH` dynamic-import specifier corrected from a broken relative form to the `@/` alias convention used by sibling journeys (the relative specifier never resolved under the test runner).

## Carry-Forward to Task 9

- Cross-suite sweeps: `test:db`, `test:services`, `test:graphql`, journey ×2 back-to-back for idempotency.
- The journey is idempotent across runs (unique per-run prefix + committed-fixture cleanup) — the back-to-back run proves it.

## Deferred Items

- None new (ledger stays D1–D4).
