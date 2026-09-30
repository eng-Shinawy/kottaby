"use client";

import { ApolloClient, ApolloLink } from "@apollo/client";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { HttpLink } from "@apollo/client/link/http";
import { PersistedQueryLink } from "@apollo/client/link/persisted-queries";
import { ApolloProvider } from "@apollo/client/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NetworkConnectivityContext } from "@/frontend/context/NetworkConnectivityContext";
import { useApolloConnectivity } from "@/frontend/hooks/connectivity";
import { InitializingUI } from "@/frontend/providers/apollo/AppApolloProviderHelpers";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import { useAuthRecoveryRegistration } from "@/frontend/providers/apollo/useAuthRecoveryRegistration";
import {
  createAuthLink,
  createConnectivityLink,
  createErrorLinkHandler,
  createLocaleLink,
  sha256,
} from "@/frontend/providers/apollo/utils";
import { Common, useAppLocale, useAppTranslation } from "@/shared/locale";
import { defaultLocale, isAppLocale, LOCALE_COOKIE_NAME } from "@/shared/locale/AppLocale";

/**
 * Reads the locale the SSR shell rendered with, for the module-scope Apollo
 * link state initialization. Parses the SAME cookie the RSC boundary reads
 * (`NEXT_LOCALE` — see `shared/locale/server-cookies.ts`), validating it with
 * the same `isAppLocale` guard and falling back to the canonical
 * `defaultLocale` when absent — exactly mirroring `getLocaleFromCookie()` so
 * the very first client GraphQL requests (which can fire before the
 * provider's sync effect runs) already carry the shell's locale. Guarded for
 * SSR (client modules still evaluate during SSR, where `document` is
 * undefined → canonical default, same as the RSC fallback).
 */
function readInitialShellLocale(): string {
  if (typeof document === "undefined") return defaultLocale;
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=([a-z-]+)`).exec(document.cookie);
  const value = match?.[1];
  return value && isAppLocale(value) ? value : defaultLocale;
}

/**
 * Module-level mutable state object shared between the Apollo links and the
 * component. The links read from this object at call-time (during a request,
 * never during render), so we never access a React ref during render — we only
 * mutate this object in useEffect (after render). This satisfies the React
 * compiler's "no ref access during render" rule while still allowing synchronous
 * client creation at module scope.
 */
const apolloLinkState = {
  authToken: null as string | null,
  /**
   * The locale the SSR shell rendered with — stamped onto every outgoing
   * request as `x-app-locale` by `createLocaleLink` so the GraphQL boundary
   * resolves the SAME locale as the visible page (mixed-language drift fix).
   * Initialized from the cookie (RSC-aligned), then kept in sync with the
   * live `LocaleContext` by the provider effect below.
   */
  locale: readInitialShellLocale(),
  isConnected: false,
  checkConnectivity: (): Promise<boolean> => Promise.resolve(true),
  notifyIfDisconnected: (): void => undefined,
  setConnected: (_v: boolean): void => undefined,
  serverNotAvailableMessage: "Server not available",
};

/**
 * Apollo client is created once at module scope — available synchronously on
 * the very first render of any provider instance, with zero useEffect cycles.
 */
const apolloClient = new ApolloClient({
  link: ApolloLink.from([
    createErrorLinkHandler(
      () => apolloLinkState.isConnected,
      v => apolloLinkState.setConnected(v),
      () => apolloLinkState.notifyIfDisconnected()
    ),
    createConnectivityLink(
      () => apolloLinkState.isConnected,
      v => apolloLinkState.setConnected(v),
      () => apolloLinkState.checkConnectivity(),
      () => apolloLinkState.notifyIfDisconnected(),
      () => apolloLinkState.serverNotAvailableMessage
    ),
    createAuthLink(() => apolloLinkState.authToken),
    createLocaleLink(() => apolloLinkState.locale),
    new PersistedQueryLink({ sha256 }),
    // Use split to send mutations individually (non-batched) while batching
    // queries. Mutations must NOT be batched because:
    // 1. The login mutation sets the auth token — if batched with a `me`
    //    query, the `me` query runs before the token is available → UNAUTHORIZED.
    // 2. Batched mutations can have ordering issues on the server.
    // Queries are batched for performance (multiple concurrent reads in one POST).
    ApolloLink.split(
      operation =>
        operation.query.definitions.some(d => d.kind === "OperationDefinition" && d.operation === "mutation"),
      new HttpLink({ uri: "/api/graphql", credentials: "include" }),
      new BatchHttpLink({ uri: "/api/graphql", credentials: "include" })
    ),
  ]),
  cache: createApolloCache(),
  defaultOptions: {
    watchQuery: { errorPolicy: "none", notifyOnNetworkStatusChange: true },
    query: { errorPolicy: "none" },
    mutate: { errorPolicy: "none" },
  },
});

export function AppApolloProvider({ children }: { readonly children: React.ReactNode }) {
  const t = useAppTranslation(Common);
  const activeLocale = useAppLocale();
  const {
    isConnected,
    isChecking,
    lastChecked,
    initialCheckDone,
    checkConnectivity,
    setConnected,
    notifyIfDisconnected,
  } = useApolloConnectivity();

  const [authToken, setAuthToken] = useState<string | null>(null);

  // Keep the locale link's source of truth aligned with the live LocaleContext
  // (cookie-backed; updates on in-app locale switches). The link reads this at
  // request time, so every request carries the shell's rendered locale.
  useEffect(() => {
    apolloLinkState.locale = activeLocale;
  }, [activeLocale]);

  // Sync component state into the module-level link state (in effects, not during render)
  useEffect(() => {
    apolloLinkState.isConnected = isConnected;
  }, [isConnected]);

  useEffect(() => {
    apolloLinkState.checkConnectivity = checkConnectivity;
  }, [checkConnectivity]);

  useEffect(() => {
    apolloLinkState.notifyIfDisconnected = notifyIfDisconnected;
  }, [notifyIfDisconnected]);

  useEffect(() => {
    apolloLinkState.setConnected = setConnected;
  }, [setConnected]);

  useEffect(() => {
    apolloLinkState.serverNotAvailableMessage = t.serverNotAvailable;
  }, [t.serverNotAvailable]);

  const updateAuthToken = useCallback((token: string) => {
    setAuthToken(token);
    apolloLinkState.authToken = token;
  }, []);

  const clearAuthData = useCallback(() => {
    setAuthToken(null);
    apolloLinkState.authToken = null;
  }, []);

  useAuthRecoveryRegistration(apolloClient, updateAuthToken);

  const contextValue = useMemo(
    () => ({
      isConnected,
      isChecking,
      lastChecked,
      checkConnectivity,
      setConnected,
      notifyIfDisconnected,
      authToken,
      updateAuthToken,
      clearAuthData,
    }),
    [
      isConnected,
      isChecking,
      lastChecked,
      checkConnectivity,
      setConnected,
      notifyIfDisconnected,
      authToken,
      updateAuthToken,
      clearAuthData,
    ]
  );

  /**
   * Only block rendering when a disconnection is actually confirmed.
   * `initialCheckDone` starts as `false` and flips to `true` after the first
   * HEAD check (which runs in a background useEffect). By gating on
   * `initialCheckDone && !isConnected` the app renders immediately on startup —
   * the offline UI appears only when a real disconnection is detected.
   */
  if (initialCheckDone && !isConnected) {
    return <InitializingUI error={true} onRetry={() => checkConnectivity()} t={t} />;
  }

  return (
    <NetworkConnectivityContext.Provider value={contextValue}>
      <ApolloProvider client={apolloClient}>{children}</ApolloProvider>
    </NetworkConnectivityContext.Provider>
  );
}
