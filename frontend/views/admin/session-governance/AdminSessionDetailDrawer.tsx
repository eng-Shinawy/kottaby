"use client";

import { CloseOutlined } from "@mui/icons-material";
import { Box, Dialog, Drawer, IconButton, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import type { ReactNode } from "react";
import { type AdminSessionQuery_adminSession, SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { DetailBody } from "@/frontend/views/admin/session-governance/AdminSessionDetailBody";
import { AdminSessionRowStatusCell } from "@/frontend/views/admin/session-governance/AdminSessionRowStatusCell";
import { AdminSessionGovernance, useAppTranslation } from "@/shared/locale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionDetailDrawer — the read-only side-panel detail of one
 * governance session (`/admin/session-governance`). The SAME
 * read-only body renders through THREE responsive hosts (one component
 * tree, MUI responsive breakpoints, no mobile/desktop triplication):
 *
 * | Host | Viewport | Surface |
 * |------|----------|---------|
 * | side `Drawer` | `md` and up (desktop, 1440-class) | inline-end panel (MUI flips horizontal anchors under RTL) |
 * | full-screen `Dialog` | `sm` … `md` (tablet ~768-class) | fullScreen dialog |
 * | bottom `Drawer` | below `sm` (mobile 375-class) | temporary bottom sheet-style drawer |
 *
 * The detail is a READ-ONLY browse view (any id, null-not-error):
 *  - `adminSession === null` renders the "absent row" body (data, not an
 *    error surface — the browse read answers id-probes with data);
 *  - the `needsAttention` badge is directory-only per the wire contract
 *    (detail always resolves false) and is deliberately NOT rendered here;
 *  - nullable lifecycle stamps render as rows ONLY when present (a
 *    scheduled row shows no resolution/cancel/dispute block);
 *  - for a `started` (live) session the caller-supplied `joinBanner` mounts
 *    above the meta grid — the single-click observation confirm
 *    ({@link JoinObservationAction}).
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, `*Outlined`
 * icons only, RTL-safe logical composition (no physical sides).
 */

/** Join-banner eligibility — `started` only (Record lookup). */
const JOIN_OBSERVABLE_STATUSES: Record<string, true> = {
  [SessionStatus.Started]: true,
};

/** Side-panel width on the desktop host (fits the meta grid without wrap). */
const DRAWER_DESKTOP_WIDTH = 440;

interface AdminSessionDetailDrawerProps {
  /** Whether the drawer/dialog host is mounted-open. */
  readonly open: boolean;
  /** The settled browse-detail payload (`null` row = absent session). */
  readonly detail: AdminSessionQuery_adminSession | null;
  readonly loading: boolean;
  readonly error: unknown;
  /** Dismiss intent (close button / backdrop / Escape). */
  readonly onClose: () => void;
  /** Detail-refetch intent (the error state's retry affordance). */
  readonly onRetry: () => void;
  /**
   * The observation banner for a live session — rendered for `started`
   * rows only; the container owns the join mutation behind it.
   */
  readonly joinBanner: ReactNode;
  /** Shared sessions-namespace labels (status chip + meta vocabulary). */
  readonly tSessions: SessionsLabels;
}

/** The read-only session detail panel (responsive Drawer/Dialog hosts). */
export function AdminSessionDetailDrawer({
  open,
  detail,
  loading,
  error,
  onClose,
  onRetry,
  joinBanner,
  tSessions,
}: Readonly<AdminSessionDetailDrawerProps>): ReactNode {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const titleId = "admin-session-detail-title";
  const header = (
    <DrawerHeader
      titleId={titleId}
      onClose={onClose}
      status={detail?.status ?? SessionStatus.Scheduled}
      statusVisible={detail !== null}
      tSessions={tSessions}
    />
  );
  const body = (
    <DetailBody
      detail={detail}
      loading={loading}
      error={error}
      onRetry={onRetry}
      joinBanner={joinBanner}
      // `!== undefined` (not the value directly): the Record lookup misses
      // at runtime for any non-`started` status, and the prop stays a real
      // boolean instead of leaking `undefined`.
      joinVisible={detail !== null && JOIN_OBSERVABLE_STATUSES[detail.status] !== undefined}
      tSessions={tSessions}
    />
  );

  if (isDesktop) {
    // Desktop host — inline-end side panel. MUI flips horizontal anchors
    // under RTL, so `anchor="right"` stays logical.
    return (
      <Drawer
        open={open}
        onClose={onClose}
        anchor="right"
        slotProps={{
          paper: {
            // Logical radii — the rounded corners face the page CONTENT on
            // both sides: the panel hugs the inline-end edge, and MUI flips
            // the horizontal anchor under RTL while the start-side corners
            // keep facing the content.
            sx: { width: { sm: DRAWER_DESKTOP_WIDTH }, borderStartStartRadius: 16, borderEndStartRadius: 16 },
            "aria-labelledby": titleId,
          },
        }}
      >
        {header}
        {body}
      </Drawer>
    );
  }
  if (isMobile) {
    // Mobile host — temporary bottom drawer (a sheet-style panel, not bottom navigation).
    return (
      <Drawer
        open={open}
        onClose={onClose}
        anchor="bottom"
        slotProps={{ paper: { sx: { maxHeight: "92vh" }, "aria-labelledby": titleId } }}
      >
        {header}
        {body}
      </Drawer>
    );
  }
  // Tablet host — full-screen dialog.
  return (
    <Dialog open={open} onClose={onClose} fullScreen aria-labelledby={titleId}>
      {header}
      {body}
    </Dialog>
  );
}

interface DrawerHeaderProps {
  readonly titleId: string;
  readonly onClose: () => void;
  readonly status: SessionStatus;
  readonly statusVisible: boolean;
  readonly tSessions: SessionsLabels;
}

/** Shared header band: title + status chip + close affordance. */
function DrawerHeader({ titleId, onClose, status, statusVisible, tSessions }: Readonly<DrawerHeaderProps>): ReactNode {
  const t = useAppTranslation(AdminSessionGovernance);
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
      <Typography id={titleId} variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        {t.detailTitle}
      </Typography>
      <Box sx={{ marginInlineStart: "auto" }}>
        {statusVisible ? <AdminSessionRowStatusCell status={status} t={tSessions} /> : null}
      </Box>
      <IconButton
        aria-label={t.detailCloseAriaLabel}
        data-testid="admin-session-detail-close"
        onClick={onClose}
        sx={theme => ({
          "&:focus-visible": {
            outline: `2px solid ${theme.palette.outline}`,
            outlineOffset: 2,
          },
        })}
      >
        <CloseOutlined />
      </IconButton>
    </Stack>
  );
}
