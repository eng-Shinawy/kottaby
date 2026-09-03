# Round 3 — Final Sweep Outcome (Task ID: 6-r3)

**Plan:** `dev3-020-immutable-audit-logging-for-all-admin-ac` (immutable audit logging for all admin actions)
**Reviewer:** Fresh independent R3 final-sweep reviewer (adversarial pass; review-only, zero source modifications)
**Branch:** `feat/dev3-020-immutable-audit-logging-for-all-admin-ac` @ `333e51f340b70e50301a14da54db16cae5fd3b36`
**Prior rounds:** R1 = 7 findings (all fixed, verified in R2); R2 = CLEAN ×2 reviewers.
**Note:** a prior 6-r3 draft of this file existed (same task ID); this version supersedes it — every claim below was re-verified independently in this pass, including a main-SHA reproduction of the pre-existing graphql debt.

---

## Verdict: **FINDINGS (non-blocking)** — 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW / 3 advisory-or-nit / 1 info. Suites + counters match recorded signatures exactly; no R1/R2 regressions observed.

---

## Environment note (branch-flip artifact)

The main checkout's HEAD was repeatedly found flipped to `main` at tool-invocation boundaries (recurring sandbox artifact also recorded by R1/R2). Protocol applied: a **detached review worktree at the feature tip** (`/home/z/r3-review` @ `333e51f`, node_modules provisioned, `.env`/`.env.test` copied from the repo root) was used for **all** file reads, suite runs, and counter runs — every read/run is therefore flip-proof and pinned to ref `333e51f`. Branch re-assertions in the main checkout were performed where possible; no source file modified; no checkbox touched. The pre-existing `plan-catalog` debt was additionally reproduced in a second detached worktree at the **main** SHA (`4ff8a62`) to prove it is genuine main debt.

---

## Adversarial checks — results

### 1. `backend/services/admin/audit-trail.service.ts` end-to-end — **PASS**

- Pagination math: `resolvePageBounds(page ?? 1, pageSize ?? undefined, locale)` → `offset = (page - 1) * pageSize` (`user-management.helpers.ts:314`). No off-by-one; page rejects 0/negative/fractional pre-DB; pageSize integer-bounded `1..100` (default 25); honest echo — out-of-range page returns empty `items` with the unchanged `totalCount`, never clamped, never an error. Worst-case offset `(2^53-1 - 1) * 100` stays inside Postgres `bigint` range — no overflow path.
- Window semantics: service requires strict `from < to` when **both** present (`from.getTime() >= to.getTime()` rejects, including the degenerate equal-bounds case); one-sided windows honored; `assertWindowBound` rejects `NaN`-timestamp `Date`s. Repo applies the half-open window `gte(createdAt, from)` / `lt(createdAt, to)` — service strictness and repo half-open semantics are complementary (adjacent windows never overlap).
- Null-vs-undefined: all six filter members treat `null` and `undefined` identically as "absent" (`normalizeIdFilter`, `normalizeEntityTypeFilter`, `normalizeActionTypeFilter`, `normalizeWindowBounds`); `entityType` trimmed (whitespace-only → absent) and bounded at the `varchar(100)` column ceiling; `actionType` fail-closed membership re-assertion against the canonical enum set; validation precedence fixed and pre-DB.
- Locale threading: single `locale` parameter reaches the actor gate and every `validationFailure` via `getServerTranslations`; no hardcoded copy anywhere on the surface.
- Snapshot: `readInSnapshot` joins a caller tx as a nested block, else opens ONE top-level `repeatable read` transaction; count + list share one executor (pinned by executor-identity oracles in the suite).
- `mapTrailRow` fail-closed coercion: corrupt stored enum → plain runtime error (masked to INTERNAL_SERVER_ERROR at the boundary); no unsafe cast.

### 2. `backend/db/repo/audit/audit-trail.repository.ts` — **PASS**

- **Count/list WHERE parity: structural.** Both `countEntries` and `listEntries` call the ONE shared `buildWhere(filters)`; the service passes the *same* normalized object to both — drift impossible by construction; the suite additionally asserts filter-object identity at the seam.
- Ordering determinism: `orderBy(desc(created_at), desc(id))` — insertion-latest tiebreak keeps same-timestamp rows stable across pages (test-pinned, gapless tiling).
- Limit/offset bounds: repository un-opinionated by design; only the service calls it, with clamped 1..100 limit and offset ≥ 0; out-of-range offset yields `[]` (test-pinned).
- Join-free count is join-equivalent: `audit_logs.actor_id` is `NOT NULL` with `ON DELETE RESTRICT` (schema-verified; FK rejection test-pinned), so the inner join can never drop a counted row.

### 3. `app/(dashboard)/audit/page.tsx` — **PASS** (1 LOW, see F-1)

- Server/client boundary clean: Server Component; `withPageAuth({ roles: [UserRole.Admin] })` first (anonymous → `/login?redirect=/audit`, role mismatch → own role dashboard); the seed handed to the client view is a plain string/number object; `AuditTrailView` owns all later state.
- Metadata correct: `getTranslations(locale)` verified **synchronous** (`shared/locale/server.ts:15`); `getLocaleFromCookie` awaited; reused `adminUsersTranslations.auditTrail` block.
- `searchParams` edges: awaited (Next async shape); array-valued params reduced by `firstValueOf` (first value only); inverted `from`/`to` day pair dropped whole; same-day pair survives as a single-day half-open window; empty-after-trim values dropped; unfiltered first page when nothing survives.

### 4. `frontend/views/admin/audit/audit-trail-filters.ts` seed/wire conversion totality — **PASS**

- Seed (`AuditTrailFiltersSeed`, `YYYY-MM-DD` strings) → drafts: `draftsFromSubmitInput` re-sanitizes dates via `parseUtcDayStart` and stringifies ids — `FilterDrafts` is all-string, so **no `Date` can reach a form input**.
- Seed/drafts → applied: both `appliedFiltersFromSubmitInput` and `appliedFiltersFromDrafts` parse through `parseUtcDayStart` / `parseUtcDayEndExclusive` (impossible calendar days → `null`, never silent rollover); inverted pair clears BOTH bounds; id `0` reads as cleared.
- Applied → wire: `buildFiltersInput` starts all six keys `undefined` (dropped from the payload entirely) and assigns only non-null applied values; dates serialize exclusively via `Date.toISOString()`. **No path exists where a raw string date reaches the wire.** Each seam has a single function and no bypass call sites (verified across `AuditTrailView` / `AuditTrailFilterBar` / `page.tsx`).
- The one gap is the **numeric** id band (not dates): see F-1.

### 5. Suite truth-check — **ALL MATCH** (fresh runs at ref `333e51f`)

| Suite | Recorded signature | Fresh result | Drift |
|---|---|---|---|
| `backend/services/admin` | 104 / 0 | **104 pass / 0 fail** (472 expect, 3 files) | none |
| `backend/db/test/logic/audit` | 32 / 0 | **32 pass / 0 fail** (368 expect) | none |
| `backend/graphql/test` | 240 / 4 (4 = pre-existing main debt in `plan-catalog.roles.test.ts`) | **236 pass / 4 fail = 240 total** — all 4 exactly `Plan Catalog GraphQL Role-Matrix (REQ-064)` anonymous probes; **reproduced identically in a detached worktree at the main SHA `4ff8a62`** (21 pass / 4 fail in that file on main) → confirmed pre-existing main debt, not introduced here | none |
| `shared/locale` | 140 / 0 | **140 pass / 0 fail** (1496 expect) | none |
| `test/ui/components/admin` | 17 / 0 | **17 pass / 0 fail** (106 expect) | none |
| *Bonus:* `test/workflows/admin/audit-trail.journey.test.ts` | — | **7 pass / 0 fail** (126 expect) | — |
| *Bonus:* `audit-trail.documents.test.ts` / `apolloCache.test.ts` / `navItems.test.ts` | — | **8/0** (32 expect) · **11/0** (24 expect) · **20/0** (116 expect) | — |

### 6. Counter truth-check — **ALL MATCH**

| Counter | Expected | Fresh result |
|---|---|---|
| `bun tsgo` | 0 | **0 errors, exit 0** |
| `bun run oxlint` | 0 / 0 | **0 warnings, 0 errors** (1074 files, 303 rules) |
| `bun biome:check` | clean | **"Checked 1098 files. No fixes applied."** (worktree verified still clean afterward) |
| `bun run lint` | exit 0 | **exit 0** |

### 7. Zero-drift — **PASS**

`git diff main -- backend/db/schema/ backend/db/migration/ backend/drizzle/ backend/lib/gateway/public-operations.ts` → **EMPTY**. The canonical `backend/db/migration/3-immutability-triggers.sql` is consumed read-only (migration-DDL pin test reads it from disk). Generated artifacts (`frontend/graphql/generated/schema.graphql`, `gql/graphql.ts`) diffs are **purely additive** (0 removed lines; codegen output consistent with the hand-authored pothos shapes).

### 8. Ledger — **PASS**

`deferred-items.md` Ledger Table: **0 rows with ❌/⚠️** in the Status column (the glyphs appear only in the template legend below the table). **6 ✅ pre-registered rows intact** (D-ET-DROPDOWN, D-GOV-WINDOW, D-KEYSET, D-EXPORT, D-DETAIL-PROJECTION, D-TRIGGER-PUSH-GAP) **+ 1 📅 Forward row intact** (BF-BS-EVIDENCE). One prose nit inside a note cell (not the Status column): the BF-BS-EVIDENCE note still says "component suite (15 tests)" while the suite is now 17 (R1 remediation added two) — see I-1.

### 9. Plan-artifact token grep — **PASS** (only sanctioned hits)

`git diff main -U0 -- . ':(exclude)ai/plans/**'` scanned for `REQ-\d`, `Task \d`, `DEV3-020`, `\bD\d{1,2}\b`, `§\d`, `plans/sprint`, plus full-content greps across all 42 plan-owned files:
- **The only diff-added token lines outside `ai/plans/**`** are the two `REQ-065` occurrences in `frontend/views/dashboard/nav/navItems.test.ts` (docblock bullet + `describe` name) — per the dispatch, **sanctioned**: the file's REQ-token docblock/describe convention pre-exists on main (`REQ-054, REQ-064 (DEV1-005)`), so this follows the local convention, not a plan-artifact leak. Not counted as a finding.
- All other token occurrences verified **pre-existing on main** by per-file count comparison against `git show main:<file>` (`sdl-static-assertions.test.ts`: 11 REQ-token lines on main = 11 on branch, `D2` counts equal; `schema-surface.test.ts`: 3 D2 lines on both; `frontend/graphql/AGENTS.md`: 2 on both — the plan's AGENTS.md addition is token-free).
- Production files (service/repo/types/pothos/query/route/views/documents/cache/locale): **zero hits, including every newly created file.**

### 10. Holistic sweep — **PASS** (findings listed below)

- Journey teardown complete and leak-proof: audit rows deleted FIRST (actor-FK `ON DELETE RESTRICT` ordering honored; immutability trigger suspended via the sanctioned `withAuditDeleteTriggersSuspended`; plus a raw-SQL sweep of rows *about* the journey users as entities), defensive notification sweep, `TrackedFixtures` reverse-registration cleanup with mandatory zero-residue probes, and platform-wide row-count oracles back to baselines (a leaking `afterAll` fails the suite). Same discipline in the wire-matrix `afterAll` (tracked rows under suspended triggers → `deleteUsersByIds` → marker/actor residue probes).
- Test posture: no over-mocking — repository spies are call-through by default (canned returns only at the two sanctioned seams: corrupt-row injection and transaction-shape observation); wire tests run the real HTTP pipeline against real PostgreSQL with direct-DB oracles and exact-key-set projection pins; repo tests run inside rollback transactions; window boundaries pinned to the millisecond. No `dangerouslySetInnerHTML`; `details` rendered verbatim as escaped text children of a `dir="auto"` pre.
- Naming/comments accurate in every re-read file (exceptions noted in A-2 and F-1's docblock caveat).

---

## Findings

### F-1. [LOW] `app/(dashboard)/audit/page.tsx:67` + `frontend/views/admin/audit/audit-trail-filters.ts:203,205` — client id bound is wider than the wire `Int`, so an in-band oversized id degrades to an error surface instead of the documented silent drop

The route sanitizer accepts ids up to `Number.MAX_SAFE_INTEGER` (`parsed <= Number.MAX_SAFE_INTEGER`), and the interactive draft path (`appliedFiltersFromDrafts`) checks only `>= MIN_ID` (no upper bound). But `AdminAuditLogFiltersInput.actorId`/`entityId` are GraphQL `Int` (32-bit; pothos `t.int()`), and the backend wire suite itself pins `actorId: 99999999999999` dying as `GRAPHQL_VALIDATION_FAILED`. A crafted deep link (e.g. `?actorId=3000000000`) or a deliberately typed 10+ digit id therefore survives every client normalization, rides the wire as a variable, fails GraphQL variable coercion, and the view settles into the localized generic error surface with a retry affordance — contradicting the route docblock's own contract ("an invalid value is silently dropped … instead of an error") for the narrow id band `(2^31-1, 2^53-1]` (and producing a server VALIDATION rejection for values above 2^53-1 on the draft path). No security or data impact (the request never executes; the service-side `isPositiveSafeInteger` guard is unreachable for these values). Suggested one-line follow-up (non-blocking): bound both client id paths to `2147483647` so sanitizer, draft normalizer, and wire scalar agree.

### A-1. [ADVISORY] `frontend/views/admin/audit/AuditTrailResults.tsx:58-60` — empty `items` with `totalCount > 0` renders the empty state without the pagination footer

When a settled response carries zero items but a non-zero honest count (reachable when rows are deleted concurrently while the user sits on a late page), the whole results card — footer included — is replaced by the empty state, so the footer cannot paginate back; recovery is via Apply/Clear (both reset to page 0) or reload. Unreachable through ordinary footer navigation (TablePagination disables `next` at the last page; filters reset to page 0). Defensible honest-empty design; noted for future refinement (e.g. render the footer whenever `totalCount > 0`).

### A-2. [ADVISORY] `frontend/views/admin/audit/AuditTrailRow.tsx:69` — `formatApplicantDate` reused for audit timestamps

The shared formatter's name is domain-specific ("applicant") while this surface renders audit `createdAt` stamps. Helper verified pre-existing on main (`frontend/lib/i18n/format-date.ts`, commit `7449297`) — sanctioned reuse; naming observation only, no functional concern.

### A-3. [NIT] `backend/db/test/logic/audit/audit-trail.repository.test.ts:203` — vacuous exclusion assertion

`expect(idsOf(rows)).not.toContain(22)` anchors on the excluded fixture's **entityId** (22), not its **row id** (`idsOf` maps row ids), so the assertion can never fail regardless of filter behavior. The real exclusion proof is the `for`-loop action-type check directly above (and inclusion via `toContain(updateRow.id)`); this line should compare against the Create fixture's captured identity id. Zero behavioral risk — test-hygiene only.

### I-1. [INFO] `ai/plans/.../deferred-items.md:19` (plan artifact prose, not code) — stale count inside the BF-BS-EVIDENCE note

The note cites "the green component suite (15 tests)"; the suite is now **17** (R1 remediation added two). The Ledger Status column (the actual gate) is unaffected — documentation-drift note only, for the orchestrator's next touch of that file.

---

## Summary for the orchestrator

- **Verdict: FINDINGS (non-blocking)** — 1 LOW + 3 advisory/nit + 1 info; zero CRITICAL/HIGH/MEDIUM; zero regressions of R1/R2 fixes observed on adversarial re-read.
- All five mandated suites match their recorded signatures exactly (104/0 · 32/0 · 240/4 with the 4 proven pre-existing on main via a main-SHA worktree run · 140/0 · 17/0; bonus journey 7/0, documents 8/0, apolloCache 11/0, navItems 20/0); all four counters clean; zero drift on the four frozen areas; ledger clean with 6 ✅ + 1 📅 intact; generated artifacts purely additive.
- F-1 is a client-side bound mismatch with a documented-behavior caveat (one-line clamp if elected); A-1/A-2/A-3/I-1 are observations. None block ship.

---

## Remediation record (round 3) — Task ID: 6-fix2

**Agent:** fix-wave R3 · **Source-fix commit:** `e3adbdf55a851bd95ad3d6466dd14b9d3ceb08ef` (parent `333e51f`, branch `feat/dev3-020-immutable-audit-logging-for-all-admin-ac`) · **Scope:** exactly the three findings above; no checkbox flips, nothing else touched.

- **F-1 [LOW] — FIXED (both client paths, drop-not-clamp).** `page.tsx` `sanitizeIdParam` now bounds to `MAX_ID = 2147483647` (the GraphQL `Int` wire max, 2^31 - 1 — replaces the wider `Number.MAX_SAFE_INTEGER` ceiling, so `?actorId=3000000000` drops the param); `audit-trail-filters.ts` `appliedFiltersFromDrafts` applies the same `<= MAX_ID` bound to BOTH id ternaries (out-of-range draft applies as cleared). `parseIdInput` untouched (reused; call-site bounds only). One mirrored component test added: draft `3000000000` applies as cleared — the wire variables carry NO actorId and no error seam renders.
- **A-3 [NIT] — FIXED.** `audit-trail.repository.test.ts:203` anchors the excluded Create fixture's own identity id (`createRow.id`) instead of the vacuous `22` (entityId); the for-loop action-type proof and the `toContain(updateRow.id)` inclusion pin are intact.
- **I-1 [INFO] — FIXED.** `deferred-items.md` BF-BS-EVIDENCE note now reads "component suite (17 tests)" (prose only; Ledger Status column untouched).
- **Gates (all green at the fix commit):** component suite **18 pass / 0 fail / 112 expect** (was 17/0/106); `audit-trail.repository` suite **15 pass / 0 fail / 46 expect**; sub-loop `--lifecycle duplicates` **exit 0** on all four touched code files; `bun tsgo` **exit 0**.
