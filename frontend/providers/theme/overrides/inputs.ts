import type { Theme } from "@mui/material/styles";
import { AUTOFILL_BACKGROUND_VAR, AUTOFILL_TEXT_VAR } from "@/frontend/providers/theme/overrides/autofill";

export const getMuiInputOverrides = () => ({
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ theme }: { theme: Theme }) => ({
        // WCAG 1.4.11 non-text contrast: MUI's resting notched outline rides
        // a 23%-alpha hairline (~1.9:1 on both canvases), below the 3:1 a
        // form field's boundary must hold. The resting border resolves
        // through `text.disabled` (the palette's solid legible-grey lane —
        // ≥4.5:1 on the light canvas and ~5.9:1 on the dark canvas) and the
        // hover state steps one lane up to `text.secondary`; the focus
        // state keeps MUI's primary ring.
        "& .MuiOutlinedInput-notchedOutline": {
          borderColor: theme.palette.text.disabled,
        },
        "&:hover:not(.Mui-focused):not(.Mui-error):not(.Mui-disabled) .MuiOutlinedInput-notchedOutline": {
          borderColor: theme.palette.text.secondary,
        },
        // Disabled affordance: make the whole field chrome read as inert
        // (the browser never applies an inert cursor to MUI's greyed
        // disabled fields on its own).
        "&.Mui-disabled": {
          cursor: "not-allowed",
        },
        "& input:-webkit-autofill": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
          WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
          caretColor: `${AUTOFILL_TEXT_VAR} !important`,
          borderRadius: "inherit",
          transition: "background-color 5000s ease-in-out 0s",
        },
        "& input:-webkit-autofill:hover": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
          WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
        },
        "& input:-webkit-autofill:focus": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
          WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
        },
        "& input:-webkit-autofill:active": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
          WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
        },
      }),
      input: {
        "&:-webkit-autofill": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
          WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
          caretColor: `${AUTOFILL_TEXT_VAR} !important`,
          borderRadius: "inherit",
        },
        "&:-webkit-autofill:hover": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
        },
        "&:-webkit-autofill:focus": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
        },
        "&:-webkit-autofill:active": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
        },
      },
    },
  },
  MuiInputBase: {
    styleOverrides: {
      input: {
        // Disabled affordance: replace the UA text cursor on disabled
        // inputs with the inert not-allowed cursor.
        "&.Mui-disabled": {
          cursor: "not-allowed",
        },
        "&:-webkit-autofill": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
          WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
          caretColor: `${AUTOFILL_TEXT_VAR} !important`,
        },
        "&:-webkit-autofill:hover, &:-webkit-autofill:focus, &:-webkit-autofill:active": {
          WebkitBoxShadow: `0 0 0 100px ${AUTOFILL_BACKGROUND_VAR} inset !important`,
          WebkitTextFillColor: `${AUTOFILL_TEXT_VAR} !important`,
        },
      },
    },
  },
});
