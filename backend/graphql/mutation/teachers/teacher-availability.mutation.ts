/**
 * `setTeacherAvailability` mutation — the teacher's manual availability
 * toggle: write the `isOnline` flag (true = Available, false = Unavailable)
 * and return the closed three-field projection.
 *
 * Contract:
 *  - `setTeacherAvailability(isOnline: Boolean!): TeacherAvailabilityState!`
 *      Teacher-only (`$all` scope conjunction). The acting teacher is
 *      resolved SERVER-side from `ctx.user.id` — never client-supplied
 *      (BOLA); the ONLY client-owned value is the boolean (BOPLA: no
 *      input type is needed for a single scalar argument — no object
 *      spread into the service call, no echo of client input back onto
 *      the wire). Every business rule (the positive-safe-integer id
 *      re-assertion, the strict-boolean flag guard, the certification gate
 *      on the Available direction, the in-session gate on the Available
 *      direction, the same-value idempotency) lives in
 *      `TeacherAvailabilityService`.
 *
 * authScopes 401/403 split (mirrors `session-report.mutation.ts`, verified against @pothos/plugin-scope-auth@4.1.7):
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`), so ANY authenticated caller would pass.
 *  - The conjunction is therefore made EXPLICIT with `$all`: anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (extensions.code UNAUTHORIZED / 401 — explicit throws pass through
 *    builder.ts's unauthorizedError mapping VERBATIM), while authenticated
 *    non-teachers fail the `role` scope into the canonical localized
 *    ForbiddenError (FORBIDDEN / 403).
 *
 * Resolvers are THIN DELEGATION ONLY (`backend/graphql/mutation/AGENTS.md`
 * + `backend/graphql/AGENTS.md`): no business logic, no repository calls,
 * no try/catch — DomainErrors from `TeacherAvailabilityService` propagate
 * uncaught to the masking boundary with their `extensions.code` untouched
 * (`VALIDATION`/422, `TEACHER_NOT_FOUND`/404, `FORBIDDEN`/403,
 * `TEACHER_IN_ACTIVE_SESSION`/409); all localized messaging happens inside
 * the service via `ctx.locale` propagation — this file carries NO
 * resolver-local error copy and NO business branching.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - This file has NO named exports — it registers the root field at
 *    import time via `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/teachers/index.ts` →
 *    `mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { TeacherAvailabilityStatePothosObject } from "@/backend/graphql/pothos/teachers/teacher-availability.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { TeacherAvailabilityService } from "@/backend/services";

// Side-effect: register the `setTeacherAvailability` mutation field.
gqlSchemaBuilder.mutationField("setTeacherAvailability", t =>
  t.field({
    type: TeacherAvailabilityStatePothosObject,
    args: {
      // The ONLY client-owned value (BOPLA): a strict non-nullable Boolean.
      // No input type is needed for one scalar; identity is server-derived.
      isOnline: t.arg.boolean({ required: true }),
    },
    // Explicit `$all` conjunction per the 401/403 split documented above:
    // anonymous callers hit UNAUTHORIZED (401), authenticated non-teachers
    // fail the `role` leg into the canonical localized FORBIDDEN (403).
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
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
      // BOPLA hand-off — `args.isOnline` is the ONLY client-owned value
      // and is passed as a bare boolean (no spread, no object echo); the
      // rater identity stays server-bound (`ctx.user.id`) and every
      // stored column is derived by the service. The service owns every
      // validation rule and gate; nothing is re-checked here.
      return TeacherAvailabilityService.setAvailability(ctx.user.id, args.isOnline, ctx.locale);
    },
  })
);
