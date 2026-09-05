import type { Components, Theme } from "@mui/material/styles";

/**
 * MD3 switch geometry (material-web md-comp-switch), scaled ~0.7 for dense UI.
 * Spec medium is 52×32 / thumbs 16→24; we use 36×22 / 10→16 so tables stay readable.
 */
const MD3_SWITCH = {
  trackWidth: 36,
  trackHeight: 22,
  trackOutlineWidth: 2,
  unselectedThumb: 10,
  selectedThumb: 16,
  pressedThumb: 20,
  /** (trackHeight - unselectedThumb) / 2 */
  unselectedMargin: 6,
  /** (trackHeight - selectedThumb) / 2 */
  selectedMargin: 3,
  /** Leading-edge offset so selected thumb sits with selectedMargin inset. */
  checkedTranslateX: 14,
  small: {
    trackWidth: 28,
    trackHeight: 18,
    unselectedThumb: 8,
    selectedThumb: 12,
    pressedThumb: 16,
    unselectedMargin: 5,
    selectedMargin: 3,
    checkedTranslateX: 10,
  },
} as const;

type SwitchPaletteColor = "primary" | "secondary" | "error" | "info" | "success" | "warning";

const SWITCH_ON_COLORS: Record<
  SwitchPaletteColor,
  "onPrimary" | "onSecondary" | "onError" | "onInfo" | "onSuccess" | "onWarning"
> = {
  primary: "onPrimary",
  secondary: "onSecondary",
  error: "onError",
  info: "onInfo",
  success: "onSuccess",
  warning: "onWarning",
};

const isSwitchPaletteColor = (color: string): color is SwitchPaletteColor => Object.hasOwn(SWITCH_ON_COLORS, color);

const getSwitchOnColor = (theme: Theme, color: string | undefined): string => {
  if (color && isSwitchPaletteColor(color)) {
    return theme.palette[SWITCH_ON_COLORS[color]];
  }
  return theme.palette.onPrimary;
};

const getSwitchMainColor = (theme: Theme, color: string | undefined): string => {
  if (color && isSwitchPaletteColor(color)) {
    return theme.palette[color].main;
  }
  return theme.palette.primary.main;
};

type SwitchGeo = typeof MD3_SWITCH | typeof MD3_SWITCH.small;

/** SwitchBase interaction states: hover, focus, active, checked, disabled. */
const getSwitchBaseStyles = (theme: Theme, geo: SwitchGeo, main: string, onColor: string): Record<string, unknown> => ({
  padding: 0,
  margin: geo.unselectedMargin,
  color: theme.palette.outline,
  transition: theme.transitions.create(["transform", "margin", "color"], {
    duration: theme.transitions.duration.shortest,
  }),
  "&:hover": {
    backgroundColor: theme.alpha(theme.palette.onSurface, theme.palette.action.hoverOpacity),
    "@media (hover: none)": {
      backgroundColor: "transparent",
    },
  },
  "&.Mui-focusVisible": {
    backgroundColor: theme.alpha(theme.palette.onSurface, theme.palette.action.focusOpacity),
  },
  // Disabled inert affordance: the theme's MuiButtonBase override restores
  // pointer events on `.Mui-disabled` (for the not-allowed cursor), which would
  // let the hover tints above repaint an inert switch. Explicit suppression —
  // needed here because these rules share or exceed the ButtonBase-level rule's
  // specificity (the checked variant's hover is (0,3,0)).
  "&.Mui-disabled:hover": {
    backgroundColor: "transparent",
  },
  "&:active .MuiSwitch-thumb": {
    width: geo.pressedThumb,
    height: geo.pressedThumb,
  },
  "&.Mui-checked": {
    transform: `translateX(${geo.checkedTranslateX}px)`,
    margin: geo.selectedMargin,
    color: onColor,
    "&:hover": {
      backgroundColor: theme.alpha(main, theme.palette.action.hoverOpacity),
      "@media (hover: none)": {
        backgroundColor: "transparent",
      },
    },
    "&.Mui-disabled:hover": {
      backgroundColor: "transparent",
    },
    "&.Mui-focusVisible": {
      backgroundColor: theme.alpha(main, theme.palette.action.focusOpacity),
    },
    "& .MuiSwitch-thumb": {
      width: geo.selectedThumb,
      height: geo.selectedThumb,
    },
    "& + .MuiSwitch-track": {
      opacity: 1,
      backgroundColor: main,
      borderColor: main,
    },
  },
  "&.Mui-checked.Mui-disabled": {
    color: theme.palette.surface,
    "& .MuiSwitch-thumb": {
      opacity: 1,
    },
    "& + .MuiSwitch-track": {
      // Track opacity stays above the 0.12 MUI default: a barely-there track
      // read as "extremely faint" in visual QA — visible-but-grey still
      // communicates inert without disappearing.
      opacity: 0.32,
      backgroundColor: theme.palette.onSurface,
      borderColor: theme.palette.onSurface,
    },
  },
  "&.Mui-disabled": {
    color: theme.palette.onSurface,
    "& .MuiSwitch-thumb": {
      opacity: 0.55,
    },
    "& + .MuiSwitch-track": {
      opacity: 0.32,
      backgroundColor: theme.palette.surfaceContainerHighest,
      borderColor: theme.palette.onSurface,
    },
  },
});

/** Thumb element geometry and transition for unselected state. */
const getSwitchThumbStyles = (geo: SwitchGeo): Record<string, unknown> => ({
  width: geo.unselectedThumb,
  height: geo.unselectedThumb,
  boxShadow: "none",
  border: "none",
  transition: "width 100ms ease, height 100ms ease",
});

/** Track element base appearance: outlined outline when off. */
const getSwitchTrackStyles = (theme: Theme, geo: SwitchGeo): Record<string, unknown> => ({
  borderRadius: geo.trackHeight / 2,
  opacity: 1,
  backgroundColor: theme.palette.surfaceContainerHighest,
  border: `${MD3_SWITCH.trackOutlineWidth}px solid ${theme.palette.outline}`,
  boxSizing: "border-box",
});

/**
 * Restyles MUI's MD2 Switch to Material Design 3 geometry and color roles.
 *
 * Spec roles (material-web md-comp-switch), denser geometry for app UI:
 * - Track outlined when off, filled with color.main when on
 * - Thumb grows when selected; color = outline (off) / on<Color> (on)
 * - Disabled: track opacity 0.12, thumb opacity 0.38
 */
export const getMuiSwitch = (): Components<Omit<Theme, "components">>["MuiSwitch"] => ({
  defaultProps: {
    disableRipple: true,
  },
  styleOverrides: {
    // Color/state rules live on `root` so nested selectors beat MUI's
    // per-color SwitchBase variants (which still paint MD2 `*.main` thumbs).
    root: ({ theme, ownerState }) => {
      const geo = ownerState.size === "small" ? MD3_SWITCH.small : MD3_SWITCH;
      const main = getSwitchMainColor(theme, ownerState.color);
      const onColor = getSwitchOnColor(theme, ownerState.color);

      return {
        width: geo.trackWidth,
        height: geo.trackHeight,
        padding: 0,
        overflow: "hidden",
        "& .MuiSwitch-switchBase": getSwitchBaseStyles(theme, geo, main, onColor),
        "& .MuiSwitch-thumb": getSwitchThumbStyles(geo),
        "& .MuiSwitch-track": getSwitchTrackStyles(theme, geo),
      };
    },
  },
});
