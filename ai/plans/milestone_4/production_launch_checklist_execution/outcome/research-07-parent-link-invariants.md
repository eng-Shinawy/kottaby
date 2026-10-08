# Research: PRODUCTION_READINESS.md §5.5 — Parent-Child Link Invariants (rows 5.5.1–5.5.6)
Date: 2026-10-08

## Area

All six §5.5 rows are implemented and heavily tested across five tiers (repo, service unit, chaos, GraphQL wire, cross-actor journey). The link grant is a scalar FK `students.parent_id` (`backend/db/schema/students/students.ts:32`) — one parent per student by column shape — written by exactly ONE guarded writer `StudentRepository.linkParentIfUnlinked` (`backend/db/repo/students/student.repository.ts:373-384`, `isNull(parentId)` predicate at :381), reachable only from the student-confirmation accept branch of `respondToLinkRequest` (`backend/services/parents/parent-link-request.service.ts:286-298`). The request workflow (`parent_link_requests`, `backend/db/schema/parents/parent-link-requests.ts:39-61`) is append-and-transition history with a partial unique index on live pendings (:58-60) and an application-stamped `expiresAt` (:51). Monitoring is gated by `requireLinkedChild` (`backend/services/parents/parent-monitoring.helpers.ts:180-209`) with a constant-shape 403 denial oracle; INV-P3 emission is `SessionReportNotificationService.notifySessionReportReady` (`backend/services/classes/session-report-notification.service.ts:147`). The 7-day TTL is single-sourced at `shared/constants/parent-link-request.constants.ts:17,20`. The only launch-relevant weakness: the expiry **sweep** and **reminder** are verified primitives with **zero production callers** (no cron trigger exists yet), and the monitoring-portal doc's rollout section still says "five read methods" while the code and contract table ship **seven** query fields.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 5.5.1 | INV-P1: no monitoring without student confirmation | Grant = `students.parentId` (students.ts:32); single guarded writer `linkParentIfUnlinked` (student.repository.ts:373-384); gate `requireLinkedChild` (parent-monitoring.helpers.ts:180-209, `student?.parentId !== parentActorId → deny()` at :203); static lock (a) "students.parent_id single-writer (INV-P1)" (parent-link.static-locks.test.ts:533) | VERIFIED |
| 5.5.2 | INV-P2: parent access read-only in MVP | `ParentMonitoringService` seven pure-read methods (parent-monitoring.service.ts:159-483); portal queries all `queryField` reads (parent-monitoring.query.ts:122,147,168,199,227,255,273); Mutation-root additions pin enumerates only the 3 handshake mutations (schema-surface.test.ts:772-776); Step 17 write-denial journey (parent-full-journey.journey.test.ts:919) | VERIFIED |
| 5.5.3 | INV-P3: parent notified on child session completion | `notifySessionReportReady` (session-report-notification.service.ts:147-201); fail-closed wave `reportWaveContextOf` (:72-82); type `SessionCompletion` + `relatedEntityType:"session"` + idempotency key (:117-122) | VERIFIED |
| 5.5.4 | One parent per student (B.12) | Scalar FK column (students.ts:32); guarded write collapses on second link → `ConflictError PARENT_LINK_TARGET_ALREADY_LINKED` + full rollback (parent-link-request.service.ts:286-295); requestLink already-linked conflict (service test :652); two-parent race chaos (chaos.test.ts:534,722) | VERIFIED |
| 5.5.5 | Parent links multiple children (B.13) | Non-unique `parentId` FK + `students_parent_id_idx` (students.ts:41); `listLinkedChildrenByParentId` (student.repository.ts:530); journey proves ONE parent with TWO children `[S3, S4]` (parent-monitoring.journey.test.ts:1273-1280) | VERIFIED |
| 5.5.6 | Link request expires after 7 days (B.14) | `PARENT_LINK_REQUEST_TTL_DAYS = 7` / `PARENT_LINK_REQUEST_MS` (parent-link-request.constants.ts:17,20); stamped at insert (parent-link-request.helpers.ts:157); strict `expiresAt > now` render (:427) and claim boundary (repo test :505); sweep `sweepExpiredRequests` (service.ts:424-429) — **no production caller**; reminder `sendExpiryReminders` (service.ts:479-548) — **no production caller** | PARTIAL |

Section 8 twins (same criteria, decision rows): 8.1/A.1 parents table (parents.ts:11-19), 8.2/A.2 `students.parent_id` FK (students.ts:32), 8.3/A.3 `students_handshake_code_unique` (students.ts:40), 8.22/B.12 and 8.23/B.13 and 8.24/B.14 map to the same artifacts as 5.5.4–5.5.6 above.

## Existing Coverage

| Tier | File | What it asserts |
|---|---|---|
| Repo DB | `backend/db/test/repo/parents/parent-link-request.repository.test.ts` | Pending-pair round-trip (:323-349); accept/reject claims + all zero-row arms (:389-435); strict-`>` boundary at `expiresAt` (:505); sweep idempotency + bulk-lapsed-only (:661-787); reminder claim window boundaries (:821,:911); sibling-pending expiry (:953) |
| Repo DB | `backend/db/test/repo/parents/parent.repository.test.ts` | parents role-table repository tests (file exists per `ls`) |
| Service unit | `backend/services/parents/parent-link-request.service.test.ts` | Already-linked conflict w/ zero inbox rows (:652); `sweepExpiredRequests` describe (:1263-1393); `sendExpiryReminders` describe (:1395-1564) |
| Service unit | `backend/services/parents/parent-monitoring.service.test.ts` | Constant-denial oracle uniformity across method×cause cells (:831); one-bounded-log per denial, no child fields (:864); gate runs BEFORE any data read (:1012,:1031,:1046); soft-deleted parent rejected even on relaxed read path (:1118) |
| Service unit | `backend/services/classes/session-report-notification.test.ts` | Linked ⇒ exactly 2 receipts student+parent (:248); unlinked ⇒ 1 receipt, parent inbox untouched (:317); derived-recipient invariance (:776); copy carries no grade/note content (:746) |
| Chaos | `backend/services/parents/parent-link-request.chaos.test.ts` | Duplicate-pending 23505 arbiter, raw code never leaks (:315); concurrent double-respond (:373); two-parent confirm race → ONE `parent_id` winner (:534); `linkParentIfUnlinked` single-writer race (:722); expiry races both sides (:606,:653,:692); re-request lockout after silent expiry (:801) |
| Static locks | `backend/services/parents/parent-link.static-locks.test.ts` | Lock (a) `students.parent_id` single-writer INV-P1 (:533-597); zero LIKE (:599); zero audit writes (:628); zero console (:651); single notifications writer (:667-708) |
| GraphQL wire | `backend/graphql/test/parent-monitoring.wire.test.ts` | 401 anonymous × 6 ops + constant shape (:791-888); 18-cell wrong-role FORBIDDEN matrix (:924); unlinked parent constant 403 on every per-child op (:1086-1118); foreign child zero leakage (:1130,:1165) |
| GraphQL wire | `backend/graphql/test/parent-link.wire.test.ts` | Link-request wire contract incl. `expiresAt` window arithmetic (:671) |
| SDL pin | `backend/graphql/test/schema-surface.test.ts` | Mutation-root additions freeze — only `requestParentChildLink`/`respondToParentLinkRequest`/`cancelParentLinkRequest` are parent mutations (:772-776); portal value objects pinned (:693-718) |
| Journey | `test/workflows/parents/parent-full-journey.journey.test.ts` | TTL pin `TTL_DAYS === 7` (:424) and `windowMs ≈ PARENT_LINK_REQUEST_MS` (:483,:520); +7d rows (:464,:502); confirm writes `parent_id`, sibling expired (:572); re-request on linked child collapses (:610); backdated expiry → stale confirm denied, no link (:642-652); report fan-out targets exactly {S1, P} (:724); parent reads all surfaces (:810); P2 constant denial (:873); parent write attempts all denied, rows byte-identical (:919) |
| Journey | `test/workflows/parents/student-confirmation-of-link.journey.test.ts` | TTL pin (:504); confirm leg Parent B + all siblings expired (:795); race loser collapse (:914,:995 — "exactly ONE winner link"); respond at expiry instant denies EXPIRED without writing (:1113) |
| Journey | `test/workflows/parents/parent-monitoring.journey.test.ts` | Teacher report → EXACTLY ONE parent-wave publish to P (:593); never-linked parent constant 403 (:813); severance (clear parentId) immediate 403 (:873); soft-delete severance (:942); en/ar byte-identical oracle (:1013,:1075,:1118); ONE parent P2 with TWO children `[S3, S4]` (:1273-1280) + per-child isolation (:1300) |
| Journey | `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` | Unlinked child's session fails closed — NO parent emission (:635); linked child deep-link triple (:523-526) |
| Journey | `test/workflows/parents/handshake-discovery.test.ts` | Second parent sees already-linked child as `linkable:false` with zero parent identity (:225); governance collapse to null byte-identical (:257-295) |

## Gaps

1. **Row 5.5.6 (B.14) — expiry sweep and reminder have NO production trigger** (the single real gap).
   - `sweepExpiredRequests` (`parent-link-request.service.ts:424`) and `sendExpiryReminders` (:479) are called only by their own tests — a repo-wide grep for callers returned service + tests only. The docblocks say "the future cron-stream job owns the trigger and registers this as its handler" (service.ts:31-33, :406-408).
   - Consequence A: expiry is still enforced at read/claim time (render-time `Expired` chip, strict-`>` claim deny) so INV/B.14 semantics hold — but storage rows stay `pending` forever until some interaction runs.
   - Consequence B (product-visible): the chaos pin at `parent-link-request.chaos.test.ts:801` documents that a lapsed-but-unmaterialized pending row still answers `PARENT_LINK_ALREADY_PENDING` — i.e. a parent CANNOT re-request after expiry until a sweep materializes it. Without a cron trigger, a parent whose request lapsed is locked out of re-requesting indefinitely.
   - Consequence C: parents never receive the 24h expiry reminder in production.
   - Needed: a cron-stream job (or script + scheduler entry) that invokes both primitives; the launch gate must either wire it or explicitly sign off lazy expiry.
2. **Row 5.5.2 — INV-P2 UI-affordance check is a one-time manual review, not an automated test.** The SDL freeze (schema-surface.test.ts:772-776) proves no portal mutations exist on the wire, and Step 17 (`parent-full-journey.journey.test.ts:919`) proves a parent's write attempts mutate nothing — but "no edit buttons / no submit forms in the portal UI" was a post-implementation manual grep per `docs/parents/monitoring-portal.md:147`. A UI-layer affordance scan could be added, though it is arguably below checklist intent.
3. **Row 5.5.3 — "delivery" vs emission.** All tiers verify the persisted inbox row + the engine publish receipt (journeys use an injected transport spy, e.g. `parent-monitoring.journey.test.ts:593`). Live WebSocket push to a *connected* parent is the realtime-engine domain (checklist §3.4.2, another researcher's row); no parent-specific live-WS delivery journey exists here. The persisted-notification half of 5.5.3 is fully verified; the realtime half should be cross-checked against the §3.4 evidence.
4. **Row 5.5.4 — no raw-SQL negative DB probe.** The checklist's verification style "attempt X — must fail" is satisfied by app-tier tests (chaos race :534, service conflict :652) and by the structural scalar-column argument; there is no test that literally executes `UPDATE students SET parent_id = $other WHERE parent_id IS NOT NULL` to demonstrate what a bypassed writer would do. Low value (the app tier is the only writer, statically locked), but a launch-gate DB probe could include it.
5. **No aggregation harness.** Nothing maps checklist row IDs (5.5.x) to the suites that prove them; sign-off currently requires manually knowing the suite↔row mapping (this file's tables).

## Harness Recommendations

1. **Do not re-implement** — the existing five-tier suite already proves rows 5.5.1–5.5.5 end-to-end. The launch plan's tasks for these rows should be *re-run + record* tasks, not new tests:
   - `bun run test/scripts/run-test.ts backend/services/parents/` (service unit + chaos + static locks)
   - `bun run test/scripts/run-test.ts backend/db/test/repo/parents/`
   - `bun run test/scripts/run-test.ts backend/services/classes/session-report-notification.test.ts`
   - `bun run test/scripts/run-test.ts backend/graphql/test/parent-monitoring.wire.test.ts` + `parent-link.wire.test.ts` + `schema-surface.test.ts`
   - `bun run test/scripts/run-test.ts test/workflows/parents/` (6 journey files, 6,193 lines)
2. **For row 5.5.6, the launch plan needs a decision task, then a wiring task:**
   - Option A (recommended): add a cron-stream job that calls `sweepExpiredRequests()` and `sendExpiryReminders()` on a schedule (e.g. hourly/daily), consistent with `docs/notifications/realtime-engine.md` cron contracts and the docblock's "future cron-stream job" contract. Then a journey test that backdates a request, runs the job handler, and asserts materialization + reminder.
   - Option B (fallback sign-off): accept lazy expiry — reads render `Expired` and claims deny at the boundary — and document that re-request after expiry requires a manual sweep invocation (a `scripts/` one-shot). This leaves the chaos-pinned lockout in place; not launch-safe for real parents.
3. **Checklist probe script** (`scripts/launch/` or `test/scripts/`): a small runner that executes the suites above and prints a per-row (5.5.1–5.5.6) verdict table, so sign-off §9 has machine-generated evidence. Locations consistent with repo layout: `test/scripts/` runners + a `scripts/health/`-style entry, or an entry in `test/config/` mapping rows→suites.
4. **DB probe addition (optional, rows 5.5.4/5.5.6)**: a `runInRollback` DB probe in `backend/db/test/` that (a) attempts a second-parent `linkParentIfUnlinked` on a linked student and asserts `null` collapse, (b) attempts to claim a request at `expiresAt` exactly and asserts the strict-`>` deny — both already covered at chaos/repo tiers (:722, :505); only add if the gate demands literal SQL-attempt evidence.
5. **Doc sync task**: `docs/parents/monitoring-portal.md` rollout section still says "the five read methods"/"the five root query fields" (lines 248, 250, 268) while the contract table (lines 42-51) and the code ship SEVEN fields (`myChildrenUpcomingSessions`, `parentSessionTarget` added by DEV1-017). The ticket prompt's "five SDL queries" is likewise stale. Update the rollout block to seven to avoid plan-writer confusion.

## Evidence Appendix

```typescript
// backend/db/schema/students/students.ts:31-32 — one parent per student (scalar FK) + unique handshake code
handshakeCode: varchar("handshake_code", { length: 50 }).notNull(),
parentId: integer("parent_id").references(() => users.id, { onDelete: "set null" }),
```
```typescript
// backend/db/schema/parents/parent-link-requests.ts:51,58-60 — 7d expiry column + one-live-pending arbiter
expiresAt: timestamp("expires_at").notNull(),
uniqueIndex("parent_link_requests_pending_pair_unique").on(t.parentId, t.studentId)
  .where(sql`${t.status} = 'pending'`),
```
```typescript
// backend/db/repo/students/student.repository.ts:378-382 — the ONLY production writer, guarded
const [row] = await tx.update(students).set({ parentId, updatedAt: sql`now()` })
  .where(and(eq(students.id, studentId), isNull(students.parentId))).returning();
```
```typescript
// backend/services/parents/parent-link-request.service.ts:286-294 — ghost confirmations impossible
const linked = await StudentRepository.linkParentIfUnlinked(studentActorId, claim.parentId, tx);
if (linked === null) { ... throw new ConflictError("PARENT_LINK_TARGET_ALREADY_LINKED", ...); }
```
```typescript
// backend/services/parents/parent-monitoring.helpers.ts:203-204 — INV-P1 gate (constant denial)
if (student?.parentId !== parentActorId) { return deny(); }
```
```typescript
// backend/services/classes/session-report-notification.service.ts:180-182 — INV-P3 fail-closed
const parent = wave.parent;
if (parent === null) { return [studentReceipt]; }   // unlinked ⇒ NO parent emission
```
```typescript
// shared/constants/parent-link-request.constants.ts:17,20 — B.14 single source of truth
export const PARENT_LINK_REQUEST_TTL_DAYS = 7;
export const PARENT_LINK_REQUEST_MS = PARENT_LINK_REQUEST_TTL_DAYS * 86_400_000;
```
```typescript
// test/workflows/parents/parent-monitoring.journey.test.ts:1276,1280 — B.13: one parent, two children
const children = await ParentMonitoringService.listLinkedChildren(c.parentP2.id, LOCALE_EN);
expect(children).toHaveLength(2);   // [S3, S4]
```
```typescript
// backend/services/parents/parent-link-request.service.ts:424-428 — sweep primitive (NO production caller)
export async function sweepExpiredRequests(outerTx?: DBTransaction): Promise<number> {
  return withTransaction(outerTx, async tx => {
    const now = new Date();
    return ParentLinkRequestRepository.markAllExpiredIfPending(now, tx);
  });
}
```
