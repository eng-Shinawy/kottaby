# Task 10 — Outcome: Registration form integration (COMPLETED)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 10 — Registration form integration — `frontend/views/auth/register/RegisterIdentityFields.tsx` (REQ-3.1, REQ-3.5, REQ-5.2, REQ-5.3, REQ-9.1)
> **Date:** 2026-09-30 · **Pipeline:** 10.QL → 10.TE → 10.SEC → 10.SR → 10.IV — all executed, all pass · **Code change: ONE file** · **Checkbox: flipped**
> **Re-dispatch note:** the FIRST attempt was environment-blocked before any edit (platform watchdog reverted the worktree HEAD to `main`, hiding the Task 1/3/8 dependency files — full evidence in the worklog's Task-10 blocker entry and in the §5 pre-written integration of this file's previous revision, which this run applied essentially verbatim). This run executed on the stable linked worktree `/home/z/feat-wt` pinned to `feat/no-phone-input-component` @ `40f66e9d`, where every dependency is present.

## 1. Summary

Replaced the register form's raw phone `TextField` with the shared `PhoneInput` component and added the localized client format rule — the exact integration the task block mandates:

- **Imports added (2):** `import { PhoneInput } from "@/frontend/components/ui/PhoneInput";` (deep import, Task 8) and `import { isValidPhone } from "@/shared/lib/phone";` (shared predicate, Task 1 — the frontend's advisory copy of the server rule; server remains authoritative per REQ-9.1). Biome-ordered; no other import touched.
- **Phone field swapped:** raw `TextField` (was `:69-85`) → `<PhoneInput {...register("phone", { required: t.phoneRequired, validate: value => (isValidPhone(value) ? true : t.phoneInvalid) })} label={t.phone} required startAdornment={<PhoneIcon fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />} error={Boolean(errors.phone)} helperText={errors.phone?.message ?? " "} aria-invalid={Boolean(errors.phone)} />` — mirroring the email analogy (`isValidEmailShape` validate) exactly.
- The `PhoneIcon` startAdornment is preserved via the component's `startAdornment` prop (forwarded into `slotProps.input` internally). `t` sourcing is unchanged (`RegisterIdentityFieldsProps.t: AuthLabels`; `t.phoneInvalid` shipped by Task 3 at `shared/locale/types/auth/index.ts:37` + en/ar).
- `fullName` / `email` / `country` TextFields, the doc comment, and the props interface are untouched; no barrel, no new file, no new dependency (`@hookform/resolvers` NOT added — D3).

Props the old block spelled out that `PhoneInput` now supplies internally (Task 8): `type="tel"`, `inputMode="tel"`, `autoComplete="tel"` (default), `fullWidth` (default `true`), `slotProps.htmlInput.dir="ltr"`, `slotProps.formHelperText."aria-live"="polite"`, `helperText ?? " "` reserved line. Nothing was lost in the swap.

## 2. Files modified

| File | Action |
|---|---|
| `frontend/views/auth/register/RegisterIdentityFields.tsx` | **EDITED** — +2 import lines; phone block −21/+15 lines (raw TextField → PhoneInput). Sole code artifact. |
| everything else in the repo | NOT touched |

`git status --porcelain` during the run also showed `shared/lib/phone.ts` modified by the **concurrent 1-fix subagent** (normalizePhone strip-then-trim idempotency reorder — the cross-file dependency recorded by Task 2 / the wave-2 consolidation). That is NOT Task 10's change; `isValidPhone` (Task 10's only consumption of the module) is untouched by it, and no interaction exists.

## 3. Verification results (pipeline)

### 10.QL — Quality Loop: **exit 0, all five stages**

```
bun run scripts/health/sub-loop.ts frontend/views/auth/register/RegisterIdentityFields.tsx --lifecycle duplicates
✅ tsgo passed (project-wide run filtered for the file — no OOM this run)
✅ oxlint passed
✅ biome:check passed
✅ lint:type-aware passed (in-process service)
✅ check:duplicates passed (intra-file jscpd)
→ exit 0
```

**Honesty note (A2 recurrence risk):** the sub-loop's project-wide tsgo stage is historically memory-borderline (vacuous false passes recorded by Tasks 2/3/5 when OOM-killed). Non-vacuous type evidence was therefore additionally produced via the documented scoped fallback: a temp tsconfig OUTSIDE the repo (`extends` root tsconfig preserving `paths`/`strict`, `incremental: false`, `typeRoots` pinned into the repo's `node_modules/@types`, `include` = exactly the edited file) → `tsgo -p … --noEmit` → **exit 0, ZERO diagnostics** over the file's full import closure (PhoneInput, register barrel, react-hook-form, MUI, locale types). **Negative control:** a scratch `.tsx` passing `label={123}` through the same scoped config → `error TS2322: Type 'number' is not assignable to type 'string'`, exit 1 — the gate genuinely type-checks against `PhoneInputProps` and the `@/` alias resolves, so the clean run is real proof. All scratch files deleted; none remain in any repo tree.

### 10.TE — Test Engineering: **both mandated probes pass**

- `rg "@hookform/resolvers" frontend/` → **0 matches** (D3 honored).
- `rg "isValidPhone" frontend/views/auth/register/` → **present** — 2 matches: the import (`RegisterIdentityFields.tsx:13`) and the validate usage (`:74`).
- **No render test authored** — the repo has no frontend render-test tier (UI is E2E-only; REQ-6.5). Coverage per the plan: Task 4 journey (server rejection), Task 15 wire test (`PHONE_INVALID` field error), existing register E2E.

### 10.SEC — Security & Tenancy Audit: **pass (REQ-9.1)**

- The inline `validate` rule is **advisory UX only**: it gates nothing but form submission UX; no code path treats client validity as authorization. The server independently re-validates via `phoneSchema` (Tasks 5/6) — a crafted bypass of the client is rejected at the service boundary.
- Field errors reach the UI **only** through the projection pipeline (unchanged): server `extensions.fields[]` → `projectMutationFieldErrors` (whitelist: only `{field, message}`, first-wins) → `applyProjectedFieldErrors` + `isRegisterFieldPath` (phone still whitelisted) → RHF `setError("phone")` → rendered via `errors.phone` as `error` / `helperText` / `aria-invalid` on `PhoneInput`. The only echoed string is the server-localized message; no raw wire text, no client-side interpolation of input values (`t.phoneInvalid` is a fixed localized leaf — no hardcoded copy, REQ-5.3).

### 10.SR — Semantic Review: **pass (all items)**

| Item | Result |
|---|---|
| No leftover raw phone `TextField` | ✅ diff shows the block replaced; the remaining `TextField`s are fullName/email/country |
| `PhoneInput` used (not a duplicate inline component) | ✅ deep import of the Task 8 component |
| `REGISTER_FIELD_PATHS` still includes `"phone"` | ✅ `registerFormUtils.ts:23` — file untouched (`isValidEmailShape` re-export :15 and values map :63-72 also untouched) |
| Server-error projection unchanged | ✅ `useRegisterSubmit.ts` untouched (trim at :48; projection at :66-79) |
| No `console.*` | ✅ grep 0 |
| No cross-layer import | ✅ imports are `@/frontend/**` + `@/shared/**` only (no `@/backend`, no `@/app`) |
| `sx`-only styling, no hardcoded colors | ✅ the sole `sx` is the pre-existing `PhoneIcon` one using `var(--mui-palette-action-active)` |
| No `@hookform/resolvers` / new deps | ✅ D3 |
| Comments clean (no REQ/Task/plan artifacts) | ✅ file comments untouched, all domain-language |
| `t` sourcing unchanged; `t.phoneRequired` stays in `required`; `t.phoneInvalid` is the Task 3 key | ✅ |

### 10.IV — Instruction Verification: **pass**

Read in full (all four also printed by the sub-loop): root `AGENTS.md`, `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `.agents/instructions/frontend.instructions.md`. Relevant rules validated: MUI v9 `sx` discipline; no hardcoded colors; React 19 (no `FormEvent` introduced); `aria-invalid={!!error}` pattern; i18n via the compile-time `*Labels` system (`t: AuthLabels` prop — no new namespace, no string-arg translation); deep imports / no barrels created; no `console.*`; no `oxlint-disable`; `frontend-no-backend-deps` respected.

## 4. Implementation notes

- The RHF spread delivers `name`/`onChange`/`onBlur` + ref through `PhoneInput`'s `React.forwardRef` slot (merged onto the underlying `<input>` via `useForkRef` — Task 8); `register(...)`'s `ref` needs no `inputRef` prop here.
- `required` renders the MUI asterisk + native attribute, as before.
- REQ-5.2 is now live in both directions on this surface: client failure → `t.phoneInvalid` (`Auth` namespace via the existing `t` prop); server rejection → `authTranslations.phoneInvalid` localized at the producer (Task 5) and projected through the unchanged pipeline.

## 5. Cross-file dependencies / carry-forward

- **Consumed (all present in the worktree at `40f66e9d`):** `PhoneInput`/`PhoneInputProps` (Task 8), `isValidPhone` (Task 1), `AuthLabels.phoneInvalid` + en/ar leaves (Task 3). Zero divergence from Task 8's prop surface; the previous blocker report's §5 pre-written JSX applied cleanly.
- **Concurrent work observed:** the 1-fix subagent's `shared/lib/phone.ts` normalizePhone idempotency fix was landing in the same worktree during this run (strip-then-trim reorder). RegisterIdentityFields consumes only `isValidPhone` (unaffected); no coordination needed. Orchestrator may commit both artifacts in one wave.
- **For Tasks 11/12/13:** this file is the RHF-spread reference integration; the controlled-mode idiom (`value`/`onChange`/`error`/`helperText`/`aria-invalid` + external label via `id`) remains as documented in `outcome/8-outcome.md` §5.
- **For Task 16/17:** register surface now enforces the client-side rule; journey/wire coverage is owned by Tasks 4/15.
