"use client";

import { WarningOutlined } from "@mui/icons-material";
import { Chip, Stack, Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminSessionsQuery_adminSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { AdminSessionRowStatusCell } from "@/frontend/views/admin/session-governance/AdminSessionRowStatusCell";
import { SESSION_TYPE_LABEL_KEY } from "@/frontend/views/admin/session-governance/sessionTypePresentation";
import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionRowHeadBand — the governance row card's head band: the
 * overline type label + type title (with the needs-attention warning chip
 * beside it when raised) inline-start, and the lifecycle status chip
 * inline-end. The arbitration-queue row mirrors this band's presentation
 * through the shared band-layout token rather than a copied literal.
 *
 * The `needsAttention` server-derived badge (a disputed row or a scheduled
 * row whose confirmation deadline lapsed) renders as a warning-palette chip
 * when true; it is presentation ONLY, never an authorization signal.
 * Extracted verbatim from `AdminSessionRow`; behavior is unchanged.
 */

/** Card head-band layout — the type-title block inline-start, the lifecycle chip inline-end. */
const ROW_HEAD_BAND_SX: SxProps<Theme> = {
  gap: 1.5,
  flexDirection: { xs: "column", sm: "row" },
  alignItems: { xs: "flex-start", sm: "center" },
  justifyContent: "space-between",
  flexWrap: "wrap",
};

interface AdminSessionRowHeadBandProps {
  readonly session: AdminSessionsQuery_adminSessions_items;
  readonly t: AdminSessionGovernanceLabels;
  readonly tSessions: SessionsLabels;
}

/** The card's head band — type title + attention badge inline-start, the lifecycle chip inline-end. */
export function AdminSessionRowHeadBand({ session, t, tSessions }: Readonly<AdminSessionRowHeadBandProps>): ReactNode {
  return (
    <Stack sx={ROW_HEAD_BAND_SX}>
      <Stack sx={{ gap: 0.5, minWidth: 0 }}>
        <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.rowTypeLabel}
        </Typography>
        <Stack sx={{ flexDirection: "row", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            {t[SESSION_TYPE_LABEL_KEY[session.sessionType] ?? "typeStudentSession"]}
          </Typography>
          {session.needsAttention ? (
            <Tooltip title={t.needsAttentionLabel} placement="top">
              <Chip
                icon={<WarningOutlined fontSize="small" />}
                label={t.needsAttentionLabel}
                size="small"
                data-testid={`admin-session-needs-attention-${session.id}`}
                sx={theme => ({
                  fontWeight: 600,
                  bgcolor: theme.palette.warningContainer,
                  color: theme.palette.onWarningContainer,
                  "& .MuiChip-icon": { color: theme.palette.onWarningContainer },
                })}
              />
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>
      <AdminSessionRowStatusCell status={session.status} t={tSessions} />
    </Stack>
  );
}
