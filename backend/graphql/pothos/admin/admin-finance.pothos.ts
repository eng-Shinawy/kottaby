/**
 * Admin financial-auditing page wrappers + filter/adjustment inputs — the
 * read/write wire shapes of the three admin surfaces over the money
 * ledgers (payments audit listing, wallet inspector, pending-withdrawal
 * queue) and the three settlement/adjustment mutations.
 *
 * Every shape is backed by a canonical type from `@/backend/types` (the
 * `admin-finance.types.ts` set Task 2.2 shipped):
 *  - `AdminStudentPaymentPage` ← `AdminStudentPaymentPageReturnType`
 *  - `AdminTeacherWallet` ← `AdminTeacherWalletReturnType` (FLAT wallet
 *    summary — `balance`/`totalEarning` are a NULL PAIR = the teacher has
 *    no wallet row yet, an honest empty state; the capped teacher-facing
 *    `Wallet` object is deliberately NOT embedded)
 *  - `AdminWithdrawalQueuePage` ← `AdminWithdrawalQueuePageReturnType`
 *  - `AdminStudentPaymentsFilterInput` — closed six-member filter
 *    whitelist mapping 1:1 onto `NormalizedAdminPaymentFilters`
 *  - `AdminWalletTransactionFilterInput` — closed four-member filter
 *    whitelist mapping 1:1 onto `AdminWalletTransactionFilters`
 *  - `AdjustTeacherWalletInput` — closed four-member whitelist mapping 1:1
 *    onto `AdminWalletAdjustmentSubmitInput`
 *
 * Placement follows the audit-trail precedent: page wrappers + filter
 * inputs live here in `pothos/admin/`; the row objects sit next to their
 * domain in `pothos/billing/`.
 *
 * Per `backend/graphql/pothos/AGENTS.md`:
 *  - NO local type definitions — all shapes come from `@/backend/types`.
 *  - Page wrappers are embedded value objects with NO `id` field (the
 *    normalizable entities are the rows inside `items`).
 *  - `WalletAdjustmentDirection` is imported from the shared enum registry
 *    — never re-registered here.
 *  - `from`/`to` ride the shared `DateTime` scalar (wire ISO-8601,
 *    resolved to `Date` before the service sees them).
 *  - Closed whitelists: any smuggled field dies as a GraphQL validation
 *    failure before a resolver ever runs (BOPLA boundary).
 */

import {
  AdminStudentPaymentPothosObject,
  AdminWithdrawalQueueRowPothosObject,
} from "@/backend/graphql/pothos/billing/admin-finance.pothos";
import { TeacherTransactionPothosObject } from "@/backend/graphql/pothos/billing/wallet.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  PaymentGatewayPothosEnum,
  PaymentStatusPothosEnum,
  TransactionStatusPothosEnum,
  TransactionTypePothosEnum,
  WalletAdjustmentDirectionPothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import type {
  AdminStudentPaymentPageReturnType,
  AdminTeacherWalletReturnType,
  AdminWithdrawalQueuePageReturnType,
} from "@/backend/types";

/**
 * `AdminStudentPaymentPage` — paginated payments audit envelope. Echoes
 * `page` + `pageSize` so callers can normalize client-side pagination
 * state; an out-of-range page yields an empty `items` array with the
 * honest `totalCount` (never clamped, never an error). Embedded wrapper —
 * NO `id` field.
 */
export const AdminStudentPaymentPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminStudentPaymentPageReturnType>("AdminStudentPaymentPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminStudentPaymentPothosObject],
        resolve: parent => [...parent.items],
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * `AdminTeacherWallet` — the FLAT wallet inspector envelope: the nullable
 * `balance`/`totalEarning` pair (BOTH null = the teacher has no wallet row
 * yet — an honest empty state, never fake zeros), the constant `currency`
 * render label, the teacher identity, and the wallet's paginated
 * transaction ledger. Deliberately does NOT embed the teacher-facing
 * `Wallet` object (that surface is bound to the 50-row capped view the
 * admin design forbids reusing). Embedded wrapper — NO `id` field.
 */
export const AdminTeacherWalletPothosObject = gqlSchemaBuilder
  .objectRef<AdminTeacherWalletReturnType>("AdminTeacherWallet")
  .implement({
    fields: t => ({
      // Null pair with `totalEarning` — honest no-wallet empty state.
      balance: t.exposeString("balance", { nullable: true }),
      totalEarning: t.exposeString("totalEarning", { nullable: true }),
      // Render label only — the platform currency constant (the `wallet`
      // table has no currency column; the service supplies the label).
      currency: t.exposeString("currency"),
      teacherId: t.exposeID("teacherId"),
      teacherName: t.exposeString("teacherName"),
      transactions: t.field({
        type: [TeacherTransactionPothosObject],
        resolve: parent => [...parent.transactions],
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * `AdminWithdrawalQueuePage` — paginated pending-withdrawal queue
 * envelope (oldest-first: longest-waiting request first). Echoes `page` +
 * `pageSize`, and carries `totalAmount` — the WHOLE queue's pending payout
 * sum aggregated server-side over the same predicate as `items`
 * (decimal string; page-size independent, so the UI can render the total
 * for multi-page queues without a partial-figure masquerade). Embedded
 * wrapper — NO `id` field.
 */
export const AdminWithdrawalQueuePagePothosObject = gqlSchemaBuilder
  .objectRef<AdminWithdrawalQueuePageReturnType>("AdminWithdrawalQueuePage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminWithdrawalQueueRowPothosObject],
        resolve: parent => [...parent.items],
      }),
      totalCount: t.exposeInt("totalCount"),
      totalAmount: t.exposeString("totalAmount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * `AdminStudentPaymentsFilterInput` — independent ANDed filters for the
 * payments audit listing, all optional (absent or `null` members drop out
 * at the service layer). `studentId` is a wire `ID` (numeric ledger key);
 * `studentName` is an ILIKE search (wildcards escaped server-side);
 * `from`/`to` bound the payment window. Closed whitelist: any smuggled
 * field dies as a GraphQL validation failure before a resolver ever runs.
 */
export const AdminStudentPaymentsFilterInput = gqlSchemaBuilder.inputType("AdminStudentPaymentsFilterInput", {
  fields: t => ({
    studentId: t.id({ required: false }),
    studentName: t.string({ required: false }),
    status: t.field({ type: PaymentStatusPothosEnum, required: false }),
    paymentGateway: t.field({ type: PaymentGatewayPothosEnum, required: false }),
    from: t.field({ type: "DateTime", required: false }),
    to: t.field({ type: "DateTime", required: false }),
  }),
});

/**
 * `AdminWalletTransactionFilterInput` — independent ANDed filters for the
 * wallet inspector's transaction ledger, all optional. Closed whitelist
 * (BOPLA boundary, four members exactly).
 */
export const AdminWalletTransactionFilterInput = gqlSchemaBuilder.inputType("AdminWalletTransactionFilterInput", {
  fields: t => ({
    type: t.field({ type: TransactionTypePothosEnum, required: false }),
    status: t.field({ type: TransactionStatusPothosEnum, required: false }),
    from: t.field({ type: "DateTime", required: false }),
    to: t.field({ type: "DateTime", required: false }),
  }),
});

/**
 * `AdjustTeacherWalletInput` — the manual wallet adjustment payload.
 * `amount` is a decimal STRING (never numeric — money discipline) the
 * service validates against its decimal grammar + positivity guard;
 * `direction` rides the service-layer `WalletAdjustmentDirection`
 * vocabulary (Credit adds to the balance, Debit subtracts — never a
 * stored column); `reason` is MANDATORY and validated + normalized at
 * intake. Closed whitelist: the four members exactly.
 */
export const AdjustTeacherWalletInput = gqlSchemaBuilder.inputType("AdjustTeacherWalletInput", {
  fields: t => ({
    teacherId: t.id({ required: true }),
    amount: t.string({ required: true }),
    direction: t.field({ type: WalletAdjustmentDirectionPothosEnum, required: true }),
    reason: t.string({ required: true }),
  }),
});
