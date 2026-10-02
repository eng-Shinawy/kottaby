# Task 12 — Outcome: Admin edit-user dialog integration (COMPLETED)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 12 — Admin edit-user dialog integration — `frontend/views/admin/users/dialogs/EditUserFormFields.tsx` (REQ-3.3, REQ-3.5, REQ-9.1, REQ-9.2)
> **Date:** 2026-09-30 · **Pipeline:** 12.QL → 12.TE → 12.SEC → 12.SR → 12.IV — all executed, all pass · **Code change: ONE file** · **Checkbox: flipped**
> **Workspace:** linked worktree `/home/z/feat-wt` pinned to `feat/no-phone-input-component` @ `5111b928` (clean at window start except two in-flight concurrent-agent files, §2).

## 1. Summary

Replaced the edit dialog's raw phone `TextField` with the shared `PhoneInput` component in
**controlled mode** (this surface is NOT react-hook-form — no `useForm`/`register`/`validate`
introduced) and computed the client format rule from the shared predicate:

- **Imports added (2):** `import { PhoneInput } from "@/frontend/components/ui/PhoneInput";`
  (deep import, Task 8) and `import { isValidPhone } from "@/shared/lib/phone";` (shared
  predicate — the frontend's advisory copy of the server rule; server remains authoritative per
  REQ-9.1). Biome-ordered; no other import touched.
- **Computed client rule (3 consts, after the existing `useAppLocale()` line):**
  `phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone)` →
  `phoneError = Boolean(fieldErrors.phone) || phoneClientError` →
  `phoneErrorText = fieldErrors.phone ?? (phoneClientError ? labels.editDialog.phoneInvalid : " ")`.
  The message is the EXISTING `AdminUsers` key `labels.editDialog.phoneInvalid` (Task 3 artifact:
  `shared/locale/types/adminUsers/index.ts:291`, en `:137` / ar `:133`) — no hook, no invented key,
  no hardcoded copy. The `" "` fallback reserves the helper line.
- **Phone block swapped:** raw `TextField` (was `:65-74`) → `<PhoneInput id={EDIT_PHONE_ID}
  value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
  error={phoneError} helperText={phoneErrorText} aria-invalid={phoneError} />`. The inline
  `slotProps={{ htmlInput: { dir: "ltr" } }}` was REMOVED (the component supplies it internally,
  REQ-2.2) and `fullWidth` was dropped (component default `true`). The external
  `AdminDialogFieldLabel` row (was `:64`) is KEPT untouched — hence `id={EDIT_PHONE_ID}` is
  retained on the field so the label's `htmlFor` keeps pairing (the controlled-mode idiom
  documented in `outcome/8-outcome.md` §5 includes the `id`; this is also the plan-review M-1 fix).
- **Patch semantics preserved:** no `required` flag was added and empty is never flagged — the
  client rule fires only on a non-empty-but-invalid value. An empty phone in this dialog means
  "clear the stored phone" (server treats empty as clear — the update guard is
  `typeof patch.phone === "string"` in `user-management.helpers.ts:286`; the dialog itself
  submits `phone: form.phone || undefined` so empty is omitted from the patch). The server
  `updateUser` `fieldErrors.phone` projection stays AUTHORITATIVE: it wins over the client hint
  (`??` precedence) and reaches the UI verbatim through the unchanged
  `useAdminUserFormFeedback` → `fieldErrors` prop pipeline (`frontend/lib/mutationFieldErrors.ts`).
- `fullName` / `country` / `dateOfBirth` TextFields, the `useAppLocale()` line (still consumed by
  the date field's `lang`), the doc comment, the `EditUserFormState` export, and the props
  interface are untouched. No barrel, no new file, no new dependency.

## 2. Files modified

| File | Action |
|---|---|
| `frontend/views/admin/users/dialogs/EditUserFormFields.tsx` | **EDITED** — +2 import lines, +6 computed lines (comment + 3 consts), phone block −10/+7 (raw TextField → PhoneInput). Sole code artifact. |
| everything else | NOT touched |

Concurrent-agent note: `git status --porcelain` during this window also showed
`frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx` (Task 11's file, edited by the
concurrent Task 11 subagent) and
`frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` (Task 13) as
modified. Those are NOT Task 12's changes and were left untouched (Fix-Or-Report rule). The
scoped type gate (§3.1) was run against Task 12's file only.

## 3. Verification results (pipeline)

### 12.QL — Quality Loop: **exit 0, all five stages**

```
bun run scripts/health/sub-loop.ts frontend/views/admin/users/dialogs/EditUserFormFields.tsx --lifecycle duplicates
✅ tsgo passed (project-wide run filtered for the file)
✅ oxlint passed
✅ biome:check passed
✅ lint:type-aware passed (in-process service)
✅ check:duplicates passed (intra-file jscpd)
→ exit 0
```

**Honesty note (A2 recurrence):** three tsgo OOM kills were recorded in-window (`dmesg`:
`Out of memory: Killed process … (tsgo) … anon-rss:~2.9GB` at uptime 7210/7248/7288 s) while
CONCURRENT wave-3 sub-loops were running (a live `ps` showed Task 13's sub-loop on
`OnboardStudentProfileSection.tsx`). Whether any of those kills was this sub-loop's tsgo stage
is indistinguishable, so the sub-loop's tsgo line is treated as ADVISORY only (a killed process
emits no diagnostics and the stage false-passes — Task 3's documented failure mode). Non-vacuous
type evidence was produced via the scoped fallback:

1. **Scoped tsgo:** temp config OUTSIDE the repo (`/home/z/tsconfig.task12.json` — the sandbox
   Write tool cannot write `/tmp`; extends the root tsconfig preserving `paths`/`strict`/`jsx`,
   `incremental: false`, `types: []`, `typeRoots` pinned into the repo's `node_modules/@types`,
   `include` overridden) → `./node_modules/.bin/tsgo -p … --noEmit` → **exit 0, ZERO diagnostics**
   over the file's full import closure (PhoneInput, the dialogs barrel, AdminUserGenderSelect,
   `useAppLocale`, `AdminUsersLabels`, MUI, react).
   - **Pattern refinement (new):** the `include` list must ALSO carry
     `frontend/providers/theme/types.ts` — the ambient `declare module "@mui/material/styles"`
     augmentation for the custom `Palette` tokens. Without it, every closure file consuming
     `theme.palette.border/shadow/surfaceContainer*/on*Container` false-errors with TS2339/TS2551
     (~100 diagnostics across the admin users/directory closure) — closure noise, not real
     defects. With the augmentation included, the run is clean.
2. **Negative control (gate-engagement proof):** a scratch `.tsx` outside the repo rendering
   `<PhoneInput label={123} />` through the same scoped config →
   `error TS2322: Type 'number' is not assignable to type 'string'`, **exit 1** — the `@/` alias
   resolves AND props are genuinely typed against `PhoneInputProps`, so the clean exit-0 is real
   proof. All three scratch files (2 configs + probe) were deleted; none remain anywhere.

### 12.TE — Test Engineering: **all mandated probes pass; NO render test authored**

- No render tier exists (repo is E2E-only; REQ-6.5) — none authored. Coverage is owned by
  **Task 4 journey step 7** (server-side `updateUser` phone rejection + BOPLA probe; currently
  RED pending Task 7 wiring — client-side work like this task does not affect that matrix) and
  the **Task 15 wire test** (`updateUser` phone rejection surfaced on the wire).
- `grep` over the file: raw phone `TextField` REPLACED — the only remaining `TextField`s are
  fullName (`:61`), country (`:84`), dateOfBirth (`:104`); `PhoneInput` is imported (`:12`) and
  used (`:73`); `isValidPhone` imported (`:15`) and used (`:53`).
- **`required` flag state preserved:** the file contains ZERO `required` matches (the edit
  dialog's phone label row never carried one) and empty is never flagged as an error — the
  client rule fires only on non-empty-but-invalid (`form.phone.length > 0 && …`). Empty =
  clear-the-stored-phone semantics intact end-to-end (dialog maps `phone: form.phone ||
  undefined`, so empty is omitted from the patch; the server update path validates only
  non-empty strings and treats empty as clear).
- Inline `dir: "ltr"` is gone (zero `dir` matches — component-supplied per REQ-2.2); the DOB
  field's `slotProps={{ htmlInput: { lang: locale } }}` is untouched (different attribute,
  pre-existing).

### 12.SEC — Security & Tenancy Audit: **pass (REQ-9.1, REQ-9.2)**

- **Admin-only surface (BFLA):** no access-control code touched; the dialog remains reachable
  only through the existing admin directory/detail containers and their permission gates.
- **Client validation is advisory UX only:** `phoneClientError` gates nothing but inline
  feedback; no code path treats client validity as authorization. The server independently
  re-validates via `phoneSchema` (Tasks 5/7) — a crafted request bypassing this dialog is
  rejected at the service boundary.
- **No mass-assignment (BOPLA, REQ-9.2):** this file only renders fields and forwards values
  into the dialog's whitelisted `AdminEditUserPatchInput` shape (`EditUserDialog.tsx:48-54`);
  the server-side picked-column whitelist (`validateUpdatePatch` / update repo) remains the
  gate — nothing in this task spreads input into a DB update.
- **No raw echo:** the only strings rendered in the helper slot are the server-localized
  `fieldErrors.phone` (verbatim, via the unchanged `useAdminUserFormFeedback` projection built
  on `frontend/lib/mutationFieldErrors.ts`) or the fixed localized leaf
  `labels.editDialog.phoneInvalid` — no interpolation of the typed value, no hardcoded copy
  (REQ-5.3), no `console.*`.

### 12.SR — Semantic Review: **pass (all items)**

| Item | Result |
|---|---|
| No RHF introduced (`useForm`/`register`/`@hookform/*`) | ✅ grep 0 — controlled `form`/`setForm` state only |
| Patch semantics preserved (empty = clear, absent ≠ required) | ✅ no `required` anywhere; empty not flagged; comment documents the clear semantics |
| Server `fieldErrors.phone` projection authoritative | ✅ `fieldErrors.phone ?? client hint`; projection pipeline untouched |
| No leftover raw phone `TextField` | ✅ diff shows the swap; 3 remaining TextFields are the other fields |
| `PhoneInput` used (not a duplicate inline component) | ✅ deep import of the Task 8 component |
| No duplicate `dir: "ltr"` | ✅ inline `slotProps.htmlInput.dir` removed |
| No invented i18n key | ✅ `labels.editDialog.phoneInvalid` (Task 3, types `:291` / en `:137` / ar `:133`) |
| No cross-layer import | ✅ imports are `@/frontend/**` + `@/shared/**` only (no `@/backend`, no `@/app`) |
| `sx`-only styling, no hardcoded colors | ✅ zero style props added; zero hex/rgb/hsl matches |
| No `console.*` | ✅ grep 0 |
| Comments clean (no REQ/Task/plan artifacts) | ✅ the one added comment is domain-language only |
| `useAppLocale()` still consumed | ✅ by the pre-existing date-field `lang` slot prop |

### 12.IV — Instruction Verification: **pass**

Read IN FULL (all four also printed by the sub-loop): root `AGENTS.md`, `frontend/AGENTS.md`,
`frontend/views/AGENTS.md`, `.agents/instructions/frontend.instructions.md`. Relevant rules
validated: MUI v9 `sx` discipline (no direct style props); no hardcoded colors; React 19 (no
`FormEvent` introduced); `aria-invalid` on form fields with validation errors; i18n via the
compile-time `*Labels` system (`labels: AdminUsersLabels` prop — no new namespace, no string-arg
translation); deep imports / no barrel created; no `console.*`; no `oxlint-disable`;
`frontend-no-backend-deps` respected.

## 4. Implementation notes

- The task block's JSX is the minimal controlled shape; `id={EDIT_PHONE_ID}` is retained (and
  `fullWidth` omitted, default `true`) because the surface renders its own
  `AdminDialogFieldLabel` above the field — dropping the `id` would orphan the label's
  `htmlFor`. This matches the controlled idiom recorded in `outcome/8-outcome.md` §5.
- The computed consts live at the top of the component (plain function — no hooks/memo needed;
  recomputed per render, matching the file's existing controlled-field style).
- `PhoneInput`'s internal `helperText ?? " "` makes the explicit `" "` fallback technically
  redundant for layout, but passing it keeps the three error states explicit at the call site
  exactly as the task block mandates.
- REQ-5.2 is now live on this surface: client failure → `labels.editDialog.phoneInvalid`
  (`AdminUsers` namespace via the existing prop); server rejection → the server-localized
  `fieldErrors.phone` message (producer-side via `validatePhoneField`, Task 5) — once Task 7
  wires the update path, `PHONE_INVALID`/`PHONE_TOO_LONG` will project through the same prop.

## 5. Cross-file dependencies / carry-forward

- **Task 7 (not yet landed at write time):** `user-management.helpers.ts:286` still carries the
  legacy length-only update guard (`MAX_PHONE_LENGTH = 20`); the journey (Task 4, step 7b) is
  RED by design until Task 7 routes `validateUpdatePatch` through `validatePhoneField` with the
  non-empty guard (empty = clear → skip). This task's client rule is independent of that wiring
  and aligned with its semantics.
- **Task 11 (concurrent):** `CreateUserFormGrid.tsx` mirrors this controlled idiom for the
  create dialog (`labels.createDialog.phoneInvalid`, where `required` IS present because create
  demands a phone). Keep the two siblings consistent — edit differs only in the
  no-required/empty-clears patch semantics.
- **Task 15 (wire test):** assert the `updateUser` `PHONE_INVALID` field error surfaces through
  this dialog's `fieldErrors.phone` pipeline.
- **Task 16/17 (final gates):** expect sub-loop tsgo to stay advisory under concurrent load —
  the scoped-tsgo + negative-control pattern (with the `frontend/providers/theme/types.ts`
  ambient augmentation included) is the reliable type evidence for view files whose closure
  touches custom `Palette` tokens.
- **No deferred ledger additions** (D-1…D-9 all ⏭️ Out of scope; nothing in this task is blocked
  or partial).
