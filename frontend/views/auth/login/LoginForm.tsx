"use client";

import { EmailOutlined as EmailIcon, LoginOutlined as LoginIcon } from "@mui/icons-material";
import { Alert, Box, Checkbox, FormControlLabel, Link as MuiLink, Stack, TextField } from "@mui/material";
import Link from "next/link";
import { AuthFormHeader, AuthSubmitButton, PasswordField } from "@/frontend/components/AuthFormShared";
import { useLoginForm } from "@/frontend/views/auth/login";

type LoginOptionsRowProps = {
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
  rememberMeLabel: string;
  forgotPasswordLabel: string;
};

function LoginOptionsRow({
  remember,
  onRememberChange,
  rememberMeLabel,
  forgotPasswordLabel,
}: Readonly<LoginOptionsRowProps>) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
      <FormControlLabel
        control={
          <Checkbox
            checked={remember}
            onChange={e => onRememberChange(e.target.checked)}
            size="medium"
            color="secondary"
            sx={{ padding: 0.5 }}
          />
        }
        label={rememberMeLabel}
        labelPlacement="end"
        sx={{
          minHeight: 44,
          "& .MuiCheckbox-root": { padding: 0.5 },
          "& .MuiFormControlLabel-label": {
            fontSize: 14,
            fontWeight: 500,
            color: "var(--mui-palette-text-secondary)",
            lineHeight: 1.4,
          },
        }}
      />
      <MuiLink
        component={Link}
        href="#"
        sx={{
          fontSize: 13,
          fontWeight: 600,
          minHeight: 44,
          display: "inline-flex",
          alignItems: "center",
          color: "var(--mui-palette-secondary-main)",
          textDecoration: "none",
          "&:hover": { textDecoration: "underline" },
          "&:focus-visible": {
            outline: "2px solid var(--mui-palette-secondary-main)",
            outlineOffset: 2,
            borderRadius: 1,
          },
        }}
      >
        {forgotPasswordLabel}
      </MuiLink>
    </Stack>
  );
}

export function LoginForm() {
  const {
    t,
    email,
    setEmail,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    remember,
    setRemember,
    errorMessage,
    loading,
    emailInputRef,
    handleSubmit,
  } = useLoginForm();

  return (
    <Box sx={{ width: "100%", maxWidth: { xs: 420, sm: 460 } }}>
      <AuthFormHeader icon={<LoginIcon sx={{ fontSize: 22 }} />} title={t.loginTitle} subtitle={t.loginSubtitle} />

      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={2}>
          <TextField
            label={t.loginEmail}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            fullWidth
            autoComplete="email"
            autoFocus
            inputRef={emailInputRef}
            slotProps={{
              input: {
                startAdornment: (
                  <EmailIcon fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />
                ),
              },
            }}
          />
          <PasswordField
            label={t.loginPassword}
            value={password}
            onChange={setPassword}
            showPassword={showPassword}
            onToggleShow={() => setShowPassword(!showPassword)}
            autoComplete="current-password"
          />

          <LoginOptionsRow
            remember={remember}
            onRememberChange={setRemember}
            rememberMeLabel={t.rememberMe}
            forgotPasswordLabel={t.forgotPassword}
          />

          {errorMessage ? (
            // Same radius token as the floating host toast that
            // can accompany this surface on masked failures.
            <Alert severity="error" variant="filled" sx={{ borderRadius: 2 }}>
              {errorMessage}
            </Alert>
          ) : null}

          <AuthSubmitButton label={t.loginSubmit} loading={loading} />
        </Stack>
      </Box>

      <Stack direction="row" spacing={1} sx={{ justifyContent: "center", mt: 3 }}>
        {/* 44px tap target via transparent padding — visible text size unchanged. */}
        <MuiLink
          component={Link}
          href="/register"
          underline="hover"
          sx={{ fontWeight: 600, display: "inline-flex", alignItems: "center", minHeight: 44, px: 1 }}
        >
          {t.registerLink}
        </MuiLink>
      </Stack>
    </Box>
  );
}
