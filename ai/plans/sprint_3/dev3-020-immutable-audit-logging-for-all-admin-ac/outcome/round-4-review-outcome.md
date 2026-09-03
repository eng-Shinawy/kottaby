# Round 4 — Fresh Review Outcome (Task ID: 6-r4)

**Plan:** `dev3-020-immutable-audit-logging-for-all-admin-ac` (immutable audit logging for all admin actions)
**Reviewer:** Fresh independent R4 reviewer (adversarial pass; review-only, zero source modifications, no checkbox flips)
**Branch:** `feat/dev3-020-immutable-audit-logging-for-all-admin-ac` @ `01edf8121b867d31b91ccd5bb98b1a898a82cd65` (code state identical to R3's fix commit `e3adbdf`; the tip commit is bookkeeping-only — R3 remediation record appended to the round-3 outcome)
**Prior rounds:** R1 = 7 findings (all fixed, verified in R2); R2 = CLEAN ×2 reviewers; R3 = 1 LOW + 3 advisory/nit + 1 info (all fixed at `e3adbdf`).

---

## Verdict: **FINDINGS (non-blocking)** — 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW / 1 NIT / 2 info.

**Ship-clear:** every mandated check passes, all five mandated suites match their recorded signatures exactly, all four R3 remediations verified held on adversarial re-read, zero drift on the frozen areas, ledger Status column clean. The single NIT is one stale number in ledger **prose** (the same I-1 class R3 already fixed once — it drifted again by exactly the test the fix itself added). Nothing blocks ship; the NIT can be absorbed by any later bookkeeping touch or by the orchestrator at disposition.

---

## Environment note (branch-flip artifact, recurred)

The main checkout's HEAD was repeatedly found flipped to `main` at tool-invocation boundaries (the same recurring sandbox artifact recorded by R1/R2/R3). Protocol applied: a **detached review worktree pinned to the feature tip** (`/home/z/r4-wt` @ `01edf81`, `node_modules` symlinked from the repo root, `.env`/`.env.test`/`.env.test.ci` copied) was used for all file reads and suite runs — flip-proof and ref-pinned. The main checkout was re-asserted to the feature ref per batch where needed and restored to `main` afterwards. The `backend/graphql/test` directory suite was additionally re-run **in the main checkout** (detached @ `01edf81`) because the pinned worktree's server-booting suites timed out at their 60 s harness gates (environmental, not product): there it reproduced R3's recorded `240/4` signature exactly, isolating the worktree timeouts as environment-only. The review worktree was removed after the pass; no source file modified anywhere; no checkbox touched.

---

## Adversarial checks — results

### 1. Five highest-risk files read end-to-end — **PASS**

- **`backend/services/admin/audit-trail.service.ts`** — All six filter dimensions normalized (actorId, entityId, entityType, actionType, from, to) with identical null/undefined-absent semantics; fixed pre-DB validation precedence; `entityType` trimmed + varchar(100)-bounded; `actionType` fail-closed membership re-assertion; window bounds reject `NaN`-timestamp `Date`s and require strict `from < to` when both present (half-open repo semantics are complementary, never degenerate). Pagination: `resolvePageBounds(page ?? 1, pageSize ?? undefined)` → offset `(page-1)*pageSize`, integer-bounded 1..100 (default 25), honest echo for out-of-range pages. Tx handling: `readInSnapshot` joins a caller tx as a nested block or opens ONE top-level `repeatable read` transaction; count + list share one executor; `mapTrailRow` fails closed on a corrupt stored enum (plain runtime error, masked at the boundary). Error paths: every pre-DB rejection is the single localized `ValidationError`; the gate owns denial logging; happy path logs nothing.
- **`backend/db/repo/audit/audit-trail.repository.ts`** — Count/list WHERE parity is structural (one shared `buildWhere`; the service passes the same normalized object to both). All six members → `eq`/`gte`/`lt` bound parameters; absent members drop out; zero string interpolation. Ordering `created_at DESC, id DESC` (deterministic tiebreak, gapless paging); join-free count is join-equivalent (`actor_id` NOT NULL + ON DELETE RESTRICT); read-only surface (no write path of any kind).
- **`app/(dashboard)/audit/page.tsx`** — `withPageAuth({ roles: [Admin] })` first; awaited async `searchParams`; array params reduced to first value; all six params sanitized independently with silent-drop; `sanitizeIdParam` bounds `1..MAX_ID (2147483647)` — `?actorId=3000000000` drops the param (R3 F-1 held); `sanitizeDayRange` uses zero-padded ISO string ordering, drops an inverted pair whole, keeps a same-day pair (the view expands it to the exclusive next midnight); unfiltered first page when nothing survives.
- **`frontend/views/admin/audit/audit-trail-filters.ts`** — Seed→drafts: all-string drafts (no `Date` can reach a form input; dates re-sanitized via `parseUtcDayStart`). Drafts→applied: impossible calendar days → `null` (no silent rollover — the year/month/day round-trip check also catches `Date.UTC`'s 0–99 → 1900–1999 mapping); inverted pair clears BOTH bounds; id `0` and id `> MAX_ID (2147483647, both id ternaries)` apply as CLEARED (R3 F-1 held on the draft path); unparseable day narrows to a one-sided window. Applied→wire: `buildFiltersInput` starts all six keys `undefined` (dropped from the JSON payload) and assigns only non-null values; dates serialize exclusively via `toISOString()` — no raw string date can reach the wire. UTC-day math is exact (`to` = `from`-day midnight + 86 400 000 ms; UTC has no DST).
- **`backend/graphql/pothos/admin/audit-trail.pothos.ts`** — Canonical `@/backend/types` shapes only (no local defs); `id` exposed FIRST as `ID!` for Apollo normalization; page wrapper deliberately `id`-less; nullable `entityId`/`details` by design; `createdAt` rides the shared `DateTime` scalar; closed six-member filter input (smuggled fields die at GraphQL validation); enum reused from the shared registry, never re-registered.
- Supporting slices cross-checked: resolver (field-by-field whitelist copy, `$all` scope conjunction, belt-only `ctx.user` narrowing), view + filter bar + fields + results + row + states (draft/applied two-layer state, form-submit-only queries, server-envelope pagination echo, verbatim `details` in an escaped `dir="auto"` `pre` — no XSS surface, ≥44 px touch targets, error seams branch on `extensions.code` only), `apolloCache.ts` (`AdminAuditLogPage: keyFields: false`, consistent with its docblock), documents (`id` selected first), and the shared helpers (`resolvePageBounds`/`isPositiveSafeInteger`/`assertActorAdmin`/`toAuditActionType` — the coercion covers all seven canonical members).

### 2. R3 remediations verified held — **PASS (all four)**

- **F-1 route path:** `page.tsx:40` pins `MAX_ID = 2147483647`; `sanitizeIdParam` (`:67–73`) drops `?actorId=3000000000` (above the wire Int max) — silent-drop posture preserved.
- **F-1 draft path:** `audit-trail-filters.ts:187` pins the same `MAX_ID`; both id ternaries (`:209`, `:211`) bound `<= MAX_ID` — an out-of-range draft applies as cleared. Mirrored component test exists (`AuditTrailView.test.tsx:408–434`: seeded `{actorId: 9}`, types `3000000000`, Apply → the wire carries NO actorId, unfiltered window re-queries, no error seam) and the suite is green (18/0).
- **A-3 repo test anchor:** `audit-trail.repository.test.ts:203` now asserts `not.toContain(createRow.id)` — the excluded row's own identity id (vacuous `22` gone); the for-loop action-type proof and `toContain(updateRow.id)` pin are intact.
- **I-1 ledger note:** `deferred-items.md:19` says "component suite (17 tests)" — held **as written**, but see the NIT below: the same fix commit added the 18th component test, so the figure is stale again at HEAD.

### 3. Mandated suites — **PASS, signatures match exactly**

| Suite | Expected | Observed |
|---|---|---|
| `bun run test/scripts/run-test.ts backend/services/admin` | 104/0 | **104 pass / 0 fail** (472 expect, 3 files) |
| `bun run test/scripts/run-test.ts backend/db/test/logic/audit` | 32/0 | **32 pass / 0 fail** (368 expect, 2 files) |
| `test/ui/components/admin` | 18/0 | **18 pass / 0 fail** (`AuditTrailView.test.tsx` block, 112 expect — tallied within the sanctioned full `test:ui:components` run: 191 pass / 0 fail across 15 files, exit 0) |
| `bun tsgo` | 0 | **exit 0** |

Drift: **none** on the mandated suites. Bonus corroborations (all 0 fail): `backend/graphql/test` **236 pass / 4 fail = 240/4** in the main checkout @ `01edf81` — the 4 are exactly the plan-catalog anonymous-matrix probes R3 proved pre-existing on main (reproduced identically here); `shared/locale` **140/0**; documents **8/0**, apolloCache **11/0**, navItems **20/0**, journey **7/0** (directory supersets green too: 38/0, 40/0, 22/0). The pinned-worktree graphql run's five 60 s server-boot timeouts were proven environmental by the main-checkout reproduction (same SHA, same code, expected signature).

### 4. Zero-drift — **PASS**

`git diff main -- backend/db/schema/ backend/db/migration/ backend/drizzle/ backend/lib/gateway/public-operations.ts` → **EMPTY** (0 lines).

### 5. Plan-artifact token grep — **PASS**

Added-line grep across the full branch diff (43 plan-owned files outside `ai/plans/**` and `worklog.md`): the ONLY artifact-token lines added by this branch are the two sanctioned **REQ-065** occurrences in `frontend/views/dashboard/nav/navItems.test.ts` (the file's REQ-token convention pre-exists on main as REQ-054/REQ-064). Every other token occurrence (sdl-static REQ-032/060/069, `D2` tokens, AGENTS.md `dev3-003`/`dev3-010` history notes) verified **pre-existing** via added-lines-only filtering of the unified diff — zero hits on added lines. No `DEV3-020`, `Task N`, `§N`, or `plans/sprint` tokens on any added line outside the sanctioned exception.

### 6. Ledger — **PASS**

`deferred-items.md` Status column: **0 ❌ / 0 ⚠️** (6 ✅ Done + 1 📅 Forward; glyphs otherwise appear only in the template legend).

### 7. Holistic adversarial pass — **PASS** (observations below)

- Teardown completeness: the wire matrix's `afterAll` deletes trail fixtures FIRST under the trigger-suspension wrapper, hard-deletes every fixture actor, and asserts zero marker/actor residue — leak-proof by construction; journey suite teardown likewise (R3-verified, unchanged).
- No fragile asserts found: exclusion/inclusion proofs anchor inserted-row identity ids; executor-identity oracles pin the tx seam; no `expect(...).rejects` (the prohibited pattern) anywhere in the new suites.
- Naming/comments accurate across the surface (the single stale figure is the ledger prose NIT below).

---

## Findings

- **[NIT] ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md:19 — ledger prose cites "component suite (17 tests)"; the suite at HEAD is 18 tests / 112 expect.** The R3 fix commit `e3adbdf` both refreshed this prose (15 → 17) and added the 18th component test in the same commit — the I-1 class recurred by exactly one. Prose-only; the Status column (📅 Forward) is untouched and the ledger's pass/fail semantics are unaffected. Suggested micro-fix (any later bookkeeping touch): "(18 tests)" or drop the volatile count ("the green component suite").
- **[INFO] frontend/views/admin/audit/audit-trail-filters.ts:210 — the entityType draft is the one dimension without a client-side normalize-to-unfiltered cap.** Ids (0, >2³¹−1) and dates (unparseable, inverted) normalize silently, but an over-100-character entityType draft applies and reaches the wire, dying at the service's pre-DB `varchar(100)` validation as the localized generic error seam. Server-as-authority is a sanctioned posture (and the deep-link path does drop over-length values at the route); recording the asymmetry only. No action required.
- **[INFO] backend/db/repo/audit/audit-trail.repository.ts:178 — `count(*)::int` mirrors the surface's int4/wire-Int reality.** A hypothetical >2³¹−1 filtered-row count would break `totalCount` wire coercion (`exposeInt`) long before this cast matters; unreachable at any realistic audit volume. No action required.

**Explicitly NOT findings (checked and cleared):** `Date.UTC` year 0–99 remapping (caught by the round-trip check; unreachable from the date-input wire format); worst-case offset precision at `MAX_SAFE_INTEGER` pages (result is empty either way; honest `totalCount` preserved); `TablePagination` hidden when `items` is empty despite `totalCount > 0` (out-of-range-page edge is unreachable on an append-only surface with apply/clear/page-size resets); `count`+`list` tearing under a caller-owned non-RR transaction (documented "inherit its isolation posture"; the service's own path is pinned RR by test).

---

## Summary for the orchestrator

- **Verdict: FINDINGS (non-blocking)** — 1 NIT (stale ledger-prose count, 17 → actual 18) + 2 info observations; zero CRITICAL/HIGH/MEDIUM/LOW; zero regressions of R1/R2/R3 fixes observed on adversarial re-read.
- All five mandated suites match their recorded signatures exactly (104/0 · 32/0 · 18/0 within the sanctioned 191/0 full component run · tsgo 0); bonus runs corroborate R3's recorded numbers (240/4 with the 4 proven pre-existing main debt, reproduced at the branch SHA in the main checkout; 140/0 locale; 8/0 documents · 11/0 apolloCache · 20/0 navItems · 7/0 journey); zero drift on the four frozen areas; ledger clean with 6 ✅ + 1 📅 intact; token grep clean modulo the sanctioned REQ-065 exception.
- All four R3 remediations held: route drops `?actorId=3000000000`, drafts clear out-of-wire-range ids with a green mirrored component test, the repository exclusion assertion anchors the excluded row's identity id, and the ledger note reads as remediated (stale by the fix's own added test — the NIT).
- Nothing blocks ship. DEV3-020 is round-4 disposition-ready; the NIT can be absorbed by any later bookkeeping commit (prose-only, no code, no ledger semantics).

## Orchestrator disposition (post-R4)

- **NIT (deferred-items.md:19 count)**: fixed directly — prose now reads "(18 tests)" (plan-artifact bookkeeping, orchestrator-owned).
- **INFO `audit-trail-filters.ts:210` entityType asymmetry**: ACCEPTED by design — the server is the validation authority for the free-text dimension; client caps exist only for the wire-Int ids where a silent wire failure mode exists. Recorded as a documented decision, not an open finding.
- **INFO `audit-trail.repository.ts:178` count(*)::int**: ACCEPTED — mirrors the surface's int4/wire-Int reality; overflow unreachable within the clamp bounds.
