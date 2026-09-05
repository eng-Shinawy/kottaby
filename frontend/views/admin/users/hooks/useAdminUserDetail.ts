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
 *    `adminCertifyTeacherColdStart`) — the SAME whitelist operations the
 *    directory uses, plus the guarded cold-start certification; the returned
 *    post-write payloads merge into the `AdminUserDetail:<id>` normalized
 *    entity (id-first rule) so the detail query re-renders automatically,
 *  - the edit / delete / certify dialog open state and the success snackbar
 *    message.
 *
 * Presentation stays in `AdminUserDetailContainer` and the detail cards;
 * this module returns plain state — no JSX.
 */

import { useMutation, useQuery } from "@apollo/client/react";
import { useMemo, useState } from "react";
import {
  adminCertifyTeacherColdStartMutationDocument,
  adminSetUserDeletedMutationDocument,
  adminUpdateUserMutationDocument,
  adminUserActivityQueryDocument,
  adminUserDetailQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { useAppLocale } from "@/frontend/hooks/locale";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import type { AdminUserCertifyTarget } from "@/frontend/views/admin/users/dialogs";
import {
  ACTIVITY_TIMELINE_LIMIT,
  formatDirectoryRelativeTime,
  formatTimestamp,
} from "@/frontend/views/admin/users/utils";

export function useAdminUserDetail(userId: number) {
  const locale = useAppLocale();
  // Intl.DateTimeFormat instances are locale-bound; recreating per render is
  // fine for ~10 timestamps per page. useMemo guards against re-creating
  // for the same locale on every keystroke re-render.
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale]
  );
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  // Server timestamps (lastActiveAt, createdAt, updatedAt, deletedAt,
  // suspendedAt, blockedAt, applicant.lastAttemptAt, applicant.cooldownUntil)
  // arrive as ISO-8601 strings; `dateOfBirth` is a Drizzle `date` column —
  // a calendar `YYYY-MM-DD` string the user reads as a date literal. Both
  // share the same null-guard + NaN-guard + format pipeline.
  const fmtTimestamp = (raw: string | null | undefined): string => formatTimestamp(raw, dateTimeFormatter);
  const fmtDate = (raw: string | null | undefined): string => formatTimestamp(raw, dateFormatter);
  const fmtRelative = (raw: string | null | undefined): string => formatDirectoryRelativeTime(raw, locale);

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
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [certifyState, setCertifyState] = useState<{ targetUser: AdminUserCertifyTarget | null }>({
    targetUser: null,
  });
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  const errorCode = error ? extractErrorCode(error) : null;
  const openEdit = () => setEditOpen(true);
  const openDelete = () => setDeleteOpen(true);
  const setCertifyTarget = (targetUser: AdminUserCertifyTarget | null) => setCertifyState({ targetUser });

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
