"use client";

import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import { LanguageOutlined as LanguageIcon } from "@mui/icons-material";
import { Alert, CircularProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import { type MouseEvent, type ReactNode, useState } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { meQueryDocument, updateMyLocaleMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { logger } from "@/frontend/lib/logger";
import { ProfileCardSection } from "@/frontend/views/dashboard/profile/ui";
import { fromWireAppLocale, languageName, toWireAppLocale } from "@/frontend/views/dashboard/profile/utils";
import { type AppLocale, useAppLocale } from "@/shared/locale";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

interface LanguagePreferenceCardProps {
  readonly t: DashboardLabels;
}

/**
 * Renders the language preference card — an exclusive two-option toggle
 * ("English" / "العربية", each label written in its OWN language per the
 * language-picker convention — deliberately NOT translated).
 *
 * The selection tracks the EFFECTIVE app locale (`useAppLocale` ←
 * LocaleContext ← NEXT_LOCALE cookie). Selecting the other language:
 *  1. disables the group with a tiny inline spinner (optimistic pending
 *     feedback — the selection itself stays on the effective locale until
 *     the app flips),
 *  2. fires the `updateMyLocale` mutation with the WIRE enum value
 *     ("Ar"/"En" — mapped from the app locale "ar"/"en"),
 *  3. on success, writes the persisted locale back into the `me` query in
 *     the Apollo cache (the same normalized `User` entry both write paths —
 *     this card AND the app-bar LocaleSwitcher write-through — keep
 *     current), then
 *  4. applies the app-wide switch exactly like the app-bar LocaleSwitcher
 *     (POST /api/set-locale + router.refresh()) so the cookie, `<html dir>`
 *     and providers flip immediately.
 * On failure the inline Alert surfaces the localized error and the group
 * re-enables with the selection reverted to the (unchanged) effective
 * locale.
 *
 * The persisted account value is observed through the `me` query in the
 * cache — when it differs from the effective locale (e.g. the cookie was
 * switched out-of-band), the caption names the saved account preference
 * instead of the generic notice.
 */
export function LanguagePreferenceCard({ t }: Readonly<LanguagePreferenceCardProps>): ReactNode {
  const effectiveLocale = useAppLocale();
  const client = useApolloClient();
  const router = useRouter();

  // Task 2.5: read the persisted User.locale from the cache (via me query).
  // The me query is populated on session load (ProfileView renders only for
  // authenticated users), so this is a cache-only read.
  const { data: meData } = useQuery(meQueryDocument, {
    fetchPolicy: "cache-only",
  });
  const persistedLocale = fromWireAppLocale(meData?.me?.locale);

  const [updateLocale, { loading: isPending }] = useMutation(updateMyLocaleMutationDocument);
  const [hasFailed, setHasFailed] = useState(false);

  const savedDiffers = Boolean(persistedLocale && persistedLocale !== effectiveLocale);

  const handleLocaleChange = (_event: MouseEvent<HTMLElement>, nextLocale: string | null) => {
    // ToggleButtonGroup in exclusive mode fires null when clicking the
    // currently selected value — treat as a no-op.
    if (!nextLocale || nextLocale === effectiveLocale) {
      return;
    }
    const targetLocale: AppLocale = nextLocale === "ar" ? "ar" : "en";
    setHasFailed(false);

    void (async () => {
      try {
        // 1. Persist the per-user locale to the account.
        const wireValue = toWireAppLocale(targetLocale);
        const { data } = await updateLocale({
          variables: { locale: wireValue },
        });

        // 2. Direct cache write-through: update the User in the Apollo cache
        // so any other views observing `me` update synchronously.
        if (data?.updateMyLocale?.id) {
          client.cache.modify({
            id: client.cache.identify({ __typename: "User", id: data.updateMyLocale.id }),
            fields: {
              locale() {
                return wireValue;
              },
            },
          });
        }

        // 3. Switch the active app-wide locale (cookie + reload).
        const response = await fetch("/api/set-locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: targetLocale }),
        });
        if (!response.ok) {
          // 4xx/5xx must surface the failure state — refreshing anyway would
          // re-render with the OLD active locale and mask the rejection.
          throw new Error(`set-locale failed with status ${response.status}`);
        }
        router.refresh();
      } catch (error: unknown) {
        setHasFailed(true);
        logger.debug({ caller: "ProfileView.LanguagePreferenceCard" }, "[Profile] updateMyLocale rejected", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
    })();
  };

  return (
    <ProfileCardSection title={t.preferences} icon={LanguageIcon} mb={2}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <ToggleButtonGroup
          exclusive
          disabled={isPending}
          value={effectiveLocale}
          onChange={handleLocaleChange}
          aria-label={t.language}
        >
          <ToggleButton value="en" sx={{ ...focusVisibleRingSx, px: 3, minHeight: 44, fontWeight: 600 }}>
            English
          </ToggleButton>
          <ToggleButton value="ar" sx={{ ...focusVisibleRingSx, px: 3, minHeight: 44, fontWeight: 600 }}>
            العربية
          </ToggleButton>
        </ToggleButtonGroup>
        {isPending ? <CircularProgress size={18} /> : null}
      </Stack>
      {hasFailed ? (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
          {t.languageUpdateFailed}
        </Alert>
      ) : null}
      <Typography
        variant="caption"
        sx={theme => ({
          display: "block",
          mt: 1.5,
          color: theme.palette.text.secondary,
        })}
      >
        {savedDiffers && persistedLocale ? t.languageSaved(languageName(persistedLocale)) : t.languageNotice}
      </Typography>
    </ProfileCardSection>
  );
}
