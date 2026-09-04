import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface RecitationItem {
  readonly name: string;
  readonly arabic: string;
  readonly popular?: boolean;
}

/** Recitation grid (or empty state) for the filtered list. */
export function RecitationGrid({
  filtered,
  noResultsLabel,
}: Readonly<{ filtered: readonly RecitationItem[]; noResultsLabel: string }>): ReactNode {
  if (filtered.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 6 }}>
        <Typography variant="body1" sx={{ color: "var(--mui-palette-text-secondary)" }}>
          {noResultsLabel}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr", lg: "1fr 1fr 1fr 1fr 1fr" },
        gap: 2,
      }}
    >
      {filtered.map(r => (
        <Stack
          key={r.name}
          spacing={0.75}
          sx={{
            p: 2,
            borderRadius: 2,
            bgcolor: "var(--mui-palette-background-default)",
            border: "1px solid var(--mui-palette-divider)",
            position: "relative",
            transition: "border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
            "&:hover": {
              borderColor: "var(--mui-palette-secondary-main)",
              transform: "translateY(-4px)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
            },
          }}
        >
          {r.popular ? (
            <Box
              sx={{
                position: "absolute",
                top: -8,
                insetInlineEnd: 8,
                px: 1,
                py: 0.25,
                borderRadius: 99,
                bgcolor: "var(--mui-palette-secondary-main)",
                color: "var(--mui-palette-onSecondary)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Popular
            </Box>
          ) : null}
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: "var(--mui-palette-text-primary)", lineHeight: 1.3 }}>
            {r.name}
          </Typography>
          <Typography
            sx={{
              fontSize: 14,
              color: "var(--mui-palette-secondary-main)",
              fontFamily: '"Cairo", sans-serif',
              direction: "rtl",
            }}
          >
            {r.arabic}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}
