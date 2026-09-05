"use client";

/**
 * DirectoryMutationDialogs — the create / edit / delete-reactivate dialog
 * block of the admin user directory, extracted from
 * `AdminUsersDirectoryContainer`.
 *
 * Renders each dialog conditionally (`createOpen` / `editTarget` /
 * `deleteTarget` come from `useAdminUsersDirectory`) with the same
 * no-try/catch contract documented in `AdminUserDialogs` /
 * `CreateUserDialog`: rejections MUST propagate into the dialog's own submit
 * / confirm handlers so VALIDATION field errors project inline and
 * USER_SELF_DEACTIVATION_FORBIDDEN keeps the dialog open with its warning
 * alert. Only success paths close the dialog and raise the snackbar.
 *
 * `CreateUserDialog` lives in its own module; the edit / delete-confirm
 * dialogs were extracted from AdminUserDialogs into `EditUserDialog.tsx` /
 * `DeleteConfirmDialog.tsx` (still consumed by AdminUserDetailContainer's
 * inline dialog block) — see those files for the error-propagation
 * contract.
 */

import type { ReactNode } from "react";
import { CreateUserDialog, DeleteConfirmDialog, EditUserDialog } from "@/frontend/views/admin/users/dialogs";
import type { useAdminUsersDirectory } from "@/frontend/views/admin/users/hooks";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DirectoryState = ReturnType<typeof useAdminUsersDirectory>;

interface DirectoryMutationDialogsProps {
  readonly labels: AdminUsersLabels;
  readonly directory: DirectoryState;
}

export function DirectoryMutationDialogs({ labels, directory }: DirectoryMutationDialogsProps): ReactNode {
  // Destructured to plain consts so the truthiness checks below narrow the
  // targets inside the async submit/confirm closures (no `!` assertions).
  const { createOpen, editTarget, deleteTarget } = directory;
  return (
    <>
      {createOpen && (
        <CreateUserDialog
          labels={labels}
          loading={directory.createLoading}
          onClose={() => directory.setCreateOpen(false)}
          onSubmit={async input => {
            // NO try/catch here — rejections MUST propagate into the dialog's
            // own submit handler so VALIDATION field errors project inline
            // (`extractFieldErrors` on `extensions.fields`). The dialog closes
            // only on success (this line runs after the mutation resolves).
            await directory.createUser({ variables: { input } });
            directory.setCreateOpen(false);
            directory.setSnackbarMessage(labels.snackbars.created);
          }}
        />
      )}

      {editTarget && (
        <EditUserDialog
          key={editTarget.id}
          labels={labels}
          user={editTarget}
          loading={directory.updateLoading}
          onClose={() => directory.setEditTarget(null)}
          onSubmit={async input => {
            // NO try/catch — rejections propagate into the dialog's submit
            // handler for inline field-error projection (see AdminUserDialogs).
            await directory.updateUser({ variables: { id: editTarget.id, input } });
            directory.setEditTarget(null);
            directory.setSnackbarMessage(labels.snackbars.updated);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          labels={labels}
          user={deleteTarget}
          loading={directory.deleteLoading}
          onClose={() => directory.setDeleteTarget(null)}
          onConfirm={async () => {
            // NO try/catch — rejections propagate into the dialog's confirm
            // handler: USER_SELF_DEACTIVATION_FORBIDDEN keeps the dialog open
            // with the warning alert; other codes leave it open for retry.
            const wasDeleted = deleteTarget.isDeleted;
            await directory.setDeleted({ variables: { id: deleteTarget.id, deleted: !wasDeleted } });
            directory.setDeleteTarget(null);
            directory.setSnackbarMessage(wasDeleted ? labels.snackbars.reactivated : labels.snackbars.deleted);
          }}
        />
      )}
    </>
  );
}
