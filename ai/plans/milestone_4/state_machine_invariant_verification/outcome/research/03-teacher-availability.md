# Research Dossier — Teacher Availability (INV-A1..INV-A4)

Domain: Teacher Availability Lifecycle · Milestone 4, Dev 2, 5 SP
Scope: `docs/specs/state-machine-invariants.md` §3 (lines 97-127) · 4 invariants
Method: line-verified read of live tree; every citation from Read/Grep/Bash output in this session.

## 1. Invariants in scope

| ID | Doc line | Verbatim statement |
|---|---|---|
| INV-A1 | docs/specs/state-machine-invariants.md:120 | "Only certified teachers (`is_approved = true`) can set their status to Available." |
| INV-A2 | docs/specs/state-machine-invariants.md:121 | "While a teacher is in an active session (`session.status = started`), their `is_online` must be `false`." |
| INV-A3 | docs/specs/state-machine-invariants.md:122 | "A teacher in In-Session state is hidden from the Available Teachers directory for all other students." |
| INV-A4 | docs/specs/state-machine-invariants.md:123 | "Upon session conclusion, the teacher's status returns to Available only if they are still active (app open)." |

States table (doc :99-105): Available=`is_online:true` visible; Unavailable=`false` not visible; In-Session=`false` not visible.
Transitions (doc :107-115) include "Unavailable --> Available: Manual toggle ON / app opened".

## 2. Enforcement map

| ID | Mechanism | Path:line | Symbol | Fragment |
|---|---|---|---|---|
| A1 | Service certification gate (Available direction only) | backend/services/teachers/teacher-availability.service.ts:245-253 | `TeacherAvailabilityService.setAvailability` | `if (locked.isApproved !== true) … throw new ForbiddenError(t.teacherNotCertified)` (245, 252) |
| A1 | Pre-gate row lock (toggle-vs-start serialization) | backend/db/repo/teachers/teacher.repository.ts:179-189 | `TeacherRepository.lockForCertificationCheck` | `.for("update")` on teacher row (187) |
| A1 | Unavailable direction skips both gates | backend/services/teachers/teacher-availability.service.ts:237-260 | gate block | `if (isOnline) { …cert…, …session… }` |
| A2 | In-session gate (reused seam, 409) | backend/services/classes/session-lifecycle.enforcement.ts:203-216 | `assertTeacherNotInActiveSession` | lists `SessionStatus.Started` rows → `ConflictError("TEACHER_IN_ACTIVE_SESSION")` (211) |
| A2 | Direction-guarded write (defense-in-depth) | backend/db/repo/teachers/teacher.repository.ts:685-705 | `TeacherRepository.setAvailabilityIntent` | `(${isOnline} = false OR NOT EXISTS (…status = Started))` in WHERE (700) |
| A2/S6 | Lock acquisition (capture+lock, one statement) | backend/db/repo/teachers/teacher.repository.ts:460-471 | `TeacherRepository.acquireInSessionLock` | `wasOnlineBeforeLock = COALESCE(marker, isOnline)`, `isOnline: false` (464-465) |
| A4 | Marker-gated last-exit release | backend/db/repo/teachers/teacher.repository.ts:558-603 | `TeacherRepository.releaseInSessionLock` | restore `isOnline = marker` + `marker = NULL` + `NOT EXISTS (started)` guard (578-587); outcomes `released`/`no_lock_held`/`active_sessions_remain` (590-602) |
| A4 | Marker column (lock oracle) | backend/db/schema/teachers/teacher.ts:36 | `teacher.wasOnlineBeforeLock` | `boolean("was_online_before_lock")` nullable; `isOnline` at :28 default(false) |
| A4 | Inactivity sweep (freshness backstop; never writes true) | backend/db/repo/teachers/teacher.repository.ts:774-814 | `TeacherRepository.sweepInactiveOnlineOnce` | victims: `isOnline=true` + stale `last_active_at` + `NOT EXISTS (started)` (780-788); writes only `isOnline:false` (800) |
| A3 | Student browse eligibility chain | backend/db/repo/teachers/teacher.repository.matching.helpers.ts:129-142 | `buildTeacherMatchingFilterChain` | `eq(teacher.isOnline, true)` (131), `eq(teacher.isApproved, true)` (132), governance `is distinct from true` (133), `not exists (… status = Started)` (136) |
| A3 | Student-only GraphQL field | backend/graphql/query/teachers/teacher-matching.query.ts:78,114-119 | `browseAvailableTeachers` | `authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }`; identity from `ctx.user.id` (143-155) |
| A1 | Teacher-only GraphQL mutation | backend/graphql/mutation/teachers/teacher-availability.mutation.ts:53,64-68 | `setTeacherAvailability` | `$all { authenticated, role: [UserRole.Teacher] }`; single `isOnline: Boolean!` arg |
| — | DB-level enforcement: NONE | backend/drizzle/ (all custom_*.sql inspected) | — | no CHECK/trigger touches `teacher.is_online`; enforcement is 100% application-layer (guarded UPDATEs + service gates). Marker column added by `backend/drizzle/20261006173528_custom_13-teacher-was-online-before-lock/migration.sql` |
| — | Admin directory (NOT an INV-A3 surface) | backend/graphql/query/admin/admin-teachers.query.ts:58,65 | `adminTeachers` | `adminOnlyAuthScopes`; `online` is an optional FILTER (backend/services/admin/teacher-directory.service.ts:75), not an eligibility gate |

## 3. Existing coverage

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| A1 | COVERED | backend/services/teachers/teacher-availability.service.test.ts:1374 | "BFLA / INV-A1: an uncertified teacher can NEVER reach the availability write — the repo write fires ZERO times" | `setAvailability(id,true)` on `isApproved:false` → FORBIDDEN + localized `teacherNotCertified`; spy proves `setAvailabilityIntent` fired 0×; one bounded log |
| A1 | COVERED | backend/services/teachers/teacher-availability.service.test.ts:1521 | "the certification gate precedence: a non-certified AND in-session teacher sees FORBIDDEN (not TEACHER_IN_ACTIVE_SESSION)" | gate order A1-before-A2; write primitive never fired |
| A1 | COVERED | backend/services/teachers/teacher-availability.service.test.ts:642-727 | Cartesian `SET_MATRIX` incl. `certState: "null"` (706) | 12-case matrix {certified, uncertified, isApproved=null} × direction × session; `isApproved=null` → FORBIDDEN on Available |
| A1 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:1731 | "certification plays no part: an unapproved teacher row toggles identically in BOTH directions" | pins that the repo tier is deliberately cert-free — the gate lives in the service only |
| A1 | COVERED | test/workflows/teachers/teacher-availability.journey.test.ts:284 | "step 4 — Denial probe A (INV-A1): U's Available toggle is FORBIDDEN; U stays offline" | committed-row byte-unchanged after denial |
| A1 | COVERED | backend/graphql/test/teacher-availability.integration.test.ts:703 | "uncertified teacher → `setTeacherAvailability(isOnline: true)` returns FORBIDDEN (INV-A1, service-side gate)" | invariant holds through the real GraphQL mutation; :691/:697 staff-role 403s |
| A2 | COVERED | backend/services/teachers/teacher-availability.service.test.ts:1411 | "INV-A2: a started-session teacher can NEVER reach the availability write — the repo write fires ZERO times" | seeded `Started` session → `TEACHER_IN_ACTIVE_SESSION` 409; 0 writes; no session id leaked |
| A2 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:1484 | "Available direction is race-blocked to zero rows while a started session exists — and writes NOTHING" | guarded UPDATE returns null; reread: `isOnline=false`, marker intact, `updatedAt` pinned (writes NOTHING) |
| A2 | COVERED | backend/services/teachers/teacher-availability.service.test.ts:813 | "integration: a `started` session created via the REAL SessionLifecycleService triggers the INV-A2 gate" | gate fires against a production-started session, not a seeded row |
| A2 (carve-out) | COVERED | backend/services/teachers/teacher-availability.service.test.ts:848 | "integration: the mid-session Unavailable toggle on a REAL started session succeeds and OVERWRITES the captured marker" | Unavailable direction is ungated; deliberate intent re-arms the release |
| A2 | COVERED | test/workflows/teachers/teacher-availability.journey.test.ts:304 | "step 5 — Denial probe B (INV-A2) … oracle-safe" | 409 through real `startSession`; denial persists offline state; no session id anywhere |
| A2 | COVERED | backend/graphql/test/teacher-availability.integration.test.ts:733 | "certified teacher with a `started` session → `setTeacherAvailability(isOnline: true)` returns TEACHER_IN_ACTIVE_SESSION (INV-A2)" | invariant through the GraphQL mutation |
| A2/S6 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:3463-3616 | "SessionLifecycleService — INV-S6 in-session lock" block | start ⇒ locked offline in same tx (3464); offline-intent seed (3483); complete/cancel-from-started ⇒ unlock (3597, 3616); resolve-from-started-dispute ⇒ unlock (3655) |
| A3 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:2761 | "excludes a teacher that owns a started session (bulk NOT EXISTS over session(teacher_id, status))" | the data-level compose rule: in-session teacher excluded from the browse read |
| A3 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:2774 | "excludes a stale-true is_online teacher that owns a started session (compose rule: the flag alone never re-admits)" | session-state check dominates a stale `is_online=true` |
| A3 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:2793 | "does not exclude a teacher whose only session is %s (only the `started` state hides)" | non-started statuses (scheduled/completed/cancelled/disputed) do NOT hide |
| A3 | COVERED | test/workflows/teachers/on-demand-matching.journey.test.ts:806 | "a started session hides the teacher from every student's browse (INV-A3) and the session-state oracle agrees" | teacher vanishes from the student browse while `started`; stale-flag window holds verdict; bidirectional oracle parity vs the per-teacher gate |
| A3 | COVERED | test/workflows/teachers/on-demand-matching.journey.test.ts:783 | "teacher toggle to Unavailable removes him from the browse; toggle back to Available restores him" | directory appearance tracks the manual toggle |
| A3 | COVERED | test/workflows/teachers/on-demand-matching.journey.test.ts:871 | "completing the session releases the in-session lock, restores the teacher, and emits exactly one student confirm-prompt" | teacher re-surfaces in the browse after the last exit |
| A4 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:897 | "restores true: a marker of true returns is_online to true and consumes the marker (released)" | restore-to-available when pre-lock intent was Available; marker → NULL |
| A4 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:917 | "restores false (never-resurrect): a marker of false keeps is_online false and consumes the marker" | offline-before ⇒ offline-after; no resurrection |
| A4 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:1005,1029,1115 | deferred restore trio | `active_sessions_remain` defers while started rows remain; two racing exits ⇒ exactly one restore; 20-way storm ⇒ 1 released + 19 no-ops |
| A4 | COVERED | test/workflows/sessions/in-session-lock-release.journey.test.ts:473,512,555-569,597,709-726 | J1 step 5 / J2 / J3 / J4 | restore-per-marker (473); variant A never-resurrect (512); variant B mid-session intent wins (555,569); admin-governance cancel releases per marker (597); last-exit deferral across two sessions (709,726) |
| A4 | COVERED | backend/services/classes/session-admin-governance.service.test.ts:1296,1348 | governance cancel release pair ("…restores the captured availability in the SAME transaction…" / "…a captured OFFLINE intent: the release never resurrects the teacher…") | admin cancel of a `started` session restores per marker (fixture posture at :1304 marker=true, :1354 marker=false); never-started row ⇒ `no_lock_held` no-op (:1382,:1401) |
| A4 | COVERED | test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts:506 | "step 7 — release restores the stale teacher; the next sweep re-offlines him (self-healing, observable-only)" | the "still active (app open)" freshness leg: restore-then-sweep |
| A4 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:1568,1626 | toggle-vs-release interleave pair | deliberate intent survives the release (convergence both orderings) |
| A4 | COVERED | backend/services/teachers/teacher-availability.service.test.ts:848 | mid-session Unavailable overwrites marker | the release honors the LATEST deliberate intent, not a stale capture |

## 4. Recommended tests for PARTIAL/GAP

No PARTIAL/GAP verdicts at the service/repo/journey tiers — all four invariants have direct, named assertions. The plan should treat this domain as a MAPPING + HARDENING domain, not a from-scratch one. Candidate additions (each optional, each additive):

| ID | Target test file | Layer rules | Assertion approach | Fixtures |
|---|---|---|---|---|
| A1 (race) | backend/services/teachers/teacher-availability.service.test.ts (new test in `setAvailability` describe) | co-located service test; `runInRollback` + `tx`; NO `rejects.toThrow` inside rollback | two-actor: open tx A, `lockForCertificationCheck` holds the row; run `demoteToUncertified` in tx B (queues on the lock); in tx A run `setAvailability(true)` → succeeds (was certified at decision time); commit A; assert final state is internally consistent (either ordering legal, never an uncertified-online row that bypassed the gate) — pins the FOR UPDATE serialization the doc claims (teacher-availability.service.ts:226) | existing `createTestUser`/`createTestTeacherRow` |
| A2 (writers-matrix) | backend/db/test/repo/teachers/teacher.repository.test.ts (new describe "INV-A2 — no writer can produce is_online=true while a started session exists") | repo test; `runInRollback` + `tx` passed to every repo call | with one `Started` session seeded, fire ALL three `is_online` writers in one battery: `setAvailabilityIntent(id,true)` → null + row untouched (today only tested at :1484); `releaseInSessionLock` → `active_sessions_remain` (:1005 covers); sweep → writes only `false` (structural, :800). Assert `reread.isOnline === false` after each | existing helpers |
| A3 (wire tier — the one real hole) | backend/graphql/test/teacher-matching.integration.test.ts (NEW file; model on backend/graphql/test/teacher-availability.integration.test.ts) | GraphQL integration tier — dev server via `testClient`, role-matrix style (anonymous 401 / teacher 403 / student 200 per the authScopes at teacher-matching.query.ts:114-119) | student caller executes `browseAvailableTeachers` with a started-session teacher in the fixture → the in-session teacher is absent from the returned page; non-student roles denied at the scope step | fixture via the integration helpers used by teacher-availability.integration.test.ts (committed rows; registry cleanup — NO runInRollback) |
| A4 (wording pin) | test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts (extend) | journey tier — committed fixtures + registry cleanup, NO runInRollback | a test NAMED for INV-A4 asserting the SHIPPED semantics as the canonical reading: teacher Available at lock → goes stale (app closed) during the session → last exit restores `is_online=true` per the marker → the next sweep re-offlines (freshness). Pin this as the accepted INV-A4 contract and record the doc-wording deviation (see §6) | existing journey cast + `tracked.register` |

## 5. Fixture/helper needs (verified signatures)

- `backend/db/test/entity-setup.ts:74` — `createTestUser(tx: DBTransaction, overrides: Partial<UserSelectType> = {}): Promise<UserSelectType>`
- `backend/db/test/entity-setup.ts:550` — `createTestTeacherRow(tx: DBTransaction, userId: number, overrides: Partial<TeacherSelectType> = {}): Promise<TeacherSelectType>` (baseline `isApproved: true, isOnline: false`)
- `backend/db/test/entity-setup.ts:303` — `createTestSession(tx, teacherId, studentId, overrides: Partial<SessionSelectType> = {}): Promise<SessionSelectType>` (status override drives Started)
- Repo tests use local wrappers `createTeacherRowFixture` / `createTeacherSession` (see teacher.repository.test.ts:1487-1489) — verify those signatures in-file before reuse.
- Service tests already use `expectRepoError` / `expectDomainDenial` / `silenceDomainLog` / `recordedLogCall` (teacher-availability.service.test.ts:1394-1397) — reuse, do not re-invent.

## 6. Notes for the plan

1. **The ticket's INV-A3 expectation is STALE.** The task brief says "verify whether any student-facing directory/query exists (expected: none)". One EXISTS: `browseAvailableTeachers` (backend/graphql/query/teachers/teacher-matching.query.ts:78, student-only) backed by `TeacherMatchingService.browseAvailableTeachers` and the compose-rule filter chain (matching.helpers.ts:131-136). It already enforces INV-A3 (flag AND session-state AND certification AND governance). Likewise docs/teachers/teacher-availability.md:295 ("no student-facing Available Teachers directory exists in the tree at this milestone") and state-machine-invariants.md:127 ("INV-A3 … remains owned by the directory/alternatives surfaces") are outdated. The plan must NOT restate "no directory exists"; INV-A3's verification surface is the matching browse.
2. **Doc line-pointer drift (defect, not a code defect).** state-machine-invariants.md:127 cites `acquireInSessionLock` at teacher.repository.ts:527, `releaseInSessionLock` at :625, `setAvailabilityIntent` at :752. Actual: :460, :558, :685. This dossier uses the verified lines. (Test-writing plan → likely out of scope to fix, but flag it.)
3. **INV-A4 enforcement-semantics mismatch.** The doc wording is "returns to Available only if they are still active (app open)". The shipped mechanism restores the pre-lock availability INTENT (marker), not an activity-conditioned restore; the "app open" freshness leg is delegated to the 15-minute inactivity sweep (canonical ruling: docs/teachers/teacher-availability.md:346). Existing tests assert the shipped semantics (inactivity journey step 7 at :506). The plan should test the shipped semantics and record the wording deviation — NOT try to invent an activity-conditioned restore.
4. **"App opened → Available" has NO producer.** The transition table (doc :110) lists "app opened" as an Unavailable→Available trigger, but `UserRepository.updateLastActiveAt` (backend/db/repo/users/user.repository.ts:403-409) writes only `users.last_active_at`; the ONLY Available-direction writer of `is_online` in the tree is the manual toggle (`setAvailabilityIntent` with the cert+session gates). No test can cover a nonexistent producer — the plan should scope INV-A1/A2 verification to the toggle and the release/marker machinery only.
5. **No DB-level enforcement exists for this domain.** No CHECK constraint or trigger guards `is_online`/`was_online_before_lock` (all `backend/drizzle/custom_*.sql` inspected; marker column added by `20261006173528_custom_13-teacher-was-online-before-lock/migration.sql`). All INV-A* verification must be service/repo/journey tier — there is nothing to trip at the SQL layer.
6. **Single-writer trio is closed.** Exactly three `is_online` writers (acquire :460, release :558, setAvailabilityIntent :685) + the sweep's offline-only batch (:774, writes only `false` at :800). Any invariant test claiming a fourth writer is wrong.
7. **Admin directory is out of scope for INV-A3.** `adminTeachers` (admin-teachers.query.ts:58, `adminOnlyAuthScopes`) exposes `online` as an optional filter (teacher-directory.service.ts:75) and may legitimately list in-session teachers — staff visibility is not the student-facing directory.
8. **Sibling-plan overlap.** INV-A2 is the manual-toggle face of INV-S6 (Sessions dossier). The `assertTeacherNotInActiveSession` seam (session-lifecycle.enforcement.ts:203) is shared; INV-A2/INV-A4 tests already live inside sessions suites (session-lifecycle.service.test.ts:3463+, in-session-lock-release.journey.test.ts). Coordinate so the two plans do not duplicate the same journey assertions; this dossier's INV-A2 claims should be cross-referenced, not rewritten.
9. **Cosmetic code defect observed:** backend/db/repo/teachers/teacher.repository.ts:411-415 contains a malformed nested doc-comment (an unclosed `/**` at 411 reopened at 415) — harmless (one big comment) but worth a follow-up cleanup; do not fix in the test plan.

---

## 7. Erratum (post-review)

After this dossier was written, the working-tree diff moved the registration and scope
block in `backend/graphql/query/teachers/teacher-matching.query.ts`:
`gqlSchemaBuilder.queryField("browseAvailableTeachers", …)` now sits at **`:81`** (line 78
is an import), and the `authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }`
block now sits at **`:123-128`** (`:114-119` are the sort/page args). The stale
`teacher-matching.query.ts:78` / `:114-119` cites above (§2 enforcement map, §4 wire-tier
row, §6 note 1) predate that diff; the plan artifacts (specs.md, plan.md, tasks.md) use the
corrected lines.
