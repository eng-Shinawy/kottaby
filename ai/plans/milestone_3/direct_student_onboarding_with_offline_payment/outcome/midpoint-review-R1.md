# Mid-Point Review Gate — Task 2.5 (R1)

Shared findings file for the mid-point review of plan `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`.
Scope baseline: commit `9fb2be3` → feature HEAD `64f9977` (`feat/direct_student_onboarding_with_offline_payment`).
Each wave appends its section below.

---

## review-backend wave

**Reviewer:** review-backend subagent (Task 2.5-backend) · **Date:** 2026-09-22 · **Branch:** `feat/direct_student_onboarding_with_offline_payment` @ `64f9977` (working tree clean; full branch delta vs `9fb2be3` = exactly the 5 in-scope code files + plan bookkeeping — `backend/db/schema/**` untouched, zero drift ✓)

**Environment note (coordination):** the sandbox auto-reverts the main worktree HEAD to `main` within seconds of any `git checkout` (reflog shows each flip-back). Review was executed in a detached worktree at `/home/z/review-backend-wt` (checked out from the same commit `64f9977`, `node_modules`/`.env.test` symlinked). Other waves hitting the same behavior should do the same instead of fighting the main worktree.

### Scope reviewed

- `backend/services/admin/student-onboarding.service.ts` (CREATE, 384 ln)
- `backend/services/admin/student-onboarding.helpers.ts` (CREATE, 180 ln)
- `backend/services/admin/index.ts` (+1 barrel line)
- `backend/db/repo/parents/parent.repository.ts` (findById — note: landed in baseline `9fb2be3` itself, zero delta in `64f9977`; current state reviewed)
- `test/workflows/admin/direct-student-onboarding.journey.test.ts` (delta = 5-line convergence adjustment only)
- Instruction set: `.agents/instructions/backend.instructions.md`, `backend/AGENTS.md`, `backend/services/AGENTS.md`, `backend/db/repo/AGENTS.md`; plan §1.3 (D1–D13), §3.3, §4.2, §4.5, §4.6; outcomes 0.2 / 2.1 (§8 contract) / 2.4.

### Findings table

| # | Severity | File:line | Description | Status |
|---|---|---|---|---|
| R1 | LOW (observation) | `backend/services/admin/student-onboarding.service.ts:309-314` | Plan §4.5 step 2's advisory parenthetical ("cheap pre-shape identity checks keep denials pre-DB") is not implemented — identity-field validation is fully delegated to `createUser`'s `validateCreateInput` (`user-management.service.ts:287`), which runs inside the composed transaction but BEFORE the first write, so a validation denial rolls back an empty transaction: the normative invariant (zero write, zero audit, zero residue) holds. Duplicating the checks would fork the validation single-source-of-truth the instructions mandate. | not-a-finding (advisory only; invariant re-verified) |
| R2 | INFO (citation drift) | `backend/services/admin/student-onboarding.service.ts:71` | Plan §4.4 names `subscriptionCreditLaneOf` (`subscription-activation-credit.helpers.ts:57`) as the safe lane primitive, but that function is module-private (not exported). Implementation uses the exported, behaviorally-equivalent fail-closed mapper `subscriptionCreditLaneMemberOf` (`subscription-admin.helpers.ts:491` — closed-vocabulary lookup over `Object.values(SubscriptionCreditLane)`, loud abort otherwise). Parity confirmed; no behavior divergence. | not-a-finding (plan citation drift) |
| R3 | INFO | `backend/db/repo/parents/parent.repository.ts:48-67` | The `findById` delta was already part of baseline `9fb2be3` ("parent repo seam"), so `64f9977` carries zero delta for this file. Current state reviewed: optional-tx Drizzle select + bare-read fallback via `queryDb` with parameterized SQL (bare-reads rule, `backend/AGENTS.md` §3), data-access-only, no hardcoded user-facing error strings, no business logic. | not-a-finding |

**Fix-requiring findings: 0** (0 critical / 0 high / 0 medium / 0 low-fix). No in-file fixes were applied; the audited byte-state is identical to the state the 2.4 gates certified.

### Review axes — results (all PASS, cited)

- **TOCTOU / D11 in-tx authoritative plan re-read** — IMPLEMENTED per plan: `resolveInTxPlan` re-reads the plan through `PlanRepository.findById(planId, tx)` inside `withTransaction` and re-asserts `assertOnboardablePlan` against the tx snapshot (`student-onboarding.service.ts:162-175`, invoked at `:328`); pre-tx plan read (`:311`) is advisory-only. No read-then-write on any shared mutable row anywhere (inserts / guarded UPDATE / relative UPDATE only — D9 holds).
- **tx propagation** — every repository/service call inside the tx receives `tx`: `createUser(…, tx) :325`, `linkParentIfUnlinked(…, tx) :188/:332`, `insertSubscription(…, tx) :217-225`, `creditLaneBalance(…, tx) :227-232`, `tx.insert(studentSubscriptions) :242-245`, `createAuditLog(…, tx) :348-364`, `getUserDetail(…, tx) :269`. Pre-tx guard reads take `outerTx` (`:302`, `:311`, `:313`). Zero bare-`db` writes; grep for `queryDb`/`@/backend/db` in service+helpers: clean.
- **INV-PAY5** — zero `student_payments` writes anywhere in the diff: service/helpers contain no reference (only the header docstring stating the ledger is untouched); test + journey contain only `$count` probes (verified by grep; no `insert/update/delete(studentPayments)`).
- **Dead code / unreachable branches / unused exports** — none: all 6 helpers + `OFFLINE_PAYMENT_GATEWAYS` used (const consumed by `assertOfflinePaymentMethod` at helpers `:50`; export shape is plan §4.3-mandated); all service-local types/functions consumed. `buildOnboardSubscriptionInsert` carrying the (unused-in-body) `balanceLane` mirrors the plan's own signature shape — not dead code, it types the lane-verified precondition.
- **Cross-layer imports** — clean: service imports repos via `@/backend/db/repo` barrel, types via `@/backend/types`, one-arg `getServerTranslations` from `@/shared/locale/server-graphql`; the `studentSubscriptions` schema import follows the existing service-layer junction precedent (plan §4.5 step 10). No frontend/graphql imports; repo file is data-access-only.
- **Audit attribution (D5)** — exactly two rows: user `Create` minted inside `createUser` (`user-management.service.ts:308-313`, details `{"role":"student"}`) + subscription `Create` via `buildSubscriptionAuditContract(actorId, AuditActionType.Create, subscription.id, buildOnboardAuditDetails(…))` (`:348-364`) — both `actorId`-attributed to the acting admin; details ids/enums/counts + the admin-authored reference only (≤500 chars worst case; `truncateDetailsSafely` guards the varchar(2000) ceiling at the seam, `audit.service.ts:88`).
- **Error taxonomy 1:1 vs §3.3** — verified end-to-end: `VALIDATION` ×6 (`methodNotOffline`/`referenceInvalid`/`planInactive`/`planLaneUnconfigured`/`parentRoleInvalid`/`parentsRowMissing`), `CONFLICT` ×3 via constraint arbitration (duplicate email → `createUser`'s own `translateDbError` with `emailAlreadyExists` at `user-management.service.ts:317-320`; duplicate reference → service's outer `translateDbError(error, duplicateReference)` at `:381`; fresh-row link conflict → `ConflictError` `:195`), `PLAN_NOT_FOUND` / `USER_NOT_FOUND` via `NotFoundError` (`errors.ts:37` derives `${ENTITY}_NOT_FOUND`), `UNAUTHORIZED`/`FORBIDDEN` via `assertActorAdmin`. `translateDbError` passes DomainErrors through untranslated (`errors.ts:202-204`), so the email copy is never mislabeled as duplicateReference. All messages one-arg `getServerTranslations(locale)` (D13) ✓.
- **Zero-write denial guarantee** — all guards precede `withTransaction` (`:302-314`): gate → method whitelist → reference normalize → plan guard → parent-target guard; every denial provably zero-write (service Tier 2 exact count snapshots + journey `snapshotFlowWriteCounts`).
- **Duplicate paymentReference race** — constraint-only: no pre-check SELECT for the reference anywhere; arbitrated by `subscriptions_payment_reference_unique` → 23505 → `translateDbError` (D9 ✓).
- **Helpers pure** — zero DB access/imports in `student-onboarding.helpers.ts`; value imports for runtime enums (`PaymentGateway`, `SubscriptionStatus`, `UserRole`/`toUserRole`), `SubscriptionCreditLane` type-only where type-only ✓.
- **Journey convergence adjustment** — re-verified factually correct, NOT an oracle loosening: detail projection hard-codes `balanceTrial: null` (`user-management.mappers.ts:163`) while the raw row's not-null-zero trial balance is pinned in `assertOnboardedLeg` (`direct-student-onboarding.journey.test.ts:405`).
- **Clean comments** — zero plan-artifact references in service/helpers/barrel (grep `REQ-|Task [0-9]|plan\.md|D-ONB`: only the docstring mentioning the `console.*` ban). No `console.*`, no `{ ...input }` spreads, no `SUPER_ADMIN`, no nested ternaries, no `oxlint-disable`.
- **Barrel** — single alphabetical line `export * from "./student-onboarding.service"` between `student-directory` and `teacher-applicant-directory`; helpers deliberately private (2.4 §2.4 justification stands).

### Final verification (re-run by this review, in the review worktree @ `64f9977`)

| Gate | Command | Result |
|---|---|---|
| duplicates ×3 | `bun run scripts/health/sub-loop.ts backend/services/admin/student-onboarding.service.ts --lifecycle duplicates` (also helpers, parent.repository) | exit 0 ×3 — "check:duplicates passed" |
| Service suite | `bun run test/scripts/run-test.ts backend/services/admin/student-onboarding.service.test.ts` | **22 pass / 0 fail / 198 expect()** [6.69s], exit 0 |
| Journey suite | `bun run test/scripts/run-test.ts test/workflows/admin/direct-student-onboarding.journey.test.ts` | **11 pass / 0 fail / 204 expect()** [3.65s], exit 0 |

(tsgo/biome full gates were certified 0-error on this exact byte-state by the 2.4 outcome; no file changed since — review made no edits.)

**Verdict: backend wave APPROVED — no fixes required; Phase 3 (resolver + census) may proceed on this byte-state.**

---

## review-types wave

**Reviewer:** review-types subagent (Task 2.5-types) · **Date:** 2026-09-22 · **Branch:** `feat/direct_student_onboarding_with_offline_payment` @ `64f9977` (scope files byte-identical to their `07c2675` landing state — `git diff --stat 07c2675..64f9977` touches ZERO types/locale files, so per-file QL results carry over)

**Environment note (confirms review-backend wave):** sandbox auto-reverts main-worktree HEAD to `main` (the local `main` ref itself was found moved to the stale feat commit `07c2675`; `origin/main` still `6bf6c71`). `git worktree add` is blocked in this sandbox (symlink creation denied), so verification was executed as atomic `checkout && gate` chains; the FINAL parity+tsgo run started and ended on `64f9977` with no flip.

### Scope reviewed

- `backend/types/admin/admin-student-onboarding.types.ts` (CREATE) + `backend/types/admin/index.ts` (+1 barrel line)
- `shared/locale/types/studentOnboarding/index.ts`, `shared/locale/en/studentOnboarding/index.ts`, `shared/locale/ar/studentOnboarding/index.ts`, `shared/locale/namespaces/studentOnboarding/{studentOnboarding.namespace.ts,index.ts}`, `shared/locale/types/message.ts`, `shared/locale/en/messages.ts`, `shared/locale/ar/messages.ts`, `shared/locale/namespaces/registry.ts`, `shared/locale/namespaces/index.ts` (deltas)
- `shared/locale/studentOnboarding-namespace.parity.test.ts`
- Downstream-consumption cross-check against the REAL landed consumers @ `64f9977`: `backend/services/admin/student-onboarding.service.ts` + `student-onboarding.helpers.ts` (read from the tip commit) + outcome/2.4-outcome.md; plan §4.1/§5.5, specs REQ-010..014.

### Findings table

| # | Severity | File:line | Description | Status |
|---|---|---|---|---|
| T1 | INFO (observation, pre-existing form) | `shared/locale/ar/studentOnboarding/index.ts:80` | `errors.planLaneUnconfigured` predicate «غير مهيأة» (feminine agreement) does not agree with the masculine subject «مسار الرصيد». The form is mirrored verbatim from the PRE-EXISTING baseline copy `errorsTranslations.planLaneUnconfigured` (`shared/locale/ar/errors/index.ts:43`, same predicate) — house copy consistency, not a new defect introduced by this plan. Fixing only the new leaf would fork two near-identical flow-denial strings. | deferred — baseline copy form; any correction must cover `shared/locale/ar/errors/index.ts:43` in the same change (outside this wave's file set; flagged for a future locale-copy pass) |
| T2 | INFO (baseline ordering) | `shared/locale/namespaces/registry.ts:59-63` | `namespaces` object member order (… Sessions, Schedule, UpNext, SubscriptionAdmin, StudentOnboarding, Wallet) is non-alphabetical — pre-existing order (verified against pre-change `6bf6c71` blob); the insertion followed the local precedent. The import block (lines 7–34) IS alphabetical, with `StudentOnboarding` correctly placed. | not-a-finding (baseline) |
| T3 | INFO (spec/plan tension, carry-forward) | specs REQ-020.9 vs `backend/types/admin/admin-student-onboarding.types.ts:47` | Specs wire whitelist shows `paymentReference?` optional; canonical type (plan §4.1/D3, authoritative) and the landed helpers (`normalizePaymentReference` rejects empty) treat it as REQUIRED. Correct as landed; the 3.x resolver reconciles the wire shape. | no action — carry-forward to 3.x |
| T4 | INFO (convention confirmation) | `backend/services/admin/student-onboarding.helpers.ts:26` | Deep import `@/shared/locale/types/studentOnboarding` from backend follows the established repo precedent (`@/shared/locale/types/errors` in 5+ pre-existing billing helpers/services; `@/shared/locale/server-graphql` for the one-arg lookup) — the shared/AGENTS.md "no deep paths" rule is repo-practiced as banning deprecated `old/**`/`beta/**` paths. | not-a-finding |

**Fix-requiring findings: 0** (0 critical / 0 high / 0 medium / 0 low-fix). No in-file fixes were applied; audited byte-state identical to the state the 1.1/1.2/2.4 gates certified.

### Review axes — results (all PASS, cited)

- **Canonical naming / zero duplicates** — `AdminOnboardStudent*` appears ONLY in `admin-student-onboarding.types.ts` (repo-wide grep → 1 file); no `StudentInsertType`/`StudentReturnType` minted; naming matches `{Entity}{Verb}SubmitInput`/`{Entity}ReturnType`; `check:duplicates` stage green on all 13 scope files.
- **Import paths** — types file: five deep `@/backend/...` `import type` lines, exact sibling convention of `admin-user.types.ts` (which also type-imports `Gender`/`UserRole`); barrels use relative `export * from "./..."` (types AGENTS.md); shared/locale files use `@/shared/locale/...` exclusively, single relative line is the sanctioned namespace barrel re-export.
- **Enum usage** — types file has zero runtime member access ⇒ `import type` is correct (matches 1.1 §4.1.SR ruling + sibling file); no raw pgEnum literals (`offline_cash`/`bank_transfer`/`male`/…) anywhere in scope; the landed 2.4 helpers VALUE-import runtime enums and type-import `SubscriptionCreditLane` — the exact split the 1.1 carry-forward mandated.
- **Locale parity & registration** — 37/37 keys in both leaves (33 strings + 4 typed single-param function leaves: `sessions(count)`, `intervalDays(days)`, `handshakeCode(code)`, `balanceCredited(count)`); compile-time hammer (`Translations.studentOnboardingTranslations` on both `Translations`-typed bundles) + runtime parity suite green; registration complete across all 6 surfaces (labels interface, en/ar leaves, handle + `<ns>.<ns>` id, registry, namespaces barrel, message.ts, en/ar messages.ts); handle public via `@/shared/locale` → `./namespaces`; top `types/index.ts` untouched, matching the `subscriptionAdmin` precedent (post-launch namespaces register through `namespaces/` only); zero `next-intl`, zero `Translation.`-enum, zero string-literal namespace lookups (the only string id is the mandated `defineNamespace` parameter), zero two-arg signatures, property-access only. Copy vocabulary verified consistent: method labels byte-equal the `adminFinance` gateway labels; lane labels byte-equal the `plans` balanceLane labels; `errors.planLaneUnconfigured` intentionally flow-specific vs the `errorsTranslations` purchase copy.
- **Layer isolation** — `shared/**` scope files import nothing from `@/frontend|backend|app` (grep clean; only `@/shared/locale/...` + `bun:test`); no `console.*`, no `oxlint-disable`, no `any`/`@ts-`/`as unknown` escape hatches (grep hits are prose only).
- **Downstream consumption (2.4 carry-forward) — verified against the LANDED service+helpers @ `64f9977`, not just plan prose**: service imports both canonical types via `@/backend/types` barrel; `mapToCreateUserInput` consumes the 6 identity fields field-by-field with `role: UserRole.Student` VALUE-hard-coded (no `role` in the whitelist — BOPLA holds); `buildOnboardSubscriptionInsert` narrows via `Pick<AdminOnboardStudentSubmitInput, "paymentMethod" | "paymentReference">` (enum-typed, no string literals); return composition at service `:359-373` is exactly the 5-key shape (`student` = `AdminUserDetailReturnType` detail, `subscription` = mapped `SubscriptionReturnType`, `creditedLane` = narrowed lane, `creditedSessions` = `plan.sessionCount`, `handshakeCode` = `snapshot.handshakeCode` non-null string from `AdminStudentSnapshotReturnType`); ALL 7 `StudentOnboardingLabels["errors"]` keys consumed 1:1 by the denial ladder (`methodNotOffline`, `referenceInvalid`, `planInactive`, `planLaneUnconfigured`, `parentRoleInvalid`, `parentsRowMissing`, `duplicateReference`) through the one-arg `getServerTranslations(locale).studentOnboardingTranslations` — zero dead keys, zero missing keys.
- **Clean comments** — zero plan-artifact references in all 13 scope files (grep `REQ-|Task [0-9]|D-ONB|plan\.md|specs\.md|§` → 0 matches).

### Final verification (this wave)

| Gate | Command | Result |
|---|---|---|
| QL ×13 scope files | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (each of the 13 files listed above) | **exit 0 ×13** — all five stages pass per file |
| Parity suite @ tip | `bun run test/scripts/run-test.ts shared/locale/studentOnboarding-namespace.parity.test.ts` (run at `64f9977`) | **50 pass / 0 fail / 352 expect()** [85ms], exit 0 |
| tsgo @ tip | `bun tsgo 2>&1 \| grep -c "error TS"` (run at `64f9977`) | **0** |
| Duplication census | repo-wide grep for `AdminOnboardStudent`, `StudentInsertType`, `StudentReturnType` | 1 file (the canonical home) / 0 / 0 |

**Verdict: types/locale wave APPROVED — no fixes required; Phase 3 (resolver + census) may proceed on this byte-state.**
