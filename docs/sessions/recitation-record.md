# Session Recitation Record — Canonical Reference

**Domain:** Sessions — the write-once `recitation` record (1:1 companion of a `session` row)
**Status:** Implemented and verified (the single write/read surface over the session-linked record)
**Source of truth for:** the one-record-per-session binding, the write-once + unique-arbiter rule, the oracle-safe collapse read, the write-acceptance status window, the governance re-check posture, the closed error taxonomy, and the consumer obligations for every ticket that writes or reads session recitation records.

This document is the single canonical reference for the session recitation record. Downstream surfaces (the session report flow, the teacher submit-report flow, the parent portal, and admin review) MUST read it before touching `recitation`, the record's GraphQL surface, or the shared documents. The record is written **exactly once** — the guarded primitives live in `RecitationRepository` and are composed by `RecitationRecordService`; consumers import that service by reference, never re-implement it, and never reach the table directly.

---

## 1. Why

A recitation record is the permanent evidence that a Quran session happened and how it went. Decision C.5 (`docs/specs/open-decisions-and-gaps.md`) reshaped the legacy user-linked table into a session-linked one: `recitation.session_id` is a NOT NULL foreign key to `session.id` carrying a UNIQUE constraint, so the database itself enforces one record per session. Every ruling in this document exists because a specific failure mode was ruled out while shipping the surface: a second writer (violates the write-once retention shape), an existence oracle (leaks who recorded what), notification or audit side effects (couples the record to waves that do not own it), and silent upserts (rewrite history). The worst failure mode for this domain is *bypass*: any code path that inserts into or reads from `recitation` without going through the service re-opens all of them. Read §8 before wiring any consumer.

## 2. The C.5 Binding — One Record Per Session

| Schema fact (`backend/db/schema/classes/recitation.ts`) | Consequence |
|---|---|
| `session_id` NOT NULL FK → `session.id`, `ON DELETE CASCADE` | A record cannot exist without its session; deleting a session deletes its record — there is no orphan state. |
| UNIQUE constraint `recitation_session_id_unique` | The database is the write-once arbiter (§3). |
| Content: `name varchar(255) NOT NULL` + `description text NULL` + `createdAt`/`updatedAt` | The client-owned surface is exactly two columns; every other column is server-owned. |
| No `user_id` column | The reciter is reached through the session (`session.student_id` → `students`). The Qira'ah doc's guards (`docs/auth/qiraah-selection-and-c5.md` §6.1) are adopted verbatim: never resurrect a user-linked row, never insert a record without a session. |

The session-linked record is unrelated to the Qira'ah **catalog** domain (`RecitationReading`, the public `recitationReadings` query): no linkage between the two ever exists, and the GraphQL object is deliberately named `SessionRecitation` so the vocabularies cannot be conflated.

## 3. Write-Once + the Unique Arbiter

**The owning teacher writes once.** There is NO update, delete, or list surface — not "not yet": the record is retention-permanent (`docs/workflows/05-admin-governance-override.md` §8), and a correction surface would be a separately designed, audited ticket. The repository namespace is closed at exactly two methods — `insertOnce` and `findBySessionId` — and a runtime key-set pin makes any wider surface a failing test, not a code-review debate.

**The constraint is the arbiter.** `insertOnce` is a single statement — there is no SELECT-before-INSERT anywhere on the write path, so there is no read-then-write window to lock. Two concurrent owner writes serialize on the unique constraint: exactly one INSERT commits, the loser's transaction rolls back with zero residual rows, and its PG `23505` is decoded by a cycle-safe cause-chain walker (`isUniqueViolation` — never message sniffing) into the typed conflict `RECITATION_ALREADY_EXISTS`. The stored row stays byte-identical; there is no upsert. No `SELECT … FOR UPDATE` and no advisory locks are needed — proven by real-PostgreSQL race arms in the repository, service, and journey suites.

```text
ABSENT  ──(owning teacher writes on a started | completed | disputed session)──▶  PRESENT
ABSENT  ──(any other write attempt)───────────────────────────────────────────▶  ABSENT (denied; nothing recorded)
PRESENT ──(repeat write by the owner)─────────────────────────────────────────▶  PRESENT (unchanged; typed conflict to the caller)
PRESENT ──(update / delete)───────────────────────────────────────────────────▶  no such surface exists (retention-permanent)
```

## 4. The Collapse Read (Oracle Ruling)

**Sessions are sensitive ⇒ collapse.** This surface inherits the sessions-are-sensitive ruling (`docs/sessions/session-lifecycle.md` §7) for BOTH directions:

- **Read:** a malformed id, an id beyond the session table's int4 ceiling, a nonexistent session, a non-participant caller, and a recordable session with no record yet all answer the **same `null`** — never an error, never a distinguishable denial. A participant (the owning teacher or the booked student, resolved from the session ROW — no identity argument exists beyond the session id) receives the row when it exists and `null` before it does.
- **Write denial:** a foreign teacher's target and a nonexistent target throw the byte-identical `SESSION_NOT_FOUND` — same class, same code, same localized message — on the service tier and on the wire (proven by whole-body byte-equality under one correlation id).

**The int4 ceiling guard.** The read path's pre-DB guard is two-fold — `!isPositiveSafeSessionId(id) || id > SESSION_ID_INT4_CEILING` collapses to `null` BEFORE any database read, where the ceiling is `2_147_483_647` (2³¹ − 1, the session table's int4 primary-key limit). Such an id can never match a row, but a query carrying one would die as a driver-level out-of-range failure — an error channel the read contract forbids. The write path keeps its own shape guard (garbage ids die as `VALIDATION` pre-DB); an over-ceiling write id fails at the driver and is masked at the boundary (§7) — a deliberate masking probe, not a leak.

## 5. Write-Acceptance Status Window

A recitation documents a session that actually happened (`docs/workflows/03-session-lifecycle-escrow.md`):

| Session status | Write admissibility |
|---|---|
| `started` | **Admitted** — the live session is documented as it happens. |
| `completed` | **Admitted** — the normal post-session recording window. |
| `disputed` | **Admitted** — a disputed session happened (decision B.18); its record remains reviewable evidence for arbitration. |
| `scheduled` | **Denied** — nothing has happened yet → `RECITATION_SESSION_NOT_WRITEABLE`. |
| `cancelled` | **Denied** — nothing happened / aborted → `RECITATION_SESSION_NOT_WRITEABLE`. |

The lifecycle owns session transitions; this surface only consults `status` and never writes a session row (INV-S1/S2 respected by construction). Ownership is TOCTOU-free — `session.teacher_id`/`session.student_id` are immutable after creation (INV-S4) — and the one documented window is a status flip between the in-transaction lookup and the insert: one statement long, domain-coherent (a session cancelled after the record landed legitimately keeps its record under the retention law), and accepted.

## 6. Governance Re-Check Posture

The GraphQL context is **not fail-closed**: the context factory never re-checks governance (fail-closure lives at the login/SSR boundary — `docs/auth/jwt-authentication-service.md`), and scope claims ride still-valid tokens. The write path therefore re-asserts governance **before the transaction opens**: `assertActorGovernanceClean(teacherUserId, t, outerTx)` denies deleted/blocked/suspended (or absent) callers with `FORBIDDEN` and zero rows, pre-empting even the session lookup.

Two boundaries keep the posture honest:

- **Reads are never governance-gated.** INV-U1/U5: governance flips preserve history. A governed teacher loses the WRITE, never the read of their own historical records, and a counterparty's governance state is invisible to the read path (which has no governance probe at all — collapse rules only).
- **Shared helpers, never twins.** The shape guards (`assertPositiveSafeSessionId` / `isPositiveSafeSessionId`) and the governance helper are imported verbatim from the session-lifecycle guard/governance modules. Forking them would drift the proven behavior both surfaces depend on.

Every denial logs exactly ONE bounded domain-error entry (`code`, `entity`, `entityId`, `locale`) — never the submitted payload, never a counterparty value — while happy paths and collapse reads log nothing.

## 7. Closed Error Taxonomy

The surface's error taxonomy is CLOSED — the table below is exhaustive; nothing else may be thrown, and every message resolves through the localized `errorsTranslations` tree (never hardcoded strings):

| Layer | Condition | `extensions.code` |
|---|---|---|
| pre-resolver | anonymous caller | `UNAUTHORIZED` |
| pre-resolver | authenticated non-teacher on the write (scope conjunction `$all{authenticated, role:[Teacher]}`) | `FORBIDDEN` |
| service, pre-transaction | governed or absent writer (deleted/blocked/suspended) | `FORBIDDEN` |
| service, pre-database | malformed session id | `VALIDATION` |
| service, pre-database | malformed payload (name required/≤255; notes trimmed, emptied-to-`null`, ≤2000) | `VALIDATION` + `fields[]` naming each offending field (`NAME_REQUIRED` / `NAME_TOO_LONG` / `DESCRIPTION_TOO_LONG`) |
| service, in-transaction | missing OR non-owned session (write) | `SESSION_NOT_FOUND` |
| service, in-transaction | session status `scheduled`/`cancelled` (write) | `RECITATION_SESSION_NOT_WRITEABLE` |
| service, in-transaction | record already exists (write, incl. the race loser) | `RECITATION_ALREADY_EXISTS` |
| boundary | any non-domain internal failure | `INTERNAL_SERVER_ERROR` (masked, requestId-correlated) |
| read | malformed id · id beyond the int4 ceiling · nonexistent session · non-participant caller · session not yet recorded | `null` — NEVER an error |

- **i18n keys:** the taxonomy added exactly two flat `errors`-namespace keys, present in BOTH locales — `recitationAlreadyExists` and `recitationSessionNotWriteable` (typed on the errors labels interface, parity-tested). Everything else reuses existing keys: `sessionNotFound`, `validation`, `forbidden`, `unauthorized`, `internalServerError`.
- **The read row IS the contract:** the null collapse is a first-class response (the query field is nullable by design), not a softened failure — consumers treat `null` as "nothing to show", never retry it, and never branch on error shape for a read.
- **Masking:** a non-domain escape (e.g. the deliberate over-ceiling write id) is masked at the GraphQL boundary to the localized `INTERNAL_SERVER_ERROR` with a correlated request id; record content and driver internals never cross (`docs/graphql/error-handling-contract.md`).
- **No dispatcher row:** the frontend error dispatcher/error maps gained NO entry — consumer forms adopt the typed conflict locally (§8, §10).

## 8. Consumer Obligations

Every consumer writes and reads THROUGH `RecitationRecordService` (import-by-reference). Never a second writer; never direct table access; never a fork of the pipeline.

| Ticket | What it must (and must not) do with this slice |
|---|---|
| **Session report flow** | Compose the record write inside its own unit by passing the caller's transaction as `setSessionRecitation`'s FINAL optional parameter — the flow then runs under a SAVEPOINT on it and commits or rolls back atomically with the report. Never insert into `recitation` directly; never open a parallel write path "for convenience". |
| **Teacher submit-report flow** | The authoring surface drives the wire mutation `setSessionRecitation` through the shared document — the wire passes NO transaction (the service opens its own top-level unit). Adopt the `RECITATION_ALREADY_EXISTS` conflict locally in the form (there is no dispatcher row); map `fields[]` to per-field helper text; select `id` first and keep the documents identity-variable-free (caller identity is never wire-visible). |
| **Parent portal** | Parents are non-participants on this surface: reads collapse to `null` and writes are `FORBIDDEN` pre-resolver. A parent-facing projection is a separately designed surface that still reads through this service — it must NOT widen the participant predicate here and must not query the table. |
| **Admin review** | Admins collapse to `null` today like any non-participant. The future admin review surface ships its OWN authScopes and reads through this service; no override write exists anywhere, and none may be added without a separately designed audited ruling. |

Composition seam summary: the final optional transaction parameter is the ONLY sanctioned multi-table composition point; the wire path passes none (the resolver deliberately omits the argument), so the top-level GraphQL flow is exactly one service-owned transaction. Everything the service does inside that unit is pure: `recitation`-table writes only.

## 9. NO-Notifications / NO-Audit Ruling

Writing, reading, or being denied on this surface emits **zero** `notifications` rows and **zero** `audit_logs` rows — enforced by source (the service never imports the notification or audit surfaces; a static source pin turns an import into a failing test) and by oracles (row-count deltas plus dispatch-boundary spies on every journey step).

Owning tickets, so nobody "helpfully" fills the gap here:

- **Parent session-completion wave:** the parent-notification surface owns the parent-facing notification emitters. This surface must stay a silent writer — a record landing is not a notification event.
- **Audit trail:** audit logs *admin* actions; a teacher authoring a record is not an admin action. Any future audit story for recitation corrections belongs to the separately designed correction surface (§3), not to stray inserts here.

Consumers composing this seam (the report and submit flows) inherit the purity: attach YOUR flow's notifications and audit rows to YOUR surface's events — never to this one.

## 10. Replay Ruling — Conflict, Not Keys

Recitation writes sit OUTSIDE the mandated idempotency-key set of `docs/IDEMPOTENCY.md` (students, invoices, class instances, payments): no `X-Idempotency-Key` is read, no claim table exists, and adding one would buy nothing — the unique constraint already serializes concurrency. A retried or double-submitted write deterministically surfaces the typed conflict `RECITATION_ALREADY_EXISTS`; replay ≡ typed conflict. The stored record is never returned in place of a replay's denial, and the original stays byte-identical. This mirrors the cold-start certification ruling ("conflict, not keys" — `docs/admin/cold-start-certification.md`) and the lifecycle's replay-throw discipline: the service must throw, never silently succeed, on a repeat write.

## 11. Architecture Map

**Write pipeline (the order is the contract):**

1. **Pre-DB shape guards** — session id positive-safe; payload normalized (name trimmed and non-empty ≤255; notes trimmed, emptied-to-`null`, ≤2000) with per-field `fields[]` projection. A malformed shape never touches SQL.
2. **Governance re-check** — pre-transaction `FORBIDDEN` for deleted/blocked/suspended/absent writers (§6).
3. **ONE transaction** (`withTransaction(outerTx, …)` — provided transaction → SAVEPOINT; none → new top-level unit): session lookup → ownership collapse (`SESSION_NOT_FOUND`, foreign ≡ nonexistent) → status window (§5) → `insertOnce`.
4. **Catch** — unique-violation cause-chain ONLY → `RECITATION_ALREADY_EXISTS`; everything else rethrown untouched (no blanket masking); the unit rolls back with zero residual rows.

**Read pipeline:** malformed-id/int4-ceiling guard → session lookup → participant gate from the row → record lookup → row | `null`. No read path raises.

| Concern | Path |
|---|---|
| Schema ground truth (zero migrations in this slice) | `backend/db/schema/classes/recitation.ts` |
| Canonical types | `backend/types/classes/recitation.types.ts` |
| Repository (closed two-method namespace) | `backend/db/repo/classes/recitation.repository.ts` |
| Service — the single writer/reader | `backend/services/classes/recitation.service.ts` |
| Pothos object + input | `backend/graphql/pothos/classes/recitation.pothos.ts` |
| Mutation resolver | `backend/graphql/mutation/classes/recitation.mutation.ts` |
| Query resolver | `backend/graphql/query/classes/recitation.query.ts` |
| Shared documents | `frontend/graphql/sharedDocuments/scheduling/recitation.documents.ts` |
| Generated surface (codegen-synced) | `frontend/graphql/generated/schema.graphql`, `frontend/graphql/generated/gql/graphql.ts` |
| Locale keys | `shared/locale/types/errors/labels.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts` |
| Public-operations allowlist | `backend/lib/gateway/public-operations.ts` (frozen — neither operation is public) |

**Wire surface:** `setSessionRecitation(sessionId: ID!, input: SessionRecitationInput!): SessionRecitation!` (non-null — a resolved call ALWAYS returns the created row; every denial throws) and `sessionRecitation(sessionId: ID!): SessionRecitation` (nullable — the collapse channel). The input is a closed two-member whitelist (`name: String!`, `description: String`); the resolver maps it field-by-field and normalizes an absent note to an explicit `null` — never the raw input object. The object exposes exactly `id` (first, for cache normalization), `sessionId`, `name`, `description`, `createdAt`, `updatedAt` — no ownership lane on the wire. Scopes: write `$all{authenticated, role:[Teacher]}` (the conjunction is load-bearing — a plain map would be ANY-semantics), read `{authenticated}` with service-owned tenancy.

**Test suites (the behavioral specification):**

| Tier | Path |
|---|---|
| Repository (race arm on real PostgreSQL) | `backend/db/test/repo/classes/recitation.repository.test.ts` |
| Service (denial matrix, fuzz, race, rollback purity) | `backend/services/classes/recitation.service.test.ts` |
| Cross-actor journey (eight ordered steps) | `test/workflows/sessions/recitation-record.journey.test.ts` |
| Wire matrix (live HTTP stack) | `backend/graphql/test/recitation-record.wire.test.ts` |
| SDL/schema freeze pins | `backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/sdl-static-assertions.test.ts` |
| Document contract | `frontend/graphql/sharedDocuments/scheduling/recitation.documents.test.ts` |
| Types conformance | `backend/types/classes/recitation.types.test-d.ts`, `backend/types/classes/recitation.types.static-assertions.test.ts` |
| Locale parity | `shared/locale/errors-namespace.parity.test.ts` |

## 12. Related Documents

- `docs/sessions/session-lifecycle.md` — the lifecycle canonical reference; §7's sessions-are-sensitive ruling is inherited verbatim by BOTH directions of this surface, and its consumer guidance routes recitation writes here.
- `docs/specs/open-decisions-and-gaps.md` — decision C.5 (one record per session; the session-linked rename), B.18 (disputed is a real, recordable state), A.4/A.5 (notifications/audit ownership).
- `docs/specs/state-machine-invariants.md` — INV-S4 (immutable participants), INV-S1/S2 (the lifecycle owns transitions), INV-U1/U5 (governance preserves history; historical reads never gated).
- `docs/auth/qiraah-selection-and-c5.md` — §6.1 guards (no user-linked recitation resurrection) and the Qira'ah-catalog domain separation.
- `docs/IDEMPOTENCY.md` — the mandated idempotency-key set this surface deliberately sits outside (§10).
- `docs/graphql/domain-error-extensions-code.md` + `docs/graphql/error-handling-contract.md` — the DomainError code contract and the boundary masking/correlation this taxonomy rides.
- `docs/admin/cold-start-certification.md` — the "conflict, not keys" precedent the replay ruling mirrors.
- `docs/workflows/03-session-lifecycle-escrow.md` + `docs/workflows/05-admin-governance-override.md` §8 — "a recitation documents what actually happened" + the permanent-retention law behind write-once.
- `docs/notifications/realtime-engine.md` — the single-writer engine discipline behind the zero-notification purity.
- Plan of record: `ai/finished_plans/milestone_1_core_domain_mvp/recitation-record-per-session-11/` (specs, plan, tasks).
