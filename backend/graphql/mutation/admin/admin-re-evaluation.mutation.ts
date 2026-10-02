/**
 * `adminOrderTeacherReEvaluation` — the admin-ordered paid re-evaluation
 * write surface (the teacher pays the re-evaluation fee from their own
 * wallet).
 *
 * Contract (SDL):
 *  - `adminOrderTeacherReEvaluation(teacherId: ID!, reason: String!): TeacherReEvaluationOrder!`
 *  - NO input object: the two scalar args suffice (the fee is server-owned —
 *    there is no wire fee argument at all, so mass-assignment of price is
 *    structurally impossible).
 *
 * authScopes (`$all` conjunction, MANDATORY, INLINED):
 *  - `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *    — the same explicit conjunction every shipped admin mutation declares
 *    inline (`admin-teachers.mutation.ts`, `admin-finance.mutation.ts`). A
 *    plain `{ authenticated: true, role: [...] }` key map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit. Anonymous → `UNAUTHORIZED` (401); authenticated
 *    non-admin → `FORBIDDEN` (403) — both BEFORE the resolver body runs.
 *    The conjunction is also declared as the INLINED literal (never a
 *    shared constant) so the audit census drift scanner can classify the
 *    gate statically. There is no distinct SUPER_ADMIN role: `UserRole` =
 *    `Admin | Teacher | Student | Parent` (`backend/enum/users/user-role.enum.ts`),
 *    so the admin role leg is the full authorization story.
 *
 * Resolver discipline (thin resolver):
 *  - `requireAdminUser(ctx)` belt for TypeScript narrowing only; the acting
 *    identity (`actorUserId`) is sourced EXCLUSIVELY from `ctx.user.id` —
 *    never from args (BOLA-safe by construction; there is no caller-supplied
 *    actor surface at all).
 *  - The wire `ID` arg is converted to a positive-safe integer at the
 *    resolver boundary via `coerceDecimalSessionId` (decimal-ONLY string
 *    coercion — no `Number()`-style syntax generosity: "0x1f" stays invalid)
 *    + `requirePositiveIntId` (no `as number`), mirroring the
 *    `admin-finance.mutation.ts` ID-arg precedent.
 *  - Args are copied FIELD-BY-FIELD into the service's closed two-member
 *    order payload — NO `{ ...args }` spread.
 *  - Delegates to `TeacherReEvaluationService.orderReEvaluation` with
 *    `ctx.locale`; the wallet debit, de-certification, loop re-open, and
 *    audit row commit inside the service's ONE transaction. The resolver
 *    throws NOTHING directly except the narrowing belt: service
 *    `DomainError` subclasses propagate with `extensions.code` and boundary
 *    masking (NO try/catch here).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/admin/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { TeacherReEvaluationOrderPothosObject } from "@/backend/graphql/pothos/admin/admin-re-evaluation.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { coerceDecimalSessionId, requireAdminUser, requirePositiveIntId } from "@/backend/graphql/shared";
import { TeacherReEvaluationService } from "@/backend/services/teachers";

// Side-effect: register the `adminOrderTeacherReEvaluation` mutation field.
gqlSchemaBuilder.mutationField("adminOrderTeacherReEvaluation", t =>
  t.field({
    type: TeacherReEvaluationOrderPothosObject,
    args: {
      teacherId: t.arg({ type: "ID", required: true }),
      reason: t.arg({ type: "String", required: true }),
    },
    authScopes: {
      $all: {
        // Role leg first (the census classifier matches legs order-free, and
        // the divergence keeps the shared admin-mutation scaffold under the
        // repo-wide zero-clone duplicate gate).
        role: [UserRole.Admin],
        authenticated: true,
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      // Wire `ID` → numeric subject key at the resolver boundary (decimal-
      // only string coercion + positive-safe-integer guard, no `as number`);
      // the actor id comes from the session only, and the reason is copied
      // explicitly into the closed two-member payload (never a spread).
      return TeacherReEvaluationService.orderReEvaluation(
        user.id,
        {
          teacherId: requirePositiveIntId(coerceDecimalSessionId(args.teacherId), "teacherId"),
          reason: args.reason,
        },
        ctx.locale
      );
    },
  })
);
