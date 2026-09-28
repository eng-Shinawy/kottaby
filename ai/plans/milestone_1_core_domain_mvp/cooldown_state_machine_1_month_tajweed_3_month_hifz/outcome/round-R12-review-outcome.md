# Round R12 Review Outcome — consecutive-zero confirmation round

- **Date:** 2026-06-01 (round R12)
- **Scope:** `git diff 94160b9..HEAD` — backend-only cooldown state machine plan (enum+guard, guarded repo UPDATE, service derivation/extension + BFLA gate + audit, admin GraphQL mutation, Pothos enum/field, i18n en/ar, generated SDL, tests).
- **Reviewer:** independent R12 subagent (no knowledge of prior rounds; judgment formed from the code alone).
- **Pre-review state:** worktree restored to HEAD (`69e291e`) after a reverted experimental change.

---

## STEP 1 — Restoration verification (all GREEN)

| Check | Result |
| --- | --- |
| `git status --porcelain` | Clean of source changes; only 5 pre-existing untracked plan outcome files (`round-R3/R7/R8/R10/R11-review-outcome.md`) — allowed |
| `bun tsgo` | 0 errors (exit 0) |
| `backend/services/teachers/applicant-lifecycle.service.test.ts` | **57 pass / 0 fail** (333 expects) |
| `backend/db/test/repo/teachers/applicant.repository.test.ts` | **17 pass / 0 fail** (56 expects) |
| `test/workflows/teachers/cooldown-state-machine.test.ts` | **12 pass / 0 fail** (264 expects) |
| `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | **12 pass / 0 fail** (54 expects) |

All four suites match their expected counts exactly. The restored state is green.

---

## STEP 2 — Independent review (R12), four adversarial perspectives

### Perspective 1 — review-types

Evidence gathered:
- `backend/enum/teachers/applicant-cooldown-state.enum.ts` — single real TS enum (`None|Active|Expired` over lowercase `none|active|expired`) + fail-closed `isApplicantCooldownState` guard over a pre-allocated `ReadonlySet`; re-exported exactly once via `backend/enum/teachers/index.ts`. rg sweep found NO duplicate enum/guard definitions anywhere in `backend/` or `test/`.
- Import coherence: `applicant.types.ts` uses `import type` for both enums (type-only positions; the in-file NOTE documents the Biome `useImportType` normalization and the value-import duty of runtime consumers). Runtime consumers hold their own value imports: the service (derivation), `enum.pothos.ts` (`gqlSchemaBuilder.enumType(ApplicantCooldownState, …)` registration), `user-management.mappers.ts` (`=== Active` comparison), and the schema-surface test.
- Construction coherence: `ApplicantProfileReturnType` gained required `cooldownState`; BOTH producers updated — `getMyApplicantProfile` (service) and `buildApplicantSnapshot` (admin mapper). `bun tsgo` 0 errors confirms closed-shape completeness.
- `deriveCooldownState` is single-sourced and consumed by exactly two surfaces; boolean↔enum equivalence verified: `state === Active` ⟺ `cooldownUntil !== null && cooldownUntil > now` (the strict-`>` boundary is shared, so no drift is possible; the service retains the original boolean expression byte-stably while the enum rides the same captured `now`, and the mapper derives the boolean FROM the enum — both orders are semantically identical).
- Bounds constants (`COOLDOWN_EXTENSION_MIN_DAYS = 1` / `MAX_DAYS = 3650`) follow the repo's module-private constant pattern (`SUSPENSION_PERIOD_MAX_DAYS` in `user-governance.helpers.ts`, `MAX_INTERVAL_DAYS` in `plan-catalog.helpers.ts`) — platform-wide 1..3650 window convention, no shared constant to alias.
- Non-finding note: `isApplicantCooldownState` has no production call site today (the state is always server-derived; no transport payload carries a cooldown-state string). It is the plan-mandated vocabulary guard shipping with the enum per the `applicant-status.enum.ts` mirror discipline, fully exercised by its own 22-test 4-tier suite. Not dead code in the plan's scope; recorded for the first future parse site.

No type findings.

### Perspective 2 — review-backend

Evidence gathered:
- Races/TOCTOU: the guard read and the guarded `extendCooldownOnce` UPDATE sit in ONE `withTransaction`; the UPDATE re-folds the eligible pre-states (`pending|in_evaluation|failed`) into the WHERE predicate so a concurrent certification collapses onto the typed `APPLICANT_ALREADY_CERTIFIED` denial (zero-row miss) instead of an illegal extension. The known concurrent-admin-extension last-write-wins on `cooldown_until` is the ACCEPTED, ledgered design (plan §6 + deferred-items D4; `FOR UPDATE` variant explicitly deferred to a future hardening ticket) — **not re-reported** per the binding design context.
- Transaction atomicity: guard read + guarded write + exactly ONE `AuditService.createAuditLog` row + post-write profile re-read all commit or roll back together. The BFLA gate (`assertActiveActorAdmin`) runs BEFORE the transaction opens — denials perform zero writes and mint zero audit rows (JR-C-1 invariant holds).
- Dead code: none on the production path — `EPOCH_PAST`, `MS_PER_DAY`, both bounds constants, `denyAlreadyCertified` (both certified arms), and `composeCooldownExtensionAudit` are all consumed. The guard deferral is the only unused export and is plan-mandated (see Perspective 1 note).
- Cross-layer imports: `user-management.mappers.ts` (admin service) → `deriveCooldownState` (teachers service) is a service→service import with in-repo precedent (`classes` → `notifications` services). No repo→service reverse import; the repo stays data-access only (its own tests pin "no i18n, no logger, no console").
- Error/logger/i18n discipline: every user-facing string resolves via `getServerTranslations(locale)` (`applicantCooldownExtensionInvalid` / `applicantNotFound` / `applicantAlreadyCertified`); log contexts carry entity ids + ISO instants + day counts only — never PII; the post-commit extension event carries the machine-readable `code` member per the universal `DomainErrorContext` convention (open index-signature type, tsgo-clean) and is documented in the service header's logging discipline block.
- Comment hygiene: diff scan of all non-md files found zero `console.*`, zero plan-artifact references (no `R*`, `tasks.md`, `deferred-items`, `plan §`, task ids); the only `§` ref cites the real `docs/teachers/applicant-lifecycle.md` (exists on disk), and `docs/drizzle/prepared-statements.md` also exists.

No backend findings.

### Perspective 3 — review-frontend (generated-SDL integrity)

- `bun run generate:gqlSchema` re-printed the Pothos schema → `frontend/graphql/generated/schema.graphql` **byte-identical** (61,105 bytes; `git diff` empty, `git status` clean — nothing to revert).
- `bun run codegen` (typed-document-node operations) also produced **zero drift** in `frontend/graphql/generated/gql/graphql.ts`.
- The generated SDL carries exactly the plan surface: `enum ApplicantCooldownState { Active Expired None }`, `ApplicantProfile.cooldownState: ApplicantCooldownState!`, `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!` — pinned by `schema-surface.test.ts` (93/0) and `sdl-static-assertions.test.ts` (57/0, refreshed 53-op baseline with documented one-time re-anchor).

No SDL-integrity findings.

### Perspective 4 — pentester

- Authz chain (defense in depth, verified end-to-end): (1) `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` inlined exactly like the sibling governance mutations in the same file (documented reason: static classification by the audit census drift scanner); (2) `requireAdminUser(ctx)` — the acting identity is `ctx.user.id`, session-derived; there is NO client-supplied actor argument (wire test proves a smuggled `actorId` arg dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver); (3) `assertActiveActorAdmin` strict governance gate (deleted → blocked → actively-suspended) runs before bounds validation and before any DB contact.
- BOLA/IDOR: admin-governance write targeting any applicant is the surface's design; the target id passes `requirePositiveIntId` (positive safe integer) before the service; the self profile query remains resolver-derived-only. No new user-reachable read of another user's applicant state.
- Injection: all SQL parameterized (Drizzle bound values; the guarded UPDATE binds id, expiry, and status members); audit `details` is `JSON.stringify` over scalars with `truncateDetailsSafely` (≤2000) at the writer. No interpolation anywhere in the new path.
- Leakage: audit payload = field NAME + ISO from/to instants + day count (no contact PII, credentials, tokens); log contexts = ids + instants; localized denial copy states only the 1..3650 bounds (parity-pinned as ICU-placeholder-free in both locales); the no-oracle `null` profile answer is unchanged.
- Abuse: `additionalDays` integer-bounded [1, 3650] admin-only; extension strictly lengthens (`max(stored, now) + days`); exactly ONE audit row per committed extension; failed extensions commit nothing.
- Two-source split: the cooldown write touches ONLY `applicants.cooldown_until` (+ `updated_at`) and `audit_logs`; `users.suspended*` / governance fields are never written from this module (the `users` table is not imported into the lifecycle service; the actor gate's read-only governance columns are the pre-existing shared guard).

No security findings.

---

## Corroborating test evidence (beyond the four mandated suites)

| Suite | Result |
| --- | --- |
| `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | 22 / 0 |
| `backend/graphql/test/schema-surface.test.ts` | 93 / 0 |
| `backend/graphql/test/sdl-static-assertions.test.ts` | 57 / 0 |
| `shared/locale/errors-namespace.parity.test.ts` | 50 / 0 |
| `shared/locale/adminUsers-namespace.parity.test.ts` | 67 / 0 |
| `test/workflows/admin/audit-completeness.journey.test.ts` | 19 / 0 |
| `backend/services/admin/user-management.service.test.ts` | 61 / 0 |

Per-file `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → **0** on all six core implementation files: enum, repository, lifecycle service, admin-governance mutation, applicant Pothos object, user-management mappers.

## Files modified by R12

**None** — zero findings, zero fixes. The SDL/codegen regeneration runs were byte-identical (working tree returned to its restored state; nothing reverted, nothing committed).

## Pre-existing / out-of-scope notes (NOT findings)

- `isApplicantCooldownState` production-unused — plan-mandated guard shipped with the enum per the mirror discipline (documented deferral; resurfaces only as a knip unused-export flag until a parse site lands).
- Concurrent-admin-extension last-write-wins — ACCEPTED ledgered design (plan §6 / D4); `FOR UPDATE` variant deferred to a future hardening ticket. Not re-reported.

---

## Verdict

**R12: 0 findings** — consecutive-zero confirmed. The restored HEAD state is green (tsgo + all four mandated suites at expected counts), and the independent four-perspective review found nothing new to fix.
