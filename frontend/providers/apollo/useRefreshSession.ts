"use client";

import type { ApolloClient } from "@apollo/client";
import { useCallback } from "react";
import { refreshTokenMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { getRefreshMemoryToken, setRefreshMemoryToken } from "@/frontend/lib/auth/refreshMemoryToken";
import { dedupedRefreshToken } from "@/frontend/lib/dedupedRefreshToken";
import { logger } from "@/frontend/lib/logger";

/**
 * `useRefreshSession` — refresh-token rotation hook.
 *
 * Returns a `refreshSession` callback that calls the `refreshToken` mutation
 * with the refresh token held in React memory, deduped so concurrent callers
 * share a single mutation. On success: pushes the new access token into the
 * authLink state via `updateAuthToken` and stores the new refresh token in
 * the React-memory slot. On failure: clears the stale refresh token so
 * subsequent attempts don't retry with the same dead token. Returns the new
 * access token (or `null` on failure).
 */
export function useRefreshSession(
  apolloClient: ApolloClient,
  updateAuthToken: (token: string) => void
): () => Promise<string | null> {
  // Internal refresh helper — calls `refreshToken` mutation with the
  // refresh token from React memory, deduped so concurrent callers share
  // a single mutation. On success: pushes the new access token into the
  // authLink state + stores the new refresh token in the memory slot.
  // Returns the new access token (or `null` on failure).
  return useCallback(async (): Promise<string | null> => {
    return dedupedRefreshToken(async () => {
      const currentRefreshToken = getRefreshMemoryToken();
      if (!currentRefreshToken) {
        return null;
      }
      try {
        const result = await apolloClient.mutate({
          mutation: refreshTokenMutationDocument,
          variables: { refreshToken: currentRefreshToken },
        });
        const payload = result.data?.refreshToken;
        if (!payload) {
          return null;
        }
        updateAuthToken(payload.accessToken);
        setRefreshMemoryToken(payload.refreshToken);
        return payload.accessToken;
      } catch (err) {
        logger.warn({ caller: "AuthProvider.refreshSession" }, "[Auth] refresh failed", err);
        // Clear the stale refresh token so subsequent attempts don't
        // retry with the same dead token.
        setRefreshMemoryToken(null);
        return null;
      }
    });
  }, [apolloClient, updateAuthToken]);
}
