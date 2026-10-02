# GraphQL Custom Scalars & Generated Country Data

Reference for the two supporting patterns behind structured country input: the single-registry
Pothos scalar-registration recipe, and the committed, generator-produced country dataset. Read
`backend/graphql/pothos/AGENTS.md` ("Custom Scalar Registration Pattern") together with this file —
the AGENTS.md states the rule, this document shows the full recipe and the reasoning.

## Why

A custom GraphQL scalar is a wire contract, not just a TypeScript type: it lives in four places at
once (runtime registration, builder typing, frontend codegen map, committed SDL) and any drift
between them surfaces as a runtime error, a compile error, a hard codegen failure, or a failing
surface pin — in that order of subtlety. Similarly, a curated reference dataset (countries) must be
regenerable and verifiably in sync with its generator, or hand-edits and stale data accumulate
silently. Both patterns exist so that a single change — one `addScalarType` call, one
`bun run generate:countries` — propagates deterministically to every tier.

## Pattern

### Scalar registration recipe

All steps happen in one change. The running example is the `CountryCode` scalar.

1. **Register once** in `backend/graphql/pothos/shared/scalar.pothos.ts` — the only place a scalar
   is ever registered. Add the resolver to the existing `graphql-scalars` import and one
   `addScalarType` call:

   ```ts
   import { CountryCodeResolver, DateTimeResolver } from "graphql-scalars";
   gqlSchemaBuilder.addScalarType("CountryCode", CountryCodeResolver, {});
   ```

   Registering the same name twice is a **runtime error** (`"has already been declared"`); both
   generators build the full schema from this registry, so a duplicate also fails
   `bun run generate:gqlSchema`. Extend the file's "Registered scalars" docblock with the new
   entry's semantics.

2. **Add the `Scalars` slot member** on `gqlSchemaBuilder` in `backend/graphql/pothos/builder.ts`:

   ```ts
   CountryCode: { Input: string; Output: string };
   ```

   Domain Pothos files then reference the scalar **by name** (`t.field({ type: "CountryCode" })`,
   e.g. `userRegistrationInputFields` in `backend/graphql/pothos/shared/userFieldHelpers.ts`).
   A missing slot member makes any such reference a compile error under `bun tsgo`.

3. **Map the scalar** in `codegen.ts` (`scalars` block):

   ```ts
   CountryCode: "string",
   ```

   `strictScalars: true` is set in the same file — a scalar that reaches the SDL without a map
   entry is a **hard `bun codegen` failure**, not a warning. The `IanaTimezone` entry shows the
   alternative shape: mapping a scalar to a typed generated constant
   (`@/shared/constants/iana-timezone.enum#IanaTimezone`) instead of a primitive.

4. **Regenerate both artifacts**:

   ```bash
   bun run generate:gqlSchema   # reprints frontend/graphql/generated/schema.graphql from the registry
   bun codegen                  # regenerates frontend/graphql/generated/gql/graphql.ts
   ```

   The SDL diff should be surgical (the `scalar CountryCode` declaration plus its description, and
   the retyped input fields). Note: two scalars mapping to the same TS type can produce a
   byte-identical `graphql.ts` — verify wire changes via `schema.graphql` and coercion tests, not
   via the operations artifact.

5. **Pin the surface** in `backend/graphql/test/schema-surface.test.ts`: the whole-schema
   named-type `additions` equality block must include `"CountryCode"`, and the codegen-sync test
   asserts `committedSdl` contains `scalar CountryCode` (that suite also asserts the committed SDL
   is byte-identical to a freshly printed one, which is what makes step 4 non-optional).
   `backend/graphql/test/sdl-static-assertions.test.ts` pins the artifact's complete custom-scalar
   set (`["CountryCode", "DateTime"]` — exactly two `^scalar ` declarations).

### Two sides in sync

The invariant stated in both `scalar.pothos.ts` and `builder.ts`: the **runtime registration**
(`addScalarType`) and the **builder `Scalars` typing** must change together. The registry module is
loaded purely for side effects (`backend/graphql/gqlSchema.definitions.ts` imports it between the
object barrel and the enum registry), so nothing else wires a new scalar up.

### Wire integrity vs. dataset membership (two validation layers)

The `graphql-scalars` resolver and the shared zod schema answer different questions and are
deliberately complementary — do not collapse them:

| Layer | Authority | Checks |
|---|---|---|
| Wire | `CountryCodeResolver` (`graphql-scalars`) | Full hardcoded ISO 3166-1 alpha-2 list, anchored **case-insensitive** regex; returns the value **unchanged** (no trim, no upper-casing) |
| Service / form | `countryCodeSchema` (`shared/lib/country-code.ts`) | Normalizes (trim + uppercase) **then** requires membership in the committed `COUNTRY_CODES` dataset |

Consequences that matter:

- `"eg"` passes the wire **unchanged** (case-insensitive accept, no normalization) and is
  normalized to `"EG"` by `countryCodeSchema`; `" EG "` is rejected at the wire (the anchored
  regex does not trim) yet parses to `"EG"` through `countryCodeSchema`; `"XX"` / `"AA"` are
  rejected at the wire; codes on the library's ISO list but curated out of our dataset (e.g.
  `"IL"`, `"XK"`) pass the wire and are rejected only by the service membership check.
- Services therefore re-validate. `backend/services/auth/registration.service.ts` and
  `backend/services/admin/user-management.helpers.ts` both run `countryCodeSchema.safeParse(...)`
  and emit `COUNTRY_CODE_REQUIRED` / `COUNTRY_CODE_INVALID` on the `country` field path.
- `isValidCountryCode` is the strict, normalization-free type guard (`value is CountryCode`);
  `countryCodeShapeSchema` is the deliberate shape-only escape hatch (any-case, no membership, no
  normalization). Its contract and rationale are documented in the `shared/lib/country-code.ts`
  module docblock.

### Generated country data

The committed dataset and its generator follow the `scripts/iana-timezone-generator/` precedent:

| Piece | Location | Role |
|---|---|---|
| Entry point | `scripts/country-data-generator/cli.ts` (`bun run generate:countries`) | Guards missing CLDR data (remediation: `bun add -d cldr-core cldr-dates-full cldr-localenames-full`), loads both locales, writes the output |
| CLDR loading + curation | `scripts/country-data-generator/cldr-data.ts` | Reads `node_modules/cldr-localenames-full/main/{ar,en}/territories.json` (paths pinned in `scripts/country-data-generator/paths.ts`); `EXCLUDED_COUNTRY_CODES` curation set; `codeToFlag()`; `buildCountryDataset()` |
| File emission | `scripts/country-data-generator/file-builders.ts` | `buildSharedCountriesFile()` emits the AUTO-GENERATED header, `COUNTRY_CODES ... as const`, the derived union `type CountryCode = (typeof COUNTRY_CODES)[number]`, and `COUNTRIES: Record<CountryCode, { en, ar, flag }>` |
| Committed artifact | `shared/constants/countries.ts` | Header: `// AUTO-GENERATED by scripts/country-data-generator — do not edit manually.` + the regeneration command |
| Flag derivation | `codeToFlag()` | Regional-indicator codepoint math: `A → U+1F1E6`, one symbol per letter — no flag images, no flag npm packages |
| Curation | `EXCLUDED_COUNTRY_CODES` | Explicit `ReadonlySet` (`EU EZ QO UN XA XB XK ZZ IL`), documented per code; mirrors `EXCLUDED_TERRITORY_CODES` in `scripts/iana-timezone-generator/territories.ts` |

Key properties:

- **Consumed by deep import only** — `@/shared/constants/countries`. The `@/shared/constants`
  barrel (`shared/constants/index.ts`) deliberately excludes generated data files;
  `shared/constants/countries.test.ts` pins this ("dataset is deep-import only").
- **`max-lines` exemption** — the repo-wide oxlint `max-lines` rule is switched off for generated
  locale-data constants in `oxlint.config.mts` (`shared/constants/countries.ts` sits in the same
  override block as `shared/locale/**` and the `iana-timezone*` files; see
  `docs/quality/linting-rules.md` for the tiered line-count policy).
- **Idempotent regeneration** — running `bun run generate:countries` twice must produce a
  byte-identical file (verify with a sha256 before/after or `git diff --no-changes`). A dirty diff
  means the generator or the curation changed: commit the regenerated artifact together with the
  generator change.
- **Validation happens against the dataset, not the shape** — `z.enum(COUNTRY_CODES)` in
  `countryCodeSchema` *is* the membership check; curation decisions (which codes exist) live only
  in the generator's `EXCLUDED_COUNTRY_CODES`, so the dataset stays the single source of truth.

## Rules

- Register each custom scalar **once**, in `backend/graphql/pothos/shared/scalar.pothos.ts`; domain
  Pothos files reference it by name only.
- Keep all four registration surfaces in one change: `addScalarType` call, `Scalars` slot member,
  `codegen.ts` map entry, regenerated SDL + codegen artifacts.
- Update the surface pins (`schema-surface.test.ts` additions array, `sdl-static-assertions.test.ts`
  scalar set) in the same change — a stale pin asserts a false contract.
- Re-run `bun run generate:gqlSchema` and `bun codegen` after every scalar or schema-shape change
  and commit the generated artifacts.
- Never treat the wire scalar as a membership gate: persist only values that passed
  `countryCodeSchema` (normalized, dataset-member).
- Never edit `shared/constants/countries.ts` by hand; change the generator and regenerate.
- Keep the country dataset out of the `@/shared/constants` barrel; import it deeply.
- Extend the curation set (`EXCLUDED_COUNTRY_CODES`) — with a per-code rationale comment — instead
  of adding ad-hoc filters in `buildCountryDataset`.

## Anti-patterns

- **Re-registering a scalar in a domain `*.pothos.ts` file** — runtime error ("has already been
  declared"); the registry file is the single registration point.
- **Adding the `addScalarType` call without the `Scalars` slot member** (or vice versa) — the two
  sides drift; `type: "CountryCode"` references stop compiling or the runtime type is untyped.
- **Forgetting the `codegen.ts` map entry** — hard `bun codegen` failure under
  `strictScalars: true`.
- **Trusting the scalar's regex as a membership check** — it is case-insensitive, does not trim,
  returns the value unchanged, and covers codes the dataset curates out; only
  `countryCodeSchema` + the service gate decide what may be persisted.
- **Normalizing inside `isValidCountryCode`** — would make the `value is CountryCode` narrowing
  unsound; normalization belongs to `countryCodeSchema` / `normalizeCountryCode`.
- **Hand-editing the generated dataset** (or adding it to the barrel, or shipping flag images /
  flag packages) — the AUTO-GENERATED header, the deep-import pin, and the regional-indicator
  derivation exist precisely to prevent this.
- **Regenerating without committing, or committing without regenerating** — the committed SDL and
  dataset must always match what their generators produce (byte-sync is test-enforced for the SDL).

## Rollout Summary

The pattern is exercised end-to-end by the country-code feature:

- Scalars `DateTime` and `CountryCode` are registered in `scalar.pothos.ts`, typed on the builder,
  mapped in `codegen.ts`, and pinned in the surface tests.
- `RegisterUserInput.country` and `AdminCreateUserInput.country` are the two wire fields typed
  `CountryCode!` (via the shared `userRegistrationInputFields` helper); the focused suite
  `backend/graphql/test/country-code-scalar.test.ts` pins the exact field list and the coercion
  boundary (accept/reject cases, value-unchanged semantics).
- `shared/constants/countries.ts` is the committed generated dataset (codes + ar/en names + flag
  emoji); `shared/lib/country-code.ts` is the shared validation authority on top of it; backend
  services and the register form both consume the same schema, so client and server accept and
  reject identically.

## Related Documents

- `backend/graphql/pothos/AGENTS.md` — scalar + enum registration rules for the Pothos layer
- `shared/lib/country-code.ts` — the shared validation module (docblock documents the two-tier contract)
- `shared/constants/countries.ts` / `scripts/country-data-generator/` — generated dataset and generator
- `scripts/iana-timezone-generator/` — the original generated-locale-data precedent
- `docs/quality/linting-rules.md` — tiered line-count rules and the generated-data exemption
- `docs/DATABASE_MIGRATIONS.md` — for schema changes that accompany new persisted scalar values
