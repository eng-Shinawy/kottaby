# Plan Catalog (`plans`) — Canonical Reference

> **Owner ticket:** DEV1-005 — Plan Catalog CRUD (Admin Only) · plan of record: [`ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/plan.md`](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/plan.md)
> **Audience:** every ticket that reads, purchases from, or extends the subscription catalog — DEV1-006 (purchases), DEV2-005 (verification/evaluation flows), DEV1-009 (transactional composition).
> **Error transport semantics** (envelopes, masking, HTTP mapping) are owned by [`docs/graphql/error-handling-contract.md`](../graphql/error-handling-contract.md); this document owns the plan-catalog *domain* contracts.

## Why

The commercial catalog is the shared source of truth that three different actors touch with three different needs:

- **FR-2.1 — Admin-exclusive CRUD.** Publishing a plan, fixing a mispriced plan, or pulling a plan from sale is an admin action. All three mutations (`createPlan`, `updatePlan`, `setPlanActiveStatus`) are gated at the GraphQL field level by `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` ([plan-catalog.mutation.ts](../../backend/graphql/mutation/plan-catalog.mutation.ts)). No other role may mutate the catalog, and there is no non-GraphQL write path — the seeder bootstraps through the service (see [Consumption guides](#consumption-guides)).
- **FR-2.2 — Varieties are title-encoded.** The plan taxonomy (Hifz Jadid / Muraja'ah / Tathbeet / Atfal / Mukathaf / Tajweed) lives entirely in `plans.title` (REQ-019). There is deliberately **no `plan_type`/`kind` column**; adding one is schema drift against this ruling.
- **FR-2.3 — The verification plan is an ordinary catalog row.** The "New Teacher Verification & Evaluation Plan" is not a special schema surface: it is a seeded plan with `sessionCount = 5`, resolved by a documented stable-title lookup rule (REQ-019). DEV2-005 must not special-case it.

Everything below follows from those three framings: a small, admin-managed, server-filtered catalog whose rows are retired (never deleted) and whose edits never rewrite the commercial past.

## Lifecycle Columns and the Pair Invariant

The DEV1-001 `plans` table shipped with no activation column. DEV1-005 added exactly two columns (REQ-010, decision D1), in [`backend/db/schema/billing/plans.ts`](../../backend/db/schema/billing/plans.ts):

| Column | Type | Semantics |
|---|---|---|
| `is_active` | `boolean NOT NULL DEFAULT true` | Lifecycle flag. Default `true` backfilled every pre-existing row — zero backfill migration. |
| `deactivated_at` | `timestamp NULL` | Retirement timestamp; `NULL` while active. |

- **Lifecycle-pair invariant:** `is_active = (deactivated_at IS NULL)` at all times. The columns move *together* in one statement — activating clears `deactivated_at`, deactivating stamps it. Never write one without the other.
- **Push-only delta:** the columns landed via `bun run db push` (Drizzle schema is the sole structural ground truth). `db reset` / custom SQL migrations remain disabled per [`docs/DATABASE_MIGRATIONS.md`](../DATABASE_MIGRATIONS.md) repo policy.
- No index on `is_active`: the catalog is a small admin-managed set (dozens of rows), so the `WHERE is_active = true` scan is trivially acceptable (REQ-010/REQ-034 ruling). Revisit only if the catalog grows past that scale.

## Pattern: Guarded State-Transition (`setActiveStatusOnce`)

The **only** lifecycle state-transition primitive in the domain is `PlanRepository.setActiveStatusOnce(id, target, tx?)` in [`backend/db/repo/billing/plan.repository.ts`](../../backend/db/repo/billing/plan.repository.ts) (decision D2):

```sql
UPDATE plans
SET is_active = $target, deactivated_at = <target ? NULL : now()>, updated_at = now()
WHERE id = $id AND is_active = NOT $target
RETURNING *;
```

Why this shape:

- **TOCTOU window = 0.** The state predicate is evaluated inside the same statement, under the row's write lock. A read-then-write would let two concurrent deactivations both observe `is_active = true` and both succeed silently (REQ-040 violation). Here the statements serialize: the winner rewrites the row and returns it, the loser matches zero rows. Proven at the wire tier by the double-deactivation race probe (outcome [5.2](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/5.2-concurrency-outcome.md)).
- **Idempotency rejects are never silent no-ops.** A `null` transition result means "guard did not match", which is ambiguous between *missing row* and *already in target state*. The service disambiguates with the read-only `existsById` probe (decision D3):
  - probe `false` → `NotFoundError` → wire code `PLAN_NOT_FOUND`;
  - probe `true` → `ConflictError` with `PLAN_ALREADY_ACTIVE` (activating an active plan) or `PLAN_ALREADY_INACTIVE` (deactivating an inactive plan).
  - Callers therefore always receive an explicit outcome — never a quiet "nothing happened". See `PlanCatalogService.setPlanActiveStatus` in [`backend/services/billing/plan-catalog.service.ts`](../../backend/services/billing/plan-catalog.service.ts).
- **No other write touches lifecycle columns.** `insertPlan` always creates active rows (server-owned defaults), and the edit path structurally excludes them (see next section).

## Visibility Split (`planCatalog` vs `adminPlans`)

Two named read operations instead of one query with a client-supplied filter argument (decision D5):

| Operation | authScopes | Arguments | Backing read |
|---|---|---|---|
| `planCatalog` | `$all { authenticated }` | none | `listActiveCatalog` → `PlanRepository.listActive` |
| `adminPlans` | `$all { authenticated, role: [UserRole.Admin] }` | `includeInactive` (defaults `true`) | `listForAdmin` → `listAll` or `listActive` |

Rules that make the split safe:

- **Field-level scope enforcement, before the resolver body.** Pothos `scope-auth` evaluates `authScopes` *before* the resolver runs, so a non-admin can never even execute `adminPlans` — visibility is structurally enforced at the field, not inside application logic (BFLA). Wire-tier proof per role-matrix cell: outcome [3.6](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/3.6-role-matrix-outcome.md), re-proven in review wave 6.4.
- **The active-only predicate exists in exactly one place** — `PlanRepository.listActive`. Both consumer reads route through it, so the visibility rule can never fork.
- **The consumer surface is server-filtered ONLY.** `planCatalog` accepts no arguments (no `includeInactive`, no search, no pagination): a storefront client has no way to request inactive rows. Frontend code must not post-filter lists — the admin container asks `adminPlans`, consumers ask `planCatalog`, and nothing in between.

## Forward-Only Edits and the No-Price-Snapshot Trade-off

`updatePlan` accepts exactly the five commercial fields — `title`, `sessionCount`, `price`, `currency`, `intervalDays` — as a compile-time whitelist (`PlanFieldPatch`, key-by-key copy, never a spread). Lifecycle columns and timestamps are structurally absent from the input types ([plan.types.ts](../../backend/types/billing/plan.types.ts)); smuggling `isActive` through the SDL is rejected pre-execution, and through the service/repository it is a type error.

- **INV-PC2 (preservation):** deactivation and edits never mutate existing `subscriptions` rows, `student_subscriptions` junction rows, or credited balances (INV-B2/B3 shield). The service imports nothing from any commercial-ledger module, and the repository's only production statements touch `plans`. Proof: byte-identical ledger rows across deactivate → edit sequences (outcome [5.1](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/5.1-preservation-proof-outcome.md)).
- **Forward-only semantics (REQ-018):** new terms apply only to purchases made *after* the edit. A recorded subscription's price is fixed at purchase time; re-pricing `Hifz Jadid` today does not retroactively change what any existing subscriber pays.
- **The trade-off:** there is **no price-snapshot column** in MVP. A purchase records terms at write time, but the catalog row always carries the *current* price. Any future flow that must charge, renew, or invoice an existing subscription at its *historical* price cannot read `plans.price` — it needs a snapshot surface that does not exist yet.
- **Revisit trigger:** the first ticket that introduces renewal, auto-billing, or historical invoicing against existing subscriptions (DEV1-006 follow-ups and beyond) must either snapshot commercial terms onto the purchase record or add a dedicated snapshot table *before* shipping. Until then, reading `plans.price` is only valid for *new* purchase decisions.
- Concurrent admin edits resolve **last-write-wins per field patch** (REQ-045) — acceptable for a low-frequency admin surface; no optimistic-version column. Revisit if audit/analytics surfaces require edit history.

## Error Code Map

Producer: `PlanCatalogService` throws `DomainError` subclasses from [`backend/lib/errors.ts`](../../backend/lib/errors.ts) (throw conventions: [`docs/graphql/domain-error-extensions-code.md`](../graphql/domain-error-extensions-code.md)). All user-facing messages resolve through `getServerTranslations(locale).errorsTranslations` (10 `planCatalog` error keys, EN+AR).

| `extensions.code` | Meaning | Producer |
|---|---|---|
| `UNAUTHORIZED` | No valid session (anonymous). | scope-auth: `authenticated` scope failure before resolver body. |
| `FORBIDDEN` | Authenticated but not Admin. | scope-auth: `role: [UserRole.Admin]` scope failure (fail-closed). |
| `VALIDATION` (+ `fields[]`) | Aggregated per-field input rejection; `fields[]` carries `{field, code, message}` so forms can mark every offending field at once. | `createPlan` / `updatePlan` validation, before any write. |
| `PLAN_TITLE_REQUIRED`, `PLAN_TITLE_TOO_LONG`, `PLAN_SESSION_COUNT_INVALID`, `PLAN_PRICE_INVALID`, `PLAN_CURRENCY_INVALID`, `PLAN_INTERVAL_DAYS_INVALID` | Field-level codes inside `fields[]` (and top-level `extensions.code = PLAN_*_INVALID` with class `VALIDATION` when raised via the 23514 fallback, per Ruling B). | validation + `translatePlanPersistenceError`. |
| `PLAN_PATCH_EMPTY` (`VALIDATION` class) | Update patch carried no fields. | `updatePlan` empty-patch guard. |
| `PLAN_NOT_FOUND` | No plan with that id. | `NotFoundError("PLAN", …)` — from `updatePlan` zero-row UPDATE, or the `existsById` probe after a guarded-transition miss. |
| `PLAN_ALREADY_ACTIVE` | Activating an already-active plan (idempotency reject — never a silent no-op). | `ConflictError` from `setPlanActiveStatus`. |
| `PLAN_ALREADY_INACTIVE` | Deactivating an already-inactive plan (idempotency reject — never a silent no-op). | `ConflictError` from `setPlanActiveStatus`. |
| `INTERNAL_SERVER_ERROR` | Unexpected persistence failure, masked. Raw driver messages, SQL fragments, and constraint names never surface. | GraphQL masking boundary (production bodies: `message`/`code`/`requestId`/`path`/`locations` only). |

**23514 check-violation translation.** The three DB CHECKs (`plans_session_count_check`, `plans_price_check`, `plans_interval_days_check`) are the defense-in-depth safety net behind service validation (REQ-035). When a direct write bypasses the service, `translatePlanPersistenceError` maps the recognized constraint names through the driver cause chain into localized `PLAN_*_INVALID` `ValidationError`s; unknown constraint names are rethrown untranslated into the masking boundary. `plans.title` carries **no unique constraint** (duplicate-title tolerance, REQ-040/REQ-043) — there is no 23505 path on this surface.

## Consumption Guides

### DEV1-006 — Purchases

- **Look up purchasable plans through the active catalog only:** `PlanCatalogService.listActiveCatalog` (or the `planCatalog` GraphQL field for client surfaces). It routes through `PlanRepository.listActive` — the single `is_active` predicate. Do **not** run your own `WHERE` against `plans`; do **not** read `listAll`/`listForAdmin` for purchase decisions.
- **Purchase-time re-validation (deferred obligation D2).** Visibility alone is not purchase authorization: inside the purchase transaction, re-assert `is_active = true` for the plan being purchased (guarded conditional UPDATE/SELECT with the same row-lock discipline as [`setActiveStatusOnce`](../../backend/db/repo/billing/plan.repository.ts)). This closes INV-PC1 ("a deactivated plan can never be purchased while inactive") against a deactivate racing a checkout. DEV1-005 ships the predicate and this contract; the enforcement inside the purchase transaction is DEV1-006's obligation.
- **Transactional composition.** All repository methods and all `PlanCatalogService` methods take `tx?: DBTransaction` as their **last** parameter. Pass the purchase transaction to join it (e.g. seed flows and tests do exactly this); omit it to run standalone. Compose reads and writes inside one transaction and keep validation before writes (see [Transactional composition](#dev1-009--transactional-composition)).

### DEV2-005 — Verification / Evaluation Flows

- **The verification-plan lookup rule (FR-2.3 / REQ-019).** Find the plan by its stable title **`"New Teacher Verification & Evaluation Plan"`** with `sessionCount = 5`. The canonical constant is `VERIFICATION_PLAN_TITLE` in [`backend/db/seeds/billing/seed-plan-catalog.ts`](../../backend/db/seeds/billing/seed-plan-catalog.ts), which also freezes the demo catalog (including the deactivated `Legacy Tajweed Plan 2025` fixture).
- **Seeding is service-bootstrap only.** The demo catalog is provisioned exclusively through `PlanCatalogService` (`listForAdmin(true, …)` find-or-create keyed on stable title; the deactivated fixture is created active and then retired via `setPlanActiveStatus(id, false, …)`). Never raw-DB-write catalog rows, and never "repair" a seeded row's lifecycle on re-run — the deactivated fixture must stay deactivated (INV-PC1).
- There is no `plan_type` column and no verification-specific schema: if you need to distinguish the verification plan, it is the *title + sessionCount=5* row — resolve it through the catalog reads, not a new discriminator.

### DEV1-009 — Transactional Composition

- **`tx`-last signatures are the composition contract.** Every `PlanRepository` method and every `PlanCatalogService` method ends with `tx?: DBTransaction`. Passing a transaction makes the call join it; omitting it executes standalone. Resolvers stay transaction-free (thin resolvers call the service with `ctx.locale`); transactions are owned by services/composite flows and tests.
- **Repository reads on the non-transactional branch** use the `queryDb` raw fast path and switch to Drizzle on the supplied transaction — same shapes both branches. Conventions: [`backend/db/repo/AGENTS.md`](../../backend/db/repo/AGENTS.md), [`backend/services/AGENTS.md`](../../backend/services/AGENTS.md).
- **Test discipline:** DB-touching suites run inside `runInRollback` and propagate the rollback transaction into every call (see the billing suites under [`backend/db/test/logic/billing/`](../../backend/db/test/logic/billing/plan-catalog.service.test.ts) — service, repository, preservation, seed). Keep that discipline for any new transactional consumer.

## What NOT to Do

- **Do not inherit the catalog-ID non-sensitivity ruling.** `plans.id` is a non-sensitive catalog identifier: enumeration reveals only public commercial data, so a bad `id` answers `PLAN_NOT_FOUND`, not `FORBIDDEN` (REQ-032 ruling, verified against live constraints in review wave 6.4). This ruling is **not transferable**: any future resource that is user-linked or carries sensitive data must default to the opposite posture (no existence oracle to unauthorized callers) and needs its own BOLA review. Copy-pasting "PLAN_NOT_FOUND for bad ids" into such a surface is a security defect.
- **Do not add catalog search without `escapeLikeWildcards`.** No search input exists on this surface today (all reads are static parameterized SQL; the N/A ruling is recorded in wave 6.4). If a future ticket introduces search over plan titles, using `escapeLikeWildcards` on the input before interpolation into any `LIKE`/`ILIKE` fragment is **mandatory**.
- **Do not treat plan `title` as an i18n key.** Titles are admin-authored **data** (free text, duplicates tolerated by design). Never use a title as a translation lookup or as UI copy; localized UI strings live in the `plans` locale namespace (47 keys, [`shared/locale/namespaces/plans/plans.namespace.ts`](../../shared/locale/namespaces/plans/plans.namespace.ts)) and localized error copy in the 10-key `planCatalog` error group under `errorsTranslations`.
- **Do not delete plan rows.** There is no delete surface by invariant (INV-PC3): rows are retired via the guarded transition. Do not add a `DELETE` statement, and do not "clean up" deactivated rows.
- **Do not fork the visibility predicate.** Never write a second `is_active` filter for catalog reads — route through `listActive` (consumers) or `listForAdmin` (admins).
- **Do not mutate lifecycle columns through the edit path.** `updatePlan` is for the five commercial fields only; state changes go through `setPlanActiveStatus` exclusively.

## Rollout Summary

- **Schema delta (push-only):** `plans.is_active boolean NOT NULL DEFAULT true`, `plans.deactivated_at timestamp NULL` — [`backend/db/schema/billing/plans.ts`](../../backend/db/schema/billing/plans.ts).
- **Repository:** `PlanRepository` — `insertPlan`, `updatePlanFields`, `setActiveStatusOnce`, `existsById`, `listActive`, `listAll` (tx-last, no hard delete) — [`backend/db/repo/billing/plan.repository.ts`](../../backend/db/repo/billing/plan.repository.ts).
- **Service:** `PlanCatalogService` — `createPlan`, `updatePlan`, `setPlanActiveStatus`, `listActiveCatalog`, `listForAdmin`; validation-before-write, 23514 translation, audit seam (`emitPlanAuditSeam` — full audit-log integration deferred to DEV3-020, D1) — [`backend/services/billing/plan-catalog.service.ts`](../../backend/services/billing/plan-catalog.service.ts).
- **GraphQL surface:** 2 queries (`planCatalog`, `adminPlans`) + 3 mutations (`createPlan`, `updatePlan`, `setPlanActiveStatus`) with field-level authScopes — [queries](../../backend/graphql/query/billing/plan-catalog.query.ts) / [mutations](../../backend/graphql/mutation/plan-catalog.mutation.ts) / [object type](../../backend/graphql/pothos/billing/plan.pothos.ts) / [inputs](../../backend/graphql/pothos/billing/plan-inputs.pothos.ts).
- **Admin UI:** `/admin/plans` page + container/table/dialogs, admin-only navigation entry (waves 4.1–4.5).
- **Seed:** demo catalog via service bootstrap — [`backend/db/seeds/billing/seed-plan-catalog.ts`](../../backend/db/seeds/billing/seed-plan-catalog.ts).
- **Invariants INV-PC1..PC3** are recorded with the plan's knowledge-propagation addenda in [`docs/specs/state-machine-invariants.md`](../specs/state-machine-invariants.md) and the decision addenda (schema delta, forward-only edits, title-encoded taxonomy, duplicate-title tolerance) in [`docs/specs/open-decisions-and-gaps.md`](../specs/open-decisions-and-gaps.md).

## Related Documents

- [DomainError → extensions.code Propagation](../graphql/domain-error-extensions-code.md) — throw conventions, subclass hierarchy, `NotFoundError` entity naming
- [GraphQL Error Handling Contract](../graphql/error-handling-contract.md) — transport surface: envelopes, masking, HTTP mapping, client mapping
- [Database Migrations Policy](../DATABASE_MIGRATIONS.md) — push-only schema-delta discipline
- [State Machine Invariants](../specs/state-machine-invariants.md) — INV-PC1..PC3 plan-catalog lifecycle section
- [Open Decisions & Gaps](../specs/open-decisions-and-gaps.md) — resolved addenda for this ticket
- [Plan of record](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/plan.md) · [Specs (REQ-001..083)](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/specs.md) · [Preservation proof (5.1)](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/5.1-preservation-proof-outcome.md) · [Concurrency proof (5.2)](../../ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/5.2-concurrency-outcome.md)
