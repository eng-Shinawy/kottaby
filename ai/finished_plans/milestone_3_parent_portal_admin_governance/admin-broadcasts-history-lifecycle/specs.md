# Requirements & Specification: Admin Broadcasts — History & Lifecycle (First-Class Record, Detail View, Stop/Retract)

> **Plan directory (verbatim):** `ai/plans/admin-broadcasts-history-lifecycle/`
> **Ticket:** #146 — Admin broadcasts CRUD, UI/UX (GitHub issue `kottaby/kottaby#146`)
> **Author:** Ahmed Hosny · **Date:** 2026-09-18
> **Governing sources:** issue #146 · `docs/notifications/broadcast-notifications.md` (§1, §9 constraints binding; §7 audit contract; §10 test map) · the prior send-plan exemplar `ai/finished_plans/milestone_3_parent_portal_admin_governance/broadcast-notifications-system-wide-targ/specs.md` (its REQ-021 metadata-only audit discipline and single-writer posture are inherited verbatim) · the verified research base `ai/plans/admin-broadcasts-history-lifecycle/outcome/research-01..04` · the locked scope ledger `ai/plans/admin-broadcasts-history-lifecycle/deferred-items.md` (D1–D8).

**Scope statement (C/R/U/D):**
- **C (Create → recorded):** compose/send already exists (shipped by the prior plan) and now becomes *recorded* — every send materializes a first-class `broadcasts` header row in the same transaction as emission. The compose surface itself is untouched.
- **R (Read):** history list + detail view on the EXISTING `/admin/broadcasts` route (new surfaces, no new routes).
- **U (Update):** stop/retract — deliberately narrow: one status transition (active → stopped) + retraction of notification rows. Nothing else is editable.
- **D (Delete):** NONE — hard-delete of broadcast records is deferred by policy (ledger D1); the lifecycle is one-way with no reactivate.

---

## 1. Executive Summary & Problem Statement

**Feature:** broadcasts become a first-class recorded entity. A send is no longer a fleeting fan-out — it leaves exactly one `broadcasts` header record (identity, copy, audience snapshot, status, recipientCount, sentBy, sentAt, idempotency key), every emitted `notifications` row is linked to it through the existing polymorphic related-entity pair, and the admin gains a history list, a detail view with live aggregate stats, and a one-way stop-with-retraction action. Everything ships on the existing `/admin/broadcasts` page as a History/Compose tab pair.

**Problem from user perspective:**
- **Admin:** today a broadcast is not an entity he can point at. One send = N `notifications` rows (type `system_broadcast`, `relatedEntityType`/`relatedEntityId` null) + one audit row with a null `entityId` and metadata-only details. There is no status, no history, no stop. The admin cannot answer "what did we send, to whom, when, and can we undo it?" — a mistyped announcement is unrecallable.
- **Recipient:** a stopped broadcast's row disappears from his feed and his unread count self-corrects; he has no broadcast-specific surface and needs none.
- **Non-admin / anonymous:** must observe nothing — list, detail, and stop are admin-only, triple-walled.
- **Platform integrity:** the send path's atomicity, idempotent-replay absorption, 5000 cap, engine single-writer invariant, and publish-post-commit discipline are all inherited UNCHANGED (canonical doc §9); the header record joins the existing transaction, it does not fork it.

**Out of scope (locked — ledger D1–D6, verbatim):** hard-delete of broadcast records; content editing after send; scheduling/delayed sends; live WebSocket retraction push; per-recipient delivery/read breakdown UI; un-publishing already-delivered realtime envelopes.

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### REQ-0 — Baseline & Execution Protocol

**User story:** As an executing agent, I want a recorded baseline and a disciplined execution/deployment/verification protocol, so that new issues are distinguishable from pre-existing ones and no step free-styles its tooling.

1. WHEN implementation begins THEN the executor SHALL record pre-implementation tool baselines (`tsgo`, `biome:check`, lint-service counts) in `outcome/0-baseline-outcome.md` and SHALL maintain the seeded deferred-items ledger (D1–D8; D1–D6 are permanent scope exclusions, D7–D8 resolve during execution).
2. WHEN any task starts THEN the executor SHALL read ALL files in `outcome/` first; WHEN a task completes THEN the executor SHALL write `outcome/<task-id>-outcome.md` and update the task checkboxes in `tasks.md`.
3. WHEN schema artifacts ship THEN deployment discipline SHALL be: Drizzle schema changes via `bun run db push`; custom SQL (the historical backfill) via `bun db migrate`; THEN `bun run generate:gqlSchema && bun codegen` with regenerated artifacts committed in the same changeset. The executor loads the `drizzle-*` skills at migration time (ledger D7) — never hand-edits the journal.
4. **Verification policy (binding):** NO UI component tests exist and NONE may be created — `test/ui` is E2E-only (Paymob spec). UI verification SHALL ride on journey/integration/documents-lock tests plus OPTIONAL agent-browser manual verification with screenshots under `scratch/screenshots/` and ZERO committed test files.

### REQ-0.5 — Translation & Enum Compliance

**User story:** As a developer, I want compile-time type-safe localization and correct enum imports, so that i18n and type errors surface at build time.

1. WHEN any user-facing string renders THEN it SHALL resolve through the compile-time namespace system: the `AdminBroadcasts` namespace handle for UI copy and the flat errors-namespace keys for error messages — NEVER hardcoded strings, NEVER a string-literal namespace, NEVER function-call key access. **There is NO `Translation` enum in this repo** — localization uses namespace handles + property access; any plan text implying a `Translation` enum is void.
2. WHEN any enum (`UserRole`, `NotificationType`, `AuditActionType`, `BroadcastAudienceType`, `BroadcastStatus`) is used at runtime THEN it SHALL be value-imported and referenced by member, never a raw string literal.

### REQ-1 — First-Class Broadcast Record

**User story:** As an admin, I want every send recorded as one durable broadcast entity, so that history, detail, and retraction have something to point at.

1. WHEN an admin's broadcast send is accepted THEN the system SHALL create EXACTLY ONE broadcast header record — carrying identity (id), title, body, audience snapshot (kind + companion), status, recipientCount, sentBy, sentAt, and the idempotency key — in the SAME transaction as the notification emission and the send audit row (header + rows + audit commit together or not at all).
2. WHEN notification rows are emitted for that send THEN the system SHALL link EVERY emitted row to its header through the EXISTING polymorphic related-entity pair — `relatedEntityType = "broadcast"`, `relatedEntityId = <header id>` — and SHALL record the send audit row with `entityId = <header id>` (new sends; historical rows keep null — see REQ-9).
3. IF an idempotent replay is detected (stored receipt carries no `emitClaimKey`) THEN the system SHALL return the original recipientCount WITHOUT re-emitting rows, WITHOUT re-auditing, and WITHOUT creating a second header — the header contract rides the existing replay path, it does not fork it (canonical doc §9 "never fork the claim-cache semantics").
4. WHEN the resolved recipient count exceeds the existing cap (`BROADCAST_MAX_RECIPIENTS = 5000`) THEN the send SHALL be rejected exactly as today — existing fail-closed behavior is unchanged and no header is created.
5. WHERE the `notifications` table is written THEN the single-writer invariant SHALL hold — all writes (emission AND retraction) flow through `NotificationEngine`; no new file inserts or deletes `notifications` rows directly (canonical doc §9).

### REQ-2 — History List

**User story:** As an admin, I want a paginated, filterable history of every broadcast ever sent, so that I can see what went out and act on it.

1. WHEN an admin opens `/admin/broadcasts` THEN the History tab SHALL be the DEFAULT tab and SHALL list broadcasts newest-first (`sentAt` DESC) with columns: title, audience summary, status (Active/Stopped), recipient count, sent date, sent-by — plus per-row actions: view details and stop (stop rendered only while active).
2. WHEN an admin filters THEN the system SHALL support: title search (ILIKE wildcard-escaped via the canonical `escapeLikeWildcards` sanitizer — never a raw pattern), a status filter, and an audience filter; filters compose with AND semantics.
3. WHEN pagination is requested THEN pages SHALL be 1-based with default pageSize 25, clamped to a max of 100; `totalCount` SHALL be the honest unfiltered-by-page count; an out-of-range page SHALL return empty items with the same honest `totalCount`, shaped as the house `{items, totalCount, page, pageSize}` payload with `id: ID!` first on the entry object (Apollo cache normalization).
4. WHEN the admin's broadcast list is read THEN status SHALL derive from the header record only (never re-derived from row counts) so a Stopped broadcast stays Stopped even if zero rows were retracted.

### REQ-3 — Detail View

**User story:** As an admin, I want a full detail view of one broadcast, so that I can inspect exactly what was sent and how it landed.

1. WHEN an admin opens a broadcast's detail THEN the system SHALL show: full content (title, body — verbatim, `dir="auto"`), audience snapshot, current status, send metadata (`sentAt`, `sentBy`), stop metadata (`stoppedBy`, `stoppedAt`) plus the recorded retracted note when stopped, and the recorded recipientCount.
2. WHEN detail stats render THEN the system SHALL compute LIVE aggregate delivery stats — delivered count and read count — from the CURRENT linked notification rows (delivered = rows still linked; read = linked rows with `isRead = true`), not from frozen counters, so reads and retractions are reflected in real time.
3. IF the broadcast id is unknown THEN the system SHALL reject with a localized `NotFoundError` (`broadcastNotFound`) and expose no partial state.

### REQ-4 — Stop (Retraction)

**User story:** As an admin, I want to stop an active broadcast and retract it from every recipient, so that a mistaken announcement disappears.

1. WHEN an admin stops an active broadcast THEN the system SHALL, in ONE transaction: (a) transition status active → stopped via a compare-and-set guard, (b) delete ALL notification rows linked to that header — ENGINE-MEDIATED (single-writer invariant; never a direct repo delete), (c) record EXACTLY ONE audit row, and (d) return the retracted row count.
2. WHEN the stop audit row is written THEN it SHALL use the EXISTING `AuditActionType.Suspend` member (no enum change), `entityType = "notification_broadcast"`, `entityId = <broadcast id>`, and metadata-only `details = { recipientCount, retractedCount }` — never message copy, never recipient identifiers (the prior plan's REQ-021 discipline, inherited).
3. IF the broadcast is already stopped THEN the system SHALL reject with a localized `ConflictError` (`broadcastAlreadyStopped`) with ZERO writes (no second audit row, no row deletion attempt).
4. IF the broadcast id is unknown THEN the system SHALL reject with a localized `NotFoundError` (`broadcastNotFound`) with zero state.
5. WHEN two concurrent stops race on the same active broadcast THEN the compare-and-set SHALL admit EXACTLY ONE winner; the loser SHALL observe the already-stopped state and receive the `broadcastAlreadyStopped` conflict.
6. Stop is ONE-WAY: there is no reactivate action, no resume, no un-stop (the `Reactivate` audit member exists but is deliberately unused here).

### REQ-5 — Recipient Retraction Observability

**User story:** As a recipient, I want a retracted broadcast to vanish from my feed, so that stale announcements don't linger.

1. WHEN a broadcast is stopped THEN each affected recipient's linked notification row SHALL be removed; WHEN that recipient next reads his feed THEN the broadcast SHALL no longer appear.
2. WHEN a recipient's unread count is derived THEN it SHALL come from the live row set, so retraction self-corrects the badge without any counter patching.
3. IF a realtime envelope was already delivered to a connected client THEN that envelope is NOT un-published — an accepted, documented limitation (ledger D4/D6): already-shown toasts cannot be recalled; only persisted feed rows are retracted.

### REQ-6 — Historical Backfill

**User story:** As an admin, I want pre-feature sends visible in history, so that the list is complete from day one.

1. WHEN the one-time backfill migration runs THEN it SHALL create header records for ALL pre-existing `system_broadcast` send groups that have a matching `notification_broadcast` audit row (groups without one are SKIPPED, not headered — REQ-6.2) — grouped by (title, body, exact shared transaction `createdAt`, since Postgres `now()` is transaction-start time) — with status active and TRUE recipient counts, and SHALL link those notification rows to their header via the related-entity pair.
2. WHEN a historical send has no matching audit row or no notification rows THEN the migration SHALL skip that group safely rather than invent a header.
3. WHEN audience scope and actor are recovered THEN the backfill SHALL derive them from the matching `notification_broadcast` audit row (scope/companion from `details`, actor from `actorId`, joined via the shared transaction timestamp).
4. The backfill SHALL be idempotent and guarded as a one-shot (re-entry rejected; ledger D8) — no normal runtime code path re-runs it.
5. **Accepted documented risk:** two IDENTICAL sends (same title+body) committed in the same microsecond merge into ONE header — recorded, not corrected.

### REQ-7 — Admin-Only Authorization (Triple Wall)

**User story:** As a non-admin user, I must be unable to observe or mutate broadcast history, so that the admin surface stays admin-only.

1. WHEN `/admin/broadcasts` is requested THEN the page gate SHALL deny non-admin roles via the existing `withPageAuth({ roles: [UserRole.Admin] })` redirect; anonymous users are sent to login.
2. WHEN list, detail, or stop GraphQL operations are invoked THEN the fields SHALL carry `adminOnlyAuthScopes` (the `$all` authenticated + Admin conjunction, enforced pre-resolver) AND the service SHALL re-verify the actor via `assertActorAdmin` — a triple wall: page, scope, service.
3. IF a non-admin invokes any list/detail/stop operation THEN the system SHALL return FORBIDDEN with ZERO state — no rows, no counts, no existence oracle; IF anonymous THEN UNAUTHORIZED.
4. IF any client-supplied id reaches a resolver THEN it SHALL be honored only AFTER the admin gate passes — no id is evaluated pre-gate.

### REQ-8 — Localization & Parity

**User story:** As an Arabic-or-English user, I want every new string localized with exact parity, so that the surface is fully bilingual.

1. WHEN the UI ships THEN ~35 NEW keys SHALL land in the `AdminBroadcasts` namespace (both `en` and `ar`): tab labels, history title/subtitle, filter labels, column labels, status labels (Active/Stopped), detail labels (including delivered/read counts and the retracted note), stop dialog title/body(count)/action/cancel, stop success toast(count), empty states, and pager labels.
2. WHEN the two new error codes ship THEN `broadcastNotFound` and `broadcastAlreadyStopped` SHALL land FLAT in the errors namespace (type declarations + `en` + `ar` implementation files), mirroring the existing broadcast validation keys — NOT inside `AdminBroadcasts`.
3. WHEN count-bearing strings are defined THEN they SHALL be functions in the namespace type (interpolation/plural parameters), reusing the Arabic CLDR plural-cycle discipline the compose toast already established.
4. WHEN keys are added THEN the `AdminBroadcasts` namespace parity test's mandated-key inventory SHALL be updated (the exhaustive-inventory guard forbids silent key minting) and the errors-namespace parity SHALL keep passing with both new keys present in both locales.

### REQ-9 — Stop Audit Trail

**User story:** As a platform operator, I want every stop on the audit trail, so that retractions are reviewable.

1. WHEN a stop succeeds THEN EXACTLY ONE audit row SHALL exist for it (`Suspend`, `entityType "notification_broadcast"`, `entityId = <broadcast id>`, details `{ recipientCount, retractedCount }`); denial paths write ZERO audit rows.
2. WHEN a new send is accepted THEN the send audit row SHALL now carry `entityId = <broadcast id>`; historical pre-feature send rows keep their null `entityId` — a documented mixed state, not corrected retroactively beyond REQ-6's linkage.
3. WHEN the stop mutation is registered THEN the audit-completeness catalog SHALL gain a "wired" row for it (mutation field → service entry → expected action types/entity type) in the same changeset that introduces the mutation.

---

## 3. UX/Navigation Specification

**Routes:** the EXISTING `/admin/broadcasts` ONLY — no new routes, no new nav entries. The nav item (`frontend/views/dashboard/nav/navItems.ts:167`, `/admin/broadcasts`, `CampaignOutlined`) is untouched.

**Page structure:** the Server Component page shell (gate + metadata) stays; it renders a NEW `AdminBroadcastsContainer` with MUI Tabs — **History (default)** + **Compose**. Both tab panels stay MOUNTED (hidden, not unmounted) so the compose draft and Apollo cache survive tab switches. The existing `BroadcastComposeContainer` and its 11 sibling compose files are byte-untouched, and the `adminBroadcastNotification(input): Int!` mutation keeps its signature and behavior (return value, toasts, replay absorption).

**Role-Based Access Matrix:**

| Role | Page `/admin/broadcasts` | GraphQL list/detail/stop | Observes broadcasts as recipient |
|---|---|---|---|
| Admin | Full access (list, filter, paginate, detail, stop) | Allowed (triple wall passed) | Yes |
| Teacher / Student / Parent | Page-level deny (redirect per `withPageAuth`) | FORBIDDEN, zero state | Yes — rows appear on send, vanish on stop |
| Anonymous | Login redirect | UNAUTHORIZED | No |

**Per-Audience Rendering:** a single admin audience renders the entire surface; there are no per-role layout variants. Recipients observe the feature only through their existing notifications feed.

**Permission Mapping (role gating only, no AppPermission strings — consistent with the existing page gate):** page → `withPageAuth({ roles: [UserRole.Admin] })`; GraphQL → `adminOnlyAuthScopes` + `requireAdminUser(ctx)`; service → `assertActorAdmin`. UI follows the hand-composed MUI Stack/Paper/Table idioms of the session-governance reference surface (draft→applied filters, clamped pages, in-page detail drawer) — `AppDataGrid`/`PageContainer` are not used.

---

## 4. Cross-Actor Workflow (Journey)

**Actors:** **Admin** (sends/stops/inspects) · **Recipient** (teacher/student/parent — receives) · **Non-admin authenticated user** (must be denied) · **Anonymous** (unauthenticated).

### Actor Table

| Actor | Role / membership | Can do | Cannot do |
|---|---|---|---|
| Admin A | `UserRole.Admin` + real admin row | list/filter/detail/stop; send (existing) | reactivate a stopped broadcast; delete |
| Recipient R (teacher) | `UserRole.Teacher` | observe rows appear on send, vanish on stop; unread badge self-corrects | reach any admin broadcast surface |
| Non-admin N (student/parent) | authenticated non-admin | nothing broadcast-history-scoped | list/detail/stop (FORBIDDEN, zero state) |
| Anonymous | unauthenticated | nothing | everything (UNAUTHORIZED) |

### Ordered Step List (negative steps included)

1. Admin sends → header created (status Active, recipientCount N) + N notification rows linked + ONE Create audit row (admin observes nothing broken in the existing compose flow — same mutation result, same toast).
2. Admin opens `/admin/broadcasts` → History lists the broadcast, status Active, N recipients (ADMIN observes).
3. Recipient opens notifications feed → sees the broadcast row, unread (RECIPIENT observes).
4. Admin opens detail → live delivered/read counts reflect actual reads (ADMIN observes).
5. Non-admin calls list/detail/stop via GraphQL → FORBIDDEN, zero state; anonymous → UNAUTHORIZED (denial oracle).
6. Admin stops → status Stopped, N rows deleted, ONE Suspend audit row, retracted count returned.
7. Recipient's feed → row gone; unread count self-corrects (RECIPIENT observes retraction).
8. Admin re-stops the same broadcast → ConflictError `broadcastAlreadyStopped`.
9. Admin stops an unknown id → NotFoundError `broadcastNotFound`.
10. History/detail → Stopped badge + stop metadata visible.

### Cross-Actor EARS Criteria (observer-perspective)

- WHEN admin stops a broadcast THEN each affected recipient SHALL no longer see that broadcast in his notifications feed AND his unread count SHALL self-correct.
- WHEN a non-admin requests the broadcast list, a detail, or a stop THEN the system SHALL return FORBIDDEN and expose no broadcast data.
- WHEN an anonymous caller invokes any broadcast-history operation THEN the system SHALL return UNAUTHORIZED.
- WHEN an admin completes a stop THEN the audit trail SHALL carry exactly one `Suspend` row naming the broadcast id.

**Journey mapping:** this journey maps 1:1 onto a test-first journey test at `test/workflows/notifications/broadcast-retraction.journey.test.ts` — real services + real DB, committed fixtures in `beforeAll`, `TrackedFixtures` hard-delete teardown, NO `runInRollback` (per `docs/testing/workflow-journey-tests.md` and the existing `admin-broadcast.journey.test.ts` precedent).

---

## 5. Non-Functional Requirements

- **Transactional atomicity:** header + emission + send audit commit together or not at all; stop (CAS + retraction + audit) is likewise one atomic unit — a forced failure at any point leaves zero partial state.
- **Idempotent replay preserved:** the existing replay absorption is unchanged; a replayed send returns the original count with zero new state (header included — no duplicate header).
- **Concurrency:** concurrent stops admit exactly one winner (CAS); losers deterministically receive the already-stopped conflict, never a torn state.
- **No N+1:** sent-by admin names are resolved via SQL joins (one query per page), never per-row service fetches.
- **Pagination clamps:** pageSize ≤ 100, 1-based pages, honest `totalCount`, out-of-range → empty items.
- **Single-writer invariant preserved:** ALL `notifications` writes — emission and retraction — stay engine-mediated; no new writer of the table exists anywhere.
- **Performance-neutral for existing notification reads:** the backfill only adds linkage values to existing columns plus one new index; recipient inbox queries are unchanged in shape. Live detail stats are computed by aggregate SQL over the linked rows, not per-recipient loops.

---

## 6. Constraints

- **No new dependencies** — the feature composes existing engine, audit, gate, repo, and MUI primitives only.
- **MUI v9 discipline:** `sx`-only styling with `theme.palette.*`; NO direct style props on Typography/Stack/Box/Grid; `*Outlined` icons; no hardcoded colors.
- **Stateful `useQuery` ONLY — NO `useLazyQuery`** anywhere in the new containers; documents extend the existing `frontend/graphql/sharedDocuments/notifications/broadcast.documents.ts` and its co-located lock test (`broadcast.documents.test.ts`).
- **i18n via compile-time handles** (`AdminBroadcasts` namespace + flat errors keys); no hardcoded user-facing strings; no `next-intl`.
- **GraphQL registration discipline:** new root fields register via the side-effect import pattern; SDL pin suites (`sdl-static-assertions.test.ts`, `schema-surface.test.ts`) are DESIGNED-FOR-UPDATE baselines — extended, never bypassed; codegen artifacts committed in the same changeset.
- **Commit discipline:** pathspec-scoped `git add <paths>` (never `-A`), never push — another agent's unrelated staged changes share the index.

## 7. Success Criteria

### Definition of Done

- [ ] The cross-actor journey test (`broadcast-retraction.journey.test.ts`) is green end-to-end — every step of §4 over real services + real DB.
- [ ] Repository, service, and GraphQL integration suites for list/detail/stop are green (repo tests under `runInRollback` + `expectRepoError`; integration via `testClient` against the dev server).
- [ ] SDL pins + audit-completeness catalog updated and green; committed codegen artifacts byte-identical to the built schema.
- [ ] i18n parity green: `AdminBroadcasts` mandated-key inventory updated, both new errors keys in `en`+`ar`, zero hardcoded strings.
- [ ] Docs updated: `docs/notifications/broadcast-notifications.md` EXTENDS §10 (new history/stop evidence rows) and records the stop-lifecycle contract; §9 prohibitions remain intact.
- [ ] **ZERO UI test files added** (explicit negative criterion — `test/ui` stays E2E-only/Paymob).

### Acceptance Metrics

- Concurrent-stop probe: exactly one winner, losers get `broadcastAlreadyStopped`.
- Replay probe: same-key double-submit leaves exactly one header, one row-set, one audit row.
- Denial probes: non-admin/anonymous across list/detail/stop return FORBIDDEN/UNAUTHORIZED with zero state.

---

## 8. Glossary

| Term | Definition |
|---|---|
| Broadcast | An admin-authored announcement fanned out as one `system_broadcast` notification row per resolved recipient. |
| Header record | The first-class `broadcasts` row recording one send: copy, audience snapshot, status, recipientCount, sentBy, sentAt, idempotency key. |
| Retraction | Stop's row side-effect: engine-mediated deletion of all notification rows linked to a broadcast header. |
| Idempotent replay | A duplicate submit under the same `X-Idempotency-Key` that returns the stored prior count with zero new state. |
| Ghost claim | A Redis emit claim set without committed rows behind it (rollback/cache-outage residual); replay handling must not mistake it for a completed send. |
| SDL pins | The frozen/reconciled field/enum/type inventories in the schema static-assertion suites that gate every schema change. |
| Audit-completeness catalog | `test/workflows/admin/audit-completeness.catalog.ts` — the wired map of every admin mutation to its expected audit actions. |
| Backfill | The guarded one-time migration creating headers for pre-feature sends, joined on the shared transaction timestamp. |
| Single-writer invariant | Only `NotificationEngine` writes `notifications` rows (canonical doc §9) — emission AND retraction both compose through it. |
| EARS | Easy Approach to Requirements Syntax — WHEN/IF/WHILE/WHERE … THEN … SHALL … |

---

## 9. Traceability Matrix (REQ ↔ Task)

Task IDs (T0–T19) reference `tasks.md`.

| Requirement | Task Coverage | What the tasks deliver |
|---|---|---|
| REQ-0 — Baseline & execution protocol | T0, T16, T17, T18, T19 | Baseline capture, ledger maintenance, deployment/codegen discipline, final gates, knowledge propagation |
| REQ-1 — First-class broadcast record | T1, T2, T3, T5, T7 | Header record creation in the send transaction, row linkage, audit-row id, replay absorption, repo/service tests |
| REQ-2 — History list | T5, T7, T8, T9, T11, T12 | List service + pagination/filters, GraphQL query + SDL pins, History tab UI, list integration + document lock tests |
| REQ-3 — Detail view | T5, T6, T7, T8, T9, T11, T13 | Detail service + live stats, detail query, detail drawer UI, NotFound contract, detail tests |
| REQ-4 — Stop (retraction) | T5, T6, T7, T8, T9, T11, T13 | Stop service (CAS + engine-mediated delete + audit), stop mutation, stop dialog/toast UI, conflict/not-found tests |
| REQ-5 — Recipient retraction observability | T4, T6, T7 | Engine retraction path, recipient-side assertions, journey steps 3/7 |
| REQ-6 — Historical backfill | T3 | One-time guarded custom-SQL migration + linkage + idempotency guard |
| REQ-7 — Admin-only authorization | T4, T7, T8, T15 | Triple wall wiring (gate/scope/service), denial tests, security tier |
| REQ-8 — Localization & parity | T10, T14 | ~35 `AdminBroadcasts` keys + 2 flat errors keys (en/ar), parity-test inventory updates |
| REQ-9 — Stop audit trail | T4, T7, T9 | Suspend audit row, send-audit id, audit-completeness catalog row |

---

**End of Specification.** Governing next step: Phase 1.5 — `@plan-review` on the complete plan (`specs.md` + `plan.md` + `tasks.md`) before any implementation begins.
