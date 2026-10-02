# Requirements Specification — Country Selector Component

**Plan Directory:** `ai/plans/issue_230/no_country_selector_component/`
**Outcome Directory:** `ai/plans/issue_230/no_country_selector_component/outcome/`
**Source Issue:** GitHub issue #230 — "No Country Selector Component" (not a milestone ticket; milestone dir is therefore `issue_230`)
**Version:** 1.0
**Date:** 2026-09-30
**Author:** AI implementation-plan agent
**Stakeholders:** Product (Kottaby), Backend, Frontend, QA

---

## 1. Introduction

Kottaby collects a user's country during public registration, but that field is
today a free-text `TextField` (`frontend/views/auth/register/RegisterIdentityFields.tsx:86-101`)
registered as `{...register("country", { required: t.countryRequired })}`. Users
can type arbitrary strings ("Egypt", "eg", "EGYPT", "  eg  ", garbage), so the
stored value in `users.country` (`backend/db/schema/users/users.ts:22`,
`varchar("country", { length: 100 })`) is unnormalized and unusable for any
cohort, analytics, or broadcast feature without fuzzy cleanup.

Issue #230 asks for a first-class country input: a component with a flag
(start adornment), validation on both tiers, a dedicated GraphQL scalar, and a
shared Zod schema. This specification defines the observable behavior of that
feature. It does **not** prescribe code structure — the frozen design contract
(decisions D1–D12) is captured in `plan.md`; this document is the *what*, not
the *how*.

### 1.1 Feature Summary

A new reusable `CountrySelector` component backed by a committed, generated ISO
3166-1 alpha-2 dataset, validated by a shared Zod schema usable by both the
frontend register form and backend registration/admin services, and transported
through a new `CountryCode` GraphQL scalar.

### 1.2 Business Value

- **Data quality:** `users.country_code` becomes a normalized, queryable ISO
  alpha-2 value instead of free text — enabling reliable country cohorts,
  broadcasts, and analytics.
- **UX:** users pick from a searchable, localized, flag-annotated list instead
  of typing, eliminating typos and locale guesswork; Arabic and English names
  are both supported.
- **Consistency:** one Zod schema is the single source of truth for country
  validity across frontend and backend — no drift between client and server.
- **Contract safety:** a typed `CountryCode` scalar makes the wire contract
  explicit and rejects malformed values at the schema boundary.

### 1.3 Scope

**In scope:**
- REQ-1 … REQ-11 below: dataset + generator, shared Zod schema, `CountryCode`
  GraphQL scalar, backend registration/admin validation, `CountrySelector`
  component, register-form integration, ar/en i18n, nullable `country_code`
  persistence, tests, and documentation/knowledge propagation.

**Out of scope (explicitly deferred — see `deferred-items.md`):**
- Dial-code / phone-country metadata and any phone-country linkage.
- Normalizing legacy free-text `country` values ("Egypt", "EG") or backfilling
  historical rows.
- Repointing existing consumers of the free-text `country` (broadcast
  `audienceCountry`, admin directory filter, profile display) at ISO codes.
- Replacing the admin directory country filter with `CountrySelector`.
- Exposing `CountryCode` on output/entity types (`users/user.pothos.ts:39` stays
  `t.exposeString("country", { nullable: true })`).
- `Intl.DisplayNames` or non-CLDR locale fallbacks beyond ar/en.

---

## 2. Actors

| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Guest / Registrant | anonymous (unauthenticated) | open `/register`, choose a country from `CountrySelector`, submit the form, see inline validation | access any authenticated route; create admin users |
| Admin | `admin` role (`UserRole.Admin`) — the admin-create mutation is gated by `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (`backend/graphql/mutation/admin/admin-users.mutation.ts:64-67`) | create users through the admin user form (country field validated by the same shared schema) | bypass server validation by transport tampering |

### 2.1 Journey Capture — N/A + Rationale

**This is a single-actor feature: no cross-actor journey exists.** Each actor
submits a form and observes only their own inline validation feedback; no shared
state is co-edited and no second actor responds to or transitions the outcome.
Consequently:

- No **Actor Table** interaction steps are required (each actor's flow is
  independent and per-request).
- Acceptance criteria below are phrased from the **observer's perspective where
  relevant** (e.g. the registrant observing the inline error, the admin
  observing the rejected submit), but they do not form multi-actor sequences.
- **No `test/workflows/<domain>/<journey>.test.ts` test will be created** for
  this feature. Journey coverage is intentionally omitted with this rationale
  (restated in `plan.md` § Journey Design and `tasks.md`).

---

## 3. User Stories

- **US-1 (Guest/Registrant):** As a prospective student/teacher/parent, I want
  to pick my country from a searchable list that shows a flag and my language's
  country name, so that I do not have to type it correctly and cannot submit an
  invalid country.
- **US-2 (Admin):** As an admin creating a user, I want the country field to
  accept only valid ISO codes enforced by the same rule as registration, so that
  every user row is consistent.
- **US-3 (Developer):** As a Kottaby engineer, I want one shared country
  dataset + Zod schema and one `CountryCode` GraphQL scalar, so that validation
  lives in one place and the wire contract is explicit.
- **US-4 (Data consumer):** As a downstream consumer of user data, I want a
  normalized `country_code` column, so that cohorts and analytics can filter by
  country deterministically.

> **Note on the template's "Requirement 0":** the baseline / execution-protocol
> requirement is captured here as **REQ-11** (Feature-6 criteria restated
> there) so that the frozen `REQ-1..REQ-11` ids remain the single numbering in
> this feature.

---

## 4. Requirements (REQ-1 … REQ-11)

### REQ-1: Country Dataset (Generated, Committed)

**User Story:** As a developer, I want a committed, generated dataset of ISO
3166-1 alpha-2 country codes with localized names and flag emoji, so that both
tiers share one authoritative list.

#### Acceptance Criteria

1. WHEN the feature is built THEN the system SHALL provide `shared/constants/countries.ts`
   exporting `COUNTRY_CODES` (a readonly tuple of uppercase ISO 3166-1 alpha-2
   codes), `CountryCode` (the union type derived from `COUNTRY_CODES`), and
   `COUNTRIES` (a `Record<CountryCode, { en: string; ar: string; flag: string }>`).
2. WHEN a `CountryCode` is looked up in `COUNTRIES` THEN the system SHALL return
   the English name, the Arabic name, and a regional-indicator flag emoji
   derived deterministically from the code.
3. WHEN the data file is opened THEN the system SHALL carry an
   `AUTO-GENERATED … do not edit manually` header identifying the generator.
4. WHEN the dataset is regenerated THEN the system SHALL produce it via a new
   script `scripts/country-data-generator/` invoked by an npm script
   `generate:countries`, mirroring the `scripts/iana-timezone-generator/`
   pattern and reading CLDR (`cldr-localenames-full`) for ar/en names.
5. IF a territory code is curated out of the dataset THEN the generator SHALL
   apply it via an explicit exclusion set (the `iana-timezone-generator`
   `EXCLUDED_TERRITORY_CODES` / remap precedent) rather than ad-hoc filtering.
6. WHEN `COUNTRY_CODES` is consumed THEN the system SHALL expose it via deep
   import (`@/shared/constants/countries`) and SHALL NOT add it to the
   `shared/constants/index.ts` barrel (matching the iana files' deliberate
   deep-import-only treatment).

#### Additional Details
- **Priority:** High — foundational for REQ-2, REQ-3, REQ-5.
- **Complexity:** Medium (CLDR extraction + curation).
- **Dependencies:** `cldr-localenames-full` devDependency (already installed;
  `package.json:147-149`).
- **Assumptions:** CLDR `main/ar/territories.json` and `main/en/territories.json`
  supply names; the emoji is derived from the ISO code (no image assets).

---

### REQ-2: Shared Zod Schema & Guards

**User Story:** As a developer, I want a shared Zod schema and guards for ISO
3166-1 alpha-2 country codes, so that frontend and backend validate identically.

#### Acceptance Criteria

1. WHEN code needs to validate a country value THEN the system SHALL provide
   `shared/lib/country-code.ts` exporting `COUNTRY_CODE_PATTERN` (`^[A-Z]{2}$`),
   `normalizeCountryCode`, `isValidCountryCode`, `countryCodeSchema`, and
   `countryCodeShapeSchema`.
2. WHEN `normalizeCountryCode(raw)` is called THEN the system SHALL trim
   surrounding whitespace and uppercase the result.
3. WHEN `countryCodeSchema.safeParse(value)` runs THEN the system SHALL first
   normalize (trim + uppercase) and then require membership in `COUNTRY_CODES`;
   a value that is not a member SHALL fail parse.
4. WHEN `countryCodeShapeSchema.safeParse(value)` runs THEN the system SHALL
   validate only the ISO *shape* (two letters, case-insensitive) without
   membership — for shape-only validation where dataset membership is not
   required (the GraphQL scalar enforces the `graphql-scalars` library's full
   ISO list separately).
5. WHEN `isValidCountryCode(value)` is called with a non-string (including
   `null`/`undefined`) THEN the system SHALL return `false` without throwing.
6. WHEN the module is imported by either tier THEN the system SHALL import `z`
   from `zod` and `COUNTRY_CODES`/`CountryCode` from `@/shared/constants/countries`
   and SHALL NOT import from `@/frontend/**`, `@/backend/**`, or `@/app/**`
   (shared-layer boundary).
7. IF an unnormalized value such as `" eg "` is parsed THEN the system SHALL
   accept it and normalize to `"EG"`; IF `"EGYPT"` or `"E1"` is parsed THEN the
   system SHALL reject it.

#### Additional Details
- **Priority:** High.
- **Complexity:** Low–Medium.
- **Dependencies:** REQ-1; `zod ^4.6.2` (`package.json:116`).
- **Assumptions:** Zod is already a project dependency; no new package is added
  (D10).

---

### REQ-3: `CountryCode` GraphQL Scalar

**User Story:** As a developer, I want a registered `CountryCode` GraphQL
scalar, so that the wire contract is typed and malformed codes are rejected at
the boundary.

#### Acceptance Criteria

1. WHEN the GraphQL schema is built THEN the system SHALL register a scalar
   named `CountryCode` exactly once in
   `backend/graphql/pothos/shared/scalar.pothos.ts` using `CountryCodeResolver`
   from `graphql-scalars` (the scalar registry is `shared/scalar.pothos.ts:24,30`).
2. WHEN the builder types scalars THEN `backend/graphql/pothos/builder.ts`
   SHALL add `CountryCode: { Input: string; Output: string }` to the `Scalars`
   slot (currently only `DateTime`, `builder.ts:75-84`).
3. WHEN frontend codegen maps scalars THEN `codegen.ts` SHALL map
   `CountryCode: "string"` alongside the existing entries (`codegen.ts:20-29`),
   preserving `strictScalars: true` (`codegen.ts:18`).
4. WHEN the SDL/codegen are regenerated THEN the system SHALL run
   `bun run generate:gqlSchema` (writes `frontend/graphql/generated/schema.graphql`)
   then `bun codegen` (writes `frontend/graphql/generated/gql/graphql.ts`), and
   both generated artifacts SHALL be committed.
5. WHEN the schema surface test runs THEN
   `backend/graphql/test/schema-surface.test.ts` SHALL pin `scalar CountryCode`
   (per `backend/graphql/pothos/AGENTS.md`).
6. IF a client submits a string that is not an ISO 3166-1 alpha-2 code (per the
   `graphql-scalars` resolver's hardcoded full-country list) into a
   `CountryCode` field THEN the scalar SHALL reject it (transport-level
   coercion failure), independent of service-layer validation. The resolver is
   case-insensitive (`/i`) and returns the value **unchanged** — it does NOT
   normalize; a code present in the library list but curated out of
   `COUNTRY_CODES` still reaches the service, where `countryCodeSchema` rejects
   it.

#### Additional Details
- **Priority:** High.
- **Complexity:** Low–Medium.
- **Dependencies:** REQ-1, REQ-2; `graphql-scalars ^2.0.0` (`package.json:104`)
  which exports `CountryCodeResolver`.
- **Assumptions:** Scalar registration ordering in
  `backend/graphql/gqlSchema.definitions.ts:15` (objects → scalar → enum →
  mutation → query) is preserved.

---

### REQ-4: Backend Validation (Registration + Admin)

**User Story:** As a platform owner, I want the backend to reject absent or
invalid country codes with localized field errors, so that no unvalidated
country reaches the database.

#### Acceptance Criteria

1. WHEN public registration is submitted THEN
   `backend/services/auth/registration.service.ts` `validateInput()` SHALL
   validate `input.country` with `countryCodeSchema.safeParse` instead of the
   free-text empty-check (`registration.service.ts:221-223`).
2. IF the country value is empty/missing THEN the system SHALL emit a field
   error with `field: "country"`, code `COUNTRY_CODE_REQUIRED`, and the
   localized `countryCodeRequired` message.
3. IF the country value is malformed or not a member of `COUNTRY_CODES` THEN the
   system SHALL emit `field: "country"`, code `COUNTRY_CODE_INVALID`, and the
   localized `countryCodeInvalid` (falling back to `errors.validation`).
4. WHEN validation collects one or more entries THEN the system SHALL throw
   `ValidationError(entries[0].message, entries)` (existing behavior,
   `registration.service.ts:244-246`), preserving `REGISTER_FIELD_PATHS`
   projection on the `country` path.
5. WHEN the user row is created THEN `createUserRow()` SHALL write the
   normalized ISO code to `countryCode` **and** the English display name
   (`COUNTRIES[code].en`) to the legacy `country` column, field-by-field with no
   spread (BOPLA discipline; `registration.service.ts:249-280`, `:268`).
6. WHEN an admin creates a user THEN `backend/services/admin/user-management.helpers.ts`
   `validateCreateInput` SHALL apply the same `countryCodeSchema` validation with codes
   `COUNTRY_CODE_REQUIRED` / `COUNTRY_CODE_INVALID` replacing the current
   `COUNTRY_REQUIRED` (`user-management.helpers.ts:174`). The admin **update** patch
   (`validateUpdatePatch`, `:220-225` `COUNTRY_INVALID`) and the admin directory **filter**
   stay on the legacy free-text `country` (deferred D-4; §2.4).
7. IF an unauthenticated caller submits registration THEN the system SHALL
   validate the same way as any registrant (this path is intentionally anon);
   IF a non-privileged caller attempts admin user creation THEN the existing
   admin role gate (`authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`)
   SHALL reject it before validation runs.

#### Additional Details
- **Priority:** High.
- **Complexity:** Medium.
- **Dependencies:** REQ-2, REQ-8; Pothos inputs retyped per REQ-8's inventory.
- **Assumptions:** `country` remains a `string` on the submit-input types
  (`backend/types/users/registration.types.ts`) but now holds an ISO code.

---

### REQ-5: `CountrySelector` Component

**User Story:** As a registrant, I want a country picker with flags and
localized names, so that I can select accurately in my language and on my
device.

#### Acceptance Criteria

1. WHEN the component renders THEN the system SHALL provide
   `frontend/components/ui/CountrySelector.tsx`, an MUI v9 `Autocomplete` over
   `COUNTRY_CODES`, with option labels being localized country names.
2. WHEN options are rendered THEN the system SHALL show a flag emoji in
   `renderOption` AND as a `startAdornment` on the input via `renderInput`.
3. WHEN the component is controlled THEN it SHALL expose the props interface
   `{ id?, name?, label, value: CountryCode | "", onChange(code: string), onBlur?, error?, helperText?, required?, disabled? }`.
4. WHEN the component needs UI text THEN it SHALL read `placeholder` and
   `noOptionsText` from `useAppTranslation(...)` for the `countrySelector`
   namespace — it SHALL NOT hardcode strings and SHALL NOT contain
   view-specific logic.
5. WHEN `renderInput` composes `params` THEN it SHALL merge
   `params.slotProps.htmlInput` (never replace `params.slotProps` wholesale),
   following the merged pattern at
   `frontend/views/admin/students/onboarding/OnboardStudentParentSection.tsx:86-101`.
6. WHILE the app is in RTL (Arabic) THEN the component SHALL render correctly:
   the start adornment SHALL appear on the leading (right) side and the AutoComplete
   popup SHALL respect `dir="rtl"`, with no hardcoded left/right positioning.
7. WHERE the viewport is mobile THEN the component SHALL be full-width and its
   interactive target SHALL meet a 44px minimum touch height.
8. IF an option list has no match for the typed query THEN the system SHALL
   display the localized `noOptionsText`.
9. WHEN the field has an error THEN the component SHALL set `aria-invalid` and
   associate `helperText` with the input.

#### Additional Details
- **Priority:** High.
- **Complexity:** Medium–High (RTL + MUI v9 adornment merge).
- **Dependencies:** REQ-1, REQ-7.
- **Assumptions:** No country/flag npm package or image assets are introduced;
  the flag is the emoji from REQ-1.
- **Storybook:** a colocated story at
  `frontend/stories/ui/CountrySelector.stories.tsx` is required.

---

### REQ-6: Register Form Integration

**User Story:** As a registrant, I want the country field on `/register` to be
the new selector, so that my input is validated before submit.

#### Acceptance Criteria

1. WHEN the register form renders THEN
   `frontend/views/auth/register/RegisterIdentityFields.tsx` SHALL replace the
   free-text country `TextField` (`RegisterIdentityFields.tsx:86-101`) with
   `CountrySelector`, wired through React Hook Form via `useController`/`Controller`.
2. WHEN `useRegisterFormState.ts` initializes the form THEN it SHALL add a
   `country` controller (alongside the existing select controllers at
   `useRegisterFormState.ts:49,54,60`) with `defaultValue: ""` and inline
   validation using `countryCodeSchema.safeParse` — **no `@hookform/resolvers`
   dependency is added** (the package is not installed).
3. WHEN `RegisterFormValues.country` is typed THEN it SHALL remain `string`
   (`registerFormUtils.ts:63-72`) holding the ISO code, and a
   `countryFromValue` guard SHALL pin the raw value back to a valid
   `CountryCode | ""` (mirroring the `roleFromSelectValue`/
   `genderFromSelectValue` pinning pattern).
4. IF the user submits with an empty country THEN the system SHALL block submit
   with the localized required message on the `country` path.
5. IF the server returns a `country` field error THEN the existing projection
   (`frontend/lib/mutationFieldErrors.ts`) SHALL surface it inline on the field.
6. WHEN the form submits THEN the payload SHALL carry the ISO code in
   `country` (matching REQ-4's validated input).

#### Additional Details
- **Priority:** High.
- **Complexity:** Medium.
- **Dependencies:** REQ-2, REQ-4, REQ-5, REQ-7.
- **Assumptions:** The register form's server-submit shape is unchanged apart
  from the country value semantics.

---

### REQ-7: i18n Labels (ar/en)

**User Story:** As an Arabic- or English-speaking user, I want the country
selector and its errors localized, so that I understand the UI in my language.

#### Acceptance Criteria

1. WHEN the feature ships THEN the system SHALL add a `countrySelector`
   namespace with labels `placeholder`, `noOptionsText`, and `fieldLabel`,
   registered per the recipe in `shared/AGENTS.md:201-216`:
   `shared/locale/types/countrySelector/index.ts`,
   `shared/locale/en/countrySelector/index.ts`,
   `shared/locale/ar/countrySelector/index.ts`,
   `shared/locale/namespaces/countrySelector/countrySelector.namespace.ts`
   (via `defineNamespace<Labels>("countrySelector.countrySelector", …)`),
   its sibling re-export `shared/locale/namespaces/countrySelector/index.ts`
   (`export * from "./countrySelector.namespace";`, mirroring `wallet/index.ts`),
   plus registry and message-bundle registration.
2. WHEN a namespace is registered THEN the system SHALL add it to
   `shared/locale/namespaces/registry.ts` and the `namespaces/index.ts`
   re-export barrel, add `<ns>Translations: <Ns>Labels` to `Translations` in
   `shared/locale/types/message.ts`, and bundle the slice in
   `shared/locale/en/messages.ts` + `shared/locale/ar/messages.ts`.
3. WHEN `AuthLabels` is extended THEN the system SHALL add
   `countryCodeRequired` and `countryCodeInvalid` to
   `shared/locale/types/auth/index.ts` (alongside the existing `countryRequired`
   at `:39`) with leaf implementations in `shared/locale/en/auth/index.ts:25,28`
   and `shared/locale/ar/auth/index.ts:25,28`.
4. WHEN the invalid message needs a fallback THEN the system SHALL reuse the
   existing `errors.validation` label.
5. WHEN the namespace is added THEN a colocated parity test
   `shared/locale/countrySelector-namespace.parity.test.ts` SHALL assert ar/en
   key parity, and `bun tsgo` SHALL pass.
6. WHEN a component renders localized text THEN it SHALL use the compile-time
   system: client via `useAppTranslation(...)`, server via
   `getTranslations(locale)` property access, API/scripts/tests via
   `getServerTranslations(locale)`, resolvers via `ctx.t("...")`.

#### Additional Details
- **Priority:** High.
- **Complexity:** Low–Medium (mechanical registration across 8 files).
- **Dependencies:** REQ-1 (names), REQ-5 (consumer).
- **Assumptions:** The `countryRequired` key may remain for backward
  compatibility but is superseded by `countryCodeRequired` on the register path.

---

### REQ-8: Persistence

**User Story:** As a data consumer, I want a normalized nullable
`country_code` column, so that country is queryable without touching legacy
free text.

#### Acceptance Criteria

1. WHEN the schema is updated THEN `backend/db/schema/users/users.ts` SHALL add
   a nullable `countryCode: varchar("country_code", { length: 2 })` column
   (the table currently has `country` at `:22` and no `country_code`).
2. WHEN the schema column is added THEN the system SHALL generate a committed
   migration under `backend/drizzle/<timestamp>_add_users_country_code/`
   (snapshot + `.sql`) via `bun drizzle-kit generate`, and apply it with
   `bun db migrate`; local development sync uses `bun db push`. The migration
   SHALL NOT use `CREATE INDEX CONCURRENTLY`.
3. WHEN `createUserRow()` inserts a user THEN it SHALL set `countryCode` to the
   normalized ISO code (REQ-4) while leaving legacy `country` populated with
   the English display name for backward compatibility.
4. WHEN legacy `country` values already exist THEN the system SHALL retain them
   untouched (no normalization, no backfill — deferred).
5. WHEN the registration submit-input type is updated THEN
   `backend/types/users/registration.types.ts` SHALL keep `country: string`
   (`RegistrationSubmitInput` and `AdminRegistrationSubmitInput`) now holding
   the ISO code, and the shared Pothos **input** field
   (`backend/graphql/pothos/shared/userFieldHelpers.ts:104`, composed by
   `backend/graphql/pothos/auth/register-input.pothos.ts` for the public input and by
   `backend/graphql/pothos/admin/admin-user.pothos.ts:313` `AdminCreateUserInput`) SHALL be
   retyped to the `CountryCode` scalar. The admin directory filter
   (`AdminUserFiltersInput.country`, `admin-user.pothos.ts:302`) and the admin update
   patch (`AdminUpdateUserInput.country`, `admin-user.pothos.ts:327`) stay `String`
   on legacy free text (deferred D-4; §2.4).
6. WHEN read paths run THEN `backend/db/repo/users/user.repository.ts` raw-SQL
   SELECT blocks (`:51-58`, `:83-90`) SHALL continue to compile; any addition of
   `country_code` to selects SHALL be explicit (no `SELECT *`).

#### Additional Details
- **Priority:** High.
- **Complexity:** Medium (migration + type propagation + codegen).
- **Dependencies:** REQ-3, REQ-4.
- **Assumptions:** Migration journal is the DB table
  `drizzle.__drizzle_migrations` (`docs/DATABASE_MIGRATIONS.md`).

---

### REQ-9: Test Coverage

**User Story:** As a QA engineer, I want layered automated tests, so that the
dataset, validation, scalar, and UI are all verified.

#### Acceptance Criteria

1. WHEN shared logic is tested THEN the system SHALL add
   `shared/lib/country-code.test.ts` covering normalization, membership,
   shape-only parse, and non-string guards (Tier 1 unit).
2. WHEN database behavior is tested THEN the system SHALL wrap tests in
   `runInRollback` and pass `tx` to every repository call, asserting
   `country_code` persistence and legacy `country` population (Tier 2).
3. WHEN service validation is tested THEN the system SHALL assert
   `COUNTRY_CODE_REQUIRED` / `COUNTRY_CODE_INVALID` are emitted on the
   `country` field for registration and admin creation (Tier 3).
4. WHEN GraphQL is tested THEN the system SHALL exercise the `CountryCode`
   scalar through `testClient` + `setupTestServerLifecycle` — not raw `fetch` —
   and pin the schema surface in `backend/graphql/test/schema-surface.test.ts`.
5. WHEN frontend projection is tested THEN the known-field-path list
   `REGISTER_FIELD_PATHS` (`frontend/views/auth/register/registerFormUtils.ts:20-31`) SHALL
   be confirmed to include `country` (it already does), and
   `frontend/lib/mutationFieldErrors.test.ts` SHALL be extended to cover the `country`
   field-path codes (`COUNTRY_CODE_REQUIRED` / `COUNTRY_CODE_INVALID`) alongside its
   existing `REUSE_SET` fallback-key audit (`:238-249`).
6. WHEN the component is tested THEN `frontend/stories/ui/CountrySelector.stories.tsx`
   SHALL provide Storybook states (default, error, disabled, RTL, empty
   options).
7. WHEN any test is run by an agent THEN it SHALL use
   `bun run test/scripts/run-test.ts <path>` (never raw `bun test` for
   db/workflow tests).
8. WHEN the feature is complete THEN the system SHALL NOT add a
   `test/workflows/` journey test — single-actor feature (see §2.1).

#### Additional Details
- **Priority:** High.
- **Complexity:** Medium.
- **Dependencies:** all prior REQs.
- **Assumptions:** The production bundle for Paymob E2E is unrelated here.

---

### REQ-10: Documentation & Knowledge Propagation

**User Story:** As a future engineer, I want a canonical doc for scalar
registration and generated country data, so that I can extend these patterns
without rediscovering them.

#### Acceptance Criteria

1. WHEN the feature ships THEN the system SHALL create
   `docs/domain/graphql-scalars.md` documenting: the scalar-registration recipe
   (`shared/scalar.pothos.ts` → builder `Scalars` slot → `codegen.ts` map →
   `bun run generate:gqlSchema` + `bun codegen` → `schema-surface.test.ts`
   pin), and the generated-country-data pattern (generator layout, CLDR source,
   `generate:countries`, AUTO-GENERATED header, curation set).
2. WHEN a scalar is added in the future THEN the doc SHALL be the referenced
   procedure.
3. WHEN AGENTS docs describe changed behavior THEN the relevant `AGENTS.md`
   SHALL be updated to match (per root AGENTS.md).
4. WHEN the doc is added THEN it SHALL be linked from the plan's traceability
   and listed in the create/update inventory.

#### Additional Details
- **Priority:** Medium.
- **Complexity:** Low.
- **Dependencies:** REQ-1, REQ-3.
- **Assumptions:** `docs/domain/` is the canonical domain-doc location.

---

### REQ-11: Outcome Knowledge Base & Progress Tracking (Feature-6)

**User Story:** As an AI agent or developer, I want a baseline, an outcome
knowledge base, and persistent progress tracking, so that I can distinguish new
issues from pre-existing ones and avoid repeating research.

#### Acceptance Criteria

1. WHEN feature implementation begins THEN the system SHALL record baseline
   error counts to distinguish new from pre-existing issues:
   `bun tsgo 2>&1 | grep "error TS" | wc -l`,
   `bun biome:check 2>&1 | grep -c "warn"`, and
   `bun run scripts/lint-service.ts --json --id baseline`.
2. WHEN feature implementation begins THEN the system SHALL create the
   deferred-items ledger at
   `ai/plans/issue_230/no_country_selector_component/deferred-items.md` from the
   deferral template.
3. WHEN an executing agent starts any task THEN the system SHALL read ALL
   existing outcome files in
   `ai/plans/issue_230/no_country_selector_component/outcome/` to absorb prior
   research, search results, and pitfalls.
4. WHEN an executing agent completes any task THEN the system SHALL write a new
   outcome document under
   `ai/plans/issue_230/no_country_selector_component/outcome/<task-id>-outcome.md`
   detailing research findings, docs/web search results, implementation
   details, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN the system SHALL update
   the corresponding task checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the system SHALL execute per-file verification
   via `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`
   (runs tsgo → oxlint → biome → lint:type-aware → check:duplicates --file;
   auto-discovers applicable AGENTS.md + `.agents/instructions`; exit 0 = pass).
7. WHEN any subtask is marked complete THEN the system SHALL complete the
   semantic review checklist (race conditions, env-config, deferred items,
   cross-layer, enums) before marking `[x]` — `sub-loop.ts` handles mechanical
   checks but cannot detect semantic bugs.

#### Additional Details
- **Priority:** High (process).
- **Complexity:** Low.
- **Dependencies:** none.
- **Assumptions:** Baseline capture precedes any source edit.

---

## 5. Edge Cases

| # | Case | Expected Behavior |
|---|------|-------------------|
| E-1 | Empty string `""` | Rejected: `COUNTRY_CODE_REQUIRED` (registration/admin); client blocks submit with required message. |
| E-2 | Lowercase input `"eg"` | Accepted and normalized to `"EG"` by `countryCodeSchema` (trim + uppercase). |
| E-3 | Mixed case `"Eg"` | Accepted → `"EG"`. |
| E-4 | Whitespace `"  eg  "` | Trimmed then uppercased → `"EG"`. |
| E-5 | Unsupported ISO code `"XX"`, `"AA"`, `"ZZ"` | The `graphql-scalars@2.0.0` `CountryCodeResolver` rejects values outside its **hardcoded full ISO 3166-1 list** at the wire; a direct service call (bypassing GraphQL) also rejects them via `COUNTRY_CODES` membership → `COUNTRY_CODE_INVALID`. |
| E-6 | Non-isocode `"EGYPT"`, `"E1"`, `"Egypt"` (after upper `"EGYPT"`) | Rejected as `COUNTRY_CODE_INVALID` (fails shape or membership). |
| E-7 | `null` / `undefined` | `isValidCountryCode` returns `false`; schema rejects → `COUNTRY_CODE_REQUIRED`. |
| E-8 | Non-string (number/object) injected into scalar | GraphQL scalar coercion rejects at transport; service guard also returns false. |
| E-9 | Unknown code injection into the GraphQL scalar (e.g. `"XX"`, `"AA"`, `"ZZ"`) | `graphql-scalars@2.0.0` `CountryCodeResolver` validates against a **hardcoded full ISO 3166-1 list** (anchored regex, case-insensitive) and rejects non-members at the wire (`~/.bun/install/cache/graphql-scalars@2.0.0@@@1/esm/scalars/CountryCode.js`). Codes that ARE in the library list but curated out of `COUNTRY_CODES` (e.g. `IL`, `XK`) pass the scalar and are rejected by the service's `countryCodeSchema` membership check → `COUNTRY_CODE_INVALID`. |
| E-10 | Legacy values already stored (`"Egypt"`, `"EG"`) | Retained untouched; not read by new validation; no backfill (deferred). |
| E-11 | Unicode / RTL display names (Arabic) | Names come from CLDR; component renders RTL-correct with leading adornment on the right. |
| E-12 | Curated-out territory | Absent from `COUNTRY_CODES`; selection impossible; rejection as non-member if smuggled. |
| E-13 | `strictScalars: true` codegen | `CountryCode` must be present in `codegen.ts` map or codegen fails — adding the map entry is mandatory. |
| E-14 | Re-registering `CountryCode` scalar twice | Runtime error; scalar registered exactly once in `scalar.pothos.ts`. |
| E-15 | Flag emoji rendering on platforms without emoji fonts | Fallback glyph acceptable; no image asset dependency introduced. |

---

## 6. Constraints and Assumptions

### 6.1 Technical Constraints

- **No new npm dependency** (D10): RHF inline validation; no
  `@hookform/resolvers`; no country/flag package; flags are emoji.
- **ISO 3166-1 alpha-2 only** (D1): canonical identifier is uppercase two
  letters, pattern `^[A-Z]{2}$`.
- **Backward compatibility:** the legacy `country` column
  (`backend/db/schema/users/users.ts:22`) is retained untouched; `country_code`
  is nullable and additive.
- **Shared-layer boundary:** `shared/` code must never import
  `@/frontend/**`, `@/backend/**`, or `@/app/**` (ESLint enforced).
- **MUI v9:** style props must be inside `sx`; adornment patterns per
  `frontend/components/AuthFormShared.tsx:129` / `RegisterIdentityFields.tsx:41`; Autocomplete
  `params` merged, not replaced.
- **Compile-time i18n only:** no `next-intl`, no `shared/messages/`.
- **Regenerated artifacts committed:** `schema.graphql`, generated
  `graphql.ts`, and the Drizzle migration.
- **Migration discipline:** never `CREATE INDEX CONCURRENTLY`; generation via
  `bun drizzle-kit generate`, application via `bun db migrate`.

### 6.2 Business Constraints

- Single-actor feature: no journey test layer.
- Scope limited to what issue #230 requests; dial codes and legacy cleanup are
  deferred.

### 6.3 Assumptions

- CLDR `cldr-localenames-full` ar/en territories data is authoritative for
  names.
- `graphql-scalars ^2.0.0` exposes `CountryCodeResolver` in the installed
  version.
- The existing `country` field-error projection path (`REGISTER_FIELD_PATHS`,
  `mutationFieldErrors.ts`) needs no path change because the field name stays
  `country`.
- Registrants are anonymous by design; admin-create is permission-gated
  upstream.

---

## 7. UX / Navigation Requirements (MANDATORY)

### 7.1 New Routes & Role-Based Access

**This feature adds NO routes, NO pages, and NO role-gated surfaces.**

| Route | Purpose | Permission | Roles with Access |
|-------|---------|------------|-------------------|
| _(none new)_ | — | — | — |
| `/register` (existing) | embeds `CountrySelector` | public | Guest/anon |

### 7.2 Sidebar / Navigation Placement

**NONE.** No sidebar entry, no bottom-nav item, no new group, no menu item is
added. `CountrySelector` is embedded inside the existing `/register` form and is
designed for reuse elsewhere later (e.g. admin forms) without any navigation
change.

### 7.3 Per-Audience Notes

- **Public register (this plan):** the selector replaces the free-text country
  input in `RegisterIdentityFields.tsx`.
- **Admin forms:** reusable but re-pointing the admin directory filter and
  admin create form is deferred (see `deferred-items.md`).

### 7.4 Responsive, RTL & Accessibility

- **Desktop:** full-width field within the existing register form column;
  Autocomplete popup anchored to the input.
- **Mobile:** full-width; minimum 44px touch target; popup scrolls with a
  bounded max-height.
- **RTL (Arabic):** the flag start-adornment appears on the logical leading
  edge; no hardcoded `left`/`right`; text alignment inherits the document
  direction.
- **Accessibility:** the control exposes combobox semantics (MUI Autocomplete
  provides `role="combobox"` + listbox); `aria-invalid` set when `error` is
  true; helper text is associated with the input and carried in a polite live
  region (`formHelperText: { "aria-live": "polite" }`, matching the country
  field's `RegisterIdentityFields.tsx:99` / the shared pattern at `:46,66,83`); the flag emoji is decorative and SHALL NOT be
  the sole accessible name for an option (the localized name is).

---

## 8. Non-Functional Requirements

### 8.1 Performance

- WHEN the selector opens THEN the system SHALL render options from a
  static in-memory dataset with no network request.
- WHEN a user types THEN filtering SHALL be client-side and synchronous.

### 8.2 Security

- WHEN a user row is inserted THEN the system SHALL map fields explicitly
  (BOPLA; no object spread of client input).
- WHEN an unauthenticated caller submits registration THEN the system SHALL
  apply the same validation as any registrant.
- IF a non-privileged caller attempts admin user creation THEN the existing
  admin role gate (`$all` authenticated + `role: [UserRole.Admin]`) SHALL reject it.
- WHEN country names are rendered THEN the system SHALL render them as text
  (no HTML injection), sourced from the generated dataset.
- WHEN the generator runs THEN it SHALL read only known CLDR JSON paths and
  SHALL NOT execute untrusted input.

### 8.3 Usability

- WHEN an Arabic locale is active THEN all selector text SHALL be Arabic with
  RTL layout.
- IF the field is invalid THEN inline feedback SHALL appear within the same
  form submit cycle (client) or projection cycle (server).

### 8.4 Reliability

- IF the database migration is applied THEN it SHALL be transactional and
  additive (nullable column), allowing safe rollback by column drop.
- IF codegen is stale THEN CI/quality gates SHALL fail on the regenerated
  artifact mismatch.

---

## 9. Success Criteria

### 9.1 Definition of Done

- [ ] All REQ-1..REQ-11 acceptance criteria are met.
- [ ] `bun quality-gate` passes and `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 for every touched file.
- [ ] `bun run generate:gqlSchema` + `bun codegen` produce no uncommitted diff after commit.
- [ ] Migration generated and applied; `country_code` persists via registration.
- [ ] No new npm dependency; no new route/nav.
- [ ] Outcome files exist for each task; `tasks.md` checkboxes reflect completion.

### 9.2 Acceptance Metrics

- All shared unit, db (`runInRollback`), service, GraphQL (`testClient`), and
  frontend projection tests pass.
- ar/en `countrySelector` parity test passes; `bun tsgo` clean.
- `COUNTRY_CODE_REQUIRED` / `COUNTRY_CODE_INVALID` observed on the `country`
  field for empty and malformed inputs respectively.

---

## 10. Glossary

| Term | Definition |
|------|------------|
| ISO 3166-1 alpha-2 | Two-letter uppercase country code (e.g. `EG`, `SA`). |
| CountryCode | The GraphQL scalar and TypeScript union type for ISO alpha-2 codes. |
| CLDR | Unicode Common Locale Data Repository; source of localized country names. |
| Regional-indicator emoji | The flag emoji derived from a code's two letters. |
| BOPLA | Broken Object Property Level Authorization — mitigated by explicit field-by-field mapping. |
| Scalar | A custom GraphQL leaf type (here `CountryCode`) with input/output coercion. |
| country_code | New nullable DB column storing the normalized ISO code. |
| countrySelector | New compile-time i18n namespace for selector UI text. |

---

## 11. Requirements Review Checklist

### Completeness
- [x] All user stories have clear roles, features, and benefits.
- [x] Each requirement has specific acceptance criteria in EARS format.
- [x] Non-functional requirements are addressed.
- [x] Success criteria are defined and measurable.
- [x] Navigation/sidebar/tabs defined for all user types (explicitly: none).
- [x] Permissions mapped to all new routes/pages (explicitly: no new routes).
- [x] Cross-actor journeys captured OR explicitly ruled N/A with rationale (§2.1).

### Quality
- [x] Requirements are written in active voice.
- [x] Each acceptance criterion is testable.
- [x] Terminology is consistent (`CountryCode`, `country_code`, `countrySelector`).
- [x] No implementation-structure mandates beyond the frozen contract referenced
      from `plan.md`.

### EARS Format Validation
- [x] WHEN statements describe specific triggers.
- [x] IF statements describe conditions/states.
- [x] WHILE statements describe continuous behavior (RTL).
- [x] WHERE statements describe context (mobile/RTL).
- [x] All responses use SHALL.

### Traceability
- [x] Requirements numbered REQ-1..REQ-11 with frozen ids/titles.
- [x] Dependencies between requirements documented.
- [x] Assumptions and constraints documented.
