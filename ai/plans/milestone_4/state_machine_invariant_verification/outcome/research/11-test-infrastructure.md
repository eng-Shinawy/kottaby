# Research Dossier — Test Infrastructure & Conventions (cross-cutting)

Scope: HOW invariant-verification tests must be written and where they live. Per-invariant
coverage verdicts live in the sibling domain dossiers; this dossier grounds the conventions
they must cite. All `path:line` citations verified in-session on the live tree.

## 1. Invariants in scope (state machines + doc line refs)

Ticket: `docs/planning/TICKETS.md:2873-2910` ("State Machine Invariant Verification Tests",
Milestone 4, Dev 2, 5 SP). Gherkin table verified at TICKETS.md:2888-2900.

| Machine | Invariant IDs | Doc table lines (docs/specs/state-machine-invariants.md) |
|---|---|---|
| 1. Session lifecycle | INV-S1..S8 | 42-49 (table header 39-41) |
| 2. Teacher verification | INV-TV1..TV7 | 87-93 (header 84-86) |
| 3. Teacher availability | INV-A1..A4 | 120-123 (header 117-119) |
| 4. Subscription & balance | INV-B1..B8 | 152-159 (header 149-151) |
| 5. Wallet & transaction | INV-W1..W8 | 213-220 (header 210-212) |
| 6. Student account | INV-U1..U5 | 251-255 (header 248-250) |
| 7. Parent-child link | INV-P1..P4 | 274-277 (header 271-273) |
| 8. Payment | INV-PAY1..PAY7 | 302-308 (header 299-301) |
| 9. Homework & progress | INV-HW1..HW4, INV-PR1..PR3 | 317-320, 325-327 (header 314-316) |
| 10. Evaluation | INV-E1..E6 | 336-341 (header 333-335) |
| (11.) Plan catalog | INV-PC1..PC3 | 356-358 (header 353-355) — NOT in ticket table |

Count discrepancy (scope boundary): the ticket Gherkin names 60 IDs (B1..B6, PAY1..PAY5,
no PC) across 10 machines; the spec doc defines 67 (adds B7, B8, PAY6, PAY7, PC1..PC3).
The plan must state explicitly whether doc-only IDs (B7/B8, PAY6/PAY7, PC1-3) are in scope —
the ticket text says "all state machine invariants from state-machine-invariants.md", which
reads as doc-complete (67), while the Gherkin table reads 60.

## 2. Enforcement map → test-accessibility per enforcement tier

| Enforcement mechanism | Where installed | How a test proves it (verified recipe) |
|---|---|---|
| CHECK constraints (named) | Drizzle schema + `backend/db/migration/`, `backend/drizzle/custom_*/migration.sql` | Savepoint bracket + raw write via `tx` + `constraintNameOf` + `hasPostgresErrorCode(err,"23514")` — canonical: `backend/db/test/repo/billing/wallet.repository.test.ts:485-492` |
| Immutability triggers `prevent_*_update/delete` | `backend/db/migration/3-immutability-triggers.sql`, `backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:30-98` (amendments: `custom_4`/`custom_5` dirs) | Trigger-presence probe on `pg_trigger` (`tgtype`/`tgenabled`) + savepoint-bracketed tamper expecting the RAISE text — canonical: `backend/db/test/logic/billing/financial-immutability.test.ts:109-178,363-516` |
| Guarded single-statement UPDATEs (zero rows = denial) | `backend/db/repo/**` | Zero-row → `null` return + zero DB delta assertions — canonical: `backend/db/test/repo/teachers/applicant.repository.re-evaluation.test.ts:18-34` |
| Service guard / transition matrix | `backend/services/**` (e.g. `SESSION_TRANSITION_MATRIX`, `session-lifecycle.enforcement.ts`) | Co-located service test via `runInRollback` + typed denial — canonical: `backend/services/classes/session-lifecycle.enforcement.test.ts:1` ("SESSION_TRANSITION_MATRIX (INV-S1/S2/B.18 codified)") |
| Cross-actor end-to-end | `test/workflows/**` | Committed-fixture journey with registry cleanup, NO rollback — canonical: `test/workflows/sessions/session-state-machine.journey.test.ts:1-44` |

Migrations dual-homed: canonical numbered SQL in `backend/db/migration/` (3-immutability-triggers.sql,
4-student-payments-status-transition.sql, 5-teacher-transaction-settlement.sql, …) and
drizzle-kit folders `backend/drizzle/*custom_*/migration.sql` (32 folders; trigger-bearing:
`custom_3-immutability-triggers`, `custom_4-student-payments-status-transition` (2 dirs),
`custom_5-teacher-transaction-settlement` (2 dirs), `custom_5-student-payments-provider-transaction`).

## 3. Existing coverage — test-infrastructure assets (all verified)

### 3.1 DB test core (`backend/db/test/`)
- `runInRollback(fn: (tx: DBTransaction) => Promise<T>): Promise<T | undefined>` — `backend/db/test/test-utils.ts:34`. Sentinel-throw forces ROLLBACK; no savepoint at top level (test-utils.ts:22-25, 42-48). Import: `@/backend/db/test/test-utils` (alias preferred — `backend/db/test/logic/AGENTS.md:39`).
- `expectRepoError(fn: () => Promise<unknown>): Promise<Error>` — `test-utils.ts:77-96`. The ONLY sanctioned rejection assertion inside `runInRollback` (`backend/db/test/AGENTS.md:30-45`).
- `constraintNameOf(err): string` — `test-utils.ts:111-126`; walks Drizzle wrapper for the PG constraint name.
- `hasPostgresErrorCode(error, pgCode): boolean` — `backend/db/test/pg-error.ts:16-27`; walks `.cause` chain for SQLSTATE. `PG_CHECK_VIOLATION = "23514"` const — `wallet.repository.test.ts:71`.
- `withImmutabilityTriggersSuspended(tables, fn)` / `withAuditDeleteTriggersSuspended(fn)` — `test/helpers/db-cleanup.ts:229-283` / `:83-109`; disable→run→restore user triggers via `pg_trigger` (test-env only). Used by repo suites for cleanup deletes — `wallet.repository.test.ts:68,908`; `student-payment.repository.admin.test.ts:59,468`.
- `isPgliteProvider()` — `test/helpers/skip-when-pglite.ts:48`; gates PG-only trigger tiers: `const describeTriggerTier = isPgliteProvider() ? describe.skip : describe` — `financial-immutability.test.ts:314`.

### 3.2 CHECK-violation + trigger-raise probe patterns (3 concrete examples)
1. Wallet CHECKs — `backend/db/test/repo/billing/wallet.repository.test.ts:475-527`: describe "CHECK constraint probes (savepoint-bracketed)"; `savepoint wallet_balance_probe` (485) → `expectRepoError(() => tx.update(wallet).set({balance:"-1.00"}))` (486-488) → `rollback to savepoint` (489) → `expect(constraintNameOf(...)).toBe("wallet_balance_check")` (490) + `hasPostgresErrorCode(...,"23514")` (491) + row unchanged re-read (522-525).
2. Student balance CHECK — `backend/db/test/repo/students/student.repository.test.ts:436-443` (asserts `students_balance_hifz_check`).
3. Trigger raises — `backend/db/test/logic/billing/financial-immutability.test.ts:364-399`: `withinSavepoint(tx,"teacher_tx_update_probe", ...)` (helper 174-178) → `expectRepoError(() => tx.update(...))` → assert `errorMessageChain(error)` contains the DDL RAISE text (`"teacher_transaction is immutable"`, consts 77-83); plus presence tier via `pg_trigger` `tgtype` bitmask (103-105,109-138,146-154).

Deadlock-safety rule: NEVER `expect(...).rejects.toThrow()` inside `runInRollback` (`backend/db/test/AGENTS.md:30-33`); the failing statement is rescued by `rollback to savepoint` so the outer tx stays queryable (financial-immutability.test.ts:169-178).

### 3.3 repo/ vs logic/ organization
- `backend/db/test/AGENTS.md:78-81`: `repo/` = 100%-coverage unit tests per repository method (rule 14, lines 98-100); `logic/` = business-logic workflows, constraints, triggers, multi-entity transactions. 26 repo files, 30 logic files (verified `find` counts).
- Actual `logic/` subdirs: admin, audit, auth, billing, classes, notifications, students, teachers, users (verified `ls`). NOTE: `logic/AGENTS.md` Layout (lines 15-32) is STALE — it lists `shared/`, `parents/`, `scheduling/`, `timezone/`, `permissions/` which do not exist; those scenarios actually live in the existing nine dirs. Any new subdir MUST be documented in Layout (rule: logic/AGENTS.md:50-54).
- Runner discovers by glob `backend/db/test/logic/**/*.test.ts`; no barrels (logic/AGENTS.md:53).

### 3.4 `backend/db/test/entity-setup.ts` — verified helper inventory (all 16)
Every helper takes `tx: DBTransaction` FIRST + `Partial<SelectType>` overrides LAST (entity-setup.ts:8-11).

| Helper | Line | Exact signature |
|---|---|---|
| `createTestUser` | 74 | `(tx, overrides: Partial<UserSelectType> = {})` → `UserSelectType`; defaults role `"student"` (85) |
| `createTestStudent` | 104 | `(tx, userId: number, overrides = {})` → `StudentSelectType`; unique handshakeCode (113) |
| `createTestParent` | 131 | `(tx, userId: number)` → `ParentSelectType` (no overrides param) |
| `createTestApplicant` | 143 | `(tx, userId: number, overrides = {})` → `ApplicantSelectType`; status `"pending"` (152) |
| `createTestAdmin` | 169 | `(tx, userId: number)` → `AdminSelectType` (no overrides param) |
| `createTestPlan` | 180 | `(tx, overrides = {})` → `PlanSelectType`; sessionCount 8, price "200.00", intervalDays 30 (188-191) |
| `createTestSubscription` | 222 | `(tx, userId: number, planId: number, overrides = {})` → active/open-ended by default (233-234) |
| `createTestStudentPayment` | 264 | `(tx, studentId: number, subscriptionId: number \| null, overrides = {})`; defaults paid/Stripe (277-278) |
| `createTestSession` | 303 | `(tx, teacherId: number, studentId: number, overrides = {})`; defaults `scheduled`/StudentSession (314-315) |
| `createTestSessionReport` | 344 | `(tx, sessionId: number, overrides = {})`; studentRatingByTeacher defaults 5 (354) |
| `createTestHomeWork` | 376 | `(tx, sessionId: number, overrides = {})`; both grade tracks NULL (386-392) |
| `createTestLesson` | 410 | `(tx, planId: number, overrides = {})` — planId positional REQUIRED (404-408) |
| `createTestEvaluation` | 440 | `(tx, evaluatedId: number, evaluatorId: number, sessionId: number \| null, overrides = {})`; score 85 (453) |
| `createTestWallet` | 478 | `(tx, teacherId: number, overrides = {})`; balance "0.00" (487) |
| `createTestTeacherTransaction` | 514 | `(tx, walletId: number, sessionId: number \| null, overrides = {})`; earning/completed "50.00" (527-528) |
| `createTestTeacherRow` | 550 | `(tx, userId: number, overrides = {})`; isApproved=true, isOnline=false (559-561) |

NOT present: no `setupTeacher`/`setupStudent`/`setupTestEntities` composite (AGENTS.md:26 mentions them, but
entity-setup.ts:74-571 exports exactly the 16 above — verified by grep `^export async function`).
Relation gotchas: `students.id` = PK (no userId field); `teachers.id` = shared PK → `users.id`;
session FKs point at `teachers.id`/`students.id` (backend/db/test/AGENTS.md:54-59).

### 3.5 Journey layer (`test/workflows/`) — 98-line AGENTS verified
- Hard rule 1 — NO `runInRollback` ever in this layer (test/workflows/AGENTS.md:8-11); committed
  fixtures in `beforeAll` inside ONE committing `db.transaction` (12-19), hard-deleted in `afterAll`.
- Registry: `createSessionFixtureRegistry()` → `{track, trackAll, ids, trackedCount, cleanup}`
  (AGENTS.md:60-67; implementation `test/workflows/helpers/journey-fixture-registry.ts:112-130`).
  Tracked-table vocabulary is a FIXED 9-table FK-safe order `JOURNEY_TRACKED_TABLE_DELETE_ORDER`
  (journey-fixture-registry.ts:73-83): session_request_idempotency, session, students, teacher,
  applicants, parents, admin, evaluations, users. Immutable tables (audit_logs, teacher_transaction)
  are NOT trackable — assert ZERO rows instead (29-35, AGENTS.md:65-67). New tracked tables require
  editing this registry (fixture-registry need for any journey asserting teacher-transaction side rows).
- Actor factory: `provisionStudentActor`/`provisionCertifiedTeacherActor`/`provisionParentActor`/
  `provisionAdminActor` — actor-context.ts:88,105,122,136; each `(tx, { locale?, tracked? }) => JourneyActor`
  where `JourneyActor = { userId, locale, role }` (43-47). Real users + role-child rows, never stubs (AGENTS.md:68-71).
- `SpiedFanoutTransport` — spied-transport.ts:1-40; records `publishFanout` calls; assert via
  `calls`, `publishCount`, `lastCall`, `publishedUserIds`, `clear()` (AGENTS.md:72-75).
- Journey skeleton (session-state-machine.journey.test.ts): header contract 1-44; `registry` const 86;
  `expectServiceDenial(code, message, action)` try/catch helper asserting `DomainError.code` + exact
  translated message 108-121; `beforeAll` committed cast 203-213; `afterAll` audit-drain under
  `withAuditDeleteTriggersSuspended` + `registry.cleanup()` 215-231; step naming `"step N — <actor> <action>"`
  (239, 256, 277); error text via `getServerTranslations("en").errorsTranslations` (92-94).
- 55 test files under test/workflows (verified find) across admin/, auth/, billing/, classes/,
  notifications/, parents/, sessions/, teachers/ + 2 helper self-tests. State-machine precedents:
  `sessions/session-state-machine.journey.test.ts` (SWEEP illegal-transition matrix 17-21),
  `teachers/cooldown-state-machine.test.ts`, `billing/financial-safety-verification.journey.test.ts`.

### 3.6 Runners + package.json scripts (verified)
- `bun run test:db` → `test/scripts/run-db-tests-parallel.ts` (package.json:23): glob `**/*.test.ts`,
  cwd `backend/db/test`, 8 workers (1 for embedded sqlite/pglite), 60s timeout (run-db-tests-parallel.ts:14-19).
- `bun run test:services` → `run-services-tests-parallel.ts` (package.json:27): cwd `backend/services`,
  8 workers, 60s; ALL-cohort broadcast race note re run-after-drain (runner head, lines 1-25).
- `bun run test` = full suite w/ lock (package.json:21). `test:db:sequential` (25), `test:integration` (31),
  `test:graphql` (38), `test:ui:e2e:paymob` (35). Workflows layer has NO dedicated npm script — run via
  `bun run test/scripts/run-test.ts test/workflows` (test/workflows/AGENTS.md:96-98); run-test.ts usage
  `bun run test/scripts/run-test.ts [flags] <test-path>` (run-test.ts:53-60), `--last` AI-optimized view.
- New logic/ and services/ files are auto-discovered by the existing scripts (glob-based) — zero
  package.json edits needed for the new suite.

### 3.7 docs/testing inventory
Single file: `docs/testing/workflow-journey-tests.md` (211 lines). Headings (lines 1-206): what a
journey is (14), layer placement (30), NO-runInRollback rule (55), fixture lifecycle (62), honest
authorization (77), notification spying (86), dynamic-import `@/` alias gotcha (104), file
organization (112), mandatory diagram documentation (122), recording from specs (137), chained
journeys (156), backdated time control (174), replay-leg idempotency matrix (183), proration
assertions in session units (196). No doc exists for the db-test or services-test layers — their
canonical rules live only in the AGENTS.md files.

### 3.8 Existing domain test-file inventory (one-line purpose; lists verified via find/ls)

`backend/services/classes/` (18): `recitation.service.test.ts` (transactional write pipeline);
`session-admin-governance.grace-copy.test.ts` (RESCHEDULE_START_PAST_GRACE_MS copy coupling);
`session-admin-governance.service.test.ts` (directory reads); `session-arbitration.service.test.ts`
(post-confirmation dispute open); `session-dispute-notification.service.test.ts` (notifyAdminsOfDisputeOpened);
`session-lifecycle.booking.test.ts` (assertBookingBoundary); `session-lifecycle.enforcement.test.ts`
(SESSION_TRANSITION_MATRIX — INV-S1/S2 codified); `session-lifecycle.guards.test.ts` (lifecycle constants);
`session-lifecycle.service.test.ts` (transactional flows); `session-report.guards.test.ts`
(assertPositiveSessionId); `session-report-notification.test.ts` (caller-tx emissions);
`session-report.service.test.ts` (submitSessionReport denials + happy paths);
`session-request-notification.service.test.ts` (caller-tx happy path); `student-homework.service.test.ts`
(constant-FORBIDDEN byte-identity + happy path). (First-describe titles verified via grep.)

`backend/services/teachers/` (12): applicant-conversion (convertToStudent), applicant-lifecycle
(getMyApplicantProfile), evaluation-booking (transactional write pipeline), evaluation-rubric
(submission pipeline), student-evaluation (write pipeline), teacher-availability (getAvailability),
teacher-inactivity (sweepInactiveTeachers), teacher-matching (browseAvailableTeachers),
teacher-profile.mappers (parseSubjectsJson), teacher-re-evaluation (order pipeline),
verification-purchase (purchase Tier 1).

`backend/services/billing/` (6): admin-financial-auditing (admin gate), subscription-activation
(confirmed path), subscription-admin (extendSubscription), subscription-expiry (sweep branches),
subscription-purchase (purchase), wallet (getMyWallet).

`backend/services/parents/` (6): parent-link-request.chaos (concurrency), parent-link-request.helpers
(Constants), parent-link-request.service (requestLink), parent-link.static-locks (corpus guards),
parent-monitoring.helpers (clampPageInput), parent-monitoring.service (Tier 1 happy paths).

`backend/db/test/logic/` (30 files, 9 subdirs — verified find):
- admin/ (3): admin-user-governance.repository, admin-user.repository, platform-analytics.repository.
- audit/ (3): audit-census-drift, audit-immutability (trigger presence + tamper tiers),
  audit-trail.repository.
- auth/ (2): auth.service, registration.service.
- billing/ (11): financial-immutability (the INV-W6/PAY2 trigger proof); plan-catalog-preservation,
  plan-catalog.repository, plan-catalog-schema, plan-catalog.service, plan-seed (INV-PC surface);
  student-payment.repository (guarded transition matrix); student-zero-lane.repository (INV-B trial
  lane); subscription-expiry.repository (INV-B3 sweep); subscription-purchase-idempotency.repository
  (INV-PAY6 claims); subscription.repository.
- classes/ (3): lesson.service, session-schema-deltas (held_balance_lane + idempotency claim
  constraints), student-progress.service (INV-PR2).
- notifications/ (3): broadcast-audience.repository, broadcast.repository, notification.repository.
- students/ (2): handshake-code-generation-locks (savepoint-bracketed unique/race probes),
  handshake-code-immutability-scan (static repo-shape scan).
- teachers/ (2): applicant-lifecycle (INV-TV transition logic), applicants.re-evaluation.column
  (schema invariants on re_evaluation_started_at).
- users/ (1): user.repository.

`test/workflows/` (55): admin/ (11 journeys: academic-tracking, account-governance, admin-password-reset,
admin-session-governance, admin-user-denials, admin-user-lifecycle, audit-completeness, audit-trail,
cold-start-certification, direct-student-onboarding, platform-analytics); auth/ (registration-phone);
billing/ (7: admin-financial-auditing, financial-safety-verification, paymob-live-tunnel,
paymob-purchase-journey, subscription-admin-lifecycle, subscription-expiry, subscription-full-lifecycle,
subscription-purchase); classes/ (5: session-report-cross-teacher, session-report-homework,
session-request-notifications, tajweed-progress-increment, teacher-preparation-read);
notifications/ (3: admin-broadcast, broadcast-retraction, j1/j2 targeted-vs-cohort); parents/ (6:
handshake-discovery, parent-full-journey, parent-link-request, parent-monitoring,
parent-session-completion-deep-link, student-confirmation-of-link); sessions/ (7: in-session-lock-release,
post-confirmation-dispute, recitation-record, session-dual-confirmation, session-lifecycle-denials,
session-lifecycle, session-state-machine); teachers/ (11: admin-ordered-re-evaluation,
applicant-student-conversion, cooldown-state-machine, evaluation-loop-booking, evaluation-rubric-scoring,
on-demand-matching, student-teacher-rating, teacher-availability, teacher-inactivity-auto-offline,
verification-plan-purchase); helpers/ (2: helpers.self-test, journey-fixtures.smoke).

### 3.9 No existing 'invariant' suite or registry
`grep -ri invariant` across backend/db/test, backend/services, test/workflows, test/integration
returns only prose mentions inside other suites (e.g. `applicants.re-evaluation.column.test.ts:41`
"schema invariants", `session-request-idempotency.repository.test.ts:218` "defensive invariant")
and `find -iname "*invariant*"` returns NOTHING. No INV-ID registry, no per-machine verification
suite exists yet — the ticket is genuinely greenfield, but with heavy per-invariant precedent
coverage spread across repo/logic/service/journey layers.

## 4. Recommended suite placement (verdict)

Grounded verdict — a per-domain hybrid mirroring the three enforcement tiers; a single new
`logic/invariants/` dir is the best fit for the ticket's cross-domain "verification suite" while
service-denial and journey layers only get additions where precedent is missing:

1. **DB-tier invariants (CHECK/trigger/unique/FK/enum/guarded-UPDATE) → new
   `backend/db/test/logic/invariants/<machine>-invariants.test.ts`** (10-11 files, one per state
   machine: session-invariants, teacher-verification-invariants, teacher-availability-invariants,
   balance-invariants, wallet-invariants, student-account-invariants, parent-link-invariants,
   payment-invariants, homework-progress-invariants, evaluation-invariants, plan-catalog-invariants).
   Justification: `logic/` is the documented home for "state-machine transitions … constraints …
   triggers" (logic/AGENTS.md:5); precedent `logic/billing/financial-immutability.test.ts` is exactly
   an INV-registry-shaped suite (trigger presence + tamper tiers + compensating-row doctrine).
   A dedicated subdir maximizes discoverability for the ticket's "every invariant tested" audit and
   gives the plan ONE place for an INV-ID → test mapping table. Cost: must add the subdir to
   logic/AGENTS.md Layout (rule: logic/AGENTS.md:50-54) — which is stale anyway (§3.3).
   Rules: `runInRollback` + `tx` everywhere; CHECK probes savepoint-bracketed via
   `constraintNameOf`+`hasPostgresErrorCode("23514")`; trigger raises via `withinSavepoint` +
   cause-chain message (financial-immutability.test.ts:174-178,229-255); guarded-UPDATE denials via
   zero-row `null` return + full-row before/after equality; enum/uniques via savepoint-bracketed
   bad inserts asserting `23514`/`23505`; DO NOT duplicate repo/ 100%-coverage probes already
   asserting the same constraint (logic/AGENTS.md:47) — cite them in the suite header instead
   and only add what's missing.
2. **Service-denial invariants → extend the existing co-located service test files** where the
   guard lives (e.g. `session-lifecycle.enforcement.test.ts` already codifies INV-S1/S2 as
   SESSION_TRANSITION_MATRIX; `student-homework.service.test.ts` holds INV-S8-adjacent denials).
   Convention: co-located `backend/services/**/*.test.ts`, `runInRollback`, typed `DomainError.code`
   + translated-substring assertions.
3. **Cross-actor / multi-writer invariants → journeys only where missing.** Session machine
   (session-state-machine.journey.test.ts SWEEP + J1/J2), cooldown machine, and financial safety
   already have journeys; the plan should NOT mint new journeys for already-journaled machines —
   extend the existing files (twice-green rule, registry cleanup) rather than fork new ones.

## 5. Fixture/helper needs (beyond §3.4 verified signatures)

| Need | Verified status | Plan guidance |
|---|---|---|
| `createTestApplicant` cooldown fixture | EXISTS — overrides `{cooldownUntil}` (entity-setup.ts:155) | INV-TV3/TV4 need past/future cooldown dates + `verificationAttempts` |
| `createTestSubscription` expired fixture | EXISTS — overrides status + startDate/endDate (entity-setup.ts:214-220 doc) | INV-B3 needs `status: Expired` AND past `endDate` |
| Teacher-governance fixture (`isApproved:false`) | EXISTS — `createTestTeacherRow(tx, userId, {isApproved:false})` (entity-setup.ts:550-562) | INV-S5/A1 denials |
| Soft-delete/suspend/block student | EXISTS — `createTestUser` overrides `{isDeleted/suspended/isBlocked}` (entity-setup.ts:66-69) | INV-U1..U5 |
| Teacher-verification row (`tajweed_level`/`hifz_level`, INV-TV7) | UNVERIFIED — no `createTestTeacherVerification` helper exists (not in the 16); table columns not inspected this session | Plan must read `backend/db/schema/teachers/` first (AGENTS.md rule 18, lines 116-119) and may need a new helper in entity-setup.ts |
| `teacher.was_online_before_lock` (INV-S6/A4) | Column exists per doc:127 (schema not re-read) | Use `createTestTeacherRow` overrides if column is on SelectType — verify first |
| Journey registry tables for payment/wallet machines | FIXED 9-table vocabulary (journey-fixture-registry.ts:73-83) — no wallet/payments/teacher_transaction tracking | If a new journey touches those, do NOT track immutable ledgers — assert zero rows (registry caveat 29-35) |

## 6. Notes for the plan (risks, overlaps, ambiguities)

1. **Count mismatch is the #1 scope risk**: ticket Gherkin = 60 IDs (no PC, B capped at 6, PAY at 5);
   spec doc = 67. B7/B8 (trial grant/consumption) and PAY6/PAY7 (activation/quarantine) are heavily
   implemented + tested already (logic/billing student-zero-lane, subscription-purchase-idempotency);
   excluding them would make the ticket's "every invariant is tested" claim false against the doc.
   Recommend: plan targets all 67, with the ticket-table 60 as mandatory and the 7 doc-extras as
   included-by-charter (each already has adjacent tests to cite or extend).
2. **No runInRollback in journeys; no raw db in rollback tests** — the two layers have OPPOSITE
   transaction contracts (AGENTS.md files are explicit). A cross-domain suite must not mix them in
   one file; journeys that need DB-tier probes do them via committed fixtures + savepoints inside
   their own transactions, not via `runInRollback`.
3. **getServerTranslations is layer-split**: DB repo tests must NOT call it directly
   (backend/db/test/AGENTS.md:121-124 + .agents/instructions/tests.instructions.md "causes the i18n
   loader to hang"); journey tests DO call `getServerTranslations("en").errorsTranslations`
   (session-state-machine.journey.test.ts:92-94, AGENTS.md rule 6). Assertion styles differ accordingly:
   DB tests assert translated substrings from the repo's own message; journeys assert exact
   `DomainError.code` + exact message.
4. **stale logic/AGENTS.md Layout must be refreshed** when the new subdir is added (root AGENTS.md
   mandates updating any AGENTS.md that documents what you change); the listed `shared/`, `scheduling/`,
   `timezone/`, `permissions/` dirs do not exist.
5. **Duplication gate**: `bun run check:duplicates` (jscpd) will flag repetitive savepoint-probe
   scaffolds across 10+ new files. Extract ONE shared probe helper (mirroring
   `withinSavepoint`/`expectRepoError`/`constraintNameOf`) — precedent: pg-error.ts was extracted from
   "16 per-file copies" (pg-error.ts:3-5) — likely as `backend/db/test/logic/invariants/invariant-probe.helpers.ts`
   or a test-utils addition; per AGENTS.md:93-96 prefer file-local wrappers unless cross-file.
6. **Coverage rule asymmetry**: repo/ tests require 100% coverage (AGENTS.md:98-100); logic/ tests do
   not — new invariant files are logic-tier, so no coverage regression risk, but run via
   `bun run test:db` (auto-discovers `backend/db/test/**/*.test.ts`).
7. **PGlite/sqlite parity**: trigger tiers must be gated `isPgliteProvider()` (financial-immutability.test.ts:314)
   and sqlite twins exist for migrations (`backend/db/migration/3-immutability-triggers-sqlite.sql`) —
   CHECK-name probes may differ on embedded providers; follow the skip-when-pglite pattern.
8. **Sibling-plan overlap**: other dossiers in this research wave map per-invariant coverage
   (COVERED/PARTIAL/GAP); this dossier's §4 placement verdict + §3 recipes are the shared substrate
   they should cite rather than re-derive. The plan's task list should route each invariant to
   exactly one layer to avoid double-writing tests other dossiers will recommend.
9. **Runner timeouts**: 60s per file (run-db-tests-parallel.ts:19) — a 67-invariant mega-file would
   risk the timeout; per-domain files (§4) also parallelize across the 8 workers.
