# Review Iteration R2 — Independent Re-Review (review-types + review-backend lens)

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Task:** 6.1 (post-implementation review iteration R2 — independent reviewer, no prior-round context)
**Branch:** `feat/direct_student_onboarding_with_offline_payment` @ `2f6f35e`
**Method:** re-read of `.agents/skills/spec-implementation/SKILL.md` §"Semantic Review Checklist" + §"Post-Implementation Review Wave", then a one-pass independent semantic review of the plan's full diff vs the Phase 0 baseline (`git diff 6bf6c71..HEAD`). Read-only — no source files modified.

## Scope

- **77 files** in the plan diff (6bf6c71..HEAD); **51 code/test/generated files** reviewed (plan docs + outcome logs excluded as non-source).
- Backend deep-read: `student-onboarding.service.ts`, `student-onboarding.helpers.ts`, `parent.repository.ts` (+diff), `admin-student-onboarding.mutation.ts`, `admin-student-onboarding.pothos.ts`, `admin-student-onboarding.types.ts`, all touched barrels/indexes.
- Frontend/shared deep-read: `onboardingDialog.types.ts`, dialog + success content, hooks (mutation/feedback/plan-options), documents + barrels, container/toolbar/directory-hook deltas, locale namespace + types + registry + `Translations` wiring.
- Tests probed for honesty: service suite (22 tests), `parent.repository.test.ts`, frontend integration suite, documents contract test, locale parity suite, journey test (11 steps), audit-completeness catalog/journey deltas, schema-surface freeze deltas.
- Seam signatures verified in-tree: `createUser(input, actorId, locale, outerTx)`, `getUserDetail(userId, locale, actorId, outerTx)`, `assertActorAdmin(actorId, locale, outerTx)`, `insertSubscription(insert, tx?)`, `createAuditLog(contract, tx)`, `withTransaction(outerTx, fn)` (savepoint semantics), `translateDbError` (DomainError pass-through, 23505 → ConflictError).

## Checklist results (no finding ⇒ verified clean)

- **Race conditions / TOCTOU** — full pre-tx denial ladder (zero-write) + in-tx authoritative plan re-read with fail-closed lane resolution; parent link via guarded `WHERE parent_id IS NULL` update with zero-row ⇒ typed conflict; duplicate email/reference arbitrated by constraints inside the tx (no pre-check SELECTs). No module-level mutable state (whitelists are frozen const Sets/Records). One comment-wording INFO on the re-read (R2-05).
- **tx propagation** — every call inside the single `withTransaction(outerTx)` callback receives `tx` (createUser, in-tx plan read, guarded parent link, subscription insert, lane credit, junction insert, audit row #2, fresh detail read); pre-tx guards take `outerTx`; helpers are pure (zero DB). Denials and guard failures are zero-write/zero-audit.
- **Dead code / dead branches** — all 7 helpers, all 6 private service functions, and all type exports are referenced; both `parentId` guards are the deliberate pre-tx/in-tx pair. One unused-return-surface LOW (R2-01).
- **Cross-layer imports** — zero `@/backend` imports in frontend/shared new code (grep-verified; the single hit is a prose path citation inside a JSDoc, R2-07); zero shared→frontend/backend imports.
- **Manual ReturnType construction** — none: `toSubscriptionAdminReturnType` helper used for the subscription leg; result composes existing canonical shapes only.
- **Clean comments** — ZERO plan-artifact references (REQ-x / Task x / Phase x / D1-D13 / plan paths / specs.md / tasks.md) in all NEW source and test files (scan over the full diff; every hit is present at baseline 6bf6c71 — see pre-existing INFO row). R1's RF1/RF2 comment rewords verified landed.
- **Schema/types/enums** — runtime enum usages are value imports (`PaymentGateway`, `SubscriptionStatus`, `UserRole`, `toUserRole`, `AuditActionType`, generated `Gender`/`PaymentGateway`); type-only imports use `import type`. No string literals where enums are compared server-side. Pothos input nullable slots verified on the generated schema (`gender: Gender`, `parentId: Int`). No duplicate type definitions across the new files (`AdminOnboardStudent*` defined exactly once; result composes `AdminUserDetailReturnType`/`SubscriptionReturnType`).
- **Duplicate definitions** — none; one duplicated *type-literal* between two files logged as LOW (R2-02).
- **Error taxonomy** — UNAUTHORIZED/FORBIDDEN via scope conjunction + defense-in-depth service gate; VALIDATION ×6 from the flow's own localized copy; `PLAN_NOT_FOUND`/`USER_NOT_FOUND`; CONFLICT via invariant + constraint arbitration; DomainErrors pass through the outer `translateDbError` untranslated (email keeps its auth copy, reference gets the flow copy).
- **Test honesty** — no weak probes found: every denial asserts typed class + `extensions.code` + exact copy + anchored zero-movement snapshots; happy paths deep-probe the committed write set (window arithmetic, evidence columns, junction row, exactly-two audit rows with ids-only details, zero ledger delta); tier-4 seam stub proves full rollback; journey test uses real services/DB with tracked cleanup; documents/parity suites pin selection shapes and locale leaf sets exactly.

## Findings

| ID | Severity | File:line | Description | Disposition |
|---|---|---|---|---|
| R2-01 | LOW | `frontend/views/admin/students/onboarding/hooks/useOnboardingPlanOptions.ts:30,34` | `plansLoading` / `parentsLoading` are returned by the hook but the only consumer (`AdminStudentsDirectoryContainer`) destructures only `planOptions`/`parentOptions` — unused return surface (review-backend "unused exports" axis). | Advisory, non-blocking. Follow-up candidate: consume the flags for a disabled/empty state, or narrow the hook's return. |
| R2-02 | LOW | `backend/services/admin/student-onboarding.service.ts:94` + `backend/services/admin/student-onboarding.helpers.ts:82` | The lane-narrowing type literal `PlanSelectType & { balanceLane: Exclude<PlanSelectType["balanceLane"], null> }` is declared twice (local `OnboardablePlan` in the service, inline in the helpers assertion predicate). A future edit to one side silently desyncs the narrowing. | Advisory, non-blocking. Follow-up candidate: export the narrowed type from the helpers module and reuse it in the assertion and the service. |
| R2-03 | LOW | `frontend/views/admin/students/onboarding/OnboardStudentDialog.tsx:110-116` | With an empty plan catalog (`planOptions` empty → `selectedPlanId` "" → parsed `planId === null`), submit returns early while `clientFieldErrors` may be `{}` — a silent no-op submit with zero feedback. Only reachable when the catalog is empty (normally pre-empted by the first-plan fallback). | Advisory, non-blocking. Follow-up candidate: surface a plan-picker error/disabled state when the catalog is empty. |
| R2-04 | LOW | `test/workflows/admin/direct-student-onboarding.journey.test.ts:392` | `expect(account.role).toBe("student")` uses a string literal while sibling assertions in the same file route enum vocabulary through members (e.g. `ACTIVE_STATUS: string = SubscriptionStatus.Active`) — inconsistent with the no-literals-where-enums-expected discipline (test hygiene only; the DB column is a raw string). | Advisory, non-blocking. Follow-up candidate: assert against `UserRole.Student`. |
| R2-05 | INFO | `backend/services/admin/student-onboarding.service.ts:155-160` | JSDoc says a concurrent plan deactivation "serializes behind this read" — under READ COMMITTED the in-tx re-read is a plain snapshot re-validation, not a lock; a deactivation committing after the re-read but before commit is not prevented. The defense-in-depth design is still sound (pre-tx guard + in-tx re-validation + fail-closed lane) and the exposure window is milliseconds. | Accepted — comment-wording nuance, not a code defect; the behavior matches the documented pre-tx + in-tx re-check design. |
| R2-06 | INFO | `backend/services/admin/student-onboarding.service.ts:376-382` (+ `backend/lib/errors.ts:201-209`) | `translateDbError` maps only unique violations (23505); a parent user deleted between the pre-tx guard and the in-tx link would surface an untranslated FK 23503 raw error. Theoretically reachable only inside a millisecond window (pre-tx guard + guarded link + FK arbiter); message would be generic, write set still rolls back atomically. | Accepted — theoretical edge consistent with the plan-accepted role-read window (FK as final arbiter); no change. |
| R2-07 | INFO | `frontend/views/admin/students/onboarding/onboardingDialog.types.ts:83-89` | JSDoc cites the backend source path `backend/services/admin/student-onboarding.helpers.ts` to justify the deliberately duplicated 255 reference ceiling. Not a cross-layer *import* and not a plan artifact — it is the documented duplication rationale (server bound stays the authority). | Accepted — deliberate, documented duplication; no change. |
| — | INFO (pre-existing, out of scope) | `backend/graphql/test/schema-surface.test.ts:215,222,647,659,700,1726` + `frontend/graphql/test/warnings/warning-surfacing.test.ts:18,293` | Plan-artifact-style references (`REQ-032`, `REQ-060/061`, `D2`) in comments of two MODIFIED test files — all present verbatim at baseline `6bf6c71` (diff hunks add none of them). Per protocol, pre-existing issues are logged, not blocking. | Logged only — pre-existing baseline content; candidates for a repo-wide comment sweep outside this plan. |

## Findings count

- **New (this round):** 7 — 4 LOW (R2-01…R2-04), 3 INFO (R2-05…R2-07).
- **Fixed (reported previously, verified resolved this round):** 2 — R1 RF1/RF2 plan-artifact comment rewords confirmed clean in the current tree.
- **Remaining (open from prior rounds):** 0 blocking; 1 accepted/deferred observation (R1 RF3 mount-time option feeds → `deferred-items.md` D-ONB-007, ledger row ✅ re-pointed) + pre-existing baseline INFO row above.

## Stop-condition tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 4 (all advisory, non-blocking) |
| INFO | 3 new + 1 pre-existing out-of-scope |

**Blocking total = 0 → stop condition met.** R2 independently concurs with the R1 aggregate sign-off: zero feature-specific blocking findings; the review loop can conclude without a further fix wave. The four LOW items are logged as follow-up candidates and do not gate completion.
