# Deferred Items Ledger — DEV3-005

**Feature:** `dev3-005-session-dispute-states`
**Created:** `2026-08-31`

| ID | Deferred Item | Source Task | Target Task | Status | Notes |
|---|---|---|---|---|---|
| F1 | Dispute actor-id columns (`disputed_by`, `resolved_by`) + audit-log entries for open/resolve | 0.1 (pre-declared) | Future ticket | ⏸ Forward | Arbitration v1 is actor-derivable from context; audit enrichment needs the audit surface conventions |
| F2 | Post-completion dispute window (dispute reachable from `completed`) | 0.1 (pre-declared) | Future ticket (DEV3-022 conversation) | ⏸ Forward | Requires amending DEV3-004's INV-S1 structural terminal ruling — out of scope here by specs.md boundary |

**Status values:** ✅ Done · ⚠️ Partial · ❌ Blocked · 🔄 In Progress · ⏸ Forward (neutral, non-blocking)
