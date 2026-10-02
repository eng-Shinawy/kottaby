
## R5-fix — canonical sentinel dedup (`backend/services/admin/user-management.helpers.test.ts:88`)

**Choice: IMPORT (deep `@/test/workflows/helpers/journey-actor-fixtures`), not a pinned comment.**

Evidence / decision trail:
- Canonical export verified: `test/workflows/helpers/journey-actor-fixtures.ts:62` → `export const ANONYMOUS_ACTOR_ID = 0;` (numeric literal-`0` sentinel — same name, same type as the local it replaces).
- `.agents/instructions/tests.instructions.md` (applyTo `**/*.test.ts, …`) contains NO rule forbidding `@/test/…` imports for backend service tests. Its only cross-tree import bans target GraphQL integration tests ("NEVER import backend repos, Drizzle schemas, or services") and a specific i18n call (`getServerTranslations` direct use) — neither applies to a named const from a test-helper module.
- Repo precedent backs the deep `@/` import style for tests ("deep `@/test/helpers/db-cleanup` import (barrel pulls Apollo into backend graphs)" — outcome/4-outcome.md), and `test/workflows/auth/registration-phone.journey.test.ts:92-95` imports the sentinel as `import { ANONYMOUS_ACTOR_ID, type JourneyActor, provisionAdminActor, … } from "@/test/workflows/helpers/journey-actor-fixtures"` — mirrored (named import, deep path).

Diff summary (assertions untouched):
- + `import { ANONYMOUS_ACTOR_ID } from "@/test/workflows/helpers/journey-actor-fixtures";` (line 77, after the `@/shared/locale/server-graphql` import — sorted order preserved).
- − local `/** Sentinel … */ const ANONYMOUS_ACTOR_ID = 0;` (former lines 87-88; duplicate of the canonical sentinel).
- Sibling backend suites (`user-management.chaos.test.ts:96`, `user-governance.service.test.ts:104`, `shared/directory-test.helpers.ts:33`) carry the same local sentinel — deduping them is out of R5-fix scope (single, tiny, file-scoped fix).

Verification:
1. `bun run scripts/health/sub-loop.ts backend/services/admin/user-management.helpers.test.ts --lifecycle duplicates` → exit 0.
2. `bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts` →  28 pass  0 fail Ran 28 tests across 1 file. [718.00ms]  (exit 0).

## Round R5 full record
Findings: (1) LOW PHONE_E164_PATTERN no production consumer → folded into deferred-items 📋 D-10 (plan-mandated export; schema-internal use; #230 hand-off). (2) LOW ANONYMOUS_ACTOR_ID local duplicate → FIXED (canonical import from test/workflows/helpers/journey-actor-fixtures; 28/28 green).
Lens verdicts: test-quality PASS · flaky-pattern PASS · assertion-vs-docs PASS · cross-layer/dead-code/echo PASS (2 LOW resolved above)
