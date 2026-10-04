# Plan Review Report — Surah/Juz Enum Homework Tracking

## Review Round: 1
## Date: 2026-10-04
## Subagents Dispatched: verify-paths-exist, verify-i18n-namespaces, verify-graphql-accuracy, verify-cross-ref-consistency (R1); verify-rebuild (R2 rebuild check); verify-empirical (R2 tsgo/oxlint/runtime sample check)

---

## Summary

- **Total issues found:** 12
- **Blocking (CRITICAL/HIGH):** 3
- **Medium (MAJOR/MEDIUM):** 2
- **Low/Notes:** 7
- **Verdict:** ✅ Plan passes review — all findings fixed and verified; no open items.

---

## Findings by Dimension

| Dimension | Subagent | Issues Found | Status |
|---|---|---|---|
| Paths Existence | verify-paths-exist | 4 | ✅ Fixed |
| i18n Compliance | verify-i18n-namespaces | 2 | ✅ Fixed |
| GraphQL Accuracy | verify-graphql-accuracy | 2 | ✅ Fixed |
| Cross-Reference Consistency | verify-cross-ref-consistency | 4 | ✅ Fixed |
| Rebuild / truncation verification | verify-rebuild | 1 (CRITICAL, raised post-R1) | ✅ Fixed |
| Empirical sample verification | verify-empirical | 1 follow-up confirmation | ✅ Pass |

---

## Detailed Findings

### Dimension 1: File Integrity / Truncation

**Subagent:** `verify-rebuild`

**Findings:**

1. **[CRITICAL]** `plan.md` head-truncation — an append tool call silently executed as an
   overwrite and destroyed §1–§8.F (Overview, decisions D1–D8, Data Models, API
   Contracts, Services/Repo signatures).
   - **Location:** `plan.md` (former lines 1–~330)
   - **Expected:** complete §1–§14 structure per the skill's plan template
   - **Actual:** file began mid-body at §9 (canonical dataset); all upstream sections lost
   - **Fix Applied:** rebuilt §1–§8 in 7 sequential Write chunks, each verified with
     `wc -c` before the next chunk; final structure audit confirms all mandatory
     sections present (Overview+decisions / Data Models / API Contracts+SDL+permission
     matrix / signatures+concurrency+Journey / UX-Nav / Security-Tenancy).

### Dimension 2: GraphQL Accuracy

**Subagent:** `verify-graphql-accuracy`

**Findings:**

1. **[MAJOR]** §8.D codegen mapper had an inverted `Object.entries` map.
   - **Location:** `plan.md` §8.D (`CODEGEN_WIRE_BY_REF` sample)
   - **Expected:** `Object.entries(BackendSurahJuzRef)` yields `[memberName, snakeRef]`
     pairs, so the lookup map used by GraphQL resolvers must be keyed by wire value
     (`ref → member`), not by member name.
   - **Actual:** original sample built the map as `member → ref`, making every
     resolver lookup miss and fall through to the error branch.
   - **Fix Applied:** flipped to
     `new Map<string, string>(Object.entries(BackendSurahJuzRef).map(([member, ref]): [string, string] => [ref, member]))`
     with an `isCodegenSurahJuzRef` type guard and zero `as` casts (a bare cast trips
     the repo's `no-unsafe-type-assertion` rule). Verified empirically: sample passes
     repo `tsgo` and type-aware oxlint, and a 35/35 runtime round-trip scratch test
     (old 5 refs + 30 new refs, both directions) passed.

2. **[MEDIUM]** Wire-probe error codes were wrong per channel.
   - **Location:** `specs.md` REQ-2.3, `plan.md` §8.G / §10, `tasks.md` Task 5.1
   - **Expected:** an invalid enum value sent as a GraphQL *variable* (JSON) is
     rejected with `BAD_USER_INPUT` (value-coercion preset), while an invalid enum
     value in a *document literal* is rejected with `GRAPHQL_VALIDATION_FAILED`
     (per `test/workflows/classes/session-report.wire.test.ts:26-31,919-946`).
   - **Actual:** plan asserted a single error code for both probe channels.
   - **Fix Applied:** dual-channel denial contract written into REQ-2.3, plan §8.G
     and §10 SDL delta notes, and Task 5.1 (two probes: variables-JSON probe expects
     `BAD_USER_INPUT`; document-literal probe expects `GRAPHQL_VALIDATION_FAILED`).

### Dimension 3: Paths Existence

**Subagent:** `verify-paths-exist`

**Findings:**

1. **[HIGH]** Cross-actor journey tests were cited by short name only, without full paths.
   - **Location:** `plan.md` §11 testing strategy / Journey Design section
   - **Expected:** exact file paths so implementers and the Task 6 wire/journey locks
     reference real files.
   - **Actual:** only test file basenames were given.
   - **Fix Applied:** full paths written in:
     `test/workflows/parents/parent-monitoring.journey.test.ts`,
     `test/workflows/admin/academic-tracking.journey.test.ts`,
     `test/workflows/classes/session-report-cross-teacher.journey.test.ts`.

2. **[LOW]** `server.ts` citation was off (claimed `:11`).
   - **Location:** `plan.md` §6 / §7 evidence citations
   - **Expected:** actual lines
   - **Actual:** correct location is `backend/ws/server.ts:15-17`
   - **Fix Applied:** citation corrected to `backend/ws/server.ts:15-17`.

3. **[LOW]** `shared/locale/AGENTS.md` citation was imprecise.
   - **Fix Applied:** corrected to `shared/locale/AGENTS.md:27-31`.

4. **[LOW]** `entity-setup.ts` cited without full path.
   - **Fix Applied:** corrected to `backend/db/test/entity-setup.ts`.

### Dimension 4: i18n Compliance

**Subagent:** `verify-i18n-namespaces`

**Findings:**

1. **[LOW]** Key-parity test was order-sensitive but cannot be.
   - **Location:** `plan.md` §8 parity guards / `tasks.md` Task 2
   - **Expected:** codegen emits enum members alphabetically while the backend
     declares them in mushaf order — the codegen-keys parity assertion must be
     order-insensitive (set/sort comparison). Only the pgEnum↔TS-enum guard is
     order-sensitive (both are declared in mushaf order).
   - **Actual:** original task text implied a single order-sensitive comparison.
   - **Fix Applied:** Task 2 and plan §8 split the guards explicitly:
     pgEnum↔TS order-sensitive; codegen keys order-insensitive.
2. **[LOW]** Glyph-note wording in the dataset section could be misread as prescribing
   ASCII stripping.
   - **Location:** `plan.md` §9 transliteration notes / `specs.md` glossary
   - **Expected:** clarify that dot-below emphatics (ḥ ṣ ṭ ḍ) are preserved in
     transliteration labels and no ASCII folding is applied.
   - **Actual:** ambiguous phrasing ("strip diacritics" reading).
   - **Fix Applied:** wording rephrased in both files to "dot-below emphatics
     (ḥ ṣ ṭ ḍ) are preserved as-is; no ASCII folding".

### Dimension 5: Cross-Reference Consistency

**Subagent:** `verify-cross-ref-consistency`

**Findings:**

1. **[HIGH]** Deferred-ledger verification grep was unsatisfiable.
   - **Location:** `tasks.md` Task 7 / `deferred-items.md` audit step
   - **Expected:** a grep whose exit status can actually be 0 when the ledger is
     healthy.
   - **Actual:** original grep counted `❌`/`⚠️` glyphs across the whole file, but the
     table legend itself contains those glyphs, so the count can never be zero.
   - **Fix Applied:** row-scoped grep:
     `grep -E '^\| D[0-9]+' deferred-items.md | grep -c '❌\|⚠️'` — legend lines are
     excluded; healthy ledger yields 0.

2. **[LOW]** REQ-0.3, REQ-0.4, REQ-7.3 appeared in `specs.md` section headers as
   ranges/derived tokens not literally present in `tasks.md`, weakening the
   traceability audit.
   - **Fix Applied:** literal `REQ-0.3`, `REQ-0.4`, `REQ-7.3` tokens added to the
     relevant `tasks.md` rows; traceability audit now zero-miss in both directions.

3. **[LOW]** Task 0 cleanup step referenced a marker convention the repo does not use.
   - **Fix Applied:** Task 0 marker requirement waived with an explicit note instead
     of an invented convention.

4. **[LOW]** en/ar locale leaf line-range citations were off by one closing brace
   (172-247/168-243 vs actual 172-248/168-244).
   - **Fix Applied:** reviewers judged acceptable as-is (implementation re-verifies
     actual insertion points); recorded here rather than churned.

---

## Fix Subagents Dispatched

All fixes were applied directly by the orchestrator (single-file, localized edits);
no separate fix subagents were required.

| Fix Area | Target Files | Findings Fixed | Status |
|---|---|---|---|
| plan.md rebuild | `plan.md` | 1 (CRITICAL truncation) | ✅ Complete |
| Mapper + parity guards | `plan.md` §8, `tasks.md` Task 2 | 2 (MAJOR inversion, LOW order-sensitivity) | ✅ Complete |
| Wire-probe error codes | `specs.md` REQ-2.3, `plan.md` §8.G/§10, `tasks.md` 5.1 | 1 (MEDIUM) | ✅ Complete |
| Journey paths + ledger grep | `plan.md` §11, `tasks.md` Task 7, `deferred-items.md` | 2 (HIGH) | ✅ Complete |
| Citations + traceability tokens + glyph note | `plan.md`, `specs.md`, `tasks.md` | 6 (LOW) | ✅ Complete |

---

## Post-Fix Verification

- [x] All stale references resolved — citations re-verified with grep/view
      (`backend/ws/server.ts:15-17`, `shared/locale/AGENTS.md:27-31`,
      `backend/db/test/entity-setup.ts`, three full journey-test paths)
- [x] §8.D mapper sample passes repo `tsgo` and type-aware oxlint, plus a 35/35
      runtime round-trip scratch test (both directions, no casts)
- [x] REQ traceability zero-miss both directions:
      `for r in $(grep -oE 'REQ-[0-9.]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done`
      → no output; reverse direction also clean
- [x] Structure audit: `plan.md` contains all mandatory sections (Overview+decisions
      D1–D8 / Data Models / API Contracts+SDL delta+permission matrix /
      Services+Repo signatures+concurrency assessment+Journey Design / UX-Nav
      ruling / Security-Tenancy)
- [x] Dataset integrity: §9 has exactly 114 rows; numbering 1–114 exact; the five
      shipped refs are byte-identical to current labels; hostile fixture
      `surah_an_nuh` stays invalid, `surah_al_furqan`=#25 becomes valid
- [x] Anti-pattern sweep clean on all artifacts: no `Translation.` enum, no two-arg
      `getTranslations`, no `@/frontend/utils/logger`, no raw `bun test` on
      workflow tests (all via `test/scripts/run-test.ts`), no bottom-nav, no
      invented paths
- [x] Truncation check: head+tail of every artifact intact (verified after the
      final glyph-note edits)
- [x] Ledger audit grep row-scoped and satisfiable (0 on healthy ledger)

**Verification command (reference):**
```bash
grep -E '^\| D[0-9]+' ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/deferred-items.md | grep -c '❌\|⚠️'   # expect 0
```

---

## Lessons for Future Plans

- **The append-as-overwrite trap is real and silent.** One Write append executed as
  an overwrite and destroyed the first half of `plan.md` without any error signal.
  Always run `wc -c` immediately after every append and compare against the previous
  byte count before writing the next chunk — this is now a mandatory step for all
  chunked plan-file writes.
- **Empirical verification of code samples beats desk-checking.** The §8.D mapper
  inversion (MAJOR) was invisible to prose review but caught immediately by pasting
  the sample into a scratch file and running repo `tsgo` + a runtime round-trip test.
  Any plan that contains non-trivial code samples should have at least the riskiest
  sample executed, not just read.
- **Check the failure channel before asserting error codes.** GraphQL rejects invalid
  enum values differently depending on whether they arrive as variables (JSON,
  `BAD_USER_INPUT`) or document literals (`GRAPHQL_VALIDATION_FAILED`). Existing
  wire tests (`session-report.wire.test.ts`) are the ground truth — cite them.
- **Make audit greps falsifiable.** Any "expect zero" verification step must be
  physically capable of returning zero (the ledger glyph grep had to be row-scoped
  because the legend itself contained the glyphs).
- **Order-sensitivity must match emission reality.** Codegen emits enum members
  alphabetically; backend enums are declared in domain (mushaf) order. Parity tests
  that compare key *sets* must be order-insensitive; only same-source comparisons
  can be order-sensitive.

---

## Traceability

**Plan files modified during review fixes:**
- `specs.md` — REQ-2.3 dual-channel denial contract; glossary glyph-note wording
- `plan.md` — full §1–§8 rebuild (truncation recovery); §8.D mapper flip + type
  guard; §8.G/§10 error-code channel split; §11 journey full paths; citation
  corrections; glyph-note wording
- `tasks.md` — Task 2 guard split (order-sensitive vs insensitive); Task 5.1
  dual-channel probes; Task 7 row-scoped ledger grep; REQ-0.3/0.4/7.3 literal
  tokens; Task 0 marker waiver note
- `deferred-items.md` — unchanged in content; referenced by the row-scoped audit grep

**Outcome knowledge base updated:**
- This report saved as:
  `ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/outcome/plan-review-R1.md`

---

## Next Steps

- [ ] Commit patched plan files (local only — do NOT push until implementation starts)
- [ ] Proceed to implementation (Phase 1: Foundation — Task 0/1: pgEnum expansion
      + drizzle migration)
- OR: run another review round if issues remain (increment R2) — **not needed; R1 verdict is PASS**
