/**
 * Hero-action gate helpers — pure visibility predicates for the admin
 * user-DETAIL hero actions (extracted so the gating matrix is test-locked
 * at the pure logic tier, the `applicant-cooldown-state.helpers`
 * precedent).
 *
 * The order-re-evaluation affordance is the certified-teacher mirror image
 * of the certify slot: certify targets the not-yet-approved applicant
 * (gated inline in `UserHeroActions`), ordering a re-evaluation targets
 * the APPROVED teacher — rendered ONLY for a user whose role is
 * `teacher` AND whose teacher row is certified. The account-governance
 * guard (deleted / blocked / suspended) mirrors the certify slot — a
 * governed account cannot be acted on. This is a UI affordance gate only:
 * the server re-asserts the admin scope and the subject's certification on
 * every mutation (the UI is not the authz boundary).
 */

import { UserRole } from "@/frontend/graphql/generated/gql/graphql";

/** Minimal projection the gate reads — the detail user structurally satisfies it. */
export interface ReEvaluationGateUser {
  readonly role: UserRole;
  readonly teacher: { readonly isApproved: boolean | null } | null;
  readonly isDeleted: boolean | null;
  readonly isBlocked: boolean | null;
  readonly suspended: boolean | null;
}

/**
 * Whether the hero renders the "Order re-evaluation" action: role Teacher
 * + a teacher snapshot that is certified (`isApproved === true`) + the
 * account not governed (deleted / blocked / suspended). Users of any other
 * role — and uncertified/de-certified teachers — never see it (the server
 * additionally denies them with `TEACHER_NOT_CERTIFIED`).
 */
export function isOrderReEvaluationActionVisible(user: ReEvaluationGateUser): boolean {
  const isGoverned = (user.isDeleted ?? false) || (user.isBlocked ?? false) || (user.suspended ?? false);
  return user.role === UserRole.Teacher && user.teacher?.isApproved === true && !isGoverned;
}
