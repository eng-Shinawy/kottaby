"use client";

/**
 * DirectoryCopyEmailButton — the copy-email quick action shared by the
 * admin directory identity surfaces (desktop identity cells, drawer
 * identity heroes, mobile email rows): it writes the email to the
 * clipboard, tints the icon to the success color while the copy has
 * resolved, and keeps the click from bubbling (`stopPropagation`) so a
 * card/row-level click handler never fires alongside the copy.
 *
 * ≥44px touch target via transparent padding; opt-in `noShrink` pins the
 * button's width where the row layout must not squeeze it narrower.
 */

import { ContentCopyOutlined as CopyIcon } from "@mui/icons-material";
import { IconButton, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface DirectoryCopyEmailButtonProps {
  readonly email: string;
  /** Whether the clipboard write has resolved (drives tooltip + tint). */
  readonly copied: boolean;
  /** The copy quick-action label (tooltip + aria prefix). */
  readonly copyLabel: string;
  /** The post-copy label (tooltip while the copy has resolved). */
  readonly copiedLabel: string;
  readonly onCopy: () => void;
  /** Pins the button's width (`flexShrink: 0`) where the row must not squeeze it. */
  readonly noShrink?: boolean;
}

export function DirectoryCopyEmailButton({
  email,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
  noShrink = false,
}: DirectoryCopyEmailButtonProps): ReactNode {
  return (
    <Tooltip title={copied ? copiedLabel : copyLabel} placement="top">
      <IconButton
        size="small"
        aria-label={`${copyLabel}: ${email}`}
        onClick={event => {
          // Copy only — the click must not also trigger the card/row.
          event.stopPropagation();
          onCopy();
        }}
        sx={theme => ({
          ...focusVisibleRingSx,
          // ≥44px touch target via transparent padding; the icon stays
          // visually 20px. flexShrink: 0 keeps the email at its full
          // available width instead of squeezing under the icon.
          p: 1.5,
          my: -1.5,
          ...(noShrink && { flexShrink: 0 }),
          color: copied ? theme.palette.success.main : theme.palette.text.secondary,
        })}
      >
        <CopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
