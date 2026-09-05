import type { Components, Theme } from "@mui/material/styles";
import { AUTOFILL_BACKGROUND_VAR, AUTOFILL_TEXT_VAR } from "@/frontend/providers/theme/overrides/autofill";

export const getMuiCssBaseline = (): Components<Omit<Theme, "components">>["MuiCssBaseline"] => ({
  styleOverrides: {
    body: {
      backgroundColor: "var(--mui-palette-background-default)",
      color: "var(--mui-palette-onBackground)",
    },
    /**
     * Autofill rules use CSS variable references so the browser resolves the
     * correct colors at runtime for the active color scheme. Hardcoded literals
     * baked at theme creation time only matched the default scheme, causing
     * mismatched autofill styling when the user switched modes.
     */
    "input:-webkit-autofill": {
      WebkitBoxShadow: `0 0 0 1000px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
      WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
      caretColor: `${AUTOFILL_TEXT_VAR} !important`,
      borderRadius: "inherit",
      transition: "background-color 5000s ease-in-out 0s",
    },
    "input:-webkit-autofill:hover": {
      WebkitBoxShadow: `0 0 0 1000px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
      WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
    },
    "input:-webkit-autofill:focus": {
      WebkitBoxShadow: `0 0 0 1000px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
      WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
    },
    "input:-webkit-autofill:active": {
      WebkitBoxShadow: `0 0 0 1000px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
      WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
    },
    "textarea:-webkit-autofill, select:-webkit-autofill": {
      WebkitBoxShadow: `0 0 0 1000px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
      WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
      caretColor: `${AUTOFILL_TEXT_VAR} !important`,
      borderRadius: "inherit",
      transition: "background-color 5000s ease-in-out 0s",
    },
    "input:autofill, textarea:autofill, select:autofill": {
      boxShadow: `0 0 0 1000px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
      color: `${AUTOFILL_TEXT_VAR} !important`,
    },
    "input:-internal-autofill-selected": {
      backgroundColor: `${AUTOFILL_BACKGROUND_VAR} !important`,
      backgroundImage: "none !important",
      color: `${AUTOFILL_TEXT_VAR} !important`,
    },
    "input[data-com-onepassword-filled], textarea[data-com-onepassword-filled], input[data-com-onepassword-filled='dark'], textarea[data-com-onepassword-filled='dark']":
      {
        backgroundColor: `${AUTOFILL_BACKGROUND_VAR} !important`,
        WebkitBoxShadow: `0 0 0 1000px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
        WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
        color: `${AUTOFILL_TEXT_VAR} !important`,
        caretColor: `${AUTOFILL_TEXT_VAR} !important`,
      },
    "*::-webkit-scrollbar": {
      width: "6px",
      backgroundColor: "transparent",
    },
    "*::-webkit-scrollbar-track": {
      background: "color-mix(in srgb, var(--mui-palette-onBackground) 2%, transparent)",
      borderRadius: "6px",
      margin: "4px 0",
    },
    "*::-webkit-scrollbar-thumb": {
      background: "color-mix(in srgb, var(--mui-palette-onBackground) 15%, transparent)",
      borderRadius: "6px",
      border: "2px solid var(--mui-palette-background-default)",
    },
    "*::-webkit-scrollbar-thumb:hover": {
      background: "color-mix(in srgb, var(--mui-palette-onBackground) 25%, transparent)",
    },
    "*": {
      scrollbarWidth: "thin",
      scrollbarColor:
        "color-mix(in srgb, var(--mui-palette-onBackground) 15%, transparent) color-mix(in srgb, var(--mui-palette-onBackground) 2%, transparent)",
    },
  },
});
