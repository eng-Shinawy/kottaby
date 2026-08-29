"use client";

import { ApolloClient, ApolloLink } from "@apollo/client";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { HttpLink } from "@apollo/client/link/http";
import { PersistedQueryLink } from "@apollo/client/link/persisted-queries";
import { ApolloProvider } from "@apollo/client/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NetworkConnectivityContext } from "@/frontend/context/NetworkConnectivityContext";
import { useApolloConnectivity } from "@/frontend/hooks/useApolloConnectivity";
import { InitializingUI } from "@/frontend/providers/apollo/AppApolloProviderHelpers";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import { useAuthRecoveryRegistration } from "@/frontend/providers/apollo/useAuthRecoveryRegistration";
import {
  createAuthLink,
  createConnectivityLink,
  createErrorLinkHandler,
  sha256,
} from "@/frontend/providers/apollo/utils";
import { useAppLocale } from "@/frontend/providers/localeContext";
import { Common, useAppTranslation } from "@/shared/locale";

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
  isConnected: false,
  /** Active UI locale — propagated as `Accept-Language` so the GraphQL
   *  context localizes server-side messages (e.g. `fields[].message`) to the
   *  SAME locale the UI renders (server default is `en`; the UI default is
   *  `ar` — without this header the two disagree until the user explicitly
   *  switches locale). Synced from LocaleContext in an effect. */
  locale: "ar" as string,
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
    // Locale propagation: every request carries the active UI locale so the
    // server's `extractLocale` (cookie → Accept-Language → default) resolves
    // the SAME locale the UI renders — server-localized error copy
    // (`fields[].message`, transport-tier preflight text) matches the UI.
    new ApolloLink((operation, forward) => {
      operation.setContext(({ headers }: { headers?: Record<string, string> }) => ({
        headers: { ...headers, "Accept-Language": apolloLinkState.locale },
      }));
      return forward(operation);
    }),
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
  // Active UI locale — synced into the module-level link state (effect below,
  // never during render) so the locale-propagation link sends the CURRENT
  // locale with every request.
  const locale = useAppLocale();
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

  // Sync component state into the module-level link state (in effects, not during render)
  useEffect(() => {
    apolloLinkState.locale = locale;
  }, [locale]);

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
