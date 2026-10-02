# Post-fix-7 — R9 comment tokens (comment-only)

**Base for this wave:** feature tip `3f27a974` (restored into the working tree via `git checkout 3f27a974 -- .`; working tree had been left at base `5a8369fe` by the read-only R9 pass). No state-changing git commands beyond the sanctioned restore; no commits.

## Finding 1 — three delta-authored `REQ-` tags in `backend/graphql/test/schema-surface.test.ts`

| Line | Before | After |
|---|---|---|
| :69 | `…`password: String!`) — REQ-003.6's `{ password,` | `…`password: String!`) — the closed `{ password,` |
| :2301 | `// ONLY this pin keeps REQ-008's actor-table scope executable.` | `// ONLY this pin keeps the admin-only credential-rotation scope` / `// executable.` |
| :2328 | `// Closed two-member shape (REQ-003.6) — `passwordHash`, identity, and` | `// Closed two-member shape — `passwordHash`, identity, and` |

Each sentence stays complete and technically accurate without the tag (the `:2301` rewrite describes the scope's behavior domain-wise: admin-only credential rotation).

## Finding 2 — rewritten lines that preserved pre-existing artifact tokens

| File:line | Token | Fix |
|---|---|---|
| `backend/graphql/mutation/admin/admin-users.mutation.ts:5` | `REQ-060` | `* Contract (SDL + the credential surface):` |
| `backend/services/admin/user-management.service.ts:34` | `REQ-031` | `…legacy CRUD methods keep the relaxed variant, and the credential mutation uses the strict `assertActorAdminActive` gate.` |
| `backend/db/test/logic/auth/auth.service.test.ts:2` | `D2` | `* AuthService tests — `updateMyLocale` (the users.locale persistence vertical) + `changeMyPassword` (the self-service credential change).` |
| `frontend/graphql/sharedDocuments/auth/auth.documents.ts:51-52` | `R2-users-locale-b` | `…from a single `me` query (DASHBOARD-1) and the session user carries the forced-reset flag the `DashboardLayout` client redirect reads.` (external ticket ref `DASHBOARD-1` kept — sanctioned) |

Untouched lines elsewhere in the same files (e.g. `admin-users.mutation.ts:11` `D10`) were deliberately left as-is per wave rules.

## Bonus (informational)

`frontend/lib/auth/withPageAuth.ts` module summary docblock — added one sentence (3 wrapped lines): "Unless the page opts out via `allowMustChangePassword`, a caller flagged for a forced password reset is fenced to `/change-password` before the role check."

Total delta vs tip `3f27a974`: 6 files, +15/−13, comment-only. No new artifact references introduced.

## Verification

1. `bun tsgo` → exit 0, 0 errors.
2. `bun run lint` → exit 0, 0 problems.
3. `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` → **104 pass / 0 fail** (657 expect calls).
4. `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 on all 6 touched files.
5. Residual-artifact grep over `git diff 5a8369fe` for the 6 touched files: **0 occurrences on added lines** (`+`) for `REQ-0|REQ-1|Task [0-9]|Phase [0-9]|post-fix|.ai/plans` (and a broader `REQ-|D[0-9]|R[0-9]-users|…` sweep: 0). Only occurrences in the diff are removed lines (the old `REQ-060`/`REQ-031` sentences) and **1 pre-existing context line** (`D10` in `admin-users.mutation.ts:11`, untouched by the delta → left alone).

## Verdict

PASS — both R9 LOW findings closed; 8 artifact tokens stripped across 4 files (7 lines), bonus fence line added. Comment-only; behavior untouched.
