"use client";

/**
 * useDirectorySnackbar — the shared feedback-snackbar channel of the admin
 * directory hooks: one `DirectorySnackbar | null` slot plus a `show`
 * (success lane by default; export flows also report warning / error) and a
 * `clear`. Both teachers hooks render the identical MUI `Snackbar` + filled
 * `Alert` recipe around the returned slice.
 */

import { useState } from "react";
import type { DirectorySnackbar, DirectorySnackbarSeverity } from "@/frontend/views/admin/users/directory";

export function useDirectorySnackbar() {
  const [snackbar, setSnackbar] = useState<DirectorySnackbar | null>(null);
  // The shared feedback channel — copy-email reports on the success lane;
  // export feedback may report on the warning (truncated) / error lanes.
  const showSnackbar = (message: string, severity: DirectorySnackbarSeverity = "success") => {
    setSnackbar({ message, severity });
  };
  const clearSnackbar = () => {
    setSnackbar(null);
  };
  return { snackbar, showSnackbar, clearSnackbar };
}
