/**
 * Auth mutations — `registerUser`, `login`, `refreshToken`, and `logout`.
 *
 * Contract:
 *  - `registerUser(input: RegisterUserInput!): User!`
 *      Public. Creates a new Student / Teacher (applicant) / Parent account.
 *      BFLA defense: `role` enum excludes `admin` at the schema layer.
 *  - `login(email: String!, password: String!): LoginPayload!`
 *      Public. Verifies credentials, issues the JWT pair, returns
 *      `{ user, accessToken, refreshToken }`. The resolver ALSO pushes the
 *      `access_token` + `refresh_token` + `session_id` as httpOnly cookies
 *      via the per-request `ctx.authCookieOut` accumulator — the route
 *      handler reads it after Apollo processes the request and merges the
 *      values onto the outgoing `Response`. Setting `access_token` as a
 *      cookie is the redirect-loop fix — SSR (`getServerUserContext`) reads
 *      it to verify the session without a client-supplied identity.
 *  - `refreshToken(refreshToken: String!): RefreshTokenPayload!`
 *      Public. Verifies the supplied refresh token, rotates the pair
 *      (issues a NEW refresh token), returns `{ accessToken, refreshToken }`.
 *      The resolver ALSO pushes the fresh `access_token` + `refresh_token` +
 *      `session_id` as httpOnly cookies (rotation).
 *  - `logout: LogoutPayload!`
 *      Public. Clears the `access_token` + `refresh_token` + `session_id`
 *      httpOnly cookies via `clearAuthCookies`. Returns `{ success: true }`.
 *      Callable with an expired token (you can always log out).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — it registers root fields at import time
 *    via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect import in `backend/graphql/mutation/index.ts`.
 *
 * i18n: all messages resolve through `getServerTranslations(locale)` — never
 * hardcoded strings. Service-layer `DomainError` subclasses propagate
 * `extensions.code` to the client untouched (CONFLICT, VALIDATION,
 * UNAUTHORIZED, FORBIDDEN).
 */

import {
  LoginPayloadPothosObject,
  LogoutPayloadPothosObject,
  RefreshTokenPayloadPothosObject,
} from "@/backend/graphql/pothos/auth/auth-payload.pothos";
import { RegisterUserInput } from "@/backend/graphql/pothos/auth/register-input.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UserPothosObject } from "@/backend/graphql/pothos/users/user.pothos";
import { AUTH_COOKIE_NAMES, clearAuthCookies, setAuthCookies } from "@/backend/lib/auth/cookies";
import { AuthService, RegistrationService } from "@/backend/services/auth";

// Side-effect: register the `registerUser` mutation field.
gqlSchemaBuilder.mutationField("registerUser", t =>
  t.field({
    type: UserPothosObject,
    args: {
      input: t.arg({ type: RegisterUserInput, required: true }),
    },
    // Public mutation — no permission gate. BFLA defense lives in the input
    // enum (`RegisterPublicRole` excludes "admin") and the service layer.
    resolve: async (_root, args, ctx) => {
      const { input } = args;
      return RegistrationService.registerUser(
        {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          password: input.password,
          gender: input.gender ?? undefined,
          country: input.country,
          role: input.role,
          // Pass the optional preferredRecitation to the service for
          // catalog validation (NOT persisted to the `recitation` table).
          preferredRecitation: input.preferredRecitation ?? undefined,
        },
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `login` mutation field.
gqlSchemaBuilder.mutationField("login", t =>
  t.field({
    type: LoginPayloadPothosObject,
    args: {
      email: t.arg({ type: "String", required: true }),
      password: t.arg({ type: "String", required: true }),
    },
    description:
      "Authenticate with email + password. Returns the authenticated user + access + refresh tokens. The access_token + refresh_token + session_id are also set as httpOnly cookies.",
    resolve: async (_root, args, ctx) => {
      const session = await AuthService.login(args.email, args.password, ctx.locale);
      // Push the access_token + refresh_token + session_id as httpOnly
      // cookies. The route handler reads `ctx.authCookieOut` after Apollo
      // processes the request and merges the values onto the outgoing
      // `Response` via `headers.append("Set-Cookie", ...)`. Setting
      // `access_token` as a cookie is the redirect-loop fix — SSR reads it.
      setAuthCookies(ctx.authCookieOut, session.accessToken, session.refreshToken, session.sessionId);
      return session;
    },
  })
);

// Side-effect: register the `refreshToken` mutation field.
gqlSchemaBuilder.mutationField("refreshToken", t =>
  t.field({
    type: RefreshTokenPayloadPothosObject,
    args: {
      // Optional — an omitted/empty argument falls back to the
      // httpOnly `refresh_token` cookie (set by `setAuthCookies` on
      // login). This is the redirect-loop recovery path: after a cold
      // reload the client's React-memory refresh token is gone, but the
      // 7-day cookie is still valid — the client calls the mutation with
      // no argument and the server rotates from the cookie (the documented
      // design in `docs/auth/REDIRECT_LOOP_FIX.md`, "Cookie Lifecycle").
      refreshToken: t.arg({ type: "String" }),
    },
    description:
      "Rotate the JWT pair from a valid refresh token (explicit argument, or the httpOnly refresh_token cookie when omitted). Returns fresh access + refresh tokens. The new access_token + refresh_token + session_id are also set as httpOnly cookies (rotation invalidates the prior pair).",
    resolve: async (_root, args, ctx) => {
      // Explicit (React-memory) token wins; fall back to the httpOnly
      // cookie so cold reloads can still rotate (session recovery). NB:
      // `??` alone is not enough — Apollo always sends the (possibly
      // empty) variable, and `"".trim()` is `""`, not nullish.
      const explicitToken = args.refreshToken?.trim() ?? "";
      const cookieToken = ctx.cookies[AUTH_COOKIE_NAMES.refreshToken] ?? "";
      const token = explicitToken !== "" ? explicitToken : cookieToken;
      const result = await AuthService.refreshToken(token, ctx.locale);
      // Push the rotated access_token + refresh_token + session_id as
      // httpOnly cookies.
      setAuthCookies(ctx.authCookieOut, result.accessToken, result.refreshToken, result.sessionId);
      return result;
    },
  })
);

// Side-effect: register the `logout` mutation field.
//
// `logout` is PUBLIC — no `authScopes: { authenticated: true }` gate. A
// caller with an expired access token (or no token at all) MUST still be
// able to log out so the cookies clear and the client resets to anonymous.
// The resolver always calls `clearAuthCookies` and returns `{ success: true }`.
gqlSchemaBuilder.mutationField("logout", t =>
  t.field({
    type: LogoutPayloadPothosObject,
    description:
      "Clears the access_token + refresh_token + session_id httpOnly cookies. Public — callable with an expired token. Always returns { success: true }.",
    resolve: (_root, _args, ctx) => {
      clearAuthCookies(ctx.authCookieOut);
      return { success: true };
    },
  })
);
