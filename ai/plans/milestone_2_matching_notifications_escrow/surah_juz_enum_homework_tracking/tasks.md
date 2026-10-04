# Tasks — Surah/Juz Enum Homework Tracking

**Plan Directory:** `ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/`
**Related:** `specs.md` (REQ-0 … REQ-10) · `plan.md` (§1-§14) · `deferred-items.md`
**Version:** 1.0 · 2026-10-04

## Non-Negotiable Execution Protocol

1. **Pre-Execution Outcome Read:** before ANY task, read ALL existing files in this plan's
   `outcome/` directory.
2. **Per-File Quality Loop:** after EVERY file edit, run
   `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) — it runs
   tsgo → oxlint → biome → lint:type-aware → check:duplicates and auto-discovers/prints the
   applicable AGENTS.md + `.agents/instructions` files.
3. **Semantic Review:** before marking any subtask complete, self-review the semantic checklist
   (race conditions, env-config, dead code, cross-layer imports, enums-as-values, deferred-item
   logging, clean comments — zero plan-artifact references like REQ-x/Task-x in code).
4. **Global Health Check:** at task end, re-run the quality loop on all files the task touched.
5. **Post-Task Outcome File:** write `outcome/<task-id>-outcome.md` (research, changes,
   cross-file dependencies, carry-overs).
6. **Checkbox Tracking:** mark each subtask `[x]` in this file on completion.
7. **Codegen & DB rules:** after schema/GraphQL changes run `bun run generate:gqlSchema` then
   `bun codegen`; schema changes apply via `bun run db push` + committed migration via
   `bun run db` → generate. NEVER raw `bun test` for workflows/db tests — always
   `bun run test/scripts/run-test.ts <path>`.

**Gate rulings for this plan:** Phase 2.5 mid-point review — SKIPPED (8 tasks < 15; single
release train). Post-implementation parallel review wave — not mandatory (≤ 10 tasks); the
final gate (Task 7) runs `bun quality-gate` instead.

## Layer-to-Instructions Mapping (files this plan touches)

| Files | AGENTS.md (absolute) | Instructions (absolute) |
|---|---|---|
| `backend/enum/shared/surah-juz-ref.enum.ts` + tests | `/home/ahmed/Projects/kottaby_kottaby/backend/enum/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`, `tests.instructions.md` |
| `backend/db/schema/enums.ts` + migration | `/home/ahmed/Projects/kottaby_kottaby/backend/db/schema/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `backend.instructions.md` |
| `backend/graphql/pothos/classes/home-work.pothos.ts`, wire tests | `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/AGENTS.md`, `pothos/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `backend/services/**` tests | `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `shared/locale/**` (types, en/ar leaves, parity test) | `/home/ahmed/Projects/kottaby_kottaby/shared/locale/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/shared/AGENTS.md` | — (none) |
| `frontend/views/teacher/sessions/**` | `/home/ahmed/Projects/kottaby_kottaby/frontend/views/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md` | `frontend.instructions.md`, `tests.instructions.md` |
| `test/workflows/classes/**` | `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md` | `tests.instructions.md` |
| `docs/**` | root `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md` | — |

### Task 0: Pre-Implementation Baseline (MANDATORY)

- [ ] 0. Establish error baseline and verify the ledger
  - Read ALL files in `outcome/` (none yet on first run — proceed)
  - Record baselines: `bun tsgo 2>&1 | grep "error TS" | wc -l`,
    `bun biome:check 2>&1 | grep -c "warn"`,
    `bun run scripts/lint-service.ts --json --id baseline`
  - Verify `deferred-items.md` exists in this plan directory with the two seeded rows (D1
    read-surface label adoption, D2 ayah-count metadata); read it
  - Write `outcome/0-baseline-outcome.md` (baseline counts + the blocking plan's carried-over
    context: this ticket discharges the blocking plan's ledger D1 "114-surah expansion")
  - 0.QL/0.TE/0.SEC/0.SR/0.IV: waived for this protocol-only task — no code files are
    touched; the ledger + outcome file are the deliverables (REQ-0.1, REQ-0.2). REQ-0.3 /
    REQ-0.4 (outcome-read / outcome-write protocol) apply to every task from Task 1 on.
  - Update progress: mark `[x]`
  - _Requirements: REQ-0 (all — baseline, ledger, REQ-0.3 outcome reads, REQ-0.4 outcome
    writes, checkbox tracking)_

### Task 1: Behavior-Preserving Mapper Refactors (BEFORE any vocabulary growth)

Rationale for order: the shipped exhaustive switches compile only while the pgEnum union has
≤ their case coverage — growing the vocabulary first breaks tsgo
(`const exhaustive: never` at `home-work.pothos.ts:125`). Refactor first, grow second.

- [ ] 1. **Mapper refactors — 35-member world stays green**
  - Read `outcome/` first
  - **1.1 Backend:** `backend/graphql/pothos/classes/home-work.pothos.ts` — replace
    `toSurahJuzRef` (`:54-127`) with the guard-narrowing form from plan §8.C (value-import
    `isSurahJuzRef`; fail-closed `throw` unchanged in semantics); reword the file-header
    mapper paragraph (`:15-24`) and the helper doc (`:35-53`) — describe the vocabulary guard
    + parity-test compensation; NO comments referencing plan artifacts
  - **1.2 Frontend:** `frontend/views/teacher/sessions/sessionReportConversions.ts` — replace
    `toCodegenSurahJuzRef` (`:27-104`) with the module-scope `CODEGEN_WIRE_BY_REF` map +
    fail-closed throw from plan §8.D; keep the file-header no-double-cast note accurate
  - **1.3 Test:** create `frontend/views/teacher/sessions/sessionReportConversions.test.ts` —
    round-trip ALL current members backend→codegen, unknown value throws fail-closed,
    `toCodegenSubmitInput` field-by-field mapping (incl. `undefined` → `null` legs)
  - [ ] 1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each file> --lifecycle duplicates` (exit 0)
  - [ ] 1.TE **Test Engineering**:
    • Tier 1: both mapper arms (member hit, unknown throw); conversions round-trip over `Object.values(SurahJuzRef)`
    • Tier 2: boundary near-misses (`"surah_an_nuh"`, case/whitespace variants) all throw
    • Tier 3: deterministic fuzz strings never leak through as values
    • Tier 4: prototype/`__proto__`/function payloads throw, never coerce
    • Layer rules: pure unit tier (no DB, no mocks needed); wire/journey suites re-run at Task 5
    • Run: `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/sessionReportConversions.test.ts`
  - [ ] 1.SEC **Security & Tenancy Audit**: mappers are pure value transforms — assert no
    tenant/identity surface change; fail-closed throw preserved on both sides (never silent null)
  - [ ] 1.SR **Semantic Review**: no dead branches; enums value-imported; no cross-layer
    imports beyond the shipped backend-enum import precedent; map is module-scope read-only
  - [ ] 1.IV **Instruction Verification**: read the AGENTS.md + instruction files printed by
    sub-loop for each file; validate against them
  - Write `outcome/1-mapper-refactor-outcome.md`; mark subtasks `[x]`
  - _Requirements: REQ-6 (all), REQ-0.5_

### Task 2: Vocabulary Expansion — Enum, pgEnum, Migration, Codegen (ATOMIC)

All non-locale mirrors land together so every suite is green at task end (locale tests assert
only their own 35-member list until Task 3).

- [ ] 2. **The 114-surah expansion lands on every structural mirror**
  - Read `outcome/` first
  - **2.1 Dataset verification:** verify plan.md §9 row-by-row against a canonical mushaf
    listing (number, transliteration, Arabic name); copy the exact `ʿ`/`ʾ`/macron glyphs from
    the five shipped EN labels; record any corrections in the outcome file
  - **2.2 TS enum:** `backend/enum/shared/surah-juz-ref.enum.ts` — insert 109 members
    (#6…#114) between `SurahAlMaidah` and `Juz1`, keys/values exactly per §9; reword the file
    header ("5 surahs …" → "114 surahs …"); `isSurahJuzRef` + membership set untouched
  - **2.3 pgEnum:** `backend/db/schema/enums.ts:124-160` — insert the same 109 values in the
    same order into the `surah_juz_ref` array
  - **2.4 DB apply + committed migration:** `bun run db push` (local; additive
    `ALTER TYPE … ADD VALUE`), then `bun run db` → "Generate Drizzle Schema" to commit the
    migration; review the emitted SQL (109 `ADD VALUE` statements; idempotency per the repo's
    `ancient_scarecrow` precedent); NEVER `db reset`/`cleanGenerate`
  - **2.5 Enum unit suite:** `backend/enum/shared/surah-juz-ref.enum.test.ts` — frozen-member
    test 35 → 144 (first 114 = §9 surah values in mushaf order; last 30 = `juz_1..juz_30`);
    FIXTURE AUDIT: `surah_al_furqan` moves to the valid-member expectation (it is §9 #25);
    invalid probes stay `juz_31`/`juz_0`/`page_1`/`surah_an_nuh`; ADD the NEW
    "surah_juz_ref pgEnum ↔ SurahJuzRef mirror parity" describe (order-sensitive,
    byte-identical, 144 — pattern: `backend/enum/notifications/notification-type.enum.test.ts:53-67`)
  - **2.6 Codegen:** `bun run generate:gqlSchema` + `bun codegen`; confirm committed SDL
    (`frontend/graphql/generated/schema.graphql`) carries 144 `SurahJuzRef` values and the
    codegen enum (`frontend/graphql/generated/gql/graphql.ts`) mirrors all 144 keys
  - **2.7 Conversions test growth:** extend `sessionReportConversions.test.ts` with the
    key-parity assertion — sorted `Object.keys(BackendSurahJuzRef)` ≡ sorted
    `Object.keys(CodegenSurahJuzRef)` (144/144; ORDER-INSENSITIVE — the backend enum declares
    mushaf order while codegen emits alphabetically, so a naive order-sensitive compare fails
    both before and after expansion); the round-trip loop auto-grows via `Object.values`
  - **2.8 SDL pin verification:** `bun run test:graphql` — `schema-surface.test.ts`,
    `sdl-static-assertions.test.ts`, `session-sdl.test.ts` pass with ZERO pin edits
  - [ ] 2.QL **Quality Loop**: sub-loop `duplicates` on every touched file (enum, enums.ts,
    both tests, generated SDL excluded from manual lint — codegen artifacts are generated)
  - [ ] 2.TE **Test Engineering**:
    • Tier 1: 144/144 through `isSurahJuzRef`; parity describe asserts order + byte-identity
    • Tier 2: near-miss invalids stay invalid (`juz_31`, `surah_an_nuh`, `juz_0`, case variants)
    • Tier 3: fuzz/unicode/RTL suites unchanged and green
    • Tier 4: coercion/prototype probes unchanged; DB backstop suite re-run
      (`bun run test:db` — `home-work.repository.test.ts` 22P02 probe)
    • Run: `bun run test/scripts/run-test.ts backend/enum/shared/surah-juz-ref.enum.test.ts`,
      `…surah-juz-ref.locale-conformance.test.ts` lands in Task 3 (not yet)
  - [ ] 2.SEC **Security & Tenancy Audit**: additive-only migration (no rewrite, no data
    change); closed vocabulary intact; no new endpoint; push/generate only (no reset)
  - [ ] 2.SR **Semantic Review**: existing 35 members byte-identical (diff the 5 frozen rows);
    declaration order = §9; migration matches drizzle schema exactly; enums value-imported;
    zero stale "35" references in touched files
  - [ ] 2.IV **Instruction Verification**: read printed AGENTS.md/instructions (schema layer
    rules esp. `backend/db/schema/AGENTS.md` push/migrate policy); validate
  - Write `outcome/2-vocabulary-expansion-outcome.md`; mark subtasks `[x]`
  - _Requirements: REQ-1 (all), REQ-2.4, REQ-5.1, REQ-5.2, REQ-8 (all)_

### Task 3: Locale Label Growth (en/ar) + Completeness Guards

- [ ] 3. **All 144 members carry localized labels, machine-enforced**
  - Read `outcome/` first
  - **3.1 Contract:** `shared/locale/types/sessions/labels.ts:383-390` — reword the
    `surahJuzLabel` doc ("exhaustive over the 144-member vocabulary (114 surahs + 30 juz)");
    ADD `readonly surahJuzSurahGroupLabel: string;` and `readonly surahJuzJuzGroupLabel: string;`
  - **3.2 EN leaf:** `shared/locale/en/sessions/labels.ts` — replace the `surahJuzLabel`
    if/switch body (`:172-247`) with the module-scope `SURAH_JUZ_LABELS` Record (144 entries
    from §9) + `?? ref` fallback (plan §8.E); add the two group keys ("Surahs", "Juzs")
  - **3.3 AR leaf:** `shared/locale/ar/sessions/labels.ts` — mirror with §9 Arabic labels
    ("سورة " + name; juz with Arabic-Indic digits "الجزء ١".."الجزء ٣٠"); add the two group
    keys ("السور", "الأجزاء")
  - **3.4 Parity belt:** `shared/locale/sessions-namespace.parity.test.ts:594-653` — grow
    `SURAH_JUZ_REFS` to the 144-member list (§9), retitle the describe 35 → 144, adjust the
    prefix-guard slices (114 surah / 30 juz); add non-empty assertions for the two new flat keys
  - **3.5 NEW conformance test:** `backend/enum/shared/surah-juz-ref.locale-conformance.test.ts`
    — for EVERY `Object.values(SurahJuzRef)`: EN label non-empty + Latin script +
    "Surah "/"Juz " prefix; AR label non-empty + Arabic script + "سورة "/"الجزء " prefix
    (backend-side so importing the shared leaves is legal)
  - [ ] 3.QL **Quality Loop**: sub-loop `duplicates` per touched file (exit 0)
  - [ ] 3.TE **Test Engineering**:
    • Tier 1: 144/144 labels resolve in BOTH locales; unknown-ref passthrough rides raw
    • Tier 2: empty-string ref → raw empty (never throws); Arabic-Indic digit spot-checks
    • Tier 3: n/a (pure data) — keep fuzz inputs hitting the `?? ref` fallback
    • Tier 4: hostile ref strings (`%`, `_`, `\\`) ride raw — never interpreted
    • Run: `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts`,
      `… backend/enum/shared/surah-juz-ref.locale-conformance.test.ts`,
      `… shared/locale/errors-namespace.parity.test.ts` (adjacent belt stays green)
  - [ ] 3.SEC **Security & Tenancy Audit**: leaf purity (no logic beyond the one-line
    fallback); no `shared/` → backend imports (conformance test lives backend-side)
  - [ ] 3.SR **Semantic Review**: fail-closed passthrough preserved; no hardcoded UI strings;
    group keys typed in the contract; zero dead entries (every label reachable)
  - [ ] 3.IV **Instruction Verification**: `shared/locale/AGENTS.md` leaf-purity +
    single-export rules (`:27-31`) + `shared/AGENTS.md` namespace rules;
    validate each leaf against them
  - Write `outcome/3-locale-labels-outcome.md`; mark subtasks `[x]`
  - _Requirements: REQ-4 (all), REQ-5.3, REQ-0.5_

### Task 4: Teacher Picker Upgrade — Grouped Searchable Autocomplete

- [ ] 4. **The 144-option picker becomes searchable and grouped**
  - Read `outcome/` first
  - **4.1 Picker:** `frontend/views/teacher/sessions/TeacherSessionReportDialog.parts.tsx` —
    replace the `FormControl`+`Select` block (`:70-84`) with a grouped, filtering MUI
    `Autocomplete` per plan §8.F: `options = SURAH_JUZ_OPTIONS` (144), `groupBy` =
    surah/juz via the two Task-3 group labels, `getOptionLabel` = `t.surahJuzLabel(option)`,
    value = `block?.surahJuz ?? null`, `onChange` null → clear block (shipped contract,
    `handleSurahChange :106-117`), `renderInput` keeps `surahJuzPickerLabel` as the floating
    label; reword the stale "35-member" comment (`:18` — REQ-7.3); thread the two group-label props
    through `AssignmentBlockProps` and the dialog's label wiring
  - **4.2 Form-state audit:** confirm `normalizeBlock` / `validateReportForm`
    (`teacherSessionReportDialog.helpers.ts`) need NO changes (value-based
    `isSurahJuzRef`); confirm `TeacherSessionReportSubmitForm.tsx` label threading compiles
  - **4.3 Adjacent surfaces:** verify read-only label renderers
    (`TeacherSessionReportHomeworkReview.tsx:56`, `TeacherPrepHomeworkList.tsx:88`) render
    new members via `t.surahJuzLabel` with no edits; run their helper tests; re-confirm no
    `frontend/stories/` entry or component test pins the picker's option count (REQ-7.4 —
    verified absent at plan time)
  - [ ] 4.QL **Quality Loop**: sub-loop `duplicates` on every touched file (exit 0)
  - [ ] 4.TE **Test Engineering**:
    • Tier 1: picker renders 144 options grouped 114/30; clear → block null; pick → block set
    • Tier 2: empty/unknown label fallback (raw ref rides); RTL rendering of AR labels
    • Tier 3: rapid re-type filtering; null-option edge; memo re-render parity with the
      shipped `React.memo` posture
    • Tier 4: no user-supplied string ever becomes a stored value without `isSurahJuzRef`
      (normalizeBlock arm re-asserted)
    • Layer rules: pure component/helper unit tests; the E2E Paymob suite is unrelated — do
      NOT touch; run helper suites via run-test wrapper
  - [ ] 4.SEC **Security & Tenancy Audit**: BOPLA — submit payload still built
    field-by-field (`buildSubmitPayload`); no `{ ...block }` spread into the mutation input
    beyond the shipped shape; picker is pure UI (no authz surface)
  - [ ] 4.SR **Semantic Review**: no hardcoded strings (labels via `t`); MUI v9 style
    compliance (`sx` callbacks, no style props, no hardcoded colors); no dead Select imports;
    comments describe domain behavior only
  - [ ] 4.IV **Instruction Verification**: read printed AGENTS.md/instructions
    (`frontend/views/AGENTS.md`, `frontend.instructions.md`); validate
  - Write `outcome/4-picker-upgrade-outcome.md`; mark subtasks `[x]`
  - _Requirements: REQ-7 (all), REQ-4.3_

### Task 5: Wire + Journey + Service Regression Locks

- [ ] 5. **The four ticket scenarios are pinned end-to-end, including the wire gap**
  - Read `outcome/` first
  - **5.1 Wire probes (NEW):** `backend/graphql/test/session-report.wire.test.ts` — add the
    invalid-enum-VALUE denials on BOTH closed channels per the suite's pinned preset contract
    (`:26-31`, `:919-946`): (a) authenticated teacher submits via the raw-document helper
    with variables `homework.jadid.surahJuz = "Juz99"` and a `"SurahAlFurqanTypo"`-style
    near-miss → `BAD_USER_INPUT` (variable-coercion preset), `data` absent, zero DB side
    effects; (b) a document-literal variant (invalid enum literal in the query text) →
    `GRAPHQL_VALIDATION_FAILED` (validation preset) — both deaths are pre-resolver (contrast
    the field-smuggle probes at `:902-912`); keep `SIGMA_SUBMIT_INPUT`
    (`:229-230`) + row assertions (`:482-485`) as the ticket's literal AC pair
    (SurahAlBaqarah + Juz30, non-contiguous)
  - **5.2 Journey extension:** `test/workflows/classes/session-report-homework.journey.test.ts`
    — add one accepted step pairing a NEW far-vocabulary member (jadid `SurahAnNasr` #110 +
    madi `Juz3`) through the real service; wrap with `sideEffectSnapshot`/`expectNoDeltas`;
    reword the hostile `surah_an_nuh` window comment (`:746-749`) to the 144-member reality
    (payload itself unchanged — still invalid)
  - **5.3 Service suites:** `backend/services/classes/session-report.guards.test.ts` —
    "accepts EVERY shipped member" title/count 35 → 144 (body iterates `Object.values`);
    hostile-fixture audit sweep (all invalid strings checked against §9);
    `session-report.service.test.ts` re-run green
  - **5.4 Repo backstop:** re-run `backend/db/test/repo/classes/home-work.repository.test.ts`
    (22P02 probe `juz_99`-style stays invalid); `backend/db/test/entity-setup.ts`
    `createTestHomeWork` needs no
    change (override takes members — spot-add one new-member fixture row to the insert test if
    the suite's coverage rules call for it)
  - [ ] 5.QL **Quality Loop**: sub-loop `duplicates` on every touched file (exit 0)
  - [ ] 5.TE **Test Engineering**:
    • Tier 1: each new test's both arms (deny + accept) execute
    • Tier 2: value near-misses (`Juz99`, `Juz0`, casing) denied; far-vocabulary pair stored
    • Tier 3: hostile sweep stays sequential (await-in-loop rule); no concurrency in suites
    • Tier 4: unauthenticated + non-teacher 401/403 matrix re-verified untouched
    • Layer rules: wire suite = dev server (`setupTestServerLifecycle` + `testClient`,
      translated copy from `getServerTranslations("en")`); journey = real services + real DB,
      committed fixtures + tracked `afterAll`, NO `runInRollback`
    • Run: `bun run test/scripts/run-test.ts test/workflows/classes/session-report-homework.journey.test.ts`,
      then `bun run test:graphql` (wire + SDL), `bun run test:db` (backstop)
  - [ ] 5.SEC **Security & Tenancy Audit**: denial asserts ZERO side effects (BOLA/BFLA
    unchanged — no new operation); pre-resolver death means no service/DB execution for bad
    values (assert no report row, no homework row, no notification publish)
  - [ ] 5.SR **Semantic Review**: no `expect().rejects.toThrow` inside `runInRollback`;
    `tx` threaded to every repo call in db-tier tests; journey cleanup tracked; zero plan-artifact
    references in test comments
  - [ ] 5.IV **Instruction Verification**: read printed AGENTS.md/instructions
    (`test/workflows/AGENTS.md`, `backend/db/test/AGENTS.md`, `tests.instructions.md`)
  - Write `outcome/5-regression-locks-outcome.md`; mark subtasks `[x]`
  - _Requirements: REQ-2 (all), REQ-3 (all), REQ-9 (all), REQ-5 (verification)_

### Task 6: Documentation & Knowledge Propagation

- [ ] 6. **Canonical docs reflect the 144-member reality**
  - Read `outcome/` first
  - **6.1 Canonical doc:** `docs/sessions/session-report-homework.md` — §5 "Surah/Juz UI" row
    (`:89`): "(5 surahs + 30 juz)" → "(114 surahs + 30 juz)", describe the record-literal label
    map + `?? ref` fallback + the parity/conformance guards; fix the "use codegen members
    only" wording to match the shipped reality (form state carries the backend enum; wire
    values are codegen keys; conversions are parity-tested); roll-file table row `:119`
    reworded (enum file EXTENDED, not Created)
  - **6.2 Vocabulary reference (NEW):** `docs/curriculum/surah-juz-ref-vocabulary.md` —
    naming rules (D8), the five mirrors + their parity guards, fixture near-collision rules
    (`surah_al_furqan` valid / `surah_an_nuh` invalid), migration/rollout notes; follow the
    docs structure (Why → Pattern → Rules → What NOT to do → Rollout → Related)
  - **6.3 Decision + readiness:** `docs/specs/open-decisions-and-gaps.md:135-139` — append a
    runtime-status note to B.11 (all 114 surahs shipped as of this plan);
    `docs/planning/PRODUCTION_READINESS.md:328` — tick row 8.21 with verification reference
  - [ ] 6.QL **Quality Loop**: sub-loop `duplicates` on each touched doc-adjacent file (docs
    are markdown — run the loop where the tool accepts them; otherwise lint-scope the code files)
  - [ ] 6.TE **Test Engineering**: n/a (documentation) — verify all cited `path:line` refs in
    the new doc resolve (grep each)
  - [ ] 6.SEC **Security & Tenancy Audit**: no credentials/PII in docs; no env keys leaked
  - [ ] 6.SR **Semantic Review**: docs describe behavior, not plan artifacts; AGENTS.md and
    `.agents/instructions/` are NOT touched (hand-curated only)
  - [ ] 6.IV **Instruction Verification**: root AGENTS.md doc rules; docs/ structure rules
  - Write `outcome/6-docs-propagation-outcome.md`; mark subtasks `[x]`
  - _Requirements: REQ-10, REQ-1 (verification), Success Criteria (docs)_

### Task 7: Final Quality Gate & Deferred-Items Enforcement

- [ ] 7. **Zero unresolved ledger rows · zero new baseline errors · full matrix green**
  - Read `outcome/` first
  - **7.1 Deferred enforcement (row-scoped — the ledger's legend prose legitimately contains
    the glyphs, so the gate scopes to table rows):**
    ```bash
    grep -E '^\| D[0-9]+' ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/deferred-items.md | grep -c '❌\|⚠️'
    # Expected: 0 (handed-off rows carry 🔄, never ❌/⚠️)
    ```
  - **7.2 Baseline comparison:** re-run the three baseline commands; document deltas in the
    outcome (zero NEW errors introduced)
  - **7.3 Full matrix:**
    - `bun run test/scripts/run-test.ts backend/enum/shared/surah-juz-ref.enum.test.ts`
    - `bun run test/scripts/run-test.ts backend/enum/shared/surah-juz-ref.locale-conformance.test.ts`
    - `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts`
    - `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/sessionReportConversions.test.ts`
    - `bun run test:db` · `bun run test:services` · `bun run test:graphql`
    - `bun run test/scripts/run-test.ts test/workflows/classes/session-report-homework.journey.test.ts`
    - `bun run test/scripts/run-test.ts test/workflows/classes/session-report-cross-teacher.journey.test.ts`
    - `bun run test/scripts/run-test.ts test/workflows/parents/parent-monitoring.journey.test.ts`
    - `bun run test/scripts/run-test.ts test/workflows/admin/academic-tracking.journey.test.ts`
  - **7.4 Stale-sweep (code + docs + tests):** after Task 6's doc fixes, this grep must return
    ZERO hits —
    `grep -rn "35-member\|5 surahs" backend/ shared/ frontend/ app/ test/ docs/ | grep -v "docs/planning/"`
    Additionally reword the stale SurahJuzRef vocabulary comments the sweep pattern misses:
    `backend/graphql/pothos/shared/enum.pothos.ts:32` ("5 surahs + 30 juz" registry bullet)
    and `:419-421` (registration doc), and the "recitation enum" misnomers for SurahJuzRef in
    `backend/graphql/test/schema-surface.test.ts` (comments around `:865` and `:1367`) —
    comment-only edits, no assertion changes
  - **7.5 Quality gate:** `bun quality-gate` green (resumes from last failed stage; NEVER clear
    caches)
  - [ ] 7.QL · 7.TE · 7.SEC · 7.SR · 7.IV: the gate IS the verification (matrix + gate + sweep);
    semantic review = confirm every REQ's acceptance criteria demonstrably green
  - Write `outcome/7-final-gate-outcome.md` (matrix results, baseline delta, ledger state);
    mark subtasks `[x]`
  - _Requirements: REQ-0 (all), REQ-10, Success Criteria (all)_

## Traceability Matrix

| REQ | Title | Tasks |
|---|---|---|
| REQ-0 | Pre-Implementation Baseline & Execution Protocol | 0, 7 |
| REQ-0.5 | Translation System & Enum Import Compliance | 1, 3 (compliance gate on every task) |
| REQ-1 | Full 114-Surah Vocabulary Expansion | 2 (2.1-2.4), 6, 7 (7.4 stale-sweep — REQ-1.5) |
| REQ-2 | Surah/Juz Validation Gates — Verified & Extended | 1 (mapper arms), 2 (2.5 fixture audit), 5 (5.1, 5.3, 5.4) |
| REQ-3 | Non-Contiguous Assignments — Regression Lock | 5 (5.1 AC pair, 5.2 far-vocabulary pairing) |
| REQ-4 | Localized Labels for the Full Vocabulary | 3 (all), 4 (4.1 group labels in use) |
| REQ-5 | Cross-Mirror Parity Guards | 2 (2.5 parity, 2.7 key parity), 3 (3.5 conformance) |
| REQ-6 | Scalable Enum Mappers | 1 (all) |
| REQ-7 | Teacher Picker at 144 Scale | 4 (all) |
| REQ-8 | GraphQL SDL & Codegen Synchronization | 2 (2.6, 2.8) |
| REQ-9 | Journey & Cross-Actor Regression Extension | 5 (5.2), 7 (cross-actor journeys re-run) |
| REQ-10 | Outcome Knowledge Base & Progress Tracking | 0, 1-7 (outcome files), 6, 7 |

**END OF tasks.md — Surah/Juz Enum Homework Tracking — v1.0 (2026-10-04)**
