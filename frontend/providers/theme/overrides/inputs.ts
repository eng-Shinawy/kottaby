import { AUTOFILL_BACKGROUND_VAR, AUTOFILL_TEXT_VAR } from "@/frontend/providers/theme/overrides/autofill";

export const getMuiInputOverrides = () => ({
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
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
      },
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
