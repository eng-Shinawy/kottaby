# 00 — Research Evidence Pack — Issue #230 "No Country Selector Component"

**Plan directory (exact):** `ai/plans/issue_230/no_country_selector_component/`
**Outcome file:** `ai/plans/issue_230/no_country_selector_component/outcome/00-research-evidence-pack.md`
**Source issue:** GitHub issue #230 — "No Country Selector Component"
**Date authored:** 2026-09-30
**Author:** research sub-agent (pre-execution evidence pass)
**Sibling artifacts:** `specs.md`, `plan.md`, `tasks.md`, `deferred-items.md`

---

## 0. Purpose & how to use this file

This is the **pre-execution knowledge file** referenced by **REQ-11 / protocol item 1**
(`tasks.md:26`, `tasks.md:643-645`). Every implementing agent MUST read it (plus every other
file under `outcome/`) before touching source.

- **Every claim below cites a real `path:line` that was opened and read.** Where the plan's own
  citation is wrong, §5 records the correction.
- **§2 = verified ground truth** (what the code *actually* is). Use it instead of re-deriving.
- **§3 = gotchas / pitfalls** that will silently break the build or the contract.
- **§4 = exact commands** to re-verify each fact yourself before you rely on it.
- **§5 = plan-citation corrections** found during verification.
- **§6 = open assumptions** that could not be verified from the working tree (with the command
  to close each).

Environment note: **`node_modules/` is not present in this checkout** (verified: `ls node_modules`
→ absent; `find . -maxdepth 3 -type d -name node_modules` → empty). Declared dependencies are
resolved in `bun.lock`, and Bun's global install cache at `~/.bun/install/cache/` is populated, so
package-level facts below are cited from that cache (or from `package.json` / `bun.lock`). Run
`bun install` before executing any plan task.

---

## 1. Issue text (verbatim)

Verbatim from the issue body as reproduced in `tasks.md:18-20`:

> Request new country input component with flag (start adornment) and with validation on both
> frontend and backend, and a new custom graphql scalar, with shared zod schema.

`deferred-items.md:5` carries the same text with the issue link. The plan correctly reads this as
five deliverables: a reusable component, a flag start adornment, frontend+backend validation, a
`CountryCode` GraphQL scalar, and a shared zod schema.

---

## 2. Verified ground truth

### 2.1 GraphQL scalar infrastructure (REQ-3)

**Scalar registry — `backend/graphql/pothos/shared/scalar.pothos.ts`**
- The file is exactly 30 lines. Its docblock states the discipline verbatim: each scalar is
  registered **ONCE** with `addScalarType`; re-registering the same name is a runtime error
  ("has already been declared"); the runtime registration and the builder `Scalars` typing MUST
  stay in sync (`scalar.pothos.ts:1-22`).
- Import of the existing scalar: `import { DateTimeResolver } from "graphql-scalars";`
  (`scalar.pothos.ts:24`).
- The single existing registration:
  `gqlSchemaBuilder.addScalarType("DateTime", DateTimeResolver, {});` (`scalar.pothos.ts:30`).
- Registered-scalars list in the header currently names only `DateTime` (`scalar.pothos.ts:14-18`).
- **Adding `CountryCode`:** add `CountryCodeResolver` to the line-24 import and a second
  `addScalarType("CountryCode", CountryCodeResolver, {})` call after line 30, plus a header-list
  entry. This is the ONLY place scalars are registered.

**Builder `Scalars` slot — `backend/graphql/pothos/builder.ts`**
- `export const gqlSchemaBuilder = new SchemaBuilder<{ ... }>` begins at `builder.ts:75`.
- The `Scalars: { ... }` slot is at `builder.ts:78-84`; it currently declares exactly one member:
  `DateTime: { Input: Date; Output: Date | string };` at `builder.ts:83`.
- The slot's JSDoc says custom scalars are "registered in `shared/scalar.pothos.ts` (via
  `addScalarType`)" (`builder.ts:79-82`).
- **Adding `CountryCode`:** insert `CountryCode: { Input: string; Output: string };` inside the
  `Scalars` block. (Plan's `builder.ts:75-84` / `:78-84` references are both within the right
  region; the precise block is `78-84`.)

**Definition wiring — `backend/graphql/gqlSchema.definitions.ts`**
- 18 lines; side-effect import order is documented in the header: "object barrel → scalar registry
  → enum registry → mutation barrel → query barrel" (`gqlSchema.definitions.ts:10-13`).
- The scalar registry is imported at `gqlSchema.definitions.ts:15`:
  `import "@/backend/graphql/pothos/shared/scalar.pothos";`. No change is needed here — the new
  scalar rides the existing side-effect import.
- `backend/graphql/gqlSchema.ts` imports the definitions barrel at `gqlSchema.ts:22`.

**Codegen scalar map — `codegen.ts`**
- `strictScalars: true` is set at `codegen.ts:18`; `defaultScalarType: "unknown"` at `codegen.ts:19`.
- The `scalars: { ... }` map is at `codegen.ts:20-29` and currently maps: `Date: "string"`,
  `DateTime: "string"`, `Email: "string"`, `JSON: "unknown"`, `LocalizedString: <inline record>`,
  `PhoneNumber: "string"`, `StringMap: "Record<string, string>"`, and
  `IanaTimezone: "@/shared/constants/iana-timezone.enum#IanaTimezone"` (`codegen.ts:21-28`).
- **Precedent worth copying:** `IanaTimezone` maps a scalar to a *generated* shared constant's
  type (`codegen.ts:28`) — the `CountryCode` scalar may instead map to `"string"` (plan D2), but
  the generated-constant precedent exists.
- `codegen.ts:34` sets `schema: "./frontend/graphql/generated/schema.graphql"`, and
  `codegen.ts:39` writes `./frontend/graphql/generated/gql/graphql.ts`. The `documents` globs are
  `frontend/graphql/sharedDocuments/**/*.ts` and `frontend/views/**/*.documents.ts`
  (`codegen.ts:35`).
- **Adding `CountryCode`:** add `CountryCode: "string",` to the map. `strictScalars: true` makes a
  missing entry a hard codegen failure (`deferred-items.md:112`, P5).

**npm scripts — `package.json`**
- `"generate:gqlSchema": "bun run scripts/generator/generate-gql-schema.ts"` (`package.json:69`).
- `"codegen": "graphql-codegen --config codegen.ts"` (`package.json:70`).
- The generator writes `resolve(process.cwd(), "frontend/graphql/generated/schema.graphql")` via
  `printSchema(lexicographicSortSchema(...))` (`scripts/generator/generate-gql-schema.ts:8,26,30-33`).
- No `generate:countries` script exists yet — REQ-1 adds it.

**`graphql-scalars@2.0.0` exports `CountryCodeResolver` — VERIFIED**
- Declared `"graphql-scalars": "^2.0.0"` (`package.json:104`) and pinned `graphql-scalars@2.0.0`
  (`bun.lock:1709`).
- Cache package version is `2.0.0`
  (`~/.bun/install/cache/graphql-scalars@2.0.0@@@1/package.json`).
- Export confirmed in the package typings:
  `GraphQLCountryCode as CountryCodeResolver`
  (`~/.bun/install/cache/graphql-scalars@2.0.0@@@1/typings/index.d.ts:6`). `CountryNameResolver`
  (not needed here) is also exported on the same line.
- Typed as `GraphQLScalarType<string, string>` with `codegenScalarType: 'string'`
  (`~/.bun/install/cache/graphql-scalars@2.0.0@@@1/typings/scalars/CountryCode.d.ts:2`;
  `.../esm/scalars/CountryCode.js` `extensions`).

**Schema-surface pin — `backend/graphql/test/schema-surface.test.ts`**
- 2989 lines; pure unit tier (no server/DB) run via
  `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` (`:150-151`).
- It freezes the named-type surface: `DateTime` is pinned as an addition (not a spec scalar) at
  `schema-surface.test.ts:1285` inside the `additions` equality block (`:1283-1325`); the
  whole-schema delta test is at `:1276-1326`.
- **Relevance:** adding `CountryCode` to the schema will make the frozen `additions` array fail
  unless `"CountryCode"` is added there (it is a new non-spec scalar name, exactly like `DateTime`).
  REQ-3 AC5/REQ-9 AC4 require pinning `scalar CountryCode`; the implementing task must update this
  exact array. Note the same test also enforces byte-identical committed SDL (`:83-92`, codegen
  sync), so `bun run generate:gqlSchema` must be re-run after the scalar lands.

---

### 2.2 Current free-text country implementation (REQ-4, REQ-8)

**DB column — `backend/db/schema/users/users.ts`**
- `import { boolean, date, integer, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";`
  (`users.ts:1`) — `varchar` is already imported, so adding `countryCode: varchar("country_code", { length: 2 })`
  needs no new import.
- `country: varchar("country", { length: 100 }),` is at `users.ts:22` (nullable — no `.notNull()`).
- `users.ts` is 45 lines; there is **no** `country_code` today. The `users_email_unique`
  constraint is declared at `users.ts:44`.
- `$inferSelect` therefore currently produces `country: string | null`; adding the nullable
  `countryCode` column extends the select type automatically.

**Registration validation + insert — `backend/services/auth/registration.service.ts`**
- `validateInput(input, locale)` begins at `registration.service.ts:199`.
- Free-text country check (**to be replaced**):
  `if (!input.country || input.country.trim().length === 0) { entries.push({ field: "country", code: "COUNTRY_REQUIRED", message: t.countryRequired }); }`
  (`registration.service.ts:221-223`).
- Error projection: entries collect into `ApiFieldErrorType[]` and throw
  `new ValidationError(entries[0].message, entries)` at `registration.service.ts:244-246`.
- The `role` tamper branch throws with a custom top-level code at `:233` (pattern to be aware of
  when adding country codes, but not required to change).
- `createUserRow(input, passwordHash, tx)` runs `registration.service.ts:250-280`; the explicit
  `UserInsertType` map (no spread — BOPLA) has `country: input.country,` at `:268`, and calls
  `UserRepository.create(insert, tx)` at `:279`.
- Translations are read via `getServerTranslations(locale)` and bound as
  `translations.authTranslations` / `translations.errorsTranslations` (`:200-202`).

**Admin validation + insert — `backend/services/admin/user-management.helpers.ts`**
- `MAX_COUNTRY_LENGTH = 100;` at `user-management.helpers.ts:31` (mirrors the column length).
- `validateCreateInput(input, locale)` at `:147`; the country branch is
  `:173-177` — `if (!input.country || ... ) { entries.push({ field: "country", code: "COUNTRY_REQUIRED", message: tAuth.countryRequired }); } else if (input.country.trim().length > MAX_COUNTRY_LENGTH) { ... code: "COUNTRY_TOO_LONG" ... }`.
  The `COUNTRY_REQUIRED` literal is at `:174`, `COUNTRY_TOO_LONG` at `:176`.
- `validateUpdatePatch(patch, locale)` at `:207`; the country branch is `:220-225` —
  `COUNTRY_INVALID` is pushed at `:223` for a present `patch.country` string that is empty or over
  length. `validateUpdatePatch` handles `phone`/`country`/`dateOfBirth` as free-text display fields.
- `buildCreateUserInsert(input, passwordHash)` at `:246` maps `country: input.country,` at `:255`.
- `buildUpdatePatch` maps `patch.country = input.country` at `:282`.
- `normalizeFilters` passes the raw `filters.country` through as an exact-match filter at
  `:362,371` (see §2.2 note below and §5 correction #6).

**Pothos inputs**
- Shared input whitelist: `userRegistrationInputFields(t)` at
  `backend/graphql/pothos/shared/userFieldHelpers.ts:97-107`; `country: t.string({ required: true }),`
  is at `userFieldHelpers.ts:104`. This helper is spread by BOTH `RegisterUserInput`
  (`register-input.pothos.ts:20-26`, spread at `:22`) and `AdminCreateUserInput`
  (`admin-user.pothos.ts:313-315`, spread at `:314`) — so retyping line 104 covers both create
  paths in one edit.
- `backend/graphql/pothos/admin/admin-user.pothos.ts`:
  - `AdminUserFiltersInput` at `:298-305` — its `country: t.string({ required: false }),` is at
    `:302`.
  - `AdminCreateUserInput` at `:313-315`.
  - `AdminUpdateUserInput` at `:323-331` — its `country: t.string({ required: false }),` is at `:327`.
- **Caution:** line `302` is the directory **filter** (free-text exact match against legacy
  display values), while line `327` is the **update patch** field. The plan cites both as inputs to
  retype to `CountryCode` (§5 correction #6). See §3 for why retyping the filter is unsafe.

**Mutations (pass-through)**
- `backend/graphql/mutation/auth.mutation.ts`: public `registerUser` at `:50-77`; passes
  `country: input.country,` at `:67`; has no permission gate (public/BFLA handled in the input enum
  and service — `:56-57`).
- `backend/graphql/mutation/admin/admin-users.mutation.ts`: `adminCreateUser` passes
  `country: input.country,` at `:83` under `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
  (`:65-69`); `adminUpdateUser` passes `country: input.country ?? undefined,` at `:115` under the
  same scope (`:101-106`). The `adminSetUserBlocked`/`Suspended` strings in the surface test
  (`schema-surface.test.ts:301`) confirm the admin-user mutation trio + governance pair.

**Service boundary types — `backend/types/users/registration.types.ts`**
- `RegistrationSubmitInput.country: string;` is at `registration.types.ts:48`.
- `AdminRegistrationSubmitInput.country: string;` is at `:75`.
- `RegisterPublicRole = "student" | "teacher" | "parent"` at `:31` (BFLA).
- Types live in `backend/types/` (per type-definition rule); no service-local `.types.ts`.

**Read paths — `backend/db/repo/users/user.repository.ts`**
- `findByEmail` raw-SQL SELECT is at `user.repository.ts:50-61` (the plan's `:51-58` covers the
  column list, which names `country` at `:52`); transactional Drizzle path at `:44-48`.
- `findById` raw-SQL SELECT is at `:82-93` (plan's `:83-90` covers the column list; `country` at
  `:84`).
- `create(insert, tx)` at `:106-...` does `tx.insert(users).values(insert).returning()`
  (`:107`) — it picks up any new column via `UserInsertType`, so **no repository signature change
  is needed** for the insert.
- **Read-path trap:** the two raw-SQL blocks name columns explicitly (no `SELECT *`). Because the
  non-transactional path is only taken when `tx` is absent (`:44`, `:76`), a `country_code`
  column that is not added to those SELECTs will silently be dropped from non-tx reads while the
  Drizzle tx path returns it. Any test asserting read-back must cover BOTH paths.

---

### 2.3 Frontend form surfaces (REQ-5, REQ-6)

**Register identity fields — `frontend/views/auth/register/RegisterIdentityFields.tsx`**
- 104 lines, `"use client"` (`:1`). Component signature/props at `:14-26`.
- Four `TextField`s: fullName (`:29-48`), email (`:49-68`), phone (`:69-85`), country (`:86-101`).
- The country `TextField` (**to be replaced by `CountrySelector`**) is exactly `:86-101`:
  `{...register("country", { required: t.countryRequired })}` at `:87`, `label={t.country}` at
  `:88`, and an error/helperText/`aria-invalid` trio at `:92-94`.
- Start-adornment pattern (bare icon, no `InputAdornment`): `startAdornment: <PersonIcon ... sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />` at `:41`; the country flag
  would mirror this shape at `:97`.
- Polite live region: `formHelperText: { "aria-live": "polite" }` is used per field — e.g. `:46`,
  `:66`, `:83`, `:99`. The country field's instance is `:99` (specs §7.4 cites `:82`, which is the
  phone field's closing brace line — see §5 correction #4).
- Imports come from the barrel `@/frontend/views/auth/register` (`:11`), which re-exports
  `registerFormUtils` (`frontend/views/auth/register/index.ts:9`).

**Form state — `frontend/views/auth/register/useRegisterFormState.ts`**
- 101 lines, `"use client"` (`:1`). `useForm<RegisterFormValues>` at `:29-40`.
- `defaultValues` block `:30-39` already includes `country: "",` at **`:35`** (tasks.md 5.2 cites
  `:29` for this — see §5 correction #5).
- Existing `useController` select controllers: `genderField` at `:49-53`, `roleField` at `:54-59`,
  `preferredRecitationField` at `:60-64`. Plan's `:49,54,60` reference is correct.
- **No country controller exists** today (country is a plain `register(...)` text field).
- The `*FromSelectValue` pinning pattern (used by `gender`/`role`) is what `countryFromValue`
  should mirror: `genderFromSelectValue`/`roleFromSelectValue` (`registerFormUtils.ts:48-61`),
  pinned into `selectedGender`/`selectedRole` (`useRegisterFormState.ts:68-71`).

**Form utils — `frontend/views/auth/register/registerFormUtils.ts`**
- `REGISTER_FIELD_PATHS` (the server-error projection whitelist) is at `registerFormUtils.ts:20-29`
  and already contains `"country"` at `:25`. `isRegisterFieldPath` guard at `:34-36`.
- `RegisterFormValues` interface at `:63-72`; `country: string;` at `:68`.
- Therefore **no `REGISTER_FIELD_PATHS` change is needed** because the field name stays `country`.
- There is **no `countryFromValue`** today; it must be added (plan REQ-6 AC3).
- The select-value tables (`GENDER_BY_SELECT_VALUE` `:41-45`, `ROLE_BY_SELECT_VALUE` `:52-56`) are
  the pattern for a `countryFromValue` membership pin.

**Projection module — `frontend/lib/mutationFieldErrors.ts`**
- 159 lines, pure (no React/MUI/Apollo runtime) (`:36-37`). Exports
  `projectMutationFieldErrors` (`:125`) and `applyProjectedFieldErrors` (`:147`), which take a
  caller-supplied `isAcceptedField` guard (here `isRegisterFieldPath`).
- It maps wire `extensions.fields[]` pairs to RHF `setError` calls; the module itself has **no path
  list** — the path list (`REGISTER_FIELD_PATHS`) lives in `registerFormUtils.ts` (§5 correction #9).
- Its test `frontend/lib/mutationFieldErrors.test.ts` (261 lines) has a `REUSE_SET` at `:238-249`
  that pins fallback auth keys, including `"countryRequired"` at `:245` and `"passwordRequired"` at
  `:242` (plan cites `:242,245`; the block is `238-249`) — new codes
  `countryCodeRequired`/`countryCodeInvalid` should be added here.

**MUI v9 Autocomplete merge-`slotProps` pattern (REQ-5 AC5)**
- Canonical example: `frontend/views/admin/students/onboarding/OnboardStudentParentSection.tsx:86-101`,
  specifically the merge at `:93-99`:
  `slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps?.htmlInput, "aria-label": ... } }}`.
  The inline comment at `:94-96` explains a bare `slotProps` would drop MUI's `endAdornment`
  (popup chevron + clear affordance).
- Second example: `frontend/views/admin/finances/WalletPickerHeader.tsx` — the **merge is at
  `:61-75`** (renderInput opens `:61`, merge at `:70-73`); the plan's `:43-57` points at
  `renderOption`/`onChange` instead (§5 correction #2).
- **MUI v9 change:** the old `inputProps` / `InputProps` props are removed; adornments now live in
  `slotProps.input.startAdornment` / `slotProps.input.endAdornment`. Existing code uses
  `slotProps={{ input: { startAdornment: ... } }}` (`RegisterIdentityFields.tsx:39-42`).
- End-adornment with a real `InputAdornment` component:
  `frontend/components/AuthFormShared.tsx:129` `<InputAdornment position="end">` (the plan cites
  `AuthFormShared.tsx:127`, which is the `startAdornment: <LockOutlined .../>` line — §5
  correction #3).

**No generic form-field component**
- `frontend/components/ui/` (verified listing) contains no reusable text/select field component —
  files are `AdminDesktopTable`, `Catalog*`, `ErrorRetryAlert`, `fieldError.{ts,test.ts}`,
  `focusRing`, `graphqlErrorSurface/`, `GraphQLErrorSurfaceHost`, `IconCircleEmptyState`,
  `LinkRequestTimestampLines`, `NoticeSnackbar`, `Notification*`, `PermissionDeniedFallback`,
  `RetryableNotice`, `sessionList/`. So `CountrySelector.tsx` is a net-new UI primitive.

**RHF present, no resolver**
- `"react-hook-form": "^7.88.0"` at `package.json:112`. **`@hookform/resolvers` is NOT declared**
  anywhere in `package.json` (grep returned nothing). Register-form validation is inline RHF
  `register(...)` rules / `validate` callbacks (`RegisterIdentityFields.tsx:50-53`), consistent
  with plan D10 ("no new dependency").

**Storybook**
- `frontend/stories/ui/` exists (contains `NotificationDrawer.stories.tsx`, `TextField.stories.tsx`),
  so `frontend/stories/ui/CountrySelector.stories.tsx` matches the location convention.

---

### 2.4 Generated-data precedent (REQ-1)

**Generator layout — `scripts/iana-timezone-generator/`**
- Files (verified): `cli.ts`, `cldr-data.ts`, `file-builders.ts`, `index.ts`, `labels.ts`,
  `paths.ts`, `territories.ts`. The barrel re-exports all six modules
  (`scripts/iana-timezone-generator/index.ts:1-5`).
- `cli.ts` is a runnable entry (`#!/usr/bin/env bun`, run as `bun run generate:iana-timezones`),
  reads CLDR, filters ids, writes four files (`cli.ts:1-5,28-63`). Note it omits `labels`/`territories`
  from the file list in the plan's generator inventory — a new `scripts/country-data-generator/`
  may add its own shape, mirroring `{cli,cldr-data,file-builders,paths,index}`.
- `paths.ts` pins the CLDR input paths and shared output paths, e.g.
  `CLDR_AR_TERRITORIES_PATH = join(ROOT, "node_modules/cldr-localenames-full/main/ar/territories.json")`
  (`paths.ts:10`) and outputs under `shared/constants/iana-*` (`paths.ts:4-7`). **Only an AR
  territories path exists** — a country generator adding English names must add a
  `main/en/territories.json` path constant (verified present in the CLDR package, see below).
- `cli.ts:38-43` guards missing CLDR data and prints the exact remediation:
  `bun add -d cldr-core cldr-dates-full cldr-localenames-full`.
- AUTO-GENERATED header format (all builders): `// AUTO-GENERATED by scripts/generate-iana-timezone-enum.ts — do not edit manually`
  followed by `// Regenerate: bun run generate:iana-timezones`
  (`file-builders.ts:11-12,24-25,40-41,64-65`).
- The generated shape uses `... as const` + `export type X = (typeof X)[number]`
  (`file-builders.ts:27-32` for ids) — exactly the `COUNTRY_CODES` / `CountryCode` shape REQ-1 requires.

**Curation override precedent — `scripts/iana-timezone-generator/territories.ts`**
- `const EXCLUDED_TERRITORY_CODES = new Set(["IL"]);` at `territories.ts:4`, and the remap
  `territoryCode && EXCLUDED_TERRITORY_CODES.has(territoryCode) ? "PS" : territoryCode` at
  `territories.ts:44`. There is also an explicit `TERRITORY_OVERRIDES` table (`:6-29`). REQ-1 AC5
  cites this precedent (plan.md §Decision C cites `EXCLUDED_TERRITORY_CODES = new Set(["IL"])`,
  `IL → "PS"`).

**CLDR devDependencies — installed and shipped**
- `"cldr-core": "^48.2.0"` (`package.json:147`), `"cldr-dates-full": "^48.2.0"` (`:148`),
  `"cldr-localenames-full": "^48.2.0"` (`:149`) — all under `devDependencies`.
- Cache version `48.2.0`, and BOTH locale trees exist:
  `~/.bun/install/cache/cldr-localenames-full@48.2.0@@@1/main/en/territories.json` and
  `.../main/ar/territories.json`.
- Sample values confirm usable names: en `"EG": "Egypt"`, `"IL": "Israel"`; ar `"EG": "مصر"`.
  **(Note:** the iana generator excludes `IL`; if the country dataset applies the same exclusion,
  the GraphQL scalar will still accept `"IL"` at the wire — see §3 gotcha S-1 and §5 correction #1.)

**Committed output files — `shared/constants/iana-*`**
- `shared/constants/iana-timezone.enum.ts`, `-labels.ts`, `-timezones.ts`, `-timezone-territories.ts`
  all exist (verified).
- `shared/constants/index.ts` (7 lines) re-exports only
  `evaluation-rubric.constants`, `free-trial.constants`, `handshake-code.constants`,
  `parent-link-request.constants`, `recitation-reading.enum`, `session-fees.constants`,
  `verification-plan.constants` — **no `iana-*` export**. This confirms REQ-1 AC6 / P4: the
  generated country file must be deep-imported only and MUST NOT be added to the barrel.
- The plan's `shared/constants/countries.ts` filename is free (no collision).

### 2.5 Zod usage precedent (REQ-2)

- `"zod": "^4.6.2"` at `package.json:116` (dependency, not dev).
- Only two files import zod directly today (grep over `backend/ shared/ frontend/`):
  `backend/types/classes/admin-session-governance.types.ts:1` (`import { z } from "zod";`) and its
  test `backend/types/classes/admin-session-governance.types.test.ts:14` (`import type { z } from "zod";`).
- Schema definitions live beside their interfaces and are exported:
  `AdminSessionListFilterInputSchema` (`admin-session-governance.types.ts:172-188`),
  `AdminSessionRescheduleInputSchema` (`:195-201`), `AdminSessionCancelInputSchema` (`:210-217`),
  `AdminSessionReassignInputSchema` (`:224-227`), `AdminSessionJoinInputSchema` (`:233-235`).
- `.safeParse` consumption is in the service layer:
  `backend/services/classes/session-admin-governance.ts:153,247,339,407,454` — the check-then-throw
  pattern the plan's `countryCodeSchema.safeParse(...)` mirrors.
- **This is the first zod usage in `shared/`.** `shared/` may import the `zod` npm package; only
  `@/frontend|@/backend|@/app` aliases are prohibited (`shared/AGENTS.md:8-11`).

### 2.6 i18n compile-time namespace registration (REQ-7)

- Canonical recipe: `shared/AGENTS.md:201-216` — exactly the 6 steps the plan cites:
  1. `*Labels` interface in `shared/locale/types/<ns>/index.ts`.
  2. en/ar leaf impls in `shared/locale/en/<ns>/index.ts` + `shared/locale/ar/<ns>/index.ts`,
     each const typed against the interface.
  3. Handle in `shared/locale/namespaces/<ns>/<ns>.namespace.ts`:
     `export const <Ns> = defineNamespace<<Labels>>("<ns>.<ns>", translations => translations.<ns>Translations);`
     plus registry + `namespaces/index.ts` re-export.
  4. Add `<ns>Translations: <Ns>Labels` to `Translations` in `shared/locale/types/message.ts`.
  5. Bundle slices in `shared/locale/en/messages.ts` + `shared/locale/ar/messages.ts`.
  6. Colocated parity test `shared/locale/<ns>-namespace.parity.test.ts` + `bun tsgo`.
- Verified mechanics:
  - `defineNamespace<TLabels>(id: string, getLabels): NamespaceHandle<TLabels>`
    (`shared/locale/namespaces/define-namespace.ts:8-13`).
  - Live example: `export const Wallet = defineNamespace<WalletLabels>("wallet.wallet", translations => translations.walletTranslations);`
    (`shared/locale/namespaces/wallet/wallet.namespace.ts:4`). Handle dirs use `index.ts` +
    `<ns>.namespace.ts` (e.g. `namespaces/wallet/`).
  - `registry.ts` imports each handle and composes the `namespaces` const
    (`shared/locale/namespaces/registry.ts:7-67`); `namespaces/index.ts` is a pure relative
    re-export barrel (`:1-31`).
  - `Translations` interface with all `<ns>Translations` members is
    `shared/locale/types/message.ts:31-61`.
  - `enMessages` bundles every slice (`shared/locale/en/messages.ts:32-62`); `ar/messages.ts`
    mirrors it (both 3111 bytes).
  - 30 existing parity tests live flat under `shared/locale/` (e.g. `wallet-namespace.parity.test.ts`),
    matching the plan's `shared/locale/countrySelector-namespace.parity.test.ts` name/shape.
- Accessors (single-arg / handle — never a two-arg `getTranslations`, never a string literal):
  `getTranslations(locale: string): Translations` (`shared/locale/server.ts:15`);
  `getServerTranslations(locale: string)` (`shared/locale/server-graphql.ts:3`);
  `useAppTranslation<TLabels>(handle: NamespaceHandle<TLabels>): TLabels`
  (`shared/locale/client/use-app-translation.ts:9`).
- **`AuthLabels` extension targets (REQ-7 AC3):** `countryRequired: string;` is at
  `shared/locale/types/auth/index.ts:39`; leaf values at `shared/locale/en/auth/index.ts:28`
  (`countryRequired: "Country is required."`) and `shared/locale/ar/auth/index.ts:28`
  (`countryRequired: "الدولة مطلوبة."`). Add `countryCodeRequired`/`countryCodeInvalid` next to these.

---

## 3. Gotchas / pitfalls (read before editing)

**S-1 — The `graphql-scalars` `CountryCode` scalar is stricter than the plan assumes.**
The resolver validates against a **hardcoded full ISO 3166-1 list as an anchored regex with the
`i` (case-insensitive) flag**, then returns the string unchanged:
`const COUNTRY_CODE_REGEX = /^(AD|AE|…|ZW)$/i; … if (!COUNTRY_CODE_REGEX.test(value)) throw …`
(`~/.bun/install/cache/graphql-scalars@2.0.0@@@1/esm/scalars/CountryCode.js`). Consequences:
- It **rejects** `"XX"`, `"AA"`, `"ZZ"` and any malformed value at the wire (not just at the
  service layer). Plan specs E-9 ("Scalar accepts ISO-shaped input; membership rejection happens in
  the Zod schema") and Decision B ("the scalar's job is wire-shape `^[A-Z]{2}$`") are inaccurate —
  see §5 correction #1. Defense-in-depth still holds: the service re-validates membership against
  `COUNTRY_CODES`.
- It **accepts lowercase** (`/i`), e.g. `"eg"`, and returns it unchanged — the Zod
  `normalizeCountryCode` (trim+uppercase) is still what the service must apply before the membership
  check and before persisting.
- Its list **includes `IL`, `PS`, `XK`**, so a curated-out territory (if `IL` is excluded from the
  dataset, per the iana precedent) is still wire-accepted; only the service membership check rejects
  it. E-12 ("rejection as non-member if smuggled") therefore depends entirely on the service layer.
- Duplicate-registration is a runtime error: registering `"CountryCode"` other than once in
  `scalar.pothos.ts` crashes (`scalar.pothos.ts:6-7`).

**S-2 — Runtime registration and builder typing must stay in sync.** `scalar.pothos.ts:10-12`
makes this explicit. Add the `addScalarType` call AND the `Scalars` slot member in the same change,
or Pothos types (`type: "CountryCode"`) will not compile against the builder.

**S-3 — `strictScalars: true`.** Any scalar emitted into the SDL must have an entry in the
`codegen.ts` map or `bun codegen` fails hard (`codegen.ts:18`; `deferred-items.md:112`). Add
`CountryCode: "string"` in the same commit as the scalar.

**S-4 — MUI v9 Autocomplete merge, not replace.** `inputProps`/`InputProps` are gone; use
`slotProps`. In `renderInput` you MUST spread `params.slotProps` and merge `htmlInput`, or you drop
MUI's `endAdornment` (popup chevron + clear button) — see the inline comments at
`OnboardStudentParentSection.tsx:94-96` and `WalletPickerHeader.tsx:67-69`. Correct merge:
`slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps?.htmlInput, "aria-label": … } }}`.

**S-5 — No flag assets, no flag packages, no `Intl.DisplayNames`.** Verified: no
`flag-icons`/`flagcdn`/`country-flag`/`react-world-flags`/`flagpack` in `package.json` (grep empty),
no flag files under `public/`, and zero `Intl.DisplayNames` usage in `backend/`, `shared/`,
`frontend/` (grep empty). Flags MUST be regional-indicator emoji derived from the ISO code (REQ-1
AC2), and ar/en names come from CLDR.

**S-6 — `shared/` boundary.** `shared/**/*.{ts,tsx}` may NOT import `@/frontend/**`, `@/backend/**`,
or `@/app/**` (`shared/AGENTS.md:8-11`, ESLint enforced). `shared/lib/country-code.ts` may import
`zod` and `@/shared/constants/countries` only.

**S-7 — Compile-time i18n only; `next-intl` is prohibited.** The only `next-intl` mentions in the
tree are forbidden-example/comments/docs (`shared/AGENTS.md:69,105,119`; legacy
`shared/Messages_README.md`; `frontend/IMPLEMENTATION_LEARNINGS.md`); there are **no real `next-intl`
imports** in backend/frontend/shared/app. Do not reintroduce it. Use the handle recipe (§2.6).
`shared/Messages_README.md` describes the removed `next-intl` system — do not follow it.

**S-8 — Deep import, no barrel for the country dataset.** The `iana-*` generated files are
deliberately absent from `shared/constants/index.ts` (§2.4). Add `shared/constants/countries.ts`
with deep-import-only consumption; do NOT edit the barrel.

**S-9 — Raw-SQL read path drops new columns.** `user.repository.ts` non-tx SELECTs name columns
explicitly (`:51-58`, `:83-90`). Adding `country_code` to the Drizzle schema without adding
`country_code AS "countryCode"` to both SELECTs yields a silent `undefined`/missing field on the
non-transactional read path only. Cover both paths in Tier-2 tests.

**S-10 — Drizzle push vs. migrate.** `bun db push` syncs the live local DB and records nothing;
the committed artifact is `bun drizzle-kit generate` (`backend/drizzle/<timestamp>_<name>/`) applied
by `bun db migrate` (`docs/DATABASE_MIGRATIONS.md`, esp. `:21,26,131-136`). Existing folders use
either random names (`20260919222143_fine_living_mummy`) or named custom folders
(`20260919222508_custom_8-broadcast-history-backfill`); the plan's `_add_users_country_code` name
implies passing `--name`. Never `CREATE INDEX CONCURRENTLY` (`tasks.md:136`).

**S-11 — `schema-surface.test.ts` will fail on the new scalar until updated.** The named-type
`additions` equality array (`:1283-1325`, `DateTime` pinned at `:1285`) and the SDL byte-identity
check (`:83-92`) both break when `CountryCode` is added; update the pin AND re-run
`bun run generate:gqlSchema` + `bun codegen` and commit both artifacts.

**S-12 — No `@hookform/resolvers`; RHF inline only.** The package is not installed. Validate the
country via `countryCodeSchema.safeParse` in the controller/`validate` path (mirror
`RegisterIdentityFields.tsx:50-53`).

---

## 4. Where to verify each fact (exact commands)

Run from the repo root `HOME=… /home/ahmed/Projects/kottaby_kottaby`. (These are read-only greps;
`node_modules` is absent, so package facts are read from `bun.lock` + `~/.bun/install/cache/`.)

**Scalar infrastructure**
```bash
sed -n '1,30p' backend/graphql/pothos/shared/scalar.pothos.ts
sed -n '75,84p' backend/graphql/pothos/builder.ts
sed -n '18,30p' codegen.ts
sed -n '14,18p' backend/graphql/gqlSchema.definitions.ts
grep -n "generate:gqlSchema\|codegen" package.json
sed -n '1276,1326p' backend/graphql/test/schema-surface.test.ts
```

**`graphql-scalars@2.0.0` export + scalar semantics**
```bash
grep -n "graphql-scalars" package.json bun.lock
grep -o "GraphQLCountryCode as CountryCodeResolver" \
  ~/.bun/install/cache/graphql-scalars@2.0.0@@@1/typings/index.d.ts
cat ~/.bun/install/cache/graphql-scalars@2.0.0@@@1/esm/scalars/CountryCode.js
```

**Current country implementation**
```bash
sed -n '20,24p' backend/db/schema/users/users.ts
sed -n '199,247p' backend/services/auth/registration.service.ts
sed -n '249,280p' backend/services/auth/registration.service.ts
sed -n '147,180p;207,225p;246,266p' backend/services/admin/user-management.helpers.ts
sed -n '97,107p' backend/graphql/pothos/shared/userFieldHelpers.ts
sed -n '296,331p' backend/graphql/pothos/admin/admin-user.pothos.ts
sed -n '18,27p' backend/graphql/pothos/auth/register-input.pothos.ts
sed -n '42,79p' backend/types/users/registration.types.ts
sed -n '43,95p' backend/db/repo/users/user.repository.ts
```

**Frontend form surfaces**
```bash
sed -n '86,101p' frontend/views/auth/register/RegisterIdentityFields.tsx
sed -n '29,64p' frontend/views/auth/register/useRegisterFormState.ts
sed -n '20,72p' frontend/views/auth/register/registerFormUtils.ts
sed -n '86,101p' frontend/views/admin/students/onboarding/OnboardStudentParentSection.tsx
sed -n '61,75p' frontend/views/admin/finances/WalletPickerHeader.tsx
sed -n '124,149p' frontend/components/AuthFormShared.tsx
sed -n '238,249p' frontend/lib/mutationFieldErrors.test.ts
grep -n "react-hook-form\|@hookform/resolvers" package.json
ls frontend/components/ui/ frontend/stories/ui/
```

**Generated-data precedent + CLDR**
```bash
ls scripts/iana-timezone-generator/
sed -n '1,47p' scripts/iana-timezone-generator/territories.ts
sed -n '1,11p' scripts/iana-timezone-generator/paths.ts
sed -n '11,32p' scripts/iana-timezone-generator/file-builders.ts
grep -n "cldr-core\|cldr-dates-full\|cldr-localenames-full" package.json
ls ~/.bun/install/cache/cldr-localenames-full@48.2.0@@@1/main/en/territories.json \
   ~/.bun/install/cache/cldr-localenames-full@48.2.0@@@1/main/ar/territories.json
cat shared/constants/index.ts
```

**Zod + i18n**
```bash
sed -n '1,2p' backend/types/classes/admin-session-governance.types.ts
grep -n "safeParse" backend/services/classes/session-admin-governance.ts
sed -n '201,216p' shared/AGENTS.md
sed -n '31,61p' shared/locale/types/message.ts
sed -n '28p' shared/locale/en/auth/index.ts; sed -n '28p' shared/locale/ar/auth/index.ts
grep -n "countryRequired" shared/locale/types/auth/index.ts
```

**Absence checks (gotchas)**
```bash
grep -rn "Intl.DisplayNames" backend shared frontend                # expect: no output
grep -rln "flag-icons\|flagcdn\|country-flag\|react-world-flags" package.json frontend backend shared  # expect: none
grep -rn "next-intl" backend shared frontend app | grep -v "//\|Readme\|README\|LEARNINGS"  # expect: none
ls public/ | grep -i flag                                           # expect: none
```

**One-time environment note:** run `bun install` before executing any task; afterwards the same
facts can be grepped directly under `node_modules/`.

---

## 5. Plan-citation corrections (references that do not match the tree)

Each item was spot-verified against the file. The "correct" column is what the evidence found.

| # | Plan claim (file:line) | Verified reality | Correct reference |
|---|---|---|---|
| 1 | `plan.md` §Decision B: scalar is "wire-shape integrity (`^[A-Z]{2}$`)"; `specs.md` E-9: "Scalar accepts ISO-shaped input; membership rejection happens in the Zod schema"; REQ-3 AC6 | `graphql-scalars@2.0.0` `CountryCode` validates against a **full hardcoded ISO list regex with `/i`** and rejects `XX`/`AA`/`ZZ`; accepts lowercase; includes `IL`/`PS`/`XK` | Evidence: `~/.bun/install/cache/graphql-scalars@2.0.0@@@1/esm/scalars/CountryCode.js`. Reword E-9 / Decision B: scalar enforces ISO-list membership (case-insensitively); service still enforces `COUNTRY_CODES` membership + normalization. |
| 2 | `plan.md` §3.2/§5.6, `tasks.md` 5.1: `WalletPickerHeader.tsx:43-57` demonstrates merging `params.slotProps.htmlInput` | `:43-57` is the Autocomplete `renderOption`/`onChange`; the merge is at `:70-73` inside `renderInput` (`:61-75`) | `frontend/views/admin/finances/WalletPickerHeader.tsx:61-75` |
| 3 | `specs.md` §6.1 / `plan.md` / `tasks.md` 5.1: `AuthFormShared.tsx:127` for `<InputAdornment position="end">` | `:127` is `startAdornment: <LockOutlined …/>`; the `InputAdornment position="end"` is at `:129`. File path is `frontend/components/AuthFormShared.tsx` (not under `views/auth/`) | `frontend/components/AuthFormShared.tsx:129` |
| 4 | `specs.md` §7.4: polite live region "matching `RegisterIdentityFields.tsx:82`" | Country field's `formHelperText: { "aria-live": "polite" }` is at `:99` (phone field ends `:82`/uses `:83`) | `frontend/views/auth/register/RegisterIdentityFields.tsx:99` (country field) |
| 5 | `tasks.md` 5.2: `useForm<RegisterFormValues> … country: ""` at `useRegisterFormState.ts:29` | `useForm` opens at `:29`; the `country: ""` default value is at `:35` | `frontend/views/auth/register/useRegisterFormState.ts:35` |
| 6 | `specs.md` REQ-8 AC5 / `tasks.md` 3.2: retype `backend/graphql/pothos/admin/admin-user.pothos.ts:302,327` to `CountryCode` | `:302` is `AdminUserFiltersInput.country` (the directory **filter**, exact-matches legacy display text); `:327` is `AdminUpdateUserInput.country` (an update field). `AdminCreateUserInput.country` is inside `userRegistrationInputFields` (`userFieldHelpers.ts:104`), not `:302` | Retype `:327` (update) per plan; **do NOT** retype `:302` unless the admin filter is intentionally moved to ISO (plan defers that as D-3/D-4). Update REQ-8 AC5 wording to say `:327` only. |
| 7 | `specs.md` REQ-3 AC2: builder `Scalars` "currently only `DateTime`, `builder.ts:75-84`" | `new SchemaBuilder<…>` opens at `:75`; the `Scalars` slot is `:78-84` with `DateTime` at `:83` | `backend/graphql/pothos/builder.ts:78-84` (member `DateTime` at `:83`) — matches `plan.md`'s `:78-84`, so prefer that one. |
| 8 | `plan.md` §3.2: "`REGISTER_FIELD_PATHS` projection (`frontend/lib/mutationFieldErrors.ts`)" | `REGISTER_FIELD_PATHS` is defined in `registerFormUtils.ts:20-29`; `mutationFieldErrors.ts` has no path list (it takes a caller guard) | `frontend/views/auth/register/registerFormUtils.ts:20-29`; `frontend/lib/mutationFieldErrors.ts` is the projection module but not the path-list owner |
| 9 | `specs.md` REQ-9 AC5 / `tasks.md` 5.2: `frontend/lib/mutationFieldErrors.test.ts` "(`:242,245` currently lists known paths)" | The known-key block is `REUSE_SET` at `:238-249`; `:242` is `passwordRequired`, `:245` is `countryRequired` | `frontend/lib/mutationFieldErrors.test.ts:238-249` (add new codes here) |

**All other citations spot-verified and correct**, including: `users.ts:22`;
`registration.service.ts:221-223,244-246,249-280,268`; `user-management.helpers.ts:174,223`
(create `:173-177`, update `:220-225`); `userFieldHelpers.ts:104`; `register-input.pothos.ts`
(spreads helper); `admin-users.mutation.ts:83,115`; `auth.mutation.ts:67`;
`registration.types.ts:48,75`; `RegisterIdentityFields.tsx:86-101,41`;
`useRegisterFormState.ts:49,54,60`; `registerFormUtils.ts:63-72`;
`OnboardStudentParentSection.tsx:86-101`; `scalar.pothos.ts:24,30`; `codegen.ts:18,20-29`;
`gqlSchema.definitions.ts:15`; `package.json:69,70,104,116,147-149`;
`shared/AGENTS.md:201-216`; `shared/locale/types/auth/index.ts:39`;
`shared/locale/{en,ar}/auth/index.ts:28`; `user.repository.ts:51-58,83-90`;
`territories.ts` exclusion precedent; `mutationFieldErrors.test.ts` reuse set.

---

## 6. Open assumptions / unverifiable-from-tree items

These could NOT be confirmed from the working tree (no `node_modules`; outbound network blocked).
Close each with the listed command before relying on it.

| # | Assumption in the plan | Status | How to close |
|---|---|---|---|
| A-1 | `graphql-scalars@2.0.0` exports `CountryCodeResolver` | **VERIFIED** from Bun cache (see §2.1 / §5 #1) — no action needed | done |
| A-2 | `cldr-localenames-full@48.2.0` ships `main/{en,ar}/territories.json` | **VERIFIED** from Bun cache (§2.4) | done |
| A-3 | The generated `shared/constants/countries.ts` will not collide and the barrel must stay iana-like | **VERIFIED** (`shared/constants/index.ts` has no country/iana exports; filename free) | done |
| A-4 | `bun run generate:countries` script name is free | Assumed free — no such script in `package.json` (grep of scripts) | `grep -n "generate:countries" package.json` after adding |
| A-5 | The Drizzle migration folder name `backend/drizzle/<timestamp>_add_users_country_code/` | Not verifiable until generated; existing convention allows both random and `--name`d folders (§3 S-10) | `bun drizzle-kit generate --name add_users_country_code` and inspect |
| A-6 | `Intl.DisplayNames`-free environment / emoji flags render | Absence verified in repo; platform rendering is out of scope | n/a |
| A-7 | `@hookform/resolvers` absence | **VERIFIED** (grep of `package.json` empty) | done |

**Residual risk statement.** The two material discrepancies an implementer must reconcile before
coding are §5 corrections **#1** (scalar is a full ISO-list membership check, case-insensitive —
not a `^[A-Z]{2}$` shape check) and **#6** (`admin-user.pothos.ts:302` is a legacy free-text filter,
not a create/update input; retyping it contradicts the deferred D-3/D-4 scope). Everything else is
mechanical line-number correction.

---

## 7. Consistency note

- REQ-1..REQ-11 each map to at least one verified artifact above; no requirement cites a
  non-existent file.
- The plan's "no new npm dependency" (D10) holds: `zod` (`package.json:116`), `graphql-scalars`
  (`:104`), all three CLDR packages (`:147-149`), and `react-hook-form` (`:112`) are already
  installed.
- The plan's "no flag package/asset, emoji flags, no `Intl.DisplayNames`" holds (§3 S-5).
- The plan's "compile-time i18n only, no `next-intl`" holds (§3 S-7).

*End of research evidence pack.*
