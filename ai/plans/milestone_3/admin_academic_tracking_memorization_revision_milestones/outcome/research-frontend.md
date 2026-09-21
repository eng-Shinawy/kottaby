# Research: Admin Academic Tracking — Frontend / Nav / I18N (digest)

Scope: routes under `app/(dashboard)/admin/`, sidebar nav config, `shared/locale` namespace conventions, UI primitives, admin analytics exemplar, parent-portal drill-down analogue, AGENTS.md constraints, and verified gaps for the new admin academic-tracking surface (TICKETS.md:2184–2217).

## (a) Existing dashboard route segments

`app/(dashboard)/` top-level segments (verified via `ls`): `admin/`, `audit/`, `dashboard/`, `disputes/`, `[feature]/` (catch-all "coming soon"), `homework/`, `layout.tsx`, `notifications/`, `parent/`, `profile/`, `schedule/`, `student/`, `students/`, `subscriptions/`, `teacher/`, `teachers/`, `wallet/`.

| Route | page.tsx | Purpose (one line) | Key citation |
|---|---|---|---|
| `/admin/dashboard` | `app/(dashboard)/admin/dashboard/page.tsx:9-11` | Role dashboard via `createRoleDashboardPage(UserRole.Admin, "/admin/dashboard")` (shared `DashboardView` only) | `app/(dashboard)/admin/dashboard/page.tsx:10` |
| `/admin/analytics` | `app/(dashboard)/admin/analytics/page.tsx:36-38` | Platform analytics dashboard → `PlatformAnalyticsContainer` | `app/(dashboard)/admin/analytics/page.tsx:37-38` |
| `/admin/broadcasts` | `app/(dashboard)/admin/broadcasts/page.tsx:36-38` | Broadcast history + compose tabs → `AdminBroadcastsContainer` | `app/(dashboard)/admin/broadcasts/page.tsx:37-38` |
| `/admin/finances` | `app/(dashboard)/admin/finances/page.tsx:40-42` | Payments audit + withdrawal queue + teacher wallet inspector → `AdminFinancesContainer` | `app/(dashboard)/admin/finances/page.tsx:41-42` |
| `/admin/lessons` | `app/(dashboard)/admin/lessons/page.tsx:32-34` | Curriculum lessons catalog per-plan CRUD → `LessonsCatalogContainer` | `app/(dashboard)/admin/lessons/page.tsx:33-34` |
| `/admin/plans` | `app/(dashboard)/admin/plans/page.tsx:32-34` | Subscription plan catalog CRUD → `PlanCatalogContainer` | `app/(dashboard)/admin/plans/page.tsx:33-34` |
| `/admin/session-governance` | `app/(dashboard)/admin/session-governance/page.tsx:44-46` | Filterable session directory + reschedule/cancel/reassign/join | `app/(dashboard)/admin/session-governance/page.tsx:45-46` |
| `/admin/users` | `app/(dashboard)/admin/users/page.tsx:30-32` | User directory → `AdminUsersDirectoryContainer` | `app/(dashboard)/admin/users/page.tsx:31-32` |
| `/admin/users/[id]` | `app/(dashboard)/admin/users/[id]/page.tsx:33-36` | Per-user detail → `AdminUserDetailContainer userId={Number(id)}` | `app/(dashboard)/admin/users/[id]/page.tsx:34-36` |
| `/students` (admin) | `app/(dashboard)/students/page.tsx:39-41` | Read-only admin students directory → `AdminStudentsDirectoryContainer` (the only `students/` page; no `[id]` student route exists) | `app/(dashboard)/students/page.tsx:40-41` |
| `/homework` (student) | `app/(dashboard)/homework/page.tsx:34-36` | Student's own homework history → `HomeworkContainer` (Student-role guarded) | `app/(dashboard)/homework/page.tsx:35-36` |
| `/parent/children` | `app/(dashboard)/parent/children/page.tsx` | Parent monitoring portal root → `ParentChildrenRootContainer` | `app/(dashboard)/parent/children/page.tsx:11` |
| `/parent/children/[studentId]` | `app/(dashboard)/parent/children/[studentId]/page.tsx` | Per-child drill-down → `ParentChildDetailContainer` | `app/(dashboard)/parent/children/[studentId]/page.tsx:5` |

Unshipped nav routes fall through to `app/(dashboard)/[feature]/page.tsx` catch-all → `ComingSoonView` (`frontend/views/dashboard/nav/navItems.ts:97-101`, `frontend/views/dashboard/layout/ComingSoonView.tsx`).

### Layout shell & role gating

- `app/(dashboard)/layout.tsx:1-14` — Server Component; wraps all children in `<DashboardLayout>` re-exported from `@/frontend/views/dashboard` (barrel chain: `frontend/views/dashboard/layout/index.ts:4` → `DashboardLayout.tsx`).
- Anonymous gating is client-side inside `DashboardLayout`: `useAuth()` at `frontend/views/dashboard/layout/DashboardLayout.tsx:57`, and the redirect effect at `frontend/views/dashboard/layout/DashboardLayout.tsx:73-83` (`router.replace(buildLoginHref(pathname))` when `!isAuthenticated`).
- Per-page ROLE gating is the Server Component guard `withPageAuth` (SSR; anonymous → `/login?redirect=<path>`, role mismatch → caller's role dashboard):
  - Options interface `WithPageAuthOptions { roles?: readonly UserRole[]; redirectTo?: string }` and `withPageAuth(options?): Promise<WithPageAuthResult>` at `frontend/lib/auth/withPageAuth.ts:34-67`.
  - Result: `WithPageAuthResult { userId: number; user: RegistrationReturnType; role: UserRole }` at `frontend/lib/auth/withPageAuth.ts:50-58`.
  - Canonical admin-page usage: `await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/analytics" })` at `app/(dashboard)/admin/analytics/page.tsx:37`.
- There is an alternative permission-gate pattern (`requirePermissionForPage` for `AppPermission`-gated pages) prescribed in `app/AGENTS.md:27-37`, but grep over `app/` found **zero** usages — every admin page today gates by role via `withPageAuth`, not by permission.

## (b) Sidebar / navigation config source

File: `frontend/views/dashboard/nav/navItems.ts` (the admin sidebar map; pages cite it as "the admin sidebar (`navItems.ts`)" — e.g. `app/(dashboard)/admin/finances/page.tsx` docblock).

Shape (`frontend/views/dashboard/nav/navItems.ts:42-46`):

```ts
export interface DashboardNavItem {
  readonly route: string;
  readonly labelKey: NavLabelKey;
  readonly Icon: SvgIconComponent;
}
```

Exact existing admin entries (`frontend/views/dashboard/nav/navItems.ts:156-187`, the `UserRole.Admin` array of `NAV_ITEMS_BY_ROLE` declared at line 126):

```ts
[UserRole.Admin]: [                                          // :156
  { route: "/admin/dashboard", labelKey: "dashboard", Icon: DashboardIcon },          // :157
  { route: "/notifications", labelKey: "notifications", Icon: NotificationsIcon },    // :158
  { route: "/admin/users", labelKey: "users", Icon: UsersIcon },                      // :159
  { route: "/teachers", labelKey: "teachers", Icon: TeachersIcon },                   // :160
  { route: "/students", labelKey: "students", Icon: StudentsIcon },                  // :161
  { route: "/admin/plans", labelKey: "plans", Icon: PlansIcon },                     // :162
  { route: "/admin/lessons", labelKey: "lessons", Icon: MenuBookOutlined },          // :166
  { route: "/audit", labelKey: "audit", Icon: AuditIcon },                           // :167
  { route: "/admin/finances", labelKey: "finances", Icon: FinanceIcon },             // :171
  { route: "/admin/broadcasts", labelKey: "broadcasts", Icon: CampaignOutlined },    // :172
  { route: "/admin/analytics", labelKey: "analytics", Icon: InsightsOutlined },      // :174
  { route: "/admin/session-governance", labelKey: "sessionGovernance",                // :176-180
    Icon: SessionGovernanceIcon },
  { route: "/disputes", labelKey: "disputes", Icon: DisputesIcon },                  // :185
  { route: "/profile", labelKey: "profile", Icon: ProfileIcon },                     // :186
],
```

Wiring notes (all `navItems.ts`):
- Icons: MUI `*Outlined` icons imported aliased from `@mui/icons-material` (`navItems.ts:6-29`).
- Labels: `labelKey` is a key of `DashboardLabels` (or `HandshakeCodeLabels`), resolved by `resolveNavItemLabel(item, dashboardLabels, handshakeCodeLabels)` at `navItems.ts:214-223`; the discriminator is `isDashboardLabelKey` (`navItems.ts:77-79`).
- Role resolution: `getNavItemsForRole(role)` at `navItems.ts:197-202` (falls back to Student items).
- Label key source files: `shared/locale/en/dashboard/index.ts:14` (`students: "Students"`), `:19` (`analytics: "Analytics"`), `:22` (`sessionGovernance`); Arabic: `shared/locale/ar/dashboard/index.ts:14` (`students: "الطلاب"`), `:19` (`analytics: "التحليلات"`). Adding a new nav label requires a new key in the `DashboardLabels` type + both `en`/`ar` leaves.

## (c) shared/locale — namespace organization & i18n APIs

Organization (verified via `ls`): locale leaves live in `shared/locale/en/<namespace>/` and `shared/locale/ar/<namespace>/` (identical dir sets, 26 namespaces each: `adminBroadcasts, adminFinance, adminSessionGovernance, adminStudents, adminTeachers, adminUsers, analytics, applicant, auth, checkout, common, dashboard, errors, handshakeCode, homework, landing, lessons, notifications, parentLink, parentMonitoring, plans, recitation, schedule, sessions, subscriptionAdmin, upNext, wallet`). Aggregators: `shared/locale/en/messages.ts` (imports e.g. `adminStudentsEn` at `shared/locale/en/messages.ts:5`, `dashboardEn` at `:13`). Handles: `shared/locale/namespaces/<ns>/<ns>.namespace.ts` via `defineNamespace`. Types: `shared/locale/types/<ns>/`. Parity tests: `shared/locale/<ns>-namespace.parity.test.ts` at the locale root (e.g. `shared/locale/adminStudents-namespace.parity.test.ts`).

Exact handle shape (`shared/locale/namespaces/define-namespace.ts:3-13`):

```ts
export interface NamespaceHandle<TLabels> {
  readonly id: string;
  readonly getLabels: (translations: Translations) => TLabels;
}
export function defineNamespace<TLabels>(id: string, getLabels: (translations: Translations) => TLabels): NamespaceHandle<TLabels>
```

Example admin handle — `Analytics` (`shared/locale/namespaces/analytics/analytics.namespace.ts:3-8`): `defineNamespace<AnalyticsLabels>("analytics.analytics", translations => translations.analyticsTranslations)`. Same pattern for `AdminStudents` (`shared/locale/namespaces/adminStudents/adminStudents.namespace.ts:3-8`, → `adminStudentsTranslations`).

| API | Exact name + import path | Definition | Real admin usage |
|---|---|---|---|
| Client hook | `useAppTranslation` from `@/shared/locale/client` | `shared/locale/client/use-app-translation.ts:8-10` (overloads: `useAppTranslation(): Translations` / `useAppTranslation<TLabels>(handle): TLabels`) | `frontend/views/admin/analytics/PlatformAnalyticsContainer.tsx:82` — `const t = useAppTranslation(Analytics);` (import at `:71`); also `frontend/views/admin/students/AdminStudentsDirectoryContainer.tsx:47` — `const labels = useAppTranslation(AdminStudents);` |
| Server getter | `getTranslations` from `@/shared/locale/server` | `shared/locale/server.ts:15` — `export function getTranslations(locale: string): Translations` (synchronous property chain) | `app/(dashboard)/admin/analytics/page.tsx:27-29` — `generateMetadata` → `getTranslations(locale).analyticsTranslations` |
| Server (API/tests) | `getServerTranslations(locale, ns)` from `@/shared/locale/server-graphql` | file exists at `shared/locale/server-graphql.ts` (root AGENTS.md table) | — |

Rules from `shared/locale/AGENTS.md` (whole file, 32 lines): `@/shared/locale/...` absolute aliases only inside the tree (lines 10-17); each leaf exports one `<scope>En`/`<scope>Ar` const typed against the `*Labels` interface from `shared/locale/types/...` (lines 19-22); leaf modules contain no logic, only literals (line 23); interpolation uses ICU `{var}` (line 26). Client containers resolve their OWN labels because interpolation closures cannot cross the server→client props boundary (`app/(dashboard)/admin/users/page.tsx:16-20` docblock).

## (d) UI primitives

Correction to the brief: `frontend/components/ui/` does NOT contain `AppDataGrid`, `MetricCard`, or `PageContainer`. Repo-wide grep for `MetricCard|PageContainer|AppDataGrid|BaseCard` hits only `frontend/views/admin/analytics/**` and `frontend/views/admin/broadcasts/BroadcastHistoryTable.tsx` (no shared `PageContainer`/`AppDataGrid` exists anywhere). Actual primitives:

| Primitive | Path | Export (verbatim) | Props highlight |
|---|---|---|---|
| `MetricCard` | `frontend/views/admin/analytics/MetricCard.tsx:34` | `export function MetricCard({ icon, title, children, sx }: Readonly<MetricCardProps>): ReactNode` | `interface MetricCardProps { icon: ReactNode; title: string; children: ReactNode; sx?: SxProps<Theme> }` (lines 21-27); composes extra `sx` after shell via `mergeSx` |
| `MetricRow` | `frontend/views/admin/analytics/MetricCard.tsx:86` | `export function MetricRow({ label, value, locale }: Readonly<MetricRowProps>): ReactNode` | `{ label: string; value: number | string; locale: string }` (lines 78-83); localizes numbers, `—` for nulls |
| `PlatformAnalyticsMetricGrid` | `frontend/views/admin/analytics/PlatformAnalyticsSections.tsx:87` | `export function PlatformAnalyticsMetricGrid({ ... })` | the 7-section responsive card grid (uses `MetricCard`) |
| `SharedStatCard` | `frontend/views/parent/monitoring/SharedStatCard.tsx:31` | `export function SharedStatCard({ ... })` | the parent-portal stat-card shell (reusable for per-student stat rows) |
| `PermissionDeniedFallback` | `frontend/components/ui/PermissionDeniedFallback.tsx:46` | `export function PermissionDeniedFallback({ ... })` | FORBIDDEN rendering (never bare `null`); mandated by `frontend/AGENTS.md:66` |
| `RetryableNotice` | `frontend/components/ui/RetryableNotice.tsx` | file exists (dir listing) | `RATE_LIMITED`/`SERVICE_UNAVAILABLE` surface; `frontend/AGENTS.md:66` |
| `AdminDesktopTable` | `frontend/components/ui/AdminDesktopTable.tsx:22` | `export function AdminDesktopTable({ ariaLabel, headers, children }: AdminDesktopTableProps): React.ReactElement` | plain responsive table shell used by admin directories |
| `ErrorRetryAlert` / `IconCircleEmptyState` / `CatalogHeader` / `GraphQLErrorSurfaceHost` | `frontend/components/ui/` (dir listing) | — | error retry, empty states, catalog headers; Apollo error toast/notice host (`frontend/AGENTS.md:67`) |

Apollo error discipline for new surfaces: classify via the single `mapGraphQLErrorByCode` table (`frontend/providers/apollo/error-link.map.ts`) + `extractErrorCode` (`frontend/lib/graphql-error-utils`), never render raw server messages (`frontend/views/admin/analytics/PlatformAnalyticsContainer.tsx:31-35` docblock, `frontend/AGENTS.md:65-67`).

## (e) Layout exemplar — `/admin/analytics` (PlatformAnalyticsContainer)

Structure: `page.tsx` (Server Component shell, zero data fetch) → client container → chrome/sections/states/trends.

| Concern | Where (verified) |
|---|---|
| Route shell | `app/(dashboard)/admin/analytics/page.tsx:36-38` — `await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/analytics" })` then `<PlatformAnalyticsContainer />` (no props — page performs ZERO server data fetching per docblock, lines 13-29) |
| Container | `frontend/views/admin/analytics/PlatformAnalyticsContainer.tsx:1` `"use client"`; `export function PlatformAnalyticsContainer(): ReactNode` at `:81` |
| Data fetching | `useQuery` imported from `@apollo/client/react` at `:50` (NOT `useLazyQuery` — banned); query at `:85-87`: `useQuery(adminPlatformAnalyticsQueryDocument, { pollInterval: PLATFORM_ANALYTICS_POLL_INTERVAL_MS (120_000, `:75`), notifyOnNetworkStatusChange: true, ... })` — manual refresh via `refetch()`, stale snapshot stays rendered under a refreshing chip (docblock `:6-17`) |
| Render states | state matrix in the docblock (`:19-38`): initial → `PlatformAnalyticsSkeleton` (`PlatformAnalyticsStates.tsx:95`, `component="output" aria-busy`, keyed to first fetch); error → `PlatformAnalyticsLoadError` (`PlatformAnalyticsStates.tsx:124`) with Retry; FORBIDDEN → `PlatformAnalyticsDeniedNotice` (`PlatformAnalyticsStates.tsx:164`), latched while no snapshot exists; populated → `PlatformAnalyticsMetricGrid` + `PlatformAnalyticsTrends` (dynamic imports) |
| Chrome | `PlatformAnalyticsHeader` (`PlatformAnalyticsChrome.tsx:27`), `PlatformAnalyticsToolbar` (`PlatformAnalyticsChrome.tsx:72`) |
| Cards | `MetricCard`/`MetricRow` (`MetricCard.tsx:34,86`); grid assembled by `PlatformAnalyticsMetricGrid` (`PlatformAnalyticsSections.tsx:87`); revenue table in `RevenueSectionCard.tsx`; charts in `RevenueTrendChart.tsx`/`SessionTrendChart.tsx` via `TrendChartCard.tsx` |
| i18n | `const t = useAppTranslation(Analytics)` at `PlatformAnalyticsContainer.tsx:82` — container resolves every label itself; page metadata via `getTranslations(locale).analyticsTranslations` (`app/(dashboard)/admin/analytics/page.tsx:29`) |
| GQL document | `frontend/graphql/sharedDocuments/admin/platform-analytics.documents.ts` — domain docs live under `frontend/graphql/sharedDocuments/admin/`, imported directly from the view module (no barrel hop beyond `@/.../admin` index) |

Directory-page variant (closer to a "students needing attention" table): `frontend/views/admin/students/AdminStudentsDirectoryContainer.tsx:43,47` (labels via `useAppTranslation(AdminStudents)`), query wiring in `frontend/views/admin/students/hooks/useAdminStudentsDirectory.ts:31,71` — `useQuery(adminStudentsQueryDocument, { fetchPolicy: cache-and-network … })` with URL-synced filters (`useStudentsUrlSync`) and error lane `hasError`/`firstErrorCode`.

## (f) Parent monitoring portal — the drill-down analogue

Pages (`app/(dashboard)/parent/`): `/parent/dashboard/page.tsx`, `/parent/children/page.tsx` (root → `ParentChildrenRootContainer`, imported at `app/(dashboard)/parent/children/page.tsx:5`), `/parent/children/[studentId]/page.tsx` (→ `ParentChildDetailContainer`, imported at `:5`; `withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/children" })` per docblock lines 8-17; `studentId` coerced to a safe positive int, foreign/unlinked ids → constant FORBIDDEN), `/parent/handshake/page.tsx`.

Containers/tabs (all in `frontend/views/parent/monitoring/`, re-exported by its `index.ts:13-25`):
- `ParentChildrenRootContainer.tsx:17` — portal root (children list).
- `ParentChildDetailContainer.tsx:23` — the per-student drill-down; tab split in `ParentChildDetailContainer.tabs.tsx`; helpers `.helpers.ts`, parts `.parts.tsx`.
- Five tabs: `ProgressTab` (Surah/Juz progress + `RatingTrendChart`), `HomeworkTab` (Jadid/Madi homework — `HomeworkTab.tsx`, `.parts.tsx`, `.body.tsx`, `.sessionHighlight.test.ts`), `AttendanceTab` (+ `AttendanceCalendar`), `EvaluationsTab`, `ReportsTab` — each with a `*Summary.tsx` stat block (`ProgressSummary`, `HomeworkSummary`, `AttendanceSummary`, `EvaluationsSummary`) and a shared `SharedStatCard.tsx:31`.
- GraphQL: `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts` — `myLinkedChildrenQueryDocument:64`, `myChildrenUpcomingSessionsQueryDocument:94`, `parentChildProgressQueryDocument:124`, `parentChildSessionsQueryDocument:164`, `parentChildReportsQueryDocument:198`, `parentChildHomeworkQueryDocument:233`, `parentSessionTargetQueryDocument:281`.
- Canonical domain doc: `docs/parents/monitoring-portal.md` (read-only portal, `requireLinkedChild` gate, five SDL queries, constant-403 denial oracle) — cited from root AGENTS.md "Important References".

This portal is the closest UX analogue for the ticket's per-student academic-history drill-down; the admin version must NOT inherit the `requireLinkedChild` gate (admin sees any student; backend resolvers enforce admin permission instead).

## (g) AGENTS.md constraints for new admin pages

`app/AGENTS.md`:
- Files under `app/` are Server Components by default; they may call backend services directly, must not call repositories/db directly, and must not use React hooks/browser APIs (`app/AGENTS.md:3-8`).
- Auth guards: use `withPageAuth()` wrapper for dashboard pages (`app/AGENTS.md:10-14`); page-level access control table at `:27-37` — not-logged-in → login; missing `AppPermission` → `requirePermissionForPage` → `/dashboard`. **Zero current usages of `requirePermissionForPage` in `app/` (grep)**; every admin page gates by role via `withPageAuth({ roles: [UserRole.Admin] })`. Container-level `<RequirePermission>` wrappers around entire page returns are prohibited; UX-level `<RequirePermission>` on buttons/tabs/sections is allowed (`app/AGENTS.md:38`).
- Server metadata i18n via `getTranslations(locale)` (`app/AGENTS.md` i18n section, mirrors `shared/locale` table).

`frontend/AGENTS.md`:
- No hardcoded colors; theme callback only when theme-specific values are needed: `sx={(theme) => ({ color: theme.palette.primary.main })}`; Material-3 `on<Color>` siblings instead of `contrastText` (`frontend/AGENTS.md:3-9`).
- MUI v9: style props are not valid on Typography/Stack/Box/Grid — `sx`-only; icon names `*Outlined` (`frontend/AGENTS.md:26-38`).
- FORBIDDEN and `RATE_LIMITED`/`SERVICE_UNAVAILABLE` render through `PermissionDeniedFallback` / `RetryableNotice` — never bare `null` (`frontend/AGENTS.md:65-67`); raw server `message` never rendered (`frontend/views/parent/monitoring/ParentChildDetailContainer` docblock discipline, also `frontend/AGENTS.md:67`).
- Route strings for nav entries must be single-sourced in a leaf lib module — never duplicate literals (`frontend/AGENTS.md:23`).
- React 19: `React.SubmitEvent` not `FormEvent`; `(formData.get("x") as string | null) ?? ""` (`frontend/AGENTS.md:20-21`).

`frontend/views/AGENTS.md` — 3 lines total: all view-tree rules live in `frontend/AGENTS.md` (`frontend/views/AGENTS.md:1-3`); read it before working in the view tree.

Root `AGENTS.md`:
- Logging: NEVER `console.*` — ESLint errors; use `logger` from `@/frontend/utils/logger` (frontend) / `@/backend/lib/logger` (backend); `logger.logDomainError` for business rejections (`AGENTS.md:105-109`).
- GraphQL client discipline: docs in `frontend/graphql/sharedDocuments/<domain>/<x>.documents.ts`, naming `{entity}QueryDocument`; always include `id` on every object type for cache normalization; NO `useLazyQuery` — stateful `useQuery` only; hooks from `@apollo/client/react` (`AGENTS.md:186-193`).
- Deep imports are the default — no new barrels; view components are imported directly from their module (pattern in every `app/(dashboard)/admin/*/page.tsx` import at line 4).
- i18n: all user-facing strings through the compile-time system; resolvers use `ctx.t` (`AGENTS.md:157-180`).

Blocked-ticket status (frontend evidence): "Session Report Submission with Homework (Jadid & Madi)" IS implemented — teacher submit form at `frontend/views/teacher/sessions/TeacherSessionReportSubmitForm.tsx` (+ `TeacherSessionReportHomeworkReview.tsx`), input shape `jadid`/`revision` at `backend/graphql/pothos/classes/session-report-input.pothos.ts:60-67`, labels at `shared/locale/en/sessions/labels.ts:135-163` (`jadidSectionTitle: "New memorization (Jadid)"` at `:155`). The dependency blocker is satisfied.

## GAPS (verified NOT to exist)

1. **No admin academic-tracking route**: `app/(dashboard)/admin/` contains exactly 9 pages (dashboard, analytics, broadcasts, finances, lessons, plans, session-governance, users, users/[id]) — verified by `find`. No `academic*`, `memorization*`, `revision*`, `progress*` segment anywhere under `app/` (grep over `app/` for academic/memorization terms returned only teacher session-report, student homework, and parent monitoring hits).
2. **No nav entry**: `frontend/views/dashboard/nav/navItems.ts` contains zero matches for academic/memorization/revision/surah (grep returned no hits).
3. **No GraphQL documents**: `frontend/graphql/sharedDocuments/admin/` holds only admin-finance, admin-session-governance, admin-students, admin-subscriptions, admin-teacher-applicants, admin-teachers, admin-users, audit-trail, platform-analytics, teacher-certification (verified listing). No academic/memorization query documents exist anywhere in `frontend/graphql/sharedDocuments/` (grep; jadid hits are in `students/homework.documents.ts` and `parents/parent-monitoring.documents.ts` — the student/parent surfaces, both already implemented).
4. **No locale namespace**: no `adminAcademic*` namespace dir under `shared/locale/en/`, `shared/locale/ar/`, `shared/locale/namespaces/`, or `shared/locale/types/` (verified listings); no academic-tracking keys in the dashboard labels files.
5. **No per-student admin drill-down**: `/students` is a flat read-only directory; no `app/(dashboard)/students/[id]` route exists (verified `find`), and the admin student surface has only a drawer (`frontend/views/admin/students/AdminStudentDetailDrawer.tsx`) — no academic history view. (Note: `frontend/views/admin/teachers/AdminTeacherDetailDrawer/DrawerAcademicSection.tsx:22-23` exists but renders only a TEACHER's rating + subject list — not student memorization.)
6. **Non-403 gap to decide**: ticket says "Non-admin attempts access — 403", but the established frontend pattern is `withPageAuth({ roles: [UserRole.Admin] })` which REDIRECTS non-admins to their role dashboard (`frontend/lib/auth/withPageAuth.ts:67-90`), with resolvers returning FORBIDDEN for data-level probes (parent-portal constant-403 oracle in `docs/parents/monitoring-portal.md`). A true HTTP 403 page does not exist in the dashboard tree.

### Proposed integration points (for the plan)

- **Route**: `app/(dashboard)/admin/academic-tracking/page.tsx` (server shell, `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" })`) + optional `app/(dashboard)/admin/academic-tracking/[studentId]/page.tsx` drill-down, mirroring the `/admin/users` ↔ `/admin/users/[id]` pair.
- **Nav position**: insert into the `UserRole.Admin` array in `frontend/views/dashboard/nav/navItems.ts:156-187` directly after the `/students` entry (`:161`) — it is the academic sibling of the student directory. Proposed object: `{ route: "/admin/academic-tracking", labelKey: "academicTracking", Icon: MenuBookOutlined-or-InsightsOutlined-style MUI *Outlined icon }` (icons imported aliased at `navItems.ts:6-29`; route string single-sourced per `frontend/AGENTS.md:23`).
- **Locale keys to add**: `academicTracking` in `DashboardLabels` type (`shared/locale/types/dashboard`) + `dashboardEn` (`shared/locale/en/dashboard/index.ts`, sibling of `students` at `:14`) + `dashboardAr` (`shared/locale/ar/dashboard/index.ts:14`); plus a new `adminAcademic` namespace following the full pattern: `shared/locale/en/adminAcademic/`, `shared/locale/ar/adminAcademic/`, `shared/locale/types/adminAcademic/`, `shared/locale/namespaces/adminAcademic/adminAcademic.namespace.ts` (→ `adminAcademicTranslations`), registration in both `messages.ts`, `shared/locale/index.ts` types export, and `adminAcademic-namespace.parity.test.ts`.
- **Reuse**: Jadid/Madi + Surah/Juz display vocabulary already exists in `shared/locale/en/parentMonitoring/index.ts` (`trackJadid: "Jadid (new memorization)"` `:33`, `homeworkColumnJadid` `:85`, `progressLatestJadidLabel` `:42`, `csvJadidColumn` `:165`) — the admin namespace should mirror rather than invent these terms. `SurahJuzRef` enum (5 surahs + Juz1..30, `backend/enum/shared/surah-juz-ref.enum.ts:10-37`) is the B.11 display vocabulary.
