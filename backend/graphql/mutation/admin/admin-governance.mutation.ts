/**
 * Admin governance mutations — `adminSetUserSuspended` / `adminSetUserBlocked`
 * / `adminExtendApplicantCooldown` / `adminOverrideApplicantEvaluation`.
 *
 * Contract (REQ-060 SDL):
 *  - `adminSetUserSuspended(id: Int!, suspended: Boolean!, periodDays: Int): AdminUserDetail!`
 *  - `adminSetUserBlocked(id: Int!, blocked: Boolean!): AdminUserDetail!`
 *
 * `adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!):
 * ApplicantProfile!` — the applicant-lifecycle cooldown extension. The actor
 * identity for the audit trail is the session user id (never a client-supplied
 * arg — there is no such argument on the field); the bounds / terminal-status
 * / audit-row rules live in
 * `ApplicantLifecycleService.extendApplicantCooldown`, whose `DomainError`
 * subclasses propagate uncaught to the masking boundary (no try/catch here).
 * The resolver returns the refreshed applicant profile directly.
 *
 * `adminOverrideApplicantEvaluation(applicantId: Int!, action:
 * AdminApplicantOverrideAction!, cooldownDays: Int): ApplicantProfile!` —
 * the admin override of an applicant's automated evaluation result (certify
 * / reject / grant_re_evaluation — docs/planning/TICKETS.md "Admin Override
 * of Evaluation Results"). Same session-sourced-actor discipline: the audit
 * actor is `ctx.user.id` (no caller-supplied actor argument exists).
 * `cooldownDays` follows the `adminSetUserSuspended` `periodDays` precedent:
 * an OPTIONAL `Int` arg validated ONLY on the reject direction (1..3650
 * whole days) and IGNORED on certify / grant_re_evaluation. All per-direction
 * rules (terminal-status guards, teacher-row insert-or-elevate / demote,
 * cooldown stamping / clearance, the single `action_type='override'` audit
 * row) live in `ApplicantLifecycleService.overrideApplicantEvaluation`, whose
 * `DomainError` subclasses propagate uncaught to the masking boundary.
 *
 * authScopes (D10 — `$all` conjunction, MANDATORY):
 *  - `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN`
 *    (403) — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit.
 *
 * Resolver discipline (thin resolvers):
 *  - ID arg → positive-safe-integer guard (no `as number`).
 *  - `actorId` sourced EXCLUSIVELY from `ctx.user.id` (never from args —
 *    BOLA-safe by construction).
 *  - `periodDays` is an OPTIONAL GraphQL arg (`Int`, not `Int!`); the
 *    resolver null-coalesces absent → `null` before delegating to the
 *    service. The service validates `periodDays ∈ 1..3650` on the
 *    suspend direction and IGNORES it on the unsuspend direction.
 *  - Scalar args only — smuggled / undeclared fields die as
 *    `GRAPHQL_VALIDATION_FAILED` at the Pothos schema layer before the
 *    resolver ever runs.
 *  - Resolvers throw NOTHING directly except the `ctx.user` narrow guard;
 *    service `DomainError` subclasses propagate with `extensions.code`
 *    and boundary masking through the GraphQL finalizer.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — root fields register at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/admin/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdminUserDetailPothosObject } from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { AdminApplicantOverrideActionPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { ApplicantProfilePothosObject } from "@/backend/graphql/pothos/teachers/applicant.pothos";
import { requireAdminUser, requirePositiveIntId } from "@/backend/graphql/shared";
import { UnauthorizedError } from "@/backend/lib/errors";
import { AdminUserManagementService, ApplicantLifecycleService } from "@/backend/services";

// Side-effect: register the `adminSetUserSuspended` mutation field.
gqlSchemaBuilder.mutationField("adminSetUserSuspended", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
      suspended: t.arg({ type: "Boolean", required: true }),
      periodDays: t.arg({ type: "Int", required: false }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      return AdminUserManagementService.setUserSuspended(
        requirePositiveIntId(args.id, "id"),
        args.suspended,
        args.periodDays ?? null,
        ctx.user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminSetUserBlocked` mutation field.
gqlSchemaBuilder.mutationField("adminSetUserBlocked", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      id: t.arg({ type: "Int", required: true }),
      blocked: t.arg({ type: "Boolean", required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      return AdminUserManagementService.setUserBlocked(
        requirePositiveIntId(args.id, "id"),
        args.blocked,
        ctx.user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminExtendApplicantCooldown` mutation field.
// The `$all` conjunction is INLINED (same shape as `adminOnlyAuthScopes`)
// so the audit census drift lock can read the gate statically — the
// census-drift scanner classifies a mutation chunk's `authScopes` literal
// and records an unresolvable gate in its skip ledger, which must stay
// empty. Same discipline as the sibling `adminStopBroadcast` registration.
gqlSchemaBuilder.mutationField("adminExtendApplicantCooldown", t =>
  t.field({
    type: ApplicantProfilePothosObject,
    args: {
      applicantId: t.arg({ type: "Int", required: true }),
      additionalDays: t.arg({ type: "Int", required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      return ApplicantLifecycleService.extendApplicantCooldown(
        requirePositiveIntId(args.applicantId, "applicantId"),
        args.additionalDays,
        user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminOverrideApplicantEvaluation` mutation
// field. The `$all` conjunction is INLINED (same shape as `adminOnlyAuthScopes`)
// so the audit census drift lock can read the gate statically — same
// discipline as the sibling `adminExtendApplicantCooldown` registration.
// `cooldownDays` is the `adminSetUserSuspended`-period precedent: validated
// on the reject direction ONLY, IGNORED on certify / grant_re_evaluation.
gqlSchemaBuilder.mutationField("adminOverrideApplicantEvaluation", t =>
  t.field({
    type: ApplicantProfilePothosObject,
    args: {
      applicantId: t.arg({ type: "Int", required: true }),
      action: t.arg({ type: AdminApplicantOverrideActionPothosEnum, required: true }),
      cooldownDays: t.arg({ type: "Int", required: false }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      return ApplicantLifecycleService.overrideApplicantEvaluation(
        requirePositiveIntId(args.applicantId, "applicantId"),
        args.action,
        args.cooldownDays ?? null,
        user.id,
        ctx.locale
      );
    },
  })
);
