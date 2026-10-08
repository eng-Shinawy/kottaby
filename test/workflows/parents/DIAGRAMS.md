# Parents workflow journey diagrams

Mermaid diagrams for the cross-actor parent-domain journey suites in this directory, using the same actor names, service entry points, and statuses as the journey code.

## handshake-discovery.test.ts

Pure-read discovery journey (steps 1→8): students read their own handshake codes, parents resolve codes through `StudentHandshakeService.findStudentByHandshakeCode`, and governance flips (isDeleted / isBlocked / active suspension) collapse discovery to the same null as a nonexistent code. No notifications or audit rows may be attributable to any cast member.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - registration service"
  participant yusuf as "Student Yusuf - self-read owner"
  participant bilal as "Student Bilal - isDeleted probe"
  participant mariam as "Student Mariam - isBlocked probe"
  participant omar as "Student Omar - suspended probe"
  participant fatima as "Parent Fatima - searching parent"
  participant karim as "Second Parent Karim - post-link observer"
  participant svc as "StudentHandshakeService"
  participant db as "Postgres"

  system->>db: register cast - four students plus two parents, canonical unique KSB codes
  yusuf->>svc: getMyHandshakeCode yusufUserId
  svc-->>yusuf: own code verbatim
  fatima->>svc: getMyHandshakeCode fatimaUserId
  svc-->>fatima: NotFoundError STUDENT_NOT_FOUND - no students row
  fatima->>svc: findStudentByHandshakeCode yusufCode
  svc-->>fatima: maskedName plus linkable true - exactly two keys, no ids
  fatima->>svc: findStudentByHandshakeCode lowered and garbage probes
  svc-->>fatima: lowercase equals original - invalid shapes reject ValidationError VALIDATION pre-DB
  svc-->>fatima: valid-format absent code returns null
  system->>db: linkStudentToParentFixture yusuf to fatima
  karim->>svc: findStudentByHandshakeCode yusufCode
  svc-->>karim: linkable false - same maskedName, zero parent identity leaks
  system->>db: setGovernanceFixture bilal isDeleted true
  fatima->>svc: findStudentByHandshakeCode bilalCode
  svc-->>fatima: null - byte-identical to the absent code
  system->>db: setGovernanceFixture mariam isBlocked true
  fatima->>svc: findStudentByHandshakeCode mariamCode
  svc-->>fatima: null - byte-identical to the absent code
  system->>db: setGovernanceFixture omar suspended - active window
  fatima->>svc: findStudentByHandshakeCode omarCode
  svc-->>fatima: null - byte-identical to the absent code
  Note over db: teardown hard-deletes every tracked row - zero notifications, zero audit logs, zero residue
```

## parent-full-journey.journey.test.ts

The consolidated arc (steps 1→17): registration → handshake discovery → link request/confirm → expiry leg → session booking/completion/report → all seven `ParentMonitoringService` surfaces → foreign-parent denials → read-only enforcement probes, with the fan-out transport spied at the injected `options.transport` seam.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - RegistrationService and provisioning tx"
  participant s1 as "Student S1 - P's linked child"
  participant s2 as "Student S2 - control tenant"
  participant p as "Parent P - winning parent"
  participant p2 as "Parent P2 - foreign parent"
  participant t as "Teacher T - certified"
  participant hs as "StudentHandshakeService"
  participant link as "ParentLinkRequestService"
  participant life as "SessionLifecycleService"
  participant report as "SessionReportService"
  participant monitor as "ParentMonitoringService"
  participant spy as "SpiedFanoutTransport"
  participant db as "Postgres"

  system->>db: register real users rows - P and S1 via RegistrationService
  system->>db: provision S2 P2 T plus S1 trial lane in one committed tx
  system->>db: book lifecycle provisioning committed
  s1->>hs: getMyHandshakeCode s1 - verbatim own code
  p->>hs: findStudentByHandshakeCode s1Code - linkable true, garbage rejects VALIDATION, absent code null
  p2->>link: requestLink s2Code parentP2 - pending plus 7d, ONE inbox row to S2, one publish
  p->>link: requestLink s1Code parentP - pending plus 7d, ONE inbox row to S1
  p2->>link: requestLink s1Code parentP2 - contention sibling, second pending
  s1->>link: listMyIncoming s1 - both parents visible, S2 rows never surface
  s1->>link: respondToLinkRequest reqPToS1 accept true
  link->>db: students.parentId equals P - sibling P2 to S1 materialized Expired
  link-)spy: exactly ONE acceptance publish to P
  p2->>link: requestLink s1Code again - ConflictError PARENT_LINK_TARGET_ALREADY_LINKED, zero rows, zero publishes
  system->>db: backdate the P2 to S2 request expiry into the past
  s2->>link: respondToLinkRequest stale accept true
  link-->>s2: DomainError PARENT_LINK_REQUEST_EXPIRED - row materialized Expired, no link written
  s1->>life: createSession book Teacher T intent Hifz with booking key
  life->>db: trial lane 1 to 0, status SCHEDULED
  t->>life: startSession then completeSession - STARTED then COMPLETED
  t->>report: submitSessionReport notes rating jadid madi
  report->>db: report and homework rows bound to the session
  report-)spy: exactly TWO publishes - one envelope to S1, one to P
  p->>monitor: listLinkedChildren - exactly S1
  p->>monitor: listChildSessions listChildReports listChildHomework - S1-scoped pages
  p->>monitor: getChildProgress - child S1 header
  p->>monitor: getSessionTarget sigma - closed pair sessionId plus studentId, landing URL constructible
  p->>monitor: listChildrenUpcomingSessions - exactly S1 block
  p2->>monitor: all five per-child reads of S1
  monitor-->>p2: constant ForbiddenError FORBIDDEN - byte-identical fingerprint, zero data
  p->>life: createSession as parent - ValidationError INSUFFICIENT_BALANCE
  p->>life: confirmSessionCompletion - NotFoundError SESSION_NOT_FOUND
  p->>report: submitSessionReport as parent - ForbiddenError FORBIDDEN
  p->>link: respondToLinkRequest as parent - ForbiddenError FORBIDDEN
  Note over db: zero new session, report, or notification rows - S1 rows byte-identical
```

## parent-link-request.journey.test.ts

Three journeys over `ParentLinkRequestService`: A (request → notify → confirm → sibling expiry), B (reject, withdraw, re-application, constant NOT_FOUND from both directions, already-linked conflict), and C (silent expiry plus the sequential race-loser emulation), all with the transport spied at the `options.transport` seam.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - provisioning and fixture writers"
  participant pa as "Parent A"
  participant pb as "Parent B"
  participant ss as "Student S - contended child"
  participant sf as "Student F - fresh reject and expiry target"
  participant anon as "Anonymous caller"
  participant sl as "Student L - pre-linked to A"
  participant svc as "ParentLinkRequestService"
  participant spy as "SpiedFanoutTransport"
  participant db as "Postgres"

  system->>db: provision A B S G L F in one tx - G suspended, L pre-linked to A
  pa->>svc: requestLink sCode parentA - pending plus 7d, masked name only
  svc->>db: ONE pending row - S inbox gains ONE row
  svc-)spy: exactly ONE publish to S
  pa->>svc: listMyOutgoing parentA - one row - B's list empty
  ss->>svc: listMyIncoming studentS - Parent A FULL name
  pb->>svc: requestLink absentCode then gCode
  svc-->>pb: null on both silent arms - zero rows, zero publishes
  anon->>svc: requestLink as anonymous caller
  svc-->>anon: UnauthorizedError UNAUTHORIZED - real re-check
  sf->>svc: requestLink fCode as student caller
  svc-->>sf: ForbiddenError FORBIDDEN - role mismatch
  pa->>svc: requestLink sCode again
  svc-->>pa: ConflictError PARENT_LINK_ALREADY_PENDING - inbox stays at ONE
  pb->>svc: requestLink sCode parentB - second live pending, ONE publish
  ss->>svc: respondToLinkRequest accept true
  svc->>db: students.parentId equals A - B sibling materialized Expired
  svc-)spy: exactly ONE accepted-decision publish to A
  pa->>svc: listMyOutgoing - Confirmed - pb sees Expired - ss sees both terminal rows
  pa->>svc: requestLink fCode - fresh pending for F, ONE publish
  sf->>svc: respondToLinkRequest reject false
  svc->>db: row Rejected, parentId stays NULL, pendings zero
  svc-)spy: exactly ONE rejected-decision publish to A
  sf->>svc: respondToLinkRequest on resolved row - ConflictError PARENT_LINK_REQUEST_ALREADY_RESOLVED
  pa->>svc: requestLink fCode again - re-application, fresh pending, ONE publish
  ss->>svc: respondToLinkRequest on F's row - NotFoundError PARENT_LINK_REQUEST_NOT_FOUND
  pb->>svc: cancelLinkRequest on foreign row - same constant NOT_FOUND
  pa->>svc: cancelLinkRequest nonexistent id - byte-equal fingerprint
  pb->>svc: requestLink lCode on linked target
  svc-->>pb: ConflictError PARENT_LINK_TARGET_ALREADY_LINKED - zero rows, zero notifications
  pa->>svc: cancelLinkRequest live pending
  svc->>db: silent fold to Rejected - zero inbox rows, zero publishes
  pa->>svc: cancelLinkRequest folded row again - ConflictError PARENT_LINK_REQUEST_ALREADY_RESOLVED
  system->>db: commit backdated expired request B to F directly
  sf->>svc: respondToLinkRequest stale accept true
  svc-->>sf: ConflictError PARENT_LINK_REQUEST_EXPIRED - row materialized Expired, silent
  system->>db: insert second live pending B to S - race window
  ss->>svc: respondToLinkRequest race row accept true
  svc-->>ss: ConflictError PARENT_LINK_TARGET_ALREADY_LINKED - claim rolled back, row still pending
  Note over db: teardown deletes all tracked rows - zero residue by id set and prefix
```

## parent-monitoring.journey.test.ts

The read-only portal spine (J1–J4): every read funnels through the `requireLinkedChild` gate; teacher report waves fan out in the recipient's persisted locale, severed links (cleared parentId and soft-delete) revoke access immediately with a constant denial shape, foreign/nonexistent/malformed probes are byte-identical in both en and ar, and multi-child reads never cross-contaminate.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - provisioning tx and severance writers"
  participant t as "Teacher T - certified en"
  participant p as "Parent P - en, linked to S1"
  participant p2 as "Parent P2 - ar, linked to S3 and S4"
  participant s1 as "Student S1 - sigma1 owner"
  participant s3 as "Student S3 - sigma3 owner"
  participant s4 as "Student S4 - sigma4 owner"
  participant life as "SessionLifecycleService"
  participant report as "SessionReportService"
  participant monitor as "ParentMonitoringService"
  participant spy as "SpiedFanoutTransport"
  participant db as "Postgres"

  system->>life: book start complete sigma1 sigma3 sigma4 - real lifecycle path
  t->>report: submitSessionReport sigma1 notes rating jadid madi
  report-)spy: TWO publishes - S1 wave and P wave, both en copy
  p->>monitor: listLinkedChildren - contains S1
  p->>monitor: listChildReports listChildHomework getChildProgress listChildSessions - sigma1 rows only
  p2->>monitor: every per-child read of S1
  monitor-->>p2: constant ForbiddenError FORBIDDEN - byte-identical, four bounded logs
  system->>db: sever arm A - clear students.parentId for S1
  p->>monitor: listLinkedChildren - S1 excluded - all four reads 403 constant shape
  system->>db: restore link then sever arm B - setGovernanceFixture isDeleted true
  p->>monitor: same constant denial shape - no branch disclosure
  p2->>monitor: probe foreign S1, never-linked S2, absent id, malformed id in en
  monitor-->>p2: byte-identical FORBIDDEN fingerprints - repeat probes stable
  p2->>monitor: same four probes in ar
  monitor-->>p2: code FORBIDDEN in both locales - message locale-composed, differs
  t->>report: submitSessionReport sigma3 then sigma4
  report-)spy: each wave publishes S-student en copy and P2 ar copy
  p2->>monitor: listLinkedChildren - S3 and S4 in stable createdAt-ASC order
  p2->>monitor: listChildReports S3 then S4 - sigma3 and sigma4 rows only, no cross-contamination
  p2->>monitor: listChildHomework getChildProgress listChildSessions - each child sees only own rows
  Note over spy: reads never publish - zero publishes on every read step
```

## parent-session-completion-deep-link.journey.test.ts

The completion-notification deep link (steps 1→6): the teacher's report submission fans a session-pointer wave to the student and linked parent, `getSessionTarget` resolves the session id to the linked child pair, the reports read lands the URL, the unlinked child's wave fails closed, and every denial cause collapses to one constant ForbiddenError.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - provisioning tx"
  participant t as "Teacher T"
  participant p as "Parent P - linked to S1"
  participant pf as "Parent PF - foreign parent"
  participant s1 as "Student S1 - linked, owns sigma1"
  participant s2 as "Student S2 - unlinked, owns sigma2"
  participant report as "SessionReportService"
  participant monitor as "ParentMonitoringService"
  participant spy as "SpiedFanoutTransport"

  system->>report: book start complete sigma1 and sigma2 - real lifecycle path, S1 linked only
  t->>report: submitSessionReport sigma1 notes rating jadid madi
  report->>report: persist report and homework rows bound to sigma1
  report-)spy: TWO publishes post-commit - S1 envelope then P envelope
  p->>monitor: read persisted inbox row - type SessionCompletion, relatedEntityType session, relatedEntityId sigma1
  pf->>monitor: inbox probe - zero sigma1 wave rows for PF and S2
  p->>monitor: getSessionTarget sigma1
  monitor-->>p: closed pair sessionId sigma1 plus studentId S1 - no other fields
  p->>monitor: listChildReports resolved S1 then listChildHomework
  monitor-->>p: landing row carries notes and rating - URL parent children S1 tab reports session sigma1 constructible
  t->>report: submitSessionReport sigma2 for the unlinked child
  report-)spy: exactly ONE publish - S2 only, no parent emission for any parent
  pf->>monitor: getSessionTarget sigma1 as foreign parent
  monitor-->>pf: ForbiddenError FORBIDDEN
  pf->>monitor: getSessionTarget absent session id
  monitor-->>pf: byte-identical FORBIDDEN - existence non-disclosure
  t->>monitor: getSessionTarget sigma1 as teacher
  monitor-->>t: byte-identical FORBIDDEN
  s1->>monitor: getSessionTarget sigma1 as student
  monitor-->>s1: byte-identical FORBIDDEN - four causes, one fingerprint, zero publishes
```

## student-confirmation-of-link.journey.test.ts

The decision legs (steps 1–11): request creation and self-scoped listing, cross-role and governed-student denials, the reject and confirm legs with sibling expiry, the winner/loser confirmation race (deterministic collapse plus the true concurrent cell), the expiry-instant boundary, and the notification deep-link triple contract — every publish spied, every denial byte-identical.

```mermaid
sequenceDiagram
  autonumber
  participant pa as "Parent A"
  participant pb as "Parent B"
  participant ss as "Student S - deciding student"
  participant sf as "Student F - race target"
  participant teacher as "Teacher"
  participant admin as "Admin"
  participant sl as "Student L - already linked"
  participant sg as "Student G - suspended"
  participant system as "System - fixture writers"
  participant svc as "ParentLinkRequestService"
  participant spy as "SpiedFanoutTransport"
  participant db as "Postgres"

  pa->>svc: requestLink sCode - pending plus 7d, ONE inbox row to S
  svc-)spy: exactly ONE publish to S
  ss->>svc: listMyIncoming - Parent A FULL name, live expiry, pending
  teacher->>svc: respondToLinkRequest - ForbiddenError FORBIDDEN
  admin->>svc: respondToLinkRequest - ForbiddenError FORBIDDEN
  pb->>svc: respondToLinkRequest as parent - ForbiddenError FORBIDDEN
  sl->>svc: respondToLinkRequest as foreign student - NotFoundError PARENT_LINK_REQUEST_NOT_FOUND
  ss->>svc: respondToLinkRequest foreign id then nonexistent id
  svc-->>ss: byte-identical constant NOT_FOUND - zero writes
  sg->>svc: respondToLinkRequest as suspended student - constant ForbiddenError, zero side effects
  pb->>svc: requestLink sCode - sibling pending for S
  ss->>svc: respondToLinkRequest reject false on Parent A row
  svc->>db: row Rejected with respondedAt - parentId stays NULL, sibling pending untouched
  svc-)spy: ONE rejected notification to Parent A in persisted locale
  pa->>svc: requestLink sCode again - re-application pending
  ss->>svc: respondToLinkRequest accept true on Parent B row
  svc->>db: students.parentId equals Parent B - ALL sibling pendings materialized Expired
  svc-)spy: ONE accepted notification to Parent B
  pa->>svc: listMyOutgoing - Rejected and Expired history, student name masked forever
  pb->>svc: requestLink fCode - loser pending - then F confirms Parent B row first
  svc->>db: winner link to Parent B - loser row Expired by sibling sweep
  ss->>svc: loser respondToLinkRequest on expired row
  svc-->>ss: ConflictError PARENT_LINK_REQUEST_ALREADY_RESOLVED - zero loser notifications
  svc->>svc: true concurrent race - Promise.allSettled two confirms one student
  svc-->>db: exactly ONE winner link - loser commits nothing, publishes zero
  system->>db: insert boundary request with expiresAt at the DB clock now
  ss->>svc: listMyIncoming - boundary row renders Expired WITHOUT a write
  ss->>svc: respondToLinkRequest at the expiry instant
  svc-->>ss: ConflictError PARENT_LINK_REQUEST_EXPIRED - row materialized Expired, silent
  ss->>svc: inbox triple check - every row carries type plus relatedEntityType plus relatedEntityId
  Note over db: parents hold decision rows only, student holds request rows only - teardown zero residue
```
