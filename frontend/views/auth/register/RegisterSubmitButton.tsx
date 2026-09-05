"use client";

import { Button, CircularProgress } from "@mui/material";
import { reducedMotionSx } from "@/frontend/views/auth/register";

interface RegisterSubmitButtonProps {
  readonly busy: boolean;
  readonly succeeded: boolean;
  readonly label: string;
}

/**
 * RegisterForm's submit CTA: full-width contained button with a spinner while
 * busy, explicit focus-visible ring (v9 ButtonBase ships none), and
 * reduced-motion-safe hover/transitions.
 */
export function RegisterSubmitButton({ busy, succeeded, label }: RegisterSubmitButtonProps) {
  return (
    <Button
      type="submit"
      variant="contained"
      fullWidth
      size="large"
      disabled={busy || succeeded}
      startIcon={busy ? <CircularProgress size={20} sx={{ color: "inherit" }} /> : null}
      sx={{
        py: 1.5,
        fontSize: 16,
        fontWeight: 700,
        borderRadius: 2,
        textTransform: "none",
        bgcolor: "var(--mui-palette-secondary-main)",
        color: "var(--mui-palette-onSecondary)",
        boxShadow: theme => `0 6px 16px ${theme.palette.secondary.main}33`,
        // v9 ButtonBase ships no keyboard-focus style; the
        // primary submit was invisible when tabbed to.
        "&.Mui-focusVisible": {
          outline: "2px solid",
          outlineColor: "var(--mui-palette-secondary-main)",
          outlineOffset: 2,
        },
        "&:hover": {
          bgcolor: "var(--mui-palette-secondary-dark)",
          boxShadow: theme => `0 8px 20px ${theme.palette.secondary.main}44`,
          transform: "translateY(-1px)",
        },
        transition: "box-shadow 0.15s ease, transform 0.15s ease, background-color 0.15s ease",
        ...reducedMotionSx,
      }}
    >
      {label}
    </Button>
  );
}
