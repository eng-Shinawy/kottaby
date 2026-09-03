"use client";

import { createContext } from "react";
import type { LoginMutationVariables, MeQuery } from "@/frontend/graphql/generated/gql/graphql";

/**
 * The authenticated user — typed as `NonNullable<MeQuery["me"]>` so the
 * shape tracks the `me` GraphQL query selection (`id`, `email`, `fullName`,
 * `role`). If the `meQueryDocument` selection changes, this type updates
 * automatically on the next codegen run.
 */
export type AuthUser = NonNullable<MeQuery["me"]>;

/**
 * Credentials accepted by `login`. Mirrors `LoginMutationVariables`
 * (`{ email, password }`) so the AuthProvider can pass them straight to
 * `useMutation(loginMutationDocument)`.
 */
export type AuthCredentials = LoginMutationVariables;

/** Shape of the authentication context published by `AuthProvider`. */
export type AuthContextType = {
  readonly user: AuthUser | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly login: (credentials: AuthCredentials, redirectUrl?: string | null) => Promise<boolean>;
  readonly logout: () => void;
};

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
