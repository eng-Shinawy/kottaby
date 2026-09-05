"use client";

import type { SchoolOutlined as SchoolIcon } from "@mui/icons-material";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** Stat card shape — used by the dashboard's placeholder stat strip. */
export interface DashboardStat {
  readonly label: string;
  readonly value: string;
  readonly Icon: typeof SchoolIcon;
}

interface DashboardStatCardProps {
  readonly stat: DashboardStat;
}

/** Renders a single placeholder stat card. */
export function DashboardStatCard({ stat }: Readonly<DashboardStatCardProps>): ReactNode {
  const { label, value, Icon } = stat;
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Box>
            <Typography
              variant="caption"
              sx={theme => ({
                color: theme.palette.text.secondary,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
              })}
            >
              {label}
            </Typography>
            <Typography
              variant="h4"
              sx={theme => ({
                fontWeight: 700,
                color: theme.palette.text.primary,
                mt: 0.5,
              })}
            >
              {value}
            </Typography>
          </Box>
          <Box
            sx={theme => ({
              width: 44,
              height: 44,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: theme.palette.primaryContainer,
              color: theme.palette.onPrimaryContainer,
              flexShrink: 0,
            })}
          >
            <Icon fontSize="medium" />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
