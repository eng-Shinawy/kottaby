/**
 * Curriculum-progress query resolver — `studentProgress`.
 *
 * `studentProgress(studentId: Int!): StudentProgress!` — the gated
 * curriculum-position read: the acting caller observes one student's current
 * lesson, completed count, and floor-computed completion percentage on the
 * student's governing tajweed plan.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth —
 * the explicit `$all` conjunction lesson):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (the builder's `defaultStrategy`), so ANY authenticated caller would
 *    pass through the first satisfied scope and wrong-role callers would be
 *    granted access. The conjunction is therefore made EXPLICIT with `$all`:
 *    anonymous callers hit the `authenticated` scope's UnauthorizedError
 *    throw (extensions.code UNAUTHORIZED / 401 — explicit throws pass
 *    through builder.ts's unauthorizedError mapping VERBATIM), while
 *    authenticated parents (and every other non-admin/teacher/student role)
 *    fail the `role` scope into the canonical localized ForbiddenError
 *    (FORBIDDEN / 403) BEFORE the resolver body runs — the scope layer is
 *    the parent's denial, and it never reaches the service or the database.
 *
 * The resolver is THIN DELEGATION:
 *  - Identity comes EXCLUSIVELY from the verified context (`ctx.user.id`,
 *    converted through the context factory's `toUserRole` into `ctx.role` —
 *    never the raw `user_role` string on the user row); the `studentId`
 *    argument is a resource selector only, never an identity claim.
 *  - The service owns the remaining authorization (student self-only /
 *    teacher shared-session pair count / admin bypass), the id validation,
 *    and the payload composition (locale-localized errors via the
 *    propagated `ctx.locale`).
 *  - Zero repository calls; top-level static imports ONLY (no
 *    `await import(`).
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through the side-effect barrels:
 *    `query/classes/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - `UserRole` is a VALUE import (scope decision input, never a type-only
 *    reference); the payload type is the canonical `StudentProgressReturnType`
 *    the Pothos object mirrors.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { StudentProgressPothosObject } from "@/backend/graphql/pothos/classes/student-progress.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { StudentProgressService } from "@/backend/services/classes/student-progress.service";

// Register `studentProgress` query field
gqlSchemaBuilder.queryField("studentProgress", t =>
  t.field({
    type: StudentProgressPothosObject,
    description:
      "Returns one student's curriculum position (current lesson + completion percentage) on their governing tajweed plan, for the student themselves, teachers sharing a session with them, and admins.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin, UserRole.Teacher, UserRole.Student],
      },
    },
    args: {
      studentId: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      // The `$all { authenticated: true }` leg guarantees a verified user row
      // at resolution time (anonymous callers never get past the scope step).
      // This branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable context
      // directly. Unreachable in practice; per the resolver-i18n rule the
      // message flows through ctx.t (its en copy is identical to builder.ts's
      // `authenticated` scope literal).
      if (!ctx.user || !ctx.role) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      return StudentProgressService.getStudentProgress(ctx.user.id, ctx.role, args.studentId, ctx.locale);
    },
  })
);
