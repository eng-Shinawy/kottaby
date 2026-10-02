# Round R8 Review — Test-Quality Lens

- **Reviewer:** R8 (independent, test-quality lens)
- **Branch:** `feat/no_country_selector_component` @ `d04e19dd` (base filter `5a8369fe`)
- **Scope:** all 17 test files added/changed by the plan; instructions read (`.agents/instructions/tests.instructions.md`); tasks.md 4-Tier framework used as yardstick
- **Worktree note:** shared worktree with concurrent agents — every read was staged via `git show feat/…:<path>` to guarantee committed-tip content; worktree deltas reviewed separately via `git diff HEAD`
- **Result: 1 must-fix + 4 minor/informational findings. Test quality is high overall.**

## 1. Four-Tier adequacy (per file, gaps named)

| File | T1 | T2 | T3 | T4 | Notes |
|---|---|---|---|---|---|
| shared/constants/countries.test.ts | ✔ dup/closed-pair/flags/RI-codepoints/excluded/deep-import pin | ✔ en/ar non-blank + CLDR spot-checks (RTL ground truth) | ✔ seeded LCG, shape boundary set | ✔ markup/entity/control/bidi sweeps | T3 determinism half is near-tautological (F4) |
| shared/lib/country-code.test.ts | ✔ full branch matrix, both schemas, guard narrowing | ✔ NBSP vs ZWSP/RLM, RTL, emoji, 3-byte | ✔ seeded corpus + `Promise.allSettled` | ✔ proto keys, SQL/LIKE, 10k strings + wall-clock bound | exemplary |
| backend/graphql/test/country-code-scalar.test.ts | ✔ registry single-entry, leaf discipline, exact field paths | ✔ case-insensitive accept / verbatim pass-through / coercion errors | ✖ (see gap G1) | ✔ non-string, literal-AST, wire variable coercion on built schema | comment bug F2 |
| backend/graphql/test/country-input-retype.wire.test.ts | ✔ built schema + committed-SDL pins, legacy inputs stay String | ✔ XX/Egypt/missing → BAD_USER_INPUT pre-resolver | ✖ (see gap G2) | ✔ smuggling key, anon BFLA (UNAUTHORIZED after coercion) | clean lifecycle/afterAll |
| backend/graphql/test/schema-surface.test.ts (M) | +`CountryCode` in frozen type-delta pin; `scalar CountryCode` in codegen-sync pin | n/a (surface freeze) | n/a | n/a | minimal, correct |
| backend/graphql/test/sdl-static-assertions.test.ts (M) | scalar set pinned to EXACTLY `[CountryCode, DateTime]`, 2 decl lines | n/a | n/a | n/a | updated, not stale |
| backend/db/test/repo/users/user.repository.test.ts (A) | ✔ create/round-trip + raw-SQL SELECT-list branch (committed fixtures) | ✔ legacy NULL reads, varchar(2) char-vs-byte (ΩΩ fits, EGY→22001) | ✔ `Promise.allSettled` 5 concurrent creates in rollback tx | ✔ injected string rejected at DB layer, table-intact probe | I6 note |
| backend/db/test/logic/auth/registration.service.test.ts (M) | ✔ persisted pair (code + display name), field-path errors | ✔ normalization, XX/AA, null/undefined tamper | ✔ seeded 64-payload fuzz through service (sequentialized, documented savepoint rationale) | ✔ BOPLA mass-assignment (countryCode/governance/handshakeCode) | layer rules fully honored |
| backend/services/admin/user-management.service.test.ts (M) | ✔ persisted pair, localized codes | ✔ whitespace/lowercase, 4-way invalid | ✔ seeded xorshift fuzz with **independent oracle** (`expectedFuzzClassification`) + 5-way concurrent creates on own txs | ✔ BFLA gate-ordering (Forbidden before validation), BOPLA probe | strongest suite in the set |
| backend/services/admin/user-management.chaos.test.ts (M) | — | — | chaos suite (pre-existing; only `country: "EG"` fixture update) | — | 2-line change, appropriate |
| backend/services/auth/__tests__/registration-trial-provisioning.test.ts (M) | fixture-only `country: "EG"` + comment | — | — | — | minimal, correct |
| frontend/graphql/test/admin/admin-users.integration.test.ts | committed tip **byte-identical to base** (verified by diff) → all its issues pre-existing; **worktree fix reviewed below** | | | | F1 |
| frontend/components/ui/CountrySelector.test.tsx (A) | ✔ render/option surface/selection/controlled value | ✔ placeholder, aria-invalid/live, RTL (logical props, no physical), disabled | ✔ seeded 200-round re-render/onChange fuzz | ✔ React-escaped hostile helperText, proto-key immunity | F3 probe |
| frontend/views/auth/register/RegisterIdentityFields.test.tsx (A) | ✔ picker replaces free-text, controller binding, submit data.country | ✔ setError projection seam | ✔ rapid-change + concurrent submits (no stale state) | ✔ overlong/unicode/proto-key via real RHF pipeline | real-RHF seam is excellent |
| frontend/views/auth/register/registerFormUtils.test.ts (A) | ✔ all COUNTRY_CODES pass-through | ✔ "", null, undefined, padded | — (proportionate: tiny pure helper; T3 assigned to the identity-fields suite and delivered there) | ✔ proto keys, 10k, RTL/emoji | fine |
| frontend/lib/mutationFieldErrors.test.ts (M) | ✔ new COUNTRY_CODE_* → `country` path mapping + first-wins collapse + whitelist seam + wire-order | — | — | ✔ REUSE_SET audit extended | matches plan 5.2.TE |
| shared/locale/countrySelector-namespace.parity.test.ts (A) | reviewed by R7 (PASS, 18/18 green) — re-skimmed, no test-quality concerns | | | | |

**Named tier gaps (both judged adequately compensated, non-blocking):**
- **G1** — `country-code-scalar.test.ts` has no Tier 3. Plan 2.1.TE T3 ("re-run generators, assert no duplicate-scalar runtime error") not implemented literally; substituted by sdl-static-assertions (scalar set pinned to exactly 2, each once → a duplicate registration would break the pin) + schema-surface codegen byte-sync. Acceptable; note for the record.
- **G2** — `country-input-retype.wire.test.ts` has no Tier 3 wire-concurrency fuzz (plan 3.2.TE T3). No `Promise.allSettled` exists anywhere under `backend/graphql/test/`. Compensated at the service tier (registration.service 64-payload fuzz; 5-way concurrent admin creates; chaos suite). Optional follow-up, not required.

## 2. Non-tautological assertions — PASS with one minor
- Assertions exercise real seams throughout: built GraphQL schema execution (variable coercion), live testClient, real Drizzle tx reads, real RHF `handleSubmit`, SQLSTATE `22001` pins via a cause-chain walker, audit-row counts around mutations. No assert-what-you-just-wired patterns found.
- **F4 (minor):** the "determinism" assertions in `countries.test.ts:167-172` and `country-code.test.ts:234-252` compare two runs of the same pure function with the same seed — trivially true; the sweep also tests a local copy of the regex, not the dataset. Harmless determinism pin (plan asked for it), but the weakest assertions in the set. Contrast: `user-management.service.test.ts` does it right (independent `expectedFuzzClassification` oracle). No action required; if touched again, fold into an oracle.

## 3. Layer rules — PASS
- **db:** `runInRollback` + `tx` propagated to every repo call (registration.service, user.repository); `expectRepoError` try/catch everywhere, zero `rejects.toThrow()`; raw-SQL no-tx branch correctly exercised via committed `beforeAll` fixtures + `afterAll` hard delete + zero-residue probe (documented Rule-9 rationale).
- **services:** external channels untouched (no new send-path invocations; suites green in sandbox); domain-log silenced via `spyOn(logger, …)`.
- **graphql:** `setupTestServerLifecycle()` + `testClient` in both wire suites; `errorPolicy` respected (assert `result.error`, never `result.errors`); TypedDocumentNode/gql documents; audit-row zero-write probes.
- **No live network calls anywhere in scope** (only pre-existing localhost harness fetch in the base-identical admin-users file).

## 4. Determinism / isolation — PASS with two flags
- All fuzz is seeded (LCG/xorshift, distinct constants noted as clone hygiene); zero unseeded `Math.random` in scope. No inter-test coupling (module-scope capture reset per render; shared-tx concurrency documented where used).
- **F3 (minor, checklist flag):** `CountrySelector.test.tsx:388` — `Bun.file(new URL("./CountrySelector.tsx", import.meta.url)).text()` is a worktree-coupled source read (flagged per lens). It duplicates the rendered-markup XSS assertion two lines above and breaks if the component file moves. The repo's static source-scan pins live in dedicated scan suites; recommend deleting the source-read or relocating it to one. Non-blocking.
- `country-input-retype.wire.test.ts:97` reads the **committed** generated SDL artifact (`frontend/graphql/generated/schema.graphql`) — a committed fixture, consistent with schema-surface's existing convention. Not a violation.
- Committed fixtures + `afterAll` cleanup present wherever servers/DB fixtures boot (`deleteUsersByIds` + RESTRICT pre-clean + `deleted === ids.length` + zero-remain checks).

## 5. Naming/structure conventions — PASS
- `describe`/`test` (no `it`), bun:test imports, tier labels in describe/test names mirroring sibling suites; deep-import rationale comments match the chaos suite's precedent; fixture factories (`makeValidInput`, `makeCreateInput`, `buildInsert`) follow sibling patterns; helpers <80 lines; no `console.*`; no `any`; localization via `getServerTranslations` not raw keys.

## 6. Scoped suite runs (mandated runner; not full suites)

| Suite | Result |
|---|---|
| `shared/lib/country-code.test.ts` | **25 pass / 0 fail**, 741 expect(), 463ms |
| `backend/services/admin/user-management.chaos.test.ts` | **8 pass / 0 fail**, 50 expect(), 2.57s |
| `backend/db/test/logic/auth/registration.service.test.ts` | **31 pass / 0 fail**, 359 expect(), 13.79s |

(Parity suite: 18 pass per R7's run; not re-run.)

## Worktree delta (uncommitted, reviewed separately)
- `frontend/graphql/test/admin/admin-users.integration.test.ts` (+75): fixes the stale multi-field probe (`country: ""` → `"EG"`, expects the four real service failures and NO country entry), adds **empty-country → BAD_USER_INPUT wire gate (zero audit writes)** and **XK → VALIDATION + COUNTRY_CODE_INVALID on the `country` path (zero audit writes)**. Both follow suite conventions (audit counts, `bearer`, structural narrowing). The fix is correct and well-motivated.
- `tasks.md`: documentation restructure only.

## Pre-existing filter (5a8369fe)
- admin-users.integration `:551 adminsCount ≥ 2` failure — pre-existing (committed file byte-identical to base; verified). Not counted.
- `EXCLUDED_CODES` curation policy (incl. `IL`) is a documented generator decision (`cldr-data.ts:41`, iana precedent) — data policy, not test quality; not counted.

## Findings
- **F1 (MUST-FIX before merge):** the committed tip is self-inconsistent — schema.graphql `:1789` types `AdminCreateUserInput.country` as non-null `CountryCode!` (pinned by the committed wire test), while the committed `admin-users.integration.test.ts:766` still sends `country: ""` expecting `VALIDATION`/`COUNTRY_REQUIRED` (`:772`, `:792`). That test now fails at wire coercion (BAD_USER_INPUT) at the tip. The corrective worktree changes are **uncommitted** — commit the admin-users fix (and tasks.md) so the tip is green.
- **F2 (minor):** `country-code-scalar.test.ts` (header + test name at `:145-150`) claims `PS` is "curated out of the shared dataset" — `PS` IS in the dataset (`countries.ts:455`; countries.test spot-checks it). Assertion still true (scalar accepts `PS` verbatim); fix the comment to `(IL, XK)` so the defense-in-depth rationale stays accurate.
- **F3 (minor):** remove/relocate the `Bun.file`-of-source probe in `CountrySelector.test.tsx:388-389` (worktree-coupled; redundant with the markup assertion).
- **F4 (minor):** near-tautological determinism assertions (see §2); optional oracle refactor if files are touched again.
- **G1/G2 (informational):** named Tier-3 gaps with documented compensations (see §1); optional wire-tier concurrency-fuzz follow-up.
- **I6 (informational):** `user.repository.test.ts` runs 5 concurrent creates on the shared rollback tx — safe for plain INSERTs (pg client queues; no nested savepoints), but the concurrency doctrine comments in the service/chaos suites read stricter; a one-line cross-reference comment would prevent confusion.

**Next actions:** (1) commit the in-flight admin-users worktree fix + tasks.md; (2) one-line comment fix F2 (and optionally F3) in the same or a follow-up commit; (3) no other test changes required.

R8-FINDINGS: 5
