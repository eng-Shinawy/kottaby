# Task 6 Outcome — `EvaluationRubricService` + in-tx helpers + service tests

## Summary

`EvaluationRubricService` (namespace, `backend/services/teachers/evaluation-rubric.service.ts`) exposes the
evaluator-facing surfaces of the five-session evaluation loop: the write-once rubric submission and its two
caller-keyed reads. The transactional write pipeline lives in the sibling module
`evaluation-rubric.helpers.ts` (not part of the public API); the service owns boundary validation, the
governance re-check, the captured instant, the `withTransaction` composition, and the post-commit publish.

### `submitRubricEvaluation` — the fixed in-tx gate order (never reordered)

1. **Pre-DB validation (zero reads)** — malformed ids (`VALIDATION`), then the input contract in one pass:
   score 0–100 integer band (`RUBRIC_SCORE_INVALID`), observations non-empty ≤ bound (`RUBRIC_NOTES_REQUIRED`),
   weakness iff-rule both directions (`RUBRIC_WEAKNESS_REQUIRED` below threshold / `RUBRIC_WEAKNESS_NOT_ALLOWED`
   at-or-above), fail-closed weakness vocabulary (`RUBRIC_WEAKNESS_INVALID`). Returns the TRIMMED notes — the
   only value the sealed insert persists.
2. **Actor governance** — `assertActorGovernanceClean` (deleted/blocked/suspended evaluator cannot score).
3. `withTransaction(outerTx, …)` → `submitRubricEvaluationInTx` (helpers), fixed order:
   - **Session gate** (`findGatedCompletedSession`): must exist, be `SessionType.TeacherEvaluation` +
     `SessionIntent.Evaluation`, be OWNED by the caller (`session.teacherId === evaluatorUserId`), and be
     `Completed`. Unknown / foreign / mistyped share the ONE byte-identical `SESSION_NOT_FOUND` (oracle-free);
     an owned-but-not-completed target is `RUBRIC_SESSION_NOT_COMPLETED`.
   - **Certification re-check, fresh in-tx** (`FOR UPDATE`): `TEACHER_NOT_CERTIFIED` unless both flags hold.
   - **Applicant lock + status gate**: `ApplicantRepository.findForBookingGate` locks the evaluated row — the
     per-applicant finalization mutex; non-`in_evaluation` is `APPLICANT_NOT_IN_EVALUATION`. The evaluated
     subject is ALWAYS `session.studentId` (REQ-2.4) — never client-supplied.
   - **Cycle membership**: a session created before the applicant's current cycle start folds into the SAME
     `SESSION_NOT_FOUND` (history is not scorable).
   - **Duplicate pre-check** (optimization only): `EVALUATION_ALREADY_SUBMITTED`.
   - **Sealed insert** `insertOnce` — payload built field-by-field (no `...input` spread); a `23505` in the
     cause chain maps onto the SAME `EVALUATION_ALREADY_SUBMITTED` (the unique arbiter is the replay
     authority — no `ctx.idempotencyKey` machinery).
   - **Quorum read under the held lock** (REQ-5.6: `FOR UPDATE` from the status read onward): below 5
     submissions the submission returns ALONE (`in_evaluation` status, no receipt).

### Finalization paths (count = 5, in the SAME transaction — REQ-5.2; the 5th submission is the only trigger)

- **PASS** (`deriveRubricVerdict`: every score ≥ `RUBRIC_PASS_THRESHOLD` — a per-evaluation minimum, never a
  mean): `insertColdStartCertified(studentId, false, sp)` on a nested savepoint; on `23505` the elevate arm
  locks the pre-existing teacher row and either no-ops (already approved) or `elevateToCertified` with the
  LOCKED row's OWN `isEvaluator` flag (demotion guard), then `finalizeOnCertification` — a zero-row finalize
  raises `APPLICANT_ALREADY_FINALIZED` and rolls the whole transaction back (REQ-7.1).
- **FAIL**: `derivePrimaryFailureArea` (lowest score, ties → earliest `created_at`; missing/foreign area is a
  fail-closed tripwire) → `resolveFinalizationCooldownUntil` (tajweed = now+30d, hifz = now+90d, from the ONE
  captured instant) → ONE guarded `transitionToFailed` — null → `APPLICANT_ALREADY_FINALIZED` + rollback.
  NO `users.suspended*` write, NO `students` row, NO role flip.

### Notification receipt discipline

The finalization notification is composed INSIDE the transaction in the APPLICANT'S persisted locale
(`users.locale`, fallback `defaultLocale`) from `applicant` keys (`NotificationType.EvaluationResult`; the
failed body interpolates the locale-formatted cooldown instant via the shared `expandCooldownTemplate`) and
`emitForUser(…, tx)` runs in-tx. The receipt + recipient locale are returned OUT of the tx;
`NotificationEngine.publishReceipts` runs STRICTLY post-commit, only on the production path (`outerTx ===
undefined`) — never retried, never able to roll back the verdict, and suppressed entirely on a
caller-owned transaction. Any failure (including a rejected in-tx emit) rolls the WHOLE verdict back —
zero committed state between the 5th submission and the verdict (REQ-15.4).

### Reads

- `myRubricPendingSessions` — certification-gated with the oracle-safe EMPTY page for non-certified callers
  (one bounded log, never an error); page bounds normalize (page ≥ 1, pageSize 1..100 default 25) and echo
  honestly; rows are the caller's own by construction.
- `myRubricEvaluation` — the (session, evaluator) pair is the only scope: unknown and foreign pairs share the
  identical `SESSION_NOT_FOUND`; a hit returns the sealed read-model (no observations) with the LIVE applicant
  status; a missing applicant row or foreign stored status fails closed (`APPLICANT_STATUS_CORRUPT`).

Every denial logs exactly ONE bounded `logger.logDomainError` (code + entity + entity id only — never the
payload, never the observations); happy paths log nothing. No module-level mutable state; every in-tx
repository call receives the SAME transaction.

## Files created / modified

| File | Status |
| --- | --- |
| `backend/services/teachers/evaluation-rubric.service.ts` | CREATED (public namespace, 3 methods) |
| `backend/services/teachers/evaluation-rubric.helpers.ts` | CREATED (in-tx pipeline, internal) |
| `backend/services/teachers/evaluation-rubric.service.test.ts` | CREATED (4-tier suite, real DB) |
| `backend/services/teachers/index.ts` | MODIFIED (sibling-pattern `export * from "./evaluation-rubric.service"`) |
| `backend/services/teachers/applicant-lifecycle.service.ts` | MODIFIED (`expandCooldownTemplate` exported — the shared cooldown-copy composer) |

Late lint hardening (all within Task-6 files): helpers kept under the `max-lines` gate (log-denial calls
compacted; `toReadModel` local rename; `finalization.verdict` reused via `verdict`), service/test optional
chains per `prefer-optional-chain`, and the test's foreign-enum injections switched to the repo's cast-free
`Object.assign` hostile-field pattern; the four describe-scope spy/read helpers hoisted to module scope
(`consistent-function-scoping`).

## Quality (sub-loop) evidence — `--lifecycle duplicates`, exit codes

| File | first run | after fixes | final |
| --- | --- | --- | --- |
| `evaluation-rubric.service.ts` | 1 (`prefer-optional-chain`) | 1 (same error surfaced on the then-current line) | **0** |
| `evaluation-rubric.helpers.ts` | 1 (`max-lines` 327 > 300) | 1 (3 × `no-unnecessary-type-conversion` on `String(enum)`) | **0** |
| `evaluation-rubric.service.test.ts` | 1 (7 oxlint warnings: 4 × function-scoping, 3 × type-assertion) | 1 (`sonarjs/different-types-comparison` latent guard) | **0** |

`tsgo` project-wide: **0 errors** (`bun tsgo 2>&1 | grep "error TS" | wc -l` → 0) before and after all fixes.

## Test evidence — `bun run test/scripts/run-test.ts backend/services/teachers/evaluation-rubric.service.test.ts`

Final: **26 pass / 0 fail, 389 expect() calls** (re-run green after every fix round).

Tier coverage (names as run):
- **Tier 1 (rollback pipeline)**: below-quorum commit-alone + sealed read-model; five-80s PASS (teacher row
  minted certified, never an evaluator, in-tx passed copy); FAIL finalization (guarded transition, exact
  tajweed cooldown, no teacher row, fail copy carries the instant); the five pre-DB denials (zero reads, one
  bounded log each); malformed ids; governance; oracle collapse (unknown/foreign/mistyped/prior-cycle → ONE
  denial); completion gate; certification gate; applicant gate; duplicate pre-check (write-once count holds);
  PASS demotion-guard arms (elevate preserves the locked row's evaluator flag / already-approved no-op);
  recipient locale (persisted-locale copy + default fallback); pending sessions (drain, bounds echo,
  oracle-safe empty page, malformed id); own-submission read (hit, unknown/foreign, malformed + corrupt status).
- **Tier 2 (boundary)**: one 79 among 100s FAILS at mean 95.8 (per-evaluation minimum pinned); weakness
  iff-rule both directions; tie-break `{65 tajweed, 65 hifz earlier}` → tajweed 30d; hifz cooldown exact
  now+90d; tajweed 30d exactness.
- **Tier 3 (chaos, committed fixtures)**: concurrent 4th/5th — the applicant lock serializes so EXACTLY one
  finalizes; concurrent duplicate — ONE row + one typed conflict; induced mid-tx abort (rejected in-tx emit)
  — zero rows, no flip, no publish.
- **Tier 4 (security/abuse)**: wrong-evaluator `SESSION_NOT_FOUND`, non-certified teacher, non-`in_evaluation`
  applicant, invalid weakness strings (fail-closed, cast-free injection), non-positive ids.

Semantic spot-checks: no `console.*` in the three files; `notes`/observations never passed to the logger
(only `code`/`entity`/`entityId`); enums imported as values wherever used at runtime.

## Exported service surface (for Task 7 — GraphQL)

`export namespace EvaluationRubricService` re-exported via `backend/services/teachers/index.ts`:

```ts
submitRubricEvaluation(evaluatorUserId: number, sessionId: number,
  input: RubricEvaluationSubmitInput, locale: string, outerTx?: DBTransaction)
: Promise<RubricEvaluationReturnType>

myRubricPendingSessions(callerUserId: number, page: number, pageSize: number,
  locale: string, outerTx?: DBTransaction)
: Promise<SessionPageReturnType>

myRubricEvaluation(callerUserId: number, sessionId: number,
  locale: string, outerTx?: DBTransaction)
: Promise<RubricEvaluationReturnType>
```

Typed denial codes the mutation/queries can surface via `errors[].extensions.code`:
`VALIDATION`, `RUBRIC_SCORE_INVALID`, `RUBRIC_NOTES_REQUIRED`, `RUBRIC_WEAKNESS_REQUIRED`,
`RUBRIC_WEAKNESS_NOT_ALLOWED`, `RUBRIC_WEAKNESS_INVALID` (ValidationError);
`SESSION_NOT_FOUND` (NotFoundError — also the prior-cycle and read-pair denial);
`RUBRIC_SESSION_NOT_COMPLETED`, `TEACHER_NOT_CERTIFIED`, `APPLICANT_NOT_IN_EVALUATION`,
`EVALUATION_ALREADY_SUBMITTED`, `APPLICANT_ALREADY_FINALIZED` (ConflictError);
`APPLICANT_STATUS_CORRUPT` (ValidationError, read path). Governance denials are re-raised unchanged by
`assertActorGovernanceClean`. Error messages always come from `getServerTranslations(locale).errorsTranslations`.

Task-7 integration notes: delegate `ctx.user.id` + `ctx.locale` ONLY; no `ctx.idempotencyKey` machinery;
production mutation calls OMIT `outerTx` (receipt publishing is owned by the service on that path);
`RubricEvaluationReturnType` carries NO notes member; `weaknessArea` is `RubricWeaknessArea | null`
(register via the `SessionTypePothosEnum` pattern).

## Cross-file dependencies

- `expandCooldownTemplate` — now EXPORTED from `applicant-lifecycle.service.ts` (shared composer; consumers:
  purchase guard + this flow's failed-copy interpolation).
- Repos (Tasks 0–5): `EvaluationRepository.insertOnce / findBySessionAndEvaluator / listCycleRubricSubmissions`,
  `SessionRepository.findById / listCompletedRubricPendingSessions / resolveCurrentEvaluationCycle`,
  `ApplicantRepository.findForBookingGate / finalizeOnCertification / transitionToFailed / findByUserId`,
  `TeacherRepository.findForEvaluationGateById / insertColdStartCertified / elevateToCertified`,
  `UserRepository.findById`.
- `withTransaction` (SAVEPOINT semantics on a caller-owned tx), `assertActorGovernanceClean` +
  `isPositiveSafeInteger` (session-lifecycle modules), `isUniqueViolation` (`@/backend/services/shared`),
  `NotificationEngine.emitForUser / publishReceipts`, constants (`RUBRIC_PASS_THRESHOLD`,
  `RUBRIC_NOTES_MAX_LENGTH`, `TAJWEED_COOLDOWN_DAYS=30`, `HIFZ_COOLDOWN_DAYS=90`,
  `VERIFICATION_PLAN_SESSION_COUNT=5`), i18n keys `rubric*` / `applicantStatusCorrupt` /
  `evaluationPassed|Failed*` (Task 3).

## Deferred-items check

No new rows needed. No blocked work discovered; both external modifications observed during verification
(the formatted service buffer and the Task-5 repo surface) were consistent with the plan and are covered by
the passing gates/tests. Nothing deferred from Task 6 to Task 7 beyond the documented integration notes above.
