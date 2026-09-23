"use client";

/**
 * DirectoryMobileCard — the shared per-item card of the mobile directory
 * lists (radius 12, `border.light` outline, 16px padding):
 *  - header as a 3-track grid (`auto minmax(0,1fr) auto`): 44px role-tinted
 *    avatar, the domain's NAME node (single-line ellipsis recipe — plain
 *    name or profile link), and a trailing column for the caption + quick
 *    action (stacking keeps the name track ≥ ~180px wide at a 390px
 *    viewport, where a horizontal caption+action row would not);
 *  - the domain's full-width identity row directly below the header grid (a
 *    DIRECT card child): the email + copy affordance live in their own row
 *    spanning the whole card instead of squeezing into the header's middle
 *    track, where long addresses wrapped mid-word (QA-verified);
 *  - a hairline divider, then the strict two-column detail rows.
 *
 * The card click (when provided) opens the detail drawer — pointer-only
 * convenience; read-only surfaces stay inert.
 */

import { Box, Card, Divider, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { UserAvatar } from "@/frontend/views/admin/users/ui";
import type { AdminSurfaceRole } from "@/frontend/views/admin/users/ui/AdminUserAvatar";

interface DirectoryMobileCardProps {
  /** The avatar's full name (the tint seed). */
  readonly avatarName: string;
  /** The avatar's role lane (expression-passed — matches the rows). */
  readonly avatarRole: AdminSurfaceRole;
  /** The header grid's middle track — the domain's name node. */
  readonly name: ReactNode;
  /** The trailing column — the timestamp caption + quick action. */
  readonly trailing: ReactNode;
  /** The full-width identity row between the header grid and the divider. */
  readonly identity: ReactNode;
  /** The strict two-column detail rows (wrapped in the shared 8px-gap stack). */
  readonly rows: ReactNode;
  /** Card click (opens the detail drawer); omit for inert cards. */
  readonly onClick?: () => void;
}

export function DirectoryMobileCard({
  avatarName,
  avatarRole,
  name,
  trailing,
  identity,
  rows,
  onClick,
}: DirectoryMobileCardProps): ReactNode {
  return (
    <Card
      onClick={onClick}
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        p: 2,
        ...(onClick !== undefined && { cursor: "pointer" }),
      })}
    >
      {/*
        Header as a 3-track grid — [avatar 44px] [NAME (flexible,
        minmax(0,1fr) so it can shrink and ellipsize)] [caption + quick
        action]. The name ALONE lives in the middle track: the email + copy
        affordance render OUT in the full-width row below the grid, so the
        middle track never has to share its ~180px with a wrapping address.
      */}
      <Box sx={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: 1 }}>
        <UserAvatar fullName={avatarName} role={avatarRole} size={44} />
        {name}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>{trailing}</Box>
      </Box>
      {identity}
      <Divider sx={{ my: 1.5 }} />
      <Stack spacing={1}>{rows}</Stack>
    </Card>
  );
}
