"use client";

/**
 * PanelCard — the shared chrome of the admin dashboard's panel family
 * (extracted when the country distribution panel joined the cooldown
 * lifecycle panel and the identical Card shell tripped the duplicates
 * gate): the outlined, low-surface card with hover shadow, the `h2`
 * headline, and the balanced secondary subtitle. Copy arrives via props;
 * the panel body renders as `children` — presentation only.
 */

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export function PanelCard({
  title,
  subtitle,
  children,
}: Readonly<{ readonly title: string; readonly subtitle: string; readonly children: ReactNode }>): ReactNode {
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        transition: theme.transitions.create(["box-shadow", "border-color"], {
          duration: theme.transitions.duration.short,
          easing: theme.transitions.easing.easeOut,
        }),
        "&:hover": {
          boxShadow: theme.shadows[2],
        },
      })}
    >
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
            {title}
          </Typography>
          <Typography
            variant="body2"
            sx={theme => ({ color: theme.palette.text.secondary, mt: 0.5, textWrap: "balance" })}
          >
            {subtitle}
          </Typography>
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}
