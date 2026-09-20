# Backend Database Seeds Layer

## Purpose

This directory contains all idempotent data seeders for local/development database bootstrapping. Each `seed-<entity>.ts` file exports a `seedOrGet(...)` function that returns either newly-inserted or existing records. Files are grouped by domain, mirroring the `backend/db/repo/`, `backend/types/`, `backend/enum/`, and `backend/graphql/` sub-directory layouts.

## Layout

```
backend/db/seeds/
├── index.ts             (master controller — orchestrates the seed order and `SeedContext`)
├── AGENTS.md            (this file)
│
├── lib/                 Shared factories + helpers (admin-user, faker, orchestrateSeedMany, schedule-factory, …)
├── assets/              Static JSON / image seed assets
│
├── shared/              cross-cutting reference data + coverage verifier (system-settings, timezones, verify-coverage)
├── auth/                user-permission-overrides (auth-coupled seed)
├── users/               seed-users, seed-user-device-tokens
├── audit/               seed-admin-audit-logs, seed-audit-logs
├── teachers/            seed-teachers, seed-teacher-availability-windows, seed-teacher-recurring-unavailability,
│                        seed-teacher-vacation-requests, seed-teacher-banking-details-history, seed-teacher-payments,
│                        seed-leave-requests, seed-leave-quota-usage
├── parents/             seed-parents, seed-suggestions
├── students/            seed-students, seed-student-progress, seed-student-status-history
├── classes/             seed-lessons, seed-classes, seed-class-instances, seed-class-performance, seed-class-status-events,
│                        seed-group-classes, seed-group-class-enrollments, seed-class-communications,
│                        seed-dst-migration-runs, seed-dst-migration-entries, seed-recurring-schedule-days
├── billing/             seed-currency-exchange-rates, seed-currency-exchange-audit-logs, seed-currency-hedges,
│                        seed-invoices, seed-invoice-coverage-months, seed-payments
├── notifications/       seed-user-notification-preferences, seed-notification-deliveries
├── complaints/          seed-complaints, seed-complaint-responses
└── storage/             seed-learning-resources, seed-site-content
```

Each domain sub-directory contains its own `index.ts` barrel that re-exports each `seedOrGet` under a domain-qualified alias (e.g. `export { seedOrGet as seedOrGetTeachers } from "./seed-teachers";`). The top-level `backend/db/seeds/index.ts` master controller is the **only** file that imports individual seeders, via the sub-directory paths or barrel aliases.

## Rules

When creating or updating a seeder in this directory, you must adhere to the following rules:

### FORBIDDEN: System permissions (CRITICAL)

**Do not seed system permissions from this directory.** Rows in `permissions`, `permission_groups`, and `group_permissions` are owned exclusively by SQL under `backend/db/migration/` and applied via drizzle migrations under `backend/drizzle/`.

- **Never** insert/upsert into `permissions`, `permission_groups`, or `group_permissions` from a seeder
- **Never** call `PermissionManagementService.upsertSystemPermissions`, `ensureSystemPermissionGroup`, `ensureGroupPermissionsForGroups`, or `revokeGroupPermissions` from seeders
- New permission keys, system groups, or group grants → add SQL under `backend/db/migration/` **and** a new drizzle migration folder under `backend/drizzle/`
- Seeders **may** assign users to existing groups (`user_permission_groups`) and seed `user_permission_overrides` (per-user overrides only). Groups must already exist from migrations before any seeder assigns them.

### Standard seeder rules

- **"seed or get" Pattern**: Every seeder MUST export a function named `seedOrGet`.
- **One Seeder per Table**: Every table must have its own dedicated seeder file (e.g. `seed-classes.ts`, `seed-class-instances.ts`). Do not combine distinct domains.
- **Idempotency**: The `seedOrGet` function must be safely runnable multiple times. Use look-before-create in the seeder (`orchestrateSeedMany` or explicit checks), then service bootstrap methods that handle duplicates (`onConflictDoUpdate`, `onConflictDoNothing`, or race recovery).
- **Return Value**: The function should return the seeded or retrieved entities. This allows other seeders to use those entities without querying the database again.
- **Dependencies via Controller Context**: If your seeder depends on data seeded by another seeder, the results should be passed from the master seeder controller (`index.ts`) through context, calling that seeder's `seedOrGet` function or accepting it as a parameter.

This ensures that we avoid duplicating data (such as permission groups or users) even if seeders are run multiple times.

- **Check Constraints**: Ensure your seeded data respects database-level `CHECK` constraints. Check `backend/db/schema/*.ts` for these constraints to prevent seeding failures.
- **Enums Verification**: PostgreSQL enums must be matched EXACTLY. Check `backend/db/schema/enums.ts` for the correct values (e.g., using `"ACTIVATED"` or `"REGULAR"` instead of `"ACTIVE"`). Do not guess valid statuses.
- **Schema Synchronization**: If you modified the database schema during your task, you MUST run `bun run db push` to apply changes to the local database before running `bun run db seed`. **Note: `db reset` and `db cleanGenerate` are permanently disabled by repo policy** — use `db push` for schema changes and `db migrate` for migration management.
- **Type Safety**: Seeders do not query the database directly. Use canonical types from `@/backend/types` for entities passed between seeders and returned from services. If a type is missing, add it under `backend/types/` rather than using inline types or `any`. For many-row idempotent inserts, use `orchestrateSeedMany` from `@/backend/db/seeds/lib` with service `find*` / `list*` + `createMany*` / `upsert*` methods.

### File Organization
- Group seeders for the same domain in the matching sub-directory.
- File naming: `backend/db/seeds/<subdir>/seed-<entity>.ts` (e.g. `backend/db/seeds/teachers/seed-teachers.ts`).
- The pre-existing `lib/` and `assets/` directories are **not** part of this domain grouping — `lib/` holds shared factories and helpers imported by all seeders via `@/backend/db/seeds/lib`; `assets/` holds static seed data files.

### Adding New Seeders
1. Identify the matching sub-directory (or create a new one following the sub-directory convention).
2. Create `seed-<entity>.ts` in that sub-directory; expose `export async function seedOrGet(...) { ... }`.
3. Add `export { seedOrGet as seedOrGet<Entity> } from "./seed-<entity>";` to the sub-directory's `index.ts`.
4. Add the import + orchestration call to `backend/db/seeds/index.ts` (the master controller) so the new seeder runs in the correct dependency order.
5. If a new sub-directory was created, also add its `index.ts` barrel.

## Service-Only Data Access (CRITICAL)

Seeders **must not** import from `@/backend/db/**` (schema, repo, drizzleDb, migrations). ESLint enforces this via `no-restricted-imports` on `backend/db/seeds/**/*.ts`.

### Allowed imports in seeders

| Layer | Path pattern | Purpose |
|-------|--------------|---------|
| Services | `@/backend/services/**` | All database writes and reads |
| Seed lib | `@/backend/db/seeds/lib` | Factories, config, `seedOrGet` helpers |
| Types | `@/backend/types` | Entity shapes returned to the controller |
| Enums | `@/backend/enum/**` | Seed data constants |
| Storage bootstrap | `@/backend/storage/demo/**` | Physical file seeding only (no DB) |

### Forbidden in seeders

- `@/backend/db/drizzleDb`, `@/backend/db/schema/**`, `@/backend/db/repo/**`
- Direct `drizzle-orm` queries against application tables

When a bootstrap method is missing on a service, **add it to the service** (and repository if needed) rather than querying the DB from the seeder. Domain seed data (constants, specs) stays in the seeder or `lib/*-factory.ts`; persistence goes through services.

## Phased execution (`runSeedStep`)

`backend/db/seeds/index.ts` wraps each domain step with `runSeedStep` from `lib/run-seed-step.ts`. Failed steps are logged and collected in `context.failedSteps`, then passed to `verifySeedCoverage(failedSteps)` so coverage reporting distinguishes empty tables from earlier step failures.

## Asset checkpoint

- Manifest: `lib/asset-manifest.ts`
- Validator: `bun run validate:seed-assets` (also runs automatically in `backend/db/scripts/drizzleSeed.ts` for `standard` profile)
- Skip gate: `SEED_SKIP_ASSET_CHECK=true`

## Linting Rules

- NEVER use `oxlint-disable` comments — fix the root cause per the repo's linting-rule guidance.
