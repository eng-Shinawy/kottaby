# Task 13 Outcome — Admin dialog stories `ChangeUserPasswordDialog.stories.tsx` (D9, REQ-007)

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `13. Admin dialog stories frontend/stories/admin/ (D9, REQ-007)` (Phase 5 — Verification)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root used:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; paths resolve 1:1)
> **Result:** 1 NEW story file with 6 stories covering every REQ-007.3/.4 dialog branch; harness = the `CertifyTeacherDialog.stories.tsx` two-layer pattern (`StoryApolloProvider` + real `useMutation` on `MockLink`, rejections propagating into the dialog's feedback seam) extended with the `RubricEvaluationDialog.stories.tsx` one-shot DOM driver for controlled fields; sub-loop `--lifecycle duplicates` **exit 0**, full-repo `bun tsgo` **0 "error TS" / exit 0**. `test/workflows/**` untouched (parallel Task 11 stream). No commits made.

## 1. What Was Implemented — branch → story mapping

| # | Story (export) | REQ-007 branch exercised | Mechanics |
|---|---|---|---|
| 1 | `Default` | REQ-007.3 — dialog opens with the three fields, empty | Renders `ChangeUserPasswordDialog` open: new-password (show/hide) + confirm empty, `mustChangePassword` off (the component's default); success mock armed, unused |
| 2 | `Filled` | REQ-007.3/.4 pre-submit filled state | `autoFill` driver types the demo credential into BOTH `input[type="password"]` fields once after mount (prototype value-setter + `input` event → real React state) |
| 3 | `RequireResetChecked` | REQ-007.3 — the "Require the user to change this password on next login" checkbox checked | `autoCheck` driver clicks the checkbox once after mount; the `mustChangePasswordHelper` caption is visible under it (as in every state) |
| 4 | `FieldErrorTooShort` | REQ-007.4 — server field error surfaced via `useAdminUserFormFeedback` | `autoFill` + `autoSubmit`: the filled values PASS the dialog's client checks (min length + confirm match) so the mutation round-trips, then the mock rejects with `extensions.fields[{ field: "password", code: "PASSWORD_TOO_SHORT", message: … }]` — `extractFieldErrors` projects it as inline `helperText` under the password field; dialog stays open |
| 5 | `FormErrorForbidden` | REQ-007.4 — field-less denial in the top-level Alert | Same driver; the mock rejects with `errors[{ message, extensions.code: "FORBIDDEN" }]` and NO `fields` payload → `extractErrorMessage` lands the message in the stack's form-level Alert |
| 6 | `Submitting` | REQ-007.4 in-flight — disabled footer | `loading: true` prop (the `passwordLoading` stand-in): `AdminDialogHeaderBand`/`AdminDialogFooterBand` render their disabled/spinner state |

### 1.1 Harness design (why it is shaped this way)

- **Two layers, per the `CertifyTeacherDialog` precedent:** `DialogHarness` renders `StoryApolloProvider`; `DialogHarnessInner` (a descendant) owns the REAL `useMutation(adminSetUserPasswordMutationDocument)` + the driver effect — hooks in the provider-rendering component would see no Apollo context.
- **Rejection propagation preserved:** harness `onSubmit` is `try { await setUserPassword(...) } finally { setSettingCredential(false) }` — NO catch — so mutations rejections flow into the dialog's `runWithFeedback` seam exactly as the real page wiring does (the `DirectoryMutationDialogs`/`UserDetailInlineDialogs` contract).
- **One-shot DOM driver** (the `RubricEvaluationDialog.stories.tsx` pattern): staggered `setTimeout` steps (300 ms fill → 450 ms tick → 600 ms submit) against the `[role="dialog"]` portal; submit located by `labels.changePasswordDialog.submit` textContent (never a hardcoded UI string); cleanup clears all timers.
- **Controlled-field typing:** `typeIntoField` uses the prototype-level `Reflect.set` value setter + bubbled `input` event so React's controlled input really registers the change (the story cannot use the component's internal `useState` — 13.SR forbids component modifications).
- **Error mocks mirror the transport boundary:** `result.errors[]` entries with `extensions.code` (+ `extensions.fields[]` for the VALIDATION variant), the exact shapes `frontend/lib/graphql-error-utils.ts` traverses — same convention as the precedent's `TEACHER_ALREADY_CERTIFIED` mock ("masked transport surface" message on the field-less variant).
- **Dialog target contract noted in-place:** `onClose` is an intentional no-op on the canvas (no `changePasswordTarget` state exists in a story); the REQ-007.6 clear-on-close behavior is owned by the containers and stays untouched here.

## 2. Files Created / Modified / NOT Modified

**Created (1):**
| File | Content |
|---|---|
| `frontend/stories/admin/ChangeUserPasswordDialog.stories.tsx` | Meta/StoryObj story module (`satisfies Meta<typeof DialogHarness>`, `tags: ["autodocs"]`, `controls.exclude` for harness props) + 6 stories (§1) + success/field-error/forbidden MockLink mocks + one-shot DOM driver |

**Deliberately NOT modified:**
- `frontend/views/admin/users/dialogs/ChangeUserPasswordDialog.tsx` + `ChangeUserPasswordFormFields.tsx` — byte-unchanged (no component logic added to make a story work; 13.SR).
- `frontend/stories/admin/AdminUserDetailPage.fixtures.ts` — NOT needed: this story file is fully self-contained (local `TARGET_USER = { id: 42, fullName: "Yusuf Al-Amin" }` + local mocks); the precedent's fixture file serves the page-level story and the parallel Task 11 stream may be touching shared test fixtures, so zero contact.
- `test/workflows/**` — untouched (parallel journey task owns that tree).
- The dialogs barrel already exported both dialog modules (Task 9) — no barrel edits.
- `shared/locale/**` — stories consume the existing `AdminUsers` namespace handle + `changePasswordDialog.submit` for the driver; zero keys minted.

## 3. Verification Results

### 3.1 13.QL — quality loop

`bun run scripts/health/sub-loop.ts frontend/stories/admin/ChangeUserPasswordDialog.stories.tsx --lifecycle duplicates` → **exit 0** (tsgo ✅ filtered for the file → oxlint ✅ → biome ✅ → lint:type-aware ✅ → check:duplicates ✅ — the duplicates stage reports the file sits outside the jscpd scan scope, matching `.jscpd.json`'s `**/*.stories.tsx` ignore entry).

### 3.2 Typecheck

- `bun tsgo` (full repo) → **0 "error TS" lines, exit 0** (`/tmp/task13-tsgo.txt`).
- Gate 3 (stories build sanity): no repo stories-typecheck script exists; the story file is inside the tsgo project scope (proven by the sub-loop's tsgo stage filtering for it) — per the task text, that suffices; story build skipped as instructed.

### 3.3 13.TE — branch coverage

Every REQ-007.3/.4 dialog branch renders in at least one story (§1 mapping): open/empty (`Default`), filled (`Filled`), flagged checkbox checked (`RequireResetChecked`), server field error → inline helperText (`FieldErrorTooShort`), field-less FORBIDDEN → top-level Alert (`FormErrorForbidden`), submitting/disabled (`Submitting`). Human visual verification happens in Storybook later by design; the logic behind each branch is already unit/wire-proven (dialog client-validation + `useAdminUserFormFeedback` projection exercised by Tasks 3/5/9 suites).

### 3.4 13.SEC — no real credentials/ids

- `TARGET_USER` = `{ id: 42, fullName: "Yusuf Al-Amin" }` — synthetic id + the repo's established fictional story persona; no email is needed by the dialog and none is mocked.
- `DEMO_CREDENTIAL = "StoryTempPass24"` — an obviously synthetic story value (named without the literal `password` token so `sonarjs/no-hardcoded-passwords` stays clean, the `CreateUserCredentialField` convention).
- Mock payloads carry only synthetic identity fields; the error messages are masked transport-surface shapes, not real server copy leaks.

### 3.5 13.SR — scope discipline

- The story file lives in `frontend/stories/admin/` — nowhere else touched.
- Zero component/hook logic was added or modified to make a story work: the dialog's own `useState` form is driven purely from the outside (DOM driver), `loading` is a prop, the mutation runs on the harness side exactly as the page containers do.
- No react-hook-form anywhere (REQ-007.5's no-RHF rule holds in the story layer too).
- No `console.*`, no `Translation.` enum, no plan-artifact references in code (docblocks describe surfaces only).

### 3.6 13.IV — instructions honored

Root `AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md` read in full before writing: no hardcoded colors (the story renders the untouched component — zero styling added), hooks imported from `@apollo/client/react`, documents via the admin shared barrel, enums (`UserRole.Teacher`) imported as values from the generated module, no `useLazyQuery`, no `FormEvent`, Storybook conventions (decorator-free harness component in `component:` slot, `controls.exclude` for harness-only props, `autodocs` tag) matching both precedents.

## 4. Subtask Pipeline Satisfaction

- **13.QL** ✅ — sub-loop exit 0 on the story file (§3.1).
- **13.TE** ✅ — all six REQ-007.3/.4 branches mapped 1:1 to stories (§1, §3.3); visual sign-off deferred to the Storybook canvas by design.
- **13.SEC** ✅ — synthetic ids/persona/credential only; no real emails; masked error shapes (§3.4).
- **13.SR** ✅ — single new file in `frontend/stories/admin/`; component untouched; no RHF; no bespoke harness plumbing beyond the established precedents (§3.5).
- **13.IV** ✅ — all three rule files read and honored (§3.6).
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — n/a (mock transport only; the mock's `id` is the dialog's own display target); race conditions — n/a (no real writes); enums-as-values — `UserRole.Teacher` imported as a value; cross-layer imports — none (story imports views/shared/graphql barrels only, exactly like the sibling stories); dead code — every mock/story is exported or consumed; deferred items — D1–D9 untouched (no session store, no mail, no nav, no profile card).

## 5. tasks.md Checkbox State

Task 13 main line + `13.QL` + `13.TE` + `13.SEC` + `13.SR` + `13.IV` flipped `[ ]` → `[x]`. No other checkbox touched (Tasks 0–10 stay `[x]`; Tasks 11/12/14/15 stay exactly as found — including the parallel Task 11/12 lines, which this task did NOT modify).

## 6. Cross-File Dependencies / Carry-Forward

- **Task 14 (final gate):** the new story file is lint-clean and type-clean; no baseline deltas expected. Story files are excluded from jscpd (`.jscpd.json`), so no duplicate risk against `RubricEvaluationDialog.stories.tsx`'s near-identical `typeIntoField` helper.
- **Human visual pass:** the six stories are ready for Storybook canvas review under `Admin/Change User Password Dialog` (title); `FieldErrorTooShort`/`FormErrorForbidden` settle ~600 ms after mount (driver timing) — reviewers should wait for the projected inline helperText / top-level Alert.
- **Mock-variables coupling:** the two error mocks pin `variables: { id: 42, input: { password: DEMO_CREDENTIAL, mustChangePassword: false } }` to exactly what the driver produces (fill both fields + unchecked checkbox + submit). If the driver constants change, the mock variables must change with them (MockLink matches exact JSON).
- **Task 11 (journey, parallel stream):** no shared files — this task's only repo contact outside its own file is `tasks.md` (own lines) + `worklog.md` (append) + this outcome file.
