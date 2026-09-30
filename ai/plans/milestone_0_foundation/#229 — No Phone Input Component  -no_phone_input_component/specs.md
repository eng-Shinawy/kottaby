# Requirements — No Phone Input Component (Reusable Phone Input with Shared Zod Validation)

> **Plan directory (verbatim):** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Ticket:** GitHub issue **#229** "No Phone Input Component" — "Reusable Phone input component with validation at both frontend and backend, with shared Zod schema."
> **Milestone:** `milestone_0_foundation` (**DERIVED** — see §Milestone Derivation; the GitHub issue carries NO milestone label)
> **Specs of record:** this file · **Design:** `plan.md` (same directory) · **Tasks:** `tasks.md` (same directory) · **Ledger:** `deferred-items.md` (same directory)
> **Decision refs:** D1–D10 (frozen design decisions, carried in every artifact)

## Document Information

| Field | Value |
|---|---|
| Feature Name | No Phone Input Component (reusable phone input + shared Zod schema) |
| Milestone | M0 (`milestone_0_foundation`) — derived |
| Issue | GitHub #229 |
| Version / Date | 1.0 · 2026-09-30 |
| Plan kind | cross-layer foundation slice — ONE new `shared/lib/` module, ONE new reusable UI component, ONE new backend helper, i18n key addition, four frontend surface swaps; ZERO DB schema delta, ZERO GraphQL SDL delta |
| Hard inputs (EXISTING, verified) | `backend/db/schema/users/users.ts:17` (`phone` varchar(20), nullable) · `backend/graphql/pothos/shared/userFieldHelpers.ts:97-107` (`phone: t.string({ required: true })`) · `backend/services/auth/registration.service.ts:199-247` (`validateInput`) · `backend/services/admin/user-management.helpers.ts:30,147,207` · `shared/lib/email.ts:9` (`isValidEmail`) · `frontend/components/AuthFormShared.tsx:77-153` (`PasswordField`) · `package.json:116` (`zod ^4.6.2`) |
| Consumers (swapped to `PhoneInput`) | `frontend/views/auth/register/RegisterIdentityFields.tsx:69-85` · `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx:79-89` · `frontend/views/admin/users/dialogs/EditUserFormFields.tsx:63-75` · `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx:110-127` |

## Context & Problem

Phone capture today is **duplicated, unvalidated, and inconsistent** across the stack:

| Surface | File / line | What it does today | Gap |
|---|---|---|---|
| Registration (client) | `frontend/views/auth/register/RegisterIdentityFields.tsx:69-85` | raw MUI `TextField` with rule `required: t.phoneRequired` only | no shape check — any non-empty string passes |
| Registration (whitelist) | `frontend/views/auth/register/registerFormUtils.ts:20-29` | `REGISTER_FIELD_PATHS` includes `"phone"` | accepted verbatim |
| Admin create (client) | `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx:79-89` | raw `TextField`, `dir: ltr` | no client shape check |
| Admin edit (client) | `frontend/views/admin/users/dialogs/EditUserFormFields.tsx:63-75` | raw `TextField` | length-only server check |
| Onboarding (client) | `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx:87-93` (data array) → rendered via `identityFields.map` at `:110-127` | raw `TextField` inside the map | delegates; phone swap must branch inside the map (REQ-3.4) |
| Registration (server) | `backend/services/auth/registration.service.ts:213-215` | emits `{ field: "phone", code: "PHONE_REQUIRED", message: t.phoneRequired }` | presence only — no format check |
| Admin create (server) | `backend/services/admin/user-management.helpers.ts:163-167` | `PHONE_REQUIRED` / `PHONE_TOO_LONG` | length cap only (`MAX_PHONE_LENGTH = 20` at `:30`) |
| Admin update (server) | `backend/services/admin/user-management.helpers.ts:217-218` | length-only patch check | format unchecked |
| GraphQL input | `backend/graphql/pothos/shared/userFieldHelpers.ts:97-107` | `phone: t.string({ required: true })` | no `String`-shape constraint possible at SDL layer |
| DB | `backend/db/schema/users/users.ts:17` | `varchar("phone", { length: 20 })`, nullable | only constraint is `users_email_unique` at `:44` — no phone unique/format check |

**The gap is a single source of truth for "what is a valid phone number".** There is no shared predicate, no schema, no reusable component, and no format validation anywhere. The email subsystem already has exactly this shape — `shared/lib/email.ts:9` exports `isValidEmail(email: string): boolean` (predicate-only, zero layer imports) and the registration form consumes it inline (`RegisterIdentityFields.tsx:49-68`: `validate: v => (isValidEmailShape(v) ? true : t.emailInvalid)`). Phone has no analogue, and the i18n key `phoneInvalid` **does not exist anywhere** (verified across `shared/locale/`).

**Existing Zod precedent (must be respected, not reinvented):** `zod ^4.6.2` is already a dependency (`package.json:116`; `bun.lock` resolves 4.6.2). Its only **production** usage today is `backend/types/classes/admin-session-governance.types.ts:1` (plus a type-only import in `admin-session-governance.types.test.ts:14`) — schemas colocated beside interfaces, exported, unknown keys stripped (docblock `:25-28`), consumed at the service boundary `backend/services/classes/session-admin-governance.ts:153,247` via `safeParse` → `throw new ValidationError(...)`, mapping to the generic `t.validation` message (it does NOT populate `fields`). There is **no zod usage in `shared/` or `frontend/` yet** — this feature introduces zod to `shared/` for the first time, which is permitted because zod has no layer dependencies (D2).

**Why this is foundation work:** the phone value flows Guest→registration and Admin→create/edit/onboarding, and the rule must be identical on both sides of the wire. A shared schema + predicate is the only way to guarantee parity without duplicating regexes; the reusable `PhoneInput` removes four near-identical raw `TextField` blocks.

### Feature Summary

Add a shared E.164 phone schema/predicate (`shared/lib/phone.ts`), a reusable accessible `PhoneInput` component (`frontend/components/ui/PhoneInput.tsx`) with a Storybook story, wire the shared schema into backend validation (`backend/services/shared/phone-validation.helpers.ts` consumed by registration + user-management), add the `phoneInvalid` i18n key (en+ar), and swap the four frontend phone surfaces to `PhoneInput`.

### Business Value

- One canonical phone rule enforced at the server trust boundary (REQ-9.1) and mirrored client-side for instant feedback.
- Removes four duplicated ad-hoc phone `TextField` blocks in favor of one tested component.
- Establishes the first shared Zod + reusable-input pattern for the Country selector (#230) and future fields to follow.
- No new runtime dependency (D3) — zod is already installed.

## Milestone Derivation

The GitHub issue **#229 carries NO milestone label**. The milestone is **DERIVED** as `milestone_0_foundation` for the following reason, and this derivation is recorded so no reader assumes a label that does not exist:

| Signal | Evidence | Conclusion |
|---|---|---|
| Cross-layer scope | touches `shared/lib/`, `frontend/components/`, `frontend/views/`, `backend/services/`, `shared/locale/` | foundation-wide, not a single vertical feature slice |
| Shared validation infrastructure | introduces the first zod schema in `shared/` and the first reusable phone input | reusable primitive, consumed by later features (#230 Country selector) |
| No product-domain behavior | no new route, no new DB column, no new business entity | enablement layer, not a domain milestone |
| Dependency direction | multiple future surfaces depend on it, it depends on none | bottom-of-stack foundation |

**Ruling:** milestone = `milestone_0_foundation` (derived). The issue body/labels are NOT edited by this plan; the derivation lives here and in `plan.md`/`tasks.md`.

## Scope

### In Scope

1. **REQ-1** New `shared/lib/phone.ts`: `PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH`, `isValidPhone`, `normalizePhone`, `phoneSchema` (D2) + colocated 4-tier tests.
2. **REQ-2** New `frontend/components/ui/PhoneInput.tsx` (forwardRef, both register-spread and controlled) + Storybook story.
3. **REQ-3** Swap the four phone surfaces (registration, admin create, admin edit, student onboarding) to `PhoneInput` + inline shared-predicate client rule (D8).
4. **REQ-4** New `backend/services/shared/phone-validation.helpers.ts` (`validatePhoneField`) wired into registration and user-management create/update (D5).
5. **REQ-5** Add `phoneInvalid` to the `AuthLabels` (register), `AdminUsersLabels` (createDialog + editDialog), and `StudentOnboardingLabels` types + en + ar (D6).
6. **REQ-6** Tests: shared 4-tier, backend service validation, GraphQL wire `PHONE_INVALID`, cross-actor journey (D9).
7. **REQ-7** Outcome Knowledge Base read/write + `tasks.md` checkbox tracking.
8. **REQ-8** Knowledge propagation: canonical doc `docs/validation/phone-validation.md` + skill updates if applicable.
9. **REQ-9** Security/tenancy: server as trust boundary, no input spread (BOPLA), no raw-input echo.

### Out of Scope (explicit — deferred to `deferred-items.md`)

Per **D10**:
- **CountrySelector** component and any country UI (#230) — deferred.
- **Country→dial-code dataset** (documented absent at `frontend/views/admin/users/dialogs/CreateUserDialog.tsx:23-27`) — deferred.
- **E.164 auto-formatting / masking UI** (as-you-type grouping) — deferred.
- **`libphonenumber`** (or any phone-parsing library) — deferred; no new dependency (D3).
- **DB column change** to `users.phone` (stays `varchar(20)` nullable, `backend/db/schema/users/users.ts:17`) — deferred.
- **Legacy phone backfill** for existing non-E.164 rows — deferred (see §Edge Cases).
- **GraphQL SDL change** — NOT needed (D7): phone stays `String` / `String!`.

## Actors

| Actor | Role (`users.role`) | Can Do (phone input) | Cannot Do (phone input) |
|---|---|---|---|
| **Guest** | unauthenticated registrant | enter a phone number on the registration form; receive instant client-side format feedback; submit registration | bypass server validation; rely on client-only validation (REQ-9.1) |
| **Authenticated Admin** | `admin` (incl. super-admin) | create a user with phone (`AdminCreateUserInput`); edit a user's phone; run student onboarding with phone | persist a phone that fails the shared schema; inject arbitrary fields via the phone patch (REQ-9.2) |
| **System / Backend** | — (validator) | validate phone via `phoneSchema`; emit `PHONE_*` field errors; localize messages; reject invalid input at the service boundary | echo raw input in errors (REQ-9.3); trust client-supplied values |
| **Student / Teacher / Parent** (registrant roles) | `student` / `teacher` / `parent` | have their phone captured at registration via the SAME shared rule | be exempt from format validation; select a dial code (CountrySelector is #230, out of scope) |

**Note on role uniformity:** phone validation is role-agnostic — the same `phoneSchema` governs Guest registration and all registrant roles (Student/Teacher/Parent), and the same helper governs all admin create/edit/onboarding paths (REQ-4). No role receives a weaker rule.

## Requirements

### REQ-1: Shared Zod Phone Schema Module

**User Story:** As a developer, I want one canonical phone predicate and Zod schema in `shared/lib/`, so frontend and backend validate identically and I can reuse it anywhere without layer violations.

#### Acceptance Criteria

1. **REQ-1.1** WHEN `shared/lib/phone.ts` is created THEN it SHALL export `PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/` (E.164: leading `+`, country digit `1-9`, total 8–15 digits), `PHONE_MAX_LENGTH = 16` (the `+` plus 15 digits), and `phoneSchema = z.string().trim().min(1, { message: "PHONE_REQUIRED" }).max(PHONE_MAX_LENGTH, { message: "PHONE_TOO_LONG" }).regex(PHONE_E164_PATTERN, { message: "PHONE_INVALID" })` — the zod `message` carries a **MACHINE CODE**, not localized prose.
2. **REQ-1.1** WHEN the module is authored THEN it SHALL import ONLY from `zod` (no `@/frontend/**`, no `@/backend/**`, no `@/app/**`) — `shared/` layer rule.
3. **REQ-1.2** WHEN `isValidPhone(value: string)` is called THEN it SHALL return `true` iff the trimmed value matches `PHONE_E164_PATTERN`, else `false` — delegating to `phoneSchema.safeParse(value).success` (single source of truth, no duplicated regex).
4. **REQ-1.3** WHEN `normalizePhone(value: string)` is called THEN it SHALL `trim()` then strip ASCII spaces, hyphens, and parentheses from the value while preserving a leading `+` (e.g. `" +20 (100) 123-4567 "` → `"+201001234567"`); it SHALL NOT invent a `+` when absent.
5. **REQ-1.4** WHEN the module ships THEN a colocated `shared/lib/phone.test.ts` SHALL exist, using `bun:test`, mirroring the four tiers of `shared/lib/email.test.ts` (branch / boundary / hostile / property), run via `bun run test/scripts/run-test.ts shared/lib/phone.test.ts`.
6. **REQ-1.1** WHEN the code/schema is consumed by a producer THEN the machine code (`PHONE_REQUIRED` / `PHONE_TOO_LONG` / `PHONE_INVALID`) SHALL be translated to localized text by that producer — the schema NEVER emits user-facing prose.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: `zod ^4.6.2` (`package.json:116`, installed) · **Assumptions**: E.164 is the accepted target format (no country selector yet, #230).

### REQ-2: Reusable `PhoneInput` Component

**User Story:** As a developer, I want a reusable, accessible phone input component, so four UI surfaces stop hand-rolling near-identical `TextField`s and bidi/aria concerns are centralized.

#### Acceptance Criteria

1. **REQ-2.1** WHEN `frontend/components/ui/PhoneInput.tsx` is created THEN it SHALL be a flat file (matching `frontend/components/ui/fieldError.ts` / `focusRing.ts`) exporting `PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>` with an explicit `Readonly<PhoneInputProps>` interface: `label?: string` (OPTIONAL — the admin sites render their own external `AdminDialogFieldLabel`), `value?`, `onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>`, `onBlur?`, `name?`, `required?`, `fullWidth?`, `error?`, `helperText?: React.ReactNode`, `autoComplete?` default `"tel"`, `disabled?`, `id?`, `"aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling"`, `startAdornment?: React.ReactNode` (the register field carries a `PhoneIcon` `startAdornment` at `RegisterIdentityFields.tsx:79-82`), and `inputRef?` — forwarded refs land on MUI `TextField`'s top-level `inputRef` (not `slotProps.input`).
2. **REQ-2.1** WHEN the component is used with `{...register("phone")}` spread THEN it SHALL forward `name`, `onChange`, `onBlur`, and `ref` correctly (uncontrolled/RHF mode); WHEN used with explicit `value`/`onChange` THEN it SHALL operate as a controlled input (both modes supported).
3. **REQ-2.2** WHEN the component renders THEN it SHALL render a MUI `TextField` with `type="tel"`, `inputMode="tel"`, and `slotProps={{ htmlInput: { dir: "ltr" } }}` so the phone value is always laid out left-to-right even inside a RTL (`ar`) layout — bidi safety.
4. **REQ-2.3** WHEN the component renders helper/error state THEN it SHALL set `helperText ?? " "` (reserve line height), `error`, `aria-invalid` wiring, and `slotProps.formHelperText: { "aria-live": "polite" }` — mirroring `frontend/components/AuthFormShared.tsx:77-153` `PasswordField`.
5. **REQ-2.3** WHEN the component is authored THEN it SHALL contain NO validation logic (no regex, no schema call) — validation lives in the shared predicate consumed by callers (REQ-3) and the server (REQ-4).
6. **REQ-2.4** WHEN the component ships THEN a Storybook story SHALL exist at `frontend/stories/ui/PhoneInput.stories.tsx` with `title: "Form/PhoneInput"`, covering at least default, required, error, and disabled states.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-1 (callers use the predicate) · **Assumptions**: MUI v9 — style props via `sx`; no hardcoded colors (theme palette only).

### REQ-3: Frontend Integration

**User Story:** As a Guest/Admin, I want the phone field everywhere to accept a valid number and give instant feedback when it does not, so I am not blocked by a server round-trip for an obvious typo.

#### Acceptance Criteria

1. **REQ-3.1** WHEN the registration form renders (`frontend/views/auth/register/RegisterIdentityFields.tsx:69-85`) THEN it SHALL use `PhoneInput` instead of the raw `TextField` AND add the inline RHF rule `validate: v => (isValidPhone(v) ? true : t.phoneInvalid)` (mirroring the email analogy at `:49-68`) — with `isValidPhone` imported from `@/shared/lib/phone`.
2. **REQ-3.1** WHEN registration state/submit is unchanged THEN `REGISTER_FIELD_PATHS` SHALL still include `"phone"` (`registerFormUtils.ts:20-29`), `registerFormUtils.ts:63-72` value projection SHALL be unchanged, and server-error projection (`useRegisterSubmit.ts:66-79`) SHALL remain unchanged.
3. **REQ-3.2** WHEN the admin create dialog renders (`frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx:79-89`) THEN it SHALL use `PhoneInput` in **controlled mode** — `<PhoneInput value={form.phone} onChange={…} error={…} helperText={…} />` driven by the dialog's existing `form`/`setForm`/`fieldErrors` state (these admin dialogs do NOT use `useForm`/`register`/RHF `validate`) — with `error` computed from the shared `isValidPhone` predicate on change/blur and the existing server `fieldErrors.phone` projection remaining authoritative; the `dir: ltr` behavior is preserved via the component's built-in `htmlInput.dir`.
4. **REQ-3.3** WHEN the admin edit dialog renders (`frontend/views/admin/users/dialogs/EditUserFormFields.tsx:63-75`) THEN it SHALL use `PhoneInput` in **controlled mode** against that dialog's `form`/`setForm`/`fieldErrors` state (no RHF `validate`), computing `error` from the shared `isValidPhone` predicate on change/blur with the server `fieldErrors.phone` projection authoritative.
5. **REQ-3.4** WHEN the student onboarding profile section renders (`frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx:110-127`) THEN it SHALL use `PhoneInput` in **controlled mode** — the identity fields (data array at `:87-93`) are rendered via `identityFields.map(...)` (`:110-127`), so the integration SHALL branch inside the map on `field.errorKey === "phone"` to render `PhoneInput` (or hoist the phone field out of the loop) rather than a plain `TextField` replacement — with `error` computed from the shared `isValidPhone` predicate on change/blur and the server `fieldErrors.phone` projection authoritative.
6. **REQ-3.5** WHEN a client rule fails THEN the `phoneInvalid` message SHALL come from the surface's OWN namespace — `useAppTranslation(Auth)` for registration, `useAppTranslation(AdminUsers)` for the admin create/edit dialogs, `useAppTranslation(StudentOnboarding)` for onboarding (each handle imported from `@/shared/locale/namespaces/<ns>`, never a string argument) — never a hardcoded string.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-1, REQ-2, REQ-5 · **Assumptions**: the four surfaces keep their existing form-state shape; only the field component and the rule change.

### REQ-4: Backend Validation

**User Story:** As the platform, I want the server to independently validate phone numbers using the shared schema, so no invalid number is persisted regardless of the client (REQ-9.1).

#### Acceptance Criteria

1. **REQ-4.1** WHEN `backend/services/shared/phone-validation.helpers.ts` is created THEN it SHALL export `validatePhoneField(value: string, locale: string): ApiFieldErrorType | null` returning `null` when valid and, when invalid, an `ApiFieldErrorType` (`backend/types/errors/api-error.types.ts:55` = `{ readonly field: string; readonly code: string; readonly message: string }`) with `field: "phone"`, `code` ∈ `PHONE_REQUIRED` / `PHONE_INVALID` / `PHONE_TOO_LONG`, and `message` localized via `getServerTranslations(locale)` (`@/shared/locale/server-graphql`).
2. **REQ-4.1** WHEN the helper maps codes THEN `PHONE_REQUIRED` → `authTranslations.phoneRequired` (`shared/locale/types/auth/index.ts:36`); `PHONE_TOO_LONG` → `errorsTranslations.validation` (`shared/locale/types/errors/labels.ts:104`); `PHONE_INVALID` → the NEW `authTranslations.phoneInvalid` (REQ-5).
3. **REQ-4.2** WHEN `registration.service.ts` `validateInput` runs (`backend/services/auth/registration.service.ts:199-247`) THEN the phone arm at `:213-215` SHALL be replaced by a call to `validatePhoneField`; a non-null result SHALL be appended to `entries` and SHALL still funnel into `throw new ValidationError(entries[0].message, entries)` at `:244-246`.
4. **REQ-4.3** WHEN `backend/services/admin/user-management.helpers.ts` validates create — `validateCreateInput(input: AdminCreateUserSubmitInput, locale: string): void` (`:147`, phone at `:163-167`) — THEN it SHALL call `validatePhoneField`; AND WHEN it validates update — `validateUpdatePatch(patch: AdminUserUpdateDbPatch, locale: string): void` (`:207`, phone at `:217-218`) — THEN it SHALL call `validatePhoneField` guarded by `typeof patch.phone === "string"` and only for a non-empty value (an empty string CLEARS the phone, EC-13) — replacing the length-only checks with the shared schema; `MAX_PHONE_LENGTH = 20` at `:30` is a private, non-exported const referenced only in-file (`:165`, `:217`), superseded by `PHONE_MAX_LENGTH = 16`.
5. **REQ-4.3** WHEN admin create/update services run (`user-management.service.ts` `createUser` `:261`, `updateUser` `:331`) THEN they SHALL surface the helper's `ApiFieldErrorType[]` in the `ValidationError.fields` payload (as today) — no change to the error envelope.
6. **REQ-4.4** WHEN student onboarding calls `createUser` (`backend/services/admin/student-onboarding.service.ts:293` → `:322`) THEN phone validation SHALL be inherited with NO code change in the onboarding service — verified by a test asserting the inherited path (REQ-6.2).
7. **REQ-4.5** WHEN any backend producer emits a phone error THEN the message SHALL be fully localized at the producer (per `ApiFieldErrorType` contract) — the machine code is never sent as the message.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-1, REQ-5 · **Assumptions**: `phoneSchema` remains server-authoritative; the GraphQL SDL is unchanged so no regen (D7).

### REQ-5: i18n — `phoneInvalid` Key

**User Story:** As an Arabic or English user, I want the invalid-phone message in my locale, so error feedback is never shown in the wrong language or as a machine code.

#### Acceptance Criteria

1. **REQ-5.1** WHEN the key is added THEN `phoneInvalid: string` SHALL be a leaf on `AuthLabels` (`shared/locale/types/auth/index.ts:12`, alongside `phoneRequired` `:36`, `label phone` `:18`, `countryRequired` `:39`; register), on BOTH `AdminUsersLabels` groups `createDialog.phoneInvalid` and `editDialog.phoneInvalid` (`shared/locale/types/adminUsers/index.ts`, next to the existing `phone` label in each group; admin create/edit dialogs) AND on `StudentOnboardingLabels` `fields.phoneInvalid` (`shared/locale/types/studentOnboarding/index.ts`, next to `fields.phone`; onboarding) — and implemented in BOTH locales for EACH namespace: `shared/locale/en/auth/index.ts` + `shared/locale/ar/auth/index.ts`, `shared/locale/en/adminUsers/index.ts` + `shared/locale/ar/adminUsers/index.ts`, `shared/locale/en/studentOnboarding/index.ts` + `shared/locale/ar/studentOnboarding/index.ts` — en `"Please enter a valid phone number."`, ar `"يرجى إدخال رقم هاتف صحيح."` — no new namespace (register uses the `Auth` handle, admin dialogs use `AdminUsers`, onboarding uses `StudentOnboarding`).
2. **REQ-5.1** WHEN the key sets are compared THEN en/ar parity within EACH namespace SHALL be enforced by the compile-time `*Labels` type gate (each locale file must satisfy its `*Labels` interface in `shared/locale/types/`) — there is NO existing `auth` parity test; any explicit runtime parity test is deferred (see `deferred-items.md` D-8).
3. **REQ-5.2** WHEN the key is consumed THEN the frontend SHALL read it via `useAppTranslation(<surface namespace>)` — `Auth` for register, `AdminUsers` for admin create/edit, `StudentOnboarding` for onboarding (REQ-3.5) — AND the backend SHALL read the register-facing text via `getServerTranslations(locale).authTranslations.phoneInvalid` inside `validatePhoneField` (REQ-4.1) — one text per namespace, both producers aligned.
4. **REQ-5.3** WHEN any producer emits the invalid-format error THEN it SHALL NOT hardcode `"Please enter a valid phone number."` or any equivalent — the typed translation function is the only source.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: — · **Assumptions**: the compile-time `*Labels` gate enforces en/ar key parity per namespace; no runtime parity test exists (deferred, D-8).

### REQ-6: Tests

**User Story:** As a maintainer, I want automated coverage at each layer, so the shared rule, the server enforcement, the wire contract, and the end-to-end journey cannot silently regress.

#### Acceptance Criteria

1. **REQ-6.1** WHEN `shared/lib/phone.test.ts` is authored THEN it SHALL cover four tiers mirroring `shared/lib/email.test.ts`: (branch) each `phoneSchema` failure code; (boundary) exactly 8 and exactly 15 digits, and length 16 vs 17; (hostile) whitespace-only, missing `+`, leading `+` with `0`, embedded newline, unicode digits; (property) `isValidPhone(normalizePhone(x)) ⟹ isValidPhone(x)` for E.164 inputs — run via `bun run test/scripts/run-test.ts shared/lib/phone.test.ts`.
2. **REQ-6.2** WHEN backend service tests are authored THEN they SHALL live colocated under `backend/services/**/*.test.ts` and SHALL assert: registration `validateInput` rejects `"abc"` with `{ field: "phone", code: "PHONE_INVALID" }`; admin `validateCreateInput`/`validateUpdatePatch` reject invalid formats; onboarding `createUser` inherits the rejection (REQ-4.4) — run via `bun run test:services`.
3. **REQ-6.3** WHEN the GraphQL wire test is authored THEN it SHALL live under `frontend/graphql/test/auth/`, use `testClient` + `setupTestServerLifecycle` from `@/test/helpers` with the auth documents (`frontend/graphql/sharedDocuments/auth/auth.documents.ts`), submit a registration with an invalid phone, and assert the response carries a field error with `code: "PHONE_INVALID"`.
4. **REQ-6.4** WHEN the workflow journey test is authored THEN it SHALL live at `test/workflows/auth/registration-phone.journey.test.ts`, exercise real services against the real test DB (tracked `afterAll` cleanup, **NO `runInRollback`**), and cover the ordered journey in §Cross-Actor Journey Capture — run via `bun run test`.
5. **REQ-6.5** WHEN any frontend render test is considered THEN it SHALL NOT be authored — the repo has **no frontend render-test tier** (UI is E2E-only, per `frontend/components/ui/fieldError.test.ts:2-13`); `PhoneInput` behavior is covered by the journey + by `fieldError`-style pure-logic tests only.
6. **REQ-6.6** WHEN the tests are run THEN they SHALL use the mandated runners (`bun run test/scripts/run-test.ts <path>` for shared; `bun run test:services`; `bun run test` for workflows) — never raw `bun test` for DB-touching suites.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-1…REQ-5 · **Assumptions**: `test/helpers` exports `testClient` + `setupTestServerLifecycle` (used by existing wire tests).

### REQ-7: Outcome Knowledge Base & Progress Tracking

**User Story:** As an executing agent, I want a persistent outcome ledger and checkbox tracking, so research is not redone and progress is visible.

#### Acceptance Criteria

1. **REQ-7.1** WHEN an executing agent starts any task THEN it SHALL first read ALL existing files under `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/outcome/` to absorb prior research, search results, and pitfalls.
2. **REQ-7.2** WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` detailing research findings, docs/web search results, implementation details, cross-file dependencies, and carry-over points.
3. **REQ-7.3** WHEN an executing agent completes any subtask THEN it SHALL flip the corresponding checkbox `[ ]` → `[x]` in `tasks.md` (same directory).
4. **REQ-7.3** WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and SHALL NOT proceed until exit code 0.

### REQ-8: Knowledge Propagation

**User Story:** As a future developer, I want the phone-validation rules documented canonically, so the pattern is discoverable without reading four files.

#### Acceptance Criteria

1. **REQ-8.1** WHEN the feature ships THEN a canonical doc SHALL exist at `docs/validation/phone-validation.md` stating: the E.164 target format, `PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH`, the machine-code convention (REQ-1.1), where the schema lives (`shared/lib/phone.ts`), where the backend helper lives (`backend/services/shared/phone-validation.helpers.ts`), the four consuming surfaces, and the explicit non-goals (CountrySelector #230, libphonenumber, masking).
2. **REQ-8.2** WHEN relevant `.agents/skills/*/SKILL.md` files exist that describe shared validation or reusable inputs THEN they SHALL be updated to reference the phone schema/component IF applicable; otherwise the plan SHALL record that no skill update was needed (no skill is created for this feature).

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: REQ-1, REQ-4 · **Assumptions**: `docs/validation/` may be a new directory.

### REQ-9: Security & Tenancy

**User Story:** As the platform, I want phone validation to be a server trust boundary with no data-leak or mass-assignment risk, so client bypass and injection are impossible.

#### Acceptance Criteria

1. **REQ-9.1** WHEN any phone value is persisted THEN the server SHALL independently validate it via `phoneSchema` (`shared/lib/phone.ts`) — client-side validation (REQ-3) is UX only and SHALL NEVER be the sole gate; a crafted request bypassing the client SHALL be rejected at the service boundary.
2. **REQ-9.2** WHEN an admin update patch includes a phone value THEN the service SHALL NOT spread the input object into a DB update (no `{ ...patch }` into `set(...)`) — only the explicitly picked `phone` column (plus existing allowed columns) SHALL be written (BOPLA / mass-assignment defense) — consistent with `validateUpdatePatch` (`user-management.helpers.ts:207`).
3. **REQ-9.3** WHEN a validation error is produced THEN the `message` SHALL be a localized constant and the `code` SHALL be a machine code — the raw submitted input value SHALL NEVER be echoed into the error `message` (no reflected input).
4. **REQ-9.4** WHEN the phone error travels to the client THEN the `ApiFieldErrorType` (`{ field, code, message }`, `backend/types/errors/api-error.types.ts:55`) SHALL be the ONLY channel — no raw exception text or stack is exposed.
5. **REQ-9.5** WHEN validation runs THEN it SHALL be pure and synchronous (no DB read required to validate format) — the format gate SHALL NOT become a tenancy/enumeration oracle (it must not reveal whether a phone exists in another tenant/account).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-1, REQ-4 · **Assumptions**: phone is not unique-constrained today (`users.ts:44` only unique on email), so no uniqueness oracle exists.

## Cross-Actor Journey Capture

**Include-rule:** this feature spans 2+ actors over shared state (Guest/Admin → System validator → persisted user), so the journey is captured here and maps 1:1 onto `test/workflows/auth/registration-phone.journey.test.ts` (REQ-6.4).

### Actor Table (journey)

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Guest | unauthenticated registrant | submit registration with a phone; observe instant client feedback | persist without server validation |
| Admin | `admin` | create/edit users and run onboarding with a phone | persist invalid phone; mass-assign fields |
| System / Backend | validator | validate via shared schema; emit `PHONE_*` field errors | echo raw input; trust client |
| Registrant (Student/Teacher/Parent) | `student`/`teacher`/`parent` | register with a phone under the same rule | bypass validation |

### Ordered Step List (Journey J1 — registration with phone validation)

1. Guest → enters a valid E.164 phone on the registration form (`PhoneInput`) → client inline rule (`isValidPhone`) passes → no client error.
2. Guest → submits registration → GraphQL `RegisterUser` mutation carries `phone` (`userRegistrationInputFields`, `userFieldHelpers.ts:97-107`).
3. System → `registration.service.registerUser` (`:80`) runs `validateInput` (`:199-247`) → `validatePhoneField` (REQ-4.1) → parses via shared `phoneSchema`.
4. System → on **valid** phone → proceeds; `ValidationError` NOT thrown; user row persisted with `users.phone` set.
5. Guest → attempts a second registration with an **invalid** phone (e.g. `"12345"`) → client rule shows `t.phoneInvalid`; if client is bypassed (crafted request) → server `validatePhoneField` returns `{ field:"phone", code:"PHONE_INVALID", message:<localized> }` → `ValidationError` thrown (`:244-246`) → NO row persisted.
6. Guest → observes the error surfaced ON the phone field via the projection pipeline (`projectMutationFieldErrors` / `applyProjectedFieldErrors`, `frontend/lib/mutationFieldErrors.ts:125,147`; `frontend/components/ui/fieldError.ts:80`).
7. Admin → opens Create User dialog → enters a phone (`PhoneInput`, `CreateUserFormGrid.tsx:79-89`) → submits → `AdminCreateUserInput` → `createUser` (`user-management.service.ts:261`) → `validateCreateInput` (`:147`) → `validatePhoneField`.
8. Admin → on invalid phone → observes `{ field:"phone", code:"PHONE_INVALID"|"PHONE_TOO_LONG"|"PHONE_REQUIRED" }` on the field; on valid phone → user created.
9. Admin → edits a user's phone (`EditUserFormFields.tsx:63-75`) → `updateUser` (`:331`) → `validateUpdatePatch` (`:207`) → `validatePhoneField` (length-only check replaced, REQ-4.3).
10. Admin → runs student onboarding with a phone (`OnboardStudentProfileSection.tsx:110-127`) → onboarding calls `createUser` (`student-onboarding.service.ts:293`→`:322`) → the SAME validation is inherited with no onboarding code change (REQ-4.4).
11. System → cleanup: journey test removes all created rows via tracked `afterAll` (no `runInRollback`).

### Cross-Actor EARS Criteria (observer-perspective)

1. WHEN the Guest submits a valid E.164 phone THEN the system SHALL persist the user AND the Guest SHALL observe no phone error on the field.
2. WHEN the Guest submits an invalid phone (client bypass possible) THEN the system SHALL reject with a field error `{ field: "phone", code: "PHONE_INVALID" }` AND the Guest SHALL observe the localized `phoneInvalid` message on the phone field AND NO user row SHALL be created.
3. WHEN the Admin creates a user with an invalid phone THEN the system SHALL reject with a `PHONE_*` field error AND the Admin SHALL observe it on the phone field AND NO user row SHALL be created.
4. WHEN the Admin updates only the phone with an invalid value THEN the system SHALL reject AND the target user's stored phone SHALL remain UNCHANGED (the patch writes nothing on failure).
5. WHEN the Admin runs onboarding with an invalid phone THEN the system SHALL reject via the inherited `createUser` validation (REQ-4.4) AND the Admin SHALL observe the same `PHONE_*` field error.
6. IF a client bypasses the frontend rule and sends an invalid phone THEN the server SHALL STILL reject (server is the trust boundary, REQ-9.1).
7. IF any producer emits a phone error THEN the `message` SHALL be localized AND SHALL NOT contain the raw submitted value (REQ-9.3).

## Edge Cases

| # | Case | Input example | Expected behavior | Governing REQ |
|---|---|---|---|---|
| EC-1 | Empty | `""` | `PHONE_REQUIRED` (registration/admin create require it) | REQ-1.1, REQ-4 |
| EC-2 | Whitespace-only | `"   "` | `trim()` → empty → `PHONE_REQUIRED` (server) / client rule fails | REQ-1.1, REQ-1.3 |
| EC-3 | Leading/trailing spaces | `" +201001234567 "` | valid after `trim()` | REQ-1.3 |
| EC-4 | Missing `+` | `"201001234567"` | `PHONE_INVALID` (E.164 requires leading `+`) | REQ-1.1, REQ-1.2 |
| EC-5 | Leading `+0` (invalid country digit) | `"+0123456789"` | `PHONE_INVALID` (`[1-9]` first country digit) | REQ-1.1 |
| EC-6 | Too short | `"+201"` | `PHONE_INVALID` (needs ≥8 digits) | REQ-1.1 |
| EC-7 | Shape failure (non-digit, ≤16 chars) | `"+20abc1234"` | `PHONE_INVALID` (fails the E.164 digit pattern; stays ≤16 chars so `.max(PHONE_MAX_LENGTH=16)` does not fire first) | REQ-1.1, REQ-1.2 |
| EC-8 | Too long (length cap) | value > 16 chars | `PHONE_TOO_LONG` | REQ-1.1, REQ-4.1 |
| EC-9 | Dashes/parens/spaces | `"+20 (100) 123-4567"` | `null`; producers may call `normalizePhone` to canonicalize before compare/persist | REQ-1.3 |
| EC-10 | Unicode / Arabic-Indic digits | `"+٢٠١٠٠١٢٣٤٥٦"` | `PHONE_INVALID` — schema accepts ASCII digits only (`\d` per current pattern; documented) | REQ-1.1, REQ-1.2 |
| EC-11 | Embedded newline / control char | `"+2010\n0123456"` | `PHONE_INVALID` | REQ-1.2 |
| EC-12 | RTL layout context (`ar`) | any valid number | renders LTR via `htmlInput.dir = "ltr"` | REQ-2.2 |
| EC-13 | Admin clears phone on update | `""` or `null` on patch | the update guard validates only when `typeof patch.phone === "string"` AND the value is non-empty — an absent (`undefined`) or empty-string `phone` CLEARS the stored phone (no validation, no `PHONE_REQUIRED`) | REQ-4.3 |
| EC-14 | Legacy non-E.164 rows | existing `users.phone` like `"01001234567"` | NOT backfilled, NOT invalidated; only NEW writes are validated (D10) | D10 |
| EC-15 | Registration phone omitted | client omits field | `RegisterUserInput.phone` is `required: true` (`userFieldHelpers.ts:97-107`) → SDL rejects at the wire before service | REQ-4.2, D7 |

## Non-Functional Requirements

### Security (REQ-9)

1. WHEN any phone is persisted THEN the server SHALL validate it via the shared schema (REQ-9.1) — client bypass is ineffective.
2. WHEN an update patch is applied THEN only the picked phone column SHALL be written — no object spread (REQ-9.2).
3. WHEN an error message is produced THEN it SHALL be a localized constant with a machine `code` — the raw input SHALL NOT be echoed (REQ-9.3).
4. WHEN errors cross the wire THEN only `{ field, code, message }` SHALL be exposed (REQ-9.4).
5. WHEN validation runs THEN it SHALL be pure/synchronous — no tenancy/enumeration oracle (REQ-9.5).

### i18n (REQ-5)

1. WHEN any user-facing phone string is shown THEN it SHALL come from the surface's own `*Labels` namespace — `AuthLabels` (register), `AdminUsersLabels` (admin dialogs), `StudentOnboardingLabels` (onboarding) — in en+ar — no hardcoded strings, no new namespace.
2. WHEN the frontend shows it THEN via `useAppTranslation(<surface namespace>)`; WHEN the backend shows it THEN via `getServerTranslations(locale).authTranslations.phoneInvalid`.
3. WHEN the locale files exist THEN en/ar key sets SHALL be identical per namespace, enforced by the compile-time `*Labels` type gate (no runtime parity test exists — deferred, D-8).

### Accessibility (REQ-2.3)

1. WHEN `PhoneInput` renders THEN `aria-invalid` SHALL reflect error state and helper text SHALL be `aria-live="polite"`.
2. WHEN the field is labeled THEN the `label` prop SHALL render an associated `<label>` (MUI `TextField` `label`).
3. WHEN the field is on a RTL page THEN the input value SHALL remain LTR (`dir: "ltr"` on the html input) while surrounding content follows document direction.

### Dependency Constraint (D3)

1. WHEN frontend validation is wired THEN it SHALL use the shared predicate — inside RHF inline `validate` rules for the register form (which uses RHF), and inside controlled-mode change/blur handlers for the admin/onboarding dialogs (which use `form`/`setForm` state, not RHF) — `@hookform/resolvers` SHALL NOT be added; `useRegisterFormState.ts:29-40` uses RHF `useForm` with NO resolver and that SHALL remain.
2. WHEN the feature is complete THEN `package.json` dependency set SHALL be unchanged (`zod` already present at `package.json:116`).

## Requirement Traceability Summary

| REQ | Short statement | Primary artifact(s) |
|---|---|---|
| **REQ-1** | Shared Zod phone schema module | `shared/lib/phone.ts` (new) |
| REQ-1.1 | E.164 schema + `PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH`, `phoneSchema` (machine-code messages) | `shared/lib/phone.ts` |
| REQ-1.2 | `isValidPhone(value)` predicate | `shared/lib/phone.ts` |
| REQ-1.3 | `normalizePhone(value)` (trim + strip spaces/dashes/parens, keep `+`) | `shared/lib/phone.ts` |
| REQ-1.4 | Colocated 4-tier unit tests | `shared/lib/phone.test.ts` (new) |
| **REQ-2** | Reusable `PhoneInput` component | `frontend/components/ui/PhoneInput.tsx` (new) |
| REQ-2.1 | `forwardRef` + explicit `Readonly<PhoneInputProps>`; register-spread + controlled | same |
| REQ-2.2 | `type="tel"`, `inputMode="tel"`, `htmlInput.dir="ltr"` (bidi) | same |
| REQ-2.3 | `aria-invalid` + `aria-live` helper text | same |
| REQ-2.4 | Storybook story | `frontend/stories/ui/PhoneInput.stories.tsx` (new) |
| **REQ-3** | Frontend integration (four surfaces) | see below |
| REQ-3.1 | Registration form swap + inline RHF rule | `RegisterIdentityFields.tsx:69-85` |
| REQ-3.2 | Admin create dialog swap (controlled mode) | `CreateUserFormGrid.tsx:79-89` |
| REQ-3.3 | Admin edit dialog swap (controlled mode) | `EditUserFormFields.tsx:63-75` |
| REQ-3.4 | Student onboarding swap (controlled, branch inside `identityFields.map` at `:110-127`) | `OnboardStudentProfileSection.tsx:110-127` |
| REQ-3.5 | Per-surface `phoneInvalid` message from the surface's own namespace (`Auth`/`AdminUsers`/`StudentOnboarding`) | `RegisterIdentityFields.tsx`, `CreateUserFormGrid.tsx`, `EditUserFormFields.tsx`, `OnboardStudentProfileSection.tsx` |
| **REQ-4** | Backend validation | see below |
| REQ-4.1 | Shared backend helper `validatePhoneField` | `backend/services/shared/phone-validation.helpers.ts` (new) |
| REQ-4.2 | `registration.service` wiring | `backend/services/auth/registration.service.ts:213-215` |
| REQ-4.3 | `user-management` create/update wiring | `backend/services/admin/user-management.helpers.ts:163-167,217-218` |
| REQ-4.4 | Onboarding inherits (verified, no code change) | `backend/services/admin/student-onboarding.service.ts:293,322` |
| REQ-4.5 | Producer fully localizes the message; machine code never sent as message | `backend/services/shared/phone-validation.helpers.ts` |
| **REQ-5** | i18n `phoneInvalid` key (en+ar) | `shared/locale/types/{auth,adminUsers,studentOnboarding}/index.ts` + matching `en/` + `ar/` files |
| REQ-5.1 | `phoneInvalid` leaf on `AuthLabels` (register) + `AdminUsersLabels` `createDialog`/`editDialog` (admin) + `StudentOnboardingLabels` `fields` (onboarding) — en + ar | those locale files |
| REQ-5.2 | Consumed by frontend (`useAppTranslation(<ns>)`) + backend (`getServerTranslations`) | REQ-3.5, REQ-4.1 |
| REQ-5.3 | No hardcoded invalid-phone string — typed translation is the only source | the three `*Labels` locale namespaces |
| **REQ-6** | Tests | see below |
| REQ-6.1 | Shared schema 4-tier tests | `shared/lib/phone.test.ts` |
| REQ-6.2 | Backend service validation tests (incl. onboarding inheritance) | `backend/services/**/*.test.ts` |
| REQ-6.3 | GraphQL wire test (`PHONE_INVALID`) | `frontend/graphql/test/auth/` |
| REQ-6.4 | Cross-actor registration journey test | `test/workflows/auth/registration-phone.journey.test.ts` |
| REQ-6.5 | No frontend render test authored (repo has no render-test tier; UI is E2E-only) | — |
| REQ-6.6 | Mandated test runners only (no raw `bun test` for DB-touching suites) | `test/scripts/run-test.ts`, `bun run test:services`, `bun run test` |
| **REQ-7** | Outcome KB & progress tracking | `outcome/`, `tasks.md` |
| REQ-7.1 | Read `outcome/` before tasks | plan dir |
| REQ-7.2 | Write `outcome/<task-id>-outcome.md` after tasks | plan dir |
| REQ-7.3 | Update `tasks.md` checkboxes | plan dir |
| **REQ-8** | Knowledge propagation | `docs/validation/phone-validation.md`; `.agents/skills/*/SKILL.md` if applicable |
| REQ-8.1 | Canonical doc | `docs/validation/phone-validation.md` (new) |
| REQ-8.2 | Skill updates if applicable | `.agents/skills/` |
| **REQ-9** | Security & tenancy | server boundary |
| REQ-9.1 | Server is the trust boundary | `phone-validation.helpers.ts` |
| REQ-9.2 | No input spread into DB updates (BOPLA) | `user-management.service.ts` |
| REQ-9.3 | Errors never echo raw input | `phone-validation.helpers.ts` |
| REQ-9.4 | `ApiFieldErrorType` is the ONLY error channel exposed to the client | `backend/types/errors/api-error.types.ts:55` |
| REQ-9.5 | Validation is pure/synchronous — no tenancy/enumeration oracle | `shared/lib/phone.ts` |

**Coverage:** every REQ-1 … REQ-9 and every sub-id (REQ-1.1–1.4, 2.1–2.4, 3.1–3.5, 4.1–4.5, 5.1–5.3, 6.1–6.6, 7.1–7.3, 8.1–8.2, 9.1–9.5) appears above and in the Requirements section.

## Outcome Knowledge Base Criteria

1. **REQ-7.1** WHEN an executing agent starts any task in this plan THEN it SHALL read ALL files in `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/outcome/` before writing code.
2. **REQ-7.2** WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` capturing research findings, docs/web search results, implementation details, cross-file dependencies, and carry-over points.
3. **REQ-7.3** WHEN an executing agent completes any subtask THEN it SHALL flip the checkbox `[ ]` → `[x]` in `tasks.md`.
4. WHEN a task surfaces unexpected scope THEN it SHALL be recorded in `deferred-items.md` (same plan directory) rather than silently expanded.
5. WHEN implementation begins THEN baseline error counts SHALL be captured (per `sub-loop.ts` + `bun tsgo` / `bun biome:check` / `lint-service`) to distinguish new from pre-existing issues, recorded in `outcome/0-baseline-outcome.md`.

## Constraints and Assumptions

### Technical Constraints

- **Zero DB schema delta** (D10): `users.phone` stays `varchar("phone", { length: 20 })` nullable (`backend/db/schema/users/users.ts:17`); no `db push`/`migrate`.
- **Zero GraphQL SDL delta** (D7): phone stays `String` / `String!` (`userFieldHelpers.ts:97-107`; `admin-user.pothos.ts:326`; `admin-student-onboarding.pothos.ts:58-61`) → NO `bun run generate:gqlSchema` / `bun codegen` required.
- **No new dependency** (D3): zod already present (`package.json:116`); `@hookform/resolvers`, `libphonenumber` NOT added; RHF inline `validate` (matching `RegisterIdentityFields.tsx:49-68`).
- **Layer rules**: `shared/lib/phone.ts` imports ONLY `zod` (no `@/frontend`, `@/backend`, `@/app`); no barrels for utilities; deep imports; no `console.*`; MUI v9 style props via `sx`; no hardcoded colors; never React 19 `FormEvent`.
- **Per-file gate**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` MUST exit 0 for each new/modified file.

### Assumptions

- E.164 is the accepted target format (no dial-code/country UI yet; `CreateUserDialog.tsx:23-27` documents the dataset's absence).
- The `phoneRequired` / `countryRequired` keys already exist (`shared/locale/types/auth/index.ts:36,39`); only `phoneInvalid` is new.
- `phoneSchema` failure codes are translated by producers — the schema never emits prose (REQ-1.1).
- Admin update's clearing semantics follow the existing patch contract (EC-13); no new behavior is invented.

## Success Criteria

### Definition of Done

- [ ] All REQ-1 … REQ-9 acceptance criteria are met
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 for every new/modified file
- [ ] `shared/lib/phone.test.ts`, backend service tests, GraphQL wire test, and `test/workflows/auth/registration-phone.journey.test.ts` are green
- [ ] `bun quality-gate` passes (tsgo → oxlint → biome → lint → duplicates)
- [ ] `docs/validation/phone-validation.md` exists (REQ-8.1)
- [ ] `outcome/` files written per task (REQ-7.2); `tasks.md` fully checked (REQ-7.3)
- [ ] `deferred-items.md` contains zero open ❌/⚠️ entries at the final gate

### Acceptance Metrics

- 100% branch coverage on `shared/lib/phone.ts` (all three failure codes + valid path)
- Zero new tsgo/oxlint/biome/lint errors vs baseline
- Journey covers both the success path and all denial/observer criteria (7 cross-actor EARS)
- Grep proof: no hardcoded `"Please enter a valid phone number."` anywhere outside the en locale files (REQ-5.3)
- Dependency proof: `package.json` dependency set unchanged (D3)

## Glossary

| Term | Definition |
|---|---|
| E.164 | International phone format: `+` followed by country code (first digit `1-9`) and up to 15 digits total |
| `phoneSchema` | The canonical zod schema in `shared/lib/phone.ts`; messages are MACHINE CODES, not prose |
| Machine code | `PHONE_REQUIRED` / `PHONE_TOO_LONG` / `PHONE_INVALID` — translated to localized text by the producer |
| `ApiFieldErrorType` | `{ field, code, message }` (`backend/types/errors/api-error.types.ts:55`) — the field-error wire shape |
| BOPLA | Broken Object Property Level Authorization — mass-assignment defense; never spread input into a DB update |
| Register spread | RHF's `{...register("phone")}` pattern passing `name`/`onChange`/`onBlur`/`ref` to a component |
| Controlled mode | Passing explicit `value` + `onChange` to the component rather than relying on RHF registration |

---

## Requirements Review Checklist

- [x] User stories have roles/features/benefits · EARS throughout · NFRs present · success criteria measurable
- [x] Actors defined for all roles (Guest, Admin, System/Backend, Student/Teacher/Parent)
- [x] Cross-actor journey captured: actor table + 11 ordered steps + observer-perspective EARS (7 criteria)
- [x] Every REQ-1 … REQ-9 (and sub-ids) traced in the traceability table
- [x] Out-of-scope items deferred (D10) with the absent dataset cited (`CreateUserDialog.tsx:23-27`)
- [x] Every EXISTING code claim cited with `path:line`; no invented symbols (e.g. `phoneInvalid` documented as NEW, not existing)
- [x] No new dependency (D3) and no SDL/DB delta (D7/D10) explicitly stated
