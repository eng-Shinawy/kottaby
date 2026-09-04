# Implementation Tasks: DEV3-011 — Session Request Notification to Teacher

> **Plan directory (verbatim):** `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher`
> **Specs of record:** `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/specs.md` (REQ-001..REQ-095) · `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/plan.md` (D1–D10)
> **Ticket scope (governing ruling under Phase 1.5 ratification):** BACKEND-ONLY. This ticket ships the canonical six-emitter session-request notification wave module + ONE new repository + ONE canonical types file + 17 new i18n keys. There are **ZERO schema, ZERO GraphQL, ZERO frontend, ZERO nav changes** — frontend/journey-UI phases are DISCHARGED BY ABSENCE with verification-only confirmations (never padded).

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Knowledge Read:** Before executing ANY task, the agent MUST read ALL existing files in `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/` in lexical order. Prior outcomes are binding context — never contradict a ratified ruling without a ledger entry.
2. **Post-Edit Verification:** EVERY created/modified file MUST pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0) before its task checkbox flips.
3. **Test Execution:** ALL tests run via `bun run test/scripts/run-test.ts <test-path>` — NEVER raw `bun test` (it skips `--env-file=.env.test`).
4. **Semantic Review:** Every implementation task includes an `.SR` self-review against the semantic checklist (atomicity, env-config, zero dead code, no cross-layer imports, enums as VALUE imports, canonical types only).
5. **Outcome Documentation:** Every task writes `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/<task-id>-outcome.md` BEFORE the next task begins.
6. **Checkbox Tracking:** `[ ]` → `[x]` only when ALL subtasks of that task are complete. No partial flips.
7. **Ledger Discipline:** Forward/incomplete-looking items are recorded ONLY as ✅ resolved-pointer entries in `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/deferred-items.md`; the final gate is `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/deferred-items.md` = 0 (row-scoped: the template's Status Values legend lines contain the symbols; only ledger table rows count — plan-review R1 amendment).

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Record Error Baseline & Initialize Deferred-Items Ledger

- [x] 0.1 [Record baseline + initialize ledger]
  - Run and capture counts into `/tmp/baseline-dev3-011-*.txt`:
    - `bun tsgo` (type-check error count)
    - `bun biome:check` (warning count)
    - `bun run scripts/lint-service.ts --json --id baseline`
  - Initialize `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, seeded with the plan's D1–D7 resolved-pointer entries (DEV3-004/005 intake+accept/decline; DEV2-011+DEV3-008 B.16 routing; queue persistence; realtime CTA metadata; alternatives computation; freeze-suite baseline drift pointer; caller-tx replay publish posture).
  - Write `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/0-baseline-outcome.md` with the captured numbers (these are the REQ-075 comparator).
  - _Requirements: REQ-001_

### 0.2 Prerequisite & Dependency Verification (Anchored, Never Rebuilt)

- [x] 0.2 [Verify every consumed artifact exists at its cited anchor]
  - `NotificationEngine.emitForUser` caller-tx receipt + own-commit branches: `backend/services/notifications/notification-engine.service.ts:327-369`; `publishReceipts` at `:475-481` (delegates to `publishReceiptsFromIndex`); replay semantics at `:302-304`/`:343-345`, keyed receipt at `:356`, fresh-receipt storage at `:363-366`, publish-on-rows at `:641-644`.
  - `isPositiveSafeInt` and `IDEMPOTENCY_KEY_MAX_LENGTH`: `backend/services/notifications/emit-validation.ts:40, 50-52`.
  - `SessionSelectType`: `backend/types/classes/session.types.ts:3`; `isSessionIntent`: `backend/types/contracts/contract-guards.ts:76-78`; `SessionEventNotificationContract`: `backend/types/contracts/session-notification.contract.types.ts:42-52`.
  - Schema anchors (read-only): `backend/db/schema/classes/session.ts:32-63`, `backend/db/schema/teachers/teacher.ts:19-38`, `backend/db/schema/students/students.ts:18-47`, `backend/db/schema/users/users.ts:11-45`, `backend/db/schema/notifications/notifications.ts:27-46`, `backend/db/schema/enums.ts:56-64`.
  - Repo idiom anchor for the tx-vs-`queryDb` driver split: `backend/db/repo/students/student.repository.ts:96-112` (incl. the `isDBTransaction` discriminator at `:33-36`); `UserRepository.findLocalesByIds` at `backend/db/repo/users/user.repository.ts:152-155` (reference only — NOT used; the joined read supersedes it).
  - Error ctor shapes: `NotFoundError` entity-name form vs `ValidationError` overloaded form at `backend/lib/errors.ts:37-41, 65-130` (overloads at `:78-86`).
  - Locale anchors: `defaultLocale` at `shared/locale/AppLocale.ts:3`; existing `typeSessionRequest` labels at `shared/locale/en/notifications/index.ts:11` and `ar/notifications/index.ts:11`; flat errors precedent at `shared/locale/types/errors/index.ts:93,97`.
  - Journey harness: `test/workflows/AGENTS.md` EXISTS (verify — do not scaffold); `SpiedFanoutTransport` import pattern at `backend/services/notifications/notification-engine.emit.test.ts:70`; in-memory claim-cache model at `:177-215`; ghost-proof precedent at `:780-828`.
  - `entity-setup.ts` signature verification BEFORE any fixture use (`backend/db/test/entity-setup.ts`).
  - IF any anchor is missing: record a ❌ ledger entry and BLOCK the dependent task — never inline-patch a foreign layer.
  - _Requirements: REQ-002, REQ-003, REQ-004_

### 0.3 Phase 1.5 Plan-Review Gate (BLOCKING)

- [x] 0.3 [@plan-review — ZERO violations required before any implementation task begins]
  - Review the trio (`specs.md` + `plan.md` + this `tasks.md`).
  - The review MUST ratify two rulings: (a) the §0 scope reconciliation — this ticket ships the notification WAVE only; session intake/accept/decline/B.16 routing are resolved-pointer forward items; (b) the D2 signature reconciliation — emitters carry `(sessionId, locale, tx?, options?)` with the second positional `locale` absent from specs.md REQ-011's literal shape.
  - Write `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/plan-review-R1.md`.
  - _Requirements: REQ-083_

---

## Phase 1: Types, Enums & i18n (NO Database Schema Work — Zero-Drift Ticket)

> There are **NO Drizzle schema tasks** in this phase: the schema is consumed read-only and `git diff backend/db/schema/** backend/db/migration/**` MUST remain empty at completion. No `bun run db push` is ever invoked.

### 1.1 Canonical Types — NEW `session-notification.types.ts`

- [x] 1.1 [Create canonical wave types]
  - CREATE `backend/types/classes/session-notification.types.ts` with EXACTLY the four exports from plan §2.2: `SessionRequestWaveKind` (closed six-member union), `SessionWaveContextRow` (raw joined row, `intent: string | null`), `SessionWaveParticipantContext`, `SessionWaveContext`.
  - UPDATE `backend/types/classes/index.ts` barrel (today re-exports six files) with `export * from "./session-notification.types";`.
  - Type-only imports of `SessionIntent` (enum member types) are fine here; runtime enum usages elsewhere MUST be VALUE imports (REQ-002).
  - NO service-layer `.types.ts` files; NO local types in services.
  - Instructions: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-003_
  - [x] 1.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/classes/session-notification.types.ts --lifecycle duplicates` (exit 0) + same for the barrel.
  - [x] 1.1.TE **Test Engineering:** the contracts conformance suites (`backend/types/contracts/contracts.conformance.test-d.ts`, `contracts.static-assertions.test.ts`) MUST stay green UNEDITED — run via `bun run test/scripts/run-test.ts backend/types/contracts`.
  - [x] 1.1.SEC **Security & Tenancy Audit:** the wave-context row carries ONLY id/fullName/locale/intent — no email/phone/governance fields may be added (PII surface pinned at type level).
  - [x] 1.1.SR **Semantic Review:** canonical-types-only discipline; zero dead exports; `AppLocale` import from `@/shared/locale/AppLocale` (NOT from frontend/backend paths).
  - [x] 1.1.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md` + `backend/types/` layer conventions.

### 1.2 i18n Keys — notifications Namespace Extension + errors Flat Keys + Parity Suite (ONE Changeset)

- [x] 1.2 [Add 15 notifications keys + 2 errors keys and extend the parity suite in the SAME changeset]
  - UPDATE `shared/locale/types/notifications/index.ts`: add six title string slots (`eventSessionRequestTitle`, `eventSessionAcceptedTitle`, `eventSessionDeclinedTitle`, `eventSessionAutoRejectedTitle`, `eventSessionQueuedTitle`, `eventSessionAlternativesOfferedTitle`), six body function slots (`eventSessionRequestBody: (studentName: string, intentLabel: string) => string`; the five outcome bodies `(teacherName: string) => string`), and three intent label string slots (`intentHifz`, `intentTajweed`, `intentEvaluation`).
  - UPDATE `shared/locale/en/notifications/index.ts` and `shared/locale/ar/notifications/index.ts` with concrete copy for all 15 keys; Arabic body/title strings MUST contain Arabic script.
  - UPDATE `shared/locale/types/errors/index.ts` + `en/errors/index.ts` + `ar/errors/index.ts`: FLAT domain-prefixed keys `sessionNotFound` and `sessionIntentCorrupt` (flat precedent: `notificationNotFound`, `studentHandshakeNotFound`).
  - UPDATE `shared/locale/notifications-namespace.parity.test.ts` in the SAME changeset: extend `MANDATED_KEYS` (26 → 41) and `FUNCTION_KEYS` (4 → 10); keep the "exactly seven `type*`-prefixed slots" pin GREEN (the new keys are `event*`/`intent*`-prefixed, never `type*`); add pins (mirroring the suite's Arabic-script pins — the `ARABIC_SCRIPT` regex at :102 and the pinned Arabic strings at :192-238) asserting every new `ar` string slot contains Arabic script and every new ar function slot returns Arabic-script output.
  - The extension MUST also update the five stale count sites in `shared/locale/notifications-namespace.parity.test.ts` (plan-review R1 amendment): the `:49` "(26 slots)" comment, the `:148` test title (no silent key minting beyond 26), the `:180` test title ("all four ar FUNCTION slots"), the `:240-249` callable pin (currently iterates/handles only the four legacy function slots — extend it to cover ALL TEN function slots, e.g. by iterating `FUNCTION_KEYS`), and the `:276` describe title.
  - New Arabic function-slot pins MUST mirror the `ARABIC_SCRIPT.test(...)` regex-based assertions at `:180-186`, NOT the exact-string plural/template pins at `:192-238` (plan-review R1 amendment).
  - FORBIDDEN anywhere: `next-intl`, `getBackendTranslations`, `shared/messages/`, a NEW namespace, `Translation` enum references.
  - Instructions: `.agents/instructions/backend.instructions.md`; namespace registration rules in `shared/AGENTS.md`.
  - _Requirements: REQ-002, REQ-013, REQ-051_
  - [x] 1.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on ALL seven locale files + the parity test (exit 0 each).
  - [x] 1.2.TE **Test Engineering:** `bun run test/scripts/run-test.ts shared/locale/notifications-namespace.parity.test.ts` AND `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` both green.
  - [x] 1.2.SEC **Security & Tenancy Audit:** copy templates interpolate ONLY `studentName`/`teacherName`/`intentLabel` — no other interpolation surface; no counterparty contacts in any string.
  - [x] 1.2.SR **Semantic Review:** key names are EXACTLY the REQ-013 inventory; no invented nested groupings (ErrorsLabels is FLAT); en/ar trees structurally identical.
  - [x] 1.2.IV **Instruction Verification:** validate against `shared/AGENTS.md` namespace checklist + auto-discovered instruction files.

---

## Phase 2: Repositories & Backend Services

### 2.1 Write Session-Request Notification Journey Test — TEST-FIRST

- [x] 2.1 [Write cross-actor journey BEFORE any repo/service code exists — it MUST fail red]
  - FIRST scaffold the test-first STUB service (plan-review R1 amendment): create `backend/services/classes/session-request-notification.service.ts` with `export namespace SessionRequestNotificationService` exposing the SIX public methods at their FINAL signatures — `(sessionId: number, locale: string, tx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<NotificationDeliveryReceipt>` — for `notifyTeacherOfSessionRequest`, `notifyStudentOfSessionAccepted`, `notifyStudentOfSessionDeclined`, `notifyStudentOfSessionAutoRejected`, `notifyStudentOfSessionQueued`, `notifyStudentOfAlternativesOffered`; each stub body `throw`s `DomainError("INTERNAL_SERVER_ERROR", "<emitter> test-first stub — implemented in task 2.3")`. Also create `backend/services/classes/index.ts` and register `export * from "./classes"` in `backend/services/index.ts`. This stub is what makes 2.1.QL attainable: tsgo compiles (no unresolved import) and the journey fails RED at RUNTIME on assertions, never at compile; task 2.3 REPLACES the stub bodies with the real `emitWave` choreography.
  - Create `test/workflows/classes/session-request-notifications.journey.test.ts` — one file for the REQ-090..REQ-095 cross-actor workflow (Student S, Teacher T, preference counterparties U/V/W, isolation observers X/Y, System fixture layer).
  - If `test/workflows/classes/` does not exist, scaffold the directory; the shared harness (`test/workflows/AGENTS.md`, `TrackedFixtures`, helpers) already exists per task 0.2 verification — extend helpers in `test/workflows/helpers/` ONLY if the cast needs rows the helpers cannot yet provision (verify first).
  - Provision the actor cast in `beforeAll` via ONE committing `db.transaction` — fixture ruling (plan-review R1 amendment): entity/property rows that helpers CAN provision go through `backend/db/test/entity-setup.ts` (signatures verified in 0.2) + `test/workflows/helpers/` (actor-context) helpers; rows that NO helper can provision are created by DIRECT committed Drizzle inserts inside the SAME committing `beforeAll` transaction, tracked in `TrackedFixtures` for FK-safe teardown — that covers the four `session` rows (S↔T, S↔U, S↔V, S↔W), the teacher rows incl. the U/V/W B.16 `requestPreference` `reject`/`queue`/`offer_alternatives` variants (`provisionCertifiedTeacherActor` cannot set `requestPreference`), and any locale-pinning the helpers cannot express (e.g. T's `users.locale='ar'`). Sanctioned fixture-level pattern per plan D9 — the session-creation write path is DEV3-004's, NOT fabricated here; the same ruling extends to the repo/service tiers (direct inserts inside `runInRollback`). Unique `jrn_sessreq_<uuid8>` prefixing on all fixture identity fields.
  - Inject `SpiedFanoutTransport` + a suite-local `Map`-backed `NotificationIdempotencyClaimCache` (modeled on `notification-engine.emit.test.ts:177-215`) through the emitters' `options` seam.
  - Steps as sequential REAL service calls (NO GraphQL layer, NO monkey-patched permissions — there is no auth surface on the emitters by construction):
    1. Teacher wave with `(undefined)` tx → assert EXACTLY ONE `notifications` row: `userId=T.id`, `type='session_request'`, `relatedEntityType='session'`, `relatedEntityId=session_ST.id`, `isRead=false`, ARABIC body containing S's fullName + Arabic intent label; spied transport records EXACTLY ONE publish with `userIds === [T.id]`.
    2. Replay the same call under the held claim cache → prior receipt returned, row count unchanged, publish count unchanged (REQ-094).
    3. Accept wave → ONE English row for S naming T; decline wave → ONE SECOND, DISTINCT row (append-only, never overwrite); T's inbox count unchanged by either outcome wave.
    4. Three B.16 waves on their own sessions → S gains EXACTLY THREE rows, each copy naming the CORRECT counterparty (U vs V vs W), three DISTINCT deterministic keys (`session:<id>:outcome_*`).
    5. Isolation invariance: X and Y end with ZERO attributable rows; spy shows NO envelope addressed to any non-participant (REQ-093).
    6. Denial probes: missing id → `SESSION_NOT_FOUND` with ONE domain log, zero rows/publishes; hostile ids (`0`, `-1`, `NaN`) → `VALIDATION` pre-DB; a fixture session with intent corrupted via direct update → `SESSION_INTENT_CORRUPT`, zero rows (REQ-095).
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` with `verifyAllAbsent` zero-residue re-probes in FK-safe order (notifications → sessions → child/entity rows) — NEVER `runInRollback` around service calls (services spawn their own transactions).
  - Spy notification dispatch; NEVER hit real email/SMS/push channels.
  - Run (expected RED — module does not exist yet): `bun run test/scripts/run-test.ts test/workflows/classes/session-request-notifications.journey.test.ts`.
  - Instructions: `.agents/instructions/tests.instructions.md` + `test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`.
  - _Requirements: REQ-072, REQ-090, REQ-091, REQ-092, REQ-093, REQ-094, REQ-095_
  - [x] 2.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts test/workflows/classes/session-request-notifications.journey.test.ts --lifecycle duplicates` (exit 0).
  - [x] 2.1.TE **Test Engineering:** the journey IS the cross-actor tier — assert shared-state transitions after every actor step, cross-actor visibility rows, denial paths, and idempotent replay (REQ-090..093, REQ-095 and REQ-094 clause (i) — replay under held key — mapped 1:1 to `it` blocks with assertive names; REQ-094 clause (ii) — cache-absent fail-open warn — is NOT a journey step: it is verified at the SERVICE Tier-3 in task 2.3.TE — plan-review R1 amendment).
  - [x] 2.1.SEC **Security & Tenancy Audit:** isolation-observer invariance (X/Y zero rows) is the honest BOLA proof; no fabricated authorization — the emitters' derived-recipient design is asserted, not simulated.
  - [x] 2.1.SR **Semantic Review:** zero `runInRollback` anywhere; zero `console.*`; fixtures committed-and-tracked; assertions on REAL row state (DB re-reads), not on returned objects alone.
  - [x] 2.1.IV **Instruction Verification:** validate against `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md` + `docs/testing/workflow-journey-tests.md`.

### 2.2 NEW Repository — `SessionRepository`

- [x] 2.2 [Implement `backend/db/repo/classes/session.repository.ts`]
  - CREATE `backend/db/repo/classes/session.repository.ts` with `export namespace SessionRepository` exposing EXACTLY two methods:
    - `findById(sessionId: number, tx?: DBQueryExecutor): Promise<SessionSelectType | null>`
    - `findWaveContextById(sessionId: number, tx?: DBQueryExecutor): Promise<SessionWaveContextRow | null>` — ONE joined read returning session id/intent + BOTH participants' `userId`/`fullName`/`locale`.
  - Driver split per the verified `student.repository.ts:96-112` idiom: tx branch uses Drizzle with TWO `alias(users, "wave_student_user")` / `alias(users, "wave_teacher_user")` from `drizzle-orm/pg-core`, `innerJoin` on `session.studentId`/`session.teacherId`, `where(eq(session.id, sessionId)).limit(1)`; non-tx branch uses ONE flat parameterized `queryDb` statement (the exact SQL in plan §4.1) — NO inline `--` comments in the template, NO prepared statements, NO `inArray`+`sql.placeholder`, NO LIKE/ILIKE anywhere.
  - CREATE `backend/db/repo/classes/index.ts` (`export * from "./session.repository";`); UPDATE `backend/db/repo/index.ts` top-level barrel (`+ export * from "./classes";`).
  - Row mapping to `SessionWaveContextRow` is field-by-field (NO object spread of raw rows).
  - Instructions: `.agents/instructions/backend.instructions.md` + `backend/db/repo/AGENTS.md` (verify existence from the tree before citing).
  - _Requirements: REQ-003, REQ-042, REQ-044_
  - [x] 2.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on the repo file + both barrels (exit 0 each).
  - [x] 2.2.TE **Test Engineering:** CREATE `backend/db/repo/classes/__tests__/session.repository.test.ts` per the `backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts` precedent — `runInRollback`, tx propagated to every call, fixtures via verified `entity-setup.ts` helpers where they exist; session/teacher rows (incl. preference variants) via direct Drizzle inserts inside the same `runInRollback` transaction — plan-review R1 fixture ruling (no factories exist). Cover: `findById` hit AND miss; `findWaveContextById` joined shape (both `fullName`/`locale` present); a participant with `locale = null` (fallback row mapping); zero writes on read paths (row-count oracle around calls). Target 100% statement/branch on the NEW repo file. Run via `bun run test/scripts/run-test.ts backend/db/repo/classes/__tests__/session.repository.test.ts`.
  - Placement ruling (plan-review R1 amendment): the test stays co-located at `backend/db/repo/classes/__tests__/session.repository.test.ts` per the `student-grant-free-trial-once.test.ts` precedent, knowingly deviating from `backend/db/test/AGENTS.md`'s `backend/db/test/repo/` placement rule (that AGENTS file is partially stale — it references nonexistent helpers); 100% coverage and runInRollback/tx discipline still apply.
  - [x] 2.2.SEC **Security & Tenancy Audit:** parameterized bindings only; equality + joins only; no LIKE surface (`escapeLikeWildcards` N/A by construction); no governance/PII columns selected.
  - [x] 2.2.SR **Semantic Review:** tx-vs-`queryDb` branch discipline; canonical types only (`SessionSelectType`, `SessionWaveContextRow`, `DBQueryExecutor` from `backend/types/`); zero dead code; no cross-layer imports.
  - [x] 2.2.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md` + repo-layer AGENTS.md rules.

### 2.3 NEW Service — `SessionRequestNotificationService` (Six Emitters)

- [x] 2.3 [Implement `backend/services/classes/session-request-notification.service.ts` — REPLACES the task-2.1 test-first stub bodies]
  - REPLACE the task-2.1 stub bodies (plan-review R1 amendment — the file/barrels already exist from the 2.1 scaffold; do NOT re-create them) with `export namespace SessionRequestNotificationService` exposing EXACTLY the six public methods, each with signature `(sessionId: number, locale: string, tx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<NotificationDeliveryReceipt>`:
    `notifyTeacherOfSessionRequest` · `notifyStudentOfSessionAccepted` · `notifyStudentOfSessionDeclined` · `notifyStudentOfSessionAutoRejected` · `notifyStudentOfSessionQueued` · `notifyStudentOfAlternativesOffered`.
  - Each public method is a ONE-LINE delegate into a private `emitWave(sessionId, waveKind, recipientSide, locale, tx, options)` implementing plan §4.2 steps 1–9 VERBATIM:
    1. `getServerTranslations(locale).errorsTranslations` for service-side error copy (ONE argument, tree access).
    2. `isPositiveSafeInt(sessionId)` PRE-DB → else `ValidationError(t.validation)` (zero reads).
    3. `SessionRepository.findWaveContextById(sessionId, tx)`; null → EXACTLY ONE `logger.logDomainError("Session not found for notification wave", { code: "SESSION_NOT_FOUND", entity: "session", entityId: sessionId, locale })` (message-first shape per `backend/lib/logger.ts:92` — plan-review R1 amendment; a null joined read uniformly means the session is absent — the participant-missing INTERNAL_SERVER_ERROR branch is dropped per A2) → `throw new NotFoundError("SESSION", t.sessionNotFound)`.
    4. Null-first intent guard `if (row.intent === null || !isSessionIntent(row.intent))` ⇒ corrupt (plan-review R1 amendment; the `contract-guards.ts` guard file is NEVER edited): EXACTLY ONE `logger.logDomainError("Session intent corrupt for notification wave", { code: "SESSION_INTENT_CORRUPT", entity: "session", entityId: sessionId, locale })` → `throw new ValidationError("SESSION_INTENT_CORRUPT", t.sessionIntentCorrupt)` (overloaded ctor).
    5. Recipient/counterparty selection by `recipientSide` (`"teacher"` only for `teacher_request`).
    6. `recipientLocale = recipient.locale ?? defaultLocale` (`shared/locale/AppLocale.ts:3`).
    7. Copy via `getServerTranslations(recipientLocale).notificationsTranslations` per the REQ-013 matrix; intent label via an EXHAUSTIVE switch over `SessionIntent` ENUM MEMBERS (VALUE import — no string literals).
    8. `NotificationEmitInput` assembled FIELD-BY-FIELD (`userId`, `type: NotificationType.SessionRequest` (VALUE import), `title`, `body`, `relatedEntityType: "session"`, `relatedEntityId: sessionId`, `idempotencyKey: \`session:${sessionId}:${waveKind}\``) — NO spreads, NO caller input object.
    9. Branch: caller-tx → `NotificationEngine.emitForUser(input, recipientLocale, tx, options)` then `return result;` DIRECTLY — the engine ALWAYS returns the receipt under caller-tx, so the wrap fallback was dead code (plan-review R1 amendment), receipt returned verbatim, NO publish; no-tx → `emitForUser(input, recipientLocale, undefined, options)` where the REAL `"notifications" in result` type guard (no `as` casts) distinguishes replay (returns the prior receipt verbatim — engine already committed+published on the fresh path) from the fresh bare-row result, which is wrapped as `{ notifications: [row], recipientUserIds: [recipient.userId] }`.
  - Module header MUST document: emitters are receipt producers (caller-tx callers publish via `NotificationEngine.publishReceipts` AFTER their own commit); emitters NEVER authorize (internal primitives, REQ-018).
  - CREATE `backend/services/classes/index.ts` (`export * from "./session-request-notification.service";`) and register `export * from "./classes";` in `backend/services/index.ts` — IF NOT already created by the 2.1 stub scaffold.
  - Happy path logs NOTHING; expected rejections log EXACTLY ONCE with bounded context; unexpected internals propagate UNCATCHED; `console.*` forbidden (`@/backend/lib/logger` only).
  - Instructions: `.agents/instructions/backend.instructions.md` + `backend/services/AGENTS.md`.
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-018, REQ-031, REQ-032, REQ-033, REQ-040, REQ-042, REQ-050, REQ-052, REQ-053_
  - [x] 2.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on the service file + both barrels (exit 0 each).
  - [x] 2.3.TE **Test Engineering:** CREATE `backend/services/classes/session-request-notification.service.test.ts` — `runInRollback` + `expectRepoError` try/catch (NEVER `.rejects.toThrow()`), `SpiedFanoutTransport` + injectable claim cache via the `options` seam. Fixtures follow the plan-review R1 fixture ruling (A4): entity rows provisionable via verified `entity-setup.ts` helpers use them; session rows (incl. the direct-update intent-corrupt fixture) and teacher rows (incl. `requestPreference` variants and locale pinning the helpers cannot express) are DIRECT Drizzle inserts inside the same `runInRollback` transaction:
    - **Tier 1 (branch/stmt):** all six emitters happy-path; all failure branches (`SESSION_NOT_FOUND`, `SESSION_INTENT_CORRUPT`, `VALIDATION`) each with EXACTLY ONE `logDomainError` (log-spy count) and ZERO rows.
    - **Tier 2 (boundary):** `sessionId` = `Number.MAX_SAFE_INTEGER` (valid shape, not found); `0`, `-1`, `1.5`, `NaN`, `2**53` (all `VALIDATION` pre-DB); participant `locale = null` → copy composed under `defaultLocale`; hostile unicode/RTL/emoji participant names composed VERBATIM into bodies.
    - **Tier 3 (chaos):** 25-way `Promise.allSettled` distinct-wave storm → all-fulfilled + exact final row-set equality; deterministic-key replay under an injected claim cache → prior receipt, ZERO new rows, ZERO new publishes; cache-absent fail-open path → wave lands with EXACTLY ONE engine `NOTIFICATION_IDEMPOTENCY_DEGRADED` warn; forced mid-tx failure test → `notifications` count unchanged AND `publishCount === 0` (ghost-push impossibility, REQ-041).
    - **Tier 4 (security):** hostile-id fuzz with a repo-spy proving ZERO DB calls pre-validation failure; derived-recipient invariant — a session whose participants differ can NEVER redirect a wave to any other user (recipient comes only from the joined read).
    - Run via `bun run test/scripts/run-test.ts backend/services/classes/session-request-notification.service.test.ts`.
  - [x] 2.3.SEC **Security & Tenancy Audit:** BOLA — recipient ids NEVER parameters, derived from the FK-chained joined read; BOPLA — whitelisted field-by-field `NotificationEmitInput`, zero spreads; BFLA — zero role logic inside the module (documented internal-primitive posture); PII — copy carries at most counterparty `fullName` + intent label; logs bounded to `{ code, entity, entityId, locale }`.
  - [x] 2.3.SR **Semantic Review:** identical `tx` threaded through every repo/engine call in a flow; no module-level mutable state; no mixing of tx-scoped and global-`db` executors in one path; enums as VALUE imports; no local type declarations (canonical `SessionWaveContextRow`/`SessionWaveContext`/`NotificationDeliveryReceipt` only).
  - [x] 2.3.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md` + `backend/services/AGENTS.md` + engine-doc §3.1–3.3 emit choreography.

### 2.M Mid-Point Review Gate

- [x] 2.M [Halt and self-audit BEFORE any later phase]
  - Re-run: repo tests, service 4-tier suite, journey (now GREEN — `bun run test/scripts/run-test.ts test/workflows/classes/session-request-notifications.journey.test.ts`), both parity suites.
  - Verify REQ-017 invariants ALREADY hold: `git diff backend/db/schema/** backend/db/migration/**` EMPTY; `backend/lib/gateway/public-operations.ts` untouched.
  - Verify engine non-modification: `git diff backend/services/notifications/** backend/graphql/**` EMPTY (consumption-not-modification).
  - Audit every REQ-001..REQ-053 line against the implemented code; record findings (or clean bill) in `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/2M-midpoint-review-outcome.md`.
  - Any blocking gap → new ❌ ledger entry + fix before proceeding; forward-looking gaps → ✅ resolved-pointer entries.
  - _Requirements: REQ-040, REQ-041, REQ-043, REQ-044, REQ-053, REQ-075 (partial)_

---

## Phase 3: GraphQL Resolvers & API Handlers — HARD-FREEZE VERIFICATION (No Implementation)

> **Scope ruling:** this ticket adds ZERO GraphQL surface. Phase 3 exists ONLY as freeze verification; no resolver/Pothos/SDL code is authored.

- [x] 3.1 [Verify zero-GraphQL-drift posture, end to end]
  - Run, and confirm GREEN WITHOUT ANY EDITS: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/sdl-static-assertions.test.ts`, `backend/graphql/test/handshake-code-surface.test.ts`, plus the committed-vs-live parity check (`plan-catalog.schema.test.ts:67-73`) and the public-operations test (`backend/lib/gateway/public-operations.test.ts`).
  - Run `bun run generate:gqlSchema && bun codegen` — MUST be a recorded NO-DIFF proof (`git status` clean on generated artifacts afterward); paste the evidence into the outcome file.
  - Grep-proof: no `sessionRequest` / `requestSession` / `acceptSessionRequest` / `declineSessionRequest` / `*session*` token appears on the Mutation/Query roots.
  - `backend/lib/gateway/public-operations.ts` remains the frozen six — byte-identical.
  - IF any freeze suite fails due to PRE-EXISTING drift (e.g. post-DEV3-016 fields absent from frozen inventories): DO NOT re-anchor the baseline — record a ✅ resolved-pointer ledger entry for the freeze-suite owner and document the pre-existing failure with its baseline diff in the outcome.
  - Write `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/3.1-outcome.md`.
  - _Requirements: REQ-017, REQ-030, REQ-060, REQ-074_

---

## Phase 4: Frontend — DISCHARGED BY ABSENCE (Verification-Only Confirmation)

> **Scope ruling:** ZERO frontend tasks. This ticket creates no component, page, route, nav item, store, or GraphQL document, so the UI 7-stage pipeline (incl. `.BF`/`.BS` agent-browser loops) applies to NOTHING. The phase below is a confirmatory check, not implementation.

- [x] 4.1 [Confirm shipped-surface consumption with zero frontend deltas]
  - Assert byte-identity: `frontend/views/dashboard/navItems.ts` UNCHANGED; no files under `frontend/views/`, `frontend/components/`, `app/` touched (`git diff --name-only -- frontend/ app/` EMPTY).
  - DTYPE-level compatibility check (compile-time, no new UI test file): the emitted row satisfies the EXISTING `NotificationReturnType` reading path and the pre-existing `typeSessionRequest` label slot (`shared/locale/en/notifications/index.ts:11`, `ar`:11) — evidenced by service/journey row-shape assertions plus a `bun tsgo` clean pass.
  - Record the REQ-062 forward contract in the ledger (actionable accept/decline CTA is a session-engine/UI-ticket item — ✅ resolved-pointer; the realtime payload allowlist is engine-owned and frozen here).
  - Record REQ-063 discharge-by-absence (no MUI/v9, React 19, RTL, or nav work exists to verify; `.BF`/`.BS` loops N/A by absence).
  - Write `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/4.1-outcome.md`.
  - _Requirements: REQ-061, REQ-062, REQ-063_

---

## Phase 5: Integration & Differential Testing

- [x] 5.1 [Full differential gate — engine regression + freeze suites + new suites, all green together]
  - Engine regression (consumption-not-modification proof — ALL UNEDITED): `bun run test/scripts/run-test.ts backend/services/notifications/notification-engine.emit.test.ts`, `...inbox.test.ts`, the chaos suite, and the realtime transport suites.
  - New suites: repo test, service 4-tier, journey, both parity suites — re-run in one pass.
  - GraphQL freeze suites re-run (task 3.1 set) UNEDITED.
  - Orchard-wide spot guard: `handshake-code-surface.test.ts` and the inherited notification GraphQL inbox matrix (`backend/graphql/test/notification-integration.matrix.test.ts`) green UNEDITED.
  - Evidence (command list + results) written to `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/5.1-outcome.md`.
  - _Requirements: REQ-070, REQ-071, REQ-072, REQ-073, REQ-074, REQ-075 (partial)_
- [x] 5.2 [Baseline gate & final ledger gate]
  - Re-run `bun tsgo`, `bun biome:check`, and the lint command from task 0.1 — counts MUST equal baseline + ZERO new errors/warnings; attach diffs as evidence.
  - Re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` over EVERY created/modified file in one pass (exit 0 each).
  - Final ledger: `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/deferred-items.md` = 0 (row-scoped — only ledger table rows count; plan-review R1 amendment).
  - Schema/migration emptiness proof one final time: `git diff backend/db/schema/** backend/db/migration/**` EMPTY.
  - Write `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/5.2-outcome.md`.
  - _Requirements: REQ-001, REQ-017, REQ-075_

---

## Phase 6: Post-Implementation Review Waves

> UI review waves are SCOPED OUT (no frontend exists). The waves below run in parallel where possible; every finding is either fixed in-flight or recorded as a ✅ resolved-pointer ledger entry.

- [x] 6.1 [review-types wave] — Audit canonical-type discipline: new types file is the ONLY additive type; no local types in service/repo/tests; contracts conformance suites still green UNEDITED; enum VALUE imports at every runtime use. Outcome: `outcome/6.1-review-types-outcome.md`. _Requirements: REQ-002, REQ-003_
- [x] 6.2 [review-backend wave] — Audit: single-writer through `NotificationEngine` only; caller-tx receipt / publish-after-commit choreography; tx propagation everywhere; error taxonomy (`SESSION_NOT_FOUND` / `SESSION_INTENT_CORRUPT` / `VALIDATION`); ONE-log-per-rejection + happy-path silence; no module-level mutable state; repo driver-split correctness. Outcome: `outcome/6.2-review-backend-outcome.md`. _Requirements: REQ-010..REQ-016, REQ-040..REQ-044, REQ-050..REQ-053_
- [x] 6.3 [pentester wave] — Adversarial audit: derived-recipient BOLA impossibility (attempt recipient-smuggling scenarios mentally + confirm Tier-4 proofs); BOPLA spread-scan over the new service; hostile-id pre-DB rejection; PII minimality in copy/logs; oracle-honesty documentation (NOT_FOUND is internal, non-precedential); governance-window honesty statement present and unchanged. Outcome: `outcome/6.3-pentester-outcome.md`. _Requirements: REQ-030..REQ-034_
- [x] 6.4 [Deferred-items & file hygiene wave] — `find . -name "*.orig" -o -name "*.rej" -o -name "*.bak"` EMPTY under the ticket's touched paths; ledger re-grep = 0 ❌/⚠️; every outcome file present for tasks 0.1→6.3. Outcome: `outcome/6.4-ledger-hygiene-outcome.md`. _Requirements: REQ-075, REQ-083_

---

## Phase 7: Knowledge Propagation & Documentation

- [x] 7.1 [Canonical documentation]
  - CREATE `docs/notifications/session-request-notifications.md` with the mandated structure: **Why** → the six-wave **Pattern** (wave table: emitter → recipient side → copy slots → `type=session_request` → `relatedEntityType="session"` → deterministic key `session:<id>:<waveKind>`) → **Rules** (single-writer through `NotificationEngine`; caller-tx receipt / publish-after-commit; recipient-locale composition is THIS module's A.4.3/D2 obligation — first full in-tree implementation, lineage recorded; closed-payload ruling; emitters-never-authorize) → **What NOT to Do** (never emit session notifications outside this module; never widen the realtime payload for CTAs; never pass recipient ids; never trust caller-supplied participants; never mutate session state) → **Rollout Summary** (file table of all created/modified files) → **Forward Consumption Contract** (DEV3-004/005 intake+accept/decline; DEV2-011 in-session detection; DEV3-008 alternatives computation — mirroring the ledger's resolved-pointers) → **Related Documents**.
  - UPDATE `docs/notifications/realtime-engine.md` §3.2 consumption table: ONE-LINE shipped-pointer on the DEV3-011 row — NO structural edit.
  - `docs/specs/state-machine-invariants.md` and `docs/specs/open-decisions-and-gaps.md` remain UNEDITED (no new invariants minted).
  - Write `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/7.1-outcome.md`.
  - _Requirements: REQ-080, REQ-081_
- [x] 7.2 [AGENTS propagation]
  - UPDATE `backend/services/AGENTS.md`: ONE new rule line — session-request notification waves live exclusively in `SessionRequestNotificationService`; emitters never authorize and never publish inside caller tx — plus the canonical-doc link.
  - UPDATE `backend/db/repo/AGENTS.md`: the repo-layout `classes/` row at `backend/db/repo/AGENTS.md:21` is STALE (plan-review R1 amendment) — add the new `session.repository` entry by EXTENDING that existing row, NEVER minting a second `classes/` row or a new layout section.
  - OPTIONAL: `shared/AGENTS.md` — add ONE clarifying line on the locale-namespace extension pattern ONLY if 1.2 surfaced a genuinely new rule (record either way in the outcome).
  - UPDATE root `AGENTS.md` Important References: add the `docs/notifications/session-request-notifications.md` line.
  - `test/workflows/AGENTS.md`: UNTOUCHED unless the journey surfaced a genuinely new harness rule (record either way in the outcome).
  - Write `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/7.2-outcome.md`.
  - _Requirements: REQ-082_
- [x] 7.3 [Outcome synthesis & ticket closeout]
  - Synthesize `ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/outcome/FINAL-outcome.md`: REQ-001→REQ-095 disposition table (met / discharged-by-absence / transferred-as-resolved-pointer), the zero-drift evidence bundle (git diffs, codegen no-diff, freeze-suite greens), the baseline-vs-final lint/type numbers, and links to every task outcome.
  - Final gate re-verification: all checkboxes `[x]`; ledger `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/sprint_2/dev3-011-session-request-notification-to-teacher/deferred-items.md` = 0 (row-scoped — plan-review R1 amendment); schema/migration diff empty; engine layer untouched.
  - _Requirements: REQ-075, REQ-083_
