# Tajweed Curriculum Lessons — CRUD Vertical Slice

This doc consolidates the durable engineering patterns and gotchas from the Tajweed Curriculum
Lessons CRUD implementation — a zero-schema-delta vertical slice over the existing `lessons`
table. It exists so the next slice over an existing table (or the next curriculum-adjacent
ticket) starts from proven rails instead of re-discovering them.

## Why

The lessons domain had an existing table (`backend/db/schema/classes/lessons.ts`) with **no
ordering column, no unique constraints on `(plan_id, title)`, no CHECK constraints** — but no
read surface, no write path, and no admin UI. The ticket therefore shipped the full stack
(types → i18n → repository → service → GraphQL → codegen → documents → admin UI → route →
seeds) against the table exactly as it exists, with **zero schema delta** and no `db push`.
The `plans` catalog domain is the same shape end-to-end and served as the clone lineage:
every layer of the lessons slice mirrors the corresponding `plan-catalog` layer, translated to
the lessons domain.

## Pattern — clone-lineage vertical slice

When a new CRUD domain mirrors an existing one, clone the lineage **structurally**, then
translate:

1. **Pick the lineage** — same table shape, same auth posture, same UI composition. Read every
   cited lineage file before writing a single new file.
2. **Types first** — `backend/types/classes/<entity>.types.ts` with the five canonical names
   (`<Entity>SelectType` / `<Entity>InsertType` / `<Entity>ReturnType` alias-of-select /
   `<Entity>SubmitInput` / `<Entity>UpdateInput = Partial<SubmitInput>`); register in the
   layer barrel.
3. **i18n in the same changeset as the strings' consumers** — the `lessonCatalog` error group
   (server errors) and the `<entity>` namespace (UI) land en+ar together with the type
   registry wiring; parity suites lock them.
4. **Repository** — dual-path idiom (`isDBTransaction` guard + `<ENTITY>_READ_COLUMNS` + raw
   `queryDb` for bare reads), guarded single-statement writes (insert / update / delete with
   RETURNING), `tx` LAST on every signature, `updatedAt` set server-side only.
5. **Service** — actor gate (admin) BEFORE validation → strict id coercion → per-field
   localized validation in helpers → `withTransaction` composing the repo write + exactly one
   audit row. Helpers throw localized `ValidationError`s the service maps via
   `to<Entity>WriteDomainError`.
6. **GraphQL** — Pothos object + inputs in `pothos/classes/`; mutations with
   `authScopes: { role: [UserRole.Admin] }` **before any resolver body**; authenticated read
   query; thin resolvers that delegate to the service WITHOUT re-wrapping transactions; then
   `bun run generate:gqlSchema && bun codegen`.
7. **Documents** — `TypedDocumentNode`s per operation, `id` in every selection set; codegen
   is **operation-based** — adding a field to a document selection requires a codegen re-run
   (the generated operation types mirror the selection).
8. **UI** — the lineage's composition tree (selector + table/cards switcher + skeleton/empty
   states + RHF-style dialogs), real data flows only, `useAppTranslation` for every string.
9. **Route + nav** — thin server page (`generateMetadata` + `withPageAuth` + view mount) +
   nav entry, each with its co-located tests.
10. **Seeder** — service-only (zero raw DB imports), look-before-create idempotency, threaded
    from the master controller via results (never by querying seed data).

## Rules

- **Wire nullability is real.** Pothos optional args arrive as `T | null | undefined` on the
  resolver; graphql-js preserves explicit client nulls. SDL schema tests must assert nullable
  fields as `"Int"` / `"String"` — an `"Int!"` assertion fails by design. Every explicit-null
  input needs a localized rejection path (null `title` → `LESSON_TITLE_REQUIRED`), and the
  drop-null-at-resolver idiom turns an all-null patch into the localized patch-empty
  rejection at the service.
- **Auth in two layers.** `authScopes` gates before any resolver body; the service re-asserts
  the actor against the `users` table before validation or writes. Denial tests must be
  **zero-write oracles**: assert the role error AND unchanged row count AND unchanged audit
  count, using a committed probe fixture.
- **Error surfacing contract.** Per-field codes ride `extensions.fields[]` (mapped to form
  field errors in the UI); patch-empty arrives as a localized top-level message; unknown ids
  surface on `extensions.code`.
- **Client validation must be app-localized.** Native `required`/`maxLength` bubbles are
  browser-localized (violates the i18n rule for user-facing messages) and pass whitespace-only
  input. Use `noValidate` + programmatic validation with a `validation*Message` namespace key
  (trim + empty + max length), keeping the server as the authority.
- **Codegen after document edits.** Operation types are generated from the document selections;
  a new selection field without `bun codegen` is a type error waiting to happen.
- **Test discipline.** DB suites via `bun run test/scripts/run-test.ts <path>` (never raw
  `bun test`), `runInRollback` + `tx` everywhere, the try/catch error helper (never
  `expect().rejects.toThrow()` inside rollback), committed-fixture groups for the bare-`queryDb`
  path, and the 4-Tier framework (coverage / boundaries / chaos / abuse). Concurrency tests
  assert the service-level oracle (double-delete → exactly one success), never raw statement
  ordering.
- **Ordering contract.** The curriculum sequence is `ORDER BY id ASC` (D1 of the plan);
  downstream consumers treat it as stable. Any future `position` column must keep `id ASC` as
  a tie-breaker or re-coordinate with them.
- **Pre-existing reds go to the ledger.** A failing suite or doc-comment defect that predates
  the slice is verified against the base commit (`git diff <base>..HEAD -- <file>` is empty)
  and recorded as a resolved ledger pointer — never fixed drive-by inside an unrelated ticket.

## What NOT to Do

- **Do not spread `{ ...input }` into Drizzle writes.** Build inserts/patches field-by-field
  from the whitelisted submit type; runtime-smuggled extras are ignored (asserted by an
  `Object.defineProperty` probe).
- **Do not write a "race-recovery" absorb branch without a real unique constraint.** A
  look-before-create seeder is idempotent for *sequential* re-runs only; absorbing
  `ConflictError` for duplicate inserts is dead code when the table has no unique constraint —
  the honest header says so.
- **Do not assert post-race terminal state in tests.** Concurrent update-then-delete may land
  both statements; assert the end oracle, not ordering.
- **Do not hand-write operation types or duplicate the schema in the frontend.** Consume the
  generated types; documents carry the names.
- **Do not use `useLazyQuery`** (repo ban) or import Apollo hooks outside
  `@apollo/client/react`.
- **Do not hardcode rendered data.** Every row/value comes from a real query flow; only
  skeleton/empty/error scaffolding states are allowed.
- **Do not update AGENTS.md or `.agents/instructions/` from feature work** — those are
  hand-curated; record durable knowledge in docs like this one instead.

## Rollout Summary

Shipped on branch `tajweed-curriculum-lessons-crud` (local worktree
`kottaby.worktrees/tajweed-curriculum-lessons-crud`):

- **Data layer**: `LessonRepository` (5 guarded methods, dual-path reads) +
  `createTestLesson` fixture; `LessonService` + helpers (5 methods with audit contracts and
  localized per-field errors); service-only idempotent seeder with 3 starter lessons.
- **API layer**: `Lesson` Pothos object (nullable `planId`/`title`), three admin mutations +
  `planLessons` authenticated query; SDL + roles suites lock the contract.
- **Frontend**: lesson documents + `classes/` domain barrel; 20-file admin lessons UI
  (plan selector, catalog table/cards, create/edit form dialog with programmatic localized
  validation, delete confirm naming its target); `/admin/lessons` page + sidebar nav entry.
- **Verification**: 150 tests green across all mandated layers (repo 29, service 20, SDL 6,
  roles 24, locale parity 40, documents contract 28, page 3); two review waves
  (mid-point + post-implementation) resolved to zero feature-specific findings; final gate:
  zero new tsgo/biome/lint findings vs baseline, zero schema drift.

## Related Documents

- Plan of record (specs / design / tasks, archived on completion):
  `ai/finished_plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/`
  — the core plan bundle; per-task implementation records, review-wave fix logs, and the
  deferred-items ledger were session artifacts, removed at archive time per repo convention
  (the durable pointers live in the linked issue #196 close-out and this doc).
- Clone lineage: `frontend/views/admin/plans/**`, `backend/db/repo/billing/plan.repository.ts`,
  `backend/services/billing/plan-catalog.*`, `backend/graphql/{pothos,mutation,query}/billing/plan-catalog.*`.
- Ticket: `docs/planning/TICKETS.md` (Tajweed Curriculum Lessons CRUD — Milestone 2).
- Domain reference: `db/schema.dbml` (`lessons` / `plans` tables).
