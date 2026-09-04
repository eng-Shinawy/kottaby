"use client";

import { Box, CircularProgress, Divider } from "@mui/material";
import type { ReactNode } from "react";
import { useAuth } from "@/frontend/hooks/auth";
import { getRecitationDescription, getRecitationLabel } from "@/frontend/lib/recitation-labels";
import {
  AccountInfoCard,
  AccountStatusCard,
  ChangePasswordCard,
  LanguagePreferenceCard,
  RecitationCard,
  SignInPromptCard,
} from "@/frontend/views/dashboard/profile/cards";
import { ProfileActions, ProfileHeader } from "@/frontend/views/dashboard/profile/ui";
import { getGenderLabel, getRoleLabel, useMounted } from "@/frontend/views/dashboard/profile/utils";
import { Auth, Dashboard, Recitation, useAppTranslation } from "@/shared/locale";

/**
 * ProfileView — user profile page.
 *
 * Shows the authenticated user's information in a card-based layout:
 *  - Header card: avatar + full name + email + role chip + edit-profile
 *    button (placeholder — editing is a future ticket).
 *  - Account Information card: full name, email, phone, role, country,
 *    gender (read from `useAuth().user`).
 *  - Account Status card: isDeleted / suspended / isBlocked status badges.
 *  - Preferences card: language preference toggle — persists the per-user
 *    locale to the account (`updateMyLocale`) and flips the app-wide locale
 *    (R2-users-locale-b).
 *  - Recitation Reading card: current preferred recitation with description.
 *  - Change Password form: current + new + confirm password fields
 *    (placeholder — wired to a "coming soon" notice since the
 *    `changePassword` mutation doesn't exist yet).
 *
 * If the user is not authenticated, shows a sign-in prompt.
 *
 * Hydration safety: a `mounted` guard prevents SSR/CSR mismatch on the
 * `useAuth()` result (the `me` query resolves client-side; the server render
 * sees `isLoading: true`, the client sees the resolved state).
 *
 * MUI v9 patterns: `sx` callback only (no string-based color props),
 * `*Outlined` icons, theme palette colors. All user-facing strings via
 * `useAppTranslation` (Dashboard + Auth + Recitation namespaces).
 */
export function ProfileView(): ReactNode {
  const t = useAppTranslation(Dashboard);
  const tAuth = useAppTranslation(Auth);
  const tRecitation = useAppTranslation(Recitation);
  const { user, isAuthenticated, isLoading } = useAuth();

  // Hydration guard — `useAuth()` resolves client-side; the server render
  // sees `isLoading: true`, the client resolves to the authenticated state.
  // Rendering nothing until mounted avoids the SSR/CSR mismatch warning.
  // Uses `useSyncExternalStore` (no `setState`-in-effect).
  const mounted = useMounted();

  if (!mounted || isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated || !user) {
    return <SignInPromptCard t={t} loginLabel={tAuth.loginSubmit} />;
  }

  const recitationLabel = user.preferredRecitation ? getRecitationLabel(user.preferredRecitation, tRecitation) : null;
  const recitationDesc = user.preferredRecitation
    ? getRecitationDescription(user.preferredRecitation, tRecitation)
    : null;
  const roleLabel = getRoleLabel(user.role, tAuth);
  const genderLabel = getGenderLabel(user.gender, tAuth);

  return (
    <Box sx={{ maxWidth: 960, mx: "auto" }}>
      {/* === Header === */}
      <ProfileHeader user={user} roleLabel={roleLabel} t={t} />

      {/* === Info grid: Account Info + Recitation === */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          alignItems: "start",
          gap: 2,
          mb: 2,
        }}
      >
        <AccountInfoCard user={user} roleLabel={roleLabel} genderLabel={genderLabel} t={t} />
        <RecitationCard
          recitationLabel={recitationLabel}
          recitationDescription={recitationDesc}
          t={t}
          tRecitation={tRecitation}
        />
      </Box>

      {/* === Account status card === */}
      <AccountStatusCard user={user} t={t} />

      {/* === Language preference card === */}
      <LanguagePreferenceCard t={t} />

      {/* === Change password card === */}
      <ChangePasswordCard t={t} showPasswordLabel={tAuth.showPassword} hidePasswordLabel={tAuth.hidePassword} />

      <Divider sx={{ my: 3 }} />

      {/* === Actions === */}
      <ProfileActions role={user.role} t={t} />
    </Box>
  );
}
