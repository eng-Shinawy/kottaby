/**
 * Admin financial-auditing ledger row objects — the canonical row shapes
 * behind the three admin read surfaces over the two money ledgers
 * (`student_payments` + `teacher_transaction`).
 *
 * Every shape is backed by a canonical type from `@/backend/types` (the
 * `admin-finance.types.ts` set Task 2.2 shipped):
 *  - `AdminStudentPayment` ← `AdminStudentPaymentRow` (payment + student
 *    identity join — one rendered row)
 *  - `AdminWithdrawalQueueRow` ← `AdminWithdrawalQueueRow` (pending
 *    settlement queue row: the pending `TeacherTransaction` + identity +
 *    reserved balance)
 *
 * Per `backend/graphql/pothos/AGENTS.md`:
 *  - NO local type definitions — all shapes come from `@/backend/types`.
 *  - `id` is exposed FIRST on every row object (Apollo cache
 *    normalization — the `AdminStudentPayment` and `AdminWithdrawalQueueRow`
 *    wrappers' normalizable entities carry it; the queue row itself is an
 *    embedded value object with NO `id`, so its normalizable identity is
 *    the `TeacherTransaction` inside `transaction`).
 *  - Money fields ride the shared `DateTime` scalar convention + decimal
 *    STRINGS verbatim (money discipline: never numbers, never floats).
 *  - `paymentGateway`/`status` are re-exposed over the canonical Pothos
 *    enums registered ONCE in `shared/enum.pothos.ts` — the canonical rows
 *    already carry the TS enum values, so these are structural passthroughs.
 *  - The `TeacherTransaction` object is REUSED from
 *    `pothos/billing/wallet.pothos.ts` (single canonical object rule) —
 *    never re-declared here.
 */

import { TeacherTransactionPothosObject } from "@/backend/graphql/pothos/billing/wallet.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { PaymentGatewayPothosEnum, PaymentStatusPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { AdminStudentPaymentRow, AdminWithdrawalQueueRow } from "@/backend/types";

/**
 * `AdminStudentPayment` — one row of the admin payments audit listing: the
 * canonical payment columns plus the student's display name (the joined
 * identity the repository resolves). `subscriptionId` is nullable (the
 * immutable ledger outlives a severed subscription link). `id` FIRST.
 */
export const AdminStudentPaymentPothosObject = gqlSchemaBuilder
  .objectRef<AdminStudentPaymentRow>("AdminStudentPayment")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization identity.
      id: t.exposeID("id"),
      studentId: t.exposeID("studentId"),
      studentName: t.exposeString("studentName"),
      subscriptionId: t.exposeID("subscriptionId", { nullable: true }),
      // Money — decimal STRING verbatim.
      amount: t.exposeString("amount"),
      currency: t.exposeString("currency"),
      paymentGateway: t.expose("paymentGateway", { type: PaymentGatewayPothosEnum }),
      status: t.expose("status", { type: PaymentStatusPothosEnum }),
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * `AdminWithdrawalQueueRow` — one row of the admin pending-withdrawal
 * queue: the pending `TeacherTransaction` (REUSED canonical object,
 * normalized via its `id`), the teacher's display name, and the teacher's
 * CURRENT wallet balance at read time (decimal STRING). Embedded value
 * object — NO `id` field (the normalizable entity is the transaction).
 */
export const AdminWithdrawalQueueRowPothosObject = gqlSchemaBuilder
  .objectRef<AdminWithdrawalQueueRow>("AdminWithdrawalQueueRow")
  .implement({
    fields: t => ({
      transaction: t.field({
        type: TeacherTransactionPothosObject,
        resolve: parent => parent.transaction,
      }),
      teacherName: t.exposeString("teacherName"),
      // Money — decimal STRING verbatim (the requester's reserved balance).
      walletBalance: t.exposeString("walletBalance"),
    }),
  });
