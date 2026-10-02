# Requirements & Specification: Parent Session Completion Notification Display

**Plan directory:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display`
**Specs path:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/specs.md`
**Companion Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/plan.md`
**Companion Tasks:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/tasks.md`
**Deferred-items ledger:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/`

## Document Information

- **Feature Name**: Parent Session Completion Notification Display
- **Ticket**: `docs/planning/TICKETS.md:2038-2075` — Owner Stream: Dev 1, Milestone 3, 3 SP, Blocked By: "Parent Read-Only Monitoring Portal" + "Real-Time Notification Engine (WebSocket)" — BOTH SHIPPED: `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/` (#157) + `ai/finished_plans/milestone_2_matching_notifications_escrow/real-time-notification-engine-websocket/`
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-17
- **Author**: Spec Plan Generator (planning wave)
- **Stakeholders**: Parents (consuming audience — the notification recipient and link consumer), Dev 1 stream (feature owner), teachers (report/homework producers — the emission trigger), students (data subjects — own-row recipients and the subjects of the deep-linked content)
- **Related Canonical Documents**: `docs/parents/monitoring-portal.md` (R16 deep-link contract `:207`, DEV1-017 forward item `:307`) · `docs/notifications/realtime-engine.md` (WS substrate) · `docs/sessions/session-report-homework.md:81` ("the body is a link invite, not a content mirror") · `docs/testing/workflow-journey-tests.md` (journey layer)

---

## ⚠️ Phase-0 Ground-Truth Verification

Every substrate row below was verified against the live tree by the research wave BEFORE being cited; the evidence basis is `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/research-00-planning-basis.md` (§1 substrate table) plus `outcome/research-01-emission-backend.md`, `outcome/research-02-notification-ui.md`, `outcome/research-03-parent-portal.md`, `outcome/research-04-i18n-tests-precedents.md` (all verified 2026-09-17). Prose-only (unverifiable) claims are labeled CREATE, never EXISTS. Symbols that do not exist are labeled MISSING.

| Substrate | State | Evidence (verified 2026-09-17) |
|---|---|---|
| Parent-completion emitter | EXISTS — FROZEN | `backend/services/classes/session-report-notification.service.ts:147-152` (`notifySessionReportReady`); parent leg fail-closed `:64-82` (both fields required, `:78-80`); sole production caller `backend/services/classes/session-report.service.ts:306`; publish-after-commit `backend/services/classes/session-report.service.ts:388-390` |
| Notification row shape | EXISTS — FROZEN | `backend/db/schema/notifications/notifications.ts:27-46` — all columns incl. `relatedEntityType: "session"` `:38` + `relatedEntityId: <sessionId>` `:39`; NO metadata/payload/JSON column; NO student id anywhere on the row |
| Wire + WS projection | EXISTS — FROZEN | `RealtimeNotificationPayload` 7-field `data` projection `backend/types/notifications/notification.types.ts:135-143`; allowlist `backend/services/notifications/realtime/redis-pubsub-transport.ts:126-137`; sidecar `backend/ws/notification-ws-server.ts:131-132` |
| `NotificationType.SessionCompletion` | EXISTS | `backend/enum/notifications/notification-type.enum.ts:11` (`"session_completion"`) |
| Route resolver + session matrix | EXISTS — EXTEND | `resolveNotificationRoute(relatedEntityType, notificationType?, role?)` `frontend/lib/notification-route-resolution.ts:188-192`; matrix `:108-120` with `SessionCompletion: { Student, Teacher }` at `:117` — **NO Parent cell (THE gap)**; role-less stage `:137-141` |
| Resolver call sites | EXISTS — 2 only | feed `frontend/views/notifications/feed/NotificationList.tsx:78`; drawer `frontend/components/ui/NotificationDrawerBody.tsx:121`; both render native `<Link href>` (feed `NotificationRow.tsx:92-110`; drawer `:118-124`) |
| Resolver test suite | GREEN — reconciled out-of-band 2026-09-17 (RED at planning verification: 5 pass / 2 fail, stale type-first arg order; now 8 pass / 0 fail via the approved runner, sub-loop exit 0 — research-00 §2.1) | `frontend/lib/notification-route-resolution.test.ts` |
| Portal deep-link landing | EXISTS — EXTEND | `app/(dashboard)/parent/children/[studentId]/page.tsx:64,66-70,73-76` forwards `?tab=`/`?session=`; `ReportsTab.parts.tsx:54-79` highlight + scrollIntoView; ONLY `ReportsTab` receives `session` today (`ParentChildDetailContainer.tabs.tsx:44`) |
| Portal root page + container | EXISTS — EXTEND | `app/(dashboard)/parent/children/page.tsx:47,49-56`; `frontend/views/parent/monitoring/ParentChildrenRootContainer.tsx:15,23,26` (`router.replace` auto-select precedent `:25-35`) |
| Parent-monitoring service + gate | EXISTS — EXTEND | five read methods `backend/services/parents/parent-monitoring.service.ts:153-329`; `requireLinkedChild` constant-denial oracle `backend/services/parents/parent-monitoring.helpers.ts:176-209` (deny `:184-192`, grant check `:199`); rate limit `enforcePortalRateLimit` `:119-132`; NO by-session read exists today (verified — research-03 §3) |
| Parent-monitoring GraphQL surface | EXISTS — EXTEND | five root fields `backend/graphql/query/parents/parent-monitoring.query.ts:110-240` (`myLinkedChildren:110`, `parentChildProgress:135`, `parentChildSessions:156`, `parentChildReports:187`, `parentChildHomework:215`); `$all` parent-only scopes `:102-107`; SDL pin `backend/graphql/test/schema-surface.test.ts:531-535` |
| Apollo cache policy | EXISTS — EXTEND | no-id value types `keyFields: false` at `frontend/providers/apollo/apolloCache.ts:114-118` |
| i18n — notifications namespace | EXISTS — FROZEN | handle `Notifications` `shared/locale/namespaces/registry.ts:22`; copy `eventSessionReportReadyTitle/Body/ParentBody` `shared/locale/types/notifications/index.ts:199,207,213` + `en/notifications/index.ts:82-85` + `ar/notifications/index.ts:83-85`; parity belt `shared/locale/notifications-namespace.parity.test.ts:120-122,372-400` |
| i18n — parentMonitoring namespace | EXISTS — EXTEND | handle `ParentMonitoring` `registry.ts:24`; types `shared/locale/types/parentMonitoring/index.ts:74`; en `shared/locale/en/parentMonitoring/index.ts:23`; ar `shared/locale/ar/parentMonitoring/index.ts:26` |
| Locale accessor system | EXISTS | `useAppTranslation(handle)` `shared/locale/client/use-app-translation.ts:8-16`; single-arg `getTranslations(locale)` `shared/locale/server.ts:15`; `getServerTranslations(locale)` `shared/locale/server-graphql.ts:3`; NO `Translation` enum exists (grep-verified, research-04 §2) |
| Nav | EXISTS — UNCHANGED | parent block `frontend/views/dashboard/nav/navItems.ts:148-154`; NO bottom nav exists anywhere in the app (only a sizing token `frontend/providers/theme/layoutSettings.ts:10`; precedent ruling `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/plan.md:497`) |
| R16 deep-link contract | EXISTS — BINDING | `docs/parents/monitoring-portal.md:207` — `/parent/children/<studentId>?tab=reports&session=<id>`; DEV1-017 forward item `:307` |
| Test infrastructure | EXISTS | journey conventions `docs/testing/workflow-journey-tests.md:55-58,64-70,77-84,86-92,102-103`; wire matrix precedent `backend/graphql/test/parent-monitoring.wire.test.ts:669-1234`; journey deep-link precedent `test/workflows/parents/parent-monitoring.journey.test.ts:790-807`; NO general `test:workflows` script (`package.json:32` is paymob-only) |

**Baseline fact (recorded at Task 0, per research-00 §2):** at planning time (2026-09-17) the resolver test suite was RED — 2 failing cases in `frontend/lib/notification-route-resolution.test.ts` pinning a stale type-first argument order (5 pass / 2 fail). It was reconciled OUT-OF-BAND on 2026-09-17, pre-implementation (a standalone fix outside this plan): rewritten to the resolver's current `(entity, type, role)` signature, now 8 pass / 0 fail. The plan's Task 6 scope therefore narrows to the Parent-cell coverage (R-F).

---

## 1. Executive Summary & Problem Statement

**Feature.** A display-only slice that turns a parent's existing `SessionCompletion` notification into a working deep link: the drawer/feed row becomes a `<Link>` to the portal-root entry URL `/parent/children?session=<id>`, the portal root resolves the session to the linked child server-side and `router.replace`s to the canonical R16 URL `/parent/children/<studentId>?tab=reports&session=<id>`, and the landing highlights the session's report row — with the highlight threaded to the homework and evaluations tabs from the same link. Ticket `docs/planning/TICKETS.md:2038-2075`; decision refs A.4 (notifications), INV-P3, FR-7.4.

**Problem — exactly three gaps** (all display-side; the emission substrate is shipped and byte-frozen):
1. **No Parent route cell**: `SESSION_ROUTES_BY_TYPE_AND_ROLE` maps `SessionCompletion` only to `{ Student, Teacher }` (`frontend/lib/notification-route-resolution.ts:117`), so a Parent-viewed row falls through to `/notifications` (research-02 §7) — the parent receives the row but it leads nowhere.
2. **No session→child resolution**: the notification row carries `relatedEntityId` = the SESSION id only — no student/child id on the row, the wire, or the WS payload (research-01 §5) — so the R16 URL (which needs `<studentId>`) cannot be built from the row alone; no by-session read exists in the parent-monitoring service (research-03 §3).
3. **Highlight threads to the reports tab only**: `renderTabContent` passes the `session` prop to `ReportsTab` alone (`ParentChildDetailContainer.tabs.tsx:44`); `HomeworkTab` and `EvaluationsTab` ignore it — while the ticket promises "report, homework, and evaluation" from one link (`docs/planning/TICKETS.md:2052-2060`).

**Business value.**
- Closes the INV-P3 loop end-to-end: the parent already receives the realtime row; this makes it actionable ("link invite, not a content mirror" — `docs/sessions/session-report-homework.md:81`).
- Delivers the portal's forward contract R16/DEV1-017 exactly as pinned (`docs/parents/monitoring-portal.md:207,307`) with zero substrate changes.
- Fulfills the ticket's four test scenarios (`docs/planning/TICKETS.md:2064-2067`) via one journey, wire, and resolver-test wave.

**Actors.** `parent` (link consumer — the audience), `teacher` (report submitter — the emission trigger), `student` (data subject — own-row recipient), `system` (emission + resolution substrate).

**Non-goals (explicit):**
1. NO emitter, engine, WS envelope, drawer/feed/badge/toast component, or `notifications` i18n copy changes (R-A — the substrate is byte-frozen).
2. NO widening of the frozen notification payload — no CTA/metadata/student-id fields (R-A; engine allowlist is frozen, `redis-pubsub-transport.ts:126-137`).
3. NO new routes, NO new tabs, NO nav changes, NO bottom nav (R-B — the link lands on the pinned R16 URL).
4. NO new Drizzle schema, tables, columns, mutations, seeds, or env keys (R-K — `git diff backend/db/schema/` stays empty).
5. NO new realtime code — the parent already receives the WS push, toast, and unread badge via the generic surfaces (REQ-015 pins this by regression test only).
6. NO resolution of foreign sessions beyond the constant denial — no partial disclosure, no existence probing (D4).

---

## 2. Requirements (EARS)

Requirement ids are the frozen traceability contract of `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/research-00-planning-basis.md` §5 — cited verbatim; tasks in `tasks.md` map onto these ids only.

### 2.0 Execution Protocol & Engineering Discipline

#### REQ-000: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I need a recorded quality and test baseline, a deferred-items ledger, and per-task outcome records, so that new issues are distinguishable from pre-existing ones and no research is repeated.

#### Acceptance Criteria
1. WHEN implementation begins THEN the executor SHALL record the baseline in `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/0-baseline-outcome.md`, including the CURRENT (green) resolver-suite baseline counts AND the RED→green reconciliation history (RED at planning 2026-09-17: 5 pass / 2 fail, stale type-first argument order; reconciled out-of-band the same day: 8 pass / 0 fail, research-00 §2.1) — so Task 6's Parent-cell additions are provably regression-free (R-F).
2. WHEN implementation begins THEN the ledger `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/deferred-items.md` SHALL exist and every mid-task deferral SHALL gain a ledger row before its task may close.
3. WHEN an executing agent starts any task THEN it SHALL read ALL files under `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/` before writing code.
4. WHEN a task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` (research findings, implementation details, cross-file dependencies, carry-overs) AND flip the task checkbox `[ ]` → `[x]` in `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/tasks.md`.
5. WHEN any file is modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 on that file before the next file is touched (progressive tsgo → oxlint → biome → lint → duplicates).
6. WHEN any subtask is marked complete THEN the semantic-review checklist SHALL have run (race conditions, env-config, deferred items, cross-layer imports, enum discipline) — `sub-loop.ts` covers mechanics only.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: none · **Assumptions**: both blocker substrates are shipped and green (verified, research-00 §1).

#### REQ-001: Locale + Enum-Import Compliance (the REAL accessor system)

**User Story:** As a developer, I want compile-time type-safe translations via the real handle-constant accessor system and correct value-imports of enums, so that i18n and type errors surface at build time instead of runtime.

#### Acceptance Criteria
1. WHEN a client component renders user-facing text THEN it SHALL use `useAppTranslation(<Handle>)` with a namespace handle constant imported from `@/shared/locale` — e.g. `useAppTranslation(ParentMonitoring)` as `frontend/views/parent/monitoring/ParentChildrenRootContainer.tsx:22` does (`shared/locale/client/use-app-translation.ts:8-16`). NO `Translation` enum exists anywhere (grep-verified, research-04 §2) — `Translation.` references are FORBIDDEN.
2. WHEN a server component renders user-facing text THEN it SHALL use SINGLE-ARG `getTranslations(locale)` (`shared/locale/server.ts:15`) followed by a property chain (`.parentMonitoringTranslations`) — the two-argument `getTranslations(locale, "ns")` form is FORBIDDEN. Property access only (`t.keyName`); function-call access `t("key")` is FORBIDDEN.
3. WHEN a script, API route, or test needs copy THEN it SHALL use `getServerTranslations(locale)` (`shared/locale/server-graphql.ts:3`) with the same property-chain discipline.
4. WHEN a GraphQL resolver needs user-facing copy THEN it SHALL use the `ctx.t` loader already bound to `ctx.locale`; services receive `locale: string` and slice namespaces via `getServerTranslations(locale).<ns>`.
5. WHEN the frontend logs THEN it SHALL import from `@/frontend/lib/logger` (the file lives at `frontend/lib/logger.ts`; `@/frontend/utils/logger` is STALE and FORBIDDEN); backend code uses `@/backend/lib/logger`.
6. WHEN an enum (`UserRole`, `NotificationType`) is used at runtime THEN it SHALL be a VALUE import from `@/backend/enum/...` (or the generated client type) — never `import type`, never string literals.
7. WHEN new en/ar copy ships THEN key parity between `shared/locale/en/<ns>/index.ts` and `shared/locale/ar/<ns>/index.ts` SHALL be proven by the namespace parity test (`shared/locale/notifications-namespace.parity.test.ts:120-122` pattern), and `bun tsgo` SHALL pass with the `Labels` type as the single source.
8. WHEN any new/modified file is scanned THEN a grep for `next-intl`, `getBackendTranslations`, `shared/messages/`, `Translation.`, two-arg `getTranslations(`, and `@/frontend/utils/logger` SHALL return zero hits.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-000 · **Assumptions**: the compile-time locale system is the ONLY i18n surface (legacy `next-intl` fully removed); the template's `Translation`-enum wording is STALE and deliberately NOT restated here.

### 2.1 The Deep-Link Display Chain

#### REQ-010: Parent Row Deep Link (Drawer AND Feed)

**User Story:** As a parent, I want the SessionCompletion notification row in BOTH the drawer and the feed to be a link into my child's portal view, so that one click takes me to the session's content (ticket scenario "Parent clicks link — session report displayed", `docs/planning/TICKETS.md:2065`).

#### Acceptance Criteria
1. WHEN a row with `relatedEntityType="session"`, wire type `SessionCompletion`, viewer role `Parent`, and a non-empty `relatedEntityId` is resolved THEN the resolver SHALL produce the pure synchronous entry URL `/parent/children?session=<id>` (R-E — matrix cell becomes a builder `(relatedEntityId: string) => string`; new exported constant `PARENT_PORTAL_ROOT_ROUTE = "/parent/children"`).
2. WHEN the row's `relatedEntityId` is absent, null, or the empty string THEN the resolver SHALL fall through to the feed (`/notifications`) — the matrix NEVER fabricates a route (R-E; existing miss semantics, `frontend/lib/notification-route-resolution.ts:92-107`).
3. WHEN the row's viewer role is `Student` or `Teacher` THEN the existing static cells SHALL remain byte-unchanged (`:117` — Student → `/student/sessions`, Teacher → `/teacher/sessions`).
4. WHEN the role-less type stage is consulted (viewer role not a wire role) THEN it SHALL stay byte-unchanged — parents always carry a resolvable wire role from `useAuth` (R-E).
5. WHEN either call site renders a Parent SessionCompletion row THEN the resolved href SHALL flow through the existing native `<Link>` surfaces with NO component change beyond passing the row's `relatedEntityId`: feed `frontend/views/notifications/feed/NotificationList.tsx:78`, drawer `frontend/components/ui/NotificationDrawerBody.tsx:121`.
6. WHEN the resolver signature is consulted THEN it SHALL be `resolveNotificationRoute(relatedEntityType, notificationType?, role?, relatedEntityId?)` — the 4th parameter optional, `string | number | null` (wire rows carry `number | null`), with the matrix value type widened to `string | ((relatedEntityId: string) => string)` (R-E).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-011, REQ-050 · **Assumptions**: both surfaces' role plumbing is fully generic (`userRole: string | null` prop) so the new cell needs no component refactor (research-02 §7).

#### REQ-011: Portal-Root Session Resolution → Canonical R16 URL (Two-Hop)

**User Story:** As a parent who followed the notification link, I want the portal root to resolve the session to my linked child and land me on the session's report view, so that I see the report without manual navigation (ticket AC `docs/planning/TICKETS.md:2064-2069`).

#### Acceptance Criteria
1. WHEN the portal root loads with `?session=<id>` present THEN the root container (`frontend/views/parent/monitoring/ParentChildrenRootContainer.tsx`) SHALL resolve it via the new `parentSessionTarget` query and `router.replace` to the canonical R16 URL `/parent/children/<studentId>?tab=reports&session=<id>` (R-D; `docs/parents/monitoring-portal.md:207`).
2. WHEN resolution succeeds THEN the canonical URL SHALL carry the linked child's `studentId` and preserve the `session` param — the existing detail shell forwards `?tab=`/`?session=` unchanged (`app/(dashboard)/parent/children/[studentId]/page.tsx:73-76`), so the reports tab lands on the highlighted row (R-B).
3. WHILE `?session=` is present and unresolved THEN the session-resolution flow SHALL own navigation — the existing first-child auto-select effect SHALL NOT race it (R-D).
4. WHEN resolution resolves AFTER the auto-select would have fired (or vice versa) THEN the effects SHALL be ordered/guarded so that the final URL is deterministic — no interleaved double navigation.
5. WHEN the resolver (leaf module, no Apollo) builds the entry URL THEN it SHALL remain synchronous and pure — no query, no side effect (R-D; drawer/feed rows are `<Link href>` computed synchronously).

#### Additional Details
- **Priority**: High · **Complexity**: High · **Dependencies**: REQ-010, REQ-020, REQ-030 · **Assumptions**: root-container `router.replace` navigation is established (`ParentChildrenRootContainer.tsx:25-35`); rejected alternatives (per-row async fetch, client-side child-scan) per D2.

#### REQ-012: Resolution-Failure Handling (Fallback, No Race)

**User Story:** As a parent whose session link no longer resolves (severed link, deleted session, foreign id), I want a graceful localized notice and the normal portal behavior, so that a stale link never dead-ends or leaks anything.

#### Acceptance Criteria
1. WHEN `parentSessionTarget` rejects FORBIDDEN THEN the root container SHALL show a transient localized notice (`sessionTargetUnavailableNotice`, REQ-041) and fall through to the existing first-child auto-select behavior (R-D).
2. WHEN the notice renders THEN it SHALL be localized in BOTH locales (en/ar) and RTL-correct in Arabic (R-H).
3. WHEN any resolution failure occurs THEN the parent SHALL stay on the portal root with working navigation — no error boundary, no blank screen, no data disclosure (D4).
4. IF the query errors for non-denial reasons (network) THEN the same fallback SHALL apply — the portal degrades to its pre-feature behavior.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-011, REQ-041 · **Assumptions**: the constant-denial oracle makes "missing", "foreign", and "unlinked" indistinguishable client-side (REQ-020), so one fallback covers all.

#### REQ-013: Session Highlight on Homework + Evaluations Tabs

**User Story:** As a parent, I want the deep-linked session highlighted not only on reports but also on the homework and evaluations tabs, so that one link surfaces all three content promises (ticket scenario "Notification includes session report, homework, and evaluation", `docs/planning/TICKETS.md:2067`).

#### Acceptance Criteria
1. WHEN `renderTabContent` renders a tab THEN it SHALL pass the `session` prop to `HomeworkTab` and `EvaluationsTab` in addition to `ReportsTab` (R-G; `frontend/views/parent/monitoring/ParentChildDetailContainer.tabs.tsx:34-50`).
2. WHEN `HomeworkTab`/`EvaluationsTab` receive a `session` prop THEN they SHALL apply the SAME highlight + `scrollIntoView` mechanism as `ReportsTab.parts.tsx:54-79` (match on the row's `sessionId`, `aria-current="true"`).
3. WHEN the parent switches tabs with a live `?session=` param THEN the container's existing `router.replace(buildDetailUrl(...))` tab-switch behavior SHALL preserve the session param across tabs (`ParentChildDetailContainer.tsx:52-57`) — highlight follows.
4. IF `ParentHomeworkEntryReturnType` lacks `sessionId` THEN the implementation SHALL add it to the closed projection + mapper + documents + codegen (R-G; verify at implementation — `ParentHomeworkEntryReturnType` at `backend/types/parents/parent-monitoring.types.ts:127-133` currently carries `sessionId` at `:129`; `mapHomeWorkRowToEntry` emits it, `parent-monitoring.helpers.ts:291`).

#### Additional Details
- **Priority**: Medium · **Complexity**: Medium · **Dependencies**: REQ-011 · **Assumptions**: the evaluations tab re-reads the SAME report rows (`EvaluationsTab.tsx:46`), so the same `sessionId` key drives its highlight with no new query.

#### REQ-014: Content Promise — One Link, Three Surfaces (Copy Byte-Frozen)

**User Story:** As a parent, I want the single notification link to surface the report (teacher notes + rating), the homework assignment, and the evaluation score, so that the ticket's content promise holds from ONE link.

#### Acceptance Criteria
1. WHEN the parent lands via the deep link THEN the reports tab SHALL highlight the session's report row, which carries `teacherNotes` + `studentRatingByTeacher` (report row fields per `backend/types/parents/parent-monitoring.types.ts:81-89`, `sessionId` at `:83`).
2. WHEN the parent opens the homework tab from the same URL THEN the session's homework row (the assignment) SHALL be highlighted (REQ-013); when the parent opens the evaluations tab THEN the session's rating-centric row SHALL be highlighted.
3. WHEN any notification copy is touched THEN the `notifications` i18n namespace SHALL remain BYTE-FROZEN — `eventSessionReportReadyTitle/Body/ParentBody` and all other keys unchanged (R-A; `shared/locale/en/notifications/index.ts:82-85`, `ar/notifications/index.ts:83-85`, parity pins `shared/locale/notifications-namespace.parity.test.ts:120-122,372-400`).
4. WHEN the deep link surfaces content THEN it SHALL only ever render portal data the parent is already authorized to read — the link NEVER bypasses `requireLinkedChild` (R-K; BOLA posture per REQ-021).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-013 · **Assumptions**: the notification body remains a "link invite, not a content mirror" (`docs/sessions/session-report-homework.md:81`) — content lives in the portal, not in copy or payload.

#### REQ-015: Realtime + Inbox Regression Pin (NO New Realtime Code)

**User Story:** As the platform owner, I want the existing realtime delivery of the parent's SessionCompletion row pinned by test, so that the display change provably did not disturb the shipped push/inbox substrate.

#### Acceptance Criteria
1. WHEN a linked child's session report is submitted THEN the parent SHALL receive the row via the shipped emission (receipt prepared in-tx, published post-commit — `backend/services/classes/session-report.service.ts:306,388-390`) — asserted by spying the notification dispatch boundary, NEVER real channels (`docs/testing/workflow-journey-tests.md:86-92`).
2. WHEN the row reaches the browser THEN the WS push, Apollo cache merge, localized toast, and unread-badge bump SHALL continue to work through the GENERIC surfaces with zero new realtime code (R-A; socket path `frontend/hooks/notifications/use-notification-realtime.socket.ts:112-178`; toast is display-only, never navigates — research-02 §5).
3. WHEN the journey asserts realtime behavior THEN it SHALL pin `relatedEntityType="session"`, `relatedEntityId=<sessionId>`, and wire type `SessionCompletion` on the parent's row (research-01 §4; journey step-2 precedent `test/workflows/parents/student-confirmation-of-link.journey.test.ts:1210`).
4. WHEN any component in `frontend/views/notifications/**`, `frontend/hooks/notifications/**`, or `frontend/components/ui/Notification*` is diffed THEN only the two resolver call sites (passing `relatedEntityId` through) may change — the drawer, feed shell, badge, toast host, and socket modules are byte-frozen (R-A).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-051 · **Assumptions**: INV-P3 delivery was already shipped and tested by the engine plan; this REQ is a pin, not a build.

#### REQ-016: Unlinked-Parent Negative (Emission Fails Closed + Stale Links Deny)

**User Story:** As the platform owner, I want unlinked parents provably excluded at BOTH ends — emission and resolution — so the display feature cannot become a data-leak vector (ticket scenario "Unlinked parent — no notification", `docs/planning/TICKETS.md:2066`).

#### Acceptance Criteria
1. WHEN a session completes for a student with NO stored parent link THEN the emission SHALL produce NO parent row — the wave context fails closed to unlinked (`backend/services/classes/session-report-notification.service.ts:64-82`, check `:78-79` → `null` `:80`; parent branch returns `[studentReceipt]` only, `:180-183`) — asserted in the journey (emission-fail-closed step, research-00 §7 step 5).
2. WHEN a stale/dangling row is later clicked (e.g. link severed after emission) THEN `parentSessionTarget` SHALL reject with the constant localized `ForbiddenError` — indistinguishable from a nonexistent session (REQ-020; D4).
3. WHEN the denial surfaces in the UI THEN the parent SHALL see the transient notice + auto-select fallback (REQ-012) — never the session's existence, student, or any field.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-012, REQ-020, REQ-051 · **Assumptions**: emission-side fail-closed is shipped and frozen (R-A) — this REQ only pins it.

### 2.2 The Session→Child Resolution Read (Backend)

#### REQ-020: `parentSessionTarget` Authorization (Link Gate + Oracle + Rate Limit)

**User Story:** As a parent, I want the session→child resolution to enforce the same link-gate and denial discipline as the rest of the portal, so that the new read is as safe as the shipped surfaces.

#### Acceptance Criteria
1. WHEN `ParentMonitoringService.getSessionTarget(parentActorId, sessionId, locale, tx?)` is called with a non-positive session id THEN it SHALL throw a localized `ValidationError` (guard `isPositiveSafeInt`).
2. WHEN the caller passes the actor gate (`requireActor(parentActorId, UserRole.Parent, ...)`) and rate limit (`enforcePortalRateLimit`) THEN the service SHALL perform ONE repeatable-read transaction: `SessionRepository.findById(sessionId, tx)` → null ⇒ constant localized `ForbiddenError` → `requireLinkedChild(parentActorId, row.studentId, locale, tx)` → return `{ sessionId: row.id, studentId: row.studentId }` (R-C; frozen signature, research-00 §4).
3. WHEN the session row is missing, foreign, or the child is unlinked/severed THEN all three cases SHALL yield the SAME constant localized `ForbiddenError` — existence non-disclosure (D4), matching the portal oracle (`parent-monitoring.helpers.ts:184-192`).
4. WHEN a denial is logged THEN the context bag SHALL contain ONLY `{ code, entity: "sessions", entityId: sessionId, locale }` — NO session row fields (R4 log discipline; same bounded-bag shape as the portal gate, `parent-monitoring.helpers.ts:185-190`).
5. WHEN the service returns THEN the projection SHALL be the closed two-field `{ sessionId, studentId }` — no other session fields, no notes, no grades (R-I-adjacent minimal projection).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-030 · **Assumptions**: `SessionRepository.findById` EXISTS (reused; NO new repo method, NO new table — R-C); rejected client-side child-scan per D2/D3.

#### REQ-021: BOLA / BOPLA / BFLA Defenses (Wire-Tier)

**User Story:** As the security owner, I want the new field defended at the wire tier exactly like the five shipped portal fields, so no probing vector opens with the new read.

#### Acceptance Criteria
1. WHEN the field is called by an anonymous caller THEN it SHALL return 401 (constant anonymous denial shape).
2. WHEN the field is called by a wrong-role caller (student/teacher/admin) THEN it SHALL return 403 with zero data (BFLA).
3. WHEN a parent probes a foreign or nonexistent session id THEN both SHALL return the byte-identical constant FORBIDDEN denial (BOLA — indistinguishable; wire-matrix precedent `backend/graphql/test/parent-monitoring.wire.test.ts:1062-1098`).
4. WHEN a caller smuggles extra identity args THEN the request SHALL die as GRAPHQL_VALIDATION_FAILED pre-resolver (BOPLA — closed arg whitelist `(sessionId: Int!)`; precedent `:1124-1125`).
5. WHEN the wire tests run THEN en/ar denial copy SHALL both be asserted (locale negotiation precedent `:1186-1219`).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-020, REQ-050 · **Assumptions**: identity is always `ctx.user.id` — never a client-supplied parent id.

### 2.3 GraphQL Contract, Cache, and Codegen

#### REQ-030: SDL Contract — `parentSessionTarget`

**User Story:** As a frontend consumer, I want a typed, parent-only GraphQL field that resolves a session id to the linked child, so the portal root can build the canonical deep-link URL client-side.

#### Acceptance Criteria
1. WHEN the schema is generated THEN it SHALL contain `parentSessionTarget(sessionId: Int!): ParentSessionTarget!` on the parent-monitoring query surface — wire name drops the `ReturnType` suffix (objectRef `"ParentSessionTarget"`, TS interface `ParentSessionTargetReturnType` in `backend/types`; Pothos precedent `backend/graphql/pothos/parents/parent-monitoring.pothos.ts:179,312`) (`backend/graphql/query/parents/parent-monitoring.query.ts`, beside the five existing fields `:110-240`).
2. WHEN the field's auth scopes are evaluated THEN they SHALL be `authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }` — the load-bearing `$all` conjunction (portal R13; existing scopes `:102-107`).
3. WHEN the field resolves THEN it SHALL call `ParentMonitoringService.getSessionTarget(ctx.user.id, args.sessionId, ctx.locale)` — identity from `ctx.user.id`, locale from `ctx.locale`.
4. WHEN the `ParentSessionTarget` objectRef is registered THEN it SHALL live beside the existing parent-monitoring object refs (locate via the query file's existing imports — no invented location) exposing exactly `sessionId: Int!` and `studentId: Int!`.
5. WHEN the type is defined THEN `ParentSessionTargetReturnType` SHALL be appended to `backend/types/parents/parent-monitoring.types.ts` (never in the Pothos file) as the frozen interface `{ readonly sessionId: number; readonly studentId: number }` (research-00 §4).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-020 · **Assumptions**: no local type definitions in Pothos files (project rule); single canonical object type.

#### REQ-031: Codegen, Apollo Cache, SDL Pin, Documents Test

**User Story:** As a maintainer, I want the new field fully wired through codegen, cache normalization, and the SDL pin, so the surface behaves like every shipped portal read.

#### Acceptance Criteria
1. WHEN the schema changes THEN the executor SHALL run `bun run generate:gqlSchema` then `bun codegen` (R-J) and commit the regenerated artifacts.
2. WHEN the schema-surface SDL pin runs THEN `backend/graphql/test/schema-surface.test.ts` (field list at `:531-535` area) SHALL include `parentSessionTarget` in the parent-monitoring field set.
3. WHEN the frontend document is created THEN `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts` SHALL export `parentSessionTargetQueryDocument` (naming convention `{Field}QueryDocument`) selecting `sessionId` + `studentId` — id-first selection does not apply (the type carries NO `id`, R-I).
4. WHEN Apollo normalizes `ParentSessionTarget` THEN `frontend/providers/apollo/apolloCache.ts` SHALL carry `ParentSessionTarget: { keyFields: false }` appended beside the existing portal entries (`:114-118`) — a closed no-id value type (R-I).
5. WHEN the documents test runs THEN `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.test.ts` SHALL pin the new document's selection set.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-030 · **Assumptions**: codegen handles the new non-null Int args/fields with no manual client typing.

### 2.4 UX / Navigation & i18n

#### REQ-040: UX & Navigation — Zero New Routes, Zero Nav Changes

**User Story:** As the product owner, I want the deep link to land on the pinned R16 URL through the EXISTING route and nav surfaces, so the portal's navigation contract stays intact (R-B).

#### Acceptance Criteria
1. WHEN the plan's route inventory is audited THEN it SHALL contain ZERO new routes — see the route table in §4; `/notifications`, `/parent/children`, `/parent/children/[studentId]` all exist.
2. WHEN the parent sidebar renders THEN the parent block (`frontend/views/dashboard/nav/navItems.ts:148-154`) SHALL be byte-unchanged — the deep link is an entry into existing surfaces, not a new nav item.
3. WHEN any UX/Nav section is filled THEN "Mobile Bottom Nav" SHALL be answered **N/A — none exists** (R-B; no bottom-nav component anywhere — only the sizing token `frontend/providers/theme/layoutSettings.ts:10`).
4. WHEN roles are audited THEN only `Parent` gains behavior (the link + resolution); Student/Teacher cells and surfaces stay unchanged; Admin has N/A (no parent nav, no portal access — wire 403 per REQ-021).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-011 · **Assumptions**: the R16 URL is already deep-linkable end-to-end (research-03 §1-2) — this REQ forbids inventing parallel surfaces.

#### REQ-041: i18n — Exactly One New Key Family in `parentMonitoring`

**User Story:** As a parent reading a stale/unresolvable link's fallback, I want a correctly localized (en/ar, RTL-safe) notice, so the failure path is as polished as the happy path.

#### Acceptance Criteria
1. WHEN the resolution-failure notice needs copy THEN exactly ONE new key family SHALL ship in the `parentMonitoring` namespace: `sessionTargetUnavailableNotice` — added to the type schema (`shared/locale/types/parentMonitoring/index.ts`), the English leaf (`shared/locale/en/parentMonitoring/index.ts`), and the Arabic leaf (`shared/locale/ar/parentMonitoring/index.ts`) in lockstep (R-H).
2. WHEN the parity test suite runs THEN the `parentMonitoring` parity test SHALL be extended to list the new key and assert en/ar parity incl. RTL correctness of the Arabic string (R-H).
3. WHEN NO new notification copy is proposed THEN the `notifications` namespace SHALL receive zero changes (R-A — byte-frozen).
4. WHEN `bun tsgo` runs THEN the three leaves SHALL typecheck against the `Labels` interface — the single source of truth.

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: REQ-012, REQ-001 · **Assumptions**: the notice is a plain string key (no interpolation params needed — no session/student data may appear in it, matching the privacy-hygiene posture `shared/locale/notifications-namespace.parity.test.ts:382-400`).

### 2.5 Test Engineering

#### REQ-050: Test Tiers, Layer Rules, Approved Runners

**User Story:** As the quality owner, I want every new surface tested in its proper tier with the project's approved runners, so the feature cannot ship on ad-hoc test invocations.

#### Acceptance Criteria
1. WHEN a journey test is run THEN it SHALL be invoked as `bun run test/scripts/run-test.ts test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` — NEVER raw `bun test` (no general `test:workflows` script exists; `package.json:32` is paymob-only; `KOTTABY_TEST_RUNNER_OK=1` is a debugging bypass only, never a task runner).
2. WHEN the wire tests run THEN they SHALL run via `bun run test:graphql` (`package.json:36`) extending `backend/graphql/test/parent-monitoring.wire.test.ts` (tiers: anonymous 401; wrong-role 403; parent + nonexistent → constant FORBIDDEN; parent + foreign → constant FORBIDDEN; parent + linked child's session → `{ studentId }`; en/ar denial parity).
3. WHEN the service tests run THEN `parent-monitoring.service.test.ts` SHALL be extended following the file's existing mocking conventions (happy path; missing session → constant denial; foreign → constant denial; non-positive id → `ValidationError`; rate-limit passthrough).
4. WHEN the resolver tests run THEN `frontend/lib/notification-route-resolution.test.ts` (already reconciled to the current `(entity, type, role)` signature out-of-band 2026-09-17) SHALL, after Task 6, additionally pin Parent-cell cases (entry URL built; absent id → feed; other types + Parent → feed) with Student/Teacher cells unchanged (R-F).
5. WHEN frontend component tests run THEN they SHALL use `bun run test/scripts/run-test.ts <path>` and cover: documents test (REQ-031), root-container resolution tests (success replace / failure notice / no auto-select race), tab-highlight tests mirroring the ReportsTab pattern.
6. WHEN journey tests are authored THEN they SHALL follow `docs/testing/workflow-journey-tests.md`: committed `beforeAll` fixtures in ONE committing transaction, FK-safe `afterAll` teardown with existence re-probes, NO `runInRollback` (`:55-58`), honest role auth via localized error substrings (`:77-84`), dispatch-boundary spy (`:86-92`), `bun:test` imports only.
7. WHEN a service-layer test inside `test/workflows/` asserts a rejection THEN it SHALL use try/catch + localized-substring matching — NEVER `expect(...).rejects.toThrow()`.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-000 · **Assumptions**: the wire matrix precedent (`backend/graphql/test/parent-monitoring.wire.test.ts:669-1234`) provides the tier scaffolding to extend.

#### REQ-051: Journey J1 — Test-First Cross-Actor Contract

**User Story:** As the quality owner, I want the cross-actor deep-link journey written FIRST (`test/workflows/parents/parent-session-completion-deep-link.journey.test.ts`), so the implementation is provably contract-driven.

#### Acceptance Criteria
1. WHEN Task 1 executes THEN `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` SHALL be CREATED and FAIL (red) before any implementation file is touched — asserting the full §3 step list.
2. WHEN the journey fixtures are provisioned THEN they SHALL include a teacher, a student, a linked parent, a completed session, and its report/homework — created via `backend/db/test/entity-setup.ts` helpers with the `jrn_parents_<uuid8>` unique-prefix convention (never seed/demo rows).
3. WHEN the journey asserts emission THEN it SHALL assert BOTH that the dispatch happened AND which userIds it targeted (student always; parent only when linked) via the spy.
4. WHEN the journey reaches the negative steps THEN it SHALL assert (a) unlinked-child session → NO parent emission (fail-closed, `backend/services/classes/session-report-notification.service.ts:78-80`), (b) foreign parent → `getSessionTarget` throws the constant localized `ForbiddenError` — indistinguishable from nonexistent (research-00 §7 steps 5-6).
5. WHEN the happy path is asserted THEN the reports read for the resolved child SHALL contain the session's report row (`sessionId`, `teacherNotes`, `studentRatingByTeacher`) — the R16 URL is constructible and lands on the highlighted row (journey precedent `test/workflows/parents/parent-monitoring.journey.test.ts:790-807`).

#### Additional Details
- **Priority**: High · **Complexity**: High · **Dependencies**: REQ-015, REQ-016, REQ-050 · **Assumptions**: the deep-link step at `test/workflows/parents/parent-monitoring.journey.test.ts:790-807` is the established precedent for session-id-bearing row assertions.

### 2.6 Quality & Knowledge

#### REQ-060: Per-File Quality Gates + Resolver-Test Reconciliation (R-F) + Baseline Comparison

**User Story:** As the quality owner, I want per-file gates on every touched file and the resolver suite's baseline history recorded (reconciled out-of-band pre-implementation), so the shipped tree is provably cleaner than the baseline.

#### Acceptance Criteria
1. WHEN a file is modified/created THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 on it (progressive tsgo → oxlint → biome → lint → duplicates, first failure short-circuits).
2. WHEN Task 6 completes THEN `frontend/lib/notification-route-resolution.test.ts` — whose stale-arg reconciliation already landed out-of-band 2026-09-17 — SHALL carry the new Parent-cell coverage against the `(entity, type, role, relatedEntityId?)` signature (R-F).
3. WHEN the implementation completes THEN a baseline comparison SHALL show: the 2 pre-existing resolver-suite failures GONE, tsgo clean, and no new quality-gate stage failures vs the Task-0 baseline.
4. WHEN the post-implementation review wave runs THEN review-types/review-backend/review-frontend/security-probing SHALL pass over the Tasks 3-8 file set, and the backend-scoped mid-point review gate (Task 4.5) SHALL have passed before any frontend file was touched.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-000, REQ-050 · **Assumptions**: the quality toolchain is green on the working branch apart from the recorded resolver-suite baseline.

#### REQ-061: Knowledge Propagation

**User Story:** As a future agent, I want the canonical portal doc updated with the delivered display contract, so the R16 forward item is closed in the documentation that pinned it.

#### Acceptance Criteria
1. WHEN implementation completes THEN `docs/parents/monitoring-portal.md` SHALL be extended with the DEV1-017 display-contract section: the two-hop navigation, the `parentSessionTarget` read, the entry-URL → canonical-URL mapping, and the tab-highlight threading (replacing the `:307` forward-item marker with shipped-state prose).
2. WHEN the final task closes THEN a final outcome document SHALL be written under `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/` recording delivered surface, deviations, and carry-overs.
3. WHEN docs are updated THEN every path:line cited SHALL be re-verified at write time (no stale citations propagated).

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: REQ-060 · **Assumptions**: `docs/parents/monitoring-portal.md` remains the canonical parent-portal contract document.

---

## 3. Cross-Actor Workflow Scenario (Journey J1)

Maps 1:1 onto `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` (REQ-051, test-first). Conventions: `docs/testing/workflow-journey-tests.md` — committed `beforeAll` fixtures (`:64-70`), honest role auth via localized error substrings (`:77-84`), dispatch-boundary spy, never real channels (`:86-92`), FK-safe `afterAll` teardown; runner `bun run test/scripts/run-test.ts <path>` (`:102-103`).

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Teacher | `teacher` | submit the session report (the emission trigger) | resolve other parents' sessions; see parent rows |
| Student | `student` | receive own completion row | resolve session targets (parent-only field — wire 403, REQ-021) |
| Parent | `parent` | receive the SessionCompletion row; resolve `parentSessionTarget`; land on the R16 deep link | resolve a foreign session; receive rows for unlinked children |
| System | engine | emit + publish post-commit; constant-denial oracle | widen the frozen payload |

### Ordered Step List

| # | Actor → Action | Expected Shared-State Change + Side Effects | REQs |
|---|---|---|---|
| 1 | Teacher → submits report for a completed session | report persisted; emission receipts prepared for student + linked parent; published post-commit (spy the dispatch boundary — NEVER real channels) | REQ-015 |
| 2 | System → parent inbox | row exists with `relatedEntityType="session"`, `relatedEntityId=<sessionId>`, wire type `SessionCompletion` | REQ-015 |
| 3 | Parent → `ParentMonitoringService.getSessionTarget(parentId, sessionId)` | returns `{ sessionId, studentId }` where `studentId` is the LINKED child | REQ-020 |
| 4 | Parent → follows the deep link | reports read for that child contains the session's report row (`sessionId`, `teacherNotes`, `studentRatingByTeacher`); the R16 URL lands on the highlighted row; homework + evaluations highlight from the same URL | REQ-010, REQ-011, REQ-013, REQ-014 |
| 5 | Negative: unlinked child's session | NO parent emission (fail-closed wave `backend/services/classes/session-report-notification.service.ts:78-80`) | REQ-016 |
| 6 | Negative: foreign parent probes `getSessionTarget` | constant localized `ForbiddenError` — indistinguishable from a nonexistent session | REQ-016, REQ-020, REQ-021 |

### Cross-Actor EARS Criteria

- WHEN the teacher submits a session report for a linked-child session THEN the system SHALL prepare receipts for BOTH the student and the linked parent AND publish them only after the caller's commit (REQ-015).
- WHEN the parent's row is rendered in the drawer or feed THEN the system SHALL present the entry-URL link `/parent/children?session=<id>` (REQ-010), observed by the parent as a clickable row.
- WHEN the parent follows the link THEN the system SHALL resolve the session to the linked child server-side and land on `/parent/children/<studentId>?tab=reports&session=<id>` with the row highlighted (REQ-011).
- IF the session does not resolve for the parent (missing/foreign/unlinked) THEN the system SHALL show the transient localized notice and fall through to the existing first-child auto-select (REQ-012) — the teacher/student actors observe nothing (no probing signal, D4).
- IF an unauthorized actor (anonymous, student, teacher, admin) attempts `parentSessionTarget` THEN the system SHALL reject with the tiered constant denial (401/403; REQ-021) — zero data, no existence disclosure.

---

## 4. UX/Navigation Requirements

### Route Inventory — ZERO new routes (R-B)

| Route | Purpose | Exists? | What changes |
|-------|---------|---------|--------------|
| `/notifications` | Notification feed page | EXISTS — `app/(dashboard)/notifications/page.tsx:26-36` | nothing in the shell; feed rows gain the new deep-link href via the resolver (REQ-010) |
| `/parent/children` | Portal root | EXISTS — `app/(dashboard)/parent/children/page.tsx:47,49-56` | root container gains the `?session=` resolution flow (REQ-011/REQ-012) |
| `/parent/children?session=<id>` | Deep-link ENTRY URL (pure, synchronous) | NEW URL shape over an EXISTING route — no file created | consumed by the resolver's Parent cell (REQ-010) |
| `/parent/children/[studentId]` | Child detail (tabbed) | EXISTS — `app/(dashboard)/parent/children/[studentId]/page.tsx:64-76` | unchanged shell; `?tab=`/`?session=` forwarding already shipped (`:73-76`) |
| `/parent/children/[studentId]?tab=reports&session=<id>` | Canonical R16 landing URL | EXISTS as URL shape over an EXISTING route | the resolution `router.replace` target (REQ-011); tab session threading to homework/evaluations (REQ-013) |

### Sidebar Navigation Placement

No sidebar changes. The parent block `frontend/views/dashboard/nav/navItems.ts:148-154` (`/parent/dashboard`, `/notifications`, `/parent/children`, `/parent/handshake`, `/profile`) is byte-unchanged — the deep link enters through the notification surfaces, not a nav item.

### Role-Based Access Matrix

| Role | Drawer/feed SessionCompletion row | `parentSessionTarget` read | Portal routes |
|------|----------------------------------|---------------------------|---------------|
| Parent | row links to `/parent/children?session=<id>` (REQ-010) | 200 `{ sessionId, studentId }` for linked child; constant FORBIDDEN otherwise (REQ-020) | full (as shipped by the portal plan) |
| Student | unchanged — cell `/student/sessions` (`notification-route-resolution.ts:117`) | 403 (REQ-021) | no parent routes (unchanged cell) |
| Teacher | unchanged — cell `/teacher/sessions` (`:117`) | 403 (REQ-021) | no parent routes (unchanged cell) |
| Admin | N/A — admins receive no SessionCompletion rows for the parent audience; fall-through to feed | 403 (REQ-021) | N/A (no parent nav block, no portal access) |

### Mobile Bottom Nav

**N/A — none exists.** No bottom-nav component exists anywhere in the app (grep-verified: only the sizing token `frontend/providers/theme/layoutSettings.ts:10`; precedent ruling `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/plan.md:497`). This plan adds no bottom nav (R-B).

---

## 5. Non-Functional Requirements

### Performance
1. WHEN a parent clicks a linked row THEN the flow SHALL cost exactly one extra GraphQL read (`parentSessionTarget`) before the canonical navigation — no client-side fan-out over children (rejected O(children) child-scan per D2).
2. WHEN the resolver builds the drawer/feed href THEN it SHALL be a synchronous pure function — zero network on row render (R-D).

### Security
1. WHEN any session id is probed through the new read THEN the constant ForbiddenError oracle + bounded log bag (REQ-020) SHALL hold — no session fields in denial context.
2. WHEN the new field is hit THEN `enforcePortalRateLimit` SHALL apply exactly as for the five shipped portal reads (`backend/services/parents/parent-monitoring.service.ts:119-132`).
3. WHEN the deep link is followed THEN authorization SHALL be enforced server-side at the resolution read AND again at every landing read via the shipped `requireLinkedChild` gates — the generic-route + server-side-authz posture ("notification deep-link cannot be abused for IDOR", precedent `ai/finished_plans/milestone_3_parent_portal_admin_governance/student-confirmation-of-parent-link/tasks.md:319`).

### Usability
1. WHEN the parent's locale is Arabic THEN the failure notice and all portal copy SHALL render RTL-correct (R-H; REQ-041).
2. WHEN the landing renders THEN the highlighted row SHALL scroll into view smoothly with `aria-current="true"` (shipped reports mechanism, `ReportsTab.parts.tsx:54-79`) — extended to homework/evaluations (REQ-013).

### Reliability
1. WHEN resolution fails (FORBIDDEN or network) THEN the portal root SHALL degrade to its pre-feature behavior — transient notice + existing first-child auto-select (REQ-012).
2. WHEN the resolution and auto-select effects compete THEN the session flow SHALL own navigation while `?session=` is present and unresolved (R-D) — no double navigation, no race.

---

## 6. Constraints & Assumptions

### Technical Constraints
- **R-A byte-freeze**: `backend/services/classes/session-report-notification.service.ts`, the engine, WS envelope, drawer/feed/badge/toast components, and the `notifications` i18n namespace are frozen.
- **R-B pinned URL**: the landing is `/parent/children/<studentId>?tab=reports&session=<id>` (`docs/parents/monitoring-portal.md:207`) — no new routes/tabs/nav.
- **R-K zero schema**: `git diff backend/db/schema/` stays empty; no mutations, seeds, or env keys.
- **R-J SDL discipline**: `bun run generate:gqlSchema` + `bun codegen` after the schema change; the schema-surface pin updates in lockstep.
- Journey layer rules: NO `runInRollback`; approved runners only (REQ-050).

### Business Constraints
- Ticket budget 3 SP, Dev 1 stream, Milestone 3 (`docs/planning/TICKETS.md:2041-2046`).
- The ticket's four test scenarios (`docs/planning/TICKETS.md:2064-2067`) are the acceptance set — mapped: "Session completes — parent notified with link to report" → REQ-015/REQ-010; "Parent clicks link — session report displayed" → REQ-010/REQ-011; "Unlinked parent — no notification" → REQ-016; "Notification includes session report, homework, and evaluation" → REQ-013/REQ-014.

### Assumptions
- Both blockers are shipped and green (verified — research-00 §1).
- Parents always carry a resolvable wire role from `useAuth` (research-02 §1), so the role-less type stage never serves parents.
- `ParentHomeworkEntryReturnType.sessionId` EXISTS (`backend/types/parents/parent-monitoring.types.ts:129`; mapper `parent-monitoring.helpers.ts:291`) — REQ-013 step 4 re-verifies at implementation time.
- The frontend logger is `@/frontend/lib/logger` (the root AGENTS.md `@/frontend/utils/logger` path is stale — never cited).

---

## 7. Success Criteria

### Definition of Done
- [ ] All REQ-000..REQ-061 acceptance criteria met (frozen REQ map, research-00 §5).
- [ ] The ticket's four test scenarios pass end-to-end: parent notified with link (REQ-015/010); click → session report displayed with highlight (REQ-011/013); unlinked parent → no notification (REQ-016); link surfaces report + homework + evaluation (REQ-013/014).
- [ ] Journey J1 (`test/workflows/parents/parent-session-completion-deep-link.journey.test.ts`) green via `bun run test/scripts/run-test.ts <path>`.
- [ ] Wire matrix extended and green via `bun run test:graphql` (REQ-050.2); service, resolver, documents, and component suites green.
- [ ] Resolver suite green at implementation start (out-of-band reconciliation 2026-09-17: 8 pass / 0 fail); Task 6 adds Parent-cell coverage with the baseline comparison recorded (REQ-060.3).
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 on every touched file.
- [ ] `git diff backend/db/schema/` empty; emission substrate files untouched; `notifications` i18n namespace untouched.
- [ ] `docs/parents/monitoring-portal.md` DEV1-017 section updated (REQ-061).

### Acceptance Metrics
- New-read cost: exactly 1 extra GraphQL read per deep-link click (REQ-011; no child-scan).
- Denial oracle: 100% of {nonexistent, foreign, unlinked, severed} session ids produce byte-identical constant FORBIDDEN at wire tier (REQ-021.3).
- Route/nav delta: 0 new routes, 0 nav items, 0 bottom-nav surfaces (REQ-040).
- i18n delta: exactly 1 new key family (`sessionTargetUnavailableNotice`) in en/ar/types with parity-test coverage (REQ-041).

---

## 8. Glossary

| Term | Definition |
|------|------------|
| `SessionCompletion` | The wire notification-type enum member `NotificationType.SessionCompletion = "session_completion"` (`backend/enum/notifications/notification-type.enum.ts:11`) — the parent's completion row. |
| `relatedEntityId` | The nullable numeric pointer on a notification row (`backend/db/schema/notifications/notifications.ts:39`); for session-family rows it carries the SESSION id — never a student id (research-01 §5). |
| R16 deep link | The portal's pinned deep-link contract: `/parent/children/<studentId>?tab=reports&session=<id>` (`docs/parents/monitoring-portal.md:207`) — the forward display target for `session_completion` notifications. |
| Entry URL | The resolver's synchronous pure link `/parent/children?session=<id>` (R-D/R-E) — hop 1 of the two-hop navigation; carries no student id. |
| Resolution | The server-side session→child mapping via the new `parentSessionTarget` read (hop 2): `{ sessionId, studentId }` under the link gate. |
| Constant-denial oracle | The portal's authorization discipline: every denial cause (missing, foreign, unlinked, severed, malformed) yields the SAME constant localized `ForbiddenError` — existence non-disclosure (`backend/services/parents/parent-monitoring.helpers.ts:184-192`; D4). |
| Wire role | The role string reaching the resolver call sites from `useAuth()` (`"Admin" \| "Parent" \| "Student" \| "Teacher"` — `frontend/lib/notification-route-resolution.ts:52`); parents always carry `"Parent"`. |
| Two-hop navigation | R-D: row `<Link href>` → entry URL (hop 1, synchronous) → portal-root resolution + `router.replace` to the canonical R16 URL (hop 2). |
| Dispatch-boundary spy | The journey-test technique asserting emission at `notifySessionReportReady`'s dispatch boundary without touching real email/SMS/push channels (`docs/testing/workflow-journey-tests.md:86-92`). |

---

## 9. Requirements Review Checklist

### Completeness
- [x] All user stories have clear roles, features, and benefits
- [x] Each requirement has specific acceptance criteria using EARS format
- [x] Non-functional requirements are addressed (§5)
- [x] Success criteria are defined and measurable (§7)
- [x] Navigation/sidebar/tabs defined for all user types (§4 — with explicit NO bottom-nav ruling)
- [x] Permissions mapped to all touched routes/pages (§4 role matrix — zero new routes)
- [x] Cross-actor workflow journey captured (actor table + ordered steps + observer-perspective EARS, §3) for the 4-actor flow

### Quality
- [x] Requirements are written in active voice
- [x] Each acceptance criterion is testable (mapped to journey/wire/service/resolver/component suites, REQ-050)
- [x] Requirements avoid implementation details except where the substrate contract is frozen (R-A..R-K, D1..D6 are binding rulings, not open design)
- [x] Terminology is consistent throughout (glossary §8)

### EARS Format Validation
- [x] WHEN statements describe specific events or triggers
- [x] IF statements describe clear conditions or states
- [x] WHILE statements describe continuous behaviors (REQ-011.3)
- [x] All statements use SHALL for system responses

### Clarity
- [x] Requirements are unambiguous
- [x] Technical jargon is explained in glossary (§8)
- [x] No conflicting requirements exist (the byte-freeze rulings resolve all tension between "add a link" and "change nothing")

### Traceability
- [x] Requirements are numbered with the frozen REQ ids (research-00 §5) and organized by area
- [x] Dependencies between requirements are clear (per-REQ Additional Details)
- [x] Requirements link to business objectives (INV-P3, FR-7.4, A.4; ticket `docs/planning/TICKETS.md:2069`)
- [x] Assumptions and constraints are documented (§6)
- [x] Ticket's four test scenarios explicitly mapped (§6 Business Constraints)
- [x] Anti-pattern guardrails encoded (REQ-001, REQ-040, REQ-050 — no `Translation.` enum, single-arg accessors, real logger path, approved runners, no bottom nav)
