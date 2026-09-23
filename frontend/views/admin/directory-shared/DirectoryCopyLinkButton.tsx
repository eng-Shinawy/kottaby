"use client";

/**
 * DirectoryCopyLinkButton — the admin directory toolbars' shareable-view
 * action: copies the CURRENT URL (the surface's URL-mirror effect keeps the
 * query string in sync with the applied filters, so what the admin pastes
 * is exactly what they see). Recipe shared by every directory toolbar —
 * text button, 44px touch floor, `text.secondary` ink, `flexShrink: 0`.
 *
 * The icon tints to the success color while the copy has resolved
 * (mirroring the copy-email quick action); failures stay silent (insecure
 * context / rejected write — the snackbar never lies about a copy that did
 * not happen). The label flows in via a plain string (the caller's
 * `quickActions` label slice) — nothing is hardcoded.
 */

import { LinkOutlined as LinkIcon } from "@mui/icons-material";
import { Button, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { useDirectoryCopyLink } from "@/frontend/views/admin/directory-copy-link";

interface DirectoryCopyLinkButtonProps {
  /** Visible label + tooltip + accessible name (e.g. `labels.quickActions.copyLink`). */
  readonly copyLinkLabel: string;
  /** Invoked after the view URL copies successfully (drives the snackbar). */
  readonly onCopyLink?: () => void;
}

export function DirectoryCopyLinkButton({ copyLinkLabel, onCopyLink }: DirectoryCopyLinkButtonProps): ReactNode {
  const { linkCopied, handleCopyLink } = useDirectoryCopyLink(onCopyLink);
  return (
    <Tooltip title={copyLinkLabel} placement="top">
      <Button
        variant="text"
        startIcon={
          <LinkIcon
            fontSize="small"
            sx={theme => ({ color: linkCopied ? theme.palette.success.main : theme.palette.text.secondary })}
          />
        }
        onClick={handleCopyLink}
        aria-label={copyLinkLabel}
        sx={theme => ({ minHeight: 44, flexShrink: 0, color: theme.palette.text.secondary })}
      >
        {copyLinkLabel}
      </Button>
    </Tooltip>
  );
}
