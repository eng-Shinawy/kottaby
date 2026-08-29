/**
 * Plan catalog queries — the two read-only catalog surfaces of DEV1-005:
 *
 *  - `planCatalog: [Plan!]!` — the consumer surface. Every authenticated
 *    caller (any role) browses the ACTIVE slice of the subscription catalog
 *    through `PlanCatalogService.listActiveCatalog`. Visibility (active-only)
 *    is owned by the service/repository predicate, NOT by this resolver.
 *  - `adminPlans(includeInactive: Boolean = true): [Plan!]!` — the staff
 *    surface, gated to `UserRole.Admin`. Delegates to
 *    `PlanCatalogService.listForAdmin` which returns every row when
 *    `includeInactive` is set, otherwise the same active-only slice
 *    consumers see.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7
 * and documented in `query/teachers/applicant.query.ts`):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`), so any authenticated caller would pass the
 *    first satisfied scope and the role gate would never bite.
 *  - The conjunction is therefore made EXPLICIT with `$all`: anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 — explicit throws pass through
 *    builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 *    non-admins fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403). Behavior pinned end-to-end in
 *    frontend/graphql/test/billing/plan-catalog.queries.test.ts.
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/billing/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (backend/graphql/AGENTS.md); zero business logic, zero repository
 *    imports. The `Plan` object type is the canonical
 *    `PlanPothosObject` (REQ-060), registered transitively by this import.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { PlanCatalogService } from "@/backend/services";

// Side-effect: register the `planCatalog` consumer query field.
gqlSchemaBuilder.queryField("planCatalog", t =>
  t.field({
    type: [PlanPothosObject],
    // `[Plan!]!` — non-null list of non-null plans (REQ-016).
    nullable: false,
    // Explicit `$all` conjunction: authenticated callers of ANY role.
    authScopes: {
      $all: {
        authenticated: true,
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
      return PlanCatalogService.listActiveCatalog(ctx.locale);
    },
  })
);

// Side-effect: register the `adminPlans` staff query field.
gqlSchemaBuilder.queryField("adminPlans", t =>
  t.field({
    type: [PlanPothosObject],
    // `[Plan!]!` — non-null list of non-null plans (REQ-030).
    nullable: false,
    args: {
      includeInactive: t.arg.boolean({ required: false, defaultValue: true }),
    },
    // Explicit `$all` conjunction per the 401/403 split documented above.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // Nullable-hardened handling: the SDL default fills omitted arguments
      // at execution, but the resolver never trusts that alone — an explicit
      // `?? true` keeps the admin view total even if the arg arrives
      // null/undefined from a caller that passes an explicit null.
      return PlanCatalogService.listForAdmin(args.includeInactive ?? true, ctx.locale);
    },
  })
);
