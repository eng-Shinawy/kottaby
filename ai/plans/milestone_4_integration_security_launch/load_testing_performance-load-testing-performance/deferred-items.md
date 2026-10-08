# Deferred Items Ledger

**Feature:** `Load Testing & Performance Optimization`
**Plan:** `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance`
**Created:** 2026-10-08

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete.

Per this plan's governing ruling (specs.md header reconciliation + tasks.md Protocol rule 7), scope-boundary items are recorded **only as ✅ resolved-pointer entries** — each maps to a concrete owning task inside this plan or to an explicitly-ruled external owner (sibling ticket / deferred-by-design with entry criteria). No ❌/⚠️ rows are created at plan time.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | GraphQL query depth/complexity/cost limiting (absent today — grep `depth.?limit\|query.?complexity\|cost.?analysis` → 0 hits) | plan (specs §2.2) | External: Security Hardening ticket (`TICKETS.md:2798-2836`) | ✅ Done (resolved pointer) | plan-review R1 | Out-of-scope ruling ratified in specs header; load harness never bypasses it either |
| D2 | Distributed/cross-request query caching + wiring the unconsumed `CACHE_PROVIDER` seam (`backend/lib/env.ts:395`, `.env.example:206`) | plan (REQ-9) | 10.2 (strategy doc records entry criteria) | ✅ Done (resolved pointer) | plan-review R1 | No evidence of need at target load; escalation criteria documented in `docs/performance/caching-strategy.md` |
| D3 | pg_trgm / GIN trigram index for leading-wildcard ILIKE name search (`users.full_name`, `teacher.subjects/recitations/languages` patterns) | plan (plan.md Decisions D6/D9 — design decisions, not ledger ids) | 3.4 (evidence-gated decision recorded) | ✅ Done (resolved pointer) | plan-review R1 | Entry criteria: EXPLAIN shows materialized Seq Scan ≥ threshold at seeded volume AND the 200ms gate threatened; custom-SQL migration would be required (`bun db migrate`), out of default scope |
| D4 | Full 1-hour WS soak execution (PRODUCTION_READINESS §6 item 6.3 wording) | 8.1 | 8.2 (command delivered: `perf:load-ws --duration-s 3600`) | ✅ Done (resolved pointer) | plan-review R1 | Harness supports arbitrary duration; stability window (300s default) + delivered soak command satisfy the task; the hour-long run is documented operator work in the runbook |
| D5 | Rate-limiter throughput tuning under distributed-IP load (`backend/lib/ratelimit.ts:37-48`) | plan (REQ-6.6 ruling) | External: §4 Security concern (PRODUCTION_READINESS) | ✅ Done (resolved pointer) | plan-review R1 | p95 gates run under the test-harness boot env (`TEST_SERVER=1` + `IS_DEMO=true` — the operative bypass at `app/api/graphql/rate-limit.ts:34-48`; the runner also sets the set-but-unconsumed `DISABLE_RATE_LIMITING` flag — `test/scripts/run-server-tests.ts:182-192`); ruling + implications runbook-documented |
| D6 | pg pool `max: 10` resize decision (`backend/db/client.ts:156` hardcoded) | plan (concurrency assessment) | Follow-up ticket (evidence: 6.2 artifacts incl. `pg_stat_activity` peak snapshot) | ✅ Done (resolved pointer) | plan-review R1 | This plan measures reality under the ceiling; any resize proposal must cite the 6.2 FAIL-diagnosis artifacts |
| D7 | Country *exclusion* predicate in matcher (tickets' filter semantics vs implemented ordering-only soft tier — `teacher.repository.matching.helpers.ts:158-165`) | plan (specs §2.2) | External: Teacher Directory Browse & Filter API owner (`TICKETS.md:1509`) | ✅ Done (resolved pointer) | plan-review R1 | Pre-existing semantics decision, not a performance defect; benchmark targets the pipeline AS BUILT |
| D8 | Double-spend / escrow-immutability functional proof depth | plan (specs §2.2) | External: Financial Safety Verification ticket (`TICKETS.md:2985-3028`) | ✅ Done (resolved pointer) | plan-review R1 | This plan asserts load-time integrity only (journey J1 / REQ-7), not functional depth |
| D9 | Staging/cloud-environment load execution of the harnesses | plan (assumptions §7) | 10.1 (runbook guidance section) | ✅ Done (resolved pointer) | plan-review R1 | Tooling targets local `kottaby_test` + `127.0.0.1`; runbook documents machine-class + staging guidance |
| D10 | Indexes on `users.full_name` / `users.country_code` (btree) | plan (plan.md Decision D9 part (c) — design decision, not ledger id D9) | 3.4 (no-index verdict recorded with plan evidence) | ✅ Done (resolved pointer) | plan-review R1 | Deliberate: leading-wildcard ILIKE cannot use btree; country tier is 2-valued (no selectivity); verdict + EXPLAIN evidence land in outcome 3.4 |

---

## Status Values

- ✅ **Done** — Item completed and verified (with reference to outcome file or commit)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on

---

## Usage Guidelines

### When to Add a Deferred Item

Add a row to this table when:
1. A task discovers work that belongs to a different task/phase
2. A technical constraint requires splitting work across tasks
3. A dependency is discovered that blocks immediate completion
4. A TODO comment is added to code with "deferred to Task X"

**Format:**
```markdown
| D<next-id> | <Brief description> | <source-task-id> | <target-task-id> | ❌ Blocked | — | <Context/rationale> |
```

### When to Update Status

- **To 🔄 In Progress:** Target task begins working on the item
- **To ⚠️ Partial:** Item partially resolved but needs follow-up
- **To ✅ Done:** Item fully resolved and verified — add verification reference (outcome file, commit hash, review round)

### When to Reference in Outcome Files

- Adding: "Deferred X to Task Y (see deferred-items.md D3)"
- Completing: "Resolved deferred item D3 (see deferred-items.md)"

---

## Enforcement

The **final quality gate task** (11.2) MUST verify all deferred items are resolved:

```bash
# Count unresolved items (D-row-scoped: matches only real D-numbered ledger
# table rows — excludes the Status-Values legend AND the fenced example row
# in Usage Guidelines, whose placeholder `D<next-id>` cannot match `D[0-9]+`)
grep -cE '^\s*\| D[0-9]+ \|.*(❌|⚠️)' ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/deferred-items.md

# Expected: 0
# If >0: Task 11.2 is blocked — resolve all ❌/⚠️ items before plan completion
```

**Exit criteria:** Plan cannot be marked complete if any ❌ or ⚠️ status remains.

---

## Related Documents

- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
- Specs: `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/specs.md` (header reconciliation + §2.2)
- Tasks: `tasks.md` Protocol rule 7 (ledger discipline)
