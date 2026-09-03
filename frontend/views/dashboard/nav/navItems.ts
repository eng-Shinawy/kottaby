"use client";

// Admin navigation map for the dashboard sidebar. Import order: MUI icons,
// then app modules (barrel discipline — codegen module imports the types).

import {
  AssessmentOutlined as AuditIcon,
  FamilyRestroomOutlined as ChildrenIcon,
  DashboardOutlined as DashboardIcon,
  GavelOutlined as DisputesIcon,
  HistoryEduOutlined as HomeworkIcon,
  LinkOutlined as LinkChildIcon,
  NotificationsOutlined as NotificationsIcon,
  VerifiedOutlined as PlansIcon,
  AccountCircleOutlined as ProfileIcon,
  CalendarMonthOutlined as ScheduleIcon,
  SchoolOutlined as SessionsIcon,
  GroupsOutlined as StudentsIcon,
  CardMembershipOutlined as SubscriptionsIcon,
  type SvgIconComponent,
  PersonOutlined as TeachersIcon,
  SupervisedUserCircleOutlined as UsersIcon,
  PaymentsOutlined as WalletIcon,
} from "@mui/icons-material";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
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
export type NavLabelKey = Exclude<keyof DashboardLabels | keyof HandshakeCodeLabels, CollidingNavLabelKeys>;

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
 * an inbox — REQ-065), positioned right after each role's dashboard entry
 * (plan §5.2: existing general nav group, no new group).
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
 * Canonical retargets (per sprint plans):
 *  - Sessions → `/student/sessions` / `/teacher/sessions` (DEV3-004 — a
 *    RETARGET of the former shared `/sessions` catch-all link)
 *  - Admin Users → `/admin/users` (DEV3-016 — the directory page exists)
 *  - Admin Plans → `/admin/plans` (DEV1-005)
 */
const NAV_ITEMS_BY_ROLE: Record<UserRole, readonly DashboardNavItem[]> = {
  [UserRole.Student]: [
    { route: "/student/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/notifications", labelKey: "notifications", Icon: NotificationsIcon },
    { route: "/student/sessions", labelKey: "sessions", Icon: SessionsIcon },
    { route: "/subscriptions", labelKey: "subscriptions", Icon: SubscriptionsIcon },
    { route: "/homework", labelKey: "homework", Icon: HomeworkIcon },
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
    { route: "/children", labelKey: "children", Icon: ChildrenIcon },
    { route: "/parent/handshake", labelKey: "navLinkMyChild", Icon: LinkChildIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
  [UserRole.Admin]: [
    { route: "/admin/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/notifications", labelKey: "notifications", Icon: NotificationsIcon },
    { route: "/admin/users", labelKey: "users", Icon: UsersIcon },
    { route: "/teachers", labelKey: "teachers", Icon: TeachersIcon },
    { route: "/students", labelKey: "students", Icon: StudentsIcon },
    { route: "/admin/plans", labelKey: "plans", Icon: PlansIcon },
    { route: "/audit", labelKey: "audit", Icon: AuditIcon },
    // DEV3-005 (R-111) — the session-arbitration queue: a REAL admin page
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
  return typeof value === "string" ? value : String(value);
}

/** Re-exported for the dashboard view's stat-card icon (notifications). */
export { NotificationsIcon };
