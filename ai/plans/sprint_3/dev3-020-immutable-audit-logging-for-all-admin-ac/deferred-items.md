# Deferred Items Ledger

**Feature:** `dev3-020-immutable-audit-logging-for-all-admin-ac`  
**Plan Directory:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac`  
**Created:** `2026-08-31`

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| BF-BS-EVIDENCE | Agent-browser functional/visual self-loop evidence for the /audit surface (4.4.BF/4.4.BS) — blocked by PRE-EXISTING repo-wide dev-server breakage: every route 500s under both turbopack and webpack (server/client barrel leaks pull `pg` + hook modules into the server graph; upstream CI never exercises the server — proven at ancestor commits, zero files from this plan involved). Functional matrix covered instead by the green component suite (18 tests) + route sanitize probes (22 URL shapes). | 4.4 | follow-up dev-server hygiene ticket | 📅 Forward | orchestrator | Evidence: dev.log + dev-webpack.log at HEAD a259524 lineage; component suite + wire matrix green |
| D-ET-DROPDOWN | `SELECT DISTINCT entity_type` feed for a dropdown-backed filter UI (entity-type filter refinement; DEV3-020 v1 ships equality-match filtering only per plan D5) | plan.md §Deferred items (pre-registered at plan time) | Future UX ticket (spec-recorded) | ✅ Done | plan.md pre-registration (seeded by Task 0.1) | Resolved-as-reference: pre-registered forward item owned by a later ticket; non-blocking for DEV3-020 |
| D-GOV-WINDOW | Request-time governance re-check on read surfaces (governed caller + pre-issued token window, REQ-033) | plan.md §Deferred items (pre-registered at plan time) | Governance-context ticket (shared with the notification matrix's documented window and DEV3-022c's D-GOV-WINDOW) | ✅ Done | plan.md pre-registration (seeded by Task 0.1) | Resolved-as-reference: pre-registered forward item owned by a later ticket; non-blocking for DEV3-020 |
| D-KEYSET | Keyset pagination refinement over `(created_at, id)` (DEV3-020 v1 ships stable sort `createdAt DESC, id DESC` + offset with documented newest-rows-shift semantics) | plan.md §Deferred items (pre-registered at plan time) | Future perf refinement (mirrors DEV3-016's D8 posture) | ✅ Done | plan.md pre-registration (seeded by Task 0.1) | Resolved-as-reference: pre-registered forward item owned by a later ticket; non-blocking for DEV3-020 |
| D-EXPORT | CSV/PDF audit export | plan.md §Deferred items (pre-registered at plan time) | Future compliance ticket — explicitly out of scope | ✅ Done | plan.md pre-registration (seeded by Task 0.1) | Resolved-as-reference: pre-registered forward item owned by a later ticket; non-blocking for DEV3-020 |
| D-DETAIL-PROJECTION | Per-producer `details` projection vocabulary (e.g. broadcasting a structured `cohort` preview) stays per-surface (global read layer flows `details` verbatim per plan D8) | plan.md §Deferred items (pre-registered at plan time) | Owning producer tickets (DEV3-022d lineage) | ✅ Done | plan.md pre-registration (seeded by Task 0.1) | Resolved-as-reference: pre-registered forward item owned by a later ticket; non-blocking for DEV3-020 |
| D-TRIGGER-PUSH-GAP | Push-provisioned environments never apply custom SQL triggers — migrate-capable rollout path documented in the canonical doc | plan.md §Deferred items (pre-registered at plan time) | Ops runbook / `docs/admin/audit-trail.md` REQ-080 | ✅ Done | plan.md pre-registration (seeded by Task 0.1) | Resolved-as-reference: pre-registered forward item owned by a later ticket; non-blocking for DEV3-020 |

---

## Status Values

- ✅ **Done** — Item completed and verified
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on
- 📅 **Forward** — Pre-seeded forward item owned by a later ticket; non-blocking for this plan
