# Round R9 — Security Re-Probe Review (independent adversarial pass)

- **Reviewer**: R9 (security re-probe lens), READ-ONLY
- **Date**: 2026-10-03
- **Verified tip**: `d04e19dd` — "test(frontend): document run command in CountrySelector test header" (branch `feat/no_country_selector_component`; range reviewed `5a8369fe..d04e19dd`, 15 commits)
- **Prior pass**: R1 midpoint (0 issues) — this round re-attacked the FINAL state independently
- **Pre-existing filter**: issues already present at `5a8369fe` excluded
- **Result**: **0 vulnerabilities** · 3 INFO observations · 1 defense-in-depth note

---

## Verdict table

| # | Probe | Verdict |
|---|-------|---------|
| 1 | Cross-layer trust (wire → resolver → service → DB, both paths) | **PASS** |
| 2 | Error-oracle abuse (REQUIRED vs INVALID) | **PASS** (INFO-1) |
| 3 | Input coercion edges (lowercase / whitespace / homoglyphs) | **PASS** |
| 4 | Admin gate ordering at tip | **PASS** |
| 5 | Mass assignment in final diff | **PASS** |
| 6 | Client-side trust boundaries | **PASS** |
| 7 | Generator / supply-chain injection | **PASS** |
| 8 | Secrets scan over full diff | **PASS** (test fixtures only) |

---

## Probe 1 — Cross-layer trust: country wire → DB

**Wire.** `CountryCode` = `CountryCodeResolver` from `graphql-scalars` (`backend/graphql/pothos/shared/scalar.pothos.ts:58-61`). Verified against the *installed* package (`node_modules/graphql-scalars/cjs/scalars/CountryCode.js`): full-ISO alternation regex with `/i` flag, **returns the value UNCHANGED** — so lowercase (`"eg"`) and curated-out members (`"XK"`, `"IL"`) pass the wire. Registered once; SDL + codegen refreshed (`schema.graphql`: `RegisterUserInput.country: CountryCode!`, `AdminCreateUserInput.country: CountryCode!`; `codegen.ts`: `CountryCode → string`).

**Resolver.** Both mutations map field-by-field, no spread: `backend/graphql/mutation/auth.mutation.ts:56-69` and `backend/graphql/mutation/admin/admin-users.mutation.ts:59-93` (`country: input.country` verbatim into the service contract).

**Service gate (single normalization+membership authority).**
- Public: `registration.service.ts` `validateInput` — blank → `COUNTRY_CODE_REQUIRED`, else `countryCodeSchema.safeParse` → `COUNTRY_CODE_INVALID` (lines 226-235). `createUserRow` then re-normalizes and re-checks membership (`normalizeCountryCode` + `isValidCountryCode`, lines 332-336) before the insert; the null arm is unreachable through service entry points and keeps code/name paired.
- Admin: `user-management.helpers.ts` `validateCreateInput` (lines 247-259) gates identically; `buildCreateUserInsert` **re-parses** through `countryCodeSchema` (line ~327) rather than trusting the prior gate — defense in depth confirmed.

**Persistence.** Only two production writers of `users.country_code`:
1. `registration.service.ts:createUserRow` → `UserRepository.create` (explicit `UserInsertType`, persisted value is the *normalized* string or `null`; legacy `country` gets `COUNTRIES[code].en`, never raw input).
2. `admin/user-management.helpers.ts:buildCreateUserInsert` → same repo (persisted value is `parsedCountry.data` — the schema's normalized output — or `null`).

`country_code` is `varchar(2)` (`backend/db/schema/users/users.ts:28`, migration `20260930202253_add_users_country_code/migration.sql` — DB-level length cap). Raw-SQL seeders (`scripts/seed-academic-tracking.ts`, `ui-audit-seed.ts`, `vlm-seed-fixtures.ts`) do not write the column. No `UPDATE ... SET` path touches `country_code` (admin profile patch stays legacy free-text `country` by design, admin-only, ≤100 chars). Reads: `country_code` rides the explicit SELECT lists (`user.repository.ts:53,86`) and `SAFE_USER_SELECT`; GraphQL exposure is the legacy display name only (`user.pothos.ts:39`, `admin-user.pothos.ts:73,282`) — no code echo. **No spot persists a non-normalized, non-member, or >2-char value. PASS.**

## Probe 2 — Error-oracle abuse

`COUNTRY_CODE_REQUIRED` (blank) vs `COUNTRY_CODE_INVALID` (present, non-member) differ, but both are reachable only *after* the wire scalar has already applied the full public ISO list, and the enumerated space is public ISO 3166-1 data. The distinction leaks nothing an attacker doesn't already know; the per-field split exists for form UX (inline helperText). The graphql-scalars rejection message echoes the caller's *own* input back to the caller (no cross-tenant reflection). **INFO-1 (benign, by design): no action.**

## Probe 3 — Input coercion edges

- `"eg"` → scalar passes unchanged → service `countryCodeSchema` normalizes to `"EG"`, member → **persisted as `"EG"`**; the raw lowercase string is never bound into any SQL statement (only two writers, both normalize first — see Probe 1; DB `varchar(2)` caps length as a last resort).
- `" EG "` → non-blank → normalize (`trim().toUpperCase()`) → `"EG"` → member → persisted `"EG"`. Nothing valid is rejected.
- `"ſg"` (U+017F): at the wire, graphql-scalars' `/^(AD|…|ZW)$/i` does **not** fold it — ECMA-262 `Canonicalize` (non-`u` flag, IgnoreCase) returns `ch` unchanged when a ≥128 code point would fold to a <128 one, so `"ſ"` never matches `"S"`; the scalar rejects with a validation error. Even if a future library change let it through, the service path persists `normalizeCountryCode("ſg") = "SG"` — a canonical dataset member — never the homoglyph, and the legacy `country` column receives `"Singapore"`. **PASS.**
- Fullwidth `ＥＧ`, Kelvin-sign homoglyphs: rejected at the wire by the same Canonicalize rule; would fail the exact-string `z.enum(COUNTRY_CODES)` membership check downstream regardless.

## Probe 4 — Admin gate ordering (re-verified at tip)

`AdminUserManagementService.createUser` (`user-management.service.ts:298-360`): `assertActorAdmin(actorId)` → runtime `role === "admin"` tamper guard (ConflictError, no audit row) → `validateCreateInput` → `hashPassword` (pre-tx) → `withTransaction` { `buildCreateUserInsert` → `UserRepository.create` → role child → audit row }. Resolver layer adds `authScopes: { $all: { authenticated, role: [Admin] } }` + `ctx.user` re-check. **PASS.**

## Probe 5 — Mass assignment over the final diff

`git diff 5a8369fe..feat/... | grep "\.\.\."` reviewed line-by-line: every spread near DB writes is either a **test fixture** (`commitFixtureUser`, `makeCreateInput({...})` builders, hostile-extras negative tests) or a **typed-patch spread** (`.set({ ...patch, updatedAt })` over the repo-internal `AdminUserUpdateDbPatch` built field-by-field by `buildUpdatePatch` — five whitelisted keys, `country_code` structurally absent). The remaining `...` hits are React slot-prop merges (`CountrySelector.tsx`) and test dataset maps. Production insert paths remain explicit field-by-field mappings. **PASS.**

## Probe 6 — Client-side trust boundaries

`CountrySelector.tsx` is presentation-only (MUI Autocomplete over `COUNTRY_CODES`; options/labels from the generated dataset — no user-controlled strings rendered). `countryFromValue` (`registerFormUtils.ts:60-65`) re-narrows raw form values through `normalizeCountryCode` + `isValidCountryCode` before the controlled selector sees them — UX-only, never a security boundary, and the server re-validates independently. Inline RHF validation mirrors the server's REQUIRED/INVALID split (advisory). **No `dangerouslySetInnerHTML`/`innerHTML`/`document.write`/`eval` in the diff** — `CountrySelector.test.tsx` even asserts the absence (`markup/source not.toContain("dangerouslySetInnerHTML")`). **PASS.**

## Probe 7 — Generator / supply-chain

`scripts/country-data-generator/` uses only `readFileSync`/`writeFile`/`mkdir` — **no fetch, no exec, no child_process, no eval**. CLDR JSON is shape-validated (`recordAtPath`/`isStringRecord`, tightened in `52328bd2`) before use. Emitted-TS injection analysis (`file-builders.ts`): codes are interpolated raw but pre-filtered by anchored `/^[A-Z]{2}$/` (injection-impossible); display names/flags are emitted via `JSON.stringify(...)` inside double-quoted literals — `"`/`\`/line terminators/control chars are escaped, and backticks/`${` inside a double-quoted string are inert content, so a malicious CLDR payload cannot break out into code (worst case: altered display strings, still safely quoted). Dataset is committed (`shared/constants/countries.ts`: 255 codes, all `^[A-Z]{2}$` uppercase lines; `XK/IL/EU/EZ/QO/XA/XB/UN/ZZ` exclusions honored) so build output doesn't depend on live registry state. **PASS.**

## Probe 8 — Secrets scan over the full diff

Only synthetic test passwords (`"sup3rSecret!"` in a form-event test; deliberately split `["sup3r", "Secret!"].join("")` to avoid scanner noise — both fake, committed test fixtures). No API keys, tokens, private keys, connection strings, or real credentials. **PASS.**

---

## INFO observations (no action required)

- **INFO-1 (error-oracle)**: REQUIRED vs INVALID country codes distinguish blank vs non-member — an enumeration oracle over *public* ISO data, reachable only past the wire scalar; zero marginal disclosure. Accepted design (form UX).
- **INFO-2 (two-tier accept set)**: the wire scalar accepts the library's full ISO list (incl. `XK`, and `IL` which the curated set excludes) while the service enforces the 255-code curated set. Values outside the curated set fail closed at `countryCodeSchema` (never persisted). This is the documented single-authority split (`shared/lib/country-code.ts` header, `docs/domain/graphql-scalars.md`); noted so future readers don't mistake the wire filter for the persistence gate.
- **INFO-3 (defense-in-depth fallback)**: `buildCreateUserInsert` degrades to legacy free-text `country: input.country` (code `null`) when called with unvalidated input. Unreachable on the GraphQL path (`validateCreateInput` throws first, verified ordering in Probe 4), the column is `varchar(100)`-capped, and the behavior is documented — but a future direct caller skipping validation would silently persist free-text. Consider a `tl;dr` assert or debug-mode throw if the helper gains new callers.

## Pre-existing (out of scope, unchanged)

Admin profile update path persists legacy free-text `country` (≤100 chars) and may diverge from `country_code` on seeded/legacy rows — pre-existing design at `5a8369fe`, addressed by the deferred normalization backfill (see `deferred-items.md`).

## Next actions

- None blocking. Optional backlog: INFO-3 hardening assert if `buildCreateUserInsert` gains callers; keep the `graphql-scalars` CountryCode behavior (pass-through, `/i`) pinned in the scalar test (`backend/graphql/test/country-code-scalar.test.ts` already asserts lowercase pass-through `"il" → "il"` — good tripwire).
