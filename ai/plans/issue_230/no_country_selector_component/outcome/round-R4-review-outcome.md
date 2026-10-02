# Round R4 Review — GraphQL-Surface Lens

- **Reviewer**: R4 (independent, graphql-surface lens)
- **Branch**: `feat/no_country_selector_component` (tip `d04e19dd`)
- **Diff base**: `5a8369fe..feat/no_country_selector_component`
- **Scope**: `backend/graphql/pothos/shared/scalar.pothos.ts`, `backend/graphql/pothos/builder.ts`, `backend/graphql/pothos/shared/userFieldHelpers.ts`, `codegen.ts`, `frontend/graphql/generated/schema.graphql`, `backend/graphql/test/{country-code-scalar.test.ts, country-input-retype.wire.test.ts, schema-surface.test.ts, sdl-static-assertions.test.ts}`
- **Method**: full read of all scoped diffs + the three touched Pothos source files at tip, `backend/graphql/AGENTS.md` + `backend/graphql/pothos/AGENTS.md`, committed-SDL and generated-output greps at the branch tip, single-registration scan, and independent re-run of all four in-scope test suites via the mandated runner.

## Lens Checklist Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Three-way scalar sync | **PASS** | Registration `gqlSchemaBuilder.addScalarType("CountryCode", CountryCodeResolver, {})` appears EXACTLY once repo-wide (`shared/scalar.pothos.ts:42`); builder `Scalars` slot gains `CountryCode: { Input: string; Output: string }` (`builder.ts`, only entry added); `codegen.ts` gains `CountryCode: "string"` in the strictScalars map (required — without it strictScalars would now fail). `graphql-scalars@^2.0.0` typings declare `GraphQLCountryCode: GraphQLScalarType<string, string>` — slot matches the resolver's real type exactly. Only other Pothos files naming `CountryCode` are `builder.ts` (typing) and `userFieldHelpers.ts` (by-NAME reference) — no re-registration, no local type definitions added anywhere |
| 2 | SDL truth | **PASS** | Committed `frontend/graphql/generated/schema.graphql` greps at tip: `scalar CountryCode` (line 762, with the ISO 3166-1 alpha-2 description) + `country: CountryCode!` on BOTH `RegisterUserInput` (1789) and `AdminCreateUserInput` (238); `country: String` (nullable, unchanged) on `AdminUserFiltersInput` + `AdminUpdateUserInput`. Diff touches only the 2 retypes + the 3-line scalar block — no collateral SDL drift |
| 3 | gql/graphql.ts absence correctness | **PASS** | File absent from the 73-file diff. Correct: codegen uses `[typescript-operations, typed-document-node]` with inline scalar mapping (no `Scalars` interface is emitted — verified zero `Scalars` tokens in the file), and the ONLY CountryCode-typed schema fields are the two input `country` fields (no document selects a CountryCode OUTPUT field). `typescript-operations` default-maps `String` → `string`; the new map maps `CountryCode` → `"string"` — identical emitted text. Verified the committed shapes: `RegisterUserInput` and `AdminCreateUserInput` both still read `country: string;` with no `unknown`/`any` fallback → codegen is a proven no-op; the committed file is current (no stale error) |
| 4 | Wire + surface tests | **PASS** | `country-input-retype.wire.test.ts` uses `setupTestServerLifecycle` + `testClient`: valid `EG` registers end-to-end (row created + hard-deleted in `afterAll` with zero-residue check); `XX` and legacy `Egypt` rejected at variable coercion (`BAD_USER_INPUT`, "Value is not a valid country code", pre-resolver); missing country rejected by the non-null contract; extra-key smuggling (`bogusSmuggledField`) rejected by input-object coercion; `adminCreateUser` invalid code dies at coercion BEFORE the role scope, and a valid code from an anonymous caller answers `UNAUTHORIZED` (coercion/scope ordering pinned both ways). Filter/update backward-compat is pinned at Tier 1 (built schema + committed SDL: not NonNull, named type `String`) — see INFO finding. `country-code-scalar.test.ts` pins the exact field surface: `countryCodeFieldPaths()` must equal `["AdminCreateUserInput.country", "RegisterUserInput.country"]` — no accidental widening possible |
| 5 | Scalar registry discipline | **PASS** | Per `pothos/AGENTS.md`: registered ONCE in `shared/scalar.pothos.ts` via `addScalarType`; the file's "Registered scalars" header list updated (DateTime + CountryCode, with backing-resolver and codegen-mapping documentation); both consumers (`register-input.pothos.ts`, `admin/admin-user.pothos.ts:377`) get the field from the ONE shared helper `userRegistrationInputFields` — single source, no domain-file registration. No local type definitions introduced in any Pothos file |
| 6 | Input helper / no type drift | **PASS** | `country: t.field({ type: "CountryCode", required: true })` replaces `t.string({ required: true })` — with the builder slot `{ Input: string; Output: string }`, `input.country` remains typed `string`, identical to the pre-retype `t.string()` typing. Resolver pass-through unchanged: `auth.mutation.ts` `country: input.country` and `admin-users.mutation.ts` `country: input.country` — service-side `countryCodeSchema` validation (3.3/3.4) stays the normalization/curated-set gate, matching the scalar's documented no-normalization contract |

## Independent Test Re-Runs (mandated runner, branch tip)

| Suite | Result |
|-------|--------|
| `country-code-scalar.test.ts` | 10 pass / 0 fail (48 expects) |
| `sdl-static-assertions.test.ts` | 58 pass / 0 fail (314 expects) — scalar set pinned to EXACTLY `["CountryCode", "DateTime"]`, exactly two `^scalar` lines |
| `schema-surface.test.ts` | 96 pass / 0 fail (630 expects) — "CountryCode" pinned in the named-type delta; committed-SDL `scalar CountryCode` belt-and-braces pin added |
| `country-input-retype.wire.test.ts` | 11 pass / 0 fail (49 expects) — live server+DB run |

`sdl-static-assertions.test.ts` was correctly UPDATED, not just extended: the stale "DateTime is the artifact's ONLY custom scalar" pin (now 2 scalar lines) would otherwise have been a false failure; the header docblock was updated in step.

## Findings

| Severity | Location | Finding |
|----------|----------|---------|
| INFO | `backend/graphql/test/country-input-retype.wire.test.ts:118-123` | The filter/update backward-compat pin is type-level (built-schema + committed-SDL assertion that `AdminUserFiltersInput.country` / `AdminUpdateUserInput.country` remain nullable `String`), not a live wire probe sending free text through `adminUsers`/`adminUpdateUser`. Sufficient — a `String` scalar trivially coerces any string, and the pin freezes exactly the property that guarantees it — but a one-line live probe would close the last gap if the free-text path is ever re-typed |

## Verdict

**PASS — approved for this lens.** All 6 lens checks verified against real content: the three-way scalar sync (registry ↔ builder slot ↔ codegen map) is exact and single-sourced; the committed SDL carries the retypes on precisely the two registration inputs while the legacy free-text inputs stay `String`; the `gql/graphql.ts` absence is provably correct (inline scalar mapping, `string` ≡ `string`, input-only scalar usage — verified both generated input shapes byte-identical); the wire suite pins coercion ordering, BFLA ordering on `adminCreateUser`, and smuggling rejection; and all four in-scope suites re-ran green (175 tests, 0 fail). One INFO advisory only. Pre-existing-filter honored: the known `frontend/graphql/test/admin/admin-users.integration.test.ts:551` fixture-count failure is unchanged since `5a8369fe` (file absent from the diff) and is not counted as an R4 finding.
