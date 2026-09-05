"use client";

import type { ApolloClient } from "@apollo/client";
import { useRouter } from "next/navigation";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { AuthContextType } from "@/frontend/context/AuthContext";
import { logoutMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { setRefreshMemoryToken } from "@/frontend/lib/auth/refreshMemoryToken";
import { logger } from "@/frontend/lib/logger";

/**
 * `useAuthLogout` — logout hook.
 *
 * Returns the `logout` callback: calls the `logout` mutation (public —
 * clears the httpOnly cookies server-side via `clearAuthCookies`), then
 * clears the access + refresh tokens from React memory, resets the user
 * state, resets the Apollo cache, and navigates to `/login`. The mutation
 * call is fire-and-forget — even if the network is down, the client state
 * is reset (the httpOnly cookies will expire on their own TTL).
 */
export function useAuthLogout(
  apolloClient: ApolloClient,
  clearAuthData: () => void,
  setUser: Dispatch<SetStateAction<AuthContextType["user"]>>,
  setError: Dispatch<SetStateAction<string | null>>
): AuthContextType["logout"] {
  const router = useRouter();

  return useCallback<AuthContextType["logout"]>(() => {
    void apolloClient
      .mutate({ mutation: logoutMutationDocument })
      .catch(err => {
        logger.warn({ caller: "AuthProvider.logout" }, "[Auth] logout mutation failed", err);
      })
      .finally(() => {
        setUser(null);
        setError(null);
        setRefreshMemoryToken(null);
        clearAuthData();
        // Reset the Apollo cache so stale authenticated data doesn't leak
        // into the next session. `client.resetStore()` re-runs all active
        // queries (which will return `null` for `me` since we just cleared
        // the token).
        void apolloClient.resetStore().catch(err => {
          logger.warn({ caller: "AuthProvider.logout" }, "[Auth] resetStore failed", err);
        });
        router.replace("/login");
      });
  }, [apolloClient, clearAuthData, router, setUser, setError]);
}
