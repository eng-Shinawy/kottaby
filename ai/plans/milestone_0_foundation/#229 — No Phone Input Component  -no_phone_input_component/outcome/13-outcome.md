# Task 13 — Outcome: Student onboarding integration (COMPLETED)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 13 — Student onboarding integration — `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` (REQ-3.4, REQ-3.5, REQ-4.4, REQ-9.1)
> **Date:** 2026-09-30 · **Worktree:** `/home/z/feat-wt` pinned to `feat/no-phone-input-component` @ `5111b928` · **Pipeline:** 13.QL → 13.TE → 13.SEC → 13.SR → 13.IV — all executed, all pass · **Code change: ONE file** · **Checkbox: flipped**

## 1. Summary

The onboarding profile section's phone row now renders the shared `PhoneInput` (Task 8) in controlled mode, with client validity computed from the shared `isValidPhone` predicate (Task 1) and the localized `StudentOnboarding` copy `t.fields.phoneInvalid` (Task 3). Because this surface renders its four identity fields through `identityFields.map(...)`, the integration is a **branch inside the map** on `field.errorKey === "phone"` — the phone row leaves the generic `TextField` branch, which the other three rows (fullName / email / country) keep verbatim. The label row (`AdminDialogFieldLabel`) and grid placement are untouched.

Concrete deltas in the single edited file (+44/−19):

- **Imports added (2, biome-ordered):** `import { PhoneInput } from "@/frontend/components/ui/PhoneInput";` (deep import) and `import { isValidPhone } from "@/shared/lib/phone";` — nothing else touched in the import block.
- **Branch inside `identityFields.map`:** `field.errorKey === "phone"` → `<PhoneInput id={field.id} value={form.phone} onChange={event => setForm(prev => ({ ...prev, phone: event.target.value }))} required disabled={submitting} error={phoneError} helperText={phoneErrorText} aria-invalid={phoneError} />`; the else arm keeps the existing `<TextField>` block exactly as it was (minus the `ltr` slotProps — see below). The `setForm` updater-function idiom matches the map's own row seam (`setForm(prev => ({ ...prev, ... }))`) and the gender/credential rows.
- **`id={field.id}` + `required` carried over** (beyond the task's minimal JSX sketch): the external `AdminDialogFieldLabel htmlFor={field.id}` must keep pairing with the input, and the other three rows keep the native `required` attribute — the component's optional `label`/`id`/`required` props exist precisely for this pairing (the controlled idiom prescribed by `outcome/8-outcome.md` §5). `fullWidth` is omitted — the component defaults it to `true`.
- **Computed client rule (component top level, before the return):**
  `const phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone);`
  `const phoneError = Boolean(fieldErrors.phone) || phoneClientError;`
  `const phoneErrorText = fieldErrors.phone ?? (phoneClientError ? t.fields.phoneInvalid : " ");`
  — the projected server `fieldErrors.phone` message (server-localized on the wire) is authoritative over the client hint via `??` precedence; `" "` reserves the helper line when no error, per the PhoneInput contract (no layout shift). `t` is the existing `useAppTranslation(StudentOnboarding)` handle; the key ships at `shared/locale/types/studentOnboarding/index.ts:62` + en/ar `:15`.
- **`ltr` handling removed:** the `readonly ltr?: boolean;` interface member, the `ltr: true` phone entry, and the TextField branch's `slotProps={field.ltr ? { htmlInput: { dir: "ltr" } } : undefined}` are gone — the component supplies `htmlInput.dir="ltr"` internally. No other row used `ltr`.
- Header/`IdentityField` doc comments extended in domain language only (mention the shared `PhoneInput` reuse; no REQ/Task/plan artifacts).

Not done (deliberately): no dial-code/country UI (D10), no RHF introduced, no render test authored (repo is E2E-only).

## 2. Files modified

| File | Action |
|---|---|
| `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` | **EDITED** — +2 imports; phone-row branch + computed error trio; `ltr` removed. Sole code artifact (+44/−19). |
| everything else in the repo | NOT touched by this task |

**Concurrent-work observation (orchestrator note):** `git status` during this run also showed `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx` and `EditUserFormFields.tsx` modified by the concurrent Task 11/12 subagents (a Task 12 sub-loop held the process lock during my 13.QL). Zero interaction; commit each task's artifact from its own wave.

## 3. Verification results (pipeline)

### 13.QL — Quality Loop: **exit 0, all five stages**

```
bun run scripts/health/sub-loop.ts frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx --lifecycle duplicates
✅ tsgo passed · ✅ oxlint passed · ✅ biome:check passed · ✅ lint:type-aware passed · ✅ check:duplicates passed → exit 0
```

**Honesty note (A2 recurrence — the sub-loop's tsgo stage was VACUOUS this window):** a direct full-repo `./node_modules/.bin/tsgo -b --noEmit` in the same window → **exit 137 (SIGKILL, OOM)** — so the sub-loop's "tsgo passed" line is a false pass, exactly as recorded in `outcome/3-outcome.md`. Non-vacuous type evidence per the documented scoped fallback:

1. **Scoped run:** temp tsconfig OUTSIDE the repo (extends root tsconfig — preserves `paths`/`strict`/`moduleResolution: bundler`; overrides `include` = exactly the edited file + `frontend/providers/theme/types.ts`; `incremental: false`; `typeRoots` pinned to the repo's `node_modules/@types`) → `tsgo -p … --noEmit` → **exit 0, ZERO diagnostics** over the file's full import closure (PhoneInput, `users/dialogs` + `users/ui` barrels, locale client/namespaces, generated gql types, zod).
   - **NEW pitfall discovered (first scoped attempt exit 1):** overriding `include` drops the repo's global theme augmentation — `frontend/providers/theme/types.ts` (the `declare module "@mui/material/styles"` Palette extension: `onPrimary`, `surfaceContainerHigh`, `border`, …). The `users/dialogs`/`users/ui` barrels drag that consumer surface into the closure, so the scoped config MUST include `frontend/providers/theme/types.ts` or ~30 barrel-reachable files emit TS2339 noise (none in the edited file, even in that first run). Carry this into Tasks 11/12/16 scoped runs.
2. **Negative control (gate-engagement proof):** scratch `.tsx` (outside the repo, same-config shape) rendering `<PhoneInput error={123} helperText={42} />` → **TS2322 `Type 'number' is not assignable to type 'boolean | undefined'`, exit 1** — the gate genuinely type-checks `PhoneInputProps` through the `@/` alias, so the clean exit-0 run is real proof. All scratch files (`tsconfig.task13*.json`, `task13-negative.tsx`) deleted; none remain anywhere.

### 13.TE — Test Engineering: **pass**

- **No render tier authored** (repo has no frontend render tier; REQ-6.5). Coverage per plan: Task 4 journey step 8 (onboarding inherits `PHONE_INVALID` via `createUser` — authored test-first in `outcome/4-outcome.md`, RED until Task 7 wiring) + Task 15 wire test.
- Raw phone TextField row is replaced: the generic `TextField` block no longer handles `errorKey === "phone"` (it renders only for fullName/email/country) and `PhoneInput` is imported (`:23`) and rendered in the branched arm (`:127-135`).
- `rg "@hookform/resolvers" frontend/` → **0 matches** (D3).

### 13.SEC — Security & Tenancy Audit: **pass (REQ-9.1 / REQ-4.4)**

- Admin-only onboarding surface (BFLA enforced upstream by the directory container + server session); this component introduces no authorization logic.
- The computed `phoneError` is **advisory UX only** — no code path treats client validity as authorization. The server independently re-validates: onboarding funnels through `createUser` (`student-onboarding.service.ts` → Task 7 `validateCreateInput` wiring), and its rejection arrives as `fieldErrors.phone` through the UNCHANGED projection seam (`useOnboardStudentFormFeedback` → `extractFieldErrors` → `serverFieldErrors`, merged at `OnboardStudentDialog.tsx:150`). The `??` precedence keeps the server-localized message authoritative over `t.fields.phoneInvalid`; no raw wire text and no input echo is rendered (only fixed, server- or catalog-localized strings).
- **No client-supplied role/tenant id is trusted from this form:** `OnboardStudentFormState` carries no role/tenant fields; the section only edits identity strings; the mutation input is built field-by-field by `buildOnboardStudentInput` (no `{ ...form }` spread; gender/method token whitelists; plan id parsed + bound to an active row) and the acting admin identity comes from the server session, never the form.

### 13.SR — Semantic Review: **pass (all items)**

| Item | Result |
|---|---|
| Map branch covers `errorKey === "phone"`; other three rows untouched | ✅ ternary inside `identityFields.map`; fullName/email/country render through the unchanged TextField arm |
| No leftover raw phone TextField handling | ✅ no `ltr` remains (grep 0); phone row cannot reach the generic arm |
| `PhoneInput` used (deep import), not a duplicate inline component | ✅ `@/frontend/components/ui/PhoneInput` |
| No RHF (`useForm`/`register`) introduced | ✅ grep 0; `form`/`setForm` controlled state preserved (updater-function idiom) |
| i18n key exists — `t.fields.phoneInvalid` (Task 3) | ✅ types `:62`, en/ar `:15`; namespace handle `useAppTranslation(StudentOnboarding)` unchanged |
| Server `fieldErrors.phone` projection preserved & authoritative | ✅ hook/dialog files untouched; `phoneErrorText = fieldErrors.phone ?? …` |
| No cross-layer import | ✅ imports are `@/frontend/**` + `@/shared/**` only (no `@/backend`, no `@/app`) |
| `sx`-only styling, no hardcoded colors | ✅ no style props added at all (PhoneInput owns tel/bidi/aria semantics internally) |
| No `console.*` | ✅ grep 0 |
| No new deps / no dial-code UI (D3/D10) | ✅ |
| Comments clean (no REQ/Task/plan artifacts) | ✅ domain-language only |

### 13.IV — Instruction Verification: **pass**

Read in full before editing (also printed by the sub-loop): root `AGENTS.md`, `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `.agents/instructions/frontend.instructions.md`. Validated: MUI v9 `sx` discipline (no style props added), no hardcoded colors, React 19 (no `FormEvent`; synthetic handlers only), `aria-invalid` on form fields with validation errors, i18n via the compile-time `*Labels` system (namespace HANDLE `StudentOnboarding`, never a string arg; no new namespace), deep imports/no barrels created, no `console.*`, no `oxlint-disable`, `frontend-no-backend-deps` respected.

## 4. Cross-file dependencies / carry-forward

- **Consumed (all present at `5111b928`):** `PhoneInput`/`PhoneInputProps` (Task 8), `isValidPhone` (Task 1 + 1-fix idempotency), `StudentOnboardingLabels.fields.phoneInvalid` + en/ar leaves (Task 3). Zero divergence from the Task 8 prop surface.
- **REQ-3.4/REQ-3.5/REQ-5.2 are now live on this surface:** client failure → `t.fields.phoneInvalid` (`StudentOnboarding` namespace); server rejection → server-localized `PHONE_*` message through the unchanged feedback seam, displayed on the shared `PhoneInput` and taking precedence.
- **For Tasks 11/12 (running concurrently):** this file is the controlled-mode reference integration for a loop-rendered surface; their dialogs follow the same `phoneError`/`phoneErrorText` computation with `labels.createDialog.phoneInvalid` / `labels.editDialog.phoneInvalid`.
- **Scoped-tsgo pitfall for Tasks 11/12/16:** temp configs must (a) override `include` (1-fix pitfall) and (b) include `frontend/providers/theme/types.ts` whenever the closure reaches the users-dialogs barrels, or the augmented MUI Palette members emit false TS2339s.
- **For Task 16:** the final gate must re-run this file's sub-loop (full-repo tsgo still OOMs in this sandbox — exit 137 this window; use the scoped pattern for type evidence).
- **Orchestrator:** commit this file alone in the Task 13 wave; `CreateUserFormGrid.tsx`/`EditUserFormFields.tsx` carry their own concurrent edits and must not be swept into it.
