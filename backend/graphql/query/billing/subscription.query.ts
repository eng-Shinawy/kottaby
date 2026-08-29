/**
 * Subscription queries — `mySubscriptions` (DEV1-006 Phase A: the
 * owner-scoped read behind the storefront's pending-request state).
 *
 *  - `mySubscriptions: [Subscription!]!` — every subscription owned by the
 *    calling user (ANY status, newest first), each with its plan row
 *    embedded. Ownership comes from the VERIFIED session context
 *    (`ctx.user.id`) — there is NO caller-supplied user argument, so no
 *    cross-user subscription read exists on this surface. The
 *    active-visibility predicate deliberately does NOT filter here: the
 *    owner sees the real lifecycle state of what they requested (a plan
 *    may deactivate AFTER a pending request exists — hiding it would
 *    orphan the request UI-side).
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7
 * and documented in `query/teachers/applicant.query.ts` and
 * `mutation/plan-catalog.mutation.ts`):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`). The conjunction is therefore made
 *    EXPLICIT with `$all`: anonymous callers hit the `authenticated`
 *    scope's UnauthorizedError throw (extensions.code UNAUTHORIZED / 401 —
 *    explicit throws pass through builder.ts's unauthorizedError mapping
 *    VERBATIM), while authenticated non-members (admins) fail the `role`
 *    scope into the canonical localized ForbiddenError (FORBIDDEN / 403).
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/billing/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (backend/graphql/AGENTS.md); zero business logic, zero repository
 *    imports. The `Subscription` object type is the canonical
 *    `SubscriptionPothosObject`, registered transitively by this import.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { SubscriptionPothosObject } from "@/backend/graphql/pothos/billing/subscription.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SubscriptionService } from "@/backend/services";

/** The storefront's subscriber roles (admins manage the catalog, never subscribe). */
const SUBSCRIBER_ROLES = [UserRole.Student, UserRole.Parent, UserRole.Teacher];

// Side-effect: register the `mySubscriptions` owner-scoped query field.
gqlSchemaBuilder.queryField("mySubscriptions", t =>
  t.field({
    type: [SubscriptionPothosObject],
    // `[Subscription!]!` — non-null list of non-null subscriptions.
    nullable: false,
    // Explicit `$all` conjunction per the 401/403 split documented above.
    authScopes: {
      $all: {
        authenticated: true,
        role: SUBSCRIBER_ROLES,
      },
    },
    resolve: async (_root, _args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message mirrors builder.ts's
      // own `authenticated` scope verbatim and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return SubscriptionService.listMySubscriptions(ctx.user.id, ctx.locale);
    },
  })
);
