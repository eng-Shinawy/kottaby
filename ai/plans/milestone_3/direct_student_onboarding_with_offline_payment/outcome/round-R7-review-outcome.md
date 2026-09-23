# Review Iteration R7 — Independent Re-Review (pentester lens, rescan of the current tip)

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Task:** 6.1 (post-implementation review iteration R7 — independent reviewer, no prior-round context)
**Branch:** `feat/direct_student_onboarding_with_offline_payment` · **Tip at review:** `6608c6d` (code byte-identical to the fix wave `bfbe666` — `git diff bfbe666..6608c6d -- backend frontend shared test docs` is empty; R5/R6 added plan docs only)
**Method:** read of `.agents/skills/spec-implementation/SKILL.md` §"Post-Implementation Review Wave" (security scope) FIRST, then an adversarial pentester walk of the write path (mutation → resolver → service → repos) plus the three NEW change clusters since the last security pass (R4 @ `2f6f35e`): the `submitDisabled` predicate, the `OnboardablePlan` type export, and the `planSection.emptyCatalog` locale key. Read-only — no source files modified. Every verdict anchored to file:line (or byte) evidence; the known terminal `[m`-swallow artifact was hex-verified (`od -c`) before treating any rendered oddity as a finding.

## Scope

- **82 files** in the plan diff (`git diff 6bf6c71..bfbe666 --name-only`); code identical at tip `6608c6d` (proof above).
- Write path deep-read at tip: `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts`, `backend/graphql/pothos/admin/admin-student-onboarding.pothos.ts`, `backend/services/admin/student-onboarding.service.ts`, `backend/services/admin/student-onboarding.helpers.ts`, `backend/db/repo/parents/parent.repository.ts`, plus the fix-wave delta (`2f6f35e..bfbe666`: FormDialogShell, directory container, dialog, plan/profile sections, gender select, locale en/ar/types, journey test).
- Generated wire artifact re-verified: `frontend/graphql/generated/schema.graphql` `AdminOnboardStudentOfflineInput` (10 fields, `planId: Int!`).
- Pre-existing load-bearing seams verified in-tree (not re-reviewed): `assertActorAdmin`, partial unique `subscriptions_payment_reference_unique`, `AdminUserManagementService.createUser` (single identity writer), `linkParentIfUnlinked` / `creditLaneBalance`, `withTransaction`, `translateDbError`.

## Probe table (attacker walk, tip `6608c6d`)

| # | Probe | Evidence (file:line) | Verdict |
|---|---|---|---|
| P1 | **BOLA/IDOR — actor source**: is the acting identity ever client-controlled? | Resolver calls `requireContextActorId(ctx.user)` (`admin-student-onboarding.mutation.ts:54-59,75`); the service takes `actorId` as a typed parameter and uses it only for the gate + audit attribution (`student-onboarding.service.ts:295-299,347`). Zero reads of any input id as actor. | **PASS** |
| P2 | **BOLA/IDOR — parentId path**: arbitrary-parent link? | Client `input.parentId` is re-validated pre-tx (`assertParentAssociationTarget`: user exists ⇒ else `USER_NOT_FOUND`; role===Parent AND owned `parents` role-child row ⇒ else localized VALIDATION — `service.ts:127-143,309-311`, `helpers.ts:105-116`) and in-tx via the guarded `linkParentIfUnlinked` (`WHERE parent_id IS NULL`, zero-row ⇒ `ConflictError` + rollback — `service.ts:179-194,328-330`). `parents` rows carry only shared PK + timestamps. | **PASS — no IDOR** |
| P3 | **BOLA/IDOR — planId path** (incl. 0/negative/unknown) | Pre-tx `findOnboardablePlan` (`service.ts:104-120,308`) + in-tx `resolveInTxPlan` (`:159-172,325`) both funnel through `assertOnboardablePlan`: unknown ⇒ `PLAN_NOT_FOUND`; inactive ⇒ VALIDATION `planInactive`; null lane ⇒ VALIDATION `planLaneUnconfigured` (never guessed — fail-closed). Wire type is `planId: Int!` (schema.graphql), so omission dies at GraphQL validation. | **PASS — fail-closed** |
| P4 | **BOPLA — wire boundary**: tampered payload smuggling role/status/verifiedAt? | Generated `AdminOnboardStudentOfflineInput` carries exactly the 10 whitelist fields (country, email, fullName, gender, parentId, password, paymentMethod, paymentReference, phone, planId — schema.graphql:164-203); `role`, subscription `status`, `paymentVerifiedAt` structurally absent; unknown fields rejected by GraphQL validation pre-resolver. | **PASS** |
| P5 | **BOPLA — resolver + service mapping**: spreads / passthroughs | Resolver maps field-by-field (`mutation.ts:78-89`); `mapToCreateUserInput` maps 7 fields and hard-codes `role: UserRole.Student` (`helpers.ts:124-134`); grep `...` across the five write-path files at tip → zero spreads in runtime code. Audit details are an explicit record literal (ids/enums/counts + reference — `helpers.ts:169-187`). | **PASS** |
| P6 | **BFLA — scope literal shape** | `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` inline in the field config (`mutation.ts:68-73`) — read directly this round; no plain-map ANY-semantics shape anywhere in the diff. Anonymous ⇒ UNAUTHORIZED, non-admin ⇒ FORBIDDEN, pre-resolver. | **PASS** |
| P7 | **BFLA — service re-assertion** | First statement of the service entry: `await assertActorAdmin(actorId, locale, outerTx)` (`service.ts:299`). Exactly one production caller (the admin mutation). A scope-layer bypass alone cannot reach a write. | **PASS** |
| P8 | **Injection — SQL/raw/LIKE/concat** | Only raw SQL in the diff: `ParentRepository.findById` standalone path — static statement, `$1` bound parameter (`parent.repository.ts`, `queryDb` block; tx path is Drizzle `eq(parents.id, userId)`). Diff-wide `ilike(`/`.like(`/`LIKE '` grep over added lines: zero code hits (only R4's own prose row). `paymentReference` travels as a bound insert value, never query text. | **PASS** |
| P9 | **XSS — rendering of returned/entity fields** | Zero `dangerouslySetInnerHTML` / `innerHTML` / `document.write` across `frontend/views/admin/students`, the shell, and the gender select (grep at tip). Success content renders `handshakeCode`/`fullName`/`email` as React text interpolation; the new `emptyCatalog` hint renders as a `FormHelperText` text child (`OnboardStudentPlanSection.tsx:123`) — auto-escaped, static copy. Password structurally absent from the mutation result selection. | **PASS** |
| P10 | **Business logic — duplicate arbitration** (email + reference) | No pre-check SELECT anywhere (read + grep): email arbitrates on `users_email_unique` inside `createUser`; reference on the partial unique index, surfaced by the single outer `translateDbError(error, …duplicateReference)` (`service.ts:373-379`); DomainErrors pass through untranslated. Replay ⇒ typed conflict, zero double-billing. | **PASS** |
| P11 | **Business logic — reference trim / 1-255 / whitespace** | `normalizePaymentReference` trims, rejects empty-after-trim (whitespace-only ⇒ VALIDATION) and >255 (`helpers.ts:63-69`); the TRIMMED value is what is stored and arbitrated. Client mirror is deliberately narrow; the server bound stays the authority. | **PASS** |
| P12 | **Business logic — fail-closed plan/lane** | `assertOnboardablePlan` (`helpers.ts:86-96`): inactive ⇒ `planInactive`; `balanceLane === null` ⇒ `planLaneUnconfigured`; the flow never guesses a lane (`subscriptionCreditLaneMemberOf` aborts on any non-member). Re-asserted against the in-tx snapshot (`service.ts:169-170`). | **PASS** |
| P13 | **Secrets / log hygiene** | `logger.logDomainError` calls carry code/entity/entityId only (`service.ts:111-115,134-138,187-191,231-235,269-273`); zero `console.*` in the new frontend/shared tree (grep). Audit rows: two, in-tx, admin-attributed, ids/enums/counts + the sanctioned reference token — no names/emails/phones/credentials (`helpers.ts:169-187`). Frontend never logs or echoes the credential (`type="password"`, `autoComplete="new-password"`; result selection excludes it). | **PASS** |
| P14 | **INV-PAY5 — zero `student_payments` writes across the whole diff** | Diff-wide grep at tip: 57 added lines mention `student_payments`/`studentPayments` — all prose, `$count` probes, or the read-only census SELECT (`countStudentPaymentsForReferences`: `.from(studentPayments).innerJoin(...)` — tests only). Targeted write-shape grep (`insert|update|delete|into|values|set` × `studentPayments`): **no matches**. Runtime write set exactly: `users` + `students` + guarded `students.parent_id` + `subscriptions` + `student_subscriptions` + 2 audit rows, one tx. | **PASS — proven** |
| P15 | **NEW: `submitDisabled` predicate — client bypass?** | The predicate (`catalogEmpty = !plansLoading && planOptions.length === 0`; `submitUnavailable = plansLoading ‖ parentsLoading ‖ catalogEmpty`; `OnboardStudentDialog.tsx:115-116`) gates ONLY the shell save button (`FormDialogShell.tsx:77 disabled={loading || submitDisabled}`) and the `handleSubmit` belt (`OnboardStudentDialog.tsx:123-125`) — pure client UX. A caller bypassing it (direct GraphQL) gains nothing: the server independently re-enforces the admin gate (P7), the offline-method whitelist, the reference bounds (P11), plan existence/active/lane pre-tx AND in-tx (P3/P12), and parent-target validation (P2). The belt cannot leak or corrupt input (it returns before any assembly). Error/resolve release: Apollo `useQuery.loading` is false after error, so the gate cannot wedge permanently. | **PASS — server is the authority** |
| P16 | **NEW: `OnboardablePlan` type export — internal-field leak?** | `export type OnboardablePlan = PlanSelectType & { balanceLane: Exclude<…, null> }` (`student-onboarding.helpers.ts:76`) — a compile-time-only TS type (`export type`), consumed ONLY by `assertOnboardablePlan` (same file) and a `type`-only import in the service (`service.ts:67`). Repo-wide grep: zero frontend/shared/generated-schema references; not a Pothos type — nothing reaches the wire. The fix deduplicated the R2-02 literal exactly as prescribed (service local alias + unused `PlanSelectType` import dropped, `service.ts:75-82,90-92`). | **PASS — no leak** |
| P17 | **NEW: `planSection.emptyCatalog` key — PII / injection surface?** | Static localized copy in en (`"No active plans are available yet. …"`, `shared/locale/en/studentOnboarding/index.ts:27`) and ar (`…:44`), declared in the labels interface (`types:85`), rendered as plain text (P9). No interpolation of any user/entity value, no PII; parity enforced structurally (leaf walker) + at compile time. | **PASS** |
| P18 | **NEW: `FormDialogShell.submitDisabled` — regression on existing consumers?** | Strictly additive optional prop, default `false` (`FormDialogShell.tsx:31,43,77`); the other two callers (`LessonFormContent`, `PlanFormContent`) pass nothing — behavior byte-identical. The repo's other `submitDisabled` props belong to unrelated pre-existing components (session-governance/finances/wallet atoms) — no collision. Same check for `AdminUserGenderSelect.disabled` (additive optional; `CreateUserFormGrid`/`EditUserFormFields` unaffected). | **PASS** |

## New-changes deep-dive summary (since the last security pass @ `2f6f35e`)

- **`submitDisabled` (R3-F1/R2-03 fix):** the disable is a UX affordance, not a control — verified the SERVICE still enforces every predicate server-side (pre-tx ladder `service.ts:299-311` + in-tx re-read `:325`, constraint arbitration `:373-379`). Client bypass ⇒ same typed denials. The belt returning early cannot bypass client validation into a malformed payload (it returns BEFORE input assembly; the server maps field-by-field regardless).
- **`OnboardablePlan` export (R2-02 fix):** single declaration restored; type-only surface; zero client exposure (P16).
- **`planSection.emptyCatalog` (R3-F1 fix):** one additive key pair, static copy, no PII (P17); consumed at `OnboardStudentPlanSection.tsx:123`; the `!catalogEmpty &&` guard keeps server plan errors visible when the catalog is non-empty (`:124`).
- **Journey test delta (R2-04 fix):** test-only — `UserRole.Student` member + value import; no production surface touched.

## Findings

**Zero NEW findings this round.** Every probe (including all three new-changes probes) terminated PASS at the tip. Prior-round rows were independently re-verified rather than trusted:

| ID | Severity | File:line | Description | Disposition |
|---|---|---|---|---|
| — | (none new) | — | Candidate observation examined and dismissed: while the optional-parent feed is in flight the submit is gated even for unlinked onboards — verified self-releasing (Apollo `loading` is false on error/resolve), transient, and the exact accepted window already recorded as R6-02. Not re-reported as new. | No action — covered by R6-02 |

## Findings count

- **New (this round):** 0 — 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW / 0 INFO.
- **Fixed (prior, independently re-verified intact at tip this round):** 5 — R3-F1/R2-03 (MEDIUM), R2-01/R3-F2, R3-F3, R2-04, R2-02 (LOW) via fix wave `bfbe666` (verification evidence: P15/P16/P17/P18 + the fix wave's own recorded gates: tsgo 0, parity 50/50, service 22/22, journey 11/11).
- **Remaining (open from prior rounds):** 0 blocking. Accepted/no-action INFOs stand (R2-05…07, R3-F4…F7, R4-01…02, R5-01, R6-01…02 + the pre-existing out-of-scope comment row); D-ONB-007 deferred row present and ✅.

## Stop-condition tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 new |
| INFO | 0 new |

**Blocking total = 0 → stop condition met.** R7 (pentester lens, rescan of the current tip) independently concurs with R1–R6: every attacker walk of the write path — and all three post-fix change clusters — terminates in a typed, localized, zero-write-or-fully-atomic denial; the `student_payments` ledger is provably untouched; the client-side gating is demonstrably not a security control (the service is). The review loop remains concluded; no fix wave required.

## Method note (for future reviewers of this workspace)

1. **Concurrent branch flipping (hit repeatedly this round):** the shared working tree bounced between `main` (`07c2675`) and the feature branch between commands — one mid-session `git diff 6bf6c71..HEAD` returned main's 19-file diff, and one `git show HEAD:<plan>/worklog.md` failed on main. All reads in this review were therefore pinned to the REF (`git show bfbe666|6608c6d:<path>`, `git log <ref>`, `git archive <ref>`) or run as atomic `git checkout <branch> -q && …` chains; a `/tmp` git-archive snapshot of the 82 scope files was used for file reads. Never trust bare working-tree state in this sandbox.
2. **Terminal `[m`-swallow artifact (re-confirmed):** `useOnboardStudentMutation.ts:47` renders as `const utate, { loading }] = …`; byte-verified via `git show … | od -c` the real source is `const [mutate, { loading }] = useMutation(…)` — false alarm, exactly as R3/R4 recorded.
3. **Verification basis:** this is a read-only rescan; no suites were re-run. Backend fix-wave deltas (`2f6f35e..bfbe666`) are type-only (a moved/exported TS alias + import churn — zero runtime semantics), so the fix wave's recorded green gates (tsgo 0, parity 50/50, service 22/22, journey 11/11, documents 10/10) remain valid for the audited byte-state, which is identical at tip `6608c6d`.
