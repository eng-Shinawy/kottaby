/**
 * User mutations — `updateMyLocale` + `changeMyPassword` + `recordMyActivity`.
 *
 * Contract:
 *  - `updateMyLocale(locale: AppLocale!): User!`
 *      Persists the CALLER's app locale preference (UI + notification-copy
 *      language) on `users.locale` — the deferred item D2 column.
 *      Identity is derived EXCLUSIVELY from the verified context (`ctx.user`)
 *      — the field accepts no identity argument of any kind, so a BOLA probe
 *      dies as a GraphQL validation failure before a resolver ever runs.
 *      Returns the updated `User` (the same canonical object `me` / `login`
 *      return, so the client's Apollo cache normalizes the write into the
 *      existing entry). Re-writing the same locale is idempotent.
 *  - `changeMyPassword(input: ChangeMyPasswordInput!): User!`
 *      Verifies the CALLER's current credential (`comparePassword` against
 *      the stored hash) and rotates it. Self-service by construction: no
 *      identity argument exists — the target row is always `ctx.user.id`, so
 *      a caller can only ever change its OWN credential (a BOLA probe dies
 *      at GraphQL validation, same as `updateMyLocale`). Returns the updated
 *      password-stripped `User` (the canonical object `me` / `login` return)
 *      with the credential-governance flag cleared (`mustChangePassword:
 *      false`) — this mutation is the ONLY operation that clears that flag.
 *      The closed two-field `ChangeMyPasswordInput` (both members plaintext,
 *      hashed/verified by the service before persistence) is defined beside
 *      the canonical `User` object in `pothos/users/user.pothos.ts`.
 *  - `recordMyActivity: Boolean!`
 *      The presence heartbeat's server leg: stamps the CALLER's
 *      `last_active_at` (the monotonic activity-stamp primitive) inside one
 *      transaction and returns the plain success scalar. Argless by design —
 *      the field admits NO argument of any kind (BOPLA: no client-owned
 *      value, no input object to seal), so a BOLA probe dies as a GraphQL
 *      validation failure before a resolver ever runs, exactly like
 *      `updateMyLocale` / `changeMyPassword`. The repository primitive's
 *      boolean miss (unknown id, already-fresh stamp) is a no-op — the wire
 *      contract stays `true`; a repo failure propagates uncaught to the
 *      standard error finalizer.
 *
 * Scope semantics (all fields are self-scoped — no role, permission, or
 * superAdmin scope participates):
 *  - Each field carries EXACTLY `authScopes: { authenticated: true }`
 *    (the `me` query precedent): every authenticated role owns a locale
 *    preference, a credential, and an activity signal. Anonymous callers
 *    hit the `authenticated` scope's UnauthorizedError throw (extensions.code
 *    UNAUTHORIZED / 401 semantics).
 *
 * Thin-resolver discipline:
 *  - `updateMyLocale` normalizes the wire value (the enum member's runtime
 *    value IS the canonical locale string "ar"|"en") and delegates to
 *    `AuthService.updateMyLocale` with `ctx.user.id` + `ctx.locale` — no
 *    business logic, no repository imports. Validation is layered
 *    defense-in-depth (the markNotificationRead NaN-guard precedent): the
 *    `AppLocale` GraphQL enum rejects any other literal at validation time
 *    (before a resolver runs), and the SERVICE's own `isAppLocale`
 *    closed-set gate — the single localized-rejection construction site —
 *    re-validates for non-schema transports and future callers.
 *  - `changeMyPassword` property-maps the two plaintext members into the
 *    service's closed `ChangeMyPasswordSubmitInput` and delegates to
 *    `AuthService.changeMyPassword(ctx.user.id, input, ctx.locale)` — the
 *    service owns the ENTIRE verification/policy/hash/persist sequence
 *    (`CURRENT_PASSWORD_INVALID`, `NEW_PASSWORD_SAME_AS_CURRENT`, and the
 *    shared password-policy denials ride `extensions.fields` for inline
 *    per-field UI errors); the resolver adds none of it.
 *  - `ctx.locale` propagates so localized errors resolve through the
 *    service's translation seam.
 *  - `recordMyActivity` is the purest delegation of the three: the field
 *    admits ZERO arguments (no client-owned input exists to normalize) and
 *    delegates `ctx.user.id` verbatim — the one-now capture, the transaction
 *    composition, and the repository primitive call all live in
 *    `AuthService.recordMyActivity`.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — the root field registers at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through the side-effect barrel `backend/graphql/mutation/index.ts`.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { AppLocalePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { ChangeMyPasswordInput, UserPothosObject } from "@/backend/graphql/pothos/users/user.pothos";
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

// Side-effect: register the `changeMyPassword` mutation field.
gqlSchemaBuilder.mutationField("changeMyPassword", t =>
  t.field({
    type: UserPothosObject,
    args: {
      input: t.arg({ type: ChangeMyPasswordInput, required: true }),
    },
    description:
      "Verifies the caller's current password, replaces it, and clears the forced-reset flag, returning the updated password-stripped user. Self-scoped — identity is derived from the verified context, never from arguments; the only path that clears `mustChangePassword`.",
    // Requires an authenticated context (UNAUTHORIZED otherwise) — the
    // self-service credential path is open to every authenticated role, so
    // no role/permission/superAdmin scope participates (the `me` query /
    // `updateMyLocale` precedent).
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
      // BOPLA property mapping into the service's closed submit input —
      // exactly the two plaintext members the wire input carries, never a
      // wholesale pass-through of the GraphQL object. Zero business logic
      // here: current-password verification, the same-as-current guard, the
      // shared policy gate, hashing, the single flag-clearing write, and
      // the password-stripped projection all live in the service.
      return AuthService.changeMyPassword(
        ctx.user.id,
        { currentPassword: args.input.currentPassword, newPassword: args.input.newPassword },
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `recordMyActivity` mutation field.
gqlSchemaBuilder.mutationField("recordMyActivity", t =>
  t.field({
    type: "Boolean",
    description:
      "Heartbeat server leg — stamps the caller's last-activity timestamp and returns true. Argless: identity is derived from the verified context, never from arguments.",
    // Requires an authenticated context (UNAUTHORIZED otherwise) — every
    // authenticated role owns an activity signal, so no role/permission
    // scope applies (the `me` query / `updateMyLocale` precedent).
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, _args, ctx) => {
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
      // Argless by design (BOPLA): identity is server-derived from the
      // authenticated context — there is no client-owned value and no
      // input object to seal. One-line delegation: the one-now capture,
      // the transaction composition, and the repository primitive call
      // all live in the service.
      return AuthService.recordMyActivity(ctx.user.id);
    },
  })
);
