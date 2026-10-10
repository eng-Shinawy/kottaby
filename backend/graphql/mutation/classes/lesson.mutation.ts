/**
 * Lessons mutations — `createLesson`, `updateLesson`, `deleteLesson`.
 *
 * Security:
 *  - All lesson management mutations declare the EXPLICIT `$all` conjunction
 *    `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`.
 *    The `$all` key is load-bearing: a plain `{ authenticated, role }` map
 *    combines its keys with ANY semantics, and a bare role map answers
 *    anonymous callers with FORBIDDEN. The conjunction makes the combine
 *    AND — the `authenticated` leg denies anonymous callers with
 *    UNAUTHORIZED (401) before the role leg is ever consulted, and the
 *    role leg denies authenticated non-admins with FORBIDDEN (403).
 *  - `actorId` is sourced EXCLUSIVELY from `ctx.user.id` (never from args —
 *    BOLA-safe by construction) and threaded into the service, which
 *    re-asserts the admin role from the user row (defense in depth) and
 *    appends the audit rows inside its own transaction.
 *  - Resolver bodies are pure delegation to `LessonService` — zero business
 *    logic in the GraphQL layer. Localized errors surface from the service.
 */

import { UserRole } from "@/backend/enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  CreateLessonInput,
  LessonPothosObject,
  UpdateLessonInput,
} from "@/backend/graphql/pothos/classes/lesson.pothos";
import { UnauthorizedError } from "@/backend/lib/errors";
import { LessonService } from "@/backend/services/classes/lesson.service";

// Register `createLesson` mutation field
gqlSchemaBuilder.mutationField("createLesson", t =>
  t.field({
    type: LessonPothosObject,
    description: "Creates a new lesson, optionally tied to a subscription plan (Admin only).",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      input: t.arg({
        type: CreateLessonInput,
        required: true,
        description: "Input fields for the new lesson.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — the `$all` conjunction's `authenticated`
      // leg guarantees a verified user row at resolution time (anonymous
      // callers are denied with UNAUTHORIZED at the scope step). This
      // branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly; the thrown error mirrors the `authenticated`
      // scope's UnauthorizedError family and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return LessonService.createLesson(args.input, ctx.user.id, ctx.locale);
    },
  })
);

// Register `updateLesson` mutation field
gqlSchemaBuilder.mutationField("updateLesson", t =>
  t.field({
    type: LessonPothosObject,
    description: "Updates mutable fields on an existing lesson (Admin only).",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      id: t.arg.id({
        required: true,
        description: "ID of the lesson to update.",
      }),
      input: t.arg({
        type: UpdateLessonInput,
        required: true,
        description: "Updated fields for the lesson.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createLesson` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      const lessonId = LessonService.coerceLessonId(args.id, ctx.locale);
      return LessonService.updateLesson(
        lessonId,
        {
          // Explicit nulls are dropped (not meaningful for the lane — null
          // title/planId are rejected service-side for direct callers); only
          // an absent field is omitted and the service validates the member.
          ...(args.input.planId !== null && args.input.planId !== undefined && { planId: args.input.planId }),
          ...(args.input.title !== null && args.input.title !== undefined && { title: args.input.title }),
        },
        ctx.user.id,
        ctx.locale
      );
    },
  })
);

// Register `deleteLesson` mutation field
gqlSchemaBuilder.mutationField("deleteLesson", t =>
  t.field({
    type: LessonPothosObject,
    description: "Deletes an existing lesson and returns the removed row for cache eviction (Admin only).",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      id: t.arg.id({
        required: true,
        description: "ID of the lesson to delete.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createLesson` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      const lessonId = LessonService.coerceLessonId(args.id, ctx.locale);
      return LessonService.deleteLesson(lessonId, ctx.user.id, ctx.locale);
    },
  })
);
