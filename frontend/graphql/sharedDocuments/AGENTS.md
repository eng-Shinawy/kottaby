# Shared GraphQL Documents Rules

## Layout

GraphQL documents are organized **by domain** into sub-directories, each with an `index.ts` barrel that re-exports its `.documents.ts` files. The top-level `index.ts` re-exports all sub-directory barrels.

```
frontend/graphql/sharedDocuments/
├── AGENTS.md             ← this file
├── index.ts              ← re-exports all sub-directory barrels
├── profile.documents.test.ts  ← co-located test (exception: stays at top level)
│
├── auth/                 auth
├── billing/              billing-alerts, billing-management, user-billing-profile, fx-ingestion
├── classes/              lesson (curriculum lessons CRUD), group-class, class-category, class-subject
├── complaints/           complaint
├── meeting/              meeting
├── notifications/        notification-alerts, notification-preferences
├── parents/              parent-directory, parent-documents, parent-dashboard, parent-profile,
│                         parent-billing-history, parent-onboarding, parent-portal
├── permissions/          permission-management
├── profile/              profile
├── reports/              report
├── resources/            learning-resource, books-and-bags
├── scheduling/           schedule, schedule-deletion, weekly-schedule, recurring-class,
│                         availability-search, dst-migration, class-session
├── shared/               test-helper, translation
├── students/             student, student-directory, student-history, student-lifecycle,
│                         student-status, student-onboarding, student-profile
├── suggestions/          suggestion
├── supervisor/           supervisor-dashboard
└── teachers/             teacher, teacher-dashboard, teacher-notes, teacher-onboarding,
                          teacher-portal, staff-profile, staff-directory, manager-onboarding,
                          applicant
```

### Barrel pattern

Each sub-directory has an `index.ts` that re-exports its documents:

```ts
export * from "./schedule.documents";
export * from "./weekly-schedule.documents";
// ...
```

The top-level `index.ts` re-exports sub-directory barrels:

```ts
export * from "./scheduling";
export * from "./teachers";
// ...
```

### Consumer import conventions

| Use case | Import pattern |
|---|---|
| **Preferred** (barrel) | `import { fooQueryDocument } from "@/frontend/graphql/sharedDocuments";` |
| **Deep import** (also valid) | `import { fooQueryDocument } from "@/frontend/graphql/sharedDocuments/<subdir>/foo.documents";` |
| **Never** (stale flat path) | `import { … } from "@/frontend/graphql/sharedDocuments/foo.documents";` ← broken after refactor |

Both barrel and deep-import paths resolve to the same exports. Prefer the barrel (`@/frontend/graphql/sharedDocuments`) in views/hooks unless you need to avoid pulling in the full barrel tree.

When adding a **new** document file:
1. Create `<domain>.documents.ts` in the matching sub-directory.
2. Add `export * from "./<domain>.documents";` to that sub-directory's `index.ts`.
3. Ensure the sub-directory is exported from the top-level `index.ts` (add `export * from "./<subdir>";` if it's a new sub-directory).
4. Run `bun run generate:gqlSchema && bun codegen`.
5. Document any new sub-directory under **Layout** above.

## File Naming
- One file per domain: `<domain>.documents.ts` (e.g., `auth.documents.ts`, `schedule.documents.ts`)
- Place files in the matching sub-directory; export all documents from the top-level `index.ts` via sub-directory barrels.

## Import Pattern
Always import from `"@apollo/client"` — **never** from `"@apollo/client/core"`:

```ts
import { gql, type TypedDocumentNode } from "@apollo/client";
import type { EntityNameQuery, EntityNameQueryVariables } from "@/frontend/graphql/generated/gql/graphql";
```

## TypedDocumentNode Convention
The naming follows a strict, predictable pattern derived from the operation name:

| Operation | Const name | TypedDocumentNode type |
|---|---|---|
| `query <entityName>` | `{entityName}QueryDocument` | `TypedDocumentNode<{EntityName}Query, {EntityName}QueryVariables>` |
| `mutation <entityName>` | `{entityName}MutationDocument` | `TypedDocumentNode<{EntityName}Mutation, {EntityName}MutationVariables>` |

**Rules:**
- Query const: `<camelCaseName>QueryDocument` → `TypedDocumentNode<{PascalCaseName}Query, {PascalCaseName}QueryVariables>`
- Mutation const: `<camelCaseName>MutationDocument` → `TypedDocumentNode<{PascalCaseName}Mutation, {PascalCaseName}MutationVariables>`
- No-arg queries: omit the second type parameter → `TypedDocumentNode<{EntityName}Query>`
- These types are **always** available after `bun run generate:gqlSchema && bun codegen` — **never** use inline type literals
- For nested field types, use compact extracted names: `{OperationName}_{field}` (e.g., `MeQuery_me`, `QuotaQuery_quota`)
- **NO MAPPING**: No type mapping functions, no intermediate conversion layers, no indexed-access workarounds (e.g., `NonNullable<MeQuery["me"]>`). Use the exact codegen-generated type name directly.
- **NO SCHEMA TYPES**: No schema-level object types (e.g., `User`, `Quota`). Only operation-derived types from `graphql.ts`.
