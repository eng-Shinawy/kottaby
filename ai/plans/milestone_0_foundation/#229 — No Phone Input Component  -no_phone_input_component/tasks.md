# Tasks — #229 No Phone Input Component (Reusable Phone Input + Shared Zod Validation)

> **Plan directory (verbatim):** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Issue:** GitHub #229 — *"No Phone Input Component"* — "Reusable Phone input component with validation at both frontend and backend, with shared Zod schema."
> **Milestone:** `milestone_0_foundation` (**DERIVED** — the GitHub issue carries NO milestone label; see Milestone Derivation below)
> **Siblings:** `specs.md` (REQ-1..REQ-9) · `plan.md` · `deferred-items.md` · `outcome/`
> **Sibling tickets:** #230 (CountrySelector) is OUT OF SCOPE here (see `deferred-items.md`).

## Milestone Derivation (explicit)

The GitHub issue #229 has **no milestone label**. This plan is assigned to `milestone_0_foundation` by derivation, because the deliverable is **cross-layer foundation infrastructure**: a shared Zod schema (`shared/lib/phone.ts`) consumed by BOTH the frontend and the backend, a reusable UI primitive (`frontend/components/ui/PhoneInput.tsx`), a shared backend validation helper, and a new i18n key. None of this is a user-visible product feature belonging to a numbered product milestone; it is the substrate other foundation tickets (#230 CountrySelector) build on. The full derivation argument is owned by `specs.md` §"Milestone Derivation"; this file only records the assignment.

## Document Information

| Field | Value |
|---|---|
| Version / Date | 1.0 · 2026-09-30 |
| Sequencing | Foundation-first with interleaved tests; the cross-actor journey test is authored **test-first** (Task 4 RED) before the backend helper + wiring (Tasks 5–7 GREEN) |
| GraphQL SDL delta | **ZERO** (D7) → phone stays `String!`/`String`; NO `bun run generate:gqlSchema`; `bun codegen` only if a genuinely new document is added |
| New dependencies | **ZERO** (D3) → `@hookform/resolvers` is NOT added; `zod@4.6.2` is already a dependency (`package.json:116`) |
| New files | `shared/lib/phone.ts` · `shared/lib/phone.test.ts` · `backend/services/shared/phone-validation.helpers.ts` · `backend/services/shared/phone-validation.helpers.test.ts` · `frontend/components/ui/PhoneInput.tsx` · `frontend/stories/ui/PhoneInput.stories.tsx` · `test/workflows/auth/registration-phone.journey.test.ts` · `docs/validation/phone-validation.md` |
| Extended files | `shared/locale/types/auth/index.ts` · `shared/locale/en/auth/index.ts` · `shared/locale/ar/auth/index.ts` · `shared/locale/types/adminUsers/index.ts` · `shared/locale/en/adminUsers/index.ts` · `shared/locale/ar/adminUsers/index.ts` · `shared/locale/types/studentOnboarding/index.ts` · `shared/locale/en/studentOnboarding/index.ts` · `shared/locale/ar/studentOnboarding/index.ts` · `backend/services/shared/index.ts` · `backend/services/auth/registration.service.ts` · `backend/services/admin/user-management.helpers.ts` · `frontend/views/auth/register/RegisterIdentityFields.tsx` · `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx` · `frontend/views/admin/users/dialogs/EditUserFormFields.tsx` · `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` |
| Backend service tests | `backend/services/auth/registration.service.test.ts` · `backend/services/admin/user-management.helpers.test.ts` (colocated) |
| GraphQL wire test | `frontend/graphql/test/auth/*.test.ts` (existing auth domain wire-test file/suite) |

## Frozen Design Decisions (binding — do not deviate)

| ID | Decision |
|---|---|
| D1 | Plan dir + milestone exactly as in the header; derivation documented in `specs.md`. |
| D2 | Shared Zod schema in NEW `shared/lib/phone.ts` — first zod usage in `shared/` (allowed: zod has no layer deps). Exports `PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH = 16`, `isValidPhone`, `normalizePhone`, `phoneSchema`. Zod `message` fields carry MACHINE CODES (`PHONE_REQUIRED`/`PHONE_TOO_LONG`/`PHONE_INVALID`) translated to localized text by producers. |
| D3 | NO new dependency. Frontend validation runs the shared predicate: the REGISTER form uses RHF inline `validate` rules (the established `isValidEmailShape` pattern); the admin create/edit + onboarding surfaces are CONTROLLED (`form`/`setForm` state) and compute `error` from `isValidPhone` on change/blur. `@hookform/resolvers` is NOT added. |
| D4 | NEW `frontend/components/ui/PhoneInput.tsx` — flat file, `React.forwardRef<HTMLInputElement, PhoneInputProps>`, explicit `Readonly<PhoneInputProps>`, supports `{...register("phone")}` spread AND controlled usage. Renders MUI `TextField type="tel" inputMode="tel"` with `slotProps={{ htmlInput: { dir: "ltr" } }}`, `helperText ?? " "` + `aria-live="polite"`, `aria-invalid` wiring. NO validation logic inside. Story at `frontend/stories/ui/PhoneInput.stories.tsx`. |
| D5 | NEW `backend/services/shared/phone-validation.helpers.ts` exporting `validatePhoneField(value, locale): ApiFieldErrorType \| null`; wire into `registration.service.ts` `validateInput` and `user-management.helpers.ts` `validateCreateInput`/`validateUpdatePatch`. |
| D6 | i18n: add `phoneInvalid: string` to `AuthLabels`, `AdminUsersLabels` (createDialog + editDialog), and `StudentOnboardingLabels` (fields) + their en/ar objects. No new namespace. en `"Please enter a valid phone number."`, ar `"يرجى إدخال رقم هاتف صحيح."`. |
| D7 | NO GraphQL SDL change → NO schema regen (`bun run generate:gqlSchema`). `bun codegen` is a separate, documents-driven step and is only needed IF a new document/selection is added; reuse `auth.documents.ts` where possible. |
| D8 | Frontend integration swaps raw TextFields for `PhoneInput` in the 4 listed surfaces; keeps `REGISTER_FIELD_PATHS` `"phone"` and the server-error projection unchanged. |
| D9 | Tests: 4-tier `shared/lib/phone.test.ts`; backend service tests; GraphQL wire test asserting `PHONE_INVALID`; journey test `test/workflows/auth/registration-phone.journey.test.ts` (real services + real DB, tracked `afterAll` cleanup, NO `runInRollback`). NO frontend render test (repo has no render tier). |
| D10 | Out of scope: CountrySelector (#230), dial-code dataset, E.164 auto-formatting/masking, `libphonenumber`, DB column change, legacy phone backfill. |

## Non-Negotiable Execution Protocol (all tasks)

1. **REQ-7.1 — Pre-Execution Outcome Read:** before executing ANY task, read ALL existing files in `outcome/` and `deferred-items.md` to absorb prior research and pitfalls.
2. **Per-File Quality Loop (immediate post-edit):** after ANY file edit run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit code `0`. The script runs `tsgo → oxlint → biome → lint → check:duplicates` progressively and auto-prints the applicable `AGENTS.md` + `.agents/instructions/*` files.
3. **Semantic Review (pre-`[x]` gate):** run the checklist in every `.SR` subtask (tenancy, races, enums-as-values, no cross-layer imports, no dead code, deferred-items logged).
4. **REQ-7.2 — Post-Execution Outcome:** write `outcome/<task-id>-outcome.md` summarizing research, changes, cross-file deps, carry-over knowledge.
5. **REQ-7.3 — Progress Tracking:** flip the task checkbox `[ ]` → `[x]` in THIS file on successful completion.
6. **Logging:** never `console.*` — frontend `@/frontend/lib/logger`, backend `@/backend/lib/logger`; domain rejections via `logger.logDomainError`.
7. **Mandated runners:** shared `*.test.ts` via `bun run test/scripts/run-test.ts <path>`; services via `bun run test:services`; GraphQL wire via `bun run test:graphql`; workflow journeys via `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts`, then `bun run test` — NEVER raw `bun test`.
8. **MANDATORY subtask pipeline per IMPLEMENTATION task:** `X.Y.QL` → `X.Y.TE` → `X.Y.SEC` → `X.Y.SR` → `X.Y.IV` → mark `[x]`. Setup/docs-only tasks (Task 0) are exempt from the full pipeline but still run their own quality loop.

### Layer → rule-file map (absolute; `sub-loop.ts` re-prints them)

| Layer touched here | AGENTS.md | `.agents/instructions/` |
|---|---|---|
| Shared lib `shared/lib/` | `…/shared/lib/AGENTS.md` (if present), `…/shared/AGENTS.md`, root | (none) |
| Shared locale `shared/locale/` | `…/shared/locale/AGENTS.md`, `…/shared/AGENTS.md`, root | (none) |
| Backend services `backend/services/` | `…/backend/services/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Backend types `backend/types/` | `…/backend/types/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Frontend components/ui `frontend/components/ui/` | `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Frontend views `frontend/views/` | `…/frontend/views/AGENTS.md`, `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Frontend stories `frontend/stories/` | `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Frontend GraphQL wire tests `frontend/graphql/test/` | `…/frontend/graphql/AGENTS.md`, `…/frontend/AGENTS.md`, root | `frontend.instructions.md`, `tests.instructions.md` |
| Journeys `test/workflows/auth/` | `…/test/workflows/AGENTS.md`, root | `tests.instructions.md` |

### Anti-patterns explicitly forbidden in this plan

- `@hookform/resolvers` / any new dependency (D3) · `libphonenumber` (D10).
- A country→dial-code dataset or `CountrySelect` (that is #230, D10).
- GraphQL SDL edits / `generate:gqlSchema` (D7) — zero SDL delta; `bun codegen` is permitted only when a genuinely NEW document/selection is added (reuse `auth.documents.ts` where possible).
- `console.*`, hardcoded colors, MUI style props outside `sx`, `FormEvent` (React 19), cross-layer imports (`shared/` → `@/frontend|@/backend|@/app`), barrel files for utilities, re-export shims.
- Frontend importing backend code (error projection must go through `frontend/components/ui/fieldError.ts` + `frontend/lib/mutationFieldErrors.ts`).

## Requirements → Task Traceability

| REQ | Title | Task(s) |
|---|---|---|
| REQ-1.1 | E.164 schema + constants | 1 |
| REQ-1.2 | `isValidPhone` | 1 |
| REQ-1.3 | `normalizePhone` | 1 |
| REQ-1.4 | Colocated unit tests | 2 |
| REQ-2.1 | `PhoneInput` prop interface + `forwardRef` | 8 |
| REQ-2.2 | LTR/bidi + `type`/`inputMode`/`autoComplete` | 8 |
| REQ-2.3 | `aria-invalid` + aria-live helper text | 8 |
| REQ-2.4 | Storybook story | 9 |
| REQ-3.1 | Registration form integration | 10 |
| REQ-3.2 | Admin create dialog integration | 10, 11 |
| REQ-3.3 | Admin edit dialog integration | 10, 12 |
| REQ-3.4 | Student onboarding integration | 10, 13 |
| REQ-3.5 | Localized client validation message (no hardcoded strings) | 10, 11, 12, 13 |
| REQ-4.1 | Shared backend phone-validation helper | 5 |
| REQ-4.2 | `registration.service` wiring | 6 |
| REQ-4.3 | `user-management` create/update wiring | 7 |
| REQ-4.4 | Onboarding inherits validation (verified, no code change) | 7 |
| REQ-4.5 | Backend phone errors localized at the producer | 5, 6, 7 |
| REQ-5.1 | `phoneInvalid` key in `AuthLabels` + `AdminUsersLabels` (create+edit) + `StudentOnboardingLabels` (en+ar) | 3 |
| REQ-5.2 | Consumed by frontend + backend error mapping | 5, 10, 11, 12, 13 |
| REQ-5.3 | No hardcoded invalid-phone message anywhere | 3, 5, 10, 11, 12, 13 |
| REQ-6.1 | Shared schema 4-tier tests | 2 |
| REQ-6.2 | Backend service validation tests | 14 |
| REQ-6.3 | GraphQL wire test (`PHONE_INVALID` field error) | 15 |
| REQ-6.4 | Cross-actor registration journey test | 4 |
| REQ-6.5 | No frontend render test authored (UI is E2E-only) | 8, 9 |
| REQ-6.6 | Mandated test runners (never raw `bun test`) | 16 |
| REQ-7.1 | Read `outcome/` before tasks | Protocol §1, 0 |
| REQ-7.2 | Write `outcome/<task-id>-outcome.md` | 17 |
| REQ-7.3 | Update `tasks.md` checkboxes | 17 |
| REQ-8.1 | Canonical doc `docs/validation/phone-validation.md` | 17 |
| REQ-8.2 | Update relevant `.agents/skills/*/SKILL.md` if applicable | 17 |
| REQ-9.1 | Server is the trust boundary | 5, 6, 7 |
| REQ-9.2 | No input spread into DB updates (BOPLA) | 7 |
| REQ-9.3 | Validation errors never echo raw input | 5 |
| REQ-9.4 | `ApiFieldErrorType` is the only error channel | 5, 6, 15 |
| REQ-9.5 | Validation is pure/synchronous, no enumeration oracle | 5, 6, 7 |

---

## Phase 0 — Baseline

- [x] 0. Baseline + ledger + outcome read (MANDATORY)
  - Record the pre-implementation baseline BEFORE any edit:
    ```bash
    bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt
    bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt
    bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
    ```
  - **REQ-7.1:** read every file in `outcome/` and `deferred-items.md`; confirm the two intentional deferrals (#230 CountrySelector, legacy phone backfill) are 📋 marked, NOT ❌/⚠️ blockers.
  - Confirm the frozen facts this plan depends on (do NOT proceed to code if any drifted): `backend/db/schema/users/users.ts:17` `phone varchar(20)` nullable and `:44` the ONLY unique constraint is on email; `backend/services/admin/user-management.helpers.ts:30` `MAX_PHONE_LENGTH = 20`; **no `phoneInvalid` key exists anywhere** (`rg "phoneInvalid" shared/ backend/ frontend/` → 0 matches); `zod@4.6.2` at `package.json:116` with `shared/` and `frontend/` currently using it nowhere.
  - Write `outcome/0-baseline-outcome.md`.
  - **Pipeline scope:** the `QL → TE → SEC → SR → IV` subtask pipeline (§8 of the protocol) is MANDATORY for IMPLEMENTATION tasks only — Task 0 is pure setup (baseline capture + reading), so it has no `0.QL/0.TE/…` subtasks; run the baseline commands above and move on.
  - _Requirements: REQ-7.1_

## Phase 1 — Shared Schema + i18n

- [x] 1. Shared Zod phone schema module — `shared/lib/phone.ts` (REQ-1.1, REQ-1.2, REQ-1.3)
  - CREATE `shared/lib/phone.ts` (flat file, sibling of `shared/lib/email.ts`) — the FIRST `zod` usage in `shared/` (allowed: zod has no layer dependencies; `shared/` MUST NOT import `@/frontend`, `@/backend`, `@/app`). Export exactly:
    - `export const PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/;` (REQ-1.1)
    - `export const PHONE_MAX_LENGTH = 16;` (REQ-1.1 — `+` + max 15 E.164 digits; DB column is `varchar(20)` at `users.ts:17`, so 16 fits with headroom, but note the DB column is NOT changed per D10)
    - `export const phoneSchema = z.string().trim().min(1, { message: "PHONE_REQUIRED" }).max(PHONE_MAX_LENGTH, { message: "PHONE_TOO_LONG" }).regex(PHONE_E164_PATTERN, { message: "PHONE_INVALID" });` (REQ-1.1)
    - `export function isValidPhone(value: string): boolean` (REQ-1.2) — pure predicate, mirrors `isValidEmail` discipline (`shared/lib/email.ts:9`): trims, rejects empty, bounds length, tests `PHONE_E164_PATTERN`. Must be safe to call with non-string-looking junk only insofar as the signature permits (`string`); no layer imports; no throw.
    - `export function normalizePhone(value: string): string` (REQ-1.3) — trim, strip ASCII spaces, dashes `-`, parentheses `(` `)`, keep exactly one leading `+`; does NOT add a country code (no dial-code data — D10). Pure, deterministic, idempotent.
  - **Convention (D2, document in a module docblock):** zod `message` values are MACHINE CODES (`PHONE_REQUIRED`/`PHONE_TOO_LONG`/`PHONE_INVALID`), NOT user-facing text. Producers (`backend/services/shared/phone-validation.helpers.ts`, and the frontend RHF rules / controlled-mode error computation) map the code → localized string. This is why `shared/lib/phone.ts` needs no i18n import (it stays layer-pure).
  - Reference the `backend/types/classes/admin-session-governance.types.ts:25-28` docblock for the "schemas beside interfaces" house style, but here the schema is the sole artifact.
  - [ ] 1.QL **Quality Loop** on `shared/lib/phone.ts`
    - `bun run scripts/health/sub-loop.ts shared/lib/phone.ts --lifecycle duplicates` → exit 0
    - Fix all errors, re-run until exit 0 before proceeding.
  - [ ] 1.TE **Test Engineering** — the schema's own tests are authored in Task 2 (colocated `shared/lib/phone.test.ts`); Task 1 only asserts the module type-checks under `tsgo` (via `1.QL`). Confirm the exported surface matches the signatures above verbatim.
  - [ ] 1.SEC **Security & Tenancy Audit** — REQ-9.1 seed: confirm the module contains NO trust decisions (it is a pure predicate; the server remains the trust boundary). No raw input is echoed; the predicate returns only `boolean`/`string`.
  - [ ] 1.SR **Semantic Review** — no cross-layer imports; `PHONE_E164_PATTERN` is a module-level frozen regex (if `g` flag is used anywhere, reset `lastIndex` — it is NOT here, so no state leak); `normalizePhone` idempotent; no dead branches; no `console.*`.
  - [ ] 1.IV **Instruction Verification** — read the AGENTS.md + `.agents/instructions/*` files printed by `sub-loop.ts` for `shared/` and validate `shared/lib/phone.ts` against them.
  - _Requirements: REQ-1.1, REQ-1.2, REQ-1.3, REQ-9.1_

- [x] 2. Shared schema 4-tier unit tests — `shared/lib/phone.test.ts` (REQ-1.4, REQ-6.1)
  - CREATE `shared/lib/phone.test.ts`, mirroring the structure of `shared/lib/email.test.ts` (bun:test, 4 explicit tiers, no render/DOM). Runner: `bun run test/scripts/run-test.ts shared/lib/phone.test.ts` (NEVER raw `bun test`).
  - **Tier 1 — Branch & Statement (100%):** every branch of `isValidPhone` (empty / whitespace-only / valid E.164 / missing `+` / leading zero / too short / too long / non-digit body); every branch of `normalizePhone` (leading/trailing whitespace, internal spaces, dashes, parens, mixed, already-normal); every arm of `phoneSchema` (`min` → `PHONE_REQUIRED`, `max` → `PHONE_TOO_LONG`, `regex` → `PHONE_INVALID`, success → no issue) asserting the exact `message` CODE.
  - **Tier 2 — Boundary Value Analysis:** `PHONE_MAX_LENGTH` (16) exactly valid vs 17 rejected; `PHONE_MAX_LENGTH` constant vs the actual E.164 max (15 digits); minimum valid `+` + 8 digits → valid vs 7 digits → invalid; `+` alone; `+0...` (leading zero rejected by `[1-9]`); unicode/Arabic-Indic digit bodies → invalid (regex is ASCII `\d`); RTL/Bidi marks in the string → invalid; empty string and `"   "`.
  - **Tier 3 — Fuzz / Property:** randomized payload fuzz (lengths 0–64, alphabet of digits/`+`/spaces/dashes/parens/control chars) asserting `isValidPhone` never throws and `normalizePhone` is idempotent (`normalizePhone(normalizePhone(x)) === normalizePhone(x)`); property: any string accepted by `isValidPhone` also parses in `phoneSchema` and vice-versa (predicate/schema agreement); `Promise.allSettled` over many concurrent parses (no shared mutable state).
  - **Tier 4 — Security & Abuse:** hostile inputs — very long strings (10k chars), embedded SQL/LIKE wildcards (`%`, `_`, `\`), null-byte `\u0000`, `\r\n`, template-injection-ish `+{1}`; assert only `boolean`/`string` is returned, no throw, no partial acceptance; assert `+1\n234` (newline inside) is rejected.
  - [ ] 2.QL **Quality Loop** on `shared/lib/phone.test.ts`
    - `bun run scripts/health/sub-loop.ts shared/lib/phone.test.ts --lifecycle duplicates` → exit 0
  - [ ] 2.TE **Test Engineering** — this subtask IS the test task; ensure 100% branch coverage of `shared/lib/phone.ts` (verify with the runner's coverage if available), and that all four tiers are distinctly present. `runInRollback`/`tx` N/A (pure unit, no DB). No render tier (repo has none).
  - [ ] 2.SEC **Security & Tenancy Audit** — Tier 4 probes are the security artifact; REQ-9.3 seed: assert no test asserts raw-input echo from the predicate (the predicate never returns input).
  - [ ] 2.SR **Semantic Review** — tests deterministic; no reliance on wall-clock/locale; no `console.*`; test file imports only from `@/shared/lib/phone` and `bun:test`.
  - [ ] 2.IV **Instruction Verification** — read applicable AGENTS.md + `.agents/instructions/tests.instructions.md` (matches `**/*.test.ts`) printed by `sub-loop.ts`.
  - _Requirements: REQ-1.4, REQ-6.1, REQ-9.3_

- [x] 3. i18n — add `phoneInvalid` key to the three label groups (REQ-5.1)
  - **`Auth` namespace** (register + backend producer):
    - `shared/locale/types/auth/index.ts`: add `phoneInvalid: string;` to the EXISTING `AuthLabels` interface (`:12`), placed next to `phoneRequired` (`:36`) and `emailInvalid` (`:35`). Do NOT create a new namespace (`Auth` handle stays at `shared/locale/namespaces/auth/auth.namespace.ts:4`).
    - `shared/locale/en/auth/index.ts`: add `phoneInvalid: "Please enter a valid phone number."` near `phoneRequired`.
    - `shared/locale/ar/auth/index.ts`: add `phoneInvalid: "يرجى إدخال رقم هاتف صحيح."` near `phoneRequired` — formal MSA, no identifiers/interpolation in copy.
  - **`AdminUsers` namespace** (admin create + edit dialogs) — add `phoneInvalid` to BOTH label groups:
    - `shared/locale/types/adminUsers/index.ts`: add `phoneInvalid: string;` inside `createDialog` next to the existing `phone` label (`:226`) AND inside `editDialog` next to `phone` (`:259`).
    - `shared/locale/en/adminUsers/index.ts` + `shared/locale/ar/adminUsers/index.ts`: add `phoneInvalid` to BOTH `createDialog` and `editDialog` with the same en/ar copy.
  - **`StudentOnboarding` namespace** (onboarding dialog):
    - `shared/locale/types/studentOnboarding/index.ts`: add `phoneInvalid: string;` inside `fields` next to the existing `phone` label (`:61`).
    - `shared/locale/en/studentOnboarding/index.ts` + `shared/locale/ar/studentOnboarding/index.ts`: add `phoneInvalid` with the same en/ar copy.
  - **Parity discipline:** there is **NO existing `auth` (or `adminUsers`/`studentOnboarding`) locale parity test** — do NOT claim one exists. Correctness is enforced at compile time: each locale object must satisfy its `*Labels` interface, so a missing en/ar key is a `tsgo` error. Do NOT invent a runtime parity test.
  - Do NOT touch `errors.validation` (`shared/locale/types/errors/labels.ts:104`) — `PHONE_TOO_LONG` reuses `errors.validation` per D5; `PHONE_INVALID` is the NEW `phoneInvalid` key in each of the three namespaces.
  - [ ] 3.QL **Quality Loop** on all nine files (`shared/locale/types/auth/index.ts`, `shared/locale/en/auth/index.ts`, `shared/locale/ar/auth/index.ts`, the `adminUsers` type+en+ar trio, the `studentOnboarding` type+en+ar trio)
    - `bun run scripts/health/sub-loop.ts <each file> --lifecycle duplicates` → exit 0
  - [ ] 3.TE **Test Engineering** — no runtime locale-parity test exists or is added; the compile-time `*Labels` gate (exercised by `tsgo` via `3.QL`) proves every en/ar implementation carries the new key. Assert each new key is a static leaf (typed `string`, not `(...)=>string`).
  - [ ] 3.SEC **Security & Tenancy Audit** — copy contains no PII placeholders, no identifiers, no raw-input interpolation (REQ-9.3 alignment); review-able in both locales.
  - [ ] 3.SR **Semantic Review** — no `Translation.` enum, no two-arg `getTranslations`; each `*Labels` interface change is additive only; both locale objects implement the new key in all three namespaces; no dead key.
  - [ ] 3.IV **Instruction Verification** — read `shared/locale/AGENTS.md` + `shared/AGENTS.md` + root AGENTS.md.
  - _Requirements: REQ-5.1, REQ-5.3, REQ-9.3_

## Phase 2 — Backend Validation

- [x] 4. Cross-actor registration journey test (**TEST-FIRST — RED before Tasks 5–7 GREEN**) (REQ-6.4)
  - CREATE `test/workflows/auth/registration-phone.journey.test.ts` — NEW file, authored BEFORE the backend helper/schema wiring so the test drives the contract. Real services + real DB; committed fixtures in `beforeAll`; tracked hard-delete in `afterAll`; **NO `runInRollback`**; spy on any notification dispatch (never hit real channels). `test/workflows/auth/` is a NEW domain subdirectory — explicitly permitted by `test/workflows/AGENTS.md` rule 10 (`test/workflows/<domain>/<workflow>.test.ts`).
  - Actors cast (real roles, never monkey-patched): **Guest** (unauthenticated registrant), **Student/Teacher/Parent** (registrant roles), **Authenticated Admin**, **System/Backend** (validator). Authorization resolves honestly via real user roles.
  - Encode each step as `actor → action → expected shared-state change + denial`:
    1. Guest → `registerUser` (via `@/backend/services/auth/registration.service`) with `phone: ""` (cannot be omitted — `RegistrationSubmitInput.phone` is a REQUIRED `string`, `backend/types/users/registration.types.ts:45`) → reject `ValidationError` with `fields[0].code === "PHONE_REQUIRED"` (`registration.service.ts:213-215`).
    2. Guest → `registerUser` with phone `"12345"` (no `+`, too short) → reject `code === "PHONE_INVALID"` (**RED until Tasks 5+6 wire the helper + Task 3 ships the key**).
    3. Guest → `registerUser` with a 17-char phone → reject `code === "PHONE_TOO_LONG"` and message === `errors.validation` (`user-management.helpers.ts:30` precedent).
    4. Guest → `registerUser` with valid E.164 `+201234567890` → SUCCESS; assert the persisted `users.phone` equals the submitted valid value; response carries the created user id.
    5. Guest → `registerUser` replaying as **Student**, **Teacher**, **Parent** (valid phone each) → SUCCESS for all three registrant roles (cross-actor coverage).
    6. Authenticated Admin → `createUser` (`@/backend/services/admin/user-management.service` `:261`) with invalid phone → reject `PHONE_INVALID`.
    7. Authenticated Admin → `createUser` valid phone → SUCCESS; `updateUser` (`:331`) with too-long phone → reject `PHONE_TOO_LONG`.
    8. Admin → student onboarding (`@/backend/services/admin/student-onboarding.service` `:293` → `createUser` `:322`) with invalid phone → reject `PHONE_INVALID` (**inherits** — REQ-4.4, no new code).
    9. Non-admin / GuEST caller → admin `createUser` → DENIED (assert the real authorization rejection — `FORBIDDEN`/`UNAUTHORIZED`; resolution is honest, not mocked).
  - Track every created user id/email in a `createdIds` array and hard-delete them in `afterAll`; assert the table is clean afterwards.
  - Run: `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts` until green, then `bun run test` (workflows via the mandated runner — NEVER raw `bun test`).
  - [ ] 4.QL **Quality Loop** on `test/workflows/auth/registration-phone.journey.test.ts`
    - `bun run scripts/health/sub-loop.ts test/workflows/auth/registration-phone.journey.test.ts --lifecycle duplicates` → exit 0
  - [ ] 4.TE **Test Engineering** — all 9 steps asserted; the three registrant roles (step 5); the inheritance proof (step 8); the denial probe (step 9); committed fixtures + tracked `afterAll` cleanup; NO `runInRollback`; notification boundary spied.
  - [ ] 4.SEC **Security & Tenancy Audit** — REQ-9.1: the journey proves client-invalid phones are rejected server-side; REQ-9.2: step 7 asserts update does not mass-assign unchecked fields (phone-only patch); actor identities come from fixture-created users only.
  - [ ] 4.SR **Semantic Review** — read `test/workflows/AGENTS.md` for the exact journey harness before authoring; no PII in assertions; no `console.*`; no production time-mock; cleanup is real (not a transaction rollback).
  - [ ] 4.IV **Instruction Verification** — read `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md` + root AGENTS.md.
  - _Requirements: REQ-6.4, REQ-4.4, REQ-9.1, REQ-9.2_

- [x] 5. Shared backend phone-validation helper — `backend/services/shared/phone-validation.helpers.ts` (REQ-4.1, REQ-5.2, REQ-9.1, REQ-9.3)
  - CREATE `backend/services/shared/phone-validation.helpers.ts` exporting `validatePhoneField(value: string, locale: string): ApiFieldErrorType | null` built on `phoneSchema` from `@/shared/lib/phone`:
    - Register it on the live barrel `backend/services/shared/index.ts` (currently `export * from "./recitation-catalog.service"; export * from "./user-provisioning.helpers";`) by adding `export * from "./phone-validation.helpers";` so consumers import `validatePhoneField` from `@/backend/services/shared` — NOT a deep path.
    - `const parsed = phoneSchema.safeParse(value);`
    - on success → `return null;`
    - on failure → read the FIRST issue's `message` CODE (`PHONE_REQUIRED` / `PHONE_TOO_LONG` / `PHONE_INVALID`), map to a localized string, and return `{ field: "phone", code: <code>, message: <localized> }` typed as `ApiFieldErrorType` (`@/backend/types/errors/api-error.types.ts:55` — `{ readonly field; readonly code; readonly message }`, message fully localized at producer).
    - Localization: `getServerTranslations(locale)` single-arg from `@/shared/locale/server-graphql` → `.authTranslations.phoneRequired` / `.authTranslations.phoneInvalid` (NEW key, Task 3) and `.errorsTranslations.validation` for `PHONE_TOO_LONG` (D5). NEVER hardcode user-facing text.
    - `field` is always the literal `"phone"` (never echo the raw value — REQ-9.3); the returned `message` never contains the input.
  - CREATE `backend/services/shared/phone-validation.helpers.test.ts` (colocated) covering the mapping branches and the localized output in en + ar.
  - [ ] 5.QL **Quality Loop** on both files
    - `bun run scripts/health/sub-loop.ts <each file> --lifecycle duplicates` → exit 0
  - [ ] 5.TE **Test Engineering** — Tier 1: all four outcomes (valid → null, required, too-long, invalid) for both locales; Tier 2: boundary lengths (16 vs 17), empty/whitespace; Tier 3: fuzz payloads never throw; Tier 4: assert `message` never contains the raw input string and `field` is always `"phone"`. No DB (pure helper) → `runInRollback` N/A.
  - [ ] 5.SEC **Security & Tenancy Audit** — REQ-9.1: the helper is the server's validation gate (client validation is advisory only); REQ-9.3: assert the returned `message` equals the localized template and contains no substring of the hostile input.
  - [ ] 5.SR **Semantic Review** — `ApiFieldErrorType` imported from `@/backend/types` (never redefined locally); no service-layer `.types.ts` file created; `getServerTranslations` single-arg + property access; no `console.*`; no dead branch.
  - [ ] 5.IV **Instruction Verification** — read `backend/services/AGENTS.md`, `backend/AGENTS.md`, root AGENTS.md, `backend.instructions.md`.
  - _Requirements: REQ-4.1, REQ-4.5, REQ-5.2, REQ-9.1, REQ-9.3, REQ-9.4, REQ-9.5_

- [x] 6. Wire shared helper into registration — `backend/services/auth/registration.service.ts` (REQ-4.2)
  - EXTEND internal `validateInput(input, locale)` (`:199-247`): REPLACE the phone check at `:213-215` (which emits `{ field: "phone", code: "PHONE_REQUIRED", message: t.phoneRequired }`) with a call to `validatePhoneField(input.phone, locale)`; if it returns non-null, push it into `entries`. Preserve the existing throw at `:244-246` (`throw new ValidationError(entries[0].message, entries)`) and every OTHER field check unchanged.
  - Do NOT change `registerUser(input, locale, outerTx?)` (`:80`) or `createAdminUser(input, locale, outerTx?)` (`:134`) signatures — both funnel through `validateInput`, so both inherit the new phone validation automatically.
  - Import `validatePhoneField` from `@/backend/services/shared` (the barrel registered in Task 5; the helper is shared by auth + admin).
  - EXTEND `backend/services/auth/registration.service.test.ts` (colocated) with phone cases: missing → `PHONE_REQUIRED`; `"12345"` → `PHONE_INVALID`; 17-char → `PHONE_TOO_LONG` (message === `errors.validation`); valid E.164 → no phone entry; assert `fields[]` shape matches `ApiFieldErrorType` and `field === "phone"`.
  - [ ] 6.QL **Quality Loop** on `backend/services/auth/registration.service.ts` and its test
    - `bun run scripts/health/sub-loop.ts <each file> --lifecycle duplicates` → exit 0
  - [ ] 6.TE **Test Engineering** — Tier 1: all four phone outcomes through `validateInput`; Tier 2: boundaries (16 vs 17, empty, whitespace); Tier 3: concurrent `registerUser` calls with fuzz phones (`Promise.allSettled`) never corrupt `entries`; Tier 4: assert `fields[0].message` never contains the hostile input (REQ-9.3). Tests use `runInRollback` + `tx` propagation where they touch the DB; `expectRepoError` try/catch pattern (never `.rejects.toThrow()` inside `runInRollback`).
  - [ ] 6.SEC **Security & Tenancy Audit** — REQ-9.1: registration validates server-side regardless of any client check; assert a client that sends a bypassed-but-invalid phone is still rejected. No raw input echoed in any error entry.
  - [ ] 6.SR **Semantic Review** — no duplicate phone check left inline; `entries[0]` ordering deterministic; no `console.*`; no change to transaction semantics; `validatePhoneField` is the single source of phone truth.
  - [ ] 6.IV **Instruction Verification** — read `backend/services/AGENTS.md`, `backend/AGENTS.md`, root AGENTS.md, `backend.instructions.md`.
  - _Requirements: REQ-4.2, REQ-4.5, REQ-9.1, REQ-9.3, REQ-9.4, REQ-9.5_

- [x] 7. Wire shared helper into admin create/update; verify onboarding inheritance (REQ-4.3, REQ-4.4, REQ-9.1, REQ-9.2)
  - `backend/services/admin/user-management.helpers.ts`:
    - **Real signatures (do not invent):** `validateCreateInput(input: AdminCreateUserSubmitInput, locale: string): void` (`:147`) and `validateUpdatePatch(patch: AdminUserUpdateDbPatch, locale: string): void` (`:207`). `AdminUpdateUserPatch` and `AdminRegistrationSubmitInput` are the WRONG types here.
    - REPLACE the inline phone block in `validateCreateInput` (`:147`; phone `:163-167` → `PHONE_REQUIRED` / `PHONE_TOO_LONG` with `tErrors.validation`) with `validatePhoneField(input.phone, locale)` (now also yields `PHONE_INVALID` via `auth.phoneInvalid`, D5).
    - REPLACE the length-only phone check in `validateUpdatePatch` (`:207`; `:217-218`) — the existing guard is `typeof patch.phone === "string"` — keeping that SAME guard shape, but routing the non-empty value through `validatePhoneField(patch.phone, locale)`. `patch.phone` is `string | null | undefined` (nullable-without-notNull schema shape, see the `:187-198` docblock): `null`/`undefined` = "leave alone" (skip), and an EMPTY STRING still **CLEARS** the stored phone — so validate ONLY when the value is non-empty (never emit `PHONE_REQUIRED` on the update path).
    - Resolve the `MAX_PHONE_LENGTH = 20` constant: it is declared PRIVATE (non-exported) at `:30` and referenced only in-file at `:165` and `:217`. After wiring both call sites it may become UNUSED — if so, remove it (and any test referencing it); if still referenced, leave it. Do not leave dead code (`SR` will flag).
  - `backend/services/admin/user-management.service.ts` `createUser` (`:261`) / `updateUser` (`:331`): NO signature change — they consume the helpers. Confirm the update path does NOT `{ ...patch }`-spread into Drizzle (`set()`); phone must be explicitly assigned after validation (BOPLA — REQ-9.2). Extend only if a spread is found.
  - **REQ-4.4 — onboarding inheritance (VERIFY, no code change):** `backend/services/admin/student-onboarding.service.ts:293` delegates to `createUser` (`:322`), so onboarding inherits phone validation through `validateCreateInput`. Add an explicit assertion in the colocated test proving onboarding rejects an invalid phone with `PHONE_INVALID` — no service file is modified for this.
  - EXTEND `backend/services/admin/user-management.helpers.test.ts` (colocated): create with missing/`"12345"`/17-char/valid phone; update-patch with absent phone (skip), `null` phone (skip), empty-string phone (clears, no error), invalid phone (reject), valid phone (pass); onboarding delegation inheritance.
  - [ ] 7.QL **Quality Loop** on `backend/services/admin/user-management.helpers.ts`, `backend/services/admin/user-management.service.ts`, and the test
    - `bun run scripts/health/sub-loop.ts <each file> --lifecycle duplicates` → exit 0
  - [ ] 7.TE **Test Engineering** — Tier 1: every branch of `validateCreateInput`/`validateUpdatePatch` phone logic (including the absent-phone skip); Tier 2: boundaries `MAX_PHONE_LENGTH` 16 vs 17, empty/whitespace, `undefined`; Tier 3: fuzz + concurrent create/update (`Promise.allSettled`); Tier 4: assert no mass-assignment (an update patch carrying extra fields like `role`/`id` does NOT write them). DB-touching cases use `runInRollback` + `tx`; `expectRepoError` try/catch.
  - [ ] 7.SEC **Security & Tenancy Audit** — **BOPLA (REQ-9.2):** verify `updateUser` maps an explicit allow-list of patchable fields; no `{ ...patch }` into `update().set()`. **BFLA/tenancy:** `createUser`/`updateUser` are admin-only callers; assert a non-admin cannot reach them (authorization resolution honest). **REQ-9.1:** validation happens server-side before any write.
  - [ ] 7.SR **Semantic Review** — no leftover inline phone check; `MAX_PHONE_LENGTH` either removed-if-dead or still-used (no dead constant); patch semantics preserved (absent ≠ required); no `console.*`; no cross-layer import.
  - [ ] 7.IV **Instruction Verification** — read `backend/services/AGENTS.md`, `backend/AGENTS.md`, `backend/types/AGENTS.md`, root AGENTS.md, `backend.instructions.md`.
  - _Requirements: REQ-4.3, REQ-4.4, REQ-4.5, REQ-9.1, REQ-9.2, REQ-9.5_

## Phase 3 — Frontend Component

- [x] 8. Reusable `PhoneInput` component — `frontend/components/ui/PhoneInput.tsx` (REQ-2.1, REQ-2.2, REQ-2.3)
  - CREATE `frontend/components/ui/PhoneInput.tsx` as a FLAT file (matching the `frontend/components/ui/fieldError.ts` / `focusRing.ts` convention — no folder, no barrel).
  - `export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(props, ref) { ... });` with an explicit `Readonly<PhoneInputProps>` prop interface (REQ-2.1), mirroring the `PasswordField` precedent at `frontend/components/AuthFormShared.tsx:77-153` (explicit prop interface wrapping a MUI `TextField`):
    - `label?: string` (OPTIONAL — the admin create/edit/onboarding sites render their OWN external `AdminDialogFieldLabel` above the field, so `PhoneInput` must not force a label) · `value?: string` · `onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>` (matches MUI `TextField`'s change handler AND RHF's `register` output) · `onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>` · `startAdornment?: React.ReactNode` (the register field carries a `PhoneIcon` `startAdornment` at `RegisterIdentityFields.tsx:79-82`) · `name?: string` · `required?: boolean` · `fullWidth?: boolean` (default `true`) · `error?: boolean` · `helperText?: React.ReactNode` · `autoComplete?: string` (default `"tel"`) · `disabled?: boolean` · `id?: string` · `"aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling"` · `inputRef?: React.Ref<HTMLInputElement>`
  - Must support BOTH `{...register("phone")}` spread (RHF supplies `name`/`onChange`/`onBlur`/`ref`) AND fully controlled usage (`value` + `onChange`; the admin surfaces use this mode). The forwarded/`inputRef` ref must land on MUI `TextField`'s TOP-LEVEL `inputRef` prop (NOT inside `slotProps.input`), which is the documented way to reach the underlying `<input>`.
  - Render MUI `TextField` (REQ-2.2, REQ-2.3):
    - `type="tel"`, `inputMode="tel"`, `autoComplete={autoComplete}` (default `"tel"`).
    - `slotProps={{ htmlInput: { dir: "ltr" } }}` — bidi safety so an Arabic (RTL) UI still renders the phone left-to-right (mirrors the `dir: "ltr"` used at `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx:79-89`).
    - `helperText={helperText ?? " "}` with `slotProps.formHelperText` carrying `aria-live="polite"` — reserves layout space (no shift) and announces validation text (precedent `AuthFormShared.tsx` PasswordField).
    - `error={error}` and pass `aria-invalid` through (`aria-invalid={ariaInvalid ?? undefined}`); forward id/name.
  - **NO validation logic inside** — the component never calls `isValidPhone`; callers own validation. No `console.*`; no hardcoded colors (use theme palette / Material-3 `on<Color>` if any color is needed); MUI style props go in `sx` only.
  - Types: import `TextFieldFieldErrorProps`/`EMPTY_FIELD_ERROR_PROPS` from `frontend/components/ui/fieldError.ts` as needed for prop compatibility with the server-error projection (the component exposes `error`/`helperText`/`aria-invalid` — the exact props `textFieldErrorProps` at `fieldError.ts:107` emits). Do NOT import anything from `@/backend`.
  - [ ] 8.QL **Quality Loop** on `frontend/components/ui/PhoneInput.tsx`
    - `bun run scripts/health/sub-loop.ts frontend/components/ui/PhoneInput.tsx --lifecycle duplicates` → exit 0
  - [ ] 8.TE **Test Engineering** — the repo has NO frontend render-test tier (documented at `frontend/components/ui/fieldError.test.ts:2-13`; UI is E2E-only). Therefore no colocated render test is authored; instead (a) `tsgo` proves the prop contract in `8.QL`, (b) Task 9's Storybook story exercises both spread and controlled modes visually, (c) integration correctness is covered by the journey test (Task 4) + wire test (Task 15). Assert the component imports nothing from `@/backend` (`rg "@/backend" frontend/components/ui/PhoneInput.tsx` → 0).
  - [ ] 8.SEC **Security & Tenancy Audit** — no client validation is treated as a trust boundary (REQ-9.1 aligns: this component only presents input; the server validates). No secrets, no `dangerouslySetInnerHTML`, helperText rendered as React node (no raw HTML injection).
  - [ ] 8.SR **Semantic Review** — `forwardRef` display name set; `Readonly<>` props; no MUI style props outside `sx`; no `FormEvent` (React 19); no hardcoded colors; no cross-layer import; no dead props.
  - [ ] 8.IV **Instruction Verification** — read `frontend/AGENTS.md`, root AGENTS.md, `frontend.instructions.md` (printed by `sub-loop.ts`).
  - _Requirements: REQ-2.1, REQ-2.2, REQ-2.3, REQ-6.5, REQ-9.1_

- [x] 9. Storybook story — `frontend/stories/ui/PhoneInput.stories.tsx` (REQ-2.4)
  - CREATE `frontend/stories/ui/PhoneInput.stories.tsx` with `title: "Form/PhoneInput"` and a default meta `component: PhoneInput`. Stories: Default (empty, spread-style props), Required, WithValue (controlled `+201234567890`), ErrorState (`error` + helper text "Please enter a valid phone number."), Disabled, RTL context wrapper (renders correctly LTR inside an RTL container).
  - Match the existing stories house style (`frontend/stories/ui/*`); use MUI `Stack` with `sx` spacing; no hardcoded colors; no `console.*`.
  - [ ] 9.QL **Quality Loop** on `frontend/stories/ui/PhoneInput.stories.tsx`
    - `bun run scripts/health/sub-loop.ts frontend/stories/ui/PhoneInput.stories.tsx --lifecycle duplicates` → exit 0
  - [ ] 9.TE **Test Engineering** — verify the story compiles under the Storybook/Vitest story build (`bun run storybook` build or the repo's storybook test command); confirm both controlled and spread prop shapes are exercised. No render-assert test tier exists.
  - [ ] 9.SEC **Security & Tenancy Audit** — story uses placeholder data only; never hardcode real PII; no network calls.
  - [ ] 9.SR **Semantic Review** — `title` exactly `"Form/PhoneInput"`; story args typed against `PhoneInputProps`; no MUI style props outside `sx`; no dead stories.
  - [ ] 9.IV **Instruction Verification** — read `frontend/AGENTS.md`, root AGENTS.md, `frontend.instructions.md`.
  - _Requirements: REQ-2.4, REQ-6.5_

## Phase 4 — Frontend Integration

- [x] 10. Registration form integration — `frontend/views/auth/register/RegisterIdentityFields.tsx` (REQ-3.1, REQ-5.2)
  - REPLACE the raw phone `TextField` at `:69-85` with `<PhoneInput label={t.phone} startAdornment={<PhoneIcon ... />} ... />` from `@/frontend/components/ui/PhoneInput` (preserve the existing `PhoneIcon` `startAdornment` at `:79-82` via the new `startAdornment` prop); spread the RHF field `{...register("phone", { required: t.phoneRequired, validate: v => (isValidPhone(v) ? true : t.phoneInvalid) })}` — mirroring the email analogy at `:49-68` (`validate: v => (isValidEmailShape(v) ? true : t.emailInvalid)`).
  - Import `isValidPhone` from `@/shared/lib/phone` (shared predicate — the frontend's advisory copy of the server rule; server remains authoritative, REQ-9.1).
  - `t.phoneInvalid` is the NEW key (Task 3) read off the existing `AuthLabels` object already threaded into this component as the `t` prop (`RegisterIdentityFieldsProps.t`) — the parent register form sources it via `const t = useAppTranslation(Auth)` (namespace HANDLE `Auth` imported from `@/shared/locale/namespaces/auth`; NEVER the string `"Auth"`). `t.phoneRequired` remains in the `required` rule. Do NOT change `REGISTER_FIELD_PATHS` (`registerFormUtils.ts:20-29` keeps `"phone"`), the values map (`:63-72`), or the `isValidEmailShape` re-export (`:15`).
  - Server-error projection is UNCHANGED: `useRegisterSubmit.ts` still trims (`:48`) and projects server `fields[]` via `frontend/lib/mutationFieldErrors.ts` (`applyProjectedFieldErrors`) → `frontend/components/ui/fieldError.ts` (`textFieldErrorProps`); `PhoneInput` accepts the emitted `error`/`helperText`/`aria-invalid` props so projection keeps working (REQ-5.2 both directions: client `t.phoneInvalid`, server `auth.phoneInvalid`).
  - [ ] 10.QL **Quality Loop** on `frontend/views/auth/register/RegisterIdentityFields.tsx`
    - `bun run scripts/health/sub-loop.ts frontend/views/auth/register/RegisterIdentityFields.tsx --lifecycle duplicates` → exit 0
  - [ ] 10.TE **Test Engineering** — no render-test tier exists (repo is E2E-only). Coverage is: Task 4 journey (server rejection), Task 15 wire test (`PHONE_INVALID` field error surfaced), and the existing register E2E if present. Verify `rg "@hookform/resolvers" frontend/` → 0 (D3 honored) and `rg "isValidPhone" frontend/views/auth/register/` → present.
  - [ ] 10.SEC **Security & Tenancy Audit** — REQ-9.1: the inline `validate` is advisory; assert no code path treats client validity as authorization. Field errors come only from `projectMutationFieldErrors` (no raw server message rendered unescaped).
  - [ ] 10.SR **Semantic Review** — no leftover raw phone TextField; `REGISTER_FIELD_PATHS` still includes `"phone"`; no `console.*`; no cross-layer import; `sx`-only styling; `PhoneInput` used (not a duplicate inline component).
  - [ ] 10.IV **Instruction Verification** — read `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, root AGENTS.md, `frontend.instructions.md`.
  - _Requirements: REQ-3.1, REQ-3.5, REQ-5.2, REQ-5.3, REQ-9.1_

- [x] 11. Admin create-user dialog integration — `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx` (REQ-3.2)
  - **This surface is CONTROLLED — it is NOT react-hook-form.** The component owns no `useForm`/`register`/`validate`; it receives `labels: AdminUsersLabels`, `form: CreateUserFormState`, `setForm: Dispatch<SetStateAction<CreateUserFormState>>`, and `fieldErrors: Record<string, string>` (see the `:38-43` props interface). Do NOT introduce RHF here.
  - REPLACE the phone `TextField` at `:79-89` with controlled `<PhoneInput value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} error={phoneError} helperText={phoneErrorText} aria-invalid={phoneError} />`; remove the now-redundant inline `slotProps={{ htmlInput: { dir: "ltr" } }}` (the component supplies it internally, REQ-2.2). KEEP the existing external `AdminDialogFieldLabel` row at `:78` (that is why `PhoneInput.label` is optional).
  - Client validation is COMPUTED from the shared predicate, not registered: `const phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone);` then `phoneError = Boolean(fieldErrors.phone) || phoneClientError` and `phoneErrorText = fieldErrors.phone ?? (phoneClientError ? labels.createDialog.phoneInvalid : " ")`. Import `isValidPhone` from `@/shared/lib/phone`; read the message from the EXISTING `labels.createDialog.phoneInvalid` (Task 3, `AdminUsers` namespace — no hook is needed because `labels` is already a prop).
  - The server `fieldErrors.phone` projection stays AUTHORITATIVE and UNCHANGED (`frontend/lib/mutationFieldErrors.ts` fills `fieldErrors` from `createUser` errors); it takes precedence over the client hint above.
  - Do NOT introduce a country selector or dial-code dropdown (that is #230, D10; the absence is documented at `frontend/views/admin/users/dialogs/CreateUserDialog.tsx:23-27`).
  - [ ] 11.QL **Quality Loop** on `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx`
    - `bun run scripts/health/sub-loop.ts frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx --lifecycle duplicates` → exit 0
  - [ ] 11.TE **Test Engineering** — no render tier (REPO HAS NO FRONTEND RENDER TEST TIER — UI is E2E-only); coverage via Task 4 journey step 6 and Task 15 wire test. Verify the old raw TextField is gone and `PhoneInput` is imported.
  - [ ] 11.SEC **Security & Tenancy Audit** — admin-only surface; client validation advisory (REQ-9.1); server `validateCreateInput` is authoritative (Task 7).
  - [ ] 11.SR **Semantic Review** — no RHF `useForm`/`register` introduced; no duplicate `dir: ltr`; no invented i18n key (`labels.createDialog.phoneInvalid` ships in Task 3); no cross-layer import; `sx`-only styling; no `console.*`.
  - [ ] 11.IV **Instruction Verification** — read `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, root AGENTS.md, `frontend.instructions.md`.
  - _Requirements: REQ-3.2, REQ-3.5, REQ-9.1_

- [x] 12. Admin edit-user dialog integration — `frontend/views/admin/users/dialogs/EditUserFormFields.tsx` (REQ-3.3)
  - **This surface is CONTROLLED — it is NOT react-hook-form.** The component receives `labels: AdminUsersLabels`, `form: EditUserFormState`, `setForm`, `formError`, `fieldErrors` (see the `:32-38` props interface). Do NOT introduce RHF here.
  - REPLACE the phone `TextField` at `:63-75` with controlled `<PhoneInput value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} error={phoneError} helperText={phoneErrorText} aria-invalid={phoneError} />`; remove the inline `slotProps={{ htmlInput: { dir: "ltr" } }}` (component-supplied). KEEP the existing external `AdminDialogFieldLabel` row at `:64`.
  - Client validation is COMPUTED from the shared predicate: `const phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone);` then `phoneError = Boolean(fieldErrors.phone) || phoneClientError` and `phoneErrorText = fieldErrors.phone ?? (phoneClientError ? labels.editDialog.phoneInvalid : " ")`. Import `isValidPhone` from `@/shared/lib/phone`; message from the EXISTING `labels.editDialog.phoneInvalid` (Task 3, `AdminUsers` namespace).
  - Patch semantics: an EMPTY phone in this dialog means "clear the stored phone" (the server treats empty/null as clear, Task 7) — so do NOT mark the field unconditionally `required` and do NOT flag empty as an error; the client rule fires only on a non-empty-but-invalid value. Preserve the server `updateUser` `fieldErrors.phone` projection (`frontend/lib/mutationFieldErrors.ts`) as authoritative.
  - [ ] 12.QL **Quality Loop** on `frontend/views/admin/users/dialogs/EditUserFormFields.tsx`
    - `bun run scripts/health/sub-loop.ts frontend/views/admin/users/dialogs/EditUserFormFields.tsx --lifecycle duplicates` → exit 0
  - [ ] 12.TE **Test Engineering** — no render tier (UI is E2E-only); coverage via Task 4 journey step 7 and Task 15 wire test `updateUser` phone rejection. Verify the raw TextField is replaced and the `required` flag state is preserved.
  - [ ] 12.SEC **Security & Tenancy Audit** — admin-only surface (BFLA); client validation advisory (REQ-9.1); the update path never mass-assigns (server-side BOPLA gate, REQ-9.2 — Task 7).
  - [ ] 12.SR **Semantic Review** — no RHF introduced; patch semantics preserved (empty = clear, absent ≠ required); no cross-layer import; `sx`-only styling; no `console.*`; no leftover raw TextField.
  - [ ] 12.IV **Instruction Verification** — read `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, root AGENTS.md, `frontend.instructions.md`.
  - _Requirements: REQ-3.3, REQ-3.5, REQ-9.1, REQ-9.2_

- [x] 13. Student onboarding integration — `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` (REQ-3.4)
  - **This surface is CONTROLLED and renders its identity fields in a loop.** All four identity fields are rendered by `identityFields.map(field => ...)` at `:110-127` (the data array is declared at `:73-100`; the phone entry is `:87-93` with `errorKey: "phone"` and `ltr: true`). The `:87-93` lines are the DATA ARRAY, not the JSX — do NOT treat this as a plain single-`TextField` replacement.
  - BRANCH INSIDE THE MAP on the phone row: `field.errorKey === "phone"` → render the controlled `<PhoneInput value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} disabled={submitting} error={phoneError} helperText={phoneErrorText} aria-invalid={phoneError} />`; every other `errorKey` keeps the existing `<TextField>` branch. (Alternatively hoist the phone row OUT of the loop — but keep the label row and grid placement identical.) Remove the `ltr: true` handling for phone (component-supplied) only if the phone row leaves the generic TextField path.
  - Client validation is COMPUTED from the shared predicate (import `isValidPhone` from `@/shared/lib/phone`): `const phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone);` then `phoneError = Boolean(fieldErrors.phone) || phoneClientError` and `phoneErrorText = fieldErrors.phone ?? (phoneClientError ? t.fields.phoneInvalid : " ")`. `t` is the existing `useAppTranslation(StudentOnboarding)` handle at `:69` (namespace HANDLE, never the string); `t.fields.phoneInvalid` is the NEW `StudentOnboarding` key (Task 3).
  - Preserve the onboarding step's field-error projection from server errors (`frontend/lib/mutationFieldErrors.ts`); the backend onboarding path inherits phone validation via `createUser` (`student-onboarding.service.ts:293`→`:322`; REQ-4.4), so the projected `PHONE_INVALID` field error (`fieldErrors.phone`) must surface on this `PhoneInput` and stay authoritative over the client hint.
  - Do NOT add any dial-code/country UI (D10).
  - [ ] 13.QL **Quality Loop** on `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx`
    - `bun run scripts/health/sub-loop.ts frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx --lifecycle duplicates` → exit 0
  - [ ] 13.TE **Test Engineering** — no render tier (UI is E2E-only); coverage via Task 4 journey step 8 (onboarding inherits `PHONE_INVALID`) and the wire test. Verify the raw phone TextField row is replaced by the branched `PhoneInput` and `PhoneInput` is imported.
  - [ ] 13.SEC **Security & Tenancy Audit** — admin-only onboarding surface (BFLA); server-side inheritance is the authoritative gate (REQ-4.4, REQ-9.1); assert no client-supplied role/tenant id is trusted from this form.
  - [ ] 13.SR **Semantic Review** — the map branch covers `errorKey === "phone"` without disturbing the other three rows; no RHF introduced; no cross-layer import; `sx`-only styling; no `console.*`; no leftover raw phone TextField; i18n key exists (`t.fields.phoneInvalid` shipped in Task 3).
  - [ ] 13.IV **Instruction Verification** — read `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, root AGENTS.md, `frontend.instructions.md`.
  - _Requirements: REQ-3.4, REQ-3.5, REQ-4.4, REQ-9.1_

## Phase 5 — Tests, Wire & Journey Consolidation

- [x] 14. Backend service validation tests (4-tier consolidation) (REQ-6.2)
  - CONSOLIDATE/EXPAND the colocated backend tests for phone validation:
    - `backend/services/auth/registration.service.test.ts` — phone branches via `registerUser` and `createAdminUser` (both funnel through `validateInput`, Task 6).
    - `backend/services/admin/user-management.helpers.test.ts` — `validateCreateInput` / `validateUpdatePatch` phone branches + the onboarding-inheritance assertion (Task 7).
  - Apply the 4-Tier framework explicitly (see Task 6/7 subtasks for the per-tier intent): Tier 1 branch/statement 100% over the phone paths; Tier 2 boundaries (16 vs 17, empty, whitespace, `undefined` patch); Tier 3 fuzz + concurrent `Promise.allSettled`; Tier 4 abuse (hostile payloads never echoed; no mass-assignment).
  - All DB-touching service tests use `runInRollback` + `tx` propagation to every repository call; `expectRepoError` try/catch — NEVER `expect(...).rejects.toThrow()` inside `runInRollback` (deadlock). Mock any external channels.
  - Run: `bun run test:services` (parallel runner) until green; then `bun run test:services:sequential` once to rule out ordering effects.
  - [ ] 14.QL **Quality Loop** on both test files
    - `bun run scripts/health/sub-loop.ts <each file> --lifecycle duplicates` → exit 0
  - [ ] 14.TE **Test Engineering** — this task IS the aggregate backend test task; assert the two files jointly exercise every phone code (`PHONE_REQUIRED`, `PHONE_TOO_LONG`, `PHONE_INVALID`) in en and ar, plus the valid path.
  - [ ] 14.SEC **Security & Tenancy Audit** — Tier 4 asserts BOPLA (no extra-field write) and REQ-9.3 (no raw-input echo) at the service boundary.
  - [ ] 14.SR **Semantic Review** — no seed-data queries (create fixtures via `entity-setup.ts` helpers); verify helper signatures before use; no `console.*`; no production code changed in this task.
  - [ ] 14.IV **Instruction Verification** — read `backend/services/AGENTS.md`, `backend/AGENTS.md`, `backend/db/test/AGENTS.md`, root AGENTS.md, `backend.instructions.md`, `tests.instructions.md`.
  - _Requirements: REQ-6.2, REQ-9.2, REQ-9.3_

- [x] 15. GraphQL wire test — `frontend/graphql/test/auth/*.test.ts` (REQ-6.3)
  - AUTHOR/EXTEND the auth-domain GraphQL wire test (locate the existing file under `frontend/graphql/test/auth/` — verify the exact path first; do NOT create a duplicate suite). Setup via `setupTestServerLifecycle()` + execute via `testClient` from `@/test/helpers`; REUSE the existing documents in `frontend/graphql/sharedDocuments/auth/auth.documents.ts` wherever possible (registration + admin create/update mutations already exist).
  - **Codegen scope (D7 clarified):** the SDL does NOT change, so `bun run generate:gqlSchema` is NOT needed. `bun codegen` regenerates TypeScript from DOCUMENTS + schema — only run it if a genuinely NEW GraphQL document/selection was added to `auth.documents.ts`; a pure reuse of existing documents requires NO codegen step.
  - Assert: sending an invalid phone through the registration mutation (`RegisterUserInput`) returns a GraphQL error whose `extensions.fields[]` contains `{ field: "phone", code: "PHONE_INVALID" }`; missing phone → `PHONE_REQUIRED`; 17-char → `PHONE_TOO_LONG`. Mirror for `AdminCreateUserInput` (admin token) with an invalid phone → `PHONE_INVALID`; and the admin update mutation too-long → `PHONE_TOO_LONG`.
  - Assert the SDL is UNCHANGED (D7): `phone` remains `String!` on the registration input and `String` on the read type — a small schema-surface assertion (e.g. the existing SDL test under `backend/graphql/test/*.sdl.test.ts` using in-process `graphQLSchema`) confirms no `Phone` scalar type was introduced.
  - Run: `bun run test:graphql` (dev server via `test/scripts/run-server-tests.ts`).
  - [ ] 15.QL **Quality Loop** on the wire-test file
    - `bun run scripts/health/sub-loop.ts <wire-test-file> --lifecycle duplicates` → exit 0
  - [ ] 15.TE **Test Engineering** — Tier 1: each code surfaced at the wire; Tier 2: boundary lengths via the wire; Tier 4: unauthenticated caller cannot call the admin mutation (assert `UNAUTHORIZED`/`FORBIDDEN`); assert no raw input echoed in `extensions.fields[].message`.
  - [ ] 15.SEC **Security & Tenancy Audit** — BFLA: admin mutation denies non-admin/anonymous; REQ-9.3: error messages localized, never echoing input; no schema exposure of internal codes as new SDL enum.
  - [ ] 15.SR **Semantic Review** — use `testClient`, not raw fetch; every object type in documents includes `id` (Apollo normalization); NO `useLazyQuery`; hooks imported from `@apollo/client/react` if any; no manual `schema.graphql` edit (D7).
  - [ ] 15.IV **Instruction Verification** — read `frontend/graphql/AGENTS.md`, `frontend/AGENTS.md`, `backend/graphql/AGENTS.md`, root AGENTS.md, `frontend.instructions.md`, `tests.instructions.md`.
  - _Requirements: REQ-6.3, REQ-9.1, REQ-9.3, REQ-9.4_

- [x] 16. Final quality gate + traceability + deferred-items enforcement
  - **Zero-dependency proof (D3):** `git diff --stat package.json bun.lock` vs the Task 0 baseline commit → EMPTY (no `@hookform/resolvers`, no `libphonenumber`).
  - **Zero-SDL proof (D7):** `git diff --stat frontend/graphql/generated/schema.graphql` → EMPTY (no regen/codegen artifacts changed).
  - **No-shim / no-cross-layer proof:** `rg "@/backend" frontend/components frontend/views/auth frontend/views/admin | rg -v "test"` → 0 unexpected hits; `rg "@/frontend|@/backend|@/app" shared/lib/phone.ts` → 0.
  - **Dependency-cruiser / barrel check:** confirm `shared/lib/` still has NO `index.ts` barrel and no re-export shim was added.
  - **Traceability check:** `for r in $(grep -oE 'REQ-[0-9]+(\.[0-9]+)?' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done` → zero misses (including dotted sub-ids REQ-1.1..REQ-9.5).
  - **Deferred-items ledger:** `grep -cE "^\| (D[0-9]+ )?.*(❌|⚠️)" ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/deferred-items.md` → expected 0 (only 📋 child-ticket deferrals #230 / legacy backfill remain, which are intentional).
  - **Full suite:** `bun tsgo` (zero new errors vs `/tmp/baseline-tsgo.txt`) · `bun biome:check` (zero new warnings) · `bun run scripts/lint-service.ts --id final` · `bun run test:services` · `bun run test:graphql` · `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts` then `bun run test` — all green.
  - **Full gate:** `bun quality-gate` → green (resume from last failed stage on re-runs; NEVER clear caches).
  - Write `outcome/16-final-gate-outcome.md` recording the baseline delta (new errors = 0), both grep proofs, the zero-dependency/zero-SDL proofs, and the journey pass.
  - [ ] 16.QL **Quality Loop** — re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` over EVERY file touched in Tasks 1–15 as a batch → all exit 0.
  - [ ] 16.TE **Test Engineering** — full suite green; journey green; the 9-step journey asserted; confirm no workflow/DB test uses raw `bun test`.
  - [ ] 16.SEC **Security & Tenancy Audit** — REQ-9.1 (server trust boundary proven by journey + wire tests), REQ-9.2 (no mass-assignment — T4 assertions), REQ-9.3 (no raw-input echo — T4 assertions) all evidenced.
  - [ ] 16.SR **Semantic Review** — walk the full semantic checklist over every modified file one final time (tenancy, races, enums-as-values, no cross-layer imports, no dead code, `MAX_PHONE_LENGTH` resolved, deferred items logged).
  - [ ] 16.IV **Instruction Verification** — read every applicable AGENTS.md + `.agents/instructions/*` file one final time.
  - _Requirements: REQ-6.6, REQ-9.1, REQ-9.2, REQ-9.3 (all REQs via traceability)_

## Phase 6 — Knowledge Propagation

- [x] 17. Knowledge propagation + outcome + progress close-out (REQ-7.2, REQ-7.3, REQ-8.1, REQ-8.2)
  - **REQ-8.1 — canonical doc:** CREATE `docs/validation/phone-validation.md` (create the `docs/validation/` directory if absent) consolidating:
    - Why: a single shared phone contract across layers; the E.164 decision and `PHONE_MAX_LENGTH = 16` vs the `varchar(20)` column (`users.ts:17`).
    - Pattern: `shared/lib/phone.ts` (schema + predicate + normalize), the machine-code `message` convention, `backend/services/shared/phone-validation.helpers.ts` mapping code → localized `ApiFieldErrorType`, `frontend/components/ui/PhoneInput.tsx` (props, bidi `dir:"ltr"`, aria-live), and the two frontend validation modes — RHF inline `validate` (register) and controlled `isValidPhone` error computation (admin/onboarding) — with no `@hookform/resolvers`.
    - Rules: server is the trust boundary; zod `message` = machine code, never user text; `PHONE_TOO_LONG` → `errors.validation`, `PHONE_INVALID` → `auth.phoneInvalid`.
    - Anti-patterns: client-only validation; adding `libphonenumber`/dial-code data; SDL change; `{ ...input }` mass-assignment on update; echoing raw input in errors.
    - Rollout Summary + Related Documents (link `docs/billing/paymob-gateway.md` style sibling docs if relevant; link #230 CountrySelector hand-off).
  - **REQ-8.2 — skills:** evaluate whether any `.agents/skills/*/SKILL.md` documents phone/validation patterns needing an update. NOTE repo policy: `AGENTS.md` and `.agents/instructions/*.instructions.md` are hand-curated and plan work MUST NOT create or edit them. If no skill is applicable, record "REQ-8.2 not applicable — no skill documents phone validation" in the outcome.
  - **REQ-7.2 — outcome:** read ALL files in `outcome/`; write `outcome/17-knowledge-propagation-outcome.md` synthesizing learnings, cross-file maps, and carry-over items.
  - **REQ-7.3 — progress:** ensure every task checkbox in THIS file is `[x]`; if anything is incomplete, leave it `[ ]` and record the blocker.
  - [ ] 17.QL **Quality Loop** on `docs/validation/phone-validation.md` (docs are lint-light; still run for consistency) → exit 0
  - [ ] 17.TE **Test Engineering** — N/A for docs; re-verify the doc's code snippets match the shipped signatures (no drift).
  - [ ] 17.SEC **Security & Tenancy Audit** — doc contains no secrets/PII; examples use placeholder phone numbers.
  - [ ] 17.SR **Semantic Review** — no fabricated APIs in the doc; every `path:line` reference is real; no `AGENTS.md`/instructions edits.
  - [ ] 17.IV **Instruction Verification** — read root AGENTS.md + `docs/` conventions before writing.
  - _Requirements: REQ-7.2, REQ-7.3, REQ-8.1, REQ-8.2_

---

## Task Sequencing Summary

| Phase | Task | Kind | Depends on | REQs |
|---|---|---|---|---|
| 0 | 0. Baseline + outcome read | setup | — | REQ-7.1 |
| 1 | 1. `shared/lib/phone.ts` | foundation | 0 | REQ-1.1, REQ-1.2, REQ-1.3, REQ-9.1 |
| 1 | 2. `shared/lib/phone.test.ts` | tests | 1 | REQ-1.4, REQ-6.1, REQ-9.3 |
| 1 | 3. i18n `phoneInvalid` | foundation | 0 | REQ-5.1, REQ-9.3 |
| 2 | 4. Journey test (RED) | test-first | 1, 3 | REQ-6.4, REQ-4.4, REQ-9.1, REQ-9.2 |
| 2 | 5. `phone-validation.helpers.ts` | backend helper | 1, 3 | REQ-4.1, REQ-5.2, REQ-9.1, REQ-9.3 |
| 2 | 6. registration wiring | backend | 5 | REQ-4.2, REQ-9.1, REQ-9.3 |
| 2 | 7. user-management wiring + onboarding verify | backend | 5 | REQ-4.3, REQ-4.4, REQ-9.1, REQ-9.2 |
| 3 | 8. `PhoneInput.tsx` | frontend component | 0 | REQ-2.1, REQ-2.2, REQ-2.3, REQ-9.1 |
| 3 | 9. PhoneInput story | frontend | 8 | REQ-2.4 |
| 4 | 10. registration form | frontend integration | 8, 3 | REQ-3.1, REQ-5.2, REQ-9.1 |
| 4 | 11. admin create dialog | frontend integration | 8 | REQ-3.2, REQ-9.1 |
| 4 | 12. admin edit dialog | frontend integration | 8 | REQ-3.3, REQ-9.1, REQ-9.2 |
| 4 | 13. student onboarding | frontend integration | 8 | REQ-3.4, REQ-4.4, REQ-9.1 |
| 5 | 14. backend service tests | tests | 6, 7 | REQ-6.2, REQ-9.2, REQ-9.3 |
| 5 | 15. GraphQL wire test | tests/wire | 5, 6, 7 | REQ-6.3, REQ-9.1, REQ-9.3 |
| 5 | 16. final quality gate | gate | all | REQ-9.1, REQ-9.2, REQ-9.3 |
| 6 | 17. knowledge propagation | docs | 16 | REQ-7.2, REQ-7.3, REQ-8.1, REQ-8.2 |
