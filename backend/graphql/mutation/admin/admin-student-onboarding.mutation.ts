/**
 * Admin direct-student-onboarding mutation —
 * `adminOnboardStudentWithOfflinePayment`.
 *
 * Contract:
 *  - `adminOnboardStudentWithOfflinePayment(input: AdminOnboardStudentOfflineInput!): AdminOnboardStudentResult!`
 *
 * One gated call creates the student account (users + students rows, hashed
 * initial credential, unique handshake code) and activates the chosen plan
 * as an `active` subscription carrying the admin-recorded offline payment
 * evidence — atomically, inside ONE service-side transaction that also
 * credits the plan's lane and mints the student↔subscription junction row.
 * Exactly two audit rows are committed per onboarding (a `user` Create row
 * for the fresh student and a `subscription` Create row for the activated
 * period), both attributed to the acting admin.
 *
 * authScopes (`$all` conjunction, MANDATORY):
 *  - `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN`
 *    (403) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit.
 *
 * Resolver discipline (thin resolvers):
 *  - Service call with `(…, ctx.user.id, ctx.locale)` — the actor id comes
 *    ONLY from the verified context identity, never from client input.
 *  - The input is mapped field-by-field onto the service whitelist — NEVER
 *    a `{ ...input }` spread, so transport-tampered extras cannot travel.
 *  - The service re-asserts the admin gate (defense in depth) and owns all
 *    validation; resolvers throw nothing beyond the context-narrowing guard
 *    and `DomainError` subclasses propagate with `extensions.code` through
 *    boundary masking.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/admin/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdminOnboardStudentOfflineInput, AdminOnboardStudentResultPothosObject } from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { StudentOnboardingService } from "@/backend/services/admin";

/**
 * Context-narrowing guard for this admin-only root field: resolves the
 * verified context identity to the actor id and refuses anonymous contexts
 * with the canonical boundary error. Non-admin roles are rejected earlier by
 * `authScopes`; this guard keeps the resolver body independent of the scope
 * layer's guarantees (defense in depth).
 */
function requireContextActorId(user: { readonly id: number } | null): number {
  if (!user) {
    throw new UnauthorizedError("Authentication required.");
  }
  return user.id;
}

// Side-effect: register the `adminOnboardStudentWithOfflinePayment` mutation field.
gqlSchemaBuilder.mutationField("adminOnboardStudentWithOfflinePayment", t =>
  t.field({
    type: AdminOnboardStudentResultPothosObject,
    args: {
      input: t.arg({ type: AdminOnboardStudentOfflineInput, required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const actorId = requireContextActorId(ctx.user);
      const { input } = args;
      return StudentOnboardingService.onboardStudentWithOfflinePayment(
        {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          password: input.password,
          gender: input.gender ?? undefined,
          country: input.country,
          parentId: input.parentId ?? undefined,
          planId: input.planId,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
        },
        actorId,
        ctx.locale
      );
    },
  })
);
