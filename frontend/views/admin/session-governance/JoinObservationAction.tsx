"use client";

import { VisibilityOutlined } from "@mui/icons-material";
import { Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AdminSessionGovernance, useAppTranslation } from "@/shared/locale";

/**
 * JoinObservationAction — the single-click confirm banner for joining a
 * LIVE (`started`) governance session as a read-only observer
 * (`/admin/session-governance`). Rendered inside
 * the detail drawer for `started` rows (the observation surface IS the
 * read-only detail view — no meeting bridge exists on this ticket).
 *
 * Single-click semantics: there is NO dialog behind the banner — one
 * explicit confirm fires the container-owned `adminJoinSession` mutation
 * (one audit row per call, server-classified conflicts surface as
 * snackbars). A SUCCESSFUL join unmounts the banner (`joined`) while the
 * drawer stays open for continued read-only observation.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors,
 * `*Outlined` icons only, RTL-safe logical composition, ≥44px touch target.
 */

interface JoinObservationActionProps {
  /** The live session being joined (drives the testids). */
  readonly sessionId: string;
  /** True after a successful join — the banner unmounts (observation continues). */
  readonly joined: boolean;
  /** True while the container's join mutation is in flight. */
  readonly loading: boolean;
  /** Confirm intent — the container owns the mutation. */
  readonly onJoin: () => void;
}

/** The single-click observation-confirm banner (live sessions only). */
export function JoinObservationAction({
  sessionId,
  joined,
  loading,
  onJoin,
}: Readonly<JoinObservationActionProps>): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);

  if (joined) {
    // The observation is live: the banner's job is done, the read-only
    // detail view continues underneath it.
    return null;
  }

  return (
    <Stack
      data-testid={`join-observation-banner-${sessionId}`}
      sx={theme => ({
        gap: 1.5,
        p: 2,
        borderRadius: 2,
        bgcolor: theme.palette.primaryContainer,
        color: theme.palette.onPrimaryContainer,
      })}
    >
      <Stack sx={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
        <VisibilityOutlined fontSize="small" />
        <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 700 }}>
          {t.joinBannerTitle}
        </Typography>
      </Stack>
      <Typography variant="body2">{t.joinBannerBody}</Typography>
      <Stack sx={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button
          variant="contained"
          color="primary"
          disabled={loading}
          onClick={onJoin}
          data-testid={`join-observation-confirm-${sessionId}`}
          aria-label={t.joinBannerAction}
          sx={{
            minHeight: { xs: 44, sm: 40 },
            px: 3,
            bgcolor: theme => theme.palette.onPrimaryContainer,
            color: theme => theme.palette.primaryContainer,
            "&:hover": {
              bgcolor: theme => theme.palette.onPrimaryContainer,
            },
          }}
        >
          {t.joinBannerAction}
        </Button>
      </Stack>
    </Stack>
  );
}
