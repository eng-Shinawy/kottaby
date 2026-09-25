/**
 * Route single-source for the admin academic-tracking surface (leaf lib
 * module — route literals are never duplicated across consumers per
 * `frontend/AGENTS.md`).
 *
 * Consumers: the dashboard container's row links and back affordance, and
 * the sidebar nav entry (`frontend/views/dashboard/nav/navItems.ts`).
 */

/** The admin academic-tracking dashboard route. */
export const ACADEMIC_TRACKING_DASHBOARD_ROUTE = "/admin/academic-tracking";

/** Builds a per-student drill-down route for the given student id. */
export function academicTrackingDetailRoute(studentId: number): string {
  return `${ACADEMIC_TRACKING_DASHBOARD_ROUTE}/${studentId}`;
}
