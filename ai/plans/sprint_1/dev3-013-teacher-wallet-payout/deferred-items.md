# Deferred Items Ledger — DEV3-013

| ID | Deferred Item | Source Task | Target Task | Status | Notes |
|---|---|---|---|---|---|
| F8 | Plan-linked pricing (replaces interim `SESSION_FEE_*` constants) | lifecycle §10 contract | future ticket | ⏸ Forward | Needs a purchase/subscription flow decision (plans catalog exists: `session_count`/`price`/`interval_days`); the "no per-plan fee inputs on the wire" ruling stands until then |
| F9 | Payout settlement — admin approval flow flipping pending withdrawal rows to completed/failed (+ the aspirational immutability trigger migration) | specs R-302 | DEV3-021-adjacent | ⏸ Forward | Ledger is append-only by contract; settlement needs either a compensating-row convention or the trigger migration as its own schema ticket |
| F10 | Ledger pagination (cursor or page wrapper beyond the 50-row cap) | specs R-301 | future ticket | ⏸ Forward | 50 newest rows documented cap is honest for v1 |
| F11 | Request-level idempotency key (`X-Idempotency-Key`) on `requestWithdrawal` | specs R-302 | future ticket | ⏸ Forward | Deliberately not wired in v1 — each request is a new financial instruction |
| F12 | Wallet admin CRUD views | DEV3-012 F3 tail | future ticket | ⏸ Forward | Out of the teacher self-service scope |

No ❌/⚠️ rows — every item is a scoped forward contract, none blocks this plan.
