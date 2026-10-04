/**
 * TeacherAvailabilityStatePothosObject — the single canonical GraphQL object
 * type for the teacher availability-toggle projection.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical
 *    {@link TeacherAvailabilityReturnType} from `@/backend/types` — no local
 *    type definitions here. The service
 *    (`TeacherAvailabilityService.getAvailability` /
 *    `setAvailability`) is the only producer of that closed three-field
 *    shape (BOPLA: read-only, no governance fields, no client-writable
 *    surface).
 *  - Exactly three fields, mapped structurally:
 *      id         → exposed Int (non-nullable; Apollo cache normalization
 *                   requires `id` on every entity-shaped object)
 *      isOnline   → exposed Boolean (non-nullable; the toggle flag, coerced
 *                   to a total boolean at the service boundary — a stored
 *                   `null` reads as `false`)
 *      isApproved → exposed Boolean (non-nullable; the certification flag,
 *                   coerced to a total boolean at the service boundary — a
 *                   stored `null` reads as `false` = "not certified")
 *  - NO inline business logic — every field is a structural passthrough;
 *    the nullable→total coercion and the gate order live in the service.
 *
 * Consumed by the zero-argument role-gated `myTeacherAvailability` query
 * and the single-arg role-gated `setTeacherAvailability` mutation, whose
 * imports of this module transitively register the type through the
 * `gqlSchema.ts` side-effect chain.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { TeacherAvailabilityReturnType } from "@/backend/types";

export const TeacherAvailabilityStatePothosObject = gqlSchemaBuilder
  .objectRef<TeacherAvailabilityReturnType>("TeacherAvailabilityState")
  .implement({
    fields: t => ({
      // Int ID (= users.id) — Apollo cache normalization requires `id`
      // on every entity-shaped object.
      id: t.exposeInt("id"),
      // The toggle flag — total boolean at this boundary (nullable column
      // coerced to `false` for a stored `null` by the service).
      isOnline: t.exposeBoolean("isOnline"),
      // The certification flag — total boolean at this boundary; the
      // client-side "Available" CTA pre-empts on `false`, the service
      // re-verifies and denies a toggle-to-Available with FORBIDDEN.
      isApproved: t.exposeBoolean("isApproved"),
    }),
  });
