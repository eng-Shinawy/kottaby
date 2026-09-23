# Review Iteration R4 — Independent Re-Review (pentester lens)

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Task:** 6.1 (post-implementation review iteration R4 — independent reviewer, no prior-round context)
**Branch:** `feat/direct_student_onboarding_with_offline_payment` @ `2f6f35e`
**Method:** read of `.agents/skills/spec-implementation/SKILL.md` §"Post-Implementation Review Wave" (security scope) first, then adversarial probing of the write path (mutation → resolver → service → repos) over the plan's full diff (`git diff 6bf6c71..HEAD`). Read-only — no source files modified. Every verdict anchored to file:line evidence; suspicious terminal renders were hex-verified with `od -c` before being treated as findings (see Method note).

## Scope

- **78 files** in the plan diff (6bf6c71..HEAD); **52 code/test/generated files** (plan docs + outcome logs excluded as non-source).
- Write path deep-read: `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts`, `backend/graphql/pothos/admin/admin-student-onboarding.pothos.ts`, `backend/services/admin/student-onboarding.service.ts`, `backend/services/admin/student-onboarding.helpers.ts`, `backend/db/repo/parents/parent.repository.ts` (+diff), barrels.
- Pre-existing seams verified in-tree (not re-reviewed, load-bearing for verdicts): `assertActorAdmin` (admin-gate.helpers.ts:114 — re-export of the anonymous+role ladder), partial unique index `subscriptions_payment_reference_unique` (`backend/db/schema/billing/subscriptions.ts:42,54`), `AdminUserManagementService.createUser` (single identity writer), `StudentRepository.linkParentIfUnlinked` / `creditLaneBalance`, `withTransaction` (savepoint semantics), `translateDbError` (DomainError pass-through, 23505 → ConflictError).

## Probe table (attacker walk of the write path)

| # | Probe | Evidence (file:line) | Verdict |
|---|---|---|---|
| P1 | **BOLA/IDOR — parentId path**: can an attacker point the new student's parent link at an arbitrary id? | Resolver passes client `input.parentId` through, but the service pre-tx guard `assertParentAssociationTarget` requires the user row to exist (`USER_NOT_FOUND` on miss) and `assertLinkableParent` requires role===Parent AND an owned `parents` role-child row (`student-onboarding.service.ts:200-220`, `student-onboarding.helpers.ts:88-99`); in-tx the link runs through the guarded `linkParentIfUnlinked` with zero-row ⇒ `ConflictError` + rollback (`service.ts:223-241`). `parents` rows carry only shared PK + timestamps (repo docblock), so the validated target leaks nothing cross-tenant. | **PASS — no IDOR** |
| P2 | **BOLA/IDOR — planId path** incl. negative/zero id | `findOnboardablePlan` pre-tx + `resolveInTxPlan` in-tx both funnel through `assertOnboardablePlan` (`service.ts:117-136`, `152-176`, `helpers.ts:70-86`): unknown id ⇒ `PLAN_NOT_FOUND`; inactive plan or null lane ⇒ localized VALIDATION (fail-closed — lane never guessed). `planId: 0` / negative simply miss `PlanRepository.findById` → not found. | **PASS — fail-closed** |
| P3 | **BOPLA — GraphQL boundary**: can a tampered payload smuggle role/status/verified-at? | `AdminOnboardStudentOfflineInput` is a closed inputType with exactly the 10 whitelist fields (`admin-student-onboarding.pothos.ts:43-90`); `role`, subscription `status`, `paymentVerifiedAt` structurally absent from the wire type — GraphQL validation rejects unknown fields before the resolver runs. | **PASS** |
| P4 | **BOPLA — resolver + service mapping**: spreads / untyped passthroughs | Resolver maps field-by-field (`admin-student-onboarding.mutation.ts:77-89`); `mapToCreateUserInput` maps 7 fields and **hard-codes `role: UserRole.Student`** (`helpers.ts:106-117`) — a client payload structurally cannot mint an admin/teacher. Grep for `...` across all five runtime write-path files: zero spreads (docstring prose only). Audit details built by an explicit record literal, ids/enums/counts only (`helpers.ts:139-158`). | **PASS** |
| P5 | **BFLA — scope literal shape**: is the `$all` conjunction an inline literal (not a variable/shared constant)? | Hex-verified with `od -c` at `admin-student-onboarding.mutation.ts:68-72`: literal `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` inline in the field config. Anonymous ⇒ UNAUTHORIZED (401), authenticated non-admin ⇒ FORBIDDEN (403), both before the resolver body. No plain-map ANY-semantics shape anywhere in the diff. | **PASS** |
| P6 | **BFLA — service re-assertion**: does a teacher/student/parent JWT reaching the service still fail? | First statement of the service entry: `await assertActorAdmin(actorId, locale, outerTx)` (`student-onboarding.service.ts:297` area) — re-asserts the anonymous + admin-role ladder (`admin-gate.helpers.ts:114-116`) server-side, so a scope-layer bypass alone cannot reach a write. Grep: the service has exactly ONE production caller — the admin mutation. Actor id comes ONLY from `ctx.user.id` (`requireContextActorId`), never client input. | **PASS** (see R4-01 for the governance-window nuance) |
| P7 | **Injection — SQL/raw/LIKE** in the diff | Only raw SQL in the diff: `ParentRepository.findById` standalone path — static statement + `$1` bound parameter (`parent.repository.ts` diff, `queryDb` block); tx path is Drizzle `eq(parents.id, userId)`. No `ilike(`/`like(` constructions added (the new static-locks suite pins the no-LIKE set, `backend/services/parents/parent-link.static-locks.test.ts` §b). Diff-wide interpolation grep: hits only in test fixtures, never in a query string. `paymentReference` never enters any query text — it travels as a bound insert value. | **PASS** |
| P8 | **XSS — client rendering of returned fields** (`handshakeCode`, `fullName`, `email`) | Zero `dangerouslySetInnerHTML` / `innerHTML` in the diff and the whole `frontend/views/admin/students/` tree (grep). `OnboardStudentSuccessContent.tsx:44-55` renders all three as React text interpolation (`{t.success.handshakeCode(result.handshakeCode)}`, `{result.student.fullName} · {result.student.email}`) — auto-escaped; `userSelect: "all"` styling only. Password is structurally absent from the mutation result selection (`admin-student-onboarding.documents.ts` docblock + selection set). | **PASS** |
| P9 | **Business logic — duplicate-reference race** (constraint arbitration) | Arbitrated INSIDE the tx by the pre-existing partial unique index `subscriptions_payment_reference_unique … WHERE payment_reference IS NOT NULL` (`subscriptions.ts:42,54`); the outer catch maps a raw 23505 to the localized duplicate-reference conflict (`service.ts:381` area). NO pre-check SELECT (grep: no reference-existence read anywhere in the flow) — replay ⇒ `ConflictError`, zero double-billing, no TOCTOU window. | **PASS** |
| P10 | **Business logic — duplicate email race** | Same pattern: `users_email_unique` arbitrates inside the tx through the shared `createUser` writer (translated to its auth copy there); outer `translateDbError` passes DomainErrors through untranslated. No pre-check SELECT. | **PASS** |
| P11 | **Business logic — reference bounds** | `normalizePaymentReference` (`helpers.ts:52-62`): trims, rejects empty-after-trim (whitespace-only ⇒ VALIDATION) and >255 (column ceiling `varchar(255)`); the TRIMMED value is what is stored and arbitrated. Reference REQUIRED for all three offline methods. | **PASS** |
| P12 | **Secrets/log hygiene** | Audit rows: exactly two, in-tx, admin-attributed; details payload = ids/enums/counts + the admin-authored reference token — email/name/phone/password structurally absent (`helpers.ts:139-158`). All denials log via `logger.logDomainError` with code/entity/entityId only — no payload values, no credential material, zero `console.*` (static-locks §d). Error responses: DomainErrors carry localized copy; `translateDbError` masks raw DB errors — no stack/entity internals cross the boundary. | **PASS** |
| P13 | **INV-PAY5 — zero `student_payments` writes in the whole diff** | Diff-wide grep: every `student_payments`/`studentPayments` hit is prose, a `$count` probe, or the read-only census helper `countStudentPaymentsForReferences` (SELECT with innerJoin — tests only). Targeted grep for write shapes: `git diff 6bf6c71..HEAD \| grep -E '\.(insert\|update\|delete)\(studentPayments\|into\(studentPayments\|set\(studentPayments'` → **no matches**. The runtime write set is exactly: `users` + `students` + `students.parent_id` (guarded) + `subscriptions` + `student_subscriptions` + 2 audit rows, one tx. | **PASS — proven** |

## Findings

| ID | Severity | File:line | Description | Disposition |
|---|---|---|---|---|
| R4-01 | INFO | `backend/services/admin/student-onboarding.service.ts:297` (+ `admin-guards.helpers.ts:17-27`) | The service re-assertion uses the RELAXED BFLA gate (`assertActorAdmin`): a suspended/blocked/deleted admin holding an unexpired JWT passes the gate for the duration of the documented context-governance window (REQ-031; strict variant `assertActorAdminActive` exists and is reserved for governance mutations). The new surface adopts this pre-existing policy uniformly with all other admin mutations — no new behavior introduced. | Accepted — pre-existing policy decision with a tracked strict-backport ticket (D4 forward-ref in `admin-guards.helpers.ts`); not a defect of this plan. |
| R4-02 | INFO | `backend/services/admin/student-onboarding.service.ts:376-382` | The outer catch maps ANY raw 23505 inside the tx to the duplicate-**reference** conflict copy. Today this is precise — the only reachable raw 23505s are the reference partial unique (email and handshake collisions are translated to DomainErrors upstream by `createUser`) — but a future second unique constraint in the write set would be mislabeled as "duplicate payment reference" to the admin. | Advisory, non-blocking. Follow-up candidate: narrow the mapping to the `subscriptions_payment_reference_unique` constraint name when a second 23505 source enters the write set. |
| — | INFO (pre-existing, out of scope) | `backend/graphql/test/schema-surface.test.ts`, `frontend/graphql/test/warnings/warning-surfacing.test.ts` | Plan-artifact-style references (`REQ-032`, `REQ-060/061`, `D2`) in comments of two MODIFIED test files — all present verbatim at baseline `6bf6c71`; the diff hunks add none. | Logged only — already recorded by R2; pre-existing baseline content, not blocking. |

## Findings count

- **New (this round):** 2 — 0 LOW, 2 INFO (R4-01, R4-02). Zero CRITICAL/HIGH/MEDIUM.
- **Fixed:** 0 this round (no fix wave required). Prior-round fixes verified intact: R1 RF1/RF2 comment rewords clean in the current tree.
- **Remaining (open from prior rounds):** 0 blocking. 4 prior LOW advisories (R2-01…R2-04) remain open as non-blocking follow-up candidates; 3 prior INFOs (R2-05…R2-07) accepted; 1 pre-existing out-of-scope INFO row.

## Stop-condition tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 new (4 prior-round advisories remain open, non-blocking) |
| INFO | 2 new + 1 pre-existing out-of-scope |

**Blocking total = 0 → stop condition met.** R4 (pentester lens) independently concurs with the R1 sign-off and R2: every attacker walk of the write path (BOLA/BOPLA/BFLA/injection/XSS/business-logic/secrets/INV-PAY5) terminates in a typed, localized, zero-write-or-fully-atomic denial; no new blocking findings. The review loop can conclude without a further fix wave.

## Method note (for future reviewers of this workspace)

Two investigation hazards were hit and resolved during this round; recording them to save future rounds the cycles:

1. **Output-rendering artifact:** terminal output in this environment can drop `[m` substrings (ANSI-SGR-sanitizer residue), which once rendered `const [mutate, { loading }] = …` as `const utate, { loading }] = …` — an apparent syntax corruption that does not exist. Any finding that rests on "impossible code" in rendered output must be hex-verified (`od -c` / `git show <branch>:<file> \| od -c`) before being reported.
2. **Concurrent branch flipping:** the shared working tree was observed switching between `main` and the feature branch between commands (another agent session). All reads in this review were therefore anchored via `git show feat/direct_student_onboarding_with_offline_payment:<path>` and atomic `checkout && verify` chains, never on bare working-tree state.
