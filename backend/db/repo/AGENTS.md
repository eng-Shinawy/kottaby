# Backend Database Repository Layer

## Purpose

This directory contains Drizzle ORM repository classes — the **only** layer that touches the database directly. Each `.repository.ts` file exposes a `namespace` of pure data-access functions (no business logic, no permission checks). Files are grouped by domain, mirroring the `backend/graphql/`, `backend/types/`, and `backend/enum/` sub-directory layouts.

## Layout

```
backend/db/repo/
├── index.ts             (top-level barrel — re-exports every sub-directory)
├── AGENTS.md            (this file)
│
├── shared/              cross-cutting infra: cache, ratelimit, session, signedUrl, soft-delete, system-settings
├── audit/               audit-trail (read-only over audit_logs)
├── auth/                impersonation (auth-related)
├── users/               user
├── permissions/         permission-management
├── billing/             billing
├── books/               book, report
├── classes/             class-category, class-performance, class-subject, group-class, dst-migration, subject-resource
├── scheduling/          scheduling (nested sub-package, pre-existing — has its own internal layout)
├── parents/             parent, suggestion
├── students/            student, student-history
├── teachers/            teacher, teacher-availability, teacher-banking, teacher-notes, staff-profile
├── notifications/       notification, notification-preferences
├── complaints/          complaint, complaint-response
├── storage/             storage, learning-resource
└── utils/               repo-internal helpers
```

Each sub-directory (except `scheduling/` and `utils/` which pre-date this refactor and have their own internal barrels) contains its own `index.ts` barrel that re-exports every `*.repository.ts` file in that sub-directory. The top-level `backend/db/repo/index.ts` re-exports every sub-directory barrel.

## Rules

- **Registration repos: `UserRepository.create` / `StudentRepository.createForRegistration` / `ApplicantRepository.create` / `ParentRepository.createForRegistration` — all take `tx: DBTransaction` as last param. See `docs/auth/user-registration.md`.**
- **Neon HTTP Client for Bare Reads (CRITICAL)**: All non-transactional read methods in database repositories MUST use `queryDb(tx)` from `@/backend/db`. When Neon HTTP mode is eligible, reads execute statelessly over HTTP POST; when `tx` is passed or HTTP mode is disabled, it falls back seamlessly to transaction/TCP handles. See `docs/drizzle/neon-http-client.md` for complete architecture, rules, and examples.
- **Prepared Statements (CRITICAL)**: Simple read-only repository methods that execute on TCP mode may use Drizzle Prepared Statements 2.0 (`sql.placeholder(...)`) defined at module level. Module-level prepared statements MUST be removed if replaced by `queryDb(tx)` on non-tx read branches. See `docs/drizzle/prepared-statements.md` for the complete pattern reference.
- **`inArray` + Prepared Statements PROHIBITED**: Queries using `inArray(column, sql.placeholder("ids"))` MUST NOT use prepared statements. PostgreSQL's prepared statement protocol treats `$1` as a single scalar — it cannot expand array parameters for `IN` clauses. Use dynamic queries (`db.select()...where(inArray(col, ids))`) instead. This is a PostgreSQL protocol limitation, not a Drizzle bug.
- **Handshake-code lookups**: `StudentRepository.findDiscoveryByHandshakeCode` (`backend/db/repo/students/student.repository.ts`) uses a single parameterized equality predicate on `students.handshake_code` (never LIKE/ILIKE or `sql` interpolation) and returns a fixed column list; the non-tx branch runs through `queryDb(tx)` (Neon HTTP), so module-level prepared statements do not apply. See `docs/parents/handshake-code-discovery.md`.
- **Parent-link requests**: `ParentLinkRequestRepository` (`backend/db/repo/parents/`) owns the append-and-transition history rows (`ln` table, partial-unique pending-pair arbiter); all transition writes are guarded UPDATEs (state + ownership folded into the predicate), never SELECT-then-UPDATE. See `docs/parents/parent-link-request.md`.
- **Audit trail is a READ-ONLY repo**: `AuditTrailRepository` (`backend/db/repo/audit/audit-trail.repository.ts`) exposes list + count only over the append-only `audit_logs` table — never add write methods to it (UPDATE/DELETE are trigger-blocked at the DB layer; the single writer remains `AuditService.createAuditLog`). See `docs/admin/audit-trail.md`.
- **Batch Lookup Methods for DataLoader**: Repositories that support GraphQL DataLoader batching MUST expose batch lookup methods (e.g., `findByUserIds(userIds: string[], tx?)`) returning `Map<string, T | null>`. Use `inArray(column, ids)` with a plain array (NOT `sql.placeholder`). Pre-initialize the map with all requested keys mapped to `null`, then fill in matches from query results. See `docs/graphql/dataloader-batching.md`.
- **Query Guidelines**: When `findMany` with complex relations creates `SQL<unknown>` errors or TypeScript property missing errors, revert to standard `.select().from().leftJoin()` or manual ID-based mapping. This is the required pattern for this environment to avoid type resolution issues.
- **Separation of Concerns**: Repositories are strictly for data access. Business logic, permission checking, and complex orchestration must reside in the `backend/services/` layer.
- **No Hardcoded Error Strings**: Repositories must not contain hardcoded user-facing error strings, messages, or warnings. Instead, use `getServerTranslations(locale, "<namespace>")` from `@/shared/locale/server-graphql` (optionally accepts a `locale?: string` parameter) to look up localized message templates. The legacy `getBackendTranslations` helper is deprecated and must not be used.
- **Conditional Aggregation**: When performing conditional aggregation (e.g., `CASE WHEN` with `SUM`/`COUNT`), Drizzle does not provide a native query builder DSL. Instead, use the `sql` template literal with generic typing (e.g., `sql<number>`) and chain `.mapWith(Number)` to cast returned values safely to JavaScript numbers. Avoid raw database-specific casts (like `CAST(... AS INTEGER)`) in SQL.
- **Type Definition Pattern**: Repository functions should use types defined in `backend/types/` (e.g., `{Entity}SelectType`, `{Entity}InsertType`) rather than directly referencing schema types. Define input/output types in the corresponding `backend/types/<subdir>/<entity>.types.ts` files using Drizzle's `$inferSelect` and `$inferInsert` types with custom transformations as needed.
- **Directory Role Filtering**: `resolveRoleCondition` in `staff-profile.repository.ts` maps `roleFilter` values to `ilike` patterns on `permission_groups.slug`. `"admin"` and `"manager"` both match `%admin%`; `"supervisor"` matches `%supervisor%`. See `docs/auth/manager-role-mapping.md`.
- **Guarded self-scope updates**: For recipient-owned mutations, fold ownership into the UPDATE predicate (`WHERE id = ? AND user_id = ?` with `RETURNING`) instead of read-then-check-then-write — a foreign or nonexistent id matches zero rows, indistinguishably. Precedent: `NotificationRepository.markReadOnce` (`backend/db/repo/notifications/notification.repository.ts`).

### Import Convention
- Consumers of repositories import from the top-level barrel: `import { TeacherRepository } from "@/backend/db/repo";` or via the `Repository` namespace. This keeps move/refactor churn contained to the barrel.
- Deep imports (`@/backend/db/repo/teachers/teacher.repository`) are also valid for cases that need a specific repo and want to avoid pulling in transitive side-effects; the top-level barrel is the recommended entry point.
- Within a `.repository.ts` file, use `@/` aliases for cross-layer dependencies (types, schema, sibling repositories) — relative imports only for siblings in the same sub-directory.

### File Organization
- Group related repositories for the same domain in the same sub-directory.
- File naming: `backend/db/repo/<subdir>/<entity>.repository.ts` (e.g. `backend/db/repo/teachers/teacher.repository.ts`).
- One `namespace` per repository file — the namespace name is the canonical export `{Entity}Repository`.
- Pre-existing nested sub-packages (`scheduling/scheduling-queries.repository/`, `utils/`) keep their internal structure; only the top-level `scheduling/index.ts` barrel is re-exported here.

### Adding New Repositories
1. Identify the matching sub-directory (or create a new one following the sub-directory convention).
2. Create `<entity>.repository.ts` in that sub-directory; expose a `export namespace <Entity>Repository { ... }`.
3. Add `export * from "./<entity>.repository";` to the sub-directory's `index.ts`.
4. If a new sub-directory was created, add the sub-directory re-export to the top-level `backend/db/repo/index.ts`.
5. Wired types live in `backend/types/<subdir>/<entity>.types.ts`; wired GraphQL exposure lives in `backend/graphql/pothos/<subdir>/`.

## Meeting Provider Tokens (`meeting_provider_tokens`)

- **Encrypted storage (CRITICAL)**: The `meeting_provider_tokens` table uses the `encryptedText` custom Drizzle type (from `backend/db/schema/custom-types`) for both `access_token` and `refresh_token` columns. The `MeetingProviderTokenRepository` (`backend/db/repo/meeting/meeting-provider-token.repository.ts`) handles encryption/decryption transparently — never write plaintext tokens to a side table or log them.
- **Unique constraint**: A unique index on `(userId, providerSlug)` ensures one token row per user per provider. Use `upsert` (not manual insert-or-update) to respect this constraint.
- **Reads via `queryDb(tx)`**: Non-transactional reads (`getByUserAndProvider`, `listByUser`, `listByProvider`) use `queryDb(tx)` per the Neon HTTP Client pattern. See `docs/drizzle/neon-http-client.md`.
- **Refresh-token rotation**: Zoom rotates refresh tokens on every exchange. After `refreshAccessToken` (`backend/services/meeting/integrations/token-refresh.ts`) succeeds, the service layer calls `upsert` with the rotated `refresh_token` value. Never assume the stored refresh token is still valid after a refresh.
- **Scope column**: Per-user OAuth tokens carry a `scope` text column for auditing which scopes were granted at consent time. adapters compare it against the required scope set and throw `InsufficientScopesError` when missing.
- See `docs/services/meeting-providers.md` for the complete adapter/factory pattern reference. *(doc file absent from this tree — pending the meeting-services ticket; see `ai/plans/dev3-002-shared-error-handling-response-contracts/deferred-items.md` BLT-03)*

## Append-Only Ledger Pattern (Quota)

The Quota System uses an **append-only ledger** pattern in `quota_ledger`. See `docs/billing/quota-system.md` for the full reference. Key repo-level rules:

### Write Pattern

- **Every quota mutation writes a ledger row + updates cache columns in the SAME transaction** (`tx`). No ledger entry without a cache update, no cache update without a ledger entry.
- **Idempotency first**: Before inserting a ledger row, check for existing entry with the same `idempotencyKey` (SHA-256). If found, return the existing row — do NOT insert a duplicate.
- **Cache columns are snapshot only**: `remaining`, `reservedClasses`, `usedThisPeriod` on `quotas` are denormalized snapshots. The ledger is always the authoritative source. Use `computeBalance` to reconstruct truth from ledger.

### idempotency Key Derivations

All keys follow the pattern `"quota-{operation}:{unique-segment}:..."` hashed with SHA-256. Helper functions in `quota.repository.ts`:
- `deriveGrantIdempotencyKey(quotaId)`
- `deriveRedeemIdempotencyKey(classInstanceId, quotaId)`
- `deriveReserveIdempotencyKey(recurringScheduleId, quotaId)`
- `deriveReleasePoolIdempotencyKey(classInstanceId, quotaId)`
- `deriveReleaseEarmarkIdempotencyKey(scheduleId, instanceId, quotaId)`
- `deriveExpireIdempotencyKey(quotaId, periodString)`

### FIFO Object Selection

`selectQuotaForBookingFIFO(studentId, tx?)`: filters ACTIVE quotas, sorts by priority DESC → validUntil ASC, returns the first with `remaining > 0`.

### Foreign Key Constraint

`quota_ledger.quotaId` → `quotas.id` uses `ON DELETE RESTRICT`. Hard-deleting a quota while ledger entries exist will fail. Use soft-delete (`deletedAt`) or archive ledger entries first.


## Billing Repository Factory (Duplication Elimination)

Billing repositories (supported-online-accounts, supported-mobile-wallets, supported-payment-links) share identical CRUD/list/deactivate/query structure. Use `makeBillingRepo<TRow, TSelect, TInsert, TUpdate, TFilters>()` from `shared/billingRepoFactory.ts`. Entity-specific insert defaults (e.g., `identifierLabel ?? name`) go in the `prepareInsert` hook — NOT in the factory. See `docs/backend/billing-repo-factory.md` for the complete pattern reference.

## Schema Helpers (Duplication Elimination)

Schema tables sharing identical column configurations (timestamps, slugs, active flags) or junction table patterns use helpers from `shared/columnHelpers.ts` and `shared/junctionTableHelper.ts`. See `docs/backend/schema-helpers.md` for the complete pattern reference.

## Linting Rules

- See `docs/quality/linting-rules.md` for Oxlint & ESLint/sonarjs fix recipes. NEVER use `oxlint-disable` comments.

## Broadcast Audience Resolution (`broadcast-audience.repository.ts`)

Cohort resolution for admin broadcasts: both tx and raw-SQL branches must stay semantically identical; exact-match (parameterized `eq`/`$1`) for country — never LIKE; the plan cohort applies `SELECT DISTINCT … ORDER BY id ASC` where the subscriptions join fans out; the governance predicate (deleted/blocked excluded, suspended INCLUDED) is invariant-pinned — do not "fix" it. Reference: `docs/notifications/broadcast-notifications.md` §2.
