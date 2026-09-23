/**
 * Admin session-governance input quartet — the Pothos input objects for
 * the admin-only mutations `adminRescheduleSession`,
 * `adminCancelSession`, `adminReassignTeacher`, and `adminJoinSession`.
 *
 * Field whitelists mirror the canonical `AdminSession*Input` types from
 * `@/backend/types` (BOPLA-safe — the resolver maps every field onto the
 * service boundary explicitly; there is no spread path from these inputs
 * into any write). Structural discipline per `backend/graphql/AGENTS.md`
 * ("Input Exception Policy"): each input is a point-and-shoot scalar map
 * backed by the canonical backend type — no local type is declared here.
 *
 *  - `AdminSessionRescheduleInput`
 *      `sessionId: ID!` + the replacement timing pair
 *      `startedAt: DateTime!` / `endedAt: DateTime!` (the registered
 *      `DateTime` scalar by NAME — ISO-8601 on the wire, parsed to `Date`
 *      before the resolver runs). Ordering (`startedAt < endedAt`), the
 *      past-grace window, and the positive-safe-integer id shape are
 *      SERVICE-side validations — the scalar layer only guarantees the
 *      wire shapes.
 *  - `AdminSessionCancelInput`
 *      `sessionId: ID!` + the optional free-text `reason` (audit
 *      metadata; length-capped and trimmed by the service).
 *  - `AdminSessionReassignInput`
 *      `sessionId: ID!` + `newTeacherUserId: ID!` — the candidate's user
 *      id only; certification is never client-asserted.
 *  - `AdminSessionJoinInput`
 *      `sessionId: ID!` only.
 *
 * Registered on the shared builder at import time; imported by
 * `backend/graphql/mutation/classes/admin-session-governance.mutation.ts`
 * through the side-effect import chain. Deliberately NOT registered
 * anywhere else (single canonical input definition per SDL name).
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";

/** Input type for the `adminRescheduleSession` mutation. */
export const AdminSessionReschedulePothosInput = gqlSchemaBuilder.inputType("AdminSessionRescheduleInput", {
  fields: t => ({
    // Target session row id — shape-only on this surface; the service
    // re-validates the positive safe integer and classifies every
    // zero-row miss.
    sessionId: t.id({ required: true }),
    // Replacement timing pair — the registered `DateTime` scalar
    // (ISO-8601 UTC on the wire). Ordering + past-grace validation live
    // in the service, pre-DB.
    startedAt: t.field({ type: "DateTime", required: true }),
    endedAt: t.field({ type: "DateTime", required: true }),
  }),
});

/** Input type for the `adminCancelSession` mutation. */
export const AdminSessionCancelPothosInput = gqlSchemaBuilder.inputType("AdminSessionCancelInput", {
  fields: t => ({
    // Target session row id — shape-only on this surface.
    sessionId: t.id({ required: true }),
    // Optional free-text cancellation reason (audit metadata). Absent or
    // null normalizes to "no reason" inside the service; the length cap
    // is a service-side boundary check.
    reason: t.string({ required: false }),
  }),
});

/** Input type for the `adminReassignTeacher` mutation. */
export const AdminSessionReassignPothosInput = gqlSchemaBuilder.inputType("AdminSessionReassignInput", {
  fields: t => ({
    // Target session row id — shape-only on this surface.
    sessionId: t.id({ required: true }),
    // The candidate teacher's USER id (shared PK with the users table).
    // Certification (`is_approved`) is verified server-side under lock —
    // the payload carries identity only, never an approval assertion.
    newTeacherUserId: t.id({ required: true }),
  }),
});

/** Input type for the `adminJoinSession` mutation. */
export const AdminSessionJoinPothosInput = gqlSchemaBuilder.inputType("AdminSessionJoinInput", {
  fields: t => ({
    // Target session row id — shape-only on this surface.
    sessionId: t.id({ required: true }),
  }),
});
