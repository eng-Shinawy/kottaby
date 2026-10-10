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
| D2 | Distributed/cross-request query caching + wiring the unconsumed `CACHE_PROVIDER` seam (`backend/lib/env.ts:395`, `.env.example:206`) | plan (REQ-9) | 10.2 (strategy doc records entry criteria) | ✅ Done (resolved pointer) | plan-review R1 + outcome/10.2-caching-strategy-outcome.md | No evidence of need at target load; escalation criteria documented in `docs/performance/caching-strategy.md` (the doc IS this row's resolution target: seam proven parsed-but-unconsumed — zero `cacheProvider` consumers outside `env.ts` itself — with the D2 entry criteria + the 5-step when-to-cache funnel + the 6.2 idle-DB closing evidence) |
| D3 | pg_trgm / GIN trigram index for leading-wildcard ILIKE name search (`users.full_name`, `teacher.subjects/recitations/languages` patterns) | plan (plan.md Decisions D6/D9 — design decisions, not ledger ids) | 3.4 (evidence-gated decision recorded) | ✅ Done (resolved pointer) | plan-review R1 + outcome/3.4-matching-index-decision-outcome.md | Entry criteria: EXPLAIN shows materialized Seq Scan ≥ threshold at seeded volume AND the 200ms gate threatened; custom-SQL migration would be required (`bun db migrate`), out of default scope. 3.4 verdict: **entry criteria unmet** — name-search cells' users scan estimates 263 rows (< 1,000) and runs 1.9–3.1ms actual; no Phase-4 evidence; stays deferred (re-opens via 4.2 triage re-entry) |
| D4 | Full 1-hour WS soak execution (PRODUCTION_READINESS §6 item 6.3 wording) | 8.1 | 8.2 (command delivered: `perf:load-ws --duration-s 3600`) | ✅ Done (resolved pointer) | plan-review R1 + outcome/10.1-runbook-outcome.md | Harness supports arbitrary duration; stability window (300s default) + delivered soak command satisfy the task; the hour-long run is documented operator work in the runbook (§6.3 soak subsection: command, budget ≈65 min, preconditions) |
| D5 | Rate-limiter throughput tuning under distributed-IP load (`backend/lib/ratelimit.ts:37-48`) | plan (REQ-6.6 ruling) | External: §4 Security concern (PRODUCTION_READINESS) | ✅ Done (resolved pointer) | plan-review R1 | p95 gates run under the test-harness boot env (`TEST_SERVER=1` + `IS_DEMO=true` — the operative bypass at `app/api/graphql/rate-limit.ts:34-48`; the runner also sets the set-but-unconsumed `DISABLE_RATE_LIMITING` flag — `test/scripts/run-server-tests.ts:182-192`); ruling + implications runbook-documented |
| D6 | pg pool `max: 10` resize decision (`backend/db/client.ts:156` hardcoded) | plan (concurrency assessment) | Follow-up ticket (evidence: 6.2 artifacts incl. `pg_stat_activity` peak snapshot) | ✅ Done (resolved pointer) | plan-review R1 | This plan measures reality under the ceiling; any resize proposal must cite the 6.2 FAIL-diagnosis artifacts |
| D7 | Country *exclusion* predicate in matcher (tickets' filter semantics vs implemented ordering-only soft tier — `teacher.repository.matching.helpers.ts:158-165`) | plan (specs §2.2) | External: Teacher Directory Browse & Filter API owner (`TICKETS.md:1509`) | ✅ Done (resolved pointer) | plan-review R1 | Pre-existing semantics decision, not a performance defect; benchmark targets the pipeline AS BUILT |
| D8 | Double-spend / escrow-immutability functional proof depth | plan (specs §2.2) | External: Financial Safety Verification ticket (`TICKETS.md:2985-3028`) | ✅ Done (resolved pointer) | plan-review R1 | This plan asserts load-time integrity only (journey J1 / REQ-7), not functional depth |
| D9 | Staging/cloud-environment load execution of the harnesses | plan (assumptions §7) | 10.1 (runbook guidance section) | ✅ Done (resolved pointer) | plan-review R1 + outcome/10.1-runbook-outcome.md | Tooling targets local `kottaby_test` + `127.0.0.1`; runbook documents machine-class + staging guidance (dedicated "Staging / Cloud Re-execution Path" section incl. the guard-interplay warning: staging DB named `kottaby_test`, or `--force-prod-shaped-target` where plumbed) |
| D10 | Indexes on `users.full_name` / `users.country_code` (btree) | plan (plan.md Decision D9 part (c) — design decision, not ledger id D9) | 3.4 (no-index verdict recorded with plan evidence) | ✅ Done (resolved pointer) | plan-review R1 + outcome/3.4-matching-index-decision-outcome.md | Deliberate: leading-wildcard ILIKE cannot use btree; country tier is 2-valued (no selectivity); verdict + EXPLAIN evidence landed in outcome 3.4: the 3 plain-variant users seq scans (1931 ≥ 1,000) are the D10-adjudicated surface — the scan filter (`is_deleted/suspended/is_blocked`, ~91% match) has no plan-prescribed index; no users index added |
| D11 | Pre-existing `test/workflows` layer red (56 failures across 9+ suites — audit-trail/broadcast/onboarding/cooldown domains) present BEFORE Task 7.1 ran | 7.1 (observed during the full-layer proof) | External: pre-existing baseline, not this plan's scope (sibling streams + immutable-audit residue; e.g. failure stack at `backend/services/admin/audit-trail.service.ts:72`) | ✅ Done (resolved pointer) | outcome/7.1-journey-j1-outcome.md | Failing-suite multiset byte-identical before vs after 7.1 (56 → 56; historical layer logs `2026-10-09T01-58-59` / `02-10-52` vs `02-40-05`); the 11.2 gate MUST diff the workflows layer against this baseline, not zero |
| D12 | knip `Unused exports` finding `authIdentityLimiter` (`backend/lib/ratelimit.ts:72`) makes `bun run check:unused` exit 1 — the file is mid-edit by a CONCURRENT sibling stream (git-status `M`, listed in the 0.1 drift file set) | 1.3 (observed while adding the knip `pg-connection-string` entry for the guard's parity oracle) | External: sibling plan stream owning `backend/lib/*`; NOT this plan's write scope (0.1 drift note forbids touching it) | ✅ Done (resolved pointer) | outcome/1.3-auth-mint-guard-outcome.md | The only remaining `check:unused` finding after Task 1.3's own knip entry landed; sibling-owned file, expect it to resolve when that stream completes; the 11.2 gate must attribute it to the sibling baseline if still present |
| D13 | `surah_juz_ref` enum-order drift on `kottaby_test` blocks the 3.2 push: every `drizzle-kit push` bundles a `recreate_enum` (home_work.current_surah_juz / revision_surah_juz) alongside the four FK `create_index` statements — migration `20261006205033_keen_madame_masque` appended 109 surahs via `ALTER TYPE ADD VALUE` (Postgres appends only) while `backend/db/schema/enums.ts:124` declares canonical order; value SET identical (cast-preserving); no `missing_hints`/`confirm_data_loss`; `--tablesFilter` cannot exclude global enum diffs (dry-run-verified) | 3.2 (observed at the push step; schema edits are done + QL-green, push NOT forced per the task's stop rule + `plan.md:381` "no NOT NULL/enum/type changes") | 3.2 remainder (orchestrator ruled option (a): sanction the bundled push — dev-DB precedent, zero data risk, converges kottaby_test to canonical schema) | ✅ Done (resolved pointer — Resolution section in outcome/3.2-fk-indexes-outcome.md) | outcome/3.2-fk-indexes-outcome.md | Push executed in a verified quiet window: `bun run db push --env-file=.env.test` → exit 0; home_work 2 rows before → 2 after; enum converged to canonical [114 surahs, 30 juz]; 4 indexes in catalog; after-evidence `perf:verify-indexes` exit 0, zero uncovered, `observedMatchesBaseline: false` |
| D14 | §6 item 6.1 API load gate **FAIL on local hardware**: all 7 scenarios breached p95 < 500ms @100 VUs (p95s 2,473–4,288ms; zero errors; `pg_stat_activity` peak non-idle = 0 across 33 samples — DB idle). Bottleneck = **server-side CPU saturation of the single-process `next start` server** (bcryptjs pure-JS 12-round login compare — `backend/lib/auth/password.ts:12`, hardcoded, no env override; `backend/services/auth/auth.service.ts:188` — plus GraphQL execution serialized on one process; `scripts/perf/lib/load-api-server.ts:52-84`); superlinear collapse 10 VUs → 100 VUs (10–17×); in-scope levers exhausted (3.4 indexes NO-CHANGE; 5.x N+1 complete, ≤6 round trips — yet my-subscriptions p95 4,288ms with idle DB); no env-only lever exists (no bcrypt/work-factor key in `backend/lib/env.ts` or `.env.test`; no `next start` cluster knob); machine-class context: 16 cores, load ≈ 4–6.7 w/ sibling streams, 15GiB RAM under swap pressure, load generator same-host (specs §7 comparative ruling) | 6.2 (triage agent, per tasks.md 6.2 FAIL prescription "anything else → ledger with evidence") | 10.1 (runbook documents staging/cloud re-execution per D9 — the designed path to a passing §6 6.1 row); out-of-scope follow-ups (bcrypt rounds reduction / native bcrypt binding / multi-process deployment) require code-or-infra changes owned outside this plan | ✅ Done (resolved pointer — Triage section in outcome/6.2-load-api-evidence-outcome.md) | outcome/6.2-load-api-evidence-outcome.md + `logs/perf/2026-10-09T21-00-14_load-api/` (100-VU FAIL evidence) + `logs/perf/2026-10-09T21-10-52_load-api/` (10-VU contrast) + outcome/10.1-runbook-outcome.md (runbook carries the FAIL-local row + the staging/cloud re-execution path + the out-of-scope lever list) | §6 6.1 evidence row = **FAIL-local** (honest verdict retained in the bundle); staging/cloud re-execution per D9 → runbook 10.1; REQ-6.4 booking accounting SATISFIED (603 created + 50 translated domain rejections + 0 transport @100 VUs); seed `196f67b5` kept live for 9.1, then cleaned to TOTAL RESIDUE 0 by 10.1 (tool + independent SQL re-probe) per the 9.1 carry-forward |
| D15 | Cross-stream code clone flagged by `check:duplicates`: `scripts/load/ws-soak.ts` [129:1–143:6] ↔ `scripts/perf/load-ws.ts` [57:1–71:6] — 15 lines / 75 tokens, the Bun-WebSocket constructor runtime-narrowing bridge (`isBunWebSocketConstructor` + `resolveBunWebSocketConstructor` + the module-scope constructor binding) that both WS harnesses legitimately need. `scripts/load/*` is owned by the sibling launch-gate stream (its §6 6.3 sign-off cites `scripts/load/ws-soak.ts`) and is on this plan's never-touch list | 11.2 (final gate observed the clone at DUPLICATES stage) | External: sibling plan stream owning `scripts/load/*` (the launch-checklist executor's WS soak harness); this plan's `scripts/perf/load-ws.ts` (Task 8.1) is the in-plan twin and was NOT modified — extracting the bridge to a shared module cannot clear the gate without editing the sibling-owned copy | ✅ Done (resolved pointer) | outcome/11.2-final-gate-outcome.md | 11.2 attribution: the clone is sibling-owned external noise; this plan's own duplicate findings (load-api-cli ↔ load-ws-cli scan loop; load-api ↔ load-ws report seam) were FIXED in 11.2 by extracting `scripts/perf/lib/cli-flag-scan.ts` + `scripts/perf/lib/report-seam.ts` (AGENTS-mandated extraction; zero `jscpd:ignore`); per-file jscpd on `load-ws.ts` confirms the ONLY remaining clone pairing is against the sibling file |
| D16 | Untracked build-output directory `.next-dev-smoke/` (created by the sibling launch-gate stream's smoke build; not in `.gitignore`, not in `.jscpd.json`'s ignore list, and `biome.json`'s includes block covers `.next`/`.next-dev`/`.next-test*` but not `.next-dev-smoke`) produces repo-wide tool noise: `bun biome:check` fails with 4,955 errors + 4,700 warnings (all in Turbopack-generated chunks, e.g. `dev/server/chunks/backend_db_000fk5z._.js` — unfixable generated code) and `check:duplicates` flags a self-clone in `dev/types/validator.ts` [14:7–28:5 ↔ 31:34–45:5]. Zero diagnostics in any tracked source file (verified by per-file attribution) | 11.2 (final gate observed the noise at the biome and duplicates stages) | External: sibling launch-gate stream owns the build dir; resolution is owner-side — delete the build output or add `/.next-dev-smoke/` to `.gitignore` (biome's `vcs.useIgnoreFile` then skips it); modifying `.jscpd.json` is repo-barred (AGENTS) so the jscpd-side fix is owner-side too | ✅ Done (resolved pointer) | outcome/11.2-final-gate-outcome.md | 11.2 attribution: biome + jscpd findings in `.next-dev-smoke/` are pre-existing since 2026-10-09 (documented as "exclusively pre-existing .next-dev-smoke build-chunk noise" in outcome/10.1-runbook-outcome.md); the baseline (0.1) biome run predates the directory and was clean; every OTHER tracked file is biome/oxlint/tsgo/lint-clean as of this gate |
| D17 | Flaky hostile-search payload-matrix tests in the `test:services` layer (sibling security-hardening commit `ec323200` — files unchanged since): `backend/services/admin/teacher-directory.service.test.ts` + `backend/services/teachers/teacher-matching.service.test.ts` assert `expect(await tx.$count(users)).toBe(usersBefore)` — a GLOBAL users-table count taken across two separate statements inside one READ COMMITTED transaction — so any parallel suite that commits a users-row write between the two statements fails the test (observed: ±1 and ±14 count mismatches, a different payload/test each run). Three full `test:services` runs each surfaced exactly 1 such transient failure; BOTH suites pass green in isolation (`33 pass / 0 fail` and `73 pass / 0 fail` via `run-test.ts`). Not a product regression, not in this plan's write scope (neither service, nor the test files, was modified by this plan) | 11.2 (full-suite sanity observed the flakes across 3 runs) | External: sibling security-hardening stream owns the test design (per-suite scoped counts or serial execution would fix it); this plan's own service suites contribute zero failures in all 3 runs | ✅ Done (resolved pointer) | outcome/11.2-final-gate-outcome.md | 11.2 attribution: test:db 1568/1568 ✅, test:graphql 385/385 ✅, workflows layer ⊆ D11 baseline ✅, test:services 2225/2226 ×3 with the 1 failure being this sibling-owned transient each time — the D11 shared-DB-race class in a new sibling suite; re-run-at-quiet-moment performed twice per the gate brief |

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
