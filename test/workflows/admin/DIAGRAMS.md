# Admin workflow journey diagrams

Mermaid diagrams for the admin-domain cross-actor journey suites in this directory, using the same actor names, service entry points, and statuses as the journey code.

## academic-tracking.journey.test.ts

Journey over the teacher-produced academic record: the teacher books, starts, completes, and reports two sessions (σ₁ graded in place via σ₂'s `previousGrades`), the admin reads the dashboard and drill-down as a pure observer, and every non-admin probe of both admin queries collapses into the identical constant FORBIDDEN (en and ar byte-uniform).

```mermaid
sequenceDiagram
  autonumber
  participant system as System
  participant teacherT as Teacher T
  participant studentS as Student S
  participant adminA as Admin A
  participant nonAdmins as Teacher / Student / Parent
  participant lifecycle as SessionLifecycleService
  participant report as SessionReportService.submitSessionReport
  participant tracking as AdminAcademicTrackingService
  participant db as Postgres
  participant spy as SpiedFanoutTransport

  system->>db: buildSessionJourneyCast plus sessions sigma1 sigma2 booked via createSession with idempotency keys K1 K2
  adminA->>tracking: getAcademicDashboard search prefix
  tracking-->>adminA: baseline - S listed with null academic fields

  teacherT->>lifecycle: startSession then completeSession for sigma1 and sigma2
  lifecycle->>db: status COMPLETED, confirm-prompt inbox row per session for Student S
  teacherT->>report: submitSessionReport sigma1 with jadid plus madi homework
  teacherT->>report: submitSessionReport sigma2 with homework plus previousGrades 55 and 88
  report->>db: home_work row per session; grades land on the PREVIOUS sigma1 row in place, sigma2 row stays ungraded
  report->>spy: one report-wave publish per submission targeting Student S only

  adminA->>tracking: getAcademicDashboard search prefix
  tracking-->>adminA: new Jadid and Madi positions from the newest GRADED row, 55/88 summaries, needsAttention lowGrade, honest stats deltas
  adminA->>tracking: getStudentAcademicDetail for Student S
  tracking-->>adminA: homework and report histories newest-first with grades, tracks, teacher identity
  Note over tracking,db: zero publishes, zero audit rows - the admin surface is a pure observer

  nonAdmins->>tracking: probe getAcademicDashboard and getStudentAcademicDetail with real actor ids
  tracking-->>nonAdmins: ForbiddenError FORBIDDEN, identical message per locale, zero data
```

## account-governance.journey.test.ts

Journey over the full governance lifecycle of Student S — suspend / unsuspend / block / unblock / soft-delete / reactivate — driven by Admin A, observed through Admin B's `getUserDetail` and Student S's real `AuthService.login` outcomes, with Teacher T held as the byte-identical cross-role control. The appended ladder leg runs the ordered student-governance sequence end to end: S books and builds a real history baseline (session + report + settled payment row), A suspends (booking denied, zero writes), A blocks (still-valid refresh token denied), A soft-deletes (history byte-identical to every observer, login denied), then A restores S and S books again on the funded lane.

```mermaid
sequenceDiagram
  autonumber
  participant adminA as Admin A
  participant adminB as Admin B
  participant studentS as Student S
  participant governedG as Governed Admin G
  participant teacherT as Teacher T (ladder cast)
  participant mgmt as AdminUserManagementService
  participant lifecycle as SessionLifecycleService
  participant report as SessionReportService
  participant auth as AuthService.login/refreshToken
  participant db as Postgres audit_logs and users

  Note over db: cast committed - admins A B G, Teacher T, Student S with real role rows

  adminA->>mgmt: setUserSuspended S true 7 days
  mgmt->>db: suspended columns set, ONE audit row Suspend user S actor A
  studentS->>auth: login
  auth-->>studentS: ForbiddenError accountBlocked - active suspension denies
  adminB->>mgmt: getUserDetail S
  mgmt-->>adminB: suspended true with window fields

  adminA->>mgmt: setUserSuspended S false null
  mgmt->>db: columns cleared, ONE audit row Reactivate
  studentS->>auth: login
  auth-->>studentS: session minted - login SUCCEEDS

  adminA->>mgmt: setUserBlocked S true
  mgmt->>db: isBlocked blockedAt set, ONE Suspend-mapped audit row changedFields isBlocked blockedAt
  studentS->>auth: login
  auth-->>studentS: ForbiddenError accountBlocked - block never lapses
  adminA->>mgmt: setUserBlocked S false
  mgmt->>db: ONE Reactivate audit row, login restored

  adminA->>mgmt: setUserDeleted S true
  studentS->>auth: login
  auth-->>studentS: ForbiddenError accountBlocked - deleted denies
  adminA->>mgmt: setUserSuspended on DELETED S
  mgmt-->>adminA: ConflictError USER_ALREADY_DELETED, ZERO new audit rows
  adminA->>mgmt: setUserDeleted S false
  studentS->>auth: login
  auth-->>studentS: login SUCCEEDS - lifecycle loop closed

  Note over studentS,db: lapsed-suspension fixture - suspendedAt 10 days ago, window expired
  studentS->>auth: login
  auth-->>studentS: login SUCCEEDS, governance columns byte-identical before and after login
  adminA->>mgmt: setUserSuspended S false null
  mgmt->>db: columns cleared under a fresh Reactivate audit row

  studentS->>mgmt: setUserSuspended with S as actor
  mgmt-->>studentS: ForbiddenError forbidden, zero writes zero audit
  adminA->>mgmt: setUserSuspended targeting self
  mgmt-->>adminA: ConflictError USER_SELF_SUSPENSION_FORBIDDEN, zero writes
  adminA->>mgmt: re-suspend an already-suspended S
  mgmt-->>adminA: ConflictError USER_ALREADY_SUSPENDED, zero new audit
  adminA->>mgmt: unsuspend a clean S
  mgmt-->>adminA: ConflictError USER_NOT_SUSPENDED, zero new audit
  governedG->>mgmt: setUserSuspended with G as actor
  mgmt-->>governedG: ForbiddenError - strict assertActiveActorAdmin guard rejects the blocked admin
  Note over mgmt,db: anonymous actorId 0 - UnauthorizedError unauthorized

  Note over studentS,db: ladder leg - registered Student S (real credential, funded lanes), certified Teacher T, Admins A and B
  studentS->>lifecycle: createSession Hifz intent - trial lane hold
  lifecycle->>db: session row scheduled, ONE teacher intake wave
  teacherT->>lifecycle: startSession then completeSession
  teacherT->>report: submitSessionReport with spied transport
  studentS->>auth: login then control refreshToken
  auth-->>studentS: still-valid rotated refresh token - history baseline snapshotted
  adminA->>mgmt: setUserSuspended S true 7 days
  studentS->>lifecycle: createSession while suspended
  lifecycle-->>studentS: ForbiddenError forbidden, zero writes, balances byte-identical
  adminA->>mgmt: setUserBlocked S true
  studentS->>auth: refreshToken with the still-valid token
  auth-->>studentS: ForbiddenError accountBlocked
  adminA->>mgmt: setUserDeleted S true
  studentS->>auth: login
  auth-->>studentS: ForbiddenError accountBlocked - history rows byte-identical to every observer
  adminB->>mgmt: getUserDetail S
  mgmt-->>adminB: stacked state visible - deleted blocked suspended
  adminA->>mgmt: restore S - setUserDeleted false then setUserBlocked false then setUserSuspended false null
  studentS->>auth: login
  auth-->>studentS: session minted - login restored
  studentS->>lifecycle: createSession Hifz intent again
  lifecycle-->>studentS: scheduled on the hifz lane - funded balance survived the ladder
```

## admin-delete-with-history.journey.test.ts

Journey over the governed-user deletion arc: the admin soft-deletes a student holding committed history (session, report, payment, and the teacher's wallet-adjacent earning row) and every historical row survives byte-identically while staying queryable by the authorized admin; a raw-SQL hard DELETE is blocked by the `prevent_users_delete` trigger with the guard re-armed transaction-locally (the restrict-FK failure class on push-provisioned databases), the soft-deleted student's login is denied at the governance gate, non-admin probes of the admin surface deny through the real gate, and reactivate restores login with the history untouched.

```mermaid
sequenceDiagram
  autonumber
  participant system as System
  participant adminA as Admin A
  participant studentS as Student S
  participant teacherT as Teacher T
  participant controlS as Control Student
  participant mgmt as AdminUserManagementService
  participant auth as AuthService.login
  participant db as Postgres
  participant guard as prevent_users_delete trigger

  system->>db: committed fixtures - Admin A creates Student S via createUser, session report payment rows, Teacher T wallet plus earning, control tenant family
  studentS->>auth: login with the real credential
  auth-->>studentS: session minted - governance clean
  adminA->>mgmt: setUserDeleted S true
  mgmt->>db: guarded UPDATE users is_deleted true plus ONE audit Delete row
  adminA->>mgmt: setUserDeleted S true again
  mgmt-->>adminA: ConflictError user already deleted - zero writes zero audit
  system->>db: re-query students session report payment wallet earning audit rows
  db-->>system: every history row present and byte-identical
  adminA->>mgmt: getUserDetail S
  mgmt-->>adminA: soft-deleted user visible to the authorized admin
  studentS->>auth: login
  auth-->>studentS: ForbiddenError accountBlocked - zero writes
  system->>db: set_config users_delete_guard on transaction-local then DELETE FROM users
  guard-->>system: RAISE users is not hard-deletable - row survives (restrict-FK class when the trigger is absent)
  controlS->>mgmt: getUserDetail S then setUserDeleted S false
  mgmt-->>controlS: ForbiddenError FORBIDDEN through the real admin gate - zero writes zero audit
  adminA->>mgmt: setUserDeleted S false
  mgmt->>db: guarded UPDATE is_deleted false deleted_at null plus ONE audit Reactivate row
  studentS->>auth: login
  auth-->>studentS: session minted - login restored
  adminA->>mgmt: setUserDeleted T true then false
  system->>db: earning wallet and session rows byte-identical across the teacher soft-delete and reactivate
```

## admin-password-reset.journey.test.ts

Journey D over the forced-reset arc: the admin sets a temporary credential with the forced-reset flag on a certified-teacher target, the flagged target is fenced to the exempt self-service fields at the Apollo gate, replaces the credential via `changeMyPassword`, and regains full access while a foreign non-admin is denied the admin credential surface.

```mermaid
sequenceDiagram
  autonumber
  participant adminA as Admin A
  participant target as Target Teacher
  participant foreign as Foreign Student
  participant mgmt as AdminUserManagementService.setUserPassword
  participant auth as AuthService
  participant gate as Apollo password-change-required gate
  participant db as Postgres

  Note over db: cast committed - flag defaults false

  adminA->>mgmt: setUserPassword target, mustChangePassword true
  mgmt->>db: new hash stored, ONE audit row Update changedFields credentials
  target->>auth: login
  auth-->>target: session minted, mustChangePassword flag true - login does NOT clear the flag
  foreign->>mgmt: setUserPassword with student actor id
  mgmt-->>foreign: ForbiddenError - zero writes, zero audit rows

  target->>gate: non-exempt operation while flagged
  gate-->>target: PASSWORD_CHANGE_REQUIRED via buildPasswordChangeRequiredDenial
  target->>gate: exempt self-service fields - isExemptRootField allowlist
  gate-->>target: exempt escape hatches stay open

  target->>auth: changeMyPassword
  auth->>db: new hash verifies, flag cleared, ZERO self-service audit rows
  target->>gate: previously-denied operation after the clear
  gate-->>target: allowed - the gate opens
  target->>auth: re-login with the new credential
  auth-->>target: succeeds - full access restored
```

## admin-session-governance.journey.test.ts

Four journeys through the real `SessionAdminGovernanceService`: admin discovery → cancel with same-lane refund release and participant waves; teacher reassignment through the certification gate; audit-only join-as-observer; and the role-denial matrix where every non-admin role and the anonymous caller are denied all six governance operations with zero writes.

```mermaid
sequenceDiagram
  autonumber
  participant adminA as Admin A
  participant studentS as Student S
  participant teacherT as Teacher T
  participant teacherT2 as Incoming Teacher T2
  participant roles as non-admin roles and anonymous
  participant gov as SessionAdminGovernanceService
  participant lifecycle as SessionLifecycleService
  participant spy as SpiedFanoutTransport
  participant db as Postgres

  Note over db: W-1 fixtures - booked held session plus lapsed-deadline session
  adminA->>gov: listAll filter status scheduled
  gov-->>adminA: held row with badge, lapsed row flagged
  adminA->>gov: getDetail
  gov-->>adminA: full row, ZERO side effects
  adminA->>gov: cancel with reason
  gov->>db: status flip, SAME-lane hold release, ONE audit row Override
  gov->>spy: post-commit participant waves
  studentS->>lifecycle: listMyStudentSessions
  lifecycle-->>studentS: cancelled row visible next to the cancellation notification
  adminA->>gov: listAll filter status cancelled
  gov-->>adminA: same row under the new filter, gone from scheduled

  Note over db: W-2 - reassignment
  adminA->>gov: reassignTeacher T1 to T2
  gov->>db: row swaps teacher, ONE audit row records the swap
  gov->>spy: localized waves to all three participants
  studentS->>lifecycle: listMyStudentSessions
  lifecycle-->>studentS: sees the NEW teacher
  teacherT->>lifecycle: listMyTeacherSessions
  lifecycle-->>teacherT: outgoing read lost the row
  teacherT2->>lifecycle: listMyTeacherSessions
  lifecycle-->>teacherT2: incoming read gained the row
  adminA->>gov: reassignTeacher to an unapproved candidate
  gov-->>adminA: localized conflict, row byte-identical, zero writes

  Note over db: W-3 - join as observer
  teacherT->>lifecycle: startSession on the booked row
  adminA->>gov: join the STARTED session
  gov->>db: exactly ONE join_observe audit row, no wave
  adminA->>gov: join a SCHEDULED session
  gov-->>adminA: localized state conflict, zero audit rows, row byte-identical

  Note over db: W-4 - denial matrix
  roles->>gov: listAll getDetail cancel reschedule reassignTeacher join with real ids
  gov-->>roles: byte-identical reference 403 denials, zero writes
```

## admin-user-denials.journey.test.ts

Journey B: the admin creates a teacher-role identity whose applicants row stays pending (certification lock), the new applicant observes the pending profile truthfully, and the admin's whitelist update keeps the applicant row byte-identical. Journey C: anonymous and non-admin callers are denied all five user-management operations with zero audit rows, and admin-role-creation tampering fails with `ADMIN_ROLE_CREATION_FORBIDDEN`.

```mermaid
sequenceDiagram
  autonumber
  participant adminA as Admin A
  participant applicant as New Applicant Teacher
  participant nonAdmins as Student / Parent / Applicant / Certified Teacher
  participant mgmt as AdminUserManagementService
  participant lifecycle as ApplicantLifecycleService.getMyApplicantProfile
  participant db as Postgres

  adminA->>mgmt: createUser role teacher
  mgmt->>db: users plus applicants pending, ONE audit row Create, ZERO teacher rows - certification lock
  adminA->>mgmt: getUserDetail
  mgmt-->>adminA: applicant projection pending, teacherIsApproved null
  applicant->>lifecycle: getMyApplicantProfile
  lifecycle-->>applicant: pending status observed truthfully
  adminA->>mgmt: updateUser fullName whitelist patch
  mgmt->>db: ONE audit row Update changedFields fullName, applicants row byte-identical
  applicant->>mgmt: listDirectory service path
  mgmt-->>applicant: ForbiddenError at the permission-resolution seam - defense-in-depth

  Note over mgmt,db: Journey C - denial battery over the five operations
  nonAdmins->>mgmt: createUser updateUser setUserDeleted getUserDetail listDirectory
  mgmt-->>nonAdmins: ForbiddenError per operation, zero writes, audit delta zero
  nonAdmins->>mgmt: same five with ANONYMOUS_ACTOR_ID
  mgmt-->>nonAdmins: UnauthorizedError, zero writes
  adminA->>mgmt: createUser role admin - tamper probe
  mgmt-->>adminA: ADMIN_ROLE_CREATION_FORBIDDEN, zero writes
```

## admin-user-lifecycle.journey.test.ts

Journey A over one target student: the admin creates the user through the real service path, observes it in the directory, soft-deletes it with login denied at the governance gate, and reactivates it with login restored — each mutation minting exactly one audit row, with self-deactivation denied.

```mermaid
sequenceDiagram
  autonumber
  participant adminA as Admin A
  participant studentS as New Student S
  participant mgmt as AdminUserManagementService
  participant auth as AuthService.login
  participant db as Postgres users students audit_logs

  adminA->>mgmt: createUser role student
  mgmt->>db: users plus students plus ONE audit row Create committed atomically
  adminA->>mgmt: listDirectory filter role student plus unique run prefix
  mgmt-->>adminA: new row with headline projection
  studentS->>auth: login
  auth-->>studentS: session minted - governance clean

  adminA->>mgmt: setUserDeleted S true
  mgmt->>db: guarded UPDATE, ONE audit row Delete, isDeleted true
  studentS->>auth: login
  auth-->>studentS: denied at the governance gate

  adminA->>mgmt: setUserDeleted S false
  mgmt->>db: ONE audit row Reactivate
  studentS->>auth: login
  auth-->>studentS: login restored

  adminA->>mgmt: setUserDeleted targeting self
  mgmt-->>adminA: USER_SELF_DEACTIVATION_FORBIDDEN, zero writes, zero audit rows
  Note over adminA,db: cast student, parent, applicant rows byte-identical across every step
```

## audit-completeness.journey.test.ts

The census-driven completeness journey: a producer admin executes EVERY wired row of the machine-readable admin action census (`audit-completeness.catalog.ts`) through the real service paths across twelve legs, then a second admin reads every minted row back through `AuditTrailService.listAuditTrail` with a 1:1 no-missing no-phantom mapping, while non-admin and anonymous actors are denied every action and mint nothing.

```mermaid
sequenceDiagram
  autonumber
  participant adminA as Admin A producer
  participant adminB as Admin B observer
  participant nonAdmins as Student / Parent / Teacher / Anonymous
  participant census as ADMIN_ACTION_CENSUS runners
  participant services as real admin services
  participant trail as AuditTrailService.listAuditTrail
  participant db as Postgres audit_logs

  Note over db: cast plus fixture sessions, wallet, plans, subscriptions, applicants committed - clean audit footprint
  adminA->>census: executeCensusRows user lifecycle leg
  census->>services: createUser updateUser setUserPassword setUserDeleted setUserSuspended setUserBlocked
  services->>db: Create Update Delete Suspend Reactivate rows, one per execution
  adminA->>census: onboarding, certification, broadcast, plan, lesson, subscription, applicant, re-evaluation legs
  census->>services: StudentOnboardingService ColdStartCertificationService AdminBroadcastService PlanCatalogService LessonService SubscriptionAdminService and peers
  services->>db: every wired census row executed, whole-table delta equals executions
  adminA->>census: session governance, dispute, finance legs
  census->>services: SessionAdminGovernanceService resolveSessionDispute AdminFinancialAuditingService
  services->>db: Override and Adjust rows on session, ledger, plan, subscription, applicant, teacher anchors

  adminB->>trail: read every entity anchor filtered
  trail-->>adminB: newest-first rows with full shapes and exact details payloads - matchedRows equals executedActions
  adminB->>trail: filter by actor, action type, entity type, boundary-exact time window
  trail-->>adminB: each axis returns exactly its subset, mismatch probe returns zero
  adminB->>db: repeated governance actions append distinct rows - append-only, never deduplicating

  nonAdmins->>services: every wired census action with valid-shaped input
  services-->>nonAdmins: ForbiddenError or UnauthorizedError per gate, zero rows minted platform-wide
  Note over services,db: mid-flight domain failures - already-active, empty patch, re-arbitration - mint zero rows
```

## audit-trail.journey.test.ts

Journey over the global `audit_logs` read surface: an admin producer mints real audit rows through user-management mutations, a different admin observer reads them back through `AuditTrailService.listAuditTrail` (order, filters, pagination, time windows), non-admin and anonymous readers are denied before any read, and a governed target's history stays fully readable.

```mermaid
sequenceDiagram
  autonumber
  participant producer as Admin Producer
  participant observer as Admin Observer
  participant nonAdmins as Student / Parent / Anonymous
  participant mgmt as AdminUserManagementService
  participant trail as AuditTrailService.listAuditTrail
  participant db as Postgres audit_logs

  Note over db: cast committed with a clean audit and notification footprint
  producer->>mgmt: createUser target student
  mgmt->>db: ONE Create row with names-only details
  observer->>trail: read target anchor
  trail-->>observer: exactly one create row

  producer->>mgmt: updateUser, setUserDeleted true, setUserDeleted false
  mgmt->>db: Update Delete Reactivate rows
  observer->>trail: read the target anchor
  trail-->>observer: four rows newest-first in exact order

  Note over db: System fixture lane seeds the remaining action types
  observer->>trail: filter each of the seven action types
  trail-->>observer: each filter returns exactly its subset
  observer->>trail: paginate the five-row history with boundary-exact windows
  trail-->>observer: gapless pages and exact window slices

  nonAdmins->>trail: listAuditTrail with real ids and ANONYMOUS_ACTOR_ID
  trail-->>nonAdmins: denied before any read, oracles byte-unchanged
  observer->>trail: read the governed target's anchor
  trail-->>observer: full four-row producer history stays readable
```

## cold-start-certification.journey.test.ts

Journey J-1 over direct admin certification of teacher-role users: Admin A provisions a teacher and certifies them cold-start (certified teacher row, finalized applicant, one override audit row, one notification, one spied envelope), Admin B and the target observe the committed state, and a battery of denial probes — student actor, suspended admin, non-teacher target, governed target, repeat certification, cooldown supersession, elevation — all fail side-effect-free.

```mermaid
sequenceDiagram
  autonumber
  participant adminA as Admin A
  participant adminB as Admin B
  participant targets as Teacher Targets
  participant student as Student Probe Actor
  participant suspendedAdmin as Admin suspended after provisioning
  participant mgmt as AdminUserManagementService
  participant certify as ColdStartCertificationService.certifyTeacherColdStart
  participant spy as SpiedFanoutTransport
  participant db as Postgres

  Note over db: cast committed - admins, student probe, three teacher targets with role-child rows
  adminA->>mgmt: createUser role teacher
  mgmt->>db: users plus applicants pending, ONE audit row Create, ZERO teacher rows yet
  adminA->>certify: certifyTeacherColdStart makeEvaluator true
  certify->>db: certified teacher row, applicant finalized passed, ONE override audit row, ONE evaluation_result notification
  certify->>spy: ONE envelope to the target only

  targets->>db: inbox shows the certification row, foreign inboxes stay EMPTY
  adminB->>mgmt: getUserDetail and getUserActivity
  mgmt-->>adminB: both timeline entries attribute to Admin A, newest-first

  student->>certify: certifyTeacherColdStart with student actor id
  certify-->>student: ForbiddenError - zero rows, zero audit, zero envelopes
  suspendedAdmin->>certify: certifyTeacherColdStart
  certify-->>suspendedAdmin: ForbiddenError governance deny, zero writes
  adminA->>certify: non-teacher target
  certify-->>adminA: ConflictError TEACHER_ROLE_REQUIRED, zero writes
  adminA->>certify: governed target
  certify-->>adminA: TEACHER_ACCOUNT_GOVERNED, zero writes - after reactivation the same call SUCCEEDS
  adminA->>certify: repeat certification
  certify-->>adminA: TEACHER_ALREADY_CERTIFIED - audit stays at 2, no second notification
  adminA->>certify: failed applicant with future cooldown
  certify->>db: certified anyway - passed plus cooldown cleared
  adminA->>certify: elevation path makeEvaluator false
  certify->>db: unapproved teacher row approved, non-evaluator, audit elevation created
```

## direct-student-onboarding.journey.test.ts

Journey over direct student onboarding with offline payment: one admin onboards three students — cash, bank transfer with a parent link, scholarship — through `StudentOnboardingService.onboardStudentWithOfflinePayment`, while the onboarded students, the linked parent, an unrelated parent, a peer student, and a teacher observe, read back, or are denied; the `student_payments` ledger is never touched.

```mermaid
sequenceDiagram
  autonumber
  participant system as System
  participant adminA as Admin
  participant student1 as Onboarded Student - cash
  participant student2 as Onboarded Student - bank transfer
  participant student3 as Onboarded Student - scholarship
  participant linkedParent as Linked Parent
  participant otherParent as Other Parent
  participant peer as Unlinked Peer Student and Teacher
  participant onboarding as StudentOnboardingService.onboardStudentWithOfflinePayment
  participant mgmt as AdminUserManagementService
  participant monitoring as ParentMonitoringService
  participant subs as SubscriptionPurchaseService.listOwn
  participant auth as AuthService.login
  participant db as Postgres

  system->>db: cast plus lane-bearing plan committed in one transaction
  adminA->>onboarding: onboard cash, no parent
  onboarding->>db: user, student, active subscription, junction, one lane credit, TWO audit rows, ZERO payment rows
  student1->>auth: login
  student1->>subs: listOwn subscriptions
  subs-->>student1: credited lane and active subscription observable
  peer->>subs: listOwn
  subs-->>peer: sees nothing of the new student
  adminA->>mgmt: listDirectory and getUserDetail and getUserActivity read-back
  mgmt-->>adminA: new row, detail snapshot, admin-attributed audit

  adminA->>onboarding: onboard bank transfer, parentId linkedParent
  onboarding->>db: same rows plus students.parent_id set, TWO audit rows
  linkedParent->>monitoring: listLinkedChildren then getChildProgress
  monitoring-->>linkedParent: child visible with no extra ceremony
  otherParent->>monitoring: getChildProgress for the same child
  monitoring-->>otherParent: constant denial, no child identity leaked

  adminA->>onboarding: onboard scholarship, unique reference
  onboarding->>db: payment_method scholarship, TWO audit rows, ZERO payment rows
  adminA->>onboarding: non-offline payment method
  onboarding-->>adminA: rejected before any write - zero rows everywhere
  adminA->>onboarding: reuse the committed payment reference
  onboarding-->>adminA: conflict, original holder keeps the reference
  peer->>onboarding: call with teacher, student, and parent real ids
  onboarding-->>peer: forbidden through the genuine actor gate
  system->>db: teardown - audit sweep, tracked hard-delete, zero-residue probes
```

## platform-analytics.journey.test.ts

Four journeys over the admin platform-analytics observation surface (`PlatformAnalyticsService.getPlatformAnalytics`): cold-platform honesty, full-cast metric deltas, freshness evolution across two bracketing reads, and the denial and purity matrix — the admin is a pure observer and every metric is a baseline-plus-fixture delta.

```mermaid
sequenceDiagram
  autonumber
  participant system as System
  participant admin as Admin Observer
  participants as Student / Teacher / Parent / Anonymous / Absent / Governed Admin
  participant analytics as PlatformAnalyticsService.getPlatformAnalytics
  participant db as Postgres

  Note over db: Journey A - cold platform
  system->>db: admin-only cast committed, baseline captured by direct counts
  admin->>analytics: getPlatformAnalytics
  analytics-->>admin: baseline plus 0 everywhere, 30 zero-filled trend buckets, rating averages honestly null

  Note over db: Journey B - full cast with paid subscription, EGP and USD payments, online and offline teachers, five sessions, withdrawal, report, evaluation, governed student
  admin->>analytics: getPlatformAnalytics
  analytics-->>admin: every metric at baseline plus its exact fixture delta, currencies never merge, governed student excluded from active counters
  participants->>analytics: student, teacher, parent probes
  analytics-->>participants: ForbiddenError every time, zero side effects

  Note over db: Journey C - freshness evolution
  system->>db: one committed EGP payment plus one completed session between reads
  admin->>analytics: first read then second read
  analytics-->>admin: second read exposes exactly plus one session and the exact amount, generatedAt strictly advances

  Note over db: Journey D - denial and purity matrix
  participants->>analytics: anonymous, absent actor, non-admin, governed admins
  analytics-->>participants: UnauthorizedError for anonymous, ForbiddenError for absent, non-admin, and governed - deleted before blocked before suspended precedence
  Note over analytics,db: every denial leaves tables byte-identical, zero audit and zero notification residue
```
