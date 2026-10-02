# Round R10 Review Outcome — docs + final full-diff sweep lens

- **Reviewer:** R10 (independent, read-only)
- **Branch tip:** `d04e19dd` (`feat/no_country_selector_component`), diff base `5a8369fe`
- **Scope:** `docs/domain/graphql-scalars.md` accuracy + final coherence sweep of the full 73-file diff (`git diff 5a8369fe..feat/no_country_selector_component --stat`: 73 files, +9 739 / −89) and plan-artifact hygiene.
- **Verdict:** ✅ **PASS — doc accurate, no blockers.** 1 actionable minor hygiene finding (F1); 2 non-blocking observations; no secrets; deferred ledger clean.

---

## 1. Doc accuracy — `docs/domain/graphql-scalars.md` (committed `f50b8776`, 198 lines)

**ACCURATE.** Every cited path exists at tip (25/25 verified with ls) and every recipe step matches the actual final implementation:

| Doc claim (line) | Tip evidence |
|---|---|
| Register once in `scalar.pothos.ts`; import + `addScalarType` snippet (29–31) | Exact lines present; "Registered scalars" docblock extended with `CountryCode` semantics |
| Duplicate registration = runtime error (33) | Matches `scalar.pothos.ts` docblock ("has already been declared") |
| `Scalars` slot member in `builder.ts` (38–42) | `builder.ts:86` — `CountryCode: { Input: string; Output: string };` verbatim |
| By-name reference via `userRegistrationInputFields` (44–45) | `userFieldHelpers.ts:105` — `country: t.field({ type: "CountryCode", required: true })` |
| `codegen.ts` map + `strictScalars: true` + `IanaTimezone` alt-shape (48–57) | `codegen.ts:21` `CountryCode: "string"`, `:18` `strictScalars: true`, `:29` `IanaTimezone: "@/shared/constants/iana-timezone.enum#IanaTimezone"` (`shared/constants/iana-timezone.enum.ts` exists) |
| `bun run generate:gqlSchema` → `schema.graphql`; `bun codegen` → `gql/graphql.ts` (59–64) | `package.json:70–71`; generator outputs to `frontend/graphql/generated/schema.graphql` |
| Surface pins (71–76): additions block, `committedSdl` byte-sync, `scalar CountryCode`, scalar set `["CountryCode","DateTime"]` | `schema-surface.test.ts:1352` (`"CountryCode"` in additions equality), `:3049` (`toBe(freshlyPrinted)`), `:3056`; `sdl-static-assertions.test.ts:1140` `toEqual(["CountryCode", "DateTime"])` + "exactly TWO scalar declaration lines" |
| Registry side-effect import "between the object barrel and the enum registry" (80–83) | `gqlSchema.definitions.ts:14–16` — `pothos` barrel → `scalar.pothos` → `enum.pothos` |
| Two-layer validation table (90–101); `countryCodeSchema` normalize→membership; `isValidCountryCode` / `countryCodeShapeSchema` contracts (105–108) | `shared/lib/country-code.ts:57,69,78–81,89` — `z.string().transform(normalizeCountryCode).pipe(z.enum(COUNTRY_CODES))`; module docblock matches |
| Service re-validation + error codes (102–104) | `registration.service.ts:232–234` and `user-management.helpers.ts:252–256` — `countryCodeSchema.safeParse`, `COUNTRY_CODE_REQUIRED`/`COUNTRY_CODE_INVALID` on `country` |
| Generated-country-data table (114–121): cli guard + remediation, `paths.ts` pin, `EXCLUDED_COUNTRY_CODES` = `EU EZ QO UN XA XB XK ZZ IL` as `ReadonlySet`, `codeToFlag` (A → U+1F1E6), `buildSharedCountriesFile`, AUTO-GENERATED header, curation per-code comments, `EXCLUDED_TERRITORY_CODES` precedent | All verified verbatim in `scripts/country-data-generator/{cli,cldr-data,paths,file-builders}.ts`; header string exact in `shared/constants/countries.ts:1` |
| Wire fields `RegisterUserInput.country` / `AdminCreateUserInput.country` = `CountryCode!` (182–184) | `frontend/graphql/generated/schema.graphql:238,1789` (`country: CountryCode!`), `:762` (`scalar CountryCode`) |
| Deep-import-only pin (125–127) | Barrel `shared/constants/index.ts` has no `countries` export; `countries.test.ts:126` "dataset is deep-import only" |
| `max-lines` exemption block (128–131) | `oxlint.config.mts:108–117` — `shared/constants/countries.ts` added to the same override block as `shared/locale/**` + `iana-timezone*` |
| Related Documents (191–198) | `AGENTS.md` has §"Custom Scalar Registration Pattern"; `docs/quality/linting-rules.md`, `docs/DATABASE_MIGRATIONS.md`, `scripts/iana-timezone-generator/` all exist |

- **Structure** ✅ Why (§8) → Pattern (§18) → Rules (§140) → Anti-patterns (§157) → Rollout Summary (§176) → Related Documents (§191).
- **Secrets** ✅ none (doc scanned; no tokens/keys/credentials).

## 2. Comment hygiene sweep — all changed `*.ts`/`*.tsx` added lines

Exact checklist grep produced **1 hit**:

- **F1 (minor, hygiene):** `backend/graphql/test/schema-surface.test.ts` — added comment *"the REQ-3 surface pin — the scalar rides the builder registry…"* references the plan's requirement numbering in a source (test) file. Reword to a plan-neutral phrase (e.g. "the schema-surface pin") before merge. Sole hit; nothing in product code, nothing in other extensions (`.sql`/`.mts`/`.md` outside plans/docs clean).

## 3. Leftover markers (TODO/FIXME/HACK/XXX/console.log|debug)

- **No** TODO/FIXME/HACK/XXX/debugger/focused-test (`.only`/`.skip`) additions anywhere in the 73-file diff.
- **F2 (observation, non-blocking):** two `console.log` lines added in `scripts/country-data-generator/cli.ts`. Introduced by the plan, but byte-for-byte the established `scripts/iana-timezone-generator/cli.ts` precedent, and `scripts/**/*.ts` sits in the **pre-existing** `no-console: off` oxlint override (`oxlint.config.mts:121–135` — unchanged by this plan). Consistent; no action required.

## 4. Cross-file naming coherence

- SQL `country_code` (`migration.sql`: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country_code" varchar(2)`) → drizzle `countryCode: varchar("country_code", …)` → repo alias `country_code AS "countryCode"` → row type `readonly countryCode: string | null` → GraphQL `CountryCode` scalar on wire field `country` → TS `CountryCode` type from generated dataset. Each layer uses its convention; no leakage. ✅
- Orphaned-export spot-checks: `normalizeCountryCode` (backend service + frontend form + tests ✅), `isValidCountryCode` (service + form + stories ✅), `codeToFlag` (used by `buildCountryDataset`, re-exported via generator barrel consumed by `cli.ts` ✅). `countryCodeShapeSchema` (**F3, observation**): consumed only by its colocated test — but it is explicitly spec-mandated (specs.md REQ-2, tasks.md 1.2) and documented as a deliberate shape-only escape hatch in both the module docblock and the domain doc; `check:unused` (knip, hint-treating) is green. Documented intent, not dead code.

## 5. REQ coverage trace (informational — for orchestrator close-out, not a finding)

`tasks.md` "Requirements Coverage Checklist" (committed tip): **unchecked** = REQ-1, REQ-2, REQ-3, REQ-4, REQ-7, REQ-8, REQ-9, REQ-10, REQ-11. Checked = REQ-5, REQ-6. (The uncommitted working tree is flipping Phase-0/1 task boxes; the REQ rows are all still open and must be flipped at 7.3 close-out.)

## 6. Deferred ledger

**Clean.** Zero `❌` / `⚠️` / `🔄` rows in the tables (all hits are legend/instruction prose, which is excluded): D-1…D-7 are `⏭️ Out of scope`; the single in-plan row D-IP-1 (tsgo regressions from the `country_code` column) is `✅ Done` with outcome-file + verification references.

## 7. Plan-artifact hygiene

- `outcome/` complete and consistently named (0-baseline → 7.2 + R1–R7 reviews + post-implementation review); `deferred-items.md` updated coherently; no secrets in plan dir; no broken cross-references observed.
- Note: working tree has two uncommitted in-flight edits (tasks.md checkbox flips; `frontend/graphql/test/admin/admin-users.integration.test.ts` adapting the multi-field error payload to the `CountryCode` wire gate + adding an empty-country wire-gate case). They are consistent with the committed design but are **not part of the reviewed tip** — ensure they are committed before close-out.

## Sign-off

| Lens item | Result |
|---|---|
| Doc accuracy (paths/symbols/recipes/patterns/secrets/structure) | ✅ PASS (25/25 paths, all steps match) |
| Comment hygiene sweep | ⚠️ F1 (1 hit — REQ-3 in test comment) |
| Leftover markers | ✅ PASS (F2 observation: precedent-consistent generator `console.log`) |
| Naming coherence / orphan exports | ✅ PASS (F3 observation: documented escape hatch) |
| REQ coverage | ℹ️ 9 of 11 unchecked (close-out duty) |
| Deferred ledger | ✅ PASS (no open rows) |
| Plan-artifact hygiene | ✅ PASS |

**R10-FINDINGS: 1** (F1 — actionable; F2/F3 informational). No blockers to merge once F1 is reworded and the uncommitted working-tree edits are committed.
