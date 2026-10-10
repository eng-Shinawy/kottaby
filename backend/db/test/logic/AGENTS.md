# Backend Database Logic Tests

## Purpose

This directory contains **business-logic** integration tests that run against a live PostgreSQL instance inside rolled-back transactions. Tests here verify cross-cutting behaviour that a single repository cannot capture on its own: state-machine transitions, security/RLS enforcement, concurrency & quota races, encryption/column constraints, audit/immutability guarantees, soft-delete integrity, and orchestration across multiple repositories + services.

Files are grouped by domain, mirroring the `backend/db/test/repo/`, `backend/db/repo/`, `backend/types/`, `backend/enum/`, `backend/graphql/`, and `backend/db/seeds/` sub-directory layouts.

## Layout

```
backend/db/test/logic/
├── AGENTS.md            (this file)
│
├── admin/               admin-user-governance, admin-user, platform-analytics repository logic
├── audit/               audit-census-drift, audit-immutability, audit-trail
├── auth/                auth.service (auth + refresh governance arms), registration.service
├── billing/             financial-immutability, plan-catalog (repository/schema/service/preservation),
│                        plan-seed, student-payment.repository, student-zero-lane,
│                        subscription (expiry / purchase-idempotency / repository)
├── classes/             session-schema-deltas, lesson.service (plan-gate), student-progress.service
├── invariants/          the state-machine invariant census: the 67-row doc↔census↔test registry
│                        (invariant-census.catalog.ts), the drift oracle (invariant-census-drift.test.ts),
│                        the shared savepoint/constraint/trigger probe helpers (invariant-probe.helpers.ts),
│                        plus the session and plan-catalog invariant suites
├── notifications/       broadcast-audience, broadcast, notification repository logic
├── shared/              cross-cutting integrity statics: data-integrity probe (users-delete-guard),
│                        retention-anti-drift census, schema-registry-census (pgEnum↔mirror parity)
├── students/            handshake-code-generation-locks, handshake-code-immutability-scan,
│                        student_status_history, student_status_transition
├── teachers/           applicant-lifecycle, applicants re-evaluation column contract
└── users/               user.repository
```

## Rules

All rules from the parent `backend/db/test/AGENTS.md` apply here — transaction rollbacks via `runInRollback`, `tx` passed to every repo method and Drizzle query, try/catch error helper instead of `expect(...).rejects.toThrow()`, `bun:test`, no `any`, no hardcoded error strings, always-create-test-data. The sub-directory layout and the conventions below are the only additions.

### Import Convention
- **Aliased imports for parent helpers** (preferred): `import { runInRollback } from "@/backend/db/test/test-utils";` and `import { setupTestEntities } from "@/backend/db/test/entity-setup";`. Aliased paths are unchanged by sub-directory moves, so prefer them over relative references.
- **Relative imports allowed**: `import { runInRollback } from "../../test-utils";` also works. If you use relative paths, remember that sub-directory files are **one level deeper** than the old flat layout — parent helpers are now at `../../entity-setup` and `../../test-utils`.
- Repository / service / type / schema / enum imports use the standard `@/` aliases: `import { TeacherRepository } from "@/backend/db/repo";`, `import { teachers, users } from "@/backend/db/schema";`, `import { TeacherBankingDetailsHistorySelectType } from "@/backend/types";`, `import { StudentStatus } from "@/backend/enum";`.
- Intra-domain sibling imports (rare in `test/logic/`) use relative paths: `import { testRepoError } from "./scheduling-test-helpers";`.

### File Organization
- Group related business-logic tests for the same domain in the matching sub-directory.
- File naming follows the existing convention (mixed `_` and `-` are tolerated for legacy file names): `backend/db/test/logic/<subdir>/<scenario>.test.ts`.
- The pre-existing `backend/db/test/repo/` directory holds repository **unit** tests (one repo per file); this `logic/` directory holds **cross-repo / cross-service** tests. Don't duplicate coverage between them.
- Domain-specific audit tests live in `audit/`. Permission/RLS and other cross-cutting tests that don't fit any single domain live in the sub-directory matching the table the test primarily asserts against.

### Adding New Tests
1. Identify the matching sub-directory (or create a new one following the sub-directory convention).
2. Create `<scenario>.test.ts` in that sub-directory.
3. No `index.ts` barrel is needed — test files are not imported by other code; the test runner discovers them by glob (`backend/db/test/logic/**/*.test.ts`). Sub-directories exist purely for organisation.
4. If a new sub-directory is created, document it in this `AGENTS.md` under **Layout**.
