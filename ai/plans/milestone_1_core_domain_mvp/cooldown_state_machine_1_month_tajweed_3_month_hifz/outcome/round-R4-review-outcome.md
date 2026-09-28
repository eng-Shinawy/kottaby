# Round R4 — Independent Review Outcome

> Reviewer: independent review-iteration subagent (R4) — no knowledge of prior rounds; judgment formed from `git diff 94160b9..HEAD` and the code alone.
> Scope: the plan's file cluster (enum + guard, types, repository, i18n leaf, service, GraphQL enum/field/mutation, SDL, unit/repo/service/wire/journey/SDL-frozen suites) — 29 changed files, +5057/−120.

## Verdict

**R4: 1 finding (fixed — 0 remaining)**

| # | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| 1 | LOW | `test/workflows/teachers/cooldown-state-machine.test.ts:65` | Stale header claim `TEST-FIRST (expected RED state)`: the docblock stated the admin legs are *still* expected to fail with `Cannot query field "adminExtendApplicantCooldown" on type "Mutation"` — but the mutation shipped (Task 6) and the suite runs green (12/12 verified this round). A CI triager reading the header could dismiss a genuine regression as the "expected RED". | **FIXED** — comment-only rewording to test-first *provenance* with an explicit "the FULL journey is green end-to-end: no step is expected to fail, and a red step is a genuine regression" statement. Sub-loop → 0; journey re-run 12 pass / 0 fail. |

No CRITICAL / HIGH / MEDIUM findings.

## Perspective 1 — review-types (type surface)

Evidence gathered:
- `backend/enum/teachers/applicant-cooldown-state.enum.ts` — real TS enum `{ None = "none", Active = "active", Expired = "expired" }` + fail-closed `isApplicantCooldownState` guard over a pre-allocated `ReadonlySet`; discipline mirrors `applicant-status.enum.ts` member-for-member. No pgEnum (D1 respected).
- Value-vs-type imports audited across the cluster: `applicant.types.ts` imports BOTH enums `import type` (type positions only, docblock documents why); value imports where members are used — service (`:54-55`), `enum.pothos.ts` (`:57`), `user-management.mappers.ts` (`:14-15`), schema-surface/journey tests. `tsgo` clean confirms the split.
- Barrels: `backend/enum/teachers/index.ts` re-exports the new enum; `backend/enum/index.ts` chains `./teachers`; `backend/types/teachers/index.ts` re-exports `./applicant.types` (so `ApplicantCooldownExtensionAudit` is reachable via `@/backend/types` — consumed by the service).
- Construction coherence: `ApplicantProfileReturnType` grew 7 → 8 fields (`cooldownState`); BOTH producers updated — `getMyApplicantProfile` (service) and `buildApplicantSnapshot` (admin mapper). `AdminUserDetailReturnType.applicant` reuses the canonical `ApplicantProfileReturnType` (`admin-user.types.ts:193`) — no duplicate shape invented.
- Pothos: exactly ONE registration (`ApplicantCooldownStatePothosEnum`, `enum.pothos.ts:132`) passing the enum OBJECT; wire names are the TS member names (`None/Active/Expired`), pinned by schema-surface + wire suites. No string-literal unions or hardcoded value arrays anywhere in `backend/graphql/pothos/`.
- Non-finding note: `isApplicantCooldownState` has no production consumer yet. It is plan-mandated canonical surface (the enum's runtime authority), fully tested, and no transport entry point exists where a raw state string arrives (the state is always server-derived via `deriveCooldownState`), so there is no missed integration — a sibling survey (`for f in backend/enum/*/*.enum.ts …`) shows it is currently the only guard without a prod consumer; recorded here for the forward ticket that consumes the state from a payload.

## Perspective 2 — review-backend (races, atomicity, discipline)

Evidence gathered:
- Guarded write: `extendCooldownOnce` is ONE UPDATE with the eligible pre-states folded into the WHERE (`inArray(status, [Pending, InEvaluation, Failed])`) — the predicate re-evaluates atomically at write time under row-lock serialization; a stale read can never replay an illegal extension. Required-tx signature (`tx: DBTransaction`, no standalone branch) — the write cannot escape the caller's atomic flow.
- Race table vs accepted semantics: extend-vs-finalize composes (both guarded predicates — service Tier-3 test); extend-vs-certification collapses onto typed `APPLICANT_ALREADY_CERTIFIED` via the guarded-write miss arm (chaos-probed with a repo stub AND raced via `Promise.allSettled`); extend-vs-extend is the accepted last-write-wins (documented design; both writes only ever set a server-computed instant). No locking read needed — the write predicate IS the guard (no TOCTOU window left open).
- Transaction atomicity: bounds → BFLA gate ordering aside, the write + audit row + post-write profile re-read all execute inside ONE `withTransaction(outerTx, …)` unit (savepoint on outer, top-level otherwise); the audit row shares the write's commit/rollback fate — the "audit-insert failure rolls the extension back" test locks it. The post-commit `logDomainError` fires strictly after `withTransaction` returns (cannot log an uncommitted event).
- Two-source split (REQ-006.2): `rg "users\.suspended|suspendedAt|suspendedPeriodDays"` over service + repo → ONLY the pre-existing docblock mention (`applicant-lifecycle.service.ts:19`, the documented absence) and the pre-existing `listDirectory` projection (`applicant.repository.ts:296`). Zero new-code mentions; zero governance-field writes; locked by `users.suspended === false` probes at repo, service, wire, and journey tiers.
- Dead code / unreachable throws: none. `EPOCH_PAST`, `MS_PER_DAY`, bounds constants, both `denyAlreadyCertified` arms (guard-read miss and guarded-write miss), and the fail-closed post-write re-read arm are all reachable and tested. The repo `extendCooldownOnce` has no throwing paths (null-miss signal only).
- i18n/logger/error discipline: `getServerTranslations(locale)` single-arg + property access everywhere in the new code (no two-arg calls repo-wide in the diff); domain rejections via `logger.logDomainError` with bounded `{ code, entity, entityId }` context; the bounds rejection is deliberately silent (pure input validation — asserted zero log calls); happy-path silence asserted; no `console.*` in the diff.
- Cross-layer imports: repo imports only drizzle/schema/enum/types (no service, no i18n, no logger — source-pinned by its own tests); service imports the canonical repo/service/helpers surfaces; the mutation file imports the pothos objects + shared guards. No cycles (`tsgo` + lint:type-aware clean).
- Observation (non-finding): the extension success path calls `getServerTranslations` twice (inline in the bounds-throw expression, then `const t = …`). `getTranslations` is a pure two-map lookup (`shared/locale/server.ts`) — zero correctness or measurable perf impact; recorded only.
- Mapper coherence win in scope: `buildApplicantSnapshot` previously hardcoded `cooldownActive: false` for admin detail; it now reads the boolean off the shared `deriveCooldownState` (Active ⇔ active) — the applicant and admin surfaces can no longer drift.
- Sub-loop `--lifecycle duplicates` → exit 0 on all 20 implementation/test files of the cluster (re-run this round).

## Perspective 3 — review-frontend (SDL integrity only)

- Re-ran `bun run generate:gqlSchema` in a scratch check → wrote `frontend/graphql/generated/schema.graphql` (61105 bytes) → `git status --porcelain frontend/` EMPTY and `git diff` on the file EMPTY: the committed SDL is byte-identical to a fresh regeneration. Nothing to revert; no mutation occurred.
- No frontend source files appear in `git diff 94160b9..HEAD --name-only` (only the generated artifact) — consistent with the plan shipping zero frontend code.
- Generated surface content spot-checked via the schema tests (not hand edits): `enum ApplicantCooldownState { Active Expired None }` wire names, `cooldownState: ApplicantCooldownState!` on `ApplicantProfile`, `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!`.

## Perspective 4 — pentester

Evidence gathered:
- Authorization chain (BFLA): wire layer `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` — the `$all` conjunction inlined verbatim (census-scanner classifiable; pinned by schema-surface + wire suites); anonymous → `UNAUTHORIZED` (both Apollo testClient and raw HTTP paths), teacher → `FORBIDDEN` with the generic scope copy and zero side effects — both BEFORE the resolver body. Resolver: `requireAdminUser(ctx)` narrow, then the service's defense-in-depth `assertActiveActorAdmin(actorId, …)` runs FIRST — anonymous / missing-row / non-admin / deleted / blocked / actively-suspended actors denied with zero writes and zero audit rows before any DB contact (ghost-actor service test proves neither write nor audit attempted).
- BOLA/BOPLA: the mutation is admin-root; the acting identity is sourced EXCLUSIVELY from `ctx.user.id` (3rd positional service arg) — no actor argument exists on the field; a smuggled `actorId` root arg dies `GRAPHQL_VALIDATION_FAILED` pre-resolver (wire-tested, audit count unchanged). `applicantId` is guarded by `requirePositiveIntId` (0 / negative / non-integer / >2^53 rejected pre-DB).
- Server-side bounds enforcement ORDER: BFLA gate → integer bounds [1, 3650] (`Number.isInteger` + min/max, module constants) → any applicant-row contact. The bounds denial wins over a missing applicant (tested with an absent id + `additionalDays: 0`), proving validation precedes the existence read.
- Mutation abuse: `additionalDays` is GraphQL `Int!` (floats/huge values die at schema validation); −5, 0, 3651 rejected server-side; 1 and 3650 accepted as boundary windows; the write takes `newExpiry = max(stored, now) + days` — a server-computed `Date`, never raw client arithmetic — so an extension can only lengthen, and repeats are the feature (last-write-wins accepted).
- SQL injection surface: `extendCooldownOnce` is fully parameterized (id, expiry instant, three enum members are bind values); static pins assert no `${` interpolation, no status string literals, no inline `--` comments in SQL templates, no `.prepare(` in the repo.
- Error-extension leakage: only `DomainError` subclasses cross the boundary carrying `extensions.code` + the static localized leaf copy (byte-equality asserted per locale in service + wire tests); no stack traces, ids-in-copy, or internal identifiers; `requirePositiveIntId`'s generic pre-existing message pattern is shared with the sibling governance mutations (pre-existing, not in scope as a new finding).
- Audit-trail forgeability: the details document is composed server-side (`composeCooldownExtensionAudit`) — field NAME, old/new ISO instants, requested day count; actorId is the verified session id; entity ids come from validated args; exactly ONE `adjust`/`applicant` row per extension inside the write's transaction (proven across repo/service/wire suites and the audit-completeness census, 19/19 green). No client channel can mint or attribute a row.
- i18n copy static-ness: `applicantCooldownExtensionInvalid` en/ar leaves are static sentences (bounds stated in-copy); the parity suite asserts ZERO ICU placeholders in BOTH locales; no identifiers in copy.
- No secrets/PII in generated artifacts; `PUBLIC_OPERATIONS` does not contain the new mutation (tested).

## Verification matrix (this round)

| Suite | Result |
|---|---|
| `bun tsgo` | clean (0 errors) |
| `bun run generate:gqlSchema` → `git diff` on schema.graphql | empty (byte-identical) |
| enum guard unit (`applicant-cooldown-state.enum.test.ts`) | 22 pass / 0 fail |
| locale parity (`errors-namespace.parity.test.ts`) | 50 pass / 0 fail |
| repo (`applicant.repository.test.ts`) | 17 pass / 0 fail |
| service (`applicant-lifecycle.service.test.ts`) | 56 pass / 0 fail |
| wire (`admin-applicant-cooldown.wire.test.ts`) | 12 pass / 0 fail |
| schema-surface | 93 pass / 0 fail |
| sdl-static-assertions | 57 pass / 0 fail |
| journey (`cooldown-state-machine.test.ts`) — re-run after fix | 12 pass / 0 fail |
| audit-completeness journey | 19 pass / 0 fail |
| sub-loop `--lifecycle duplicates` × 20 cluster files + the fixed journey file | exit 0 (all) |

Forbidden commands (`bun quality-gate`, `bun oxlint`, `bun lint:type-aware` standalone, `bun biome:check`) were not invoked; `lint:type-aware` ran only inside the sanctioned sub-loop.

## Files modified by R4

- `test/workflows/teachers/cooldown-state-machine.test.ts` — docblock-only fix for finding #1 (no assertion, fixture, or behavior change).

## Re-review after fix

The fix is comment-only; the affected suite (cooldown journey) was re-run green and the file's sub-loop passed. No other finding surfaces on re-review of the touched region. **R4: 1 finding (fixed — 0 remaining).**
