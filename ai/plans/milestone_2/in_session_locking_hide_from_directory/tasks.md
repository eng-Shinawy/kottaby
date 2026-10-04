# Implementation Tasks: In-Session Locking (Hide from Directory)

> **Plan directory (verbatim):** `ai/plans/milestone_2/in_session_locking_hide_from_directory`
> **Specs of record:** `ai/plans/milestone_2/in_session_locking_hide_from_directory/specs.md` (REQ-001..REQ-023) · **Design of record:** `ai/plans/milestone_2/in_session_locking_hide_from_directory/plan.md` (D1–D6)
> **Ticket (governing ruling):** Milestone 2 · Dev 2 · 3 SP · Decision Refs INV-A2, INV-A3, INV-A4, FR-4.3 (`docs/planning/TICKETS.md:1338-1372`). Ship ONE nullable `teacher` column (`was_online_before_lock`), THREE single-statement atomic repo writers (`acquireInSessionLock` / `releaseInSessionLock` / `setAvailabilityIntent`, replacing `setOnline`), the marker-gated release composed on **every** terminal exit (incl. the admin-governance leak fix), the race-closed Available-direction toggle write. **ZERO GraphQL schema changes, ZERO UI, ZERO new locale keys, ZERO new notification waves.** The lock itself (INV-A2/INV-S6 at `startSession`) is ALREADY SHIPPED and is re-locked, never rebuilt. INV-A3's directory read-side stays Dev 3 (`TICKETS.md:1457`, `:1509` — ledger D2); "app open" liveness stays `TICKETS.md:1298` (ledger D3).

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Knowledge Read:** Before executing ANY task, read ALL existing files in `ai/plans/milestone_2/in_session_locking_hide_from_directory/outcome/` in lexical order. Prior outcomes are binding context — never contradict a ratified ruling without a ledger entry.
2. **Post-Edit Verification:** EVERY created/modified file MUST pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0) before its task checkbox flips. The script runs `tsgo → oxlint → biome:check → lint:type-aware → check:duplicates` progressively and auto-discovers the applicable `AGENTS.md` + `.agents/instructions/*.instructions.md` files for the target path.
3. **Test Execution:** ALL tests run via `bun run test/scripts/run-test.ts <test-path>` — NEVER raw `bun test` (raw `bun test` skips the `--env-file=.env.test` preload, breaking DB/GraphQL suites). Journey tests run via `bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts`.
4. **Semantic Review:** Every implementation task includes an `.SR` self-review against the semantic checklist (atomicity, env-config registration n/a here, zero dead code, no cross-layer imports, enums as VALUE imports, canonical types only, deferred-item ledgering).
5. **Outcome Documentation:** Every task writes `ai/plans/milestone_2/in_session_locking_hide_from_directory/outcome/<task-id>-outcome.md` BEFORE the next task begins.
6. **Checkbox Tracking:** `[ ]` → `[x]` only when ALL subtasks (`.QL`/`.TE`/`.SEC`/`.SR`/`.IV`) of that task are complete. No partial flips.
7. **Ledger Discipline:** Forward/incomplete-looking items are recorded ONLY as ✅ resolved-pointer entries in `ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md`; the final gate is `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0 (row-scoped: the template's Status-Values legend lines contain the symbols; only ledger table rows count).
8. **Drizzle rule:** the ONE schema change applies via `bun run db push` (Drizzle schema flow). `bun db migrate` is NOT invoked (no custom SQL exists in this plan).

**Mandatory 5-stage subtask pipeline (strict order) for EVERY implementation task X.Y:** `X.Y.QL` (per-file sub-loop) → `X.Y.TE` (4-Tier test engineering) → `X.Y.SEC` (BOLA/BOPLA/BFLA/sanitization) → `X.Y.SR` (semantic review) → `X.Y.IV` (instruction verification). No skipping ahead: if tsgo fails, fix only tsgo before running oxlint/biome/lint/duplicates.

**Applicable rule files (auto-discovered by `sub-loop.ts`; read before fixing):** root `AGENTS.md` · `backend/AGENTS.md` + `backend/services/AGENTS.md` (service tasks) · `backend/db/repo/AGENTS.md` (repo tasks) · `backend/types/AGENTS.md` (type tasks) · `test/workflows/AGENTS.md` (journey task) · `.agents/instructions/backend.instructions.md` (all `backend/**`) · `.agents/instructions/tests.instructions.md` (all test files).

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Record Error Baseline & Initialize Deferred-Items Ledger

- [ ] 0.1 [Record baseline + initialize ledger]
  - Run and capture counts into `/tmp/baseline-*.txt`:
    - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`
    - `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`
    - `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - VERIFY/COMPLETE the already-seeded `ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md` (it ships pre-seeded with resolved-pointer rows **D1–D8**; D8 is the `setOnline`-deletion ordering guard, resolved-by-sequencing — do NOT re-create the ledger from the template): confirm each row D1–D7 carries its owner and rationale (real accept/decline intake → Dev 3; directory read-side → Dev 3 `:1457`/`:1509`; 15-min sweep composition → `:1298`; booking-time availability gate → Dev 3; INV-A2 gate widening to disputed → pending product ruling; `inSession` flag → forbidden by contract registry `docs/backend/cross-stream-contracts.md:56`; `last_active_at` heartbeat cadence → `:1298`).
  - Write `ai/plans/milestone_2/in_session_locking_hide_from_directory/outcome/0-baseline-outcome.md` with the captured numbers (these are the REQ-001 comparator).
  - _Requirements: REQ-001_

### 0.2 Prerequisite & Dependency Verification (Anchored, Never Rebuilt)

- [ ] 0.2 [Verify every consumed artifact exists at its cited anchor — grep/Read, no edits]
  - **Blocked-by ticket implemented (gate):** `TeacherAvailabilityService.getAvailability(teacherId: number, locale: string, tx?: DBQueryExecutor): Promise<TeacherAvailabilityReturnType>` (`backend/services/teachers/teacher-availability.service.ts:103-125`) and `setAvailability(teacherId: number, isOnline: boolean, locale: string, tx?: DBTransaction): Promise<TeacherAvailabilityReturnType>` (`:178-246`) — consumed, with gates at `:209-217` (INV-A1) and `:223` (INV-A2).
  - **Lock path (CONSUME the discipline, replace the two writes):** `startSession(teacherUserId: number, sessionId: number, locale: string, outerTx?: DBTransaction): Promise<SessionReturnType>` (`backend/services/classes/session-lifecycle.service.ts:249-254`); transition `SessionRepository.startSessionOnce(id: number, teacherId: number, tx?: DBTransaction): Promise<SessionSelectType | null>` (`backend/db/repo/classes/session.repository.ts:173-186`); discarded prior-online read at `session-lifecycle.service.ts:274`; lock write at `:283`; fail-closed throw at `:284-289`.
  - **Release path (REWORK target):** `releaseTeacherInSessionLock(teacherId: number, tx: DBTransaction): Promise<void>` (`backend/services/classes/session-lifecycle.transitions.ts:249-257`); call sites `session-lifecycle.service.ts:404` (complete), `:489-491` (cancel, `startedAt` guard), `:663-665` (arbitration, `startedAt` guard).
  - **Leak evidence (FIX target):** `cancelSessionInTx` (`backend/services/classes/session-admin-governance.helpers.ts:298-366`) — `guardCancelPreTerminal` matches `scheduled|started` (`backend/db/repo/classes/session.repository.helpers.ts:436-441,459-468`); refund at `:343`; audit `:345`; claim backfill `:356`; governance wave `:359`; ZERO release references in the file (grep-verified). Admin entrypoint `SessionAdminGovernanceService.cancel(actorId: number, input: AdminSessionCancelInput, locale: string, idempotencyKey?: string | null, outerTx?: DBTransaction, options?): Promise<SessionReturnType>` (`backend/services/classes/session-admin-governance.ts:325-332`).
  - **Classifier pollution evidence:** `guardReschedule` writes `startedAt/endedAt` onto scheduled rows (`session.repository.helpers.ts:443-457`).
  - **Toggle path (REWORK target):** `TeacherRepository.setOnline(id: number, online: boolean, tx: DBTransaction): Promise<TeacherSelectType | null>` (`backend/db/repo/teachers/teacher.repository.ts:512-522`); `lockForCertificationCheck(teacherId: number, tx: DBTransaction): Promise<{ id: number; isApproved: boolean | null } | null>` (`:217-227`); `findById(id: number, tx?: DBQueryExecutor): Promise<TeacherSelectType | null>` (`:172`).
  - **INV-A2 gate (CONSUME verbatim):** `assertTeacherNotInActiveSession(teacherId: number, tx: DBTransaction, t?: ErrorsTranslations): Promise<void>` (`backend/services/classes/session-lifecycle.enforcement.ts:200-214`) — probes `SessionRepository.listForTeacher(teacherId, { status: SessionStatus.Started }, 1, 0, tx)` (`backend/db/repo/classes/session.repository.ts:635`); throws `ConflictError("TEACHER_IN_ACTIVE_SESSION", …)`; re-exported via `backend/services/classes/index.ts:6`.
  - **Schema anchor:** `teacher.isOnline` at `backend/db/schema/teachers/teacher.ts:28`; `session.status` at `backend/db/schema/classes/session.ts:64`; `SessionStatus` enum `backend/enum/scheduling/session-status.enum.ts:7-13` (value import required); `users.lastActiveAt` at `backend/db/schema/users/users.ts:44` (login-stamped only — `backend/services/auth/auth.service.ts:514-516`; NOT read by this ticket).
  - **Types anchor:** `TeacherAvailabilityReturnType` (`backend/types/teachers/teacher.types.ts:24-28`); `TeacherAvailabilitySnapshotContract` (`backend/types/contracts/teacher-availability.contract.types.ts:27-41` — UNTOUCHED, Dev-3 concern); `DBTransaction`/`DBQueryExecutor` (`backend/types/db.types.ts:23,30`).
  - **i18n anchor (reuse, never mint):** `teacherInActiveSession` / `teacherNotCertified` / `teacherNotFound` (`shared/locale/types/errors/labels.ts:293-299`); `getServerTranslations(locale)` ONE arg from `@/shared/locale/server-graphql`; FORBIDDEN: `Translation.` enum, two-arg `getTranslations`, `next-intl`, `shared/messages/`.
  - **Test anchors:** INV-S6 suite (`backend/services/classes/session-lifecycle.service.test.ts:3246-3440`); `setOnline` repo suite (`backend/db/test/repo/teachers/teacher.repository.test.ts:393+` — migrates in 2.2–2.4); journey helpers (`test/workflows/helpers/actor-context.ts:88,105`; `test/workflows/AGENTS.md`); GraphQL pins (`backend/graphql/test/teacher-availability.integration.test.ts:807-849`; `backend/graphql/test/schema-surface.test.ts:1200-1205`).
  - IF any anchor is missing or drifted: record a ❌ ledger entry and BLOCK the dependent task — never inline-patch a foreign layer.
  - _Requirements: REQ-002, REQ-004, REQ-011_

### 0.3 Phase 1.5 Plan-Review Gate (BLOCKING)

- [x] 0.3 [@plan-review — ZERO violations required before any implementation task begins]
  - Review the trio (`specs.md` + `plan.md` + this `tasks.md`) against root `AGENTS.md` + layer `AGENTS.md` + `.agents/instructions/*` using the `plan-review` skill.
  - The review MUST ratify: (a) the scope reconciliation — lock re-locked not rebuilt; accept ≡ `startSession` ruling (REQ-004); INV-A3 data-level only (REQ-011); INV-A4 = marker semantics with `:1298` composition (design D4); (b) the D3 retirement of `setOnline` and the three-writer map; (c) the leak-fix placement (teacher row acquired between the session-row transition and the wave's receipt writes — same lock order as the completion path); (d) zero GraphQL/UI/locale/notification drift claims.
  - Fix every reported violation and re-run until the verdict is zero violations; write `ai/plans/milestone_2/in_session_locking_hide_from_directory/outcome/plan-review-R1.md`.
  - _Requirements: REQ-023_

---

## Phase 1: Schema & Canonical Types

### 1.1 `teacher.was_online_before_lock` Column (Drizzle push)

- [ ] 1.1 [Add the ONE nullable marker column and push the schema]
  - UPDATE `backend/db/schema/teachers/teacher.ts`: add `wasOnlineBeforeLock: boolean("was_online_before_lock"),` immediately after `isOnline` (`:28`) — nullable, NO `.default(...)`, NO `.notNull()`. Add the column JSDoc in the file's existing style (semantics: `NULL` = no in-session lock held; `true/false` = pre-lock availability intent restored on the last `started` exit).
  - Apply via `bun run db push` (Drizzle schema flow). Do NOT run `bun db migrate` (no custom SQL). Do NOT touch any other schema file; `git diff backend/db/schema/` MUST show exactly this one column addition.
  - VERIFY post-push: existing rows read `was_online_before_lock = NULL`; `SELECT is_online, was_online_before_lock FROM teacher LIMIT 1` shape check (no backfill, no default).
  - Instructions: `backend/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-005.4, REQ-022.4_
  - [ ] 1.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/schema/teachers/teacher.ts --lifecycle duplicates` (exit 0).
  - [ ] 1.1.TE **Test Engineering:** schema-level assertions only — the column flows into `TeacherSelectType` via `$inferSelect` (verify compile via `bun tsgo`); no new repo behavior yet. Existing schema-adjacent suites stay green unedited.
  - [ ] 1.1.SEC **Security & Tenancy Audit:** the column is server-internal state — never exposed via GraphQL, never client-writable; confirm no Pothos object references it (grep `was_online_before_lock` / `wasOnlineBeforeLock` in `backend/graphql/` → zero).
  - [ ] 1.1.SR **Semantic Review:** nullable without default (REQ-005.3/REQ-022.4); zero dead schema exports; `git diff` scoped to the one file.
  - [ ] 1.1.IV **Instruction Verification:** validate against `backend/AGENTS.md` + `.agents/instructions/backend.instructions.md`.

### 1.2 Canonical Release-Outcome Types

- [ ] 1.2 [Add the two canonical types to `backend/types/teachers/teacher.types.ts`]
  - UPDATE `backend/types/teachers/teacher.types.ts` (today exports `TeacherSelectType` `:3`, `TeacherColdStartCertificationInput` `:5-8`, `TeacherAvailabilityReturnType` `:24-28`) with EXACTLY two new exports (bodies pinned in `plan.md` §2.2): `export type TeacherInSessionLockReleaseOutcomeType = "released" | "no_lock_held" | "active_sessions_remain";` and `export interface TeacherInSessionLockReleaseResultType { readonly outcome: TeacherInSessionLockReleaseOutcomeType; readonly teacher: TeacherSelectType; }` — each with production-grade JSDoc (domain semantics, no plan-artifact references).
  - Do NOT touch `TeacherAvailabilityReturnType` (no `inSession` flag — forbidden by `docs/backend/cross-stream-contracts.md:56`) and do NOT touch `backend/types/contracts/teacher-availability.contract.types.ts` (Dev-3 boundary).
  - The existing barrel `backend/types/teachers/index.ts` re-exports `./teacher.types` — verify, do NOT add a duplicate line.
  - _Requirements: REQ-005, REQ-006, REQ-022_
  - [ ] 1.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/teachers/teacher.types.ts --lifecycle duplicates` (exit 0).
  - [ ] 1.2.TE **Test Engineering:** `bun tsgo` clean (the new column must already appear on `TeacherSelectType` after 1.1); existing type suites stay green unedited.
  - [ ] 1.2.SEC **Security & Tenancy Audit:** the outcome union carries no identifiers beyond the teacher row it wraps; no PII added to any projection.
  - [ ] 1.2.SR **Semantic Review:** canonical location only (no service-layer `.types.ts`); zero dead exports; union members cover exactly the three repo outcomes from `plan.md` §4.2.
  - [ ] 1.2.IV **Instruction Verification:** validate against `backend/types/AGENTS.md` + `.agents/instructions/backend.instructions.md`.

---

## Phase 2: Journey Test FIRST + Repository Primitives

### 2.1 Write the Cross-Actor Journey Test FIRST (expected RED)

- [ ] 2.1 [Author `test/workflows/sessions/in-session-lock-release.journey.test.ts` covering J1–J4]
  - CREATE the journey file BEFORE any repo/service rework (skill rule: journey-first, implement until green). Follow `test/workflows/AGENTS.md` exactly: ONE committing `beforeAll` `db.transaction(...)` cast; unique `jrn_lock_<8hex>` fixture prefixes; `tracked.register(...)` for every row; `afterAll` → `tracked.cleanup()` + `tracked.verifyAllAbsent()`; NO `runInRollback`; denials via try/catch + translated substrings (`getServerTranslations("en").errorsTranslations`); honest roles via `provisionStudentActor` / `provisionCertifiedTeacherActor` (`test/workflows/helpers/actor-context.ts:88,105`); direct-DB oracle helper `readTeacherLockState(teacherId)` reading `is_online` + `was_online_before_lock` (mirror `readTeacherIsOnline` at `test/workflows/teachers/teacher-availability.journey.test.ts:120-123`).
  - **J1 (REQ-016):** certified teacher `is_online=true`; student books (`SessionLifecycleService.createSession`); teacher still online; `startSession` → oracle `is_online=false`, marker `true`; toggle-Available attempt ⇒ `TEACHER_IN_ACTIVE_SESSION` with oracle safety (message + `JSON.stringify(denial)` must NOT contain the session id); `completeSession` → `is_online=true`, marker `NULL`.
  - **J2 (REQ-017):** variant A — teacher toggles Unavailable first, starts, completes → stays `false`, marker `NULL`; variant B — teacher Available at start, toggles Unavailable mid-session (succeeds — Unavailable direction), completes → stays `false`, marker `NULL`.
  - **J3 (REQ-018):** teacher starts; admin `SessionAdminGovernanceService.cancel` → restore per marker in-tx; governance-cancel wave fired exactly once (spy the emitter — `SpiedFanoutTransport` / `test/workflows/helpers` idiom); variant — admin cancels a never-started `scheduled` row (reschedule-polluted `startedAt` via `guardReschedule` or direct fixture) → availability untouched.
  - **J4 (REQ-019):** two students book; teacher starts both (booking has no availability gate — verified); complete session A → still `false`, marker intact; complete session B → restore per ORIGINAL marker, marker `NULL`.
  - The suite is EXPECTED RED against the current tree (release is unconditional; marker column absent ⇒ fixture compile fails until 1.1 lands) — that is the point: run it, capture the failure inventory in the outcome file, and let Phases 2–3 turn it green.
  - Instructions: `test/workflows/AGENTS.md`; `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-016, REQ-017, REQ-018, REQ-019_
  - [ ] 2.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts test/workflows/sessions/in-session-lock-release.journey.test.ts --lifecycle duplicates` (exit 0).
  - [ ] 2.1.TE **Test Engineering:** the file IS the test — verify it compiles post-1.1 and records the red inventory; no `runInRollback` anywhere; every fixture tracked; zero-residue re-probes in `afterAll`.
  - [ ] 2.1.SEC **Security & Tenancy Audit:** denial assertions assert code + translated message, never raw server text; oracle-safety assertions included (no session-id leakage).
  - [ ] 2.1.SR **Semantic Review:** journeys assert OBSERVER-perspective outcomes via the direct-DB oracle; no monkey-patching; honest roles only.
  - [ ] 2.1.IV **Instruction Verification:** validate against `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md`.

### 2.2 `TeacherRepository.acquireInSessionLock` (NEW)

- [ ] 2.2 [Implement the atomic capture-and-lock primitive + migrate its slice of the `setOnline` suite]
  - CREATE in `backend/db/repo/teachers/teacher.repository.ts`: `export async function acquireInSessionLock(id: number, tx: DBTransaction): Promise<TeacherSelectType | null>` — EXACTLY the single guarded statement pinned in `plan.md` §4.1 (`was_online_before_lock = COALESCE(was_online_before_lock, is_online)`, `is_online = false`, `updated_at = now()`, `WHERE id = $1`, `RETURNING *`; required-`tx` discipline identical to the retired `setOnline`; NO inline `--` comments inside `sql` templates). Production-grade docblock: domain semantics (first-lock-wins capture, fail-closed null), no plan-artifact references.
  - Do NOT yet rewire `startSession` (that is 3.1); this task ships the primitive + its tests.
  - Instructions: `backend/db/repo/AGENTS.md`; `backend/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-005.1-3, REQ-022.1_
  - [ ] 2.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/teacher.repository.ts --lifecycle duplicates` (exit 0).
  - [ ] 2.2.TE **Test Engineering** (`backend/db/test/repo/teachers/teacher.repository.test.ts`, `runInRollback` + `tx` to every call):
    • Tier 1: 100% branch/statement — capture `true`→lock; capture `false`→lock (never-resurrect seed); `NULL` return on missing row; required-`tx` source pin (mirror `:586-587`).
    • Tier 2: `is_online` NULL-column coercion (mirror `:485-492`); second acquire preserves first marker (COALESCE first-lock-wins); idempotent re-acquire while marker set.
    • Tier 3: 20-way `Promise.allSettled` acquire chaos on one teacher row — converges to marker = first-captured value, `is_online=false`.
    • Tier 4: hostile ids (0, -1, NaN, 2^53) → `NULL` (zero rows), no throw.
  - [ ] 2.2.SEC **Security & Tenancy Audit:** PK-only addressing; no caller-supplied anything beyond the server-derived id; hostile-id probes prove zero side effects.
  - [ ] 2.2.SR **Semantic Review:** ONE statement (no read-then-write); value-imported enums if any; zero dead code; docblock truthful.
  - [ ] 2.2.IV **Instruction Verification:** validate against `backend/db/repo/AGENTS.md` + `.agents/instructions/backend.instructions.md` + `.agents/instructions/tests.instructions.md`.

### 2.3 `TeacherRepository.releaseInSessionLock` (NEW)

- [ ] 2.3 [Implement the marker-gated, last-exit-guarded release primitive]
  - CREATE: `export async function releaseInSessionLock(teacherId: number, tx: DBTransaction): Promise<TeacherInSessionLockReleaseResultType | null>` — the primary guarded statement pinned in `plan.md` §4.2 (restore `is_online = was_online_before_lock`, clear marker, `WHERE marker IS NOT NULL AND NOT EXISTS (SELECT 1 FROM session WHERE teacher_id = $1 AND status = 'started')`), then on zero rows ONE disambiguation `findById`: missing row ⇒ `null`; marker `NULL` ⇒ `{ outcome: "no_lock_held", teacher }`; else `{ outcome: "active_sessions_remain", teacher }`. Import `TeacherInSessionLockReleaseResultType` from `@/backend/types` (deep import `@/backend/types/teachers/teacher.types` per barrel rules — the `backend/types` barrel exists and re-exports teachers types; use the existing import idiom of the file).
  - `SessionStatus` used in the `NOT EXISTS` predicate MUST be a value import (`eq(session.status, SessionStatus.Started)`).
  - Instructions: `backend/db/repo/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-006, REQ-007, REQ-022.1-2_
  - [ ] 2.3.QL **Quality Loop:** sub-loop on `backend/db/repo/teachers/teacher.repository.ts` (exit 0).
  - [ ] 2.3.TE **Test Engineering:**
    • Tier 1: restore `true`; restore `false` (never-resurrect); marker cleared to `NULL`; missing row ⇒ `null`; three-outcome disambiguation exactness.
    • Tier 2: `no_lock_held` when marker `NULL` (incl. reschedule-polluted `startedAt` fixture — release ignores the classifier); `active_sessions_remain` while another `started` row exists; no-op writes NOTHING (verify `is_online`/marker/`updated_at` unchanged on the deferred path).
    • Tier 3: concurrent releases for ONE teacher holding TWO started sessions (complete A + complete B racing via `Promise.allSettled` inside `runInRollback`) — exactly one `"released"`, the other `"active_sessions_remain"`; plus a two-teacher control asserting BOTH release (no cross-teacher interference); 20-way release chaos.
    • Tier 4: hostile ids ⇒ `null` (zero rows) with NO throw; `EXPLAIN` capture for the `NOT EXISTS` probe (cost note in outcome file; ledger a pointer if a partial index is ever warranted — do NOT add one now).
  - [ ] 2.3.SEC **Security & Tenancy Audit:** the `NOT EXISTS` subquery is `teacher_id`-scoped only; no cross-tenant reads; hostile-id zero side effects.
  - [ ] 2.3.SR **Semantic Review:** single atomic restore + one disambiguation read on the cold path only; no read-then-write on the hot path; outcome union exhaustive; the repo-tier three-way disambiguation is a RATIFIED deviation from the zero-row convention (rationale in `plan.md` §4.2 — do not "fix" it into the service tier).
  - [ ] 2.3.IV **Instruction Verification:** `backend/db/repo/AGENTS.md` + instructions files.

### 2.4 `TeacherRepository.setAvailabilityIntent` (NEW) — `setOnline` RETIRED

- [ ] 2.4 [Implement the direction-guarded toggle writer; DELETE `setOnline`; migrate the suite]
  - CREATE: `export async function setAvailabilityIntent(id: number, isOnline: boolean, tx: DBTransaction): Promise<TeacherSelectType | null>` — the statement pinned in `plan.md` §4.3 (marker CASE `WHEN was_online_before_lock IS NULL THEN NULL ELSE $online END`; Available-direction `NOT EXISTS(started)` guard; `RETURNING *`).
  - DELETE `setOnline` (`backend/db/repo/teachers/teacher.repository.ts:512-522`) together with its stale docblock (`:473-511`). Grep-verify ZERO remaining non-test references before deletion (`backend/services/classes/session-lifecycle.service.ts:283`, `session-lifecycle.transitions.ts:250`, `teacher-availability.service.ts:230` are rewired in 3.1/3.2/3.4 — **delete `setOnline` only in this task if 3.x have landed; otherwise keep the deletion as the LAST step of 3.4** — verify ledger D8 already records the 2.4/3.4 ordering split; update its status once the grep is clean).
  - MIGRATE the retired suite's cases (`backend/db/test/repo/teachers/teacher.repository.test.ts:393+`): lock/release idempotency, same-value writes, zero-row null, NULL-column coercion, chaos (the existing case at `:562-580` is 25-way — preserve or exceed), required-tx pin — re-expressed against the three new primitives (each pinned by its own task; this task owns the `setAvailabilityIntent` slice + the file-level retirement edit).
  - Instructions: `backend/db/repo/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-009.1-3, REQ-010.1, REQ-022.1_
  - [ ] 2.4.QL **Quality Loop:** sub-loop on the repository + its test file (exit 0).
  - [ ] 2.4.TE **Test Engineering:**
    • Tier 1: Unavailable direction writes `false`, marker untouched when `NULL`; marker overwritten `false` when set (deliberate intent); zero-row null both directions.
    • Tier 2: Available direction succeeds when no `started` row; BLOCKED (zero rows) when a `started` row exists (the race-closed write); marker CASE applied on the true direction too (disputed-window consistency).
    • Tier 3: 20-way rapid toggle storm in one tx (mirror `teacher-availability.service.test.ts:1003` discipline at repo level); toggle-vs-release interleaving converges (REQ-009.4).
    • Tier 4: hostile ids ⇒ zero rows, no throw; boolean type-guard callers stay in the service (repo trusts the typed param — document).
  - [ ] 2.4.SEC **Security & Tenancy Audit:** the guard predicate is the security control (INV-A2 at write time); no ids beyond PK; BOPLA — no input objects reach the writer.
  - [ ] 2.4.SR **Semantic Review:** no dead exports introduced by this task's slice; `setOnline` retirement itself is tracked by ledger D8 (grep-verified complete at 3.4); knip-clean; docblocks reflect the three-writer map.
  - [ ] 2.4.IV **Instruction Verification:** `backend/db/repo/AGENTS.md` + instructions files.

---

## Phase 3: Service Composition (turns the journey green)

### 3.1 `startSession` — Acquire Path (UPDATE)

- [ ] 3.1 [Replace the findById+setOnline pair with `acquireInSessionLock`]
  - UPDATE `backend/services/classes/session-lifecycle.service.ts` `startSession` (`:249-292`): after `SessionRepository.startSessionOnce` (`:266`) and the transition-miss rejection (`:267-269`), REPLACE the prior-teacher read (`:274`) + lock write (`:283`) with `const locked = await TeacherRepository.acquireInSessionLock(started.teacherId, tx);` — keyed on the transitioned row's `teacherId` (never caller input). `null` ⇒ keep the existing fail-closed `logger.error` + throw (`:284-289` message preserved).
  - REWRITE the stale docblock at `:230-234` ("with no availability-toggle surface yet…") to the marker truth: the toggle exists, the marker persists pre-lock intent, release restores it (REQ-015.4). Keep the seam-note lineage: reference the canonical doc `docs/teachers/teacher-availability.md` §6.2 instead of plan artifacts.
  - Instructions: `backend/services/AGENTS.md`; `backend/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-003.1-2, REQ-005.1, REQ-015.4_
  - [ ] 3.1.QL **Quality Loop:** sub-loop on `backend/services/classes/session-lifecycle.service.ts` (exit 0).
  - [ ] 3.1.TE **Test Engineering:** extend the INV-S6 suite (`session-lifecycle.service.test.ts:3246-3440`): start ⇒ oracle `is_online=false` AND `was_online_before_lock` = pre-start value (true & false variants); mid-flow fault after acquire rolls back transition+capture (adapt `:3259`); zero-row acquire ⇒ start fails, availability untouched.
  - [ ] 3.1.SEC **Security & Tenancy Audit:** row-keyed write (`started.teacherId`); no client input flows into the writer; BFLA n/a (no new entrypoint).
  - [ ] 3.1.SR **Semantic Review:** single-statement acquire; no leftover `priorTeacher` transient; docblock truthful; no dead imports.
  - [ ] 3.1.IV **Instruction Verification:** `backend/services/AGENTS.md` + instructions.

### 3.2 Release Body Rework + Unconditional Call Sites (UPDATE)

- [ ] 3.2 [Rework `releaseTeacherInSessionLock` to the marker-gated primitive; drop `startedAt` guards]
  - UPDATE `backend/services/classes/session-lifecycle.transitions.ts` `releaseTeacherInSessionLock` (`:249-257`): body → `TeacherRepository.releaseInSessionLock(teacherId, tx)`; `null` ⇒ existing `logger.error` + throw (message preserved); `"released"` ⇒ silent; `"no_lock_held"` / `"active_sessions_remain"` ⇒ ONE bounded `logger.debug` each with fixed key shape, NO session ids (REQ-014.1-2). Signature stays `(teacherId: number, tx: DBTransaction): Promise<void>`; update the definition-side doc (`:33-36`) to the marker semantics.
  - UPDATE `backend/services/classes/session-lifecycle.service.ts`: remove the `cancelled.startedAt !== null` guard (`:489`) and the `resolved.startedAt !== null` guard (`:663`) — both calls become unconditional (design D6; the marker is the single gate). `completeSessionWithReceipt`'s call (`:404`) is untouched.
  - Instructions: `backend/services/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-006.1-4, REQ-008.2-3, REQ-014_
  - [ ] 3.2.QL **Quality Loop:** sub-loop on both touched files (exit 0).
  - [ ] 3.2.TE **Test Engineering:** INV-S6 suite verdicts preserved (complete⇒unlock, cancel-from-started⇒unlock, cancel-from-scheduled⇒no-op — now via `no_lock_held`, arbitration both directions `:3352-3440`); NEW: never-resurrect verdicts (complete with marker=false ⇒ stays `false`); reschedule-polluted `startedAt` scheduled-cancel ⇒ `no_lock_held` (no spurious restore); release no-op logs exactly one debug (spy `logger.debug`).
  - [ ] 3.2.SEC **Security & Tenancy Audit:** denial/error surfaces unchanged; log payloads carry no identifiers beyond `teacherId`; no new user-facing strings (REQ-014.4).
  - [ ] 3.2.SR **Semantic Review:** zero dead branches; guards removed not commented out; enum value imports intact.
  - [ ] 3.2.IV **Instruction Verification:** service AGENTS + instructions.

### 3.3 Admin-Governance Cancel Leak Fix (UPDATE — the discovered defect)

- [ ] 3.3 [Compose the release into `cancelSessionInTx`]
  - UPDATE `backend/services/classes/session-admin-governance.helpers.ts` `cancelSessionInTx` (`:298-366`): ADD `await releaseTeacherInSessionLock(cancelled.teacherId, tx);` AFTER the claim backfill (`:356`) and BEFORE the governance wave (`:359`) — the teacher row is acquired after the session-row transition and before the governance wave's receipt writes, mirroring the completion path's lock order (session row → teacher row → notification-receipt rows; consistent ordering per `plan.md` §6). `cancelled.teacherId` comes from the `guardCancelPreTerminal` transition row (`:331`) — server-derived only.
  - The governance wave (`notifySessionGovernanceCancelled`, `:359`), refund (`refundHeldLaneToProvenance`, `:343`), audit (`:345`) are consumed unchanged (REQ-013.2).
  - Instructions: `backend/services/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-008.1,4-5, REQ-013_
  - [ ] 3.3.QL **Quality Loop:** sub-loop on the helpers file (exit 0).
  - [ ] 3.3.TE **Test Engineering:** extend `backend/services/classes/session-admin-governance.service.test.ts`: admin cancel of a `started` session (marker=true fixture) ⇒ teacher restored in the same tx; marker=false fixture ⇒ stays `false`; `scheduled` cancel ⇒ `no_lock_held` no-op (existing governance tests stay green — refund/audit/wave asserts unchanged); wave fired exactly once.
  - [ ] 3.3.SEC **Security & Tenancy Audit:** admin authorization untouched (BFLA n/a — no new entrypoint); the release adds no admin-controllable input; idempotency claim flow untouched.
  - [ ] 3.3.SR **Semantic Review:** same-tx discipline verified (no post-commit release); the consistent lock order (session row → teacher row → notification-receipt rows, mirroring the completion path) documented in the docblock in domain terms.
  - [ ] 3.3.IV **Instruction Verification:** service AGENTS + instructions.

### 3.4 Toggle Service Rework (UPDATE) — completes `setOnline` retirement

- [ ] 3.4 [Switch `setAvailability` to `setAvailabilityIntent` with the race-closed denial]
  - UPDATE `backend/services/teachers/teacher-availability.service.ts` `setAvailability` (`:178-246`): REPLACE the `TeacherRepository.setOnline(teacherId, isOnline, innerTx)` call (`:230`) with `TeacherRepository.setAvailabilityIntent(teacherId, isOnline, innerTx)`. Zero-row mapping: `isOnline === true` ⇒ `throw new ConflictError("TEACHER_IN_ACTIVE_SESSION", t.teacherInActiveSession)` (race-closed backstop, REQ-010.2 — the teacher row's existence is already proven in-tx by `lockForCertificationCheck` at `:190`); `isOnline === false` ⇒ existing `NotFoundError("TEACHER", t.teacherNotFound)` path (`:231-242` semantics preserved). Gates at `:209-217`/`:223` unchanged.
  - AFTER this task: grep-verify zero non-test `setOnline` references remain, then complete the 2.4 deletion if it was deferred (ledger D8 → done). Flip nothing until `bun tsgo` is clean.
  - Instructions: `backend/services/AGENTS.md`; `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-009.1-2, REQ-010.2-3, REQ-003.4_
  - [ ] 3.4.QL **Quality Loop:** sub-loop on the service file (exit 0).
  - [ ] 3.4.TE **Test Engineering:** extend `backend/services/teachers/teacher-availability.service.test.ts`: mid-session Unavailable (real started session) succeeds AND overwrites marker (assert via repo read); Available-direction race-block — stub/spy the repo writer to return `null` once ⇒ `ConflictError` with the EXACT existing code+message; unavailable-direction zero-row ⇒ `NotFoundError`; existing 4-tier blocks stay green (INV-A1/INV-A2 spy discipline `:1121,1158`).
  - [ ] 3.4.SEC **Security & Tenancy Audit:** `ctx.user.id` remains the only teacher identity source; the new denial discloses no session id (oracle safety).
  - [ ] 3.4.SR **Semantic Review:** zero dead branches; no duplicate denial construction (share the `t.teacherInActiveSession` message source with the gate path); `setOnline` fully retired.
  - [ ] 3.4.IV **Instruction Verification:** service AGENTS + instructions.

### 3.5 Journey Green + INV-S6 Matrix Consolidation

- [ ] 3.5 [Turn `test/workflows/sessions/in-session-lock-release.journey.test.ts` green; consolidate the service matrix]
  - RUN `bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts` — J1–J4 must pass end-to-end against the real DB with committed fixtures. Capture the green inventory in the outcome file.
  - Consolidate: every REQ-003/006/007/008/009/010 service-level verdict now lives in exactly one place (INV-S6 suite + toggle suite + governance suite); delete any duplicated scaffolding the journey accidentally introduced (journey asserts outcomes, service suites assert mechanics — no overlap in fixtures).
  - _Requirements: REQ-003.3, REQ-006, REQ-007, REQ-016, REQ-017, REQ-018, REQ-019_
  - [ ] 3.5.QL **Quality Loop:** sub-loop on the journey file + any touched test file (exit 0).
  - [ ] 3.5.TE **Test Engineering:** the journey IS the assertion set of `plan.md` §7 — every step of J1–J4 maps 1:1 to its REQ; zero-residue verified (`tracked.verifyAllAbsent()`).
  - [ ] 3.5.SEC **Security & Tenancy Audit:** journey uses honest roles; no permission bypasses; denial texts asserted via translations.
  - [ ] 3.5.SR **Semantic Review:** no `runInRollback` in the journey; no cross-layer imports; no fabricated fixtures (entity-setup helpers only).
  - [ ] 3.5.IV **Instruction Verification:** `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md`.

---

## Phase 4: Cross-Layer Verification (schema freeze + no-UI drift)

### 4.1 GraphQL Integration & Schema-Surface Pins (consumed, never edited)

- [ ] 4.1 [Prove the SDL freeze and the wire-level denial surface]
  - RUN `bun run test/scripts/run-test.ts backend/graphql/test/teacher-availability.integration.test.ts` and `backend/graphql/test/schema-surface.test.ts` — MUST be green UNEDITED: mutation args pin `["isOnline"]`, query args empty, `TeacherAvailabilityState` fields `{id, isOnline, isApproved}` (`teacher-availability.integration.test.ts:807-849`; `schema-surface.test.ts:1200-1205`); permission tiers (anonymous 401, student/admin 403, INV-A1 403, INV-A2 409 with oracle safety `:652-758`); BOPLA smuggled-arg probes `:762-802`.
  - RUN the state-machine journey `test/workflows/sessions/session-state-machine.journey.test.ts` — green unedited (no transition-matrix change).
  - VERIFY zero UI drift: `git diff --name-only` contains NO `frontend/**`, `app/**`, `shared/locale/**`, `.storybook/**` paths (REQ-020.1) — the existing card/hook/error-link row are consumed unchanged (`frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx:62`; `frontend/providers/apollo/error-link.map.ts:480-482`).
  - _Requirements: REQ-012, REQ-020, REQ-021.4_
  - [ ] 4.1.QL **Quality Loop:** n/a (no files created/modified — verification task; run sub-loop on any file you were forced to touch).
  - [ ] 4.1.TE **Test Engineering:** capture the green inventories into the outcome file (the REQ-012/020 evidence).
  - [ ] 4.1.SEC **Security & Tenancy Audit:** the wire probes ARE the audit (permission tiers + BOPLA + oracle safety).
  - [ ] 4.1.SR **Semantic Review:** confirm zero edits leaked into GraphQL/frontend layers.
  - [ ] 4.1.IV **Instruction Verification:** n/a (read-only verification).

---

## Phase 5: Canonical Docs & Docblock Hygiene

### 5.1 Canonical Domain Docs (UPDATE — truth-first)

- [ ] 5.1 [Update the three canonical docs to the shipped semantics]
  - UPDATE `docs/specs/state-machine-invariants.md`: §3.3 implementation pointer (`:125`) — INV-A4 now implemented (marker-gated release); `:12` header note — release now composes on every started-exit including admin-governance cancel (the claim becomes true); document the `was_online_before_lock` marker as the lock-held oracle.
  - UPDATE `docs/teachers/teacher-availability.md`: §6.2 (`:299-313`) — hazard RESOLVED (shipped marker + gated release; keep the historical narrative, mark the fix shipped); §6.1 forward contract (`:287-297`) — unchanged and now backed by the truthful write-side; fix the `users.ts:37` line drift at `:315` → `users.ts:44`; add the composition note for the `:1298` sweep (in-session lock priority; sweep owns app-open convergence).
  - UPDATE `docs/sessions/session-lifecycle.md`: release semantics section — marker oracle, the four composed exit paths (complete / participant cancel / arbitration / admin governance cancel), the last-started-exit guard, and the rule "any NEW terminal exit path MUST compose the release" (REQ-008.6); correct the `:81` release-coverage claim if it lists only the three legacy exits; add the deploy-cutover note (a session already `started` at deploy time holds no marker, so its post-deploy conclusion releases as a benign no-op — affected teachers self-heal via the manual toggle).
  - SWEEP the `setOnline` retirement blast radius across docs: `grep -rn "setOnline" docs/` returns 19 hits today (15 in `docs/teachers/teacher-availability.md` — incl. §3.1 `:92-103`, §4.1 `:172-182`, the write-path table `:41-42`, the flow diagram `:75`, `:162`, the test-coverage table `:215`, §6.3 `:315`; 2 in `docs/sessions/session-lifecycle.md` — incl. `:190`; 2 in `docs/specs/state-machine-invariants.md`). Rewrite every present-tense `setOnline` reference to the three-writer map (`acquireInSessionLock` / `releaseInSessionLock` / `setAvailabilityIntent`); historical/narrative mentions may keep the name only where the text explicitly marks it as the retired primitive.
  - Do NOT update `AGENTS.md` or `.agents/instructions/*` (hand-curated only — rule-files content policy).
  - _Requirements: REQ-011.3, REQ-015.1-3_
  - [ ] 5.1.QL **Quality Loop:** sub-loop on each touched doc is n/a (markdown); still run `bun run scripts/lint-service.ts -f <doc> --id docs` IF the repo lints docs (check; most markdown is lint-exempt — record either way).
  - [ ] 5.1.TE **Test Engineering:** grep-verify no doc still claims "unconditional restore", "no availability-toggle surface", or release-without-admin-cancel (the three falsified claims), and that zero present-tense `setOnline` references survive outside explicitly-marked historical narrative — capture the grep results (incl. `grep -rn "setOnline" docs/` = historical-only) in the outcome file.
  - [ ] 5.1.SEC **Security & Tenancy Audit:** docs must NOT recommend `is_online`-only directory filtering (forward contract language preserved verbatim).
  - [ ] 5.1.SR **Semantic Review:** every doc claim now matches a code anchor verified in this plan (no aspirational semantics).
  - [ ] 5.1.IV **Instruction Verification:** validate against the docs style of the touched files.

### 5.2 Code Docblocks + DEF-6 Drift Fix (UPDATE)

- [ ] 5.2 [Fix the stale seam notes and the enforcement docstring]
  - VERIFY (and complete if not already done in 3.1/3.2): `session-lifecycle.service.ts:230-234` rewritten; `session-lifecycle.transitions.ts:33-36` definition doc updated; the retired `setOnline` docblock (`teacher.repository.ts:473-511`) is gone with the method; the three new primitives carry production-grade docblocks (what/why/domain — ZERO plan-artifact references like REQ-NNN/Task N/specs.md).
  - FIX the DEF-6 drift (predecessor-plan ledger item): `assertTeacherNotInActiveSession` docblock at `backend/services/classes/session-lifecycle.enforcement.ts:186-189` says "The denial is FORBIDDEN-class" while the code throws `ConflictError("TEACHER_IN_ACTIVE_SESSION")` (`:212`, 409) — code is authoritative; rewrite the docstring to CONFLICT-class.
  - _Requirements: REQ-015.4-5_
  - [ ] 5.2.QL **Quality Loop:** sub-loop on every touched file (exit 0).
  - [ ] 5.2.TE **Test Engineering:** existing enforcement tests stay green (`session-lifecycle.enforcement.test.ts:374` area); grep proves zero "FORBIDDEN-class" remnants in the file.
  - [ ] 5.2.SEC **Security & Tenancy Audit:** docstring changes must not weaken the oracle-safety description (no session-id disclosure language).
  - [ ] 5.2.SR **Semantic Review:** comments describe domain behavior only; no noisy trivial comments.
  - [ ] 5.2.IV **Instruction Verification:** service AGENTS + instructions.

---

## Phase 6: Final Gates & Knowledge Propagation

### 6.1 Final Quality Gate, Ledger Enforcement & Traceability Audit

- [ ] 6.1 [Run the full verification battery]
  - `bun quality-gate` — all stages pass (tsgo → oxlint → biome → lint → duplicates).
  - `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md` = 0.
  - Traceability: `for r in $(grep -oE 'REQ-[0-9]+' ai/plans/milestone_2/in_session_locking_hide_from_directory/specs.md | sort -u); do grep -q "$r" ai/plans/milestone_2/in_session_locking_hide_from_directory/tasks.md || echo "MISSING: $r"; done` — zero output.
  - Anti-pattern sweep on the delivered code: no `Translation.` enum, no two-arg `getTranslations`, no `@/frontend/utils/logger`, no raw `bun test` in docs/scripts, no bottom-nav, no invented paths; DB tests use `runInRollback` + `tx`; journey uses committed fixtures.
  - Full suites via the wrapper: repo tests (`bun run test:db` scope or file-level), `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts`, `backend/services/teachers/teacher-availability.service.test.ts`, `backend/services/classes/session-admin-governance.service.test.ts`, `backend/db/test/repo/teachers/teacher.repository.test.ts`, `test/workflows/sessions/in-session-lock-release.journey.test.ts`, plus 4.1's GraphQL files.
  - _Requirements: REQ-021, REQ-023_
  - [ ] 6.1.QL **Quality Loop:** any file fixed during this gate re-runs its own sub-loop (exit 0).
  - [ ] 6.1.TE **Test Engineering:** capture every suite's green summary in `outcome/6.1-final-gate-outcome.md`.
  - [ ] 6.1.SEC **Security & Tenancy Audit:** confirm the four BOLA/BOPLA/BFLA postures of REQ-021 one final time against the diff.
  - [ ] 6.1.SR **Semantic Review:** the semantic checklist over the whole diff (atomicity, dead code, cross-layer, enums, ledger).
  - [ ] 6.1.IV **Instruction Verification:** re-run sub-loop discovery on the final file list; confirm all listed rule files were honored.

### 6.2 Knowledge Propagation & Documentation

- [ ] 6.2 [Synthesize outcome files into the canonical docs; evaluate skill updates]
  - Read ALL files in `ai/plans/milestone_2/in_session_locking_hide_from_directory/outcome/`; extract recurring patterns/gotchas.
  - The canonical propagation target for this plan is ALREADY `docs/teachers/teacher-availability.md` + `docs/sessions/session-lifecycle.md` (updated in 5.1) — VERIFY they consolidate the plan's durable learnings (three-writer map, marker oracle, last-exit guard, release-composition rule). IF a gap remains, close it in `docs/sessions/in-session-lock.md` (new canonical file, kebab-case) and cross-link.
  - Evaluate `.agents/skills/*/SKILL.md` updates: ONLY if a new pattern emerged that changes a skill's domain guidance (expected: NONE — the plan applies existing patterns; record the negative finding explicitly). NEVER touch `AGENTS.md` / `.agents/instructions/*`.
  - Write `outcome/6.2-knowledge-propagation-outcome.md`; mark task `[x]`.
  - _Requirements: REQ-001.4, REQ-023_
  - [ ] 6.2.QL **Quality Loop:** sub-loop on any file created/modified here (exit 0).
  - [ ] 6.2.TE **Test Engineering:** n/a (documentation task — record the doc grep-verifications from 5.1.TE as the evidence).
  - [ ] 6.2.SEC **Security & Tenancy Audit:** docs must not disclose internal ids/log formats beyond what production logs already carry.
  - [ ] 6.2.SR **Semantic Review:** no summary/markdown files created outside the sanctioned docs + outcome locations.
  - [ ] 6.2.IV **Instruction Verification:** confirm the rule-files content policy was honored (no AGENTS.md/instructions edits).

---

**Task Sequencing (dependency graph):** 0.1 → 0.2 → 0.3 → 1.1 → 1.2 → 2.1 (journey RED) → 2.2 → 2.3 → 2.4 → 3.1 → 3.2 → 3.3 → 3.4 (completes 2.4's retirement) → 3.5 (journey GREEN) → 4.1 → 5.1 → 5.2 → 6.1 → 6.2. Foundation-first with the journey written test-first per the skill's interleaving rule; each phase fully completes before the next begins (lifecycle isolation).
