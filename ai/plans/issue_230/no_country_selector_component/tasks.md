# Tasks — Issue #230: Country Selector Component

## Document Information

- **Feature Name**: Country Selector Component (issue #230 — "No Country Selector Component")
- **Issue**: GitHub issue #230 (NOT a milestone ticket — milestone dir is `issue_230`)
- **Plan Directory**: `ai/plans/issue_230/no_country_selector_component/`
- **Outcome Directory**: `ai/plans/issue_230/no_country_selector_component/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-30
- **Related Documents**:
  - Requirements: `ai/plans/issue_230/no_country_selector_component/specs.md`
  - Design: `ai/plans/issue_230/no_country_selector_component/plan.md`
  - Deferred items: `ai/plans/issue_230/no_country_selector_component/deferred-items.md`
- **Template**: `.agents/spec-process-guide/templates/tasks-template.md`
- **Target stack**: Next.js 16 App Router, Bun, React 19, MUI v9, Pothos GraphQL, Drizzle ORM, custom compile-time i18n (`shared/locale/`).

### Issue intent (verbatim)

> Request new country input component with flag (start adornment) and with validation on both frontend and backend, and a new custom graphql scalar, with shared zod schema.

---

## Non-Negotiable Execution Protocol for All Tasks

1. **Pre-Execution Outcome Knowledge Read (REQ-11):** Before executing ANY task, the executing agent MUST read **ALL** existing files in `ai/plans/issue_230/no_country_selector_component/outcome/` to absorb prior research, search results, docs, and pitfalls so analysis is not repeated. This includes `outcome/0-baseline-outcome.md` and every `<task-id>-outcome.md` written by earlier tasks.
2. **Per-File Quality Verification Loop (immediate post-edit):** Whenever a file is modified, run the unified per-file script BEFORE moving to another file/subtask:
   ```bash
   bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates
   ```
   It runs `tsgo → oxlint → biome:check → lint:type-aware → check:duplicates` in strict progressive order, short-circuiting at the first failing check. It also auto-discovers and prints the applicable `.agents/instructions/*.instructions.md` and layer `AGENTS.md` files. Exit code `0` = all checks passed.
3. **Semantic Review Checklist (pre-completion gate):** Run the agent self-review checklist (race conditions, env-config, dead code, cross-layer, enums, deferred items) — see `.SR` below.
4. **Global Health Check (completion gate):** Re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on **all** modified files; every run MUST exit code `0`.
5. **Post-Execution Outcome File Creation (REQ-11):** After implementation + quality checks, write `ai/plans/issue_230/no_country_selector_component/outcome/<task-id>-outcome.md` summarizing research, analysis, changes, cross-file dependencies, and carry-over knowledge.
6. **Task Progress Tracking (REQ-11):** Update the checkbox `[ ]` → `[x]` in **this** `tasks.md` upon successful completion.

## MANDATORY Subtasks for Every Implementation Task

**EVERY implementation task (X.Y) MUST carry these 5 subtasks in strict order:**
`QL → TE → SEC → SR → IV → mark [x]`.

### 1. Quality Loop Subtask (X.Y.QL)

```markdown
- [ ] X.Y.QL **Quality Loop**: Per-file verification on `<file-path>`
  - Run: `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates`
  - The script runs: tsgo → oxlint → biome:check → lint:type-aware → check:duplicates
  - It auto-discovers & prints applicable AGENTS.md + .agents/instructions files
  - It enforces the Fix-Or-Report rule (fix within same file; report cross-file deps to orchestrator)
  - Exit code 0 = all checks passed; 1 = stopped at failing check (errors printed)
  - Fix all errors and re-run until exit code 0 before proceeding
```

### 2. Test Engineering Subtask (X.Y.TE)

```markdown
- [ ] X.Y.TE **Test Engineering**: Author / expand tests using the 4-Tier Framework
  - **Tier 1 (Branch & Statement Coverage)**: 100% method and branch coverage for new logic.
  - **Tier 2 (Boundary Value Analysis)**: empty strings, nullability fallbacks, unicode/RTL, numeric/timezone boundaries.
  - **Tier 3 (Monkey & Chaos Testing)**: randomized fuzz payloads, concurrent execution (`Promise.allSettled`), out-of-order state.
  - **Tier 4 (Security & Abuse Testing)**: SQL/LIKE wildcards (`%`, `_`, `\`), unauthenticated rejection, invalid role handling.
  - **Layer Rules Enforced**:
    • Database tests: wrapped in `runInRollback` + `tx` propagation to every repository method (`expectRepoError` try/catch).
    • Service tests: mock all external channels (WhatsApp, Resend, Twilio, Fixer, Upstash Redis).
    • GraphQL tests: setup via `setupTestServerLifecycle()` + execute via `testClient`.
    • Journey tests (`test/workflows/`): NOT APPLICABLE for this feature — see the "No Journey Test" ruling below.
```

### 3. Security & Tenancy Audit Subtask (X.Y.SEC)

```markdown
- [ ] X.Y.SEC **Security & Tenancy Audit**: Probe for authorization and boundary vulnerabilities
  - **BOLA / IDOR Defense**: verify identity is derived from `ctx.user.id` / session context; caller cannot read/mutate sibling tenant records.
  - **BOPLA Mass Assignment Defense**: verify strict DTO mapping; ensure no `{ ...input }` spread into Drizzle `insert()`/`update()`/`set()` calls.
  - **BFLA Function Access**: verify low-privilege tokens (students/parents/guests) cannot call admin/supervisor mutations.
  - **Composite Relations**: verify child resources belong to the verified parent resource.
  - **Input Sanitization**: ensure LIKE/ILIKE search queries escape wildcard characters (`escapeLikeWildcards`).
```

### 4. Semantic Review Subtask (X.Y.SR) — MANDATORY

```markdown
- [ ] X.Y.SR **Semantic Review**: Agent self-review before marking complete
  - [ ] No client-supplied ID used without caller ownership or role permission assertion (IDOR/BOLA defense)
  - [ ] Multi-tenant Drizzle queries include explicit tenancy filter
  - [ ] No unvalidated `...input` spreading into Drizzle update methods (BOPLA mass assignment defense)
  - [ ] DataLoaders filter batch results against caller authorized tenancy
  - [ ] No read-then-write without atomicity (SELECT FOR UPDATE / tx / advisory lock)
  - [ ] No module-level mutable state without bounds
  - [ ] All `resolveEnvConfig` calls registered in `env-config-keys.ts`
  - [ ] All `resetX()` functions invalidate all resolved keys
  - [ ] No empty-string credential acceptance
  - [ ] No dead branches (all paths reachable)
  - [ ] No cross-layer imports (frontend→backend, shared→frontend/backend)
  - [ ] Enums imported as values (not `import type`) when used at runtime
  - [ ] Schema migrations match Drizzle schema
  - [ ] All deferred items logged in `deferred-items.md`
```

### 5. Instruction Verification Subtask (X.Y.IV)

```markdown
- [ ] X.Y.IV **Instruction Verification**: Read & validate `<file-path>` against rule files
  - The `sub-loop.ts` script (run in X.Y.QL) auto-discovers & prints applicable rule files
  - Read ALL printed AGENTS.md files (root `AGENTS.md` + layer `AGENTS.md`)
  - Read ALL printed .agents/instructions files (e.g. `.agents/instructions/backend.instructions.md`)
  - Validate the file against the rules in those files
```

### Layer-to-Instructions Mapping (applicable to this plan)

`sub-loop.ts` auto-discovers these per target file; the table is a pre-flight reference. **Never** create or update AGENTS.md / `.agents/instructions/*` — they are hand-curated; durable knowledge goes to `docs/domain/graphql-scalars.md` and the `outcome/` files.

| Target path | AGENTS.md files | .agents/instructions files |
|-------------|-----------------|----------------------------|
| `scripts/country-data-generator/*` | `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md` | — |
| `shared/constants/*`, `shared/lib/*` | `/home/ahmed/Projects/kottaby_kottaby/shared/AGENTS.md` | — |
| `shared/locale/**` | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | — |
| `backend/graphql/pothos/**`, `backend/graphql/test/**` | `backend/graphql/pothos/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `backend/db/schema/**` | `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/db/repo/**` | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/services/**` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/types/**` | `backend/types/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `frontend/components/**`, `frontend/views/**`, `frontend/stories/**` | `frontend/views/AGENTS.md` (views), `frontend/AGENTS.md` | `frontend.instructions.md` |
| `backend/db/test/**` | `backend/db/test/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |

### Regeneration commands (call out per task where applicable)

| Change | Command(s) |
|--------|-----------|
| New/updated Pothos scalar or field | `bun run generate:gqlSchema` (writes `frontend/graphql/generated/schema.graphql`) **then** `bun codegen` (writes `frontend/graphql/generated/gql/graphql.ts`) |
| Drizzle schema column (local DB sync only) | `bun db push` (via `scripts/dbActions/`) |
| Committed migration SQL | `bun drizzle-kit generate` → `backend/drizzle/<timestamp>_<name>/` → `bun db migrate` |
| Generated country dataset | `bun run generate:countries` (new script, Phase 1.1) |

**Drizzle distinction (critical):** `bun db push` only syncs the live local DB — it does **not** produce a committed migration. The committed artifact is produced by `bun drizzle-kit generate` and applied with `bun db migrate`. Never `CREATE INDEX CONCURRENTLY`. See `docs/DATABASE_MIGRATIONS.md`.

### No Journey Test (explicit ruling)

Issue #230 is a **single-actor feature**: country validation touches one form (`/register`) and one anon GraphQL mutation, plus an admin-only create path that is validation-only. There is **no cross-actor state transition** (no actor A's action observed by actor B). Per `.agents/instructions/tests.instructions.md`, `test/workflows/` journey tests are reserved for cross-actor workflows; **NO `test/workflows/` test is created for this plan**. Rationale recorded here and in `plan.md` §Journey Design and `specs.md` Journey Capture (N/A). Coverage lives in Tiers 1–4 (Phase-level `.TE`).

---

## Implementation Overview

Implement the issue-230 country input with a single canonical identifier: **ISO 3166-1 alpha-2 uppercase** (`^[A-Z]{2}$`, D1). A generated, committed dataset (`shared/constants/countries.ts`, D4) supplies codes + ar/en names + flag emoji; a shared zod schema/guards module (`shared/lib/country-code.ts`, D3) is the one validation source for both tiers; Pothos exposes a new `CountryCode` scalar (D2) backed by `graphql-scalars`' `CountryCodeResolver`; a reusable `CountrySelector` MUI v9 component (D5) replaces the free-text register field (D6); backend validation (D7) and a new nullable `country_code` column (D8) persist the ISO code plus a display name.

### Implementation Strategy

- **Shared-first**: dataset + zod schema land before backend/frontend consume them (both tiers import the same module).
- **Regenerate, don't hand-edit**: SDL, codegen, and migration artifacts are produced by their generators and committed.
- **No new runtime dependency** (D10): RHF inline `safeParse` validation; no `@hookform/resolvers`; dial codes deferred.
- **Backward compatible** (D8): legacy `country` free text is untouched; new `country_code` is additive and nullable.

### Development Approach

- **Testing Strategy**: TDD-leaning — shared unit tests authored with the module; service/db/GraphQL tests expanded in each phase's `.TE`.
- **Integration Strategy**: shared module → scalar → service/db → i18n → frontend, each phase verified per-file before the next consumes it.
- **Deployment Strategy**: Drizzle migration applied via `bun db migrate`; SDL + codegen committed so the frontend build does not depend on a running server.

### Requirement → Phase map (all of REQ-1..REQ-11)

| REQ | Title | Phase / Task |
|-----|-------|--------------|
| REQ-1 | Country dataset (generated, committed) | 1.1 |
| REQ-2 | Shared zod schema & guards | 1.2 |
| REQ-3 | `CountryCode` GraphQL scalar | 2.1 |
| REQ-4 | Backend validation | 3.3, 3.4 |
| REQ-5 | `CountrySelector` component | 5.1 |
| REQ-6 | Register form integration | 5.2 |
| REQ-7 | i18n labels (ar/en) | 4.1, 4.2 |
| REQ-8 | Persistence | 3.1, 3.3 |
| REQ-9 | Test coverage | every `.TE` |
| REQ-10 | Documentation & knowledge propagation | 6.1 |
| REQ-11 | Outcome knowledge base & progress tracking | 0.1 + every task's checkboxes/outcome file |

---

## Implementation Plan

### Phase 0: Pre-Implementation Baseline

- [ ] 0.1 Establish error baseline, initialize outcome dir, and seed deferred-items ledger
  - Read all existing files in `ai/plans/issue_230/no_country_selector_component/outcome/` (REQ-11).
  - Record baseline error counts BEFORE any implementation:
    ```bash
    bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt
    bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt
    bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
    ```
  - Create the deferred-items ledger `ai/plans/issue_230/no_country_selector_component/deferred-items.md` (template `.agents/spec-process-guide/templates/deferred-items-template.md`) with the seeded D-1..D-7 items and the baseline table.
  - Write outcome file: `ai/plans/issue_230/no_country_selector_component/outcome/0-baseline-outcome.md` documenting baseline counts and the deferred-items ledger state.
  - Update progress: mark task 0.1 `[x]` in `tasks.md`.
  - _Requirements: REQ-11, REQ-9_

---

### Phase 1: Shared Layer

- [ ] 1.1 **Country dataset + generator script (REQ-1)**
  - Create `scripts/country-data-generator/{cli,cldr-data,file-builders,paths,index}.ts`, mirroring `scripts/iana-timezone-generator/` (`cli.ts`, `cldr-data.ts`, `file-builders.ts`, `paths.ts`, `index.ts`).
  - Curate the ISO-2 code list in the generator; reuse the CLDR loading pattern (`cldr-localenames-full/main/<locale>/territories.json`) for ar names and the `en` sibling for en names; derive `flag` as the regional-indicator emoji from each code.
  - Emit `shared/constants/countries.ts` with header `// AUTO-GENERATED by scripts/country-data-generator — do not edit manually`, exporting `COUNTRY_CODES` (`as const`), `export type CountryCode = (typeof COUNTRY_CODES)[number]`, and `COUNTRIES: Record<CountryCode, { en: string; ar: string; flag: string }>`.
  - Add npm script `generate:countries` to `package.json`; run it to produce the committed file. Do **not** export from `shared/constants/index.ts` (deep-import only, matching the iana files).
  - Files: `scripts/country-data-generator/{cli,cldr-data,file-builders,paths,index}.ts`, `shared/constants/countries.ts`, `package.json`.
  - Applicable rules: root `AGENTS.md`, `shared/AGENTS.md`.
  - _Requirements: REQ-1, REQ-9, REQ-11_

- [ ] 1.1.QL **Quality Loop**: Per-file verification on each generator file + `shared/constants/countries.ts` + `package.json`
  - Run: `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` for each created file (exit code 0).

- [ ] 1.1.TE **Test Engineering**: 4-Tier coverage for the dataset
  - Tier 1: assert `COUNTRY_CODES` has no duplicates; `COUNTRIES` has an entry for every code; every `flag` is a 2-codepoint regional-indicator emoji matching its code.
  - Tier 2: assert ar + en names are non-empty strings; spot-check RTL-safe Arabic names (e.g. Egypt `EG`).
  - Tier 3: fuzz — reject any generated code failing `^[A-Z]{2}$`.
  - Tier 4: assert no injection/malformed CLDR value leaks into emitted strings.
  - Files: generator-level assertions plus a colocated data-integrity test file (if authored, assert it is added under `shared/` and passes `sub-loop.ts`).
  - _Requirements: REQ-9, REQ-1_

- [ ] 1.1.SEC **Security & Tenancy Audit**: no runtime user input in generator; verify CLDR data is read-only and no shell/`eval` interpolation of locale strings; the generated file contains no executable content.
  - _Requirements: REQ-9_

- [ ] 1.1.SR **Semantic Review**: run the checklist (no cross-layer imports — generator must not import `@/backend|@/frontend|@/app`; enum-as-value only where runtime; no dead branches).
  - _Requirements: REQ-9, REQ-1_

- [ ] 1.1.IV **Instruction Verification**: read `shared/AGENTS.md` + root `AGENTS.md` and validate `shared/constants/countries.ts` and the generator files against them (deep-import discipline; AUTO-GENERATED header; no barrel export).
  - _Requirements: REQ-11_

- [ ] 1.1 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/1.1-country-dataset-outcome.md`; mark 1.1 `[x]` in `tasks.md`.

- [ ] 1.2 **Shared zod schema & guards (REQ-2)**
  - Create `shared/lib/country-code.ts` exporting exactly (D3):
    - `COUNTRY_CODE_PATTERN` — `RegExp` for ISO-shape `^[A-Z]{2}$`.
    - `normalizeCountryCode(raw: string): string` — `trim().toUpperCase()`.
    - `isValidCountryCode(value: unknown): value is CountryCode` — shape + membership against `COUNTRY_CODES`.
    - `countryCodeSchema` — zod: transform trim+uppercase then validate membership against `COUNTRY_CODES`.
    - `countryCodeShapeSchema` — regex-only ISO-shape schema (shape-only validation where dataset membership is not required; the GraphQL scalar separately enforces the `graphql-scalars` library's full ISO list).
  - Imports: `z` from `"zod"`, `COUNTRY_CODES`/`CountryCode` from `"@/shared/constants/countries"` (deep imports; no relative paths; shared must never import `@/backend|@/frontend|@/app`).
  - Create colocated `shared/lib/country-code.test.ts`.
  - Files: `shared/lib/country-code.ts`, `shared/lib/country-code.test.ts`.
  - Applicable rules: root `AGENTS.md`, `shared/AGENTS.md`.
  - _Requirements: REQ-2, REQ-9, REQ-11_

- [ ] 1.2.QL **Quality Loop**: Per-file verification
  - Run: `bun run scripts/health/sub-loop.ts shared/lib/country-code.ts --lifecycle duplicates` and the same for `shared/lib/country-code.test.ts` (exit code 0).

- [ ] 1.2.TE **Test Engineering**: 4-Tier coverage in `shared/lib/country-code.test.ts`
  - Tier 1 (branches): `normalizeCountryCode` trim/uppercase; `isValidCountryCode` for valid member, valid-shape non-member (`XX`/`AA`), lowercase, empty, whitespace, `null`/`undefined`, non-string; both schemas' `safeParse` success + failure.
  - Tier 2 (boundaries): `""`, `"   "`, `"eg"`, `" EG "`, `"Egypt"` (legacy free text), `"EGY"`, `"E"`, unicode/RTL strings, 3-byte emoji input.
  - Tier 3 (fuzz): randomized strings via `Promise.allSettled` over `countryCodeSchema.safeParse` — no throw, always returns `{success}`; assert determinism.
  - Tier 4 (abuse): prototype-pollution-shaped input (`"__proto__"`), SQL/LIKE wildcards (`%`, `_`, `\`), huge strings — all rejected, no regex ReDoS (bounded input).
  - Run via `bun run test/scripts/run-test.ts shared/lib/country-code.test.ts`.
  - _Requirements: REQ-9, REQ-2_

- [ ] 1.2.SEC **Security & Tenancy Audit**: verify the membership check uses `COUNTRY_CODES` (not a regex alone) so `XX`/`AA` are rejected; confirm no `eval`, no dynamic `RegExp` construction from input; confirm normalization happens **before** membership check.
  - _Requirements: REQ-9, REQ-2_

- [ ] 1.2.SR **Semantic Review**: run the checklist (no cross-layer imports; no module-level mutable state; every branch reachable; `isValidCountryCode` narrows correctly).
  - _Requirements: REQ-9, REQ-2_

- [ ] 1.2.IV **Instruction Verification**: read `shared/AGENTS.md` + root `AGENTS.md`; validate deep-import discipline and "no service-layer `.types.ts`" rule.
  - _Requirements: REQ-11_

- [ ] 1.2 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/1.2-country-code-module-outcome.md`; mark 1.2 `[x]` in `tasks.md`.

---

### Phase 2: GraphQL Scalar

- [ ] 2.1 **`CountryCode` scalar registration + regen + surface pin (REQ-3)**
  - Update `backend/graphql/pothos/shared/scalar.pothos.ts`: add `CountryCodeResolver` to the `graphql-scalars` import (currently `scalar.pothos.ts:24`) and register with `gqlSchemaBuilder.addScalarType("CountryCode", CountryCodeResolver, {})` next to `DateTime` (line 30); extend the file-header registered-scalars list.
  - Update `backend/graphql/pothos/builder.ts` `Scalars` slot (the `{ DateTime: { Input: Date; Output: Date | string } }` block around `:78-84`) to add `CountryCode: { Input: string; Output: string }`.
  - Update `codegen.ts` scalar map (block at `:20-29`) with `CountryCode: "string"` (`strictScalars: true` at `:18` means a missing entry fails codegen).
  - Regenerate: `bun run generate:gqlSchema` then `bun codegen`; commit `frontend/graphql/generated/schema.graphql` and `frontend/graphql/generated/gql/graphql.ts`.
  - Pin the surface in `backend/graphql/test/schema-surface.test.ts` (assert `scalar CountryCode` is present).
  - Files: `backend/graphql/pothos/shared/scalar.pothos.ts`, `backend/graphql/pothos/builder.ts`, `codegen.ts`, `frontend/graphql/generated/schema.graphql`, `frontend/graphql/generated/gql/graphql.ts`, `backend/graphql/test/schema-surface.test.ts`.
  - Applicable rules: `backend/graphql/pothos/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-3, REQ-9, REQ-11_

- [ ] 2.1.QL **Quality Loop**: Per-file verification
  - Run: `bun run scripts/health/sub-loop.ts backend/graphql/pothos/shared/scalar.pothos.ts --lifecycle duplicates`, plus the same for `builder.ts`, `codegen.ts`, and `schema-surface.test.ts` (exit code 0).

- [ ] 2.1.TE **Test Engineering**: 4-Tier coverage for the scalar surface
  - Tier 1: `schema-surface.test.ts` asserts the scalar exists and is typed; assert `Scalars` slot and codegen map entry resolved (codegen build succeeds).
  - Tier 2: boundary — scalar accepts a valid code `"EG"`; assert a raw GraphQL literal through `testClient`/`setupTestServerLifecycle` rejects clearly invalid values per resolver semantics.
  - Tier 3: fuzz the SDL regen — re-run generators and assert no duplicate-scalar runtime error ("has already been declared").
  - Tier 4: attempt to pass undeclared/unknown scalar values; confirm no smuggling of extra fields.
  - Run: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` and `bun run test:graphql`.
  - _Requirements: REQ-9, REQ-3_

- [ ] 2.1.SEC **Security & Tenancy Audit**: confirm the scalar is a leaf value type (no object smuggling); verify `CountryCodeResolver` marks invalid input as a client error; ensure no field on the builder is widened by the scalar addition.
  - _Requirements: REQ-9, REQ-3_

- [ ] 2.1.SR **Semantic Review**: run the checklist; specifically confirm runtime registration (scalar.pothos.ts) and the builder `Scalars` typing stay in sync, and that `codegen.ts` `strictScalars` is satisfied.
  - _Requirements: REQ-9, REQ-3_

- [ ] 2.1.IV **Instruction Verification**: read `backend/graphql/pothos/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`; validate the one-file scalar registry discipline.
  - _Requirements: REQ-11_

- [ ] 2.1 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/2.1-country-code-scalar-outcome.md`; mark 2.1 `[x]` in `tasks.md`.

---

### Phase 3: Backend

- [ ] 3.1 **Drizzle schema column + committed migration (REQ-8)**
  - Update `backend/db/schema/users/users.ts`: add nullable `countryCode: varchar("country_code", { length: 2 })` next to the existing `country: varchar("country", { length: 100 })` (`users.ts:22`). Leave `country` untouched (D8, backward compat).
  - Local DB sync: `bun db push`.
  - Produce the committed migration: `bun drizzle-kit generate` → `backend/drizzle/<timestamp>_add_users_country_code/` (snapshot.json + .sql), then apply with `bun db migrate`. Never `CREATE INDEX CONCURRENTLY`.
  - Files: `backend/db/schema/users/users.ts`, `backend/drizzle/<timestamp>_add_users_country_code/` (generated).
  - Applicable rules: `backend/db/schema/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`; convention doc `docs/DATABASE_MIGRATIONS.md`.
  - _Requirements: REQ-8, REQ-9, REQ-11_

- [ ] 3.1.QL **Quality Loop**: Per-file verification
  - Run: `bun run scripts/health/sub-loop.ts backend/db/schema/users/users.ts --lifecycle duplicates` (exit code 0).

- [ ] 3.1.TE **Test Engineering**: repository migration/column coverage
  - Tier 1: a repo test (wrapped in `runInRollback` + `tx` propagated to every repository call) inserts a user with `countryCode: "EG"` and reads it back via `UserRepository` (note the raw-SQL SELECT blocks at `user.repository.ts:51-58` and `:83-90` that name `country`/`phone` explicitly may need the new column added — treat as in-task if a read assertion requires it, else log a cross-file dependency).
  - Tier 2: `null` `countryCode` (legacy rows) reads back `null`; length boundary at 2 chars rejects longer values at the DB layer.
  - Tier 3: concurrent inserts via `Promise.allSettled` inside the rollback tx.
  - Tier 4: attempt to insert an oversized/injected `countryCode` string — DB length constraint rejects.
  - Run: `bun run test/scripts/run-test.ts backend/db/test/repo/<users-repo-test>.test.ts`; db tests MUST use `runInRollback`.
  - _Requirements: REQ-9, REQ-8_

- [ ] 3.1.SEC **Security & Tenancy Audit**: confirm the migration is additive + nullable (no data loss); confirm no tenancy scoping change; verify `length: 2` prevents oversized writes.
  - _Requirements: REQ-9, REQ-8_

- [ ] 3.1.SR **Semantic Review**: run the checklist — "schema migrations match Drizzle schema" is the key item; confirm generated SQL matches the Drizzle diff exactly and `drizzle.__drizzle_migrations` records the applied migration.
  - _Requirements: REQ-9, REQ-8_

- [ ] 3.1.IV **Instruction Verification**: read `backend/db/schema/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`, and `docs/DATABASE_MIGRATIONS.md`.
  - _Requirements: REQ-11_

- [ ] 3.1 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/3.1-country-code-column-outcome.md`; mark 3.1 `[x]` in `tasks.md`.

- [ ] 3.2 **Types + Pothos input retype (REQ-4, REQ-3)**
  - Update `backend/types/users/registration.types.ts`: `RegistrationSubmitInput.country` and `AdminRegistrationSubmitInput.country` stay `string` (now holding the ISO code) — do NOT change the service-boundary type to `CountryCode`; keep the wire field name `country` on the input to preserve `REGISTER_FIELD_PATHS` projection (D7, REQ-8 AC5).
  - Retype the public registration Pothos input: `backend/graphql/pothos/shared/userFieldHelpers.ts:104` — change `country: t.string({ required: true })` to `country: t.field({ type: "CountryCode", required: true })`; `backend/graphql/pothos/auth/register-input.pothos.ts` composes this helper. `AdminCreateUserInput` (`backend/graphql/pothos/admin/admin-user.pothos.ts:313`) inherits the retyped field via `{ ...userRegistrationInputFields(t) }`.
  - Do NOT retype the admin directory filter (`admin-user.pothos.ts:302`, `AdminUserFiltersInput.country`) or the admin update patch (`admin-user.pothos.ts:327`, `AdminUpdateUserInput.country`) — both stay `t.string` on legacy free text (deferred D-4; §2.4).
  - Update resolvers that pass the field through: `backend/graphql/mutation/auth.mutation.ts:67` and `backend/graphql/mutation/admin/admin-users.mutation.ts:83`.
  - Regenerate SDL + codegen: `bun run generate:gqlSchema` then `bun codegen`; commit both generated files.
  - Files: `backend/types/users/registration.types.ts`, `backend/graphql/pothos/shared/userFieldHelpers.ts`, `backend/graphql/pothos/auth/register-input.pothos.ts`, `backend/graphql/pothos/admin/admin-user.pothos.ts`, `backend/graphql/mutation/auth.mutation.ts`, `backend/graphql/mutation/admin/admin-users.mutation.ts`, generated `schema.graphql` + `graphql.ts`.
  - Applicable rules: `backend/types/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-4, REQ-3, REQ-9, REQ-11_

- [ ] 3.2.QL **Quality Loop**: Per-file verification
  - Run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` for each modified file (exit code 0).

- [ ] 3.2.TE **Test Engineering**: 4-Tier coverage of the retyped inputs
  - Tier 1: GraphQL integration via `setupTestServerLifecycle()` + `testClient` — `registerUser` accepts `country: "EG"`; the SDL exposes `country: CountryCode!` on `RegisterUserInput`.
  - Tier 2: boundary — malformed `country` values rejected at the scalar layer; missing `country` rejected by `required: true`.
  - Tier 3: fuzz concurrent `registerUser` mutations with mixed valid/invalid codes.
  - Tier 4: BFLA — assert guest/anon can call `registerUser` (expected allowed) but NOT admin-create mutations; invalid role handling unchanged.
  - Run: `bun run test:graphql` / `bun run test:services`.
  - _Requirements: REQ-9, REQ-4, REQ-3_

- [ ] 3.2.SEC **Security & Tenancy Audit**: BOPLA — ensure the retype does not introduce any `{ ...input }` spread; BFLA — admin-create paths remain behind their existing admin role gate (`$all` authenticated + `role: [UserRole.Admin]`).
  - _Requirements: REQ-9, REQ-4_

- [ ] 3.2.SR **Semantic Review**: run the checklist; key items — "no cross-layer imports" (backend→shared is allowed), "enums imported as values when used at runtime" (not applicable to a type-only code), "no dead branches".
  - _Requirements: REQ-9, REQ-4_

- [ ] 3.2.IV **Instruction Verification**: read `backend/types/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `backend/graphql/AGENTS.md`, `.agents/instructions/backend.instructions.md`; validate "never create local type definitions in Pothos files".
  - _Requirements: REQ-11_

- [ ] 3.2 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/3.2-types-pothos-inputs-outcome.md`; mark 3.2 `[x]` in `tasks.md`.

- [ ] 3.3 **Registration validation + ISO-code insert (REQ-4, REQ-8)**
  - In `backend/services/auth/registration.service.ts` `validateInput()` (around `:199-247`), replace the free-text check at `:221-223` (`{ field: "country", code: "COUNTRY_REQUIRED", message: t.countryRequired }`) with `countryCodeSchema.safeParse(input.country)` logic:
    - empty/absent → `{ field: "country", code: "COUNTRY_CODE_REQUIRED", message: t.countryCodeRequired }`
    - malformed/non-member → `{ field: "country", code: "COUNTRY_CODE_INVALID", message: t.countryCodeInvalid }`
    - keep the field path `country` so the existing `REGISTER_FIELD_PATHS` projection (`frontend/lib/mutationFieldErrors.ts`) is unchanged.
  - In `createUserRow()` (`:249-280`), change the BOPLA explicit mapping at `:268` to write `countryCode: normalizeCountryCode(input.country)` **and** `country: COUNTRIES[normalizedCode].en` (display name) — field-by-field, NEVER `{ ...input }` spread.
  - Add the auth labels `countryCodeRequired` / `countryCodeInvalid` to the i18n interface (done in 4.2; block on that if run first).
  - Files: `backend/services/auth/registration.service.ts`.
  - Applicable rules: `backend/services/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-4, REQ-8, REQ-9, REQ-11_

- [ ] 3.3.QL **Quality Loop**: Per-file verification
  - Run: `bun run scripts/health/sub-loop.ts backend/services/auth/registration.service.ts --lifecycle duplicates` (exit code 0).

- [ ] 3.3.TE **Test Engineering**: 4-Tier coverage for registration validation
  - Tier 1: service tests — valid code inserts `country_code` + display name; empty → `COUNTRY_CODE_REQUIRED`; malformed → `COUNTRY_CODE_INVALID`; error payload field path is `country`.
  - Tier 2: `"eg"` normalizes to `"EG"`; `" EG "` normalizes; `"XX"`/`"AA"` (valid shape, not a member) rejected; `null`/`undefined` rejected.
  - Tier 3: fuzz randomized country payloads through the service; assert no throw besides `ValidationError`.
  - Tier 4: mass-assignment probe — submit extra fields; assert they are not written (BOPLA). Mock all external channels (WhatsApp/Resend/etc.).
  - Run: `bun run test:services` / `bun run test/scripts/run-test.ts <service-test>`.
  - _Requirements: REQ-9, REQ-4, REQ-8_

- [ ] 3.3.SEC **Security & Tenancy Audit**: verify the insert remains explicit field-by-field (no spread), normalization precedes membership check, `COUNTRIES[...]` lookup cannot be polluted (code is a member type), and anon registration cannot set governance/server fields.
  - _Requirements: REQ-9, REQ-4_

- [ ] 3.3.SR **Semantic Review**: run the checklist — key items: "no unvalidated `...input` spreading", "no read-then-write without atomicity" (validation is pure; single INSERT), "all deferred items logged".
  - _Requirements: REQ-9, REQ-4_

- [ ] 3.3.IV **Instruction Verification**: read `backend/services/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`; validate i18n usage (`getServerTranslations`) and typed translation keys.
  - _Requirements: REQ-11_

- [ ] 3.3 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/3.3-registration-validation-outcome.md`; mark 3.3 `[x]` in `tasks.md`.

- [ ] 3.4 **Admin user-creation validation parity (REQ-4)**
  - In `backend/services/admin/user-management.helpers.ts`, replace the free-text country logic in **`validateCreateInput`** (write at `:174` `COUNTRY_REQUIRED`) with `countryCodeSchema.safeParse(...)`, emitting `COUNTRY_CODE_REQUIRED` / `COUNTRY_CODE_INVALID` on field path `country`. Leave **`validateUpdatePatch`** (`:220-225`, `COUNTRY_INVALID`) on the legacy free-text `country` (deferred D-4; §2.4).
  - Normalize + store the ISO code + display name on the admin-create path consistently with 3.3 (`countryCode` + `country: COUNTRIES[code].en`).
  - Files: `backend/services/admin/user-management.helpers.ts`.
  - Applicable rules: `backend/services/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-4, REQ-8, REQ-9, REQ-11_

- [ ] 3.4.QL **Quality Loop**: Per-file verification
  - Run: `bun run scripts/health/sub-loop.ts backend/services/admin/user-management.helpers.ts --lifecycle duplicates` (exit code 0).

- [ ] 3.4.TE **Test Engineering**: 4-Tier coverage for admin create
  - Tier 1: valid admin create stores code + display name; empty → `COUNTRY_CODE_REQUIRED`; malformed → `COUNTRY_CODE_INVALID`.
  - Tier 2: lowercase/whitespace normalization; non-member valid-shape rejection.
  - Tier 3: fuzz + concurrent admin creates.
  - Tier 4: BFLA — assert non-admin (student/parent/teacher/anon) callers are rejected by the existing admin role gate (`$all` authenticated + `role: [UserRole.Admin]`) before validation runs; mass-assignment probe.
  - Run: `bun run test:services`.
  - _Requirements: REQ-9, REQ-4_

- [ ] 3.4.SEC **Security & Tenancy Audit**: BFLA defense — confirm the admin-create admin role gate is unchanged and precedes validation; BOPLA — explicit mapping, no spread.
  - _Requirements: REQ-9, REQ-4_

- [ ] 3.4.SR **Semantic Review**: run the checklist; confirm admin and registration validation share the same schema (no drift).
  - _Requirements: REQ-9, REQ-4_

- [ ] 3.4.IV **Instruction Verification**: read `backend/services/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-11_

- [ ] 3.4 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/3.4-admin-validation-outcome.md`; mark 3.4 `[x]` in `tasks.md`.

---

### Phase 4: i18n

- [ ] 4.1 **`countrySelector` namespace (REQ-7)**
  - Follow the namespace registration recipe (`shared/AGENTS.md:201-216`):
    1. `shared/locale/types/countrySelector/index.ts` — `CountrySelectorLabels` interface (`placeholder: string`, `noOptionsText: string`, `fieldLabel: string`).
    2. `shared/locale/en/countrySelector/index.ts` + `shared/locale/ar/countrySelector/index.ts` — leaf impls typed against the interface.
    3. `shared/locale/namespaces/countrySelector/countrySelector.namespace.ts` — `defineNamespace<CountrySelectorLabels>("countrySelector.countrySelector", tr => tr.countrySelectorTranslations)`, plus its sibling re-export `shared/locale/namespaces/countrySelector/index.ts` (`export * from "./countrySelector.namespace";`, mirroring `shared/locale/namespaces/wallet/index.ts`).
    4. Register in `shared/locale/namespaces/registry.ts` (import from `@/shared/locale/namespaces/countrySelector` + entry, alphabetical near `Common`/`Dashboard`) and re-export in `shared/locale/namespaces/index.ts`.
    5. Add `countrySelectorTranslations: CountrySelectorLabels` to `Translations` in `shared/locale/types/message.ts`; bundle slices in `shared/locale/en/messages.ts` + `shared/locale/ar/messages.ts`.
    6. Colocated parity test `shared/locale/countrySelector-namespace.parity.test.ts`.
  - Files: the namespace files (`types/countrySelector/index.ts`, `en/countrySelector/index.ts`, `ar/countrySelector/index.ts`, `namespaces/countrySelector/countrySelector.namespace.ts`, `namespaces/countrySelector/index.ts`) + `registry.ts`, `namespaces/index.ts`, `types/message.ts`, `en/messages.ts`, `ar/messages.ts`.
  - Applicable rules: root `AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md`.
  - _Requirements: REQ-7, REQ-9, REQ-11_

- [ ] 4.1.QL **Quality Loop**: Per-file verification
  - Run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` for each of the namespace files + `registry.ts`, `index.ts`, `message.ts`, `en/messages.ts`, `ar/messages.ts` (exit code 0); also `bun tsgo`.

- [ ] 4.1.TE **Test Engineering**: 4-Tier coverage for i18n parity
  - Tier 1: parity test asserts en + ar implement every `CountrySelectorLabels` key; namespace handle resolves.
  - Tier 2: assert ar strings are non-empty and valid Arabic (RTL-safe); assert no key falls back to the en string by accident.
  - Tier 3: enumerate all registry handles and assert no duplicate/absent entry.
  - Tier 4: assert no raw user input is interpolated into labels (no injection surface).
  - Run: `bun run test/scripts/run-test.ts shared/locale/countrySelector-namespace.parity.test.ts`; compile-time check via `bun tsgo`.
  - _Requirements: REQ-9, REQ-7_

- [ ] 4.1.SEC **Security & Tenancy Audit**: labels are static compile-time strings — confirm no dynamic key construction; no cross-layer import in shared locale files.
  - _Requirements: REQ-9, REQ-7_

- [ ] 4.1.SR **Semantic Review**: run the checklist; confirm barrel conventions (`index.ts` = pure relative re-exports, no imports) and no `next-intl`/`shared/messages` references.
  - _Requirements: REQ-9, REQ-7_

- [ ] 4.1.IV **Instruction Verification**: read root `AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md`; validate the 6-step namespace registration recipe.
  - _Requirements: REQ-11_

- [ ] 4.1 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/4.1-country-selector-namespace-outcome.md`; mark 4.1 `[x]` in `tasks.md`.

- [ ] 4.2 **Auth validation keys `countryCodeRequired` / `countryCodeInvalid` (REQ-7)**
  - Add `countryCodeRequired: string` and `countryCodeInvalid: string` to `AuthLabels` in `shared/locale/types/auth/index.ts` (near the existing `phoneRequired:36`, `countryRequired:39`).
  - Implement en at `shared/locale/en/auth/index.ts` (near `:25,28`) and ar at `shared/locale/ar/auth/index.ts` (near `:25,28`). The invalid-message fallback may reuse `errors.validation` where appropriate; keep `countryRequired` for backward compatibility.
  - Files: `shared/locale/types/auth/index.ts`, `shared/locale/en/auth/index.ts`, `shared/locale/ar/auth/index.ts`.
  - Applicable rules: root `AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md`.
  - _Requirements: REQ-7, REQ-9, REQ-11_

- [ ] 4.2.QL **Quality Loop**: Per-file verification
  - Run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` for the three auth locale files (exit code 0); `bun tsgo`.

- [ ] 4.2.TE **Test Engineering**: 4-Tier coverage
  - Tier 1: existing auth parity test covers new keys (extend if needed); assert both locales define the keys.
  - Tier 2: ar strings non-empty / RTL-safe.
  - Tier 3: ensure no duplicate key collision with `countryRequired`.
  - Tier 4: static-string assertion (no interpolation surface).
  - Run the auth parity test via `bun run test/scripts/run-test.ts <auth parity test>`.
  - _Requirements: REQ-9, REQ-7_

- [ ] 4.2.SEC **Security & Tenancy Audit**: static labels only; verify the service can only reference typed keys (compile-time enforced).
  - _Requirements: REQ-9, REQ-7_

- [ ] 4.2.SR **Semantic Review**: run the checklist; confirm `message.ts` bundle wiring remains consistent.
  - _Requirements: REQ-9, REQ-7_

- [ ] 4.2.IV **Instruction Verification**: read `shared/locale/AGENTS.md`, `shared/AGENTS.md`; validate pluralization/interpolation conventions are respected (these keys are plain strings).
  - _Requirements: REQ-11_

- [ ] 4.2 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/4.2-auth-validation-keys-outcome.md`; mark 4.2 `[x]` in `tasks.md`.

---

### Phase 5: Frontend

- [ ] 5.1 **`CountrySelector` component + story (REQ-5)**
  - Create `frontend/components/ui/CountrySelector.tsx`: MUI v9 `Autocomplete` over `COUNTRY_CODES` (D5).
    - Props: `{ id?, name?, label, value: CountryCode | "", onChange(code: string), onBlur?, error?, helperText?, required?, disabled? }`.
    - Option label = localized name (`COUNTRIES[code][locale]`); `flag` emoji rendered in `renderOption` **and** as a bare `startAdornment` in `renderInput`.
    - Merge, don't replace: `renderInput={params => <TextField {...params} slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps?.htmlInput, "aria-label": ... } }} />}` — pattern from `OnboardStudentParentSection.tsx:86-101` / `WalletPickerHeader.tsx:61-72`.
    - Start-adornment pattern: bare icon for `startAdornment` (`RegisterIdentityFields.tsx:41`); `<InputAdornment position="end">` for end adornments (`frontend/components/AuthFormShared.tsx:129`).
    - Read own UI text via `useAppTranslation(CountrySelectorNs)` (import the namespace handle aliased: `import { CountrySelector as CountrySelectorNs } from "@/shared/locale/namespaces/countrySelector"`, since the component itself is named `CountrySelector`) — `placeholder`, `noOptionsText`, `fieldLabel`; no view-specific logic; RTL-safe (`textAlign: "start"`, logical direction).
  - Create `frontend/stories/ui/CountrySelector.stories.tsx`.
  - Files: `frontend/components/ui/CountrySelector.tsx`, `frontend/stories/ui/CountrySelector.stories.tsx`.
  - Applicable rules: `frontend/AGENTS.md`; `.agents/instructions/frontend.instructions.md`.
  - _Requirements: REQ-5, REQ-9, REQ-11_

- [ ] 5.1.QL **Quality Loop**: Per-file verification
  - Run: `bun run scripts/health/sub-loop.ts frontend/components/ui/CountrySelector.tsx --lifecycle duplicates` and the same for the story (exit code 0).

- [ ] 5.1.TE **Test Engineering**: 4-Tier coverage (component)
  - Tier 1: Storybook story renders; open dropdown lists all `COUNTRY_CODES`; selecting fires `onChange` with the ISO code.
  - Tier 2: empty value renders placeholder; `error` + `helperText` render; RTL (`dir="rtl"`) layout does not clip the flag; disabled state non-interactive.
  - Tier 3: rapid open/close + typing fuzz (`Promise.allSettled` interactions) — no crash.
  - Tier 4: assert rendered labels are React-escaped (XSS-safe — no `dangerouslySetInnerHTML`); no prototype-key option injection.
  - Vitest story runner covers the story; run via the project's storybook/vitest command.
  - _Requirements: REQ-9, REQ-5_

- [ ] 5.1.SEC **Security & Tenancy Audit**: XSS-safe label rendering; no user input reaches `dangerouslySetInnerHTML`; no flag URL fetching (emoji only); `aria-invalid` wired when `error`.
  - _Requirements: REQ-9, REQ-5_

- [ ] 5.1.SR **Semantic Review**: run the checklist; confirm no backend imports, no hardcoded colors (theme palette only), MUI v9 `sx` for style props, `*Outlined` icon naming.
  - _Requirements: REQ-9, REQ-5_

- [ ] 5.1.IV **Instruction Verification**: read `frontend/AGENTS.md` + `.agents/instructions/frontend.instructions.md`; validate MUI v9 style-prop and icon-naming rules and i18n client usage (`useAppTranslation`).
  - _Requirements: REQ-11_

- [ ] 5.1 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/5.1-country-selector-component-outcome.md`; mark 5.1 `[x]` in `tasks.md`.

- [ ] 5.2 **Register form integration (REQ-6)**
  - `frontend/views/auth/register/useRegisterFormState.ts`: add a `country` controller via `useController`/`Controller` (RHF `^7.88.0`; `@hookform/resolvers` is NOT installed and MUST NOT be added, D10); `useForm<RegisterFormValues>` defaultValues keep `country: ""` (`useRegisterFormState.ts:35`).
  - `frontend/views/auth/register/RegisterIdentityFields.tsx`: REPLACE the free-text country `TextField` (`:86-101`) with `<CountrySelector>` bound to the controller; inline validation uses `countryCodeSchema.safeParse` on the raw value (no zod resolver); keep the `error`/`helperText` projection from `frontend/lib/mutationFieldErrors.ts` (`projectMutationFieldErrors`/`applyProjectedFieldErrors`).
  - `frontend/views/auth/register/registerFormUtils.ts`: `RegisterFormValues.country` stays `string` (holds the ISO code); add a `countryFromValue` guard that pins the raw value.
  - Update `frontend/lib/mutationFieldErrors.test.ts` (confirm the known-field-path list `REGISTER_FIELD_PATHS` at `frontend/views/auth/register/registerFormUtils.ts:20-31` already includes `country`, and extend the `REUSE_SET` audit at `:238-249`) to cover the new `countryCodeRequired` / `countryCodeInvalid` codes on field path `country`.
  - Files: `frontend/views/auth/register/{RegisterIdentityFields.tsx,registerFormUtils.ts,useRegisterFormState.ts}`, `frontend/lib/mutationFieldErrors.test.ts`.
  - Applicable rules: `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md`, `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-6, REQ-5, REQ-9, REQ-11_

- [ ] 5.2.QL **Quality Loop**: Per-file verification
  - Run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` for each modified file (exit code 0).

- [ ] 5.2.TE **Test Engineering**: 4-Tier coverage for the register form
  - Tier 1: `RegisterIdentityFields` renders `CountrySelector`; selecting sets the form `country` value to the ISO code; empty submit shows `t.countryCodeRequired`; malformed value (via injected state) shows `t.countryCodeInvalid`.
  - Tier 2: `countryFromValue` guard handles `""`, `null`, `undefined`, lowercase input.
  - Tier 3: rapid selection changes + concurrent submit attempts — no stale-state race.
  - Tier 4: injected overlong/unicode value cannot bypass the shared-schema check; `mutationFieldErrors.test.ts` asserts the new field-path mapping.
  - Run: `bun run test/scripts/run-test.ts frontend/lib/mutationFieldErrors.test.ts` and the register view tests (if present; otherwise the story/vitest layer).
  - _Requirements: REQ-9, REQ-6_

- [ ] 5.2.SEC **Security & Tenancy Audit**: verify client validation is advisory only — the server re-validates (defense in depth); confirm no client-supplied value is trusted without the shared schema; confirm no new dependency was added.
  - _Requirements: REQ-9, REQ-6_

- [ ] 5.2.SR **Semantic Review**: run the checklist; confirm no backend imports, the RHF controller is wired without a resolver, and the projection field path remains `country`.
  - _Requirements: REQ-9, REQ-6_

- [ ] 5.2.IV **Instruction Verification**: read `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md`, `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-11_

- [ ] 5.2 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/5.2-register-integration-outcome.md`; mark 5.2 `[x]` in `tasks.md`.

---

### Phase 6: Documentation & Knowledge Propagation

- [ ] 6.1 **Create `docs/domain/graphql-scalars.md` (REQ-10)**
  - Read all outcome files in `ai/plans/issue_230/no_country_selector_component/outcome/` and synthesize.
  - Create `docs/domain/graphql-scalars.md` documenting: (a) the scalar-registration recipe (register in `scalar.pothos.ts` → add to the builder `Scalars` slot → map in `codegen.ts` → `bun run generate:gqlSchema` + `bun codegen` → pin in `schema-surface.test.ts`); (b) the generated-country-data pattern (`scripts/country-data-generator/` → committed `shared/constants/countries.ts` with AUTO-GENERATED header).
  - Follow the docs file structure: Why → Pattern → Rules → Anti-patterns → Rollout Summary → Related Documents. Do NOT create or update any AGENTS.md.
  - Files: `docs/domain/graphql-scalars.md`.
  - Applicable rules: root `AGENTS.md` ("NEVER create summary markdown files" exception: structural docs).
  - _Requirements: REQ-10, REQ-11_

- [ ] 6.1.QL **Quality Loop**: Per-file verification on `docs/domain/graphql-scalars.md` (markdown lint via biome where applicable; exit code 0).
- [ ] 6.1.TE **Test Engineering**: verify all `path:line`/symbol citations in the doc against the real files.
  - _Requirements: REQ-9, REQ-10_

- [ ] 6.1.SEC **Security & Tenancy Audit**: doc contains no secrets, tokens, or real credentials; no instructions encouraging unsafe patterns.
  - _Requirements: REQ-9, REQ-10_

- [ ] 6.1.SR **Semantic Review**: confirm the doc does not duplicate/contradict `docs/billing/paymob-gateway.md` conventions and links only to real files.
  - _Requirements: REQ-9, REQ-10_

- [ ] 6.1.IV **Instruction Verification**: read root `AGENTS.md` (Important References) and confirm the doc path/name convention.
  - _Requirements: REQ-11_

- [ ] 6.1 outcome: write `ai/plans/issue_230/no_country_selector_component/outcome/6.1-graphql-scalars-doc-outcome.md`; mark 6.1 `[x]` in `tasks.md`.

---

### Phase 7: Post-Implementation Review Wave & Outcome Synthesis

- [ ] 7.1 **Global quality gate + deferred-items enforcement**
  - Run:
    ```bash
    bun quality-gate
    bun run check:unused
    ```
  - Deferred Items Enforcement (BLOCKING):
    ```bash
    grep -c "❌\|⚠️" ai/plans/issue_230/no_country_selector_component/deferred-items.md
    ```
    Expected: `0`. If >0, resolve or create explicit target tasks before completing.
  - Compare current errors vs `/tmp/baseline-*.txt` (from Phase 0); document any new errors.
  - _Requirements: REQ-9, REQ-11_

- [ ] 7.2 **Review wave (parallel subagents, per lifecycle stage)**
  - Dispatch review subagents in parallel over the changed surfaces: backend (services/repo/types/pothos), shared (constants/lib/locale), frontend (component/views/stories), config (schema/migration/codegen).
  - Aggregate findings; dispatch per-file fix subagents using the layer AGENTS.md + `.agents/instructions/*` as guardrails.
  - Verify every fixed file: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0).
  - Re-review until zero findings.
  - Write outcome: `ai/plans/issue_230/no_country_selector_component/outcome/7-review-wave-outcome.md`.
  - _Requirements: REQ-11, REQ-9_

- [ ] 7.3 **Outcome synthesis & plan close-out**
  - Re-read all `outcome/*.md`; write the consolidated `ai/plans/issue_230/no_country_selector_component/outcome/7.3-synthesis-outcome.md`.
  - Confirm the "No Journey Test" ruling is recorded (single-actor feature — no `test/workflows/` test).
  - Confirm every REQ-1..REQ-11 checkbox is `[x]` below; mark 7.3 `[x]`.
  - _Requirements: REQ-11_

---

## Requirements Coverage Checklist (REQ-1..REQ-11)

- [ ] REQ-1 Country dataset (generated, committed) — covered by 1.1
- [ ] REQ-2 Shared zod schema & guards — covered by 1.2
- [ ] REQ-3 `CountryCode` GraphQL scalar — covered by 2.1, 3.2
- [ ] REQ-4 Backend validation — covered by 3.2, 3.3, 3.4
- [ ] REQ-5 `CountrySelector` component — covered by 5.1, 5.2
- [ ] REQ-6 Register form integration — covered by 5.2
- [ ] REQ-7 i18n labels (ar/en) — covered by 4.1, 4.2
- [ ] REQ-8 Persistence — covered by 3.1, 3.3, 3.4
- [ ] REQ-9 Test coverage — covered by every `.TE` subtask
- [ ] REQ-10 Documentation & knowledge propagation — covered by 6.1
- [ ] REQ-11 Outcome knowledge base & progress tracking — covered by 0.1 + every task's outcome file + checkbox tracking

### REQ-11 progress-tracking note

Progress tracking for this feature is the checkbox state in **this** `tasks.md`. Every implementation subtask ends with an `X.Y outcome` line that (a) writes `outcome/<task-id>-outcome.md` and (b) flips the `[x]`. Task 0.1 seeds `deferred-items.md`; task 7.3 confirms every REQ checkbox above is closed and that all `outcome/` files were read before execution (protocol item 1).

---

## Task Execution Checklist (per task)

### Before Starting
- [ ] Read ALL files in `ai/plans/issue_230/no_country_selector_component/outcome/` (REQ-11)
- [ ] Requirements (`specs.md`) and design (`plan.md`) reviewed
- [ ] Dependencies available; `git status` clean of unrelated changes
- [ ] Task scope + acceptance criteria clear

### During Implementation
- [ ] Code follows `AGENTS.md` + `.agents/instructions/*` (deep imports; no barrels; i18n via typed handles)
- [ ] Tests written alongside implementation (4-Tier)
- [ ] Error handling + edge cases handled
- [ ] No `console.*`; use the layer logger

### Before Completion
- [ ] Acceptance criteria met
- [ ] Tests pass; coverage adequate
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 for every modified file
- [ ] Instruction Verification read + validated against every listed AGENTS.md/instructions file

### Task Completion
- [ ] Feature works per requirements
- [ ] No regressions
- [ ] Outcome file written to `ai/plans/issue_230/no_country_selector_component/outcome/`
- [ ] Checkbox marked `[x]` in `tasks.md`

---

## Quality Gates

- [ ] `bun quality-gate` passes (tsgo → oxlint → biome → lint → duplicates)
- [ ] `bun run check:unused` clean (no unused generated exports/deps)
- [ ] GraphQL regenerated cleanly (`bun run generate:gqlSchema` + `bun codegen` produced no unexpected diffs)
- [ ] Migration generated + applied (`bun drizzle-kit generate` → `bun db migrate`); no `CREATE INDEX CONCURRENTLY`
- [ ] `deferred-items.md` has zero unresolved ❌/⚠️ items
- [ ] No new npm dependency added (D10)

---

[← Deferred Items](deferred-items.md) | [Plan Directory](.)
