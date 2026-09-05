import { Button, Stack } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Hero CTA row (register / sign-in). */
export function HeroCtas(): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ pt: 1 }}>
      <Button
        component={Link}
        href="/register"
        variant="contained"
        size="large"
        sx={{
          position: "relative",
          overflow: "hidden",
          bgcolor: "var(--mui-palette-secondary-main)",
          color: "var(--mui-palette-onSecondary)",
          fontWeight: 700,
          textTransform: "none",
          fontSize: 16,
          borderRadius: 2,
          px: 4,
          py: 1.5,
          boxShadow: "0 8px 24px rgba(184,115,51,0.35)",
          "&:hover": {
            bgcolor: "var(--mui-palette-secondary-dark)",
            transform: "translateY(-2px)",
            "&::after": {
              content: '""',
              position: "absolute",
              top: 0,
              left: "-100%",
              width: "100%",
              height: "100%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
              transition: "left 0.5s ease",
            },
          },
          "&:hover::after": {
            left: "100%",
          },
          transition: "all 0.2s ease",
        }}
      >
        {t.heroCtaPrimary}
      </Button>
      <Button
        component={Link}
        href="/login"
        variant="outlined"
        size="large"
        sx={{
          color: "var(--mui-palette-onPrimary)",
          borderColor: "color-mix(in srgb, var(--mui-palette-onPrimary) 30%, transparent)",
          fontWeight: 700,
          textTransform: "none",
          fontSize: 16,
          borderRadius: 2,
          px: 4,
          py: 1.5,
          "&:hover": {
            borderColor: "var(--mui-palette-secondary-light)",
            bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 8%, transparent)",
          },
          transition: "all 0.2s ease",
        }}
      >
        {t.heroCtaSecondary}
      </Button>
    </Stack>
  );
}
