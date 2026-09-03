"use client";

import { Close as CloseIcon, Menu as MenuIcon } from "@mui/icons-material";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { LocaleSwitcher } from "@/frontend/components/LocaleSwitcher";
import {
  BrandMark,
  ColorModeToggleButton,
  DesktopNavLinks,
  type LandingNavLink,
  MobileNavMenu,
} from "@/frontend/views/landing/nav";
import { ctaShimmerSx } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Sticky top nav: brand, desktop section links, desktop actions, mobile drawer. */
export function LandingNav({
  desktopNavLinks,
  navLinks,
  activeSection,
}: Readonly<{
  desktopNavLinks: readonly LandingNavLink[];
  navLinks: readonly LandingNavLink[];
  activeSection: string;
}>): ReactNode {
  const t = useAppTranslation(Landing);
  const { mode, setMode } = useColorScheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleColorMode = () => setMode(mode === "dark" ? "light" : "dark");

  return (
    <Box
      component="nav"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "blur(12px)",
        bgcolor: "color-mix(in srgb, var(--mui-palette-primary-dark) 70%, transparent)",
        borderBottom: "1px solid var(--mui-palette-divider)",
      }}
    >
      <Container maxWidth="lg">
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", py: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <BrandMark size={32} />
            <Typography
              sx={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--mui-palette-onPrimary)" }}
            >
              Kottaby Academy
            </Typography>
          </Stack>

          {/* Desktop section nav links */}
          <DesktopNavLinks desktopNavLinks={desktopNavLinks} activeSection={activeSection} />

          {/* Desktop actions — hidden on xs/sm */}
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", display: { xs: "none", md: "flex" } }}>
            <LocaleSwitcher />
            {/* Dark mode toggle */}
            <ColorModeToggleButton mode={mode} onToggle={toggleColorMode} ariaLabel={t.a11yToggleColorMode} />
            <Button
              component={Link}
              href="/login"
              variant="text"
              sx={{ color: "var(--mui-palette-onPrimary)", fontWeight: 600, textTransform: "none" }}
            >
              {t.navSignIn}
            </Button>
            <Button component={Link} href="/register" variant="contained" sx={{ ...ctaShimmerSx, px: 2.5 }}>
              {t.navGetStarted}
            </Button>
          </Stack>

          {/* Mobile hamburger button — visible on xs/sm only */}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", display: { xs: "flex", md: "none" } }}>
            <ColorModeToggleButton mode={mode} onToggle={toggleColorMode} ariaLabel={t.a11yToggleColorMode} />
            <Button
              onClick={() => setMobileOpen(prev => !prev)}
              sx={{
                minWidth: "auto",
                p: 1,
                color: "var(--mui-palette-onPrimary)",
                borderRadius: 2,
                "&:hover": { bgcolor: "color-mix(in srgb, var(--mui-palette-onPrimary) 10%, transparent)" },
              }}
              aria-label={t.a11yToggleMenu}
            >
              {mobileOpen ? <CloseIcon /> : <MenuIcon />}
            </Button>
          </Stack>
        </Stack>

        <MobileNavMenu
          open={mobileOpen}
          navLinks={navLinks}
          activeSection={activeSection}
          onClose={() => setMobileOpen(false)}
        />
      </Container>
    </Box>
  );
}
