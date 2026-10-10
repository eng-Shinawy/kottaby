# GraphQL Integration Testing Rules

Integration tests for GraphQL queries/mutations under `frontend/graphql/test/` must adhere strictly to these rules:

## Layout

Tests are organized **by domain** into sub-directories mirroring the `frontend/graphql/sharedDocuments/` taxonomy. Shared infrastructure lives in the repo-root `test/` directory:

```
test/
├── helpers/              ← shared test helpers & server lifecycle (exported via @/test/helpers)
└── scripts/              ← test execution runners
```

### Shared test infrastructure

All shared test infrastructure (Apollo test client, port allocation, server lifecycle, entity setup helpers) is exported via `@/test/helpers`. Never hand-roll per-suite server bootstrap or clients.

### `billing/` sub-directory

Billing-domain wire pins over the LIVE dev server (`setupTestServerLifecycle` + `testClient`): the escrow denial codes (`escrow-denial-codes.test.ts` — `INSUFFICIENT_BALANCE` over `createSession` and `WALLET_INSUFFICIENT_FUNDS` over `requestWithdrawal`).

### `gateway/` sub-directory

Suites under `frontend/graphql/test/gateway/` run against the BUILT schema imported in-process (`import { graphQLSchema } from "@/backend/graphql/gqlSchema"`) — they deliberately do NOT spin up a live server.

### Import conventions for test files

| Target | Recommended import pattern | Notes |
|---|---|---|
| Test Helpers & Lifecycle | `import { setupTestServerLifecycle, testClient } from "@/test/helpers";` | **Preferred alias** — canonical shared test helpers. |
| Documents | `import { fooQueryDocument } from "@/frontend/graphql/sharedDocuments/<subdir>/foo.documents";` | Always use the full deep alias, including the `sharedDocuments` sub-directory segment. |
| Generated types | `import { … } from "@/frontend/graphql/generated/gql/graphql";` | Single file — all types. |
| Generated enums | `import { CurrencyCode, AccountStatus } from "@/frontend/graphql/generated/gql/graphql";` | Always import enum values from generated types — never hardcode string equivalents (see rule 11). |

When adding a **new** test:
1. Identify the matching sub-directory (or create a new one following the conventions above).
2. Create `<scenario>.test.ts` in that sub-directory.
3. Import shared helpers from `@/test/helpers`.
4. If a new sub-directory is created, document it under **Layout** above.
5. For mutations: look up `Mutation<Name>Variables` in generated types and pass ALL args (required + optional) as `variables` — see rule 11.
6. Run `bun tsgo` and `bun biome:check` on the new file before considering it done.

---

1. **Next.js Server Lifecycle Management**:
   - Import the reusable dev server setup lifecycle helper from `@/test/helpers` and call it at the root of your `describe` block:
     ```typescript
     import { setupTestServerLifecycle } from "@/test/helpers";

     describe("My GraphQL Tests", () => {
       setupTestServerLifecycle();
       // ...
     });
     ```
   - This automatically handles hooking into Bun's `beforeAll` and `afterAll` lifecycles to spawn the Next.js dev server on the fixed test port (`3066`), poll until ready, and kill only this process's server tree upon test suite completion.
   - Optional env override: `GRAPHQL_TEST_PORT=<port>` pins the port for debugging.
   - Never hardcode port numbers — the shared port constant is exported from `@/test/helpers` (`TEST_PORT`).

2. **Apollo Shared Client**:
   - Import the shared, cache-disabled test client to perform all GraphQL operations:
     ```typescript
     import { testClient } from "@/test/helpers";
     ```

3. **Type-Safe GraphQL Execution**:
   - Do **NOT** write raw string queries in tests or use raw HTTP `fetch` POST requests.
   - Define queries as `TypedDocumentNode` in `frontend/graphql/sharedDocuments/<subdir>/` files, run `bun run generate:gqlSchema` and `bun codegen`, and pass the imported document node directly to the query call:
     ```typescript
     const result = await testClient.query({
       query: {entityName}QueryDocument,
     });
     ```

4. **Dynamic Header & Locale Testing**:
   - Dynamically change headers (such as `Accept-Language` or cookie authentication values) on a per-query basis using Apollo's request context:
     ```typescript
     const result = await testClient.query({
       query: {entityName}QueryDocument,
       context: {
         headers: {
           "Accept-Language": "en",
           "Cookie": "NEXT_LOCALE=en",
         },
       },
     });
     ```

5. **Handling Query Errors & Non-Null Checks**:
   - Since the test client is configured with `errorPolicy: "all"`, GraphQL errors (like unauthorized access) do not throw. Instead, assert against the `result.error` property (type `ApolloError | undefined`) rather than `result.errors`.
   - Always verify that target query properties (e.g., `result.data?.teachers`) are defined and not null before performing assertions on them, to satisfy TypeScript's strict null checking. Use guards (e.g., `if (!teachers) throw new Error("...")`) to narrow the type cleanly.

6. **Align Test Data with Provisioned Entities**:
   - Avoid hardcoding search strings or expected names — create and reference the entities each test provisions, and use those exact names/IDs in search parameters and assertions.
   - Never import from `@/shared/demo-users` in integration tests — all test data should be provisioned via the shared test setup helpers.

7. **Optional Chaining Preference (Linter & TS Compliance)**:
   - Prefer optional chain expressions (`?.`) over verbose logical checks. Avoid code structures like `if (!result.data || !result.data.field)`. Instead, use `if (!result.data?.field)`. This complies with the `@typescript-eslint/prefer-optional-chain` lint rule.

8. **Test Duplication Prevention**:
   - Never duplicate standard test setup routines—such as login mutations or querying/extracting basic entities (e.g., matching student/teacher ID pairs)—across multiple test files.
   - Centralize all reusable test logic in the shared helpers under `test/helpers/`.
   - For mutation variable construction shared across test cases, use a typed builder helper that defaults optional fields to `null` and accepts `Partial<T>` overrides — see rule 11 for the builder pattern.

9. **Large Method Remediation**:
   - Keep helper functions and test seeders modular and concise. If a helper or seeder exceeds ~70–80 lines, refactor it by extracting distinct steps into smaller helper functions.

10. **Strict Interface Layer Separation**:
    - Integration tests under `frontend/graphql/test/` must interact with the application *exclusively* via the GraphQL API (using `testClient`). Under no circumstances should backend repositories (`db/repo/`), drizzle schemas directly (other than for checking in seed files), or service layers (`backend/services/`) be imported or invoked directly inside integration test files.

11. **Mutation Argument Coverage (CRITICAL)**:

    **Core Rule**: Every mutation call site MUST pass ALL available input arguments (both required AND optional) as `variables` — no field may be silently omitted. Optional fields must explicitly appear as `null` even when you don't intend to test them in that call site.

    **Discovering Arguments**: Look up the mutation's variables type in `frontend/graphql/generated/gql/graphql.ts` (search for `{MutationName}Variables`). For `input` object mutations, also look up the input type definition (e.g., `TeacherOnboardingInput`) and include **ALL** its fields:

    ```typescript
    type SomeMutationVariables = {
      expectedVersion?: number | null;  // OPTIONAL — has | null
      newClassesRemaining: number;       // REQUIRED — no | null
      studentId: string;                 // REQUIRED
    };
    ```

    - Fields **without** `InputMaybe` → required — always pass a value.
    - Fields **with** `InputMaybe` → optional — test both a **meaningful non-null value** AND **`null`** in separate test cases.

    **Testing Matrix for Optional Fields**: For each optional field, ensure at least two test cases exercise it:
    - One with a meaningful non-null value (real enum values, realistic strings, valid IDs — never empty strings or `""` for required fields).
    - One with `null` explicitly (do not omit the field — pass `null` to exercise the resolver's optional branch).

    **Enum Values**: Import and use generated enum values — never hardcode string literals:

    ```typescript
    // ✅ Correct — generated enums
    import { CurrencyCode, AccountStatus } from "@/frontend/graphql/generated/gql/graphql";
    const input = { status: AccountStatus.Activated, currency: CurrencyCode.Usd };

    // ❌ Wrong — hardcoded strings
    const input = { status: "ACTIVATED", currency: "USD" };
    ```

    **Nested Input Types**: For input objects containing nested input types, populate ALL fields at every nesting level — do not skip nested optional fields.

    **Builder Pattern for Large Input Objects**: When a mutation has many optional fields, use a typed builder helper:

    ```typescript
    type TeacherInputOverrides = Partial<TeacherOnboardingInput> & { name: string; email: string; password: string };

    function buildTeacherInput(overrides: TeacherInputOverrides): TeacherOnboardingInput {
      return {
        name: overrides.name,
        email: overrides.email,
        password: overrides.password,
        // Required defaults — always present
        address: overrides.address ?? null,
        avatarUrl: overrides.avatarUrl ?? null,
        hourlyRate: overrides.hourlyRate ?? null,
        // ... all optional fields default to null, overridable
      };
    }
    ```

    **Cleanup Guards**: When tests provision multiple entities used in cleanup mutations, guard against `null` IDs for **ALL** required arguments — not just the ones used as variables in the test body. Missing an ID in the guard can cause empty strings to be passed for required `String!` fields:

    ```typescript
    // ✅ Good — guard all required IDs
    if (studentId && teacherId && studentUserId && teacherUserId) {
      // cleanup mutations with all required variables
    }

    // ❌ Bad — only checks some, empty-string fallback for remaining required fields
    if (studentUserId && teacherUserId) {
      // studentId: studentId || "" → empty string for required String! field
    }
    ```

    **Helper Function Pattern**: For mutations shared across multiple test cases, centralize the variable construction in a typed helper function (following rule 8 about test duplication):

    ```typescript
    function buildEntityVars(entityId: string, overrides: Partial<UpdateEntityInput> = {}): UpdateEntityInput {
      return {
        entityId,
        // required fields
        issueDate: overrides.issueDate ?? new Date().toISOString(),
        // default optional fields to null
        description: overrides.description ?? null,
        expectedVersion: overrides.expectedVersion ?? null,
      };
    }
    ```
