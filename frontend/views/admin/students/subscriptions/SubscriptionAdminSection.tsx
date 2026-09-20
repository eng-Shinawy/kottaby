"use client";

/**
 * SubscriptionAdminSection — the admin student drawer's subscription-
 * management surface. Renders the addressed student's
 * subscriptions (the `adminStudentSubscriptions` read, newest-first) with
 * per-status lifecycle actions, and hosts the four action dialogs
 * (extend / renew / cancel / change plan) plus the shared feedback
 * snackbar.
 *
 * Mount point: `AdminStudentDetailDrawer`, directly below the balances
 * section — the page is `withPageAuth([Admin])`-gated, so the section (and
 * its mutations) only ever render inside the admin directory drawer.
 *
 * Data flow: the section is the query host (the drawer itself stays
 * presentational); rows come from the shared `TypedDocumentNode` document
 * with `cache-and-network` so refetches after a mutation keep the current
 * rows visible while the fresh list streams in. The admin plan catalog
 * feeds the change-plan selector (client-side same-lane eligibility via
 * the pure helper — cross-lane migration is out of scope server-side).
 *
 * Errors: the read surfaces through the directory error-alert recipe
 * (title/message/retry + the canonical code suffix) — the change-plan
 * dialog mirrors the same recipe when the plan-catalog read fails;
 * mutation denials arrive server-localized and render inside their dialog
 * until dismissed.
 * Successes report through the shared snackbar with the namespace's copy —
 * the plan-change toast carries the payload's proration numbers.
 *
 * MUI v9 `sx`-only styling, theme tokens only, every string through the
 * `subscriptionAdmin` namespace (`common` for the dialog dismiss label).
 */
import { useQuery } from "@apollo/client/react";
import { type ReactNode, useState } from "react";
import { adminStudentSubscriptionsQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments/billing";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { DirectoryDrawerSection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import { DirectoryFeedbackSnackbar } from "@/frontend/views/admin/directory-shared/DirectoryFeedbackSnackbar";
import { SubscriptionActionDialogs } from "@/frontend/views/admin/students/subscriptions/dialogs";
import {
  type OpenSubscriptionDialogKind,
  useSubscriptionAdminActions,
  useSubscriptionDialogController,
} from "@/frontend/views/admin/students/subscriptions/hooks";
import { SubscriptionCopyDigestButton } from "@/frontend/views/admin/students/subscriptions/SubscriptionCopyDigestButton";
import { SubscriptionRowsView } from "@/frontend/views/admin/students/subscriptions/SubscriptionRowsView";
import {
  countByStatus,
  filterByStatus,
  nextExpiryBound,
  type SubscriptionRow,
  type SubscriptionStatusFilter,
  sortNewestFirst,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { buildStudentDigestText } from "@/frontend/views/admin/students/subscriptions/subscriptionDigestComposer";
import type { DirectorySnackbar } from "@/frontend/views/admin/users/directory";
import { AdminUsers, SubscriptionAdmin, useAppLocale, useAppTranslation } from "@/shared/locale";

interface SubscriptionAdminSectionProps {
  /** The addressed student's user id (the read surface's owner argument). */
  readonly userId: string | number;
}

export function SubscriptionAdminSection({ userId }: SubscriptionAdminSectionProps): ReactNode {
  const labels = useAppTranslation(SubscriptionAdmin);
  // The adminUsers activity block single-sources the audit action labels
  // (the same slot the audit-trail table's chips read through
  // `actionLabelsOf`) — the drawer's trail teaser and the trail's full
  // listing can never drift apart.
  const adminUsersLabels = useAppTranslation(AdminUsers);
  const locale = useAppLocale();
  const [snackbar, setSnackbar] = useState<DirectorySnackbar | null>(null);
  // The status filter lens — a pure view state (the fetched rows stay
  // untouched; the chips' math rides the pure helpers) that resets
  // naturally with the drawer's per-student remount.
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatusFilter>("all");

  const {
    data,
    previousData,
    loading,
    error: queryError,
    refetch,
  } = useQuery(adminStudentSubscriptionsQueryDocument, {
    variables: { userId },
    fetchPolicy: "cache-and-network",
  });

  // The admin plan catalog feeds the change-plan selector (active plans
  // only — the eligibility helper re-filters per source row anyway). The
  // loading flag rides along so the change-plan dialog renders a disabled
  // select while the catalog streams in instead of falsely claiming that
  // no eligible plan exists; a settled failure rides along too so the
  // dialog offers the directory error-alert recipe with a retry instead
  // of the "no eligible plan" copy.
  const {
    data: plansData,
    loading: plansLoading,
    error: plansError,
    refetch: refetchPlans,
  } = useQuery(adminPlansQueryDocument, {
    variables: { includeInactive: false },
    fetchPolicy: "cache-and-network",
  });

  const actions = useSubscriptionAdminActions({
    refetch: () => {
      void refetch();
    },
    onSuccess: message => {
      setSnackbar({ message, severity: "success" });
    },
    labels,
  });

  // The lifecycle-dialog state machine: which dialog is open for which
  // row, plus the shared submit pipeline every dialog flows through.
  const dialogs = useSubscriptionDialogController();

  // Opening the change-plan dialog re-streams the plan catalog first —
  // the selector must never offer a plan deactivated (or miss one
  // created) since the section mounted, and the in-flight refetch keeps
  // the select disabled instead of falsely claiming an empty lane.
  const openDialogFor = (kind: OpenSubscriptionDialogKind, row: SubscriptionRow): void => {
    if (kind === "changePlan") {
      void refetchPlans();
    }
    dialogs.openDialogFor(kind, row);
  };

  // `errorPolicy: "none"` (the default) drops `data` on a failed refetch;
  // `previousData` keeps the last good list visible beside the alert.
  const rows = sortNewestFirst((data ?? previousData)?.adminStudentSubscriptions ?? []);
  const counts = countByStatus(rows);
  const filteredRows = filterByStatus(rows, statusFilter);
  const nextBound = nextExpiryBound(rows);

  // The copy-digest text — rebuilt on every settled render (the rows are
  // few; the composition is string joins) through the pure composer.
  const digest = buildStudentDigestText({ rows, studentId: userId, nextBound, labels, locale });

  const retryQuery = (): void => {
    void refetch();
  };

  const retryPlansQuery = (): void => {
    void refetchPlans();
  };

  return (
    <DirectoryDrawerSection
      label={labels.title}
      action={
        rows.length > 0 ? (
          <SubscriptionCopyDigestButton
            digest={digest}
            copyLabel={labels.digest.copy}
            copiedLabel={labels.digest.copied}
          />
        ) : null
      }
    >
      <SubscriptionRowsView
        rows={rows}
        filteredRows={filteredRows}
        statusFilter={statusFilter}
        counts={counts}
        nextBound={nextBound}
        loading={loading}
        hasQueryError={Boolean(queryError)}
        errorCode={queryError ? extractErrorCode(queryError) : null}
        labels={labels}
        locale={locale}
        activityLabels={adminUsersLabels.activity}
        onOpenDialog={openDialogFor}
        onSelectFilter={setStatusFilter}
        onRetry={retryQuery}
      />
      <SubscriptionActionDialogs
        controller={dialogs}
        actions={actions}
        plans={plansData?.adminPlans ?? []}
        plansLoading={plansLoading}
        plansError={Boolean(plansError)}
        plansErrorCode={plansError ? extractErrorCode(plansError) : null}
        onRetryPlans={retryPlansQuery}
      />
      <DirectoryFeedbackSnackbar snackbar={snackbar} onClose={() => setSnackbar(null)} />
    </DirectoryDrawerSection>
  );
}
