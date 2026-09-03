# DEV3-012 — Plan

> Rules: checkboxes move `[ ]` → `[-]` → `[x]` (closed with an outcome file). Scoped commits only. Every implementer re-reads specs.md + `docs/sessions/session-lifecycle.md` + the DEV3-004 service/repository conventions before touching code.

- [x] 0.1 Baseline capture (gate counts from the DEV3-005 close) into `outcome/0.1-baseline.md`; seed `deferred-items.md`.
- [x] 1.1 Repo primitives: `confirmSessionCompletionOnce` (guarded dual-confirm UPDATE … RETURNING fee/teacherId/feeHeld), `ensureWalletOnce` (ON CONFLICT DO NOTHING insert), `insertEarningTransactionOnce`, `creditWalletOnce` (explicit balance/total_earning increment), `sweepExpiredScheduledOnce` (batch UPDATE … RETURNING). Repo tests (runInRollback + tx-3rd-arg conventions). *(owner: backend)*
- [x] 1.2 Service: `confirmSessionCompletion` (R-201/202 — participant guard, idempotence, one-tx credit slice) + `sweepExpiredSessions` (R-203 — batch cancel + `refundHeldLaneToProvenance` reuse). Service suite green. *(owner: backend)*
- [x] 2.1 GraphQL: `confirmSessionCompletion(id): Session!` mutation (R-204), Session object unchanged (no new fields — stamps already exposed); SDL pins DEV3_012 + freeze title; allowlist untouched; codegen sync. *(owner: backend)*
- [x] 2.2 Cron entry: `app/api/cron/sweep-sessions` route per R-204 (bearer secret, mode gates, honest counts). *(owner: backend)*
- [x] 3.1 Frontend: student confirm affordance on completed rows (SessionRow action matrix + in-flight slot), teacher confirm state display, i18n ar/en + parity. *(owner: next round — closed cron-r6, see outcome/3.1-frontend-outcome.md)*
- [x] 4.1 Full gates + live loop: tsgo/biome/eslint/oxlint, battery delta 0, agent-browser confirm flow + sweep verification. *(closed cron-r6, see outcome/4.1-5.1-close-outcome.md)*
- [x] 5.1 Close-out: final outcome, deferred sweep, push, worklog. *(closed cron-r6)*
