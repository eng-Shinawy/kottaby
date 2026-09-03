# Final Outcome — DEV3-005 Session Dispute States

**Plan:** `ai/plans/sprint_1/dev3-005-session-dispute-states/`
**Closed by:** orchestrator across three rounds (cron-r3 backend audit+close; suite-completion + verification round; close-out round). All work on `feat/dev3-004-session-creation-lifecycle-scheduled-sta` in `/home/z/feat-dev3-004`.

## Task ledger

| Task | Verdict | Evidence |
|---|---|---|
| 0.1 Baseline + deferred seed | [x] | `outcome/0.1-baseline.md`; `deferred-items.md` F1/F2 forward |
| 1.1 Schema (R-101) | [x] | cron-r3-be-outcome — 5 nullable columns verified on both DBs via information_schema |
| 1.2 Repository (R-102/104/106) | [x] | cron-r3-be-outcome — guarded single-UPDATE primitives, same-lane refund in-transaction |
| 1.3 Service (R-102/103/104/107/112) | [x] | cron-r3-be-outcome — probe-chain classifications, INV-S1/S2 regression, cancel-reason persistence |
| 2.1 GraphQL (R-105/106/108) | [x] | cron-r3-be-outcome — enum, 2 mutations + admin query, Session +5 fields, SDL pins, allowlist intact |
| 3.1 Student/teacher UI (R-109/110) | [x] | `outcome/3.1-outcome.md` — suites 31/63 tests 0 fail; parity 0 drift |
| 3.2 Admin UI (R-109/111) | [x] | `outcome/3.2-outcome.md` — page/container/row/dialog + 23-test suite; 6 hardenings |
| 4.1 Full gates + live loop | [x] | `outcome/4.1-outcome.md` — all gates green; BOTH arbitration outcomes verified live in a real browser incl. refund/hold-consume DB assertions; hydration clean |
| 5.1 Close-out | [x] | this file + scoped commits + push + worklog |

## Final gate state (all first-hand at close)

- `tsgo` exit 0 · biome 0 findings (96-file set) · oxlint 0/0 (301 rules)
- Component tiers: student 23/8/0 · teacher 63 tests 0 fail · admin 19/4/0 — all exit 0
- Parity: 20 tests / 0 fail / 493 expect
- Backend battery: 61 pass / 0 fail (wire tier run with the dev server paused per the documented port-3066 guard)

## Notable findings (documented for posterity)

1. **Runner-wedge family:** the resolve→SUCCESS cache-convergence path dead-ends the Happy-DOM runner (timer- AND microtask-starving allocation loop → OOM kill) independent of `fireEvent.submit` vs click-submitter and `addTypename` — instrumented proof shows zero Apollo activity before death (the wedge precedes the cache write). Skips carry INTACT bodies; the compensating live loop verified both outcomes. NOT a production defect (real browser converges instantly — verified).
2. **Accessible-name collision class:** disabled CTAs keep their accessible names, so role queries collide with "visible-but-disabled" variants — now fixed in the teacher matrix and documented (the student suite's disputed-row matrix coverage rides the same convention).
3. **Pre-existing latent footgun hardened:** list-filter cache modifiers MUST return the same reference when nothing matched (idempotence guard now on `removeSessionFromAdminQueue`).

## Deferred sweep (deferred-items.md)

- F1 (actor-id columns + audit entries) — ⏸ Forward, future ticket.
- F2 (post-completion dispute window) — ⏸ Forward, DEV3-022 conversation.
- No ❌/⚠️ residue.
