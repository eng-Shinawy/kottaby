/**
 * Plan catalog mutations — `createPlan`, `updatePlan`, `setPlanActiveStatus`.
 *
 * Contract (REQ-020/REQ-030/REQ-031/REQ-050/REQ-060):
 *  - ADMIN-ONLY. Every field carries the EXPLICIT `$all` conjunction
 *    `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`.
 *    A plain scope map is WRONG in this engine: Pothos combines the keys of
 *    ONE scope map with ANY semantics under the default `any` strategy, so
 *    `{ authenticated: true, role: [UserRole.Admin] }` would admit any
 *    authenticated caller (a student passing `authenticated` suffices). The
 *    `$all` conjunction makes anonymous callers hit the `authenticated`
 *    scope's UnauthorizedError throw (extensions.code UNAUTHORIZED / 401,
 *    passed through VERBATIM by builder.ts's `unauthorizedError` mapping)
 *    while authenticated non-admins fail the `role` scope into the canonical
 *    localized ForbiddenError (FORBIDDEN / 403). Pattern precedent:
 *    backend/graphql/query/teachers/applicant.query.ts.
 *  - NO `deletePlan` / `removePlan` field exists BY CONSTRUCTION (INV-PC3):
 *    the catalog domain exposes no delete surface — this file registers
 *    exactly the three fields below and nothing else.
 *  - Thin resolvers: the `if (!ctx.user)` guard exists purely for TypeScript
 *    narrowing (the repo-wide no-non-null-assertion rule) — `$all {
 *    authenticated: true }` already guarantees a verified user row; the
 *    thrown message mirrors builder.ts's own `authenticated` scope verbatim
 *    and is unreachable in practice. Resolvers delegate straight to
 *    `PlanCatalogService` with locale propagation — zero business logic,
 *    zero repository imports, no try/catch (DomainErrors propagate uncaught
 *    to the masking boundary; `docs/graphql/domain-error-extensions-code.md`).
 *  - `Plan!` non-null return backed by the canonical `PlanPothosObject`.
 *    Every service method ends in a single INSERT/UPDATE ... RETURNING * so
 *    the FULL persisted row rides back for Apollo cache convergence.
 *  - `id` arguments ride the GraphQL `ID` scalar and arrive as strings; the
 *    resolvers convert with `Number(args.id)` and hand the service a number
 *    (the service rejects non-positive-integers with the localized
 *    plan-not-found validation error).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.mutationField(...)`; wired through the side-effect
 *    barrel `backend/graphql/mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { CreatePlanInput, UpdatePlanInput } from "@/backend/graphql/pothos/billing/plan-inputs.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { PlanCatalogService } from "@/backend/services";

// Side-effect: register the admin `createPlan` mutation field.
gqlSchemaBuilder.mutationField("createPlan", t =>
  t.field({
    type: PlanPothosObject,
    args: {
      input: t.arg({ type: CreatePlanInput, required: true }),
    },
    // Explicit `$all` conjunction — see the file header for the ANY-vs-ALL
    // engine semantics (a plain scope map would admit authenticated students).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TS narrowing only — unreachable behind `$all { authenticated: true }`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // Explicit field-by-field mapping (BOPLA boundary): only the five
      // caller-editable fields cross into the service; the input type makes
      // lifecycle fields unrepresentable on the wire in the first place.
      return PlanCatalogService.createPlan(
        {
          title: args.input.title,
          sessionCount: args.input.sessionCount,
          price: args.input.price,
          currency: args.input.currency,
          intervalDays: args.input.intervalDays,
        },
        ctx.locale,
        // DEV3-020: the acting admin rides into the service so the audit
        // row commits INSIDE the mutation's transaction (fail-closed).
        ctx.user.id
      );
    },
  })
);

// Side-effect: register the admin `updatePlan` mutation field.
gqlSchemaBuilder.mutationField("updatePlan", t =>
  t.field({
    type: PlanPothosObject,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdatePlanInput, required: true }),
    },
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
      // Partial-patch builder: only DEFINED fields enter the service patch —
      // an empty input stays an empty patch (the service owns the
      // planPatchEmpty reject). v3-defaults optional input fields arrive as
      // `T | null | undefined`; an explicit null is normalized to
      // "not supplied" (mirrors the `?? undefined` idiom in
      // auth.mutation.ts's registerUser) so the service's partial-patch
      // contract (`PlanUpdateInput` — undefined-only optionality) holds and
      // no key can ever be forged as undefined.
      const { input } = args;
      const patch = {
        ...(input.title !== undefined && input.title !== null ? { title: input.title } : {}),
        ...(input.sessionCount !== undefined && input.sessionCount !== null
          ? { sessionCount: input.sessionCount }
          : {}),
        ...(input.price !== undefined && input.price !== null ? { price: input.price } : {}),
        ...(input.currency !== undefined && input.currency !== null ? { currency: input.currency } : {}),
        ...(input.intervalDays !== undefined && input.intervalDays !== null
          ? { intervalDays: input.intervalDays }
          : {}),
      };
      // `ID` arrives as a string — the service validates positive-integer
      // semantics and rejects anything else with the localized not-found
      // validation error.
      return PlanCatalogService.updatePlan(Number(args.id), patch, ctx.locale, ctx.user.id);
    },
  })
);

// Side-effect: register the admin `setPlanActiveStatus` mutation field.
gqlSchemaBuilder.mutationField("setPlanActiveStatus", t =>
  t.field({
    type: PlanPothosObject,
    args: {
      id: t.arg.id({ required: true }),
      isActive: t.arg.boolean({ required: true }),
    },
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
      // The ONLY lifecycle state-transition surface — idempotency conflicts
      // (PLAN_ALREADY_ACTIVE / PLAN_ALREADY_INACTIVE) are service-owned.
      // DEV3-020: the acting admin rides into the service so the audit row
      // commits INSIDE the mutation's transaction (fail-closed).
      return PlanCatalogService.setPlanActiveStatus(Number(args.id), args.isActive, ctx.locale, ctx.user.id);
    },
  })
);
