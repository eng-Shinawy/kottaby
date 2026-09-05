"use client";

import { ListItem, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { type DashboardNavItem, resolveNavItemLabel } from "@/frontend/views/dashboard/nav";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";
import type { HandshakeCodeLabels } from "@/shared/locale/types/handshakeCode";

interface SidebarListItemProps {
  readonly item: DashboardNavItem;
  readonly t: DashboardLabels;
  readonly handshakeCodeLabels: HandshakeCodeLabels;
  readonly pathname: string;
  readonly onNavigate: () => void;
}

/** Renders a single sidebar nav item with active-route highlighting. */
export function SidebarListItem({
  item,
  t,
  handshakeCodeLabels,
  pathname,
  onNavigate,
}: Readonly<SidebarListItemProps>): ReactNode {
  const label = resolveNavItemLabel(item, t, handshakeCodeLabels);
  const Icon = item.Icon;
  // Active when the current pathname equals the item's route. Nav items are
  // exact paths (the dashboard item points straight at its role-specific
  // route, e.g. `/teacher/dashboard`), so an exact match is correct — a
  // sub-route like `/sessions/123` never half-highlights its parent.
  const isActive = pathname === item.route;

  return (
    // `component="li"` keeps the list DOM valid (ul > li > a) — the MUI
    // `List` parent renders a `<ul>`, and anchors as its direct children
    // violate the axe `list` rule. `disablePadding` keeps the wrapping
    // `<li>` geometry-free so the button's own mx/my/borderRadius render
    // pixel-identical to the pre-`<li>` layout.
    <ListItem disablePadding component="li">
      <ListItemButton
        component={Link}
        href={item.route}
        onClick={onNavigate}
        selected={isActive}
        aria-current={isActive ? "page" : undefined}
        sx={theme => ({
          ...focusVisibleRingSx,
          mx: 1,
          my: 0.25,
          borderRadius: 2,
          py: 1,
          "&.Mui-selected": {
            bgcolor: theme.palette.primaryContainer,
            color: theme.palette.onPrimaryContainer,
            "& .MuiListItemIcon-root": {
              color: theme.palette.onPrimaryContainer,
            },
          },
          "&.Mui-selected:hover": {
            bgcolor: theme.palette.primaryContainer,
          },
        })}
      >
        <ListItemIcon
          sx={theme => ({
            minWidth: 36,
            color: theme.palette.text.secondary,
          })}
        >
          <Icon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={label}
          slotProps={{
            primary: {
              sx: { fontWeight: 600, fontSize: 14 },
            },
          }}
        />
      </ListItemButton>
    </ListItem>
  );
}
