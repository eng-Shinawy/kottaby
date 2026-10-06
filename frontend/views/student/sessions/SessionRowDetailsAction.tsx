"use client";

import { InfoOutlined as DetailsIcon } from "@mui/icons-material";
import { IconButton, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { Sessions, useAppTranslation } from "@/shared/locale";

/**
 * SessionRowDetailsAction — the session row's read-only "Session details"
 * affordance: an outlined icon-button at the actions row's trailing edge
 * (beside the lifecycle CTAs), rendered for EVERY status — details are
 * read-only and always legitimate. The affordance is purely an opener (the
 * dialog fetches fresh through `sessionById`); the row renders it only
 * while its container supplies the intent (`onDetailsIntent`).
 *
 * Outlined treatment through the theme's outline token — MUI v9's
 * IconButton carries no `variant` prop. ≥44px mobile target (40px at sm+
 * beside the row's other CTAs) and the shared keyboard-focus ring (MUI v9
 * ButtonBase ships none).
 */
export function SessionRowDetailsAction({
  sessionId,
  onIntent,
}: Readonly<{ sessionId: string; onIntent: (sessionId: string) => void }>): ReactNode {
  const t = useAppTranslation(Sessions);
  return (
    <Tooltip title={t.sessionDetailsTooltip} placement="top">
      <IconButton
        aria-label={t.sessionDetailsTooltip}
        onClick={() => onIntent(sessionId)}
        data-testid={`session-details-action-${sessionId}`}
        sx={theme => ({
          ...focusVisibleRingSx,
          border: 1,
          borderColor: theme.palette.outlineVariant,
          color: theme.palette.onSurfaceVariant,
          minHeight: { xs: 44, sm: 40 },
          minWidth: { xs: 44, sm: 40 },
          alignSelf: { xs: "flex-end", sm: "auto" },
        })}
      >
        <DetailsIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
