"use client";

/**
 * UserDetailInlineDialogs — the inline edit / delete-reactivate / certify
 * dialogs of the admin user DETAIL page, extracted from
 * `AdminUserDetailContainer`.
 *
 * Uses the SAME shared dialogs the directory invokes (`EditUserDialog` /
 * `DeleteConfirmDialog`) plus the certify dialog (`CertifyTeacherDialog` —
 * detail page only). The no-try/catch contract documented in those modules
 * holds: rejections propagate into each dialog's own submit / confirm
 * handler so VALIDATION field errors project inline,
 * USER_SELF_DEACTIVATION_FORBIDDEN keeps the delete dialog open with its
 * warning alert, and the TEACHER_* conflict codes project inside the
 * certify dialog. Only success closes the dialog, raises the success
 * snackbar, and refetches the activity timeline (the mutation appended an
 * audit row).
 */

import type { ReactNode } from "react";
import type { AdminUserDetailQuery_adminUserDetail } from "@/frontend/graphql/generated/gql/graphql";
import { CertifyTeacherDialog, DeleteConfirmDialog, EditUserDialog } from "@/frontend/views/admin/users/dialogs";
import type { useAdminUserDetail } from "@/frontend/views/admin/users/hooks";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type AdminUserDetailState = ReturnType<typeof useAdminUserDetail>;

interface UserDetailInlineDialogsProps {
  readonly labels: AdminUsersLabels;
  readonly user: AdminUserDetailQuery_adminUserDetail;
  readonly detail: AdminUserDetailState;
}

export function UserDetailInlineDialogs({ labels, user, detail }: UserDetailInlineDialogsProps): ReactNode {
  const isReactivate = user.isDeleted ?? false;
  return (
    <>
      {detail.editOpen && (
        <EditUserDialog
          labels={labels}
          user={user}
          loading={detail.updateLoading}
          onClose={() => detail.setEditOpen(false)}
          onSubmit={async input => {
            // NO try/catch — rejections propagate into the dialog's submit
            // handler for inline field-error projection (see EditUserDialog).
            await detail.updateUser({ variables: { id: user.id, input } });
            detail.setEditOpen(false);
            detail.setSnackbarMessage(labels.snackbars.updated);
            // The mutation appended an audit row — refresh the timeline.
            void detail.refetchActivity();
          }}
        />
      )}

      {detail.certifyState.targetUser && (
        <CertifyTeacherDialog
          labels={labels}
          targetUser={detail.certifyState.targetUser}
          loading={detail.certifyLoading}
          onResolve={async makeEvaluator => {
            const targetUser = detail.certifyState.targetUser;
            if (makeEvaluator === null || !targetUser) {
              detail.setCertifyTarget(null);
              return;
            }
            // NO try/catch — rejections propagate into the dialog's confirm
            // handler: TEACHER_* codes project as the inline warning alert.
            await detail.certifyUser({ variables: { userId: targetUser.id, makeEvaluator } });
            detail.setCertifyTarget(null);
            detail.setSnackbarMessage(labels.snackbars.certified);
            // The mutation appended an audit row — refresh the timeline.
            void detail.refetchActivity();
          }}
        />
      )}

      {detail.deleteOpen && (
        <DeleteConfirmDialog
          labels={labels}
          user={user}
          loading={detail.deleteLoading}
          onClose={() => detail.setDeleteOpen(false)}
          onConfirm={async () => {
            // NO try/catch — rejections propagate into the dialog's confirm
            // handler: USER_SELF_DEACTIVATION_FORBIDDEN keeps the dialog open
            // with the warning alert; other codes leave it open for retry.
            await detail.setDeleted({ variables: { id: user.id, deleted: !isReactivate } });
            detail.setDeleteOpen(false);
            detail.setSnackbarMessage(isReactivate ? labels.snackbars.reactivated : labels.snackbars.deleted);
            // The mutation appended an audit row — refresh the timeline.
            void detail.refetchActivity();
          }}
        />
      )}
    </>
  );
}
