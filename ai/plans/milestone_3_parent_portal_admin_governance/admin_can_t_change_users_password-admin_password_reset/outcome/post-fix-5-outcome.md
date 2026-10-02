# Post-Fix 5 — R5 test-quality wave (test-only)

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Review target tip:** `187518a4` · Scope: the 3 LOW findings from `round-R5-review-outcome.md` (all test-quality pin gaps; zero shipped-code defects). **No production file touched; NO commits made** (orchestrator commits).

## Fixes (mirroring the in-file precedents exactly)

### R5-F1 — `adminSetUserPassword` SDL pins (`backend/graphql/test/schema-surface.test.ts`, +71)

New describe block `admin credential-rotation surface — adminSetUserPassword SDL pins`, placed directly after the sibling `admin-governance mutations — exact arg shapes + $all scope pins` block, with three tests mirroring the sibling pins:

1. **Exact-args pin** — `adminSetUserPassword` returns `AdminUserDetail!` with EXACTLY the two required args (`id: Int!`, `input: AdminSetUserPasswordInput!`), `field.args` length pinned to 2 (mirrors the `adminSetUserBlocked` args pin; BOPLA no-third-arg comment carried over).
2. **Scope pin** — the EXACT `$all: { authenticated: true, role: [UserRole.Admin] }` conjunction via the shared `authScopesSnapshot` helper, with the same `Reflect.get`-based no-cast `$all`/`role` unwrapping as the sibling `adminExtendApplicantCooldown` pin; the comment records WHY only this schema-layer pin is executable (the wire Tier-2 FORBIDDEN verdicts are satisfied by the service-layer `assertActorAdminActive` guard regardless — defense-in-depth masks the regression).
3. **Exact-2-member input pin** — `AdminSetUserPasswordInput` discloses EXACTLY `["mustChangePassword", "password"]` with `Boolean!`/`String!` (mirrors the self-service `ChangeMyPasswordInput` closed-shape pin; REQ-003.6).

Header docblock extended with the credential-rotation treatment sentence.

**Length/contiguity pins audit:** NONE affected — the additions are test-only; the surface-freeze quartet already enumerates `adminSetUserPassword` via `ADMIN_USER_USER_MUTATION_FIELDS` + `CREDENTIAL_INPUT_TYPE_NAMES`, and the 20-mutation admin-block contiguity pin already places it between `adminSetUserDeleted` and `adminSetUserSuspended`. All those pins re-ran green unchanged.

### R5-F2 — REAL listener glue + registration scan (`backend/graphql/test/password-change-gate.test.ts`, +236)

1. **Registration static scan** (added to the existing `plugin registration surface` describe, per the `user-governance.service.test.ts` withTransaction-census precedent): `readFileSync` over `APOLLO_SERVER_FILE_PATH` (`@/app/api/graphql/apollo-server.ts` → `process.cwd()` mapping) with the `stripComments` hygiene helper; pins (a) the `passwordChangeGate` import binding, (b) the trailing-comma invocation `createPasswordChangeGatePlugin(),` occurring EXACTLY once, (c) that invocation located INSIDE the `plugins: [...]` literal (between the array opening and its closing bracket).
2. **REAL listener glue describe** (`passwordChangeGate — REAL listener glue (requestDidStart → didResolveOperation)`): drives `createPasswordChangeGatePlugin()` → `requestDidStart(...)` → the returned listener's `didResolveOperation(...)` with a FULL `GraphQLRequestContextDidResolveOperation<Context>` literal — constructed with zero unsafe assertions (the no-`as` discipline is kept: complete production `Context` literal via the `parent-monitoring.helpers.test.ts` `baseUser` row-fixture precedent, `HeaderMap` from the `@apollo/server` root export, minimal `buildSchema` schema, no-op `Logger`/`KeyValueCache`/`CachePolicy` literals). Three live behaviors:
   - flagged user + non-allowlisted root (`adminUsersDirectory`) → the listener REJECTS with the ForbiddenError-family denial: `code` + `extensions.code` = `PASSWORD_CHANGE_REQUIRED`, `extensions` keys EXACTLY `["code", "http"]`, `http.status` 200, message = localized EN `passwordChangeRequired`, zero field/operation/path trigger detail;
   - un-flagged user + same gated root → listener resolves untouched (zero behavior change);
   - flagged user + allowlisted roots (`me`, `changeMyPassword`) → listener resolves untouched (escape hatches reachable).
   
   Docblock scope line + branch-matrix updated. The no-throw pins use direct `await` + lexically visible `expect(...).toBeUndefined()` (the repo's type-aware lint denies `await expect(...).resolves…` as await-of-non-Thenable, and no `.resolves.` precedent exists in backend tests).

### R5-F3 — shared-document lock (`frontend/graphql/test/auth/auth.test.ts` −46/+9 + `frontend/graphql/sharedDocuments/documents.contract.test.ts` +13)

1. **auth.test.ts**: the locally `parse`d `changeMyPasswordProbeDocument` (and its `ChangeMyPasswordWire` interface, plus the now-unused `parse`/`TypedDocumentNode` imports) is DELETED; all 4 probes run through the shared `changeMyPasswordMutationDocument` import (`auth.documents.ts:163`) — the exact TypedDocumentNode the production change-password form consumes (the `admin-users.integration.test.ts` convention). All assertions are byte-identical (UNAUTHORIZED, `CURRENT_PASSWORD_INVALID` + `extensions.fields`, happy-path flag echo + deep `passwordHash` zero-leak walk, old-denied/new-authorized persistence). The stale docblock ("the shared self-service credential document does not exist yet") is replaced with the shared-document rationale.
2. **documents.contract.test.ts** (the auth `DOCUMENT_CONTRACT_TABLE` — it already covers the auth documents `login`/`registerUser`/`updateMyLocale`/`refreshToken`/`logout`/`me`, so this is the SMALLEST-diff option; no new file created, admin table untouched): added the `ChangeMyPassword` row (`channel: "mutation"`, `variables: ["input"]`, `objectSelections: ["changeMyPassword"]` — id-first convention) after `UpdateMyLocale`, plus the `ChangeMyPasswordMutation`/`ChangeMyPasswordMutationVariables` type import and the compile-time typed-binding line in the "documents remain TypedDocumentNode-typed" proof, matching every other row's parity.

## Verification (all commands ≤240 s, logs under /tmp/rf5/, strays killed + `.next-test-dev/dev/lock` cleared before solo runs)

| # | Command | Result |
|---|---|---|
| 1 | `bun tsgo` | **exit 0, 0 errors** (run twice — before and after the final gate-test edit) |
| 2 | `bun run lint` | **exit 0, 0 problems** (run twice) |
| 3 | `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` | **104 pass / 0 fail** (470 ms; was 101 → +3 pins) |
| 4 | `bun run test/scripts/run-test.ts backend/graphql/test/password-change-gate.test.ts` | **38 pass / 0 fail** (134 ms; was 34 → +4 tests) |
| 5 | `bun run test/scripts/run-test.ts frontend/graphql/test/auth/auth.test.ts` (solo) | **14 pass / 0 fail** (8.58 s incl. server boot; 49 expect calls) |
| 6 | `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/documents.contract.test.ts` | **33 pass / 0 fail** (154 ms; was 32 → +1 row test) |
| 7 | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` × 4 touched files | **exit 0 on all four** (schema-surface, password-change-gate, auth.test.ts, documents.contract.test.ts) |

Initial sub-loop run on `password-change-gate.test.ts` failed with 3 `typescript(await-thenable)` type-aware lint errors (the `await expect(...).resolves` pattern); fixed by switching the no-throw pins to direct `await` + lexically visible `expect()` (also matches the suite's existing "lexically visible assertion" convention) — re-run green.

## Diff footprint vs `187518a4`

4 files, +329/−46 — **all test files**; zero production/source changes.

## Verdict

**All 3 R5 LOW findings fixed; 7/7 verification gates green.** The admin credential surface now carries the same exact-pin treatment as its self-service sibling; the gate's composition + registration seam has executable coverage (real listener driven end-to-end, no flagged-caller wire dependency); and the wire suite + the shared-document contract table now lock the exact TypedDocumentNode the production form sends.
