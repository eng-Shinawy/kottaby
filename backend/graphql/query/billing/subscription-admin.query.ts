/**
 * Admin subscription read query — `adminStudentSubscriptions`.
 *
 * Contract:
 *  - `adminStudentSubscriptions(userId: ID!): [StudentSubscription!]!` —
 *    the addressed student-owner's subscription rows across every
 *    lifecycle status, NEWEST FIRST (the repository's own `created_at
 *    DESC` ordering), mapped onto the canonical `StudentSubscription`
 *    object. The owner id is the only client material; the acting
 *    admin's identity is server-bound from `ctx.user.id` (never from
 *    args — BOLA-safe by construction).
 *  - BOLA boundary: the service's read predicate is `user_id = userId` —
 *    ONLY the addressed owner's rows come back, and a well-formed but
 *    unknown id is the indistinguishable empty list (never an error).
 *  - The wire `ID` is coerced through the service-owned strict
 *    decimal-string parse (`coerceUserId`) BEFORE the service call — a
 *    malformed id is the canonical localized VALIDATION denial, never a
 *    silent mis-target or a 500.
 *  - Read-only: no writes, no audit rows. DomainErrors (FORBIDDEN
 *    non-admin, VALIDATION malformed id) propagate uncaught to the
 *    masking boundary — no try/catch here.
 *
 * authScopes (`adminOnlyAuthScopes` — the MANDATORY `$all` conjunction):
 *  - `{ $all: { authenticated: true, role: [Admin] } }` from the shared
 *    admin prelude. Anonymous → `UNAUTHORIZED` (401); authenticated
 *    non-admin → `FORBIDDEN` (403) — both BEFORE the resolver body runs.
 *    `requireAdminUser(ctx)` is the TypeScript-narrowing belt only.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/billing/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation;
 *    no business logic inline. Top-level static imports only.
 */

import { SubscriptionPothosObject } from "@/backend/graphql/pothos/billing/subscription.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { adminOnlyAuthScopes, requireAdminUser } from "@/backend/graphql/shared";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import { coerceUserId } from "@/backend/services/billing/subscription-admin-read.helpers";

// Side-effect: register the `adminStudentSubscriptions` query field.
gqlSchemaBuilder.queryField("adminStudentSubscriptions", t =>
  t.field({
    type: [SubscriptionPothosObject],
    description:
      "Lists one student's subscriptions across every lifecycle status, newest first. Admin-only; the results include only rows owned by the addressed user.",
    authScopes: adminOnlyAuthScopes,
    args: {
      userId: t.arg.id({
        required: true,
        description: "The student owner's user id whose subscriptions are listed.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const tErrors = await ctx.t("errorsTranslations");
      return SubscriptionAdminService.listForAdmin(coerceUserId(args.userId, tErrors), user.id, ctx.locale);
    },
  })
);
