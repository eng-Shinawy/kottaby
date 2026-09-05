import { MosqueOutlined as MosqueIcon } from "@mui/icons-material";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { CtaDecor } from "@/frontend/views/landing/sections/cta/CtaDecor";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Final CTA ───────────────────────────────────────────────────────

export function CtaSection(): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Box
      component="section"
      sx={{
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(135deg, var(--mui-palette-primary-dark) 0%, var(--mui-palette-primary-main) 100%)",
        color: "var(--mui-palette-onPrimary)",
      }}
    >
      <CtaDecor />

      <Container maxWidth="md" sx={{ position: "relative", zIndex: 1, py: { xs: 6, md: 10 } }}>
        <Stack spacing={3} sx={{ alignItems: "center", textAlign: "center" }}>
          <MosqueIcon sx={{ fontSize: 48, color: "var(--mui-palette-secondary-light)", opacity: 0.9 }} />
          <Typography
            variant="h2"
            sx={{
              fontSize: { xs: 28, md: 40 },
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              m: 0,
              background:
                "linear-gradient(120deg, var(--mui-palette-onPrimary) 30%, var(--mui-palette-secondary-light) 50%, var(--mui-palette-onPrimary) 70%)",
              backgroundSize: "200% auto",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
              animation: "textShine 4s linear infinite",
              "@keyframes textShine": {
                "0%": { backgroundPosition: "200% center" },
                "100%": { backgroundPosition: "-200% center" },
              },
            }}
          >
            {t.ctaTitle}
          </Typography>
          <Typography
            variant="h6"
            component="p"
            sx={{ maxWidth: 520, opacity: 0.85, fontWeight: 400, fontSize: { xs: 15, md: 17 } }}
          >
            {t.ctaSubtitle}
          </Typography>
          <Button
            component={Link}
            href="/register"
            variant="contained"
            size="large"
            sx={{
              mt: 1,
              position: "relative",
              overflow: "hidden",
              bgcolor: "var(--mui-palette-secondary-main)",
              color: "var(--mui-palette-onSecondary)",
              fontWeight: 700,
              textTransform: "none",
              fontSize: 17,
              borderRadius: 2,
              px: 5,
              py: 1.5,
              boxShadow: "0 8px 24px rgba(184,115,51,0.4)",
              "&::after": {
                content: '""',
                position: "absolute",
                top: 0,
                left: "-100%",
                width: "100%",
                height: "100%",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
                transition: "left 0.5s ease",
              },
              "&:hover": {
                bgcolor: "var(--mui-palette-secondary-dark)",
                transform: "translateY(-2px)",
                "&::after": { left: "100%" },
              },
              transition: "all 0.2s ease",
            }}
          >
            {t.ctaButton}
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
