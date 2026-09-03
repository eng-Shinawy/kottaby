# SUMMARY-Outcome — DEV3-022d Broadcast Notifications (System-Wide & Targeted)

**Plan:** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/`
**Branch:** `feat/dev3-022d-broadcast-notifications` · **Spec type:** Full spec (plan-review PASS-with-notes at R1; all findings dispositioned)
**Closed:** 2026-09-02 · **Outcome files:** 30 (this synthesis included)

## 1. Requirements traceability (55 unique REQs → evidence)

| Domain | Requirements | Evidence |
|---|---|---|
| Baseline + prerequisites | REQ-001, REQ-002 | `outcome/0.1-baseline-outcome.md` (tsgo 0/biome 0/lint 0, empty diff) · `outcome/0.2-prerequisites-outcome.md` (16/16 substrate artifacts verified at corrected anchors, zero BLOCKED) |
| Types, i18n, enums | REQ-003, REQ-004, REQ-010 (DB-1) | `outcome/1.1..1.4` — TS-only enum + guard (25 tests), closed selector/input shapes, contract widening, 4 ErrorsLabels keys (parity 8/0), AdminBroadcasts namespace 27 keys en/ar (parity 54/0), dashboard `broadcasts` label |
| Cohort resolution | REQ-011, REQ-012, REQ-013, REQ-014, REQ-015 (INV-U1/U2/U4) | `outcome/2.1` + repo suite (19 tests: four kinds, exact-match country, active-window plan predicate on generic owner FK, governance exclusion — deleted/blocked OUT, suspended IN) |
| Determinism, cap, empty cohort | REQ-016, REQ-017, REQ-018 | id-ASC ordering; 5000 fail-closed pre-DB (service guards + tests); zero-recipient localized rejection with zero state |
| Copy, audit, publish, idempotency | REQ-019, REQ-020, REQ-021 (DB-5, JR-C-1), REQ-022, REQ-023, REQ-024 | `outcome/2.3` (RedisClaimCache 24 tests) + `outcome/2.4` (service matrix 16 tests: verbatim copy, metadata-only audit `entityType:"notification_broadcast"`/`entityId:null`, publish-after-commit, replay ⇒ prior count zero-state, fail-open ladder, forced-rollback atomicity) |
| Pothos/mutation surface | REQ-027, REQ-029, REQ-030 (D10), REQ-031, REQ-032 (D11), REQ-033, REQ-034, REQ-035 | `outcome/3.1..3.3` — enum/input registration, `$all` double wall + live-row re-verification, no identity-arg surface, closed whitelist inputs, PLAN_NOT_FOUND scope confinement, no pre-send count oracle, log hygiene; wire integration 8/0 (UNAUTHORIZED/FORBIDDEN/BOPLA probes) |
| Layer integrity | REQ-040, REQ-041, REQ-042, REQ-043, REQ-044 | single-writer engine insert; delegation purity; tx/savepoint propagation (service test); schema/migration/gateway drift diffs **EMPTY** at 5.2; plan-catalog & handshake pre-existing failures isolated (report-only) |
| Validation + labels + nav | REQ-050, REQ-051, REQ-052, REQ-055, REQ-060, REQ-061, REQ-062 | localized rejection codes (4 flat keys, bounds 1–255/100); nav single-ADD `/admin/broadcasts` after `/audit` (26 tests, non-admin blocks byte-identical to pristine base); server guard + redirect |
| Compose surface | REQ-063, REQ-064, REQ-065, REQ-074 | `outcome/4.1..4.4` — codegen document + authLink additive header merge (64/0), server page guard (6/0), compose UI (Tier-1 suite green incl. copy-preservation pin; flow tier + browser loops environment-blocked → DF-1/DF-2), a11y (aria-busy, focus rings, 44px floors, aria-describedby) |
| Full suite + security tier | REQ-070, REQ-071, REQ-072, REQ-073, REQ-075 | `outcome/5.1` — all affected layers green (counts in §3); security-tier closure table (hostile inputs, BFLA incl. second admin, replay no-double-insert, sequential same-key ⇒ ONE row-set, corrupt receipt fail-open); coverage: 100% statements in-process, branch gaps = type-unreachable guards/env-gated handler/child-process wire code |
| Baseline gates | REQ-076 | `outcome/5.2` — **all deltas ZERO** (§2 below); freezes intact; ledger grep gate = 0 |
| Knowledge propagation | REQ-080, REQ-081 | `outcome/7.1` (canonical doc `docs/notifications/broadcast-notifications.md`) + `outcome/7.2` (services/repo/root AGENTS.md one-liners; engine §3.2 row flipped SHIPPED) |
| Synthesis/closure | REQ-082 | this document |

## 2. Baseline → final gate deltas — ALL ZERO

| Gate | Baseline (0.1) | Final (post 7.2) | Delta |
|---|---|---|---|
| tsgo | 0 | 0 (exit 0) | **0** |
| biome:check | 0 | 0 (exit 0) | **0** |
| lint | 0 | 0 (exit 0) | **0** |
| check:duplicates | 0 | 0 (per-file sub-loop exit 0) | **0** |
| Schema/migration drift | empty | empty | **0** |
| public-operations freeze | empty | empty | **0** |
| deferred-items ❌/⚠️ grep | 0 | 0 | **0** |

## 3. Journey steps 1–10 → passing evidence

`test/workflows/notifications/admin-broadcast.journey.test.ts` — **29 pass / 0 fail** across the notifications journey files (10/10 for this journey):

1. all-cohort fan-out + governance exclusion + ONE audit row + ONE envelope — PASS
2. same-key replay ⇒ identical count, zero new rows/audit/publishes — PASS
3. role cohort ⇒ only teacher; others byte-identical — PASS
4. targeted country cohort (run-unique sentinel) ⇒ exact-equality only — PASS
5. plan cohort ⇒ active-window owner only; expired-window excluded — PASS
6. validation-family + hostile discriminants + empty cohort + unknown plan ⇒ DB untouched — PASS
7. teacher/student/parent/nonexistent actor ⇒ FORBIDDEN at the real gate, zero state — PASS
8. anonymous ⇒ UNAUTHORIZED, zero state — PASS
9. governed member appears in NO cohort of ANY fired broadcast — PASS
10. post-hoc observers read their OWN inboxes (system_broadcast, verbatim, null entity ref, unread) — PASS

## 4. Review waves — findings and dispositions

13 reviewer runs over 10 mandated iterations (R1a-d wave + R2–R10 deep-dives); every round PASS (0 CRITICAL / 0 HIGH throughout). Consolidated in `outcome/6.1-review-waves-outcome.md`; per-round files `outcome/6.1-review-R*.md`.

**Fix-now (all applied, verified, committed):** snackbar dismiss 44px floor · Redis claim-cache 2s command/connect bounds · positive `entityId:null` conformance pin · **audience-kind switch preserves authored copy (data-loss bug)** · per-toast Snackbar remount · aria-describedby on the audience error · **Arabic successToast CLDR mod-100 plural classes** (naive switch wrong for every count ≥100 incl. 5000) · wire member-set pin for BroadcastAudienceType · rollback canary snapshot assertion · copy-preservation regression pin (container 6/6 pre-SIGABRT) · plan-artifact JSDoc removals · unused-export cleanup · scope-note concession in the integration suite header · 8 pre-committed TS errors + 15 lint errors in 4.3 files fixed at the 5.2 full-repo gate.

**Ledgered (deferred-items, ALL Forward with named owners — zero Blocked):** DF-1 (bun/Happy-DOM flow-tier runtime defect) · DF-2 (browser loops behind 48 pre-existing build errors) · RV-1 cohort-drift replay residual (engine substrate) · RV-2 governance-blind gate + builder comment (DEV3-016 substrate) · RV-3 body ceiling decision · RV-4 batched-alias amplification (root BLT-05/REQ-035 substrate) · RV-5 plans-failure surface · RV-6 notifications-namespace Arabic plurals (substrate) · RV-7 container UX polish · RV-8 limiter identity/log-forging (dead code) · RV-9 wire-tier propagation pin (needs REDIS_URL test posture).

## 5. Process-integrity notes (recoveries worth remembering)

- **Sandbox keeper force-reset HEAD to main repeatedly** (documented since 2.M): mitigation = local main ref pinned to the branch tip; every commit applied on the feature branch in one atomic chain. Two casualties recovered: 4.4's uncommitted nav edits (wiped pre-commit — re-implemented verbatim from its outcome spec, 26/26 + byte-identical blocks reproduced) and the 5.1/5.2 gate catches (8 TS + 15 lint errors committed by 4.3 before its drift hit).
- **Task-gateway timeouts** forced orchestrator-run small-step execution for the heavy suite phases (5.1/5.2) — deviations recorded in worklog.md.
- **Reviewer-verdict skepticism proved load-bearing:** R4's "proper CLDR classes" PASS was overturned by R7's code evidence — the Arabic plurals MEDIUM shipped precisely because verdicts were evidence-pinned.

## 6. Closure state

- **Checkboxes:** every task 0.1–7.2 `[x]` (4.3 closed with an explicit DF-1/DF-2 disposition note; 7.1.QL carries the documented .md sub-loop tool exclusion); 7.3 flips with this synthesis.
- **Ledger:** D1/D2 (phase-0 seeds) + DF-1/DF-2 + RV-1..RV-9 — all Forward with owners; grep gate 0.
- **Commits:** 17 on the feature branch, scoped adds only, `Plan:/Phase:/Tasks:` trailers, zero Co-authored-by trailers (verified R10).
- **Knowledge:** `docs/notifications/broadcast-notifications.md` canonical reference live; engine consumption row SHIPPED; AGENTS.md surfaces updated.
- The plan is COMPLETE; the deferred items ride their named follow-up streams (engine hardening, gateway hardening, UI test-infra, broadcast polish).
