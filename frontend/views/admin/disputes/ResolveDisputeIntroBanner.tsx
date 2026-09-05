"use client";

import { BalanceOutlined as BalanceIcon } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * ResolveDisputeIntroBanner — the tinted intro strip of the
 * `ResolveDisputeDialog`: the balance icon beside the localized arbitration
 * explainer, rendered on the `primaryContainer` surface. Extracted verbatim
 * from the dialog for the `max-lines-per-function` budget; behavior is
 * unchanged.
 */

interface ResolveDisputeIntroBannerProps {
  /** Localized explainer body (`sessions.resolveDisputeBody`). */
  readonly body: string;
}

/** Tinted intro strip: balance icon + arbitration explainer copy. */
export function ResolveDisputeIntroBanner({ body }: Readonly<ResolveDisputeIntroBannerProps>): ReactNode {
  return (
    <Stack
      sx={theme => ({
        gap: 1,
        flexDirection: "row",
        alignItems: "flex-start",
        p: 2,
        borderRadius: 2,
        bgcolor: theme.palette.primaryContainer,
        color: theme.palette.onPrimaryContainer,
      })}
    >
      <BalanceIcon fontSize="small" />
      <Typography variant="body2">{body}</Typography>
    </Stack>
  );
}
