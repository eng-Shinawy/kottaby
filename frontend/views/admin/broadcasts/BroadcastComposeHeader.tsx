"use client";

/**
 * BroadcastComposeHeader — the compose surface heading: the `CampaignOutlined`
 * brand icon beside the page title/subtitle pair.
 */

import { CampaignOutlined } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

interface BroadcastComposeHeaderProps {
  readonly labels: AdminBroadcastsLabels;
}

export function BroadcastComposeHeader(props: BroadcastComposeHeaderProps): ReactNode {
  return (
    <Stack
      sx={{
        alignItems: { xs: "flex-start", sm: "center" },
        flexDirection: "row",
        gap: 2,
        marginBlockEnd: 3,
      }}
    >
      <Box
        aria-hidden
        sx={theme => ({
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          borderRadius: 2,
          flexShrink: 0,
          backgroundColor: `color-mix(in srgb, ${theme.palette.primary.main} 14%, transparent)`,
        })}
      >
        <CampaignOutlined sx={theme => ({ color: theme.palette.primary.main, fontSize: 30 })} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          {props.labels.pageTitle}
        </Typography>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
          {props.labels.pageSubtitle}
        </Typography>
      </Box>
    </Stack>
  );
}
