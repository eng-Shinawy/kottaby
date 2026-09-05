"use client";

import { type ReactNode, useCallback, useState } from "react";
import { CookieConsentBanner } from "@/frontend/views/landing/sections/floating/CookieConsentBanner";
import { CookieSettingsDialog } from "@/frontend/views/landing/sections/floating/CookieSettingsDialog";
import {
  COOKIE_ANALYTICS_KEY,
  COOKIE_CONSENT_KEY,
  COOKIE_MARKETING_KEY,
  notifyConsentChanged,
  useCookiePreference,
  useNeedsConsentBanner,
} from "@/frontend/views/landing/utils";

export function CookieConsent(): ReactNode {
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false);

  const needsConsent = useNeedsConsentBanner();
  const analyticsPref = useCookiePreference(COOKIE_ANALYTICS_KEY);
  const marketingPref = useCookiePreference(COOKIE_MARKETING_KEY);

  // Dialog-local drafts: edits stay transient until the visitor saves.
  const [draftAnalytics, setDraftAnalytics] = useState(true);
  const [draftMarketing, setDraftMarketing] = useState(true);

  const openSettings = useCallback(() => {
    setDraftAnalytics(analyticsPref);
    setDraftMarketing(marketingPref);
    setCookieDialogOpen(true);
  }, [analyticsPref, marketingPref]);

  const handleAccept = useCallback(() => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    localStorage.setItem(COOKIE_ANALYTICS_KEY, "true");
    localStorage.setItem(COOKIE_MARKETING_KEY, "true");
    notifyConsentChanged();
  }, []);

  const handleDecline = useCallback(() => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
    localStorage.setItem(COOKIE_ANALYTICS_KEY, "false");
    localStorage.setItem(COOKIE_MARKETING_KEY, "false");
    notifyConsentChanged();
  }, []);

  const handleSaveCookieSettings = useCallback(() => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "custom");
    localStorage.setItem(COOKIE_ANALYTICS_KEY, String(draftAnalytics));
    localStorage.setItem(COOKIE_MARKETING_KEY, String(draftMarketing));
    notifyConsentChanged();
    setCookieDialogOpen(false);
  }, [draftAnalytics, draftMarketing]);

  const closeDialog = useCallback(() => setCookieDialogOpen(false), []);

  if (!needsConsent) return null;

  return (
    <>
      <CookieConsentBanner onDecline={handleDecline} onOpenSettings={openSettings} onAccept={handleAccept} />
      <CookieSettingsDialog
        open={cookieDialogOpen}
        draftAnalytics={draftAnalytics}
        draftMarketing={draftMarketing}
        onClose={closeDialog}
        onDraftAnalyticsChange={setDraftAnalytics}
        onDraftMarketingChange={setDraftMarketing}
        onSave={handleSaveCookieSettings}
      />
    </>
  );
}
