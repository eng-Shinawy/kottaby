# Task 12 Outcome — Knowledge Propagation (REQ-10)

**Date**: 2026-09-19
**Branch**: `feat/admin-subscription-management` @ `1ee017c` (verified/re-asserted on every Bash call)
**Agent**: Task 12 Subagent (Phase 8 — knowledge propagation, docs ONLY)
**Scope (3 doc files + plan ledger)**: NEW `docs/billing/admin-subscription-management.md`; UPDATE `docs/specs/state-machine-invariants.md` §4; UPDATE `docs/billing/paymob-gateway.md` §12; flip tasks.md Task 12 checkbox. **Zero source files touched; docs-only policy honored.**

---

## 1. Deliverables

### 1.1 NEW `docs/billing/admin-subscription-management.md` (canonical doc, ~200 lines)

Clean technical reference (sibling-doc conventions: title / Domain / Lifecycle Status front matter, numbered sections, tables, mermaid-free). Sections:

1. **Overview & architecture** — the four admin lifecycle operations + admin read surface, one-tx shape, implementation-anchor table.
2. **GraphQL surface** — all 5 field names with exact SDL: inputs (`ExtendSubscriptionInput{subscriptionId,days}`, `RenewSubscriptionInput{subscriptionId}`, `CancelSubscriptionInput{subscriptionId,reason}`, `ChangeSubscriptionPlanInput{subscriptionId,newPlanId}`), payload `ChangeSubscriptionPlanPayload{subscription,direction,carrySessions,forfeitedSessions}`, enum `ProrationDirection`; read surface semantics (newest-first, owner-scoped, empty-list-for-unknown-id, VALIDATION for malformed).
3. **Lifecycle transition table** — extend `active→active` (window shift, `end_date < newEndDate` guard), renew `expired→(new active row)`, cancel `active→cancelled` (balance-preserving), changePlan `active→cancelled + new active row` (same-lane only); scope exclusions (pending payment-owned, suspended governance-owned, no cross-lane, no refunds).
4. **Audit-verb mapping** — extend→`Update`, renew→`Create`, cancel→`Suspend`, change→`Override`, entity `subscription`, one row per committed mutation sharing the tx fate, zero rows on denial; exact `details` shapes (incl. the audit-field-name nuance: audit `forfeitedExcess` vs payload `forfeitedSessions`); cancel reason = the trail's only free text (≤ 200 trimmed).
5. **Proration** — BigInt minor units, canonical `/^\d{1,8}\.\d{2}$/` price gate, cross-multiplied direction (never divides), tie-break on session count, upgrade carry `floor(remaining × priceMinorOld × scNew ÷ (scOld × priceMinorNew))` clamped to the session ceiling, downgrade forfeits the entire remainder; interval ceilings (extend inclusive bound from `startDate`; plan-change one-interval window); **two worked examples** (strict upgrade 8×200.00 → 4×60.00 with remaining 5 → carry 8, total 12; the census/journey downgrade 8×200.00 → 4×50.00 with remaining 6 → unit-value TIE broken to Downgrade, forfeit 6, total 4).
6. **Idempotency claims & reserved namespace** — `subscription-admin:renew:<id>`, `subscription-admin:planChange:<id>:<planId>`; server-constructed keys (single builders); the purchase-ingestion reservation guard (client keys under the reserved prefix rejected pre-DB on every purchase surface); savepoint-bracketed claim before any write, claim rolls back on failure, set-null pointer backfill.
7. **Replay semantics per operation** — extend `<` predicate backstop + locking read → idempotent conflict (zero audit; new extensions stack legitimately); cancel zero-row disambiguation ladder (not-found / replay conflict / notActive); renew claim replay returns the FIRST result (pointer-less/foreign → alreadyRenewed); plan-change serialized-probe + 23505 replay → first result with ZERO carry/forfeit and re-derived direction (original arithmetic lives in the committed audit row).
8. **Concurrency & lock ordering** — WHERE-predicate-as-lock; `subscriptions → students` lock order matching the expiry sweep (40P01 mapped to localized conflict); owner `FOR UPDATE` acquired after the source flip and held to commit (read→settle serialization; repo-layer-only locking reads); extend true-pre-image audit; CHECK 23514 → localized conflict, no partial commit; renew headroom pre-check.
9. **Interplay with the expiry sweep** — sweep exclusively owns `active → expired`; extend vs sweep linearizable by statement ordering; cancel never zeroes BUT the sweep's coverage guard treats `cancelled` as NON-covering, so a LATER sweep of ANOTHER covering sub may still zero a cancel-preserved lane (the documented one-directional asymmetry, spelled out).
10. **Authorization boundary** — three layers: inlined `$all{authenticated, role:[Admin]}` scope conjunction (with the why: the audit-census drift classifier's honest-skip ledger must stay empty), `requireAdminUser` belt, `assertActorAdmin` re-assertion before any read/write; zero writes / zero claims / zero audits on denial; BOLA structure of the read.
11. **Admin drawer surface** — section below balances (keyed per-student remount), documents with `id` in every selection set + drawer-query refetch, per-status action matrix (active → extend/cancel/change plan; expired → renew; pending/cancelled → none), presentational dialogs with server-localized denials, payload-riding carried/forfeited copy (no client proration math), `subscriptionAdmin` i18n namespace (5-step registration + en/ar parity + CLDR plurals incl. zero class), **zero-notification contract**.
12. **Environment note** — generic phrasing: the DB must have ALL baseline migrations applied (1–5 incl. the teacher-transaction settlement amendment); a skipped amendment leaves the strict early trigger active and legitimate writes abort as guard violations that mimic feature failures — re-apply the repo's idempotent migration set before diagnosing.
13. **Related documents** — purchase, expiry, state-machine invariants, plan catalog, segregated balance, both journeys.

No REQ-N / task-id / phase / plan-path references anywhere in the body (grep-verified, §4 below).

### 1.2 UPDATE `docs/specs/state-machine-invariants.md` §4 (+17 lines)

§4 has no literal "producers" table — producers are documented in blockquote **Implementation reference** notes (the expiry-sweep note after the INV-B table). Added a parallel blockquote in EXACTLY that format, directly after the expiry one:

> `active → cancelled` now HAS a producer — the admin cancel mutation (`adminCancelSubscription` → `SubscriptionRepository.cancelActiveOnce`), guarded single-statement UPDATE (`WHERE id = ? AND status = 'active'`, replay-safe, zero rows = replay/no-op), patches exactly `status` + `updated_at`, deliberately **balance-preserving**; the cancel-vs-expiry zeroing asymmetry (cancellation preserves; the expiry sweep zeroes per INV-B3's conditional rule) and its one-directional operational form (the sweep's coverage guard treats `cancelled` as NON-covering, so a LATER sweep of ANOTHER covering sub may still zero a cancel-preserved lane); renew + plan-change named as the rest of the admin writer set; link to the new canonical doc.

### 1.3 UPDATE `docs/billing/paymob-gateway.md` §12 "Related Documents" (+1 line)

The section EXISTS (line 399) and references lifecycle docs (`subscription-purchase.md`) → the conditional "add a pointer" branch applies. Added one line: `admin-subscription-management.md — the admin lifecycle operations over purchased subscriptions (extend / renew / cancel / plan change)`.

### 1.4 tasks.md

`- [ ] **12. Knowledge propagation**` → `[x]` (no sub-lines exist for Task 12).

---

## 2. Verification

| Check | Result |
|---|---|
| `bun run scripts/health/sub-loop.ts docs/billing/admin-subscription-management.md --lifecycle duplicates` | tsgo **passed** (0 errors for the path); oxlint stage reports FAILED with its own "No files found to lint. Finished on 0 files" (an .md path yields zero JS/TS inputs — the harness treats that as a stop before the biome/duplicates stages; script exit 1). **Expected md-file behavior** — the sub-loop's lint stages are TS/JS-scoped; noted per the task brief. |
| Spell-check consistency (cspell, repo config) | New doc: 5 unknown-word hits — `linearizable`, `TOCTOU`, `savepoint`, `CLDR`, `refetches` — all already used by sibling docs (`linearizable`/`TOCTOU`/`SAVEPOINT` appear verbatim in `subscription-validity-window-expiry.md`); the pre-existing siblings carry the same class of domain-vocabulary hits (`hifz`, `tajweed`, `paymob`, `fawry`). No novel misspellings; style consistent with siblings. |
| Plan-artifact grep over the new doc | `rg "REQ-\|tasks\.md\|specs\.md\|plan\.md\|ai/plans\|milestone\|Phase [0-9]\|Task [0-9]"` → **0 matches**. The §1.2 blockquote references only canonical doc artifacts (INV-B3/INV-B6, file links) — same idiom as the neighbouring expiry blockquote. |
| Docs-only policy | `git status --short \| grep -i AGENTS` → **empty** (exit 1). AGENTS.md and `.agents/instructions` untouched. |

## 3. Sandbox incidents handled (branch-pointer race, again)

The known main↔feat HEAD-flip automation struck twice mid-task:

1. Early reads (worktree-read via Read/LS) returned MAIN state (outcome dir listing missing files, `cat` ENOENT on files proven to exist at tip) while HEAD verification kept alternating `1ee017c` ↔ `c4971c6`. Mitigation applied per the worklog runbook: re-assert `git checkout -f feat/...` at every Bash call; race-proof reads via `git show 1ee017c:<path>` / a one-shot `git archive` snapshot of the plan dir + docs to `/tmp` (immutable commit objects — immune to worktree flips); ALL outcome/spec reading done from the snapshot.
2. After the first pair of doc edits, the flipper moved HEAD to main and the tracked-file edits were wiped (tracked-modification loss, not just a label flip). Recovery: untracked new doc survived (also backed up to `/tmp/out12/backup-new-doc.md`); re-checked-out feat, re-verified the two target files matched tip, re-applied both edits byte-identically, and confirmed the two files are byte-identical between `c4971c6` and `1ee017c` so a plain (non-force) `git checkout feat` CARRIES the dirty edits instead of refusing/wiping. Post-recovery state: `M paymob-gateway.md (+1)`, `M state-machine-invariants.md (+17)`, `?? admin-subscription-management.md`, HEAD = `1ee017c` on feat. Backups of all three files kept at `/tmp/out12/backup-*.md`.

## 4. Recurring patterns extracted (occurrence counts across `outcome/` + worklog)

| # | Pattern | Occurrences | Canonical form |
|---|---|---|---|
| 1 | **Branch-pointer races** (main↔feat flip mid-call; stale worktree reads; lost tracked edits) | **4+** (Tasks 8, 11, 12; mechanism documented in Task 6) | Re-assert branch per Bash call; read via `git show <tip>:<path>` / archive snapshots; a first tracked-file edit + NON-force checkout pins the tree (abort-on-dirty); keep `/tmp` backups. |
| 2 | **Port-3066 orphan runbook** (orphaned `next-server` children wedge GraphQL/journey suites; `killListenersOnPort` is a no-op without `lsof`) | **5** (Tasks 7, 8, 10 carry-forward, 11 caveat A, R5 note) | Evict the :3066 listener (by pid — name may not match the kill pattern) + ensure postgres before any server-suite run. |
| 3 | **Default-code ConflictError discipline** (never invent machine keys; `extensions.code` stays in `{UNAUTHORIZED, FORBIDDEN, VALIDATION, NOT_FOUND, CONFLICT}`) | **4** (discovered Task 2, applied Tasks 3-5, re-swept R9/R10 — all four SQL classes 22003/23505/23514/40P01 mapped) | `new ConflictError(localizedMessage)` default-code form; domain translation in `toSubscriptionAdminDomainError`. |
| 4 | **Fixture-derived dates** (derive expecteds from the fixture's stored values, never a separately captured clock — ms drift breaks equality) | **4** (Tasks 2, 4, 8, 9) | Ceiling/window assertions read the fixture row's own `endDate`; journey ISO bounds derived from read-back rows. |
| 5 | **Plan-artifact grep → 0** (comment hygiene: no REQ-N/task/phase/plan refs in code OR shipped docs) | **8** (Tasks 2, 3, 4, 5, 9, 10 + R2-3, R9/R10 sweeps; R6-3/R8-2 were exactly this class) | `rg "REQ-\|Task N\|Phase\|tasks\.md\|specs\.md\|plan\.md\|ai/plans"` over every touched file → 0, then re-run QL on reworded files. |
| 6 | **Reserved claims namespace** `subscription-admin:` (server-owned key space on BOTH ends) | **3** (5.5 HIGH finding F1, purchase-boundary guard + mirrored test R1-B6, Task 8 journey pinning) | Admin flows mint keys via single builders; purchase ingestion rejects client keys under the prefix pre-DB. |
| 7 | **Inlined authScopes literal** (byte-equivalent `$all` conjunction on admin mutation fields, not the shared constant) | **3** (Task 9 forced scope extension, Task 10 carry-forward, census-drift skip-ledger invariant) | Static census classifier must see a literal gate or the honest-skip ledger re-opens. |
| 8 | **Enums-as-values** (no runtime status/action/lane string literals; exhaustive `Record` tables) | **7** (Tasks 2, 3, 4, 5, 9, 10 + R10 fresh-eyes sweep) | VALUE imports; closed-vocabulary lookups; `: never`-style ladders. |
| 9 | **Zero-notification contract** (the whole admin subscription surface emits no notifications) | **3** (plan/specs scope-OUT, Task 8 journey spy pins zero dispatches at every step, Task 10 carry-forward) | Any future notification is a contract change, not an addition. |
| 10 | **All-baseline-migrations DB requirement** (strict early trigger without its later amendment aborts sanctioned writes → journeys "fail" environmentally) | **3** (Task 8 pre-existing trigger failures, Task 11 caveat B, Task 11-FINANCE-DIAG root cause) | Re-apply the repo's idempotent migration set before diagnosing; now the doc's §12 env note (generic phrasing). |
| 11 | **Line ceilings shape modules** (75-line function / 300-line file oxlint ceilings force sibling-helper splits) | **4** (Tasks 3, 4, 6 hit them; Task 5 pre-split; R4 style notes) | Split read/guard/write phases into module-level helpers from the start. |
| 12 | **Concurrent-duplicate test design** (barrier the shared READ for guarded-UPDATE paths; claim paths need NO barrier — the unique index serializes) | **2** (Task 2 read-barrier, Task 3 no-barrier insight) | Spy-stub the finder to hold both txs, then release; or rely on the claim's 23505 blocking. |
| 13 | **Review-campaign convergence** 16 → 5 → 5 → 3 → 3 → 3 → 2 → 2 → 0 → 0 (R1-R10; stop condition = 2 consecutive zero rounds) | **10 rounds** recorded | Independent fresh-context reviewers; fix-then-re-verify per round. |
| 14 | **`MS_PER_DAY = 86_400_000` duplication** (R2-5 INFO accepted: helpers const vs activation-service local const) | **2 sites** (recorded for consolidation; both documented in the doc's window arithmetic) | Non-blocking consolidation opportunity. |

## 5. Notes for the orchestrator

- **tasks.md checkbox state:** tip `1ee017c` carries `[x]` for tasks 0-11 (+0.5) as committed state; this task added the Task 12 flip on top (worktree diff vs tip = exactly the 1 checkbox line). An early "all unchecked" observation during the race was a stale MAIN worktree view (see §3), not the feat tip's state — caught and corrected before finish: the final tasks.md was rebuilt from tip + the single Task 12 flip, and verified (`12` top-level `[x]` marks; diff vs tip = 1 line).
- `outcome/7-graphql-integration-outcome.md` and `outcome/8-journey-outcome.md` are referenced by the worklog but are NOT present at tip (same reset loss); their results are fully recorded in the worklog entries for Tasks 7/8.
- Docs-only policy honored: no source/test/config files touched; **AGENTS.md and `.agents/instructions` untouched** (`git status --short | grep -i AGENTS` → empty). No commits, no pushes.
