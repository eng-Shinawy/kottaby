# Round R2 Review — Shared-Layer Lens

- **Reviewer**: R2 (independent, shared-layer lens)
- **Branch**: `feat/no_country_selector_component` (tip `d04e19dd`)
- **Diff base**: `5a8369fe..feat/no_country_selector_component`
- **Scope**: `shared/constants/countries.ts` + `.test.ts`, `shared/lib/country-code.ts` + `.test.ts`, `scripts/country-data-generator/*`
- **Method**: full read of all 9 scoped files (1,302 added lines, all new), root + `shared/` AGENTS.md, independent runtime verification (bun), both test suites re-run, generator re-executed for idempotency.

## Lens Checklist Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Dataset integrity | **PASS** | Runtime-verified: 255 codes, sorted A→Z, no dupes; `COUNTRIES` keys ≡ `COUNTRY_CODES` exactly (closed pair); every flag = 2 codepoints in U+1F1E6–U+1F1FF derived from its own code; all en/ar names non-blank; {EU, EZ, QO, UN, XA, XB, XK, ZZ, IL} all absent |
| 2 | country-code export surface | **PASS** | Module exports exactly `COUNTRY_CODE_PATTERN`, `normalizeCountryCode`, `isValidCountryCode`, `countryCodeSchema`, `countryCodeShapeSchema` (runtime `Object.keys` = 5, no default). `ISO_SHAPE_ANY_CASE` kept private. Strict guard checks RAW value → narrowing sound; Set-based membership (`__proto__` probe safe); transform-then-enum pipeline (`z.string().transform(...).pipe(z.enum(...))`); both regexes flag-free (`/^[A-Z]{2}$/`, `/^[A-Za-z]{2}$/`), `lastIndex` stays 0 |
| 3 | Test adequacy | **PASS** | All documented edges covered and non-tautological: ZWSP/RLM fail-closed vs NBSP trims, 3-byte emoji (`☁`) + 4-byte (`🇪🇬`, `😀`), `__proto__`/`constructor`/`prototype` + state-untouched probe, `%`/`_`/`\` + injection payloads, 10k strings + wall-clock bound, seeded LCG fuzz determinism in BOTH files, compile-time narrowing proof. Re-ran: 25 + 17 tests, 0 fail (741 + 1825 expects) |
| 4 | Comments | **PASS** | Zero `REQ-*`/Task/Phase/plan-path references (grep clean). Comments describe domain behavior (two-tier rationale, narrowing soundness, exclusion rationale); no trivia |
| 5 | Cross-layer imports | **PASS** | `countries.ts` imports nothing; `country-code.ts` imports only `zod` + `@/shared/constants/countries`; tests import `bun:test` + shared modules; generator (scripts layer) imports node builtins + `@/scripts/*`. No frontend/backend/app imports anywhere |
| 6 | Generator | **PASS** | Re-ran `bun run generate:countries` → 255 countries, `git status` on output EMPTY (byte-identical = deterministic + idempotent). Names emitted via `JSON.stringify` (escaping correct). `Object.hasOwn` + Set exclusions (prototype-safe). No `process.argv`/`process.env`/`fetch`/`exec`/`spawn`/`eval`; reads only `node_modules/cldr-localenames-full`, writes only the output file |
| 7 | Deep-import discipline | **PASS** | `shared/constants/index.ts` does not export countries (8 pre-existing barrel lines only); repo-wide grep finds no barrel re-export of `countries` anywhere; `countries.test.ts` additionally locks this at runtime |

## Findings

| Severity | Location | Finding |
|----------|----------|---------|
| LOW | `shared/lib/country-code.ts:57-59` (pipeline at :78-81) | `normalizeCountryCode` uppercases non-ASCII homoglyphs whose Unicode uppercase maps into A–Z, so `countryCodeSchema` accepts e.g. `"ſg"` (long s) → `"SG"` (runtime-verified). Output is always a canonical dataset member, so persisted-value integrity is unaffected, but the input contract is broader than "ASCII two letters". If strict ASCII provenance is wanted, pipe through `COUNTRY_CODE_PATTERN` post-transform. No doc/test currently claims ASCII-only input, so this is a contract note, not a defect |
| INFO | `scripts/country-data-generator/cldr-data.ts:34-39` | Exclusion comment calls EU/EZ/QO/UN/ZZ "exceptional-reservation … not ISO 3166-1 countries", yet other CLDR exceptional-reservation codes (AC, CP, CQ, DG, EA, IC, TA) are intentionally kept. The real discriminator is grouping/region-code vs selectable territory — could be stated to preempt "why is EA in but EU out" questions |
| INFO | `scripts/country-data-generator/cldr-data.ts:109` | `toSorted((a, b) => a.localeCompare(b))` is ICU/locale-environment dependent in general. For uppercase ASCII pairs it is stable in practice (verified output today), but a plain code-point compare (`a < b`) would make the deterministic-output guarantee fully environment-independent |
| INFO | `scripts/country-data-generator/cli.ts:23` | Missing-CLDR hint says `bun add -d cldr-core cldr-dates-full cldr-localenames-full`, but the generator reads only `cldr-localenames-full` (copied hint from the iana-generator precedent) |

## Verdict

**PASS — approved for this lens.** No blockers, no majors, no minors. All 7 lens checks verified against real content, plus independent runtime verification (dataset math, export surface, statefulness, prototype safety) and a successful byte-identical generator re-run. The single LOW item is an input-contract observation with no persistence-integrity impact; the three INFO items are documentation polish. Pre-existing-filter: all scoped files are new on this branch — nothing at `5a8369fe` to filter.
