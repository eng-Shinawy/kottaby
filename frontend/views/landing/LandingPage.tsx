"use client";

import { Box } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SiteFooter } from "@/frontend/components/SiteFooter";
import {
  BackToTopButton,
  FooterBanner,
  LandingMainSections,
  ModeFlashOverlay,
  ScrollProgressBar,
  SkipToContentLink,
} from "@/frontend/views/landing/layout";
import { LANDING_SECTION_IDS, LandingNav, useLandingNavLinks, useScrollSpy } from "@/frontend/views/landing/nav";
import { CookieConsent, HeroSection, HijriPrayerStrip, WhatsAppButton } from "@/frontend/views/landing/sections";

/**
 * Landing page — the public front door of Kottaby Academy at `/`.
 *
 * Replaces the prior `redirect("/dashboard")` (which bounced anonymous
 * visitors to `/login` and wasted the most valuable URL). This page is a
 * rich marketing surface: hero, stats bar, features grid, recitations
 * showcase, how-it-works, roles, testimonials, FAQ, newsletter, final CTA,
 * and footer.
 *
 * **Lightweight by design**: no Apollo queries, no auth hooks, no mutation
 * imports — only MUI + i18n. This keeps the turbopack compile footprint
 * small enough to survive the 4 GB / no-swap sandbox.
 *
 * Design (Midnight Blue + Copper brand):
 *  - Hero: midnight-blue gradient with Islamic geometric tessellation +
 *    copper radial glow. Big headline with copper accent word.
 *  - Sections alternate between `background.default` and `background.paper`
 *    for rhythm.
 *  - All accents (badges, icons, underlines, buttons) use copper
 *    (`secondary-main`).
 *
 * Client component — needs `useAppTranslation(Landing)` for bilingual copy.
 * RTL is handled automatically by MUI + the locale-aware Emotion cache.
 */
export function LandingPage(): ReactNode {
  const { mode } = useColorScheme();
  const prevMode = useRef(mode);
  const [modeFlash, setModeFlash] = useState(false);

  useEffect(() => {
    document.documentElement.style.scrollBehavior = "smooth";
  }, []);

  useEffect(() => {
    // Uniform cleanup kind on every path (oxlint consistent-return): the
    // timer only exists on real mode flips.
    if (prevMode.current === mode) {
      return undefined;
    }
    prevMode.current = mode;
    setModeFlash(true);
    const timer = setTimeout(() => setModeFlash(false), 300);
    return () => clearTimeout(timer);
  }, [mode]);

  const activeSection = useScrollSpy(LANDING_SECTION_IDS);
  const { navLinks, desktopNavLinks } = useLandingNavLinks();

  return (
    <Box
      component="div"
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        bgcolor: "var(--mui-palette-background-default)",
      }}
    >
      <SkipToContentLink />
      <ScrollProgressBar />
      <LandingNav desktopNavLinks={desktopNavLinks} navLinks={navLinks} activeSection={activeSection} />
      <HeroSection />
      <HijriPrayerStrip />
      <LandingMainSections />
      <ModeFlashOverlay mode={mode} modeFlash={modeFlash} />
      <SiteFooter />
      <FooterBanner />
      <BackToTopButton />
      <WhatsAppButton />
      <CookieConsent />
    </Box>
  );
}
