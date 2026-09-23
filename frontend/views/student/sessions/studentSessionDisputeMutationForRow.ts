import type { MyStudentSessionsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { resolveStudentDisputeMutation } from "@/frontend/views/student/sessions/sessionDisputeMutations";

/**
 * The dispute dialog's mutation arm resolves from the disputed row's
 * generation: a post-confirmation row escalates through the
 * post-confirmation document; pre-completion rows (and an unresolved id
 * while the slot mounts, e.g. the list changed under an open dialog) keep
 * the shipped held-escrow document. The operations authorize server-side,
 * so a degraded binding can only surface a localized denial.
 */
export function resolveStudentDisputeMutationForRow(
  data: MyStudentSessionsQuery | undefined,
  disputeDialogSessionId: string | null
): ReturnType<typeof resolveStudentDisputeMutation> {
  const disputedRow =
    disputeDialogSessionId === null || data === undefined
      ? null
      : (data.myStudentSessions.items.find(session => session.id === disputeDialogSessionId) ?? null);
  return resolveStudentDisputeMutation(disputedRow);
}
