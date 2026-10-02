# Task 8 — Outcome: Reusable `PhoneInput` component

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 8 — Reusable `PhoneInput` component (`frontend/components/ui/PhoneInput.tsx`)
> **Date:** 2026-09-30 · **Requirements:** REQ-2.1, REQ-2.2, REQ-2.3, REQ-6.5, REQ-9.1

## 1. Summary

Created `frontend/components/ui/PhoneInput.tsx` (flat file, no folder, no barrel) — a reusable,
presentation-only phone field wrapping MUI `TextField` v9.4.0. It centralizes tel semantics,
bidi safety, and helper-line/aria-live behavior for the four consuming surfaces (register,
admin create/edit dialogs, student onboarding), which are wired in Tasks 10–13.

- `export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(props: Readonly<PhoneInputProps>, ref) { ... });` with `PhoneInput.displayName = "PhoneInput"`.
- Exported `PhoneInputProps` (all optional): `label?`, `value?`, `onChange?`, `onBlur?`, `startAdornment?`, `name?`, `required?`, `fullWidth?` (default `true`), `error?`, `helperText?: React.ReactNode`, `autoComplete?` (default `"tel"`), `disabled?`, `id?`, `"aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling"`, `inputRef?: React.Ref<HTMLInputElement>`.
- Renders `TextField` with `type="tel"`, `inputMode="tel"`, `autoComplete={autoComplete}`, `helperText={helperText ?? " "}`, `error={error}`, `aria-invalid={ariaInvalid ?? undefined}`, `slotProps={{ input: { startAdornment }, htmlInput: { dir: "ltr" }, formHelperText: { "aria-live": "polite" } }}`.
- **No validation logic inside** — never calls `isValidPhone`; callers own validity and project it via `error`/`helperText`/`aria-invalid` (structurally identical to what `textFieldErrorProps()` in `fieldError.ts` emits, so the server-error projection spreads in unchanged — no import needed, structural typing suffices).
- Both usage modes supported: RHF spread `{...register("phone")}` (uncontrolled; ref arrives through React's forwarding slot) and controlled (`value` + `onChange`).
- Both ref entry points (forwarded `ref` and explicit `inputRef` prop) land on MUI `TextField`'s **top-level `inputRef`** (verified in `@mui/material/TextField/TextField.js`: `inputRef` is destructured at top level and forwarded into the Input slot → the underlying `<input>`; NOT into `slotProps.input`).

## 2. Files created

| File | Purpose |
|---|---|
| `frontend/components/ui/PhoneInput.tsx` | The reusable phone field component (sole code artifact of Task 8) |

## 3. Verification results (pipeline 8.QL → 8.TE → 8.SEC → 8.SR → 8.IV)

### 8.QL — Quality Loop: **exit 0** (all five stages, no OOM fallback needed)

```
bun run scripts/health/sub-loop.ts frontend/components/ui/PhoneInput.tsx --lifecycle duplicates
✅ tsgo passed (project-wide run filtered for the file — completed in-sandbox, no OOM this run)
✅ oxlint passed
✅ biome:check passed
✅ lint:type-aware passed (in-process lint service)
✅ check:duplicates passed (intra-file jscpd)
All checks for lifecycle "duplicates" passed  → exit 0
```

- The sub-loop's tsgo stage ran project-wide and filtered for this file — it completed
  **without** being OOM-killed this time (the Task 0 A2 constraint did not bite; no
  `bunx tsgo --noEmit --ignoreConfig` fallback was required).
- Instruction files printed and read: `.agents/instructions/frontend.instructions.md`,
  root `AGENTS.md`, `frontend/AGENTS.md` (8.IV satisfied).

### 8.TE — Test Engineering

- No colocated render test authored — the repo has **no frontend render-test tier** (documented
  at `frontend/components/ui/fieldError.test.ts:2-13`; UI verification is E2E-only), per REQ-6.5.
- Prop contract proven by tsgo in 8.QL; both spread and controlled modes are exercised visually
  by Task 9's story; integration correctness covered later by the journey test (Task 4) and the
  GraphQL wire test (Task 15).
- `rg "@/backend" frontend/components/ui/PhoneInput.tsx` → **0 matches** (no cross-layer import).
- `rg "console\." frontend/components/ui/PhoneInput.tsx` → 0 matches.

### 8.SEC — Security & Tenancy Audit: pass

- No client validation treated as a trust boundary: the component only presents input and
  forwards validation outcomes; the server remains authoritative (REQ-9.1).
- No secrets, no `dangerouslySetInnerHTML`; `helperText` is rendered as a React node
  (escaped by React, never raw HTML).

### 8.SR — Semantic Review: pass (all items)

| Item | Result |
|---|---|
| `forwardRef` display name set | ✅ `PhoneInput.displayName = "PhoneInput"` |
| `Readonly<>` props | ✅ `props: Readonly<PhoneInputProps>` |
| No MUI style props outside `sx` | ✅ no style props at all (none needed) |
| No `FormEvent` (React 19) | ✅ grep clean |
| No hardcoded colors | ✅ grep clean (no `#hex`/`rgb(`/color names) |
| No cross-layer import | ✅ only `react`, `@mui/material`, `@mui/material/utils` |
| No dead props | ✅ all 15 props consumed in the render |
| No validation logic inside | ✅ no `isValidPhone`/regex in file |
| No `console.*` | ✅ grep clean |

### 8.IV — Instruction Verification: pass

Read root `AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md`
(and `frontend/views/AGENTS.md`/stories house style consulted only as precedent reading).
Relevant rules honored: no hardcoded colors; `sx`-only styling; no `FormEvent`; `"use client"`
for interactive components; `aria-invalid` on form fields; deep imports; no `console.*`;
no `oxlint-disable` comments (root cause fixed instead).

## 4. Implementation notes (deviations & discoveries)

1. **Ref merging via MUI `useForkRef` (not manual mutation).** The first draft merged
   `ref` + `inputRef` with a hand-written callback ref that assigned `ref.current`/`inputRef.current`.
   oxlint's **React Compiler `immutability` rules rejected it** ("`inputRef` cannot be modified";
   "Cannot modify local variables after render completes" — React Compiler skips optimizing the
   component otherwise). Fix: `const setRef = useForkRef(ref, inputRef)` imported from
   `@mui/material/utils` — a public MUI subpath re-export (no new dependency; `@mui/material`
   is a direct dep). `useForkRef` handles function refs, object refs, and React 19 cleanup
   functions, and is memoized on its ref args.
2. **`inputMode="tel"` placement is top-level per the task contract.** Verified in MUI v9.4.0
   `TextField.js` that unknown top-level props (incl. `inputMode`) forward to the ROOT
   FormControl slot, not the `<input>`; the functional tel soft-keyboard behavior is already
   delivered by `type="tel"` (forwarded to the input), so the contract text is followed
   literally with no extra placement. `dir: "ltr"` is the only `htmlInput` slot attribute —
   exactly as mandated and as the `CreateUserFormGrid.tsx:88` precedent.
3. **Top-level `aria-invalid` passthrough mirrors the `PasswordField` precedent** (`AuthFormShared.tsx:122`).
   MUI's InputBase additionally derives `aria-invalid` on the `<input>` itself from `error={true}`.
4. **`startAdornment` is forwarded unconditionally** through `slotProps.input` — when absent it
   is `undefined` and MUI renders nothing (matches `RegisterIdentityFields.tsx:79-83` structure).
5. **RHF spread typing verified against react-hook-form 7.88:** `ChangeHandler = (event: { target: any; type?: any }) => Promise<void | boolean>` is assignable to both the MUI change/blur handler slots and this component's `React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>` / `React.FocusEventHandler<...>` props; `UseFormRegisterReturn.ref` (`RefCallBack`) flows through React's forwarding slot to `useForkRef`.
6. Import ordering was normalized in place by the sub-loop's biome stage (no manual churn; tree diff for other files untouched).

## 5. Carry-forward knowledge for Tasks 9–13

- **Import path (deep, no barrel):** `import { PhoneInput } from "@/frontend/components/ui/PhoneInput";` — also exports `PhoneInputProps` (typed story args for Task 9: `satisfies Meta<typeof PhoneInput>` / `StoryObj` args work against it).
- **Prop surface (all optional):** `label?: string` · `value?: string` · `onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>` · `onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>` · `startAdornment?: React.ReactNode` · `name?: string` · `required?: boolean` · `fullWidth?: boolean` (**default `true`**) · `error?: boolean` · `helperText?: React.ReactNode` · `autoComplete?: string` (**default `"tel"`, overrides OK**) · `disabled?: boolean` · `id?: string` · `"aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling"` · `inputRef?: React.Ref<HTMLInputElement>`.
- **Task 10 (register):** `<PhoneInput {...register("phone", { required: t.phoneRequired, validate: v => (isValidPhone(v) ? true : t.phoneInvalid) })} label={t.phone} required fullWidth startAdornment={<PhoneOutlined fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />} error={Boolean(errors.phone)} helperText={errors.phone?.message ?? " "} aria-invalid={Boolean(errors.phone)} />` — the helper fallback `" "` inside PhoneInput makes passing `helperText` optional; `error`/`aria-invalid` still come from the caller.
- **Tasks 11–13 (controlled admin/onboarding):** `<PhoneInput id={...} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required fullWidth error={!!fieldErrors.phone} helperText={fieldErrors.phone} aria-invalid={!!fieldErrors.phone} />` — no `label` (external `AdminDialogFieldLabel` renders it; pair via `id`).
- **Server-error projection** (`textFieldErrorProps` / `mutationFieldErrors`): `{ error, helperText }` spread is type-compatible as-is; `helperText` may stay undefined (PhoneInput reserves the line itself).
- **forwardRef + ref mutation gotcha (repo-wide):** manual `ref.current` mutation inside a component's callback ref is rejected by oxlint React-Compiler immutability rules — use `useForkRef` from `@mui/material/utils` for merged refs.
- **Per-file `inputRef` slot:** MUI `TextField` top-level `inputRef` reaches the `<input>`; never route refs through `slotProps.input`.
- **`"use client"`** is required at the top of the component file (interactive; convention matches `PermissionDeniedFallback`/`NoticeSnackbar`).

## 6. Cross-file dependencies

- **Consumed by (future):** `frontend/views/auth/register/RegisterIdentityFields.tsx` (Task 10), `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx` + `EditUserFormFields.tsx` (Tasks 11/12), `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` (Task 13), `frontend/stories/ui/PhoneInput.stories.tsx` (Task 9).
- **Type-compatible with:** `frontend/components/ui/fieldError.ts` (`textFieldErrorProps` output spreads into `PhoneInput` without adapter props).
- **No files outside the Task 8 scope were modified** (`git status` shows only the new file plus pre-existing Task 0/1/3 artifacts).
