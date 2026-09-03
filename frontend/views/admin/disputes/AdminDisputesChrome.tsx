"use client";

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * AdminDisputesChrome — the ALWAYS-ON chrome of the admin arbitration queue
 * (`/disputes`, DEV3-005 R-111): the page title over the sticky honest-count
 * bar. It renders in EVERY branch of the body state matrix (skeleton /
 * denial / error / empty / rows), which is why it lifts out of the
 * container unchanged — only the body BELOW it swaps.
 */

interface AdminDisputesChromeProps {
  /** Localized page title (`sessions.adminDisputesPageTitle`). */
  readonly title: string;
  /** Localized honest-count line (`sessions.adminDisputesCountLine(total)`). */
  readonly countLine: string;
}

/** Page title + sticky honest-count bar (renders in every body branch). */
export function AdminDisputesChrome({ title, countLine }: Readonly<AdminDisputesChromeProps>): ReactNode {
  return (
    <Stack sx={{ gap: 2 }}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Box
        sx={theme => ({
          position: "sticky",
          top: { xs: 56, sm: 64 },
          zIndex: theme.zIndex.appBar - 1,
          bgcolor: theme.palette.surfaceContainer,
          backdropFilter: "blur(8px)",
          borderRadius: 2,
          py: 1,
          px: { xs: 0.5, sm: 1 },
          borderBottom: "1px solid",
          borderBottomColor: theme.palette.outlineVariant,
        })}
      >
        <Typography
          variant="body2"
          data-testid="admin-disputes-count"
          sx={theme => ({ color: theme.palette.text.secondary })}
        >
          {countLine}
        </Typography>
      </Box>
    </Stack>
  );
}
