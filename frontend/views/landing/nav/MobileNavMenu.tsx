import { Box, Button, Stack } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LandingNavLink } from "@/frontend/views/landing/nav";
import { ctaShimmerSx } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Mobile nav backdrop + slide-down menu (anchor links + auth CTAs). */
export function MobileNavMenu({
  open,
  navLinks,
  activeSection,
  onClose,
}: Readonly<{
  open: boolean;
  navLinks: readonly LandingNavLink[];
  activeSection: string;
  onClose: () => void;
}>): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <>
      {/* Mobile nav backdrop */}
      <Box
        onClick={onClose}
        sx={theme => ({
          position: "fixed",
          inset: 0,
          bgcolor: `color-mix(in srgb, ${theme.palette.common.black} 50%, transparent)`,
          zIndex: 99,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.3s ease",
        })}
      />

      {/* Mobile slide-down menu */}
      <Box
        sx={{
          // 12 nav links + auth CTAs exceed the old 500px cap, silently
          // clipping the trailing Achievements/Curriculum entries.
          maxHeight: open ? 720 : 0,
          overflowY: "auto",
          overflowX: "hidden",
          transition: "max-height 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <Stack
          spacing={1}
          sx={{
            py: 2,
            borderTop: "1px solid var(--mui-palette-divider)",
          }}
        >
          {navLinks.map(link => {
            const isActive = link.href === `#${activeSection}`;
            return (
              <Button
                key={link.href}
                href={link.href}
                fullWidth
                onClick={onClose}
                sx={{
                  color: isActive ? "var(--mui-palette-secondary-light)" : "var(--mui-palette-onPrimary)",
                  justifyContent: "flex-start",
                  fontWeight: 600,
                  textTransform: "none",
                  borderRadius: 1.5,
                  px: 2,
                  py: 1.2,
                  borderLeft: isActive ? "3px solid var(--mui-palette-secondary-main)" : "3px solid transparent",
                  "&:hover": { bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 12%, transparent)" },
                }}
              >
                {link.label}
              </Button>
            );
          })}
          <Stack direction="row" spacing={1.5} sx={{ pt: 1.5, px: 1 }}>
            <Button
              component={Link}
              href="/login"
              variant="outlined"
              fullWidth
              sx={{
                color: "var(--mui-palette-onPrimary)",
                borderColor: "color-mix(in srgb, var(--mui-palette-onPrimary) 30%, transparent)",
                fontWeight: 600,
                textTransform: "none",
                borderRadius: 2,
              }}
            >
              {t.navSignIn}
            </Button>
            <Button component={Link} href="/register" variant="contained" fullWidth sx={ctaShimmerSx}>
              {t.navGetStarted}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </>
  );
}
