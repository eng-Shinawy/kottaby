import { Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ResourceCardFooter } from "@/frontend/views/landing/sections/resources/ResourceCardFooter";

/** One resource card: category chip, date, clamped title/excerpt, read-more. */
export function ResourceCard({
  title,
  category,
  date,
  excerpt,
  index,
}: Readonly<{ title: string; category: string; date: string; excerpt: string; index: number }>): ReactNode {
  return (
    <Stack
      spacing={2}
      sx={{
        p: 3,
        borderRadius: 3,
        bgcolor: "var(--mui-palette-background-paper)",
        border: "1px solid var(--mui-palette-divider)",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease",
        "&:hover": {
          borderColor: "var(--mui-palette-secondary-main)",
          boxShadow: "0 12px 32px rgba(184,115,51,0.1)",
          transform: "translateY(-4px)",
        },
        "&:active": { transform: "translateY(-2px) scale(0.98)" },
        animation: `staggerFadeIn 0.5s ease ${index * 0.12}s both`,
        "@keyframes staggerFadeIn": {
          "0%": { opacity: 0, transform: "translateY(16px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Chip
          label={category}
          size="small"
          sx={{
            bgcolor: "var(--mui-palette-secondary-main)",
            color: "var(--mui-palette-onSecondary)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.02em",
            height: 24,
            opacity: 0.12,
          }}
        />
        <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)", fontSize: 12 }}>
          {date}
        </Typography>
      </Stack>
      <Typography
        variant="h6"
        sx={{
          fontWeight: 700,
          fontSize: 17,
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {title}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "var(--mui-palette-text-secondary)",
          lineHeight: 1.6,
          flex: 1,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {excerpt}
      </Typography>
      <ResourceCardFooter />
    </Stack>
  );
}
