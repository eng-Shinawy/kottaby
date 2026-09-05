"use client";

/**
 * DirectoryRowCells — shared cell-level components for the admin user
 * directory surfaces (desktop table + mobile card list).
 *
 * Both surfaces render the SAME semantic content per row — role pill, status
 * /details chips, governance headline, relative "last active" copy, and the
 * kebab actions menu — so the rendering lives in this component family and
 * each surface composes it.
 *
 * This module hosts the shared row types plus the role pill, the governance
 * headline, and the relative-time cell; the remaining cells live in their
 * own siblings:
 *  - `DirectoryStatusDetails`  → ./DirectoryStatusDetails
 *  - `DirectoryActionsMenu`    → ./DirectoryActionsMenu
 *  - `DirectoryEmptyState`     → ./DirectoryEmptyState
 *
 * Every color is resolved through a `sx` theme callback against the M3
 * container/`on<Color>Container` pairs (light + dark variants defined in the
 * theme palettes); the semantic → lane mapping comes from
 * `adminUsersDirectory.helpers.ts`, and the tone → token lookup from
 * `directoryToneColors.ts` (`DirectoryToneChip` paints the pills).
 *
 * Only components (plus the row types) leave this module — the tone→token
 * lookup lives in `directoryToneColors.ts` so the component files stay
 * within `react-refresh/only-export-components`.
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUsersQuery } from "@/frontend/graphql/generated/gql/graphql";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import {
  type DirectoryGovernance,
  type DirectoryRole,
  formatDirectoryRelativeTime,
  governanceLabel,
  governanceToneKey,
  roleToneKey,
  toneColors,
} from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Directory list-item row consumed by the cell components. */
export type DirectoryUserItem = AdminUsersQuery["adminUsers"]["items"][number];

/** Narrow label slice consumed by the row cells. */
type RowCellLabels = Pick<
  AdminUsersLabels,
  | "headers"
  | "roleLabels"
  | "statusBadges"
  | "directoryChips"
  | "emptyState"
  | "quickActions"
  | "editDialog"
  | "deleteConfirm"
  | "reactivateConfirm"
>;

interface DirectoryRolePillProps {
  readonly role: DirectoryRole;
  readonly labels: Pick<AdminUsersLabels, "roleLabels">;
  /**
   * Deleted rows render the role pill in the neutral lane regardless of the
   * role's own tint (the row is visually dimmed — the tint should not
   * compete with the governance signal).
   */
  readonly muted?: boolean;
}

/**
 * Role pill — same role → tint mapping as `UserAvatar` (admin = error lane,
 * teacher = secondary, student = primary, parent = neutral surface).
 */
export function DirectoryRolePill({ role, labels, muted = false }: DirectoryRolePillProps): ReactNode {
  let label: string;
  if (role === "Admin") {
    label = labels.roleLabels.admin;
  } else if (role === "Teacher") {
    label = labels.roleLabels.teacher;
  } else if (role === "Student") {
    label = labels.roleLabels.student;
  } else {
    label = labels.roleLabels.parent;
  }
  return <TonalChip tone={muted ? "neutral" : roleToneKey(role)} label={label} />;
}

interface DirectoryRelativeTimeProps {
  readonly value: string | null | undefined;
  /** Bound app locale (`useAppLocale()`) — fed to `Intl.RelativeTimeFormat`. */
  readonly locale: "ar" | "en";
}

/** Localized "last active" cell text; em-dash when the timestamp is unset. */
export function DirectoryRelativeTime({ value, locale }: DirectoryRelativeTimeProps): ReactNode {
  return (
    <Typography variant="body2" component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
      {formatDirectoryRelativeTime(value, locale)}
    </Typography>
  );
}

interface GovernanceLabelBlockProps {
  readonly governance: DirectoryGovernance;
  readonly labels: Pick<AdminUsersLabels, "statusBadges">;
  /**
   * `pill` renders the tinted container-background chip used on desktop;
   * `dot-text` renders the bare dot + colored label the mobile cards use.
   */
  readonly variant?: "pill" | "dot-text";
}

/**
 * Governance headline — small pill: 8px status dot + label. `dot-text`
 * renders the same dot + label without the tinted background (mobile body
 * row). The dot picks the matching `.main` family color; text uses the
 * `on<Color>Container` sibling.
 */
export function DirectoryGovernanceLabel({
  governance,
  labels,
  variant = "pill",
}: GovernanceLabelBlockProps): ReactNode {
  const tone = governanceToneKey(governance);
  const text = governanceLabel(governance, labels.statusBadges);
  if (variant === "dot-text") {
    return (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
        <Box
          component="span"
          aria-hidden
          sx={theme => ({
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            bgcolor: toneColors(theme, tone).dot,
          })}
        />
        <Typography
          variant="body2"
          component="span"
          sx={theme => ({ color: toneColors(theme, tone).fg, fontWeight: 500 })}
        >
          {text}
        </Typography>
      </Box>
    );
  }
  return (
    <Box
      component="span"
      sx={theme => {
        const colors = toneColors(theme, tone);
        return {
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.5,
          borderRadius: "999px",
          bgcolor: colors.bg,
          color: colors.fg,
        };
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={theme => ({ width: 8, height: 8, borderRadius: "50%", bgcolor: toneColors(theme, tone).dot })}
      />
      <Typography variant="caption" component="span" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
        {text}
      </Typography>
    </Box>
  );
}

/**
 * Convenience export of the per-row labels slice type (type-only — erased
 * at runtime, so the module stays component-only for fast-refresh).
 * Non-component helpers (`asDirectoryRole`, `directoryGovernanceOf`, …)
 * are imported directly from `adminUsersDirectory.helpers.ts`.
 */
export type { RowCellLabels };
