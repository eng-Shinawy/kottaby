"use client";

import { useApolloClient } from "@apollo/client/react";
import { type ReactNode, useMemo, useState } from "react";
import { AuthContext, type AuthContextType } from "@/frontend/context/AuthContext";
import { useNetworkConnectivity } from "@/frontend/hooks/connectivity";
import { useAuthLogin } from "@/frontend/providers/apollo/useAuthLogin";
import { useAuthLogout } from "@/frontend/providers/apollo/useAuthLogout";
import { useRefreshSession } from "@/frontend/providers/apollo/useRefreshSession";
import { useRestoreSession } from "@/frontend/providers/apollo/useRestoreSession";

interface AuthProviderProps {
  readonly children: ReactNode;
}

/**
 * AuthProvider — real implementation.
 *
 * State machine:
 *  - On mount: query `me` (carrying the access token from React memory via
 *    the authLink). If it returns a user → `isAuthenticated = true`. If it
 *    throws (UNAUTHORIZED — no/expired token), try `refreshToken` directly
 *    (using the refresh token held in the React-memory slot). On refresh
 *    success, retry `me` with the fresh access token. On refresh failure /
 *    no refresh token → settle as anonymous (`isAuthenticated = false`).
 *  - `login(credentials)`: calls `loginMutationDocument`, on success pushes
 *    `accessToken` into `updateAuthToken` (so the authLink uses it on the
 *    next request), stores `refreshToken` in the React-memory slot (so the
 *    recovery link can call `refreshToken` later), sets `user` from the
 *    mutation result, returns `true`. On error: sets `error` to a localized
 *    message, returns `false`.
 *  - `logout()`: calls `logoutMutationDocument` (public mutation — clears
 *    the httpOnly cookies server-side via `clearAuthCookies`), then clears
 *    the access + refresh tokens from React memory, resets `user` to null,
 *    resets the Apollo cache (so stale authenticated data doesn't leak
 *    into the next session), and navigates to `/login`. The server-side
 *    cookie clear is fire-and-forget — even if it fails, the client state
 *    is reset (the cookies will expire on their own TTL).
 *
 * Cold-start recovery: the refresh token is held in React memory only
 * (per `docs/auth/REDIRECT_LOOP_FIX.md` — never persisted to localStorage
 * to mitigate XSS). On a full page reload React memory is wiped — but the
 * 7-day httpOnly `refresh_token` cookie survives, and the `refreshToken`
 * mutation accepts an empty argument to rotate from that cookie
 * (cold-reload recovery). The mount-time `restoreSession` effect therefore
 * re-establishes the session (me → cookie-based refresh → me retry) as long
 * as the cookie is valid, without bouncing the user to `/login`.
 *
 * `me` carries `authScopes: { authenticated: true }` — anonymous
 * callers receive a GraphQL UNAUTHORIZED error instead of `null`. The
 * `restoreSession` effect catches the error and falls through to its
 * refresh-then-retry path (same UX as the prior return-null contract, but
 * with explicit 401 semantics at the schema layer).
 *
 * The behavior above is composed from focused hooks:
 *  - `useRefreshSession` — refresh-token rotation (deduped).
 *  - `useRestoreSession` — mount-time `me` → refresh → `me` retry effect.
 *  - `useAuthLogin` — login mutation + token persistence.
 *  - `useAuthLogout` — logout mutation + client-state reset + redirect.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const apolloClient = useApolloClient();
  const { updateAuthToken, clearAuthData } = useNetworkConnectivity();

  const [user, setUser] = useState<AuthContextType["user"]>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useRefreshSession(apolloClient, updateAuthToken);
  useRestoreSession(apolloClient, refreshSession, setUser, setIsLoading);
  const login = useAuthLogin(apolloClient, updateAuthToken, setUser, setError);
  const logout = useAuthLogout(apolloClient, clearAuthData, setUser, setError);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      error,
      login,
      logout,
    }),
    [user, isLoading, error, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
