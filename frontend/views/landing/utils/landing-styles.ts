// ─── Shared landing markup styles (single source for repeated blocks) ───────

/** Shimmer-sweep CTA button styling (nav, mobile drawer, cookie dialog). */
export const ctaShimmerSx = {
  position: "relative",
  overflow: "hidden",
  bgcolor: "var(--mui-palette-secondary-main)",
  color: "var(--mui-palette-onSecondary)",
  fontWeight: 700,
  textTransform: "none",
  borderRadius: 2,
  // Tap floor — the padding-only newsletter submit measured 40px in QA.
  minHeight: 44,
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
    "&::after": { left: "100%" },
  },
};

export const sectionBadgeLineSx = {
  width: 24,
  height: 2,
  bgcolor: "var(--mui-palette-secondary-main)",
};

/** Newsletter section shell with the pulsing accent border (used by both success and form states). */
export const newsletterShellSx = {
  position: "relative",
  bgcolor: "var(--mui-palette-background-paper)",
  py: { xs: 6, md: 10 },
  pl: 3,
  "&::before": {
    content: '""',
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 5,
    background: "linear-gradient(to bottom, var(--mui-palette-secondary-main), transparent)",
    animation: "newsletterBorderPulse 2s ease-in-out infinite",
    "@keyframes newsletterBorderPulse": {
      "0%, 100%": { opacity: 0.7 },
      "50%": { opacity: 1 },
    },
  },
};

/**
 * Module-level style variants for the pricing card — the popular/standard
 * ternary tree collapsed into two single lookups so the component stays far
 * under the sonarjs cognitive-complexity ceiling. All colors are palette
 * CSS variables (sx-only; no raw hex outside the brand shadow constants
 * already in use across this page).
 */
export const POPULAR_CARD_SX = {
  p: 4,
  borderRadius: 3,
  bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 6%, var(--mui-palette-background-paper))",
  border: "2px solid var(--mui-palette-secondary-main)",
  boxShadow: "0 12px 32px rgba(184,115,51,0.18)",
  transform: "translateY(-8px)",
  position: "relative",
  transition: "box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease",
  height: "100%",
  overflow: "hidden",
  animation: "pricingScaleIn 0.3s ease",
  "@keyframes pricingScaleIn": {
    "0%": { transform: "translateY(-8px) scale(0.97)" },
    "100%": { transform: "translateY(-8px) scale(1)" },
  },
} as const;

export const STANDARD_CARD_SX = {
  ...POPULAR_CARD_SX,
  bgcolor: "var(--mui-palette-background-paper)",
  border: "1px solid var(--mui-palette-divider)",
  boxShadow: "none",
  transform: "none",
  "&:hover": {
    borderColor: "var(--mui-palette-secondary-main)",
    boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
    transform: "translateY(-4px)",
  },
  "@keyframes pricingScaleIn": {
    "0%": { transform: "scale(0.97)" },
    "100%": { transform: "scale(1)" },
  },
} as const;

export const POPULAR_CTA_SX = {
  position: "relative",
  zIndex: 1,
  overflow: "hidden",
  bgcolor: "var(--mui-palette-secondary-main)",
  color: "var(--mui-palette-onSecondary)",
  borderColor: "transparent",
  fontWeight: 700,
  textTransform: "none",
  borderRadius: 2,
  py: 1.2,
  // Tap floor — the padding-only height measured 40px in visual QA.
  minHeight: 44,
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
    borderColor: "transparent",
    "&::after": { left: "100%" },
  },
} as const;

export const STANDARD_CTA_SX = {
  position: "relative",
  zIndex: 1,
  overflow: "visible",
  bgcolor: "transparent",
  color: "var(--mui-palette-secondary-main)",
  borderColor: "var(--mui-palette-secondary-main)",
  fontWeight: 700,
  textTransform: "none",
  borderRadius: 2,
  py: 1.2,
  // Tap floor — matches the popular-plan CTA.
  minHeight: 44,
  "&:hover": {
    bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 8%, transparent)",
    borderColor: "var(--mui-palette-secondary-dark)",
  },
} as const;
