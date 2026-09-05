"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * AdminDisputeRowMetaCell — one label/value meta pair inside the admin
 * dispute row's header strip: an overline label over a semibold body value,
 * wrap-friendly (`minWidth: 0` keeps truncation RTL-safe inside the
 * flex-wrap row). Extracted verbatim from `AdminDisputeRow` for the
 * `max-lines-per-function` budget; behavior is unchanged.
 */

interface AdminDisputeRowMetaCellProps {
  readonly label: string;
  readonly value: string;
}

/** One label/value meta pair (overline label + body value), wrap-friendly. */
export function AdminDisputeRowMetaCell({ label, value }: Readonly<AdminDisputeRowMetaCellProps>): ReactNode {
  return (
    <Stack sx={{ gap: 0.25, minWidth: 0 }}>
      <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Stack>
  );
}
