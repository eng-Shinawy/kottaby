"use client";

import { Box, Card, Typography } from "@mui/material";
import type { ReactNode } from "react";

type StatColor = "primary" | "success" | "warning" | "info";

function resolvePalette(
  theme: {
    palette: {
      primary: { main: string; contrastText: string };
      success: { main: string; contrastText: string };
      warning: { main: string; contrastText: string };
      info: { main: string; contrastText: string };
    };
  },
  color: StatColor
): { bgcolor: string; fg: string } {
  if (color === "primary") {
    return { bgcolor: theme.palette.primary.main, fg: theme.palette.primary.contrastText };
  }
  if (color === "success") {
    return { bgcolor: theme.palette.success.main, fg: theme.palette.success.contrastText };
  }
  if (color === "warning") {
    return { bgcolor: theme.palette.warning.main, fg: theme.palette.warning.contrastText };
  }
  return { bgcolor: theme.palette.info.main, fg: theme.palette.info.contrastText };
}

export function SharedStatCard({
  icon,
  value,
  label,
  color,
}: Readonly<{ icon: ReactNode; value: string; label: string; color: StatColor }>): ReactNode {
  return (
    <Card
      variant="outlined"
      sx={theme => ({
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.5,
        padding: 1.5,
        borderRadius: 2,
        borderColor: theme.palette.divider,
        flex: 1,
        minWidth: 0,
      })}
    >
      <Box
        sx={theme => {
          const { bgcolor, fg } = resolvePalette(theme, color);
          return {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            bgcolor,
            color: fg,
          };
        }}
      >
        {icon}
      </Box>
      <Typography variant="h6" component="span" dir="auto" sx={{ fontWeight: 700, lineHeight: 1.2, fontSize: "1rem" }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, textAlign: "center" })}>
        {label}
      </Typography>
    </Card>
  );
}
