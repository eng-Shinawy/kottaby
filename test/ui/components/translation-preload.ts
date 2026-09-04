/**
 * i18n + active-locale wiring — THIRD preload of `test:ui:components`.
 *
 * DIVERGENCE NOTE vs adopted `test/ui/AGENTS.md` (upstream target state):
 * AGENTS.md describes a `readTranslation(handle, locale)` Suspense cache from
 * `@/shared/locale/client/translation-cache-store`. That module does not exist
 * on this branch yet. Here the compile-time translation system loads EVERY
 * namespace SYNCHRONOUSLY via static imports — `getTranslations(locale)` in
 * `@/shared/locale/server.ts` is pure, in-memory and never suspends. So there
 * is nothing to async-preload; this file instead:
 *
 * 1. Warms ONLY the namespaces exercised by current component suites (landing
 *    + auth) for BOTH locales. Touching every label eagerly surfaces missing-
 *    key drift at PRELOAD time instead of deep inside a test assertion.
 * 2. Wires the ACTIVE-LOCALE source of truth used by client components that do
 *    NOT read `LocaleContext`: `frontend/hooks/useAppLocale` resolves the
 *    locale from Next.js route params (`useParams()`), and `LocaleSwitcher`
 *    drives switches through `useRouter().refresh()`. A `next/navigation`
 *    mock module is registered ONCE here with an in-memory state object that
 *    tests can point at `"ar"` or `"en"` before rendering — serverless, zero
 *    ports, zero network.
 */

import { mock } from "bun:test";

import type { AppLocale } from "@/shared/locale/AppLocale";
import { arMessages } from "@/shared/locale/ar/messages";
import { enMessages } from "@/shared/locale/en/messages";
import { Applicant } from "@/shared/locale/namespaces/applicant";
import { Auth } from "@/shared/locale/namespaces/auth";
import { Common } from "@/shared/locale/namespaces/common";
import { Dashboard } from "@/shared/locale/namespaces/dashboard";
import { Errors } from "@/shared/locale/namespaces/errors";
import { HandshakeCode } from "@/shared/locale/namespaces/handshakeCode";
import { Landing } from "@/shared/locale/namespaces/landing";
import { Notifications } from "@/shared/locale/namespaces/notifications";
import { ParentLink } from "@/shared/locale/namespaces/parentLink";

/** Mutable navigation state consumed by the mocked `next/navigation` exports. */
export interface TestNavigationState {
  /** Active locale reported by `useParams()` → `frontend/hooks/useAppLocale`. */
  locale: AppLocale;
  /** Value returned by `usePathname()`. */
  pathname: string;
  /** Number of `router.refresh()` invocations (locale-switch side effect). */
  refreshCount: number;
}

export const testNavigationState: TestNavigationState = {
  locale: "ar",
  pathname: "/",
  refreshCount: 0,
};

void mock.module("next/navigation", () => ({
  useParams: () => ({ locale: testNavigationState.locale }),
  usePathname: () => testNavigationState.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    // LocaleSwitcher calls refresh() after POSTing /api/set-locale; tests read
    // refreshCount to prove the switch flow completed without a real router.
    refresh: () => {
      testNavigationState.refreshCount += 1;
    },
  }),
  redirect: () => undefined,
  notFound: () => undefined,
}));

// Warm exactly the namespaces current suites exercise, both locales, eagerly.
// (Full-bundle sync loads make these plain property reads; failing keys throw
// here, at the earliest possible moment.)
for (const translations of [arMessages, enMessages]) {
  Landing.getLabels(translations);
  Auth.getLabels(translations);
  // Warm the Applicant + Errors handles so the ApplicantStatusCard suites
  // surface missing-key drift at preload time.
  Applicant.getLabels(translations);
  Errors.getLabels(translations);
  // Warm the Notifications + Common handles so the realtime-toast suite
  // surfaces missing-key drift at preload time.
  Notifications.getLabels(translations);
  Common.getLabels(translations);
  // Warm the Dashboard handle so the app-bar/sidebar badge suites surface
  // missing-key drift at preload time (nav labels + app-bar strings).
  Dashboard.getLabels(translations);
  // Warm the HandshakeCode handle so the student handshake-code card suite
  // surfaces missing-key drift at preload time.
  HandshakeCode.getLabels(translations);
  // Warm the ParentLink handle so the DEV1-014 link-requests suites (student
  // incoming queue + parent outgoing section) surface missing-key drift at
  // preload time.
  ParentLink.getLabels(translations);
}
