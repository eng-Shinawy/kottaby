/**
 * Admin broadcast mutation — `adminBroadcastNotification`.
 *
 * Contract:
 *  - `adminBroadcastNotification(input: AdminBroadcastNotificationInput!): Int!`
 *      Composes one admin-authored announcement into one `system_broadcast`
 *      notification per resolved recipient and returns the PERSISTED
 *      recipient count (the audit's `recipientCount` and the engine's
 *      receipt agree — the count is never a client-supplied or projected
 *      number). The audience selector resolves server-side: the caller can
 *      never name an individual user.
 *
 * Scope semantics (the `$all` conjunction is LOAD-BEARING):
 *  - EXACTLY `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`.
 *    Anonymous → `UNAUTHORIZED` (401 semantics); authenticated non-admin →
 *    `FORBIDDEN` (403 semantics) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit (the admin surface's documented wrong answer).
 *  - The scope gate is the OUTER wall only: the service re-verifies the
 *    actor against a real admin row (defense-in-depth) before any write.
 *
 * Thin-resolver discipline:
 *  - The body delegates EXCLUSIVELY to `AdminBroadcastService.broadcast` —
 *    no business logic, no repository imports, no direct engine calls (the
 *    engine is consumed by the service, by reference).
 *  - Input mapping is FIELD-BY-FIELD into the canonical
 *    `BroadcastNotificationSubmitInput` shape — never a `{ ...input }`
 *    spread, so no transport-smuggled field can cross the boundary. The
 *    absent/null wire slots map to `null` (the service's "not provided"
 *    semantics treat both identically).
 *  - Identity is derived EXCLUSIVELY from the verified context: the only
 *    actor source is `ctx.user.id` (never an argument), the locale is
 *    `ctx.locale`, and the compose-session key is the gateway-captured
 *    `ctx.idempotencyKey` (propagation-only — materialized as `null` when
 *    the `X-Idempotency-Key` header is absent, coalesced to `undefined` for
 *    the service's optional slot). No identity argument exists on the field.
 *  - NO try/catch: expected service rejections carry their localized
 *    messages and `extensions.code` already; everything unexpected bubbles
 *    to the boundary's masking finalizer (resolvers never mask or log).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — the root field registers at import
 *    time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/notifications/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { AdminBroadcastNotificationInput } from "@/backend/graphql/pothos/notifications/admin-broadcast.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { AdminBroadcastService } from "@/backend/services/notifications/admin-broadcast.service";

// Side-effect: register the `adminBroadcastNotification` mutation field.
gqlSchemaBuilder.mutationField("adminBroadcastNotification", t =>
  t.field({
    type: "Int",
    args: {
      input: t.arg({ type: AdminBroadcastNotificationInput, required: true }),
    },
    description:
      "Broadcasts an admin-authored announcement to the audience selected server-side and returns the persisted recipient count.",
    // Admin-only — the `$all` conjunction makes the authenticated+role pair
    // an AND (ANY semantics is the plain-map default and is the documented
    // wrong answer for an admin surface).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all` scope conjunction guarantees an authenticated admin at
      // resolution time (anonymous and non-admin callers never get past the
      // scope step). This branch exists purely for TypeScript narrowing —
      // the repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly. Unreachable in practice; per the
      // resolver-i18n rule the message flows through ctx.t.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      const { input } = args;
      // Field-by-field mapping (never a spread) into the canonical submit
      // shape; actorId ONLY from the verified context; the gateway-captured
      // idempotency key propagates as-is (null-absent → optional undefined).
      return AdminBroadcastService.broadcast(
        {
          title: input.title,
          body: input.body ?? null,
          audience: {
            type: input.audience.type,
            role: input.audience.role ?? null,
            country: input.audience.country ?? null,
            planId: input.audience.planId ?? null,
          },
        },
        ctx.user.id,
        ctx.locale,
        ctx.idempotencyKey ?? undefined
      );
    },
  })
);
