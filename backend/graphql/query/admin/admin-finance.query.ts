/**
 * Admin financial-auditing queries — the three admin-gated read surfaces
 * over the money ledgers:
 *
 *  - `adminStudentPayments(filters: AdminStudentPaymentsFilterInput, page: Int, pageSize: Int): AdminStudentPaymentPage!`
 *  - `adminTeacherWallet(teacherId: ID!, filters: AdminWalletTransactionFilterInput, page: Int, pageSize: Int): AdminTeacherWallet!`
 *  - `adminPendingWithdrawals(page: Int, pageSize: Int): AdminWithdrawalQueuePage!`
 *
 * authScopes (`$all` conjunction, MANDATORY):
 *  - `authScopes: adminOnlyAuthScopes` — the shared
 *    `{ $all: { authenticated: true, role: [UserRole.Admin] } }` prelude.
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN`
 *    (403) — both BEFORE the resolver body runs.
 *
 * Resolver discipline (thin resolvers):
 *  - `requireAdminUser(ctx)` belt for TypeScript narrowing only (the
 *    translated `UnauthorizedError` matches the `authenticated` scope's
 *    own throw, so the belt is invisible when the scope did its job).
 *  - ID args (`teacherId`, `studentId`) are wire `ID`s — converted to
 *    positive-safe integers at the resolver boundary via
 *    `coerceDecimalSessionId` (decimal-ONLY string coercion — no
 *    `Number()`-style syntax generosity: "0x1f" stays invalid) +
 *    `requirePositiveIntId` (no `as number`), so the service always
 *    receives a numeric ledger key.
 *  - Filter args are copied FIELD-BY-FIELD into the service's closed
 *    filter whitelists — NO `{ ...filters }` spread. The input types are
 *    the schema's BOPLA boundary: smuggled fields die at GraphQL
 *    validation before a resolver runs.
 *  - Delegates to `AdminFinancialAuditingService` with
 *    `(…, ctx.locale)`; reads emit NO audit rows. Resolvers throw NOTHING
 *    directly except the narrowing belt; service `DomainError` subclasses
 *    propagate with `extensions.code` and boundary masking.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — root fields register at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/admin/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 */

import {
  AdminStudentPaymentPagePothosObject,
  AdminStudentPaymentsFilterInput,
  AdminTeacherWalletPothosObject,
  AdminWalletTransactionFilterInput,
  AdminWithdrawalQueuePagePothosObject,
} from "@/backend/graphql/pothos/admin";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  adminOnlyAuthScopes,
  coerceDecimalSessionId,
  requireAdminUser,
  requirePositiveIntId,
} from "@/backend/graphql/shared";
import { AdminFinancialAuditingService } from "@/backend/services/billing/admin-financial-auditing.service";

// Side-effect: register the `adminStudentPayments` query field.
gqlSchemaBuilder.queryField("adminStudentPayments", t =>
  t.field({
    type: AdminStudentPaymentPagePothosObject,
    args: {
      filters: t.arg({ type: AdminStudentPaymentsFilterInput, required: false }),
      page: t.arg({ type: "Int", required: false }),
      pageSize: t.arg({ type: "Int", required: false }),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      // The `$all` scope conjunction guarantees an admin context at
      // resolution time; `requireAdminUser` is the TS-narrowing belt (see
      // file docs + backend/graphql/shared/admin-prelude.ts).
      const user = await requireAdminUser(ctx);
      // Closed-input whitelist copy — exactly the six service-recognized
      // filter members, never a spread of the wire input.
      return AdminFinancialAuditingService.listStudentPaymentsForAdmin(
        user.id,
        {
          studentId:
            args.filters?.studentId == null
              ? null
              : requirePositiveIntId(coerceDecimalSessionId(args.filters.studentId), "studentId"),
          studentNameSearch: args.filters?.studentName ?? null,
          status: args.filters?.status ?? null,
          paymentGateway: args.filters?.paymentGateway ?? null,
          from: args.filters?.from ?? null,
          to: args.filters?.to ?? null,
        },
        args.page ?? null,
        args.pageSize ?? null,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminTeacherWallet` query field.
gqlSchemaBuilder.queryField("adminTeacherWallet", t =>
  t.field({
    type: AdminTeacherWalletPothosObject,
    args: {
      teacherId: t.arg({ type: "ID", required: true }),
      filters: t.arg({ type: AdminWalletTransactionFilterInput, required: false }),
      page: t.arg({ type: "Int", required: false }),
      pageSize: t.arg({ type: "Int", required: false }),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      // Wire `ID` → numeric ledger key at the resolver boundary (decimal-
      // only string coercion + positive-safe-integer guard, no `as number`).
      const teacherId = requirePositiveIntId(coerceDecimalSessionId(args.teacherId), "teacherId");
      // Closed-input whitelist copy — exactly the four ledger filter
      // members, never a spread of the wire input.
      return AdminFinancialAuditingService.getTeacherWalletForAdmin(
        user.id,
        teacherId,
        {
          type: args.filters?.type ?? null,
          status: args.filters?.status ?? null,
          from: args.filters?.from ?? null,
          to: args.filters?.to ?? null,
        },
        args.page ?? null,
        args.pageSize ?? null,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminPendingWithdrawals` query field.
gqlSchemaBuilder.queryField("adminPendingWithdrawals", t =>
  t.field({
    type: AdminWithdrawalQueuePagePothosObject,
    args: {
      page: t.arg({ type: "Int", required: false }),
      pageSize: t.arg({ type: "Int", required: false }),
    },
    authScopes: adminOnlyAuthScopes,
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      return AdminFinancialAuditingService.listPendingWithdrawalsForAdmin(
        user.id,
        args.page ?? null,
        args.pageSize ?? null,
        ctx.locale
      );
    },
  })
);
