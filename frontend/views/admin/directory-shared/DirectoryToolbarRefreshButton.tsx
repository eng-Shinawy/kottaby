"use client";

/**
 * DirectoryToolbarRefreshButton — the admin directory toolbars' refresh
 * action: a text button that re-fetches the current page (the promise is
 * handed to Apollo) and shows a disabled state while the query is in
 * flight. Recipe shared by every directory toolbar — 44px touch floor,
 * `text.secondary` ink, `flexShrink: 0` so the wrapping control row never
 * squeezes it. The label flows in via a plain string (the caller's
 * `filters` label slice) — nothing is hardcoded.
 */

import { RefreshOutlined as RefreshIcon } from "@mui/icons-material";
import { Button } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryToolbarRefreshButtonProps {
  /** Visible and accessible label (e.g. `labels.filters.refresh`). */
  readonly refreshLabel: string;
  /** `true` while the query is in flight (the button shows a disabled state). */
  readonly loading: boolean;
  /** Re-fetches the current page (the promise is handed to Apollo). */
  readonly onClick: () => void;
}

export function DirectoryToolbarRefreshButton({
  refreshLabel,
  loading,
  onClick,
}: DirectoryToolbarRefreshButtonProps): ReactNode {
  return (
    <Button
      variant="text"
      startIcon={<RefreshIcon />}
      onClick={onClick}
      disabled={loading}
      aria-label={refreshLabel}
      sx={theme => ({ minHeight: 44, flexShrink: 0, color: theme.palette.text.secondary })}
    >
      {refreshLabel}
    </Button>
  );
}
