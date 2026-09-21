# Research: GraphQL Layer (Pothos) — Admin Academic Tracking

Scope: map `backend/graphql/` (Pothos queries, registration barrels, authScopes, pagination, SDL/codegen) and verify which admin academic-tracking surfaces already exist vs. are missing. All citations personally verified this session via Grep/Read/`git log`.

## (a) Pothos structure map

### `backend/graphql/pothos/` — object/input/enum definitions

| Dir | Files | Relevant to this ticket |
|---|---|---|
| `pothos/admin/` | `admin-finance.pothos.ts`, `admin-students.pothos.ts`, `admin-teacher-applicants.pothos.ts`, `admin-teachers.pothos.ts`, `admin-user.pothos.ts`, `audit-trail.pothos.ts`, `platform-analytics.pothos.ts`, `index.ts`, `shared/adminDirectoryFieldHelpers.ts` | admin directory/analytics precedents — directory pages + export envelopes |
| `pothos/parents/` | `parent-link-request.pothos.ts`, `parent-monitoring.pothos.ts` (NO `index.ts` barrel here — parents objects ride their query modules transitively) | parent progress/homework objects (Jadid/Madi positions) |
| `pothos/classes/` | `admin-session-governance-input.pothos.ts`, `create-session-input.pothos.ts`, `home-work.pothos.ts`, `lesson.pothos.ts`, `recitation.pothos.ts`, `report.pothos.ts`, `session-arbitration.pothos.ts`, `session-filter-input.pothos.ts`, `session.pothos.ts`, `session-report-input.pothos.ts`, `index.ts` | **homework + session-report types live here** |
| `pothos/shared/` | `disputeCaseFieldHelpers.ts`, `enum.pothos.ts`, `health.pothos.ts`, `scalar.pothos.ts`, `userFieldHelpers.ts` | enum/scalar registry (SurahJuzRef registered here) |
| others | `auth/ billing/ notifications/ students/ teachers/ users/` | not directly relevant |

### `backend/graphql/query/` — root query fields (side-effect registration)

| Dir | Files (all verified by `ls`) | Relevant to ticket |
|---|---|---|
| `query/admin/` | `admin-finance.query.ts`, `admin-students.query.ts`, `admin-teacher-applicants.query.ts`, `admin-teachers.query.ts`, `admin-users.query.ts`, `audit-trail.query.ts`, `platform-analytics.query.ts`, `index.ts`, `shared/adminDirectoryPagination.helpers.ts` | admin query precedents |
| `query/parents/` | `parent-link.query.ts`, `parent-monitoring.query.ts`, `index.ts` | `myLinkedChildren`, `parentChildProgress`, `parentChildSessions`, `parentChildReports`, `parentChildHomework`, `myChildrenUpcomingSessions` |
| `query/classes/` | `admin-session-governance.query.ts`, `lesson.query.ts`, `recitation.query.ts`, `session-arbitration.query.ts`, `session-lifecycle.query.ts`, `session-report.query.ts`, `index.ts` | `sessionReport`, `sessionHomework`, `studentHomeworkHistory` |
| `query/students/` | `handshake-code.query.ts`, `homework.query.ts` (added 2026-09-21), `index.ts` | `myHomework` (student-scoped paged Jadid/Madi history) |

### `backend/graphql/mutation/classes/session-report.mutation.ts` — blocking feature VERIFIED IMPLEMENTED

The blocker "Session Report Submission with Homework (Jadid & Madi)" exists:
- `gqlSchemaBuilder.mutationField("submitSessionReport", …)` at `backend/graphql/mutation/classes/session-report.mutation.ts:65`
- Homework composites wired via `jadid: wireBlockToInput(homework.jadid)` / `madi: wireBlockToInput(homework.madi)` at `backend/graphql/mutation/classes/session-report.mutation.ts:109-110`
- Delegates to `SessionReportService.submitSessionReport(ctx.user.id, sessionId, input, ctx.locale)` at `backend/graphql/mutation/classes/session-report.mutation.ts:120`; imports `HomeWorkBlockInput, SessionReportSubmitInput` from `@/backend/types` at line 52.

### Homework domain types (backend of the ticket)

- `backend/db/schema/classes/home-work.ts:23` — `export const homeWork = pgTable(`; columns `id` (line 26), `sessionId` (27), `currentFromAyah/currentToAyah/currentGrade/currentSurahJuz` (30-33), `revisionFromAyah/revisionToAyah/revisionGrade/revisionSurahJuz` (34-37); grades CHECKed to `[0,100]` (lines 46-47).
- Pothos object: `SessionHomeWorkPothosObject` at `backend/graphql/pothos/classes/home-work.pothos.ts:137` — `gqlSchemaBuilder.objectRef<HomeWorkReturnType>("SessionHomeWork").implement({...})`; Jadid fields exposed as `currentFromAyah: t.exposeInt(..., { nullable: true })` etc. (lines 144-148), `currentSurahJuz` mapped via `SurahJuzRefPothosEnum` (lines 150-157); `revision_*` mirror (159+).
- `StudentHomeworkPage` object ref at `backend/graphql/pothos/classes/home-work.pothos.ts:191-192`.
- Surah/Juz enum (Decision ref B.11): `backend/enum/shared/surah-juz-ref.enum.ts:8` — `export enum SurahJuzRef` with 36 members: `SurahAlFatihah = "surah_al_fatihah"` … `SurahAlMaidah = "surah_al_maidah"` (5 surahs) then `Juz1 = "juz_1"` … `Juz30 = "juz_30"`; plus `isSurahJuzRef` type guard. Registered ONCE as `SurahJuzRefPothosEnum` in `pothos/shared/enum.pothos.ts` (imported at `home-work.pothos.ts:32`).

## (b) Concrete query precedents

### Admin query #1: `adminStudents` (paginated directory)

File: `backend/graphql/query/admin/admin-students.query.ts`

| Aspect | Verified detail (file:line) |
|---|---|
| Field registration | `gqlSchemaBuilder.queryField("adminStudents", t => t.field({` at `admin-students.query.ts:59` |
| Return type | `type: AdminStudentPagePothosObject` at :61 (object ref `AdminStudentPage` at `backend/graphql/pothos/admin/admin-students.pothos.ts:71`, `.objectRef<AdminStudentPageReturnType>("AdminStudentPage")`) |
| Args | `filters: t.arg({ type: AdminStudentFiltersInput, required: false })` at :63 plus `...adminDirectoryPaginationArgs(t)` at :64 |
| authScopes | `authScopes: adminOnlyAuthScopes,` at :66 — defined in `backend/graphql/shared/admin-prelude.ts:24-29` as:
```typescript
export const adminOnlyAuthScopes = {
  $all: {
    authenticated: true,
    role: [UserRole.Admin],
  },
};
```
| Resolver belt | `const user = await requireAdminUser(ctx);` at :68 (`admin-prelude.ts:31`; throws `new UnauthorizedError(tErrors.unauthorized)` via `await ctx.t("errorsTranslations")` at admin-prelude.ts:33-34 — TS narrowing only) |
| Pagination guard | `const { page, pageSize } = resolveAdminDirectoryPageBounds(args.page, args.pageSize);` at :69 |
| Service call | `return AdminStudentDirectoryService.list(` at :70 — signature `backend/services/admin/student-directory.service.ts:96`: `export async function list(filters: AdminStudentFiltersSubmitInput, page: number, pageSize: number | undefined, locale: string, …)`; called with `(…, ctx.locale, user.id)`. Filter args copied FIELD-BY-FIELD (no `{ ...input }` spread) — `search/hasParent/language` at :71-73 |
| Export sibling | `adminStudentsExport` at :86, `type: AdminStudentExportEnvelopePothosObject` :88, no pagination args, delegates to `AdminStudentDirectoryService.exportAll(...)` at :95 |

401/403 semantics (file header, `admin-students.query.ts:12-15`): anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN` (403), both BEFORE the resolver runs. A plain `{ authenticated, role }` key-map is WRONG — Pothos combines with ANY semantics; `$all` makes the conjunction explicit.

### Admin query #2: `adminPlatformAnalytics` (zero-arg analytics snapshot)

File: `backend/graphql/query/admin/platform-analytics.query.ts`

| Aspect | Verified detail (file:line) |
|---|---|
| Registration | `gqlSchemaBuilder.queryField("adminPlatformAnalytics", t =>` at `platform-analytics.query.ts:48` |
| Return type | `type: PlatformAnalyticsPothosObject` at :49 (from `@/backend/graphql/pothos/admin`) |
| Args | NONE — "Zero arguments — the read scope is the closed contract" (description, :55) |
| authScopes (inline form) | :53-58:
```typescript
authScopes: {
  $all: {
    authenticated: true,
    role: [UserRole.Admin],
  },
},
```
| Resolver belt | `if (!ctx.user) { const tErrors = await ctx.t("errorsTranslations"); throw new UnauthorizedError(tErrors.unauthorized); }` at :59-66 |
| Service call | `return PlatformAnalyticsService.getPlatformAnalytics(ctx.user.id, ctx.locale);` at :67 — signature `backend/services/admin/platform-analytics.service.ts:129`: `export async function getPlatformAnalytics(actorId: number, locale: string, outerTx?: DBTransaction): Promise<PlatformAnalyticsReturnType>` |
| No DataLoader | comment at `backend/graphql/pothos/admin/platform-analytics.pothos.ts:34`: snapshot arrays use "no `t.loadable` — the parent is a single resolved" object (per-parent batching not needed for single-root analytics) |

### Parent-monitoring query: `parentChildProgress` (gated per-student drill-down)

File: `backend/graphql/query/parents/parent-monitoring.query.ts` (291 lines)

| Aspect | Verified detail (file:line) |
|---|---|
| authScopes object | local `parentOnlyAuthScopes` at :114-120:
```typescript
const parentOnlyAuthScopes: { $all: { authenticated: true; role: UserRole[] } } = {
  $all: {
    authenticated: true,
    role: [UserRole.Parent],
  },
};
```
(declared without `as const` deliberately — see comment :106-113) |
| Registration | `gqlSchemaBuilder.queryField("parentChildProgress", t => t.field({` at :147 |
| Return type | `type: ParentChildProgressPothosObject` at :149 — object at `backend/graphql/pothos/parents/parent-monitoring.pothos.ts:314-315` (`.objectRef<ParentChildProgressReturnType>("ParentChildProgress")`); fields: `child: ParentLinkedChild!`, `progressRowCount: Int!` (honest count over `progress` table, never a fabricated percentage, :324-331), `latestJadidPosition`/`latestMadiPosition: nullable ParentHomeworkPosition` (surahJuz enum + from/to ayah, :332-340) |
| Args | `studentId: t.arg.int({ required: true })` at :150-152 |
| Resolver belt | `if (!ctx.user) { const tErrors = await ctx.t("errorsTranslations"); throw new UnauthorizedError(tErrors.unauthorized); }` at :157-160 |
| Service call | `return ParentMonitoringService.getChildProgress(ctx.user.id, args.studentId, ctx.locale);` at :162 — signature `backend/services/parents/parent-monitoring.service.ts:210`: `export async function getChildProgress(parentActorId: number, studentId: number, locale: string, outerTx?: DBTransaction): Promise<ParentChildProgressReturnType>` |
| Link gate | the requireLinkedChild grant is verified inside the service transaction; "a missing, foreign, never-linked, severed, or malformed student id collapses to the same constant denial" (field description, :152-154) |
| Siblings in same file | `myLinkedChildren` :122, `parentChildSessions` :168, `parentChildReports` :199, `parentChildHomework` :227, `myChildrenUpcomingSessions` :255 |

## (c) How new query files get registered (side-effect barrels)

Chain: `backend/graphql/gqlSchema.ts:20` → `import "@/backend/graphql/query";` → `backend/graphql/query/index.ts:33-42` (side-effect imports per sub-domain: `import "./admin";` at line 42) → sub-domain barrel `backend/graphql/query/admin/index.ts:12-18` (one `import "./x.query";` per file) → each `*.query.ts` registers root fields via `gqlSchemaBuilder.queryField(...)` at import time with NO named exports.

Definition-order barrel: `backend/graphql/gqlSchema.definitions.ts:13-17` — imports in order: `@/backend/graphql/pothos` (object barrel) → `pothos/shared/scalar.pothos` → `pothos/shared/enum.pothos` → mutation barrel → query barrel. `gqlSchema.ts:22` then calls `gqlSchemaBuilder.toSchema()`.

Pothos object barrels to touch for new objects: `backend/graphql/pothos/admin/index.ts` has `export * from "./<file>.pothos";` per type file (lines 8-14). The classes barrel `backend/graphql/pothos/classes/index.ts` re-exports `home-work.pothos`, `lesson.pothos`, `report.pothos`, `session-report-input.pothos` (lines 22-25). NOTE: `pothos/parents/` has NO `index.ts` — its objects are registered transitively via the query module imports (documented in `backend/graphql/query/parents/index.ts` header).

### Recent-addition evidence (commit `16b1b7f9`, 2026-09-21, PR #207 — added `myHomework`)

`git show --stat 16b1b7f9 -- backend/graphql frontend/graphql` shows exactly the files a new query touches:
1. NEW: `backend/graphql/query/students/homework.query.ts` (+83 lines) — registers `gqlSchemaBuilder.queryField("myHomework", t => t.field({` at `homework.query.ts:54`, `type: ParentHomeworkPagePothosObject` :55, args `page`/`pageSize` with SDL defaults (`t.arg.int({ required: false, defaultValue: 1 })`, :57-60), `authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }` :65-70, delegates to `StudentHomeworkService.listMyHomework(ctx.user.id, { page, pageSize })` :77.
2. Barrel line added: `backend/graphql/query/students/index.ts:19` — `import "./homework.query";`.
3. Object extensions: `pothos/parents/parent-monitoring.pothos.ts` (+93) and `query/parents/parent-monitoring.query.ts` (+55) — `parentChildHomework` added at `parent-monitoring.query.ts:227`, service call `ParentMonitoringService.listChildHomework(...)` at :244.
4. Test pins updated: `backend/graphql/test/schema-surface.test.ts` (+102) and `backend/graphql/test/sdl-static-assertions.test.ts` (+22) — **the SDL Query-root op set is FROZEN as an exact baseline** ("the Query root is EXACTLY the refreshed 57-op baseline", `sdl-static-assertions.test.ts:34-36`); any new query requires updating these pins in the same change.
5. Artifacts committed in the same changeset: `frontend/graphql/generated/schema.graphql` (+32) and `frontend/graphql/generated/gql/graphql.ts` (+39) — "schema/codegen artifacts must be committed in the SAME change set as their registrations" (sdl-static-assertions header, :8-10).
6. Frontend documents: `frontend/graphql/sharedDocuments/students/homework.documents.ts` (+43) + its `index.ts` line (+1), plus per-domain `.documents.test.ts` updates.

Written procedure (authoritative): `backend/graphql/query/AGENTS.md` "### Adding New Queries" (lines 44-50): (1) pick/create sub-directory, (2) create `<entity>.query.ts` registering on `gqlSchemaBuilder`, (3) add `import "./<entity>.query";` to the sub-directory's `index.ts`, (4) if new sub-directory, add `import "./<subdir>";` to `backend/graphql/query/index.ts`, (5) run `bun run generate:gqlSchema` then `bun codegen`.

## (d) SDL + codegen

- SDL artifact: `frontend/graphql/generated/schema.graphql` — written by `scripts/generator/generate-gql-schema.ts` (`OUTPUT_PATH` at line 22; lexicographically sorted via `lexicographicSortSchema` for deterministic diffs, :15-16).
- Exact scripts (`package.json:69-70`): `"generate:gqlSchema": "bun run scripts/generator/generate-gql-schema.ts"` and `"codegen": "graphql-codegen --config codegen.ts"`.
- `codegen.ts`: schema source `./frontend/graphql/generated/schema.graphql` (line 33), documents globs `./frontend/graphql/sharedDocuments/**/*.ts` + `./frontend/views/**/*.documents.ts` (line 34), output `./frontend/graphql/generated/gql/graphql.ts` with plugins `typescript-operations`, `typed-document-node` (lines 37-45); `DateTime` scalar maps to `string` (line 24).
- Run order after any Pothos change (per `backend/graphql/gqlSchema.ts:14-16`): `bun run generate:gqlSchema` then `bun codegen`.

## (e) Pagination conventions & DataLoader status

### Pagination (offset-based, NO Relay connections)

| Pattern | Evidence |
|---|---|
| Root args | `adminDirectoryPaginationArgs(t)` — `page: t.arg({ type: "Int", required: false })` + `pageSize` — `backend/graphql/query/admin/shared/adminDirectoryPagination.helpers.ts:52-56` |
| Bounds guard | `resolveAdminDirectoryPageBounds(page, pageSize)` at `adminDirectoryPagination.helpers.ts:62-78`: defaults `page ?? 1`, `pageSize ?? 25`; `page` must be a positive integer; `pageSize` integer in `1..100`; violations throw `ValidationError` (DomainError subclass) BEFORE any service call |
| Page envelope (admin) | `AdminStudentPage` at `pothos/admin/admin-students.pothos.ts:71-81`: `items: [AdminStudentItem]`, `total/page/pageSize/pageCount: Int!` — page wrapper is a deliberate embedded value object with NO `id` (comment :19-21); out-of-range page → empty `items` + honest `total` (:66-67) |
| Export envelope | `AdminStudentExportEnvelope` at `admin-students.pothos.ts:96-104`: `rows: [AdminStudentItem]`, `total: Int!`, `truncated: Boolean!` (`true` exactly when `total > rows.length`; 1000-row cap lives in the service) |
| Page envelope (parents/students) | `ParentAttendancePage` at `pothos/parents/parent-monitoring.pothos.ts:125-134`: `items`, `totalCount: Int!`, `page: Int!`, `pageSize: Int!` (parents use `totalCount`, admin uses `total`+`pageCount`) |
| SDL-default variant | `myHomework` uses `t.arg.int({ required: false, defaultValue: 1 })` / `defaultValue: 25` — `query/students/homework.query.ts:57-60` (defaults in SDL, service re-normalizes) |

No cursor/Relay connection types exist anywhere in the query layer (all listings are page/pageSize envelopes — verified across admin/parents/students query files above).

### DataLoader — mandated by rule, ZERO live examples

`backend/graphql/pothos/AGENTS.md:20-26` ("DataLoader Batching (CRITICAL)") requires `t.loadable()` / `loadableObject(Ref)` for any per-parent-object service/repo call, notes `t.loadable()` does not support list returns, and requires batch methods returning `Map<string, T | null>`. HOWEVER, repo-wide grep for `t.loadable|loadableObject|new DataLoader` across `backend/` returns only two comment mentions (`query/health.query.ts:11`, `query/notifications/notification.query.ts:26` — both saying the field needs NO DataLoader) and one comment in `pothos/admin/platform-analytics.pothos.ts:34` ("no `t.loadable`"). **There is no live DataLoader example in the GraphQL layer today**; every current admin/parent query resolves the whole payload in ONE service call, so per-parent batching never arises. New admin academic queries that expose per-row computed fields would be the first real consumers of the mandated pattern.

## (f) Mandatory rules (backend/graphql/AGENTS.md + pothos/AGENTS.md) — as they bear on this ticket

- **No local type defs**: types come from `@/backend/types` (`{Entity}ReturnType`, `{Entity}SubmitInput`) as Pothos `objectRef<...>` backing; single canonical object type per entity (`backend/graphql/AGENTS.md:69-88` pattern block).
- **Inputs**: prefer `inputType(string-named)` over `inputRef<BackendType>` (`backend/graphql/AGENTS.md:82-84`).
- **authScopes kinds**: `authenticated` / `role` / `permission` / `superAdmin` / `notImpersonating`; fail-closed (`backend/graphql/AGENTS.md:10`). Admin role gating must be the EXPLICIT conjunction `$all: { authenticated: true, role: [UserRole.Admin] }` — a plain key-map is ANY-semantics and WRONG (`backend/graphql/AGENTS.md:17`). Shared prelude: `adminOnlyAuthScopes` + `requireAdminUser` in `backend/graphql/shared/admin-prelude.ts:24-37`.
- **`permission` vs `superAdmin`**: use `authScopes: { permission: AppPermission.X }` for non-superadmin-authorized mutations; `superAdmin: true` blocks ALL non-superadmins (`backend/graphql/AGENTS.md:91-92`). Current admin read queries use the `role: [UserRole.Admin]` scope, not permission strings.
- **Resolvers are thin**: delegate to `backend/services/`; no business logic in Pothos files, no direct repo calls (`backend/graphql/AGENTS.md:12`); resolvers throw nothing directly — service `DomainError` subclasses propagate `extensions.code` and are masked ONLY at the boundary by `finalizeGraphqlErrors` (`backend/graphql/AGENTS.md:104-108`).
- **Localized errors**: `ctx.t("errorsTranslations")` (bound to `ctx.locale`; binding at `gqlContextFactory.ts:46` and `:236`); e.g. `tErrors.unauthorized` thrown as `UnauthorizedError` (admin-prelude.ts:33-34). Service calls receive `ctx.locale` for service-tier localized DomainErrors.
- **Enums**: real TS enums from `backend/enum/`, registered ONCE in `pothos/shared/enum.pothos.ts` via `gqlSchemaBuilder.enumType(MyEnum, { name: "MyEnum" })`; hardcoding value literals in `*.pothos.ts` is PROHIBITED (`backend/graphql/AGENTS.md:19-58`, `pothos/AGENTS.md:9-18`).
- **`id` first** on every entity-shaped object for Apollo normalization (`t.exposeID("id")`, e.g. `home-work.pothos.ts:143`, `parent-monitoring.pothos.ts:79`); page wrappers/embedded values carry no id.
- **Admin-mutation census**: every new admin-gated MUTATION must add a `wired` row to `test/workflows/admin/audit-completeness.catalog.ts` (reads emit NO audit rows; `backend/graphql/AGENTS.md:88-90`). This ticket is query-only unless drill-down mutations are added.
- **Nullability**: Pothos fields non-null by default; align TS types (`backend/graphql/AGENTS.md:11`).

## Frontend document conventions (context for consuming the new queries)

- Existing admin documents live in `frontend/graphql/sharedDocuments/admin/` (all listed): `admin-finance`, `admin-session-governance`, `admin-students`, `admin-subscriptions`, `admin-teacher-applicants`, `admin-teachers`, `admin-users`, `audit-trail`, `platform-analytics`, `teacher-certification` — each `.documents.ts` has a sibling `.documents.test.ts` and all are re-exported via that dir's `index.ts`.
- Per root AGENTS.md: documents live in `frontend/graphql/sharedDocuments/<domain>/<entity>.documents.ts`, named `{entityName}QueryDocument`, always include `id` on object types, no `useLazyQuery`, hooks imported from `@apollo/client/react`.
- Per-domain contract tests exist: `frontend/graphql/sharedDocuments/documents.contract.test.ts` (repo-wide) — new document sets follow the same pattern (e.g. `students/homework.documents.ts` added with `index.ts` line in commit 16b1b7f9).

## GAPS (verified NOT to exist)

Verified by: full `ls` of `backend/graphql/query/admin/`, `query/students/`, `query/classes/`, `query/parents/` (files enumerated above); grep for `adminAcademic|academicProgress|memorizationProgress|needsAttention|atRisk|lowGrade|slowProgress|studentAcademic` across `backend/` and `frontend/graphql/sharedDocuments/` (only hits are the session-dispute `needsAttention` badge in `backend/db/repo/classes/session.repository.ts:704` / `session.repository.helpers.ts:342` — a session-deadline flag, NOT academic); grep for `memoriz|Memoriz` across `backend/graphql/` and `backend/services/` (no file-name/module hits).

Missing admin academic-tracking GraphQL surfaces — NONE of these exist today:

1. **Admin memorization/revision milestone overview** — no query aggregates per-student Jadid (new memorization) or Madi (revision) homework positions across students. No `admin*` query touches `home_work` data at all (the only homework reads are student-scoped `myHomework` and participant-gated `sessionHomework`).
2. **Admin homework grades view** — no admin query for per-student/per-session homework grades (currentGrade/revisionGrade). `studentHomeworkHistory` (`backend/graphql/query/classes/session-report.query.ts:125+`) is teacher-scoped cross-teacher history, not an admin surface.
3. **Surah/Juz progress per student (admin)** — Surah/Juz progression is only exposed to parents (`parentChildProgress.latestJadidPosition/latestMadiPosition`, `pothos/parents/parent-monitoring.pothos.ts:314+`) and the student himself (`myHomework`); no admin equivalent.
4. **Overall academic advancement analytics** — `adminPlatformAnalytics` (`platform-analytics.query.ts:48`) is a whole-platform business snapshot (users, sessions, revenue, subscriptions); it contains no academic/memorization metrics.
5. **Students-needing-attention view** — no admin query for low grades / slow academic progress. The existing `needsAttention` symbol is a session dispute/deadline badge only (`backend/db/repo/classes/session.repository.helpers.ts:342`).
6. **Admin per-student academic drill-down with full history** — no admin query joining homework rows + session reports + progress rows for one student. `adminUserDetail`/`adminUserActivity` (user governance) have no academic data.
7. **Admin academic services** — `backend/services/admin/` (ls above) has no academic/analytics-academic service; a new `AdminAcademic*` service + `backend/types/*` ReturnTypes + Pothos objects + queries would all be new.
8. **Admin role query-barrel wiring** — new files must be added to `backend/graphql/query/admin/index.ts` (currently 7 imports, lines 12-18) and the frozen Query-root baselines in `backend/graphql/test/schema-surface.test.ts` + `backend/graphql/test/sdl-static-assertions.test.ts` (57-op Query root freeze) must be refreshed in the same change set.

Blocked-by status: VERIFIED IMPLEMENTED (`submitSessionReport` mutation with Jadid/Madi homework, `backend/graphql/mutation/classes/session-report.mutation.ts:65-120`), so this ticket is unblocked.
