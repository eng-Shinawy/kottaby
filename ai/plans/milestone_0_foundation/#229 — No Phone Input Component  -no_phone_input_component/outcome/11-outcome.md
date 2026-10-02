# Task 11 — Outcome: Admin create-user dialog integration (COMPLETED)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 11 — Admin create-user dialog integration — `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx` (REQ-3.2, REQ-3.5, REQ-9.1)
> **Date:** 2026-09-30 · **Pipeline:** 11.QL → 11.TE → 11.SEC → 11.SR → 11.IV — all executed, all pass · **Code change: ONE file** · **Checkbox: flipped**
> **Executed on:** worktree `/home/z/feat-wt` pinned to `feat/no-phone-input-component` @ `5111b928` (clean HEAD before the edit; no git write commands issued).

## 1. Summary

Replaced the admin create-user dialog's raw phone `TextField` with the shared `PhoneInput`
component in **controlled mode** — this surface stays plain React state (`form`/`setForm` props
from `CreateUserDialog`), NO React Hook Form was introduced:

- **Imports added (2):** `import { PhoneInput } from "@/frontend/components/ui/PhoneInput";`
  (deep import, Task 8) and `import { isValidPhone } from "@/shared/lib/phone";` (shared
  predicate, Task 1 — the frontend's advisory copy of the server rule; server authoritative per
  REQ-9.1). Biome-ordered per the `RegisterIdentityFields.tsx` convention; no other import touched.
- **Phone field swapped** (was `:79-89`): `<PhoneInput id={CREATE_PHONE_ID} value={form.phone}
  onChange={e => setForm({ ...form, phone: e.target.value })} required error={phoneError}
  helperText={phoneErrorText} aria-invalid={phoneError} />`.
  - `id` kept so the KEPT external `AdminDialogFieldLabel htmlFor={CREATE_PHONE_ID}` row still
    pairs (that is why `PhoneInput.label` is optional — `label` is NOT passed).
  - `required` kept (MUI asterisk + native attribute — the create dialog's phone is required;
    the server emits `PHONE_REQUIRED` on empty).
  - `fullWidth` dropped from the JSX — `PhoneInput` defaults `fullWidth = true` (Task 8),
    so rendered behavior is identical.
  - The inline `slotProps={{ htmlInput: { dir: "ltr" } }}` was REMOVED — the component supplies
    `htmlInput.dir: "ltr"` internally (no duplicate `dir`).
- **Client validation COMPUTED, not registered** (component body, before `return`):
  `const phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone);`
  `const phoneError = Boolean(fieldErrors.phone) || phoneClientError;`
  `const phoneErrorText = fieldErrors.phone ?? (phoneClientError ? labels.createDialog.phoneInvalid : " ");`
  — the message reads the EXISTING Task 3 key `labels.createDialog.phoneInvalid` off the
  `labels: AdminUsersLabels` prop (no hook, no new namespace, no new key).
- **Server `fieldErrors.phone` projection UNCHANGED and AUTHORITATIVE:** `fieldErrors` still
  arrives from `CreateUserDialog`'s `useAdminUserFormFeedback` (filled from `createUser`
  failures via `frontend/lib/mutationFieldErrors.ts`); it wins over the client hint both in
  `phoneError` (`Boolean(fieldErrors.phone) || …`) and in `phoneErrorText` (`fieldErrors.phone ?? …`).
- **No country selector / dial-code dropdown added** (#230, D10) — the free-text country field
  and the documented no-dial-code posture (`CreateUserDialog.tsx:23-27`) are untouched.
- Header doc comment refreshed (phone is no longer a raw text field) — domain language only.
- `fullName` / `email` / `country` TextFields, gender select, credential field, props interface
  (:41-46), and the `CREATE_*_ID` constants are untouched. No new file, no barrel, no new
  dependency.

## 2. Files modified

| File | Action |
|---|---|
| `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx` | **EDITED** — +2 import lines, +6 computed-hint lines (incl. comment), phone block −10/+8 lines (raw TextField → PhoneInput), doc comment −3/+4. Sole code artifact of Task 11. |
| everything else in the repo | NOT touched by Task 11 |

`git diff --stat` during the run also showed `EditUserFormFields.tsx` (Task 12) and
`OnboardStudentProfileSection.tsx` (Task 13) modified by **concurrent sibling subagents** in the
same worktree — NOT Task 11's changes; no interaction (disjoint files), orchestrator may commit
per-task or in one wave.

## 3. Verification results (pipeline 11.QL → 11.TE → 11.SEC → 11.SR → 11.IV)

### 11.QL — Quality Loop: **exit 0, all five stages**

```
bun run scripts/health/sub-loop.ts frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx --lifecycle duplicates
✅ tsgo passed (project-wide run filtered for the file)
✅ oxlint passed
✅ biome:check passed
✅ lint:type-aware passed (in-process service)
✅ check:duplicates passed (intra-file jscpd)
→ exit 0
```

**Honesty note (A2 recurrence risk):** the sub-loop's project-wide tsgo stage has historically
false-passed on OOM-kill (Tasks 2/3/5), so non-vacuous type evidence was additionally produced
via the documented scoped fallback (outcome/3-outcome.md pattern, Task 10 precedent): a temp
tsconfig OUTSIDE the repo (`extends` root tsconfig preserving `paths`/`strict`/
`moduleResolution: bundler`, `incremental: false`, `types: []`, `include` = exactly the edited
file) → `tsgo -p … --noEmit`.

- First scoped run: exit 1 — **zero diagnostics in the edited file**; every diagnostic was a
  `Property '…' does not exist on type 'Palette'` in closure siblings, caused by the scoped
  include dropping the MUI theme module augmentation (`frontend/providers/theme/types.ts`).
  Re-run with that augmentation file added to `include` → **exit 0, ZERO diagnostics** over the
  file's full import closure (PhoneInput, `shared/lib/phone`, dialogs barrel, gender select,
  locale types).
- **Negative control (gate-engagement proof):** a scratch `.tsx` outside the repo passing
  `label={123}` through the same scoped config → `error TS2322: Type 'number' is not assignable
  to type 'string'` (exit 1) — the gate genuinely type-checks against `PhoneInputProps` and the
  `@/` alias resolves, so the clean run is real proof.
- All scratch files (`tsconfig.task11.json`, `tsconfig.task11-negative.json`,
  `task11-negative-control.tsx`) were deleted after verification; none remain anywhere.

### 11.TE — Test Engineering: **no render tier — no test authored (correct per plan)**

- The repo has **no frontend render-test tier** (documented at
  `frontend/components/ui/fieldError.test.ts:2-13`; UI is E2E-only) — no render test authored.
- Coverage per plan: Task 4 journey step 6 (admin create with invalid phone) and Task 15 wire
  test (`AdminCreateUserInput` → `PHONE_INVALID` field error) — both later tasks.
- Mandated probes (grepped the edited file):
  - Old raw phone `TextField` **gone** — the phone block now renders `<PhoneInput …>`; the
    remaining `TextField` uses are the untouched fullName/email/country fields.
  - `PhoneInput` **imported** (`:14`, deep import from `@/frontend/components/ui/PhoneInput`).
  - No duplicate `dir: "ltr"` in the file (grep → 0; component-supplied).
  - No RHF (`useForm` / `register(` / `hookform`) — grep → 0 (controlled mode preserved).
  - `isValidPhone` imported + used (`:21`, `:52`); `labels.createDialog.phoneInvalid` consumed
    (`:54`) — key verified present in `shared/locale/types/adminUsers/index.ts:256` (createDialog),
    en `:118`, ar `:114` (no invented key).

### 11.SEC — Security & Tenancy Audit: **pass (REQ-9.1)**

- Admin-only surface, reached through the existing dialog permission context — nothing about
  this change alters access.
- The client hint (`phoneClientError`) is **advisory UX only**: it gates nothing but inline
  feedback; no code path treats client validity as authorization. The server's
  `validateCreateInput` (Task 7) re-validates via `phoneSchema` at the service boundary — a
  crafted request bypassing the client is still rejected.
- Server `fieldErrors.phone` (localized wire message projected by `mutationFieldErrors.ts`
  through `useAdminUserFormFeedback`) remains **authoritative** and takes precedence over the
  client hint in both `error` and `helperText`.
- No raw-input echo: the only strings rendered are the server-localized projection or the fixed
  localized leaf `labels.createDialog.phoneInvalid` (REQ-5.3) — no interpolation of the typed
  value; `helperText` is a React node (React-escaped, no HTML injection). No new network,
  storage, or secret surface.

### 11.SR — Semantic Review: **pass (all items)**

| Item | Result |
|---|---|
| No RHF `useForm`/`register` introduced | ✅ grep 0 — surface stays controlled (`form`/`setForm` props) |
| No duplicate `dir: ltr` | ✅ inline `slotProps.htmlInput` removed; component supplies it |
| No invented i18n key | ✅ `labels.createDialog.phoneInvalid` (Task 3, `AdminUsers` createDialog) — verified present in types + en + ar |
| No cross-layer import | ✅ imports are `@mui/material`, `react`, `@/frontend/**`, `@/shared/**` only (no `@/backend`, no `@/app`) |
| `sx`-only styling | ✅ no new style props at all; the one `sx` is the pre-existing grid Box |
| No hardcoded colors | ✅ grep clean |
| No `console.*` | ✅ grep 0 |
| No `FormEvent` (React 19) | ✅ none introduced; MUI change-handler shape flows into `PhoneInput.onChange` |
| Comments clean (no REQ/Task/plan artifacts) | ✅ doc comment + hint comment are domain language only |
| External `AdminDialogFieldLabel` row kept, paired via `id` | ✅ `:87` untouched; `id={CREATE_PHONE_ID}` on `PhoneInput` |
| Controlled value/onChange threaded verbatim | ✅ `setForm({ ...form, phone: e.target.value })` — same idiom as sibling fields |
| PhoneInput used (not a duplicate inline component) | ✅ deep import of the Task 8 component |

### 11.IV — Instruction Verification: **pass**

Read in full (all four also listed/printed by the sub-loop): root `AGENTS.md`,
`frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `.agents/instructions/frontend.instructions.md`.
Relevant rules validated: MUI v9 `sx` discipline (no direct style props added); no hardcoded
colors; React 19 (no `FormEvent`); `aria-invalid` on form fields with errors; i18n via the
compile-time `*Labels` system (labels is a prop — no hook, no string-arg translation, no new
namespace); deep imports / no barrel created or edited; no `console.*`; no `oxlint-disable`;
`frontend-no-backend-deps` respected; fix-within-file honored (no other file modified).

## 4. Implementation notes

- `helperText` fallback `" "`: PhoneInput reserves the helper line itself (`helperText ?? " "`),
  so the field no longer shifts layout when the error copy appears — this replaces the old
  `helperText={fieldErrors.phone}`-only rendering (undefined when clean). The explicit `" "` in
  `phoneErrorText` matches the task contract and is idempotent with the component default.
- `error`/`aria-invalid` now carry the OR of server projection and client hint (previously
  server-only), which is exactly the REQ-3.2/REQ-3.5 behavior; the computed consts are plain
  component-body derivations — no memo needed (cheap pure predicate on a string).
- `PhoneInput` supplies `type="tel"`, `inputMode="tel"`, `autoComplete="tel"`,
  `formHelperText.aria-live="polite"` — semantics the raw TextField lacked; nothing lost from
  the old block (`fullWidth` default, `dir: ltr` internal).

## 5. Cross-file dependencies / carry-forward

- **Consumed (all present in the worktree):** `PhoneInput`/`PhoneInputProps` (Task 8 —
  controlled-mode idiom per `outcome/8-outcome.md` §5), `isValidPhone` (Task 1),
  `AdminUsersLabels.createDialog.phoneInvalid` + en/ar leaves (Task 3).
- **For Task 12 (EditUserFormFields.tsx):** the same controlled idiom applies with
  `labels.editDialog.phoneInvalid`; observe the patch-semantics divergence (edit dialog must NOT
  flag empty as an error) — already visible as the concurrent edit in the shared worktree.
- **For Task 15 wire test:** this surface now surfaces the server `PHONE_INVALID` projection on
  `PhoneInput` and the client hint for instant feedback; wire coverage unchanged.
- **Scoped-tsgo fallback refinement (for later tasks):** when the edited file's import closure
  touches components using augmented `theme.palette` tokens, the scoped config must ALSO include
  `frontend/providers/theme/types.ts` (module augmentation) or closure siblings will noise-fail
  with `Property '…' does not exist on type 'Palette'`.
- **Concurrent-work note:** Task 12/13 edits were landing in the same worktree during this run;
  the Task 11 diff contains only `CreateUserFormGrid.tsx`.
