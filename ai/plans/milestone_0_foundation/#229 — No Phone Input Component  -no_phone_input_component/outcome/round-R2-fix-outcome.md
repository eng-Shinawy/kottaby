# Round R2 fix — docblock wire-reachability corrections (Task: R2-fix)

Plan dir: ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component
Scope: comment-only. Zero behavior change. No git commands run.

## Item 1 [LOW→fix] — user-management.helpers.ts docblocks: wire-reachability corrections
- Finding (re-confirmed in-tree, not taken on faith):
  - `AdminUpdateUserInput.phone` is NULLABLE — `t.string({ required: false })` at backend/graphql/pothos/admin/admin-user.pothos.ts:389.
  - `admin-users.mutation.ts:114` maps `phone: input.phone ?? undefined` → an explicit wire `phone: ""` (or whitespace-only) SURVIVES normalization → `buildUpdatePatch` (helpers.ts:394-396) copies it verbatim → `phonePatchError`'s empty-trim guard (helpers.ts:277: `typeof !== "string" || trim().length === 0` → `null`) skips it → repo `.set({...patch})` stores `''` verbatim. The E.164 gate does NOT fire for empty strings on the update path. The R1 claim "currently unreachable from the GraphQL wire (input types phone non-nullable)" was wrong on both counts.
  - An explicit wire `null` for phone is NOT reachable as null: `?? undefined` normalizes it to absent → key dropped → column left alone. Also `AdminUpdateUserPatchInput.phone` is typed `string`-only (backend/types/admin/admin-user.types.ts:292), so the patch layer cannot even carry a phone `null` — only `dateOfBirth` is `string | null` (types:295, "A `null` value signals 'clear the stored date'").
- Action: rewrote the three docblocks (`phonePatchError`, `validateUpdatePatch`, `buildUpdatePatch`) to state exactly: absent=skip/column untouched; wire `""`/whitespace=REACHABLE, stored verbatim, NOT cleared, gate deliberately skipped (admin-side semantics); wire `null` for phone=normalized to absent; non-empty=E.164-validated. Removed both "currently unreachable from the GraphQL wire" claims (empty-string shape) and no longer claim null writes SQL NULL for phone. The only SQL-NULL statement left is scoped to `dateOfBirth` (the one member typed to carry `null`), matching admin-user.types.ts:288.
- Also aligned ONE sentence in the test file header (backend/services/admin/user-management.helpers.test.ts:11-15) which repeated the forbidden claim "`null` then writes SQL NULL and clears the stored phone" → now states the wire normalizes an explicit `null` to absent. Comment-only; assertions untouched.
- Observation (no action, out of scope): the resolver maps ALL five members with `?? undefined` (admin-users.mutation.ts:113-117), so even `dateOfBirth` wire `null` is normalized to absent through `adminUpdateUser`; the null-clears contract for `dateOfBirth` holds at the service/patch layer (in-process callers) per types:288. Flag for a future review wave if the wire-level nuance matters.

## Item 2 [LOW→verify, then fix docs] — empty-phone wire payload from the edit dialog
- Finding (exact trace): `EditUserFormFields.tsx` sets `form.phone: ""` when the field is cleared (`setForm({...form, phone: e.target.value})`, :76) — form state is `""`. The dialog that owns submission is `EditUserDialog.tsx`; its submit handler maps the patch at :83: `phone: form.phone || undefined` → `"" || undefined` → `undefined` → the `phone` key is OMITTED from the `AdminEditUserPatchInput` handed to `onSubmit` (callers pass it through as mutation `input`). So the wire payload when the user clears the phone field is: **OMITTED** (neither `""` nor `null`). Server-side, absent key → `buildUpdatePatch` skips → `users.phone` column left untouched (NOT cleared, NOT stored as `''`).
- Consequence: the dialog can never produce the wire-`""` shape from Item 1; that shape requires a hand-crafted API call.
- Action: the mandate's omit-branch said "nothing to fix", but the component comment (EditUserFormFields.tsx:50-52) asserted "An empty phone clears the stored number" — factually false under the traced behavior (omitted → stored number untouched). Per Item 2's title ("fix docs if needed") I corrected the COMMENT to the actual behavior (comment-only, no behavior change). Flagging this deviation explicitly for the orchestrator; trivially revertible if the literal omit-branch reading is preferred.

## Item 3 [LOW→fix] — PhoneInput.stories.tsx header docblock overstatement
- Finding: header (~:11-13) claimed stories cover "the React Hook Form spread shape (`name` + change/blur handlers + ref)" — no story carries handlers/ref (Default's args are name/label/fullWidth/startAdornment only).
- Action: reworded to: Default mirrors only the `name`-only member of the `{...register("phone")}` spread; change/blur handlers and ref are not expressible as Storybook args; the controlled `value`/`onChange` mode is demonstrated by `WithValue` and `RtlContext` (via the controlled harness). No stories changed.

## Verification
1. `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → ALL CHECKS PASSED (tsgo + oxlint + biome + lint:type-aware + duplicates) for all three touched files: backend/services/admin/user-management.helpers.ts, frontend/stories/ui/PhoneInput.stories.tsx, frontend/views/admin/users/dialogs/EditUserFormFields.tsx.
2. `bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts` → 28 pass / 0 fail (168 expect calls) — comment-only proof; DB tier still asserts empty-string phone stores verbatim.
3. `rg -n "unreachable from the GraphQL wire|writes SQL NULL" backend/services/admin/user-management.helpers.ts` → 0 matches; same grep on the test file → 0 matches.
4. Plan-artifact hygiene: no plan/task references added to source comments.
