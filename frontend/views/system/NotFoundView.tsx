"use client";

import { SearchOffOutlined } from "@mui/icons-material";
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/frontend/views/landing/nav/BrandMark";
import { Landing, useAppTranslation } from "@/shared/locale";

/**
 * NotFoundView — branded global 404 for any unmatched URL.
 *
 * Rendered by `app/not-found.tsx` (root not-found boundary). Replaces the
 * default English LTR Next.js error page, which leaked into the Arabic-RTL
 * app whenever a stale or mistyped route was hit.
 *
 * Design mirrors the dashboard `ComingSoonView` placeholder card (copper
 * icon disc, quiet surface card) topped with the landing brand row, so the
 * page reads as part of the product in both locales. Direction comes from
 * the root `<html dir>` (cookie-driven); layout uses logical flex/gap only,
 * so it is RTL-safe by construction.
 */
export function NotFoundView(): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Box
      component="main"
      id="main-content"
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "var(--mui-palette-background-default)",
        px: 2,
        py: 6,
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 560 }}>
        {/* Brand row — matches the landing nav/footer identity */}
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", justifyContent: "center", mb: 4 }}>
          <BrandMark size={32} />
          <Typography sx={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>Kottaby Academy</Typography>
        </Stack>

        <Card
          elevation={0}
          sx={theme => ({
            width: "100%",
            borderRadius: 3,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            bgcolor: theme.palette.surfaceContainerLow,
          })}
        >
          <CardContent sx={{ p: { xs: 3, sm: 5 }, textAlign: "center" }}>
            <Box
              sx={theme => ({
                width: 72,
                height: 72,
                mx: "auto",
                mb: 3,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: theme.palette.secondaryContainer,
                color: theme.palette.onSecondaryContainer,
              })}
            >
              <SearchOffOutlined sx={{ fontSize: 36 }} />
            </Box>

            <Typography
              variant="overline"
              sx={theme => ({
                display: "block",
                color: theme.palette.text.secondary,
                letterSpacing: "0.35em",
                fontWeight: 700,
                direction: "ltr",
              })}
            >
              404
            </Typography>

            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
              {t.notFoundTitle}
            </Typography>
            <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary, lineHeight: 1.7 })}>
              {t.notFoundBody}
            </Typography>

            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "center", mt: 4 }}>
              <Button
                component={Link}
                href="/"
                variant="contained"
                sx={{
                  textTransform: "none",
                  fontWeight: 700,
                  px: 3,
                  minHeight: 44,
                  bgcolor: "var(--mui-palette-secondary-main)",
                  color: "var(--mui-palette-onSecondary)",
                  "&:hover": { bgcolor: "var(--mui-palette-secondary-dark)" },
                }}
              >
                {t.notFoundBackHome}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
