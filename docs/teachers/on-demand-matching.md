# On-Demand Teacher Matching — Canonical Reference

**Domain:** Teachers / On-demand matching algorithm (student browse: eligibility filter, quoted-token match, country-tier + rating sort pipeline)
**Specs:** `docs/specs/functional-requirements.md` (FR-4.4), `docs/specs/state-machine-invariants.md` (INV-A3 — the read-side predicate this pipeline owns), `docs/backend/cross-stream-contracts.md` (§7.3 — the TOCTOU re-assertion this pipeline deliberately does NOT own)
**Ticket:** `docs/planning/TICKETS.md` — "On-Demand Matching Algorithm (Filter/Sort Pipeline)". The student-facing browse API/UI is the sibling "Teacher Directory Browse & Filter API" ticket and is NOT built here.
**Sibling docs:** `docs/teachers/teacher-availability.md` (the `is_online` writers this pipeline observes), `docs/teachers/teacher-average-rating.md` (the single-writer cached rating this pipeline sorts by), `docs/sessions/session-lifecycle.md` (the in-session lock/release writer whose `started` rows this pipeline excludes on)
**Status:** Implemented and verified — all layers are in-tree and their test locks are green (repository suite, 4-tier service suite, cross-actor journey).

This document is the canonical reference for the student's on-demand teacher matching read: what makes a teacher eligible, how the per-browse choices become SQL token filters, how results are ordered and paginated, and the invariants every future consumer or writer MUST preserve. All layers (schema, types, mappers, repository, service, locale, tests) conform to what is described here. Code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Why

A student who wants to start a hifz or tajweed session needs to answer one question: *"which certified teachers are available right now for the recitation I am reading?"* Before this pipeline, the platform had all the individual ingredients — `teacher.is_online` (the availability toggle), `teacher.is_approved` (certification), the session table (the in-session lock), `teacher.subjects` + `teacher.average_rating` (profile + quality) — but no student-facing composition of them. The only consumers of those signals were admin surfaces and the session lifecycle itself.

This pipeline is that composition, as a **pure read**: it turns a student's per-browse choices (recitation, evaluation intent excluded) plus the student's own profile (country, preferred language) into one SQL-filtered, SQL-sorted, SQL-paginated page of teacher cards. It writes nothing, dispatches nothing, and hides nothing that the eligibility predicates do not hide — the empty state is an honest empty page, not an error.

Three boundaries give the pipeline its shape:

- **Student-only callership.** The caller identity is the server-derived student user id; a caller without a `students` row is denied with the canonical `STUDENT` not-found error, disclosing nothing. There are no client-supplied teacher or student ids anywhere in the input.
- **Domain boundaries are respected, not re-implemented.** Certification, availability truthfulness, and the in-session lock are owned by their own surfaces (`docs/teachers/teacher-availability.md`, `docs/sessions/session-lifecycle.md`); the matcher only READS their results — with one load-bearing exception (§3.2: the stale-flag window forces a compose rule).
- **Booking is a different seam.** A browse result is a point-in-time snapshot; the session-creation flow re-asserts availability under a row lock (§3.8). The matcher's job ends at the page.

---

## 2. Pattern

### 2.1 The pipeline (data flow)

```
student browse (per-browse choices: recitation, intent, search, minRating,
  │              sort; caller: ctx user id)
  │
  ├── 1. Service validation  (backend/services/teachers/teacher-matching.service.ts)
  │        ├── recitation checked against the shared catalog guard (isRecitationReading)
  │        ├── intent restricted to hifz | tajweed (evaluation is NOT a browse intent)
  │        ├── sort restricted to the TeacherMatchingSort member set
  │        ├── page/pageSize bounds resolved + localized rejection out of range
  │        │    (resolvePageBounds — backend/services/admin/user-management.query.helpers.ts)
  │        └── caller resolved: users row → students row; either miss ⇒
  │             NotFoundError("STUDENT", studentHandshakeNotFound) + ONE bounded log
  │
  ├── 2. Token normalization (pure, service-side — the ONE escape point, §3.1)
  │        language resolution: primary ?? another → trimmed/lowercased token;
  │        null or Arabic ⇒ NO language predicate (Arabic is the platform baseline)
  │
  ├── 3. Repository read     (TeacherRepository.listMatchingCandidates —
  │        backend/db/repo/teachers/teacher.repository.ts)
  │        teacher INNER JOIN users on the shared PK
  │        WHERE  <eligibility chain, §2.2>
  │        ORDER BY country tier ASC, <sort key, §2.3>, id DESC
  │        LIMIT/OFFSET  + same-filter count(*)::int sibling (Promise.all — honest total)
  │        └─ the in-session check is a correlated NOT EXISTS inside the ONE query
  │           (zero N+1; served by session_teacher_id_status_idx)
  │
  └── 4. Projection          (backend/services/teachers/teacher-profile.mappers.ts)
           raw rows mapped field-by-field through the fail-closed parsers
           (§3.3) into the closed 9-field card; envelope
           { items, total, page, pageSize, pageCount = ceil(total / pageSize) }
```

The canonical shapes are pinned in `backend/types/teachers/teacher-matching.types.ts` (input, item card, page envelope, student context) and locked by `backend/types/teachers/teacher-matching.types.static-assertions.test.ts`. The whole pipeline is read-only: no lock is taken, no write is issued, no notification is dispatched — concurrent browses are safe by construction, and the journey test asserts zero row deltas and zero dispatches across every browse step (`test/workflows/teachers/on-demand-matching.journey.test.ts`).

### 2.2 The eligibility predicate list

A teacher is a candidate for a browse page if and only if ALL of the following hold (built in `buildTeacherMatchingFilterChain`, `backend/db/repo/teachers/teacher.repository.ts`):

| # | Predicate | Column(s) | Note |
|---|---|---|---|
| 1 | Online | `teacher.is_online` | `eq(true)` — a nullable boolean reads fail-closed: `null`/`false` never qualify |
| 2 | Certified | `teacher.is_approved` | same fail-closed `eq(true)` discipline |
| 3 | Not governed | `users.is_deleted` / `users.suspended` / `users.is_blocked` | `is distinct from true` — NULL-safe, §3.5 |
| 4 | Not in a started session | `session` via correlated `NOT EXISTS` | same table + same status value as the booking oracle, §3.2 |
| 5 | Teaches the requested recitation | `teacher.recitations` | quoted-token `ilike`, §3.1 |
| 6 | Teaches the requested intent as a subject | `teacher.subjects` | quoted-token `ilike`, §3.1 |
| 7 | (non-Arabic students only) Fluent in the student's language | `teacher.languages` | quoted-token `ilike`; omitted entirely when the student's resolved language is null/Arabic |
| 8 | (optional `search` set) Display name matches the search substring | `users.full_name` | PLAIN substring `ilike` — NO quoted-token anchor (a varchar column, not a JSON payload); escaped at the service's single escape point; empty/whitespace means "no search" |
| 9 | (optional `minRating` set) Rating floor satisfied | `teacher.average_rating` | parameterized `>=` bound (decimal string, the wallet funds-guard precedent); the honest SQL semantics exclude the unrated (NULL never satisfies a `>=`) |

Predicates 5–7 match the RAW stored JSON payloads in SQL — string containment on quoted tokens. Predicates 1–4 are the eligibility core; 5–9 narrow it per browse (8–9 only when the student opts in). Nothing else excludes: country (§3.7) and rating POSITION are ordering concerns, never filters (a rating FLOOR chosen by the student is the one sanctioned exception, and it excludes only by the student's own request).

### 2.3 Ordering: country tier, then the chosen sort key, then id

```
ORDER BY country_tier ASC,          -- 0 = same country as the student, 1 = foreign (ALWAYS first)
         <sort key>,                -- the student's `sort` choice (RATING_DESC by default):
                                    --   RATING_DESC → average_rating DESC NULLS LAST
                                    --   NAME_ASC    → users.full_name ASC
                                    --   NEWEST      → teacher.id DESC (the tiebreak repeats it)
         id DESC                    -- deterministic tiebreak (stable pagination; ALWAYS last)
```

Country precedence is a **soft ordering** (§3.7) built as a CASE tier: the student's `country_code` match is tier 0; a legacy free-text `country` match (case-insensitive) is the fallback arm; a student with neither gets a single tier. The tier is NEVER displaced — every `sort` choice re-orders only the post-tier band. The default `RATING_DESC` key is byte-identical to the pre-sort-choice ordering, so an absent/legacy client sees exactly the historical page. Rating is the honest-null column maintained by the rating submission flow (`docs/teachers/teacher-average-rating.md`) — the sort preserves its honesty instead of fabricating a zero (§3.6); the same honesty applies to the optional `minRating` floor (predicate 9): a NULL rating never satisfies `>=`, so a floored browse excludes the unrated by construction.

### 2.4 The page envelope and the card

The envelope is `{ items, total, page, pageSize, pageCount }` with `pageCount = Math.ceil(total / pageSize)`. Zero eligible teachers is a valid, honest result: `{ items: [], total: 0, … }` — never an error; the browse UI renders the `teacherDirectory.noTeachersAvailable` copy from the `shared/locale/teacherDirectory` namespace (en/ar parity-locked by `shared/locale/teacherDirectory-namespace.parity.test.ts`). The card is a closed 9-field projection — `id`, `fullName`, `country`, `countryCode`, `subjects`, `recitations`, `languages`, `averageRating` (parsed float), `isOnline` — with no email, phone, hash, or timestamps (§3.10).

---

## 3. Rules

### 3.1 One escape point: gate → JSON-quote → escape → `%…%`

Every free-text token that reaches a LIKE/ILIKE predicate passes through exactly ONE normalization site — the service — in this order:

1. **Gate** — enum-backed tokens (`recitation`, `intent`) are validated against their catalogs before any pattern exists; free-text tokens (language) are trimmed, lowercased, length-capped, and rejected if they carry `"` or `\` (either would break the quoting scheme). The name-search choice takes the PLAIN-SUBSTRING arm (no gate quotes — step 2 does not apply to it): trimmed, length-capped (80), empty ⇒ no predicate.
2. **JSON-quote** — the token is wrapped as `"token"`. The columns store JSON arrays (`["hafs_an_asim","english"]`), so the quotes anchor token boundaries: a search for `"hifz"` can never match `"hifz_jadid"`. The display-name search deliberately SKIPS this step — `users.full_name` is a plain varchar, a free-text substring match is the contract, and the quoted-token anchor would only narrow the match dishonestly.
3. **Escape** — `escapeLikeWildcards` (`backend/lib/db/escape-like-wildcards.ts`) prefixes every `\`, `%`, `_` so the token's own characters stay literal. The order is load-bearing: the backslash is escaped FIRST, so the `%`/`_` escapes it then introduces are not themselves treated as escapable characters by PostgreSQL.
4. **Wrap** — the escaped quoted token becomes `%…"token"…%`.

The repository receives the FINISHED pattern and binds it to `ilike(column, pattern)` as a parameter. It never re-escapes, never re-wraps, never concatenates user input into SQL. This is the same discipline the admin directory search established; the helper's own contract states it, and the repo test suite pins it (a raw `_` injected into a pattern still matches, proving the repo does not silently re-escape). A future consumer that "helpfully" escapes in a second place double-escapes `\` and corrupts every token carrying a wildcard character.

### 3.2 The compose rule: `is_online` alone never decides visibility

`teacher.is_online` has two writers (manual toggle, session lifecycle) and one known stale-flag window: the release path can restore `is_online = true` while a session is still `started` (the INV-A4 hazard documented in `docs/teachers/teacher-availability.md`). A teacher can therefore be `is_online = true` AND in-session at the same instant.

The matcher's visibility predicate MUST compose the flag with session state:

```
eligible ⇔ is_online = true AND NOT EXISTS (started session for the teacher)
```

The `NOT EXISTS` dominates the stale flag — the in-session teacher stays hidden regardless of what `is_online` claims. **Oracle parity is the test anchor:** the read-side predicate uses the SAME table (`session`) and the SAME status value (`started`) as `assertTeacherNotInActiveSession` (`backend/services/classes/session-lifecycle.enforcement.ts`) — the write-side/booking oracle. The journey test re-derives the eligible set from raw rows and proves the browse exclusion set equals the oracle's throw set in both directions on a mixed cast (including a stale-`true` + started-session fixture). If either side changes its session-state definition without the other, the parity test fails.

### 3.3 Fail-closed parse direction: corrupt JSON degrades, never throws

The token columns are `varchar(255)` holding JSON arrays, parsed at the projection layer by the shared parsers in `backend/services/teachers/teacher-profile.mappers.ts` (`parseSubjectsJson`, `parseTeacherRecitations`, `parseTeacherLanguages`, `parseAverageRating`). The direction is fail-closed and one-way:

- `null`, empty, whitespace, non-JSON, non-array-root, or wrong-typed-member payloads degrade to `[]` (rating: `null`). A corrupt payload NEVER throws into a read path — a stored-garbage row renders with an empty list instead of failing the whole page.
- `parseTeacherRecitations` additionally intersects members with the catalog guard, so a stale or out-of-catalog value silently drops from the card.
- **Eligibility and projection are independent.** Eligibility is decided in SQL on the RAW payload (a row whose payload is `["hafz"` — unparseable tail — can still match a token LIKE if its raw characters do); the projection parser independently degrades that row's card to `[]`. Eligibility is never weakened by parsing, and parsing never re-decides eligibility. The repo suite locks this interplay with a corrupt-JSON edge test.
- SQL does NOT parse JSON. The `varchar(255)` + quoted-token containment scheme exists precisely so the read needs no `jsonb` casts; parsers live at the projection layer only.

### 3.4 JSON-in-varchar(255) capacity discipline

The token columns follow the established `teacher.subjects` pattern: a JSON array serialized into a `varchar(255)`, nullable, no default. The bound is load-bearing and must be re-checked whenever the stored vocabulary grows:

- `teacher.recitations` holds only `RecitationReading` catalog values (`shared/constants/recitation-reading.enum.ts`) — the full ten-value catalog serializes to ≈192 characters, inside the bound with headroom.
- `teacher.languages` holds lowercase free-text tokens; writers MUST keep the total serialized array within 255 (strict validation at the write surface is the owner's obligation — the read side is fail-closed either way, §3.3).
- Any future member-value change MUST re-run the capacity check before landing; an overflowing payload is truncated by the column and the truncated JSON is exactly the corrupt payload §3.3 degrades.

### 3.5 Governance exclusion is NULL-safe: `is distinct from true`

Deleted, suspended, and blocked accounts must never surface in a browse page. The exclusion is written as `is distinct from true` (not `= false`), because the governance flags are nullable booleans with legacy rows carrying `NULL` meaning "never governed". `flag = false` would silently exclude those legacy rows; `flag is not distinct from true`-style coercions and `coalesce(flag, false) = true` are alternative spellings with the same semantics, but the codebase's form is the bare `is distinct from true` — keep it. The repo suite pins the fragment and proves a legacy-`NULL` governance row stays visible while an explicit `true` disappears.

### 3.6 Rating ordering: `DESC NULLS LAST` + deterministic `id` tiebreak

- PostgreSQL's `DESC` default is `NULLS FIRST` — an unrated teacher would sort ABOVE every rated one. The pipeline always writes `desc nulls last` explicitly: an honest null means "not yet rated", and the sort treats it as worse-than-any-rating, never as zero (zero is an impossible average — see `docs/teachers/teacher-average-rating.md`). Never substitute `coalesce(average_rating, 0)`: it fabricates a rating, breaks the honest-null contract, and erases the discoverability difference between "unrated" and "rated lowest".
- The final tiebreak is `id DESC`. Equal ratings are common (many teachers share 0 ratings or cluster at 5.00); without a deterministic tiebreak, consecutive pages can duplicate or drop rows when inserts shift row order mid-pagination. The repo tests paginate through equal-rated fixtures and assert page-stable membership.

### 3.7 Country is an ORDER-BY tier, never a WHERE

Prioritizing same-country teachers is a preference, not an eligibility requirement — a student with no eligible same-country candidates must still see the rest of the world, tiered after. The tier is computed as a CASE expression over the joined `users` row (code arm → legacy-text arm → single-tier constant) and used ONLY in `ORDER BY`. Two traps are locked by tests:

- A missing student country pair collapses to ONE tier (every candidate is "tier 1") — rating then decides; it must not exclude anyone.
- The no-tier arm is the constant expression `1 = 1`, not a bare integer literal: a bare `1` in ORDER BY is parsed by PostgreSQL as an output-column ordinal and silently sorts by the first selected column, destroying the tier key.

### 3.8 Browse is a point-in-time snapshot — re-assertion at booking is NOT this pipeline's job

A browse page reflects the eligibility predicates at the instant of its query. A teacher may toggle offline, or enter a session, between the student's page render and the booking — accepted by design. The ownership seam is explicit in `docs/backend/cross-stream-contracts.md` (§7.3 TOCTOU Re-Assertion): the session-creation flow MUST re-assert `isOnline` + `is_approved` under `SELECT FOR UPDATE` before consuming a browse result. The matcher discloses its snapshot nature, takes no locks (the path is 100% reads), and MUST NOT grow booking-side verification — that would duplicate the session engine's contract instead of consuming it.

### 3.9 Schema flows through push, never migration files

The matcher's storage additions (the two `varchar(255)` token columns in `backend/db/schema/teachers/teacher.ts`, the `session_teacher_id_status_idx` composite index in `backend/db/schema/classes/session.ts`) landed as Drizzle schema edits applied with `db push`. `backend/db/migration/**` and `backend/drizzle/**` MUST stay untouched — no hand-written SQL migration files, no generated migration drift, no new pgEnum, no junction table (the JSON-in-varchar token pattern is deliberate, §3.4). `TeacherSelectType` picks new columns up automatically via `$inferSelect`; there is nothing to hand-maintain in the types layer.

### 3.10 The card is a closed, PII-free projection

The item card is built field-by-field from the raw row through the parsers — never a spread of the row. Its 9-field shape is pinned three ways: exact-keyof type assertions, compile-time absence of `email`/`phoneNumber`/`passwordHash`/`createdAt` (and friends), and a runtime key-whitelist scan (`backend/types/teachers/teacher-matching.types.static-assertions.test.ts`). Adding any column to the card — PII or not — fails compilation first. The same closed-shape discipline applies to the input: a 4-field interface, no id fields, no spread into any builder (BOPLA), and the caller's id comes from the server-derived identity, never from the payload (BOLA).

### 3.11 Journey-first with the oracle-parity anchor

The feature's executable spec is the cross-actor journey `test/workflows/teachers/on-demand-matching.journey.test.ts`, written BEFORE the service and red until it lands. It encodes the full student/teacher lifecycle interplay (visibility, toggle off/on, in-session hide, completion reappear with the shipped completion receipt intercepted and tracked, unsatisfiable browse, non-Arabic filter, non-student denial) and carries two anchor patterns worth reusing:

- **The oracle-parity anchor** (§3.2) — set-equality proof between the read-side exclusion set and the write-side oracle's rejections, computed from raw rows inside the test.
- **Zero-side-effect browse assertions** — every browse step asserts zero row-count deltas (scoped to fixture ids) and zero notification dispatches; lifecycle steps carry their own shipped side effects, which are spied and tracked rather than denied.

Layered beneath the journey: the repo suite (`backend/db/test/repo/teachers/teacher.repository.test.ts`) locks the SQL semantics branch-by-branch (including the stale-flag compose rule, tier arms, NULLS LAST, tiebreak, pagination honesty, corrupt-JSON edge), the parser suite (`backend/services/teachers/teacher-profile.mappers.test.ts`) locks the fail-closed direction, and the static-assertion suites lock the type shapes (§3.10).

---

## 4. What NOT to Do

### 4.1 Never create a second escape point

All pattern building lives in the service. A repo method that escapes, a helper that re-wraps `%…%`, or a caller that pre-escapes before the service each break the single-escape-point contract — double-escaping corrupts tokens carrying `\`/`%`/`_`, and un-escaped paths re-open the wildcard-injection surface. The repo MUST keep binding finished patterns verbatim.

### 4.2 Never filter visibility on `is_online` alone

The stale-`true` window (§3.2) makes a flag-only filter WRONG even though the flag is usually truthful. Any new read surface that decides "is this teacher browsable?" MUST compose the flag with the started-session `NOT EXISTS` — and keep the oracle parity intact.

### 4.3 Never loop the per-teacher session oracle across a page

`assertTeacherNotInActiveSession` is the booking/write-side oracle; calling it per row to filter a page is N+1 by construction. The bulk `NOT EXISTS` in the one candidate query is the read-side form of the same question. Conversely, do not point booking code at the LIKE-based read — booking goes through the locked re-assertion (§3.8).

### 4.4 Never parse JSON in SQL, and never throw on corrupt payloads

No `jsonb` casts, no `json_*` functions, no payload repair jobs triggered from the read path. Eligibility matches raw tokens; parsers degrade (§3.3). A stored-payload cleanup, if ever needed, belongs to the write/ops surface that owns the column — not to the student browse.

### 4.5 Never turn country or language preference into an exclusion

Country tiers are ORDER BY only (§3.7). Language is a hard filter ONLY for non-Arabic students whose profile resolves to a concrete language; an Arabic-baseline or language-less student MUST see the unfiltered-by-language page (Quran teaching is Arabic-native — the absent filter is the default, not a gap).

### 4.6 Never widen the card or spread rows into it

No email, phone, hash, timestamps, governance fields, or ids-beyond-the-card on the item. No `{ ...row }` projection, no `{ ...input }` into builders. The static pins (§3.10) fail on drift by design — update them in the same change as any sanctioned shape change, never around them.

### 4.7 Never patch the stale-`true` hazard from the read side

The compose rule (§3.2) is a read-side defense, not the cure. The root fix — a persisted prior-online marker consumed by the release transaction — belongs to the In-Session Locking ticket (`docs/planning/TICKETS.md`, "In-Session Locking (Hide from Directory)"). The matcher MUST NOT grow flags, markers, or writes to compensate.

### 4.8 Never migrate, never enum the tokens

No files under `backend/db/migration/**` / `backend/drizzle/**`, no new pgEnum, no junction table for recitations/languages/subjects (§3.9). The JSON-in-varchar + quoted-token scheme is the design; replacing it with normalized tables or DB enums is a schema-architecture decision, not a matching-pipeline edit.

### 4.9 Never fabricate ratings or clamp the total

No `coalesce(average_rating, 0)` in ordering (§3.6); no page-clamped `total` — the count sibling shares the page query's predicate so `total` is honest even beyond the last page; an out-of-range page returns empty rows + the unchanged count, never an error.

### 4.10 Never let a browse write

The pipeline is read-only end to end: no availability writes, no counters, no analytics side rows, no notifications, no logging on the happy path (one bounded log on the caller-miss denial only). If a feature seems to need a write inside a browse, it is a different feature on a different surface.

---

## 5. Rollout Summary

The algorithm shipped as one additive backend changeset — zero GraphQL, zero frontend, zero public-operations changes (the sibling "Teacher Directory Browse & Filter API" ticket owns the API/UI and consumes the service + envelope as its contract).

| Layer | Path | Purpose |
|---|---|---|
| Schema | `backend/db/schema/teachers/teacher.ts` | +`recitations`, +`languages` (nullable `varchar(255)` JSON-in-varchar, push-applied) |
| Schema | `backend/db/schema/classes/session.ts` | +`session_teacher_id_status_idx` (serves the in-session `NOT EXISTS`) |
| Types | `backend/types/teachers/teacher-matching.types.ts` | Canonical shapes: intent, submit input, item card, page envelope, student context |
| Types | `backend/types/teachers/teacher-matching.types.static-assertions.test.ts` | Shape + PII-absence pins (§3.10) |
| Types | `backend/types/contracts/teacher-availability.contract.types.ts` | `TeacherMatchingLanguagesInput` exported additively (contract consumed, not forked) |
| Parsers | `backend/services/teachers/teacher-profile.mappers.ts` | Canonical fail-closed parser home (subjects/rating moved verbatim from the admin mapper; recitations/languages added) |
| Repository | `backend/db/repo/teachers/teacher.repository.ts` | `listMatchingCandidates` — the eligibility chain, tier + ordering, count sibling |
| Repository tests | `backend/db/test/repo/teachers/teacher.repository.test.ts` | SQL-semantics locks: eligibility matrix, compose rule, tiers, NULLS LAST, tiebreak, pagination, corrupt-JSON edge, binding pins |
| Service | `backend/services/teachers/teacher-matching.service.ts` | `browseAvailableTeachers` — validation, caller resolution, token normalization (the ONE escape point), delegation, projection |
| Service tests | `backend/services/teachers/teacher-matching.service.test.ts` | 4-tier suite: branch matrix, boundaries, concurrency, wildcard-injection probes |
| Journey | `test/workflows/teachers/on-demand-matching.journey.test.ts` | Cross-actor journey with the oracle-parity anchor + zero-side-effect browse assertions |
| Locale | `shared/locale/{types,en,ar,namespaces}/teacherDirectory/**`, `shared/locale/teacherDirectory-namespace.parity.test.ts` | `teacherDirectory.noTeachersAvailable` empty-state copy (en/ar parity-locked) |
| Docs | `docs/teachers/on-demand-matching.md` | This document |

Byte-frozen by design: `backend/graphql/**`, `frontend/**`, `app/**`, `backend/lib/gateway/public-operations.ts` — the sibling ticket owns those surfaces and MUST consume the service contract without this slice moving a byte of them.

---

## 6. Related Documents

- **Availability toggle** — `docs/teachers/teacher-availability.md` — the manual `is_online` writer (INV-A1/A2), the two-writer split, and the INV-A4 stale-flag hazard that motivates the compose rule (§3.2).
- **Average rating** — `docs/teachers/teacher-average-rating.md` — the single-writer cached `average_rating` this pipeline sorts by; the honest-null ruling this pipeline's `NULLS LAST` ordering preserves (§3.6).
- **Session lifecycle** — `docs/sessions/session-lifecycle.md` — the in-session lock/release writer; the `started` status value shared by the read-side predicate and the booking oracle.
- **State-machine invariants** — `docs/specs/state-machine-invariants.md` — INV-A3 (directory visibility) whose read-side enforcement lives here; INV-S6 (in-session offline) observed by predicate 1 of §2.2.
- **Functional requirements** — `docs/specs/functional-requirements.md` (FR-4.4) — the prioritization semantics (country priority, non-Arabic language filter) implemented as tiers and conditional filters.
- **Cross-stream contracts** — `docs/backend/cross-stream-contracts.md` (§7.3) — the snapshot/TOCTOU ownership seam (§3.8) and the no-spread data-handling rules the pipeline follows.
- **Booking oracle** — `backend/services/classes/session-lifecycle.enforcement.ts` (`assertTeacherNotInActiveSession`) — the write-side session-state oracle the read-side predicate must stay in parity with (§3.2).
- **Recitation catalog** — `shared/constants/recitation-reading.enum.ts` — the shared certification vocabulary validated at the gate and used as the recitation token domain.
- **Sibling browse ticket** — `docs/planning/TICKETS.md` ("Teacher Directory Browse & Filter API") — the student-facing API/UI consumer of the service contract and the `teacherDirectory` empty-state copy.
