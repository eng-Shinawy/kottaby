# Mid-Point Review Gate — Round 1 Outcome (3.5-GATE)

**Plan:** `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention`
**Date:** 2026-10-09
**Gate scope:** ALL files modified in tasks 1.1–4.2 (per the 3.5-GATE trigger: 18 tracked items > 15, distinct backend+frontend phases)
**Executor:** 3.5-GATE fix-wave agent (this file)

---

## Reviewer Verdicts — ALL PASS, zero CRITICAL/HIGH, five LOW

Three parallel review subagents were dispatched over the plan's modified files:

| Reviewer | Scope | Verdict |
|---|---|---|
| `review-backend` | limiter/helper/guard/transport semantics — race conditions, dead code, fail-open/fail-closed inversions (`backend/lib/ratelimit.ts`, `transport-guard.ts`, `builder.ts` scope semantics, plan-catalog `$all`, cron limiter wiring) | **PASS** — 0 CRITICAL / 0 HIGH / findings folded into the LOW list below |
| `review-config` | `next.config.ts`, route wiring order, wire-map completeness (`security-headers`, route POST pipeline order, `TRANSPORT_WIRE_MAP` exhaustiveness, source pins) | **PASS** — 0 CRITICAL / 0 HIGH / findings folded into the LOW list below |
| `review-frontend` | CSV helper + exporter seams (`csv-formula.ts`, the four cell builders, print-export extraction) | **PASS** — 0 CRITICAL / 0 HIGH / findings folded into the LOW list below |

### Scoped test-run totals (suites in each reviewer's scope, latest recorded runs)

| Suite | Result | Source of run |
|---|---|---|
| `test/config/security-headers.test.ts` | 7 pass / 0 fail | task 1.5 |
| `app/api/graphql/test/graphql-route.origin.test.ts` | **29 pass / 0 fail** | task 1.2, re-verified this wave (incl. with a pre-existing `WS_ALLOWED_ORIGINS` host value) |
| `app/api/graphql/test/graphql-route.transport.test.ts` | **41 pass / 0 fail** (40 + 1 new parity pin) | task 1.3, re-verified this wave |
| `app/api/graphql/test/graphql-route.pipeline-order.test.ts` | 9 pass / 0 fail | task 1.1 regression + this wave |
| `app/api/set-locale/test/set-locale-route.test.ts` | 39 pass / 0 fail | task 1.4 |
| `backend/lib/ratelimit.test.ts` | 8 pass / 0 fail | task 2.1 (⚠️ file under CONCURRENT Phase-2 edit — untouched by this wave) |
| `backend/graphql/test/context-keys.test.ts` | 24 pass / 0 fail | task 2.1 |
| `app/api/cron/reconcile-paymob-payments/test/…` | 20 pass / 0 fail | task 2.4 |
| `app/api/cron/expire-subscriptions/test/…` | 13 pass / 0 fail | tasks 2.1/2.4 |
| `test/config/sql-injection-static-locks.test.ts` | **26 pass / 0 fail** (24 + 2 new) | task 3.1, extended this wave |
| `test/config/xss-static-locks.test.ts` | 8 pass / 0 fail | task 3.3, re-verified this wave (comment-edit sanity) |
| SQL hostile-payload service suites (matching / directory / payments-audit) | 73 / 33 / 32 pass, 0 fail | task 3.2 |
| CSV suites (`csv-formula` 25, wallet 2, directory 4, analytics 3, print-export 3) | 37 pass / 0 fail | task 3.4 |
| `backend/graphql/test/schema-surface.test.ts` | 130 pass / 0 fail | tasks 4.1/4.2 |
| `backend/graphql/test/plan-catalog.roles.test.ts` | 27 pass / 0 fail | task 4.2 + addendum |
| `backend/graphql/test/plan-catalog.schema.test.ts` | 5 pass / 0 fail | task 4.2 |

---

## Findings Table (all five = LOW; zero CRITICAL/HIGH)

| # | Severity | File | One-line description | Disposition |
|---|---|---|---|---|
| 1 | LOW | `test/config/sql-injection-static-locks.test.ts` | Lock (b) census scanned only `\bilike\s*\(` while the wildcard-escape discipline's requirement letter also names `like(`; stripper docblock did not state that string/template-literal content is scanned verbatim (review-backend doc-nit) | **Fixed-by-fix-wave** (this wave) |
| 2 | LOW | `app/api/graphql/test/graphql-route.origin.test.ts` (~:55, :64) | Module-scope `WS_ALLOWED_ORIGINS` stub + unconditional `afterAll` delete destroys a pre-existing host value in shared-process runs | **Fixed-by-fix-wave** (house save/restore pattern) |
| 3 | LOW | `app/api/graphql/transport-rejection.ts` (:3-6) | Stale docblock claimed "extracted verbatim from route.ts … behavior unchanged from the pre-extraction route" — false since the builder gained per-kind `messageKey` selection + two new rows | **Fixed-by-fix-wave** (rewritten in domain terms) |
| 4 | LOW | `frontend/views/notifications/feed/NotificationRowContent.tsx` (~:193) | Trailing block comment cited "(plan §5.5 visual matrix)" — a plan-artifact reference in a production comment | **Fixed-by-fix-wave** (citation removed, behavior content kept) |
| 5 | LOW | `app/api/graphql/test/graphql-route.transport.test.ts` (~:641) | Source pins derived the repo root from `process.cwd()` (inconsistent with both static-locks suites); reviewers also suggested a client-`batchMax` ↔ server-cap parity source pin | **Fixed-by-fix-wave** (`import.meta.dir` root + parity pin added) |

No accepted-limit or out-of-scope finding required a code change beyond these five.

---

## Fixes Applied (this wave)

### Fix 1 — `test/config/sql-injection-static-locks.test.ts`
- **Verified zero first:** a comment-stripped (same stripper, same exclusions) scan of `backend/db/repo/**` production sources for `\blike\s*\(` yields **0 matches today** — the lock is safe to hold at zero (probe run before the edit; no `like(` site exists to STOP on).
- **Companion lock added:** `BARE_LIKE_SEARCH = /\blike\s*\(/u` + `scanBareLikeFiles()` — asserted EMPTY over the repository census corpus in the lock-(b) describe (new test "ZERO bare like( call sites…"). The regex is disjoint from the census scanner by construction (`ilike(`'s prefix letter blocks the word boundary — documented on the constant).
- **Ilike census pin UNCHANGED** (8 files / 14 lines / 19 occurrences, byte-identical pin).
- **Stripper docblock + suite docblock extended:** STRING/TEMPLATE-LITERAL CONTENT IS SCANNED VERBATIM — a benign string containing `ilike(` (or `like(`) counts as a call site; fail-closed direction stated in both the suite header (COMMENT-STRIPPING SEMANTICS) and the `stripComments` function docblock. The documented claim is pinned by the extended stripper unit test (line-8 in-string `ilike(` counts; in-string `like(` trips the companion matcher).
- **Tier-4 negative proof added:** synthetic in-memory fixture (never a real-source edit) — a seeded bare `like(` site FAILS the zero-lock (appears in the scanner's list), is NOT an ilike census site (disjointness, both directions), and the real corpus stays empty. Suite docblock's lock-(b) header row + `KNOWN lexical caveat` text updated to cover the companion lock.

### Fix 2 — `app/api/graphql/test/graphql-route.origin.test.ts`
- Captured `PREEXISTING_WS_ALLOWED_ORIGINS` BEFORE the module-scope stub; `afterAll` restores it (delete only if it was absent pre-stub), `resetEnvironmentCache()` kept both sides (house pattern: `backend/ws/notification-ws-server.test.ts:66-82` originals map + this plan's `security-headers.test.ts` hadPrevious guard). File docblock's "stub is removed" sentence rewritten truthfully. Verified green standalone AND with a pre-existing host value (`WS_ALLOWED_ORIGINS=… run`).

### Fix 3 — `app/api/graphql/transport-rejection.ts`
- Module docblock rewritten truthfully in domain terms: the module owns the exhaustive kind→wire mapping and the guarded rejection builder; every kind maps to wire pairing (status / transport code / Allow presence) + localized-message key; the builder resolves locale once and selects the message per kind (request-shape failures → `badRequest`, access refusals → `forbidden`). Zero plan-artifact references; the mock-shadowed-specifier warning kept verbatim.

### Fix 4 — `frontend/views/notifications/feed/NotificationRowContent.tsx`
- Trailing block comment: "(plan §5.5 visual matrix)" citation removed; the full behavioral content (unread tint via `theme.palette.action.selected`, dot + visually-hidden `filterUnread` text, bold title, mark-read action; read rows un-tinted/no dot/no action) kept verbatim in domain terms. Grep-clean for plan-artifact references.

### Fix 5 — `app/api/graphql/test/graphql-route.transport.test.ts`
- **Root pin:** `const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")` (test at `app/api/graphql/test/` → 4 up), docblock states the relative-derivation contract; both source reads (`route.ts`, `transport-guard.ts`) switched from `process.cwd()` to `REPO_ROOT`.
- **Batch-cap parity source pin** (in the existing source-pin describe): scans the comment-stripped client source `frontend/providers/apollo/AppApolloProvider.tsx` for `batchMax:\s*(\d+)`, asserts exactly ONE literal, and asserts it equals the imported `MAX_GRAPHQL_OPERATIONS_PER_REQUEST` — the two values cannot share an import across layers (frontend never imports backend), so the source text is the seam. Rationale documented on the test (an over-window client batch would dead-letter every query it sends). Suite coverage-map bullet extended.

---

## Verification Results (this wave)

| Check | Result |
|---|---|
| `sub-loop … --lifecycle duplicates` — `test/config/sql-injection-static-locks.test.ts` | **exit 0** (tsgo/oxlint/biome/lint:type-aware ✅, duplicates skipped-out-of-scope = pass) |
| `sub-loop … --lifecycle duplicates` — `app/api/graphql/test/graphql-route.origin.test.ts` | **exit 0** |
| `sub-loop … --lifecycle duplicates` — `app/api/graphql/transport-rejection.ts` | **exit 0** (incl. intra-file jscpd) |
| `sub-loop … --lifecycle duplicates` — `frontend/views/notifications/feed/NotificationRowContent.tsx` | **exit 0** (incl. intra-file jscpd) |
| `sub-loop … --lifecycle duplicates` — `app/api/graphql/test/graphql-route.transport.test.ts` | **exit 0** |
| `run-test.ts test/config/sql-injection-static-locks.test.ts` | **26 pass / 0 fail** (24 pre-existing + 2 new) |
| `run-test.ts app/api/graphql/test/graphql-route.origin.test.ts` | **29 pass / 0 fail** (also re-run with a pre-existing `WS_ALLOWED_ORIGINS` host value: 29/0) |
| `run-test.ts app/api/graphql/test/graphql-route.transport.test.ts` | **41 pass / 0 fail** (40 pre-existing + 1 new parity pin) |
| `run-test.ts app/api/graphql/test/graphql-route.pipeline-order.test.ts` (regression — imports the docblock-touched builder transitively) | **9 pass / 0 fail** |
| `run-test.ts test/config/xss-static-locks.test.ts` (sanity — the scanner sweeps the comment-edited component) | **8 pass / 0 fail** |

The two pre-existing baseline tsgo errors (`DirectoryCopyLinkButton.tsx` TS6133, `EditUserDialog.tsx` TS2322, per `0-baseline-outcome.md`) never surfaced in any file-scoped run — exempt, untouched.

**Concurrency respected:** a Phase-2 agent is concurrently editing `backend/lib/ratelimit.ts` — this wave never touched it or its test.

---

## Remaining Accepted Limits (documented, deliberate — no action)

1. **Census line-number strictness is intentional** — the ilike census pins exact `[line, occurrenceCount]` pairs; any edit that shifts a pinned line fails the lock and forces the pin edit through review. Drift is the signal; looseness would be the defect.
2. **Regex-literal stripper edge documented** — the comment stripper does not model regex literals (accepted lexical limit, stated in the suite docblock); text-level scans trade obfuscation-resistance for visible, cheap false positives.
3. **UTF-16 drained-checkpoint mirrors transport-guard precedent** — the set-locale drained-length checkpoint measures `String.length` (UTF-16 code units), identical semantics to `assertWithinBodyLimit`'s `rawBody.length` in the transport guard; informational, not a byte-count claim.
4. **XSS scanner sink scope matches the requirement letter and is stricter than spec on `outerHTML`** — all eight sinks (`dangerouslySetInnerHTML`, `.innerHTML`, `.outerHTML`, `insertAdjacentHTML`, `document.write(`, `eval(`, `new Function(`, `srcDoc`) are locked at zero including read-side `outerHTML` uses; comments/strings count by design (fail-closed).
5. **set-locale UTF-16 informational** — same unit caveat as (3) for `MAX_SET_LOCALE_BODY_BYTES`; mirrors the gateway's own semantics.

---

## Out-of-Scope Pre-Existing Items (recorded for human attention — NOT fixed here)

1. **`backend/graphql/AGENTS.md` (~:100) stale sentence** — states the `permission` scope "uses `ctx.isSuperAdmin` and `ctx.permissions` directly (no `getUserContext` call)"; post-4.1 the scope reads ONLY `ctx.permissions`. Hand-curated file — plan work never edits AGENTS.md; reword when the file is next human-touched (also noted in `4.1-outcome.md`).
2. **`backend/types/billing/admin-finance.types.ts:12-13` docblock** — claims the REPOSITORY escapes `studentNameSearch`; the escape actually happens at the SERVICE (`admin-financial-auditing.service.read.helpers.ts:150`). Logged for task 5.1's documentation-truth sweep (also noted in `3.2-outcome.md`).
3. **Sibling notification files' old `REQ-`-ref census** — `NotificationFeedError.tsx`, `NotificationList.tsx`, `NotificationsFeedBody.tsx`, `NotificationsFeedContainer.tsx`, `useNotificationsFeedState.ts`, `MarkAllButton.tsx`, `NotificationFilterChips.tsx` still carry predecessor-plan `REQ-` docblock references (they do NOT cite the XSS scanner, so they were outside task 3.3's file list per Fix-Or-Report). If a repo-wide comment-artifact hygiene pass is ever wanted, that list is the census (also noted in `3.3-outcome.md`).
4. *(Informational)* `app/api/graphql/test/graphql-route.origin.test.ts`'s own source pins still derive paths via `process.cwd()` — same class as fixed finding 5 but in a file whose only assigned fix this wave was the env-stub hygiene; left untouched per the surgical-fix mandate.

---

## Verdict

**GATE PASSED.** All three reviewers returned PASS with zero CRITICAL/HIGH; all five LOW findings are fixed and re-verified (per-file sub-loop exit 0 ×5; affected suites 26/29/41 pass / 0 fail plus regression 9/8 pass); accepted limits are documented above; out-of-scope items are recorded for human attention. Phases 4.1/4.2 are complete; Phase 5 (5.1 documentation truth, 5.2 blocking verification sweep) may proceed.
