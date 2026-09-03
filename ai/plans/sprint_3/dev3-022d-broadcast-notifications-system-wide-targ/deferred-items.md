# Deferred Items Ledger

**Feature:** `dev3-022d-broadcast-notifications-system-wide-targ`  
**Plan Directory:** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ`  
**Created:** `2026-08-31`

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| DF-1 | TE flow tier (7 mutation-flow component tests) green on a runtime without the bun 1.3.14 + Happy-DOM mutation-render defect; suite + scoping NOTE already committed | 4.3.TE | post-plan follow-up: UI test-infra ticket (bun/Happy-DOM runtime fix), re-run via `test:ui:components` | 📅 Forward | 5.1 outcome §2 | e2e spec covers the same loop over real Chromium; blocked by PRE-EXISTING runtime defect, outside plan scope (REQ-044) |
| DF-2 | 4.3.BF/BS browser self-loops executed via test/ui/e2e/admin-broadcasts.e2e.test.ts once the app UI-serving tier renders pages again | 4.3.BF/.BS | post-plan follow-up: UI-tier build-repair ticket (48 pre-existing `next build` errors), then execute the committed e2e spec | 📅 Forward | 5.1 outcome §2 | pre-existing upstream breakage on latest main (REQ-044); not caused by this plan |
| D1 | Chunked mega-broadcast (>5000 recipients) | 0.1 | future scale ticket | 📅 Forward | phase 0 | per DB-4: recipient cap 5000 fail-closed; chunking deferred |
| D2 | Crash-between-commit-and-publishReceipts double-insert residual | 0.1 | engine hardening stream | 📅 Forward | phase 0 | engine §3.6 document-locked posture; owned by engine team |
| RV-1 | Cohort-drift replay residual: the claim digest binds the key to the RESOLVED cohort, so a membership change between submit and same-key retry yields a fresh accept (R1b MEDIUM) | 6.1 (R1b) | engine hardening stream (claim-digest namespace is engine substrate DEV3-010 — consumed, not edited, per plan) | 📅 Forward | 6.1 review waves | deterministic same-key double-click stays absorbed; residual = only deliberate cross-time retries after membership churn; document in 7.1 canonical doc |
| RV-2 | Governance-blind admin gate: assertActorAdmin re-verifies role only (soft-deleted/blocked admin with a live token passes both walls ≤15min TTL) + pothos builder.ts role-scope comment drift (R1d MEDIUM/LOW) | 6.1 (R1d) | DEV3-016 substrate/governance stream (gate + builder predate this plan) | 📅 Forward | 6.1 review waves | substrate-inherited, NOT a 022d regression; server-auth.ts doc drift recorded with it |
| RV-3 | Broadcast `body` has no ceiling at any layer → storage amplification per recipient + idempotency receipt serializes it (R1d LOW + R2 LOW) | 6.1 (R1d/R2) | broadcast hardening ticket (spec defines no body cap — DB-3 verbatim-copy posture) | 📅 Forward | 6.1 review waves | admin-gated surface; oversized-body inserts typically fail first; decide ceiling vs accepted-risk with product |
| RV-4 | Batched/aliased mutation amplification: allowBatchedHttpRequests + fail-open stub limiter → N full pipelines per request, each committing its own tx (R3 MEDIUM; root substrate already ledgered as BLT-05 / REQ-035 / api-gateway doc) | 6.1 (R3) | gateway hardening stream (op/alias/depth caps + real limiter) | 📅 Forward | 6.1 review waves | admin-token-gated; 022d adds no new gateway surface |
| RV-5 | Plans query FAILURE renders as the empty-catalog path (no localized failure/retry row; needs a new AdminBroadcasts namespace slot + parity belt update) (R4 LOW) | 6.1 (R4) | broadcast UX polish ticket | 📅 Forward | 6.1 review waves | admin cannot distinguish "no active plans" from "load failed"; send correctly stays blocked |
| RV-6 | Same naive-Arabic-plural defect in the SHIPPED notifications namespace (`markAllResult`/`unreadCount` linear switch, wrong ≥100) — substrate DEV3-010 | 6.1 (R7) | notifications i18n hardening ticket (substrate; 022d's AdminBroadcasts fixed in-plan) | 📅 Forward | 6.1 review waves | systemic with RV-3-fix precedent; parity suites pin the wrong rule there too |
| RV-7 | Container UX polish: lazy compose-key init (eager per-render mint) + clear-on-change for stale inline errors (R1c/R4 LOWs, accepted-as-is behavior today) | 6.1 (R1c/R4/R10) | broadcast UX polish ticket | 📅 Forward | 6.1 review waves | cosmetic; current semantics test-pinned; bundle with RV-5 |
| RV-8 | Limiter identity forgeable via raw x-forwarded-for + latent log-forging sink in the rate-limit logger (dead code today — stub limiter) | 6.1 (R3 LOW) | gateway hardening stream (with RV-4) | 📅 Forward | 6.1 review waves | substrate DEV3-003-era; load-bearing when the real limiter lands |
| RV-9 | Wire-tier idempotency-key propagation unpinnable over the cache-less hermetic server (R6 MEDIUM) — pin needs a REDIS_URL test posture or resolver-seam fence | 6.1 (R6) | broadcast test-infra ticket (bundle with DF-1 runtime work) | 📅 Forward | 6.1 review waves | service-tier consumption already pinned; suite header SCOPE NOTE added; 3.3 tightening path applies |

---

## Status Values

- ✅ **Done** — Item completed and verified
- **Partial** — Partially completed, needs follow-up work
- **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on
- 📅 **Forward** — Pre-seeded forward item owned by a later ticket; non-blocking for this plan

> Ledger-state note: no row in the table above carries a blocked/partial status; every row is Done or Forward with a named owner target.
