/**
 * `requestWithdrawal` mutation — the teacher's payout request (DEV3-013,
 * R-302).
 *
 * Contract:
 *  - `requestWithdrawal(input: RequestWithdrawalInput!): Wallet!` —
 *    teacher-only; identity is server-bound from `ctx.user.id` (the
 *    input carries ONLY the amount — no wallet id exists on the wire,
 *    BOLA-proof by construction).
 *  - Semantics (debit-on-request escrow, specs R-302): ONE `pending`
 *    `withdrawal` ledger row plus a GUARDED balance debit inside ONE
 *    transaction; insufficient funds roll the flow back (zero rows
 *    committed) and surface the localized `WALLET_INSUFFICIENT_FUNDS`
 *    conflict.
 *  - The UPDATED `Wallet!` payload lets the client converge its cache
 *    without a refetch (the ledger page rides the payload).
 *  - DomainErrors (`WALLET_INVALID_AMOUNT` VALIDATION,
 *    `WALLET_INSUFFICIENT_FUNDS` conflict, governance `FORBIDDEN`)
 *    propagate uncaught to the masking boundary — no try/catch here.
 *
 * authScopes: the explicit `$all { authenticated, role: [Teacher] }`
 * conjunction (the 401/403 split documented in
 * `query/billing/wallet.query.ts` — ANY-semantics engine).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/billing/index.ts` →
 *    `mutation/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation;
 *    no business logic inline. Top-level static imports only (gate A1).
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { WalletPothosObject } from "@/backend/graphql/pothos/billing/wallet.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { WalletService } from "@/backend/services";

/**
 * `RequestWithdrawalInput` — the withdrawal request whitelist. EXACTLY one
 * field: the requested payout amount as a decimal string (the R-303
 * validation matrix lives entirely service-side, pre-DB). No wallet id, no
 * currency, no other fields — identity and address are server-owned.
 */
const RequestWithdrawalInput = gqlSchemaBuilder.inputType("RequestWithdrawalInput", {
  fields: t => ({
    amount: t.string({ required: true, description: 'The payout amount as a decimal string (e.g. "125.00").' }),
  }),
});

// Side-effect: register the `requestWithdrawal` mutation field.
gqlSchemaBuilder.mutationField("requestWithdrawal", t =>
  t.field({
    type: WalletPothosObject,
    args: {
      input: t.arg({ type: RequestWithdrawalInput, required: true }),
    },
    description:
      "Request a payout from the caller's own teacher wallet: one pending withdrawal ledger row plus a guarded balance debit, atomically. Insufficient funds roll the request back (zero rows) and surface WALLET_INSUFFICIENT_FUNDS; malformed amounts fail the pre-DB validation matrix with WALLET_INVALID_AMOUNT. Returns the UPDATED wallet (balance + refreshed ledger) so no refetch is needed. Teacher-only.",
    // Explicit `$all` conjunction per the 401/403 split documented above.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `query/billing/wallet.query.ts`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // The amount is carried VERBATIM into the service's validation
      // matrix (money discipline: never re-parsed or re-rounded here).
      return WalletService.requestWithdrawal(ctx.user.id, args.input.amount, ctx.locale);
    },
  })
);
