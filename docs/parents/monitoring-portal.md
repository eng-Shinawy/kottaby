# Parent Read-Only Monitoring Portal — Canonical Reference

**Domain:** Parents / Read-only monitoring of confirmed-linked children
**Specs:** `docs/specs/functional-requirements.md` (§7 Parent Supervision), `docs/specs/state-machine-invariants.md` (INV-P1, INV-P2), `docs/workflows/04-parent-supervision-handshake.md` (§4.5 monitoring scope)
**Status:** Implemented and verified

This document is the single canonical reference for the parent read-only monitoring portal: the seven GraphQL query contracts, the `requireLinkedChild` authorization gate, the constant-denial oracle posture, the read-only surface discipline, the Apollo cache policy for the portal's no-`id` value types, the prototype-aware implementation discipline, and the shipped session-completion deep-link display contract (DEV1-017). All layers (schema, repositories, services, GraphQL, frontend) MUST conform to the contracts described here. Code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

The portal consumes the *binding* half of the parent-child handshake (a `confirmed` link in `students.parent_id`). The link-request workflow that produces that grant is canonically documented in [`docs/parents/parent-link-request.md`](./parent-link-request.md); the discovery half (handshake codes) lives in [`docs/parents/handshake-code-discovery.md`](./handshake-code-discovery.md). This document owns the *consumption* half: what a parent may read, how the read is gated, and the invariants that survive mid-flight severance.

---

## Why

Two child-safety invariants rule the entire surface:

- **INV-P1** — A parent cannot monitor a student without the student's explicit confirmation of the link request. The grant lives on the student row (`students.parent_id`), never on the link-request history table.
- **INV-P2** — Parent access on the MVP portal is strictly read-only. The portal exposes zero mutations of any kind; the only parent write actions in the system are the link-request mutations (request / cancel / respond-via-student), which belong to the handshake domain, not the monitoring surface.

Every design ruling in this doc is a child-safety ruling first and a workflow ruling second. The portal's value proposition (attendance, reports, homework, progress) is reachable ONLY through a confirmed `students.parent_id` grant that is re-proven inside the same transaction snapshot as the data reads — there is no time-of-check to time-of-use window between the gate and the read.

The portal is also the *forward target* of the real-time notification engine: when a child's session completes, `SessionReportNotificationService.notifySessionReportReady` emits a `session_completion` notification to the linked parent (via the same `students.parent_id` grant). The notification's `relatedEntityType/Id` payload carries the session id; the portal's report-tab deep-link is the display contract that closes that notification loop.

---

## Pattern

### The seven read-only query contracts

The portal surface is exactly seven root `Query` fields, registered by side effect through `backend/graphql/query/parents/parent-monitoring.query.ts` (no named exports — side-effect registration via the existing `query/parents/index.ts` → `query/index.ts` → `gqlSchema.ts` chain). Every field carries the same load-bearing auth conjunction:

```typescript
const parentOnlyAuthScopes: { $all: { authenticated: true; role: UserRole[] } } = {
  $all: { authenticated: true, role: [UserRole.Parent] },
};
```

The `$all` wrapper is **load-bearing**. A plain scope map (no `$all`) combines its keys with ANY semantics in `@pothos/plugin-scope-auth`'s default strategy — ANY authenticated caller would pass through the first satisfied scope and non-parents would be granted access. The `$all` wrapper makes BOTH conditions mandatory: anonymous callers hit `UnauthorizedError` (401) via the `authenticated` scope; authenticated callers with a wrong role (admin / teacher / student) fail the `role` scope into the canonical localized `ForbiddenError` (403) mapped at `backend/graphql/pothos/builder.ts:111-121`.

The const is declared WITHOUT `as const` — Pothos's `AuthScopes` slot expects a mutable `UserRole[]` for the `role` member, and `as const` widens the literal to a `readonly [UserRole.Parent]` tuple that fails assignment (TS2322). The explicit `{ $all: { authenticated: true; role: UserRole[] } }` type annotation keeps the conjunction a single source of truth while satisfying Pothos's mutable-array expectation.

| # | Field | Args | Return type | Service delegation |
|---|---|---|---|---|
| 1 | `myLinkedChildren` | (zero-arg) | `[ParentLinkedChild!]!` | `ParentMonitoringService.listLinkedChildren(ctx.user.id, ctx.locale)` |
| 2 | `parentChildProgress` | `studentId: Int!` | `ParentChildProgress!` | `ParentMonitoringService.getChildProgress(ctx.user.id, args.studentId, ctx.locale)` |
| 3 | `parentChildSessions` | `studentId: Int!`, `page: Int`, `pageSize: Int` | `ParentAttendancePage!` | `ParentMonitoringService.listChildSessions(ctx.user.id, args.studentId, { page, pageSize }, ctx.locale)` |
| 4 | `parentChildReports` | `studentId: Int!`, `page: Int`, `pageSize: Int` | `ParentReportPage!` | `ParentMonitoringService.listChildReports(ctx.user.id, args.studentId, { page, pageSize }, ctx.locale)` |
| 5 | `parentChildHomework` | `studentId: Int!`, `page: Int`, `pageSize: Int` | `ParentHomeworkPage!` | `ParentMonitoringService.listChildHomework(ctx.user.id, args.studentId, { page, pageSize }, ctx.locale)` |
| 6 | `myChildrenUpcomingSessions` | (zero-arg) | `[ParentChildUpcomingBlock!]!` | `ParentMonitoringService.listChildrenUpcomingSessions(ctx.user.id, ctx.locale)` |
| 7 | `parentSessionTarget` | `sessionId: Int!` | `ParentSessionTarget!` | `ParentMonitoringService.getSessionTarget(ctx.user.id, args.sessionId, ctx.locale)` |

Identity arrives EXCLUSIVELY from `ctx.user.id` (the verified parent actor). The per-student `args.studentId` and the session-target read's `args.sessionId` are the only client-supplied parameters that reach the service, and both are gated inside the service before any data read (`requireLinkedChild`; the session read + linked-child gate — see the session-completion deep-link display contract section). Page args are forwarded as an explicit closed whitelist — never a spread of `args`.

Every resolver carries an identical TypeScript-narrowing branch (`if (!ctx.user)`) that is **reachable in the type system** but **unreachable in practice** (the `$all { authenticated: true }` scope throws first). The branch exists purely for TypeScript narrowing — the repo-wide no-non-null-assertion rule forbids dereferencing the nullable context directly. The thrown message is localized via `ctx.t("errorsTranslations")`, so both `en` and `ar` clients receive the localized `unauthorized` string.

### The `requireLinkedChild` gate (INV-P1 enforcement)

The authorization spine for every per-student read is a single gate, co-located with the data reads inside ONE `withTransaction`. The grant (`students.parent_id`) and the row scan share one READ COMMITTED snapshot — there is no time-of-check to time-of-use window between gate and read.

Authoritative implementation: `backend/services/parents/parent-monitoring.helpers.ts` (`requireLinkedChild`), consumed by every per-student method in `backend/services/parents/parent-monitoring.service.ts`.

```typescript
export async function requireLinkedChild(
  parentActorId: number,
  studentId: number,
  locale: string,
  tx: DBQueryExecutor | undefined
): Promise<StudentSelectType> {
  const t = getServerTranslations(locale).errorsTranslations;

  const deny = (): never => {
    logger.logDomainError("Parent portal read denied: link not in force", {
      code: "FORBIDDEN",
      entity: "students",
      entityId: studentId,
      locale,
    });
    throw new ForbiddenError(t.forbidden);
  };

  if (!Number.isSafeInteger(studentId) || studentId <= 0) {
    return deny();                    // malformed id  ≡ denial
  }

  const student = await StudentRepository.findById(studentId, tx);
  if (student?.parentId !== parentActorId) {
    return deny();                    // missing OR foreign OR never-linked  ≡ denial
  }

  const childUser = await UserRepository.findById(studentId, tx);
  if (childUser === null || childUser.isDeleted) {
    return deny();                    // severed (soft-deleted) child  ≡ denial
  }

  return student;
}
```

#### Constant-denial oracle (the five-cause table)

The gate produces a CONSTANT denial shape across every cause the spec enumerates. Every arm throws the SAME `ForbiddenError` carrying the SAME localized message (`errorsTranslations.forbidden`) and emits EXACTLY ONE `logDomainError` with the SAME bounded context bag `{ code: "FORBIDDEN", entity: "students", entityId: <studentId>, locale }`. The caller cannot distinguish the cause from the response bytes.

| # | Cause | Gate arm | ForbiddenError | logDomainError context |
|---|---|---|---|---|
| 1 | Malformed id (non-integer, ≤0) | `!Number.isSafeInteger(studentId) \|\| studentId <= 0` → `deny()` | `t.forbidden` | `{ code: "FORBIDDEN", entity: "students", entityId: <studentId>, locale }` |
| 2 | Missing id (no student row) | `student?.parentId !== parentActorId` is `undefined !== <number>` → `deny()` | `t.forbidden` | same |
| 3 | Foreign id (student exists, different parent) | `student.parentId !== parentActorId` → `deny()` | `t.forbidden` | same |
| 4 | Never-linked id (student exists, `parentId IS NULL`) | `student.parentId === null` → `null !== <number>` → `deny()` | `t.forbidden` | same |
| 5 | Severed child (link valid, `users.isDeleted = true`) | `childUser.isDeleted` → `deny()` | `t.forbidden` | same |
| (5b) | Child user row missing (`childUser === null`) | `childUser === null` → `deny()` | `t.forbidden` | same |

The `deny()` closure is the ONLY log site on the denial path. It always logs before throwing (no zero-log path) and throws immediately after logging (no multi-log path). The context bag carries the caller-supplied `studentId` only — NEVER the row's stored columns (`parentId`, `handshakeCode`, `fullName`, etc. are never logged). This is the denial-oracle posture: a pentester probing the portal cannot enumerate which student ids exist, which are linked, or which have been soft-deleted — every probe returns the same byte-identical 403 in both `en` and `ar`.

#### TOCTOU seal (gate + reads share one transaction snapshot)

Per-student service methods (`getChildProgress`, `listChildSessions`, `listChildReports`, `listChildHomework`) open ONE `withTransaction(outerTx, async tx => { ... }, { isolationLevel: "repeatable read" })` and run the gate FIRST, before any data read. On the production path (no `outerTx`) the top-level transaction runs at `REPEATABLE READ`, so the gate and every subsequent data read observe EXACTLY ONE consistent snapshot — a link severance that commits mid-flight cannot make the gate pass on one snapshot while the data reads observe another (the READ-COMMITTED TOCTOU window; no `FOR UPDATE` is needed because the surface is read-only). The `outerTx` parameter lets a caller-owned transaction (e.g., a test under `runInRollback`) join the unit as a SAVEPOINT — a SAVEPOINT inherits the OUTER transaction's isolation (PostgreSQL has no per-savepoint isolation), so caller-owned units provide whichever snapshot consistency the caller's isolation level guarantees; the production guarantee above applies to the self-opened top-level transaction.

The zero-arg `listLinkedChildren` method does NOT need a per-student gate — the list IS the parent's own scope, and the predicate `students.parent_id = $parentId AND users.is_deleted = false` enforces severance at the repo layer (`StudentRepository.listLinkedChildrenByParentId`).

### BOLA / BFLA / BOPLA posture

- **BOLA (identity from context only):** the only identity in `requireLinkedChild` is the `parentActorId` parameter (which arrives from `ctx.user.id` at the GraphQL layer — never client-supplied). The `studentId` parameter is validated against the caller's grant (`students.parentId === parentActorId`) BEFORE any data read.
- **BFLA (non-parent roles deny pre-service):** every service method starts with `await requireActor(parentActorId, UserRole.Parent, locale, outerTx, false)` — the relaxed READ path (identity + role; a SOFT-DELETED actor is rejected on every path, while the blocked/suspended arms stay governance-scoped so a governed-but-present parent's self-scoped reads stay visible). Admins, teachers, and students cannot reach the per-student transaction. The GraphQL `authScopes` conjunction is the layer-1 defense; `requireActor` is the layer-2 defense-in-depth.
- **BOPLA (output projections expose ONLY the documented fields):** the projection mappers in `parent-monitoring.helpers.ts` emit a closed set of fields per type. The `updatedAt` audit stamp present on `reports` / `home_work` rows is SILENTLY DROPPED at the mapping seam. Zero billing/fee/wallet/held-lane/confirmation-deadline/dispute/internal columns are reachable. The closed `interface` shapes in `backend/types/parents/parent-monitoring.types.ts` cannot accidentally inherit new columns when the underlying schema grows (no `extends Entity`, no `& SelectType`, no `Omit<...>` re-opening).

### Attendance derivation (no attendance table)

There is no `attendance` table in the schema (grep-verified zero code hits). Attendance history is a **derived read** over `session` rows scoped to the child: `status` (`scheduled` / `started` / `completed` / `cancelled` / `disputed`) + `startedAt` / `endedAt`. The portal surfaces this as `ParentAttendanceEntryReturnType` via the `mapSessionToAttendanceEntry` projection mapper.

A first-class attendance table is a forward product decision (NOT in scope for the MVP portal); if product later wants richer attendance metrics, it is a new schema migration + new projection, never a widening of the existing session-derived view.

### Evaluations disambiguation (the `evaluations` table is NOT child data)

The `evaluations` table is sheikh→teacher-candidate orientation (evaluatedId / evaluatorId FKs into `users`), NOT per-session child evaluation. The portal's "teacher evaluations (scores, notes)" surface is satisfied by per-session teacher evaluation OF THE CHILD, sourced from the `reports` table: `studentRatingByTeacher` (int 0-5) + `teacherNotes` (text). The `evaluations` table stays OUT of the portal — there is no `Evaluation` import in any portal code path (grep-locked in the post-implementation review).

### Progress-source ruling (skeleton tables, honest counts)

The `progress` and `lessons` tables are skeletons today (no writers, no readers). Portal progress stats are an **honest read over what exists**:

- `progressRowCount` — `COUNT(progress)` for the child via `ProgressRepository.countForStudent` (zero means "no recorded progress yet" — NEVER a fabricated percentage).
- `latestJadidPosition` / `latestMadiPosition` — derived from the newest `home_work` row's `current_*` (Jadid / new memorization) and `revision_*` (Madi / revision) columns. The position is emitted ONLY when the track carries a surah/juz reference; otherwise `null`. `surahJuz` is non-null by construction in `ParentHomeworkPositionReturnType`.

Deep curriculum-traversal statistics (per-surah completion percentages, juz-level progress maps) are deferred to a future curriculum ticket — they need a richer writer/read model than the current skeleton provides.

### Read-only posture (INV-P2)

The portal ships ZERO new GraphQL mutations on the root `Mutation` type (grep-locked in the post-implementation review; the SDL pin in `backend/graphql/test/schema-surface.test.ts` asserts no portal-named fields appear on `Mutation`). The seven service methods are pure READs: zero writes, zero notifications, zero cache invalidations. The portal UI exposes no mutation affordances — no edit buttons, no submit forms, no "request session" CTAs. Parent write actions (request/cancel link) belong to the handshake domain (`docs/parents/parent-link-request.md`), not the monitoring surface.

### Untouched participant-only surfaces

The pre-existing participant-only queries `sessionReport` and `sessionHomework` (consumed by teachers and students via `SessionReportService.getSessionReport` / `getSessionHomework` and the `resolveVisibleSessionForCaller` participant gate) are **byte-unchanged**. Parents receive indistinguishable `null` from those queries today, exactly as before. The portal's parent-scoped reads are NEW, sibling fields — never a widening of the participant-only surface. The byte-unchanged posture is `git diff`-proven in the post-implementation review.

### Apollo cache policy for no-`id` value types

The portal ships nine GraphQL types without an `id` field: three pagination wrappers (`ParentAttendancePage`, `ParentReportPage`, `ParentHomeworkPage`), three embedded value objects (`ParentHomeworkTrack`, `ParentHomeworkPosition`, `ParentChildProgress`), the session-target deep-link value pair (`ParentSessionTarget`), and the two "What's next" glance-card types (`ParentChildUpcomingBlock`, `ParentChildUpcomingSession`). All nine are registered with `keyFields: false` in `frontend/providers/apollo/apolloCache.ts`, opting each out of normalization. This prevents Apollo's "Cache data may be lost" warnings when the same shape is written through different parent objects (e.g., a `ParentHomeworkTrack` embedded in two different `ParentHomeworkEntry` rows). For the session-target pair the exemption additionally means NO cache identity: each `sessionId` variable is a distinct inline entry under the root query field, repeated resolutions never collide or merge, and a failed resolution leaves no stale value for a subsequent id. The glance-card pair is likewise inline-only: each block (with its slim `ParentChildUpcomingSession` rows) lives under the root `myChildrenUpcomingSessions` field and is replaced wholesale on refetch — the normalizable entity inside a block is the embedded `ParentLinkedChild` echo, which keeps its default `id` normalization.

The four `id`-carrying portal types (`ParentLinkedChild`, `ParentAttendanceEntry`, `ParentReportEntry`, `ParentHomeworkEntry`) are deliberately NOT registered — they keep Apollo's default `__typename` + `id` normalization so each row normalizes into its own cache identity (the load-bearing mechanism for cross-query row reuse and per-child cache isolation). Misapplying `keyFields: false` to an `id`-carrying row could, under pathological conditions, collapse two distinct rows into a single cache reference.

To keep the cache factory under the oxlint `max-lines-per-function` budget (75 executable lines), the entire `typePolicies` registry is hoisted out of `createApolloCache` into a single module-level `const apolloCacheTypePolicies: TypePolicies`. The `TypePolicies` type annotation is load-bearing — without contextual typing from the const annotation, TypeScript widens `keyFields: false` to `keyFields: boolean`, which does not satisfy Apollo's `TypePolicy` literal-typed members.

Per-child cache isolation is enforced by Apollo's automatic re-fetch on variable change — the `studentId` argument feeds the cache key path, so switching children produces a fresh fetch (no `client.cache.evict` needed; the no-`id` types have no normalized entity to evict).

### Frontend URL-is-the-state posture (no Zustand store)

The portal frontend uses **URL search params as the child-switcher state**, NOT a Zustand store. Zustand is not installed in the project (`frontend/stores/` contains only its `AGENTS.md`). The child switcher is `?student=<id>` on the portal root URL; the detail route is `app/(dashboard)/parent/children/[studentId]/`-style dynamic segments with tabbed sections (attendance / reports / homework / evaluations / progress). This keeps the URL fully shareable and bookmarkable — a parent can deep-link a specific child's report tab directly.

### Canonical error dispatcher pattern (frontend)

Portal views consume the shared GraphQL error dispatcher pattern (`mapGraphQLErrorByCode` in `frontend/providers/apollo/error-link.map.ts`, dispatched via `frontend/providers/apollo/utils/error-surface.ts`). The dispatcher:

1. Normalizes each wire error item's `extensions.code`.
2. Skips auth-recovery rows (display ownership belongs to the deduped token-refresh path).
3. Maps each remaining item through the pure code→behavior table.
4. Publishes the resulting `GraphQLErrorAction`s to a registered UI listener (toasts / `PermissionDeniedFallback`).

A `FORBIDDEN` (403) action renders `PermissionDeniedFallback` (never a toast); a `VALIDATION` action carries `fieldErrors` pairs for form-bound consumers. Portal views use this dispatcher for ALL error rendering — there is no try/catch in the resolver layer (masking belongs at the boundary, never in resolvers).

### Shared-predicate builder for list/count repo pairs (no drift)

Paged portal reads (`listChildReports` / `listChildHomework`) call a `listForStudent` + `countForStudent` repo pair. Each pair shares ONE module-scope JOIN-condition builder (`buildParentScopedReportJoinCondition` / `buildParentScopedHomeWorkJoinCondition`) that folds the relationship predicate (`reports.session_id = session.id`) and the tenancy predicate (`session.student_id = $studentId`) into a single ON clause. Because both foreign keys are NOT NULL with `ON DELETE CASCADE` and carry UNIQUE constraints, the INNER JOIN cannot fan out — one report/homework row matches exactly one session row — so the count over the JOIN equals the count over the bare table scoped by the same tenancy predicate. The paged window and the honest total describe the same filtered set; the count cannot drift from the list.

### Prototype-aware implementation discipline

When a `prototype/` directory exists for a feature, the implementation MUST inspect the prototype screenshots sequentially (1-2 at a time, never batch-loaded — vision-payload timeouts) to extract layout/flow parity. Translation rules:

- **Translate, never transplant**: prototype Tailwind hex colors and class names MUST be re-expressed via the project's MUI v9 theme (`sx` prop, theme palette, `on<Color>` siblings). NEVER copy a hex code or a Tailwind class verbatim.
- **Fake data prohibition**: every row / name / amount in a prototype is invented. Hardcoding ANY of it into a component, store, or "temporary" fixture is a critical defect. Wire real data flows (GraphQL → hook → resolver → service → repository) from the start, OR use approved loading / empty / error scaffolding states only.
- **Prototypes are not spec**: the prototype visualizes the spec; it does not extend it. New fields / buttons seen only in a prototype are NOT requirements — check `specs.md` and the canonical docs first.

---

## Rules

1. **R1 — Authorization grant is `students.parent_id` ONLY.** Portal authorization reads ONLY the student row's `parentId` FK. NEVER query the `parent_link_requests` history table for read authorization — the link table is history, the student row is the grant. Scan lock: post-implementation review grep-locks zero `parent_link_requests` / `ParentLinkRequestRepository` imports in portal code.
2. **R2 — Every per-student read funnels through `requireLinkedChild`.** The gate is the single authorization spine. It runs FIRST inside ONE `withTransaction`, BEFORE any data read, all in the same READ COMMITTED snapshot (TOCTOU seal). `listLinkedChildren` is exempt — the list IS the parent's own scope (the predicate enforces severance at the repo layer).
3. **R3 — Constant denial shape (oracle posture).** All five denial causes (malformed id, missing row, foreign id, never-linked id, severed child) produce the SAME `ForbiddenError` with the SAME localized message (`errorsTranslations.forbidden`) and emit EXACTLY ONE `logDomainError` with the SAME bounded context bag. The caller cannot distinguish the cause. The `deny()` closure is the ONLY log site — always logs before throwing, throws immediately after logging.
4. **R4 — Zero child fields in denial logs.** The log context bag is exactly `{ code: "FORBIDDEN", entity: "students", entityId: <studentId>, locale }`. The `studentId` is the caller-supplied input, not the row's stored columns. NEVER log `parentId`, `handshakeCode`, `fullName`, `email`, or any row field on a denial path.
5. **R5 — Zero mutations on the portal surface.** The portal ships ZERO new GraphQL mutation fields (INV-P2). The seven service methods are pure READs — zero writes, zero notifications, zero cache invalidations. The portal UI exposes no mutation affordances.
6. **R6 — Output projections are closed and minimal.** Every projection type is an explicit `interface` with named members in `backend/types/parents/parent-monitoring.types.ts` — no `extends Entity`, no `& SelectType`, no `Omit<...>` re-opening. The `updatedAt` audit stamp is dropped at the mapping seam. Zero billing/fee/wallet/held-lane/confirmation-deadline/dispute/internal columns are reachable. Anchor: `parent-monitoring.helpers.ts` projection mappers; `parent-monitoring.types.ts` closed shapes.
7. **R7 — No fabricated values for null fields.** Projection mappers pass nullable fields through unchanged. Null rating (`studentRatingByTeacher`) stays `null` (never `0`). Null notes (`teacherNotes`) stay `null` (never `""`). A fully-null homework track block collapses to `null` (never a zero-grade block). A partially-null block preserves per-field nullability (never fabricated).
8. **R8 — Fail-closed enum narrowing.** Raw pgEnum strings from the database are narrowed through type-guard helpers (`toSessionStatus`, `toSurahJuzRef`) that log + throw on corrupt stored values rather than passing them to the wire. NEVER trust a raw string from the DB in a typed enum slot.
9. **R9 — Attendance is derived from `session` rows.** There is no `attendance` table. Attendance history = `session` rows scoped to the child, projected via `mapSessionToAttendanceEntry` (`id`, `status`, `startedAt`, `endedAt`, `createdAt`). A first-class attendance table is a forward product decision; never widen the session-derived view ad-hoc.
10. **R10 — The `evaluations` table is NOT portal data.** Per-session teacher evaluation of the child comes from `reports` (`studentRatingByTeacher` + `teacherNotes`). The `evaluations` table (sheikh→teacher-candidate) is out of scope. Scan lock: zero `evaluations` / `Evaluation` imports in portal code.
11. **R11 — Progress is an honest read.** `progressRowCount` is `COUNT(progress)` (zero means "no recorded progress yet" — NEVER a fabricated percentage). `latestJadidPosition` / `latestMadiPosition` are derived from the newest `home_work` row, emitted ONLY when the track carries a surah/juz reference. Deep curriculum statistics are deferred.
12. **R12 — Untouched participant-only surfaces.** The pre-existing `sessionReport` / `sessionHomework` participant-only queries are byte-unchanged. Parents receive indistinguishable `null` from them today. The portal's parent-scoped reads are NEW, sibling fields — never a widening. Diff-proof recorded in the post-implementation review.
13. **R13 — The `$all` authScopes conjunction is load-bearing.** Every portal field carries `authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }`. A plain scope map (no `$all`) combines with ANY semantics and leaks access to non-parents. The `role` member is `UserRole[]` (mutable) — do NOT apply `as const`.
14. **R14 — Apollo cache policy: `keyFields: false` for no-`id` value types ONLY.** The nine no-`id` portal types (`ParentAttendancePage`, `ParentReportPage`, `ParentHomeworkPage`, `ParentHomeworkTrack`, `ParentHomeworkPosition`, `ParentChildProgress`, `ParentSessionTarget`, `ParentChildUpcomingBlock`, `ParentChildUpcomingSession`) opt out of normalization. The four `id`-carrying types (`ParentLinkedChild`, `ParentAttendanceEntry`, `ParentReportEntry`, `ParentHomeworkEntry`) keep default normalization. NEVER misapply `keyFields: false` to an `id`-carrying row.
15. **R15 — URL is the child-switcher state (no Zustand).** The portal frontend uses `?student=<id>` URL search params for child switching. Zustand is not installed. The URL is fully shareable and bookmarkable.
16. **R16 — Deep-link contract for completion notifications.** The portal's report-tab URL (`/parent/children/<studentId>?tab=reports&session=<id>`) is the forward display target for `session_completion` notifications emitted by `SessionReportNotificationService.notifySessionReportReady`. The emitter already writes `relatedEntityType` / `relatedEntityId`; the portal resolves the deep-link client-side. The full shipped contract — entry URL, two-hop resolution, denial fallback, and tab threading — is specified in the session-completion deep-link display contract section below.
17. **R17 — i18n parity (en/ar).** Every user-facing string on the portal resolves through the `parentMonitoring` translation namespace (`useAppTranslation(ParentMonitoring)` frontend, `ctx.t` / `getServerTranslations` backend). No hardcoded strings. Pluralization is implemented as `(count: number) => string` function slots; each locale owns its own plural-class branching (English 0/1/2+; Arabic 0/1/2/3-10/11+ with Arabic-Indic digit shaping via `count.toLocaleString("ar")`).
18. **R18 — Read-only repo layer.** Portal repositories (`StudentRepository.listLinkedChildrenByParentId`, `ReportRepository.listForStudent` / `countForStudent`, `HomeWorkRepository.listForStudent` / `countForStudent`, `ProgressRepository.countForStudent`) are pure data access — zero permission logic, zero writes, zero business rules. `tx` is the LAST parameter on every method. Repositories never import `parent_link_requests` or `evaluations`.

---

## Anti-patterns

- **Do NOT widen the participant-only `sessionReport` / `sessionHomework` queries.** They are byte-locked. Parents get indistinguishable `null` from them; the portal ships NEW, sibling, parent-scoped queries instead.
- **Do NOT query `parent_link_requests` for read authorization.** The link table is history. The student row's `parentId` FK is the grant. A read-time join onto `parent_link_requests` reintroduces an enumeration oracle (the link table's `status` column would leak which students are pending vs confirmed).
- **Do NOT introduce per-student gates that run outside the data-read transaction.** A gate that runs in a separate `db` call before opening `withTransaction` has a TOCTOU window: a severance that lands between the gate and the read can extend the returned payload. The gate and the reads MUST share one snapshot.
- **Do NOT vary the denial shape by cause.** A "missing row" 403 that differs from a "foreign id" 403 leaks an existence oracle. Every denial cause produces byte-identical response bytes and byte-identical log context bags.
- **Do NOT log row fields on denial paths.** Logging `student.parentId`, `student.fullName`, `student.handshakeCode`, etc. on a denial leaks the row's existence and contents to anyone with log access. The `deny()` closure logs ONLY the caller-supplied `studentId`.
- **Do NOT ship portal mutations "for convenience".** A "quick" `parentUpdateChildNote` mutation breaks INV-P2 contractually. Parent write actions belong to the handshake domain (`docs/parents/parent-link-request.md`), not the monitoring surface.
- **Do NOT apply `keyFields: false` to `id`-carrying row types.** Misapplying it to `ParentLinkedChild`, `ParentAttendanceEntry`, `ParentReportEntry`, or `ParentHomeworkEntry` breaks per-entity cache normalization and could collapse two distinct rows into a single cache reference under pathological conditions.
- **Do NOT use `as const` on the `authScopes` const.** The `role` member widens to a `readonly [UserRole.Parent]` tuple that fails Pothos's mutable `UserRole[]` slot (TS2322). Use an explicit `{ $all: { authenticated: true; role: UserRole[] } }` type annotation instead.
- **Do NOT fabricate zero values for null fields.** Coercing `studentRatingByTeacher: null` to `0` or `teacherNotes: null` to `""` misrepresents the data — a parent seeing "0 / 5" believes the teacher rated the child poorly; a parent seeing empty notes believes the teacher wrote nothing. Both are false signals. Pass nulls through unchanged.
- **Do NOT use `useLazyQuery` for portal reads.** Use stateful `useQuery` exclusively (re-keyed by the `studentId` variable for per-child cache isolation). Documents are `TypedDocumentNode`s in `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts`; hooks are imported from `@apollo/client/react`, not `@apollo/client`.
- **Do NOT add a Zustand store for the child switcher.** URL search params are the state. Zustand is not installed; a store would break URL shareability and bookmarkability.
- **Do NOT use `queryDb` raw SQL with bare column names in a JOIN.** Bare `session_id` is ambiguous when both sides of the JOIN have a `session_id` column (PostgreSQL 42702). Always qualify with the table alias (`hw.session_id`, `r.session_id`) in raw SQL SELECT lists. The Drizzle branch is explicit per-column by construction.
- **Do NOT treat the `evaluations` table as child data.** It is sheikh→teacher-candidate orientation. Per-session teacher evaluation of the child comes from `reports`.
- **Do NOT treat `progress` / `lessons` skeleton rows as a deep curriculum read model.** They are timestamps and titles today. Deep curriculum traversal is a forward product ticket.
- **Do NOT transplant prototype Tailwind/hex values into production components.** Translate to MUI v9 theme (`sx` prop, theme palette). Hardcoded colors are forbidden project-wide.
- **Do NOT hardcode prototype fake data into components, stores, or "temporary" fixtures.** Every row / name / amount in a prototype is invented. Wire real data flows from the start, or use approved loading / empty / error scaffolding only.
- **Do NOT batch-load prototype screenshots.** Reading 5-11+ prototype images in a single turn blows up prompt/vision payloads to 8MB+ and causes upstream inference timeouts or stream connection drops. Inspect sequentially, 1-2 at a time, strictly as needed for the active subtask.
- **Do NOT clear quality-gate caches.** The `quality-gate:fresh` flag clears ONLY the state file (`.quality-gate-state.json`), never the ESLint cache. Never manually delete `.eslintcache` / `.eslintcache-type-aware`.
- **Do NOT add `oxlint-disable` / `jscpd:ignore` comments.** Fix the root cause.

---

## Rollout Summary

### Files created (backend)

| File | Purpose |
|---|---|
| `backend/types/parents/parent-monitoring.types.ts` | The ten closed read projections + `ParentPageInput` shared pagination input |
| `backend/db/repo/classes/progress.repository.ts` | `ProgressRepository.countForStudent` — honest count read |
| `backend/services/parents/parent-monitoring.helpers.ts` | `requireLinkedChild` gate + pure projection mappers + pagination clamp + fail-closed enum narrowing |
| `backend/services/parents/parent-monitoring.service.ts` | `ParentMonitoringService` namespace — the five read methods |
| `backend/graphql/pothos/parents/parent-monitoring.pothos.ts` | Ten `*PothosObject` refs (declarative, structural `t.expose*` passthroughs) |
| `backend/graphql/query/parents/parent-monitoring.query.ts` | Side-effect module registering the five root query fields (zero named exports) |

### Files modified (backend)

| File | Change |
|---|---|
| `backend/types/parents/index.ts` | Added `export * from "./parent-monitoring.types";` |
| `backend/db/repo/students/student.repository.ts` | Added `listLinkedChildrenByParentId` (JOIN students ⋈ users, soft-delete severance in predicate) |
| `backend/db/repo/classes/index.ts` | Added `export * from "./progress.repository";` |
| `backend/db/repo/classes/report.repository.ts` | Added `ReportForStudentRow` + `buildParentScopedReportJoinCondition` + `listForStudent` / `countForStudent` pair |
| `backend/db/repo/classes/home-work.repository.ts` | Added `buildParentScopedHomeWorkJoinCondition` + `listForStudent` / `countForStudent` pair; standalone SQL columns qualified with `hw.` alias (ambiguous-column fix) |
| `backend/services/parents/index.ts` | Added `export * from "./parent-monitoring.service";` |
| `backend/graphql/query/parents/index.ts` | Appended `import "./parent-monitoring.query";` (side-effect barrel chain) |

### Files created (frontend)

| File | Purpose |
|---|---|
| `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts` | `TypedDocumentNode` query documents for the five portal fields (id-first on every object) |
| `frontend/views/parent/children/*` | Portal root + detail views (client components, `useQuery` re-keyed by `studentId`) |

### Files modified (frontend)

| File | Change |
|---|---|
| `frontend/providers/apollo/apolloCache.ts` | Hoisted `typePolicies` to module-level `apolloCacheTypePolicies: TypePolicies`; added `keyFields: false` for the six no-`id` portal types |
| `frontend/views/dashboard/nav/navItems.ts` | Retargeted parent nav entry to `/parent/children` (was the inconsistent `/children`) |

### i18n ceremony (eleven operations)

The `parentMonitoring` namespace (62 typed slots covering portal root, child switcher, detail header, five tabs, Jadid/Madi vocabulary, per-surface empty states, loading/error scaffolding) was added via the full compile-time-typed locale ceremony: type schema → namespace handle → en/ar impls → registry + barrel + en/ar aggregate bundles + parity test. Pluralization is function-valued (`(count: number) => string`); Arabic uses all five plural classes (0 / 1 / 2 / 3-10 / 11+) with Arabic-Indic digit shaping.

### Test layers (all GREEN)

| Layer | Runner | Result |
|---|---|---|
| Repository / DB logic | `bun run test/scripts/run-test.ts` | 93 pass (6 suites — 4 new + 2 modified sibling static-source-pin updates) |
| Service unit | `bun run test/scripts/run-test.ts` | 126 pass (constant-denial oracle, BOLA, BFLA, BOPLA, TOCTOU, pagination clamp, mapper boundary arms) |
| Cross-actor journeys (J1-J4) | `bun run test/scripts/run-test.ts` | 13 pass (teacher completes session → parent reads report; student severs link → parent loses access; admin override link → parent gains access; unlinked probe → constant 403) |
| GraphQL integration (wire) | `bun run test/scripts/run-test.ts` | 27 pass (role×op matrix, Bearer auth, `extensions.code`, en/ar localized copy) |

### Quality gate (vs Phase 0 baseline)

| Check | Baseline | Final | Status |
|---|---|---|---|
| `bun tsgo` (errors) | 0 | 0 | ✅ matches baseline |
| `bun biome:check` (warnings) | 0 | 0 | ✅ matches baseline |
| `bun run scripts/lint-service.ts` | exit 0 | exit 0 | ✅ matches baseline |
| `check:duplicates` | 0 | 0 | ✅ clean |

Zero new errors/warnings introduced. No `oxlint-disable` / `jscpd:ignore` added. No caches cleared.

### Schema parity (zero Drizzle changes)

`git diff --name-only origin/main...HEAD -- backend/db/schema/` is EMPTY. The five new SDL queries + ten new object types are pure GraphQL surface (Pothos objectRefs + query fields), backed by existing Drizzle tables and indexes. `drizzle-kit push` / `generate` NOT run.

### Forward items (named future tickets, NOT blocking)

- **Deep curriculum-traversal statistics** → future curriculum ticket (the `progress` / `lessons` skeletons need a richer writer/read model).
- **DEV1-019 E2E browser journey** → sibling milestone_4_integration_security_launch ticket (covers the parent↔child journey end-to-end in a real browser).
- **First-class attendance table** → future product ticket IF richer attendance metrics are required.
- **Rate limiting on parent child-id probing** → post-MVP security hardening (the constant-denial oracle already neutralizes enumeration; rate limiting is defense-in-depth).

---

## Session-completion deep-link display contract (DEV1-017 — shipped)

This section closes the DEV1-017 forward item (removed from the Forward items list) and extends the binding deep-link contract R16 into its shipped form: a `SessionCompletion` notification row for a linked parent resolves through the portal onto the session's report, homework, and evaluations content. The notification row stays a **link invite, not a content mirror** — the `docs/sessions/session-report-homework.md` ruling: no grade, note, or child data rides the row or any URL, and the content promise is honored only on the gated portal surfaces after resolution. Zero new routes and zero nav entries: the entry URL is the existing portal root route carrying a query parameter, and the landing is the existing detail route's reports tab.

Authoritative implementations: `frontend/lib/notification-route-resolution.ts` (entry URL), `app/(dashboard)/parent/children/page.tsx` and `frontend/views/parent/monitoring/ParentChildrenRootContainer.tsx` / `ParentChildrenRootContainer.helpers.ts` / `useSessionResolution.ts` (two-hop resolution), `backend/services/parents/parent-monitoring.service.ts` + `backend/graphql/query/parents/parent-monitoring.query.ts` (the `parentSessionTarget` read), `frontend/views/parent/monitoring/ParentChildDetailContainer.helpers.ts` + the `HomeworkTab` / `EvaluationsTab` row parts (tab threading).

### The entry URL (notification row → portal root)

`resolveNotificationRoute(relatedEntityType, notificationType, role, relatedEntityId)` routes a Parent viewer's `SessionCompletion` row through a builder cell (not a static string): the pure builder `parentSessionCompletionEntry` composes `/parent/children?session=<id>` from the single-sourced route constant `PARENT_PORTAL_ROOT_ROUTE = "/parent/children"`, where `<id>` is the row's `relatedEntityId` — the SESSION id, taken in its string form. The builder fires ONLY for a non-empty string-form id: an absent / `null` / empty id falls through to the notifications feed (`/notifications`) — the resolver NEVER fabricates a route. Unresolvable VALUES (e.g. `"0"`) DO compose the URL by design: the portal root's resolution flow owns the failure path. Both notification call sites (feed list `NotificationList.tsx`, drawer body `NotificationDrawerBody.tsx`) thread the row's id and navigate via the native `<Link>`; the realtime toast path has no navigation surface.

### The `parentSessionTarget` read (the deep-link landing read)

The portal's seventh root query field: `parentSessionTarget(sessionId: Int!): ParentSessionTarget!` (the same `parentOnlyAuthScopes` `$all` conjunction), delegating with zero business logic to `ParentMonitoringService.getSessionTarget(parentActorId, sessionId, locale, outerTx?)`. The projection is the closed two-field value pair `{ sessionId, studentId }` — the echoed session id plus the LINKED child's id, and nothing else (no `id` field, no session content: the child id can only come from the grant check). The service flow: an `isPositiveSafeInt` validation arm FIRST (generic `errorsTranslations.validation` copy — a malformed id is a SHAPE failure, not the constant denial; the wire's `Int!` guarantees integer-ness anyway) → `requireActor` parent re-check → `enforcePortalRateLimit` → ONE `repeatable read` transaction: `SessionRepository.findById` → constant localized `ForbiddenError(t.forbidden)` on miss → `requireLinkedChild(parentActorId, row.studentId, locale, tx)` inside the SAME snapshot (TOCTOU seal) → the two-field pair.

The constant-denial oracle extends to this read: nonexistent, foreign, unlinked, and severed session ids are indistinguishable — byte-identical localized 403s per locale at the service, wire, and journey tiers — with EXACTLY ONE bounded `logDomainError` per denial arm whose context bag is exactly `{ code: "FORBIDDEN", entity: "sessions", entityId: <probed sessionId>, locale }` (the session-read arm; the linked-child gate inside the same flow logs its established `"students"` bag). Zero session row fields ever enter a log.

The frontend document is `parentSessionTargetQueryDocument` (closed `sessionId studentId` selection, `$sessionId: Int!` the only variable, identity derived server-side from the authenticated caller). `ParentSessionTarget` is the seventh of the portal's nine no-`id` cache types (`keyFields: false`).

### Two-hop resolution (the session flow owns navigation while unresolved)

- **Hop 1 — shell extraction (guard-only).** The server shell `app/(dashboard)/parent/children/page.tsx` extracts the raw `?session=` value with the detail shell's `firstValueOf` pattern (first value of a possibly repeated parameter, `null` when absent) and forwards it as a plain prop. Zero data fetch, zero server redirect — resolution is client-side only.
- **Hop 2 — root resolution.** The root container (`ParentChildrenRootContainer.tsx`) consumes the pointer through `useSessionResolution`: a skip-guarded, stateful `useQuery(parentSessionTargetQueryDocument)` (skipped when no pointer is present AND when `parseSessionId` cannot produce a positive safe integer — empty / non-numeric / non-positive / beyond-safe values take the failure path without ever reaching the wire, so the pre-feature root fires zero extra network operations). On success exactly ONE `router.replace` to the canonical R16 landing `/parent/children/<studentId>?tab=reports&session=<sessionId>`, composed through the detail container's `buildDetailUrl` (the ONE URL builder — no parallel builder is minted) and written exactly once per resolved pointer (a ref ledger gates the replace, so re-renders and dev-mode double-effect invocation cannot re-fire it).

Single-writer navigation: while the pointer is pending, or has landed, the pre-existing first-child auto-select is suppressed (`autoSelectPermitted`) — an exhaustive sweep of pointer × parameter × children × ledger states proves the landing arm and the auto-select arm are never both open. On failure, navigation ownership releases to the auto-select, whose replace clears the stale `?session=` naturally; a later back-navigation to the entry URL re-arms resolution fresh.

### The constant-denial fallback (cause-blind client-side)

Every resolution failure — a FORBIDDEN denial (nonexistent / foreign / unlinked / severed session), a network error, or a malformed pointer — collapses into ONE client-side boolean: the root renders the transient localized notice `sessionTargetUnavailableNotice` (en: "This session's details are no longer available." / ar: "تفاصيل هذه الجلسة لم تعد متاحة.") as an outlined info `Alert` (`data-testid="parent-session-target-unavailable"`) between the count line and the body, then falls through to the first-child auto-select. The notice states unavailability ONLY — which cause fired is as invisible client-side as the 403 bytes are server-side; its privacy hygiene (no digits, no ids, no grade/score/notes/rating surface, en/ar parity) is pinned by the `parentMonitoring` parity belt. The failure path performs NO URL write and adds zero logging.

### One link, three content tabs (the content promise)

The landing highlight threads the session pointer to every content tab: `renderTabContent` passes the parsed `?session=` pointer to `ReportsTab`, `HomeworkTab`, and `EvaluationsTab`, and the homework and evaluations rows apply the same mechanism as the shipped report row — the shared match rule `isDeepLinkTargetRow(deepLinkSessionId, row.sessionId)` (single-sourced in `ParentChildDetailContainer.helpers.ts`; the reports row's inline rule is decision-identical), a `rowRef` anchor + `useEffect` `scrollIntoView({ behavior: "smooth", block: "center" })`, `aria-current="true"`, and the primary-border treatment. ONE link (`/parent/children/<studentId>?tab=reports&session=<id>`) therefore surfaces the report row (notes + rating), the homework row (the assignment), and the evaluations row (the rating-centric view of the same report records) — highlighted and scrolled into view on every content tab. The tab switcher's existing `buildDetailUrl(props.studentId, value, props.session)` handlers preserve `?session=` across tabs (no threading code was added there — none was needed); progress and attendance tabs are deliberately NOT threaded. A pointer naming a session absent from the child's own rows matches NOTHING: no highlight, no scroll, no error, no notice — existence non-disclosure by construction, since the rows it could match are already `requireLinkedChild`-gated reads.

### Shipped surface and verification layers

| Surface | Implementation |
|---|---|
| Entry URL | `parentSessionCompletionEntry` + `PARENT_PORTAL_ROOT_ROUTE` (`frontend/lib/notification-route-resolution.ts`); call sites `NotificationList.tsx` / `NotificationDrawerBody.tsx` |
| Landing read | `parentSessionTarget(sessionId: Int!)` → `ParentMonitoringService.getSessionTarget` → `ParentSessionTargetReturnType { sessionId, studentId }` |
| Document / cache | `parentSessionTargetQueryDocument` (`frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts`); `ParentSessionTarget: { keyFields: false }` (`frontend/providers/apollo/apolloCache.ts`) |
| Resolution flow | `useSessionResolution.ts` + `ParentChildrenRootContainer.helpers.ts` (`parseSessionId`, `resolveSessionFlow`, `autoSelectPermitted`, `landingReplaceDue`, `buildSessionLandingUrl`) |
| Denial notice | `sessionTargetUnavailableNotice` in `shared/locale/{types,en,ar}/parentMonitoring/` + the `parentMonitoring-namespace.parity.test.ts` pins |
| Tab threading | `isDeepLinkTargetRow` (`ParentChildDetailContainer.helpers.ts`); `HomeworkTab.parts.tsx` / `EvaluationsTab.parts.tsx` rows |

| Verification layer | Suite (approved runner `bun run test/scripts/run-test.ts`) |
|---|---|
| Cross-actor journey (real DB) | `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` — 6 pass / 0 fail |
| Service unit | `backend/services/parents/parent-monitoring.service.test.ts` — 88 pass / 0 fail |
| Wire matrix | `backend/graphql/test/parent-monitoring.wire.test.ts` — 38 pass / 0 fail |
| SDL surface | `backend/graphql/test/schema-surface.test.ts` — 71 pass / 0 fail |
| Route resolver | `frontend/lib/notification-route-resolution.test.ts` — 16 pass / 0 fail |
| Documents | `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.test.ts` — 18 pass / 0 fail |
| Portal-root flow | `frontend/views/parent/monitoring/ParentChildrenRootContainer.helpers.test.ts` — 19 pass / 0 fail |
| Tab highlights | `HomeworkTab.sessionHighlight.test.ts` / `EvaluationsTab.sessionHighlight.test.ts` — 12 pass / 0 fail each |
| i18n parity | `shared/locale/parentMonitoring-namespace.parity.test.ts` — 160 pass / 0 fail |

---

## Related Documents

- [`docs/parents/parent-link-request.md`](./parent-link-request.md) — the link-request workflow that produces the `confirmed` grant the portal consumes. §8 consumer contract names this portal as the read-only consumer of `students.parent_id`.
- [`docs/parents/handshake-code-discovery.md`](./handshake-code-discovery.md) — the discovery half of the handshake (code format, minimal payload, masking, `linkable` semantics).
- [`docs/workflows/04-parent-supervision-handshake.md`](../workflows/04-parent-supervision-handshake.md) — the governing workflow (§4.2 discovery, §4.3 request/confirm, §4.4 visibility, §4.5 monitoring scope).
- [`docs/specs/state-machine-invariants.md`](../specs/state-machine-invariants.md) — INV-P1 (no monitoring without explicit confirmation), INV-P2 (read-only MVP access), INV-P3 (session-completion notification).
- [`docs/specs/functional-requirements.md`](../specs/functional-requirements.md) — FR-7.3 (parent monitoring scope: attendance, reports, homework, evaluations, progress; MVP read-only).
- [`docs/sessions/session-report-homework.md`](../sessions/session-report-homework.md) — the participant-only `sessionReport` / `sessionHomework` contract (byte-unchanged by this portal) and the "link invite, not content mirror" notification-copy principle the deep-link display contract honors.
- [`docs/notifications/realtime-engine.md`](../notifications/realtime-engine.md) — the `session_completion` notification emitter (the portal's report-tab deep-link is its forward display target).
- [`docs/notifications/session-request-notifications.md`](../notifications/session-request-notifications.md) — the sibling notification surface (the portal does NOT emit notifications; it consumes them via the deep-link contract).
- [`AGENTS.md`](../../AGENTS.md) (root) — path aliases, barrel mechanics, GraphQL Document Conventions, `oxlint-disable` prohibition, parallel subagent quality-gate workflow.
- [`backend/services/AGENTS.md`](../../backend/services/AGENTS.md) — service-layer rules (domain-driven services, business-logic hub, SSR-compatible, i18n via `getServerTranslations`).
- [`backend/graphql/query/AGENTS.md`](../../backend/graphql/query/AGENTS.md) — side-effect imports only, resolver delegation, adding new queries recipe.
- [`frontend/graphql/AGENTS.md`](../../frontend/graphql/AGENTS.md) — embedded type normalization policy (the canonical rule source for the `keyFields: false` opt-outs).
