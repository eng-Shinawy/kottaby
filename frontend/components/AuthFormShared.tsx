"use client";

import { LockOutlined, VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import {
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { Auth, useAppTranslation } from "@/shared/locale";

/** audit-R7/P1: honor prefers-reduced-motion for button lift/glow motion.
 * Embedded media query keeps the guard active pre-hydration (same contract as
 * the useMediaQuery({ noSsr:true }) convention without its hydration flash). */
const reducedMotionSx = {
  "@media (prefers-reduced-motion: reduce)": {
    transition: "none",
    "&:hover": {
      transform: "none",
    },
  },
};

/**
 * Shared form components for auth pages (login + register).
 *
 * Extracted to eliminate jscpd duplicate clones between LoginForm.tsx and
 * RegisterForm.tsx. These are the header, password field, and submit button
 * that were duplicated across both forms.
 */

/** Shared header block: icon badge + title + subtitle. */
export function AuthFormHeader({
  icon,
  title,
  subtitle,
}: Readonly<{ icon: ReactNode; title: string; subtitle: string }>): ReactNode {
  return (
    <Stack spacing={1} sx={{ mb: 4 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            bgcolor: "var(--mui-palette-secondary-main)",
            color: "var(--mui-palette-onSecondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: theme => `0 6px 16px ${theme.palette.secondary.main}33`,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Stack spacing={0.25}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)" }}>
            {subtitle}
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}

/** Shared password field with show/hide toggle. */
export function PasswordField({
  label,
  value,
  onChange,
  showPassword,
  onToggleShow,
  autoComplete,
  helperText,
  error,
  inputRef,
  name,
  onBlur,
  "aria-invalid": ariaInvalid,
}: Readonly<{
  label: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  showPassword: boolean;
  onToggleShow: () => void;
  autoComplete: string;
  helperText?: string;
  error?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  name?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
}>): ReactNode {
  // audit-R4: the toggle's accessible name MUST localize (it was hardcoded
  // English "Show password"/"Hide password", leaking EN copy onto ar pages).
  const t = useAppTranslation(Auth);

  return (
    <TextField
      label={label}
      type={showPassword ? "text" : "password"}
      value={value}
      onChange={onChange}
      name={name}
      inputRef={inputRef}
      onBlur={onBlur}
      required
      fullWidth
      autoComplete={autoComplete}
      helperText={helperText ?? " "}
      error={error}
      aria-invalid={ariaInvalid}
      // audit-R7/P2: roomier line boxes for multi-line Arabic helper copy.
      slotProps={{
        formHelperText: { sx: { lineHeight: 1.6 }, "aria-live": "polite" },
        input: {
          startAdornment: <LockOutlined fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />,
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={showPassword ? t.hidePassword : t.showPassword}>
                <IconButton
                  aria-label={showPassword ? t.hidePassword : t.showPassword}
                  onClick={onToggleShow}
                  size="small"
                  sx={{
                    ...focusVisibleRingSx,
                    // 44px touch target: 12px padding around the 20px glyph,
                    // pulled back with matching negative margins so the input
                    // row keeps its natural height (invisible-padding trick).
                    p: 1.5,
                    m: -1.5,
                  }}
                >
                  {showPassword ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** Shared submit button with loading spinner. */
export function AuthSubmitButton({
  label,
  loading,
  disabled,
}: Readonly<{ label: string; loading: boolean; disabled?: boolean }>): ReactNode {
  return (
    <Box
      component="button"
      type="submit"
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      sx={{
        width: "100%",
        py: 1.5,
        position: "relative",
        ...focusVisibleRingSx,
        // Raw <button> elements fall back to the UA font (Arial here) — MUI
        // ButtonBase no longer sets a family in v9. Inherit the body chain
        // (Inter/Cairo) so the label matches every other surface incl. RTL.
        fontFamily: "inherit",
        fontSize: 16,
        fontWeight: 700,
        borderRadius: 2,
        textTransform: "none",
        border: "none",
        cursor: loading || disabled ? "not-allowed" : "pointer",
        opacity: loading || disabled ? 0.6 : 1,
        background: "var(--mui-palette-secondary-main)",
        color: "var(--mui-palette-onSecondary)",
        // Theme-aware alpha suffix keeps the glow translucent — a solid var()
        // would resolve to the full-opacity accent and read as a heavy halo.
        boxShadow: theme => `0 4px 12px ${theme.palette.secondary.main}2e`,
        transition: "box-shadow 0.15s ease, transform 0.15s ease",
        "&:hover": {
          boxShadow: theme => `0 6px 16px ${theme.palette.secondary.main}44`,
          transform: "translateY(-1px)",
        },
        ...reducedMotionSx,
      }}
    >
      {/* audit-R4: keep the accessible NAME while pending — swapping the label
          for a bare spinner left screen readers with an unnamed button mid-flow. */}
      {loading ? (
        <>
          <CircularProgress size={20} sx={{ color: "inherit" }} />
          <Box
            component="span"
            sx={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clipPath: "inset(50%)",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Box>
        </>
      ) : (
        label
      )}
    </Box>
  );
}
