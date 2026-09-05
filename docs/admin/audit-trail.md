# Admin Audit Trail — Canonical Reference

**Domain:** Admin / global governance read-back of `audit_logs` (Workflow 05 — "Audit Trail" read half)
**Specs:** `docs/specs/functional-requirements.md` (FR-10.5), `docs/workflows/05-admin-governance-override.md` (§7), `docs/specs/state-machine-invariants.md` (INV-U1/INV-U5), `docs/planning/PRODUCTION_READINESS.md` (§1.3 Audit Trail Completeness)
**Status:** Implemented and verified

This document is the single canonical reference for the admin audit-trail read surface — the `/audit` browse/filter/paginate projection over the append-only `audit_logs` table. All layers (types, repo, service, GraphQL, frontend, tests) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

The **write half** of the trail is owned by the audit-emission contract documented in `docs/admin/user-management.md` (§2.4): every successful admin mutation appends exactly one `audit_logs` row inside the caller's transaction via `AuditService.createAuditLog`. This document covers everything downstream of those rows: how they are read, proved immutable, and kept honest.

---

## 1. Why

The trail exists because administrative power on this platform is supreme and must be reconstructible. Three repo-planning mandates pin it:

- **FR-10.5** (`docs/specs/functional-requirements.md`) — "Every administrative action is permanently logged with actor ID, action type, entity target, and timestamp." Resolved as the `audit_logs` table + the `audit_action_type` enum (decision **A.5** in `docs/specs/open-decisions-and-gaps.md`).
- **Workflow 05 §7** (`docs/workflows/05-admin-governance-override.md`) — defines the audit-log field set (actor, action type, entity target, timestamp) and the full catalog of admin actions requiring audit (user management, plan management, subscriptions, session governance, evaluation override, financial adjustment, notification broadcast, cold-start bootstrapping).
- **PRODUCTION_READINESS §1.3.1–1.3.5** (`docs/planning/PRODUCTION_READINESS.md`) — the launch-gate rows this surface satisfies: every admin action logged (1.3.1); records immutable/append-only — UPDATE/DELETE must fail (1.3.2); every row carries `actor_id`, `action_type`, `entity_type`, `entity_id`, `details`, `created_at` (1.3.3); the admin can filter by actor, action type, entity, and date range (1.3.4); all seven `audit_action_type` values are exercised and visible (1.3.5).

The read surface is the governance answer to those mandates: a single admin-only, read-only, paginated trail that renders every logged action without ever mutating the log itself — reading the trail never audits, never logs, never writes.

---

## 2. Read-Surface Contract

One GraphQL query backs the whole surface:

```text
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical:
//   - schema:  backend/graphql/pothos/admin/audit-trail.pothos.ts
//   - query:   backend/graphql/query/admin/audit-trail.query.ts
adminAuditLogs(filters: AdminAuditLogFiltersInput, page: Int, pageSize: Int): AdminAuditLogPage!

AdminAuditLogEntry:  id: ID!, actionType: AuditActionType!, actorId: Int!, actorName: String!,
                     entityType: String!, entityId: Int, details: String, createdAt: DateTime!
AdminAuditLogPage:   items: [AdminAuditLogEntry!]!, page: Int!, pageSize: Int!, totalCount: Int!
```

- **Auth:** the query carries the mandatory `$all` scope conjunction — `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (a plain map degrades to ANY semantics and is wrong). Anonymous → `UNAUTHORIZED`; authenticated non-admin → `FORBIDDEN` — both BEFORE the resolver body runs. The service re-asserts the admin gate as its first statement (`assertActorAdmin`) — defense in depth.
- **Fields:** `id` is the integer primary key exposed FIRST as a GraphQL `ID!` (Apollo cache normalization). `actionType` is the shared seven-member `AuditActionType` enum (Adjust, Create, Delete, Override, Reactivate, Suspend, Update). `actorName` is the acting account's **CURRENT** `users.full_name` — a documented live projection, NOT a point-in-time snapshot (the `actor_id` FK is NOT NULL with ON DELETE RESTRICT, so the join never drops a row). `entityId` and `details` are nullable **by design**: not every audit event targets a single row and `details` is optional context.
- **Order:** `createdAt DESC, id DESC` — newest-first with a deterministic tiebreak. Batch mutations committed in one transaction share a timestamp; the `id DESC` tail keeps them in stable insertion-latest order so consecutive pages never duplicate or drop a row. (New rows landing between page fetches shift offsets — documented offset-pagination posture; keyset pagination over `(created_at, id)` is a recorded future refinement, NOT shipped here.)
- **Pagination:** page-based. `page` must be a positive safe integer (default 1); `pageSize` must be an integer in **1..100** (default 25); both validated pre-DB. The count and the listing run inside **ONE snapshot transaction**: `readInSnapshot` opens it at `repeatable read` when it owns the transaction, so `totalCount` can never disagree with `items`; when a caller-supplied `outerTx` is handed in, the reads instead inherit the CALLER's isolation level and the snapshot guarantee is the caller's to provide. An out-of-range page yields an empty `items` array with the honest, unchanged `totalCount` — never clamped, never an error.
- **Filters:** exactly six optional members (`actorId`, `actionType`, `entityType`, `entityId`, `from`, `to`), combined as independent ANDed predicates. The wire input is a closed whitelist — smuggled fields die at GraphQL validation before any resolver runs; the resolver copies the six members **field-by-field** (never a spread). Absent or null members drop out entirely — an empty filter is the unfiltered listing (the fallback, never an error); malformed values (non-positive ids, over-length entity types, unknown action types, inverted date windows) fail `VALIDATION` pre-DB. `actorId`/`entityId` accept positive safe integers within the GraphQL `Int` wire range (1..2147483647); `entityType` is trimmed, non-empty, ≤ 100 characters; `actionType` is fail-closed enum-membership checked.
- **Time-window semantics — half-open:** the window is `created_at >= from AND created_at < to`. A boundary row at `from` is included; a boundary row at `to` is excluded; adjacent windows never overlap. A one-sided bound (only `from` or only `to`) is a valid open-ended window.
- **Client day-boundary convention:** the UI collects calendar days (`YYYY-MM-DD`) and expands them client-side: `from` = UTC midnight of the selected start day; `to` = the **exclusive** midnight AFTER the selected end day — so an inclusive calendar-day range rides the wire as a half-open instant interval. A same-day `from`/`to` pair is valid and selects exactly that single day. Bounds are validated as real UTC calendar days (impossible dates never roll over silently).

---

## 3. Two-Tier Immutability Proof

Immutability is enforced and verified at two independent tiers; a dedicated test suite (`backend/db/test/logic/audit/audit-immutability.test.ts`) pins both, plus the migration DDL as a third textual tier.

**Tier 1 — application single-writer (static).** `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts`) is the ONLY writer of `audit_logs` in the codebase. The static tier of the immutability suite scans the entire backend production corpus and asserts: zero Drizzle `update(auditLogs)` / `delete(auditLogs)` call sites, zero raw-SQL `UPDATE/DELETE audit_logs` statements, the `AuditService` module surface locked to exactly `["createAuditLog"]`, and a path-exact bijective teardown allowlist over the test-layer deleters that ARE sanctioned (every sanctioned mutator is listed, every listed path exists). The read surface itself exposes no write path — `AuditTrailRepository` is list/count only.

**Tier 2 — database triggers (behavioral).** `backend/db/migration/3-immutability-triggers.sql` installs `prevent_audit_logs_update_trigger` and `prevent_audit_logs_delete_trigger` on `audit_logs` (both `BEFORE`, both `RAISE EXCEPTION 'audit_logs is immutable — … is not permitted'`, idempotent `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`). Any UPDATE or DELETE attempt aborts the statement and its transaction; the INSERT (append) path is deliberately untouched. The trigger tier of the suite inserts a real fixture row and proves both tamper attempts THROW while a plain insert succeeds — gated by a live `pg_trigger` probe so it runs only where triggers exist.

**Environment caveat — push vs migrate (honest rollout requirement).** The triggers ship via a **custom SQL migration**; the journal entry is `20260825222701_custom_3-immutability-triggers`. A database provisioned through the migrate path (`bun run db migrate`) applies custom SQL and gets both triggers. A database provisioned through schema-**push** does NOT apply custom SQL — such an environment has the `audit_logs` table but NOT the trigger tier; the application-tier single-writer scan still holds, and the trigger-tier suite records the gap honestly (skips under pglite test providers; runs the structural branch on push-provisioned postgres). **Rollout rule: provision with the migrate path so Tier 2 is live, and verify with a `pg_trigger` probe before relying on DB-tier enforcement.** Verified record for this surface: migrate-provisioned dev database, both triggers present and enabled (`tgenabled = 'O'`), tamper attempts observed to throw.

**Honest residual:** an actor holding raw database credentials can bypass BOTH tiers (`ALTER TABLE … DISABLE TRIGGER`, `session_replication_role = replica`, `DROP TRIGGER`). That is an environment-tier risk, not addressable at the application layer — restrict DB credentials accordingly. Correction semantics are append-only by design: a mistaken entry is never edited or removed; a new compensating row is appended.

---

## 4. Governance-Window Acknowledgment

The trail applies **zero governance filtering**: there are no soft-delete, suspension, or blocking predicates anywhere in its query chain. The history of a governed target — soft-deleted, suspended, or blocked — remains fully visible in the trail, by design. The trail is a supreme-governance read capability, not a per-row scoping surface; `actorId`/`entityId` are FILTERS (data), never authorization inputs, and no per-row ownership scope exists.

The governance-window risk (a governed caller still holding a pre-issued token inside the revocation window) is **acknowledged, not expanded**: this read surface performs no request-time governance re-check and claims no fail-closed guarantee for that window. Callers needing stronger guarantees must not rely on the trail's gate for it. The related deferred decisions are recorded in `docs/specs/open-decisions-and-gaps.md` and mirrored in the plan ledgers.

---

## 5. History Survives Governance

Governance actions on this platform preserve history by rule: soft-delete preserves all historical sessions, reports, and financial records (**INV-U1**); balances survive suspension/blocking/soft-delete (**INV-U5**) — see `docs/specs/state-machine-invariants.md`; there are no hard deletes on users (`docs/workflows/05-admin-governance-override.md` §8). The audit trail is the durable evidence thread across that lifecycle:

- Audit rows are append-only and trigger-protected (§3) — no governance action can rewrite or remove them.
- The `actor_id` foreign key is `NOT NULL` with `ON DELETE RESTRICT` — an audit row cannot exist without its actor, and the join to `users` for `actorName` can never orphan a row.

The net invariant: **an entity's full audit history outlives every governance state change applied to it**, which is exactly what dispute resolution and the PRODUCTION_READINESS §1.3 rows require.

---

## 6. Details Hygiene (Consumption Note)

The read layer flows `details` **verbatim** — pass-through, by contract. The trail view neither parses, truncates, nor re-formats the stored JSON string; it renders it as escaped text inside a `dir="auto"` pre-formatted element (mixed-direction JSON blobs), with em-dash placeholders for null `details`/`entityId` cells. Because the read layer never re-processes the payload, hygiene is enforced entirely at the WRITER (per the audit-emission contract in `docs/admin/user-management.md` §2.4):

- `details` is capped at ≤ 2000 characters and defensively truncated BEFORE insert — an overlong payload never fails the mutation.
- `details` carries field **names** + metadata only — never contact PII, never credentials, never password hashes, never email pre/post pairs.

Consequences for consumers: never treat `details` as structured-and-trusted enough to query on (see the LIKE-search prohibition in §8), and never "improve" the read layer by re-sanitizing or re-truncating — the verbatim pass-through is the contract that keeps the rendered trail byte-faithful to what the writer stored.

---

## 7. Deep-Link Contract

The `/audit` route accepts a sanitized deep-link seed so other admin surfaces can link straight to a target's history:

```text
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical: app/(dashboard)/audit/page.tsx
/audit?entityType=user&entityId=42
/audit?actorId=7&actionType=Delete&from=2026-02-01&to=2026-02-04
```

- **Parameters:** the `entityType` + `entityId` pair (the canonical "show me this entity's history" link), plus optional `actionType`, `actorId`, `from`, `to` — the same six-member vocabulary as the wire filters.
- **Sanitization — silent drop, per parameter:** every parameter is validated independently server-side; an invalid value is silently DROPPED (never reflected, never surfaced as an error), so a hostile or malformed query string degrades to a partially filtered — or fully unfiltered — listing. `entityType`: trimmed, non-empty, ≤ 100 chars. `actorId`/`entityId`: positive integers within 1..2147483647 (the GraphQL `Int` wire max — out-of-range values can never survive variable coercion, so they are dropped here). `actionType`: exact generated-enum membership, fail-closed. `from`/`to`: each must parse as a real `YYYY-MM-DD` UTC calendar day (no rollover); an inverted pair is dropped as a whole; a same-day pair survives (the view expands it to the exclusive following midnight, §2). Repeated parameters take the first value.
- **Landing:** survivors are handed to the client view as the `initialFilters` seed; nothing surviving renders the unfiltered first page. The view re-normalizes the seed (defense in depth) and owns all later filter state — the view NEVER rewrites the URL; every subsequent query change happens through the filter bar's submit.
- **Page gate:** the route is server-guarded — `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/audit" })`; anonymous callers are redirected to login with a return path, mismatched roles to their own dashboard. See `docs/app/with-page-auth.md`.

---

## 8. What NOT to Do

- **DO NOT add an update/delete/edit surface to `audit_logs`.** No mutation resolvers, no repository write methods, no raw-SQL mutators — the DB triggers reject them and the static single-writer scan fails the suite by design. Corrections are made by appending a new compensating row (§3).
- **DO NOT LIKE-search `details`.** No `LIKE`/`ILIKE`/pattern matching on the `details` column — filters are equality/range predicates on typed columns only. Pattern-searching a verbatim JSON blob re-opens an injection surface and invites PII mining of a column whose hygiene contract is names-only (§6).
- **DO NOT fork a second audit writer.** `AuditService.createAuditLog` is the single canonical writer; audit contracts are composed by calling services, never constructed inside the writer — and never by a second writer alongside it. A fork would diverge the `actorId` source of truth and re-open the denial-no-audit surface.
- **DO NOT filter trail history by governance.** No soft-delete/suspension/block predicates on the trail — history survives governance (§4, §5). A governance-filtered trail silently hides exactly the evidence the surface exists to preserve.
- **DO NOT add a second `AuditActionType` enum registration.** The enum lives once in `backend/enum/`, is registered once in the shared Pothos enum registry, and reaches the frontend only through codegen. Re-registering (or hardcoding value literal arrays, or re-declaring a string-union twin) drifts the vocabulary and breaks the seven-value guarantee of PRODUCTION_READINESS §1.3.5.
- **DO NOT read the trail without the `$all` scope conjunction.** A plain `{ authenticated: true, role: [...] }` map is ANY-semantics and lets any authenticated caller through. The explicit `$all` conjunction is load-bearing on this surface like every other admin read.

---

## 9. Architecture Map

| Module | Responsibility (one line) |
|---|---|
| `backend/enum/audit/audit-action-type.enum.ts` | Canonical seven-member `AuditActionType` enum (mirrors the `audit_action_type` pgEnum). |
| `backend/types/audit/audit-trail.types.ts` | Canonical shapes: closed filter submit whitelist + entry/page return types. |
| `backend/db/schema/audit/audit-logs.ts` | Append-only `audit_logs` table schema (the pre-existing substrate). |
| `backend/db/repo/audit/audit-trail.repository.ts` | Read-only data access — `listEntries` + `countEntries` share ONE predicate builder; `tx` optional-last; zero writes. |
| `backend/services/admin/audit-trail.service.ts` | Business-logic hub — gate → filter validation → page bounds → ONE repeatable-read snapshot tx (count + list) → row mapping; zero writes, zero logging. |
| `backend/services/admin/admin-gate.helpers.ts` | Shared admin gate (`assertActorAdmin`) + fail-closed raw-enum coercion — reused, not forked. |
| `backend/services/admin/audit.service.ts` | The single append-only writer `AuditService.createAuditLog` (write half; never invoked by the read surface). |
| `backend/graphql/pothos/admin/audit-trail.pothos.ts` | GraphQL objects + closed six-member filter input — `id` first, embedded page envelope (no `id`), shared enum, `DateTime` scalar. |
| `backend/graphql/query/admin/audit-trail.query.ts` | `adminAuditLogs` root field — `$all` scope conjunction, thin field-by-field resolver, side-effect registration. |
| `frontend/graphql/sharedDocuments/admin/audit-trail.documents.ts` | Typed `gql` document — `id` selected first, exact entry + envelope selections. |
| `frontend/providers/apollo/apolloCache.ts` | Registers `AdminAuditLogPage` as an embedded value type (`keyFields: false`). |
| `app/(dashboard)/audit/page.tsx` | Server-guarded route — admin page gate + independent silent-drop deep-link sanitization into the view seed. |
| `frontend/views/admin/audit/audit-trail-filters.ts` | Filter contract + pure UTC-day/enum plumbing — malformed drafts normalize to unfiltered. |
| `frontend/views/admin/audit/AuditTrailView.tsx` | Client container — `useQuery` listing, seed re-normalization, error seams branch on `extensions.code`. |
| `frontend/views/admin/audit/AuditTrailFilterBar.tsx` | Real `<form>` filter bar — draft state internal; queries fire ONLY on submit. |
| `frontend/views/admin/audit/AuditTrailFilterFields.tsx` | Filter field grid — ids, entity type, action `Select`, date pair, ≥44px Apply/Clear. |
| `frontend/views/admin/audit/AuditTrailResults.tsx` | Settled results card — honest empty state + pagination footer echoing the server envelope. |
| `frontend/views/admin/audit/AuditTrailRow.tsx` | One trail row — expandable verbatim `details` in a `dir="auto"` pre; em-dash null placeholders. |
| `frontend/views/admin/audit/AuditTrailStates.tsx` | `aria-busy` skeleton, honest empty state, settled-failure retry seams. |
| `frontend/views/admin/audit/audit-trail-skin.ts` | Shared theme-token `sx` skins (RTL-safe, no physical direction props). |

---

## 10. Test Locks

- `backend/db/test/logic/audit/audit-immutability.test.ts` — the two-tier immutability proof (static single-writer scan + behavioral trigger tier + migration-DDL pin).
- `backend/db/test/logic/audit/audit-trail.repository.test.ts` — repository read contract (filter chains, ordering, join, honest count).
- `backend/services/admin/audit-trail.service.test.ts` — service pipeline order, snapshot-tx identity oracles, denial silence, corrupt-row fail-closed mapping.
- `backend/graphql/test/audit-trail.query.test.ts` — wire matrix over live HTTP: denial tiers, closed-input smuggle probes, hostile pagination, internal-error leak scan.
- `backend/graphql/test/schema-surface.test.ts` — committed SDL byte-identity against a deterministic rebuild (pins the exact wire contract of §2).
- `test/workflows/admin/audit-trail.journey.test.ts` — cross-actor journey: audited mutations land, denials write zero rows, the trail renders them.
- `test/ui/components/admin/AuditTrailView.test.tsx` — component matrix: filter submit semantics, UTC-boundary wire pins, pagination echo, error seams, both locales.
- `frontend/graphql/sharedDocuments/admin/audit-trail.documents.test.ts` + `frontend/providers/apollo/apolloCache.test.ts` — document/SDL agreement and cache-registration pins.

---

## 11. Related Documents

- Audit-emission (write) contract: `docs/admin/user-management.md` §2.4 — composition-only `AuditLogWriteContract`, in-tx emission, denial-no-audit rule, ≤2000-char names-only `details`.
- Workflow: `docs/workflows/05-admin-governance-override.md` §7 (audit-log requirements + the catalog of audited admin actions).
- Requirements & readiness: `docs/specs/functional-requirements.md` (FR-10.5), `docs/planning/PRODUCTION_READINESS.md` §1.3, `docs/specs/open-decisions-and-gaps.md` (A.5).
- Invariants: `docs/specs/state-machine-invariants.md` (INV-U1, INV-U5 — history/balances survive governance).
- Error contract: `docs/graphql/error-handling-contract.md` + `docs/graphql/domain-error-extensions-code.md` (code taxonomy, boundary masking — corrupt stored enums surface as masked internal errors, never raw values).
- Page auth wrapper: `docs/app/with-page-auth.md`.
- Migration notes: `docs/DATABASE_MIGRATIONS.md` (migrate vs push — the §3 trigger caveat applies here).
