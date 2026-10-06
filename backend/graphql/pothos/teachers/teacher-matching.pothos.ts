/**
 * TeacherMatching objects — the student-facing browse-read projections.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical return types from `@/backend/types`
 *    (`TeacherMatchingItemReturnType`, `TeacherMatchingPageReturnType`) — no
 *    local type definitions here. `TeacherMatchingService.browseAvailableTeachers`
 *    is the only producer of those closed shapes (BOPLA: PII-minimal cards —
 *    no email, phone, credential, or timestamp fields ever enter the
 *    projection).
 *
 * `TeacherMatchingItem` — one eligible teacher card. Exactly the nine
 * canonical fields, mapped structurally:
 *      id            → Int! (the shared users/teacher PK; Apollo cache
 *                      normalization requires `id` on every entity-shaped
 *                      object — declared FIRST per the shape-pin convention)
 *      fullName      → String! (display name only)
 *      country       → String (nullable — a profile may not record one)
 *      countryCode   → String (nullable — same)
 *      subjects      → [String!]! (parsed fail-closed; a corrupt payload
 *                      degrades to [])
 *      recitations   → [RecitationReading!]! (parsed catalog tokens)
 *      languages     → [String!]! (parsed fluency tokens)
 *      averageRating → Float (nullable — an unrated teacher stays null,
 *                      never a fabricated zero)
 *      isOnline      → Boolean! (total boolean at the service boundary —
 *                      a stored null reads false)
 *
 * `TeacherMatchingPage` — the paginated browse envelope. Id-less value
 * object (the frontend registers it with `keyFields: false`):
 *      items     → [TeacherMatchingItem!]!
 *      total     → Int! (honest, unfiltered-by-page count)
 *      page      → Int! (resolved page)
 *      pageSize  → Int! (resolved page size)
 *      pageCount → Int! (`Math.ceil(total / pageSize)`; 0 for an empty set)
 *
 * NO inline business logic — every field is a structural passthrough; the
 * eligibility gates, the compose rule (`is_online = true` AND no active
 * `started` session), the token escaping, and the nullable→total coercions
 * live in the service + repository layers.
 *
 * Consumed by the role-gated `browseAvailableTeachers` query, whose import
 * of this module transitively registers the types through the `gqlSchema.ts`
 * side-effect chain.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { RecitationReadingPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { TeacherMatchingItemReturnType, TeacherMatchingPageReturnType } from "@/backend/types";

const TeacherMatchingItemPothosObject = gqlSchemaBuilder
  .objectRef<TeacherMatchingItemReturnType>("TeacherMatchingItem")
  .implement({
    fields: t => ({
      // Int ID (= users.id) — Apollo cache normalization requires `id`
      // on every entity-shaped object; declared FIRST per the shape pin.
      id: t.exposeInt("id"),
      // Display name only — no email, phone, or credential fields exist
      // on the canonical projection.
      fullName: t.exposeString("fullName"),
      // Optional profile geography (the soft ordering tier is server-side).
      country: t.exposeString("country", { nullable: true }),
      countryCode: t.exposeString("countryCode", { nullable: true }),
      // Parsed fail-closed subject tokens — spread into a fresh mutable
      // array because the canonical projection is readonly.
      subjects: t.field({
        type: ["String"],
        resolve: parent => [...parent.subjects],
      }),
      // Parsed Qira'ah certification tokens in the canonical enum vocabulary.
      recitations: t.field({
        type: [RecitationReadingPothosEnum],
        resolve: parent => [...parent.recitations],
      }),
      // Parsed fluency tokens.
      languages: t.field({
        type: ["String"],
        resolve: parent => [...parent.languages],
      }),
      // Parsed float or null — an unrated teacher is honest-null, never a
      // fabricated zero.
      averageRating: t.exposeFloat("averageRating", { nullable: true }),
      // Total boolean at this boundary (a stored null reads false).
      isOnline: t.exposeBoolean("isOnline"),
    }),
  });

export const TeacherMatchingPagePothosObject = gqlSchemaBuilder
  .objectRef<TeacherMatchingPageReturnType>("TeacherMatchingPage")
  .implement({
    fields: t => ({
      // The projected card page — spread into a fresh array because the
      // canonical envelope is readonly.
      items: t.field({
        type: [TeacherMatchingItemPothosObject],
        resolve: parent => [...parent.items],
      }),
      // Honest, unfiltered-by-page count — an out-of-range page yields an
      // empty items array NEXT TO this unchanged count.
      total: t.exposeInt("total"),
      // Resolved page bounds (post-normalization, echoed back verbatim).
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
      // `Math.ceil(total / pageSize)`; 0 for an empty set.
      pageCount: t.exposeInt("pageCount"),
    }),
  });
