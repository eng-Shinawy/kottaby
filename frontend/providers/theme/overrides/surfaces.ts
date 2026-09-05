import type { Components, Theme } from "@mui/material/styles";

export const getMuiButton = (): Components<Omit<Theme, "components">>["MuiButton"] => ({
  styleOverrides: {
    root: ({ ownerState, theme }) => ({
      borderRadius: 8, // Rounded buttons
      boxShadow: "none",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      "&:hover": {
        boxShadow: "none",
      },
      ...(ownerState.variant === "contained" &&
        ownerState.color === "primary" && {
          backgroundColor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          "&:hover": {
            backgroundColor: theme.palette.primary.dark,
            boxShadow: "none",
          },
          // Disabled contained buttons: solid muted surface + legible grey
          // label. MUI's default 38%-alpha wash read as a "very low contrast
          // gray bar" in visual QA (profile save-password button). The doubled
          // class out-specifies MUI's own `.Mui-disabled` variant styles.
          "&&.Mui-disabled": {
            backgroundColor: theme.palette.surfaceContainerHighest,
            color: theme.palette.text.disabled,
            boxShadow: "none",
          },
        }),
    }),
  },
});

export const getMuiPaper = (): Components<Omit<Theme, "components">>["MuiPaper"] => ({
  styleOverrides: {
    root: {
      backgroundImage: "none",
    },
  },
});

export const getMuiCard = (): Components<Omit<Theme, "components">>["MuiCard"] => ({
  styleOverrides: {
    root: ({ theme }) => ({
      borderRadius: 8, // Data containers use modern rounded-xl (1rem/16px) standard
      boxShadow: theme.palette.shadow.card,
      border: `1px solid ${theme.palette.border.light}`,
      backgroundColor: theme.palette.background.paper,
    }),
  },
});
