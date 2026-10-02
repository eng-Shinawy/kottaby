"use client";

/**
 * ChangePasswordForm — the small centered credential form rendered by the
 * top-level `/change-password` page (the forced self-service password
 * change; also reachable voluntarily by an authenticated user).
 *
 * Composition reuses the shared auth form building blocks (the same
 * header / password field / submit button trio the login + register forms
 * render) inside a compact centered column. The forced-reset copy — the
 * header subtitle (`description`) AND the temporary-password info notice —
 * renders ONLY while the session user is flagged (`mustChangePassword`,
 * the same predicate the DashboardLayout mirror applies): the page is also
 * reachable voluntarily by an un-flagged authenticated user (direct URL —
 * it is not a nav item by design), for whom "you must set a new password
 * before you can continue" / "a temporary password was issued" copy would
 * be factually wrong, so both collapse for them (null/undefined session
 * user also reads as not flagged). The title stays visible
 * unconditionally.
 *
 * State, validation, the `changeMyPassword` mutation, error projection,
 * and the post-success dashboard hand-off live in `useChangePasswordForm`.
 */

import { LockResetOutlined } from "@mui/icons-material";
import { Alert, Box, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { AuthFormHeader, AuthSubmitButton, PasswordField } from "@/frontend/components/AuthFormShared";
import type { AuthUser } from "@/frontend/context/AuthContext";
import { useAuth } from "@/frontend/hooks/auth";
import { useChangePasswordForm } from "@/frontend/views/auth/change-password/useChangePasswordForm";

interface TemporaryPasswordNoticeProps {
  readonly user: AuthUser | null;
  readonly label: string;
}

/**
 * The temporary-password info notice — rendered ONLY while the session
 * user is flagged for a forced reset (`mustChangePassword === true`, the
 * same predicate the DashboardLayout mirror applies and the same gate the
 * header's `description` subtitle uses; a null/undefined session user
 * reads as not flagged). The page is also reachable voluntarily by an
 * un-flagged authenticated user (direct URL — it is not a nav item by
 * design), for whom the "a temporary password was issued" copy would be
 * factually wrong, so the notice collapses for them.
 */
function TemporaryPasswordNotice({ user, label }: Readonly<TemporaryPasswordNoticeProps>): ReactNode {
  if (user?.mustChangePassword !== true) return null;
  return (
    <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
      {label}
    </Alert>
  );
}

export function ChangePasswordForm(): ReactNode {
  const {
    t,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showCurrent,
    setShowCurrent,
    showNew,
    setShowNew,
    showConfirm,
    setShowConfirm,
    validationErrors,
    fieldErrors,
    formError,
    succeeded,
    loading,
    handleSubmit,
  } = useChangePasswordForm();
  const { user } = useAuth();

  const currentError = validationErrors.currentPassword ?? fieldErrors.currentPassword;
  const newError = validationErrors.newPassword ?? fieldErrors.newPassword;
  const confirmError = validationErrors.confirmPassword;
  // Forced-reset predicate — shared with the notice below and the
  // DashboardLayout mirror; un-flagged voluntary visitors get no
  // "you must …" description (the title stays unconditional).
  const isForcedReset = user?.mustChangePassword === true;

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        py: 6,
        backgroundColor: "var(--mui-palette-background-default)",
      }}
    >
      <Box sx={{ width: "100%", maxWidth: { xs: 420, sm: 460 } }}>
        <AuthFormHeader
          icon={<LockResetOutlined sx={{ fontSize: 22 }} />}
          title={t.changePassword.title}
          subtitle={isForcedReset ? t.changePassword.description : undefined}
        />

        <TemporaryPasswordNotice user={user} label={t.changePassword.temporaryPasswordNotice} />

        <Box component="form" onSubmit={handleSubmit} noValidate>
          <Stack spacing={2}>
            <PasswordField
              label={t.changePassword.currentPasswordLabel}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              showPassword={showCurrent}
              onToggleShow={() => setShowCurrent(!showCurrent)}
              autoComplete="current-password"
              error={Boolean(currentError)}
              helperText={currentError}
              aria-invalid={Boolean(currentError)}
            />
            <PasswordField
              label={t.changePassword.newPasswordLabel}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              showPassword={showNew}
              onToggleShow={() => setShowNew(!showNew)}
              autoComplete="new-password"
              error={Boolean(newError)}
              helperText={newError}
              aria-invalid={Boolean(newError)}
            />
            <PasswordField
              label={t.changePassword.confirmPasswordLabel}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              showPassword={showConfirm}
              onToggleShow={() => setShowConfirm(!showConfirm)}
              autoComplete="new-password"
              error={Boolean(confirmError)}
              helperText={confirmError}
              aria-invalid={Boolean(confirmError)}
            />

            {formError ? (
              <Alert severity="error" variant="filled" sx={{ borderRadius: 2 }}>
                {formError}
              </Alert>
            ) : null}

            {succeeded ? (
              <Alert severity="success" variant="filled" sx={{ borderRadius: 2 }}>
                {t.changePassword.success}
              </Alert>
            ) : null}

            <AuthSubmitButton label={t.changePassword.submit} loading={loading} disabled={succeeded} />
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
