"use client";

import { Button, Card, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  displayLinkRequestStatus,
  isLinkRequestActionable,
  parentLinkStatusChipSpec,
} from "@/frontend/lib/parent-link-request-status";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * OutgoingLinkRequestCard — one outgoing link request on the parent
 * handshake surface: the target student's MASKED name
 * (`dir="auto"` — the masked-name contract: the parent side never
 * receives a full student name), the computed status chip (shared
 * read-purity machinery), the sent + expiry lines, and — ONLY on
 * live-pending rows — the Cancel affordance (≥44px, focus-visible ring,
 * in-flight disable).
 */

/** The cancel payload snapshotted when the user opens the cancel dialog. */
export interface PendingCancellation {
  readonly requestId: string;
}

interface OutgoingLinkRequestCardProps {
  readonly row: MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests;
  /** `parentLink` namespace labels (property access only). */
  readonly labels: ParentLinkLabels;
  /** Active app locale (drives the locale-aware timestamp stamps). */
  readonly locale: string;
  /** The mount-captured `now` (computed-expiry parity). */
  readonly nowMs: number;
  /** A cancel mutation is in flight (global in-flight disable). */
  readonly cancelInFlight: boolean;
  /** Opens the cancel dialog for this row. */
  readonly onCancel: (cancellation: PendingCancellation) => void;
}

export function OutgoingLinkRequestCard({
  row,
  labels,
  locale,
  nowMs,
  cancelInFlight,
  onCancel,
}: Readonly<OutgoingLinkRequestCardProps>): ReactNode {
  const chipSpec = parentLinkStatusChipSpec(labels);
  const actionable = isLinkRequestActionable(row.status, row.expiresAt, nowMs);
  const displayStatus = displayLinkRequestStatus(row.status, row.expiresAt, nowMs);

  return (
    <Card
      variant="outlined"
      data-testid="parent-outgoing-row"
      sx={theme => ({
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderColor: theme.palette.border.main,
      })}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle1" component="p" dir="auto" sx={{ fontWeight: 700 }}>
          {row.studentMaskedName}
        </Typography>
        <Chip
          size="small"
          color={chipSpec[displayStatus].color}
          label={chipSpec[displayStatus].label}
          sx={{ flexShrink: 0 }}
        />
      </Stack>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.sentAtLabel}: {formatApplicantDate(row.createdAt, locale)}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.expiresLine(formatApplicantDate(row.expiresAt, locale))}
      </Typography>
      {actionable ? (
        <Button
          type="button"
          variant="outlined"
          color="error"
          disabled={cancelInFlight}
          onClick={() => onCancel({ requestId: row.id })}
          sx={{
            ...focusVisibleRingSx,
            minHeight: 44,
            width: { xs: "100%", sm: "auto" },
            alignSelf: { sm: "flex-end" },
            marginTop: 0.5,
          }}
        >
          {labels.cancelAction}
        </Button>
      ) : null}
    </Card>
  );
}
