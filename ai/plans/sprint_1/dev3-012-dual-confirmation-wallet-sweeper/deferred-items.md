# Deferred Items Ledger — DEV3-012

| ID | Deferred Item | Source Task | Target Task | Status | Notes |
|---|---|---|---|---|---|
| F3 | Frontend confirm affordance + wallet views (plan task 3.1) | plan | next round | ✅ Closed (cron-r6) | Affordance shipped; wallet ADMIN views were never in 3.1 scope (they remain a future ticket if wanted) |
| F4 | Claim-row expiry inside the sweeper (D2 tail) | specs R-203 | this plan, task 1.2 stretch | ⏸ Forward | "Claims are harmless rows" — only if trivial; never blocks the session sweep |
| F5 | Wallet DB trigger (schema docblock's aspirational trigger) | specs R-202 | future ticket | ⏸ Forward | Explicit same-tx updates this round; a trigger migration is a standalone schema ticket |
| F6 | Stale `test:cron` npm script (references non-existent paths) | cron-r6 finding | future housekeeping | ⏸ Forward | `backend/services/cron/test/`, `backend/db/test/repo/cron.repository.test.ts`, `backend/lib/cron-auth.test.ts` do not exist; sweep-route coverage now lives at `app/api/cron/sweep-sessions/test/` |
| F7 | Teacher-surface live login (no teacher creds in .env) | cron-r6 4.1 | next live round | ⏸ Forward | Compensated by teacher suite branch 23 (both locales) + the byte-shared row verified live on the student surface |
