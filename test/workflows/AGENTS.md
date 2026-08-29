# Workflow / Journey Test Layer Rules

This directory contains **cross-actor journey tests**: sequential, multi-actor workflows executed
through the real service layer against the real test database. Canonical reference:
`docs/testing/workflow-journey-tests.md`.

> **Status:** This directory currently contains only this rules file. The first journey
> implementation scaffolds `test/workflows/helpers/` (cast provisioning + cleanup, pure
> `export *` barrel) and the first `test/workflows/<domain>/` subdirectory.

## Hard rules

1. **NO `runInRollback` — ever.** Services use the global `db` and spawn their own top-level
   transactions; an outer rollback wrapper would deadlock or miss committed rows. This layer is
   the documented exception to the `backend/db/test/` rollback rule — valid only inside
   `test/workflows/`.
2. **Committed fixtures + tracked cleanup.** Create the full actor cast in `beforeAll` inside a
   committing `db.transaction(...)`. Track every created row id (including side-effect rows the
   services create: reports, dues, credit transactions, idempotency-keyed rows) and hard-delete
   all of them in `afterAll`, in FK-safe order, via the cast helper's cleanup function.
3. **Unique UUID prefixes.** Every suite derives a per-run prefix
   (`const prefix = \`jrn_<domain>_${randomUUID().slice(0, 8)}\``) used in names/notes so repeated
   or parallel runs never collide.
4. **Honest authorization only.** Actors are real users holding their real roles (`users.role` +
   role-child rows). Never monkey-patch role/permission resolution in a journey — negative steps
   must fail through the real authorization/ownership checks.
5. **External effects always intercepted.** Nothing may reach real email/SMS/push/FX providers.
   Spy the notification dispatch boundary (namespace import + `spyOn` from `bun:test`; if
   interception empirically fails, fall back to `mock.module` and restore in `afterAll`). Assert
   both that a dispatch happened and **which userIds it targeted**.
6. **Never `expect(...).rejects.toThrow()`.** Use a try/catch helper and assert translated
   substrings from `getServerTranslations("en").errorsTranslations` — no hardcoded English strings.
7. **Use `bun:test` for test-framework imports.** Do not use Jest or Vitest; no `console.*`, no `any` casts.
8. **`@/` import aliases** (e.g. `@/test/workflows/helpers`), never relative parent paths.
9. **Never use demo/seeded rows as fixtures.** Always create your own entities via
   `backend/db/test/entity-setup.ts` helpers (`createTestUser`, `createTestStudent`,
   `createTestParent`, `createTestApplicant`, `createTestAdmin`) — verify signatures first; they
   vary.
10. **Organization**: one journey file per cross-actor workflow, grouped by domain subdirectory
    (`test/workflows/<domain>/<workflow>.test.ts`). Shared scaffolding lives in
    `test/workflows/helpers/` with a pure `export *` barrel (`./` paths only, one `/` max per
    export path).

## Running

While iterating on one journey (log capture, AI-optimized output):

```bash
bun run test/scripts/run-test.ts test/workflows/<domain>/<workflow>.test.ts
```

The whole layer (via the approved runner):

```bash
bun run test/scripts/run-test.ts test/workflows
```
