"use client";

import type { ReactNode } from "react";
import type { AdminSessionsQuery_adminSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { CancelSessionDialog } from "@/frontend/views/admin/session-governance/CancelSessionDialog";
import { ReassignTeacherDialog } from "@/frontend/views/admin/session-governance/ReassignTeacherDialog";
import {
  type ReschedulePair,
  RescheduleSessionDialog,
} from "@/frontend/views/admin/session-governance/RescheduleSessionDialog";

/**
 * AdminSessionGovernanceDialogs — the governance-dialog slot of the admin
 * session-governance container: exactly ONE of the three
 * governance dialogs (reschedule / cancel / reassign) mounts while the
 * container's dialog state targets it; the slot renders nothing while the
 * state is `null`. Pure presentational composition over a fragment (no
 * wrapper element — DOM identical to the inline blocks it moved from): the
 * mutations behind the submit intents live in
 * `useAdminSessionGovernanceActions`, and each dialog's session id is
 * threaded to the container's submit callbacks at CALL time.
 *
 * MUI v9 discipline: `sx`-only styling is owned by the individual dialogs;
 * this slot adds none.
 */

/** Which governance dialog (if any) is open, keyed to its session row. */
export interface GovernanceDialogState {
  readonly kind: "reschedule" | "cancel" | "reassign";
  readonly session: AdminSessionsQuery_adminSessions_items;
}

interface AdminSessionGovernanceDialogsProps {
  /** The open dialog + its session row (`null` = none mounts). */
  readonly dialog: GovernanceDialogState | null;
  readonly rescheduleLoading: boolean;
  readonly cancelLoading: boolean;
  readonly reassignLoading: boolean;
  /** Dismiss intent — every dialog's `onClose` (backdrop / Escape / cancel). */
  readonly onClose: () => void;
  /** Reschedule-submit intent (the hook fires `adminRescheduleSession`). */
  readonly onRescheduleSubmit: (sessionId: string, pair: ReschedulePair) => void;
  /** Cancel-submit intent (the hook threads the attempt's idempotency claim). */
  readonly onCancelSubmit: (sessionId: string, reason: string | null) => void;
  /** Reassign-submit intent (the hook fires `adminReassignTeacher`). */
  readonly onReassignSubmit: (sessionId: string, newTeacherUserId: number) => void;
}

/** The three governance dialogs — exactly one mounts with the dialog state. */
export function AdminSessionGovernanceDialogs({
  dialog,
  rescheduleLoading,
  cancelLoading,
  reassignLoading,
  onClose,
  onRescheduleSubmit,
  onCancelSubmit,
  onReassignSubmit,
}: Readonly<AdminSessionGovernanceDialogsProps>): ReactNode {
  return (
    <>
      {dialog?.kind === "reschedule" ? (
        <RescheduleSessionDialog
          key={dialog.session.id}
          session={dialog.session}
          open
          onClose={onClose}
          loading={rescheduleLoading}
          onSubmit={pair => {
            onRescheduleSubmit(dialog.session.id, pair);
          }}
        />
      ) : null}
      {dialog?.kind === "cancel" ? (
        <CancelSessionDialog
          key={dialog.session.id}
          session={dialog.session}
          open
          onClose={onClose}
          loading={cancelLoading}
          onSubmit={reason => {
            onCancelSubmit(dialog.session.id, reason);
          }}
        />
      ) : null}
      {dialog?.kind === "reassign" ? (
        <ReassignTeacherDialog
          key={dialog.session.id}
          session={dialog.session}
          open
          onClose={onClose}
          loading={reassignLoading}
          onSubmit={newTeacherUserId => {
            onReassignSubmit(dialog.session.id, newTeacherUserId);
          }}
        />
      ) : null}
    </>
  );
}
