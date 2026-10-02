# Admin Academic Tracking — Derived Milestone Read Model

> Domain architecture guide for the admin academic-tracking surface: the read-only cross-student memorization/revision monitoring dashboard (latest Jadid/Madi positions, per-track grade summaries, progress counts, needs-attention flags, aggregate advancement statistics) and its per-student drill-down.

**Domain:** Admin / Academic governance (Milestone 3 — Parent Portal & Admin Governance)
**Source ticket:** Admin Academic Tracking (Memorization & Revision Milestones) — Milestone 3, admin governance stream
**Status:** Implemented and verified

This document is the canonical reference for the academic-tracking read model. The surface derives EVERYTHING it renders from existing tables at read time — it owns zero schema, zero writers, zero audit vocabulary, zero notification fan-out. All layers (types, repository, service, GraphQL, frontend, tests) conform to the contracts below; the authoritative implementations are cited by path in each section.

---

## Why

Admins must monitor memorization and revision progress across ALL students without reading per-teacher surfaces: who is advancing, where each track stands (Surah/Juz + ayah span), how grades trend, and which students need attention. The data already exists — teachers submit Jadid (`current_*`) and Madi (`revision_*`) homework rows with write-once grades through the session-report flow — so the surface is a pure READ MODEL over `home_work ⋈ session ⋝ users` plus the skeleton `progress` count. Deriving at read time (instead of denormalizing counters) keeps one source of truth and makes the surface immune to write-path drift.

Three load-bearing properties:

1. **Constant-denial oracle.** Every non-admin caller — teacher, student, parent, anonymous — receives the SAME byte-identical localized denial regardless of the id probed (valid, foreign, nonexistent, malformed). Zero existence oracle: a non-admin can never distinguish "exists" from "doesn't".
2. **Snapshot consistency.** Each request captures ONE `now` instant and threads it to every windowed read; rows stamped after the instant count in none of the aggregates. A dashboard can never disagree with itself mid-page.
3. **Honest aggregates.** Averages over zero graded rows are `null` (never a fabricated zero); zero-row students appear with null academic fields; out-of-range pages return empty `items` next to the honest `total`.

---

## Pattern

### Layer stack (single canonical types file, no service-layer types)

| Layer | Path | Responsibility |
|---|---|---|
| Types | `backend/types/admin/admin-academic-tracking.types.ts` | All derived shapes: `*SelectType` (repo output, native `Date`), `*ReturnType` (wire shapes, ISO-string timestamps), submit inputs; `readonly` members; the `AdminAcademicAttentionReason` string union |
| Repository | `backend/db/repo/admin/academic-tracking.repository.ts` (+ `academic-tracking-query-helpers.ts`) | Five single-statement guarded SELECTs: paged directory rows (page-slice derived table + `LEFT JOIN LATERAL` per-student lanes), honest total (shared predicate extract), platform stats (one conditional aggregation), attention-signal inputs, soft-delete-aware student echo |
| Service | `backend/services/admin/admin-academic-tracking.service.ts` (+ `constants/helpers/mappers`) | Gate-first (`assertActorAdminActive`), one read-only transaction, pre-DB bounds validation, `Promise.all` over the same tx, attention-threshold composition, Date→ISO mapping |
| GraphQL | `backend/graphql/pothos/admin/academic-tracking.pothos.ts` + `backend/graphql/query/admin/academic-tracking.query.ts` | 13 Pothos objects + the one new enum (`AdminAcademicAttentionReason`), two root queries registered by side effect through exactly two barrel lines |
| Frontend | `frontend/views/admin/academic-tracking/**` + `sharedDocuments/admin/academic-tracking.documents.ts` | Server shells behind `withPageAuth([Admin])`, client containers (stateful `useQuery`), honest states, `adminAcademic` i18n namespace (en/ar parity-tested) |

### The derived read model

- **Position honesty per track:** the newest GRADED homework row carries the achieved position; when no graded row exists, the newest row carrying a surah/juz reference stands in (an ungraded assignment is the teacher's plan, not an achieved position). A graded row without a reference yields a null position — the fallback never outranks a graded row.
- **Attention rules (service constants, never client args):** `lowGrade` when the average of the last 10 graded Jadid rows is < 60 (zero graded rows ⇒ NOT flagged — absence ≠ failure); `staleProgress` when the student has ≥1 completed session AND zero graded rows in the last 14 days (staleness anchored on the graded rows' grade-write stamp, falling back to the assignment stamp). Both reasons may co-occur; the flag is computed per request and never persisted.
- **Soft-delete posture:** the dashboard predicate hard-seals `role = student AND is_deleted = false` (shared by rows/count/stats/signals so list and total can never drift); the drill-down echo is the ONE reader that returns soft-deleted students (the header banners the deletion) and still resolves only the student lane.

### Snapshot discipline

The caller captures `now = new Date()` once per request inside the transaction. Every windowed read closes at that instant — statement-level visibility, no cross-metric drift. Grade state reads as committed (grades are write-once and monotonic).

---

## Rules

1. **Gate before ANY read.** Both service methods call `assertActorAdminActive(actorId, locale)` first; denials localize through `getServerTranslations(locale, ...)` with ≤1 bounded `logDomainError` per denial. Wire-level, both queries carry `authScopes: adminOnlyAuthScopes` (the explicit `$all` conjunction) plus the `requireAdminUser` narrowing belt.
2. **Raw SQL timestamps need an explicit decoder.** The pg driver returns raw-fragment timestamps (`max(...)`, `filter (where ...)`) as strings; every such selection maps through a null-safe `Date` decoder (`decodeNullableTimestamp` in the query helpers) — a NULL stamp stays `null`, never an epoch.
3. **`progress.student_id` shares the users PK.** `students.id` is a shared PK/FK to `users.id`, so `progress.studentId = users.id` correlates directly — no join through the role-child table is needed anywhere in this repo family.
4. **Search escaping is one-point.** The service escapes LIKE wildcards AND wraps `%…%` (`escapeLikeWildcards`); the repository binds the final pattern verbatim to its `ilike` predicates and never re-escapes. One canonical escape point, one binding point.
5. **LATERAL lanes window by the page slice.** The page slice is computed FIRST (filter + order + limit/offset) and the per-student lanes are `LEFT JOIN LATERAL` against it — lateral lookups run only for the requested window, each lane yields ≤1 row per student, and no fan-out can cross students.
6. **Test fixtures must stamp rows inside the snapshot window.** Readers close their windows at the captured `now`; a fixture relying on `defaultNow()` (the real clock) is honestly excluded — fixtures stamp explicit past instants relative to the fixed snapshot.
7. **Locale-differentiated wire probes need dedup-free clients.** Apollo Client deduplicates in-flight queries on document + variables; two probes differing only in context headers collapse into one request and share the first response (locale assertions silently receive the wrong copy). Integration probes that vary ONLY by locale/context must run on a `queryDeduplication: false` client (constructor-level option in @apollo/client v4 — per-call flags are ignored).
8. **Variable-coercion failures are `BAD_USER_INPUT`.** A fractional value against `Int!` fails coercion at the transport (Apollo Server protocol code); `GRAPHQL_VALIDATION_FAILED` is reserved for document-level parse/validation failures. Service-level shape gates (0 / negative) throw the localized `VALIDATION` DomainError.
9. **Id-less GraphQL value objects get `keyFields: false`.** The pagination envelopes, stats block, position/summary value objects, attention flag, detail wrapper, and per-entry track block are cached inline; only `id`-carrying rows normalize (Apollo cache policies in `frontend/providers/apollo/apolloCache.ts`).

---

## Anti-patterns

- **Denormalizing milestone counters.** A `students.milestones` column would fork the write path and drift from `home_work`. The read model derives; it never persists.
- **Client-supplied windows.** Any repo parameter that lets a caller size an attention window or bound an aggregate breaks the D3 discipline — windows are service/repo constants only.
- **Unbounded per-row reads.** Correlated per-row subqueries outside the page-slice LATERAL lanes are N+1 by construction; set-oriented statements with conditional aggregation (`filter (where ...)`) are the pattern.
- **Fabricated values in honest slots.** Zero graded rows ⇒ `null` average (never 0); absent position ⇒ the localized "none" label; null stamp ⇒ the em-dash placeholder. The three honest states never share a label.
- **Silent fixture drift in shared databases.** Interrupted integration runs leave committed fixture students; unscoped search probes must include the run token to stay deterministic.
- **Plan-artifact tokens in code comments.** Comments/JSDoc describe domain behavior — requirement ids, task ids, and decision shorthand never appear in shipped code.

---

## Rollout Summary

- Shipped: the read-only admin academic dashboard (`/admin/academic-tracking`) + per-student drill-down (`[studentId]`), the `adminAcademic` i18n namespace (en/ar, parity-tested), the nav entry (admin block, after `/students`), the SDL/codegen refresh (query surface 59 → 62 fields, Mutation frozen at 50), and the four test suites (repository 21, service/helpers/mappers, journey 6, wire matrix 34).
- Deliberately out of scope: CSV/export envelopes, percentage-through-curriculum maps, any write surface (the feature dispatches zero mutations, audit rows, and notifications).
- Known bounded trade-offs (documented in the plan's deferred ledger): the drill-down resolves session/teacher context via page-bounded indexed PK reads, and reuses the whole-lane attention-signal read for one student's flag — both correct and page-bounded; a batched/scoped variant is a follow-up optimization.

---

## Related Documents

- `docs/admin/platform-analytics.md` — the conditional-aggregation and `Promise.all`-over-one-transaction patterns this surface clones
- `docs/admin/account-governance.md` — the soft-delete lifecycle the dashboard seals and the drill-down banners
- `docs/admin/admin-session-governance.md` — the session lifecycle feeding `completed` sessions and the session-report substrate
- `backend/types/admin/admin-academic-tracking.types.ts` — the canonical shape contracts
- `backend/db/repo/admin/academic-tracking.repository.ts` — the statement-level implementation
- `backend/services/admin/admin-academic-tracking.service.ts` — the gate/validation/composition flow
