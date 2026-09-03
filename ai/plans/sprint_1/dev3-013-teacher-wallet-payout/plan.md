# DEV3-013 — Implementation Plan

Binding specs: `specs.md` (R-301..R-306). Parent contract:
`docs/sessions/session-lifecycle.md` §10 DEV3-013 row + DEV3-012 deferred
ledger. Prerequisite state: DEV3-012 closed at 427294d (wallet credit
primitives live: `ensureWalletOnce`, `creditEarningOnce`, the
`WalletRepository` module, the `wallet`/`teacher_transaction` tables).

## Task graph

| # | Task | Depends | Touches |
|---|---|---|---|
| 0.1 | Baseline: confirm clean tree @427294d, dev server up, gates green | — | — |
| 1.1 | Repo slice: `debitForWithdrawalOnce` + `listRecentTransactions` in `WalletRepository` | 0.1 | `backend/db/repo/billing/wallet.repository.ts` |
| 1.2 | Service slice: `WalletService.getMyWallet` + `WalletService.requestWithdrawal` (validation matrix R-303, tx ownership) | 1.1 | `backend/services/billing/wallet.service.ts`, `backend/services/index.ts` |
| 2.1 | GraphQL slice: billing Pothos objects + transaction enums, `myWallet` query, `requestWithdrawal` mutation, barrels, SDL regen + codegen, schema-surface pins | 1.2 | `backend/graphql/**`, `frontend/graphql/generated/**`, schema.graphql |
| 2.2 | Backend tests: `wallet.service.test.ts` (runInRollback: read-shape, withdrawal happy/insufficient/invalid matrix, guarded-debit race backstop, total_earning immutability) | 1.2 | `backend/services/billing/` |
| 3.1 | Frontend slice: `wallet` i18n namespace (en/ar/parity), shared documents (12th family), `TeacherWalletContainer`, `/wallet` page | 2.1 | `shared/locale/**`, `sharedDocuments/billing/**`, `frontend/views/teacher/wallet/**`, `app/(dashboard)/wallet/page.tsx` |
| 3.2 | Component suite: `test/ui/components/teacher/wallet/` (render/ledger/dialog validation/success/insufficient arms × ar/en) | 3.1 | `test/ui/components/teacher/wallet/` |
| 4.1 | Full gates (tsgo/biome/oxlint/eslint + component suites + backend battery + parity) + live agent-browser QA (teacher wallet loop: read → withdraw → insufficient → DB ledger verification) | 3.2 | — |
| 5.1 | Close-out: outcome files, deferred ledger F8-F12, scoped commits + push | 4.1 | docs + git |

## Execution order

Strictly sequential (each tier consumes the previous tier's artifacts;
codegen requires the SDL; the suite requires the container). No parallel
lanes — the Task tool has been unreliable in recent rounds and the slice is
tightly coupled through the generated types.

## Gate set (4.1)

1. `bun tsgo` — 0 errors
2. `bun biome check` selected file set — 0 findings
3. `bun oxlint` — 0/0
4. full-repo eslint — exit 0
5. component suites: student / teacher / admin / NEW wallet — 0 fail
6. sessions-namespace parity + wallet parity — 0 fail
7. backend battery incl. new wallet service suite — 0 fail
8. documents contract test + schema-surface test — 0 fail
9. live agent-browser loop (real browser) — zero console/hydration errors
