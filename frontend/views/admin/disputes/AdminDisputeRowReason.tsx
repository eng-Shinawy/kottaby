"use client";

import { ExpandLessOutlined as CollapseIcon, ExpandMoreOutlined as ExpandIcon } from "@mui/icons-material";
import { IconButton, Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputeRowReason — the filed dispute-reason block inside the admin
 * dispute row (R-111): the reason clamps to TWO lines while collapsed with
 * the FULL text expandable through the `aria-expanded` toggle. The clamp is
 * CSS-only (`WebkitLineClamp`), so the full string stays in the
 * accessibility tree either way; `minWidth: 0` keeps the truncation RTL-safe
 * inside the wrap-friendly flex row. The expand/collapse state is local to
 * this block — the same lifecycle it had while resident on the row (it
 * resets when the row unmounts).
 */

/** Line clamp height for the collapsed dispute reason (exactly two lines). */
const REASON_CLAMP_LINES = 2;

interface AdminDisputeRowReasonProps {
  /** Session id — keys the row-scoped test ids (`admin-dispute-reason*`). */
  readonly sessionId: string;
  /** The rendered reason text (the caller resolves the em-dash fallback). */
  readonly reason: string;
  /** Localized sessions-namespace labels (toggle vocabulary). */
  readonly t: SessionsLabels;
}

/** Clamped dispute reason + expand/collapse affordance (R-111). */
export function AdminDisputeRowReason({ sessionId, reason, t }: Readonly<AdminDisputeRowReasonProps>): ReactNode {
  const [reasonExpanded, setReasonExpanded] = useState<boolean>(false);

  return (
    <Stack sx={{ gap: 0.5, minWidth: 0 }}>
      <Stack sx={{ gap: 0.5, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.disputeReasonMeta}
        </Typography>
        <IconButton
          size="small"
          aria-expanded={reasonExpanded}
          aria-label={reasonExpanded ? t.disputeReasonCollapse : t.disputeReasonExpand}
          data-testid={`admin-dispute-reason-toggle-${sessionId}`}
          onClick={() => {
            setReasonExpanded(prev => !prev);
          }}
          sx={theme => ({
            "&:focus-visible": {
              outline: `2px solid ${theme.palette.outline}`,
              outlineOffset: 2,
            },
          })}
        >
          {reasonExpanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
        </IconButton>
      </Stack>
      <Typography
        data-testid={`admin-dispute-reason-${sessionId}`}
        variant="body2"
        sx={theme => ({
          color: theme.palette.text.secondary,
          minWidth: 0,
          ...(reasonExpanded
            ? {}
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: REASON_CLAMP_LINES,
                overflow: "hidden",
              }),
        })}
      >
        {reason}
      </Typography>
    </Stack>
  );
}
