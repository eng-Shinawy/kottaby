"use client";

import {
  BlockOutlined as BlockIcon,
  CheckCircleOutlined as CheckCircleIcon,
  type SvgIconComponent,
  WarningAmberOutlined as WarningIcon,
} from "@mui/icons-material";
import { Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AuthUser } from "@/frontend/context/AuthContext";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

interface AccountStatusCardProps {
  readonly user: AuthUser;
  readonly t: DashboardLabels;
}

/** Account Status card: isDeleted / suspended / isBlocked status badges. */
export function AccountStatusCard({ user, t }: Readonly<AccountStatusCardProps>): ReactNode {
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        mb: 2,
      })}
    >
      <CardContent sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
          {t.accountStatus}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          <StatusBadge
            active={!user.isDeleted && !user.suspended && !user.isBlocked}
            label={t.statusActive}
            Icon={CheckCircleIcon}
            tone="success"
          />
          <StatusBadge active={user.isDeleted} label={t.statusDeleted} Icon={WarningIcon} tone="error" />
          <StatusBadge active={user.suspended} label={t.statusSuspended} Icon={WarningIcon} tone="warning" />
          <StatusBadge active={user.isBlocked} label={t.statusBlocked} Icon={BlockIcon} tone="error" />
        </Stack>
      </CardContent>
    </Card>
  );
}

interface StatusBadgeProps {
  readonly active: boolean;
  readonly label: string;
  readonly Icon: SvgIconComponent;
  readonly tone: "success" | "warning" | "error";
}

/**
 * Renders a status badge — colored chip with icon. Inactive badges render in
 * a muted `outlined` style so the active state stands out.
 */
function StatusBadge({ active, label, Icon, tone }: Readonly<StatusBadgeProps>): ReactNode {
  if (!active) {
    return (
      <Chip
        icon={<Icon />}
        label={label}
        variant="outlined"
        aria-disabled="true"
        sx={theme => ({
          // border.main (not outlineVariant) so the inert badge keeps a
          // visible outline against the muted disabled background.
          borderColor: theme.palette.border.main,
          bgcolor: theme.palette.action.disabledBackground,
          color: theme.palette.text.secondary,
          fontWeight: 600,
          cursor: "default",
          "& .MuiChip-icon": { color: theme.palette.text.secondary },
        })}
      />
    );
  }
  // Resolve the tone-specific container + onContainer colors via a single
  // lookup object (avoids nested ternaries — sonarjs/no-nested-conditional).
  const tonePalette = resolveTonePalette(tone);
  return (
    <Chip
      icon={<Icon />}
      label={label}
      sx={theme => ({
        fontWeight: 600,
        bgcolor: tonePalette.bg(theme.palette),
        color: tonePalette.fg(theme.palette),
      })}
    />
  );
}

/** Per-tone container + foreground color resolver (used by StatusBadge). */
interface TonePalette {
  readonly bg: (palette: import("@mui/material/styles").Palette) => string;
  readonly fg: (palette: import("@mui/material/styles").Palette) => string;
}

/** Maps a `tone` to its container + onContainer color tokens. */
function resolveTonePalette(tone: "success" | "warning" | "error"): TonePalette {
  switch (tone) {
    case "success":
      return {
        bg: p => p.successContainer,
        fg: p => p.onSuccessContainer,
      };
    case "warning":
      return {
        bg: p => p.warningContainer,
        fg: p => p.onWarningContainer,
      };
    case "error":
      return {
        bg: p => p.errorContainer,
        fg: p => p.onErrorContainer,
      };
    default:
      // Defensive — should never reach here given the union type.
      return {
        bg: p => p.surfaceContainer,
        fg: p => p.onSurface,
      };
  }
}
