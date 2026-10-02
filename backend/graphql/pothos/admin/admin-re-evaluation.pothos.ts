/**
 * `TeacherReEvaluationOrder` — the wire receipt of the admin-ordered paid
 * re-evaluation (`adminOrderTeacherReEvaluation`): the verbatim charged
 * fee, the currency, the post-debit wallet balance, the fresh re-evaluation
 * cycle anchor, and the subject teacher's id — exactly the canonical
 * `TeacherReEvaluationOrderReturnType` the service returns, exposed
 * non-null on every member.
 *
 * Money discipline: `amountCharged`/`walletBalance` are decimal STRINGS
 * verbatim (never numbers — the fee constant and the wallet read-back ride
 * the ledger's byte-identical money discipline), and `currency` is the
 * platform currency label. `reEvaluationStartedAt` is the fresh cycle
 * anchor stamped by the guarded re-open write — a `Date` on the service
 * type, serialized to ISO-8601 UTC on the wire.
 *
 * NO input object exists for this surface: the mutation takes the two
 * scalar args (`teacherId: ID!`, `reason: String!`) directly — there is no
 * `OrderTeacherReEvaluationInput`. The fee is server-owned (no wire fee
 * argument exists, so mass-assignment of price is structurally impossible)
 * and the acting identity is session-sourced server-side.
 *
 * Permission matrix: the surface is ADMIN-ONLY — the mutation
 * carries the inline `$all` conjunction
 * `{ authenticated: true, role: [UserRole.Admin] }`. There is no distinct
 * SUPER_ADMIN role: `UserRole` = `Admin | Teacher | Student | Parent`
 * (`backend/enum/users/user-role.enum.ts`), so the admin role leg is the
 * full authorization story; the governance-active check re-asserts inside
 * the service transaction (`assertActorAdminActive`).
 *
 * Apollo normalization: the receipt is an id-less embedded value object
 * (the subject teacher's `users.id` rides `teacherId`, not a self `id`) —
 * the frontend registers the type with `keyFields: false` in the Apollo
 * cache, the sanctioned wrapper-type exception to the id-field rule.
 *
 * Per `backend/graphql/pothos/AGENTS.md` + `backend/AGENTS.md`:
 *  - NO local type definitions — the shape comes from
 *    `TeacherReEvaluationOrderReturnType` in `@/backend/types`.
 *  - No custom scalar registration here (the ISO instant is a plain
 *    non-null `String`, serialized via the field resolver — NOT a
 *    `DateTime` scalar).
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { TeacherReEvaluationOrderReturnType } from "@/backend/types";

/**
 * `TeacherReEvaluationOrder` — the non-null five-field order receipt.
 * Every member is non-null: an order either committed (all five members
 * are known and final) or it denied entirely (the whole field errors, so
 * no partial receipt can ever surface).
 */
export const TeacherReEvaluationOrderPothosObject = gqlSchemaBuilder
  .objectRef<TeacherReEvaluationOrderReturnType>("TeacherReEvaluationOrder")
  .implement({
    fields: t => ({
      // users.id of the subject teacher whose wallet was charged (the
      // charge anchor the admin UI refetches the wallet + detail views by).
      teacherId: t.exposeID("teacherId", {
        description: "The subject teacher's user id (the wallet the fee was charged from).",
      }),
      // Verbatim decimal STRING — the charged fee exactly as the ledger row
      // carries it (never parsed, never re-rounded, never a number).
      amountCharged: t.exposeString("amountCharged", {
        description: "The re-evaluation fee charged, as a verbatim decimal string.",
      }),
      // The currency label the fee was charged in (the platform constant).
      currency: t.exposeString("currency", {
        description: "The currency the fee was charged in.",
      }),
      // Post-debit balance read back INSIDE the ordering transaction, so the
      // client converges without a refetch (the adjustTeacherWallet pattern).
      walletBalance: t.exposeString("walletBalance", {
        description: "The wallet balance after the charge, as a verbatim decimal string.",
      }),
      // Fresh re-evaluation cycle anchor (the guarded re-open's stamped
      // instant) — ISO-8601 UTC on the wire.
      reEvaluationStartedAt: t.string({
        description: "The instant the re-evaluation cycle started (ISO-8601).",
        resolve: parent => parent.reEvaluationStartedAt.toISOString(),
      }),
    }),
  });
