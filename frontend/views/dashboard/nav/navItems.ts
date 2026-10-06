"use client";

// Admin navigation map for the dashboard sidebar. Import order: MUI icons,
// then app modules (barrel discipline — codegen module imports the types).

import {
  AssessmentOutlined as AuditIcon,
  CampaignOutlined,
  FamilyRestroomOutlined as ChildrenIcon,
  DashboardOutlined as DashboardIcon,
  GavelOutlined as DisputesIcon,
  AccountBalanceOutlined as FinanceIcon,
  PersonSearchOutlined as FindTeachersIcon,
  HistoryEduOutlined as HomeworkIcon,
  InsightsOutlined,
  LinkOutlined as LinkChildIcon,
  MenuBookOutlined,
  NotificationsOutlined as NotificationsIcon,
  VerifiedOutlined as PlansIcon,
  AccountCircleOutlined as ProfileIcon,
  CalendarMonthOutlined as ScheduleIcon,
  EventNoteOutlined as SessionGovernanceIcon,
  SchoolOutlined as SessionsIcon,
  GroupsOutlined as StudentsIcon,
  CardMembershipOutlined as SubscriptionsIcon,
  type SvgIconComponent,
  PersonOutlined as TeachersIcon,
  QueryStatsOutlined as TrackingIcon,
  SupervisedUserCircleOutlined as UsersIcon,
  PaymentsOutlined as WalletIcon,
} from "@mui/icons-material";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { STUDENT_LINK_REQUESTS_ROUTE, STUDENT_SESSIONS_ROUTE } from "@/frontend/lib/notification-route-resolution";
import { ACADEMIC_TRACKING_DASHBOARD_ROUTE } from "@/frontend/views/admin/academic-tracking/academic-tracking-routes";
import { dashboardEn } from "@/shared/locale/en/dashboard";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";
import type { HandshakeCodeLabels } from "@/shared/locale/types/handshakeCode";

/**
 * Navigation item shape — used by `DashboardSidebar` to render role-aware
 * navigation links. Each item has a route (URL path), a label key (looked up
 * in `DashboardLabels`, or in `HandshakeCodeLabels` for feature-owned nav
 * entries), and a `*Outlined` MUI icon.
 */
export interface DashboardNavItem {
  readonly route: string;
  readonly labelKey: NavLabelKey;
  readonly Icon: SvgIconComponent;
}

/**
 * Nav-label keys owned by BOTH label namespaces. A cross-namespace key
 * collision would make the runtime `key in dashboardEn` discrimination
 * silently prefer the dashboard bundle, so colliding keys are carved OUT of
 * the nav label-key union: a future collision fails at COMPILE time at the
 * nav-item definition site (pick a key owned by exactly one namespace)
 * instead of resolving ambiguously at runtime. The namespaces are disjoint
 * today — a pure future-proofing guard with zero current behavior change.
 */
type CollidingNavLabelKeys = keyof DashboardLabels & keyof HandshakeCodeLabels;

/**
 * A nav label key owned by EXACTLY ONE label namespace — the discriminator
 * `isDashboardLabelKey` stays total and unambiguous over this union.
 */
type NavLabelKey = Exclude<keyof DashboardLabels | keyof HandshakeCodeLabels, CollidingNavLabelKeys>;

/**
 * Type guard: is this nav label key owned by the `dashboard` namespace?
 *
 * Membership is tested against the `dashboard` en leaf — key sets are
 * compile-pinned on every locale leaf, so a key present on one leaf is
 * present on all. Feature-owned keys (e.g. the handshake-code nav label)
 * fall through to the `handshakeCode` label bundle at resolve time.
 *
 * `NavLabelKey` excludes cross-namespace collisions at the type level, so
 * for every admissible key exactly ONE of the two branches can match — the
 * guard can never silently prefer the dashboard bundle.
 */
function isDashboardLabelKey(key: NavLabelKey): key is keyof DashboardLabels {
  return key in dashboardEn;
}

/**
 * Role-keyed navigation map. Each role sees its own subset of nav items.
 *
 * The dashboard + profile links are present for ALL roles (every user has a
 * dashboard landing + a profile). Role-specific links (Sessions, Subscriptions,
 * Wallet, etc.) are gated by role per the FR catalog. The Notifications
 * inbox link is present for ALL roles too (every authenticated audience has
 * an inbox), positioned right after each role's dashboard entry
 * (the existing general nav group — no new nav group).
 *
 * Each role's dashboard item points DIRECTLY at its role-specific route
 * (`/teacher/dashboard`, …) instead of the bare `/dashboard` dispatcher:
 * one hop faster, and immune to the preview-gateway trailing-slash loop
 * (gateway 301s `/dashboard` → `/dashboard/`, Next.js 308s it back — see
 * `frontend/lib/auth/roleDashboardRoute.ts`).
 *
 * Routes point at their canonical role-scoped pages; routes whose pages have
 * not shipped yet fall through to the `app/(dashboard)/[feature]/page.tsx`
 * catch-all, which renders the `ComingSoonView`. Real routes (Dashboard,
 * Profile, Notifications) take precedence over the catch-all per Next.js
 * route resolution.
 *
 * Canonical retargets:
 *  - Sessions → `/student/sessions` / `/teacher/sessions` (a
 *    RETARGET of the former shared `/sessions` catch-all link)
 *  - Parent Children → `/parent/children` (a RETARGET of the former
 *    shared `/children` catch-all link; the parent portal root ships
 *    at the role-scoped route)
 *  - Student Sessions → the shared `STUDENT_SESSIONS_ROUTE` constant
 *    (the nav and the session-completion notification deep-link never
 *    drift)
 *  - Student Plans → `/student/plans` (a pure ADD to the student list:
 *    the student-guarded catalog page ships at the route; the `plans`
 *    label key is shared with the admin entry — both `DashboardLabels`-owned)
 *  - Student Find Teachers → `/student/teachers` (a pure ADD: the
 *    student-guarded available-teachers directory browse ships at the
 *    route; the `findTeachers` label key is `DashboardLabels`-owned)
 *  - Admin Users → `/admin/users` (the directory page exists)
 *  - Admin Plans → `/admin/plans`
 *  - Admin Broadcasts → `/admin/broadcasts` (a pure ADD, not a
 *    retarget: the compose surface ships at the route)
 *  - Admin Session Governance → `/admin/session-governance` (a
 *    pure ADD, not a retarget: the admin session directory ships at the
 *    route)
 *  - Student Link Requests → the real decision route via the shared
 *    `STUDENT_LINK_REQUESTS_ROUTE` constant (the nav, the
 *    dashboard-card CTA, and the notification deep-link never drift).
 */
const NAV_ITEMS_BY_ROLE: Record<UserRole, readonly DashboardNavItem[]> = {
  [UserRole.Student]: [
    { route: "/student/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/notifications", labelKey: "notifications", Icon: NotificationsIcon },
    // Same single-sourced constant as the session-completion notification
    // deep link (the surface where the Rate action lives).
    { route: STUDENT_SESSIONS_ROUTE, labelKey: "sessions", Icon: SessionsIcon },
    // Targets the student-guarded plan catalog at
    // `app/(dashboard)/student/plans/page.tsx` — browse + purchase CTA.
    { route: "/student/plans", labelKey: "plans", Icon: PlansIcon },
    // Targets the student-guarded teacher directory at
    // `app/(dashboard)/student/teachers/page.tsx` — the
    // available-teachers browse (recitation + subject intent filters).
    { route: "/student/teachers", labelKey: "findTeachers", Icon: FindTeachersIcon },
    { route: "/subscriptions", labelKey: "subscriptions", Icon: SubscriptionsIcon },
    { route: "/homework", labelKey: "homework", Icon: HomeworkIcon },
    { route: STUDENT_LINK_REQUESTS_ROUTE, labelKey: "linkRequests", Icon: LinkChildIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
  [UserRole.Teacher]: [
    { route: "/teacher/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/notifications", labelKey: "notifications", Icon: NotificationsIcon },
    { route: "/teacher/sessions", labelKey: "sessions", Icon: SessionsIcon },
    { route: "/schedule", labelKey: "schedule", Icon: ScheduleIcon },
    { route: "/wallet", labelKey: "wallet", Icon: WalletIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
  [UserRole.Parent]: [
    { route: "/parent/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/notifications", labelKey: "notifications", Icon: NotificationsIcon },
    { route: "/parent/children", labelKey: "children", Icon: ChildrenIcon },
    { route: "/parent/handshake", labelKey: "navLinkMyChild", Icon: LinkChildIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
  [UserRole.Admin]: [
    { route: "/admin/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/notifications", labelKey: "notifications", Icon: NotificationsIcon },
    { route: "/admin/users", labelKey: "users", Icon: UsersIcon },
    { route: "/teachers", labelKey: "teachers", Icon: TeachersIcon },
    { route: "/students", labelKey: "students", Icon: StudentsIcon },
    // Targets the admin-guarded academic-tracking console at
    // `app/(dashboard)/admin/academic-tracking/page.tsx` — cross-student
    // memorization + revision milestone tracking. The route string is
    // single-sourced in the academic-tracking routes leaf.
    {
      route: ACADEMIC_TRACKING_DASHBOARD_ROUTE,
      labelKey: "academicTracking",
      Icon: TrackingIcon,
    },
    { route: "/admin/plans", labelKey: "plans", Icon: PlansIcon },
    // Targets the admin-guarded curriculum-lessons catalog at
    // `app/(dashboard)/admin/lessons/page.tsx` — the per-plan lesson CRUD
    // (create / edit / delete) over the subscription-plan curriculum.
    { route: "/admin/lessons", labelKey: "lessons", Icon: MenuBookOutlined },
    { route: "/audit", labelKey: "audit", Icon: AuditIcon },
    // Targets the admin-guarded finances console at
    // `app/(dashboard)/admin/finances/page.tsx` — the payments audit, the
    // withdrawal payout queue, and the teacher wallet inspector.
    { route: "/admin/finances", labelKey: "finances", Icon: FinanceIcon },
    { route: "/admin/broadcasts", labelKey: "broadcasts", Icon: CampaignOutlined },
    // Targets the admin-guarded analytics page at `app/(dashboard)/admin/analytics/page.tsx`.
    { route: "/admin/analytics", labelKey: "analytics", Icon: InsightsOutlined },
    // Targets the admin-guarded session-governance directory at
    // `app/(dashboard)/admin/session-governance/page.tsx` — filter, reschedule,
    // cancel, and teacher reassignment over platform sessions.
    {
      route: "/admin/session-governance",
      labelKey: "sessionGovernance",
      Icon: SessionGovernanceIcon,
    },
    // (R-111) — the session-arbitration queue: a REAL admin page
    // (`app/(dashboard)/disputes/page.tsx`, `withPageAuth` admin-gated like
    // the role dashboards) instead of a catch-all coming-soon stub.
    { route: "/disputes", labelKey: "disputes", Icon: DisputesIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
};

/**
 * Returns the nav items for the given role. Falls back to the student nav
 * (the smallest common denominator) when the role is null/unknown — keeps the
 * dashboard renderable for anonymous users hitting `/dashboard` (the auth
 * redirect handles them separately, but the layout still needs to mount).
 */
export function getNavItemsForRole(role: UserRole | null | undefined): readonly DashboardNavItem[] {
  if (role && role in NAV_ITEMS_BY_ROLE) {
    return NAV_ITEMS_BY_ROLE[role];
  }
  return NAV_ITEMS_BY_ROLE[UserRole.Student];
}

/**
 * Returns the human-readable label for a nav item, resolved from the label
 * bundle that OWNS the key: `DashboardLabels` for the shared shell entries,
 * `HandshakeCodeLabels` for feature-owned nav entries (the handshake-code
 * discovery nav item).
 *
 * Most `DashboardLabels` entries are `string` literals, but a few (`welcome`,
 * `comingSoonBody`, `userAvatarAlt`) are functions. The nav-item label keys
 * are all `string` literals, so the non-string fallback is safe here.
 */
export function resolveNavItemLabel(
  item: DashboardNavItem,
  dashboardLabels: DashboardLabels,
  handshakeCodeLabels: HandshakeCodeLabels
): string {
  const value = isDashboardLabelKey(item.labelKey)
    ? dashboardLabels[item.labelKey]
    : handshakeCodeLabels[item.labelKey];
  return typeof value === "string" ? value : item.labelKey;
}
