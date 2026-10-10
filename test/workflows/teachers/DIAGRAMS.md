# Teachers workflow journey diagrams

Mermaid diagrams for the cross-actor journey suites in this directory, using the same actor names, service entry points, and statuses as the journey code.

## teacher-inactivity-auto-offline.journey.test.ts

The inactivity auto-offline sweep across the real cast (steps 1–11): idle teachers fall past the 15-minute staleness cutoff while fresh explicit-intent toggles survive the same pass, the started-session lock exempts its teacher from every sweep, the strict second-precision boundary decides who falls, overlapping passes collapse to one flip — and the marker-gated release at session conclusion restores the pre-lock Available intent with the next sweep re-offlining the gone-stale teacher (the restore is never activity-conditioned).

```mermaid
sequenceDiagram
  autonumber
  participant system as "System - sweep, fixtures, backdated stamps"
  participant t as "Teacher T - sweep victim and resume actor"
  participant u as "Teacher U - uncertified"
  participant a as "Teacher A - fresh toggle"
  participant l as "Teacher L - in-session actor"
  participant s as "Student S - L session counterparty"
  participant r as "Teacher R - marker restore fixture"
  participant avail as "TeacherAvailabilityService"
  participant lifecycle as "SessionLifecycleService"
  participant inactivity as "TeacherInactivityService"
  participant analytics as "PlatformAnalyticsRepository"

  system->>inactivity: drain pass - stale-online population emptied
  t->>avail: setAvailability true
  avail-->>t: online - fresh intent stamp
  system->>inactivity: sweep at 14 min idle
  inactivity-->>system: offlined 0 - inside the threshold, stamp untouched
  system->>analytics: onlineNowCount rose by one after the toggle
  system->>inactivity: sweep at 30 min idle
  inactivity-->>system: offlined 1 - T falls, last_active_at byte-identical
  system->>analytics: onlineNowCount decayed by exactly T
  t->>avail: setAvailability true again
  avail-->>t: online - activity re-stamped by the toggle
  u->>avail: setAvailability true
  avail-->>u: ForbiddenError teacherNotCertified - row stays offline
  a->>avail: setAvailability true - fresh intent stamp
  system->>inactivity: one pass - A survives, the stale fixture falls, zero publishes
  l->>avail: setAvailability true
  lifecycle->>l: startSession locks offline, marker captured
  system->>inactivity: sweep observes the started session - offlined 0, session live
  l->>avail: setAvailability true while in-session
  avail-->>l: ConflictError teacherInActiveSession - oracle-safe, no session id
  system->>l: force the flag online - the documented sub-second race window
  system->>inactivity: lock priority holds - offlined 0, flag restored to false
  lifecycle->>l: completeSession - release restores per marker despite the stale stamp
  system->>inactivity: next sweep re-offlines the stale restored teacher
  system->>inactivity: second-precision boundary - inside survives, one second past falls
  system->>inactivity: replay pass - offlined 0, zero-row no-op
  system->>inactivity: two concurrent passes - summed count is exactly one flip
  r->>avail: setAvailability true - the pre-lock intent
  lifecycle->>r: startSession - marker true, flag locked offline
  system->>r: backdate lastActiveAt 30 min - gone stale mid-session
  lifecycle->>r: completeSession - marker restore returns Available, marker consumed, stamp byte-identical
  system->>inactivity: next sweep re-offlines R - the freshness leg, never an activity-conditioned restore
```
