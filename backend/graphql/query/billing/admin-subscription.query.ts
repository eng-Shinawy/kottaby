/**
 * Admin subscription-lifecycle query — `adminSubscriptions` (DEV1-009).
 *
 *  - `adminSubscriptions(...): AdminSubscriptionConnection!` — every
 *    subscription across ALL statuses (unless the optional `status` filter
 *    narrows the read), newest first, paginated (limit/offset, service-
 *    clamped to 1..100). The page carries its own `total` + the `limit`/
 *    `offset` that shaped it, so the client footer never re-derives state.
 *
 *  - The `status` filter is caller-supplied as a String and narrowed
 *    INSIDE the SERVICE (`SubscriptionService.listAllSubscriptionsForAdmin`
 *    owns the ValidationError — the resolver passes `args.status` through
 *    verbatim; do NOT narrow here). Anything outside the sanctioned
 *    `subscription_status` set rejects with the localized invalid-filter
 *    validation copy BEFORE the read opens.
 *
 *  - Complements (never replaces) `adminPendingSubscriptionRequests`
 *    (DEV1-006 Phase B): that read is the FIFO verification queue over
 *    pending rows only; this one is the bounded, filterable lifecycle view
 *    over every row, exposing the stamped payment columns + dates (admins
 *    audit money).
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7
 * and documented in `query/teachers/applicant.query.ts` and
 * `mutation/plan-catalog.mutation.ts`):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`). The conjunction is therefore made
 *    EXPLICIT with `$all`: anonymous callers hit the `authenticated`
 *    scope's UnauthorizedError throw (extensions.code UNAUTHORIZED / 401),
 *    while authenticated non-admins fail the `role` scope into the
 *    canonical localized ForbiddenError (FORBIDDEN / 403).
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/billing/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer (backend/graphql/AGENTS.md);
 *    zero business logic beyond the argument pass-through below, zero
 *    repository imports.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdminSubscriptionConnectionPothosObject } from "@/backend/graphql/pothos/billing/admin-subscription.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SubscriptionService } from "@/backend/services";

/** The lifecycle list's gate: admins only. */
const ADMIN_ROLE = [UserRole.Admin];

// Side-effect: register the `adminSubscriptions` admin-gated query field.
gqlSchemaBuilder.queryField("adminSubscriptions", t =>
  t.field({
    type: AdminSubscriptionConnectionPothosObject,
    nullable: false,
    args: {
      status: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    // Explicit `$all` conjunction — admins only (same 401/403 split).
    authScopes: {
      $all: {
        authenticated: true,
        role: ADMIN_ROLE,
      },
    },
    resolve: async (_root, args, ctx) => {
      // TS narrowing only — unreachable behind `$all { authenticated: true }`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // The status filter passes through UNNARROWED — the service owns the
      // narrowing + the localized ValidationError (single source of truth).
      // Pagination defaults ride the resolver; clamping lives in the
      // service (1..100 / offset floor 0 — the audit-trail discipline).
      return SubscriptionService.listAllSubscriptionsForAdmin(
        {
          status: args.status ?? undefined,
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
        },
        ctx.locale
      );
    },
  })
);
