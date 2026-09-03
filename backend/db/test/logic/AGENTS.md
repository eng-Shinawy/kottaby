# Backend Database Logic Tests

## Purpose

This directory contains **business-logic** integration tests that run against a live PostgreSQL instance inside rolled-back transactions. Tests here verify cross-cutting behaviour that a single repository cannot capture on its own: state-machine transitions, security/RLS enforcement, concurrency & quota races, encryption/column constraints, audit/immutability guarantees, soft-delete integrity, and orchestration across multiple repositories + services.

Files are grouped by domain, mirroring the `backend/db/test/repo/`, `backend/db/repo/`, `backend/types/`, `backend/enum/`, `backend/graphql/`, and `backend/db/seeds/` sub-directory layouts.

## Layout

```
backend/db/test/logic/
├── AGENTS.md            (this file)
│
├── shared/              cross-cutting infra + integrity tests
│                        audit-immutability, audit-trail, cache_split_routing, concurrency,
│                        column-encryption, hours-recalc, ip-format, poly-integrity, rls,
│                        soft_delete_security, session-scalability, permissions_rls
├── auth/                auth-rate-limit, auth_rate_limit_enforcement, impersonation-sessions, password-reset-token
├── classes/             session-schema-deltas (session domain: held_balance_lane column +
│                        session_request_idempotency claim-table constraints)
├── parents/             parent_directory
├── students/            student-pagination-stability, student_progress, student_status_history, student_status_transition
├── teachers/           teacher_availability, teacher_banking_history, teacher_banking_verification, teacher_profile
├── scheduling/          class_instances_overlap, class_instances_security, class_quota_race, class_rescheduling,
│                        class_teacher_integrity, leave_quota, scheduling_security
├── billing/             billing-safeguards, exchange-rate, invoice-restriction, payment-idempotency
├── notifications/       notification_delivery_tracking, notification_preferences
├── audit/               audit-immutability, audit-trail           (audit-domain logic tests; shared/* holds cross-cutting ones)
├── timezone/            timezone_dst, timezone_validation
└── permissions/         permissions_rls, permission-management.service.test
```

## Rules

All rules from the parent `backend/db/test/AGENTS.md` apply here (transaction rollbacks, `runInRollback`, try/catch error helper pattern, `bun:test`, no `any`, no hardcoded error strings). The sub-directory layout is the only addition; rules are restated for convenience.

### Mandatory Test Patterns
- **`runInRollback`**: Every database test MUST run inside `runInRollback` (imported from `@/backend/db/test/test-utils` or `../../test-utils`). Pass the `tx` instance to **every** repository method AND Drizzle query — mixing `tx` queries with `db`-backed repo calls causes deadlocks.
- **No `expect(...).rejects.toThrow()` inside `runInRollback`** — use a try/catch helper (e.g. `expectRepoError` / `expectRepositoryError`) and assert on `.toContain()` with a translated-message substring, not the raw translation key.
- **Clean Setup Helpers**: Use helpers from `@/backend/db/test/entity-setup` (or `../../entity-setup`) — `createTestUser`, `createTestTeacher`, `setupTestEntities`, etc. Generate unique emails / IDs via `randomUUID()` or prefixed strings to avoid unique-constraint violations.
- **Bun Test**: Use `import { describe, test, it, expect, beforeAll, afterAll } from "bun:test"` — never Jest/Vitest.
- **Strict Type Safety**: No `as any` overrides. No `console.log` — use `testLogger` or no logging.
- **Code Cleanliness**: Run `bun tsgo` and lint via the queue client after creating or modifying tests (`curl -s -X POST http://localhost:${LINT_QUEUE_PORT}/lint -H "Content-Type: application/json" -d '{"id":"db-logic","files":["<file>"]}'`). Fix all resulting TS6133 unused-import / unused-variable errors.

### Import Convention
- **Aliased imports for parent helpers** (preferred): `import { runInRollback } from "@/backend/db/test/test-utils";` and `import { setupTestEntities } from "@/backend/db/test/entity-setup";`. Aliased paths are unchanged by sub-directory moves, so prefer them over relative references.
- **Relative imports allowed**: `import { runInRollback } from "../../test-utils";` also works. If you use relative paths, remember that sub-directory files are **one level deeper** than the old flat layout — parent helpers are now at `../../entity-setup` and `../../test-utils`.
- Respository / service / type / schema / enum imports use the standard `@/` aliases: `import { TeacherRepository } from "@/backend/db/repo";`, `import { teachers, users } from "@/backend/db/schema";`, `import { TeacherBankingDetailsHistorySelectType } from "@/backend/types";`, `import { StudentStatus } from "@/backend/enum";`.
- Intra-domain sibling imports (rare in `test/logic/`) use relative paths: `import { testRepoError } from "./scheduling-test-helpers";`.

### File Organization
- Group related business-logic tests for the same domain in the matching sub-directory.
- File naming follows the existing convention (mixed `_` and `-` are tolerated for legacy file names): `backend/db/test/logic/<subdir>/<scenario>.test.ts` (e.g. `backend/db/test/logic/scheduling/class_quota_race.test.ts`).
- The pre-existing `backend/db/test/repo/` directory holds repository **unit** tests (one repo per file); this `logic/` directory holds **cross-repo / cross-service** tests. Don't duplicate coverage between them.
- Cross-cutting tests that don't fit any single domain (RLS, cache routing, encryption, concurrency, audit immutability across tables) live in `shared/`. Domain-specific audit tests live in `audit/`. Domain-specific permission RLS tests can live either in `permissions/` (permission-table-centred) or in the relevant domain subdir (e.g. `scheduling/scheduling_security.test.ts`) — both are acceptable; pick the one that matches the table the test primarily asserts against.

### Adding New Tests
1. Identify the matching sub-directory (or create a new one following the sub-directory convention).
2. Create `<scenario>.test.ts` in that sub-directory.
3. No `index.ts` barrel is needed — test files are not imported by other code; the test runner discovers them by glob (`backend/db/test/logic/**/*.test.ts`). Sub-directories exist purely for organisation.
4. If a new sub-directory is created, document it in this `AGENTS.md` under **Layout**.
5. Follow the verification loop: `bun tsgo` + `bun biome:check` + lint queue client for new/modified test files before considering the test done.

## Linting Rules

- See `docs/quality/linting-rules.md` for Oxlint & ESLint/sonarjs fix recipes. NEVER use `oxlint-disable` comments.

