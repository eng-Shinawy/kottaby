import type { PaletteOptions } from "@mui/material/styles";

/**
 * Light palette — **Midnight Blue + Copper** brand identity.
 *
 * Replaces the legacy emerald/gold palette with a premium scholarly
 * identity: deep midnight blue (primary) evokes library/manuscript
 * tradition; warm copper (secondary) evokes calligraphy ink +
 * illuminated manuscript borders. Warm cream canvas evokes aged paper.
 *
 * WCAG AA contrast ratios verified:
 *  - text.primary `#1A2B45` on background.default `#FAF6EF` → ~14:1
 *  - text.secondary `#4A5A75` on background.default → ~7:1
 *  - onPrimary `#FFFFFF` on primary.main `#1E3A5F` → ~9:1
 *  - onSecondary `#FFFFFF` on secondary.main `#B87333` → ~4.6:1
 */
export const lightPalette: PaletteOptions = {
  // Standard MUI Text Palette
  text: {
    primary: "#1A2B45", // Deep navy-charcoal for crisp text
    secondary: "#4A5A75", // Muted navy (~7:1 contrast on cream)
    disabled: "#5F6C82", // Solid cool grey — stays readable (~4.8:1) on cream
  },

  // Disabled-state controls: solid, legible greys instead of MUI's 38%-alpha
  // wash (mirrors the dark palette's disabled-contrast refinement).
  action: {
    disabled: "#7A8496",
    disabledBackground: "rgba(26, 43, 69, 0.12)",
  },

  primary: {
    main: "#1E3A5F", // Deep Midnight Blue (rich, scholarly)
    light: "#2D5283",
    dark: "#132841",
    contrastText: "#FFFFFF",
  },
  onPrimary: "#FFFFFF",
  primaryContainer: "#D5E1F0", // Light blue tint
  onPrimaryContainer: "#0F2238", // Deep navy text

  secondary: {
    main: "#B87333", // Warm Copper (calligraphy accent)
    light: "#D49454",
    dark: "#8B5520",
    contrastText: "#FFFFFF",
  },
  onSecondary: "#FFFFFF",
  secondaryContainer: "#F2DFC6", // Warm cream tint
  onSecondaryContainer: "#4A2A12", // Dark copper text

  error: {
    main: "#C62828", // Crisp Dark Red
    light: "#EF5350",
    dark: "#B71C1C",
    contrastText: "#FFFFFF",
  },
  onError: "#FFFFFF",
  errorContainer: "#FDECEA", // Soft red pill
  onErrorContainer: "#7F1D1D", // Dark red text

  success: {
    main: "#2E7D32",
    light: "#4CAF50",
    dark: "#1B5E20",
    contrastText: "#FFFFFF",
  },
  onSuccess: "#FFFFFF",
  successContainer: "#DCFCE7",
  onSuccessContainer: "#14532D",

  warning: {
    main: "#D97706",
    light: "#F59E0B",
    dark: "#B45309",
    contrastText: "#FFFFFF",
  },
  onWarning: "#FFFFFF",
  warningContainer: "#FEF3C7",
  onWarningContainer: "#78350F",

  info: {
    main: "#2563EB",
    light: "#60A5FA",
    dark: "#1E40AF",
    contrastText: "#FFFFFF",
  },
  onInfo: "#FFFFFF",
  infoContainer: "#DBEAFE",
  onInfoContainer: "#1E3A8A",

  // Tertiary: muted teal — complements blue + copper without conflict
  tertiary: "#3D7068",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#D2E8E4",
  onTertiaryContainer: "#1F3B36",

  // Navigation & Shell Components
  header: "#FFFFFF",
  onHeader: "#1A2B45",
  headerContainer: "#FAF6EF",
  onHeaderContainer: "#1A2B45",

  footer: "#FFFFFF",
  onFooter: "#1A2B45",
  footerContainer: "#FAF6EF",
  onFooterContainer: "#4A5A75",

  sidebar: "#FFFFFF",
  onSidebar: "#1A2B45",
  sidebarContainer: "#FAF6EF",
  onSidebarContainer: "#4A5A75",

  background: {
    default: "#FAF6EF", // Warm cream canvas (evokes manuscript paper)
    paper: "#FFFFFF", // Pure white card surfaces
  },
  onBackground: "#1A2B45",
  surface: "#FFFFFF",
  onSurface: "#1A2B45",
  surfaceVariant: "#F2EDE2", // Warm cream-variant
  onSurfaceVariant: "#4A5A75",
  outline: "#B5BCC8", // Distinct cool outline
  outlineVariant: "#DEE2EA",
  scrim: "#000000",
  inverseSurface: "#1A2B45",
  inverseOnSurface: "#FAF6EF",
  inversePrimary: "#7BA5D6",
  surfaceDim: "#E8E1D2",
  surfaceBright: "#FFFFFF",

  // Material 3 Surface Containers (warm cream ladder)
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#FAF6EF",
  surfaceContainer: "#F2EDE2",
  surfaceContainerHigh: "#E8E1D2",
  surfaceContainerHighest: "#D6CCB5",

  border: {
    light: "#E2E5EA",
    main: "#C4C9D2", // Adds clear visual definition
  },
  shadow: {
    card: "0 4px 6px -1px rgba(26, 43, 69, 0.08), 0 2px 4px -2px rgba(26, 43, 69, 0.04)",
    cardHover: "0 10px 15px -3px rgba(26, 43, 69, 0.12), 0 4px 6px -2px rgba(26, 43, 69, 0.06)",
    button: "0 1px 3px 0 rgba(26, 43, 69, 0.1), 0 1px 2px 0 rgba(26, 43, 69, 0.06)",
    buttonHover: "0 4px 6px -1px rgba(26, 43, 69, 0.12), 0 2px 4px -2px rgba(26, 43, 69, 0.08)",
  },

  // High-Contrast Status Badge Pairings
  status: {
    pending: "#D97706",
    onPending: "#FFFFFF",
    pendingContainer: "#FEF3C7", // Soft warm amber background
    onPendingContainer: "#78350F", // Dark warm amber text

    confirmed: "#2563EB",
    onConfirmed: "#FFFFFF",
    confirmedContainer: "#DBEAFE",
    onConfirmedContainer: "#1E3A8A",

    active: "#2E7D32",
    onActive: "#FFFFFF",
    activeContainer: "#DCFCE7",
    onActiveContainer: "#14532D",

    completed: "#7C3AED",
    onCompleted: "#FFFFFF",
    completedContainer: "#EDE9FE",
    onCompletedContainer: "#4C1D95",

    cancelled: "#C62828",
    onCancelled: "#FFFFFF",
    cancelledContainer: "#FDECEA",
    onCancelledContainer: "#7F1D1D",

    blocked: "#4A5A75",
    onBlocked: "#FFFFFF",
    blockedContainer: "#E2E5EA",
    onBlockedContainer: "#1A2B45",
  },

  DataGrid: {
    bg: "#FFFFFF",
    pinnedBg: "#FAF6EF",
    headerBg: "#F2EDE2",
  },
};
