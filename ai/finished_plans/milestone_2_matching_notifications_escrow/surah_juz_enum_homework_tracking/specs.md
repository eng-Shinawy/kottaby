# Requirements — Surah/Juz Enum Homework Tracking

**Plan Directory:** `ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/`
**Outcome Directory:** `ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/outcome/`
**Ticket:** Surah/Juz Enum Homework Tracking — `docs/planning/TICKETS.md:1422-1453` (Dev 2 · 3 SP)
**Milestone:** 2 — Matching, Notifications & Escrow
**Blocked By:** Session Report Submission with Homework (Jadid & Madi) — `docs/planning/TICKETS.md:1376-1418` — implemented and archived at `ai/finished_plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/`
**Decision Refs:** B.11 (Surah/Juz enum) — `docs/specs/open-decisions-and-gaps.md:135-139`
**Version:** 1.0 · 2026-10-04

## Introduction

The blocking ticket shipped the complete homework write path: the `home_work` table with two
independent `surah_juz_ref` pgEnum columns (`currentSurahJuz` / `revisionSurahJuz`,
`backend/db/schema/classes/home-work.ts:33,37`), the 35-member vocabulary (5 surahs + 30 juz,
`backend/enum/shared/surah-juz-ref.enum.ts:8-44` mirrored byte-for-byte by the pgEnum at
`backend/db/schema/enums.ts:124-160`), the fail-closed `isSurahJuzRef` type guard
(`surah-juz-ref.enum.ts:55-57`), three-tier enum validation (GraphQL coercion → service guard →
pgEnum backstop), and full non-contiguity support (no constraint anywhere compares the two
columns). The decision text B.11, however, specifies "all 114 Surahs (represented as examples)
and all 30 Juz" — and both predecessor plans explicitly deferred that widening to THIS ticket
(the blocking plan's ledger row D1: "Enum expansion is that ticket's core; its other listed
scenarios … are ALREADY shipped by M1's guards — the plan for that ticket should
verify-then-extend").

This plan therefore runs a **verify-then-extend** posture. The four ticket test scenarios
(valid Surah accepted · valid Juz accepted · non-contiguous fields differ · invalid value
rejected) are already satisfied by shipped code and become regression locks, extended where a
verified gap exists (no wire-tier test pins the enum-VALUE coercion denial — the wire suite
only smuggles unknown FIELDS, `backend/graphql/test/session-report.wire.test.ts:902-912`). The
genuinely new deliverable is the **114-surah expansion** of the vocabulary across every mirrored
surface — TS enum, pgEnum + migration, both locale label maps, codegen, the two exhaustive
mappers (which must be refactored: lint ceilings documented at
`frontend/views/teacher/sessions/sessionReportConversions.ts:30-31` and
`backend/graphql/pothos/classes/home-work.pothos.ts:45-47` cap switch bodies), and the teacher
picker (144 options need grouping + search).

### Feature Summary

Widen the homework Surah/Juz vocabulary from 5 example surahs to the full 114-surah mushaf canon
(144 members total with the 30 juz), keeping validation, non-contiguity, wire contracts, and
localized labels intact and regression-locked end to end.

### Business Value

- Teachers can assign and track homework against any surah of the Quran, not just the five
  shipped examples — the real-world Jadid/Madi curriculum spans the entire mushaf.
- Arabic-first localized labels for all 144 members keep the product's bilingual promise on
  the teacher dialog and every read surface that already resolves `t.surahJuzLabel`.
- Closes decision B.11's spec-vs-runtime discrepancy and ticks readiness row 8.21
  (`docs/planning/PRODUCTION_READINESS.md:328`).

### Scope

**In scope:**

- `SurahJuzRef` TS enum growth 5 → 114 surah members (declaration order = mushaf order), plus
  the byte-identical `surah_juz_ref` pgEnum growth and its committed migration
  (`ALTER TYPE … ADD VALUE`, additive-only).
- Refactor of the two exhaustive enum mappers (backend `toSurahJuzRef`, frontend
  `toCodegenSurahJuzRef`) to scalable guard-based lookups with identical fail-closed semantics.
- Locale label growth for all 144 members in `en` and `ar` sessions-namespace leaves, plus two
  new picker group-label keys; contract doc and parity tests grow with them.
- NEW parity guards: pgEnum ↔ TS-enum mirror parity test, codegen key parity test, and a
  backend-side locale-completeness conformance test.
- Teacher picker upgrade to a grouped, searchable MUI `Autocomplete` (144 options).
- GraphQL SDL regeneration + codegen, and regression locks: wire-tier invalid-enum-VALUE probe,
  journey extension with a far-vocabulary member, hostile-fixture audit, frozen-count test
  updates 35 → 144.
- Documentation: `docs/sessions/session-report-homework.md` vocabulary rows, B.11 runtime-status
  note, `PRODUCTION_READINESS.md` row 8.21, and a canonical vocabulary doc under
  `docs/curriculum/`.

**Out of scope:**

- Read-surface adoption of localized labels by the parent portal / admin academic tracking /
  student homework display (the `formatSurahJuzRef` regex surface) — carried over as ledger row
  D1 with owner "next parent-portal display ticket" (blocking plan's D2; unchanged here).
- Per-surah ayah-count metadata (e.g. validating `toAyah` ≤ the surah's ayah count) — ledger row
  D2, curriculum-stream owner.
- Any schema change beyond enum-value addition (no new tables, columns, constraints, indexes).
- Any new route, navigation entry, or permission change.

### Ground-Truth Baseline (verified 2026-10-04)

| Surface | Location | Status |
|---|---|---|
| `home_work` columns | `backend/db/schema/classes/home-work.ts:33,37` — `currentSurahJuz: surahJuzRef("current_surah_juz")`, `revisionSurahJuz: surahJuzRef("revision_surah_juz")`, both nullable, no pair constraint | EXISTS (frozen) |
| pgEnum (35 values) | `backend/db/schema/enums.ts:124-160` | EXISTS → EXTEND to 144 |
| TS enum + guard | `backend/enum/shared/surah-juz-ref.enum.ts:8-44,55-57` | EXISTS → EXTEND to 144 |
| Service guard | `backend/services/classes/session-report.guards.ts:147-160` — `isSurahJuzRef` → `ValidationError(t.homeworkSurahJuzInvalid)` | EXISTS (frozen) |
| Block mapping | `backend/services/classes/session-report.service.ts:131-144` — jadid → `currentSurahJuz` (:136), madi → `revisionSurahJuz` (:141) | EXISTS (frozen) |
| GraphQL in/out | `backend/graphql/pothos/classes/session-report-input.pothos.ts:42`; output mapper `backend/graphql/pothos/classes/home-work.pothos.ts:54-127` | EXISTS → mapper REFACTOR |
| Pothos registration | `backend/graphql/pothos/shared/enum.pothos.ts:434-436` — `enumType(SurahJuzRef, { name: "SurahJuzRef" })`, auto-picks up members | EXISTS (unchanged) |
| Locale labels | type `shared/locale/types/sessions/labels.ts:389`; en `shared/locale/en/sessions/labels.ts:172-247`; ar `shared/locale/ar/sessions/labels.ts:168-243` | EXISTS → EXTEND to 144 |
| Parity belt | `shared/locale/sessions-namespace.parity.test.ts:594-653` (35-member vocab block) | EXISTS → EXTEND to 144 |
| Enum unit suite | `backend/enum/shared/surah-juz-ref.enum.test.ts` (frozen-35 test; `surah_al_furqan` used as an INVALID fixture) | EXISTS → EXTEND + fixture audit |
| pgEnum↔TS parity test | none (precedent: `backend/enum/notifications/notification-type.enum.test.ts:53-67`) | MISSING → CREATE |
| Codegen key parity test | none | MISSING → CREATE |
| Locale-completeness test | none (parity test hardcodes its own vocab) | MISSING → CREATE |
| Wire invalid-VALUE probe | none — wire suite smuggles unknown FIELDS only (`backend/graphql/test/session-report.wire.test.ts:902-912`) | MISSING → CREATE |
| Frontend conversion | `frontend/views/teacher/sessions/sessionReportConversions.ts:32-104` (`max-switch-cases` ≤ 30 noted at :30-31) | EXISTS → REFACTOR |
| Teacher picker | `frontend/views/teacher/sessions/TeacherSessionReportDialog.parts.tsx:18-19` (`SURAH_JUZ_OPTIONS = Object.values(SurahJuzRef)`, "35-member" comment), Select at :70-84 | EXISTS → UPDATE (Autocomplete) |
| Read-surface display | `frontend/views/parent/monitoring/parentMonitoringDisplay.ts:52-56` regex `formatSurahJuzRef` + consumers (`HomeworkSummary.tsx:7`, `HomeworkTab.parts.helpers.tsx:7,61`, `ProgressSummary.tsx:8`, `ProgressTab.parts.tsx:6,93`, `academic-tracking-display.ts:17,61,87`, `homework.helpers.ts:16,59-60,113-114`) | EXISTS (deferred — ledger D1) |
| Journey | `test/workflows/classes/session-report-homework.journey.test.ts` (JADID/MADI blocks :131-132; hostile `surah_an_nuh` :748-749) | EXISTS → EXTEND |

## Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I want an error baseline and a persistent outcome ledger
before touching code, so that new issues are distinguishable from pre-existing ones and prior
research is never repeated.

#### Acceptance Criteria

1. WHEN implementation begins THEN system SHALL record baseline error counts (`bun tsgo`,
   `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) and store them in
   `outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the deferred-items ledger
   `ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/deferred-items.md`
   SHALL exist (pre-seeded rows: D1 read-surface label adoption, D2 ayah-count metadata).
3. WHEN an agent starts any task THEN system SHALL read ALL files in the plan's `outcome/`
   directory before executing.
4. WHEN an agent completes any task THEN system SHALL write
   `outcome/<task-id>-outcome.md` with research findings, changes, cross-file dependencies, and
   carry-over points.
5. WHEN any subtask completes THEN system SHALL update its checkbox `[ ]` → `[x]` in
   `tasks.md`.
6. WHEN any file is modified THEN system SHALL pass
   `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) on that file
   before moving on.
7. WHEN any subtask is marked complete THEN the agent SHALL complete the semantic review
   checklist (race conditions, env-config, dead code, cross-layer imports, enums-as-values,
   deferred-item logging) — the script cannot detect these.

- **Priority:** High · **Complexity:** Low · **Status:** CREATE (protocol)

## Requirement 0.5: Translation System & Enum Import Compliance

**User Story:** As a developer, I want compile-time-safe translations and correct enum imports,
so that i18n and type errors surface at build time.

#### Acceptance Criteria (verified against the live locale surface)

1. WHEN a client component renders user-facing text THEN system SHALL use
   `useAppTranslation(<NamespaceHandle>)` from `@/shared/locale/client`
   (`shared/locale/client/use-app-translation.ts:8-10`; e.g. the sessions handle
   `Sessions` from `shared/locale/namespaces/sessions/sessions.namespace.ts`) and access labels
   as properties (`t.surahJuzLabel`), never function calls.
2. WHEN a server component renders user-facing text THEN system SHALL use the single-argument
   `getTranslations(locale)` returning the full typed bundle (`shared/locale/server.ts:15-17`).
3. WHEN a service, test, or API route needs copy THEN system SHALL use
   `getServerTranslations(locale)` (`shared/locale/server-graphql.ts:3-5`).
4. WHEN a GraphQL resolver passes locale THEN system SHALL thread `ctx.locale` into the service
   (precedent: `backend/graphql/mutation/classes/session-report.mutation.ts:120`); resolvers
   carry no copy of their own.
5. WHEN an enum is used at runtime THEN system SHALL import it as a value (`import { SurahJuzRef }`),
   never `import type`, and SHALL use members (`SurahJuzRef.SurahAlBaqarah`), never string
   literals where the enum type is expected.

#### Forbidden Patterns (none of these exist in this codebase — do not introduce them)

- ❌ `Translation.<Namespace>` enum — no such type exists; namespace handles are
  `defineNamespace` objects.
- ❌ Two-argument `getTranslations(locale, "namespace")` — the real signature is
  single-argument (`shared/locale/server.ts:15-17`).
- ❌ `useAppTranslation("string-literal")` — handles are passed, not strings.
- ❌ `t('key')` function-call access; `next-intl`; `getBackendTranslations`;
  `shared/messages/` references.
- ❌ Hardcoded UI strings; string literals where `SurahJuzRef` is expected.

- **Priority:** High · **Complexity:** Low · **Status:** CREATE (compliance gate)

## Requirement 1: Full 114-Surah Vocabulary Expansion

**User Story:** As a teacher, I want to assign homework against any surah of the Quran, so that
Jadid and Madi tracking follows the real memorization curriculum.

#### Acceptance Criteria

1. WHEN the expansion lands THEN the `SurahJuzRef` TS enum
   (`backend/enum/shared/surah-juz-ref.enum.ts:8-44`) SHALL carry exactly **144 members** — the
   114 surahs in mushaf order (1 = Al-Fātihah … 114 = An-Nās) followed by the existing 30 juz
   (`Juz1 = "juz_1"` … `Juz30 = "juz_30"`) — with every existing member's key and value
   unchanged.
2. WHEN the expansion lands THEN the `surah_juz_ref` pgEnum (`backend/db/schema/enums.ts:124-160`)
   SHALL list the byte-identical 144 values in the same order (verified by the NEW parity test,
   REQ-5).
3. WHEN the schema change ships THEN the database SHALL receive the 109 new values via
   additive `ALTER TYPE "surah_juz_ref" ADD VALUE …` statements — no table rewrite, no column
   type change, no constraint change, existing rows and their values untouched.
4. WHEN any existing test, fixture, or stored row references a pre-expansion member THEN its
   behavior SHALL be unchanged (renames are forbidden; the 5 shipped surahs keep exact keys,
   values, and labels).
5. IF a code path still assumes 35 members (frozen-count tests, "35-member" comments, hardcoded
   hostile fixtures) THEN the expansion SHALL update it (REQ-2.4, REQ-7.3) — zero stale
   references remain.

- **Priority:** High · **Complexity:** Medium · **Status:** EXTEND (schema + enum; the canonical
  144-row dataset lives in `plan.md` §9 — it is the reviewed source of truth for member keys,
  DB values, and both locale labels)

## Requirement 2: Surah/Juz Validation Gates — Verified & Extended

**User Story:** As the platform, I want only genuine `surah_juz_ref` members stored, so that
homework data stays canonical against a now much wider vocabulary.

#### Acceptance Criteria

1. WHEN a teacher submits a valid Surah member in either block THEN the system SHALL accept and
   store it — EXISTS, verified at three tiers: service guard
   (`backend/services/classes/session-report.guards.ts:147-160`), repo insert
   (`backend/db/repo/classes/home-work.repository.ts:74`), journey step-5 payload blocks
   (`test/workflows/classes/session-report-homework.journey.test.ts:131-132`).
2. WHEN a teacher submits a valid Juz member in either block THEN the system SHALL accept and
   store it — EXISTS, verified (journey `MADI_BLOCK` = `Juz1` at :132; wire `Juz30` at
   `backend/graphql/test/session-report.wire.test.ts:230`).
3. WHEN any non-member value arrives THEN the system SHALL reject it at the earliest tier —
   GraphQL denies pre-resolver on BOTH closed channels per the wire suite's pinned preset
   contract (`backend/graphql/test/session-report.wire.test.ts:26-31,919-946`): a non-member
   value in the variables JSON dies as `BAD_USER_INPUT` (variable-coercion preset), a
   non-member enum literal in the document dies as `GRAPHQL_VALIDATION_FAILED` (validation
   preset) — both with `data` absent and zero side effects. The service guard then throws the
   localized `ValidationError(t.homeworkSurahJuzInvalid)`; the pgEnum is the final DB
   backstop (`22P02`) — EXISTS at service + DB tiers; **EXTEND: NEW wire-tier tests SHALL
   pin the enum-VALUE denials on both channels** (variables `surahJuz: "Juz99"` /
   `"SurahAlFurqanTypo"`-style near-misses via the raw-document helper; a document-literal
   variant) — the verified gap: today's wire suite smuggles unknown *fields* only
   (:902-912), never bad enum *values*.
4. WHEN tests use "invalid" enum fixtures THEN every such string SHALL be audited against the
   144-member vocabulary — e.g. `surah_al_furqan` (enum unit suite, "string that is not a
   member" case) BECOMES VALID because surah 25 ships as `surah_al_furqan`; the journey's
   hostile `surah_an_nuh` (:748-749) STAYS invalid because surah 71 ships as `surah_nuh`
   (naming pinned in `plan.md` §9); the fixture-audit sweep SHALL replace or re-anchor every
   affected fixture with a permanently-invalid probe.
5. WHEN the DB backstop test runs THEN the raw-executor probe
   (`backend/db/test/repo/classes/home-work.repository.test.ts` — `22P02` on an out-of-enum
   insert) SHALL keep passing against a post-expansion near-miss (e.g. `juz_31`, `surah_an_nuh`).

- **Priority:** High · **Complexity:** Medium · **Status:** EXISTS (verified) + EXTEND (wire
  probe, fixture audit)

## Requirement 3: Non-Contiguous Assignments — Regression Lock

**User Story:** As a teacher, I want Jadid on one surah and Madi on a different, non-adjacent
surah or juz, so that revision tracks the student's actual review plan.

#### Acceptance Criteria

1. WHEN the jadid and madi blocks carry different members (e.g. jadid = Surah Al-Baqarah, madi
   = Juz 30) THEN the system SHALL store both independently — EXISTS, verified: the columns are
   independent nullable pgEnums (`backend/db/schema/classes/home-work.ts:33,37`) and no code
   path anywhere compares them (the block mapper is field-by-field,
   `backend/services/classes/session-report.service.ts:131-144`; the guard validates each
   supplied block independently, `session-report.guards.ts:147-160`).
2. WHEN either block is omitted THEN the system SHALL still store the other (optional blocks;
   ≥ 1-block rule unchanged) — EXISTS, verified (jadid-only / madi-only service tests).
3. WHEN the ticket's literal AC pair (current = Surah Al-Baqarah, revision = Juz 30) is
   submitted THEN the wire SHALL round-trip both values — EXISTS, verified at
   `backend/graphql/test/session-report.wire.test.ts:229-230,482-485`; this pairing SHALL remain
   pinned, and the journey extension (REQ-9) SHALL add a far-vocabulary non-contiguous pairing
   on the service path.

- **Priority:** Medium · **Complexity:** Low · **Status:** EXISTS (verified — regression lock; no
  production code change)

## Requirement 4: Localized Labels for the Full Vocabulary

**User Story:** As an Arabic-first user, I want every surah and juz member to render a proper
localized label, so that homework lists, dialogs, and history read naturally in my locale.

#### Acceptance Criteria

1. WHEN any of the 144 members renders THEN `t.surahJuzLabel(ref)`
   (`shared/locale/types/sessions/labels.ts:389`) SHALL return a non-empty label in BOTH
   locales — EN in the shipped diacritic style ("Surah Al-Fātihah", "Surah Al-Anʿām", "Juz 30"),
   AR with the "سورة " / "الجزء " prefixes and Arabic-Indic juz digits ("سورة الفاتحة",
   "سورة الأنعام", "الجزء ٣٠").
2. WHEN a label function is implemented THEN each locale leaf
   (`shared/locale/en/sessions/labels.ts:172-247`, `shared/locale/ar/sessions/labels.ts:168-243`)
   SHALL hold its vocabulary as a module-scope `Readonly<Record<string, string>>` literal with
   the fail-closed fallback `?? ref` — replacing the shipped 5-guard + 30-case if/switch bodies,
   which cannot grow to 144 within the `max-switch-cases` / function-size lint ceilings
   (documented at `sessionReportConversions.ts:30-31` and
   `backend/graphql/pothos/classes/home-work.pothos.ts:45-47`).
3. WHEN the teacher picker groups its options (REQ-7) THEN two NEW flat keys SHALL land in the
   sessions namespace — `surahJuzSurahGroupLabel` ("Surahs" / "السور") and
   `surahJuzJuzGroupLabel` ("Juzs" / "الأجزاء") — across the type contract, both leaves, and
   the parity belt.
4. WHEN the parity belt runs THEN the sessions-namespace vocabulary block
   (`shared/locale/sessions-namespace.parity.test.ts:594-653`) SHALL exercise all 144 members
   (non-empty, script guards, prefix guards, unknown-ref passthrough) — grown from its shipped
   35-member list; the type-contract doc ("exhaustive over the 35-member vocabulary",
   `shared/locale/types/sessions/labels.ts:384-388`) SHALL be reworded to 144.
5. IF a member lacks a label in either locale THEN a NEW backend-side conformance test (REQ-5.3)
   SHALL fail the build (completeness is machine-enforced, not review-enforced).

- **Priority:** High · **Complexity:** Medium · **Status:** EXTEND

## Requirement 5: Cross-Mirror Parity Guards

**User Story:** As a maintainer, I want the vocabulary's mirrored surfaces machine-locked
together, so that no future member addition can land on one mirror and silently drift the
others.

#### Acceptance Criteria

1. The enum unit suite SHALL gain a **pgEnum ↔ TS-enum mirror parity test** — order-sensitive,
   byte-identical, 144 members each — mirroring the shipped precedent
   `backend/enum/notifications/notification-type.enum.test.ts:53-67`. This is the missing link
   today: `surah_juz_ref` has NO direct parity test (the compile-time `never` guard in the old
   mapper only catches pgEnum-side additions, never TS-side ones).
2. A **codegen key parity test** SHALL pin `Object.keys(SurahJuzRef)` ≡
   `Object.keys(codegen SurahJuzRef)` (the Pothos wire values are the TS enum KEYS, registered
   once at `backend/graphql/pothos/shared/enum.pothos.ts:434-436`), guarding the frontend
   conversion map's totality after every codegen run.
3. A **locale-completeness conformance test** (backend-side, where importing shared locale
   leaves is legal) SHALL assert for EVERY `Object.values(SurahJuzRef)` member: non-empty EN
   label with Latin script + "Surah "/"Juz " prefix, and non-empty AR label with Arabic script +
   "سورة "/"الجزء " prefix.
4. The three guards SHALL together close every drift direction: pgEnum↔TS (5.1),
   TS↔codegen-wire (5.2), TS↔labels (5.3) — compensating for the compile-time exhaustiveness
   retired with the old switch mappers (REQ-6).

- **Priority:** High · **Complexity:** Medium · **Status:** CREATE

## Requirement 6: Scalable Enum Mappers

**User Story:** As a developer, I want the DB-value ↔ wire-value mappers to scale past the
30-case lint ceiling, so that the 144-member vocabulary cannot break compilation or lint.

#### Acceptance Criteria

1. WHEN the backend mapper resolves a stored pgEnum string for the wire THEN
   `toSurahJuzRef` (`backend/graphql/pothos/classes/home-work.pothos.ts:54-127`) SHALL be
   replaced by the guard-narrowing form — `if (isSurahJuzRef(value)) return value;` plus the
   fail-closed `throw` — deleting the 5-guard + 30-case switch (the shipped doc comment at
   :45-47 records the function-size lint ceiling that already forbids a 35-case body; 144 is
   impossible). The compile-time `never` guard is retired; its protection moves to the REQ-5
   parity tests.
2. WHEN the frontend mapper converts backend enum values to codegen wire values THEN
   `toCodegenSurahJuzRef` (`frontend/views/teacher/sessions/sessionReportConversions.ts:32-104`)
   SHALL be replaced by a module-scope lookup map (backend value → codegen value) with a
   membership-guarded return and the same fail-closed `throw` on an unmapped value — deleting
   the 5-guard + 30-case switch (`max-switch-cases` ≤ 30 documented at :30-31). The map's
   totality is pinned by the REQ-5.2 key-parity test.
3. WHEN either mapper receives an unknown value THEN behavior SHALL be unchanged: throw
   (backend resolver error / frontend conversion error) — never a silent `null`, never a
   passthrough.
4. WHEN the refactors land THEN every existing test touching the mappers (wire round-trips,
   dialog helpers, document contracts) SHALL keep passing without semantic change.

- **Priority:** High · **Complexity:** Medium · **Status:** UPDATE (refactor-in-place; contract
  unchanged)

## Requirement 7: Teacher Picker at 144 Scale

**User Story:** As a teacher, I want to find the right surah or juz quickly among 144 options,
so that assigning homework stays fast.

#### Acceptance Criteria

1. WHEN the assignment block renders its Surah/Juz control
   (`frontend/views/teacher/sessions/TeacherSessionReportDialog.parts.tsx:70-84`) THEN it SHALL
   present all 144 members through a searchable, grouped MUI `Autocomplete` — two groups
   ("Surahs" / "Juzs", REQ-4.3), option labels via `t.surahJuzLabel(option)` — replacing the
   shipped flat `Select` whose 35-item menu does not scale to a searchable 144-item list.
   MUI v9.4 `Autocomplete` precedent exists in-repo
   (`frontend/views/admin/students/onboarding/OnboardStudentParentSection.tsx`,
   `frontend/views/admin/finances/WalletPickerHeader.tsx`).
2. WHEN the teacher clears the control THEN the block SHALL be cleared (the shipped
   empty-string-clears-block contract, `handleSurahChange` at :106-117, is preserved); when a
   value is picked THEN the form state keeps the backend snake_case enum member (form-state
   contract unchanged; `normalizeBlock`'s `isSurahJuzRef` pre-submit guard at
   `frontend/views/teacher/sessions/teacherSessionReportDialog.helpers.ts` keeps working
   value-based, untouched).
3. WHEN stale comments reference the old vocabulary size THEN they SHALL be updated (the
   "35-member Surah/Juz vocabulary" comment at `TeacherSessionReportDialog.parts.tsx:18`).
4. IF Storybook stories or component tests pin the picker's option count or rendering THEN they
   SHALL be updated in lockstep (none exist today — verified: no story matches
   `SessionReport`/`AssignmentBlock` under `frontend/stories/`).

- **Priority:** Medium · **Complexity:** Medium · **Status:** UPDATE

## Requirement 8: GraphQL SDL & Codegen Synchronization

**User Story:** As an API consumer, I want the schema and generated types to carry the full
vocabulary, so that clients can submit and render any member.

#### Acceptance Criteria

1. WHEN the enum grows THEN the committed SDL (`frontend/graphql/generated/schema.graphql`)
   SHALL regenerate with 144 `SurahJuzRef` values via `bun run generate:gqlSchema` +
   `bun codegen` — the Pothos registration itself is untouched
   (`backend/graphql/pothos/shared/enum.pothos.ts:434-436` auto-picks up members).
2. WHEN the SDL pinning suites run THEN they SHALL keep passing without pin changes:
   `backend/graphql/test/schema-surface.test.ts:3464` (`enum SurahJuzRef {` containment —
   member-list-agnostic), the define-exactly-once assertion in
   `backend/graphql/test/sdl-static-assertions.test.ts`, and the `SessionHomeWork` field-order
   pin (`backend/graphql/test/session-sdl.test.ts:330-341` — no field changes).
3. WHEN codegen regenerates THEN the codegen `SurahJuzRef` enum
   (`frontend/graphql/generated/gql/graphql.ts`) SHALL mirror all 144 members (keys =
   wire values) — pinned by the REQ-5.2 parity test.
4. IF any committed document test hardcodes a member list THEN the regen SHALL keep those
   members valid (existing wire members are unchanged, so no document edits are expected).

- **Priority:** High · **Complexity:** Low · **Status:** EXTEND (regen + verify)

## Requirement 9: Journey & Cross-Actor Regression Extension

**User Story:** As the platform, I want the expanded vocabulary proven through the real
multi-actor pipeline, so that "it compiles" never substitutes for "it works".

#### Acceptance Criteria

1. WHEN the journey suite runs THEN `test/workflows/classes/session-report-homework.journey.test.ts`
   SHALL gain one accepted submission whose jadid block uses a NEW far-vocabulary surah member
   (e.g. `SurahAnNasr` / `surah_an_nasr`, #110) and whose madi block uses a juz member —
   proving resolver → service → repo → DB → read-surface round-trip for a post-expansion value,
   with the existing side-effect oracle (`sideEffectSnapshot` /
   `expectNoDeltas`) asserting no unintended writes.
2. WHEN existing journey fixtures run THEN they SHALL keep passing unchanged (all shipped
   members keep their values; the hostile `surah_an_nuh` payload at :748-749 remains invalid —
   its explanatory comment SHALL be reworded from "the shipped enum window
   surah_al_fatihah..surah_al_maidah + juz_1..30" to the 144-member reality).
3. WHEN the cross-actor read surfaces return the new member THEN parent
   (`test/workflows/parents/parent-monitoring.journey.test.ts`), admin
   (`test/workflows/admin/academic-tracking.journey.test.ts`), and
   student surfaces SHALL surface it with their shipped shapes — no structural change; label
   rendering on those surfaces remains the deferred D1 surface (ledger).
4. WHEN the service guard suite runs THEN its "accepts EVERY shipped SurahJuzRef member"
   integration test (`backend/services/classes/session-report.guards.test.ts`) SHALL
   automatically cover 144/144 members via `Object.values(SurahJuzRef)` (title/count wording
   updated), and its invalid-fixture strings SHALL pass the REQ-2.4 audit.

- **Priority:** High · **Complexity:** Medium · **Status:** EXTEND

## Requirement 10: Outcome Knowledge Base & Progress Tracking

**User Story:** As a future agent, I want each task's research and outcomes persisted, so that
no analysis is ever repeated.

#### Acceptance Criteria

1. WHEN any task starts THEN the executing agent SHALL have read every file in the plan
   `outcome/` directory (REQ-0.3).
2. WHEN any task completes THEN `outcome/<task-id>-outcome.md` SHALL exist with research
   findings, implementation details, and carry-over points (REQ-0.4).
3. WHEN any subtask completes THEN its checkbox in `tasks.md` SHALL be `[x]` (REQ-0.5).
4. WHEN the plan completes THEN the final gate SHALL verify zero unresolved ledger rows
   (deferred-items.md) and a baseline comparison documenting no new errors.

- **Priority:** High · **Complexity:** Low · **Status:** CREATE (protocol)

## UX/Navigation Requirements

**Ruling: NO new routes, pages, navigation entries, or permission changes.** The vocabulary
expansion rides the existing session-report / homework surfaces; every route below already
exists and ships its own access control. No sidebar item, tab, or mobile bottom-nav entry is
added or moved.

### Affected Existing Routes (all access rules unchanged)

| Route | Purpose | Access (as shipped) | What changes here |
|---|---|---|---|
| `/teacher/sessions` | Teacher sessions list + report/homework dialog | `withPageAuth({ roles: [UserRole.Teacher] })` (`app/(dashboard)/teacher/sessions/page.tsx:33`) | Picker becomes grouped searchable Autocomplete over 144 members |
| `/student/sessions` | Student participant read of report/homework | Student-only (`app/(dashboard)/student/sessions/page.tsx:33`) | No structural change; new members render through existing shapes |
| `/homework` | Student homework history | Student-only (`app/(dashboard)/homework/page.tsx:35`) | No structural change; label adoption remains ledger row D1 |
| `/parent/children/[studentId]` | Parent monitoring portal (homework tab) | Parent-only (`app/(dashboard)/parent/children/[studentId]/page.tsx:64`) | No structural change; label adoption remains ledger row D1 |
| `/admin/academic-tracking`, `/admin/academic-tracking/[studentId]` | Admin academic tracking | Admin-only (`app/(dashboard)/admin/academic-tracking/page.tsx:37`) | No structural change; label adoption remains ledger row D1 |

### Role-Based Access Matrix (unchanged by this plan)

| Role | Homework write (submitSessionReport) | Homework reads | Picker surface |
|---|---|---|---|
| Teacher | Yes — own completed sessions only (`session-report.mutation.ts:77-82` role gate + service ownership) | `sessionReport` / `sessionHomework` / `studentHomeworkHistory` | Grouped Autocomplete |
| Student | No | `myHomework` own history | Read-only labels |
| Parent | No | Monitoring portal five-query set (linked child) | Read-only labels (D1 surface) |
| Admin | No | Academic-tracking read models | Read-only labels (D1 surface) |

### Per-Audience Rendering

| Audience | Difference |
|---|---|
| Teacher | Selects from the full 144-member grouped/searchable picker; localized labels |
| Student / Parent / Admin | Read-only display of stored members; localized label adoption on these surfaces stays deferred (ledger D1) — the shipped `formatSurahJuzRef` regex keeps mechanically splitting the new CamelCase keys |

## Cross-Actor Workflow Journey

The submission workflow and its state machine are UNCHANGED by this plan; the journey below is
the regression surface the expansion must not disturb. It maps onto the EXISTING
`test/workflows/classes/session-report-homework.journey.test.ts` (extension per REQ-9), not a
new journey file.

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Teacher | `teacher` | submit report + homework (jadid/madi blocks, any of the 144 members) for own completed session; grade previous homework once | submit for others' sessions; write grades twice |
| Student | `student` | observe own homework via `myHomework` / participant reads | submit or mutate homework |
| Parent | `parent` | observe linked child's homework via monitoring portal | submit; read unlinked children |
| Admin | `admin` | observe academic-tracking read models | submit |

### Ordered Steps (teacher assigns → actors observe)

1. Teacher → submits report with jadid = `surah_an_nasr` (NEW member), madi = `juz_3` →
   exactly one `home_work` row stores both members independently; notifications publish after
   commit; **no other actor's data changes**.
2. Student → reads participant homework → sees the same row with both members (non-contiguous
   pairing preserved end to end).
3. Parent → reads monitoring portal homework tab → sees the same members through the read
   model.
4. Admin → reads academic-tracking latest-position lanes → jadid/madi positions resolve the new
   member through the fail-closed narrowers (`narrowSurahJuzRef`,
   `backend/db/repo/admin/academic-tracking-query-helpers.ts:281-289`).
5. Foreign teacher → attempts the same submission → `SESSION_NOT_FOUND` (denial oracle
   unchanged); a non-member surah value → localized `homeworkSurahJuzInvalid` denial with zero
   side effects.

### Observer-Perspective EARS Criteria

- WHEN the teacher submits homework carrying any post-expansion member THEN the student SHALL
  observe the identical member on the participant read AND the parent SHALL observe it on the
  monitoring read — with zero writes beyond the single `home_work` row.
- IF any actor submits a non-member value THEN every actor SHALL observe the same unchanged
  state (denial pre-DB, zero side effects).
- WHEN the admin reads academic tracking THEN the new member SHALL narrow cleanly through the
  fail-closed vocabulary guard — an unknown stored value remains a hard error, never a silent
  null.

## Non-Functional Requirements

### Performance

- WHEN the picker opens THEN 144 options SHALL render through MUI Autocomplete's grouping and
  filtering without virtualization concerns at this scale; the shipped O(1) membership set
  (`SURAH_JUZ_REF_MEMBERS`, `surah-juz-ref.enum.ts:47`) keeps guard checks constant-time.
- WHEN the label map resolves a ref THEN lookup SHALL be a single object-index (`Record`
  access) — no per-call array scans.

### Migration Safety

- WHEN the migration applies THEN `ALTER TYPE … ADD VALUE` statements SHALL be additive and
  idempotent-safe (`ADD VALUE` — catalog-only, brief lock, zero row rewrites); deployment
  SHALL ship migration + code together (no stored row can reference a new member until the new
  code accepts it, so old readers never see unknown values).

### Security

- WHEN any value arrives THEN the closed-vocabulary posture SHALL hold at all three tiers
  (REQ-2) — enum values are non-freeform identifiers; there is no injection surface in the
  enum itself, and the SQL/LIKE hostile-input suite stays green.

### Reliability

- WHEN a label or mapper misses a member THEN a parity/conformance test SHALL fail the suite
  (REQ-5) — completeness is machine-enforced.

## Constraints and Assumptions

### Technical Constraints

- The Quranic canon is immutable: the 114-row dataset (plan.md §9) will never need a
  regeneration workflow — no generator script is introduced (decision D2 in plan.md).
- `max-switch-cases` (≤ 30) and function-size lint ceilings forbid growing the two exhaustive
  switches — the mappers MUST be refactored (REQ-6), not stretched.
- PostgreSQL enum semantics: `ALTER TYPE … ADD VALUE` is transaction-restricted on older
  majors; the repo carries both precedents (drizzle-generated `backend/drizzle/20260907182455_ancient_scarecrow/migration.sql`
  and the guarded DO-block pattern in
  `backend/drizzle/20260915232949_custom_6-transaction-type-arbitration-reversal/migration.sql`).
  Per `backend/db/schema/AGENTS.md`: `db push` applies schema changes locally; `db generate`
  commits the migration.
- `shared/` must never import from `@/backend/**` — the locale-completeness conformance test
  therefore lives backend-side (REQ-5.3), where importing shared leaves is legal.

### Business Constraints

- Existing members are frozen (no renames): stored rows, wire contracts, tests, and labels for
  the shipped 35 must survive byte-identical.
- The blocking plan's ledger explicitly assigns THIS ticket the expansion; read-surface label
  adoption (its D2) remains with the parent-portal display ticket (this plan's ledger D1).

### Assumptions

- The 144-row dataset in plan.md §9 is the reviewed baseline; implementation SHALL verify each
  transliteration and Arabic name against a canonical mushaf listing before landing (EN
  transliteration follows the shipped labels' glyph vocabulary — `ā ī ū ʿ ʾ` — extended with
  the standard dot-below emphatic consonants (`ḥ ṣ ṭ ḍ`) where the name requires it; the five
  frozen rows keep their exact shipped codepoints).
- Surah 71 ships as `surah_nuh` (not `surah_an_nuh`), keeping the journey's hostile fixture
  invalid — the naming table is authoritative on every such near-collision.

## Success Criteria

### Definition of Done

- [ ] All REQ-1 … REQ-10 acceptance criteria met
- [ ] pgEnum ↔ TS ↔ codegen ↔ labels all carry exactly 144 members, machine-verified
- [ ] All four ticket test scenarios green: valid Surah accepted · valid Juz accepted ·
      non-contiguous pairing stored · invalid value rejected (3 tiers + NEW wire probe)
- [ ] Migration applied additively; existing rows untouched; committed migration SQL reviewed
- [ ] `bun quality-gate` green; no new baseline errors
- [ ] Docs updated: `docs/sessions/session-report-homework.md` rows, B.11 status note,
      `docs/planning/PRODUCTION_READINESS.md` row 8.21 ticked, canonical vocabulary doc created
      under `docs/curriculum/`

### Acceptance Metrics

- 144/144 members pass `isSurahJuzRef`; 144/144 resolve non-empty labels in en AND ar; 144/144
  codegen keys match; zero stale "35" references repo-wide (comment sweep).

## Glossary

| Term | Definition |
|---|---|
| `SurahJuzRef` | The TS enum mirroring the `surah_juz_ref` pgEnum — the homework vocabulary (today 5 surahs + 30 juz; 144 members after this plan) |
| `surah_juz_ref` | The PostgreSQL enum type backing `home_work.current_surah_juz` / `home_work.revision_surah_juz` |
| Jadid / Madi | The two homework tracks: new memorization (`current_*` columns) / revision (`revision_*` columns) |
| Non-contiguous assignment | jadid and madi referencing different, unrelated members (e.g. Surah Al-Baqarah + Juz 30) |
| Mirror surfaces | The hand-maintained copies of the vocabulary: TS enum, pgEnum, en labels, ar labels, codegen enum |
| Parity guard | A test asserting two mirrors are byte-identical (order-sensitive), so drift fails the suite |
| Far-vocabulary member | A post-expansion member (e.g. `surah_an_nasr`) used in tests to prove the pipeline end-to-end |
| Fail-closed | Unknown values throw (mappers) or ride raw (labels) — never silently coerced, never empty |

---

## Requirements Review Checklist

### Completeness

- [x] All user stories have clear roles, features, and benefits
- [x] Each requirement has EARS acceptance criteria
- [x] Non-functional requirements addressed
- [x] Success criteria defined and measurable
- [x] Navigation ruling explicit (no new routes; affected existing routes tabled)
- [x] Permissions mapped (unchanged; matrix provided)
- [x] Cross-actor journey captured (actor table + ordered steps + observer EARS) for the
      teacher→student/parent/admin flow

### Quality

- [x] Active voice; every criterion testable
- [x] Requirements avoid implementation detail except where the plan pins existing code as
      frozen contract
- [x] Terminology consistent (Glossary)

### EARS Format Validation

- [x] WHEN statements describe specific triggers; IF statements describe conditions; SHALL
      used for system responses

### Traceability

- [x] Requirements numbered REQ-0 … REQ-10; each maps to plan.md sections and tasks.md tasks
      (Traceability Matrix in tasks.md)

**END OF specs.md — Surah/Juz Enum Homework Tracking — v1.0 (2026-10-04)**
