# DEV3-012 — Dual-Confirmation Wallet Credit + 24h Deadline Sweeper

**Ticket:** Sprint-2 ledger item (docs/planning/TEAM_ALLOCATION.md Sprint-2 band) — the contractual successor of DEV3-004's frozen lifecycle.
**Author:** orchestrator, round cron-r5. **Status:** in progress (backend slice this round; frontend affordance next).
**Binding contract sources (read FIRST, they outrank this file):**
- `docs/sessions/session-lifecycle.md` §Forward-contracts row DEV3-012 + §4 hold-as-debit ruling
- `docs/specs/open-decisions-and-gaps.md` B.2 (24h dual-confirmation timeout), B.4 (hold-as-debit; wallet-side lands here), D2 (claim sweeper ownership)
- `backend/db/schema/billing/wallet.ts` + `teacher-transaction.ts` (schema docblocks are load-bearing)

## R-201 — Student completion confirmation (participant-guarded)

WHEN a participant (student who owns the session, or the session's teacher) calls `confirmSessionCompletion(id)` on a session whose `status = completed` THEN the caller's stamp is written (`confirmed_by_student_at = now` for the student; the teacher's stamp was already set by `completeSessionOnce` and is never rewritten). The mutation is **idempotent**: a repeat confirm or a confirm on a session whose `fee_held` is already `false` returns the current session state and performs ZERO financial writes. Guards: pre-DB positive-safe-integer id; governance re-check on the acting user (deleted/blocked/suspended → `ForbiddenError`); oracle-safe probe vocabulary (`SESSION_NOT_FOUND` / `SESSION_INVALID_TRANSITION`) — a non-participant or non-completed session MUST be indistinguishable from a missing row at the wire.

## R-202 — Dual-confirmation credit (single atomic slice)

WHEN dual confirmation becomes true (`status = completed` ∧ `confirmed_by_teacher_at IS NOT NULL` ∧ `confirmed_by_student_at IS NOT NULL` ∧ `fee_held = true`) THEN in **ONE transaction**: (a) the guarded UPDATE flips `fee_held = false`; (b) the teacher's wallet row is ensured (`INSERT … ON CONFLICT (teacher_id) DO NOTHING` — schema docblock says "created when a teacher is approved", but no such writer exists yet, so the primitive is self-sufficient); (c) one `teacher_transaction` row is inserted (`type = earning`, `amount = session.fee` verbatim decimal string, `session_id` linked, `description` ≤255 chars, `wallet_id` linked); (d) the wallet's `balance` and `total_earning` increase by exactly `fee` (explicit guarded UPDATE — NO DB trigger exists; the schema docblock's trigger description is aspirational). INV-W1: the credit fires EXACTLY once per session (the `fee_held = true` predicate is the once-guard; zero-row on replay → no financial writes). INV-W2: `session.fee_held = false` rows never credit.

## R-203 — 24h deadline sweeper (B.2 auto-cancel)

A sweep operation cancels every session with `status = scheduled ∧ confirmation_deadline < now` in ONE guarded batch UPDATE `… RETURNING id, teacher_id, fee, held_balance_lane, fee_held`, and for each returned row with `fee_held = true` refunds the recorded `held_balance_lane` via the ONE shared same-lane primitive (`refundHeldLaneToProvenance` reuse — never a bespoke refund). Rows with `fee_held = false` (or a NULL lane — DEV1-era rows) change nothing financially. The deadline is never re-armed anywhere (B.2). The sweep is idempotent: a second run matches zero rows.

## R-204 — Wire surface

- `confirmSessionCompletion(id): Session!` — authScopes `{ authenticated: true }` byte-identical in shape to `cancelSession`'s; participant predicate is SERVICE-side (oracle-safe posture, same as the dispute pair).
- `POST /api/cron/sweep-sessions` — external-cron entry guarded by the `CRON_SECRET` bearer secret (env already carries `CRON_SECRET` / `CRON_EXECUTION_MODE` / `CRON_EXTERNAL_ENABLED`); disabled unless `CRON_EXECUTION_MODE=external ∧ CRON_EXTERNAL_ENABLED=true`; returns `{ cancelled, refunded }` honest counts; never leaks row identities beyond counts.

## R-205 — Containment

- No re-arming of `confirmation_deadline` anywhere (grep gate).
- No NEW enum members; no schema columns beyond an additive sweeper index if justified.
- Zero notification/audit/recitation/report writes (out of contract).
- Allowlist + gateway posture unchanged (the new mutation is authenticated, NOT public).
- SDL gates: `schema-surface` grows DEV3_012 pin blocks; freeze title extended; codegen-growth-only.

## Non-goals (this ticket)

- Student-confirm UI affordances + wallet admin views (frontend — next round, plan task 3.1).
- Claim-row expiry (D2 says "claims are harmless rows" — folded into the sweeper ONLY if trivial; otherwise forward).
- Plan-linked pricing (DEV3-013's forward contract — interim `SESSION_FEE_*` constants stand).
- Notifications (D1), payout/withdrawal surfaces, wallet admin CRUD.
