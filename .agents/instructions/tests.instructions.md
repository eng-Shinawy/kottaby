---
applyTo: "**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/*.spec.tsx,scripts/run-test/**/*.ts"
---

# Test Rules

### Database Tests - Transaction Safety (CRITICAL)

- ALWAYS use `runInRollback` wrapper for DB tests - never perform DB ops outside rollback unless testing RLS roles
- ALWAYS pass `tx` to ALL repo methods inside transactions - mixing `tx` and `db` causes deadlocks and state pollution
  ```ts
  // WRONG - db-backed call inside tx transaction
  await tx.select(...);
  await SomeRepository.someMethod(arg1); // uses global db - DEADLOCK

  // CORRECT - all calls use tx
  await tx.select(...);
  await SomeRepository.someMethod(arg1, tx);
  ```
- NEVER `expect(...).rejects.toThrow()` inside `runInRollback` - causes deadlocks. Use try/catch pattern:
  ```ts
  async function expectRepoError(fn: () => Promise<unknown>): Promise<Error> {
    let errorCaught: unknown = null;
    try { await fn(); } catch (error) { errorCaught = error; }
    expect(errorCaught).not.toBeNull();
    return errorCaught as Error;
  }
  ```
- NEVER call `getServerTranslations` from `@/shared/locale/server-graphql` directly in tests - causes the i18n loader to hang. Use `expectRepoError` pattern
- `DBTransaction` type from `./test-utils` for tx params - NEVER type as `any`

### Database Tests - tx Parameter Position

- `tx` position VARIES per repo method - check signature before calling:
  - `ParentRepository.getParentProfile(parentId, tx?)` - 2nd
  - `StudentRepository.setClassesRemaining(studentId, value, expectedVersion?, tx?)` - 4th
  - `StorageDbRepository.linkFileToParent(parentId, fileId, usageType, tx?)` - 4th
- When in doubt, read the repo method source - never assume tx position

### Database Tests - Entity Setup Helpers

- Helper signatures VARY - read source in `entity-setup.ts` before calling:
  - `setupStudent(tx, userOverrides, parentOverrides, studentOverrides)` - 4 args, NOT `(tx, parentId, overrides)`
  - `createTestParent(tx, userId, overrides)` - requires userId from previously created user
  - `createTestStudent(tx, parentId, overrides)` - requires parentId from previously created parent
- Database schema relations to remember:
  - `students.id` is PK - does NOT have `userId` field
  - `teachers.id` references `teachers.userId` -> `users.id`
  - `classInstances.studentId` -> `students.id`, `classInstances.teacherId` -> `teachers.id`
  - Must insert `teacherAssignments` between student and teacher before booking a class

### Database Tests - Data & Schema

- NEVER query seed data - always create test data using `entity-setup.ts` helpers inside `runInRollback`
- NEVER assume table columns - read schema in `backend/db/schema/` first
  - `storageFiles` only has `id`, `path`, `isProtected` - no `mimeType`, `size`, `bucket`
  - Many tables lack `createdAt`/`updatedAt` - verify before inserting
- Pre-existing data: fetch initial count BEFORE operations, assert `initialCount + newItemsCount`:
  ```ts
  const existingCount = await db.$count(students, eq(students.parentId, testParent.id));
  // ... perform inserts (e.g., add 20 students) ...
  const allStudentsCount = await db.$count(students, eq(students.parentId, testParent.id));
  expect(allStudentsCount).toBe(existingCount + 20);
  ```
- Non-existent UUID: `"00000000-0000-0000-0000-000000000000"` or `randomUUID()`
- Unique emails/names: use `randomUUID()` to avoid constraint violations
- Shared timestamp: `const now = new Date();` for all `createdAt`/`updatedAt` in a test

### Database Tests - Error Assertions

- Assert `.toContain()` on translated message substring (e.g., `"not found"`, `"Version mismatch"`, `"already deactivated"`) - NOT raw translation key
- Repository methods produce localized messages - raw keys like `"studentNotFound"` never appear in `error.message`
- Do NOT catch errors manually outside of a reusable `expectRepoError` helper

### Database Tests - Coverage & Structure

- 100% code coverage required for `repo/` tests - verify with `bun test --coverage <path>` or `bun run test:db:coverage`
- `logic/` vs `repo/`: logic = workflows/constraints/triggers, repo = 100% coverage of isolated methods
- Aggressively extract helpers (e.g., `testRepoError`, `expectConstraintViolation`) to reduce duplication
- Build custom higher-order test wrappers within the test file for domain-specific patterns (e.g., `function testRepoError(name, logic)`)
- Keep helpers under ~70-80 lines - extract distinct steps into smaller functions
- Do NOT dump domain-specific logic into `test-utils.ts` - keep it in the test file unless globally applicable

### Database Tests - RLS & Cleanup

- RLS testing: `setupRlsRole()` in `beforeAll`, `teardownRlsRole()` in `afterAll`
- Switch roles within tx: `await tx.execute(sql\`SET LOCAL ROLE test_rls_user\`)`
- Non-rollback data (e.g., in `beforeAll` for shared static data) needs `afterAll` cleanup:
  ```ts
  afterAll(async () => {
    await db.delete(someTable).where(eq(someTable.id, testRecord.id));
  });
  ```

### Database Tests - Quality

- Use `bun:test` for test utilities (`describe`, `test`, `it`, `beforeAll`, `afterAll`, `expect`) - NOT Jest or Vitest imports
- Never use `any` - use `Partial<...>` or specific types
- Types from `@/backend/types` for consistency with backend architecture
- Clean up unused imports/variables - run `bun tsgo` and `bun run lint` (which IS the lint queue client) after changes
- Use `testLogger` (never `console.log` or `console.*`) - prefer `testLogger` or no logging if not needed

### Run-Test Script

- Run with log capture: `bun run scripts/run-test/run-test.ts <test-path>` (not raw `bun test`)
- View last result: `bun run scripts/run-test/run-test.ts --last <path>`
- Filtered view: `bun run scripts/run-test/run-test.ts --last --focus "<pattern>" <path>`
- AI agents MUST use this script instead of raw `bun test` for database tests

### Run-Test Script Modification Rules

When modifying `scripts/run-test/run-test.ts`:
- Preserve backward compatibility - existing flags and their behavior must not change
- Keep the log format stable (`logs/<timestamp>/<relative-path>.log`)
- Use `process.stderr.write` for script messages (prefixed with `[run-test]`) - never `console.*`
- Update `--help` output and `parseArgs()` for any new flags
- No external dependencies - script must remain self-contained
- Test changes: `bun run scripts/run-test/run-test.ts scripts/run-test/tests/smoke.test.ts`
- Run quality: `bun tsgo`, `bun biome:check scripts/run-test/`, and lint after changes

### GraphQL Integration Tests (`frontend/common/graphql/test/`)

- Use `testClient.query()`, NEVER raw `fetch` or string queries
- Define queries as `TypedDocumentNode`, pass document node to testClient:
  ```ts
  const result = await testClient.query({ query: {entityName}QueryDocument });
  ```
- `setupTestServerLifecycle` from `./lifecycle` at root of `describe` block:
  ```ts
  describe("My GraphQL Tests", () => {
    setupTestServerLifecycle();
    // ...
  });
  ```
- NEVER import backend repos, Drizzle schemas, or services - interact via GraphQL API only
- Test client has `errorPolicy: "all"` - GraphQL errors do NOT throw. Assert `result.error` (type `ApolloError | undefined`), NOT `result.errors`
- Use `authenticatedRequest` helper from `helpers.ts` for authenticated queries/mutations
- Import shared demo users from `@/shared/demo-users` - avoid hardcoded search strings like `"Default Teacher"`
- Prefer optional chaining (`?.`) - complies with `@typescript-eslint/prefer-optional-chain`
- Null guard before assertions on query results:
  ```ts
  const teachers = result.data?.teachers;
  if (!teachers) throw new Error("teachers should be defined");
  ```
- Dynamic headers per-query via Apollo request context:
  ```ts
  const result = await testClient.query({
    query: {entityName}QueryDocument,
    context: {
      headers: { "Accept-Language": "en", "Cookie": "NEXT_LOCALE=en" },
    },
  });
  ```
- Keep helpers under ~70-80 lines - extract distinct steps when exceeding
- Never duplicate standard test setup (login mutations, entity extraction) - centralize in `helpers.ts`
- Type annotations from `@/backend/types` for consistency

### UI Tests (`test/ui/`)

See `test/ui/AGENTS.md` for full rules. Summary:

- **Production server for E2E** — `test/ui/e2e/` runs against `next start` (`.next-test-prod`), not `next dev`.
- **Build prerequisite** — Run `bun run build:test` before `test:ui:e2e` or `test:ui`. Tests do not build automatically.
- **Rebuild after server changes** — Re-run `build:test` after auth, middleware, API routes, or other server/runtime changes.
- **Component tests** (`test/ui/components/`) — Happy DOM + mocked Apollo; no server, no `build:test` required.
- **GraphQL vs UI** — `test:graphql` still uses the dev server (test-helper mutations). Only `test/ui/` defaults to production.

```bash
bun run build:test           # once before E2E (or after server code changes)
bun run test:ui:components   # no build needed
bun run test:ui:e2e          # requires build:test
bun run test:ui              # components + e2e + static
bun run test:ui:kill         # stop stale test servers (port 3066 only — never 3000/4000)
```

### Test Execution Commands

- `bun run build:test` - production Next.js build for UI/E2E (`.next-test-prod`, `.env.test` only)
- `bun run test:db` - database repo tests (parallel)
- `bun run test:db:sequential` - sequential DB tests (debugging)
- `bun run test:db:coverage` - database tests with coverage report
- `bun run test:graphql` - GraphQL integration tests (dev server)
- `bun run test:ui:components` - UI component tests (no server)
- `bun run test:ui:e2e` - E2E tests (production server; run `build:test` first)
- `bun run test:ui:static` - mobile/desktop import isolation checks
- `bun run test:ui` - all UI tests
- `bun run test:ui:kill` - kill test servers on port 3066 only (never dev:3000 or start:4000)
- `bun run test` - all tests across all layers

### Quality

- Always use `~/.bun/bin/bun` - never npm/yarn/pnpm
- Run `bun tsgo` and `bun run lint` (which IS the lint queue client) after creating or modifying tests - fix all errors
- Follow Biome/ESLint formatting and linting rules
- When a source file is covered by static source-scan pin tests (count pins, allowlist pins, comment-hygiene pins), ANY change to that file must update those pins in the SAME change - a stale pin asserts a false contract and hides real drift
- Dynamic `import()`/`require()` escape hatches must be pinned out wherever a static specifier allowlist exists - a dynamic specifier bypasses `from "..."` scans entirely

### GraphQL Mutation Argument Coverage (CRITICAL)

- Every mutation call in integration tests MUST pass ALL available input arguments (required AND optional) as `variables`
- Look up mutation variable types in `frontend/common/graphql/generated/gql/graphql.ts` (search for `{MutationName}MutationVariables`)
- Required fields (no `InputMaybe`): always pass a value
- Optional fields (`InputMaybe`): test BOTH a meaningful non-null value AND `null` in separate test cases
- For `input` object mutations: include ALL fields of the input type, including nested input types
- Use valid enum values from generated types (e.g., `CurrencyCode.Usd`, `AccountStatus.Activated`) — never hardcode strings
- See `docs/testing/mutation-argument-coverage.md` for the complete pattern reference

### Linting Rules

- See `docs/quality/linting-rules.md` for Oxlint & ESLint/sonarjs fix recipes. NEVER use `oxlint-disable` comments.

