# Notifications workflow journey diagrams

Mermaid diagrams for the cross-actor journey suites in this directory, using the same actor names, service entry points, and statuses as the journey code.

## j1-targeted-single-recipient.test.ts

Journey J1: a test-invoked emitter persists one `session_request` notification for a certified teacher via `NotificationEngine.emitForUser`, only that teacher observes or mutates it, and a parent-outsider's mark probe fails oracle-safely with `NOTIFICATION_NOT_FOUND` while the owner's row stays byte-identical.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - fixture setup in one committing tx"
  participant emitter as "Emitter - test-invoked"
  participant teacher as "Teacher T - certified recipient"
  participant student as "Student S - bystander"
  participant outsider as "Parent Pa - outsider"
  participant engine as "NotificationEngine"
  participant spy as "SpiedFanoutTransport"
  participant db as "Postgres"

  system->>db: provision teacher, student, parent with TrackedFixtures
  teacher->>engine: listMyNotifications - empty page, totalCount 0
  teacher->>engine: getMyUnreadCount - 0

  emitter->>engine: emitForUser userId teacher, type SessionRequest, title and body with run prefix, relatedEntityType session, relatedEntityId 4242
  engine->>db: insert one unread notifications row for teacher
  engine->>spy: publishFanout userIds teacher only, payload v 1, kind notification, no userId field
  engine-->>emitter: emitted row id, isRead false
  Note over db: student and parent inboxes stay at zero rows - no fan-out

  teacher->>engine: getMyUnreadCount - 1
  teacher->>engine: listMyNotifications - exactly the emitted row, unread
  student->>engine: listMyNotifications + getMyUnreadCount - still empty and 0

  teacher->>engine: markRead emittedRow
  engine->>db: update isRead true
  engine-->>teacher: row isRead true, unread back to 0
  teacher->>engine: markRead repeat - idempotent, same row, no duplicate

  outsider->>engine: markRead emittedRow
  engine-->>outsider: NotFoundError NOTIFICATION_NOT_FOUND
  Note over db: teacher row byte-identical after the denial probe, outsider inbox still 0

  teacher->>engine: listMyNotifications after simulated reconnect
  engine-->>teacher: catch-up page equals DB listing ordered by createdAt desc, id desc
```

## j2-cohort-broadcast-offline-persistence.test.ts

Journey J2: `NotificationEngine.emitForUsers` fans one `system_broadcast` batch out to parents A and B in a single insert with one shared timestamp and ONE spied publish carrying both ids; offline parent B still finds the persisted row, and a same-key replay returns the prior receipt while a fresh key emits a new batch.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - fixture setup in one committing tx"
  participant emitter as "Emitter - test-invoked"
  participant parentA as "Parent A - online recipient"
  participant parentB as "Parent B - offline recipient"
  participant teacher as "Teacher T - denial bystander"
  participant engine as "NotificationEngine"
  participant spy as "SpiedFanoutTransport"
  participant cache as "InMemoryClaimCache"
  participant db as "Postgres"

  system->>db: provision parents A, B and teacher with TrackedFixtures
  parentA->>engine: getMyUnreadCount - 0
  parentB->>engine: getMyUnreadCount - 0

  emitter->>engine: emitForUsers batch userIds A and B, type SystemBroadcast, key FIRST
  engine->>cache: claim FIRST key - true
  engine->>db: one multi-row insert, 2 unread rows, identical batch createdAt
  engine->>spy: ONE publishFanout carrying BOTH ids, payload v 1, kind notification, no userId field
  engine-->>emitter: delivery receipt with 2 rows
  Note over db: teacher inbox stays at zero rows - no accidental fan-out

  parentA->>engine: listMyNotifications - exactly own copy unread, unread count 1
  parentB->>engine: listMyNotifications offline catch-up - persisted copy, unread 1
  parentB->>engine: markAllRead type SystemBroadcast
  engine->>db: flip exactly B unread row, affected 1
  engine-->>parentB: unread count drops to 0
  Note over db: A keeps unread 1 - mark mutates only B rows

  teacher->>engine: markRead A row - foreign probe
  engine-->>teacher: NotFoundError NOTIFICATION_NOT_FOUND
  teacher->>engine: markAllRead SystemBroadcast - affected 0, A row byte-identical

  emitter->>engine: emitForUsers SAME key FIRST - replay
  engine->>cache: claim FIRST - false, get prior receipt
  engine-->>emitter: prior receipt, same row ids
  Note over spy: zero new rows, zero new publishes

  emitter->>engine: emitForUsers DIFFERENT key SECOND, body null
  engine->>db: fresh 2 rows, own batch timestamp, unread
  engine->>spy: exactly one new publish carrying both ids

  parentA->>engine: markRead NONEXISTENT id - NotFoundError NOTIFICATION_NOT_FOUND, same message as foreign probe
  parentA->>engine: markRead id 0 - ValidationError VALIDATION pre-DB
  Note over db: A inbox unchanged - 2 rows, 2 unread
```

## admin-broadcast.journey.test.ts

Admin A composes broadcasts over every cohort kind through the real `AdminBroadcastService.broadcast` (all, role teacher, targeted country, plan P); a same-key replay is absorbed, validation, BFLA and anonymous denials change nothing, and the governed soft-deleted cast member appears in no cohort while every recipient observes the broadcast in his own inbox.

```mermaid
sequenceDiagram
  autonumber
  participant admin as "Admin A - sender"
  participant cast as "Teacher T / Student S / Parent Pa / Student S2 / StudentExpired SX"
  participant governed as "Governed G - soft-deleted parent with cohort country"
  participant svc as "AdminBroadcastService"
  participant engine as "NotificationEngine"
  participant spy as "SpiedFanoutTransport"
  participant db as "Postgres"

  admin->>db: provision 7 actors, plan P, active and expired subscriptions in one committing tx
  admin->>svc: broadcast audience all, key ALL
  svc->>db: insert rows for every governed member, ZERO for G
  svc->>db: ONE Create audit row, entityId null, metadata only
  svc->>spy: ONE envelope with the full recipient id list
  svc-->>admin: persisted recipient count

  admin->>svc: broadcast replay SAME key ALL
  svc-->>admin: identical count from the stored receipt
  Note over db: zero new rows, zero audit rows, zero new publishes

  admin->>svc: broadcast audience role teacher, key TEACHER
  svc->>db: only T gains a row, one audit row scope role
  admin->>svc: broadcast audience country COHORT_COUNTRY, key EG
  svc->>db: only S gains a row - exact eq match, G governance-excluded
  admin->>svc: broadcast audience plan P, key PLAN
  svc->>db: only active-window subscriber S - expired SX excluded by strict now less than end_date

  admin->>svc: validation probes - empty or overlong title, coherence matrix, hostile discriminant, malformed planId
  svc-->>admin: ValidationError BROADCAST_TITLE_INVALID or BROADCAST_AUDIENCE_INVALID
  admin->>svc: empty cohort country probe - ValidationError BROADCAST_AUDIENCE_EMPTY
  admin->>svc: unknown planId probe - NotFoundError PLAN_NOT_FOUND
  Note over db: every denial writes zero rows, zero audit, zero publishes

  cast->>svc: broadcast probes as teacher, student, parent
  svc-->>cast: ForbiddenError FORBIDDEN through the real admin gate
  cast->>svc: broadcast with NONEXISTENT_USER_ID - ForbiddenError FORBIDDEN
  cast->>svc: broadcast with actorId 0 - UnauthorizedError UNAUTHORIZED
  Note over governed: G appears in NO row and NO envelope of ANY fired broadcast

  cast->>engine: listMyNotifications own inbox post-hoc
  engine-->>cast: type SystemBroadcast, verbatim copy stored inertly, relatedEntityType null, relatedEntityId null, isRead false
  Note over engine: each observer sees exactly the cohorts he belongs to - no cross-cohort leakage
```

## broadcast-retraction.journey.test.ts

Admin A sends a teacher-cohort broadcast, observes it in history and detail, then stops it via `AdminBroadcastService.stopBroadcast` so every linked recipient row is retracted engine-mediated and the recipient's unread count self-corrects; non-admin and anonymous callers are denied with zero state, and the audit trail carries exactly one Create and one Suspend row.

```mermaid
sequenceDiagram
  autonumber
  participant admin as "Admin A - sender and stopper"
  participant recipient as "Teacher R - cohort recipient"
  participant student as "Student N - non-admin"
  participant parent as "Parent N2 - non-admin"
  participant svc as "AdminBroadcastService"
  participant engine as "NotificationEngine"
  participant spy as "SpiedFanoutTransport"
  participant db as "Postgres"

  admin->>db: provision A, T, N, Pa in one committing tx
  admin->>svc: broadcast audience role teacher, key BROADCAST
  svc->>db: broadcasts header status Active, recipientCount, linked notification rows
  svc->>db: ONE Create audit row, entityId header id, metadata only
  svc->>spy: ONE envelope with full recipient list, relatedEntityType broadcast, relatedEntityId header

  admin->>svc: listBroadcasts titleSearch runPrefix
  svc-->>admin: history entry Active, sentByName from SQL join, stopped fields null
  recipient->>engine: listMyNotifications - broadcast row unread, linked to header
  recipient->>engine: markRead own row
  admin->>svc: broadcastDetail header
  svc-->>admin: liveDeliveredCount equals rows, liveReadCount 1

  student->>svc: listBroadcasts - ForbiddenError FORBIDDEN
  parent->>svc: broadcastDetail and stopBroadcast - ForbiddenError FORBIDDEN
  student->>svc: stopBroadcast actorId 0 probes - UnauthorizedError UNAUTHORIZED
  Note over db: zero rows, zero audit, zero publishes, no existence leak pre-gate

  admin->>svc: stopBroadcast header
  svc->>db: status Stopped, delete every linked recipient row
  svc-->>admin: retracted count equals recipient count
  svc->>db: ONE Suspend audit row, metadata recipientCount and retractedCount only
  recipient->>engine: listMyNotifications - inbox clean, unread self-corrects to 0
  Note over spy: publishCount stays 1 - stop is DB-level, no realtime retraction push

  admin->>svc: stopBroadcast SAME header again
  svc-->>admin: ConflictError BROADCAST_ALREADY_STOPPED, zero writes
  admin->>svc: stopBroadcast and broadcastDetail NONEXISTENT id
  svc-->>admin: NotFoundError BROADCAST_NOT_FOUND, zero state
  admin->>svc: listBroadcasts status Stopped
  svc-->>admin: entry Stopped with stoppedByName and stoppedAt, liveDeliveredCount 0, liveReadCount 0
```

## reconnect-catchup.journey.test.ts

Journey: the teacher's realtime socket is killed mid-flight; a notification emitted while offline is persisted with no frame, the reconnect catch-up read surfaces the missed row through the real inbox path with the correct unread count, a second emission delivers a live frame on the NEW socket with the emit-to-frame loopback latency recorded, the observed session row stays byte-unchanged across the whole disconnect window (the sidecar is push-only — session state lives in Postgres), and the connected sibling recipient provably receives nothing while a foreign mark-read probe fails oracle-safely.

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - fixture setup + sidecar boot"
  participant client as "Teacher T - Bun WebSocket client"
  participant sibling as "Parent Pa - sibling recipient, connected throughout"
  participant engine as "NotificationEngine"
  participant wrapper as "RecordingForwardingFanoutTransport"
  participant sidecar as "NotificationWsServer - sidecar on port 0"
  participant db as "Postgres"

  system->>db: provision teacher, student, parent and one observed session row with TrackedFixtures
  system->>sidecar: startNotificationWsServer with recording-and-forwarding in-process transport
  client->>sidecar: connect with access_token cookie - registered, then killed mid-flight
  sibling->>sidecar: connect and stay live for the whole window
  system->>engine: emitForUser while teacher offline - type SessionRequest linked to observed session
  engine->>db: insert one unread notifications row for teacher - persisted with no live socket
  engine->>wrapper: publishFanout teacher only - recorded and forwarded
  Note over sibling: sibling socket provably silent, sibling inbox row count stays 0

  client->>sidecar: reconnect on a NEW socket
  client->>engine: catch-up read - unfiltered inbox page 1 plus unread count
  engine-->>client: missed row surfaces with unread count 1
  system->>engine: second emitForUser
  engine->>wrapper: publishFanout teacher only - recorded and forwarded
  wrapper->>sidecar: envelope delivered in-process
  sidecar-->>client: frame arrives on the NEW socket, emit-to-frame latency recorded
  Note over db: observed session row byte-unchanged across the whole disconnect window

  sibling->>engine: markRead teacher row - foreign denial probe
  engine-->>sibling: NotFoundError NOTIFICATION_NOT_FOUND, teacher row byte-identical
  Note over sibling: sibling inbox still 0 rows, sibling socket still silent
  system->>sidecar: shutdown in afterAll - fresh handshake refused, no lingering listener
```

