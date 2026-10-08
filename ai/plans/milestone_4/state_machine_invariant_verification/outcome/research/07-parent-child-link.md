# Research Dossier — Parent-Child Link (INV-P1..INV-P4)

Ticket: docs/planning/TICKETS.md:2873-2910 (Milestone 4, Dev 2, 5 SP). Gherkin row: `Parent-child link (INV-P1 through INV-P4)` — docs/planning/TICKETS.md:2896.
Spec slice: docs/specs/state-machine-invariants.md:259-279 (§7 Parent-Child Link Lifecycle). All line citations below verified on the live tree this session.

## 1. Invariants in scope

| ID | Doc line | Verbatim statement |
|---|---|---|
| INV-P1 | docs/specs/state-machine-invariants.md:274 | "A parent cannot monitor a student without the student's explicit confirmation of the link request." |
| INV-P2 | docs/specs/state-machine-invariants.md:275 | "In the MVP, parent access is strictly read-only." |
| INV-P3 | docs/specs/state-machine-invariants.md:276 | "A parent receives real-time notification when a linked child's session completes." |
| INV-P4 | docs/specs/state-machine-invariants.md:277 | "✅ RESOLVED (A.2): Parent-child link data model implemented via `students.parent_id` FK and `students.handshake_code`." |

Conceptual states (docs/specs/state-machine-invariants.md:261-269): Code_Generated :264, Link_Requested :265, Linked :266, Rejected :267, Expired :268, Unlinked :269. Binding note (handshake discovery bound by INV-P1..P4): :279. Ticket-pointer correction: docs/parents/monitoring-portal.md:28,30 and the live SDL pin say the portal is SEVEN query fields, not "five SDL queries" (see §6).

## 2. Enforcement map

### INV-P1 — confirmation-gated monitoring grant

| Mechanism | Path:line | Symbol | Fragment |
|---|---|---|---|
| Grant column (FK) | backend/db/schema/students/students.ts:32 | `parentId` | `integer("parent_id").references(() => users.id, { onDelete: "set null" })` |
| Sole guarded grant writer | backend/db/repo/students/student.repository.ts:373 | `StudentRepository.linkParentIfUnlinked` | docblock :358-359 "UPDATE students SET parent_id … WHERE id = $1 AND parent_id IS NULL RETURNING *"; code :380-381 `.set({ parentId, updatedAt: sql`now()` }).where(and(eq(students.id, studentId), isNull(students.parentId)))` |
| Student-only claim (state+liveness guard) | backend/db/repo/parents/parent-link-request.repository.ts:238 | `respondToPendingForStudent` | WHERE `id ∧ student_id ∧ status='pending' ∧ expires_at > now` (:248-255); zero rows ⇒ null (:257) |
| Confirm service branch | backend/services/parents/parent-link-request.service.ts:250 | `ParentLinkRequestService.respondToLinkRequest` | :266 claim → :286 `linkParentIfUnlinked(studentActorId, claim.parentId, tx)` → :298 `expireSiblingPendingsForStudent` |
| Sibling-pending expiry (one winner) | backend/db/repo/parents/parent-link-request.repository.ts:361 | `expireSiblingPendingsForStudent` | WHERE `student_id ∧ status='pending' ∧ id <> winner` (:369-375) |
| Duplicate-pending DB arbiter | backend/db/schema/parents/parent-link-requests.ts:58-60 | `parent_link_requests_pending_pair_unique` | partial UNIQUE INDEX `.where(sql`status = 'pending'`)`; SQL: backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:371 |
| Read gate (the monitoring grant check) | backend/services/parents/parent-monitoring.helpers.ts:180 | `requireLinkedChild` | :203 `if (student?.parentId !== parentActorId) return deny();` + :207-209 soft-delete severance re-check |
| Wire role gate | backend/graphql/query/parents/parent-monitoring.query.ts:114-119 | `parentOnlyAuthScopes` | `$all: { authenticated: true, role: [UserRole.Parent] }` |
| Decision mutation (caller-scoped) | backend/graphql/mutation/parents/parent-link.mutation.ts:178 | `respondToParentLinkRequest` | :195-196 `respondToLinkRequest(requestId, args.accept, callerId, …)` — callerId = ctx.user.id |

### INV-P2 — read-only portal

| Mechanism | Path:line | Symbol | Fragment |
|---|---|---|---|
| Query-only registration | backend/graphql/query/parents/parent-monitoring.query.ts:74-79 | (file docblock) | "This file registers QUERY fields ONLY. Zero mutation fields of any kind." |
| Read-only service methods (7 pure reads) | backend/services/parents/parent-monitoring.service.ts:178,210,255,293,334,382,449 | `listLinkedChildren`/`getChildProgress`/`listChildSessions`/`listChildReports`/`listChildHomework`/`getSessionTarget`/`listChildrenUpcomingSessions` | zero writes; docs/parents/monitoring-portal.md:198 "R5 — Zero mutations on the portal surface" |
| SDL freeze (portal queries) | backend/graphql/test/schema-surface.test.ts:709-717 | `PARENT_MONITORING_QUERY_FIELDS` | 7 names: `myChildrenUpcomingSessions` :710 … `parentSessionTarget` :716 |
| SDL freeze (parent mutations = exactly 3, all handshake-domain) | backend/graphql/test/schema-surface.test.ts:772-776 | `RECONCILED_PARENT_LINK_MUTATION_FIELDS` | `cancelParentLinkRequest`/`requestParentChildLink`/`respondToParentLinkRequest` |
| Canonical doc | docs/parents/monitoring-portal.md:145-147 | §Read-only posture (INV-P2) | "ZERO new GraphQL mutations on the root `Mutation` type … the SDL pin in `backend/graphql/test/schema-surface.test.ts` asserts no portal-named fields appear on `Mutation`" |

### INV-P3 — parent session-completion notification

| Mechanism | Path:line | Symbol | Fragment |
|---|---|---|---|
| Emit primitive | backend/services/classes/session-report-notification.service.ts:147 | `SessionReportNotificationService.notifySessionReportReady` | parent emission gated on stored link :180-183 `const parent = wave.parent; if (parent === null) return [studentReceipt];` |
| Wave-context read (link resolution) | backend/services/classes/session-report-notification.service.ts:159 | `SessionRepository.findReportWaveContextById` | LEFT JOIN parent leg; `reportWaveContextOf` :72-82 fails closed to unlinked on a half-joined leg |
| Emission contract | backend/services/classes/session-report-notification.service.ts:114-124 | `reportReadyEmitInput` | `type: NotificationType.SessionCompletion`, `idempotencyKey: session:${sessionId}:report` |
| Sole caller (producer = report submission) | backend/services/classes/session-report.service.ts:306 | inside `submitSessionReport` (:357) | receipts handed back, publish-after-commit via `NotificationEngine.publishReceipts` (:28-32 docblock) |
| Enum member | backend/db/schema/enums.ts:103 | `notification_type` | `"session_completion"` |
| Realtime transport | backend/ws/AGENTS.md:1-3 | notification WS sidecar | push-only fan-out; service tests spy the transport seam instead |

### INV-P4 — data model (FK + handshake code)

| Mechanism | Path:line | Symbol | Fragment |
|---|---|---|---|
| Handshake column | backend/db/schema/students/students.ts:31 | `handshakeCode` | `varchar("handshake_code", { length: 50 }).notNull()` |
| Unique constraint | backend/db/schema/students/students.ts:40 | `students_handshake_code_unique` | `unique("students_handshake_code_unique").on(t.handshakeCode)` |
| Link index | backend/db/schema/students/students.ts:41 | `students_parent_id_idx` | `index("students_parent_id_idx").on(t.parentId)` |
| Parent role-child table | backend/db/schema/parents/parents.ts:11-20 | `parents` | PK = FK `users.id` `onDelete: "cascade"` |
| Request history table | backend/db/schema/parents/parent-link-requests.ts:39-62 | `parentLinkRequests` | `status: linkStatus` default `'pending'` :49; FKs `ON DELETE RESTRICT` :43-48; partial unique :58-60 |
| Link-status enum | backend/db/schema/enums.ts:99 | `linkStatus` | `pgEnum("link_status", ["pending", "confirmed", "rejected", "expired"])` — no `unlinked` member |
| Migration SQL | backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:371-372 | — | partial unique index + `students_parent_id_idx` |

No `custom_*` DB trigger guards any parent table (drizzle custom migrations target student_payments/teacher_transaction/session columns/notifications/rubric/applicant/users/was-online — verified via `ls backend/drizzle/`). DB-level arbiters for this domain: the partial unique index (raw 23505 on duplicate pending), the handshake unique/NOT NULL, and the `parent_id IS NULL` guarded UPDATE.

## 3. Existing coverage

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| INV-P1 | COVERED | backend/services/parents/parent-link.static-locks.test.ts:533 | `describe("lock (a) — students.parent_id single-writer (INV-P1)")` | Corpus scans (:534-596) prove `linkParentIfUnlinked` is the ONLY non-null `parent_id` writer repo-wide (no rogue `.set`/raw SQL/inserts); the ONLY invariant test in the repo that names INV-P1 |
| INV-P1 | COVERED | backend/db/test/repo/students/student.repository.test.ts:318 | "Tier 1 — winner claims the unlinked student; second call (and a rival parent) collapse to null" | Guarded-UPDATE zero-rows semantics: winner :327 links; replay :334 null; rival parent :337 null; nonexistent :343-346 null |
| INV-P1 | COVERED | test/workflows/parents/student-confirmation-of-link.journey.test.ts:721 | "Step 6 — REJECT leg: rejected + respondedAt, parent_id unchanged (NULL)…" | Rejection writes no grant; :795 Step 7 CONFIRM writes `parent_id = Parent B` + expires ALL sibling pendings; :995 two-parent concurrent confirm ⇒ exactly ONE winner link |
| INV-P1 | COVERED | backend/services/parents/parent-monitoring.helpers.test.ts:475 | `describe("parent-monitoring.helpers — requireLinkedChild denial oracle (5 causes)")` | Never-linked/missing/foreign/malformed/severed all deny; :621 byte-identical fingerprints; :675 severed-child defense-in-depth |
| INV-P1 | COVERED | test/workflows/parents/parent-monitoring.journey.test.ts:813 | "J1 step 5 — DENIAL: P2 (never linked to S1) reads S1 → constant 403, zero data" | :873 J2 step 1 sever (clear parentId) ⇒ immediate 403 + list exclusion; :942 soft-delete sever same shape |
| INV-P1 | COVERED | backend/graphql/test/parent-monitoring.wire.test.ts:1086 | "parentChildProgress answers FORBIDDEN for a parent with no link (constant denial)" | Wire-tier no-link denial on all per-child ops :1086-1118; :924 wrong-role 18-cell FORBIDDEN matrix; :998 BFLA byte-identical probes |
| INV-P1 | COVERED | test/workflows/parents/parent-full-journey.journey.test.ts:572 | "Step 9 — Student S1 confirms P: parent_id written, the P2 sibling expired, ONE acceptance notification to P" | Full confirm chain through real services; :873 Step 16 — foreign parent denied on EVERY per-child read |
| INV-P1 | COVERED | backend/services/parents/parent-link-request.chaos.test.ts:534 | "two-parent confirm race: exactly ONE students.parent_id winner — loser commits NOTHING, remaining pendings expired" | Concurrency arbitration; :722 `linkParentIfUnlinked` single-writer race; :373 double-respond one claim |
| INV-P1 | COVERED | backend/services/parents/parent-link-request.service.test.ts:861 | "Tier 1 — own-commit reject: rejected copy, NO students write, sibling pendings stay live" | Reject writes no grant; :779 accept winner link + sibling expiry; :1818 post-claim zero-row link collapse rolls back the whole unit |
| INV-P2 | COVERED | backend/graphql/test/schema-surface.test.ts:1417 | "mutation set grows ONLY by the sanctioned additions (… the reconciled parent-link trio …)" | SDL-level INV-P2: Mutation root contains no portal fields beyond the 3 handshake mutations; :1116 query root = baseline + `PARENT_MONITORING_QUERY_FIELDS` (:709-717) exactly |
| INV-P2 | COVERED | test/workflows/parents/parent-full-journey.journey.test.ts:919 | "Step 17 — Parent P's write attempts are all denied: zero rows, S1's rows byte-identical" | Parent actor denied on `createSession`/`confirmSessionCompletion`/`submitSessionReport`/`respondToLinkRequest` via REAL role re-checks (owned by finished sibling plan, REQ-2 :181-190) |
| INV-P2 | COVERED | backend/graphql/test/parent-monitoring.wire.test.ts:888 | "the anonymous denial shape is CONSTANT across all six operations" | 401/403 posture + :924 wrong-role matrix pin the parent-private read scope (per parent-monitoring.query.ts:44-57) |
| INV-P3 | COVERED | backend/services/classes/session-report-notification.test.ts:248 | "linked session ⇒ exactly 2 receipts (student + parent) with the engine-pinned emission contract" | Parent receipt only with stored link; :317 unlinked ⇒ exactly 1 receipt, parent inbox untouched; :814 half-joined parent leg fails closed to unlinked; :776 derived-recipient invariance (no smuggled recipient) |
| INV-P3 | COVERED | test/workflows/parents/parent-session-completion-deep-link.journey.test.ts:454 | "Step 1 — teacher submits the report: completion receipts prepared for the student AND the linked parent; dispatch spied, published post-commit" | End-to-end: report submit → 2 emissions → post-commit publish; :534 Step 2 inbox deep-link triple; :635 Step 5 unlinked child ⇒ NO parent emission; :705 Step 6 denial probes |
| INV-P3 | COVERED | test/workflows/parents/parent-full-journey.journey.test.ts:724 | "Step 14 — Teacher T submits the report: fan-out targets exactly {S1, P}; P's inbox carries the deep-link triple; P2 gets nothing" | Chained chain including the isolation probe (foreign parent receives nothing) |
| INV-P3 | COVERED | test/workflows/parents/parent-monitoring.journey.test.ts:593 | "J1 step 2 — Teacher T submits σ1 report + homework: rows land; EXACTLY ONE parent-wave publish to P (en recipient locale)" | Exactly-one publish + locale composition; :1154 J4 step 1 — ar recipient-locale publish to P2 |
| INV-P4 | COVERED | backend/db/test/logic/students/handshake-code-generation-locks.test.ts:219 | "50 consecutive student registrations: every code non-null, pattern-exact, mutually unique, with exact row defaults" | :255 duplicate INSERT rejected by `students_handshake_code_unique` (raw 23505 via DB); :280 duplicate UPDATE rejected; :309 NOT NULL rejection; :376 collision arbiter — loser retries fresh code |
| INV-P4 | COVERED | backend/db/test/repo/students/student.repository.test.ts:143 | "Tier 1 — inserts the registration row with the supplied code and zeroed balances" | Handshake code round-trips; :160 in-tx read; :296 `findLinkTargetByHandshakeCode` miss returns null on both executor paths |
| INV-P4 | COVERED | backend/db/test/repo/students/student.parent-monitoring.repository.test.ts:126-131 | (fixture teardown observation) | Parent-user deletion ⇒ FK `ON DELETE SET NULL` severs ⇒ `listLinkedChildrenByParentId` returns `[]` — the only Unlinked-state producer exercised at DB tier |
| INV-P4 | COVERED | backend/db/test/repo/parents/parent.repository.test.ts:95 | "Tier 1 — round-trips the role-child row inside the tx" | `parents` role-child persistence; :135 rollback purity |
| INV-P4 | COVERED | backend/db/test/repo/parents/parent-link-request.repository.test.ts:86 | `PENDING_PAIR_UNIQUE` constant | Repo suite trips the partial unique index, claim/withdraw guards, sweep (:725-729 fixture matrix) — request-history half of the model |

## 4. Recommended tests for PARTIAL/GAP

**No GAP and no PARTIAL: all four invariants are COVERED at every relevant tier** (service unit + mocked engine, DB repo/logic under `runInRollback`, GraphQL wire, workflow journeys with committed fixtures, chaos races, static corpus locks). The plan's INV-P work is therefore an **evidence-registry task**, not new-test authoring — with ONE optional thin pin worth adding:

| ID | Target test file | Layer rules | Assertion approach | Fixtures |
|---|---|---|---|---|
| INV-P3 (optional pin) | `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` (extend; the file already owns the completion-notification chain) OR a small journey-side step in `test/workflows/parents/parent-full-journey.journey.test.ts` | Journey layer: NO `runInRollback` (test/workflows/AGENTS.md:8-11), committed fixtures + registry cleanup, `catchJourneyError`, spied transport | Book + start + complete a session for a linked child but DO NOT submit the report; assert ZERO parent notification rows for that session (row-count delta 0 vs baseline) and zero spied publishes targeting the parent — pinning that INV-P3's producer is report-ready, not the `completed` flip. Existing tests cover the unlinked-child absence (deep-link :635) but no test asserts the linked-child-without-report absence | Existing cast helpers: `provisionParentActor`/`provisionCertifiedTeacherActor` (test/workflows/AGENTS.md:77-80), `createSessionFixtureRegistry()` (:69-76), `SpiedFanoutTransport` (:81-84); trial-lane booking precedent at parent-session-completion-deep-link.journey.test.ts:288,408 (cited via finished-plan specs.md:411-412) |

If the verification suite wants INV-named traceability (the ticket's "every invariant is tested" clause), the registry should be a **documentation matrix** (plan/tasks citing the §3 rows), not duplicated assertions — sibling journeys are authoritative and must not be rewritten (finished-plan specs.md:57-58 "Out of scope … Re-writing the existing per-domain journey files").

DB-tier note: do NOT plan raw-SQL trigger-trip tests for this domain — there is no `prevent_*` trigger on `students`/`parents`/`parent_link_requests` to trip. The only DB-enforced members (partial unique index 23505, handshake unique/NOT NULL, FKs) are already tripped by handshake-code-generation-locks.test.ts:255-309, the chaos duplicate-create race (:315), and the repo suites.

## 5. Fixture/helper needs (verified signatures)

| Helper | Path:line | Signature (verified) |
|---|---|---|
| `createTestUser` | backend/db/test/entity-setup.ts:74 | `(tx: DBTransaction, overrides: Partial<UserSelectType> = {}) => Promise<UserSelectType>` |
| `createTestStudent` | backend/db/test/entity-setup.ts:104 | `(tx: DBTransaction, userId: number, overrides: Partial<StudentSelectType> = {}) => Promise<StudentSelectType>` — auto-generates unique `KSB-${randomUUID().slice(0,8).toUpperCase()}` handshakeCode (:113), `parentId: null` default (:117) |
| `createTestParent` | backend/db/test/entity-setup.ts:131 | `(tx: DBTransaction, userId: number) => Promise<ParentSelectType>` |
| `createTestAdmin` | backend/db/test/entity-setup.ts:169 | `(tx: DBTransaction, userId: number) => Promise<AdminSelectType>` |
| `runInRollback` | backend/db/test/AGENTS.md:20-21 | from `./test-utils`; pass `tx` to ALL repo methods; try/catch helper, never `expect(...).rejects.toThrow()` (:31-44) |
| Link-request TTL constants | shared/constants/parent-link-request.constants.ts:17,20 | `PARENT_LINK_REQUEST_TTL_DAYS = 7`; `PARENT_LINK_REQUEST_MS = TTL_DAYS * 86_400_000` |
| Journey registry / actors / spy | test/workflows/AGENTS.md:69-93 | `createSessionFixtureRegistry()` → `{ track, trackAll, ids, trackedCount, cleanup }`; `provisionParentActor` `(tx, { locale?, tracked? }) => JourneyActor`; `SpiedFanoutTransport` (structurally implements the fan-out transport port) |
| Linked-child journey fixture | test/workflows/parents/parent-monitoring.journey.test.ts:426-433 | local `severChildLink`/`relink` helpers use direct `tx.update(students).set({ parentId })` — fixture control ONLY (journey-layer fixture writes are sanctioned; the production single-writer is pinned by static-locks :533) |

## 6. Notes for the plan

1. **Verdict summary: 4/4 COVERED, 0 PARTIAL, 0 GAP.** INV-P is the most heavily-tested domain in the tree — five layers of evidence per invariant. Plan effort here should be traceability, not authoring.
2. **Doc-vs-impl nuance (INV-P3)**: the spec says "when a linked child's session completes"; the implementation's sole producer is REPORT submission (`session-report.service.ts:306` inside `submitSessionReport` :357), which INV-S7 gates to `completed` sessions. No notification fires at the `completed` status flip itself; "real-time" delivery is the WS sidecar (backend/ws/AGENTS.md:1-3), which service tests reach only via the spied fan-out seam. The plan should record this mapping and (optionally) add the §4 absence pin.
3. **Doc drift — "five SDL queries" is stale**: docs/parents/monitoring-portal.md header says "the seven GraphQL query contracts" (:7, :28, :30) and the SDL pin has 7 fields (schema-surface.test.ts:709-717), but the same doc's inventory rows still say "five read methods" (:248), "five root query fields" (:250), "five portal fields" (:268). The ticket pointer's "five SDL queries" repeats the stale count. The verification plan must count SEVEN and cite the SDL pin.
4. **`Unlinked` state has no production writer** (docs/specs/state-machine-invariants.md:269): `link_status` has no `unlinked` member (enums.ts:99); severance is only (a) parent-user hard-delete via FK `ON DELETE SET NULL` (repo-tested at student.parent-monitoring.repository.test.ts:126-131) or (b) fixture-controlled `parentId` writes in journeys (parent-monitoring.journey.test.ts:426). Do NOT plan an "unlink flow" test — there is no such mutation; a plan task that assumes one would be testing a nonexistent surface.
5. **Sibling-plan overlap (hard boundary)**: the finished plan `workflow_tests_parent_journey_and_subscription_lifecycle` (ai/finished_plans/milestone_4_integration_security_launch/.../specs.md) OWNS the INV-P legs in `test/workflows/parents/parent-full-journey.journey.test.ts`: REQ-2 (:166-202) owns the read-only/write-denial + tenancy legs (incl. the first-ever parent-denied `confirmSessionCompletion` probe, :197-202); REQ-3 (:204-232) owns the 7-day TTL and one-parent-per-student legs. The five other journey files (`handshake-discovery`, `parent-link-request`, `parent-monitoring`, `parent-session-completion-deep-link`, `student-confirmation-of-link`) are cited as authoritative — new INV-P tests must extend, never rewrite them (specs.md:57-58).
6. **Enforcement is app-layer + partial-unique-index, NOT triggers**: INV-P1's atomicity is the guarded single-statement UPDATE (`linkParentIfUnlinked` :373; `respondToPendingForStudent` :238) plus the partial unique index as the concurrency arbiter (raw 23505 → `PARENT_LINK_ALREADY_PENDING`, service maps it). Any "trip a DB guard" test idea for this domain reduces to the 23505/unique/NOT NULL trips already covered.
7. **Naming hazard**: exactly ONE test in the repo names INV-P1 by ID (static-locks :533). If the verification plan wants grep-able INV-P traceability, it can add INV-named `describe` labels in a registry doc or extend existing describes — but per repo rules do not add duplicate assertion suites just to carry names.
