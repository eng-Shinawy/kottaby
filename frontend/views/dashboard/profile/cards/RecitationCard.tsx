"use client";

import { MenuBookOutlined as MenuBookIcon } from "@mui/icons-material";
import { Alert, Box, Card, CardContent, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";
import type { RecitationLabels } from "@/shared/locale/types/recitation";

interface RecitationCardProps {
  readonly recitationLabel: string | null;
  readonly recitationDescription: string | null;
  readonly t: DashboardLabels;
  readonly tRecitation: RecitationLabels;
}

/** Recitation Reading card: current preferred recitation with description. */
export function RecitationCard({
  recitationLabel,
  recitationDescription,
  t,
  tRecitation,
}: Readonly<RecitationCardProps>): ReactNode {
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
      })}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
          <MenuBookIcon fontSize="small" sx={theme => ({ color: theme.palette.primary.main })} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t.recitationReading}
          </Typography>
        </Stack>
        {recitationLabel ? (
          <Box
            sx={theme => ({
              p: 2,
              borderRadius: 2,
              bgcolor: theme.palette.primaryContainer,
              color: theme.palette.onPrimaryContainer,
            })}
          >
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {recitationLabel}
            </Typography>
            {recitationDescription ? (
              <Typography variant="caption" sx={{ opacity: 0.85, mt: 0.5, display: "block" }}>
                {recitationDescription}
              </Typography>
            ) : null}
          </Box>
        ) : (
          <Alert severity="info" variant="outlined">
            {tRecitation.selectHelper}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
