"use client";

import type { ApolloClient } from "@apollo/client";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { AuthContextType } from "@/frontend/context/AuthContext";
import { loginMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { setRefreshMemoryToken } from "@/frontend/lib/auth/refreshMemoryToken";
import { logger } from "@/frontend/lib/logger";
import { Auth, useAppTranslation } from "@/shared/locale";

/**
 * `useAuthLogin` — login mutation hook.
 *
 * Returns the `login` callback: calls `loginMutationDocument`, on success
 * pushes `accessToken` into `updateAuthToken` (so the authLink uses it on
 * the next request), stores `refreshToken` in the React-memory slot (so
 * the recovery link can call `refreshToken` later), sets `user` from the
 * mutation result, returns `true`. On error: sets `error` to a localized
 * message and rethrows so the LoginForm can do granular error-code mapping
 * (UNAUTHORIZED → invalidCredentials, FORBIDDEN → accountBlocked, etc.).
 */
export function useAuthLogin(
  apolloClient: ApolloClient,
  updateAuthToken: (token: string) => void,
  setUser: Dispatch<SetStateAction<AuthContextType["user"]>>,
  setError: Dispatch<SetStateAction<string | null>>
): AuthContextType["login"] {
  const t = useAppTranslation(Auth);

  return useCallback<AuthContextType["login"]>(
    async (credentials, _redirectUrl) => {
      setError(null);
      try {
        const result = await apolloClient.mutate({
          mutation: loginMutationDocument,
          variables: credentials,
        });
        const payload = result.data?.login;
        if (!payload) {
          setError(t.loginError);
          return false;
        }
        // Persist tokens: access token → React memory (authLink reads it
        // on the next request), refresh token → React-memory slot
        // (recovery link reads it on UNAUTHENTICATED).
        updateAuthToken(payload.accessToken);
        setRefreshMemoryToken(payload.refreshToken);
        setUser(payload.user);
        return true;
      } catch (err) {
        logger.warn({ caller: "AuthProvider.login" }, "[Auth] login failed", err);
        setError(t.loginError);
        // Rethrow so the LoginForm can do granular error-code mapping
        // (UNAUTHORIZED → invalidCredentials, FORBIDDEN → accountBlocked, etc.)
        throw err;
      }
    },
    [apolloClient, t.loginError, updateAuthToken, setUser, setError]
  );
}
