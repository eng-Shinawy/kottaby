# DEV3-013 — Teacher Wallet Surface + Payout (Withdrawal Request) — Specs

Parent contract: `docs/sessions/session-lifecycle.md` §10 Forward-contracts
(DEV3-013 row) + the DEV3-012 deferred ledger ("payout/withdrawal surfaces"
explicitly out of DEV3-012 scope). The wallet credit slice (R-202) landed in
DEV3-012; teachers now accumulate real, spendable earnings — this plan gives
them the READ surface (balance + ledger) and the WRITE surface (withdrawal
request). Plan-linked pricing remains a recorded forward item (F8) — the
interim `SESSION_FEE_*` constants stand, per the lifecycle doc's own ruling.

## Money discipline (inherited, non-negotiable)

- Fees/balances/amounts are decimal STRINGS end-to-end — never numbers,
  never floats, never re-parsed or re-rounded. Wire amounts are GraphQL
  `String!` values carried verbatim into decimal columns.
- No arithmetic on money anywhere; the guarded debit is SQL-side
  (`balance - amount` inside the UPDATE predicate/set with the amount as a
  bound decimal string), never JS math.
- Currency display (EGP) is a render-time concern only.

## R-301 — `myWallet` query (teacher-only read)

`myWallet: Wallet!` — non-null; the wallet row is ensured lazily through the
DEV3-012 `WalletRepository.ensureWalletOnce` primitive (idempotent
`ON CONFLICT DO NOTHING`), so a brand-new certified teacher gets an
honest zeroed wallet instead of an error.

- authScopes: explicit `$all { authenticated, role: [Teacher] }` conjunction
  (the engine's ANY-semantics split — anonymous 401 / wrong-role 403), the
  same surface as `myApplicantProfile`.
- `Wallet` shape: `id` FIRST (Apollo cache identity), then `balance`,
  `totalEarning` (decimal strings), `currency` (constant "EGP" — render
  label only, NOT a column read: `wallet` has no currency column; the
  platform currency lives in `SESSION_FEE_CURRENCY`), `createdAt`,
  `updatedAt`, and `transactions: [TeacherTransaction!]!`.
- `transactions` = the ledger newest-first, CAPPED at the 50 most recent
  rows (documented cap; full pagination is F10). Each
  `TeacherTransaction`: `id` first, `amount`, `type`, `status`,
  `description`, `sessionId` (nullable), `createdAt`. The wire type
  `sessionId` is exposed as `ID` — cache-friendly, no join performed.

## R-302 — `requestWithdrawal` mutation (teacher-only write)

`requestWithdrawal(input: RequestWithdrawalInput!): Wallet!` — returns the
UPDATED wallet so the client converges its cache without a refetch.

- Input `{ amount: String! }` — the requested payout amount as a decimal
  string. NO other fields (no wallet id — identity is server-bound from
  `ctx.user.id` → the teacher's unique wallet; BOLA-proof by construction).
- authScopes: the same explicit `$all` teacher conjunction.
- SEMANTICS (debit-on-request, the platform's escrow-hold pattern):
  1. ONE `pending` `withdrawal` ledger row is inserted (the in-flight
     payout record; settlement/flip is the admin payout flow, F9).
  2. SAME transaction: the wallet `balance` is debited by exactly
     `amount` via a GUARDED UPDATE whose predicate enforces
     `balance >= amount` (the guard lives in the statement, mirroring
     `decrementLaneIfAvailable`). `total_earning` is NEVER touched by a
     withdrawal — it is a lifetime counter.
  3. Zero-row guarded miss ⇒ insufficient funds. A pre-DB re-read gives
     the CURRENT balance for the localized denial; the DB-side
     `wallet_balance_check >= 0` CHECK is the concurrent-overdraw
     backstop (a racing pair of requests cannot both pass the predicate).
- Idempotency: deliberately NOT keyed per amount — each request is a NEW
  financial instruction (two identical requests = two payouts, honestly).
  The request-level idempotency header machinery (X-Idempotency-Key) is
  NOT wired on this surface in v1 (F11 records the option).

## R-303 — Validation matrix (pre-DB, fail-closed)

`amount` (after trim) must match `^\d{1,7}(\.\d{1,2})?$` AND parse to a
value > 0:

| Case | Result |
|---|---|
| empty / whitespace | `VALIDATION` `walletInvalidAmount` |
| non-numeric / negative / 3+ decimals / 0.00 / 0 | `VALIDATION` `walletInvalidAmount` |
| > 7 integer digits (≥ 10,000,000) | `VALIDATION` `walletInvalidAmount` |
| well-formed but > current balance | `CONFLICT`-class `WALLET_INSUFFICIENT_FUNDS` (reuses the existing `insufficientBalance` copy) |

Rationale for the 7-digit cap: `balance` is `decimal(10,2)`; an amount that
can never fit a wallet balance is rejected pre-DB with the precise message
instead of a generic overflow error.

## R-304 — Service placement + repo ownership

- `WalletService` (new `backend/services/billing/wallet.service.ts`, barrel
  export) — the ONLY caller of the two new repository methods; owns the
  transaction (`withTransaction`), the validation matrix, the oracle-free
  error classification, and `logger` events. Mirrors
  `SessionLifecycleService` conventions (locale-propagated localized
  DomainErrors, `outerTx?` test seam).
- `WalletRepository` gains: `debitForWithdrawalOnce({walletId, amount,
  description}, tx)` (insert pending row + guarded debit, returns the
  ledger row or null) and `listRecentTransactions(walletId, limit, tx)`.
  No business logic, no i18n (repo AGENTS.md).

## R-305 — GraphQL surface registration

- Pothos: `WalletPothosObject` + `TeacherTransactionPothosObject` in a new
  `backend/graphql/pothos/billing/` module (canonical-shape passthrough,
  `id` first); `TransactionTypePothosEnum` + `TransactionStatusPothosEnum`
  registered in `shared/enum.pothos.ts` with exhaustive pgEnum mapping
  helpers (no `as`, no `default` escape).
- Resolvers: thin delegation only — `query/billing/wallet.query.ts` +
  `mutation/billing/wallet.mutation.ts`, side-effect barrels up to
  `gqlSchema.ts`. No try/catch (masking boundary contract).
- SDL pins: `schema-surface.test.ts` grows a DEV3_013 field list
  (growth-only — no existing pin edits) + committed-SDL pin lines.

## R-306 — Frontend surface (`/wallet`, teacher-only)

- `app/(dashboard)/wallet/page.tsx` — `withPageAuth({ roles: [Teacher] })`;
  the `/wallet` nav route ALREADY exists for teachers (ComingSoon stub
  today) — this plan replaces the stub with the real page.
- `TeacherWalletContainer` (client): balance header cards (available
  balance + lifetime earnings, EGP-labeled, verbatim strings), a "Request
  withdrawal" CTA opening a dialog (amount field + live validation +
  available-balance hint; submit disabled while invalid/in-flight), and the
  ledger list (type icon + signed-amount color, status chip, description,
  timestamp; honest empty state).
- Cache convergence: the returned `Wallet!` payload normalizes
  `Wallet:<id>` (id first) — ZERO refetch on success; the ledger list
  converges from the payload's `transactions` (query-fetch-policy
  cache-first on remount is acceptable — balances change only via own
  actions in v1).
- i18n: NEW `wallet` namespace (`shared/locale/namespaces/wallet/` +
  types + en + ar + parity belt), wired into `Translations` /
  `enMessages` / `arMessages`. One new errors-namespace key
  (`walletInvalidAmount`); `insufficientBalance` is REUSED for R-303's
  funds denial. Exact ar/en key parity (compile + runtime belt).
- A11y/RTL: dialog is focus-trapped MUI, labeled inputs, 44px CTAs;
  Arabic copy verified RTL.

## Out of scope (forward items)

- F8 plan-linked pricing (replaces `SESSION_FEE_*` — recorded forward
  contract, needs a purchase flow decision).
- F9 payout settlement (admin approval flow flipping `pending` →
  `completed/failed` + the immutability-trigger migration).
- F10 ledger pagination.
- F11 request-level idempotency key on `requestWithdrawal`.
- F12 wallet admin CRUD views.
