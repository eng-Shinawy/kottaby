/**
 * Admin financial-auditing mutations — the three admin-gated write
 * surfaces over the money ledgers:
 *
 *  - `approveWithdrawal(transactionId: ID!): TeacherTransaction!` — settle
 *    a pending withdrawal to `completed` (the debit was reserved at
 *    request time).
 *  - `rejectWithdrawal(transactionId: ID!, reason: String!): TeacherTransaction!`
 *    — settle a pending withdrawal to `failed` and restore the reserved
 *    balance.
 *  - `adjustTeacherWallet(input: AdjustTeacherWalletInput!): TeacherTransaction!`
 *    — book a reason-bearing manual credit/debit adjustment (audit-stamped
 *    server-side).
 *
 * authScopes (`$all` conjunction, MANDATORY):
 *  - `authScopes: adminOnlyAuthScopes` — the shared
 *    `{ $all: { authenticated: true, role: [UserRole.Admin] } }` prelude.
 *  - Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN`
 *    (403) — both BEFORE the resolver body runs.
 *
 * Resolver discipline (thin resolvers):
 *  - `requireAdminUser(ctx)` belt for TypeScript narrowing only; the
 *    actor identity (`actorUserId`) is sourced EXCLUSIVELY from
 *    `ctx.user.id` — never from args or input (BOLA-safe by construction).
 *  - ID args (`transactionId`, `input.teacherId`) are wire `ID`s —
 *    converted to positive-safe integers at the resolver boundary via
 *    `coerceDecimalSessionId` (decimal-ONLY string coercion — no
 *    `Number()`-style syntax generosity: "0x1f" stays invalid) +
 *    `requirePositiveIntId` (no `as number`).
 *  - Input args are copied FIELD-BY-FIELD into the service's closed
 *    submit whitelist — NO `{ ...input }` spread. The input type is the
 *    schema's BOPLA boundary: smuggled fields die at GraphQL validation
 *    before a resolver runs.
 *  - Delegates to `AdminFinancialAuditingService` with `(…, ctx.locale)`;
 *    the audit row + settlement commit inside the service's transaction.
 *    Resolvers throw NOTHING directly except the narrowing belt; service
 *    `DomainError` subclasses propagate with `extensions.code` and
 *    boundary masking (NO try/catch here).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — root fields register at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/admin/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 */

import { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdjustTeacherWalletInput } from "@/backend/graphql/pothos/admin/admin-finance.pothos";
import { TeacherTransactionPothosObject } from "@/backend/graphql/pothos/billing/wallet.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { coerceDecimalSessionId, requireAdminUser, requirePositiveIntId } from "@/backend/graphql/shared";
import { AdminFinancialAuditingService } from "@/backend/services/billing/admin-financial-auditing.service";

// Side-effect: register the `approveWithdrawal` mutation field.
gqlSchemaBuilder.mutationField("approveWithdrawal", t =>
  t.field({
    type: TeacherTransactionPothosObject,
    args: {
      transactionId: t.arg({ type: "ID", required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      // Wire `ID` → numeric ledger key at the resolver boundary (decimal-
      // only string coercion + positive-safe-integer guard, no `as number`).
      return AdminFinancialAuditingService.approveWithdrawal(
        user.id,
        requirePositiveIntId(coerceDecimalSessionId(args.transactionId), "transactionId"),
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `rejectWithdrawal` mutation field.
gqlSchemaBuilder.mutationField("rejectWithdrawal", t =>
  t.field({
    type: TeacherTransactionPothosObject,
    args: {
      transactionId: t.arg({ type: "ID", required: true }),
      reason: t.arg({ type: "String", required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      return AdminFinancialAuditingService.rejectWithdrawal(
        user.id,
        requirePositiveIntId(coerceDecimalSessionId(args.transactionId), "transactionId"),
        args.reason,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adjustTeacherWallet` mutation field.
gqlSchemaBuilder.mutationField("adjustTeacherWallet", t =>
  t.field({
    type: TeacherTransactionPothosObject,
    args: {
      input: t.arg({ type: AdjustTeacherWalletInput, required: true }),
    },
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      // Closed-input whitelist copy — exactly the four service-recognized
      // members, never a spread of the wire input. The enum rides the
      // service-layer `WalletAdjustmentDirection` VALUE import (runtime
      // use — the Pothos enum resolves to the same canonical enum).
      return AdminFinancialAuditingService.adjustTeacherWallet(
        user.id,
        {
          teacherId: requirePositiveIntId(coerceDecimalSessionId(args.input.teacherId), "teacherId"),
          amount: args.input.amount,
          direction:
            args.input.direction === WalletAdjustmentDirection.Debit
              ? WalletAdjustmentDirection.Debit
              : WalletAdjustmentDirection.Credit,
          reason: args.input.reason,
        },
        ctx.locale
      );
    },
  })
);
