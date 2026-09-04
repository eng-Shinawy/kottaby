"use client";

import { InboxOutlined } from "@mui/icons-material";
import { Alert, Box, Chip, Snackbar, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { LinkStatus } from "@/frontend/graphql/generated/gql/graphql";
import { parentLinkStatusChipSpec } from "@/frontend/lib/parent-link-request-status";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * The cold-load skeleton, the generic failure alert, and the zero-rows
 * composition live in the sibling `IncomingStates.parts.tsx` (150-line view
 * budget); they are re-exported here so the `IncomingBody` / container import
 * paths (and the domain barrel) stay unchanged.
 */
export { IncomingEmptyState, IncomingLoadErrorAlert, IncomingSkeletonList } from "./IncomingStates.parts";

/** Success-toast auto-hide cadence (host toast posture, mark-all precedent). */
const SUCCESS_TOAST_AUTOHIDE_MS = 6000;

/**
 * IncomingHeader — the static page shell: `studentPageTitle` (h1) +
 * `studentPageSubtitle`, copy resolved client-side through the
 * `ParentLink` namespace handle (property access only).
 */
export function IncomingHeader({ labels }: Readonly<{ readonly labels: ParentLinkLabels }>): ReactNode {
  return (
    <Stack spacing={0.5}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        {labels.studentPageTitle}
      </Typography>
      <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.studentPageSubtitle}
      </Typography>
    </Stack>
  );
}

/**
 * Chip order of the status summary strip — pending/confirmed/rejected always
 * render (a zero still reads as a deliberate stat); the computed `expired`
 * chip only joins when at least one row displays it.
 */
const SUMMARY_CHIP_ORDER: readonly LinkStatus[] = [
  LinkStatus.Pending,
  LinkStatus.Confirmed,
  LinkStatus.Rejected,
  LinkStatus.Expired,
];

/**
 * IncomingStatusSummary — the compact per-status count strip above a SHORT
 * request list (≤2 rows, ≥`sm` viewports only — the sparse-inbox composition):
 * outlined chips tallying pending / confirmed / rejected rows. A zero count
 * renders a neutral chip (the strip reads as an intentional stats bar, not a
 * lone badge), and the `expired` chip only appears when a row displays that
 * computed verdict. Counts arrive pre-derived by the caller from the SAME
 * `displayLinkRequestStatus` verdict the row cards render, so the strip can
 * never disagree with the list below it.
 */
export function IncomingStatusSummary({
  counts,
  labels,
}: Readonly<{
  readonly counts: Readonly<Record<LinkStatus, number>>;
  readonly labels: ParentLinkLabels;
}>): ReactNode {
  const chipSpec = parentLinkStatusChipSpec(labels);
  return (
    <Box
      component="section"
      aria-label={labels.listSummaryLabel}
      data-testid="student-link-requests-summary"
      sx={{ display: { xs: "none", sm: "flex" }, alignItems: "center", flexWrap: "wrap", gap: 1 }}
    >
      {SUMMARY_CHIP_ORDER.filter(status => status !== LinkStatus.Expired || counts[status] > 0).map(status => (
        <Chip
          key={status}
          size="small"
          variant="outlined"
          color={counts[status] > 0 ? chipSpec[status].color : "default"}
          label={labels.summaryCountChip(chipSpec[status].label, counts[status])}
        />
      ))}
    </Box>
  );
}

/**
 * IncomingShortListHint — the friendly one-line hint under a SHORT request
 * list (≤2 rows, ≥`sm` viewports only): a muted inbox glyph beside
 * `incomingHintBody` inside a dashed-border card — the dashed outline marks
 * the region as "future content lands here" so the sparse inbox reads as
 * intentional composition rather than dead space.
 */
export function IncomingShortListHint({ labels }: Readonly<{ readonly labels: ParentLinkLabels }>): ReactNode {
  return (
    <Box
      data-testid="student-link-requests-hint"
      sx={theme => ({
        display: { xs: "none", sm: "flex" },
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        px: 2,
        py: 1.5,
        borderRadius: 2,
        border: "1px dashed",
        borderColor: theme.palette.border.main,
      })}
    >
      <InboxOutlined aria-hidden sx={theme => ({ fontSize: 20, flexShrink: 0, color: theme.palette.text.secondary })} />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {labels.incomingHintBody}
      </Typography>
    </Box>
  );
}

/**
 * SuccessToast — the transient localized success snackbar after a Confirm /
 * Reject resolves (`confirmSuccessToast` / `rejectSuccessToast`). The copy
 * arrives preassembled; `null` keeps the snackbar closed.
 */
export function SuccessToast({
  copy,
  onClose,
}: Readonly<{ readonly copy: string | null; readonly onClose: () => void }>): ReactNode {
  return (
    <Snackbar
      open={copy !== null}
      autoHideDuration={SUCCESS_TOAST_AUTOHIDE_MS}
      onClose={(_, reason) => {
        if (reason !== "clickaway") {
          onClose();
        }
      }}
    >
      <Alert
        severity="success"
        variant="filled"
        data-testid="student-link-requests-success-toast"
        sx={{ borderRadius: 2 }}
      >
        {copy}
      </Alert>
    </Snackbar>
  );
}
