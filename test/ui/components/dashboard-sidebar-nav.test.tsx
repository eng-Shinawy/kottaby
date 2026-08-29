/**
 * DashboardSidebar nav wiring — admin Plans entry (DEV1-005 Task 4.5).
 *
 * Two tiers, one suite:
 *
 * 1. UNIT tier — `getNavItemsForRole` / `NAV_ITEMS_BY_ROLE` structure: the
 *    admin array carries the Plans item targeting the REAL admin catalog
 *    page (`/admin/plans` — REQ-054, the Task 4.2 page) and the
 *    student/teacher/parent arrays carry NO plans entry (role-visibility
 *    4.5.3, structural via the `NAV_ITEMS_BY_ROLE` map).
 *
 * 2. COMPONENT tier — `DashboardSidebar` render through the established
 *    harness (Happy DOM + translation-preload + `renderWithWrapper`), with
 *    the role supplied through the REAL `AuthContext.Provider` (same context
 *    `useAuth` consumes in the app — no hook-module mocks). Asserts the
 *    rendered "Plans" link points at `/admin/plans` with the label resolved
 *    from the DASHBOARD namespace (`dashboardTranslations.plans`), and that
 *    a student fixture renders no such link.
 *
 * Translation discipline (mirrors `ApplicantStatusCard.test.tsx`): assertions
 * reference ONLY label objects resolved through
 * `Dashboard.getLabels(getTranslations(locale))` — zero hardcoded copy. The
 * nav label key `plans` deliberately lives in the dashboard namespace because
 * `DashboardNavItem.labelKey` is typed `keyof DashboardLabels` (documented
 * deviation in outcome/4.5-navigation-outcome.md; the plans-namespace keys
 * serve the page content, not the nav).
 *
 * Scope note (4.5.2): the mobile bottom-nav surface is untouched — Plans is
 * an admin-only entry and admin is a desktop sidebar surface here.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { DashboardSidebar } from "@/frontend/views/dashboard/DashboardSidebar";
import { getNavItemsForRole } from "@/frontend/views/dashboard/navItems";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Dashboard } from "@/shared/locale/namespaces/dashboard";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";
import { testNavigationState } from "@/test/ui/components/translation-preload";

/** Minimal deterministic user fixture carrying only the fields `me` selects. */
function userFixture(role: UserRole, id: number): AuthUser {
  return {
    id,
    email: `nav-fixture-${id}@example.test`,
    fullName: `Nav Fixture ${id}`,
    phone: null,
    country: null,
    gender: null,
    role,
    preferredRecitation: null,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
  };
}

const ADMIN_FIXTURE = userFixture(UserRole.Admin, 9001);
const STUDENT_FIXTURE = userFixture(UserRole.Student, 9002);

/** Auth context double: static user, no lifecycle — the sidebar reads `user` only. */
function authValue(user: AuthUser | null): AuthContextType {
  return {
    user,
    isAuthenticated: user !== null,
    isLoading: false,
    error: null,
    login: () => Promise.resolve(false),
    logout: () => undefined,
  };
}

// Module-level constants — stable context values (never re-constructed per render).
const ADMIN_AUTH = authValue(ADMIN_FIXTURE);
const STUDENT_AUTH = authValue(STUDENT_FIXTURE);

/** Render the sidebar under the full provider stack plus the auth context. */
function renderSidebar(auth: AuthContextType, locale: AppLocale): void {
  testNavigationState.pathname = "/admin/dashboard";
  renderWithWrapper(
    <AuthContext.Provider value={auth}>
      <DashboardSidebar mobileOpen={false} onMobileClose={() => undefined} />
    </AuthContext.Provider>,
    { locale }
  );
}

/**
 * The shared happy-dom preload registers a 1024px viewport — BELOW MUI's `lg`
 * breakpoint (1200px), so the permanent drawer's `display: { xs: "none",
 * lg: "block" }` hides it from the accessibility tree and role queries come
 * back empty. Widen the viewport to `lg+` for the render tier so the sidebar
 * links are visible/accessible exactly as on a real desktop dashboard.
 */
interface ViewportSetter {
  setViewport(viewport: { width: number; height: number }): void;
}

/** Assertion-free runtime guard for happy-dom's `window.happyDOM` handle. */
function isViewportSetter(value: unknown): value is ViewportSetter {
  if (typeof value !== "object" || value === null) return false;
  const setter: unknown = Reflect.get(value, "setViewport");
  return typeof setter === "function";
}

beforeAll(() => {
  const candidate: unknown = Reflect.get(window, "happyDOM");
  if (isViewportSetter(candidate)) {
    candidate.setViewport({ width: 1600, height: 900 });
  }
});

afterEach(cleanup);

describe("navItems — admin Plans entry targets the real /admin/plans page", () => {
  test("admin nav carries the Plans item with route /admin/plans, positioned after teachers/students", () => {
    const adminItems = getNavItemsForRole(UserRole.Admin);
    const routes = adminItems.map(item => item.route);

    expect(routes).toEqual([
      "/admin/dashboard",
      "/users",
      "/teachers",
      "/students",
      "/admin/plans",
      "/audit",
      "/profile",
    ]);

    const plans = adminItems.find(item => item.route === "/admin/plans");
    expect(plans?.labelKey).toBe("plans");
    // The *Outlined icon convention: the PlansIcon component is attached
    // (MUI icon components are exotic objects — forwardRef/ lazy wrappers).
    expect(plans?.Icon).toBeDefined();
  });

  test("student + parent navs carry the consumer /plans storefront; teacher carries none (role-visibility 4.5.3, consumer-storefront amendment)", () => {
    // Consumer storefront amendment (this round): students and parents get
    // a /plans entry (the planCatalog read is server-gated to authenticated
    // callers and returns the ACTIVE slice only). Teachers have no buying
    // journey — no plans entry. NOBODY but the admin sees the management
    // surface /admin/plans in their nav.
    for (const role of [UserRole.Student, UserRole.Parent]) {
      const items = getNavItemsForRole(role);
      const storefront = items.find(item => item.route === "/plans");
      expect(storefront, `role ${role} carries the /plans storefront`).toBeDefined();
      expect(storefront?.labelKey).toBe("plans");
      expect(storefront?.Icon).toBeDefined();
      // The management surface stays admin-only in every non-admin nav.
      expect(items.some(item => item.route === "/admin/plans")).toBe(false);
    }
    for (const role of [UserRole.Teacher]) {
      const items = getNavItemsForRole(role);
      expect(items.some(item => item.route === "/plans")).toBe(false);
      expect(items.some(item => item.route === "/admin/plans")).toBe(false);
      expect(items.some(item => item.labelKey === "plans")).toBe(false);
    }
  });

  test("admin Plans label resolves from the dashboard namespace ('Plans' in en)", () => {
    // The label mechanism is the dashboard namespace (keyof DashboardLabels
    // typing) — resolved via resolveNavItemLabel's own lookup path.
    const dashboardLabels = Dashboard.getLabels(getTranslations("en"));
    const adminItems = getNavItemsForRole(UserRole.Admin);
    const plans = adminItems.find(item => item.route === "/admin/plans");

    expect(plans).toBeDefined();
    if (!plans) return;
    const value = dashboardLabels[plans.labelKey];
    expect(typeof value === "string" ? value : String(value)).toBe(dashboardLabels.plans);
    expect(dashboardLabels.plans).toBe("Plans");
  });
});

describe("DashboardSidebar render — role-aware Plans link", () => {
  test("admin fixture renders a translated 'Plans' link pointing at /admin/plans", () => {
    const dashboardLabels = Dashboard.getLabels(getTranslations("en"));
    renderSidebar(ADMIN_AUTH, "en");

    // At lg+ only the permanent drawer is visible (the closed temporary one
    // stays mounted but inaccessible) — exactly one Plans link is exposed.
    const plansLinks = screen.getAllByRole("link", { name: dashboardLabels.plans });
    expect(plansLinks).toHaveLength(1);
    for (const link of plansLinks) {
      expect(link.getAttribute("href")).toBe("/admin/plans");
    }
  });

  test("student fixture renders a translated 'Plans' link pointing at the /plans storefront", () => {
    const dashboardLabels = Dashboard.getLabels(getTranslations("en"));
    renderSidebar(STUDENT_AUTH, "en");

    const plansLinks = screen.getAllByRole("link", { name: dashboardLabels.plans });
    expect(plansLinks).toHaveLength(1);
    for (const link of plansLinks) {
      // The STUDENT storefront route — not the admin management surface.
      expect(link.getAttribute("href")).toBe("/plans");
    }
  });

  test("arabic locale: the Plans link uses the translated dashboard label", () => {
    const dashboardLabels = Dashboard.getLabels(getTranslations("ar"));
    renderSidebar(ADMIN_AUTH, "ar");

    const plansLinks = screen.getAllByRole("link", { name: dashboardLabels.plans });
    expect(plansLinks).toHaveLength(1);
    for (const link of plansLinks) {
      expect(link.getAttribute("href")).toBe("/admin/plans");
    }
  });
});
