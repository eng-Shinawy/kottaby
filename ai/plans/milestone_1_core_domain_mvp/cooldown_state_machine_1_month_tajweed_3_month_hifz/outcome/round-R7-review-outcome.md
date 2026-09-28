# Round R7 — Independent Review Outcome (OPERATIONAL & RUNTIME BEHAVIOR focus)

Scope: `git diff 94160b9..HEAD` (backend cooldown state-machine cluster: TS enum + guard, guarded repo UPDATE, service derivation/extension + BFLA gate + audit, admin GraphQL mutation, Pothos enum/field, i18n en/ar, generated SDL, tests). No prior-round outcome files were read.

Environment constraint honored: `bun tsgo`, per-file `sub-loop --lifecycle duplicates`, targeted `run-test.ts`, git/rg only. No `quality-gate`/`oxlint`/`biome:check`/`lint:type-aware` whole-repo runs were invoked directly (the per-file sub-loop reports them per file).

---

## Perspective 1 — review-types (standard sweep)

Evidence:
- `bun tsgo --noEmit` (project-wide, locked runner): **0 errors**.
- Per-file sub-loop (`--lifecycle duplicates`) on all 7 production files — `applicant-cooldown-state.enum.ts`, `applicant.repository.ts`, `applicant-lifecycle.service.ts`, `admin-governance.mutation.ts`, `applicant.pothos.ts`, `shared/enum.pothos.ts`, `applicant.types.ts`, `user-management.mappers.ts`: tsgo / oxlint / biome:check / lint:type-aware / duplicates all ✅.
- `ApplicantProfileReturnType` extended with `cooldownState: ApplicantCooldownState`; `AdminUserDetailReturnType["applicant"]` composes `ApplicantProfileReturnType` (never re-declared), so the admin mapper's new snapshot fields are type-checked against the one canonical shape (`backend/types/admin/admin-user.types.ts:193`).
- `ApplicantCooldownExtensionAudit` is a closed 4-field readonly contract (`field`/`from`/`to`/`additionalDays`); both consumers (service composer, tests) pin it exactly.
- `isApplicantCooldownState` has no production call site today (the state is server-derived, never accepted as transport input) — it is the plan-mandated vocabulary guard, fully tested in `applicant-cooldown-state.enum.test.ts` (22 pass incl. null-proto / BOM / control-char / ReDoS-shaped hostility).

No type-level findings.

## Perspective 2 — review-backend (standard sweep + OPERATIONAL focus)

(a) Connection/tx hygiene — every path closed:
- `extendApplicantCooldown` (service.ts:434–534): `assertActiveActorAdmin` and the bounds check run BEFORE any transaction opens → denials open zero connections. Inside `withTransaction(outerTx, …)`: every failure arm (missing row, certified guard, guarded-write miss, audit insert error, post-write profile miss) throws through the helper → drizzle rolls back (top-level tx) or rolls back to savepoint (outerTx path) and rethrows; success commits. No manual client checkout, no leaked executor.
- Nested-tx semantics of the optional `outerTx` (FINAL param): `withTransaction` routes to `outerTx.transaction(fn)` → drizzle SAVEPOINT; a rejection leaves the outer tx usable. Verified at runtime by the service suite's concurrency probes, including the harness note that a savepoint-scoped rejection in the single-connection probe swallows the interleaved write with it (production shape = distinct connections).
- Repo write `extendCooldownOnce` is tx-REQUIRED (no standalone branch) — the expiry commits with the admin transaction or not at all.

(b) Time handling — captured-now discipline:
- One `new Date()` per derivation site: `getMyApplicantProfile` (service.ts:270), `assertCanPurchaseVerification` (service.ts:333), the extension math (service.ts:486). `cooldownActive` and `cooldownState` ride the SAME instant (service.ts:271–275); the admin mapper derives both observables from one captured `now` via the shared `deriveCooldownState` (mappers.ts:133–137).
- Multi-clock contradiction analysis inside ONE extension: now₁ (actor-suspension check) < now₂ (base selection) < now₃ (post-write profile read). The returned profile's instant is ≥ now₂ + 1 day, so now₃ can never flip the derived state to Expired within the operation — no contradictory state/audit is reachable. Audit `from`/`to` are the exact pre-read stored instant and the exact written instant.
- `EPOCH_PAST` sentinel is a fixed module constant, only read via `getTime()`; `Math.max(base, now) + days` is lengthen-only, overflow-safe at the 3650-day ceiling (≈10y), and agrees with the strict-`>` boundary (an expiry exactly at the captured instant re-arms from `now`).

(c) Pool/lock behavior under the concurrent probes:
- Two probes in `applicant-lifecycle.service.test.ts` (lines 1235, 1268): extension vs rubric-finalize (both guarded predicates compose, exactly ONE audit row) and extension vs certification (guarded UPDATE re-evaluates status under the row lock → typed `APPLICANT_ALREADY_CERTIFIED` conflict or legitimate supersede, never an illegal extension). Both pass.
- Guarded UPDATE + `inArray` status pre-states rely on row-lock serialization + EvalPlanQual re-check under READ COMMITTED — correct; no deadlock surface (single row lock, then audit INSERT).

(d) Logging payload hygiene:
- All new `logger.logDomainError` calls carry ids / codes / locale / ISO instants only — no email, name, phone, IP, or token. Post-commit event `APPLICANT_COOLDOWN_EXTENDED` (service.ts:526) is payload-pinned by the service suite (message + ctxArg toMatchObject). No `console.*` anywhere in the added code.

(e) DB-clock vs app-clock mixed-clock audit:
- Cooldown instants are app-clock end-to-end: derived in the service, bound as a parameter, read back as `Date`, compared against app `new Date()`. DB `sql`now()`` is used ONLY for `updated_at` / `last_attempt_at` bookkeeping columns, which no code path compares against app time — no mixed-clock inconsistency exists in any single operation.

No backend findings.

## Perspective 3 — review-frontend (generated-SDL integrity)

- `bun run generate:gqlSchema` → wrote `frontend/graphql/generated/schema.graphql`; `git diff` on the file is **empty** (byte-identical regeneration; prior copy verified via /tmp snapshot).
- Beyond the stated minimum, also ran `bun run codegen`: `frontend/graphql/generated/gql/graphql.ts` regenerated **byte-identical** (`git status --porcelain frontend/graphql/generated/` clean) — no frontend document consumes the new surface yet, so typed-output drift is structurally impossible and empirically absent.
- Working tree after verification: clean (one pre-existing untracked `round-R3-review-outcome.md` from another iteration, untouched).

No frontend findings.

## Perspective 4 — pentester (authz chain, BOLA, injection, leakage, abuse)

- Auth chain: `authScopes: { $all: { authenticated: true, role: [Admin] } }` (ANY-vs-ALL trap avoided) → `requireAdminUser` belt → service re-runs `assertActiveActorAdmin` (deleted → blocked → actively-suspended, deterministic order) as defense-in-depth. Anonymous = 401, non-admin = 403, both pre-resolver with zero writes — pinned over real HTTP by the wire suite (12 pass).
- BOLA/BOPLA: actor identity sourced exclusively from `ctx.user.id`; no actor argument exists on the field — a smuggled `actorId` arg dies as `GRAPHQL_VALIDATION_FAILED` pre-resolver (wire test). `applicantId` is a legitimate admin-target selector, guarded `requirePositiveIntId`.
- Injection: every statement parameterized (id / instants / enum members bound); search paths untouched. No prepared statements on writes (repo policy).
- Leakage: audit `details` = field NAME + ISO instants + day count only; denial copy is static localized sentences (ICU-placeholder-free, pinned by parity tests); absent-id vs missing-profile both collapse to `APPLICANT_NOT_FOUND` on an admin-only surface.
- Abuse: bounds `Number.isInteger ∈ [1, 3650]` (0, −5, 3651, fractional all rejected pre-DB, pinned); every accepted extension appends exactly ONE `adjust` audit row sharing the write's commit fate; no notification fan-out; `users` governance columns provably untouched (two-source split asserted directly against the table in both suites).
- Import-direction safety: admin mappers import the teachers service directly (no barrel cycle); acyclic, tsgo-verified.

No pentest findings.

## Test execution ledger (all green)

| Suite | Result |
|---|---|
| `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | 22 pass / 0 fail |
| `shared/locale/errors-namespace.parity.test.ts` | 50 pass / 0 fail |
| `shared/locale/adminUsers-namespace.parity.test.ts` | 67 pass / 0 fail |
| `backend/graphql/test/schema-surface.test.ts` | 93 pass / 0 fail |
| `backend/graphql/test/sdl-static-assertions.test.ts` | 57 pass / 0 fail |
| `backend/services/teachers/applicant-lifecycle.service.test.ts` | 57 pass / 0 fail |
| `backend/db/test/repo/teachers/applicant.repository.test.ts` | 17 pass / 0 fail |
| `backend/graphql/test/admin-applicant-cooldown.wire.test.ts` | 12 pass / 0 fail |
| `test/workflows/teachers/cooldown-state-machine.test.ts` | 12 pass / 0 fail |
| `test/workflows/admin/audit-completeness.journey.test.ts` | 19 pass / 0 fail |
| `frontend/views/admin/audit/audit-trail-filters.entityType.test.ts` | 8 pass / 0 fail |

Hygiene greps over the changed code files: zero `console.*`, zero plan-artifact references (`REQ-\d`, `tasks.md`, `milestone_1…`, round tokens), zero `Translation.` / two-arg `getTranslations` in code (only hits are test pins asserting their absence and generic-prose "the plan" in a harness-rules comment).

## Findings

None. (Informational notes, not defects: (1) the "post-commit" domain event fires after savepoint return on the test-only `outerTx` path — production never passes `outerTx`, and the wording matches the production commit semantics; (2) a mid-transaction hard delete of the target user would collapse onto `APPLICANT_ALREADY_CERTIFIED` rather than `APPLICANT_NOT_FOUND` — a documented fail-closed collapse of the guarded-write miss, unreachable via any wired surface.)

## Verdict

**R7: 0 findings**

Code changes made this round: none (zero-fix round; verification only).
