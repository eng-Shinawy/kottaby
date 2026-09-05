# Parent Handshake-Code Discovery — Canonical Reference

**Domain:** Parents / Student–parent linking (handshake-code discovery)
**Specs:** `docs/specs/functional-requirements.md` (§7 Parent Supervision), `docs/specs/state-machine-invariants.md` (INV-P1..P4)
**Status:** Implemented and verified

This document is the single canonical reference for parent-side student discovery by handshake code: the code format and its generation contract, the minimal confirmation payload and the name-mask algorithm, the governance-exclusion collapse rule, the null-not-error not-found channel, the `linkable` signal semantics, the binding forward contract for the future link-request flow, and the brute-force posture of the search surface. All layers (shared constants, repositories, services, GraphQL, frontend) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

The *generation* half of the handshake contract (how codes are minted at student registration) is canonically documented in [`docs/auth/user-registration.md`](../auth/user-registration.md) §2 and is described here **by reference only**. This document owns the *consumption* half: what a parent may learn from a code, and what every later flow that consumes a code must re-prove on its own.

---

## Why

Parent supervision begins with an out-of-band step: the student reads his handshake code from his own profile and shares it with his parent — a person, not an API. Discovery is the moment the platform first discloses student data to a not-yet-linked parent, which makes it the top PII-leak risk of the entire supervision feature. A naive implementation would answer a code search with the matched student row (full name, ids, contact fields, balances, governance state) and let the UI hide the rest — a payload that can leak by accident in every future consumer.

The ruling shipped here is structural instead: discovery discloses **the minimum needed to confirm "this is my child"** — the first grapheme of each name part, masked, plus one bit saying whether the child can still be linked — and nothing else. The payload is closed by construction at the type level, so no consumer can disclose more than the service computed.

Discovery is anchored to INV-P1 (`docs/specs/state-machine-invariants.md`):

> *"A parent cannot monitor a student without the student's explicit confirmation of the link request."*

**Discovery is not monitoring.** It confers zero supervision capability, zero session/report/progress data, and zero PII beyond the sanctioned mask. Monitoring access begins only with the student's explicit confirmation in the future link-request flow (Workflow 04 §4.3/§4.4 — `docs/workflows/04-parent-supervision-handshake.md`). This is the discovery-≠-monitoring invariant: the handshake code unlocks *confirmation*, never *observation*.

Two further rulings shape the contract:

- Workflow 04 §4.2: *"The system displays limited matching information to confirm identity without exposing full student data."* — the minimal payload above is that rule implemented server-side, not in the UI.
- Workflow 04's resolved governance ruling: *"If the student's account is soft-deleted (`users.is_deleted = true`), the parent loses access immediately."* — the read-side twin is that a governed child is **unfindable**: discovery behaves as if the child never existed.

---

## Pattern

### 1. The two handshake read surfaces

| Surface | GraphQL field | Role gate | Arguments | Result |
|---|---|---|---|---|
| Student self-read | `myHandshakeCode: String!` | student only | **zero** — identity comes exclusively from `ctx.user.id` | the caller's own code verbatim; localized `STUDENT_NOT_FOUND` if no `students` row exists for the caller |
| Parent discovery | `findStudentByHandshakeCode(code: String!): HandshakeCodeLookup` (nullable) | parent only | exactly one: the code | `{ maskedName, linkable }` or `null` — never an error for a miss |

Both fields carry the explicit `$all` conjunction in `authScopes` (`backend/graphql/query/students/handshake-code.query.ts`): anonymous callers receive `UNAUTHORIZED` (401 semantics) and authenticated callers with any other role — including the sibling role of each query, teacher, and admin — receive the canonical localized `ForbiddenError` (`FORBIDDEN`, 403 semantics) **before any resolver runs**. No admin/supervisor read override exists on either surface. A plain scope map would combine with ANY semantics and leak access; the conjunction is load-bearing (same engine behavior as the applicant-profile precedent).

### 2. Code format

```text
KSB-<exactly 8 uppercase hexadecimal characters [0-9A-F]>   e.g. KSB-ABCD1234
```

- Canonical shape: `HANDSHAKE_CODE_PATTERN = /^KSB-[0-9A-F]{8}$/` in `shared/constants/handshake-code.constants.ts` (dependency-free module — imports nothing). The regex is anchored with one bounded fixed quantifier and no alternation, so matching is linear-time on any input (no ReDoS surface).
- Storage: `students.handshake_code` is `varchar(50)` `NOT NULL` under the unique constraint `students_handshake_code_unique` — uniqueness is DB-enforced, one eligible student per code by construction.
- Codes are generated **once** at student registration and never rewritten. Write-immutability is scan-locked: the only `handshakeCode` write in the codebase is the registration insert (`backend/db/test/logic/students/handshake-code-immutability-scan.test.ts`).
- Input acceptance is normalize-then-validate: `normalizeHandshakeCode(value)` = `value.trim().toUpperCase()`, and validation ALWAYS runs against the normalized value. Case variants of a valid code (`ksb-abcd1234`) normalize into a valid lookup; structural garbage (wrong prefix, wrong length, non-hex characters such as unicode letters or symbols, LIKE wildcards `%`/`_`/`\`) fails closed **before any database read**.

### 3. Generation contract (by reference — never re-implement)

Code minting lives in the registration path and is canonically documented in [`docs/auth/user-registration.md`](../auth/user-registration.md) §2. The facts every consumer must know (and must not rebuild):

- The generator derives 8 uppercase hex characters from `crypto.randomUUID()` hex — so every generated code satisfies the canonical pattern above. (The registration generator emits the `KSB-` prefix from its own embedded literal; parity with the shared constants module is pinned by the generation lock suite, not enforced by a shared import.)
- Entropy: 16⁸ = 4,294,967,296 ≈ **4.3 billion** possible codes — a 32-bit keyspace. Collision probability is negligible at registration-scale load.
- Collision model: a unique-constraint violation (PostgreSQL `23505`, detected by traversing the Drizzle `DrizzleQueryError.cause` chain — never by reading the top-level error — with SQLite message parity) is absorbed by a **bounded in-transaction retry**: at most `HANDSHAKE_RETRY_LIMIT = 5` attempts, each regenerating a fresh code and re-inserting **on the same registration transaction**.
- Per-attempt savepoint: `StudentRepository.createForRegistration` (`backend/db/repo/students/student.repository.ts`) wraps each insert in a Drizzle nested transaction (a `SAVEPOINT`), so a rejected insert rolls back only that attempt and leaves the surrounding transaction usable — without the savepoint, a real collision would abort the transaction and poison every later statement.
- On budget exhaustion the service throws `ConflictError` (logged as `HANDSHAKE_COLLISION` per absorbed collision and `HANDSHAKE_EXHAUSTED` on exhaustion). Non-collision errors surface immediately.

The generation path is permanently locked by `backend/db/test/logic/students/handshake-code-generation-locks.test.ts` — describe it, cite it, never duplicate it.

### 4. The discovery pipeline (strictly ordered)

```text
parent submits code
   │
   1. normalize (trim → uppercase) THEN validate against HANDSHAKE_CODE_PATTERN
   │     malformed → localized ValidationError (VALIDATION), BEFORE any DB read
   2. single parameterized equality read:  students ⋈ users ON shared PK
   │     WHERE students.handshake_code = $1  LIMIT 1   (optional caller tx propagated)
   3. row miss            → return null          (never an error)
   4. governance excluded → return null          (same null — indistinguishable)
   5. hit                 → return { maskedName, linkable }   (nothing else)
```

Authoritative implementation: `StudentHandshakeService.findStudentByHandshakeCode(code, locale, tx?)` (`backend/services/students/student-handshake.service.ts`) over `StudentRepository.findDiscoveryByHandshakeCode` (`backend/db/repo/students/student.repository.ts`). The read's ONLY predicate is the parameterized equality on `handshake_code` — no LIKE/ILIKE, no `sql`-template interpolation, no `inArray` — and it returns a fixed column list (never spread-driven): `parentId`, `fullName`, and the five governance columns. Governance *filtering* is deliberately NOT in the repository: the repo returns the row faithfully, and the service owns the exclusion decision through the pure predicate `isGovernanceExcludedFromDiscovery` (`backend/services/students/student-handshake.helpers.ts`).

### 5. The name mask (`maskedName`)

`maskFullName` (`shared/lib/mask-full-name.ts`) is a pure shared helper with a fixed contract:

- **Total** — accepts any string, never throws, performs no I/O.
- **Deterministic** — the same input always yields the same mask; no clock, locale, environment, or randomness is consulted (the mask renders identically server-side and client-side).
- **Grapheme-aware** — the leading cluster of each name part is segmented with `Intl.Segmenter` at `grapheme` granularity (locale-free), keeping combining marks, emoji ZWJ sequences, skin-tone modifiers, and regional-indicator pairs attached to their base cluster. When `Intl.Segmenter` is unavailable, a code-point fallback (`Array.from`) is used — it still never throws and never splits surrogate pairs.
- Shape: the **first Unicode grapheme cluster of every whitespace-separated name part**, followed by the fixed cluster `***`. Whitespace runs collapse to single spaces; the fixed cluster means the output carries **no length-of-remainder signal**.

| Input | Output |
|---|---|
| `Yusuf` | `Y***` |
| `أحمد محمد` | `أ*** م***` |
| `ع` | `ع***` |
| `""` or `"   "` (empty after trim) | `***` (fixed placeholder) |

Arabic/RTL names, single-part names, and extra whitespace are handled by the algorithm itself — RTL rendering direction is a UI concern, never a masking concern. The edge suite (RTL, emoji, single-part, empty) lives in `shared/lib/mask-full-name.test.ts`.

### 6. The payload (`HandshakeCodeLookup`)

```graphql
type HandshakeCodeLookup {   # embedded value type — NO id field BY DESIGN
  maskedName: String!
  linkable: Boolean!
}
```

- The canonical return type `HandshakeCodeLookupReturnType` (`backend/types/students/student.types.ts`) closes the shape: exactly `maskedName` + `linkable`, both `readonly`. The Pothos object (`backend/graphql/pothos/students/handshake-code.pothos.ts`) is a pure structural passthrough of those two fields — it cannot disclose more than the service computed.
- **No `id` field, by design.** This is an embedded value type, not an entity: the payload must carry no database identity, so a client can only re-obtain it by **re-submitting the handshake code itself** (capability-by-code). The frontend Apollo cache registers it with `keyFields: false` (`frontend/providers/apollo/apolloCache.ts`, per the embedded-type policy in `frontend/graphql/AGENTS.md`) so it is cached inline and never normalized by an identity-derived key.
- The internal discovery row type (`HandshakeDiscoveryRowType`) is service-internal and never surfaces through GraphQL.

---

## Rules

### R1 — Payload closure (minimalism ruling)

A successful discovery answers with exactly `{ maskedName, linkable }`. Forbidden in the payload, now and forever: `students.id`, `users.id`, any contact field (email/phone), balances, session/report/progress data, governance state, and the raw `parentId`. The raw `parentId` value never leaves the service — only its `IS NULL` bit does. If a future flow needs more, it must justify a new, separately reviewed field — never widen this object.

### R2 — Not-found is a nullable payload, not an error

A syntactically valid code that matches no eligible student answers `null` — never an error. A discovery miss is a first-class UI state ("no student found for this code"), not a client error. This mirrors the null-precedence precedent established by the teacher applicant profile query, where `null` is chosen over `NOT_FOUND` because the miss is a legitimate state rather than a fault (see `docs/teachers/applicant-lifecycle.md` §3). The GraphQL field is nullable at the top level for exactly this reason.

### R3 — Governance-exclusion collapse rule

A matched child whose `users` row is governed is treated **exactly as if the student did not exist** — the same `null` as a code that never matched, byte-identical, through one indistinguishable channel. No observer (network-level, timing, or payload) may distinguish "never existed" from "governed". The predicate (`isGovernanceExcludedFromDiscovery`) is pure and fail-closed:

| Row state | Discoverable? |
|---|---|
| `isDeleted = true` | **No** — always excluded |
| `isBlocked = true` | **No** — always excluded |
| `suspended = false` | Yes |
| `suspended = true`, window start (`suspendedAt`) missing | **No** — fail-closed |
| `suspended = true`, duration (`suspendedPeriodDays`) missing or ≤ 0 | **No** — fail-closed (a plain nullable int with no CHECK constraint; a zero-day window must not masquerade as "lapsed") |
| `suspended = true`, window end **strictly after** `now` | **No** — active suspension |
| `suspended = true`, window end **at or before** `now` | Yes — lapsed suspension |

Window end = `suspendedAt + suspendedPeriodDays × 24h` (86,400,000 ms per day), evaluated against **one captured `now` per invocation**. The fail-closed direction is binding: missing or corrupt governance data must never widen discovery visibility. Rationale: Workflow 04's resolved ruling that a soft-deleted child means the parent loses access immediately — unfindability is the read-side twin.

> **Note (DEV3-017):** The window math above now lives in the shared predicate `backend/lib/auth/suspension-window.ts#isSuspensionActive`; this R3 table stays the semantic source. See `docs/admin/account-governance.md`.

### R4 — `linkable` semantics (advisory, per-child)

`linkable` is computed server-side as `parent_id IS NULL` at lookup time. It is the read-side signal of the one-parent-per-student rule (recorded decision B.12: `students.parent_id` is a single FK, not a junction table — only one parent can be linked to a student at a time).

- **Advisory at its isolation level**: it is a read, not a reservation. Two parents holding the same code can both see `linkable: true`; the truth is decided by the link flow's own transaction (R5). Never treat this bit as authorization.
- **Per-child gating, never per-parent**: a parent can link multiple children (recorded decision B.13 — each child requires a separate handshake confirmation). The gate is the child's `parent_id`, never anything about the searching parent's existing links. A second parent's later linking of a *different* child is always legitimate.
- `linkable: false` discloses only "this child already has a linked parent" — the minimum any future claimant needs to know — and **never which parent**.
- The FK is `ON DELETE SET NULL` (`students.parent_id` → `users.id`): removal of the linked parent's user row re-opens the child (`linkable` becomes `true` again on the next lookup).
- Discovery itself remains stateless: the lookup emits no record, and nothing discovery returns can expire. The link-request flow downstream of discovery is now SHIPPED (see the R5 status update and `docs/parents/parent-link-request.md`) and persists its own `parent_link_requests` rows under the 7-day expiry ruling (B.14) — those records belong to the binding flow, never to discovery.

### R5 — Binding forward contract for the link-request flow

> **Status update (DEV1-014):** the link-request flow described here is now SHIPPED — see `docs/parents/parent-link-request.md` for the implemented workflow (the R5 rules below remain intact and are enforced there).

Whoever implements the link-request mutation (Workflow 04 §4.3) is bound by this contract:

1. **Re-resolve the student by re-submitting the handshake code** inside the link flow's own transaction. The code is the capability reference across steps — the only thread connecting discovery to link.
2. **Never trust a stored or transmitted student id.** The discovery payload carries no id (R1); there is nothing legitimate to store, and anything a client submits must be ignored as identity.
3. **Re-check `parent_id IS NULL` server-side** inside that transaction. Discovery's `linkable` is advisory only (R4); the write-time truth is the transaction's own read.
4. **Re-evaluate governance exclusion** with the same collapse rule (R3) inside that same transaction — a child governed between discovery and link must fail exactly as unfindable.

### R6 — Brute-force posture

Iterative code-space probing is a recognized residual risk; the shipped posture is layered:

| Layer | What shipped |
|---|---|
| Role gate | Parent-only (`$all` conjunction): anonymous → `UNAUTHORIZED` (401); any other authenticated role → `FORBIDDEN` (403) before any read. No admin/supervisor read override. |
| Payload value | Negligible — one grapheme per name part plus one bit. A successful probe learns almost nothing, and `linkable: false` reveals only "already linked", never whose child or which parent. |
| Keyspace | 16⁸ ≈ 4.3 billion codes (a 32-bit space) — unguessable at registration scale. |
| Rate limiting | Inherited platform posture: the limiter is a fail-open stub (`backend/lib/ratelimit.ts` — `checkRateLimit` always succeeds). Real per-parent/per-IP throttling of this query is owned by the future rate-limiting hardening stream, not by this surface. |
| Real limiter today | The link-time re-validation itself: discovery grants nothing, so probing discovers only masks — every actual link attempt is re-validated server-side (R5). |

### R7 — Oracle hygiene and side-effect absence

The ONLY sanctioned information channel is: valid-format code → (`null` | masked payload). Malformed input → localized `ValidationError` (`VALIDATION`, key `handshakeCodeInvalid`) before any DB read. Role failures → the canonical localized `FORBIDDEN`. Everything else collapses into `null`. Discovery writes nothing: zero audit rows, zero notifications, zero side-effect writes, no locks, and **no caching of lookup results (positive or negative)** — the repo read is executed per request.

### R8 — Logging discipline

`logger.logDomainError` fires on exactly the two enumerated expected rejections across the two surfaces — malformed code (`VALIDATION`) and the self-read missing-row case (`STUDENT_NOT_FOUND`). The **submitted code string is never logged — not even after validation passes**. Every happy path — including discovery misses and governance collapses — emits nothing. Unexpected internals are never caught in the service; they bubble to the GraphQL masking boundary, which owns the single correlated log line.

---

## What NOT to Do

- **Do not widen the payload.** No `id`, no email/phone, no balances, no governance fields, no raw `parentId` — not "temporarily", not for a UI convenience. The two-key shape is the contract.
- **Do not return an error for a not-found code.** `null` is the answer; an error leaks that the code *format* was valid and changes the UI contract.
- **Do not distinguish "governed" from "never existed".** One null channel, byte-identical, no timing side-channels, no extra log lines on the collapse path.
- **Do not trust `linkable` as authorization.** It is advisory at its isolation level; the link flow re-checks `parent_id IS NULL` inside its own transaction.
- **Do not resolve the link flow by a stored/transmitted student id.** There is no id in the payload by design; re-submit the code.
- **Do not let missing or corrupt suspension data widen visibility.** Missing window start, missing or non-positive duration ⇒ excluded (fail-closed), always.
- **Do not log the submitted code** — on any path, at any layer.
- **Do not use LIKE/ILIKE, string concatenation, or `sql`-template interpolation** for the lookup. One parameterized equality predicate, nothing else.
- **Do not add a cache layer for lookup results** — positive or negative. Lookups are cheap, single-row, parameterized reads.
- **Do not add rate limiting inside the discovery service.** The platform limiter is a fail-open stub at the transport boundary; real throttling belongs to the rate-limiting hardening stream.
- **Do not re-implement the generator or the mask.** Generation is locked in the registration path (`docs/auth/user-registration.md` §2); masking is `shared/lib/mask-full-name.ts`. Consume, never duplicate.
- **Do not add an admin/supervisor read override** to either handshake query. Admin governance operates on governed data through its own surfaces, not through parent discovery.

---

## Rollout Summary

Shipped surface (all paths verified in-tree):

| Layer | Path | Test lock |
|---|---|---|
| Canonical code shape + normalization | `shared/constants/handshake-code.constants.ts` | `shared/constants/handshake-code.constants.test.ts` |
| Name mask | `shared/lib/mask-full-name.ts` | `shared/lib/mask-full-name.test.ts` (RTL/emoji/single-part/empty edge suite) |
| Canonical types (payload + discovery row) | `backend/types/students/student.types.ts` | type-composition review + `tsgo` baseline |
| Repository lookups + savepoint-wrapped registration insert | `backend/db/repo/students/student.repository.ts` | `backend/db/test/logic/students/handshake-code-generation-locks.test.ts` (incl. collision-absorption lock), `backend/db/test/logic/students/handshake-code-immutability-scan.test.ts` |
| Governance predicate | `backend/services/students/student-handshake.helpers.ts` | `backend/services/students/student-handshake.service.test.ts` (governance fixtures) |
| Service (both flows) | `backend/services/students/student-handshake.service.ts` | `backend/services/students/student-handshake.service.test.ts` |
| GraphQL surface (both queries + object) | `backend/graphql/query/students/handshake-code.query.ts`, `backend/graphql/pothos/students/handshake-code.pothos.ts` | `backend/graphql/test/handshake-code-surface.test.ts` (401/403 pre-resolver, two-field no-id shape) |
| Apollo embedded-type registration | `frontend/providers/apollo/apolloCache.ts` (`HandshakeCodeLookup: { keyFields: false }`) | `frontend/providers/apollo/apolloCache.test.ts` |
| GraphQL documents | `frontend/graphql/sharedDocuments/students/handshake-code.documents.ts` | `frontend/graphql/test/students/handshake-code.documents.test.ts`, `frontend/graphql/test/students/handshake-code.test.ts` |
| Student self-read UI | `frontend/views/students/dashboard/HandshakeCodeCard.tsx` | `test/ui/components/students/HandshakeCodeCard.test.tsx` |
| Parent discovery page + container | `app/(dashboard)/parent/handshake/page.tsx`, `frontend/views/parent/handshake/HandshakeDiscoveryContainer.tsx` | `test/ui/page-guards/parent-handshake-page.test.ts`, `test/ui/components/parent/HandshakeDiscoveryContainer.test.tsx` |
| i18n (errors keys `handshakeCodeInvalid` / `studentHandshakeNotFound`; `handshakeCode` UI namespace, en/ar) | `shared/locale/**` | `shared/locale/handshakeCode-namespace.parity.test.ts` |
| End-to-end journey | discovery by code (found / not-found / already-linked / governed) | `test/workflows/parents/handshake-discovery.test.ts` |

Zero schema drift: `students.handshake_code` and `students.parent_id` pre-exist from the registration-era schema work; this surface added no columns and performs **zero writes** of any kind.

---

## Related Documents

- **Generation contract (the other half):** [`docs/auth/user-registration.md`](../auth/user-registration.md) — §2 Handshake Generation (format, 4.3B space, bounded in-transaction retry on `23505`, `ConflictError` on exhaustion)
- **Null-precedence precedent:** [`docs/teachers/applicant-lifecycle.md`](../teachers/applicant-lifecycle.md) — §3 Query Contract & Precedence (the one-null-answer rule this surface mirrors)
- **Requirements & invariants:** `docs/specs/functional-requirements.md` (§7 Parent Supervision, FR-7.1/FR-7.2), `docs/specs/state-machine-invariants.md` (INV-P1..P4 — read-only for this surface)
- **Recorded decisions:** `docs/specs/open-decisions-and-gaps.md` (A.2 parent-link model, A.3 unique code, B.12 one parent per student, B.13 parent links multiple children, B.14 7-day link-request expiry)
- **Workflow:** `docs/workflows/04-parent-supervision-handshake.md` (§4.2 parent search, §4.3 link request, §4.4 student confirmation, governance rulings)
- **Error contract:** `docs/graphql/domain-error-extensions-code.md` (producer-side throw conventions — `VALIDATION`, `STUDENT_NOT_FOUND`), `docs/graphql/error-handling-contract.md` (transport taxonomy, masking boundary)
- **Authoritative implementations:** `shared/constants/handshake-code.constants.ts`, `shared/lib/mask-full-name.ts`, `backend/types/students/student.types.ts`, `backend/db/repo/students/student.repository.ts`, `backend/services/students/student-handshake.helpers.ts`, `backend/services/students/student-handshake.service.ts`, `backend/graphql/query/students/handshake-code.query.ts`, `backend/graphql/pothos/students/handshake-code.pothos.ts`, `frontend/graphql/sharedDocuments/students/handshake-code.documents.ts`, `frontend/views/parent/handshake/HandshakeDiscoveryContainer.tsx`, `frontend/views/students/dashboard/HandshakeCodeCard.tsx`, `app/(dashboard)/parent/handshake/page.tsx`
