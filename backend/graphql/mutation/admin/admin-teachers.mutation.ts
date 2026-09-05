/**
 * Admin teacher mutations — `adminCertifyTeacherColdStart`.
 *
 * Contract (SDL):
 *  - `adminCertifyTeacherColdStart(userId: Int!, makeEvaluator: Boolean = true): AdminUserDetail!`
 *
 * authScopes (the `$all` conjunction is MANDATORY):
 *  - `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`
 *  - Anonymous → `UNAUTHORIZED`; authenticated non-admin → `FORBIDDEN`
 *    — both BEFORE the resolver body runs.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG: Pothos
 *    combines scope keys with ANY semantics unless `$all` makes the
 *    conjunction explicit. See `docs/teachers/applicant-lifecycle.md` §3
 *    for the verified pattern.
 *
 * Resolver discipline (thin resolvers):
 *  - Guard + delegate: the `!ctx.user` narrowing guard, then a
 *    field-by-field call into the service layer (NO spread of args).
 *  - Resolvers throw NOTHING directly beyond the guard: service
 *    `DomainError` subclasses propagate with `extensions.code` and
 *    boundary masking (NO try/catch here).
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
import { UnauthorizedError } from "@/backend/lib/errors";
import { ColdStartCertificationService } from "@/backend/services";

// Side-effect: register the `adminCertifyTeacherColdStart` mutation field.
gqlSchemaBuilder.mutationField("adminCertifyTeacherColdStart", t =>
  t.field({
    type: AdminUserDetailPothosObject,
    args: {
      userId: t.arg({ type: "Int", required: true }),
      makeEvaluator: t.arg({ type: "Boolean", required: false, defaultValue: true }),
    },
    description:
      "Admin-only cold-start certification (INV-TV1(b) / FR-3.9): promotes an existing teacher-role user to a certified founding Sheikh — inserts or elevates the teacher row (is_approved=true, is_evaluator per flag), finalizes any applicants row (passed, cooldown cleared), appends one override audit row, and notifies the teacher. Repeat calls answer TEACHER_ALREADY_CERTIFIED.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      // The `$all.authenticated` scope guarantees a verified user row at
      // resolution time (anonymous callers never get past the scope step).
      // This branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly. Unreachable in practice; per the resolver-i18n
      // rule the message flows through ctx.t.
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return ColdStartCertificationService.certifyTeacherColdStart(
        ctx.user.id,
        { userId: args.userId, makeEvaluator: args.makeEvaluator ?? true },
        ctx.locale
      );
    },
  })
);
