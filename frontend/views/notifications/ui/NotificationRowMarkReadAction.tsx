"use client";

import { DoneOutlined } from "@mui/icons-material";
import { Button, IconButton, Stack, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { darkOutlinedContrastSx } from "@/frontend/views/notifications/utils";

interface NotificationRowMarkReadActionProps {
  /** Row-context translated aria/tooltip text (`markReadAriaLabel`). */
  readonly markReadLabel: string;
  /** Inline button label (`markRead`). */
  readonly buttonLabel: string;
  /** Whether THIS row's mark-read mutation is in flight. */
  readonly markReadPending: boolean;
  /** Fires the row's mark-read mutation. */
  readonly onMarkRead: () => void;
}

/**
 * NotificationRowMarkReadAction — the row's mark-read action (rendered only
 * for unread rows). Touch posture: `sm+` shows the inline secondary button;
 * on `xs` the action is a ≥44px icon-only button with the translated
 * row-context `aria-label` — a single-action row keeps a direct affordance
 * rather than an overflow menu. Both affordances carry a row-context
 * `Tooltip` (the NotificationUnreadBadge / LocaleSwitcher precedent) so
 * pointer users get the same target-of-action context screen readers
 * announce, and the inline button paints through the dark-mode outlined
 * contrast lift (`darkOutlinedContrastSx`) so its label clears AA in both
 * color schemes.
 */
export function NotificationRowMarkReadAction({
  markReadLabel,
  buttonLabel,
  markReadPending,
  onMarkRead,
}: Readonly<NotificationRowMarkReadActionProps>): ReactNode {
  return (
    <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignItems: "center" }}>
      <Tooltip title={markReadLabel}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DoneOutlined />}
          disabled={markReadPending}
          aria-label={markReadLabel}
          onClick={onMarkRead}
          // QA round 2 (axe serious): dark-mode outlined text/border lift.
          sx={theme => ({
            ...focusVisibleRingSx,
            ...darkOutlinedContrastSx(theme),
            display: { xs: "none", sm: "inline-flex" },
            flexShrink: 0,
          })}
        >
          {buttonLabel}
        </Button>
      </Tooltip>
      <Tooltip title={markReadLabel}>
        <IconButton
          size="small"
          aria-label={markReadLabel}
          disabled={markReadPending}
          onClick={onMarkRead}
          sx={{
            ...focusVisibleRingSx,
            display: { xs: "inline-flex", sm: "none" },
            minHeight: 44,
            minWidth: 44,
          }}
        >
          <DoneOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
