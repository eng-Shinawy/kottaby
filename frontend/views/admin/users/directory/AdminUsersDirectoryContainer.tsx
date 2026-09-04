"use client";

/**
 * AdminUsersDirectoryContainer — the admin user directory client surface
 * (presentation only).
 *
 * State, query, and mutation wiring lives in `useAdminUsersDirectory`; the
 * filter/enum narrowing helpers live in `directoryConversions`; the results
 * section (desktop table + mobile card list + paginations) lives in
 * `DirectoryResults`; the create / edit / delete-reactivate dialogs render
 * in `DirectoryMutationDialogs`; the success snackbar closes the loop.
 *
 * Composes:
 *  - `DirectoryToolbar` (search + role/status/country filters + the Create
 *    User button; the mobile quick-filter `FilterChipsRow` sits between the
 *    toolbar and the results),
 *  - a mobile-only create `Fab` (the desktop create affordance lives in the
 *    toolbar),
 *  - create dialog (whitelist input + VALIDATION field-error projection),
 *    edit dialog (whitelist patch), and delete/reactivate confirm dialog
 *    with self-deactivation conflict alert (all in `DirectoryMutationDialogs`).
 *
 * The prototype-parity rework removed the overview stats strip, the
 * role-distribution caption, the legacy filter card, and the raw
 * `TablePagination`; `AdminUserStatsQuery`/`adminUserStatsQueryDocument`
 * remain in the codebase for other surfaces but this page no longer queries
 * them.
 *
 * All chrome copy comes from the `AdminUsers` locale namespace (passed from
 * the server as `labels`). MUI v9 `sx`-only discipline; colors via
 * `theme.palette.*` callbacks; `*Outlined` icons; ≥44px touch targets;
 * responsive (desktop table ≥md, stacked cards below).
 */

import { AddOutlined as AddIcon } from "@mui/icons-material";
import { Alert, Button, Fab, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AdminUserSuccessSnackbar, DirectoryMutationDialogs } from "@/frontend/views/admin/users/dialogs";
import { DirectoryResults, DirectoryToolbar, FilterChipsRow } from "@/frontend/views/admin/users/directory";
import { useAdminUsersDirectory } from "@/frontend/views/admin/users/hooks";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface AdminUsersDirectoryContainerProps {
  readonly labels: AdminUsersLabels;
}

export function AdminUsersDirectoryContainer({ labels }: AdminUsersDirectoryContainerProps): ReactNode {
  const directory = useAdminUsersDirectory();
  // Re-fetch the current page after a load failure (transport failure or
  // GraphQL error). The promise is handed to Apollo; rejections re-surface
  // through the same `hasError` state.
  const retryDirectory = () => {
    void directory.refetch();
  };
  return (
    // Bottom padding clears the fixed mobile FAB (bottom 88 + 56 height) so
    // the last stacked card never slides under it when scrolled to the end.
    <Stack spacing={3} sx={{ p: { xs: 2, md: 3 }, pb: { xs: 20, md: 4 } }}>
      <Typography variant="h4" component="h1">
        {labels.title}
      </Typography>

      <DirectoryToolbar
        labels={labels}
        roleFilter={directory.roleFilter}
        setRoleFilter={directory.setRoleFilter}
        governanceFilter={directory.governanceFilter}
        setGovernanceFilter={directory.setGovernanceFilter}
        countryFilter={directory.countryFilter}
        setCountryFilter={directory.setCountryFilter}
        searchInput={directory.searchInput}
        setSearchInput={directory.setSearchInput}
        onCreateUser={() => directory.setCreateOpen(true)}
      />

      <FilterChipsRow
        labels={labels}
        roleFilter={directory.roleFilter}
        governanceFilter={directory.governanceFilter}
        setRoleFilter={directory.setRoleFilter}
        setGovernanceFilter={directory.setGovernanceFilter}
      />

      {directory.hasError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retryDirectory}>
              {labels.errorState.retry}
            </Button>
          }
        >
          {labels.errorState.title}: {labels.errorState.message}
          {directory.firstErrorCode === null ? "" : ` (${directory.firstErrorCode})`}
        </Alert>
      )}

      <DirectoryResults labels={labels} directory={directory} />

      {/* Mobile-only create affordance — the desktop one lives in the
          toolbar. Fixed above the bottom nav (bottom: 88px), below dialogs.
          The container's 160px mobile `pb` above guarantees scroll clearance
          below the pagination card so this FAB never covers the last
          content at the bottom of the page. */}
      <Fab
        color="primary"
        aria-label={labels.createDialog.title}
        onClick={() => directory.setCreateOpen(true)}
        sx={{ display: { xs: "flex", md: "none" }, position: "fixed", insetInlineEnd: 16, bottom: 88, zIndex: 900 }}
      >
        <AddIcon />
      </Fab>

      <DirectoryMutationDialogs labels={labels} directory={directory} />

      <AdminUserSuccessSnackbar
        message={directory.snackbarMessage}
        onClose={() => directory.setSnackbarMessage(null)}
      />
    </Stack>
  );
}
