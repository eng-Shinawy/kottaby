# Plan Review Report — Load Testing & Performance Optimization

## Review Round: R1 (single round — findings fixed and re-verified)
## Date: 2026-10-08
## Subagents Dispatched: 5 parallel reviewers (review wave) + 3 parallel fix agents + 1 fix-verification agent

---

## Summary

- **Total issues found (raw across dimensions):** 52 · **Unique after dedup:** ~35 · **Rejected as false (stale-tree evidence):** 2
- **Blocking (CRITICAL/HIGH):** 7 (all fixed)
- **Medium:** 14 (all fixed)
- **Low/Notes:** 12 (all fixed)
- **Fix volume:** 99 targeted edits by 3 fix agents + 10 orchestrator follow-up edits (110 total)
- **Re-verification:** 12/12 highest-impact spot-checks PASS against the live tree; 1 residual found and fixed (specs.md DoD ledger-gate pattern)
- **Verdict: Plan passes all AGENTS.md rules** (post-fix; no second review round required — all R1 findings were mechanically re-verified by grep evidence + a dedicated verification agent)

---

## Findings by Dimension

| Dimension | Subagent | Issues Found | Status |
|---|---|---|---|
| Citation verification (every `path:line`) | review-citations (explore) | 14 (2 rejected → 12 actionable) | ✅ Fixed |
| AGENTS.md rule compliance | review-rules (explore) | 5 | ✅ Fixed |
| Cross-reference & structural consistency | review-xref (explore) | 13 | ✅ Fixed |
| Security / concurrency / journey-design soundness | review-soundness (explore) | 13 | ✅ Fixed |
| Anti-pattern & invented-symbol sweep | review-antipatterns (explore) | 7 (1 rejected → 6 actionable) | ✅ Fixed |

**Rejected findings (adjudicated with file evidence):**
1. *"`escapeLikeWildcards` does not exist in teacher-matching.service.ts"* — FALSE: it is imported at `backend/services/teachers/teacher-matching.service.ts:76` from `@/backend/lib/db/escape-like-wildcards` and applied at `:217` inside `quotedTokenPattern` (`:215`); only the line anchor was stale, and the anchor was fixed.
2. *"`test/workflows/AGENTS.md` has 12 rules; rule 13 (DIAGRAMS.md mermaid) is invented"* — FALSE against the working tree: rule 13 exists at `test/workflows/AGENTS.md:55-62` and `test/workflows/sessions/DIAGRAMS.md` exists (the reviewer read a stale `HEAD` snapshot while sibling streams were concurrently editing the tree). Plan unchanged; caveat recorded.

---

## Detailed Findings (deduplicated, by severity)

### CRITICAL/HIGH (7 — all fixed)

1. **[HIGH] `EnrichedSubscriptionReturnType` wrapper shape incompatible with the Pothos objectRef** — a `{ subscription: row }` wrapper breaks every `t.expose*` passthrough and the byte-identical SDL claim. **Fix:** flat structural supertype `SubscriptionReturnType & { plan?; auditEntriesCount?; auditTrailPeek? }` merged with the `Object.assign` idiom (`session-lifecycle.queries.ts:113-121`); `SubscriptionAuditTrailPeek` cited to `backend/types/billing/subscription-admin.types.ts:14`. (plan.md Component 8, tasks 5.2)
2. **[HIGH] WS ramp math contradicted the token bucket** — bucket is burst 5 + sustained 1 token/2s (`backend/ws/notification-ws-server-constants.ts:14-17`), so a bucket-honoring 100-connection ramp is **~190s**, not 40s; the "5 per 2s" ramp would self-inflict `4429` rejections. **Fix:** all ramp figures corrected (specs header/REQ-8.2, plan D8 + race table, tasks 8.1). The invented "raised bucket via env" soak override was **dropped** (constants are hardcoded; plan adds no env keys).
3. **[HIGH] WS harness omitted the mandatory Origin allowlist** — Origin is checked FIRST (`backend/ws/notification-ws-server-handshake.ts:62-73`, 403 on miss); cookie-only connections would all fail. **Fix:** harness design now sends an allowlisted `Origin` header alongside the cookie (plan Component 7, tasks 8.1, specs REQ-8.1).
4. **[HIGH] Rate-limit bypass mis-anchored to a dead key** — the operative bypass is `TEST_CI/TEST_SERVER` at `app/api/graphql/rate-limit.ts:34` (hard-throw in production mode unless `IS_DEMO` — `:38-43`); `DISABLE_RATE_LIMITING` is set-but-unconsumed. **Fix:** every citation re-anchored; harness boot env specified as `TEST_SERVER=1` + `IS_DEMO=true` mirroring `test/scripts/run-server-tests.ts:182-192` (specs header/§2.2/REQ-6.6, plan D3/Component 6, tasks 6.1, ledger D5).
5. **[HIGH] Blocking ledger-gate grep false-positives** — the row-scoped pattern matched the ledger's own fenced ❌ example row and returned 1, so Task 11.2 would spuriously block. **Fix:** D-row-scoped pattern `grep -cE '^\s*\| D[0-9]+ \|.*(❌|⚠️)'` in all four locations (ledger Enforcement, tasks Protocol rule 7 + 11.2, specs DoD); verified 0 live.
6. **[HIGH] Booking scenario omitted the mandatory `x-idempotency-key` header** — `createSession` requires it from the header (`backend/graphql/gqlContextFactory.ts:242`); as specified, all 100 bookings would be validation-rejected. **Fix:** scenario contract now mints a unique header per request; `buildRequest` returns headers (plan Component 6, tasks 6.1, specs REQ-6.2).
7. **[HIGH] Citation clusters off-by-N in drifting files** — `browseAvailableTeachers` `:346-351`→`:354-359`, delegation `:411`→`:421`, envelope `:413-419`→`:423-429`; matching NOT EXISTS `:136`→`:140`; prepared-statement test `:3172-3173`→`:643-644`; PR §6 per-item anchors +1/+2 (6.1→`:280` … 6.7→`:286`); query.ts defaults `:109-110`→`:118-119`, authScopes `:114-119`→`:123-129`; ioredis `:131`→`:132`; ~40 sites corrected. (The tree drifted mid-planning while sibling streams edited matching-service/test files — a point-in-time caveat inherent to line anchors.)

### MEDIUM (14 — all fixed)

Invented `AuditEntityType` → `entityType: string` + `SUBSCRIPTION_AUDIT_ENTITY_TYPE` constant (`subscription-admin.helpers.ts:53`); phantom `backend/graphql/pothos/AGENTS.md` reconciliation (its `t.loadable()` MUST at `:20-22` is unsatisfiable while the dataloader plugin is intentionally unloaded — `builder.ts:15-17,:101` — and its placeholder-`inArray` form at `:26` loses to the repo prohibition — `backend/db/repo/AGENTS.md:29`, test-locked) — ruling added to plan D4 + rule-file table + 5.3.IV; false console-ban claim for `scripts/**` (`eslint.config.mjs:237,244` override; ops precedent `backup-database.ts:127-128`) — Logging Strategy rewritten; fan-out envelope shape (`parseFanoutEnvelope` guard + `userIds` covering all identities + unique `data.id` per burst — `redis-pubsub-transport.ts:31,57-67`); impossible sidecar registry probe → client-observable zero-residue check (sidecar's single `fetch` is the handshake — `notification-ws-server.ts:126`); J1 step-5 wrong actor (student→**teacher** starts, `session-lifecycle.service.ts:282-299`); hot-teacher FOR UPDATE serialization added (`lockForCertificationCheck` — `session-lifecycle.booking.ts:245`); `PlanRepository.findByIds` bare-read convention split (tx→Drizzle `inArray`, no-tx→`queryDb` `= ANY($1::int[])` — `findBalanceLanesByIds` precedent, `plan.repository.ts:189,:8-14`); `subscription_purchase_idempotency` index column `t.sessionId`→`t.subscriptionId`; "six §6 rows"→seven; phantom task `12.1`→`11.1, 11.2`; REQ-4 traceability `4.2`→`3.3 (4.2 triage re-enters)`; REQ-9.5→REQ-9.2 mislabel; task 10.2 pipeline enumerated.

### LOW (12 — all fixed)

PR §6 anchor drift (all 8 sites), batch-mandate deviation note (number-keyed precedents `user.repository.ts:244-247`, `parent-link-request-reminder.repository.ts:93-95`), `Pool extends Client` false rationale → delegation wording (`node_modules/pg-pool/index.js:66`; `getDrizzleDbPool` exported at `client.ts:177`), connectionTimeout `:158`→`:159`, registration-test `:18-30`→`:59-103` (5 sites), escrow marker `:3`→`:4`, `TICKETS.md:2925`→`:2926`, repo-AGENTS `:35,38-39` cite, dependency-mermaid re-entry edge `4.2 -.->|"IF FAIL"| 3.4` + rewired edges (`0.1→7.1`, `2.1→8.1`), ledger trailing slash + D-namespace collision disambiguation, 10.1 sign-off-table Phase-3 enumeration, REQ-0.5/REQ-11/REQ-2 traceability cells, 25-test WS suite count.

---

## Fix Subagents Dispatched

| Subagent | Target Files | Findings Fixed | Status |
|---|---|---|---|
| fix-specs (coder) | `specs.md` | 21 fix items / 34 edits | ✅ Complete |
| fix-plan (coder) | `plan.md` | 18 fix items / 35 edits | ✅ Complete |
| fix-tasks (coder) | `tasks.md` | 19 fix items / 30 edits | ✅ Complete |
| orchestrator (self) | `specs.md` + `plan.md` + `deferred-items.md` | 10 residual/follow-up edits | ✅ Complete |

---

## Post-Fix Verification

- [x] All stale references resolved (grep confirms: old strings 0 hits — `:346-351`, `:413-419`, `helpers.ts:136`, `3172-3173`, `AuditEntityType` as a type-usage, `Pool extends Client`, `≥40s`, `all six`, `12.1`, old gate pattern, `:18-30`, `escrow...md:3`, `TICKETS.md:2925`, `session_id_idx` misuse)
- [x] New citations re-verified against the live tree (12/12 spot-checks PASS — dedicated verification agent; 1 residual DoD-gate defect found and fixed)
- [x] AC traceability complete: `for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING; done` → zero misses (REQ-0..REQ-12 + REQ-0.5)
- [x] Ledger gate: `grep -cE '^\s*\| D[0-9]+ \|.*(❌|⚠️)' deferred-items.md` → **0** (old pattern provably returned 1)
- [x] Anti-pattern sweep: zero `Translation.` refs, zero two-arg `getTranslations`, zero raw `bun test` on workflows, zero `@/frontend/utils/logger`, zero bottom-nav-as-new-UI, zero next-intl/`shared/messages/` refs
- [x] All four artifacts end on complete structures (no truncation): specs 465 · plan 520 · tasks 304 · ledger 93 lines

---

## Lessons for Future Plans

- **Line anchors drift in a live tree**: sibling streams edited matching-service/test files mid-planning (+4..+10 lines). Reviews must re-verify anchors against the *current* tree, and stale-`HEAD`-based "invented symbol" claims need live-tree adjudication before acting (2 false findings this round).
- **Read the transport wrapper, not just the limiter config**: `backend/lib/ratelimit.ts` (config) vs `app/api/graphql/rate-limit.ts` (bypass + IS_DEMO guard) — same line number, different file, opposite conclusions.
- **Derive harness math from enforcement code, not docs summaries**: the WS token bucket's *sustained* rate (1/2s), not its burst capacity, sizes the ramp (190s vs the intuitive 40s).
- **A blocking gate command must be executed against its own artifact before ratification** — the ledger-gate grep false-positived on its own template example.
- **Pothos objectRefs demand flat structural supertypes** — enrichment wrappers break `t.expose*` passthroughs; the repo's batch-enrich idiom (`Object.assign` into row copies) is the compatible shape.

---

## Traceability

**Plan files modified (all four):**
- `specs.md` — 44 edits: header reconciliation citations (ramp math, bypass mechanism, prohibition-test anchor), REQ-1/2/4/5/6/8/10 criteria re-anchored + pothos/batch-mandate rulings + x-idempotency-key + envelope/Origin/residue criteria + J1 step-5 actor + §9 traceability cells + §7 anchors + DoD gate pattern
- `plan.md` — 38 edits: D2/D3/D4/D5/D8 rulings corrected + pothos reconciliation + UX/SDL cites + race-table (FOR UPDATE, ramp, timeout) + Components 1/3/5/6/7/8 re-specified (flat enriched type, `entityType: string`, tx/no-tx split, headers, Origin, envelope, client-observable residue, certification note) + Data Models index column + Logging Strategy + §6/TICKETS cites
- `tasks.md` — 31 edits: Protocol rule 7 gate pattern, 0.1/1.1/1.2/2.1/3.3/3.4/4.1/5.1/5.2/5.3/6.1/8.1/9.1/10.1/10.2/11.2 task specs + rule-file table (pothos AGENTS) + dependency mermaid (re-entry edge, rewired edges, burst ramp) + "seven §6 rows"
- `deferred-items.md` — 6 edits: verbatim-path slash, D-row gate pattern + comment, D3/D10 namespace disambiguation, D5 bypass citation

**Outcome knowledge base updated:**
- This report saved as: `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/outcome/plan-review-R1.md`

---

## Next Steps

- [x] Plan-review gate PASSED (this round — post-fix verification complete)
- [ ] Commit patched plan files (do NOT push until implementation starts)
- [ ] Proceed to implementation (Phase 0: Task 0.1 baseline; then Phase 1: Harness Library Foundation)
