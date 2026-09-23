"use client";

/**
 * useDirectoryPageAndDialogs — pagination draft state + the create/edit/
 * delete dialog targets + success snackbar for the admin users directory.
 *
 * The page pair seeds from the URL contract so a shared link lands on the
 * exact paginated position it was copied from (fail-closed parsing clamps
 * junk/out-of-range values back to the defaults).
 */

import { useState } from "react";
import type { DirectoryUserItem } from "@/frontend/views/admin/users/directory";

export function useDirectoryPageAndDialogs(urlPage: number, urlPageSize: number) {
  const [page, setPage] = useState(urlPage);
  const [pageSize, setPageSizeState] = useState(urlPageSize);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DirectoryUserItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DirectoryUserItem | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  const setPageSize = (value: number) => {
    setPageSizeState(value);
    setPage(0);
  };

  return {
    page,
    pageSize,
    setPage,
    setPageSize,
    createOpen,
    setCreateOpen,
    editTarget,
    setEditTarget,
    deleteTarget,
    setDeleteTarget,
    snackbarMessage,
    setSnackbarMessage,
  };
}
