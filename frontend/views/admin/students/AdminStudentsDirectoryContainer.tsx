"use client";

/**
 * AdminStudentsDirectoryContainer — the admin student directory client
 * surface (read-only, presentation only).
 *
 * State and query wiring lives in `useAdminStudentsDirectory`; the filter/
 * refresh/export toolbar lives in `AdminStudentsToolbar`; the results
 * section (desktop table + mobile card list + paginations) lives in
 * `AdminStudentsResults`; the feedback snackbar closes the loop.
 *
 * The surface's data operations stay READ-ONLY by design — no edit/delete
 * dialogs and no data mutations exist here. Three affordances round it
 * out: the per-row detail drawer (opened by clicking a row/card or
 * through the explicit view-details quick action — the container owns the
 * single drawer instance and keeps the selected item mounted through the
 * exit transition), the SERVER-SIDE EXPORT-ALL CSV download (the
 * dedicated export query runs with the current filter state, the backend
 * caps the dump and reports `truncated`, and the export flow serializes
 * the rows with the existing pure CSV builder — `studentsCsvExport.ts`),
 * and the DIRECT STUDENT ONBOARDING dialog (the toolbar affordance opens
 * it; the `onboarding/` hooks own the write + feedback wiring and every
 * completed onboarding re-fetches this directory through its live query
 * variables; the success screen's restart affordance keeps the dialog
 * open for back-to-back onboardings).
 *
 * All chrome copy comes from the `AdminStudents` locale namespace, resolved
 * client-side via `useAppTranslation(AdminStudents)` — the page mounts this
 * container label-free so no labels cross the server→client props boundary.
 * MUI v9 `sx`-only discipline; colors via `theme.palette.*` callbacks;
 * `*Outlined` icons; ≥44px touch targets; responsive (desktop table ≥md,
 * stacked cards below).
 */

import { Stack } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import { DirectoryErrorAlert } from "@/frontend/views/admin/directory-shared/DirectoryErrorAlert";
import { DirectoryFeedbackSnackbar } from "@/frontend/views/admin/directory-shared/DirectoryFeedbackSnackbar";
import { DirectoryPageHeader } from "@/frontend/views/admin/directory-shared/DirectoryPageHeader";
import { DirectoryScrollToTop } from "@/frontend/views/admin/directory-shared/DirectoryScrollToTop";
import { AdminStudentDetailDrawer } from "@/frontend/views/admin/students/AdminStudentDetailDrawer";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { AdminStudentsResults } from "@/frontend/views/admin/students/AdminStudentsResults";
import { AdminStudentsToolbar } from "@/frontend/views/admin/students/AdminStudentsToolbar";
import {
  useAdminStudentsDirectory,
  useDirectoryCohortPanels,
  useOnboardingDirectoryFlow,
} from "@/frontend/views/admin/students/hooks";
import { OnboardingHistoryDialog } from "@/frontend/views/admin/students/OnboardingHistoryDialog";
import { OnboardStudentDialog } from "@/frontend/views/admin/students/onboarding";
import { runStudentsCsvExport } from "@/frontend/views/admin/students/studentsCsvExport";
import { useAppLocale } from "@/shared/locale";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminStudents } from "@/shared/locale/namespaces/adminStudents";

export function AdminStudentsDirectoryContainer(): ReactNode {
  const labels = useAppTranslation(AdminStudents);
  const locale = useAppLocale();
  const directory = useAdminStudentsDirectory();
  // Direct student onboarding — the surface's one write affordance: the
  // onboarding hooks own the mutation + feedback wiring, and every completed
  // onboarding re-fetches this directory through its live query variables.
  // The option feeds gate on the dialog being open — browse-only visits issue
  // no option reads; the loading flags keep the submit unavailable till both
  // option sets resolve.
  // Direct student onboarding — the surface's one write affordance, with
  // its open/success/feedback/recent-history orchestration extracted into
  // the flow hook (the option feeds gate on the dialog being open).
  const onboarding = useOnboardingDirectoryFlow(directory.variables);
  // Highlight mode + history dialog — the directory's device-scoped cohort
  // panels (highlight persists through a versioned localStorage preference;
  // the history dialog opens over the SAME localStorage-backed record).
  const cohort = useDirectoryCohortPanels();
  // Lowercased email set of the recent onboardings — the directory rows'
  // "recently onboarded" chip match (localStorage-backed, credential-free).
  const recentEmails = useMemo(
    () => new Set(onboarding.recent.map(entry => entry.email.toLowerCase())),
    [onboarding.recent]
  );
  // Single detail-drawer instance — `selectedStudent` stays mounted through
  // the drawer's exit transition (only `drawerOpen` flips on close).
  const [selectedStudent, setSelectedStudent] = useState<StudentDirectoryItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openStudentDetails = (student: StudentDirectoryItem) => {
    setSelectedStudent(student);
    setDrawerOpen(true);
  };
  // The copy-email quick action shares the directory's feedback snackbar.
  const handleCopyEmail = () => {
    directory.showSnackbar(labels.quickActions.emailCopied);
  };
  // Server-side EXPORT-ALL (the flow lives in `studentsCsvExport.ts`): the
  // dedicated export query runs with the CURRENT filter state, then the rows
  // serialize through the EXISTING pure CSV builder and download.
  const handleExportCsv = (): Promise<void> => runStudentsCsvExport(directory, labels);
  // Re-fetch the current page after a load failure; rejections re-surface through `hasError`.
  const retryDirectory = () => void directory.refetch();
  return (
    <Stack spacing={3} sx={{ p: { xs: 2, md: 3 } }}>
      <DirectoryPageHeader title={labels.title} subtitle={labels.subtitle} />

      <AdminStudentsToolbar
        labels={labels}
        directory={directory}
        loading={directory.loading}
        hasFilters={directory.hasFilters}
        onExportCsv={() => {
          void handleExportCsv();
        }}
        exportLoading={directory.exportLoading}
        exportDisabled={directory.exportLoading || directory.loading || directory.total === 0}
        onOnboardStudent={onboarding.openOnboarding}
        onboardDisabled={onboarding.onboardingOpen || onboarding.submitting}
        highlightRecent={cohort.highlightRecent}
        onToggleHighlightRecent={cohort.toggleHighlightRecent}
        onOpenHistory={cohort.openHistory}
        onCopyLink={() => {
          directory.showSnackbar(labels.quickActions.linkCopied);
        }}
      />

      {directory.hasError && (
        <DirectoryErrorAlert labels={labels.errorState} onRetry={retryDirectory} errorCode={directory.firstErrorCode} />
      )}

      <AdminStudentsResults
        labels={labels}
        directory={directory}
        onCopyEmail={handleCopyEmail}
        onViewDetails={openStudentDetails}
        recentEmails={recentEmails}
        highlightRecent={cohort.highlightRecent}
      />

      <AdminStudentDetailDrawer
        open={drawerOpen}
        student={selectedStudent}
        labels={labels}
        locale={locale}
        onClose={() => {
          setDrawerOpen(false);
        }}
        onCopyEmail={handleCopyEmail}
      />

      <OnboardingHistoryDialog
        open={cohort.historyOpen}
        onClose={cohort.closeHistory}
        entries={onboarding.recent}
        labels={labels}
      />

      <OnboardStudentDialog
        open={onboarding.onboardingOpen}
        onClose={onboarding.closeOnboarding}
        parentOptions={onboarding.parentOptions}
        planOptions={onboarding.planOptions}
        plansLoading={onboarding.plansLoading}
        parentsLoading={onboarding.parentsLoading}
        submitting={onboarding.submitting}
        globalError={onboarding.globalError}
        serverFieldErrors={onboarding.serverFieldErrors}
        onSubmit={onboarding.onSubmit}
        success={onboarding.onboardSuccess}
        recent={onboarding.recent}
        onStartAnother={onboarding.startAnotherOnboarding}
      />

      <DirectoryFeedbackSnackbar snackbar={directory.snackbar} onClose={directory.clearSnackbar} />

      {/* Floating back-to-top — the FAB reveals itself after ~a screenful of scroll. */}
      <DirectoryScrollToTop ariaLabel={labels.scrollBackToTop} />
    </Stack>
  );
}
