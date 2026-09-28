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
 * All chrome copy comes from the `AdminUsers` locale namespace, resolved
 * client-side via `useAppTranslation(AdminUsers)` — the namespace carries
 * interpolation closures (e.g. pluralized chips, dialog warnings) that must
 * never cross the server→client props boundary, so the server page mounts
 * this container label-free. MUI v9 `sx`-only discipline; colors via
 * `theme.palette.*` callbacks; `*Outlined` icons; ≥44px touch targets;
 * responsive (desktop table ≥md, stacked cards below).
 */

import { AddOutlined as AddIcon } from "@mui/icons-material";
import { Fab, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryErrorAlert } from "@/frontend/views/admin/directory-shared/DirectoryErrorAlert";
import { AdminUserSuccessSnackbar, DirectoryMutationDialogs } from "@/frontend/views/admin/users/dialogs";
import {
  ActiveFiltersRow,
  DirectoryResults,
  DirectoryToolbar,
  FilterChipsRow,
} from "@/frontend/views/admin/users/directory";
import { useAdminUsersDirectory } from "@/frontend/views/admin/users/hooks";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";

export function AdminUsersDirectoryContainer(): ReactNode {
  const labels = useAppTranslation(AdminUsers);
  const directory = useAdminUsersDirectory();
  // The copy-email quick action reports success through the shared success
  // snackbar (identical feedback channel as the create/edit/delete writes).
  // The copy-LINK action rides the same channel.
  const handleCopyEmail = () => {
    directory.setSnackbarMessage(labels.quickActions.emailCopied);
  };
  const handleCopyLink = () => {
    directory.setSnackbarMessage(labels.quickActions.linkCopied);
  };
  // Re-fetch the current page after a load failure (transport failure or
  // GraphQL error). The promise is handed to Apollo; rejections re-surface
  // through the same `hasError` state.
  const retryDirectory = () => {
    void directory.refetch();
  };
  // One-click recovery from over-filtering — resets EVERY filter draft
  // (the same page-resetting setters the toolbar's clear button routes
  // through) and is surfaced inside the empty state's CTA slot.
  const clearAllFilters = () => {
    directory.setRoleFilter("");
    directory.setGovernanceFilter("");
    directory.setApplicantStatusFilter("");
    directory.setCooldownStateFilter("");
    directory.setCooldownExpiringSoon(false);
    directory.setCountryFilter("");
    directory.setSearchInput("");
  };
  return (
    // Bottom padding clears the fixed mobile FAB (bottom 24 + 56 height) so
    // the last stacked card never slides under it when scrolled to the end.
    <Stack spacing={3} sx={{ p: { xs: 2, md: 3 }, pb: { xs: 12, md: 4 } }}>
      <Typography variant="h4" component="h1">
        {labels.title}
      </Typography>

      <DirectoryToolbar
        labels={labels}
        roleFilter={directory.roleFilter}
        setRoleFilter={directory.setRoleFilter}
        governanceFilter={directory.governanceFilter}
        setGovernanceFilter={directory.setGovernanceFilter}
        applicantStatusFilter={directory.applicantStatusFilter}
        setApplicantStatusFilter={directory.setApplicantStatusFilter}
        cooldownStateFilter={directory.cooldownStateFilter}
        setCooldownStateFilter={directory.setCooldownStateFilter}
        countryFilter={directory.countryFilter}
        setCountryFilter={directory.setCountryFilter}
        searchInput={directory.searchInput}
        setSearchInput={directory.setSearchInput}
        onCreateUser={() => directory.setCreateOpen(true)}
        onCopyLink={handleCopyLink}
      />

      <FilterChipsRow
        labels={labels}
        roleFilter={directory.roleFilter}
        governanceFilter={directory.governanceFilter}
        cooldownStateFilter={directory.cooldownStateFilter}
        setRoleFilter={directory.setRoleFilter}
        setGovernanceFilter={directory.setGovernanceFilter}
        setCooldownStateFilter={directory.setCooldownStateFilter}
      />

      <ActiveFiltersRow
        labels={labels}
        roleFilter={directory.roleFilter}
        governanceFilter={directory.governanceFilter}
        applicantStatusFilter={directory.applicantStatusFilter}
        cooldownStateFilter={directory.cooldownStateFilter}
        cooldownExpiringSoon={directory.cooldownExpiringSoon}
        countryFilter={directory.countryFilter}
        searchApplied={directory.searchDebounced}
        setRoleFilter={directory.setRoleFilter}
        setGovernanceFilter={directory.setGovernanceFilter}
        setApplicantStatusFilter={directory.setApplicantStatusFilter}
        setCooldownStateFilter={directory.setCooldownStateFilter}
        setCooldownExpiringSoon={directory.setCooldownExpiringSoon}
        setCountryFilter={directory.setCountryFilter}
        setSearchInput={directory.setSearchInput}
      />

      {directory.hasError && (
        <DirectoryErrorAlert labels={labels.errorState} onRetry={retryDirectory} errorCode={directory.firstErrorCode} />
      )}

      <DirectoryResults
        labels={labels}
        directory={directory}
        onCopyEmail={handleCopyEmail}
        onClearFilters={clearAllFilters}
      />

      {/* Mobile-only create affordance — the desktop one lives in the
          toolbar. Fixed at the standard 24px bottom offset (there is no
          bottom nav on this surface), below dialogs. The container's 96px
          mobile `pb` above guarantees scroll clearance below the pagination
          card so this FAB never covers the last content at the bottom of
          the page. */}
      <Fab
        color="primary"
        aria-label={labels.createDialog.title}
        onClick={() => directory.setCreateOpen(true)}
        sx={{ display: { xs: "flex", md: "none" }, position: "fixed", insetInlineEnd: 16, bottom: 24, zIndex: 900 }}
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
