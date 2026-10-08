# Phone Validation — the shared contract

Every surface that collects a phone number — public registration, the admin create/edit user
dialogs, and student onboarding — validates, normalizes, collects, and stores phones through
one shared contract. This document is the single reference for that contract: the E.164 shape
decision, the schema/predicate/normalizer module, the server-side gate, the reusable input
component, the two frontend validation modes, and the update patch semantics.

## 1. Why a single phone contract

A phone number crosses four layers: a shared validation module, backend services, a reusable
UI component, and per-surface form logic. Before this contract existed, each surface carried
its own inline phone check (a raw `TextField` plus a hand-rolled regex in the registration
service and again in the admin user-management helpers), so the accepted shape could drift
between layers and between actors.

The contract collapses all of that onto one shape authority:

- `shared/lib/phone.ts` owns the shape. It is used by both the frontend and the backend and
  imports nothing from any layer, so frontend and backend can never disagree.
- `shared/lib/phone/` is the libphonenumber library: the ported google-libphonenumber
  helpers + the country/dial-code dataset. It powers semantic validation and the
  country/dial-code picker, and **coexists deliberately** with `shared/lib/phone.ts`
  (Section 3a explains why neither replaces the other).
- `backend/services/shared/phone-validation.helpers.ts` is the only server-side gate. Public
  registration and the admin create/update flows both funnel through it, so no write path can
  skip it or substitute a different rule.
- `frontend/components/ui/PhoneInput.tsx` is the only phone input primitive. It centralizes
  the tel semantics and owns **no** validation rules — validation lives in the layers above.
  The country/dial-code picker behavior lives in `frontend/hooks/phoneInput/` on top of the
  primitive.

## 2. The shape decision: strict E.164

The accepted shape is strict E.164: a leading `+`, a non-zero country digit, and 8–15 digits
in total (e.g. `+201001234567`). Deliberate properties of this decision:

- **Dial-code data now exists — shape checking stays dial-code-independent.** The country →
  dial-code dataset shipped with the libphonenumber library
  (`shared/lib/phone/countries.ts`, `PHONE_COUNTRIES` — 243 entries) and feeds the frontend
  country/dial-code picker (`frontend/hooks/phoneInput/`). But the service-level format gate
  still never consults it: `validatePhoneField` keeps checking the pure E.164 shape, and no
  per-country rule is applied server-side to the stored value.
- **No masking or auto-formatting of the stored value.** The picker formats the national
  half for display only (`formatNationalDigits`); the emitted wire value is canonical E.164
  built from the selected dial code + national digits (`buildE164FromParts`).
- **`PHONE_MAX_LENGTH = 16` vs the `varchar(20)` column.** The wire ceiling is the leading
  `+` plus up to 15 digits (`PHONE_MAX_LENGTH = 16`), while the storage column is wider:
  `backend/db/schema/users/users.ts:17` declares `phone: varchar("phone", { length: 20 })`.
  The column is intentionally unchanged: it is nullable, it already fits the E.164 ceiling
  with headroom, and legacy rows may hold non-normalized values that a column narrowing would
  put at risk. Tightening or constraining the column is future migration work, not a
  validation concern. The database applies no uniqueness or shape constraint to `phone`.

## 3. The shared module — `shared/lib/phone.ts`

Three concerns form the contract: a pattern + length constant, a schema, a predicate, and a
normalizer (the schema is the single shape authority; the predicate and the checks all
delegate to it, so they can never disagree):

```ts
export const PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/;
export const PHONE_MAX_LENGTH = 16;

export const phoneSchema = z
  .string()
  .trim()
  .min(1, { message: "PHONE_REQUIRED" })
  .max(PHONE_MAX_LENGTH, { message: "PHONE_TOO_LONG" })
  .regex(PHONE_E164_PATTERN, { message: "PHONE_INVALID" });

export function isValidPhone(value: string): boolean {
  return phoneSchema.safeParse(value).success;
}

export function normalizePhone(value: string): string {
  const stripped = value.replace(/[ ()-]/g, "").trim();
  return stripped.startsWith("+") ? `+${stripped.replace(/^\++/, "")}` : stripped;
}
```

Semantics worth knowing before you compose these:

- `phoneSchema` trims, then checks required → too-long → invalid, in that order. The schema
  tolerates edge whitespace; stripping user-formatted separators is the caller's job via
  `normalizePhone`.
- `isValidPhone` is pure and synchronous, never throws, and tolerates surrounding whitespace.
- `normalizePhone` strips ASCII spaces, dashes, and parentheses **before** trimming (that
  ordering is what makes it idempotent), collapses runs of leading `+` to one, and never
  invents a `+` or prepends a country code. Pure, deterministic, idempotent:
  `normalizePhone(out) === out`.
- `PHONE_E164_PATTERN` is a module-level frozen regex with no `g` flag — no `lastIndex` state
  to leak between calls.

### 3a. The libphonenumber library — `shared/lib/phone/`

The dial-code/country feature (formerly deferred to
[issue #230](https://github.com/kottaby/kottaby/issues/230)) has shipped as a **directory
sibling** of the shape module: `shared/lib/phone/` contains the ported google-libphonenumber
library and the country dataset. Because `shared/lib/phone.ts` also exists, the bare alias
`@/shared/lib/phone` still resolves to the **zod shape gate** — the libphonenumber library
MUST be consumed through its deep paths:

- `@/shared/lib/phone/parse` — `buildE164FromParts`, `parsePhoneToE164`, `isPhoneValidForRegion`,
  `isCompletePhoneValid`, `splitPhoneValueToParts`
- `@/shared/lib/phone/calling-code` — `getCallingCodeForRegion`, `matchCallingCodeFromDigits`,
  `isCallingCodePrefixValid`, `isCallingCodeComplete`, `getMaxCallingCodeLength`,
  `canAppendCallingCodeDigit`
- `@/shared/lib/phone/national-format` — `formatNationalDigits`, `getNextFormatChar`,
  `clampSelectionToDigits`
- `@/shared/lib/phone/countries` — `PhoneCountry`, `PHONE_COUNTRIES` (243 entries; suggested
  EG/SA/AE/US/GB first), `getPhoneCountry`, `resolvePhoneCountryByCallingCode`
- `@/shared/lib/phone/types` — `ParsePhoneResult`, `CallingCodeMatch`

Why both modules exist and neither replaces the other:

- `shared/lib/phone.ts` (zod) is the **lexical shape gate** — a fixed-template,
  machine-code-emitting validator wired into the service-level `validatePhoneField` gate and
  its localized `extensions.fields[]` envelope. Its codes (`PHONE_REQUIRED`,
  `PHONE_TOO_LONG`, `PHONE_INVALID`) are the wire vocabulary the tests pin.
- `shared/lib/phone/` (libphonenumber) is the **semantic validation + input-UX library** —
  per-region validity, calling-code parsing/matching, and national display formatting for
  the picker. It returns E.164-or-null results and never throws.
- Keeping the zod gate authoritative for server-side rejection preserves the documented
  wire contract (fixed localized templates, machine codes, per-locale messages); the
  libphonenumber library powers client-side affordances and the GraphQL `PhoneNumber` scalar
  (Section 10) without altering any mutation input type.

## 4. Machine codes, never user copy

The zod `message` values carried by `phoneSchema` — `PHONE_REQUIRED`, `PHONE_TOO_LONG`,
`PHONE_INVALID` — are **machine codes, not user-facing text**. Keeping the codes inside the
schema keeps the shared module free of i18n and of any layer dependency. Producers translate
each code into localized copy at their own boundary:

| Code | Raised by | Localized to (server gate) |
|---|---|---|
| `PHONE_REQUIRED` | empty/whitespace-only value | `auth.phoneRequired` |
| `PHONE_TOO_LONG` | more than `PHONE_MAX_LENGTH` chars | `errors.validation` |
| `PHONE_INVALID` | fails the E.164 pattern | `auth.phoneInvalid` |

Frontend surfaces render their own per-namespace copy for the same condition (register →
`auth.phoneInvalid`; admin create/edit dialogs → the `adminUsers` dialog labels; onboarding →
`studentOnboarding.fields.phoneInvalid`), so no surface depends on another's vocabulary.
Never hardcode any of these strings at a call site and never surface the raw codes as copy.

## 5. The server gate — `backend/services/shared/phone-validation.helpers.ts`

One function is the whole gate:

```ts
export function validatePhoneField(value: string, locale: string): ApiFieldErrorType | null {
  const parsed = phoneSchema.safeParse(value);
  if (parsed.success) {
    return null;
  }
  const code = parsed.error.issues[0].message;
  const translations = getServerTranslations(locale);
  switch (code) {
    case "PHONE_REQUIRED":
      return { field: "phone", code, message: translations.authTranslations.phoneRequired };
    case "PHONE_TOO_LONG":
      return { field: "phone", code, message: translations.errorsTranslations.validation };
    case "PHONE_INVALID":
      return { field: "phone", code, message: translations.authTranslations.phoneInvalid };
    default: {
      // Exhaustiveness guard — phoneSchema emits only the three codes above.
      throw new Error(`Unexpected phone validation code: ${code}`);
    }
  }
}
```

Contract details:

- Returns `null` when the value parses; otherwise the localized field error for the **first**
  failing schema check (the `field` is always the literal `"phone"`).
- `ApiFieldErrorType` comes from `@/backend/types` — it is never redefined locally.
- `getServerTranslations(locale)` (from `@/shared/locale/server-graphql`) supplies the
  templates; the returned `message` is a fixed localized template and **never contains the
  submitted value**.
- Pure and synchronous — no DB, no I/O — so the format gate can never act as a tenancy or
  enumeration oracle.
- The wire value is parsed as-is; canonicalization of separators stays the caller's concern
  via `normalizePhone`.
- Consumers: `backend/services/auth/registration.service.ts` (public registration) and
  `backend/services/admin/user-management.helpers.ts` (`validateCreateInput` /
  `validateUpdatePatch`). Student onboarding inherits the gate through `createUser` with no
  code of its own.

## 6. The input primitive — `frontend/components/ui/PhoneInput.tsx`

A presentation-only MUI field (`TextField` under the hood, `Readonly` props) rendering two
native inputs inside one outline: a flag button + borderless dial-code ("prefix") input in
the start adornment, and the national-number input as the field value. It owns the tel
semantics, the bidi scaffolding (the field root is wrapped in `dir="ltr"` so flag, dial
code, and number read left-to-right on RTL (ar) pages), the attached country picker
(`frontend/components/ui/PhoneCountryPicker.tsx`), and **no** server-shaped validation
rules:

- Live client hints only: `invalidPrefix` (dial code that matches no country) and the
  live invalid-phone hint, resolved by the fixed priority documented in the component:
  `prefixInvalid → required-empty → caller helperText → live invalidPhone`. The caller's
  `helperText` (typically the projected server copy) therefore wins over the live hint.
- `helperText ?? " "`-style layout reservation is preserved: the helper line never
  collapses, and the `FormHelperText` region announces politely without focus movement.
- `label` is optional and falls back to the `phoneInput` namespace default; admin/
  onboarding surfaces pass `hideLabel` because they render their own labeled field row
  above the input. `fullWidth` defaults to `true`.
- Callers project validity through `error` / `helperText` — `aria-invalid` is computed
  inside the field from its error state, never passed in. Server field errors ride the
  same `error`/`helperText` pair, so server-side error projection flows in unchanged.
- React Hook Form callers use the `Controller` binder
  `frontend/components/ui/PhoneFormField.tsx` (optional `rules` passthrough); controlled
  callers pass `value` / `onChangeAction` directly. There is no `register(...)` spread
  and no `forwardRef` — the component owns both native inputs.
- Storybook: `frontend/stories/ui/PhoneInput.stories.tsx` exercises both usage modes,
  the picker, live-invalid states, and RTL.

### 6a. The country/dial-code picker — `frontend/hooks/phoneInput/`

The phone-input UX for the country-selector feature lives in a hook layer on top of the
primitive, not inside it:

- `usePhoneInput` (`frontend/hooks/phoneInput/usePhoneInput.ts`) is the state machine: it
  splits the value into a dial-code ("prefix") slot and a national slot
  (`splitPhoneValueToParts`), owns the country picker open/close state, and exposes
  `selectCountry`, keyboard navigation across the two slots, and derived validity flags
  (`prefixInvalid`, `phoneInvalid`, `isValid` — computed via `isCallingCodePrefixValid` /
  `isCompletePhoneValid`).
- The emitted wire value is canonical E.164: `buildE164FromParts(prefixDigits,
  nationalDigits)` from `@/shared/lib/phone/parse` (an in-progress number falls back to the
  raw `+<prefix><national>` string so the server round-trip can still reject it with the
  localized envelope). The emitted value therefore keeps satisfying the Section 3 shape gate.
- The national half is formatted for display only (`formatNationalDigits` +
  `clampSelectionToDigits` handle caret-safe national formatting); the stored/emitted value
  is never masked.
- The country list comes from `PHONE_COUNTRIES` (`@/shared/lib/phone/countries`) — 243
  entries with flag + `nameEn`/`nameAr` + dial code; the picker labels live in the
  `phoneInput` locale namespace (keys: `label`, `selectCountry`, `invalidPrefix`,
  `invalidPhone`, `required`, `countryCallingCode`, `phoneNumber`), consumed via
  `useAppTranslation(PhoneInput)`.
- The primitive itself stays presentation-only: the picker decorates around `PhoneInput`
  (dial-code field + country menu), and the server-side gate (Section 5) is unchanged.

## 7. The two frontend validation modes

There is no `@hookform/resolvers` anywhere in this flow (no zod-to-RHF resolver bridge) — the
two surfaces bind the shared predicate differently:

**Mode A — React Hook Form inline `validate` (register form).**
`frontend/views/auth/register/RegisterIdentityFields.tsx` binds the phone field through the
`PhoneFormField` controller binder and computes the message from the shared predicate at
submit/blur time (the `rules` ride the controller — the same inline contract `register`
carried before):

```tsx
<PhoneFormField
  name="phone"
  control={control}
  rules={{
    required: t.phoneRequired,
    validate: value => (isValidPhone(value) ? true : t.phoneInvalid),
  }}
  label={t.phone}
  required
  error={Boolean(errors.phone)}
  helperText={errors.phone?.message ?? " "}
/>
```

**Mode B — controlled state with `isValidPhone` error computation (admin/onboarding).**
The admin create/edit dialogs and the onboarding profile section
(`frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx`) own plain state
and compute the phone error from the shared predicate, with any projected server field error
taking precedence over the instant client hint:

```tsx
const phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone);
const phoneError = Boolean(fieldErrors.phone) || phoneClientError;
const phoneErrorText = fieldErrors.phone ?? (phoneClientError ? t.fields.phoneInvalid : " ");

<PhoneInput
  id={field.id}
  value={form.phone === "" ? null : form.phone}
  onChangeAction={value => setForm(prev => ({ ...prev, phone: value ?? "" }))}
  required
  disabled={submitting}
  hideLabel
  error={phoneError}
  helperText={phoneErrorText}
/>
```

In both modes the client check is **advisory only** — a fast hint. The server round-trip
(Section 5) is what decides.

## 8. Update patch semantics (admin user updates)

The admin update path is a patch, not a whole-object replace. The precise wire semantics
(`validateUpdatePatch` / `buildUpdatePatch` in `backend/services/admin/user-management.helpers.ts`):

| Wire input | Behavior |
|---|---|
| `phone` key **absent** | Skipped entirely — not validated, not written. Absent ≠ required. |
| `phone: ""` / whitespace | **Reachable** on the update path and **stored verbatim** — the format gate is skipped deliberately for this admin-only surface; an empty string clears the phone. |
| `phone: null` | Normalized to absent (skip), not written as SQL `NULL`. |
| `dateOfBirth: null` | Explicit clear — reset to SQL `NULL` at the service layer. |
| Edit dialog UI | Omits the `phone` key entirely when the user clears the field, so the normal UI flow rides the "absent = skip" branch; only a raw wire client can hit the empty-string branch. |
| Extra/unknown fields | Never copied — the update maps an explicit allow-list of patchable fields. |

Create-path semantics differ: `validateCreateInput` runs the full phone gate, so an invalid or
empty phone is rejected there.

## 9. Rules

1. **The server is the trust boundary.** `validatePhoneField` runs server-side on every phone
   write path regardless of any client check. Client validation is advisory UX only and must
   never be treated as authorization.
2. **Zod `message` = machine code.** `PHONE_REQUIRED` / `PHONE_TOO_LONG` / `PHONE_INVALID` are
   codes, never user text; producers localize them (`PHONE_TOO_LONG` → `errors.validation`,
   `PHONE_INVALID` → `auth.phoneInvalid`, `PHONE_REQUIRED` → `auth.phoneRequired`).
3. **Validation is pure and synchronous.** No DB, no I/O, no clock — a pure predicate cannot
   leak tenancy or act as an enumeration oracle.
4. **Fixed templates only.** Error messages are fixed localized templates; the submitted value
   is never interpolated or echoed back.
5. **One shape authority.** Add/derive any new phone logic from `phoneSchema` (or the existing
   exports) — never re-implement the regex at a call site.

## 10. Anti-patterns

- **Client-only validation as authorization** — gating any server action on the client
  predicate, or trusting that the UI already validated.
- **Importing the libphonenumber library via the bare alias** — `@/shared/lib/phone`
  resolves to the zod shape gate (`shared/lib/phone.ts`); the libphonenumber library must be
  deep-imported (`@/shared/lib/phone/parse`, `.../calling-code`, `.../national-format`,
  `.../countries`, `.../types`). There is no barrel — the directory's `index.ts` was removed
  precisely because the alias shadows it.
- **Two validators disagreeing on the wire contract** — the libphonenumber library powers
  client affordances and the scalar; it must never replace `phoneSchema` as the server-side
  rejection authority. The localized VALIDATION envelope (`extensions.fields[]`) is the
  documented wire contract, and scalar-level coercion errors cannot be localized
  per-request-locale.
- **Applying the `PhoneNumber` scalar to existing mutation inputs** — the scalar is
  registered (`backend/graphql/scalars/phoneNumberScalar.ts`, via the scalar registry in
  `backend/graphql/pothos/shared/scalar.pothos.ts`) for FUTURE input fields; existing phone
  mutation inputs intentionally stay `String`, and field errors keep flowing through the
  existing `ApiFieldErrorType` envelope. No new phone enum/union in the schema, and no
  re-typing of any existing field.
- **`{ ...input }` mass-assignment on update** — spreading a wire patch into
  `update().set()`; always map an explicit allow-list (Section 8).
- **Echoing raw input in errors** — messages are fixed templates; never interpolate the
  submitted phone (or any hostile input) into a message. The `PhoneNumber` scalar throws a
  `GraphQLError` whose message is the machine code `PHONE_INVALID` — never the submitted
  value.
- **React Hook Form in controlled surfaces** — admin dialogs and onboarding own plain state
  and project server errors; do not introduce `useForm`/`register` there, and do not add a
  resolver bridge (`@hookform/resolvers`) anywhere in this flow.
- **Assuming the DB enforces the shape** — the column is a plain nullable `varchar(20)` with
  no uniqueness or shape constraint; validation happens in the layers above.

## 11. Rollout Summary

- **Shipped:** the shared E.164 module (`shared/lib/phone.ts` with unit tests), the server
  gate wired into registration and admin create/update (onboarding inherits via `createUser`),
  the `PhoneInput` primitive with its Storybook story, both frontend validation modes, the
  `phoneInvalid` i18n key across the three namespaces (en + ar), a 9-step registration journey
  test (`test/workflows/auth/registration-phone.journey.test.ts`), and a GraphQL wire test
  (`frontend/graphql/test/auth/auth.test.ts`).
- **Shipped with the country-selector feature (formerly issue #230):** the ported
  libphonenumber library in `shared/lib/phone/` (parse/calling-code/national-format/countries
  + tests), the `phoneInput` locale namespace (en + ar), the `usePhoneInput` country/dial-code
  picker hook layer (`frontend/hooks/phoneInput/`), and the registered `PhoneNumber` GraphQL
  scalar (`backend/graphql/scalars/phoneNumberScalar.ts` — SDL carries `scalar PhoneNumber`;
  frontend codegen maps it to `string`). The scalar is **registered but not yet applied**:
  every existing phone mutation input remains `String` because the localized VALIDATION
  field-error envelope is the wire contract.
- **Not shipped (deliberate):** input masking/auto-formatting of the stored value, per-country
  server-side rejection rules, a `users.phone` column migration, uniqueness enforcement, admin
  phone-search normalization, and backfill of legacy non-E.164 rows. These need a dedicated
  storage-migration effort.
- **Exported, awaiting consumers:** `normalizePhone` and `PHONE_E164_PATTERN` currently have
  no production consumer. They are deliberate public API of the shared module — kept for the
  normalization hand-off when real consumers land (search matching, legacy-value
  canonicalization) — not dead code. Do not remove them.

## 12. Related Documents

- `shared/lib/phone.ts` — the shape authority (schema, predicate, normalizer) + `shared/lib/phone.test.ts`
- `shared/lib/phone/` — the libphonenumber library (parse, calling-code, national-format,
  countries) + `shared/lib/phone/phone-number.test.ts`
- `backend/services/shared/phone-validation.helpers.ts` — the server gate (+ its test)
- `backend/graphql/scalars/phoneNumberScalar.ts` — the registered-but-not-yet-applied
  `PhoneNumber` GraphQL scalar; `backend/graphql/pothos/shared/scalar.pothos.ts` — its registry
- `frontend/components/ui/PhoneInput.tsx` — the shared input primitive · `frontend/stories/ui/PhoneInput.stories.tsx`
- `frontend/hooks/phoneInput/` — the country/dial-code picker hook layer (`usePhoneInput`)
- `frontend/views/auth/register/RegisterIdentityFields.tsx` — Mode A (RHF inline validate)
- `frontend/views/admin/users/dialogs/CreateUserFormGrid.tsx`, `EditUserFormFields.tsx` and `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` — Mode B (controlled)
- `backend/services/auth/registration.service.ts`, `backend/services/admin/user-management.helpers.ts` — consumers of the gate
- `test/workflows/auth/registration-phone.journey.test.ts` — cross-actor journey; `frontend/graphql/test/auth/auth.test.ts` — wire test
