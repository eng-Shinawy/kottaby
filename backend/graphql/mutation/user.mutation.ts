/**
 * User mutations — `updateMyLocale`.
 *
 * Contract:
 *  - `updateMyLocale(locale: AppLocale!): User!`
 *      Persists the CALLER's app locale preference (UI + notification-copy
 *      language) on `users.locale` — the DEV3-010 deferred item D2 column.
 *      Identity is derived EXCLUSIVELY from the verified context (`ctx.user`)
 *      — the field accepts no identity argument of any kind, so a BOLA probe
 *      dies as a GraphQL validation failure before a resolver ever runs.
 *      Returns the updated `User` (the same canonical object `me` / `login`
 *      return, so the client's Apollo cache normalizes the write into the
 *      existing entry). Re-writing the same locale is idempotent.
 *
 * Scope semantics (every authenticated role owns a locale preference — no
 * role, permission, or superAdmin scope participates):
 *  - The field carries EXACTLY `authScopes: { authenticated: true }`
 *    (the `me` query precedent). Anonymous callers hit the `authenticated`
 *    scope's UnauthorizedError throw (extensions.code UNAUTHORIZED / 401
 *    semantics).
 *
 * Thin-resolver discipline:
 *  - The body normalizes the wire value (`String(args.locale)` — the enum
 *    member's runtime value IS the canonical locale string "ar"|"en") and
 *    delegates to `AuthService.updateMyLocale` with `ctx.user.id` +
 *    `ctx.locale` — no business logic, no repository imports. Validation is
 *    layered defense-in-depth (the markNotificationRead NaN-guard
 *    precedent): the `AppLocale` GraphQL enum rejects any other literal at
 *    validation time (before a resolver runs), and the SERVICE's own
 *    `isAppLocale` closed-set gate — the single localized-rejection
 *    construction site — re-validates for non-schema transports and future
 *    callers.
 *  - `ctx.locale` propagates so localized errors resolve through the
 *    service's translation seam.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — the root field registers at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through the side-effect barrel `backend/graphql/mutation/index.ts`.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { AppLocalePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { UserPothosObject } from "@/backend/graphql/pothos/users/user.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { AuthService } from "@/backend/services/auth";

// Side-effect: register the `updateMyLocale` mutation field.
gqlSchemaBuilder.mutationField("updateMyLocale", t =>
  t.field({
    type: UserPothosObject,
    args: {
      locale: t.arg({ type: AppLocalePothosEnum, required: true }),
    },
    description:
      "Persists the caller's app locale preference (UI + notification-copy language) and returns the updated user. Idempotent. Self-scoped — identity is derived from the verified context, never from arguments.",
    // Requires an authenticated context (UNAUTHORIZED otherwise) — every
    // authenticated role owns a locale preference, so no role/permission
    // scope applies (the `me` query precedent).
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, args, ctx) => {
      // The `authenticated` scope guarantees a verified user row at
      // resolution time (anonymous callers never get past the scope step).
      // This branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly. Unreachable in practice; per the resolver-i18n
      // rule the message flows through ctx.t (its en copy is identical to
      // builder.ts's `authenticated` scope literal).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // Defense-in-depth layering (the markNotificationRead NaN-guard
      // precedent): the AppLocale enum already rejects any non-locale
      // literal at validation time; the service's own `isAppLocale` gate —
      // the single localized-rejection construction site — re-validates for
      // non-schema transports and future callers. The enum member's runtime
      // value IS the canonical locale string ("ar" | "en"), identical to the
      // persisted `users.locale` value, so it flows through unchanged.
      return AuthService.updateMyLocale(ctx.user.id, args.locale, ctx.locale);
    },
  })
);
