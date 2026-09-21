import { Stack } from "@mui/material";
import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { DashboardView } from "@/frontend/views/dashboard";
import { ParentUpNextCard } from "@/frontend/views/parent/dashboard";
import {
  HandshakeCodeCard,
  PendingParentLinkRequestsCard,
  StudentUpNextCard,
} from "@/frontend/views/students/dashboard";
import { ApplicantStatusCard, TeacherUpNextCard } from "@/frontend/views/teachers/dashboard";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * Shared role-gated dashboard page factory.
 *
 * Creates a Server Component page that:
 *  1. Calls `withPageAuth({ roles: [role] })` — verifies the caller is
 *     authenticated AND holds the specified role. Anonymous callers redirect
 *     to `/login?redirect=<path>`; role mismatches redirect to `/dashboard`.
 *  2. Renders the `DashboardView` client component, composing a
 *     role-specific content slot ABOVE the stat grid:
 *
 *     - Teacher → `<ApplicantStatusCard />` + `<TeacherUpNextCard />`
 *       composed as siblings. The applicant card is
 *       a pure UI affordance: the page guard above stays the only server-side
 *       boundary, the zero-argument `myApplicantProfile` query answers
 *       identity server-side, and applicant vs certified presentation comes
 *       entirely from the query payload. The up-next card follows the same
 *       additive pattern (zero-prop client component, the identity-scoped
 *       `myTeacherSessions` read) — no new routes, no
 *       extra guard logic.
 *     - Student → `<HandshakeCodeCard />` + `<PendingParentLinkRequestsCard />`
 *       + `<StudentUpNextCard />`
 *       composed as siblings inside a Stack. Same additive
 *       pattern: all three cards are zero-prop client components whose
 *       identity-scoped queries (`myHandshakeCode`,
 *       `myIncomingParentLinkRequests`, `myStudentSessions`, `myHomework`)
 *       answer identity server-side, and they mount inside the
 *       EXISTING student dashboard surface (no new student route, no
 *       `DashboardView` contract change). The pending-requests card renders
 *       `null` when the actionable queue is empty, and the up-next card
 *       degrades per-block on its own query failures. The hooks live
 *       INSIDE each card component — composition here is plain JSX, so no
 *       conditional-hook surface exists.
 *     - Parent → `<ParentUpNextCard />` — the same additive pattern, the
 *       third role card on the shared Up Next primitives: a zero-prop
 *       client component whose identity-scoped `myChildrenUpcomingSessions`
 *       read answers one glance block per confirmed-linked child
 *       server-side (no new parent route, no `DashboardView` contract
 *       change, and the page guard above stays the only authorization
 *       boundary).
 *     - Other roles → nothing (slot empty; their dashboards unchanged).
 *
 * Extracted to eliminate jscpd duplicates across the 4 role dashboard pages
 * (student, teacher, parent, admin).
 */
export async function createRoleDashboardPage(role: UserRole, path: string): Promise<React.ReactElement> {
  await withPageAuth({ roles: [role], redirectTo: path });
  return <DashboardView statusSlot={resolveStatusSlot(role)} />;
}

/**
 * Server-side composition of the role-specific dashboard content slot —
 * this factory adds no client-side gating of its own; the page guard above
 * stays the only authorization boundary.
 */
function resolveStatusSlot(role: UserRole): React.ReactNode {
  switch (role) {
    case UserRole.Teacher:
      return (
        <Stack sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <ApplicantStatusCard />
          <TeacherUpNextCard />
        </Stack>
      );
    case UserRole.Student:
      return (
        <Stack sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <HandshakeCodeCard />
          <PendingParentLinkRequestsCard />
          <StudentUpNextCard />
        </Stack>
      );
    case UserRole.Parent:
      return <ParentUpNextCard />;
    default:
      return undefined;
  }
}

/** Metadata helper for role dashboard pages — brand title follows the active locale. */
export async function roleDashboardMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).dashboardTranslations;
  return { title: t.title };
}
