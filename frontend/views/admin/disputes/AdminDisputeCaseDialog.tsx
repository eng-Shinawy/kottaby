"use client";

import { useQuery } from "@apollo/client/react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { AdminDisputeCaseQuery } from "@/frontend/graphql/generated/gql/graphql";
import { adminDisputeCaseQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { AdminDisputeCaseArtifacts } from "@/frontend/views/admin/disputes/AdminDisputeCaseArtifacts";
import { AdminDisputeCaseAuditTrail } from "@/frontend/views/admin/disputes/AdminDisputeCaseAuditTrail";
import { AdminDisputeCaseSessionFacts } from "@/frontend/views/admin/disputes/AdminDisputeCaseSessionFacts";
import { DisputeCaseErrorSlot } from "@/frontend/views/shared/disputes/DisputeCasePrimitives";
import { Common, Sessions, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * AdminDisputeCaseDialog — the ADMIN case-review read for one disputed
 * session (`/disputes`, "Review case"): a single stateful
 * `adminDisputeCase` query renders the full evidence bundle — the session
 * detail (escrow class, fee, dispute moment + reason), the teacher report
 * (with the student rating), the homework row, the recitation record and
 * the session-scoped audit trail.
 *
 * Honesty contract: absent evidence artifacts arrive as honest `null`s and
 * render as localized empty-state lines — the dialog NEVER fabricates
 * placeholder data. The state matrix mirrors the arbitration queue body:
 * `aria-busy` skeleton → denial fallback (`PermissionDeniedFallback` for
 * the mapping-table denial family — the admin gate is SERVER-owned, this
 * surface carries no role logic) → generic inline alert → the bundle.
 *
 * Mobile: the SAME responsive dialog geometry the `/disputes` dialogs
 * already ship (fullWidth + theme-aware paper, ≥44px touch target on the
 * close action) — no route or navigation additions.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, `*Outlined`
 * icons only, RTL-safe logical composition.
 */

interface AdminDisputeCaseDialogProps {
  /** Id of the disputed session under review (the case query's closed variable). */
  readonly sessionId: string;
  readonly open: boolean;
  /** Dismiss intent — the close action and the dismissal gate both route here. */
  readonly onClose: () => void;
}

/** The admin case-review dialog: one query, four evidence sections, honest nulls. */
export function AdminDisputeCaseDialog({ sessionId, open, onClose }: Readonly<AdminDisputeCaseDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const tc = useAppTranslation(Common);
  const locale = useAppLocale();

  const { data, loading, error } = useQuery(adminDisputeCaseQueryDocument, {
    variables: { id: sessionId },
  });

  let body: ReactNode;
  if (loading && data === undefined) {
    // First fetch for this case: the `aria-busy` skeleton — no fabricated
    // section shells that could be mistaken for empty artifacts.
    body = <AdminDisputeCaseLoading />;
  } else if (error) {
    const rawCode = extractErrorCode(error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    body =
      action?.kind === "permission-fallback" || action?.kind === "auth-recovery" ? (
        <PermissionDeniedFallback />
      ) : (
        <DisputeCaseErrorSlot testId="admin-dispute-case-error" message={t.genericError} />
      );
  } else if (!data) {
    body = <AdminDisputeCaseLoading />;
  } else {
    const disputeCase: AdminDisputeCaseQuery["adminDisputeCase"] = data.adminDisputeCase;
    body = (
      <Stack sx={{ gap: 3 }}>
        <AdminDisputeCaseSessionFacts
          session={disputeCase.session}
          studentName={disputeCase.studentName}
          teacherName={disputeCase.teacherName}
          t={t}
          locale={locale}
        />
        <AdminDisputeCaseArtifacts disputeCase={disputeCase} t={t} />
        <AdminDisputeCaseAuditTrail entries={disputeCase.auditTrail} t={t} locale={locale} />
      </Stack>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
      data-testid="admin-dispute-case-dialog"
      aria-labelledby="admin-dispute-case-title"
    >
      <DialogTitle id="admin-dispute-case-title" sx={theme => ({ color: theme.palette.onSurface })}>
        {t.caseReviewTitle}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 3 }}>{body}</DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} data-testid="admin-dispute-case-close" sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}>
          {tc.close}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Stable skeleton keys — never the render-time array index. */
const CASE_LOADING_KEYS: readonly string[] = ["case-loading-session", "case-loading-report", "case-loading-trail"];

/** The case dialog's `aria-busy` loading slot — bare skeleton lines. */
function AdminDisputeCaseLoading(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="admin-dispute-case-loading" sx={{ gap: 2, py: 2 }}>
      {CASE_LOADING_KEYS.map(key => (
        <Skeleton key={key} variant="rounded" sx={{ height: 56 }} />
      ))}
    </Stack>
  );
}
