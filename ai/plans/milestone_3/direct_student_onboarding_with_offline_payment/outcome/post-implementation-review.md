# Post-Implementation Review — Phase 6 Waves

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Task:** 6.1 (parallel review subagent waves over the plan's changed files)

## review-frontend wave (R1)

**Reviewer scope:** `frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.ts` (+ co-located contract test + admin barrel line), `frontend/views/admin/students/onboarding/**` (dialog tree 8 files + hooks 4 files), `AdminStudentsToolbar.tsx` + `AdminStudentsDirectoryContainer.tsx` deltas + `useAdminStudentsDirectory.ts` delta, `frontend/graphql/test/admin-student-onboarding/admin-student-onboarding.test.ts`.
**Method:** read-only review against plan §5.2–§5.7, `.agents/instructions/frontend.instructions.md`, `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/graphql/AGENTS.md`; targeted greps (hardcoded colors, plan-artifact refs, bare-`@apollo/client` hook imports, `useLazyQuery`, `console.*`/`logger`, store mutations, string-literal namespaces); findings FILTERED to NEW issues in this plan's files only.

### Findings

| ID | Severity | File | Finding | Review axis | Disposition |
|---|---|---|---|---|---|
| RF1 | Minor | `frontend/views/admin/students/onboarding/OnboardStudentPaymentSection.tsx:8` | Header comment carried the plan decision artifact "(D3)" | Clean comments — zero plan-artifact references | FIXED this wave (comment-only) |
| RF2 | Minor | `frontend/views/admin/students/onboarding/OnboardStudentSuccessContent.tsx:6` | Header comment carried the spec artifact "(REQ-030.6 — …)" | Clean comments — zero plan-artifact references | FIXED this wave (comment-only) |
| RF3 | Observation | `frontend/views/admin/students/AdminStudentsDirectoryContainer.tsx` (via `useOnboardingPlanOptions`) | The option feeds (`planCatalogQueryDocument` + parent-role `adminUsersQueryDocument`) fire at directory mount even when the dialog is never opened; the stateful-`useQuery`-only rule (NO `useLazyQuery`) makes conditional fetching a structural follow-up (mount the dialog subtree on first open), not an in-place flag | Data-fetch economy (NOT a plan violation — plan §5.3 wires these hooks verbatim) | Deferred → `deferred-items.md` D-ONB-007 |

### Verified clean (axes with zero findings)

- **MUI discipline** — layouts via `sx` only (grids/Stacks; no direct style props); palette colors exclusively through `sx={(theme) => …}` callbacks and theme vars (backdrop scrim via `var(--mui-palette-scrim)`); zero hex/rgba/named colors in the new tree (grep clean); icons `PersonAddOutlined` / `CheckCircleOutlined` (correct `*Outlined` naming).
- **Apollo** — hooks (`useMutation`, `useQuery`) imported from `@apollo/client/react` ONLY; zero `useLazyQuery`; `gql` + `TypedDocumentNode` from `@apollo/client` per the documents convention; `id`-first selections pinned by the contract test in lockstep with the shared `AdminUserDetailFields` fragment; no store mutations outside the Apollo cache.
- **FormDialogShell chrome** — reused verbatim (`titleId` / `dialogTitle` / `labels.{cancel,save,saving}` + `globalError` alert band); the success state renders its own minimal chrome because the shell's dismiss-label slot is unreachable outside the shell (pre-accepted in outcome/4.2 §5.4 — not re-flagged).
- **Refetch contract** — targets the REAL `adminStudentsQueryDocument` with the caller's LIVE directory variables (`AdminStudentsQueryVariables` surfaced by the additive `useAdminStudentsDirectory` delta), `awaitRefetchQueries: true` — never hardcoded to page 1.
- **Error-mapping seam** — `extractFieldErrors` → inline `helperText` (server VALIDATION `extensions.fields[]`, keyed by input field names); field-less rejections → the shell's alert band via `extractErrorMessage`; server copy rendered VERBATIM (no client re-translation); client errors clear on any draft edit; rejections propagate to the single `runWithFeedback` catch point (nothing swallowed at the call site).
- **Credential hygiene** — password field `type="password"` + `autoComplete="new-password"`; the credential is structurally absent from the mutation result selection and never echoed or logged (zero `console.*` / `logger` in the tree; the integration suite deep-probes for `passwordHash` leakage).
- **Copy** — namespace handles ONLY (`useAppTranslation(StudentOnboarding)` / `(AdminUsers)`); zero string-literal namespaces.
- **Toolbar additive-only** — the toolbar delta is strictly additive (two new props + one button + one doc bullet); `onboardDisabled` matches the plan ("disabled while the dialog is open" plus the in-flight write); no behavior drift in the existing affordances.

### Fixes applied this wave

- RF1/RF2: reworded two header comments (plan/spec artifact references removed) — zero behavior change.

### Verification

- `bun tsgo` → 0 errors (pre-fix baseline 0; re-run post-fix 0).
- `bun run lint` → exit 0 (pre-fix baseline 0; re-run post-fix exit 0).
- `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 on BOTH fixed files.
- Scope filter honored: only NEW findings in this plan's files; items already documented as accepted in `outcome/4.2-outcome.md` §5 (success-dismiss label reuse, deliberately duplicated 255 reference bound, stale ESLint cache artifact) were NOT re-flagged.

### Worklog

- **Task ID:** 6.1-frontend — review-frontend wave (R1) executed: 16 changed frontend files reviewed across all mandated axes; 2 minor comment fixes (RF1/RF2); 1 deferred discovery (RF3 → D-ONB-007); verification green (`bun tsgo` 0 / `bun run lint` exit 0 / sub-loop exit 0 on fixed files). Fixes + this review + the ledger row committed atomically on `feat/direct_student_onboarding_with_offline_payment` (no push).

## review-backend wave (R1)

**Reviewer scope:** `backend/services/admin/student-onboarding.service.ts`, `backend/services/admin/student-onboarding.helpers.ts`, `backend/db/repo/parents/parent.repository.ts` (`findById`), `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts`, `backend/graphql/pothos/admin/admin-student-onboarding.pothos.ts`, `backend/services/admin/student-onboarding.service.test.ts`.
**Method:** one-pass semantic read of each scope file + plan §1.3 (D1–D13), §3.3, §4.2–§4.6 + `outcome/2.4-outcome.md` §7–§8 cross-check; targeted greps (tx propagation, plan-artifact refs, `console.*`/`{ ...input }`/`SUPER_ADMIN`/two-arg `getServerTranslations`); seam-signature verification (`getUserDetail`, `subscriptionCreditLaneMemberOf`, `toSubscriptionAdminReturnType`, `assertActorAdmin`); full service suite re-run. Findings FILTERED to NEW issues in this plan's files only.

### Findings

| ID | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| RB1 | Info | `backend/services/admin/student-onboarding.service.ts:242` | Junction row is written as a direct `tx.insert(studentSubscriptions)` inside the service rather than through a repository method | Accepted — the exact pattern the plan's write sequence (§4.5 step 10) prescribes, mirroring the existing service-layer precedent `subscription-purchase.service.ts:419`; no `StudentSubscriptionsRepository` exists and the insert is tx-carried |
| RB2 | Info | `backend/services/admin/student-onboarding.service.test.ts:84` | `HANDSHAKE_CODE_PATTERN` doc comment says "8 uppercase alphanumeric" while the pattern (and the generator) are hex `[0-9A-F]{8}` | Accepted — the wording faithfully mirrors the generator's own doc comment (`backend/services/shared/user-provisioning.helpers.ts:36`, a pre-existing foreign file out of scope); the pattern itself is exact |
| RB3 | Info | `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts:56` | Boundary guard throws `UnauthorizedError` with a server-authored English message ("Authentication required.") instead of resolved copy | Accepted — structurally unreachable (the `authScopes` `$all` conjunction fires pre-resolver for anonymous contexts) and is the verbatim precedent of the sibling admin mutation guard (`admin-users.mutation.ts:52,72`); code `UNAUTHORIZED` propagates through masking |
| RB4 | Info | `backend/services/admin/student-onboarding.helpers.ts:34` | `OFFLINE_PAYMENT_GATEWAYS` is a `ReadonlySet` + `.has` where plan §4.3 sketched a `readonly[]` + `.includes` | Accepted — semantically identical whitelist membership guard; the Set form is the stricter/faster equivalent and the three members match the plan exactly |

No Major/Minor findings. Zero code changes made this wave — every scope file is byte-identical to the audited 5.2-gate state, so all prior green verification runs remain valid for the audited byte-state.

### Axis evidence

- **1. Tx propagation (zero bare-db after the tx opens)** — every call inside the single `withTransaction(outerTx)` callback (service.ts:319) receives `tx`: `createUser` :325, in-tx plan read :328→:163, guarded parent link :332→:188, subscription insert :217–225, lane credit :227–232, junction insert :242, audit row #2 :348–364, fresh detail read :366→:269. Pre-tx guards pass `outerTx` (:302, :311, :313→:135, :144). `ParentRepository.findById` is dual-mode by design: drizzle select on a supplied transaction, raw parameterized `queryDb` only when standalone (parent.repository.ts:68–81). Helpers are pure — zero DB access (helpers.ts:5–9).
- **2. No TOCTOU** — full pre-tx denial ladder (service.ts:307–314) PLUS the in-tx authoritative plan re-read `resolveInTxPlan` (:162–175, invoked :328) re-asserting `assertOnboardablePlan` against the transaction snapshot and resolving the credit lane fail-closed via `subscriptionCreditLaneMemberOf` (subscription-admin.helpers.ts:491–503 aborts on any non-member). Parent-link race window is closed by the guarded `WHERE parent_id IS NULL` update with zero-row ⇒ typed conflict (:182–197); the role-read window is plan-accepted benign (§4.6: no role-mutation surface exists; FK `students_parent_fk` is the final arbiter). D11 satisfied exactly — the in-tx read is not a duplicate pre-check.
- **3. Error taxonomy 1:1 vs plan §3.3** — `UNAUTHORIZED`/`FORBIDDEN` via `assertActorAdmin` (:302) + the GraphQL `$all` scope conjunction (mutation.ts:68–73 + requireContextActorId :54–59); `VALIDATION` ×6 from the helpers (:51 methodNotOffline, :66 referenceInvalid, :84 planInactive, :87 planLaneUnconfigured, :104 parentRoleInvalid, :107 parentsRowMissing); `PLAN_NOT_FOUND` (:119, :170); `USER_NOT_FOUND` (:142, defensive :239, :277); `CONFLICT` (invariant :195; duplicate email via createUser's own `translateDbError` → `emailAlreadyExists`, user-management.service.ts:319; duplicate reference via the service catch `translateDbError` :381). Every DomainError carries structured `extensions.code`; nothing swallowed.
- **4. Dead code / unreachable branches** — none: all 7 helpers and all 6 private service functions are referenced; both `parentId` guards (:312, :331) are the deliberate pre-tx/in-tx pair, not duplication drift; all test imports and fixtures are consumed.
- **5. Denial ladder order** — admin gate :302 → offline-method whitelist :309 → reference normalize :310 → plan :311 → parent target :312–314, each pre-tx and each zero-write on denial — exactly plan §4.5 steps 1–4.
- **6. Constraint-only duplicate arbitration** — no pre-check `SELECT` for email or payment reference anywhere in the service/helpers (read + grep verified); email arbitrates on `users_email_unique` inside `createUser`, reference on the partial unique index surfaced by the single `translateDbError` at :381 (DomainErrors pass through untranslated, so the email conflict keeps its auth copy — pinned by test:328–347). Handshake collisions arbitrate by constraint with the in-tx bounded retry inside `createUser`. D9 respected.
- **7. Same-tx write set** — junction insert (:242) + lane credit (:227–232) + audit row #2 (:348–364) all execute inside the one `withTransaction` callback; audit row #1 is minted inside `createUser` on the same `tx`. Any throw at any step rolls back the whole write set (proven by the tier-4 residue test).
- **8. Test quality** — 22 tests / 198 expects, no weak probes found: every denial asserts the typed class + `extensions.code` + the exact translated message (`expectDomainDenial` test:324–328; class-level `toBeInstanceOf` for ValidationError/NotFoundError/ConflictError/UnauthorizedError) AND anchored zero-movement snapshots across all six write tables (test:137–228, :331–334 — anchor-scoped counts immune to peer-worker drift, audit anchoring includes zero-attribution checks); happy paths deep-probe the committed shape (window arithmetic, evidence columns, junction row, exactly-two audit rows with ids-only details pinned to the exact JSON, zero ledger delta — test:342–446); duplicate tests prove constraint arbitration with holder coherence (test:328–377); tier 4 stubs the guarded-link seam and proves full rollback (test:405–428). Spy hygiene (tracked/restored) and no `.rejects.toThrow` per the DB-test rules.
- **9. Clean comments** — grep `REQ-|Task [0-9]|§|plan\.md|specs\.md|tasks\.md|D[0-9]+ ` across all six files → ZERO hits; the only cross-references are engineering-contract citations (`backend/.../AGENTS.md`), which are allowed.
- **10. Forbidden patterns** — grep `console\.|\.\.\.input|SUPER_ADMIN|getServerTranslations\(<two-args\>` → only two hits, both comments DOCUMENTING the prohibitions (mutation.ts:29, service.ts:38). One-argument `getServerTranslations(locale)` (:304); field-by-field mappings at mutation.ts:78–89, helpers.ts:117–127 and :171–179 (no caller-payload spread reaches any write path); `SUPER_ADMIN` absent (role hard-coded `UserRole.Student`, helpers.ts:125).

### Verified clean (axes with zero findings)

- **Seam signatures** — `AdminUserManagementService.getUserDetail(userId, locale, actorId, outerTx?)` matches the :269 call shape exactly (no locale/actor swap); `subscriptionCreditLaneMemberOf(lane, tErrors)`, `toSubscriptionAdminReturnType(row, tErrors)` and `assertActorAdmin(actorId, locale, outerTx?)` all verified in-tree against their call sites.
- **Mutation/Pothos contract** — input whitelist is exactly the ten plan fields (server-owned role/status/verification structurally absent); result composes ONLY existing canonical objects + the three flat credit/handshake echoes; `authScopes` uses the explicit `$all` conjunction (no ANY-semantics map); resolver maps field-by-field and passes `ctx.locale` + `ctx.user.id` only.
- **Helper purity** — zero DB access, runtime enum value imports (no `import type` on enums), types imported from `backend/types` (no co-located `.types.ts`), `outerTx`-last seam honored.
- **Cross-entity purity** — the flow's write set is exactly the five plan tables; the student-payments ledger is never touched (zero-delta asserted per happy-path leg).

### Fixes applied this wave

- None — no code changes (see Findings: four accepted Info observations, zero actionable defects).

### Verification

- `bun run test/scripts/run-test.ts backend/services/admin/student-onboarding.service.test.ts` (approved runner, process-locked) → **22 pass / 0 fail / 198 expects / 4.10s**.
- No scope file modified this wave → `bun tsgo` / `bun run lint` results from the immediately preceding waves remain byte-valid for the audited state; sub-loop not applicable (nothing fixed).
- Scope filter honored: no pre-existing foreign issues re-flagged (e.g. the generator's own "alphanumeric" doc-comment wording in `user-provisioning.helpers.ts`, and the sibling `admin-users.mutation.ts` boundary-message precedent, are recorded as provenance for RB2/RB3, not defects).

### Worklog

- **Task ID:** 6.1-backend — review-backend wave (R1) executed: 6 backend scope files reviewed one-pass across all mandated axes (tx propagation, TOCTOU/D11, error taxonomy vs §3.3, dead code, denial ladder, constraint-only duplicates, same-tx write set, test quality, clean comments, forbidden patterns); 0 fixes (4 accepted Info observations RB1–RB4); 0 deferred discoveries; suite re-run green via the approved runner (22/0). This review appended on `feat/direct_student_onboarding_with_offline_payment` (no push).

---

## Wave R1 aggregate (orchestrator sign-off)

- review-types: 0 fix-requiring findings (2 INFO) — commit e3e1822
- review-backend: 0 code findings (4 INFO, all accepted with evidence) — commit e21b907
- review-frontend: 2 Minor fixed (plan-artifact comment rewords RF1/RF2), 1 Observation deferred (D-ONB-007, re-pointed) — commit b475303
- review-security-probing: 9/9 probes PASS, 0 findings — commit fe76de0
- Aggregate R1: 0 CRITICAL / 0 HIGH / 0 MEDIUM; 2 LOW fixed; verification green (tsgo 0, lint 0, parity 50/50, service suite 22/22, documents 10/10)

## fix wave R2-R3

**Scope:** the 4 deduplicated fix-requiring findings from review iterations R2+R3 (R3-F1/R2-03, R2-01/R3-F2, R3-F3, R2-04, R2-02). Minimal fixes only; `student_payments` untouched; no cross-layer imports introduced.

### Findings → fixes

| ID | Severity | Location | Fix applied |
|---|---|---|---|
| R3-F1 / R2-03 | MEDIUM | `frontend/views/admin/students/onboarding/OnboardStudentDialog.tsx` | Submit no longer silently no-ops on an empty/loading plan catalog. `plansLoading` + `parentsLoading` are threaded from `useOnboardingPlanOptions` through `AdminStudentsDirectoryContainer` into the dialog as required props; the dialog derives `catalogEmpty` (`!plansLoading && planOptions.length === 0`) and `submitUnavailable` (`plansLoading ‖ parentsLoading ‖ catalogEmpty`), passes `submitDisabled={submitUnavailable}` to `FormDialogShell` (new additive optional prop `submitDisabled?: boolean`, default `false` — the shell owns the save button, so this was the minimal place the "disable the submit" demand can land; existing callers are unchanged), guards `handleSubmit` with the same predicate (belt for Enter-key implicit submission), and hands `catalogEmpty` to `OnboardStudentPlanSection`, which renders the new inline `planSection.emptyCatalog` hint in place of the option cards. |
| R2-01 / R3-F2 | LOW | `frontend/views/admin/students/onboarding/hooks/useOnboardingPlanOptions.ts` | The previously-dead `plansLoading` / `parentsLoading` exports are now consumed by the container (hook file itself unchanged — no dead surface remains). |
| R3-F3 | LOW | `frontend/views/admin/students/onboarding/OnboardStudentProfileSection.tsx` + `frontend/views/admin/users/ui/AdminUserGenderSelect.tsx` | Shared `AdminUserGenderSelect` gained an additive optional `disabled?: boolean` prop (wired to the MUI `Select`; hosts that omit it keep the always-enabled behavior) and the onboarding profile section passes `disabled={submitting}`. |
| R2-04 | LOW | `test/workflows/admin/direct-student-onboarding.journey.test.ts:392` | `expect(account.role).toBe("student")` → `toBe(UserRole.Student)`; the finding's "already imported" assumption was verified FALSE, so the `UserRole` value import (`@/backend/enum/users/user-role.enum`) was added. |
| R2-02 | LOW | `backend/services/admin/student-onboarding.service.ts` + `student-onboarding.helpers.ts` | Verified: the service already uses the helpers' runtime lane mapper (`subscriptionCreditLaneMemberOf`), so the remaining duplication was TYPE-level only. The lane-narrowed plan row type is now exported ONCE from the helpers as `OnboardablePlan` (co-located with the `assertOnboardablePlan` guard whose assertion produces it); the guard asserts `plan is OnboardablePlan` and the service imports it and drops its local alias + the now-unused `PlanSelectType` import. |

Locale leaves: ONE new key pair `studentOnboarding.planSection.emptyCatalog` (en + ar, idiomatic Arabic, no Arabic-script fallthrough) added additively to the types interface + both leaf consts; compile-time registry + parity suite enforce parity.

### Verification

- `bun tsgo` (grep -c "error TS") → **0**
- `bun run lint` → **exit 0**
- `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on all 12 touched TS files → **exit 0 each**
- `bun run test/scripts/run-test.ts shared/locale/studentOnboarding-namespace.parity.test.ts` → **50 pass / 0 fail** (355 expects)
- `bun run test/scripts/run-test.ts backend/services/admin/student-onboarding.service.test.ts` → **22 pass / 0 fail** (198 expects)
- port-clear prefix (`fuser -k 3066/tcp; pkill next-server`) then `bun run test/scripts/run-test.ts test/workflows/admin/direct-student-onboarding.journey.test.ts` → **11 pass / 0 fail** (204 expects)

No deferred discoveries — nothing added to `deferred-items.md`.

## fix wave R8-R10

**Scope:** the 3 remaining fix-requiring findings from review iterations R8–R10 (R10-F1, R8-01, R9-01). Minimal fixes only; `student_payments` untouched; no cross-layer imports introduced.

### Findings → fixes

| ID | Severity | Location | Fix applied |
|---|---|---|---|
| R10-F1 | MEDIUM | `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/tasks.md` | Restored the 39 checkboxes the platform file sweeps had un-flipped: tasks 2.1–2.5 + their QL/TE/SEC/SR/IV sub-items and the 14 nested Phase-0 (0.2) sweep verification bullets. Every flip verified before flipping: outcome files present (`2.1-outcome.md`–`2.4-outcome.md`, `midpoint-review-R1.md` for 2.5, `0.2-outcome.md`) and work artifacts present (journey test, census composite rows, `ParentRepository.findById`, service + helpers + co-located tests) with the suites recorded green — then re-run green live this wave. Checkbox state: BEFORE 71 `[x]` / 39 `[ ]` (110 total) → AFTER 110 `[x]` / 0 `[ ]`. |
| R8-01 | LOW | `test/workflows/admin/direct-student-onboarding.journey.test.ts:649,679` · `backend/services/admin/student-onboarding.service.test.ts:364` | The 3 residual role-literal assertions `toBe("student")` → `toBe(UserRole.Student)`. Journey test: the `UserRole` VALUE import was verified present (`:71`). Service test: the import was verified ABSENT → `import { UserRole } from "@/backend/enum/users/user-role.enum"` added in the sorted enum-import group. |
| R9-01 | LOW | `shared/locale/ar/studentOnboarding/index.ts:81` | `planLaneUnconfigured`: «غير مهيأة» → «غير مهيأ» — masculine agreement with «مسار الرصيد». One-word copy fix; key-set parity unaffected (parity suite re-run green). |

### Verification

- `bun tsgo 2>&1 | grep -c "error TS"` → **0**
- `bun run lint` → **exit 0**
- `bun run test/scripts/run-test.ts shared/locale/studentOnboarding-namespace.parity.test.ts` → **50 pass / 0 fail** (355 expects)
- port-clear prefix (`fuser -k 3066/tcp`; `pkill next-server`) then `bun run test/scripts/run-test.ts test/workflows/admin/direct-student-onboarding.journey.test.ts` → **11 pass / 0 fail** (204 expects)
- `bun run test/scripts/run-test.ts backend/services/admin/student-onboarding.service.test.ts` → **22 pass / 0 fail** (198 expects)

No deferred discoveries — nothing added to `deferred-items.md`.
