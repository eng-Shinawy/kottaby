import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  ChangeMyPasswordMutation,
  ChangeMyPasswordMutationVariables,
  LoginMutation,
  LoginMutationVariables,
  LogoutMutation,
  MeQuery,
  RecordMyActivityMutation,
  RefreshTokenMutation,
  RefreshTokenMutationVariables,
  RegisterUserMutation,
  RegisterUserMutationVariables,
  UpdateMyLocaleMutation,
  UpdateMyLocaleMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * `registerUser` mutation — creates a new Student / Teacher (applicant) /
 * Parent account.
 *
 * Selection includes `id` on the returned `User` so Apollo Client can
 * normalize the cache entry (per `sharedDocuments/AGENTS.md` "id Field
 * Requirement").
 */
export const registerUserMutationDocument: TypedDocumentNode<RegisterUserMutation, RegisterUserMutationVariables> = gql`
  mutation RegisterUser($input: RegisterUserInput!) {
    registerUser(input: $input) {
      id
      email
      fullName
      role
    }
  }
`;

/**
 * `me` query — returns the authenticated user (or `null` for anonymous).
 *
 * The AuthProvider runs this on mount to restore the session from the
 * `Authorization: Bearer <accessToken>` header (held in React memory) or
 * the `access_token` cookie (SSR fallback). On `null` (anonymous), the
 * AuthProvider attempts a `refreshToken` via `useAuthRecoveryRegistration`
 * before settling on `isAuthenticated = false`.
 *
 * Selection includes `id` so Apollo cache normalization writes the user
 * into the same cache entry the `login` mutation produced. The selection
 * also includes the profile-page fields (`phone`, `country`, `gender`,
 * `locale`), the read-only governance fields (`isDeleted`, `suspended`,
 * `isBlocked`), and the forced-reset gate flag (`mustChangePassword`) so
 * the profile page can render full account info + status badges + the
 * language preference from a single `me` query (DASHBOARD-1) and the
 * session user carries the forced-reset flag the `DashboardLayout`
 * client redirect reads.
 */
export const meQueryDocument: TypedDocumentNode<MeQuery> = gql`
  query Me {
    me {
      id
      email
      fullName
      phone
      country
      gender
      locale
      role
      preferredRecitation
      isDeleted
      suspended
      isBlocked
      mustChangePassword
    }
  }
`;

/**
 * `login` mutation — authenticates with email + password.
 *
 * Returns `{ user, accessToken, refreshToken }`. The AuthProvider stores
 * `accessToken` in React memory (via `updateAuthToken`) + `refreshToken`
 * in a module-level slot (read by `useAuthRecoveryRegistration` so the
 * recovery link can call `refreshToken` without JS-readable cookies).
 *
 * The server ALSO sets `refresh_token` + `session_id` as httpOnly cookies
 * on the response (handled by the GraphQL route handler reading the
 * per-request `ctx.authCookieOut` accumulator).
 *
 * The `user` selection mirrors the `me` query selection (DASHBOARD-1) so
 * the AuthProvider can store the authenticated user directly from the
 * login mutation result — the same shape flows into `useAuth().user`.
 */
export const loginMutationDocument: TypedDocumentNode<LoginMutation, LoginMutationVariables> = gql`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      user {
        id
        email
        fullName
        phone
        country
        gender
        locale
        role
        preferredRecitation
        isDeleted
        suspended
        isBlocked
        mustChangePassword
      }
      accessToken
      refreshToken
    }
  }
`;

/**
 * `updateMyLocale` mutation — persists the caller's per-user app locale
 * (R2-users-locale backend vertical, D2).
 *
 * Self-scoped and authenticated-only: identity is derived server-side from
 * the verified context, so the only variable is the target `locale` enum.
 * Idempotent — re-sending the current value is a no-op write.
 *
 * NOTE on the wire value: the GraphQL `AppLocale` enum serializes as the
 * PascalCase `Ar` / `En` (the Gender-convention), while the shared app
 * locale union (`@/shared/locale/AppLocale`) stores lowercase `"ar"` /
 * `"en"`. Callers MUST map between the two at the boundary —
 * `"ar" → AppLocale.Ar`, `"en" → AppLocale.En`.
 *
 * Selection includes `id` FIRST so Apollo writes the returned user back
 * into the same normalized cache entry the `me` / `login` documents
 * produced (per `sharedDocuments/AGENTS.md` "id Field Requirement"); the
 * persisted `locale` rides along so `useAuth().user.locale` tracks the
 * account preference without a refetch.
 */
export const updateMyLocaleMutationDocument: TypedDocumentNode<
  UpdateMyLocaleMutation,
  UpdateMyLocaleMutationVariables
> = gql`
  mutation UpdateMyLocale($locale: AppLocale!) {
    updateMyLocale(locale: $locale) {
      id
      email
      locale
    }
  }
`;

/**
 * `changeMyPassword` mutation — the self-service credential change
 * (forced-reset flow + voluntary changes). Authenticated-only: identity is
 * derived server-side from the verified context, so the only variables are
 * the current password (verified server-side before the write) and the
 * replacement. The ONLY operation that clears the server-side forced
 * password-change flag.
 *
 * Selection includes `id` FIRST so Apollo writes the returned user back
 * into the same normalized cache entry the `me` / `login` documents
 * produced (per `sharedDocuments/AGENTS.md` "id Field Requirement");
 * `email` / `fullName` / `role` ride along to mirror the canonical
 * `me`-shape payload and `mustChangePassword` echoes the flag clear so the
 * client can proceed without a re-login.
 */
export const changeMyPasswordMutationDocument: TypedDocumentNode<
  ChangeMyPasswordMutation,
  ChangeMyPasswordMutationVariables
> = gql`
  mutation ChangeMyPassword($input: ChangeMyPasswordInput!) {
    changeMyPassword(input: $input) {
      id
      email
      fullName
      role
      mustChangePassword
    }
  }
`;

/**
 * `refreshToken` mutation — rotates the JWT pair from a valid refresh token.
 *
 * The argument is OPTIONAL: an empty/omitted value makes the server rotate
 * from the httpOnly `refresh_token` cookie instead (cold-reload recovery —
 * the React-memory token slot is empty after a page load, but the 7-day
 * cookie is still valid; this is the documented recovery design in
 * `docs/auth/REDIRECT_LOOP_FIX.md`).
 *
 * Returns `{ accessToken, refreshToken }`. The AuthProvider stores the new
 * `accessToken` in React memory + the new `refreshToken` in the
 * module-level slot. The server ALSO sets the new `refresh_token` +
 * `session_id` as httpOnly cookies (rotation invalidates the prior pair).
 */
export const refreshTokenMutationDocument: TypedDocumentNode<RefreshTokenMutation, RefreshTokenMutationVariables> = gql`
  mutation RefreshToken($refreshToken: String) {
    refreshToken(refreshToken: $refreshToken) {
      accessToken
      refreshToken
    }
  }
`;

/**
 * `logout` mutation — clears the `access_token` + `refresh_token` +
 * `session_id` httpOnly cookies on the server. Public — callable with an
 * expired token. The AuthProvider calls this from `logout()` before
 * clearing its React-memory state + navigating to `/login`.
 *
 * Returns `{ success }` (always `true` — the resolver always clears the
 * cookies via `clearAuthCookies` and returns success).
 */
export const logoutMutationDocument: TypedDocumentNode<LogoutMutation> = gql`
  mutation Logout {
    logout {
      success
    }
  }
`;

/**
 * `recordMyActivity` mutation — the client presence heartbeat.
 *
 * Argless by contract: identity is derived server-side from the verified
 * context, never from arguments, and the payload is a bare non-nullable
 * `Boolean` (the server's activity stamp always reports success once the
 * request is authenticated). Because nothing object-typed is selected, the
 * shared-documents `id` Field Requirement does not apply here — there is no
 * normalized cache entry to write.
 *
 * Fired by the shell-mounted presence heartbeat while the document is
 * visible. Every beat is a monotonic activity stamp server-side, so the
 * operation is idempotent; a failed beat is logged and swallowed by the
 * heartbeat — this mutation must never surface UI.
 */
export const recordMyActivityMutationDocument: TypedDocumentNode<RecordMyActivityMutation> = gql`
  mutation RecordMyActivity {
    recordMyActivity
  }
`;
