# Implementation Tasks: Admin Broadcasts — History & Lifecycle (First-Class Record, Detail View, Stop/Retract)

> **Plan directory (verbatim — used everywhere below):** `ai/plans/admin-broadcasts-history-lifecycle`
> **Ticket:** #146 — Admin broadcasts CRUD, UI/UX (GitHub issue `kottaby/kottaby#146`)
> **Specs:** `ai/plans/admin-broadcasts-history-lifecycle/specs.md` (REQ-0..REQ-9, §4 cross-actor journey, §6 constraints)
> **Outcomes:** `ai/plans/admin-broadcasts-history-lifecycle/outcome/` (`research-01`..`research-04` = the verified fact base)
> **Deferred items:** `ai/plans/admin-broadcasts-history-lifecycle/deferred-items.md` (D1–D8)
> **Author:** Ahmed Hosny · **Date:** 2026-09-18
> **Scope (one line):** first-class `broadcasts` header records + admin history list/detail + one-way stop-with-retraction lifecycle on the EXISTING `/admin/broadcasts` page — compose surface untouched, six locked exclusions (ledger D1–D6) never re-included.

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Outcome Knowledge Read:** before starting ANY task, read ALL existing files under `ai/plans/admin-broadcasts-history-lifecycle/outcome/` and `ai/plans/admin-broadcasts-history-lifecycle/deferred-items.md`. Never repeat a resolved mistake; never redo finished work.
2. **Post-Edit Verification:** after creating/modifying ANY file, run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` — exit code MUST be 0 before the task may be marked complete. The script runs `tsgo → oxlint → biome:check → lint → check:duplicates` progressively and auto-discovers/prints the applicable `AGENTS.md` + `.agents/instructions/*.instructions.md` files.
3. **Test Execution:** run tests ONLY via `bun run test/scripts/run-test.ts <test-path>` (journey suites: `bun run test/scripts/run-test.ts test/workflows/...`); NEVER raw `bun test` for DB/service suites.
4. **NO UI component test files — EVER.** `test/ui` is E2E-only (the Paymob spec). UI verification rides on journey/integration/documents-lock tests plus OPTIONAL agent-browser manual verification (screenshots under `scratch/screenshots/`, never committed). Any task that would create a file under `test/ui/` is invalid.
5. **Semantic Review Checklist Self-Review:** every task ends with a self-review pass — atomicity (no read-then-write without CAS/tx), env-config registration, zero dead code, no cross-layer imports (`shared/` never imports app/frontend/backend), enums value-imported and referenced by member, no `console.*`, no `.rejects.toThrow()` inside `runInRollback`, no plan-artifact/REQ references in code comments.
6. **Outcome Documentation:** after each task, write `ai/plans/admin-broadcasts-history-lifecycle/outcome/<task-id>-outcome.md` capturing: research findings, docs consulted, implementation details, verification evidence, deviations, and carry-overs.
7. **Checkbox Tracking:** flip `[ ]` → `[x]` in this `tasks.md` as subtasks complete. A task is `[x]` only when ALL its subtasks are `[x]`.
8. **Drizzle discipline:** schema changes (new table, columns, indexes) via `bun run db push`; custom SQL (the historical backfill) via `bun db migrate` — NEVER mixed in one migration. Load the `drizzle-*` skills at migration time (ledger D7); never hand-edit the migration journal.
9. **Commit discipline:** all commits pathspec-scoped (`git add <paths>`, NEVER `git add -A`) and NEVER pushed — another agent has unrelated staged changes in the shared index.
10. **Quality-gate workflow:** follow `bun quality-gate` (tsgo → oxlint → biome → lint → duplicates); NEVER clear cache files; re-run to resume from the last failed stage.
11. **Scope discipline:** never implement beyond a task's scope; cross-file dependencies found mid-task are reported to the orchestrator (Fix-Or-Report rule), never silently patched in an unassigned file.

---

## Task → Instruction-Files Mapping (verified to exist)

Root `AGENTS.md` always applies. Files below were glob-verified on 2026-09-18 — cite ONLY these; `frontend/components/AGENTS.md`, `backend/services/notifications/AGENTS.md`, and `frontend/views/admin/AGENTS.md` do NOT exist.

| Target path pattern | AGENTS.md files (verified) | .agents/instructions files |
|---|---|---|
| `backend/enum/**` | `backend/enum/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/types/**` | `backend/types/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/db/schema/**` | `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/db/repo/**` | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/db/test/logic/**` | `backend/db/test/AGENTS.md`, `backend/db/test/logic/AGENTS.md`, `backend/AGENTS.md` | backend + `.agents/instructions/tests.instructions.md` |
| `backend/db/migration/**` (custom SQL) | `backend/AGENTS.md` (+ `drizzle-*` skills at run time, D7) | `.agents/instructions/backend.instructions.md` |
| `backend/services/**` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/graphql/query/**` | `backend/graphql/query/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/graphql/mutation/**` | `backend/graphql/mutation/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/graphql/pothos/**` | `backend/graphql/pothos/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/graphql/test/**` | `backend/graphql/AGENTS.md`, `backend/AGENTS.md` | backend + `.agents/instructions/tests.instructions.md` |
| `shared/locale/**` | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | (none) |
| `frontend/graphql/sharedDocuments/**` | `frontend/graphql/sharedDocuments/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/AGENTS.md` | `.agents/instructions/frontend.instructions.md` |
| `frontend/views/**` | `frontend/views/AGENTS.md`, `frontend/AGENTS.md` | `.agents/instructions/frontend.instructions.md` |
| `app/(dashboard)/**` | `app/AGENTS.md` | `.agents/instructions/frontend.instructions.md` |
| `test/workflows/**` | `test/workflows/AGENTS.md` | `.agents/instructions/tests.instructions.md` |
| `docs/**` | root `AGENTS.md` only | (none) |

---

## Phase 0 — Baseline & Gates

- [x] T0 [Pre-Implementation Baseline & Deferred Ledger]
  - Record baseline BEFORE any implementation: `tsgo` error count, `biome:check` warning count, lint JSON snapshot (`bun run scripts/lint-service.ts --json --id baseline`), plus a `git status --porcelain` snapshot.
  - Confirm `ai/plans/admin-broadcasts-history-lifecycle/deferred-items.md` is the working ledger: D1–D6 are LOCKED scope exclusions (stay ❌ by design, excluded from the final-gate count); D7–D8 resolve during execution; any execution-added row must reach ✅ before plan completion.
  - Write `outcome/T0-outcome.md` with all baseline counts + snapshot.
  - _Requirements: REQ-0_

- [x] T0.5 [Plan Review Gate — completed at planning time]
  - `@plan-review` ran over the complete plan package (`specs.md` + `plan.md` + this `tasks.md`); all reported findings dispositioned before implementation — see `outcome/plan-review-R1.md`.
  - _Requirements: REQ-0_

---

## Phase 1 — Backend Foundation (journey test FIRST)

- [x] T1 [Enums & Types — `BroadcastStatus` + canonical broadcast types]
  - CREATE `backend/enum/notifications/broadcast-status.enum.ts` — `enum BroadcastStatus { Active = "active", Stopped = "stopped" }`, mirroring the `broadcast-audience-type.enum.ts` conventions; UPDATE the `backend/enum/notifications/index.ts` barrel (`export * from "./broadcast-status.enum";`).
  - UPDATE `backend/db/schema/enums.ts` — register BOTH new pgEnums: `broadcast_status` and `broadcast_audience_type` (the TS-only audience enum gains its DB counterpart for the header's audience snapshot column).
  - AMEND the `backend/enum/notifications/broadcast-audience-type.enum.ts` doc note (currently "no pgEnum counterpart") — the runtime selector stays TS-only; the new `broadcast_audience_type` pgEnum persists the header's audience snapshot (plan.md §4.2).
  - UPDATE `backend/graphql/pothos/shared/enum.pothos.ts` — register `BroadcastStatusPothosEnum` (enum-OBJECT form only; a literal `values:[...]` list fails the static-assertion gate).
  - EXTEND `backend/types/notifications/broadcast.types.ts` (committee-of-one, no service-layer `.types.ts`): `BroadcastSelectType`, `BroadcastInsertType`, `AdminBroadcastEntryReturnType` (`sentByName`/`stoppedByName` resolved via SQL joins — never per-row service fetches), `AdminBroadcastPageReturnType` (house `{items, totalCount, page, pageSize}`), `AdminBroadcastDetailReturnType` (entry + `liveDeliveredCount` + `liveReadCount`), `AdminBroadcastListFilters`.
  - _Requirements: REQ-1_
  - [x] T1.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T1.TE **Test Engineering:** enum test file mirroring `broadcast-audience-type.enum.test.ts` 4 tiers — Tier 1 member values; Tier 2 null/empty/wrong-case/number rejections; Tier 3 fuzz hostile strings; Tier 4 no string-literal acceptance beyond the two members. Type shapes compile under `tsgo`; zero runtime code in `.types.ts`.
  - [x] T1.SEC **Security & Tenancy Audit:** enum surface closed (no index signature, no extra members); no identity-bearing fields in the new types; filters type readonly.
  - [x] T1.SR **Semantic Review:** enums value-imported downstream (never `import type` at runtime use); zero dead code; no cross-layer imports; pgEnum member lists byte-match the TS enums.
  - [x] T1.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T2 [`broadcasts` table schema & push]
  - CREATE `backend/db/schema/notifications/broadcasts.ts` per the locked D1 column list: identity PK; `title` varchar(255) notNull; `body` text notNull; `audienceType` `broadcast_audience_type` nullable; `audienceRole` `user_role` nullable; `audienceCountry` varchar(100) nullable; `audiencePlanId` int nullable NO FK; `status` `broadcast_status` notNull default 'active'; `recipientCount` int notNull; `sentById` FK → users `onDelete: restrict`; `sentAt` notNull defaultNow; `stoppedById` FK → users nullable; `stoppedAt` nullable; `idempotencyKey` varchar nullable UNIQUE.
  - Indexes on the new table: `(sentAt)` and `(status)`; PLUS the composite index `notifications (related_entity_type, related_entity_id)` added to `backend/db/schema/notifications/notifications.ts` for linkage/retraction lookups.
  - ADD `export * from "./broadcasts";` to `backend/db/schema/notifications/index.ts` (backend/db/schema/AGENTS.md "Adding New Tables") — without the barrel re-export, `@/backend/db/schema` cannot resolve `broadcasts` for T1's `BroadcastSelectType` inference.
  - Apply via `bun run db push` (schema changes ONLY — never mixed with the T3 custom SQL; load `drizzle-*` skills, ledger D7); verify table + all three indexes exist post-push and a second push is a no-op.
  - _Requirements: REQ-1_
  - [x] T2.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T2.TE **Test Engineering:** schema lands via push; DDL behavior coverage is delegated to the T5 repo tests (log the dependency in `outcome/T2-outcome.md`); verify push idempotency (second run = no pending changes) and `tsgo` green.
  - [x] T2.SEC **Security & Tenancy Audit:** FK actions restrict/`set null` only where locked (no cascade deletes leaking broadcast provenance); no tenant-scoping absent by design (admin entity) — confirm no per-tenant column smuggled in.
  - [x] T2.SR **Semantic Review:** schema matches the D1 column list exactly; defaults sane (`status='active'`); indexes match query plans of T5 (list newest-first, CAS by id+status, linkage lookups).
  - [x] T2.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T3 [One-time backfill custom-SQL migration]
  - CREATE the backfill migration, applied via `bun db migrate` (custom SQL ONLY — never via `bun run db push`; load `drizzle-*` skills, ledger D7): grouped header creation for ALL pre-existing `system_broadcast` rows — `type='system_broadcast' AND related_entity_id IS NULL`, `GROUP BY (title, body, created_at)` — each group producing ONE header with status 'active', `recipientCount = count(*)`, `sentAt = group createdAt`.
  - Audience + actor recovery: LEFT JOIN `audit_logs` (`entity_type='notification_broadcast'`, same `created_at` as the group, `details.recipientCount` matches, `DISTINCT ON` lowest audit id) — audience kind/companion from `details`, `sentById` from `actorId`; groups with no matching audit row or no notification rows are SKIPPED safely (no invented headers).
  - Linkage UPDATE: match `notifications` rows on (title, `body IS NOT DISTINCT FROM`, `created_at`) → set `related_entity_type='broadcast'`, `related_entity_id = <header id>`.
  - Idempotent one-shot guard (`related_entity_id IS NULL` predicate everywhere — re-entry is a no-op; ledger D8); document the accepted same-microsecond duplicate-merge risk (REQ-6.5) in the migration header.
  - Verify: header count == distinct groups, linkage completeness 100%, then re-run the migration to prove idempotency; capture evidence in `outcome/T3-outcome.md`.
  - _Requirements: REQ-6_
  - [x] T3.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T3.TE **Test Engineering:** the migration run IS the test — assert header/row/linkage counts against the dev DB before + after, then re-run to prove the no-op guard; Tier 2 edge: NULL-body historical rows (IS NOT DISTINCT FROM), groups without audit rows.
  - [x] T3.SEC **Security & Tenancy Audit:** zero destructive operations (INSERT + UPDATE only, guarded WHERE clauses); no superuser-required statements; backfill never touches rows created post-feature.
  - [x] T3.SR **Semantic Review:** guard makes re-entry safe without journal hacks; SQL matches the verified join key (transaction-start `now()` shared `createdAt`); no runtime code path can re-run it.
  - [x] T3.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

---

- [x] T4 [Cross-actor journey test — TEST-FIRST, expected RED until T7]
  - CREATE `test/workflows/notifications/broadcast-retraction.journey.test.ts` following the `admin-broadcast.journey.test.ts` pattern exactly: committed fixtures in `beforeAll` (single tx), `TrackedFixtures` for fixture rows + `afterAll` hard-delete; `audit_logs` rows cleared via the separate suspended-trigger sweep (trigger-immutable tables are never registered in `TrackedFixtures` — per `test/workflows/AGENTS.md`; precedent: `admin-broadcast.journey.test.ts` journey-cleanup), `expectJourneyError` try/catch helper, run-unique prefixes, `db.$count` oracles, actor helpers from `test/workflows/helpers/actor-context.ts`, `SpiedFanoutTransport` — NEVER `runInRollback`.
  - Asserts the full journey (specs §4 steps 1–10): admin send → history entry (status active, recipientCount N) → recipient row exists linked to header → detail live stats (delivered/read) → non-admin FORBIDDEN / anonymous UNAUTHORIZED (zero state) → admin stop → recipient row gone + unread count self-corrects → re-stop → `broadcastAlreadyStopped` → unknown id → `broadcastNotFound` → exactly ONE Suspend audit row with `entityId = <broadcast id>`.
  - The suite MUST be committed RED (T7 lands the service surface that greens it) — run via `bun run test/scripts/run-test.ts test/workflows/notifications/broadcast-retraction.journey.test.ts` and record the expected-failure evidence in `outcome/T4-outcome.md`.
  - _Requirements: REQ-4, REQ-5, REQ-7, REQ-9_
  - [x] T4.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts test/workflows/notifications/broadcast-retraction.journey.test.ts --lifecycle duplicates` (exit 0)
  - [x] T4.TE **Test Engineering:** the journey IS the test tier — real services + real DB, real role rows (authorization never monkey-patched), committed fixtures + tracked teardown, side-effect channels spied; journey layer rules: NO `runInRollback`, services spawn their own transactions.
  - [x] T4.SEC **Security & Tenancy Audit:** denial steps assert zero state (no rows, no counts, no existence oracle) for non-admin/anonymous; recipient-side assertions confirm no cross-tenant leakage of retraction.
  - [x] T4.SR **Semantic Review:** one file per cross-actor workflow; helpers reused not forked; no runInRollback; `db.$count` oracles over raw row reads.
  - [x] T4.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T5 [BroadcastRepository]
  - CREATE `backend/db/repo/notifications/broadcast.repository.ts` (verified sibling convention: `broadcast-audience.repository.ts` + `notification.repository.ts` live in `backend/db/repo/notifications/`; UPDATE its `index.ts` barrel): `create` (translateDbError maps PG 23505 → `ConflictError`), `findByIdempotencyKey`, `list` + filters + pagination (1-based, honest `totalCount`, `ilike` title search through `escapeLikeWildcards`), `findById` (with `sentByName`/`stoppedByName` resolved via SQL joins), `transitionToStopped` CAS (`UPDATE … WHERE id = ? AND status = 'active' RETURNING`; 0 rows → the CALLER arbitrates NotFound vs Conflict).
  - 100%-coverage repo tests in `backend/db/test/logic/notifications/` (verified location): `runInRollback` everywhere, `tx` passed to ALL repo calls, `expectRepoError` try/catch helper, NEVER `rejects.toThrow()` inside `runInRollback`, `entity-setup.ts` helpers only (verify signatures before use).
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4_
  - [x] T5.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T5.TE **Test Engineering:** Tier 1 create/find/list/CAS paths 100% branch coverage; Tier 2 null audience companions, unicode/RTL titles, page/pageSize clamps, empty result sets; Tier 3 concurrent CAS races via `Promise.allSettled` (exactly one winner); Tier 4 ILIKE wildcard probes (`%`, `_`, `\` stored in titles stay inert); 23505 unique-violation on `idempotencyKey`.
  - [x] T5.SEC **Security & Tenancy Audit:** all params bound (no string concatenation); search input sanitized via `escapeLikeWildcards` before ILIKE; repo performs NO role checks (service-layer duty) and none smuggled in.
  - [x] T5.SR **Semantic Review:** repo is data-access only (no business rules); joins resolve names in ONE query per page (no N+1); canonical types from `@/backend/types`; tx-propagation on every method.
  - [x] T5.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T6 [NotificationRepository extensions + engine retraction]
  - EXTEND `backend/db/repo/notifications/notification.repository.ts`: `deleteByRelatedEntity` (set-based DELETE by `related_entity_type`/`related_entity_id` — one statement, no row loops) + `readStatsByRelatedEntity` (ONE grouped aggregate: row count + `sum(isRead)`).
  - CREATE `NotificationEngine.retractByRelatedEntity(relatedEntityType, relatedEntityId, tx)` at `backend/services/notifications/notification-engine.service.ts` — the single-writer invariant holds (canonical doc §9): retraction composes through the engine on the supplied `tx`; no other file ever deletes `notifications` rows.
  - Engine + repository tests: retraction deletes exactly the linked rows (engine-mediated), stats aggregate matches live row sets, tx propagation asserted.
  - _Requirements: REQ-3, REQ-4, REQ-5_
  - [x] T6.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T6.TE **Test Engineering:** Tier 1 delete/stats coverage both tx and non-tx branches; Tier 2 zero-linked-rows stats (0/0), rows with mixed isRead, unicode payloads; Tier 3 concurrent retract + concurrent retract-vs-emit race via `Promise.allSettled`; Tier 4 unrelated-entity rows untouched by a retraction (isolation probe).
  - [x] T6.SEC **Security & Tenancy Audit:** delete scoped ONLY by the related-entity pair (no broader predicate possible); stats disclose counts only, no recipient identity leakage.
  - [x] T6.SR **Semantic Review:** engine remains the ONLY `notifications` writer (grep-prove no new direct writer); `is_read` flip semantics untouched; no dead exports.
  - [x] T6.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

---

- [x] T7 [AdminBroadcastService extensions — send records; list/detail/stop]
  - EXTEND `backend/services/notifications/admin-broadcast.service.ts` — send path per D4: insert the header FIRST (caught 23505 → `findByIdempotencyKey` → return the existing `recipientCount`, no emit/audit/publish); `emitForUsers` carries linkage (`BROADCAST_RELATED_ENTITY_TYPE` constant + header id) instead of nulls; engine-reports-replay-after-header-insert (ghost-claim residual) → throw `ConflictError` to roll the whole transaction back (no orphan header); the send audit row (Create, "notification_broadcast") now carries `entityId = <broadcast id>`.
  - NEW service methods (all behind `assertActorAdmin` + one `withTransaction`): `listBroadcasts` (filters + pagination; `escapeLikeWildcards` + `%…%` wrap; status derives from the header only), `broadcastDetail` (entry + live stats via `readStatsByRelatedEntity`), `stopBroadcast` (CAS → NotFound/Conflict arbitration → engine retract → exactly ONE Suspend audit row, metadata-only `details = { recipientCount, retractedCount }` → return the retracted count).
  - Colocated service tests (`backend/services/notifications/admin-broadcast.service.test.ts` pattern, `runInRollback`): send-records-header matrix, replay absorption (no duplicate header), list/detail/stop matrices incl. CAS races and denial zero-state.
  - **Journey T4 goes GREEN** in this task — run it and capture green evidence in `outcome/T7-outcome.md`.
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-7, REQ-9_
  - [x] T7.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T7.TE **Test Engineering:** Tier 1 all service branches; Tier 2 empty audience replays, null stop metadata, boundary counts; Tier 3 concurrent stop races via `Promise.allSettled` (exactly one winner, losers get Conflict), same-key replay probes; Tier 4 non-admin denial matrices across list/detail/stop with zero-state assertions. Service tests mock external adapters (transport/cache); DB tests in `runInRollback` + `tx`.
  - [x] T7.SEC **Security & Tenancy Audit:** BFLA — `assertActorAdmin` pre-transaction on every new method, zero writes on denial; BOPLA — strict field-by-field DTO mapping, no `{ ...input }` spreads into insert/update; audit `details` metadata-only (never message copy, never recipient ids — inherited REQ-021 discipline); `broadcastNotFound` confined to the admin path (no existence oracle pre-gate).
  - [x] T7.SR **Semantic Review:** header + emission + audit atomic (one commit); ghost-claim rollback leaves zero partial state; replay path returns the original count with no second header; enums value-imported; no dead code; no plan-artifact references in comments.
  - [x] T7.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

---

## Phase 2 — GraphQL API

- [x] T8 [Resolvers & codegen]
  - CREATE `backend/graphql/query/notifications/admin-broadcasts.query.ts` — `adminBroadcasts(filters, page, pageSize): AdminBroadcastPage!` and `adminBroadcastDetail(broadcastId: Int!): AdminBroadcastDetail!`; CREATE `backend/graphql/mutation/notifications/admin-stop-broadcast.mutation.ts` — `adminStopBroadcast(broadcastId: Int!): Int!` (the retracted count).
  - Both fields: `adminOnlyAuthScopes` + `requireAdminUser(ctx)` prelude; resolvers delegate EXCLUSIVELY to `AdminBroadcastService` (no try/catch boundary masking, no direct repo/engine calls); entry objects list `id: ID!` FIRST (Apollo cache normalization); `pageSize` default 25 clamped ≤ 100; out-of-range page → empty items + honest `totalCount`.
  - Wire both barrels via side-effect imports (`import "./admin-broadcasts.query";`, `import "./admin-stop-broadcast.mutation";`); RUN `bun run generate:gqlSchema && bun codegen` — regenerated artifacts committed in the SAME changeset.
  - _Requirements: REQ-2, REQ-3, REQ-4, REQ-7_
  - [x] T8.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T8.TE **Test Engineering:** schema builds clean (`generate:gqlSchema` no registration errors); resolver-level behavior lands with T15's integration matrix — log the dependency in `outcome/T8-outcome.md`.
  - [x] T8.SEC **Security & Tenancy Audit:** authScopes exactly the `$all` conjunction map; ZERO identity args (caller from `ctx.user.id` only); client-supplied `broadcastId` honored only AFTER the admin gate passes; ops never added to the public allowlist.
  - [x] T8.SR **Semantic Review:** delegation-only resolvers; side-effect barrel pattern; no duplicate registration; `id: ID!` first on every object type.
  - [x] T8.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T9 [SDL pins & audit census]
  - UPDATE `backend/graphql/test/sdl-static-assertions.test.ts` — `FROZEN_MUTATION_FIELDS` gains `adminStopBroadcast`; `FROZEN_QUERY_FIELDS` gains `adminBroadcasts` + `adminBroadcastDetail` (alphabetical, sorted-list assertions).
  - UPDATE `backend/graphql/test/schema-surface.test.ts` — `RECONCILED_ADMIN_BROADCAST_CERTIFY_MUTATION_FIELDS`, `RECONCILED_ENUMS` gains `BroadcastStatus`, `RECONCILED_ADMIN_BROADCAST_TYPE_NAMES` (+ the new page/detail object types), admin-mutation sorted-contiguity pin, whole-schema named-type delta — while leaving the `notification_type` members pin untouched.
  - Codegen-sync: `frontend/graphql/generated/schema.graphql` byte-identical to the built schema (pin test green).
  - ADD the wired row for `adminStopBroadcast` to `test/workflows/admin/audit-completeness.catalog.ts` (same changeset as the mutation): mutation field → service entry → `expectedActionTypes: [AuditActionType.Suspend]`, `entityType "notification_broadcast"`.
  - _Requirements: REQ-2, REQ-4, REQ-9_
  - [x] T9.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T9.TE **Test Engineering:** the updated baseline suites run green via `bun run test/scripts/run-test.ts backend/graphql/test` — NOTHING beyond the enumerated pin updates may change (no bypasses, no assertion deletions).
  - [x] T9.SEC **Security & Tenancy Audit:** pin extensions are additive only — no field un-frozen, no enum pin weakened; the audit census guarantees the stop mutation can never ship unaudited.
  - [x] T9.SR **Semantic Review:** pins are DESIGNED-FOR-UPDATE baselines, extended never bypassed; catalog row matches the T7 audit contract exactly.
  - [x] T9.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T15 [GraphQL integration tests]
  - CREATE integration tests in `backend/graphql/test/` (server lifecycle via `setupTestServerLifecycle`; requests via `testClient` as in `notification-query.test.ts` in the same directory — note the sibling `admin-broadcast.integration.test.ts` uses raw fetch; the NEW suites use `testClient`): list + filters + pagination (incl. out-of-range page → empty items + honest `totalCount`), detail (known id + unknown id → `broadcastNotFound`), stop (happy path returning the retracted count + already-stopped conflict + unknown id + FORBIDDEN/UNAUTHORIZED denials).
  - Authorization oracle: teacher/student/parent receive FORBIDDEN with ZERO broadcast state across all three operations; anonymous receives UNAUTHORIZED pre-resolver.
  - _Requirements: REQ-2, REQ-3, REQ-4, REQ-7_
  - [x] T15.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T15.TE **Test Engineering:** the integration matrix IS the test — real HTTP stack, no resolver-level shortcuts; Tier 4 denial/abuse probes (smuggled identity args rejected by GraphQL validation pre-resolver); the whole `backend/graphql` test directory stays green via `bun run test/scripts/run-test.ts backend/graphql/test`.
  - [x] T15.SEC **Security & Tenancy Audit:** error payloads carry only documented `extensions.code`s; no user/broadcast enumeration leakage in denial responses.
  - [x] T15.SR **Semantic Review:** tests exercise the wire contract (SDL shape + codes), not internals; no env leakage between tests; fixtures cleaned up.
  - [x] T15.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

---

## Phase 3 — Mid-Point Review Gate

- [x] T16 [Backend mid-point review gate]
  - Dispatch review subagents in parallel per the SDD Phase 2.5 pattern: `review-types` (backend/types files), `review-backend` (all `backend/` files from T1–T9/T15), `review-config` (schema/migration/env surfaces).
  - Filter to backend-specific findings only; fix each per file via `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0 per fixed file); re-dispatch the reviews until ZERO backend-specific findings remain.
  - Write `outcome/midpoint-review-R1.md`; mark complete ONLY when the backend review is clean — frontend propagation must not begin on a dirty backend.
  - _Requirements: REQ-0_

---

## Phase 4 — Frontend

- [x] T10 [i18n keys & parity]
  - ~35 NEW `AdminBroadcasts` namespace keys — labels type + `en` + `ar`: tabs; history title/subtitle; filter labels; column labels; `statusActive`/`statusStopped`; `viewDetails`/`stopAction`; detail labels incl. delivered/read counts + `detailRetractedNote`; `stopConfirmTitle`/`stopConfirmBody(count)`/`stopConfirmAction`/`stopConfirmCancel`; `stopSuccessToast(count)`; `emptyTitle`/`emptyBody`; `pagerPrev`/`pagerNext`. Count-bearing keys are FUNCTIONS in the type (interpolation/plural params, Arabic CLDR plural-cycle discipline).
  - UPDATE `shared/locale/adminBroadcasts-namespace.parity.test.ts` — `MANDATED_KEYS` + `FUNCTION_KEYS` inventories (the exhaustive-inventory guard forbids silent key minting).
  - FLAT error keys `broadcastNotFound` / `broadcastAlreadyStopped` in `shared/locale/types/errors/labels.ts` + `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts` (mirroring the existing broadcast validation keys — NOT inside `AdminBroadcasts`).
  - _Requirements: REQ-8, REQ-0.5_
  - [x] T10.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T10.TE **Test Engineering:** parity suites green both locales via `bun run test/scripts/run-test.ts shared/locale` — mandated-key inventory updated, plural-function output asserted for en + ar, Arabic-script sweep passes, errors-namespace parity keeps both new keys.
  - [x] T10.SEC **Security & Tenancy Audit:** no raw server data interpolated into labels beyond the numeric count; error copy discloses no recipient data or internal ids.
  - [x] T10.SR **Semantic Review:** handle accessed via the `AdminBroadcasts` namespace const (never a string-literal namespace, never function-call key access — no `Translation` enum exists); zero hardcoded user-facing strings.
  - [x] T10.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T11 [GraphQL documents & lock tests]
  - EXTEND `frontend/graphql/sharedDocuments/notifications/broadcast.documents.ts` (verified existing) with `adminBroadcastsQueryDocument`, `adminBroadcastDetailQueryDocument`, `adminStopBroadcastMutationDocument` — `TypedDocumentNode`s against the T8 codegen types; EVERY object type in each document includes `id`.
  - EXTEND its existing co-located lock test `broadcast.documents.test.ts` — pin operation names, variable surfaces, `id`-inclusion, barrel identity.
  - _Requirements: REQ-2, REQ-3, REQ-4_
  - [x] T11.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T11.TE **Test Engineering:** documents lock test green via `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments` — operation names + variable surfaces + `id`-first fields pinned.
  - [x] T11.SEC **Security & Tenancy Audit:** documents carry ZERO identity variables (broadcastId only where server-contract requires; caller identity lives in the session); no token-like material in documents.
  - [x] T11.SR **Semantic Review:** generated types imported from `frontend/graphql/generated`; no hand-written response types; barrel export updated per convention.
  - [x] T11.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T12 [Hooks & history section]
  - CREATE in `frontend/views/admin/broadcasts/`: `useAdminBroadcastsData` (stateful `useQuery`), `useAdminBroadcastDetail` (stateful `useQuery` + `skip` — NEVER `useLazyQuery`), `useStopBroadcast` (mutation + snackbar toast + Apollo cache refetch), `broadcast-history.helpers.ts`, `BroadcastHistoryFilterBar.tsx` (draft→applied filter state), `BroadcastHistoryTable.tsx` (row + status chip), `BroadcastHistoryPager.tsx` (1-based, clamped `changePage`), `BroadcastHistorySection.tsx` (render-state matrix).
  - Follow the session-governance + disputes reference patterns (`frontend/views/admin/session-governance/`, `frontend/views/admin/disputes/`); hand-composed MUI (`sx` only, NO AppDataGrid/PageContainer); theme-palette colors only, `*Outlined` icons, logical spacing props, ≥44px targets.
  - _Requirements: REQ-2_
  - [x] T12.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T12.TE **Test Engineering:** NO component tests (policy — `test/ui` is E2E-only); correctness rides on T15's wire contract + the T11 documents lock test + T14's manual verification; boundary behavior (empty list, out-of-range page, loading/error skeletons) verified via the render-state matrix in T14.
  - [x] T12.SEC **Security & Tenancy Audit:** no client-side trust of server data (status rendered from header payload only); user copy rendered with `dir="auto"` where authored text displays; no identity assumptions client-side.
  - [x] T12.SR **Semantic Review:** stateful `useQuery` only (zero `useLazyQuery`); zero direct style props (`sx` callbacks with `theme.palette.*`); zero hardcoded strings — all copy via `useAppTranslation(AdminBroadcasts)`; `React.SubmitEvent` typing where forms submit.
  - [x] T12.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T13 [Detail drawer, stop dialog & page swap]
  - CREATE `BroadcastDetailDrawer.tsx` (in-page drawer, full verbatim content `dir="auto"`, live delivered/read stats, stop metadata when stopped) and `StopBroadcastDialog.tsx` (confirmation with interpolated recipient count; dialog remount via a single `useState<string|null>` key — the session-governance idiom).
  - SWAP `app/(dashboard)/admin/broadcasts/page.tsx` to render the NEW `AdminBroadcastsContainer` with MUI Tabs — History (DEFAULT) + Compose — BOTH panels stay MOUNTED (hidden, not unmounted) so the compose draft + Apollo cache survive tab switches; `BroadcastComposeContainer` and its 11 sibling compose files stay byte-untouched; the `adminBroadcastNotification` mutation keeps its signature/behavior; no new routes, no nav changes.
  - _Requirements: REQ-3, REQ-4_
  - [x] T13.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per created/modified file (exit 0)
  - [x] T13.TE **Test Engineering:** NO component tests (policy); drawer/dialog behavior verified in T14's agent-browser pass; page-gate behavior (non-admin redirect) is the existing SSR `withPageAuth` contract — unchanged.
  - [x] T13.SEC **Security & Tenancy Audit:** page gate stays `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/broadcasts" })`; non-admin redirect via `roleDashboardPath(ctx.role)` (never bare `/dashboard`); drawer renders only admin-gated data already fetched through the triple wall.
  - [x] T13.SR **Semantic Review:** compose files byte-untouched (diff-prove it); both tabs mounted with hidden panels (draft + cache preserved); stop button rendered ONLY while status is active; no dead code.
  - [x] T13.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each file, and validate against them.

- [x] T14 [Manual UI verification — NO committed test files, policy]
  - Run the app; login via `bun run scripts/browser-login.ts --inject`; verify with agent-browser (`agent-browser snapshot -i -c`, `agent-browser console --level error`, network clean): tabs render (History default), history list + filters + pagination, detail drawer, stop flow END-TO-END (a test recipient's row disappears after stop), Arabic RTL rendering (locale switch).
  - Save screenshots under `scratch/screenshots/` (never committed); record findings + console/network evidence in `outcome/T14-outcome.md`.
  - EXPLICITLY assert ZERO new files under `test/ui/` — this task creates no test files whatsoever.
  - _Requirements: REQ-2, REQ-3, REQ-4, REQ-8 (verification), REQ-0 (no-UI-test policy)_
  - [x] T14.QL **Quality Loop:** run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on any file patched from findings (exit 0)
  - [x] T14.VER **Manual Verification Checklist:** tabs (History default, Compose intact); list + status chips + filters compose AND-wise; pager clamps; detail drawer shows live stats + stop metadata; stop dialog shows interpolated count; stop success toast; stopped row shows Stopped badge and no stop action; empty state; RTL mirroring; `aria-busy`/focus states.
  - [x] T14.SEC **Security & Tenancy Audit:** confirm non-admin roles landing on `/admin/broadcasts` are redirected (spot-check one role in the browser); no broadcast data flashes before gate.
  - [x] T14.SR **Semantic Review:** zero committed test files; screenshots under `scratch/` only; findings dispositioned or ledgered.
  - [x] T14.IV **Instruction Verification:** read the auto-discovered AGENTS.md + .agents/instructions files that sub-loop.ts prints for each patched file, and validate against them.

---

## Phase 5 — Post-Implementation Review Wave

- [x] T17 [Parallel review wave]
  - Dispatch review-types / review-backend / review-frontend / security-probing subagents, scoped STRICTLY to files created/modified by this plan (T1–T15 artifacts only).
  - Aggregate + dedupe + categorize findings (CRITICAL/HIGH/MEDIUM/LOW); filter out pre-existing issues (compare against the T0 baseline).
  - Fix per file cluster with `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` verification (exit 0 per fixed file); re-run the wave until ZERO feature-specific findings; write `outcome/post-implementation-review.md`.
  - _Requirements: REQ-0_

---

## Phase 6 — Knowledge Propagation

- [x] T18 [Canonical docs update & knowledge propagation]
  - AMEND `docs/notifications/broadcast-notifications.md`: §1 (broadcasts are now first-class; linkage via the existing related-entity pair), §9 (NEW rules: stop is engine-mediated retraction; header-first transaction order on send; the send audit row carries the broadcast id going forward — historical rows keep null, documented as a mixed state), §10 (EXTEND the evidence map with the new journey/repo/service/integration/parity rows — §10 currently has NO stale component-test rows to prune).
  - The canonical doc lives in `docs/notifications/` ONLY — NEVER update `AGENTS.md` or `.agents/instructions/*` from plan outcomes (they are hand-curated).
  - Write `outcome/T18-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-0_

---

## Phase 7 — Final Gate

- [x] T19 [Final quality gate]
  - `bun quality-gate` green through ALL stages; run the journey suite (`bun run test/scripts/run-test.ts test/workflows/notifications/`), db tests (`bun run test:db`, scoped to notifications where the runner supports it), service tests, GraphQL integration tests, i18n parity; confirm codegen-sync byte-identical.
  - Confirm ZERO UI test files added (`git status --porcelain test/ui` empty of new files); baseline deltas vs T0 = zero new errors.
  - Deferred-items enforcement: execution-added rows all ✅, D7/D8 resolved; D1–D6 remain the locked ❌ scope list by design.
  - Write `outcome/T19-final-gate-outcome.md`.
  - _Requirements: REQ-0 (all)_

---

## Requirements Traceability (REQ ↔ Task)

| Requirement | Task Coverage |
|---|---|
| REQ-1 — First-class broadcast record | T1, T2, T3, T5, T7 |
| REQ-2 — History list | T5, T7, T8, T9, T11, T12 |
| REQ-3 — Detail view | T5, T6, T7, T8, T9, T11, T13 |
| REQ-4 — Stop (retraction) | T5, T6, T7, T8, T9, T11, T13 |
| REQ-5 — Recipient retraction observability | T4, T6, T7 |
| REQ-6 — Historical backfill | T3 |
| REQ-7 — Admin-only authorization | T4, T7, T8, T15 |
| REQ-8 — Localization & parity | T10, T14 |
| REQ-9 — Stop audit trail | T4, T7, T9 |
| REQ-0 — Baseline & execution protocol | T0, T16, T17, T18, T19 |

---

**Execution order reminder:** T0.5 plan-review completed at planning time. Journey task **T4 is TEST-FIRST** — it must exist (RED) before T7 turns it GREEN. Never start Phase 4 before the T16 mid-point gate is clean; never create a UI component test file — `test/ui` is E2E-only.
