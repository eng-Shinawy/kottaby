# Deferred Items Ledger

**Feature:** GitHub issue #230 — "No Country Selector Component"
**Plan:** `ai/plans/issue_230/no_country_selector_component/`
**Issue:** [#230](https://github.com/) — "Request new country input component with flag (start adornment) and with validation on both frontend and backend, and a new custom graphql scalar, with shared zod schema"
**Created:** `2026-09-30`

---

## Purpose

This ledger tracks all work deferred from one task to another, and all work intentionally
out of scope for issue #230, so nothing is silently forgotten. Every deferred item must be
explicitly logged here. Items with a `❌ Blocked` or `⚠️ Partial` status block plan
completion (see [Enforcement](#enforcement)); items marked `⏭️ Out of scope` are
deliberate scope decisions for a **future** issue/plan and do not block this plan.

This ledger follows `.agents/spec-process-guide/templates/deferred-items-template.md`,
extended with a Phase-0 baseline section and a scope-decision section required by the
plan's frozen design contract (D1–D12) and the Feature-6 criteria (REQ-11).

---

## Phase 0 — Baseline Error Ledger

Recorded **before any source change** so new failures can be distinguished from
pre-existing noise. These are the literal baseline commands from the skill
(`.agents/skills/spec-driven-development/SKILL.md:61-67` and
`.agents/spec-process-guide/execution/implementation-guide.md:28-34`).
Phase 0 of `tasks.md` owns populating the result columns.

| # | Command | Raw artifact | Result (populate at Phase 0) | Notes |
|---|---|---|---|---|
| B1 | `bun tsgo 2>&1 \| grep "error TS" \| wc -l > /tmp/baseline-tsgo.txt` | `/tmp/baseline-tsgo.txt` | `_TBD_` | Count of TypeScript errors at baseline |
| B2 | `bun biome:check 2>&1 \| grep -c "warn" > /tmp/baseline-biome.txt` | `/tmp/baseline-biome.txt` | `_TBD_` | Count of biome warnings at baseline |
| B3 | `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json` | `/tmp/baseline-lint.json` | `_TBD_` | JSON lint envelope: `{ success, output, exitCode, metrics }` |
| B4 | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` | exit code | `_TBD_` | Per-file progressive loop exit code (0 = clean); run for any file touched generically before refactor |

**Baseline policy:** any `error TS` / biome warning / lint error present at Phase 0 must
match the post-change count, or the change must reduce it. A **new** error above the
recorded baseline is a regression and must be fixed. Pre-existing issues found while
reading files are listed in [Pre-existing Issues](#pre-existing-issues-not-caused-by-this-plan).

---

## Ledger Table

| ID | Item | Reason deferred | Trigger to revisit | Owner | Requirement impacted | Status |
|---|---|---|---|---|---|---|
| D-1 | Dial-code / phone-country metadata (calling codes `+20`, `+966`, …) and derived `phone_country` inference | Issue #230 requests only a **country** input component. CLDR (`cldr-localenames-full`) ships territory **names** but **no calling-code data**; adding dial codes would need a new data source (e.g. ITU/`libphonenumber`) and a new npm dependency, which D10 forbids for this plan. | A follow-up issue requests dial-code display or phone↔country inference; or a dial-code dataset is added to the repo. | TBD (future issue) | REQ-1 (data shape), REQ-5 (component props) | ⏭️ Out of scope |
| D-2 | Normalizing legacy free-text `country` values (e.g. `"Egypt"` / `"egypt"` / `"EG"`) into ISO codes, plus a data backfill migration | Safe to defer: the new `country_code` column (REQ-8, D8) is added **alongside** the retained free-text `country`. Existing rows have no `country_code`. A backfill requires a curation mapping and a data migration that risks corrupting display strings; it is orthogonal to the component/scalar feature. | A consumer needs to filter/group users by ISO code for existing rows (e.g. admin directory or broadcast cohorts move to ISO); or `country_code` starts being read as non-nullable. | TBD | REQ-8 (persistence), REQ-4 (validation) | ⏭️ Out of scope |
| D-3 | Repointing the admin directory `country` filter and the broadcast `audienceCountry` exact-match cohort builder at ISO codes | Both currently match the free-text `country` string (`backend/db/schema/notifications/broadcasts.ts:41` `audienceCountry varchar(100)`; `backend/services/notifications/admin-broadcast.service.ts:188`). Moving them to ISO codes is a **behavior/UX change** beyond issue #230 and depends on D-2 (backfill) to be correct for legacy rows. | Broadcast audience selection is redesigned, or the admin filter is moved to `CountrySelector` (D-4). | TBD | REQ-8 (persistence) | ⏭️ Out of scope |
| D-4 | Making the admin-user country filter/input a `CountrySelector` too, and retyping the admin directory **filter** (`AdminUserFiltersInput.country`, `admin-user.pothos.ts:302`) / admin **update** patch (`AdminUpdateUserInput.country`, `admin-user.pothos.ts:327`) inputs to the `CountryCode` scalar | Issue #230 asks for the component itself. The admin directory keeps its free-text filter and the admin update patch keeps free-text `country` (both match legacy display strings via D-3). The admin **create** input is retyped in scope (it shares `userFieldHelpers.ts:104` with registration), so the admin create form must already emit an ISO code. Replacing the admin UI + wiring the filter/update to ISO codes depends on D-3/D-2. The component (REQ-5) is intentionally **reusable** so this is a small follow-up. | Admin user-management UI work is scheduled, or D-3 is accepted. | TBD | REQ-5 (component), REQ-6 (integration), REQ-8 (persistence) | ⏭️ Out of scope |
| D-5 | Adding `@hookform/resolvers` + `zodResolver` for the register form | D10 forbids a new dependency for this plan. The register form validates inline via `countryCodeSchema.safeParse` inside the RHF `validate`/controller path, which needs no resolver. A resolver only earns its keep once **multiple** forms share zod validation. | A second zod-consuming form appears, or the fraction of zod-validated fields makes manual wiring a source of duplication. | TBD | REQ-2 (schema), REQ-6 (integration) | ⏭️ Out of scope |
| D-6 | Exposing `CountryCode` (instead of `String`) on **output/entity** types | Only **input** validation is in issue #230's scope. Today `backend/graphql/pothos/users/user.pothos.ts:39` exposes `country: t.exposeString("country", { nullable: true })` (the legacy free-text column). Retyping outputs to `CountryCode` requires the `country_code` column to be populated (blocked by D-2) and would be a breaking SDL change for clients. | D-2 backfill lands and clients are ready for a schema change; or a new `countryCode` field is added as a distinct output. | TBD | REQ-3 (scalar), REQ-8 (persistence) | ⏭️ Out of scope |
| D-7 | `Intl.DisplayNames` fallback and locale-extension names beyond CLDR `ar`/`en` | The repo's generated-data precedent (`shared/constants/iana-*.ts`) is CLDR `ar`/`en` only, and the app's compile-time i18n supports exactly `en`/`ar` (`shared/locale/{en,ar}`). `Intl.DisplayNames` would add a runtime locale dependency with no current consumer. | The app adds a third locale, or a consumer needs country names in a locale absent from CLDR's `main/` data shipped in `cldr-localenames-full`. | TBD | REQ-1 (dataset), REQ-7 (i18n) | ⏭️ Out of scope |

**Status legend:** `⏭️ Out of scope` = deliberate scope decision for a future plan (does
not block this plan) · `❌ Blocked` = in-scope work not yet done (blocks completion) ·
`⚠️ Partial` = in-scope work partly done (blocks completion) · `🔄 In Progress` · `✅ Done`
(requires an outcome-file or commit reference).

### In-plan deferred items (must resolve before completion)

No in-plan deferrals are known at plan authoring time. Implementation tasks (Phase 0–7)
must add rows here (status `❌ Blocked` / `⚠️ Partial` / `🔄 In Progress`) the moment they
discover work that belongs to another task or phase, then flip them to `✅ Done` with an
`outcome/` reference when completed. The frozen task pipeline expects any such row to be
resolved inside the same phase that owns the target file.

| ID | Item | Source task | Target task | Status | Verified by | Notes |
|---|---|---|---|---|---|---|
| — | _(none yet — add during execution)_ | — | — | — | — | — |

---

## Non-deferred (in scope)

The following are explicitly **in scope** for this plan and must NOT be treated as
deferred. They are listed here so the ledger cannot be used to silently drop them.

| Capability | Where | Requirement |
|---|---|---|
| ISO 3166-1 alpha-2 dataset with `ar`/`en` names + flag emoji, generated and committed | `shared/constants/countries.ts` (new generator `scripts/country-data-generator/`) | REQ-1 |
| Shared zod schema + guards (`countryCodeSchema`, `countryCodeShapeSchema`, `normalizeCountryCode`, `isValidCountryCode`, `COUNTRY_CODE_PATTERN`) | `shared/lib/country-code.ts` + colocated `shared/lib/country-code.test.ts` | REQ-2 |
| New GraphQL scalar `CountryCode` (registry + builder `Scalars` slot + `codegen.ts` map + regenerated SDL/codegen + `schema-surface.test.ts` pin) | `backend/graphql/pothos/shared/scalar.pothos.ts`, `backend/graphql/pothos/builder.ts`, `codegen.ts` | REQ-3 |
| Backend rejection of absent/invalid codes on registration **and** admin user creation, localized field errors on path `country` | `backend/services/auth/registration.service.ts`, `backend/services/admin/user-management.helpers.ts` | REQ-4 |
| Reusable `CountrySelector` (flag start adornment, localized names, RTL, MUI v9 Autocomplete, RHF-compatible) | `frontend/components/ui/CountrySelector.tsx` + story | REQ-5 |
| Register form swap from free-text `TextField` to `CountrySelector` with shared-schema validation | `frontend/views/auth/register/{RegisterIdentityFields.tsx,useRegisterFormState.ts,registerFormUtils.ts}` | REQ-6 |
| `countrySelector` i18n namespace + `AuthLabels` keys `countryCodeRequired` / `countryCodeInvalid`, with compile-time parity | `shared/locale/**` | REQ-7 |
| Nullable `country_code varchar(2)` column + committed migration; registration stores ISO code **and** display name | `backend/db/schema/users/users.ts`, `backend/drizzle/<timestamp>_add_users_country_code/` | REQ-8 |
| Coverage across shared/db/service/GraphQL/frontend tiers per D11 (no `test/workflows` journey — single-actor feature) | tests listed in `plan.md` §7 | REQ-9 |
| `docs/domain/graphql-scalars.md` knowledge propagation | `docs/domain/graphql-scalars.md` | REQ-10 |
| Outcome knowledge base + `[ ]`→`[x]` task checkbox tracking | `ai/plans/issue_230/no_country_selector_component/outcome/`, `tasks.md` | REQ-11 |
| Retaining the legacy free-text `country` column untouched (backward compatibility) | `backend/db/schema/users/users.ts` | REQ-8 |

---

## Pre-existing Issues (not caused by this plan)

Observed while verifying the ground-truth citations above. These are **pre-existing** in
the current tree as of the plan authoring date; they are recorded so implementers do not
mistake them for regressions, not as work items for this plan unless a task's file scope
overlaps them.

| # | Location | Observation | Impact on this plan |
|---|---|---|---|
| P1 | `backend/services/admin/user-management.helpers.ts:173-177` | Admin country validation uses `COUNTRY_REQUIRED` and a `COUNTRY_TOO_LONG` branch (`MAX_COUNTRY_LENGTH`). The frozen D7 replaces the free-text check with `countryCodeSchema.safeParse` **on the create path (`validateCreateInput`) only**; the length branch becomes unreachable for ISO-2 codes there, and `validateUpdatePatch` (`:220-225`) stays free-text (D-4). | In scope for the admin task (3.4): the length branch and `MAX_COUNTRY_LENGTH` must be reconciled when D7 lands. Logged here so the redundancy is intentional, not accidental. |
| P2 | `backend/graphql/pothos/users/user.pothos.ts:39` | `country` is exposed as `t.exposeString("country", { nullable: true })` — the legacy free-text column, **not** the new scalar. | Deliberately unchanged (see D-6). A client reading `country` still receives `"Egypt"`-style legacy text until D-2/D-6. |
| P3 | `backend/db/schema/notifications/broadcasts.ts:41` | `audienceCountry varchar(100)` matches free-text country names exactly (`backend/services/notifications/admin-broadcast.service.ts:188`). | Untouched (see D-3); broadcasts keep exact-matching legacy display strings. |
| P4 | `shared/constants/index.ts` | The generated `iana-*` files are intentionally **not** exported from the barrel (deep-import only). | `shared/constants/countries.ts` must follow the same deep-import convention; do not add it to the barrel. |
| P5 | `codegen.ts:18` `strictScalars: true` | Every scalar must have an explicit entry in the codegen scalar map or codegen fails. | REQ-3 mandates adding `CountryCode: "string"` to `codegen.ts`; forgetting it is a hard codegen failure, not a warning. |

---

## Enforcement

The **final quality-gate task** (last task before Phase 7 completion, per `tasks.md`)
MUST verify no in-scope deferred item remains unresolved:

```bash
# In-scope unresolved items only (⏭️ out-of-scope rows are intentional and must not match)
grep -nE "❌ Blocked|⚠️ Partial|🔄 In Progress" \
  ai/plans/issue_230/no_country_selector_component/deferred-items.md
# Expected: no matches (exit 1) — all in-plan deferrals resolved with an outcome/ reference
```

**Exit criteria:** the plan cannot be marked complete while any `❌ Blocked`, `⚠️ Partial`,
or `🔄 In Progress` row remains. Rows marked `⏭️ Out of scope` are permanent scope
decisions for future issues and do not block this plan.

Also assert the in-scope capability list above was delivered: every REQ-1..REQ-11 row in
[tasks.md](./tasks.md) is checked `[x]` and has a corresponding `outcome/` file (REQ-11).

---

## Related Documents

- Requirements: [`specs.md`](./specs.md) — REQ-1..REQ-11 acceptance criteria
- Design: [`plan.md`](./plan.md) — decisions D1..D12, testing strategy, traceability
- Tasks: [`tasks.md`](./tasks.md) — Phase 0 baseline task, per-file pipeline, checkboxes
- Outcome knowledge base: [`outcome/`](./outcome/) — per-task execution records (REQ-11)
- Templates: `.agents/spec-process-guide/templates/deferred-items-template.md`
- Execution guide: `.agents/spec-process-guide/execution/implementation-guide.md`
- Skill: `.agents/skills/spec-driven-development/SKILL.md`
