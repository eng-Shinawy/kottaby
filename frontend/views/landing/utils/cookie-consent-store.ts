"use client";

import { useSyncExternalStore } from "react";

// ─── Cookie consent (localStorage-backed external store) ────────────

export const COOKIE_CONSENT_KEY = "kottaby-cookie-consent";
export const COOKIE_ANALYTICS_KEY = "kottaby-cookie-analytics";
export const COOKIE_MARKETING_KEY = "kottaby-cookie-marketing";

/**
 * Consent preferences live in localStorage, but React state must be
 * derived through `useSyncExternalStore` — never via synchronous
 * `setState` calls inside an effect. This module-scope subscriber is a
 * stable identity across renders; it listens both to our in-tab notify
 * channel and to cross-tab `storage` events.
 */
const consentListeners = new Set<() => void>();

function subscribeCookieConsent(listener: () => void): () => void {
  consentListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    consentListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function notifyConsentChanged(): void {
  for (const listener of consentListeners) listener();
}

/** True when no consent decision has been recorded yet. Server snapshot:
 * false so the banner stays hidden during SSR/hydration (no flash). */
export function useNeedsConsentBanner(): boolean {
  return useSyncExternalStore(
    subscribeCookieConsent,
    () => localStorage.getItem(COOKIE_CONSENT_KEY) === null,
    () => false
  );
}

/** Stored boolean preference (`"false"` only disables); defaults to true.
 * Server snapshot matches the pre-hydration default to avoid drift. */
export function useCookiePreference(key: string): boolean {
  return useSyncExternalStore(
    subscribeCookieConsent,
    () => localStorage.getItem(key) !== "false",
    () => true
  );
}
