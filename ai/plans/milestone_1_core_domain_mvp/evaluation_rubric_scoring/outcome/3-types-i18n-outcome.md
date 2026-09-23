# Task 3 Outcome — Backend types + i18n keys (errors, applicant, sessions) + error-map rows

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Task:** 3 — Backend types + i18n keys + error-map rows (Phase 2 — Backend Foundation)
**Date:** 2026-09-21 · **Repo root:** `/home/z/my-project` (branch `main`; working tree also carries the uncommitted Task 2 delta — the orchestrator owns commits)
**Pre-execution reads:** `tasks.md` (full), `plan.md` (full, incl. §4.1, §5.3, §6.2, §12), `specs.md` (REQ-0.5, REQ-9.1, REQ-10 + adjacent), ALL outcome files (`0-baseline-outcome.md`, `0-baseline-verified-outcome.md`, `plan-review-R1.md`, `2-schema-outcome.md`), `deferred-items.md`, plus layer rules: `backend/AGENTS.md`, `backend/types/AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`, and (printed by the sub-loop at edit time) `.agents/instructions/frontend.instructions.md`.

---

## Summary

All four rubric types landed appended to the canonical evaluation type module (canonical `EvaluationReturnType`/`EvaluationSubmitInput` untouched — the Task 2 one-token Omit ripple remains the only prior edit to that file). The full i18n triple-leaf contract landed for 21 new keys across three namespaces — 7 `errors` denials, 4 `applicant` outcome-notification keys, 10 `sessions` dialog keys — each with type leaf + en + ar + parity-test extension IN THIS TASK. The Apollo error map gained exactly one row per new machine code (7 rows), following the dedicated-copy row pattern of the existing evaluation rows.

`bun tsgo` full-tree after all edits: **0 `error TS` lines** (baseline parity). `bun biome:check` warn count: **0** (baseline parity).

---

## Type surface (`backend/types/teachers/evaluation.types.ts` — appended)

| Type | Shape | Notes |
|---|---|---|
| `RubricEvaluationSubmitInput` | `{ score: number; notes: string; weaknessArea: RubricWeaknessArea \| null }` (all `readonly`) | The sealed client input; the iff-threshold rule documented on the type |
| `RubricSubmissionInsertInput` | the above + `evaluatedId`, `evaluatorId`, `sessionId` (all `readonly`) | Sealed server-assembled payload — evaluated/evaluator/session resolved server-side, never spread from client input |
| `RubricCycleSubmissionRow` | `{ id, sessionId, evaluatorId, score, weaknessArea, createdAt }` | Quorum-read projection (≤5 rows by the credit ceiling) |
| `RubricEvaluationReturnType` | read-model incl. `applicantStatus: ApplicantStatus`, deliberately NO `notes` | Notes stay server-side; visibility beyond the writing evaluator is a future administrative surface |

Enum imports in this file are **type-only** (`import type { ApplicantStatus }` / `import type { RubricWeaknessArea }` from the deep `@/backend/enum/teachers/*.enum` paths) — the file contains no runtime expressions, matching the existing types-layer convention (`applicant.types.ts:8` precedent). The value-import obligation stays with the runtime consumers (Task 4 repos / Task 6 service, per the Task 2 outcome note). No barrels changed (the teachers types barrel already re-exports the module).

## i18n keys added (exact handles — carry-forward for Tasks 6 / 7 / 10 / 11)

**`errors` namespace** (all flat strings, ZERO placeholders; bijection per plan §5.3):

| Machine code | Key (en copy) | ar copy |
|---|---|---|
| `RUBRIC_SCORE_INVALID` | `rubricScoreInvalid` — "Score must be a whole number from 0 to 100." | «يجب أن تكون الدرجة رقماً صحيحاً بين 0 و100.» |
| `RUBRIC_NOTES_REQUIRED` | `rubricNotesRequired` — "Observations are required (up to 2000 characters)." | «الملاحظات مطلوبة (حتى 2000 حرف).» |
| `RUBRIC_WEAKNESS_REQUIRED` | `rubricWeaknessRequired` — "A weakness area is required for a score below 80." | «مجال الضعف مطلوب للدرجة الأقل من 80.» |
| `RUBRIC_WEAKNESS_NOT_ALLOWED` | `rubricWeaknessNotAllowed` — "A weakness area applies only to scores below 80." | «مجال الضعف مخصص للدرجات الأقل من 80 فقط.» |
| `RUBRIC_WEAKNESS_INVALID` | `rubricWeaknessInvalid` — "The weakness area must be Tajweed or Hifz." | «يجب أن يكون مجال الضعف إما التجويد أو الحفظ.» |
| `RUBRIC_SESSION_NOT_COMPLETED` | `rubricSessionNotCompleted` — "This evaluation session is not completed yet." | «جلسة التقييم هذه لم تكتمل بعد.» |
| `APPLICANT_ALREADY_FINALIZED` | `applicantAlreadyFinalized` — "The application was already finalized." | «تم إصدار القرار النهائي لهذا الطلب بالفعل.» |

Placed directly after `verificationSubscriptionNotActive` (the rubric-adjacent block that ends the `ErrorsLabels` interface) in `shared/locale/types/errors/labels.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts`.

**`applicant` namespace** (notification copy composed server-side in the recipient's locale — Task 6):

| Key | Value shape | en | ar |
|---|---|---|---|
| `evaluationPassedTitle` | string, no placeholders | "You are a certified teacher" | «لقد أصبحت معلماً معتمداً» |
| `evaluationPassedBody` | string, no placeholders | "You passed all 5 evaluation sessions. Your teacher record is active." | «لقد نجحت في جميع جلسات التقييم الخمس، وسجل المعلم الخاص بك مُفعّل الآن.» |
| `evaluationFailedTitle` | string, no placeholders | "Evaluation result" | «نتيجة التقييم» |
| `evaluationFailedBody` | string with the SINGLE ICU placeholder `{cooldownUntil}` | "You can re-apply after {cooldownUntil}." | «يمكنك إعادة التقديم بعد {cooldownUntil}.» |

Shape ruling (plan §6.2 ambiguity resolved): the plan's row reads "function: `(cooldownUntil) => …`" while its example copy is the ICU form. The **ICU-string form** was implemented because (a) it is byte-identical in shape to the two sibling cooldown surfaces (`errors.applicantCooldownActive`, `applicant.cooldownExpiryLine`), (b) the repo's only server-side expansion seam is the typed `replace("{cooldownUntil}", <locale-formatted stamp>)` posture (`applicant-lifecycle.service.ts` `expandCooldownTemplate`), which Task 6 can reuse verbatim, and (c) the parity tooling pins ICU placeholder name + single occurrence in both locales. Consumers: pass the formatted stamp per the recipient locale; the placeholder NAME `cooldownUntil` is pinned identical ar/en.

**`sessions` namespace** (evaluator rubric dialog — Task 11; all flat strings, no placeholders):

`submitEvaluationAction` ("Submit evaluation" / «إرسال التقييم»), `rubricDialogTitle` ("Evaluation rubric" / «استمارة التقييم»), `rubricScoreLabel` ("Score (0-100)" / «الدرجة (٠-١٠٠)»), `rubricNotesLabel` ("Observations" / «الملاحظات»), `rubricWeaknessLabel` ("Primary weakness area" / «مجال الضعف الرئيسي»), `rubricWeaknessTajweed` ("Tajweed" / «التجويد»), `rubricWeaknessHifz` ("Hifz" / «الحفظ»), `rubricWeaknessHelper` ("Shown for scores below 80 — the area drives the re-apply cooldown." / «يظهر للدرجات الأقل من ٨٠ — ويحدد مجال الضعف مدة الانتظار قبل إعادة التقديم.»), `rubricSubmitCta` ("Submit evaluation" / «إرسال التقييم»), `rubricSubmittedSuccess` ("Evaluation submitted." / «تم إرسال التقييم.»).

Placed after `surahJuzLabel` under a dedicated section comment in `shared/locale/types/sessions/labels.ts`, `shared/locale/en/sessions/labels.ts`, `shared/locale/ar/sessions/labels.ts`. No namespace registration/bundle changes were needed (all three namespaces already registered; barrels re-export the touched leaf files).

## Error-map rows (`frontend/providers/apollo/error-link.map.ts`)

One row per new code, dedicated copy (never the generic `validation`/`conflict` copy), via a lookup-table + `mapRubricEvaluationRow` resolver slotted into the dispatch chain before the masked-internal row; the resolver's dispatch-table JSDoc gained the 7 rows:

- `RUBRIC_SCORE_INVALID` / `RUBRIC_NOTES_REQUIRED` / `RUBRIC_WEAKNESS_REQUIRED` / `RUBRIC_WEAKNESS_NOT_ALLOWED` / `RUBRIC_WEAKNESS_INVALID` → `kind: "toast"` (error tone, non-retryable) — mutation-channel treatment for the pre-DB validation denials; the submitting dialog stays open for retry (plan §6 dialog behavior).
- `RUBRIC_SESSION_NOT_COMPLETED` / `APPLICANT_ALREADY_FINALIZED` → `kind: "notice"`, `noticeKind: "conflict"` (error tone) — mirrors the `EVALUATION_SESSION_NOT_COMPLETED` / `EVALUATION_ALREADY_SUBMITTED` sibling rows exactly.

Row kinds are a documented interpretation: plan §6 prose calls all denials "localized toasts", but the map's established semantics distinguish toast vs notice; the conflict codes follow their existing siblings. Lookup tables are typed `Record<string, ErrorMessageKey | undefined>` (explicit-undefined value type — keeps the miss check type-honest and satisfies `sonarjs/different-types-comparison`, which rejected `!== undefined` against the bare value type on the first sub-loop pass).

---

## Files Modified

| File | Change | Sub-loop exit (tsgo/oxlint/biome/lint:duplicates) |
|---|---|---|
| `backend/types/teachers/evaluation.types.ts` | + 2 type-only enum imports + 4 appended interfaces | **0** (rules: backend.instructions.md, AGENTS.md, backend/types/AGENTS.md, backend/AGENTS.md) |
| `shared/locale/types/errors/labels.ts` | + 7 key leaves + docblocks (after `verificationSubscriptionNotActive`) | **0** (rules: AGENTS.md; shared rule files absorbed pre-edit) |
| `shared/locale/en/errors/index.ts` | + 7 en values | **0** |
| `shared/locale/ar/errors/index.ts` | + 7 ar values | **0** |
| `shared/locale/types/applicant/index.ts` | + 4 key leaves + docblocks | **0** |
| `shared/locale/en/applicant/index.ts` | + 4 en values | **0** |
| `shared/locale/ar/applicant/index.ts` | + 4 ar values | **0** |
| `shared/locale/types/sessions/labels.ts` | + 10 key leaves + docblocks (rubric-dialog section) | **0** |
| `shared/locale/en/sessions/labels.ts` | + 10 en values | **0** |
| `shared/locale/ar/sessions/labels.ts` | + 10 ar values | **0** |
| `shared/locale/errors-namespace.parity.test.ts` | + rubric-scoring pinned inventory (exhaustive pin over `rubric*` + `applicantAlreadyFinalized`, non-empty both locales, zero-ICU-placeholder pin); applicant-lifecycle exhaustive pin now excludes the rubric-pinned key (the booking-key exclusion pattern); header item 6 | **0** |
| `shared/locale/applicant-namespace.parity.test.ts` | + evaluation-outcome notification pins (4 keys non-empty both locales; 3 flat keys placeholder-free; `evaluationFailedBody` exactly one `{cooldownUntil}`, name + occurrence + order pinned); header item 6 | **0** |
| `shared/locale/sessions-namespace.parity.test.ts` | + 10 keys in `MANDATED_SESSIONS_KEYS`; + dedicated rubric-dialog describe (non-empty, zero placeholders, distinct weakness options); + `rubricSubmittedSuccess` sync-resolution sample; + 2 Arabic-script sample keys; header item 6 | **0** |
| `frontend/providers/apollo/error-link.map.ts` | + 7 code rows (2 lookup tables + `mapRubricEvaluationRow`) + dispatch-chain + JSDoc table rows | **0** (after fixing the two `sonarjs/different-types-comparison` errors; rules: frontend.instructions.md, AGENTS.md, frontend/AGENTS.md) |
| `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/tasks.md` | Task 3 checkbox flipped | n/a — plan artifact |

## Files NOT Modified (scope guard)

No repos, services, GraphQL (Pothos/mutation/query/enum registration — Tasks 6/7), enums, schema, seeds, documents (`sharedDocuments` — Task 10), views/stories (Task 11), `app/` routes, AGENTS.md, or `.agents/instructions/*` touched. No new namespace/bundle/registry files (none required). Task 2's working-tree files (`backend/db/schema/enums.ts`, `backend/db/schema/teachers/evaluations.ts`, `backend/enum/teachers/index.ts`, `shared/constants/index.ts`, `db/schema.dbml`) were left exactly as Task 2 left them.

## Test Evidence (mandated runner only — raw `bun test` never used)

| Command | Result |
|---|---|
| `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` | exit **0** — **48 pass, 0 fail**, 372 expect() calls (incl. the 9 new rubric assertions: exhaustive pin + 7 key pins + placeholder-free pin) |
| `bun run test/scripts/run-test.ts shared/locale/applicant-namespace.parity.test.ts` | exit **0** — **34 pass, 0 fail**, 365 expect() calls (incl. the 6 new outcome-notification assertions) |
| `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts` | exit **0** — **38 pass, 0 fail**, 1848 expect() calls (incl. the 12 new rubric-dialog assertions) |
| `bun run test/scripts/run-test.ts frontend/providers/apollo/error-link.map.test.ts` (regression on the map's paired suite) | exit **0** — 31 pass, 0 fail (existing rows unaffected; new rows exercised behaviorally by the Task 7/11 consumers) |
| `bun run test/scripts/run-test.ts backend/types/teachers/evaluation-booking.types.static-assertions.test.ts` (regression: the directory's source-scan pin suite) | exit **0** — 8 pass, 0 fail |
| `bun tsgo 2>&1 \| grep -c "error TS"` | **0** (baseline parity) |
| `bun biome:check 2>&1 \| grep -c "warn"` | **0** (baseline parity) |

Sub-loop failures encountered and fixed in-task: the first `error-link.map.ts` pass failed `lint:type-aware` with 2 × `sonarjs/different-types-comparison` (`!== undefined` against a non-optional indexed value) — fixed by typing the row tables `Record<string, ErrorMessageKey | undefined>`; re-run exit 0. All other files passed first pass.

## Security (SEC — this task's posture)

Compile-time copy only; no runtime data path was added. Confirmed: **no free-text `notes` value can enter any log key or message through this task's diff** — the new locale copy speaks ABOUT observations but never interpolates content (zero ICU placeholders across all 7 `errors` keys and all 10 `sessions` keys, pinned by tests); `RubricEvaluationReturnType` deliberately omits `notes` (the read-model posture); the error-map actions carry key handles + tone only (no score/notes/identifier fields). No `console.*` in any touched file.

## Semantic Self-Review (all items)

- **No hardcoded UI strings:** all 21 keys are locale leaves; the error map references `ErrorMessageKey` handles only; tests resolve copy through the locale maps (no literal copy asserted except as test data references to the maps themselves).
- **No two-arg `getTranslations`, no `Translation` enum, no `next-intl`:** grep across all touched files → zero matches; the errors parity suite's own import-hygiene pin over `route.ts` stays green.
- **Enums as value imports where runtime:** this task added no runtime enum expressions; both enum imports in the types file are type-only (documented above — the runtime value-import obligation belongs to Tasks 4/6 consumers).
- **No cross-layer imports:** shared files import only `@/shared/locale/**`; `backend/types` imports only `@/backend/**`; `frontend/providers` imports `@/shared/locale/types` (allowed direction) — zero new layer violations.
- **No plan-artifact references in code comments/JSDoc:** grep for `REQ-|DEV2-|Task \d|plan.md|tasks.md|specs.md` across all touched files → zero matches; docblocks describe domain behavior (error codes, thresholds, write-once/posture facts) only.
- **No trivial comments; no dead branches; no `console.*`:** verified per file; the only lookup miss-branches are the map's intentional fall-through-to-null rows (existing contract).
- **Scope:** `git diff --name-only` matches the table above (plus Task 2's pre-existing uncommitted files and the checkbox flip); no file outside Task 3's mandate was touched.

## Cross-File Dependencies & Carry-Forward for Later Tasks

1. **Task 6 (service)** — consumes: `getServerTranslations(locale).applicantTranslations` → `evaluationPassedTitle` / `evaluationPassedBody` / `evaluationFailedTitle` / `evaluationFailedBody` (expand `{cooldownUntil}` via the typed-replacement cooldown seam with a locale-formatted stamp — placeholder NAME pinned `cooldownUntil`); `getServerTranslations(locale).errorsTranslations` → the 7 new keys for the typed `ValidationError`/`ConflictError` messages; the 4 new types from `@/backend/types` (`RubricEvaluationSubmitInput` sealed input, `RubricSubmissionInsertInput` sealed insert, `RubricCycleSubmissionRow[]` quorum rows, `RubricEvaluationReturnType` return — `applicantStatus: ApplicantStatus` member included).
2. **Task 7 (GraphQL)** — Pothos input/object back the same 4 types (no local types); `extensions.code` values `RUBRIC_*` + `APPLICANT_ALREADY_FINALIZED` now have bijjective `errors` keys and frontend map rows, so GraphQL-suite assertions can pin `errors[].extensions.code` ↔ localized message round-trips.
3. **Task 11 (evaluator UI)** — dialog copy from `useAppTranslation(Sessions)` handles: `submitEvaluationAction`, `rubricDialogTitle`, `rubricScoreLabel`, `rubricNotesLabel`, `rubricWeaknessLabel`, `rubricWeaknessTajweed`, `rubricWeaknessHifz`, `rubricWeaknessHelper`, `rubricSubmitCta`, `rubricSubmittedSuccess`; typed-denial toasts/notices flow through the 7 new error-map rows automatically (no additional frontend wiring needed).
4. **Task 14 (docs)** — the 7 code↔key pairs belong in `docs/graphql/domain-error-extensions-code.md`.
5. **Parity-test extension points** — future `errors` keys must respect the new exhaustive pin (`rubric*` + `applicantAlreadyFinalized` ↔ `EVALUATION_RUBRIC_SCORING_KEYS`); `applicantAlreadyFinalized` is intentionally pinned in the RUBRIC inventory and excluded from the applicant-lifecycle inventory (a key may live in exactly one inventory).

## Deferred-Items Check

No new deferred work discovered — the ledger stays at D1–D4 (all cross-ticket, all `Blocked`, all with target-ticket pointers). Nothing in this task's scope (types + copy + map rows) produced deferred behavior; no row added.

## Verification Line (task-scoped)

`15 REQ targets tracked for the plan · this task verified REQ-0.5 + REQ-9.1 (keys) + REQ-10 (code↔key bijection) · BUN cmd(s) that passed: sub-loop × 14 files (all exit 0); bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts (48 pass); …/applicant-namespace.parity.test.ts (34 pass); …/sessions-namespace.parity.test.ts (38 pass); …/frontend/providers/apollo/error-link.map.test.ts (31 pass, regression); …/backend/types/teachers/evaluation-booking.types.static-assertions.test.ts (8 pass, regression); bun tsgo (0 errors); bun biome:check (0 warns) · requirements deferred (IDs): none new (D1–D4 unchanged)`
