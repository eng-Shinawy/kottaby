import type { PaletteOptions } from "@mui/material/styles";

/**
 * Dark palette — **Midnight Blue + Copper** brand identity (dark variant).
 *
 * A dark mirror of the light palette: deep midnight-navy canvas with a
 * luminous midnight-blue primary (lighter than the light-mode #1E3A5F so it
 * stays visible on the #0A1422 canvas, but still recognizably "midnight
 * blue" — NOT sky-blue) and bright copper accent.
 *
 * The primary ladder (#3D6BA0 main / #2A4F7A dark / #5A8BC5 light) is a
 * single hue family with the light-mode #1E3A5F — only luminance shifts,
 * so the brand identity reads consistently across themes.
 *
 * WCAG AA contrast ratios verified:
 *  - text.primary `#F1F5FB` on background.default `#0A1422` → ~16:1
 *  - text.secondary `#A8B5CC` on background.default → ~8:1
 *  - onPrimary `#FFFFFF` on primary.main `#3D6BA0` → ~5.4:1 (AA for normal text)
 *  - onSecondary `#1A0E05` on secondary.main `#E0985C` → ~7:1
 */
export const darkPalette: PaletteOptions = {
  // Standard MUI Text Palette (WCAG 2.1 AA Compliant high contrast)
  text: {
    primary: "#F1F5FB", // High contrast cool-white for primary text
    secondary: "#A8B5CC", // Muted sky-blue (~8:1 contrast ratio)
    disabled: "#8792A3", // Muted slate — solid grey that stays readable (~5:1) on navy surfaces
  },

  // Disabled-state controls: solid, legible greys instead of MUI's 38%-alpha
  // wash, which read as "invisible" in visual QA (profile save button +
  // status chips). Still clearly inert — the not-allowed cursor + no hover
  // feedback carry the disabled affordance.
  action: {
    disabled: "#7E8AA0",
    disabledBackground: "rgba(241, 245, 251, 0.16)",
  },

  primary: {
    main: "#3D6BA0", // Luminous midnight blue (brand-consistent, visible on dark navy)
    light: "#5A8BC5",
    dark: "#2A4F7A",
    contrastText: "#FFFFFF",
  },
  onPrimary: "#FFFFFF",
  primaryContainer: "#1B3358", // Dark navy background
  onPrimaryContainer: "#C9DCFA", // Bright sky-blue text

  secondary: {
    main: "#E0985C", // Bright copper (pops on dark)
    light: "#EDB47D",
    dark: "#B87333",
    contrastText: "#1A0E05",
  },
  onSecondary: "#1A0E05",
  secondaryContainer: "#5C3315", // Dark copper-brown
  onSecondaryContainer: "#F5DFC4", // Bright cream text

  error: {
    main: "#F87171", // Bright Red for visibility
    light: "#FCA5A5",
    dark: "#DC2626",
    contrastText: "#450A0A",
  },
  onError: "#450A0A",
  errorContainer: "#450A0A", // Rich dark crimson container
  onErrorContainer: "#FECACA", // High legibility light red text

  success: {
    main: "#4ADE80",
    light: "#86EFAC",
    dark: "#16A34A",
    contrastText: "#052E16",
  },
  onSuccess: "#052E16",
  successContainer: "#14532D",
  onSuccessContainer: "#DCFCE7",

  warning: {
    main: "#FBBF24",
    light: "#FDE047",
    dark: "#D97706",
    contrastText: "#451A03",
  },
  onWarning: "#451A03",
  warningContainer: "#78350F",
  onWarningContainer: "#FEF3C7",

  info: {
    main: "#60A5FA",
    light: "#93C5FD",
    dark: "#2563EB",
    contrastText: "#0A1828",
  },
  onInfo: "#0A1828",
  infoContainer: "#1E3A8A",
  onInfoContainer: "#DBEAFE",

  // Tertiary: muted teal — complements blue + copper without conflict
  tertiary: "#5FA89E",
  onTertiary: "#0A1F1B",
  tertiaryContainer: "#1F3B36",
  onTertiaryContainer: "#B5DBD3",

  // Navigation & Shell Components (deep navy shells)
  header: "#0F1A2A",
  onHeader: "#F1F5FB",
  headerContainer: "#0F1A2A",
  onHeaderContainer: "#F1F5FB",

  footer: "#0F1A2A",
  onFooter: "#F1F5FB",
  footerContainer: "#0F1A2A",
  onFooterContainer: "#A8B5CC",

  sidebar: "#0F1A2A",
  onSidebar: "#F1F5FB",
  sidebarContainer: "#0F1A2A",
  onSidebarContainer: "#A8B5CC",

  background: {
    default: "#0A1422", // Deep midnight-navy canvas
    paper: "#101E33", // Elevated navy-tinted surface
  },
  onBackground: "#F1F5FB",
  surface: "#101E33",
  onSurface: "#F1F5FB",
  surfaceVariant: "#1A2C45",
  onSurfaceVariant: "#A8B5CC",
  outline: "#2D3F58",
  outlineVariant: "#1E2F48",
  scrim: "#000000",
  inverseSurface: "#F1F5FB",
  inverseOnSurface: "#1A2B45",
  inversePrimary: "#1E3A5F",
  surfaceDim: "#070F1C",
  surfaceBright: "#1F335C",

  // Material 3 Surface Layering (deepening navy ladder)
  surfaceContainerLowest: "#070F1C",
  surfaceContainerLow: "#0C1726",
  surfaceContainer: "#101E33",
  surfaceContainerHigh: "#16264A",
  surfaceContainerHighest: "#1F335C",

  border: {
    light: "#1E2F48",
    main: "#2D3F58",
  },
  shadow: {
    card: "0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -2px rgba(0, 0, 0, 0.5)",
    cardHover: "0 10px 15px -3px rgba(0, 0, 0, 0.8), 0 4px 6px -2px rgba(0, 0, 0, 0.4)",
    button: "0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px 0 rgba(0, 0, 0, 0.2)",
    buttonHover: "0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -2px rgba(0, 0, 0, 0.5)",
  },

  // High-Contrast Status Badge Pairings
  status: {
    pending: "#FBBF24",
    onPending: "#451A03",
    pendingContainer: "#451A03",
    onPendingContainer: "#FDE68A",

    confirmed: "#60A5FA",
    onConfirmed: "#0A1828",
    confirmedContainer: "#1E3A8A",
    onConfirmedContainer: "#DBEAFE",

    active: "#4ADE80",
    onActive: "#052E16",
    activeContainer: "#14532D",
    onActiveContainer: "#DCFCE7",

    completed: "#A78BFA",
    onCompleted: "#1E1B4B",
    completedContainer: "#4C1D95",
    onCompletedContainer: "#EDE9FE",

    cancelled: "#F87171",
    onCancelled: "#450A0A",
    cancelledContainer: "#450A0A",
    onCancelledContainer: "#FECACA",

    blocked: "#94A3B8",
    onBlocked: "#0F172A",
    blockedContainer: "#1E293B",
    onBlockedContainer: "#F1F5F9",
  },

  DataGrid: {
    bg: "#101E33",
    pinnedBg: "#0F1A2A",
    headerBg: "#16264A",
  },
};
