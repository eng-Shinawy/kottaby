/**
 * `myTeacherAvailability` query — the caller's own availability-toggle
 * projection.
 *
 * Contract:
 *  - ZERO arguments — identity is derived EXCLUSIVELY from the verified
 *    context (`ctx.user.id`). There is no caller-supplied lookup
 *    surface of any kind: BOLA probes that attempt to address a foreign id
 *    die as GraphQL validation failures before a resolver ever runs.
 *  - `TeacherAvailabilityState!` (non-nullable) — the closed three-field
 *    projection (`id`, `isOnline`, `isApproved`) produced by
 *    `TeacherAvailabilityService.getAvailability`. A missing teacher row
 *    surfaces the localized `NotFoundError` (`TEACHER_NOT_FOUND`, HTTP
 *    404); a garbage id dies pre-DB as the localized `ValidationError`
 *    (`VALIDATION`, HTTP 422). The read path emits zero logs on the happy
 *    branch.
 *  - DomainErrors thrown deeper propagate uncaught to the masking
 *    boundary (no try/catch here by contract) — `extensions.code`
 *    survives untouched: `VALIDATION`/422, `TEACHER_NOT_FOUND`/404.
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"` default), so ANY authenticated caller would
 *    pass through the first satisfied scope and non-teachers would be
 *    granted access.
 *  - The conjunction is therefore made EXPLICIT with `$all`: anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 — explicit throws pass through
 *    builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 *    non-teachers fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403).
 *
 * Per backend/graphql/query/AGENTS.md:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/teachers/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (backend/graphql/AGENTS.md); no business logic inline.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { TeacherAvailabilityStatePothosObject } from "@/backend/graphql/pothos/teachers/teacher-availability.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { TeacherAvailabilityService } from "@/backend/services";

// Side-effect: register the `myTeacherAvailability` query field.
gqlSchemaBuilder.queryField("myTeacherAvailability", t =>
  t.field({
    type: TeacherAvailabilityStatePothosObject,
    // Explicit `$all` conjunction per the 401/403 split documented above.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, _args, ctx) => {
      // The `$all { authenticated: true }` scope guarantees a verified user
      // row at resolution time (anonymous callers never get past the scope
      // step). This branch exists purely for TypeScript narrowing — the
      // repo-wide no-non-null-assertion rule forbids dereferencing the
      // nullable context directly; the thrown message resolves through
      // the request locale per the resolver localization contract and is
      // unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      // Identity is server-derived (BOLA — no id argument of any kind);
      // the locale propagates so every localized denial copy resolves
      // through the service's translation seam.
      return TeacherAvailabilityService.getAvailability(ctx.user.id, ctx.locale);
    },
  })
);
