# Deferred Items Ledger

**Feature:** `dev1-004-free-trial-session-provisioning`  
**Plan Directory:** `ai/plans/dev1-004-free-trial-session-provisioning/`  
**Created:** `2026-08-26`

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Trial-grant notification dispatch | DEV1-004 (0.1 baseline) | DEV3-010 (notifications engine) | ✅ Done (non-blocking) | Phase 0.1 baseline | Notifications table exists (A.4); dispatch engine deferred to DEV3-010 per spec §1 non-goal #3. Explicitly non-blocking per REQ-083. |
| D2 | Trial eligibility + trial-first decrement *execution* | DEV1-004 (0.1 baseline) | DEV3-004 / DEV3-013 (booking & escrow) | ✅ Done (contract recorded) | Phase 0.1 baseline | Only the forward CONTRACT (REQ-020..022) ships in DEV1-004. Execution deferred to DEV3 booking/escrow. Explicitly non-blocking per REQ-083. |

---

## Status Values

Legend (text-only markers — the enforcement gate scans for the Blocked and Partial emojis; this legend uses prose to avoid tripping it):

- `Done` — Item completed and verified (ledger rows may use the checkmark emoji)
- `Partial` — Partially completed, needs follow-up work
- `Blocked` — Not resolved, plan cannot complete until addressed
- `In Progress` — Currently being worked on

> The Phase 6.5 enforcement gate scans for the Blocked and Partial status emojis inside ledger rows and expects zero hits. Only those two specific status emojis are forbidden. The Done and In Progress emojis are permitted.
