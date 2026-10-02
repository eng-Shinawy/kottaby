"use client";

/**
 * useAdminUserDetail — data, formatter, and inline-dialog wiring for
 * `AdminUserDetailContainer` (the admin user DETAIL page).
 *
 * Owns:
 *  - the locale-bound formatters (`fmtTimestamp` / `fmtDate` / `fmtRelative`),
 *  - the detail query (`adminUserDetail`) and the independent per-user
 *    activity timeline query (scoped `audit_logs` read-back — a timeline
 *    failure never blocks the detail surface, and it refetches after each
 *    successful inline mutation),
 *  - the inline mutations (`adminUpdateUser` / `adminSetUserDeleted` /
 *    `adminCertifyTeacherColdStart` / `adminSetUserPassword`) — the SAME
 *    whitelist operations the directory uses, plus the guarded cold-start
 *    certification; the returned post-write payloads merge into the
 *    `AdminUserDetail:<id>` normalized entity (id-first rule) so the detail
 *    query re-renders automatically,
 *  - the admin-ordered PAID re-evaluation order (`useOrderTeacherReEvaluation`)
 *    — the one inline write whose id-less receipt cannot auto-merge, so the
 *    hook refetches the affected caches (admin user detail + the teacher's
 *    admin wallet view) after each success,
 *  - the edit / delete / certify / change-password / order-re-evaluation
 *    dialog open state and the success snackbar message.
 *
 * Presentation stays in `AdminUserDetailContainer` and the detail cards;
 * this module returns plain state — no JSX.
 */

import { useMutation, useQuery } from "@apollo/client/react";
import { useState } from "react";
import {
  adminCertifyTeacherColdStartMutationDocument,
  adminSetUserDeletedMutationDocument,
  adminSetUserPasswordMutationDocument,
  adminUpdateUserMutationDocument,
  adminUserActivityQueryDocument,
  adminUserDetailQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import type {
  AdminUserCertifyTarget,
  AdminUserChangePasswordTarget,
  AdminUserReEvaluationTarget,
} from "@/frontend/views/admin/users/dialogs";
import { useOrderTeacherReEvaluation } from "@/frontend/views/admin/users/hooks/useOrderTeacherReEvaluation";
import { useUserDetailFormatters } from "@/frontend/views/admin/users/hooks/useUserDetailFormatters";
import { ACTIVITY_TIMELINE_LIMIT } from "@/frontend/views/admin/users/utils";

export function useAdminUserDetail(userId: number) {
  const { fmtTimestamp, fmtDate, fmtRelative } = useUserDetailFormatters();

  const { data, loading, error } = useQuery(adminUserDetailQueryDocument, {
    variables: { id: userId },
    fetchPolicy: "cache-and-network",
  });

  // Per-user activity timeline — independent query so a timeline failure
  // never blocks the detail surface; refetched after each successful inline
  // mutation so a just-written audit row appears immediately (the mutation
  // itself only merges the detail fragment into the cache).
  const {
    data: activityData,
    loading: activityLoading,
    error: activityError,
    refetch: refetchActivity,
  } = useQuery(adminUserActivityQueryDocument, {
    variables: { id: userId, limit: ACTIVITY_TIMELINE_LIMIT },
    fetchPolicy: "cache-and-network",
  });

  // Inline mutations through the SAME shared dialogs the directory uses
  // (`EditUserDialog` / `DeleteConfirmDialog`); Apollo merges the returned
  // post-write fragment into the `AdminUserDetail:<id>` normalized entity.
  const [updateUser, { loading: updateLoading }] = useMutation(adminUpdateUserMutationDocument);
  const [setDeleted, { loading: deleteLoading }] = useMutation(adminSetUserDeletedMutationDocument);
  // Cold-start teacher certification — the returned post-write detail merges
  // into the `AdminUserDetail:<id>` normalized entity, so no refetch is
  // needed (the activity timeline still refetches for the new audit row).
  const [certifyUser, { loading: certifyLoading }] = useMutation(adminCertifyTeacherColdStartMutationDocument);
  // Admin-ordered PAID re-evaluation — the id-less `TeacherReEvaluationOrder`
  // receipt cannot auto-merge, so the hook refetches `AdminUserDetail` +
  // `AdminTeacherWallet` on success; the runner's promise REJECTS on denial
  // so the dialog stays open and maps the `extensions.code` locally.
  const { orderReEvaluation, loading: reEvaluationLoading } = useOrderTeacherReEvaluation();
  // Credential set — same cache-merge semantics; the returned detail carries
  // `mustChangePassword`, so the hero/governance indicator re-renders without
  // a refetch (the activity timeline still refetches for the new audit row).
  const [setUserPassword, { loading: passwordLoading }] = useMutation(adminSetUserPasswordMutationDocument);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [certifyState, setCertifyState] = useState<{ targetUser: AdminUserCertifyTarget | null }>({
    targetUser: null,
  });
  const [reEvaluationState, setReEvaluationState] = useState<{ targetUser: AdminUserReEvaluationTarget | null }>({
    targetUser: null,
  });
  const [changePasswordTarget, setChangePasswordTarget] = useState<AdminUserChangePasswordTarget | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  const errorCode = error ? extractErrorCode(error) : null;
  const openEdit = () => setEditOpen(true);
  const openDelete = () => setDeleteOpen(true);
  const setCertifyTarget = (targetUser: AdminUserCertifyTarget | null) => setCertifyState({ targetUser });
  const setReEvaluationTarget = (targetUser: AdminUserReEvaluationTarget | null) =>
    setReEvaluationState({ targetUser });

  return {
    fmtTimestamp,
    fmtDate,
    fmtRelative,
    data,
    loading,
    errorCode,
    activityData,
    activityLoading,
    activityError,
    refetchActivity,
    updateUser,
    updateLoading,
    setDeleted,
    deleteLoading,
    certifyUser,
    certifyLoading,
    certifyState,
    setCertifyTarget,
    orderReEvaluation,
    reEvaluationLoading,
    reEvaluationState,
    setReEvaluationTarget,
    setUserPassword,
    passwordLoading,
    changePasswordTarget,
    setChangePasswordTarget,
    editOpen,
    setEditOpen,
    deleteOpen,
    setDeleteOpen,
    snackbarMessage,
    setSnackbarMessage,
    openEdit,
    openDelete,
  };
}
