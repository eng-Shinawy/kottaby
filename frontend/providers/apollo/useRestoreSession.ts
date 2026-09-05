"use client";

import type { ApolloClient } from "@apollo/client";
import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { AuthContextType } from "@/frontend/context/AuthContext";
import { meQueryDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { getRefreshMemoryToken } from "@/frontend/lib/auth/refreshMemoryToken";
import { logger } from "@/frontend/lib/logger";

/**
 * `useRestoreSession` — session-restore effect.
 *
 * On mount: tries `me` → falls back to `refreshToken` (via the passed-in
 * `refreshSession`) → retries `me`. Settles as anonymous if both fail.
 *
 * `me` carries `authScopes: { authenticated: true }` — anonymous callers
 * receive a GraphQL UNAUTHORIZED error. The first `me` call may throw;
 * we catch it and fall through to the refresh path. The recovery link
 * (registered via `useAuthRecoveryRegistration`) ALSO intercepts the
 * UNAUTHENTICATED error and calls refresh — `dedupedRefreshToken`
 * ensures both paths share a single refresh mutation.
 */
export function useRestoreSession(
  apolloClient: ApolloClient,
  refreshSession: () => Promise<string | null>,
  setUser: Dispatch<SetStateAction<AuthContextType["user"]>>,
  setIsLoading: Dispatch<SetStateAction<boolean>>
): void {
  useEffect(() => {
    let cancelled = false;

    async function restoreSession(): Promise<void> {
      // Step 1: try `me`. If it succeeds with a user, we're done. If it
      // throws (UNAUTHORIZED — no/expired token), fall through to refresh.
      try {
        const meResult = await apolloClient.query({
          query: meQueryDocument,
          fetchPolicy: "network-only",
        });
        if (cancelled) {
          return;
        }
        const meData = meResult.data?.me ?? null;
        if (meData) {
          setUser(meData);
          return;
        }
      } catch (err) {
        // `me` threw — likely UNAUTHORIZED (no/expired token). Fall
        // through to the refresh path. The recovery link may already
        // be running a refresh in the background; `dedupedRefreshToken`
        // ensures we share its promise.
        if (!cancelled) {
          logger.warn({ caller: "AuthProvider.restoreSession" }, "[Auth] me query failed", err);
        }
      }

      // Step 2: try a manual refresh if we have a refresh token in React
      // memory (e.g. navigating between routes within a tab session — the
      // access token may have expired but the refresh token is still valid).
      if (!getRefreshMemoryToken()) {
        return;
      }
      const newAccessToken = await refreshSession();
      if (cancelled || !newAccessToken) {
        return;
      }

      // Step 3: retry `me` with the fresh access token.
      try {
        const meRetry = await apolloClient.query({
          query: meQueryDocument,
          fetchPolicy: "network-only",
        });
        if (cancelled) {
          return;
        }
        const meRetryData = meRetry.data?.me ?? null;
        if (meRetryData) {
          setUser(meRetryData);
        }
      } catch (err) {
        if (!cancelled) {
          logger.warn({ caller: "AuthProvider.restoreSession" }, "[Auth] me retry failed", err);
        }
      }
    }

    void restoreSession().finally(() => {
      if (!cancelled) {
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apolloClient, refreshSession, setUser, setIsLoading]);
}
