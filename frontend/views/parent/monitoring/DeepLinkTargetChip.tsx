"use client";

/**
 * Deep-link origin chip — the small outlined badge at a row card's
 * top-start corner, rendered ONLY when that row is the `?session=`
 * deep-link target. It names the visit's origin (the session-completion
 * notification the parent followed) so the glowing row's primary border
 * + selection wash (`deepLinkRowSx`) are self-explaining. Rendered as the
 * row's FIRST child so it leads the row's accessible-name ordering. One
 * component consumed by the reports / homework / evaluations rows — no
 * per-tab duplication.
 */
import { NotificationsActiveOutlined } from "@mui/icons-material";
import { Chip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

export function DeepLinkTargetChip({ labels }: Readonly<{ labels: ParentMonitoringLabels }>): ReactNode {
  return (
    <Chip
      aria-hidden={false}
      icon={<NotificationsActiveOutlined />}
      label={labels.deepLinkChip}
      size="small"
      variant="outlined"
      sx={theme => ({
        alignSelf: "flex-start",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color: theme.palette.primary.main,
        borderColor: alpha(theme.palette.primary.main, 0.6),
        bgcolor: alpha(theme.palette.primary.main, 0.1),
        "& .MuiChip-icon": {
          fontSize: 14,
          color: theme.palette.primary.main,
        },
      })}
    />
  );
}
