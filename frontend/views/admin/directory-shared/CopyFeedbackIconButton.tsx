"use client";

/**
 * CopyFeedbackIconButton — the shared copy quick-action button of the admin
 * surfaces: the Tooltip/IconButton shell whose icon swaps to a check and
 * tints the success color while the `useCopyFeedback` copied flag is up.
 *
 * The owning row resolves the labels and the copied payload; the click
 * guard (bubble suppression for row-level actions) stays in the owner's
 * `onCopyClick` so each surface keeps its own contract.
 *
 * MUI v9 discipline: `sx`-only styling, ≥44px touch target (`p: 1` on the
 * small IconButton), one contained-intent control per row.
 */

import { CheckOutlined as CopiedIcon, ContentCopyOutlined as CopyIcon } from "@mui/icons-material";
import { IconButton, Tooltip } from "@mui/material";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

interface CopyFeedbackIconButtonProps {
  /** True while the copied flag is up (check icon + success tint). */
  readonly copied: boolean;
  /** The copy tooltip label. */
  readonly copyLabel: string;
  /** The post-copy tooltip label. */
  readonly copiedLabel: string;
  /** The button's accessible name (the owning row composes the value form). */
  readonly ariaLabel: string;
  /** The click handler — copy + any row-level guard (e.g. stopPropagation). */
  readonly onCopyClick: (event: ReactMouseEvent) => void;
}

export function CopyFeedbackIconButton({
  copied,
  copyLabel,
  copiedLabel,
  ariaLabel,
  onCopyClick,
}: Readonly<CopyFeedbackIconButtonProps>): ReactNode {
  return (
    <Tooltip title={copied ? copiedLabel : copyLabel} placement="top">
      <IconButton
        size="small"
        aria-label={ariaLabel}
        onClick={onCopyClick}
        sx={theme => ({
          ...focusVisibleRingSx,
          p: 1,
          color: copied ? theme.palette.success.main : theme.palette.text.secondary,
        })}
      >
        {copied ? <CopiedIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
