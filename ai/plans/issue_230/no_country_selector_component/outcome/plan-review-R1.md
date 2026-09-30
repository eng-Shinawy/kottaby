# Plan Review Report — Issue #230 "No Country Selector Component"

**Plan directory (exact):** `ai/plans/issue_230/no_country_selector_component/`
**Outcome file:** `ai/plans/issue_230/no_country_selector_component/outcome/plan-review-R1.md`
**Review round:** R1
**Date:** 2026-09-30
**Gate:** plan-review (pre-implementation, read-only on source; fixes applied only to the four plan files)
**Reviewer:** plan-review sub-agent

---

## Summary

Reviewed `specs.md`, `plan.md`, `tasks.md`, and `deferred-items.md` against the root `AGENTS.md`,
the layer AGENTS.md files (`shared/`, `shared/locale/`, `backend/graphql/`, `backend/graphql/pothos/`,
`backend/services/`, `backend/db/schema/`, `frontend/`, `frontend/views/`), and
`.agents/instructions/{frontend,backend,tests}.instructions.md`.

Every cited `path:line` reference in the four artifacts was spot-verified by reading the real file
(>40 references checked; ≥12 required). Twenty distinct defects were found and fixed in place. They
fall into three classes: (a) **permission-matrix data that does not exist** (fabricated roles),
(b) **factually wrong scalar-behavior claims** that drive design decisions, and (c) **incorrect or
mis-attributed `path:line` citations** plus **one internal contradiction** and **one i18n usage bug**.

No source file outside the plan directory was modified. The plan now passes all applicable
AGENTS.md rules. See "Residual, documented consequence" for the one accepted design tension that is
a documented scope consequence rather than a rule violation.

---

## Review rounds

| Round | Scope | Result |
|-------|-------|--------|
| R1 | Full review of `specs.md` + `plan.md` + `tasks.md` + `deferred-items.md`; citation spot-verification; rule-compliance check | 20 defects found → all fixed in place → re-scanned clean |

Re-verification after fixes: targeted grep over all four artifacts for every stale pattern returned
no matches (`CLEAN`). Fixes were applied with the `Edit` tool only.

---

## Findings and fixes (by dimension)

### Dimension 1 — Permission matrix vs. real role/seed data (root `AGENTS.md`, backend GraphQL scopes)

**F-1. Fabricated roles in the actor table.** `specs.md` §2 declared the Admin actor as
`SUPER_ADMIN` / `ACADEMY_ADMIN` "with user-management permission".
*Rule broken:* permission matrix must reflect real data. The `user_role` pgEnum / `UserRole` enum has
exactly four members — `admin | teacher | student | parent` (`backend/enum/users/user-role.enum.ts:6-11`).
`SUPER_ADMIN`, `ACADEMY_ADMIN`, and `STAFF` do not exist anywhere in the tree.
*Fix:* replaced with the real `admin` (`UserRole.Admin`) and its actual gate —
`authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
(`backend/graphql/mutation/admin/admin-users.mutation.ts:64-67`).

**F-2. Fabricated roles in the role-access matrix.** `plan.md` §5.3 listed
`SUPER_ADMIN / ACADEMY_ADMIN / STAFF / TEACHER / PARENT / STUDENT` and an "existing admin permission".
*Fix:* replaced with `admin` / `teacher` / `student` / `parent` and the real role gate.

**F-3. "Supervisor" is not a role.** `plan.md` §5.4 listed "Parent / Student / Teacher / Supervisor".
*Fix:* removed `Supervisor`; row now reads "Parent / Student / Teacher".

**F-4. "Admin permission gate" is factually a role gate.** `plan.md` §3.3, §6; `specs.md` REQ-4 AC7,
§8.2; `tasks.md` 3.2.SEC, 3.4.TE, 3.4.SEC said admin-create is behind an "admin permission gate".
The builder's `permission` scope is a hardcoded placeholder that always returns `true`
(`backend/graphql/pothos/builder.ts:139`); the actual gate is role-based `$all`
(`admin-users.mutation.ts:64-67`).
*Fix:* all such references corrected to "admin role gate (`$all` authenticated + `role: [UserRole.Admin]`)".

### Dimension 2 — `CountryCode` scalar behavior (root `AGENTS.md`; `backend/graphql/pothos/AGENTS.md`)

**F-5. The scalar is NOT shape-only — the plan's core scalar rationale was wrong.**
`plan.md` Decision B stated "the scalar's job is wire-shape integrity (`^[A-Z]{2}$`); the dataset's
job is business membership". `specs.md` E-9 claimed "Scalar accepts ISO-shaped input; membership
rejection happens in the Zod schema". Verified against the installed package:
`graphql-scalars@2.0.0` `CountryCodeResolver` validates against a **hardcoded full ISO 3166-1 list**
via an anchored **case-insensitive** regex and returns the value **unchanged** (no normalization):
`~/.bun/install/cache/graphql-scalars@2.0.0@@@1/esm/scalars/CountryCode.js`
(`COUNTRY_CODE_REGEX = /^(AD|AE|…|ZW)$/i`).
Consequences corrected:
- `"XX"` / `"AA"` / `"ZZ"` are rejected **at the wire**, not by the service `COUNTRY_CODES` check.
- Codes in the library list but curated out of our dataset (`IL`, `XK`, `PS`) pass the scalar and are
  rejected only by the service membership check.
- The resolver accepts lowercase and does not normalize, so `normalizeCountryCode` is still required.
*Fix:* rewrote `specs.md` E-5, E-9, REQ-2 AC4, REQ-3 AC6; `plan.md` Decision B rationale, §3.1 header
note, §3.3 closing note, §6 "Unsupported codes" row; `tasks.md` 4.x scalar description. The
`DateTime` precedent remains valid; the import name `CountryCodeResolver` is confirmed exported
(`~/.bun/install/cache/graphql-scalars@2.0.0@@@1/typings/index.d.ts:5`).

### Dimension 3 — Admin input-scope contradiction (plan internal consistency; `backend/graphql/pothos/AGENTS.md`)

**F-6. Retyping the admin directory filter was contradictory.** `specs.md` REQ-8 AC5, `plan.md` §3.2,
and `tasks.md` 3.2 listed `admin-user.pothos.ts:302,327` as inputs to retype to `CountryCode`.
Line 302 is `AdminUserFiltersInput.country` — the admin directory **filter**, which `plan.md` §2.4 and
`deferred-items.md` D-3/D-4 explicitly leave on legacy free text. Retyping it would break legacy-name
filtering. Line 327 is `AdminUpdateUserInput.country`, also deferred by D-4.
*Fix:* corrected citations so only the shared input helper (`userFieldHelpers.ts:104`, composed by
`register-input.pothos.ts` and `AdminCreateUserInput` at `admin-user.pothos.ts:313`) is retyped;
filter (`:302`) and update (`:327`) explicitly stay `String`.

**F-7. Update path referenced a non-existent field.** `plan.md` §4.1 said `validateUpdatePatch`
should "validate `countryCode` when present". `AdminUserUpdateDbPatch`
(`backend/types/admin/admin-user.types.ts:266-268`) is `Partial<Pick<UserSelectType, "fullName" |
"phone" | "country" | "gender" | "dateOfBirth">>` — there is no `countryCode`.
*Fix:* `validateUpdatePatch` row changed to "unchanged — free text (deferred D-4)".

**F-8. `specs.md` REQ-4 AC6 over-cited the admin update line.** AC6's trigger is admin **create** but
it cited `user-management.helpers.ts:174,223`; `:223` is the update-patch branch.
*Fix:* narrowed to `:174` (`validateCreateInput`) with the update patch and filter explicitly deferred.
`tasks.md` 3.4 aligned the same way.

**F-9. `tasks.md` 3.2 contradicted `specs.md`/`plan.md` on the service-boundary type.** Task 3.2 said
`RegistrationSubmitInput.country`/`AdminRegistrationSubmitInput.country` "become `CountryCode`",
while `specs.md` REQ-8 AC5, `plan.md` §3.2, and `specs.md` REQ-4 assumption all say they **stay
`string`** (`backend/types/users/registration.types.ts:48,75`).
*Fix:* task 3.2 now says the type stays `string` holding the ISO code.

### Dimension 4 — i18n / compile-time translation rules (`shared/AGENTS.md`, `shared/locale/AGENTS.md`)

**F-10. `ctx.t(...)` used without `await`.** `plan.md` §5.7 showed `const tErrors =
ctx.t("errorsTranslations");`. `ctx.t` is typed as returning a `Promise`
(`backend/graphql/gqlContextFactory.ts:46`), and every real call site awaits it
(e.g. `backend/graphql/mutation/admin/admin-teachers.mutation.ts:59`).
*Fix:* added `await` and corrected the comment ("returns a Promise").

**F-11. Namespace dir re-export file missing from the inventory.** `specs.md` REQ-7 AC1 and
`tasks.md` 4.1 listed `namespaces/countrySelector/countrySelector.namespace.ts` but omitted the
required sibling `namespaces/countrySelector/index.ts`. `registry.ts` imports handles via the
directory path (`@/shared/locale/namespaces/<ns>`), which resolves through that `index.ts`
(live example: `shared/locale/namespaces/wallet/index.ts`).
*Fix:* added the `index.ts` re-export to both the spec file list and the task recipe.

**F-12. Namespace-handle / component name collision.** `tasks.md` 5.1 wrote
`useAppTranslation(CountrySelector)` while the component itself is named `CountrySelector`.
*Fix:* task now imports the handle aliased (`import { CountrySelector as CountrySelectorNs } from
"@/shared/locale/namespaces/countrySelector"`), matching `plan.md` §5.7.

*Non-violations confirmed:* no `Translation.` enum, no two-arg `getTranslations`, no `next-intl`, no
`shared/messages/` references; the `defineNamespace<Labels>("countrySelector.countrySelector", tr =>
tr.countrySelectorTranslations)` recipe matches the live `wallet` exemplar; `AuthLabels`
`countryRequired` is at `shared/locale/types/auth/index.ts:39` as cited.

### Dimension 5 — `path:line` citation accuracy (root `AGENTS.md` §"cite real locations")

**F-13. Known-field-path list mis-attributed.** `specs.md` REQ-9 AC5, `plan.md` §7 Tier 4, and
`tasks.md` 5.2 cited `frontend/lib/mutationFieldErrors.test.ts` (`:242,245`) as "known paths".
That test file is 261 lines and `:242/:245` are `REUSE_SET` entries (`passwordRequired`,
`countryRequired`); the projection module has no path list at all. The real known-path list is
`REGISTER_FIELD_PATHS` in `frontend/views/auth/register/registerFormUtils.ts:20-31`.
*Fix:* re-attributed to `REGISTER_FIELD_PATHS:20-31` + the `REUSE_SET` audit `:238-249`.

**F-14. Wrong line for the merged-`slotProps` exemplar.** `plan.md` §5.6 and `tasks.md` 5.1 cited
`WalletPickerHeader.tsx:43-57`; the merge (`{ ...params.slotProps, htmlInput: { ...params.slotProps?.htmlInput, … } }`)
is at `:61-72` (`frontend/views/admin/finances/WalletPickerHeader.tsx`); `:43-57` is `renderOption`/`onChange`.
*Fix:* corrected to `:61-72`.

**F-15. Wrong line (and path shorthand) for the end-adornment exemplar.** `specs.md` §6.1 and
`tasks.md` 5.1 cited `AuthFormShared.tsx:127`; `<InputAdornment position="end">` is at `:129`, and the
file lives at `frontend/components/AuthFormShared.tsx` (not `frontend/views/auth/`).
*Fix:* corrected path and line.

**F-16. Wrong line for the country default value.** `tasks.md` 5.2 cited `useRegisterFormState.ts:29`
for `country: ""`; `:29` is the `useForm(...)` call and the `country` default is at `:35`.
*Fix:* corrected to `:35`.

**F-17. Missing-country helperText line.** `specs.md` §7.4 cited `RegisterIdentityFields.tsx:82` for
the polite live region; `:82` is the phone field's closing brace — the country field's
`formHelperText` is at `:99`.
*Fix:* corrected to `:99` (with the shared pattern lines `:46,66,83`).

**F-18. Off-by-one in the deferred ledger.** `deferred-items.md` P1 cited
`user-management.helpers.ts:173-176`; the branch is `:173-177`.
*Fix:* corrected and clarified that only `validateCreateInput` is retyped.

*Verified-correct citations (spot sample):* `RegisterIdentityFields.tsx:86-101` (country field),
`registration.service.ts:221-223/244-246/249-280/268`, `user-management.helpers.ts:174/223`,
`scalar.pothos.ts:24,30`, `builder.ts:78-84`, `codegen.ts:18,20-29`, `registration.types.ts:48,75`,
`userFieldHelpers.ts:104`, `admin-user.pothos.ts:302,327`, `auth.mutation.ts:67`,
`admin-users.mutation.ts:83`, `useRegisterFormState.ts:49,54,60`, `registerFormUtils.ts:63-72`,
`user.repository.ts:51-58/83-90/106`, `users.ts:22`, `package.json:104,116,147-149`,
`iana-timezone-generator/territories.ts:4,44`, `ONboardStudentParentSection.tsx:86-101`,
`shared/AGENTS.md:201-216`, `graphql-scalars@2.0.0` / `zod@4.6.2` / `cldr-localenames-full@48.2.0`
(all present in `bun.lock`), no `@hookform/resolvers` in `bun.lock`.

### Dimension 6 — Remaining required checks (all PASS)

- **Scalar two-sides-in-sync rule** (`backend/graphql/pothos/AGENTS.md:5-7`): the plan registers
  `CountryCode` once in `scalar.pothos.ts` AND adds it to the builder `Scalars` slot AND maps it in
  `codegen.ts` (`strictScalars: true`, `codegen.ts:18`), AND pins it in
  `backend/graphql/test/schema-surface.test.ts`, AND re-runs `bun run generate:gqlSchema` +
  `bun codegen`. Task 2.1.SR explicitly checks the sync. **PASS.**
- **GraphQL document naming** (`frontend.instructions.md:79-88`): the feature adds no new frontend
  GraphQL documents (the register mutation document already exists and is unchanged), so no naming
  rule is engaged. **N/A / PASS.**
- **REQ-1..REQ-11 traceability**: every REQ in `specs.md` appears in the `tasks.md`
  "Requirement → Phase map" (`tasks.md:163-175`) and in the coverage checklist (`tasks.md:627-639`).
  REQ-1→1.1, REQ-2→1.2, REQ-3→2.1/3.2, REQ-4→3.2/3.3/3.4, REQ-5→5.1, REQ-6→5.2, REQ-7→4.1/4.2,
  REQ-8→3.1/3.3, REQ-9→every `.TE`, REQ-10→6.1, REQ-11→0.1 + every outcome file. **PASS.**
- **Drizzle push-vs-migrate correctness** (`docs/DATABASE_MIGRATIONS.md`,
  `backend/db/schema/AGENTS.md:39`): the plan correctly distinguishes `bun db push` (live-DB sync,
  no committed artifact) from `bun drizzle-kit generate` (committed folder under `backend/drizzle/`)
  applied by `bun db migrate`; journal table `drizzle.__drizzle_migrations` matches; and it forbids
  `CREATE INDEX CONCURRENTLY`. `bun drizzle-kit …` is the repo's own invocation form
  (`scripts/dbActions/generate.ts:89` runs `["drizzle-kit","generate",…]` via `bun`). **PASS.**
- **`plan.md` required sections** (design template): Document Information, Overview + Design Goals,
  Key Design Decisions (D1–D12 + rationale), Data Models, API Contracts, Services/Repository,
  Concurrency & Race-Condition Assessment, Cross-Actor Journey (N/A + rationale), UX/Navigation
  (routes, sidebar, role matrix, per-audience, RTL/mobile, a11y), Translation System Requirements,
  Security/Tenancy, Testing Strategy per tier + no-journey ruling, Risks/Rollback, Traceability
  Matrix, Outcome protocol, Design Review Checklist. **PASS.**
- **Shared-layer boundary**: `shared/lib/country-code.ts` imports only `zod` +
  `@/shared/constants/countries`; no `@/frontend|@/backend|@/app` import. **PASS.**
- **MUI v9**: plan uses `sx`, `*Outlined` icon naming, and `params.slotProps.htmlInput` (never
  `inputProps`). **PASS.**
- **No new npm dependency**: `@hookform/resolvers` confirmed absent from `bun.lock`; no flag/dial
  package; flags are regional-indicator emoji. **PASS.**

---

## Residual, documented consequence (not a rule violation)

The admin **create** wire input is tightened to `CountryCode` in scope (it shares
`userFieldHelpers.ts:104` with registration), while the admin create **form UI** is not rebuilt in
this plan. This means the admin create form must submit an ISO code; typing a display name will now
be rejected by the scalar. This is recorded as: `plan.md` §5.4 (note), `plan.md` §8 Risks (new row),
`tasks.md` 3.2 (note), and `deferred-items.md` D-4 (extended). It is an accepted behavior change
consistent with REQ-4, not an AGENTS.md violation. If product wants to avoid the admin-side change
entirely, the follow-up is to split the shared input helper — recorded here for the implementer.

---

## Traceability

| Dimension | Rule source | Findings | Status |
|-----------|-------------|----------|--------|
| Permission matrix vs real roles | root AGENTS.md; `backend/graphql/mutation/admin/admin-users.mutation.ts` | F-1..F-4 | Fixed |
| Scalar behavior | `backend/graphql/pothos/AGENTS.md`; `graphql-scalars@2.0.0` | F-5 | Fixed |
| Admin input scope | `plan.md` §2.4; `deferred-items.md` D-3/D-4 | F-6..F-9 | Fixed |
| i18n | `shared/AGENTS.md`; `shared/locale/AGENTS.md` | F-10..F-12 | Fixed |
| Citation accuracy | root AGENTS.md | F-13..F-18 | Fixed |
| Scalar sync / documents / traceability / Drizzle / sections | listed above | — | Pass |

**Files modified (plan directory only):** `specs.md`, `plan.md`, `tasks.md`, `deferred-items.md`
(this outcome file created). No source file was touched.

---

## Final verdict

Plan passes all AGENTS.md rules
