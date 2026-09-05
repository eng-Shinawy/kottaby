"use client";

import { Button, Card, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  displayLinkRequestStatus,
  isLinkRequestActionable,
  parentLinkStatusChipSpec,
} from "@/frontend/lib/parent-link-request-status";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * LinkRequestCard — one incoming parent-link request on the student
 * `/student/link-requests` surface: the requesting
 * parent's FULL name (`dir="auto"` — the sanctioned disclosure on the
 * student side, Workflow 04 §4.4), the computed status chip
 * (success/warning/error theme-palette roles), the sent + expiry lines, and
 * — ONLY on live-pending rows — the Confirm/Reject affordances (≥44px,
 * focus-visible ring, in-flight disable).
 *
 * The computed-status machinery (read purity + chip palette) is the
 * SHARED `frontend/lib/parent-link-request-status.ts` module — the same
 * helpers the parent-side `OutgoingLinkRequestCard` consumes, so a given
 * row state can never render two different verdicts or palettes across the
 * two surfaces.
 */

/**
 * The decision payload snapshotted when the user opens the confirm/reject
 * dialog — the dialog copy interpolates exactly the parent name the user
 * saw on the row, even if a background refetch lands mid-decision.
 */
export interface PendingDecision {
  readonly requestId: string;
  readonly accept: boolean;
  readonly parentName: string;
}

interface LinkRequestCardProps {
  readonly row: MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests;
  /** `parentLink` namespace labels (property access only). */
  readonly labels: ParentLinkLabels;
  /** Active app locale (drives the locale-aware timestamp stamps). */
  readonly locale: string;
  /** The mount-captured `now` (computed-expiry parity). */
  readonly nowMs: number;
  /** A respond mutation is in flight (global in-flight disable). */
  readonly respondInFlight: boolean;
  /** Opens the confirm/reject decision dialog for this row. */
  readonly onDecide: (decision: PendingDecision) => void;
}

export function LinkRequestCard({
  row,
  labels,
  locale,
  nowMs,
  respondInFlight,
  onDecide,
}: Readonly<LinkRequestCardProps>): ReactNode {
  const chipSpec = parentLinkStatusChipSpec(labels);
  const actionable = isLinkRequestActionable(row.status, row.expiresAt, nowMs);
  const displayStatus = displayLinkRequestStatus(row.status, row.expiresAt, nowMs);

  return (
    <Card
      variant="outlined"
      data-testid="student-link-requests-row"
      sx={theme => ({
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        padding: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderColor: theme.palette.border.main,
      })}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="overline" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
          {labels.fromLabel}
        </Typography>
        <Chip
          size="small"
          color={chipSpec[displayStatus].color}
          label={chipSpec[displayStatus].label}
          sx={{ flexShrink: 0 }}
        />
      </Stack>
      <Typography variant="subtitle1" component="p" dir="auto" sx={{ fontWeight: 700 }}>
        {row.parentFullName}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.sentAtLabel}: {formatApplicantDate(row.createdAt, locale)}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.expiresLine(formatApplicantDate(row.expiresAt, locale))}
      </Typography>
      {actionable ? (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { xs: "stretch", sm: "center" }, justifyContent: { sm: "flex-end" }, marginTop: 0.5 }}
        >
          <Button
            type="button"
            variant="contained"
            disabled={respondInFlight}
            onClick={() => onDecide({ requestId: row.id, accept: true, parentName: row.parentFullName })}
            sx={{ ...focusVisibleRingSx, minHeight: 44, width: { xs: "100%", sm: "auto" } }}
          >
            {labels.confirmAction}
          </Button>
          <Button
            type="button"
            variant="outlined"
            disabled={respondInFlight}
            onClick={() => onDecide({ requestId: row.id, accept: false, parentName: row.parentFullName })}
            sx={{ ...focusVisibleRingSx, minHeight: 44, width: { xs: "100%", sm: "auto" } }}
          >
            {labels.rejectAction}
          </Button>
        </Stack>
      ) : null}
    </Card>
  );
}
