"use client";

import { CampaignOutlined, CloseOutlined, StopCircleOutlined } from "@mui/icons-material";
import { Box, Chip, Drawer, IconButton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import {
  type AdminBroadcastDetailQuery_adminBroadcastDetail,
  BroadcastStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { BroadcastDetailBody } from "@/frontend/views/admin/broadcasts/BroadcastDetailBody";
import {
  BROADCAST_TONE_COLORS,
  broadcastStatusLabelKey,
  broadcastStatusTone,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { Common } from "@/shared/locale/namespaces/common";

/**
 * BroadcastDetailDrawer — the read-only side panel over one sent broadcast
 * (`/admin/broadcasts`, History tab). A single in-page `Drawer` host pinned
 * to the physical right edge on `sm` and up (MUI does not flip horizontal
 * anchors under RTL — `anchor="right"` stays the physical right edge in
 * both directions, matching the repo's existing `anchor="right"` drawer
 * convention) and it goes full-width below `sm`. The
 * header band carries the drawer title, the lifecycle status chip (rendered
 * from the payload's own status snapshot — never a client-side guess) and
 * the close affordance; the body ({@link BroadcastDetailBody}) renders the
 * verbatim broadcast copy `dir="auto"`, the live delivered/read counters and
 * the stop metadata while the entry is stopped.
 *
 * The detail read itself lives in `useAdminBroadcastDetail` (skip-gated
 * while no broadcast is selected) — this panel stays presentational and
 * receives the settled payload + retry intent.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, `*Outlined`
 * icons only, ≥44px targets, RTL-safe logical composition.
 */

/** Panel width from `sm` up (full-width sheet below). */
const DRAWER_DESKTOP_WIDTH = 440;

/** The drawer title's DOM id (the `aria-labelledby` target). */
const DETAIL_TITLE_ID = "admin-broadcast-detail-title";

interface BroadcastDetailDrawerProps {
  /** Whether the drawer is mounted-open. */
  readonly open: boolean;
  /** Settled detail payload, `null` until the drawer's fetch resolves. */
  readonly detail: AdminBroadcastDetailQuery_adminBroadcastDetail | null;
  /** True while this broadcast's detail read is in flight. */
  readonly loading: boolean;
  readonly error: unknown;
  /** Dismiss intent (close button / backdrop / Escape). */
  readonly onClose: () => void;
  /** Detail-refetch intent (the body error arm's retry affordance). */
  readonly onRetry: () => void;
}

/** The read-only broadcast detail panel (header + body in one drawer host). */
export function BroadcastDetailDrawer({
  open,
  detail,
  loading,
  error,
  onClose,
  onRetry,
}: Readonly<BroadcastDetailDrawerProps>): ReactNode {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      anchor="right"
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", sm: DRAWER_DESKTOP_WIDTH },
            // Logical radii — the rounded corners face the page CONTENT on
            // `sm` and up; the full-width mobile sheet stays square-edged.
            borderStartStartRadius: { sm: 16 },
            borderEndStartRadius: { sm: 16 },
          },
          "aria-labelledby": DETAIL_TITLE_ID,
        },
      }}
    >
      <DrawerHeader detail={detail} onClose={onClose} />
      <BroadcastDetailBody detail={detail} loading={loading} error={error} onRetry={onRetry} />
    </Drawer>
  );
}

interface DrawerHeaderProps {
  readonly detail: AdminBroadcastDetailQuery_adminBroadcastDetail | null;
  readonly onClose: () => void;
}

/** Shared header band: drawer title + status chip + close affordance. */
function DrawerHeader({ detail, onClose }: Readonly<DrawerHeaderProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);
  const tCommon = useAppTranslation(Common);
  const status = detail?.entry.status ?? BroadcastStatus.Active;
  const toneColors = BROADCAST_TONE_COLORS[broadcastStatusTone(status)];
  const StatusIcon = status === BroadcastStatus.Active ? CampaignOutlined : StopCircleOutlined;
  return (
    <Stack
      sx={theme => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
        p: 2,
        borderBottom: "1px solid",
        borderBottomColor: theme.palette.outlineVariant,
      })}
    >
      <Typography id={DETAIL_TITLE_ID} variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        {t.detailTitle}
      </Typography>
      <Box sx={{ marginInlineStart: "auto" }}>
        {detail !== null ? (
          <Chip
            icon={<StatusIcon fontSize="small" />}
            label={t[broadcastStatusLabelKey(status)]}
            size="small"
            sx={theme => ({
              bgcolor: toneColors.bg(theme.palette),
              color: toneColors.fg(theme.palette),
              border: "1px solid",
              borderColor: theme.palette.outlineVariant,
              "& .MuiChip-icon": { color: toneColors.fg(theme.palette) },
            })}
          />
        ) : null}
      </Box>
      <IconButton
        aria-label={tCommon.close}
        data-testid="admin-broadcast-detail-close"
        onClick={onClose}
        sx={theme => ({
          "&:focus-visible": {
            outline: `2px solid ${theme.palette.outline}`,
            outlineOffset: 2,
          },
          ...focusVisibleRingSx,
        })}
      >
        <CloseOutlined />
      </IconButton>
    </Stack>
  );
}
