# Review Iteration R10 — FINAL Holistic Cross-Layer Consistency Gate

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Branch:** `feat/direct_student_onboarding_with_offline_payment` · **Tip reviewed:** `4d19242`
**Date:** 2026-09-22 · **Lens:** holistic cross-layer consistency (final gate) — one happy path + one denial path traced end-to-end, plus docs/tasks/outcome/deferred plan-completion inventory.
**Scope:** `git diff 6bf6c71..HEAD --name-only` — 85 files. Read-only; every read re-pinned via the atomic `git checkout <branch> -q && …` chain (session hazard below).

---

## Method

Read-only trace of the full write path across every layer, each verdict anchored to file:line evidence read at tip `4d19242`: dialog form state → submit mapping → mutation hook → shared document → generated SDL/types → Pothos input → resolver whitelist → canonical `AdminOnboardStudentSubmitInput` → service composite (insert columns) → DB schema → result selection → success rendering → locale catalogs. Denial path traced from the GraphQL scope gate through the service's pre-transaction ladder to the dialog's error projection. Docs file verified symbol-by-symbol against the shipped tree. No suites re-run (read-only final gate; the fix wave's recorded green gates stand per R7's verification basis).

---

## Happy path — offline cash onboarding, traced layer by layer

| # | Layer | Evidence | Coherence verdict |
|---|---|---|---|
| 1 | Dialog form fields | `OnboardStudentFormState` (`onboardingDialog.types.ts:26-48`) — exactly the 10 flow fields (`fullName, email, phone, password, gender, country, parentId, planId, paymentMethod, paymentReference`) | ✔ |
| 2 | Submit mapping | `buildOnboardStudentInput` (`onboardingDialog.types.ts:113-131`) — field-by-field onto `AdminOnboardStudentOfflineInput` (generated); token tables `GENDER_BY_TOKEN` / `OFFLINE_GATEWAY_BY_TOKEN` (Record lookups, no enum comparisons); password rides verbatim | ✔ 10 = 10 |
| 3 | Submit handler | `OnboardStudentDialog.tsx:118-139` — `validateOfflinePaymentDraft` (reference 1–255 + offline-method token) → safe-int planId parse → `onSubmit(buildOnboardStudentInput(form, planId))` | ✔ |
| 4 | Hook | `useOnboardStudentMutation.ts` — `useMutation(adminOnboardStudentWithOfflinePaymentMutationDocument)`, `refetchQueries` = the CALLER's live directory variables (`AdminStudentsQueryVariables`), `awaitRefetchQueries: true`; rejections propagate unswallowed. (The `utate` render at :47 is the documented terminal ``-swallow artifact — od-verified again this round; not a finding.) | ✔ |
| 5 | Container wiring | `AdminStudentsDirectoryContainer.tsx:73-78` — hooks trio composed; submit wrapped in `runWithFeedback`; toolbar affordance `onOnboardStudent` (`AdminStudentsToolbar.tsx:82-85`) | ✔ |
| 6 | Shared document | `admin-student-onboarding.documents.ts` — `$input: AdminOnboardStudentOfflineInput!`; `student` selects `id` FIRST + the exact `AdminUserDetail` set; `subscription { id status paymentMethod paymentReference paymentVerifiedAt }`; `creditedLane creditedSessions handshakeCode`; no credential selected | ✔ |
| 7 | Generated types | `frontend/graphql/generated/gql/graphql.ts:49-66` `AdminOnboardStudentOfflineInput` mirrors the 10 fields; :660-665 mutation + `Exact<{ input: AdminOnboardStudentOfflineInput }>` variables; :646-652 result sub-shapes match the selection | ✔ |
| 8 | SDL | `schema.graphql:164-202` — `AdminOnboardStudentOfflineInput` = the same 10 fields (3 optional: `gender parentId` nullable, rest `!`); descriptions identical to Pothos | ✔ |
| 9 | Pothos input | `admin-student-onboarding.pothos.ts:48-99` — the same 10 fields, same requiredness (`gender`/`parentId` optional, others required), `paymentMethod: PaymentGatewayPothosEnum!` | ✔ |
| 10 | Resolver whitelist | `admin-student-onboarding.mutation.ts:88-113` — field-by-field (NO spread) onto the service call; actor from `requireContextActorId(ctx.user)` only; `ctx.locale` propagated | ✔ 10 = 10 |
| 11 | Canonical input | `AdminOnboardStudentSubmitInput` (`admin-student-onboarding.types.ts:37-48`) — the same 10 keys; `role` deliberately absent (server hard-codes `UserRole.Student`) | ✔ |
| 12 | Identity mapping | `mapToCreateUserInput` (`student-onboarding.helpers.ts:124-134`) — 7 identity fields + `role: UserRole.Student`; composed through `AdminUserManagementService.createUser(…, tx)` (single writer) | ✔ |
| 13 | Subscription insert | `buildOnboardSubscriptionInsert` (`student-onboarding.helpers.ts:145-160`) — `status: SubscriptionStatus.Active`, `paymentMethod`, `paymentReference`, `paymentVerifiedAt: now`, window `start + intervalDays × MS_PER_DAY`; inserted via `SubscriptionRepository.insertSubscription(…, tx)` (`subscription.repository.ts:70-80`) | ✔ 4/4 columns |
| 14 | Schema columns | `backend/db/schema/billing/subscriptions.ts` — `status` (subscriptionStatus), `payment_method` (paymentGateway), `payment_reference` varchar(255), `payment_verified_at` timestamp; partial unique `subscriptions_payment_reference_unique … WHERE payment_reference IS NOT NULL` | ✔ |
| 15 | Remaining composite writes | `student-onboarding.service.ts:214-246` — `creditLaneBalance(…, tx)`, junction `tx.insert(studentSubscriptions)`, audit row #2 via `AuditService.createAuditLog(…, tx)`; single `withTransaction(outerTx, …)` closure; return `{ student, subscription, creditedLane, creditedSessions, handshakeCode }` | ✔ |
| 16 | Result → success UI | `OnboardStudentSuccessContent.tsx:37-53` — `student.fullName · student.email`, `t.success.handshakeCode(result.handshakeCode)`, `t.success.balanceCredited(result.creditedSessions)`; credential never rendered | ✔ |
| 17 | Copy + namespace | `shared/locale/en/studentOnboarding/index.ts:50-64` and `ar/:67-84` carry `success.handshakeCode/balanceCredited`, `errors.methodNotOffline/referenceInvalid/duplicateReference`; namespace handle `StudentOnboarding` wired via `shared/locale/namespaces/{registry,index,studentOnboarding}`; en/ar parity suite in scope | ✔ |

**Happy-path verdict: COHERENT** — the same ten-field whitelist is byte-identical at every hop (form → mapping → hook → document → SDL → Pothos → resolver → canonical type), the insert stamps exactly the four lens columns (`status/payment_method/payment_reference/payment_verified_at`), and the result's five fields round-trip into the shared document selection, generated types, and the success view without drift.

## Denial path — duplicate payment reference (plus the gate ladder)

| # | Stage | Evidence | Verdict |
|---|---|---|---|
| 1 | Pre-resolver scope gate | `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` INLINE LITERAL (`admin-student-onboarding.mutation.ts:99-105`) — anonymous → `UNAUTHORIZED`, non-admin → `FORBIDDEN` before the body | ✔ |
| 2 | Context narrowing | `requireContextActorId` (:66-75) throws `UnauthorizedError` on null identity; actor id never client input | ✔ |
| 3 | Service re-assertion | `assertActorAdmin(actorId, locale, outerTx)` is the service's FIRST action (`student-onboarding.service.ts:299`; defined `admin-gate.helpers.ts`, re-exported via `admin-guards.helpers:35`) — a direct non-admin caller hits a genuine `ForbiddenError` | ✔ |
| 4 | Pre-transaction ladder (zero writes) | `assertOfflinePaymentMethod` (`helpers.ts:49`) → `normalizePaymentReference` (:63, 1–255) → `findOnboardablePlan`/`assertOnboardablePlan` (fail-closed catalog-active + lane) → `assertLinkableParent` (:105) — all BEFORE `withTransaction` opens | ✔ |
| 5 | In-transaction duplicate arbitration | Duplicate reference → `23505` on the partial unique index → `translateDbError(error, copy.tOnboarding.errors.duplicateReference)` at the catch seam (`service.ts:393-397`) → localized `CONFLICT`; duplicate email arbitrates inside `createUser` (`ConflictError` at :192 region); DomainErrors pass through untranslated; no pre-check SELECT anywhere | ✔ |
| 6 | UI projection | `useOnboardStudentFormFeedback.ts:49-63` — field-keyed `extensions.fields[]` → inline `helperText` (`serverFieldErrors`); field-less rejections (duplicate email/reference CONFLICT) → `globalError` alert band, rendered verbatim (server-localized); stores reset per attempt + on close | ✔ |
| 7 | Zero-movement proof | Journey suite `test/workflows/admin/direct-student-onboarding.journey.test.ts` — step 9 (non-offline method, rejected before any write), step 10 (duplicate reference conflicts, `error.message` contains `tOnboarding.errors.duplicateReference`, original holder intact), step 11 (teacher/student/parent real-id callers forbidden); per-arm zero-row oracles; `student_payments` count-delta = 0 on every path; census-runner + drift lock pin the two-audit-row contract | ✔ |

**Denial-path verdict: COHERENT** — every arm terminates in a typed, localized, zero-write (or fully-rolled-back) denial; client-side gating is convenience only and the server is the authority.

## Docs verification — `docs/admin/student-onboarding-offline-payment.md`

All cited paths resolve in-tree and the claims match shipped behavior: `admin-gate.helpers.ts` / `admin-guards.helpers.ts` / `with-transaction.ts` / `audit.service.ts` / `errors.ts` / `audit-census-drift.test.ts` / `subscription-admin-settle.helpers.ts` / `FormDialogShell.tsx` all exist; symbols `assertOnboardablePlan`, `assertOfflinePaymentMethod`, `normalizePaymentReference`, `mapToCreateUserInput`, `buildOnboardSubscriptionInsert`, `buildOnboardAuditDetails`, `translateDbError`, `insertSubscription`, `requireContextActorId` verified; §5's error-merge `{ ...serverFieldErrors, ...clientFieldErrors }` is at `OnboardStudentDialog.tsx:110` and the derive-on-arrive plan fallback at :109; toolbar affordance present; the illustrative GraphQL block is marked non-authoritative and its field names match the real SDL; related docs (`user-management.md`, `admin-subscription-management.md`, `state-machine-invariants.md`) exist. **No stale claims found.**

---

## Findings (NEW this round)

| ID | Severity | File | Finding | Evidence | Required action |
|---|---|---|---|---|---|
| R10-F1 | **MEDIUM** (plan-completion gate, no code impact) | `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/tasks.md` | **Checkbox drift: 39 of 110 checkboxes remain `[ ]`** at the final gate. Unchecked: the 5 top-level Phase-2/2.5 tasks **2.1, 2.2, 2.3, 2.4, 2.5** (lines 130-198) with all 20 of their QL/TE/SEC/SR/IV sub-items, plus the 14 read-only sweep items of the (checked) task 0.2 (lines 67-80). The work itself is demonstrably done — outcome files `2.1…2.4` and `midpoint-review-R1.md` exist, the artifacts are in the 85-file scope (journey test, census catalog/runner, `parent.repository.ts` seam, service+helpers), and R1–R7 verified the code green — the boxes were simply never flipped, violating tasks.md protocol item 6 ("Flip `[ ]` → `[x]` on the task AND every completed subtask as work lands. Never batch-flip at the end.") and failing this round's ALL-`[x]` exit criterion. Not previously reported by R1–R7 (grep of prior outcomes/worklog: no mention). | `grep -c '^\s*- \[ \]' tasks.md` → 39 (71 `[x]`); unchecked regions enumerated above | Mechanical `docs(plan)` commit flipping the 39 completed boxes; no source change. Plan must not be declared complete until flipped. |

Notes (examined, NOT findings): (a) docs cite the gate's defining file `admin-gate.helpers.ts` while consumers import the `admin-guards.helpers` re-export barrel — both exist; the citation is accurate, not stale. (b) The 40th literal `[ ]` occurrence in tasks.md is the protocol's own prose at :19 ("Flip `[ ]` → `[x]`"). (c) `useOnboardStudentMutation.ts:47` renders as `const utate, …` — the known terminal `[`-swallow; byte-verified (`od -c`) again this round.

## Verified clean (axes with zero NEW findings)

- GraphQL input ↔ Pothos ↔ resolver whitelist ↔ canonical type ↔ SDL ↔ generated types ↔ shared document ↔ form fields ↔ hooks ↔ success content: **no drift** (happy-path table, layers 1-17).
- Subscription insert columns ↔ schema: `status/payment_method/payment_reference/payment_verified_at` all stamped; partial unique index intact.
- Denial ladder (scope gate → context narrowing → service re-assertion → pre-tx guards → constraint arbitration → UI projection): coherent, zero-write on every arm.
- Docs file vs shipped behavior: all citations resolve; no stale claims.
- Locale catalogs en/ar + namespace registry/parity: keys present and consumed through the typed handle.
- Audit/census composite contract (catalog secondary rows + runner + drift lock) matches the docs' §4 description.

---

## Plan-completion inventory (final gate)

| Gate item | Result |
|---|---|
| tasks.md checkboxes | **71 / 110 `[x]`** — 13/18 top-level tasks checked; **39 unchecked** (see R10-F1): 5 top-level (2.1-2.5) + 20 sub-items + 14 Phase-0 sweep items |
| Outcome files (`outcome/`) | **30 present** — 20 task outcomes (0.1, 0.2, 1.1-1.3, 2.1-2.4, 3.1-3.3, 4.1-4.4, 5.1-5.3, 7.1) + exploration-ground-truth + plan-review-R1 + midpoint-review-R1 + post-implementation-review + round-R2…R7 (6). Every implementation task has its outcome file ✔ |
| deferred-items.md live rows | 7 live rows D-ONB-001…007, **all ✅ Done — 0 live ❌/⚠️** (the 8th `\| D-ONB` grep hit is the fenced format template `D-ONB-<next-id>` inside the usage-guidelines code block, not a ledger row) ✔ |
| Docs file | Verified against shipped behavior ✔ |

## Stop-condition tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 1 (R10-F1 — plan bookkeeping gate, mechanical fix) |
| LOW | 0 |
| INFO | 0 |

**Blocking total = 1 (MEDIUM, docs-only).** The shipped code is coherent end-to-end on both traced paths and the docs match it; the ONLY outstanding item before plan completion is the mechanical checkbox flip (R10-F1). All seven code-facing review rounds (R1-R7) stand: 0 open code findings.

## Session hazard (repeat, confirmed)

The shared working tree flipped back to `main` (`07c2675`) between tool calls multiple times this round (bare `git branch --show-current` returned `main` and one `ls` of `outcome/` listed only 7 files mid-flip). Every subsequent read was re-pinned via the atomic `cd /home/z/my-project && git checkout feat/direct_student_onboarding_with_offline_payment -q && …` chain and cited from the feature branch's HEAD (`4d19242`), exactly as R3/R4/R6 recorded. Reviewers of this workspace must never trust bare working-tree state.
