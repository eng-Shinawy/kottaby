# Implementation Tasks: On-Demand Matching Algorithm (Filter/Sort Pipeline)

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline`
> **Specs of record:** `specs.md` REQ-001…REQ-021 · `plan.md` D1–D14 · ledger: `deferred-items.md`.
> **Ticket:** `docs/planning/TICKETS.md:1457-1505` — Dev 3, Milestone 2, 8 SP (B.10, A.6, FR-4.4). **Governing ruling:** this plan ships the matching ALGORITHM (storage + parsers + types + repo read + `TeacherMatchingService` + INV-A3 read-side predicate + canonical empty-state copy + full test locks). ZERO GraphQL, ZERO frontend, ZERO public-operations changes — the browse API/UI is the sibling `:1509` ticket.

## Non-Negotiable Execution Protocol

1. **Pre-Execution Outcome Knowledge Read:** before ANY task, read ALL files in `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/outcome/`.
2. **Per-File Quality Verification Loop:** after EVERY file edit, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0 before moving on; auto-discovers + prints applicable AGENTS.md and `.agents/instructions/*.md` — read ALL printed files).
3. **Test runner discipline:** NEVER raw `bun test` — always `bun run test/scripts/run-test.ts <path>` (log capture; `--last --focus "<pattern>"` for AI-optimized review).
4. **Semantic Review (.SR):** the mechanical loop cannot detect races, dead branches, BOPLA spreads, enum-import mistakes — the `.SR` checklist runs before every `[x]`.
5. **Post-Execution Outcome File:** write `outcome/<task-id>-outcome.md` (research, changes, cross-file deps, carry-overs) after every task.
6. **Checkbox discipline:** update `[ ]` → `[x]` in THIS file as subtasks complete.
7. **Ledger gate:** final task verifies `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/deferred-items.md` = 0.

**Mandatory 5-stage subtask pipeline (strict order) for EVERY implementation task X.Y:** `X.Y.QL` (per-file sub-loop) → `X.Y.TE` (4-Tier test engineering) → `X.Y.SEC` (BOLA/BOPLA/BFLA/sanitization) → `X.Y.SR` (semantic review) → `X.Y.IV` (instruction verification). Journey tests are written TEST-FIRST (task 2.1 precedes the service task 2.3).

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Baseline & ledger initialization
- [ ] 0.1 Record baseline and seed the ledger
  - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`; record `bun run check:unused` exit status in the outcome file
  - Confirm `deferred-items.md` exists and carries the six resolved-pointer seeds (GraphQL/UI, write path, student recitation home, INV-A4, auto-offline, TOCTOU re-assert)
  - Write `outcome/0.1-baseline-outcome.md` (baseline counts + the no-GraphQL/no-frontend ruling diffs to re-verify at closure)
  - _Requirements: REQ-001_

## Phase 1: Storage, Types, Parsers & i18n

### 1.1 Schema: matcher columns + in-session index (db push)
- [ ] 1.1 Add `teacher.recitations` + `teacher.languages` + `session_teacher_id_status_idx`
  - Edit `backend/db/schema/teachers/teacher.ts` (add the two nullable `varchar(255)` columns after `subjects` `:29`, with the doc comments from `plan.md` §2.2); edit `backend/db/schema/classes/session.ts` (append `index("session_teacher_id_status_idx").on(t.teacherId, t.status)` to the index list `:87-91`)
  - Run `bun run db push`; verify `git diff backend/db/migration/**` is EMPTY; confirm `TeacherSelectType` picks both columns up via `$inferSelect` (tsgo)
  - No pgEnum, no junction table, no codegen (D14)
  - [ ] 1.1.QL: `bun run scripts/health/sub-loop.ts backend/db/schema/teachers/teacher.ts --lifecycle duplicates` then `... backend/db/schema/classes/session.ts ...` (exit 0)
  - [ ] 1.1.TE: extend the schema-touching repo coverage via task 2.2's suite (no standalone schema test file); verify `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/teacher.repository.test.ts` still green after push
  - [ ] 1.1.SEC: confirm no new externally-writable surface (columns are read by the matcher; write path deferred with ledger pointer); no PII stored (catalog enum values + language tokens)
  - [ ] 1.1.SR: enums imported as values where used at runtime; no dead branches; push (not migrate) honored
  - [ ] 1.1.IV: read the AGENTS.md + instruction files printed by sub-loop (`backend/db/schema/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`) and validate
  - Write `outcome/1.1-schema-outcome.md`; mark `[x]`
  - _Requirements: REQ-003 (003.1–003.5)_

### 1.2 Canonical matcher types + contract export + static pins
- [ ] 1.2 Create `backend/types/teachers/teacher-matching.types.ts` (+ export `TeacherMatchingLanguagesInput`)
  - Create the types file exactly per `plan.md` §2.3 (`TeacherMatchingIntent`, `TeacherMatchingSubmitInput`, `TeacherMatchingItemReturnType`, `TeacherMatchingPageReturnType`, `TeacherMatchingStudentContext`); add the additive `export` keyword to `type TeacherMatchingLanguagesInput` in `backend/types/contracts/teacher-availability.contract.types.ts:25`
  - Add the types file to the `backend/types/teachers/index.ts` barrel (`export * from "./teacher-matching.types";` — `./` relative only; the barrel line covers every export in the new file; the separate additive `export` keyword on `TeacherMatchingLanguagesInput` lands in the contracts file as specified above)
  - Create `backend/types/teachers/teacher-matching.types.static-assertions.test.ts` pinning exact keyof sets + PII absence (mirror `teacher-availability.types.static-assertions.test.ts`)
  - Run contracts suites: `bun run test/scripts/run-test.ts backend/types/contracts/contracts.static-assertions.test.ts` (+ conformance) — zero shape drift
  - [ ] 1.2.QL / 1.2.TE (static-assertion test green via `bun run test/scripts/run-test.ts backend/types/teachers/teacher-matching.types.static-assertions.test.ts`) / 1.2.SEC (PII pins prove no email/phone/hash/timestamp exposure) / 1.2.SR (no local types in service files; contract consumed, not forked) / 1.2.IV (`backend/types/AGENTS.md` + instructions)
  - Write `outcome/1.2-types-outcome.md`; mark `[x]`
  - _Requirements: REQ-004 (004.1–004.6), REQ-013 (copy key dependency), REQ-018 (PII)_

### 1.3 Shared teacher-profile parsers (extraction + extension)
- [ ] 1.3 Create `backend/services/teachers/teacher-profile.mappers.ts`; rewire the admin mapper
  - Move `parseSubjectsJson` + `parseAverageRating` VERBATIM from `backend/services/admin/teacher-directory.mappers.ts:17-30,38-44` into the new canonical home (exported); add `parseTeacherRecitations` (JSON-array members filtered through `isRecitationReading` — VALUE import of the guard) + `parseTeacherLanguages` (string members, degrade-`[]`)
  - Update `backend/services/admin/teacher-directory.mappers.ts` to import both moved parsers from the canonical home (keep `mapTeacherDirectoryRow` in place — NO re-export shim); the admin directory suites must stay green unchanged
  - [ ] 1.3.QL on both touched files (`--lifecycle duplicates` — this task exists to keep jscpd clean)
  - [ ] 1.3.TE: direct parser tests (corrupt payloads: `null`, `""`, `"not json"`, `"[1,2]"`, `'["hafs_an_asim", 42]'`, unicode tokens, max-length) + `bun run test/scripts/run-test.ts` on the admin directory suites + repo test to prove zero regression
  - [ ] 1.3.SEC: parsers never throw on corrupt input (fail-closed degrade); no `console.*`; no user-facing strings in mappers
  - [ ] 1.3.SR: verbatim move (zero behavior change); no dead code left in the admin file; no re-export shim (rule)
  - [ ] 1.3.IV: read printed rule files (`backend/services/AGENTS.md`, `backend/AGENTS.md`, backend instructions)
  - Write `outcome/1.3-mappers-outcome.md`; mark `[x]`
  - _Requirements: REQ-005 (005.1–005.4), REQ-002.3_

### 1.4 i18n: seed the `teacherDirectory` namespace
- [ ] 1.4 Create the namespace per the 6-step recipe (all 13 touchpoints from `plan.md` §2.4)
  - Types interface + types dir barrel + en leaf (`teacherDirectoryEn`) + en dir barrel + ar leaf (`teacherDirectoryAr`) + ar dir barrel + `defineNamespace` handle + namespaces dir barrel + `registry.ts` member + `namespaces/index.ts` re-export + `Translations` member in `shared/locale/types/message.ts` + en/ar `messages.ts` slices + colocated parity test `shared/locale/teacherDirectory-namespace.parity.test.ts`
  - Key: `noTeachersAvailable` — en `"No teachers available"`, ar `"لا يوجد معلمون متاحون"` (verified net-new; the only teacher empty-state copy today is admin-gated `shared/locale/en/adminTeachers/index.ts:56`)
  - NO `Translation` enum (does not exist — forbidden to invent); NO two-arg `getTranslations` (one-arg verified, `shared/locale/server.ts:15-17`)
  - [ ] 1.4.QL on every touched file (`--lifecycle duplicates`)
  - [ ] 1.4.TE: parity test green; `bun tsgo` proves the `Translations` member wiring compiles; run the whole locale suite (`bun run test/scripts/run-test.ts shared/locale/` root or per-file) to prove zero regression
  - [ ] 1.4.SEC: copy carries no data, no interpolation leaks; namespace id follows the `<dir>.<name>` convention (`"teacherDirectory.teacherDirectory"`)
  - [ ] 1.4.SR: barrels use `./` relative paths only; `export *` default; member ordering matches existing registry style
  - [ ] 1.4.IV: `shared/AGENTS.md` + `shared/locale/AGENTS.md` (printed by sub-loop)
  - Write `outcome/1.4-i18n-outcome.md`; mark `[x]`
  - _Requirements: REQ-016, REQ-002.2, REQ-013 (copy half)_

## Phase 2: Matching Core — Journey-First, Repository, Service

### 2.1 Cross-actor journey test (TEST-FIRST — red until 2.3 lands)
- [ ] 2.1 Write `test/workflows/teachers/on-demand-matching.journey.test.ts` per `specs.md` §4 + `plan.md` §4.5
  - Cast via `provisionStudentActor` / `provisionCertifiedTeacherActor` (`test/workflows/helpers/actor-context.ts:88,105`) + `TrackedFixtures`; ONE committing `beforeAll` `db.transaction`; tracked hard-delete `afterAll` + zero-residue re-probes; unique `jrn_matching_<8hex>` fixture prefixes; NO `runInRollback`; never `.rejects.toThrow()` (try/catch + translated substrings)
  - Encode the 9 ordered steps of `specs.md` §4.2 (visibility/ordering; toggle off/on; in-session hide via `SessionLifecycleService.startSession`; complete → reappear via `completeSession` WITH its verified shipped side effects — spy `NotificationEngine.publishReceipts`, assert the completion receipt targets the session's student, register the confirm-prompt notification row for tracked teardown, per `plan.md` §4.5 and the `spyPublication` precedent `test/workflows/sessions/session-lifecycle.journey.test.ts:238-244`; empty browse; non-Arabic filter; non-student caller-miss denial) + the oracle-parity anchor (browse exclusion set ≡ `assertTeacherNotInActiveSession` throw set) + browse-step zero-side-effect assertions (row-count deltas scoped to fixture ids; no dispatches from browse itself)
  - Teacher fixtures via `createTestTeacherRow` overrides (recitations/languages/subjects/averageRating/isOnline/isApproved) + `createTestSession` for the in-session cast; country fixtures via `createTestUser` overrides (`country`/`countryCode`)
  - Run: `bun run test/scripts/run-test.ts test/workflows/teachers/on-demand-matching.journey.test.ts` — EXPECT RED (service missing) until 2.3; the journey is the spec the service must satisfy
  - [ ] 2.1.QL / 2.1.TE (the journey IS the test artifact) / 2.1.SEC (honest roles — real `users`/`students`/`teacher` rows; denial probes included) / 2.1.SR (journey rules 1-12 from `test/workflows/AGENTS.md`) / 2.1.IV (`test/workflows/AGENTS.md`, `.agents/instructions/tests.instructions.md`)
  - Write `outcome/2.1-journey-outcome.md`; mark `[x]`
  - _Requirements: REQ-017, REQ-006.3/006.4 (parity + compose), REQ-013, REQ-019 (journey layer), REQ-020 (zero side effects)_

### 2.2 Repository: `listMatchingCandidates` + repo test suite
- [ ] 2.2 Implement the repo read in `backend/db/repo/teachers/teacher.repository.ts`
  - Add `NormalizedTeacherMatchingFilters` + `TeacherMatchingRowType` (repo-file-local, precedent `:81-95`) + `listMatchingCandidates(filters, limit, offset, tx?: DBQueryExecutor)` with the filter chain, country-tier fragment, `desc nulls last` ordering, joined count sibling — exactly `plan.md` §4.2; `SessionStatus` as VALUE import; NO inline `--` comments in `sql` templates; `(tx ?? db)` executor per the same-file `listDirectory` precedent
  - Extend `backend/db/test/repo/teachers/teacher.repository.test.ts` with a `listMatchingCandidates` suite: eligibility matrix (online/approved/governed/in-session exclusions — incl. a stale-`true` is_online + started-session row proving the compose rule), token filters (recitation/subject/language incl. `"hifz"` vs `"hifz_jadid"` boundary), country tiering (code vs legacy-text vs absent), rating order + NULLS LAST, pagination + honest total + beyond-last page, corrupt-JSON edge, empty result — all `runInRollback` + `tx` to every call, `expectRepoError` discipline, `createTestUser`/`createTestTeacherRow`/`createTestSession` fixtures, never seeds
  - [ ] 2.2.QL (`--lifecycle duplicates` on repo + test file) / 2.2.TE (the suite; 100% branch coverage of the builder + method) / 2.2.SEC (repo binds patterns only — never re-escapes; no hardcoded strings; no business logic in repo) / 2.2.SR (`inArray`+prepared-statements rule N/A but checked; guarded-write rule N/A — read-only; deterministic tiebreak) / 2.2.IV (`backend/db/repo/AGENTS.md`, `backend/db/test/AGENTS.md`, both instruction files)
  - Write `outcome/2.2-repository-outcome.md`; mark `[x]`
  - _Requirements: REQ-006 (006.1–006.4), REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-015, REQ-019 (repo tier), REQ-003.3 (index consumer)_

### 2.3 Service: `TeacherMatchingService.browseAvailableTeachers` + 4-tier suite
- [ ] 2.3 Create `backend/services/teachers/teacher-matching.service.ts` until the journey (2.1) is green
  - One public method per `plan.md` §3.1/§4.1: validation (`isRecitationReading`, intent ∈ {hifz, tajweed}, `resolvePageBounds(input.page ?? 1, input.pageSize ?? undefined, locale)` from `@/backend/services/admin/user-management.query.helpers`), caller resolution (`UserRepository.findById` → `StudentRepository.findById` → `NotFoundError("STUDENT", t.studentHandshakeNotFound)` + bounded `logger.logDomainError`), language resolution truth table, ONE-escape-point pattern builders, repo delegation, mapper projection, envelope return
  - `getServerTranslations(locale)` ONE-arg + `.errorsTranslations` property access; `logger` from `@/backend/lib/logger`; errors from `@/backend/lib/errors`; `tx?: DBQueryExecutor` passthrough (pure read — never `withTransaction`)
  - Create `backend/services/teachers/teacher-matching.service.test.ts` (4 tiers): Tier 1 — branch matrix over validation/language/country resolution (Cartesian per `plan.md` §4.1 table); Tier 2 — null/empty/unicode/50-char tokens, unrated teachers, beyond-last page, corrupt payloads; Tier 3 — `Promise.allSettled` parallel browses (read-only safety), toggle-during-browse snapshot acceptance; Tier 4 — `%`/`_`/`\` wildcard probes, invalid enum payloads (evaluation intent, bogus recitation), non-student caller denial, message assertions via `getServerTranslations(locale).errorsTranslations` (never hardcoded English) — `runInRollback` + `tx` for every DB-touching case, `expectRepoError` + `silenceDomainLog` helpers per the availability-suite pattern
  - [ ] 2.3.QL (`--lifecycle duplicates` on service + test) / 2.3.TE (suite + JOURNEY GREEN: `bun run test/scripts/run-test.ts test/workflows/teachers/on-demand-matching.journey.test.ts`, then the whole layer via the approved runner `bun run test/scripts/run-test.ts test/workflows`) / 2.3.SEC (BOLA: zero ids from input; BOPLA: field-by-field DTO, no `...input` spread; BFLA: student-only contract documented + journey denial; sanitization: token gate before escape) / 2.3.SR (no dead branches; frozen bounded constants; no cross-layer imports; snapshot TOCTOU disclosure in the docblock) / 2.3.IV (`backend/services/AGENTS.md`, `backend/AGENTS.md`, backend + tests instructions)
  - Write `outcome/2.3-service-outcome.md`; mark `[x]`
  - _Requirements: REQ-002 (002.1, 002.3, 002.4), REQ-007, REQ-008, REQ-009, REQ-010, REQ-012, REQ-013, REQ-014, REQ-018, REQ-019 (service tier), REQ-020_

### 2.M Mid-point review gate (backend-scoped — all Phase 1-2 files)
- [ ] 2.M Dispatch parallel review subagents (read-only scope: every file touched by 1.1–2.3) — `review-types` (types + contract export), `review-backend` (service/repo/mappers: TOCTOU, dead code, cross-layer, race conditions), `security-probing` (wildcard injection, BOPLA spreads, governance evasion, PII). Aggregate + dedupe findings; fix within-file; re-run `sub-loop.ts --lifecycle duplicates` per fixed file; re-review until zero feature-specific findings
  - Write `outcome/2.M-midpoint-review-outcome.md`; mark `[x]`
  - _Requirements: REQ-001 (execution protocol), REQ-018, REQ-019_

## Phase 3: Post-Implementation Review Waves (parallel, plan-scoped `git diff --name-only` vs baseline)

- [ ] 3.1 `review-types` wave — canonical naming, no duplicate definitions, `@/` aliases, value-vs-type enum imports across `backend/types/teachers/teacher-matching.types.ts`, the contract edit, and the static-assertion test
- [ ] 3.2 `review-backend` wave — architecture compliance, TOCTOU/race audit, dead code, cross-layer imports over `backend/services/teachers/**`, `backend/db/repo/teachers/teacher.repository.ts`, `backend/services/admin/teacher-directory.mappers.ts`, `backend/db/schema/**` edits
- [ ] 3.3 `security-probing` wave — BOLA/BOPLA/BFLA probes, LIKE-wildcard injection (`%`, `_`, `\`), governance-evasion fixtures, PII sweep of the item projection; confirm `public-operations.ts` byte-identical
- [ ] 3.4 Fix wave — per-file fix subagents using printed instruction files as guardrails; `sub-loop.ts --lifecycle duplicates` exit 0 per fixed file; re-run waves until zero feature-specific findings
  - Write `outcome/3-review-waves-outcome.md` (findings → fixes → re-review verdict)
  - _Requirements: REQ-018, REQ-019, REQ-001.4_

## Phase 4: Final Gate & Knowledge Propagation

### 4.1 Final quality gate & deferred-items enforcement
- [ ] 4.1 Enforce the ledger + baseline comparison
  - `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/deferred-items.md` = 0 (every forward item a ✅ resolved-pointer with its owning ticket)
  - Compare current `bun tsgo` / `bun biome:check` / lint-service / `check:unused` outputs vs `/tmp/baseline-*.txt` — document every delta
  - `bun quality-gate` green end-to-end; ruling diffs verified EMPTY: `git diff backend/graphql/ frontend/ app/ backend/lib/gateway/` (no-GraphQL/no-frontend/no-public-ops ruling held)
  - Write `outcome/4.1-final-gate-outcome.md`; mark `[x]`
  - _Requirements: REQ-001 (001.1–001.4), REQ-021 (gate half)_

### 4.2 Knowledge propagation & documentation
- [ ] 4.2 Consolidate learnings into `docs/teachers/on-demand-matching.md`
  - Read ALL outcome files; extract patterns/gotchas (quoted-token LIKE discipline, oracle-parity compose rule, fail-closed parser direction, JSON-in-varchar capacity check, governance IS-DISTINCT-FROM, NULLS LAST)
  - Create the canonical doc per the docs structure (Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents) in the existing `docs/teachers/` home (siblings: `teacher-availability.md`, `teacher-average-rating.md`); NEVER touch AGENTS.md / `.agents/instructions/**`
  - [ ] 4.2.QL on the new doc (`--lifecycle duplicates`)
  - Write `outcome/4.2-knowledge-propagation-outcome.md`; mark `[x]`
  - _Requirements: REQ-021_

---

## Domain-to-Docs Mapping (knowledge-propagation target)

| Plan domain | Docs subdir | File |
|---|---|---|
| Matching algorithm / teacher directory read path | `docs/teachers/` (existing home) | `docs/teachers/on-demand-matching.md` (task 4.2) |

## Layer-to-Instructions Mapping (per-task rule files — sub-loop.ts auto-discovers and prints them at runtime)

| Task | Files touched | AGENTS.md (absolute) | Instructions (absolute) |
|---|---|---|---|
| 1.1 | `backend/db/schema/teachers/teacher.ts`, `backend/db/schema/classes/session.ts` | `/home/ahmed/Projects/kottaby_kottaby/backend/db/schema/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` |
| 1.2 | `backend/types/teachers/**`, `backend/types/contracts/**` | `/home/ahmed/Projects/kottaby_kottaby/backend/types/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` |
| 1.3 | `backend/services/teachers/**`, `backend/services/admin/teacher-directory.mappers.ts` | `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` |
| 1.4 | `shared/locale/**` | `/home/ahmed/Projects/kottaby_kottaby/shared/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/shared/locale/AGENTS.md` | (none) |
| 2.1 | `test/workflows/teachers/**` | `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md` | `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md` |
| 2.2 | `backend/db/repo/teachers/teacher.repository.ts` + `backend/db/test/repo/teachers/teacher.repository.test.ts` | `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | backend + tests instructions |
| 2.3 | `backend/services/teachers/teacher-matching.service.ts` + `.service.test.ts` | `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | backend + tests instructions |
| 4.2 | `docs/teachers/on-demand-matching.md` | (docs — no layer AGENTS.md) | (none) |

## Requirement Coverage Index (task → locked REQ IDs)

| Task | REQ IDs |
|---|---|
| 0.1 | REQ-001, REQ-001.1–001.4 |
| 1.1 | REQ-003, REQ-003.1, REQ-003.2, REQ-003.3, REQ-003.4, REQ-003.5 |
| 1.2 | REQ-004, REQ-004.1–004.6, REQ-013, REQ-018 |
| 1.3 | REQ-005, REQ-005.1–005.4, REQ-002.3 |
| 1.4 | REQ-016, REQ-002.2, REQ-013 |
| 2.1 | REQ-017, REQ-006.3, REQ-006.4, REQ-013, REQ-019, REQ-020 |
| 2.2 | REQ-006, REQ-006.1–006.4, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-015, REQ-019, REQ-003.3 |
| 2.3 | REQ-002.1, REQ-002.3, REQ-002.4, REQ-007, REQ-008, REQ-009, REQ-010, REQ-012, REQ-013, REQ-014, REQ-018, REQ-019, REQ-020 |
| 2.M | REQ-001, REQ-018, REQ-019 |
| 3.1–3.4 | REQ-018, REQ-019, REQ-001.4 |
| 4.1 | REQ-001, REQ-001.1–001.4, REQ-021 |
| 4.2 | REQ-021 |

**Cross-check command (traceability audit — must print nothing):**
```bash
for r in $(grep -oE 'REQ-[0-9]+' ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/specs.md | sort -u); do grep -q "$r" ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/tasks.md || echo "MISSING: $r"; done
```

## Deferred Items (resolved-pointer seed — authoritative table lives in `deferred-items.md`)

| ID | Forward item | Owning ticket |
|---|---|---|
| D1 | Student browse GraphQL query + SDL + profile projection | `Teacher Directory Browse & Filter API` (`docs/planning/TICKETS.md:1509`) |
| D2 | Student browse UI (route, nav, empty-state rendering) | same sibling ticket |
| D3 | Production write path for `teacher.recitations`/`teacher.languages` | candidate `Cold-Start Bootstrapping (Direct Sheikh Certification)` (`:2314`) — no dedicated profile ticket at plan time |
| D4 | Durable student recitation preference home | `docs/auth/qiraah-selection-and-c5.md:501-531` deferred program |
| D5 | INV-A4 never-resurrect release gating | `In-Session Locking (Hide from Directory)` (`:1338`) |
| D6 | 15-minute inactivity auto-offline sweep | `15-Minute Inactivity Auto-Offline` (`:1298`) |
| D7 | Browse-time TOCTOU re-assert at session creation (SELECT FOR UPDATE) | session-request flow (`Session Request Notification to Teacher`, `:1601` + session engine) |
