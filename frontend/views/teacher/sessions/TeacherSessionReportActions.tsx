"use client";

/**
 * TeacherSessionReportActions — the submit-mode action band pinned to the
 * dialog's scroll edge. The report form outgrows compact viewports, so the
 * band sticks to the bottom of the scrolling paper instead of scrolling out
 * of reach: full-width stacked arms on compact widths (primary trailing),
 * an inline right-aligned row on sm+. The band bleeds over the dialog
 * content's padding so the hairline spans the full paper width.
 */

import { Box, Button } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

interface TeacherSessionReportActionsProps {
  /** Labels for the submit/cancel pair (the sessions namespace slice). */
  readonly t: Pick<SessionsLabels, "reportSubmitLabel" | "reportCancelLabel">;
  /** Disables both arms while the report mutation is in flight. */
  readonly submitLoading: boolean;
  /** Cancel intent — the dialog owns the close. */
  readonly onClose: () => void;
}

/** The sticky submit/cancel band one submit-mode report form renders last. */
export function TeacherSessionReportActions({
  t,
  submitLoading,
  onClose,
}: Readonly<TeacherSessionReportActionsProps>): ReactNode {
  return (
    <Box
      sx={theme => ({
        position: "sticky",
        bottom: 0,
        zIndex: 1,
        marginInline: -3,
        paddingInline: 3,
        paddingTop: 2,
        paddingBottom: 2.5,
        marginBottom: -2.5,
        display: "flex",
        flexDirection: { xs: "column-reverse", sm: "row" },
        alignItems: { xs: "stretch", sm: "center" },
        justifyContent: { sm: "flex-end" },
        gap: 1.5,
        backgroundColor: theme.vars.palette.background.paper,
        borderTop: "1px solid",
        borderColor: theme.vars.palette.outline,
        // Elevation separates the pinned band from the content scrolling
        // beneath it (compact viewports) — without the shadow the hairline
        // alone disappears against the dark paper and the band reads as
        // overlapping the form instead of riding above it.
        boxShadow: "0 -6px 16px rgba(0, 0, 0, 0.35)",
        "& .MuiButton-root": {
          whiteSpace: "nowrap",
          width: { xs: "100%", sm: "auto" },
          minHeight: { xs: 54, sm: 40 },
        },
      })}
    >
      <Button type="submit" variant="contained" disabled={submitLoading}>
        {t.reportSubmitLabel}
      </Button>
      <Button onClick={onClose} variant="outlined" color="inherit" disabled={submitLoading}>
        {t.reportCancelLabel}
      </Button>
    </Box>
  );
}
