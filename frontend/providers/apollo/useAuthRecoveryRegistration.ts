"use client";

import type { ApolloClient } from "@apollo/client";
import { useCallback, useEffect } from "react";
import { refreshTokenMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { getRefreshMemoryToken, setRefreshMemoryToken } from "@/frontend/lib/auth/refreshMemoryToken";
import { dedupedRefreshToken } from "@/frontend/lib/dedupedRefreshToken";
import { logger } from "@/frontend/lib/logger";
import { registerAuthRecovery, unregisterAuthRecovery } from "@/frontend/providers/apollo/utils";

/**
 * Auth-recovery registration hook.
 *
 * Wires the `refreshToken` mutation into the shared errorLink (via
 * `registerAuthRecovery`) so UNAUTHENTICATED GraphQL responses trigger a
 * `refreshToken` BEFORE hard-redirecting to `/login`. On success, the new
 * access token is pushed into `updateAuthToken` (so the authLink uses it on
 * the next request) + the new refresh token is stored in the React-memory
 * slot (so the next recovery call uses the rotated token). On failure, the
 * errorLink falls through to its existing redirect-to-login behavior.
 *
 * `dedupedRefreshToken` ensures N concurrent UNAUTHENTICATED responses share
 * a single `refreshToken` mutation (mirrors the server-side idempotency we'd
 * get from a session endpoint).
 *
 * The hook registers on mount + unregisters on unmount. `apolloClient` is
 * nullable so the parent `AppApolloProvider` can render its loading UI
 * before the client exists (though in practice the client is created at
 * module scope, so it's never null after the first render).
 */
export function useAuthRecoveryRegistration(
  apolloClient: ApolloClient | null,
  updateAuthToken: (token: string) => void
): void {
  const refresh = useCallback(async (): Promise<string | null> => {
    if (!apolloClient) {
      logger.warn({ caller: "useAuthRecoveryRegistration" }, "[AuthRecovery] no Apollo client — skipping refresh");
      return null;
    }

    return dedupedRefreshToken(async () => {
      const currentRefreshToken = getRefreshMemoryToken();
      if (!currentRefreshToken) {
        logger.info(
          { caller: "useAuthRecoveryRegistration" },
          "[AuthRecovery] no refresh token in React memory — rotating from the httpOnly cookie"
        );
      }

      try {
        const result = await apolloClient.mutate({
          mutation: refreshTokenMutationDocument,
          variables: { refreshToken: currentRefreshToken ?? "" },
        });
        const payload = result.data?.refreshToken;
        if (!payload) {
          logger.warn({ caller: "useAuthRecoveryRegistration" }, "[AuthRecovery] refreshToken returned no payload");
          return null;
        }
        // Persist the fresh tokens: access token → React memory (authLink
        // reads it on the next request), refresh token → React-memory slot
        // (next recovery call uses the rotated token).
        updateAuthToken(payload.accessToken);
        setRefreshMemoryToken(payload.refreshToken);
        logger.info({ caller: "useAuthRecoveryRegistration" }, "[AuthRecovery] refresh succeeded");
        return payload.accessToken;
      } catch (error: unknown) {
        logger.warn({ caller: "useAuthRecoveryRegistration" }, "[AuthRecovery] refresh failed", error);
        // Clear the stale refresh token so subsequent recovery attempts
        // don't keep retrying with the same dead token.
        setRefreshMemoryToken(null);
        return null;
      }
    });
  }, [apolloClient, updateAuthToken]);

  const reFetch = useCallback(() => {
    if (!apolloClient) {
      return;
    }
    // Re-issue all active observable queries with the fresh token loaded
    // into React memory by `updateAuthToken`. `apolloClient.refetchQueries({ include: "active" })`
    // re-runs every active watchQuery against the new authLink state.
    void apolloClient.refetchQueries({ include: "active" }).catch((error: unknown) => {
      logger.warn({ caller: "useAuthRecoveryRegistration" }, "[AuthRecovery] refetchQueries failed", error);
    });
  }, [apolloClient]);

  useEffect(() => {
    registerAuthRecovery({ refresh, reFetch });
    return () => {
      unregisterAuthRecovery();
    };
  }, [refresh, reFetch]);
}
