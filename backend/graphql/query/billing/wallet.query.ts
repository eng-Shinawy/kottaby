/**
 * `myWallet` query — the caller's own teacher wallet (R-301).
 *
 * Contract:
 *  - ZERO arguments — identity is derived EXCLUSIVELY from the verified
 *    context (`ctx.user.id`; the teacher PK shares the users PK, and the
 *    wallet's `teacher_id` is unique). There is no caller-supplied lookup
 *    surface of any kind: BOLA probes that attempt to address a foreign
 *    wallet die as GraphQL validation failures before a resolver ever runs.
 *  - `Wallet!` NON-null — the wallet row is ensured lazily
 *    (`WalletRepository.ensureWalletOnce`, idempotent), so a brand-new
 *    certified teacher gets an honest zeroed wallet instead of an error.
 *  - DomainErrors thrown deeper (`FORBIDDEN` from the service's governance
 *    re-check) propagate uncaught to the masking boundary (no try/catch
 *    here by contract).
 *
 * authScopes 401/403 split (verified against @pothos/plugin-scope-auth@4.1.7,
 * the same split `query/teachers/applicant.query.ts` documents):
 *  - `{ role: [UserRole.Teacher] }` ALONE yields FORBIDDEN for anonymous
 *    callers — wrong code for anonymous.
 *  - A plain `{ authenticated: true, role: [...] }` map is WRONG in this
 *    engine: Pothos combines the keys of ONE scope map with ANY semantics
 *    (`defaultStrategy: "any"`), so ANY authenticated caller would pass.
 *  - The conjunction is therefore made EXPLICIT with `$all`: anonymous
 *    callers hit the `authenticated` scope's UnauthorizedError throw
 *    (UNAUTHORIZED / 401), while authenticated non-teachers fail the
 *    `role` scope into the canonical localized ForbiddenError (FORBIDDEN /
 *    403).
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.queryField(...)`.
 *  - Wired through side-effect barrels:
 *    `query/billing/index.ts` → `query/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation
 *    (backend/graphql/AGENTS.md); no business logic inline.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { WalletLedgerPagePothosObject, WalletPothosObject } from "@/backend/graphql/pothos/billing/wallet.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { WalletService } from "@/backend/services";

// Side-effect: register the `myWallet` query field.
gqlSchemaBuilder.queryField("myWallet", t =>
  t.field({
    type: WalletPothosObject,
    description:
      "The caller's own teacher wallet: the balance surface (decimal strings, EGP) plus the newest-first ledger page (the 50 most recent transactions). The wallet row is ensured lazily, so a new teacher sees an honest zeroed wallet. Teacher-only.",
    // Explicit `$all` conjunction per the 401/403 split documented above.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, _args, ctx) => {
      // TypeScript narrowing only — see `query/teachers/applicant.query.ts`.
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      // Zero arguments: the wallet address is the verified context identity.
      return WalletService.getMyWallet(ctx.user.id, ctx.locale);
    },
  })
);

// Side-effect: register the `myWalletLedger` query field — the paginated
// ledger companion (`myWallet` always carries the first 50-row page; this
// field serves every window beyond it for the client's "load more").
gqlSchemaBuilder.queryField("myWalletLedger", t =>
  t.field({
    type: WalletLedgerPagePothosObject,
    args: {
      limit: t.arg.int({ required: true }),
      offset: t.arg.int({ required: true }),
    },
    description:
      "One newest-first page of the caller's own teacher ledger (the paginated companion of `myWallet`). The window is clamped server-side to the documented envelope (limit 1..50, offset >= 0) and the payload carries the pagination truth (totalCount + hasMore). Teacher-only; the wallet address is the verified context identity — there is no caller-supplied lookup surface.",
    // Explicit `$all` conjunction per the same 401/403 split as `myWallet`.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Teacher],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `query/teachers/applicant.query.ts`.
      if (!ctx.user) {
        throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized);
      }
      // Zero lookup arguments beyond the window: the wallet address is the
      // verified context identity (BOLA-proof by construction).
      return WalletService.getMyWalletLedgerPage(ctx.user.id, args.limit, args.offset, ctx.locale);
    },
  })
);
