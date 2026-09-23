# Task 11 — Evaluator UI (row action + dialog + hook + wiring + Storybook) — Outcome

## Summary

The evaluator's rubric-scoring surface is complete and verified. A completed
evaluation row that still owes a submission offers the **submit-evaluation**
CTA (gated by the stateful `myRubricPendingSessions` pending read — never
`useLazyQuery`), which opens the `RubricEvaluationDialog` mounted **keyed by
session id** beside the report dialog (the closed dialog leaves the tree, so
every open starts from a pristine draft). The dialog composes the
score / notes / weakness trio from `RubricEvaluationDialog.parts.tsx`, resolves
its draft (validation, iff-rule weakness reveal below `RUBRIC_PASS_THRESHOLD`,
forced weakness reset out of the band) through the pure helpers in
`rubricEvaluationDialog.helpers.ts`, and submits through the sealed wire
contract (`sessionId` + score/notes/weakness only — no client-supplied
identities) via `useRubricEvaluation`.

Outcome lanes: success → pending read refetched (the scored row loses its
affordance), localized success snackbar through the container's notice lane,
dialog closes; typed denials → the single error-mapping table
(`error-link.map.ts`) toasts app-scope, the normalized code is surfaced as the
submit outcome, and the dialog STAYS OPEN with the draft intact for in-place
retry. Submission is gated while on the wire (`React.SubmitEvent`, dismissal
gated, no `FormEvent`). All copy resolves through compile-time i18n handles
(`Sessions`/`Errors` property access); MUI v9 discipline held (`sx`-only,
theme-palette callbacks, `*Outlined` icon, `aria-invalid` mirrored on fields).

## Files created

- `frontend/views/teacher/sessions/RubricEvaluationDialog.tsx` — the evaluator dialog (submit form, iff-rule weakness band, dismissal gating)
- `frontend/views/teacher/sessions/RubricEvaluationDialog.parts.tsx` — `RubricScoreField` / `RubricNotesField` / `RubricWeaknessField` presentational controls (`aria-invalid`, helper-tone rules)
- `frontend/views/teacher/sessions/TeacherRubricDialogMount.tsx` — report-dialog-pattern mount keyed by session id
- `frontend/views/teacher/sessions/rubricEvaluationDialog.helpers.ts` — pure draft resolution (`parseRubricScore`, `resolveRubricDraft`)
- `frontend/views/teacher/sessions/useRubricEvaluation.ts` — pending-read + submit-mutation arms (`pendingSessionIds`, `submitEvaluation`, `submitting`)
- `frontend/graphql/sharedDocuments/teachers/evaluation-rubric.documents.ts` — `myRubricPendingSessions` / `submitRubricEvaluation` shared documents
- `frontend/graphql/test/teachers/evaluation-rubric.documents.test.ts` — document tests
- `frontend/stories/teachers/RubricEvaluationDialog.stories.tsx` — mock-driven Storybook coverage

## Files modified

- `frontend/views/teacher/sessions/TeacherSessionsContainer.tsx` — rubric dialog state + mount slot + `onSubmitEvaluation` wiring; query variables extracted to module scope (per-function line budget)
- `frontend/views/teacher/sessions/useTeacherLifecycleMutations.ts` — composes `useRubricEvaluation` arms
- `frontend/views/teacher/sessions/TeacherSessionsBody.tsx` — passes the rubric affordance/CTA through to the shared row
- `frontend/views/teacher/sessions/teacherSessionCacheArms.ts` — `teacherActionsForSession` gains the `submitEvaluation` affordance (pending-set + type gate, stable order Report-first)
- `frontend/views/teacher/sessions/teacherSessionCacheArms.test.ts` — rubric affordance gate tests (19 pass / 0 fail)
- `frontend/views/student/sessions/sessionRowAction.ts` — action-id union extends with `submitEvaluation`
- `frontend/graphql/sharedDocuments/teachers/index.ts` — barrel export for the new documents
- `frontend/graphql/generated/gql/graphql.ts` — regenerated codegen

## Files verified UNTOUCHED

- `frontend/views/teacher/sessions/navItems.ts` — not in `git diff --name-only`
- `frontend/app/(dashboard)/teacher/sessions/page.tsx` — not in `git diff --name-only`

(ZERO routes/nav changes — the task's no-route constraint holds.)

## Verification evidence

- **tsgo**: `bun tsgo 2>&1 | grep "error TS" | wc -l` → **0** (re-run after all fixes)
- **Quality sub-loop** (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`) → exit 0 for all 12 Task-11 files:
  `RubricEvaluationDialog.tsx`, `RubricEvaluationDialog.parts.tsx`,
  `TeacherRubricDialogMount.tsx`, `rubricEvaluationDialog.helpers.ts`,
  `useRubricEvaluation.ts`, `teacherSessionCacheArms.ts`,
  `teacherSessionCacheArms.test.ts`, `TeacherSessionsContainer.tsx`,
  `useTeacherLifecycleMutations.ts`, `TeacherSessionsBody.tsx`,
  `sessionRowAction.ts`, `RubricEvaluationDialog.stories.tsx`
  - Fixes made during the loop: merged duplicate `react` imports into
    `import { type ReactNode, … } from "react"` in the dialog + parts
    (`import-x/no-duplicates`); extracted `teacherSessionsQueryVariables` to
    module scope in the container (`max-lines-per-function` 104→100 budget);
    block-bodied the `clearTimeout` cleanup callback in the stories
    (`useIterableCallbackReturn`).
- **Arms test**: `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/teacherSessionCacheArms.test.ts` → **19 pass / 0 fail** (49 expect calls), including the stable-order rubric affordance gate and the compile-time label-identity test
- **Semantic greps** (dialog/parts/mount/helpers/hook/stories + arms/mutations/body/container):
  - `useLazyQuery` → 0 usages (only the docblock note that it is banned)
  - `console.*` → 0
  - non-`sx` MUI style props (`style={{`/`style="`) → 0
  - `aria-invalid` → present (3× in the parts fields)
  - hardcoded JSX text / `t('key')`-style calls in the dialog family → 0 (only `Sessions.*`/`Errors.*` property-access handles)
  - plan-artifact references in comments → 0

## Story state inventory (`Teachers/RubricEvaluationDialog`)

| Story | State | Coverage |
|---|---|---|
| `Pristine` | pristine draft | empty score; weakness select hidden; open-from-mock path |
| `PassingDraft` | passing draft | score 85 (≥ threshold) → weakness select stays hidden |
| `FailingDraft` | failing draft | score 79 (< threshold) → required weakness select revealed |
| `TypedDenial` | typed denial | submit → denial mock; mapped toast app-scope; dialog stays open with draft intact |
| `SubmissionSuccess` | settled success | submit → success mock; pending read refetched; success snackbar; dialog closes |

## Carry-forward

- The submit payload contract is sealed: only `sessionId` + score/notes/weakness. Any future evaluator-identity or applicant-identity field belongs to the server layer, never this input.
- The pending read is always-on and stateful by design (row-affordance gate); do not convert to lazy/dialog-scoped fetching.
- Denial UX relies on every typed `extensions.code` of this flow having an `error-link.map.ts` row; new denial codes must be added there, not remapped locally.
- The affordance order contract (`['report', 'submitEvaluation']`, Report first) is pinned by the arms test — preserve it when extending actions.

## Cross-file dependencies

- `sessionRowAction.ts` action-id union ⊂ `teacherSessionCacheArms.ts` matrix ⊂ `TeacherSessionsBody.tsx` handler props ⊂ `TeacherSessionsContainer.tsx` wiring — extending the union requires all four.
- `RubricEvaluationDialog.tsx` ↔ `RubricEvaluationDialog.parts.tsx` (controls), `rubricEvaluationDialog.helpers.ts` (draft), `TeacherRubricDialogMount.tsx` (keyed mount), `useRubricEvaluation.ts` (arms through `useTeacherLifecycleMutations.ts`).
- `RUBRIC_PASS_THRESHOLD` / `RUBRIC_NOTES_MAX_LENGTH` come from `@/shared/constants`; the iff-rule band must stay in sync with the server's pass decision.
- `evaluation-rubric.documents.ts` ↔ codegen `graphql.ts` (regenerated; keep in sync after schema edits).

## Deferred check

- Storybook visual review of the five stories in a running Storybook instance was not performed in this headless verification (mock-driven renders compile and lint clean; interactive behavior is exercised by the arms tests + typed lanes). Recommend a human pass over `Teachers/RubricEvaluationDialog` stories in the next manual QA window.
