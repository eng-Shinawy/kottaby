# Technical Architecture & Implementation Design: Parent Session Completion Notification Display

**Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display`
**Plan path:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/plan.md`
**Specs:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/specs.md`
**Tasks:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/tasks.md`
**Deferred-items ledger:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/`

---

## Document Information

- **Feature Name**: Parent Session Completion Notification Display
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome`
- **Version**: 1.0
- **Date**: 2026-09-17
- **Author**: Design author (planning wave) — all `path:line` citations below come from the verified research base (research-00..04) and were re-verified against the live tree before being written
- **Requirements**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/specs.md` (REQ-000, REQ-001, REQ-010..REQ-016, REQ-020, REQ-021, REQ-030, REQ-031, REQ-040, REQ-041, REQ-050, REQ-051, REQ-060, REQ-061)
- **Research basis**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-session-completion-notification-display/outcome/research-00-planning-basis.md` (rulings R-A..R-K — binding; this plan fleshes them out, never re-opens them) + research-01..04 evidence base

### Related Documents

- Ticket: `docs/planning/TICKETS.md:2038-2075` (heading `:2038`; AC at `:2052-2060`; `docs/planning/MILESTONE_PLAN.md:262` — Dev 1, 3 SP)
- `docs/parents/monitoring-portal.md:22,207,307` — R16 deep-link contract, DEV1-017 forward item, "display contract that closes the notification loop"
- `docs/sessions/session-report-homework.md:54,71,81-82,90,115` — emitter rules: recipients, "link invite, not content mirror", never publish before commit
- `docs/notifications/realtime-engine.md` — WS substrate; `:95` batch-publish envelope id-ruling; `:63-104` parent-completion example
- `docs/notifications/session-request-notifications.md:57` — "never widen the realtime payload for CTAs; routing reads `relatedEntityId` client-side"
- `docs/testing/workflow-journey-tests.md:55-92,102-103` — journey conventions + approved runner
- Precedent plan (structure/tone only; its rulings are NOT binding here): `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/plan.md`
- Binding prior commitments: `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/specs.md:177,541,624,631` (R-I deep-link forward contract, DEV1-017 as consumer)

---

## 1. Overview

This feature is a **display-only vertical slice** over a fully shipped notification substrate. The parent's `SessionCompletion` notification row is already emitted (`session-report-notification.service.ts:147-152`), already WS-pushed (7-field frozen envelope, `notification.types.ts:135-143`), and already rendered in the drawer, feed, badge, and toast surfaces. What is missing is the last mile: the row in the parent's inbox carries only `relatedEntityType: "session"` and `relatedEntityId: <sessionId>` (research-01 §5 — definitively no student/child id on any notification path), so a parent clicking the row today lands on the generic `/notifications` feed (`notification-route-resolution.ts:117` — the `SessionCompletion` matrix row has `Student`/`Teacher` cells only).

This plan closes that loop with four surgical moves and NOTHING else:

1. **One new parent-scoped read field** — `parentSessionTarget(sessionId: Int!): ParentSessionTarget!` resolving a session id to its linked-child id, behind the portal's existing `$all` parent authScope, `requireLinkedChild` gate, rate limiter, and constant ForbiddenError oracle (R-C).
2. **One resolver matrix cell** — the Parent/SessionCompletion cell in `frontend/lib/notification-route-resolution.ts` becomes a builder function producing `/parent/children?session=<id>` from the row's `relatedEntityId` (R-E); the two production call sites (feed `NotificationList.tsx:78`, drawer `NotificationDrawerBody.tsx:121`) pass the id through.
3. **One portal-root resolution flow** — `ParentChildrenRootContainer` reads `?session=`, resolves it via the new query, and `router.replace`s to the canonical R16 URL `/parent/children/<studentId>?tab=reports&session=<id>` (R-D); on denial it shows a transient localized notice and falls back to the existing first-child auto-select.
4. **One tab-threading extension** — the `?session=` highlight threads into `HomeworkTab` and `EvaluationsTab` the same way `ReportsTab` already consumes it (R-G), so ONE link surfaces the report (notes + rating), the homework row, and the evaluation view.

Zero schema changes, zero mutations, zero emitter/WS-envelope changes, zero nav changes, zero new routes (R-B, R-K). `git diff backend/db/schema/` stays empty — a proof obligation in tasks, not an aspiration.

### Design Goals

1. **Close the notification loop without widening any frozen surface** — the realtime envelope, the `notifications` i18n copy, the emitter, and the wire row are all byte-frozen (R-A); the deep link is resolved from `relatedEntityType`/`relatedEntityId` interpretation, never from new payload fields (`docs/notifications/session-request-notifications.md:57`).
2. **Authorization by construction, reusing the portal's proven gate stack** — `$all` role scope + `requireActor` + `requireLinkedChild` + `enforcePortalRateLimit` + constant-denial oracle; NO new repo method, NO new table (R-C).
3. **Existence non-disclosure on session-id probing** — nonexistent, foreign, and unlinked session ids all yield the SAME constant localized `ForbiddenError` with the SAME bounded log context (R-C, REQ-020).
4. **One link, three content tabs** — the R16 reports-tab landing stays canonical; the session highlight threads to homework + evaluations so the ticket's "report, homework, and evaluation" promise ships from a single navigation (R-G, REQ-013/014).
5. **Deterministic, race-free navigation** — the session-resolution effect owns navigation while `?session=` is present and unresolved; the auto-select effect is suppressed in that window (R-D, REQ-012).

### 1.1 Key Design Decisions (D1..D6 — from research-00 §10; each anchored to a ruling)

**D1 — Display-only scope; the emission substrate is byte-frozen (R-A).**
- *Context:* The ticket could tempt an implementer toward payload enrichment, a notification-row CTA field, or emitter changes to carry the child id. All of that substrate already ships and is intentionally minimal (`session-report-notification.service.ts:107-124` — the emit input carries exactly `userId`, `type`, `title`, `body`, `relatedEntityType: "session"`, `relatedEntityId: sessionId`, `idempotencyKey: session:{id}:report`).
- *Options:* (a) widen the emit input / wire row with a student pointer; (b) resolve session→child on the display side only.
- *Decision:* (b). This plan touches only the client resolver, the portal root container, one new read field, and the tab threading. No change to `session-report-notification.service.ts`, the engine, the WS envelope (`redis-pubsub-transport.ts:126-137` allowlist), drawer/feed/badge/toast components, or the `notifications` i18n namespace.
- *Rationale:* R-A ratified; the sibling ruling (`session-request-notifications.md:57` — "Never widen the realtime payload for CTAs") plus the closed-projection ruling (`real-time-notification-engine-websocket/specs.md:71`) forbid payload growth by construction; research-01 §5 proves no notification read path exposes a child id, which is exactly why the display side owns the mapping (`docs/parents/monitoring-portal.md:207` — "the portal resolves the deep-link client-side").

**D2 — Two-hop navigation: sync pure resolver + root-container resolution (R-D).**
- *Context:* The drawer/feed rows navigate via native `<Link href>` computed synchronously (`NotificationRow.tsx:92-110`, `NotificationDrawerBody.tsx:118-124`); the row cannot await a session→child query at render time, and the row itself carries no child id (research-02 §6 key implication).
- *Options:* (a) per-row async fetch to build the canonical URL before render (would force loading states into every row and break the sync `<Link>` pattern); (b) client-side scan of each linked child's paginated reports/sessions to find the session (O(children) queries, pagination-fragile, race-prone — explicitly rejected by R-C); (c) a two-hop split: the resolver produces a SYNCHRONOUS pure entry URL `/parent/children?session=<id>`, and the portal root container resolves `?session=` via the new query and `router.replace`s to the canonical R16 URL.
- *Decision:* (c). The resolver is a leaf module (no Apollo dependency — verified: `notification-route-resolution.ts` imports nothing from Apollo); root-container `router.replace` navigation is the established pattern (`ParentChildrenRootContainer.tsx:25-35` — useEffect at :25, `router.replace` at :32 — per research-00 §1; `redirect()` precedents at `app/(dashboard)/parent/children/[studentId]/page.tsx:69-71`).
- *Rationale:* R-D ratified; zero loading-state debt in the notification surfaces; the portal root is the natural place to own the session→child hop because it already owns child selection.

**D3 — Server-side link-gated session resolution as a NEW GraphQL read (R-C).**
- *Context:* There is NO session-scoped/by-session read anywhere in the parents service today (research-03 §3 — definitive; the deepest session-scoping in existence is the client-side ReportsTab highlight). The mapping session id → student id must come from a gated server read, never from the notification row (research-01 §5).
- *Options:* (a) widen the frozen notification payload or enrich the row (forbidden by R-A and the closed-projection rulings); (b) client-side child-scan (rejected in R-C); (c) new field `parentSessionTarget` on the existing `parent-monitoring.query.ts`, reusing `SessionRepository.findById` + `requireLinkedChild` + `enforcePortalRateLimit`.
- *Decision:* (c). Frozen signature: `getSessionTarget(parentActorId, sessionId, locale, tx?)` in `ParentMonitoringService` returning the closed two-field projection `{ sessionId, studentId }`.
- *Rationale:* R-C ratified; single-hop, index-backed (`session` PK lookup), one gate; keeps the parent's property envelope minimal (BOPLA) and the read path identical in shape to the five shipped portal fields.

**D4 — Constant ForbiddenError oracle for every resolution miss (R-C).**
- *Context:* `parentSessionTarget` accepts an arbitrary integer; a probing parent could distinguish "session exists but not my child's" from "session does not exist" if the denial shapes diverged.
- *Options:* (a) `NOT_FOUND`-style 404 discrimination; (b) one constant localized `ForbiddenError` for nonexistent, foreign, unlinked, and malformed ids.
- *Decision:* (b), byte-identical across all causes, matching the portal's shipped oracle posture (research-03 §8; `requireLinkedChild` at `parent-monitoring.helpers.ts:176-209` already denies constant `ForbiddenError(t.forbidden)` at `:191`). Null session row ⇒ the same constant denial, logged with the bounded context `{ code: "FORBIDDEN", entity: "sessions", entityId: sessionId, locale }` ONLY — no session row fields in the denial log bag (R4 log discipline).
- *Rationale:* R-C ratified; the enumeration trade-off (403 admits "some parent surface exists") is inherent and already accepted by the portal; copy constancy is the mitigation. REQ-016, REQ-020, REQ-021 all pin this.

**D5 — Session highlight threads to homework + evaluations; reports stays the landing (R-G).**
- *Context:* Ticket AC (`docs/planning/TICKETS.md:2052-2060`) demands a link to "report/homework/evaluation". The R16 URL pins `?tab=reports` as the landing (`docs/parents/monitoring-portal.md:207`); only `ReportsTab` consumes `?session=` today (`ParentChildDetailContainer.tabs.tsx:44` — HomeworkTab/EvaluationsTab do not receive it, research-03 §2).
- *Options:* (a) three separate deep links / a chooser UI; (b) ONE landing on reports with the same highlight + scrollIntoView mechanism (`ReportsTab.parts.tsx:54-79`) threaded into `HomeworkTab` and `EvaluationsTab` — the report row carries `teacherNotes` + `studentRatingByTeacher` (`parent-monitoring.types.ts:81-89`, sessionId at `:83`), the homework row carries the assignment, and EvaluationsTab re-reads the SAME report rows (`EvaluationsTab.tsx:46`).
- *Decision:* (b). `renderTabContent` (`ParentChildDetailContainer.tabs.tsx:34-50`) passes `session` to both additional tabs. If `ParentHomeworkEntryReturnType` lacks `sessionId`, add it to the closed projection + mapper + documents + codegen — verify at implementation (research-03 §3 records `sessionId` at `parent-monitoring.types.ts:129` and mapper `mapHomeWorkRowToEntry` at `parent-monitoring.helpers.ts:291` emitting `sessionId`, so the flag should clear as EXISTS).
- *Rationale:* R-G ratified; one navigation surfaces all three content promises; zero new query fields.

**D6 — Resolver test suite RECONCILED out-of-band; remaining scope is Parent-cell coverage (R-F).**
- *Context:* `frontend/lib/notification-route-resolution.test.ts` was RED at baseline verification on 2026-09-17 (5 pass / 2 fail — stale pre-matrix two-stage argument order; research-00 §2.1). It was RECONCILED OUT-OF-BAND the same day, pre-implementation (a standalone fix outside this plan, user-requested, not plan execution): the suite was rewritten to the resolver's current 3-param contract `resolveNotificationRoute(relatedEntityType, notificationType?, role?)` (`frontend/lib/notification-route-resolution.ts:188` — resolver module byte-unchanged) and is now GREEN — 8 tests / 25 expect() calls / 0 fail via `bun run test/scripts/run-test.ts frontend/lib/notification-route-resolution.test.ts`; per-file gate `bun run scripts/health/sub-loop.ts frontend/lib/notification-route-resolution.test.ts --lifecycle duplicates` → exit 0. The rewrite added session-matrix + role-less-type-stage coverage with codegen `UserRole` enum role assertions.
- *Options:* (a) re-do the reconciliation as plan work (already landed — duplicate); (b) treat the green suite as the baseline and scope Task 6 to the Parent-cell coverage ONLY.
- *Decision:* (b). Task 6's remaining scope: NEW Parent coverage on the green suite — entry URL built from a non-empty `relatedEntityId` (once the 4th param lands); absent/empty id → feed (the matrix never fabricates); other types + Parent role → feed; Student/Teacher cells byte-unchanged — plus the 4th `relatedEntityId?` param and the two call sites, all still plan work. Task 0 records the CURRENT green baseline plus the RED→green history so Task 6's additions are provably regression-free.
- *Rationale:* R-F ratified; REQ-060 carries the Parent-cell coverage; the out-of-band reconciliation (landed 2026-09-17, pre-implementation) closed deferred item D1; baseline history recorded at Task 0 is the honesty proof.

### 1.2 Architecture & System Context

```mermaid
graph LR
    E[SessionReportNotificationService.notifySessionReportReady] -->|emit inside tx + publishReceipts post-commit| N[(notifications row: type=session_completion, relatedEntityType=session, relatedEntityId=sessionId)]
    N -->|WS fanout: 7-field frozen envelope| P[Parent browser]
    P -->|drawer / feed row: Link href| R[resolveNotificationRoute entity, type, role, relatedEntityId]
    R -->|Parent + SessionCompletion + id present| ENTRY["/parent/children?session=<id> (sync pure entry URL)"]
    ENTRY --> C[ParentChildrenRootContainer: useQuery parentSessionTarget]
    C -->|resolver.replace on success| L["/parent/children/<studentId>?tab=reports&session=<id> (R16)"]
    C -->|constant FORBIDDEN on denial| NOTICE[transient sessionTargetUnavailableNotice + auto-select fallback]
    L --> T[ReportsTab highlight (existing) + HomeworkTab + EvaluationsTab threading (new)]
    C -.->|authScopes $all parent + requireLinkedChild + rate limit| S[ParentMonitoringService.getSessionTarget]
    S --> RP[SessionRepository.findById]
```

The emitter path (leftmost) is byte-frozen substrate (R-A) — it ships unchanged; the display slice owns everything from the row click rightward.

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend routing | App Router + native `<Link>` (existing) | Drawer/feed rows stay synchronous hrefs; resolution is a root-container effect, not row-level async (D2) |
| Frontend data | Apollo Client v4 `useQuery` (stateful; NO `useLazyQuery`) | Root-container resolution and tab threads consume stateful queries per repo convention |
| Backend | Pothos `queryField` + `authScopes $all` (`parent-monitoring.query.ts:102-107` pattern) | The new field is a sixth sibling of five proven fields (R-C) |
| Database | PostgreSQL via Drizzle — EXISTING tables only | R-K: zero schema/mutation/emitter changes; `git diff backend/db/schema/` stays empty |
| i18n | Compile-time system in `shared/locale/` — handle constants, single-arg `getTranslations` | R-H: ONE new key in `parentMonitoring`; `notifications` namespace byte-frozen |
| Testing | `bun run test/scripts/run-test.ts <path>` (journey/service/frontend), `bun run test:graphql` (wire) | Approved runners only; raw `bun test` on journeys FORBIDDEN (research-00 §8) |

---

## 2. Data Models

### 2.1 The notification wire row (FROZEN — consumed, never widened)

The row the parent clicks is the existing 8-field `Notification` GraphQL object (`backend/graphql/pothos/notifications/notification.pothos.ts:41-79`; fields at `:45-77`) and its client projection `MyNotificationsQuery_myNotifications_items` — `id`, `type`, `title`, `body`, `isRead`, `relatedEntityType`, `relatedEntityId`, `createdAt`. For a session-completion row: `type` is wire enum `SessionCompletion` (`notification-type.enum.ts:11`), `relatedEntityType === "session"` (`notification-route-resolution.ts:45` literal), and `relatedEntityId` is the **numeric session id, `number | null` on the wire** (`graphql.ts:960`; emit site `session-report-notification.service.ts:120-121`). No student id, no CTA, no payload column exists on the row, the table (`backend/db/schema/notifications/notifications.ts:27-46` — full column list, NO metadata/JSON column), or the WS envelope (`notification.types.ts:135-143` — 7-field closed `data` projection) — and this plan adds none (R-A).

### 2.2 New canonical type — CREATE (append to `backend/types/parents/parent-monitoring.types.ts`)

Frozen verbatim from research-00 §4:

```typescript
export interface ParentSessionTargetReturnType {
  readonly sessionId: number;
  readonly studentId: number;
}
```

Rules honored: types live ONLY under `backend/types/` (the file already exists at 179 lines, research-03 §3); every member `readonly`; the shape is CLOSED — exactly two fields, no `id` (a value object, not an entity — R-I/D3 mirror the no-id `ParentReportPage` precedent); no local type definitions in any Pothos file.

**Validation rules (service-side, pre-DB):** `sessionId` must be a positive safe integer — `isPositiveSafeInt(sessionId)` failure ⇒ `ValidationError` (a malformed INPUT, distinct from the link/identity denial which is the constant ForbiddenError; this matches the frozen flow in research-00 §4 and keeps input-shape errors honest while existence probes stay oracle-collapsed). `sessionId` beyond `Number.MAX_SAFE_INTEGER` never reaches the repo.

**Relationships (read projection only):** `ParentSessionTargetReturnType.sessionId → session.id` (PK read); `studentId → session.studentId → students.parentId` (the authorization grant, checked by `requireLinkedChild`). The type is produced ONLY from a session row that passed the gate — no fan-out, no joins beyond the session row.

### 2.3 NO DB changes — proof obligation (R-K)

**N/A (ruled):** no new tables, columns, enums, indexes, seeds, env keys, or Drizzle migrations; `drizzle-kit push/generate` is NOT part of this plan's pipeline. The tasks phase asserts the proof: `git diff --stat backend/db/schema/` is EMPTY on the shipped branch (REQ-020/REQ-060 verification step). The only schema-adjacent artifact changes are the GraphQL SDL regen pair (`bun run generate:gqlSchema` + `bun codegen`, R-J) — GraphQL codegen only, never database codegen.

### 2.4 The portal projections consumed (EXISTING — reused by the landing)

| Projection | Evidence | Role in this feature |
|---|---|---|
| `ParentReportEntryReturnType` — includes `sessionId: number` | `backend/types/parents/parent-monitoring.types.ts:81-89` (`sessionId` at `:83`); mapper `mapReportRowToEntry` `parent-monitoring.helpers.ts:241` | The R16 reports landing: the highlighted row exposes `teacherNotes` + `studentRatingByTeacher` (content promise REQ-014) |
| `ParentHomeworkEntryReturnType` — `sessionId` at `:129` | `parent-monitoring.types.ts:127-133`; mapper `mapHomeWorkRowToEntry` `parent-monitoring.helpers.ts:291` (emits `sessionId`) | Homework-tab highlight anchor (REQ-013); verification flag: if the projection lacks `sessionId` at implementation time, add it to projection + mapper + documents + codegen (R-G caveat) |
| Evaluations view | `EvaluationsTab.tsx:46` re-reads `data?.parentChildReports?.items` | Highlight threads the SAME report rows — no new query, no new projection |

---

## 3. API Contracts

### 3.1 GraphQL SDL additions (one new root Query field; ZERO mutations — R-K)

```graphql
extend type Query {
  "REQ-020/REQ-030: resolves a session id to the caller's linked-child id for the notification deep-link hop (R-C). Nonexistent / foreign / unlinked ids all yield the SAME constant localized ForbiddenError."
  parentSessionTarget(sessionId: Int!): ParentSessionTarget!
}

type ParentSessionTarget {
  sessionId: Int!
  studentId: Int!
}
```

The existing five portal fields (`myLinkedChildren:110`, `parentChildProgress:135`, `parentChildSessions:156`, `parentChildReports:187`, `parentChildHomework:215` — all in `backend/graphql/query/parents/parent-monitoring.query.ts:110-240`) are **unchanged** — byte-identical SDL, args, and resolvers. The new object type `ParentSessionTargetReturnType` registers in the parent-monitoring object-ref module — locate the registration file via the query file's existing imports (the precedent plan's `parent-monitoring.pothos.ts` registration module); do not invent a location. It follows the existing conventions: single `objectRef<ParentSessionTargetReturnType>("ParentSessionTarget")`, `t.exposeInt` for both fields, nullable marks matching TS nullability (both non-null), zero inline logic, ReturnTypes imported from the canonical `@/backend/types` surface only. **Wire-name convention (ten-ref precedent, `backend/graphql/pothos/parents/parent-monitoring.pothos.ts:179,:312`):** the TS interface keeps the `ReturnType` suffix (`ParentSessionTargetReturnType`, defined in `@/backend/types`), but the Pothos objectRef string / GraphQL wire name DROPS it (`"ParentSessionTarget"`) — matching `ParentReportPageReturnType` ↔ `"ParentReportPage"` etc. The Apollo cache policy key `ParentSessionTarget` MUST equal this wire name.

### 3.2 Resolver wiring (`parent-monitoring.query.ts` — appended field)

```typescript
gqlSchemaBuilder.queryField("parentSessionTarget", t =>
  t.field({
    type: ParentSessionTargetPothosObject,
    args: { sessionId: t.arg.int({ required: true }) },
    description: "…",
    authScopes: parentOnlyAuthScopes,  // shared const (`parent-monitoring.query.ts:102-107`) — the const itself embodies the load-bearing $all conjunction (portal R13)
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {                                          // TS narrowing only — scope already threw
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ParentMonitoringService.getSessionTarget(ctx.user.id, args.sessionId, ctx.locale);
    },
  })
);
```

Identity is `ctx.user.id` ONLY — the caller never supplies a parent id (BOLA). Args are the closed whitelist `{ sessionId }` — no input-object spread, so BOPLA identity-smuggling probes die as `GRAPHQL_VALIDATION_FAILED` pre-resolver (the wire-matrix precedent at `parent-monitoring.wire.test.ts:1124-1125`).

### 3.3 Field-level permission matrix

| Operation | anonymous | Student | Teacher | Admin | Parent (linked child's session) | Parent (foreign / nonexistent / unlinked id) |
|---|---|---|---|---|---|---|
| `parentSessionTarget` | 401 `UNAUTHORIZED` (builder.ts:127-132 pattern) | 403 `FORBIDDEN` | 403 | 403 | 200 `{ sessionId, studentId }` | 403 — SAME constant copy, zero data (D4) |

The `$all` conjunction is load-bearing (portal R13): `authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }` requires BOTH predicates; omitting `$all` ORs them and would let anonymous callers through the role check (the rationale documented at `parent-monitoring.query.ts:102-107`) — the new field does NOT inline this object; it reuses the shared const `parentOnlyAuthScopes` defined at `parent-monitoring.query.ts:102-107`, which all five existing portal fields use and which itself embodies the `$all` conjunction. Denial copy source: `errorsTranslations.forbidden` — the same key every existing 403 uses; NO new denial keys (REQ-020, REQ-041 keeps denial copy out of the new key family).

### 3.4 Frontend document contract

`frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts` — append (naming convention `{Field}QueryDocument`):

```graphql
query ParentSessionTarget($sessionId: Int!) {
  parentSessionTarget(sessionId: $sessionId) {
    sessionId
    studentId
  }
}
```

Export: `parentSessionTargetQueryDocument`. Convention: `TypedDocumentNode` typed against generated types, docblock, hooks from `@apollo/client/react` if consumed via hook — the root container consumes it statefully via `useQuery` (NO `useLazyQuery`, per repo convention). No `id` field is selectable — the type carries none by design (R-I).

### 3.5 Apollo cache policy

`frontend/providers/apollo/apolloCache.ts` — append beside the existing portal no-id entries (`:114-118`, where `ParentReportPage`/`ParentChildProgress` carry `keyFields: false`):

```typescript
ParentSessionTarget: { keyFields: false },
```

R-I ratified: the type carries NO `id`, so it MUST be excluded from cache normalization or Apollo emits a missing-`id` warning on every fetch. This is the explicit reconciliation against the root AGENTS.md "Always include id field on every object type" rule: the portal precedent R14 (`docs/parents/monitoring-portal.md:205` — "Apollo cache policy: keyFields:false for no-id value types ONLY") governs no-id value types like this one, which are normalized-exempt rather than id-bearing. The value object is transient by design — the root container reads it once per navigation and never needs cache identity.

### 3.6 Codegen + schema-surface pin obligations (R-J)

1. `bun run generate:gqlSchema` → regenerate the Pothos SDL with the new field.
2. `bun codegen` → regenerate `frontend/graphql/generated/` types (commit).
3. `backend/graphql/test/schema-surface.test.ts` — the five-field SDL pin (`:531-535` area) gains `parentSessionTarget` with its exact arg/return shape, so accidental renames/drops fail CI (REQ-031).
4. `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.test.ts` — the documents test gains the new document's selection pin (`sessionId` + `studentId`, no id-first pin since there is no `id` — assert the two-field closed selection instead).

---

## 4. Service & Repository Signatures

### 4.1 `getSessionTarget` — frozen signature + full flow (research-00 §4)

```typescript
export async function getSessionTarget(
  parentActorId: number,
  sessionId: number,
  locale: string,
  tx?: DBTransaction
): Promise<ParentSessionTargetReturnType>
```

Appended to `ParentMonitoringService` in `backend/services/parents/parent-monitoring.service.ts` (a sixth member beside the five existing methods, `:153-329`). Exact flow, in order:

1. `isPositiveSafeInt(sessionId)` fails ⇒ throw `ValidationError` (malformed input — NOT the constant denial; distinct error class, honest for real clients, and repo never touched).
2. `await requireActor(parentActorId, UserRole.Parent, locale, tx, false)` — the RELAXED read-path variant (the same relaxed re-check `listLinkedChildren` performs, `parent-monitoring.service.ts:158`): a governed-but-not-deleted parent may still read.
3. `enforcePortalRateLimit(parentActorId, locale)` — reuse the portal limiter (`parent-monitoring.service.ts:119-132`; bypassed under `TEST_CI`/`TEST_SERVER` per the scaffold at `:94-116` — the TEST bypass is the limiter's own existing behavior, not a new carve-out).
4. ONE repeatable-read transaction (`withTransaction` — the gate+read-single-snapshot discipline, D11 of the precedent plan still binding): `SessionRepository.findById(sessionId, tx)` ⇒ `null` ⇒ throw the CONSTANT localized `ForbiddenError` (portal denial copy) with `logDomainError` context `{ code: "FORBIDDEN", entity: "sessions", entityId: sessionId, locale }` ONLY — NO session row fields (R4 log discipline, REQ-020).
5. `requireLinkedChild(parentActorId, row.studentId, locale, tx)` — the existing gate (`parent-monitoring.helpers.ts:176-209`); every miss (foreign student, never-linked, severed via `users.isDeleted`, malformed) collapses to the SAME constant denial shape at `:191`.
6. Return `{ sessionId: row.id, studentId: row.studentId }` — the closed two-field projection, values sourced strictly from the gated row.

### 4.2 Repository reuse table (NO new repo methods)

| Member | File:line | State | Role in `getSessionTarget` |
|---|---|---|---|
| `SessionRepository.findById` | `backend/db/repo/classes/session.repository.ts:130` | EXISTS — reuse as-is | The single PK read fetching the session row (`id`, `studentId`) |
| `requireLinkedChild` | `backend/services/parents/parent-monitoring.helpers.ts:176-209` | EXISTS — reuse as-is | The link gate on `row.studentId`; constant denial oracle at `:191` |
| `enforcePortalRateLimit` | `backend/services/parents/parent-monitoring.service.ts:119-132` (scaffold `:94-116`) | EXISTS — reuse as-is | Per-parent read throttle; TEST bypass is existing limiter behavior |
| `requireActor` (relaxed) | `backend/services/parents/parent-link-request.helpers.ts:234-236` docblock precedent; portal usage `parent-monitoring.service.ts:158` | EXISTS — reuse as-is | Actor role re-check, relaxed read variant |
| `withTransaction` | `@/backend/lib/db/with-transaction` | EXISTS — reuse | One repeatable-read snapshot for gate + session read |

**Verdict: ZERO new repository methods, ZERO new tables, ZERO writes (R-C, R-K).** The feature's entire data footprint is one existing PK lookup.

### 4.3 Client resolver + call-site contract (R-E)

`frontend/lib/notification-route-resolution.ts` — MODIFY:

1. **Signature gains the 4th optional parameter:**
   ```typescript
   export function resolveNotificationRoute(
     relatedEntityType: string | null,
     notificationType?: string | null,
     role?: string | null,
     relatedEntityId?: string | number | null
   ): string
   ```
   (Wire rows carry `number | null` — `graphql.ts:960`; the `string` union member covers the drawer/item typing where the id may arrive stringified; the guard applies the builder only for a non-empty STRING form, per R-E.)
2. **Matrix value type widens:** `string | ((relatedEntityId: string) => string)`.
3. **The Parent/SessionCompletion cell becomes the builder** `parentSessionCompletionEntry`:
   ```typescript
   SessionCompletion: {
     Student: STUDENT_SESSIONS_ROUTE,                    // byte-unchanged (static)
     Teacher: TEACHER_SESSIONS_ROUTE,                    // byte-unchanged (static)
     Parent: parentSessionCompletionEntry,               // NEW builder
   }
   ```
   producing `PARENT_PORTAL_ROOT_ROUTE` + `?session=<id>` — i.e. `/parent/children?session=<relatedEntityId>`.
4. **New exported constant:** `PARENT_PORTAL_ROOT_ROUTE = "/parent/children"`.
5. **Application rule (the matrix never fabricates):** the builder is applied ONLY when `relatedEntityId` is a non-empty string; absent/empty id falls through to the feed (`NOTIFICATIONS_FEED_ROUTE`). Existing Student/Teacher cells stay static strings. The role-less type stage (`NOTIFICATION_ROUTE_BY_TYPE`, `:137-141`) is byte-unchanged — parents always carry a resolvable wire role from `useAuth` (research-02 §7: the drawer/feed role plumbing is fully generic).

**The two exact production call sites** (MODIFY — thread the row's `relatedEntityId` as the 4th argument; no other call sites exist, research-02 §2):

| Site | File:line | Change |
|---|---|---|
| Feed list | `frontend/views/notifications/feed/NotificationList.tsx:78` | `deepLinkHref={resolveNotificationRoute(notification.relatedEntityType, notification.type, userRole, notification.relatedEntityId)}` |
| Drawer body | `frontend/components/ui/NotificationDrawerBody.tsx:121` | `href={resolveNotificationRoute(item.relatedEntityType, item.type, userRole, item.relatedEntityId)}` |

Both surfaces navigate via native `<Link href>` — unchanged. The realtime toast path has NO navigation at all (`use-notification-realtime.socket.ts:112-178`) and stays untouched (REQ-015: the push/toast/badge behavior is pinned by tests, not modified).

### 4.4 Concurrency & Race Condition Assessment

| Scenario | Actors | Risk | Mitigation |
|---|---|---|---|
| Link severed mid-resolution (parent opens `?session=` link; the child severs the link before the query lands) | parent vs severance flow | Deny-after-click flash of data | **Pure read; NO `SELECT FOR UPDATE` anywhere.** Gate + session read share ONE repeatable-read transaction snapshot: a link severed mid-flight resolves to the constant denial within the same snapshot (the gate reads the grant inside the tx — `requireLinkedChild(parentActorId, row.studentId, locale, tx)`). A granted read is consistent with itself; the next navigation re-gates fresh. |
| Root-container navigation race (auto-select effect vs session-resolution effect both firing `router.replace`) | two client effects in `ParentChildrenRootContainer` | Double navigation / navigation thrash / the auto-select overwriting the session landing | **Ruling (R-D): while `?session=` is present and unresolved, the session-resolution flow OWNS navigation; the auto-select effect is suppressed** (guard the existing auto-select effect on the absence of a pending `?session=`). The two effects must never both replace. On resolution failure (FORBIDDEN): show the transient localized notice, clear the pending session param, THEN fall through to the existing first-child auto-select. Tests pin success-replace, failure-notice, and the no-race suppression (REQ-012). |
| Module-level state | — | Stale shared mutable state | **None.** The resolver is a pure function over its arguments (existing module holds only frozen consts); the resolution state is component-local `useState`/query state in the root container; the service is stateless. |
| Concurrent identical resolutions (parent double-clicks the row) | one browser | Two identical `parentSessionTarget` queries | Harmless: duplicate read-only query; Apollo request dedup coalesces identical in-flight documents. No write amplification is possible (zero mutations, R-K). |
| Report submitted while parent is on the landing | teacher write vs parent read | Highlight target missing momentarily | Accepted staleness: the ReportsTab fetch is client-driven; a just-submitted report appears on the next fetch. No cross-request locking is warranted for a display surface. |

---

## 5. Cross-Actor Journey Design (J1 — the test-first contract, research-00 §7)

### 5.1 Shared-entity state machine (notification row; session row is read-only substrate)

| Current State | Trigger (actor + action) | Next State | Guard / Permission |
|---|---|---|---|
| (pre-emission) | teacher submits the session report (`session-report.service.ts:306` call) | `emitted` — receipts prepared for student + linked parent | emitter runs inside the caller's tx; recipients resolve server-side from the joined read |
| `emitted` | caller commits (`publishReceipts` at `session-report.service.ts:388-390` — strictly post-commit) | `published` | nothing is ever pushed for a rolled-back tx |
| `published` | engine fanout (WS envelope, 7-field frozen projection) | `inbox-visible` — drawer/feed row + toast + badge bump | recipient's own authenticated socket only |
| `inbox-visible` | parent clicks the row (`<Link>` → entry URL) | `clicked` (row also flips `isRead` fire-and-forget via the existing mark action) | authenticated parent session |
| `clicked` | portal root resolves `?session=` via `parentSessionTarget` | `resolved` (200 → `router.replace` to R16) **or** `denied` (constant 403 → transient notice + auto-select fallback) | `$all` parent scope + `requireLinkedChild` |
| `resolved` | browser lands on `/parent/children/<studentId>?tab=reports&session=<id>` | `landed` — highlighted report row; thread continues to homework/evaluations tabs | server shell `withPageAuth` + client container |

The `session` row and the `students.parentId` grant are READ-ONLY substrate for this feature: this plan adds no transitions to them — it only observes them through the gate. Severance transitions (grant → NULL, child soft-delete) abort the chain at the `clicked → resolved` hop with the constant denial.

### 5.2 Side-effect matrix (per transition)

| Transition | Rows Created/Updated by THIS plan | Notifications (channel → recipient actor) | Idempotency Key |
|---|---|---|---|
| report submission → `emitted` | **NONE** (emitter is frozen substrate) | emissions for student + linked parent — `emitReportReadyNotification` per recipient with identical emit input | `session:{id}:report` (`session-report-notification.service.ts:114-124`; engine claim digest per recipient, fail-open) |
| `emitted` → `published` | NONE | `NotificationEngine.publishReceipts` post-commit → WS fanout | envelope carries the first sibling row's `id` (`docs/notifications/realtime-engine.md:95` batch ruling) |
| every other transition (click, resolve, land) | NONE — zero writes anywhere in this feature | NONE | N/A (INV: display-only, R-K) |

### 5.3 Cross-actor visibility table

| State | Teacher sees | Student sees | Parent sees |
|---|---|---|---|
| report submitted, emission prepared (pre-commit) | own report (participant queries) | nothing yet (publish is post-commit) | nothing yet |
| `published` / `inbox-visible` | own row: type `SessionCompletion` → `/teacher/sessions` (byte-unchanged cell) | own row: type `SessionCompletion` → `/student/sessions` (byte-unchanged cell) | own row: the NEW link → `/parent/children?session=<id>` |
| `clicked → resolved` | n/a (not their navigation) | n/a | R16 landing: report row (notes + rating), homework row, evaluations view — child-scoped via the gate |
| `clicked → denied` (unlinked/foreign/stale session) | n/a | n/a | transient `sessionTargetUnavailableNotice` + first-child auto-select; NO disclosure of session existence |
| unlinked child's session completes | the teacher's own report surface | own row (student always receives) | NO parent emission at all (fail-closed wave context, `session-report-notification.service.ts:78-80,180-183` — REQ-016) |
| foreign parent probes `parentSessionTarget` | n/a | n/a | constant ForbiddenError — indistinguishable from nonexistent session (D4) |

### 5.4 Mapping to J1 ordered steps (assertion set for the journey test, research-00 §7)

| J1 step | Assertion | Design seam |
|---|---|---|
| 1 | Teacher submits report for a completed session → emission receipts prepared for student + linked parent; published post-commit (SPY the dispatch boundary — never real channels) | `session-report.service.ts:306,388-390`; journey spy per `docs/testing/workflow-journey-tests.md:86-92` |
| 2 | Parent inbox contains the row with `relatedEntityType="session"`, `relatedEntityId=<sessionId>`, wire type `SessionCompletion` | `myNotifications` read; the (type, entity, id) triple precedent `test/workflows/parents/student-confirmation-of-link.journey.test.ts:1210` |
| 3 | `ParentMonitoringService.getSessionTarget(parentId, sessionId)` → `{ sessionId, studentId }` where studentId is the LINKED child | §4.1 flow |
| 4 | Reports read for that child contains the session's report row (`sessionId`, `teacherNotes`, `studentRatingByTeacher`) — the R16 URL is constructible and lands on the highlighted row | `parentChildReports`; deep-link precedent `test/workflows/parents/parent-monitoring.journey.test.ts:790-807` |
| 5 | Negative: unlinked child's session → NO parent emission | fail-closed wave `:78-80` |
| 6 | Negative: foreign parent → `getSessionTarget` throws the constant localized ForbiddenError (indistinguishable from nonexistent) | D4; denial asserted via localized substrings from `getServerTranslations("en").errorsTranslations`, try/catch — NEVER `rejects.toThrow` inside journeys |

Journey file (CREATE, TEST-FIRST, Task 1): `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts`.

---

## 6. UX / Navigation Specification

### 6.1 Routes table

| Route (file) | Purpose | Change in this plan | Guard |
|---|---|---|---|
| `/notifications` (`app/(dashboard)/notifications/page.tsx:26-36`) | Feed page | NONE (row hrefs change value, not the page) | `withPageAuth` no role whitelist (every role has an inbox) |
| `/parent/children` (`app/(dashboard)/parent/children/page.tsx:47,49-54,56`) | Portal root — guard-only shell | **MODIFY**: server shell additionally forwards `?session=` (first-value extraction alongside the existing `?student=` handling) into `ParentChildrenRootContainer` | `withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/children" })` |
| `/parent/children/<studentId>?tab=reports&session=<id>` (`app/(dashboard)/parent/children/[studentId]/page.tsx:64,73-76`) | The R16 deep-link landing | NONE — the shell already forwards `?tab=` and `?session=` (`:73-74`) and the container already resolves them (`ParentChildDetailContainer.tsx:33-35`) | `withPageAuth` + service-side gate on every backing query |
| `/student/sessions`, `/teacher/sessions` | Student/Teacher completion-row targets | NONE — byte-unchanged matrix cells | unchanged |

**Zero new routes, zero route removals (R-B).** The entry URL `/parent/children?session=<id>` is an existing route with a new query param, not a new segment.

### 6.2 Sidebar navigation integration

**UNCHANGED (R-B).** The parent nav block (`frontend/views/dashboard/nav/navItems.ts:148-154`) already contains `/notifications` (`:150`) and `/parent/children` (`:151`); the notification row and the portal are both existing destinations. No nav item, label key, icon, or ordering changes.

**Mobile Bottom Nav: N/A — none exists (R-B).** No bottom-nav component exists anywhere in the app (only a sizing token `bottomNavHeight` at `frontend/providers/theme/layoutSettings.ts:10`; the precedent plan rules "NO bottom nav anywhere in this product" — `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/plan.md:497`).

### 6.3 Role-based access matrix

| Surface | Admin | Teacher | Student | Parent (linked) | Parent (unlinked) |
|---|---|---|---|---|---|
| Notification drawer/feed rows | own inbox (unchanged) | own inbox; SessionCompletion → `/teacher/sessions` (unchanged) | own inbox; SessionCompletion → `/student/sessions` (unchanged) | own inbox; SessionCompletion → NEW link `/parent/children?session=<id>` | same new link cell — landing resolves to the constant denial if the child was never linked |
| `/parent/children` routes | Deny (`withPageAuth`) | Deny | Deny | Allow (own children) | Allow root; resolution denies per-session |
| `parentSessionTarget` field | 403 role scope | 403 | 403 | 200 (linked child's session) / 403 otherwise | 403 |
| Reports/homework/evaluations tabs | unreachable | unreachable | unreachable | gated per-child (unchanged) | gated denial (unchanged) |

### 6.4 Per-audience rendering

| Audience | Rendering in this feature |
|---|---|
| **Parent** | Drawer/feed SessionCompletion rows gain the deep-link href (was: generic feed fall-through). On the portal root with `?session=`: resolution-in-flight is silent; success replaces to the R16 URL; FORBIDDEN shows the transient localized `sessionTargetUnavailableNotice` then auto-selects the first child. Reports tab highlights the target row (existing mechanism); homework + evaluations tabs gain the same highlight + scrollIntoView. |
| **Student** | BYTE-UNCHANGED. The `SessionCompletion: { Student: … }` cell is a static string (`/student/sessions`); the resolution, notice, and tab threading never touch student surfaces. |
| **Teacher** | BYTE-UNCHANGED. Same reasoning — `Teacher` cell static (`/teacher/sessions`). |
| **Admin** | Unchanged; admin simply has no Parent matrix cell and no portal access. |

### 6.5 Permission mapping per component

| Component/Route | Required permission | Source of role |
|---|---|---|
| `app/(dashboard)/parent/children/page.tsx` | `withPageAuth({ roles: [UserRole.Parent] })` (`:47`) | server session |
| `app/(dashboard)/parent/children/[studentId]/page.tsx` | same (`:64`) | server session |
| `ParentChildrenRootContainer` | page-level gate + service-side gate per query | server gate; client only renders |
| Notification drawer/feed rows | `withPageAuth` (no role whitelist) on `/notifications`; drawer rides the authenticated dashboard shell | `userRole: string \| null` prop threaded from `useAuth()` (`frontend/views/dashboard/layout/DashboardAppBar.tsx:66,172` → `NotificationUnreadBadge.tsx:140` → `NotificationDrawer.tsx:35,173`; feed: `frontend/views/notifications/feed/NotificationsFeedContainer.tsx:50,95`) |
| `parentSessionTarget` resolver | `$all { authenticated: true, role: [UserRole.Parent] }` | `ctx.user.id` — identity from context ONLY |
| Client resolver `resolveNotificationRoute` | none (pure function; authorization happens at the landing's server gate) | `role` argument threaded from the same `useAuth()` plumbing |

The R-B ruling recorded here: the deep link is an invitation, not an authorization — a Parent who bookmarks or shares `/parent/children?session=<id>` gets exactly the server-side gate outcome (constant denial for anything not linked), the same as the notification-row path. No client authorization exists anywhere in the flow.

---

## 7. Security & Tenancy Mitigations

| Class | Threat | Mitigation (named seam) |
|---|---|---|
| **BOLA** | Foreign session-id probing: a parent harvests session ids (sequential guessing) and calls `parentSessionTarget` to learn which child/session pairs exist | Constant ForbiddenError oracle (D4): nonexistent, foreign, unlinked, and malformed-gate ids all yield the SAME localized copy, SAME error shape, zero data, one bounded log. Existence non-disclosure: the caller cannot distinguish the causes. Identity is `ctx.user.id` only; the `sessionId` arg is validated against the caller's OWN grant (`requireLinkedChild(parentActorId, row.studentId, …)`) before ANY projection is built (REQ-020, REQ-021). |
| **BOPLA** | Property-level smuggling: identity hints riding the field args | Args are the explicit closed whitelist `{ sessionId: Int! }` — NO input-object spread (the resolver passes `args.sessionId` only, `getSessionTarget(ctx.user.id, args.sessionId, ctx.locale)`); identity-arg smuggle probes die as `GRAPHQL_VALIDATION_FAILED` pre-resolver (wire precedent `parent-monitoring.wire.test.ts:1124-1125`). Output side: the projection is the closed two-field `ParentSessionTargetReturnType` — nothing else is selectable by construction. |
| **BFLA** | Low-privilege function access: student/teacher/admin invoking a parent-scoped read | Layer 1 — field-level `$all { authenticated, role: [UserRole.Parent] }` (the load-bearing conjunction, §3.2). Layer 2 — `requireActor(parentActorId, UserRole.Parent, …, false)` re-check inside the service. The wire matrix pins 401/403 for every non-parent class (REQ-021). |
| **Rate limiting** | Session-id enumeration at speed | `enforcePortalRateLimit(parentActorId, locale)` reuse — the SAME per-parent throttle the five portal reads ride (`parent-monitoring.service.ts:119-132`). NOTE: the limiter's existing TEST bypass (`TEST_CI`/`TEST_SERVER`, scaffold `:94-116`) is limiter-own behavior; this plan adds no bypass and tests assert the passthrough only. |
| **R4 denial-log discipline** | Sensitive data leaking through denial logs | The null-session denial logs the bounded bag `{ code: "FORBIDDEN", entity: "sessions", entityId: sessionId, locale }` ONLY — NO session row fields (no studentId, no status, no timestamps). `requireLinkedChild` misses log their own bounded bag (existing `:184-192`); one `logDomainError` per denial, never child row data (REQ-020). |
| **Privacy** | Grade/score/notes leaking through the NEW copy | Parity hygiene pin: the one new key `sessionTargetUnavailableNotice` contains NO grades, scores, notes, ratings, or digits (the notifications parity belt's privacy-hygiene pattern, `shared/locale/notifications-namespace.parity.test.ts:382-400`, extends to the new key). The notice states unavailability only. The `notifications` namespace copy stays byte-frozen (R-A). |
| **Tenancy** | Cross-child visibility | The resolution returns the studentId but the LANDING re-gates per-child through the existing `parentChildReports`/`parentChildHomework` reads — tenancy is enforced twice (resolution + landing), both times through the same `students.parentId` grant. |
| **LINK-wildcards** | n/a | No search input, no `ILIKE` surface exists in this feature. |

---

## 8. i18n Design

### 8.1 Exactly ONE new key family (R-H)

| Artifact | Change |
|---|---|
| `shared/locale/types/parentMonitoring/index.ts` | Append `readonly sessionTargetUnavailableNotice: string;` to `ParentMonitoringLabels` |
| `shared/locale/en/parentMonitoring/index.ts` | e.g. `sessionTargetUnavailableNotice: "This session's details are no longer available."` (final copy at implementation) |
| `shared/locale/ar/parentMonitoring/index.ts` | Arabic literal with full parity — RTL-correct, no grade/score/note/digit content |
| Parity test (extend the parentMonitoring parity coverage) | En/ar key parity for the new key + the privacy-hygiene pattern (no grades/scores/notes/digits) |

NO new namespace (R-H); the `notifications` namespace copy is byte-frozen (R-A). Denial copy stays on `errorsTranslations.forbidden` — no duplicate denial keys.

### 8.2 Accessors (the REAL system — anti-patterns in research-00 §9 are binding)

- **Client components** (root container, tabs): `useAppTranslation(ParentMonitoring)` with the handle constant imported from `@/shared/locale` (the `ParentChildrenRootContainer.tsx:22` precedent). NEVER `Translation.` — NO such enum exists (grep-verified, research-04 §2).
- **Server components**: single-arg `getTranslations(locale)` → `.parentMonitoringTranslations` property chain (`shared/locale/server.ts:15`). NEVER the two-arg form.
- **Tests / scripts**: `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (`:3`), single-arg.
- **Interpolation**: none needed — the notice is a plain string key.
- **RTL**: the Arabic literal is authored RTL-correct; the parity test extension carries the obligation (REQ-041).

---

## 9. Error Handling

### 9.1 Denial + error classes table

| Category | Trigger | Response shape | Copy source | Log discipline |
|---|---|---|---|---|
| 401 unauthenticated | anonymous hits `parentSessionTarget` | `UnauthorizedError`, `extensions.code = "UNAUTHORIZED"` | `errorsTranslations.unauthorized` | scope layer, no portal log |
| 403 wrong role | authenticated non-parent | localized `ForbiddenError`, `FORBIDDEN` | `errorsTranslations.forbidden` | scope layer |
| 403 session resolution miss | session nonexistent / foreign child / unlinked / severed / (gate-side malformed student link) | CONSTANT `ForbiddenError` — byte-identical across all causes, zero data | `errorsTranslations.forbidden` | ONE bounded `logDomainError` bag `{ code, entity: "sessions", entityId, locale }` — no session row fields (R4) |
| 400 validation | `sessionId` not a positive safe integer | `ValidationError` | typed validation copy per the existing service conventions | validation path, pre-DB |
| Resolution failure at the UI | FORBIDDEN lands in the root container | transient `sessionTargetUnavailableNotice` + first-child auto-select fallback (never a raw server message rendered) | `parentMonitoring` namespace | client-side only; no server message leak |
| Entry-URL miss (absent/empty `relatedEntityId`) | wire row lacks the id | resolver falls through to `/notifications` feed — the matrix never fabricates | n/a | none |
| Tab-level read failures | existing per-tab errors | UNCHANGED: `PermissionDeniedFallback` per tab (e.g. `ReportsTab.tsx:50-51`) | existing keys | unchanged |

Logging: backend uses ONLY `logger` from `@/backend/lib/logger` (`logDomainError` for the single denial line); frontend uses `@/frontend/lib/logger` (the root AGENTS.md `@/frontend/utils/logger` path is STALE — never cite it). `console.*` is forbidden everywhere.

### 9.2 Client error surfacing

`ParentChildrenRootContainer` treats a `FORBIDDEN` GraphQL error from `parentSessionTargetQueryDocument` as a NORMAL, expected outcome (stale/dangling notification rows are a legitimate product state — severance happens): no error snackbars, no retry prompts; the transient notice + auto-select fallback IS the handling. All other error codes ride the existing `extractErrorCode` + `mapGraphQLErrorByCode` pattern for consistency.

---

## 10. Testing Strategy (tiers, layers, approved runners — research-00 §8)

Runner discipline: journeys and per-file lanes run via `bun run test/scripts/run-test.ts <path>` — NEVER raw `bun test` on journeys (NO general `test:workflows` script exists; `KOTTABY_TEST_RUNNER_OK=1` is a debugging bypass only, never cited as a task runner). Wire lane runs via `bun run test:graphql` (`package.json:36`). Per-file gates: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) after every file.

| Tier | Suite | Key assertions | Runner |
|---|---|---|---|
| Journey (TEST-FIRST, Task 1) | CREATE `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` | J1 steps 1-6 (§5.4): committed `beforeAll` fixtures + FK-safe tracked `afterAll` teardown; NO `runInRollback` (journey lane exception per `docs/testing/workflow-journey-tests.md:55-58`); honest role auth; dispatch-boundary SPY (never real channels, `:86-92`); denial asserts via localized substrings from `getServerTranslations("en").errorsTranslations` in try/catch — never `rejects.toThrow`; cross-actor visibility in both directions (`:77-84`) | `bun run test/scripts/run-test.ts test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` |
| Service (Task 3) | EXTEND `backend/services/parents/parent-monitoring.service.test.ts` | happy path (linked child's session → `{ sessionId, studentId }`); missing session → constant denial; foreign session → constant denial (assert SAME copy as missing, en AND ar); non-positive `sessionId` → `ValidationError`; rate-limit passthrough (mock per the file's existing mocking conventions) | `bun run test/scripts/run-test.ts backend/services/parents/parent-monitoring.service.test.ts` |
| Wire (Task 4) | EXTEND `backend/graphql/test/parent-monitoring.wire.test.ts` (matrix precedent `:669-1234`) | anonymous → 401; wrong role (student/teacher/admin) → 403; parent + nonexistent session → constant FORBIDDEN; parent + foreign session → constant FORBIDDEN (byte-identical); parent + linked child's session → 200 `{ studentId }`; BOPLA smuggle probe dies pre-resolver; en/ar denial copy parity; id-first pin does NOT apply (no `id` field) — pin the closed two-field selection instead | `bun run test:graphql` |
| SDL lock (Task 4) | EXTEND `backend/graphql/test/schema-surface.test.ts` | field list gains `parentSessionTarget` with exact arg/return shape (`:531-535` area); the five existing portal fields stay pinned byte-identical | `bun run test:graphql` |
| Resolver (Task 6, R-F) | EXTEND `frontend/lib/notification-route-resolution.test.ts` — the stale-arg reconciliation landed out-of-band 2026-09-17 (suite green, 8/8); ADD Parent + SessionCompletion + non-empty id → entry URL `/parent/children?session=<id>`; absent/empty id → feed; other types + Parent → feed; Student/Teacher cells unchanged | `bun run test/scripts/run-test.ts frontend/lib/notification-route-resolution.test.ts` |
| Documents (Task 5) | EXTEND `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.test.ts` | `parentSessionTargetQueryDocument` pins the closed `{ sessionId, studentId }` selection | `bun run test/scripts/run-test.ts <path>` |
| Frontend (Tasks 7-8) | root-container resolution tests + tab-highlight tests | success → `router.replace` to the R16 URL; FORBIDDEN → transient notice + auto-select fallback; NO race (auto-select suppressed while `?session=` pending — the two effects never both replace); homework/evaluations highlight mirrors the ReportsTab pattern (`ReportsTab.parts.tsx:54-79`) | `bun run test/scripts/run-test.ts <path>` |
| i18n parity (Task 2) | parentMonitoring parity extension | en/ar parity for `sessionTargetUnavailableNotice`; privacy-hygiene (no grade/score/note/digit in the rendered notice) | suite runner |
| Per-file gates | every touched file | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 | as listed |

**Journey J1 is test-first** (Task 1 lands the failing journey before any production code); REQ-015's realtime/inbox regression pin rides the journey + the existing engine tests (`backend/services/classes/session-report-notification.test.ts`) — no new realtime code, so no new realtime tests beyond the emission pin.

### 10.1 Wire matrix extension summary (REQ-021)

The new field slots into every existing tier of the portal wire matrix: anonymous cell, three wrong-role cells, no-link cell, foreign-child cell, linked-200 cell, the BOPLA smuggle probe list, and the selection pin — the exact slot-in recipe documented in research-03 §6.

---

## 11. Knowledge Propagation

EXTEND `docs/parents/monitoring-portal.md` (Task 10, REQ-061) — the DEV1-017 display-contract section, placed beside the R16 rule (`:207`) and the DEV1-017 forward item (`:307`):

- the `parentSessionTarget` field contract (args, closed return shape, `$all` parent scope, constant-denial oracle, rate-limiter reuse);
- the two-hop navigation contract: entry URL `/parent/children?session=<id>` → root resolution → canonical R16 URL; the resolution-owns-navigation / auto-select-suppressed rule;
- the resolver matrix ruling: Parent/SessionCompletion builder, the never-fabricate id rule, `PARENT_PORTAL_ROOT_ROUTE` as the single definition site;
- the tab-threading ruling (reports landing + homework/evaluations highlight);
- the frozen-substrate statement (R-A: envelope/emitter/notifications-copy byte-frozen; the link rides `relatedEntityType`/`relatedEntityId` interpretation only);
- the R4 log-discipline statement for the session-denial bag.

Outcome protocol: after each task, write `outcome/<task-id>-outcome.md` (findings, cross-file dependencies, carry-overs); before any task, read ALL files in `outcome/`.

### 11.1 REQ traceability matrix

| REQ | Covered in |
|---|---|
| REQ-000 | §1 baseline statement + D6 + §10 (journey test-first, baseline recorded Task 0) |
| REQ-001 | §8.2 accessors (handle constants, single-arg `getTranslations`, property access, real logger paths) |
| REQ-010 | §4.3 resolver builder + call sites |
| REQ-011 | §4.1 flow + §6.1 routes (root resolution → R16 `router.replace`) |
| REQ-012 | §4.4 navigation-race ruling + §9.1 resolution-failure row |
| REQ-013 | §2.4 / D5 (homework + evaluations threading) |
| REQ-014 | D5 + §5.4 (one link, three content tabs; notifications copy byte-frozen) |
| REQ-015 | §5.1-5.2 (realtime/inbox substrate observed, pinned by journey; no new realtime code) |
| REQ-016 | D4 + §5.3 (fail-closed emission + constant denial for stale rows) |
| REQ-020 | §4.1 flow + §7 (gate, oracle, R4 log discipline, rate limit) |
| REQ-021 | §3.2-3.3 + §7 + §10.1 (BOLA/BOPLA/BFLA wire matrix) |
| REQ-030 | §3.1-3.2 SDL + `$all` |
| REQ-031 | §3.5-3.6 (cache policy, codegen pair, SDL pin, documents pin) |
| REQ-040 | §6.1-6.5 (routes/nav/matrix/audience/permission mapping; explicit NO bottom-nav) |
| REQ-041 | §8 (one key triple, parity + RTL) |
| REQ-050 | §10 runner discipline |
| REQ-051 | §5.4 + §10 journey row (J1 test-first) |
| REQ-060 | §10 per-file gates + D6 Parent-cell coverage (stale-arg reconciliation landed out-of-band 2026-09-17) |
| REQ-061 | §11 |

---

## 12. Design Review Checklist (author self-certification)

- [x] **Overview + decisions** — §1 with D1..D6 each anchored to a ruling (R-A..R-K) and research-00 §10; no ruling re-opened.
- [x] **Data Models** — §2: frozen `ParentSessionTargetReturnType`, the 8-field wire row (`relatedEntityId: number | null`, `graphql.ts:960`), NO DB changes with the `git diff backend/db/schema/`-empty proof obligation, consumed projections incl. the `ParentHomeworkEntryReturnType` sessionId verification flag.
- [x] **API Contracts** — §3: SDL block, existing five fields unchanged, field-level permission matrix (anonymous 401 / Student/Teacher/Admin 403 / Parent allowed, `$all` R13), document contract, Apollo cache `keyFields: false`, codegen + schema-surface pins.
- [x] **Services/Repo signatures** — §4: frozen `getSessionTarget` signature + exact 6-step flow, REUSE table (`SessionRepository.findById` `session.repository.ts:130`, `requireLinkedChild` `:176-209`, `enforcePortalRateLimit` `:119-132`), resolver + the two exact call sites, NO new repo methods.
- [x] **Concurrency assessment** — §4.4: pure read (no `SELECT FOR UPDATE`), single-snapshot tx, root-container navigation race with the owns-navigation/suppressed-auto-select mitigation, module-level state: none.
- [x] **Journey design** — §5: state machine, side-effect matrix (`session:{id}:report` idempotency, post-commit publish), cross-actor visibility, J1 step mapping.
- [x] **UX/Nav spec** — §6: routes table, sidebar unchanged + explicit bottom-nav N/A, role matrix, per-audience rendering (Student/Teacher byte-unchanged), permission mapping with `withPageAuth` + `useAuth` threading.
- [x] **Security & Tenancy mitigations** — §7: BOLA (constant oracle, existence non-disclosure), BOPLA (explicit field mapping, no spread), BFLA (`$all` + `requireActor`), rate limiting (+ TEST bypass note), R4 log discipline, privacy parity pin.
- [x] **i18n** — §8: one key triple, real accessor system, RTL.
- [x] **Error handling** — §9 denial classes table incl. the `ValidationError` vs constant-403 distinction.
- [x] **Testing strategy** — §10: tiers, layers, approved runners, journey test-first, wire matrix, resolver Parent-cell coverage (stale-arg reconciliation landed out-of-band pre-implementation).
- [x] **Knowledge propagation** — §11 `docs/parents/monitoring-portal.md` DEV1-017 section + outcome protocol.
- [x] **Anti-pattern sweep** — no `Translation.` enum (handle constants `ParentMonitoring`/`Notifications`/`Common`/`Errors` from `@/shared/locale` only); no two-arg `getTranslations`; no `@/frontend/utils/logger` (frontend logger cited as `@/frontend/lib/logger`); no raw `bun test` on journeys; no bottom-nav references (explicit N/A); no next-intl / `getBackendTranslations` / `shared/messages/`; no payload/emitter widening; no new Drizzle schema/mutations/env keys; no `trackable-tasks.md` / `implementation.md` (deliverables: `specs.md` / `plan.md` / `tasks.md` / `deferred-items.md`).
- [x] **Citation honesty** — every `path:line` originates from research-00..04 (session-verified); every non-existing symbol is labeled CREATE/MISSING; no invented paths.
