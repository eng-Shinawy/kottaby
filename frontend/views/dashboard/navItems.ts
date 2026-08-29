"use client";

import {
  AssessmentOutlined as AuditIcon,
  FamilyRestroomOutlined as ChildrenIcon,
  DashboardOutlined as DashboardIcon,
  HistoryEduOutlined as HomeworkIcon,
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
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

/**
 * Navigation item shape — used by `DashboardSidebar` to render role-aware
 * navigation links. Each item has a route (URL path), a label key (looked up
 * in `DashboardLabels`), and a `*Outlined` MUI icon.
 */
export interface DashboardNavItem {
  readonly route: string;
  readonly labelKey: keyof DashboardLabels;
  readonly Icon: SvgIconComponent;
}

/**
 * Role-keyed navigation map. Each role sees its own subset of nav items.
 *
 * The dashboard + profile links are present for ALL roles (every user has a
 * dashboard landing + a profile). Role-specific links (Sessions, Subscriptions,
 * Wallet, etc.) are gated by role per the FR catalog.
 *
 * Each role's dashboard item points DIRECTLY at its role-specific route
 * (`/teacher/dashboard`, …) instead of the bare `/dashboard` dispatcher:
 * one hop faster, and immune to the preview-gateway trailing-slash loop
 * (gateway 301s `/dashboard` → `/dashboard/`, Next.js 308s it back — see
 * `frontend/lib/auth/roleDashboardRoute.ts`).
 *
 * Routes that don't have a real page yet resolve to the `app/(dashboard)/[feature]/page.tsx`
 * catch-all, which renders the `ComingSoonView`. Real routes (Dashboard,
 * Profile, the admin `/admin/plans` catalog) take precedence over the
 * catch-all per Next.js route resolution.
 */
const NAV_ITEMS_BY_ROLE: Record<UserRole, readonly DashboardNavItem[]> = {
  [UserRole.Student]: [
    { route: "/student/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/sessions", labelKey: "sessions", Icon: SessionsIcon },
    { route: "/subscriptions", labelKey: "subscriptions", Icon: SubscriptionsIcon },
    { route: "/homework", labelKey: "homework", Icon: HomeworkIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
  [UserRole.Teacher]: [
    { route: "/teacher/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/sessions", labelKey: "sessions", Icon: SessionsIcon },
    { route: "/schedule", labelKey: "schedule", Icon: ScheduleIcon },
    { route: "/wallet", labelKey: "wallet", Icon: WalletIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
  [UserRole.Parent]: [
    { route: "/parent/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/children", labelKey: "children", Icon: ChildrenIcon },
    { route: "/profile", labelKey: "profile", Icon: ProfileIcon },
  ],
  [UserRole.Admin]: [
    { route: "/admin/dashboard", labelKey: "dashboard", Icon: DashboardIcon },
    { route: "/users", labelKey: "users", Icon: UsersIcon },
    { route: "/teachers", labelKey: "teachers", Icon: TeachersIcon },
    { route: "/students", labelKey: "students", Icon: StudentsIcon },
    { route: "/admin/plans", labelKey: "plans", Icon: PlansIcon },
    { route: "/audit", labelKey: "audit", Icon: AuditIcon },
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
 * Returns the human-readable label for a nav item, looked up from the
 * `DashboardLabels` translation.
 *
 * The `labelKey` is a keyof `DashboardLabels` — most entries are `string`
 * literals, but a few (`welcome`, `comingSoonBody`, `userAvatarAlt`) are
 * functions. The nav-item label keys are all `string` literals, so the cast
 * is safe here.
 */
export function resolveNavItemLabel(item: DashboardNavItem, t: DashboardLabels): string {
  const value = t[item.labelKey];
  return typeof value === "string" ? value : String(value);
}

/** Re-exported for the dashboard view's stat-card icon (notifications). */
export { NotificationsIcon };
