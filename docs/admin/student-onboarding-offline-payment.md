# Admin Direct Student Onboarding with Offline Payment — Canonical Reference

**Domain:** Admin / Direct student onboarding (Workflow 05 — identity-provisioning + offline-settlement composite)
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (§5 Payment Invariants, INV-PAY5)
**Status:** Implemented and verified

This document is the single canonical reference for the admin direct-onboarding surface — the `adminOnboardStudentWithOfflinePayment` mutation that provisions a student identity and activates a paid subscription in ONE gated call, for students who settle at the desk by cash, bank transfer, or scholarship. All layers (types, repos, services, GraphQL, frontend, tests) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

> Scope note: this document may cite spec anchors (INV-* invariants) — that is house style for canonical docs. The `docs/specs/*` files are **read-only for this surface**: it mints no new invariants and binds INV-PAY5 by reference. The sibling admin half that provisions identity WITHOUT payment is [`user-management.md`](./user-management.md); the gateway-settled purchase half of the lifecycle is [`../billing/admin-subscription-management.md`](../billing/admin-subscription-management.md).

---

## 1. Why

A walk-in student pays at the admin desk — cash, a bank transfer slip, or a scholarship waiver — and needs a working account in the same breath: identity, active subscription, lane credit, and the parent link when one exists. No gateway session, no webhook, no `student_payments` ledger row exists for these settlements; the payment's evidence lives ON the subscription row itself (`payment_method`, `payment_reference`, `payment_verified_at` — INV-PAY5).

Splitting that into "create user" + "activate subscription" would either publish a credential-less, subscription-less student on a partial failure or force a second admin action to recover. The surface therefore makes the composite the unit of work: one mutation, ONE transaction, two audit rows, and a deniable-before-any-write ladder. The flow reuses the identity single-writer (`AdminUserManagementService.createUser`) instead of forking a second users+students writer, and reuses the lane-credit and audit machinery instead of inventing per-flow variants — every rule below exists because the composite must be atomic, admin-attributed, and free of ledger detours.

Implementation anchors:

| Layer | Surface |
|---|---|
| Input/result types | `backend/types/admin/admin-student-onboarding.types.ts` (`AdminOnboardStudentSubmitInput` — the ten-field whitelist), Pothos refs in `backend/graphql/pothos/admin/admin-student-onboarding.pothos.ts` |
| GraphQL mutation | `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts` (`adminOnboardStudentWithOfflinePayment`) |
| Service | `StudentOnboardingService.onboardStudentWithOfflinePayment` (`backend/services/admin/student-onboarding.service.ts`) with pure helpers in `backend/services/admin/student-onboarding.helpers.ts` |
| Composed writer | `AdminUserManagementService.createUser` / `getUserDetail` (`backend/services/admin/user-management.service.ts`), gate `assertActorAdmin` (`backend/services/admin/admin-gate.helpers.ts`) |
| Repositories | `SubscriptionRepository.insertSubscription`, `StudentRepository.creditLaneBalance`, `StudentRepository.linkParentIfUnlinked`, `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts`) |
| Frontend | dialog tree under `frontend/views/admin/students/onboarding/`, documents in `frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.ts` |

---

## 2. Pattern — the Composite Transaction

One service call performs five write families inside ONE `withTransaction(outerTx, …)` closure (`backend/lib/db/with-transaction.ts`); the caller's `outerTx` joins as a savepoint when provided, and the SAME `tx` is propagated to EVERY repository/service call — a bare-`db` call inside the flow is a bug, not a style issue.

1. **Identity via the single writer.** `AdminUserManagementService.createUser(mapToCreateUserInput(input), actorId, locale, tx)` provisions `users` + the `students` role child (with the registration handshake and its retry) and mints the user's `Create` audit row. The mapping (`mapToCreateUserInput`, `backend/services/admin/student-onboarding.helpers.ts`) is field-by-field — never a spread — and hard-codes the role to `student`: the wire input has no role field, and this surface must never become a role-elevation path. The initial credential rides the mapping's password field and is never echoed back.
2. **Plan re-read + lane resolution in-tx.** The plan is re-read inside the transaction and narrowed by `assertOnboardablePlan` (catalog-active + lane configured, fail-closed) so a plan deactivated mid-request cannot be settled against.
3. **Guarded parent link (optional).** With a `parentId`, `StudentRepository.linkParentIfUnlinked(studentUserId, parentId, tx)` links only an unlinked student to a linkable parent; a vanished-row (zero-row) result fails the transaction loudly as a conflict rather than committing a half-composite.
4. **The offline activation twin.** `buildOnboardSubscriptionInsert` is the admin-settle insert's offline twin (`backend/services/billing/subscription-admin-settle.helpers.ts` `insertAdminPeriodSubscription` is the gateway-flow sibling): it inserts via `SubscriptionRepository.insertSubscription` with `status: Active` directly — no `pending` leg — and stamps the evidence triple `paymentMethod`, `paymentReference` (the trimmed, admin-authored token), and `paymentVerifiedAt = now`; the window is one fresh interval, `end = start + intervalDays × 86_400_000`.
5. **Lane credit + junction + second audit row.** `StudentRepository.creditLaneBalance(studentId, lane, plan.sessionCount, tx)` credits the plan's lane exactly once; the `student_subscriptions` junction row (via `tx.insert(studentSubscriptions)`) anchors ownership; and the subscription `Create` audit row is minted via `AuditService.createAuditLog` with details from `buildOnboardAuditDetails`. The flow returns a fresh detail read through `AdminUserManagementService.getUserDetail(…, tx)` composed on the SAME transaction, plus `creditedLane`, `creditedSessions`, and the generated handshake code.

```graphql
# Illustrative — authoritative shape lives in the generated SDL.
input AdminOnboardStudentOfflineInput {
  fullName: String!  email: String!  phone: String!  password: String!
  gender: Gender  country: String!
  parentId: Int          # null ⇒ onboard without a parent link
  planId: Int!
  paymentMethod: PaymentGateway!   # OfflineCash | BankTransfer | Scholarship
  paymentReference: String!        # REQUIRED for all three methods
}
type AdminOnboardStudentResult {
  student: AdminUserDetail!  subscription: StudentSubscription!
  creditedLane: SubscriptionCreditLane!  creditedSessions: Int!  handshakeCode: String!
}
```

The result carries the one place the handshake code is rendered (the post-submit success view); the credential is structurally absent from the payload — it cannot be leaked by a consumer.

---

## 3. Offline-Payment Invariants (INV-PAY5)

- **Zero `student_payments` writes.** The service and helpers never touch the payments ledger — no INSERT, UPDATE, or DELETE reference exists in this surface. The runtime proof is the journey suite's `student_payments` count-delta = 0 probes on every path, and the census-journey's producer footprint. Gateway-settled payments keep their own ledger; desk settlements keep theirs on the subscription row.
- **Evidence triple on the subscription.** `payment_method` / `payment_reference` / `payment_verified_at` (columns in `backend/db/schema/billing/subscriptions.ts`) ARE the payment record for this surface. The audit row preserves the reference as the admin-authored evidence token — the one free-form value the trail is allowed to carry on this flow.
- **Reference REQUIRED for all three offline methods.** `OfflineCash`, `BankTransfer`, and `Scholarship` are equally evidence-bearing: there is no reference-exempt method. `normalizePaymentReference` trims and enforces length 1–255 (the `payment_reference varchar(255)` column ceiling); an empty-after-trim or 256-character reference is a localized pre-transaction validation denial. The frontend duplicates the 255 ceiling as a client convenience (backend runtime machinery must not ride into the client bundle) — the server re-validates authoritatively.
- **Constraint-arbitrated uniqueness — no pre-check races.** Duplicate references are arbitrated by the partial unique index `subscriptions_payment_reference_unique` (`… WHERE payment_reference IS NOT NULL`), translated at the seam by `translateDbError(error, <localized duplicateReference copy>)` (`backend/lib/errors.ts`) into a localized `CONFLICT`. The flow NEVER pre-checks with a SELECT — a check-then-insert would race two concurrent admins onto the same reference, and the constraint already answers the question atomically. Duplicate emails arbitrate the same way through `users_email_unique` inside `createUser`.
- **Denials never mint evidence.** Every guard (§6) runs before the transaction opens; a denied call leaves `subscriptions`, `users`, lanes, and audit rows byte-identical.

---

## 4. The Two-Audit-Row Composite Census

This flow is the FIRST composite (two-row) audit producer among admin mutations, and the census machinery (`test/workflows/admin/audit-completeness.catalog.ts`) extends to match:

- **Catalog row:** `ADMIN_ACTION_CENSUS` entries were one-expected-row producers until this surface. The entry for `adminOnboardStudentWithOfflinePayment` carries the primary expectations (`expectedEntityType: "user"`, `expectedActionTypes: [Create]`) PLUS `secondaryExpectedAuditRows: [{ entityType: "subscription", expectedActionTypes: [Create] }]` — the declared contract that a single execution mints BOTH rows.
- **Runner:** `censusRunners["adminOnboardStudentWithOfflinePayment"]` (in `test/workflows/admin/audit-completeness.journey.test.ts`) executes the real service path once and records BOTH rows: the user `Create` row (details `{ role: "student" }` — the identity seam's contract) and the subscription `Create` row (details mirroring `buildOnboardAuditDetails` exactly: `studentUserId`, `planId`, `parentId`, `paymentMethod`, `paymentReference`, `creditedLane`, `creditedSessions`).
- **Drift lock:** the census-drift suite (`backend/db/test/logic/audit/audit-census-drift.test.ts`) keeps the mutation ↔ row bijection exact — a shipped admin mutation without a census row fails CI, and a census row whose runner under-records (one row for a two-row producer) fails the whole-table zero-missing oracles.
- **Details vocabulary:** both rows carry ids, enum members, and counts only — plus the payment reference, which is the audit trail's sanctioned evidence token for this flow. Names, emails, phones, and credentials are structurally absent from the payload builder.

Future composite producers MUST extend the same machinery (declare secondaries in the catalog; record every row in the runner) rather than minting unaudited second rows.

---

## 5. The Admin Dialog Surface (Frontend)

The surface lives inside the existing admin students directory — no new routes, no nav changes. The toolbar gains ONE primary "Onboard student" button (`AdminStudentsToolbar.tsx`); `AdminStudentsDirectoryContainer.tsx` owns open/success state and composes the hooks.

- **Dialog chrome:** one `Dialog` on the shared `FormDialogShell` (`frontend/views/admin/forms/FormDialogShell.tsx`) — title / cancel / save / saving / global error band come from the shell, never bespoke scaffolding. Host: `OnboardStudentDialog.tsx`, which owns the flat draft state (reset on every close affordance), client-side submit validation, plan pre-binding (first active catalog plan as the derive-on-arrive fallback), the GraphQL-ID → safe-int parse, and the server/client error merge (`{ ...serverFieldErrors, ...clientFieldErrors }`).
- **Four sections, in order:** Profile (`OnboardStudentProfileSection.tsx` — identity + initial credential, rendered `type="password"` / `autoComplete="new-password"` with an in-place visibility toggle — an input echo, never a rendered copy) → Parent (`OnboardStudentParentSection.tsx` — optional autocomplete over parent-role directory rows; empty selection means "onboard without a link") → Plan (`OnboardStudentPlanSection.tsx` — selectable outlined cards over ACTIVE catalog plans, title / sessions · interval · lane / price+currency) → Offline Payment (`OnboardStudentPaymentSection.tsx` — three-segment exclusive toggle over the offline gateway tokens + the required reference field with its 1–255 helper copy; the scholarship leg gains a client-side quick-generator (`SCH-` + 8 unambiguous crypto-random characters — a data-entry accelerator only; uniqueness is still arbitrated by the partial unique index)).
- **Success handoff:** `OnboardStudentSuccessContent.tsx` swaps in post-submit — the student identity block (name + email), the handshake code (select-on-tap; the one place it renders — plus the clipboard copy affordance), and the credited-sessions line, animated in behind a tinted success badge. The credential is absent from the mutation payload and never rendered. Two actions close the view: **Onboard another student** (the restart affordance — the container clears its success payload + server feedback, the dialog clears its draft, and the empty form returns WITHOUT a close, so back-to-back onboardings skip the reopen) and **Done** (the dialog's own close path).
- **Hooks trio** (`frontend/views/admin/students/onboarding/hooks/`): `useOnboardStudentMutation` wraps the shared document `adminOnboardStudentWithOfflinePaymentMutationDocument` (`frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.ts`) with `refetchQueries` on the admin students directory query using the CALLER'S live page/filter variables — the refreshed row lands on the page the admin is looking at, never a hardcoded page 1; `useOnboardStudentFormFeedback` is the `runWithFeedback` seam — it clears both stores, awaits the submit action once, and projects rejections into field-keyed inline errors (server-localized, rendered verbatim) or the global error band; `useOnboardingPlanOptions` feeds the two option lists (active catalog plans by construction; parent-role directory rows).
- **Copy:** the `StudentOnboarding` namespace handle (`shared/locale/namespaces/studentOnboarding`, typed by `StudentOnboardingLabels` in `shared/locale/types/studentOnboarding`) — compile-typed handles only, no string-literal namespaces, en/ar parity suite locked.

---

## 6. Authorization Layering & the Zero-Write Denial Ladder

Three layers, defense in depth:

1. **GraphQL scope gate (pre-resolver):** `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` written as an INLINE LITERAL in the mutation file — see the anti-patterns section for why the literal shape is load-bearing. Anonymous callers die here with `UNAUTHORIZED`; authenticated non-admins with `FORBIDDEN`, both before any resolver logic.
2. **Context narrowing:** `requireContextActorId` (`backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts`) narrows `ctx.user` server-side; the actor id is server-bound and never an argument. The resolver maps the ten input fields FIELD-BY-FIELD into the service call and propagates `ctx.locale` — no try/catch, no local types, no business logic.
3. **Service re-assertion:** `assertActorAdmin(actorId, locale, outerTx)` (`backend/services/admin/admin-gate.helpers.ts`) is the service's FIRST action — a direct service caller that bypassed GraphQL still hits the gate.

The service's denial ladder is deterministic and ENTIRELY pre-transaction (zero writes, zero audit rows on every arm): anonymous → non-admin → non-offline `paymentMethod` → reference empty/`>255` after trim → unknown plan → inactive or lane-less plan (fail-closed) → unknown parent user → non-parent target / parent without a role-child row. Only AFTER the ladder passes does `withTransaction` open; duplicates (email, payment reference) are the sole in-transaction denials, and both arbitrate through UNIQUE constraints (§3). Expected rejections are logged via the domain-error logger with ids only.

---

## 7. Rules

- **One transaction, `tx` to EVERY call.** All five write families ride the `withTransaction(outerTx, …)` closure; `createUser`, the plan re-read, the parent link, the subscription insert, the lane credit, the junction insert, the audit write, and the detail read all receive the same `tx`/`outerTx`. Mixed `tx`/`db` inside the flow is prohibited — a bare call can commit work the rollback must erase.
- **Constraint-arbitrated duplicates.** `translateDbError` at the transaction seam maps `23505` to the localized conflict copy; DomainErrors pass through untranslated. No pre-check SELECT for email or reference existence, ever.
- **One-argument translations.** Copy resolves through the compile-time single-argument translation tree (`locale` parameter, server translations); errors carry canonical `extensions.code` values (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION`, `CONFLICT`, `USER_NOT_FOUND`, `PLAN_NOT_FOUND`) with localized messages — no invented machine keys, and the resolver never masks or re-writes them.
- **Closed whitelist at every hop.** Ten explicit input fields on the wire; `mapToCreateUserInput` maps field-by-field (never a spread); the role, subscription `status`, and `paymentVerifiedAt` are server-authored and structurally unreachable from client input.
- **Audit details hygiene.** Ids, enum members, counts — plus the payment reference as the sanctioned evidence token. No names, emails, phones, or credentials in either audit row, on any path.
- **Pure helpers.** The helpers module performs zero DB access and zero I/O; validation throws typed localized errors and everything else is pure derivation (`buildOnboardSubscriptionInsert`, `buildOnboardAuditDetails`, the gateway set).
- **Fail-closed plan narrowing.** An inactive plan or a plan without a configured lane denies with a localized validation error — a settlement against a lane-less plan cannot exist.

---

## 8. What NOT to Do

- **DO NOT write the `student_payments` ledger from this surface** (INV-PAY5). Desk settlements record evidence on the subscription row only. Adding a payments-ledger write here forks the payment-authority model and breaks the zero-ledger-movement contract pinned by the journey.
- **DO NOT replace the inline-literal `$all` authScopes with a plain map or a shared constant.** A plain `{ authenticated: true, role: [Admin] }` map carries ANY-semantics (either scope suffices) instead of the required conjunction, AND a shared-constant gate is invisible to the audit-census drift classifier — the field would silently drop out of the admin-gated census bijection. The literal must stay multi-line and byte-shaped like the sibling admin mutation files.
- **DO NOT pre-check duplicates with SELECTs.** No "does this email/reference exist?" read before insert; the partial unique index plus `translateDbError` is the entire arbitration story, and a check-then-insert reintroduces the race the constraint closes.
- **DO NOT fork a second identity writer.** Users + students are provisioned ONLY through `AdminUserManagementService.createUser` composed with `mapToCreateUserInput` (role hard-coded). A parallel INSERT path would fork the handshake minting, the email-conflict translation, and the user audit row's contract.
- **DO NOT spread unvalidated input** into any write or mapping call — not at the resolver, not in the mapping helper. The whitelist is closed field-by-field at every hop.
- **DO NOT touch `student_payments` "for consistency," mint audit rows outside the flow's transaction, or write audit rows on denials.** Both rows live inside the composite transaction; denials append zero rows.
- **DO NOT widen the surface beyond admin callers or add it to the public-operations allowlist.** The scope gate and `assertActorAdmin` are both load-bearing; this mutation is not public allowlist material.
- **DO NOT import backend runtime machinery into the client bundle** (e.g. the server's reference-length constant) — the frontend re-declares the 255 ceiling locally and the server remains authoritative.
- **DO NOT use string-literal locale namespaces.** Copy is accessed through the `StudentOnboarding` typed handle; new copy extends the namespace's en/ar leaves with parity-suite coverage.

---

## 9. Rollout Summary

This surface ships:

- `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts` — the mutation field (thin resolver, inline-literal `$all` scope, field-by-field delegation) + Pothos input/result refs in `backend/graphql/pothos/admin/admin-student-onboarding.pothos.ts`.
- `backend/services/admin/student-onboarding.service.ts` — the composite pipeline; `backend/services/admin/student-onboarding.helpers.ts` — the pure gate/mapping/insert/details helpers.
- `backend/types/admin/admin-student-onboarding.types.ts` — the ten-field input and result types.
- `frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.ts` — the typed shared document (id-first selections).
- `frontend/views/admin/students/onboarding/` — the dialog tree (host + four sections + success content + view types) and the hooks trio; the toolbar button and container wiring in `frontend/views/admin/students/AdminStudentsToolbar.tsx` / `AdminStudentsDirectoryContainer.tsx` with the live-directory variables returned by `frontend/views/admin/students/hooks/useAdminStudentsDirectory.ts`.
- `shared/locale/{en,ar}/studentOnboarding` — the flow's namespace (errors, section labels, success copy) with runtime en/ar parity.
- Census extension: the composite catalog row + runner in `test/workflows/admin/audit-completeness.catalog.ts` / `audit-completeness.journey.test.ts`.

Test locks: `backend/services/admin/student-onboarding.service.test.ts` (gate/denial/happy/chaos tiers, zero-ledger and two-audit-row assertions), `test/workflows/admin/direct-student-onboarding.journey.test.ts` (cross-actor journey — three offline legs, read-backs, denial matrix with zero-movement probes), `backend/db/test/logic/audit/audit-census-drift.test.ts` + `test/workflows/admin/audit-completeness.journey.test.ts` (composite census), `frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.test.ts` (document contract), `shared/locale/studentOnboarding-namespace.parity.test.ts` (en/ar parity).

---

## 10. Related Documents

- [`../billing/admin-subscription-management.md`](../billing/admin-subscription-management.md) — the gateway-settled admin subscription lifecycle (the offline activation twin's settle-shape sibling, the audit-verb mapping, and the census convention this flow's composite row extends).
- [`user-management.md`](./user-management.md) — the identity single-writer contract this flow composes (`createUser`/`getUserDetail`), the audit-write contract, and the directory the onboarding affordance mounts into.
- [`../specs/state-machine-invariants.md`](../specs/state-machine-invariants.md) — INV-PAY5 (§5 Payment Invariants): the offline direct-onboarding bypass of `student_payments` with evidence carried on the subscription row.
- `backend/services/billing/subscription-admin-settle.helpers.ts` — `insertAdminPeriodSubscription`, the gateway-flow settle insert this surface's offline twin mirrors.
- Authoritative implementations: `backend/services/admin/student-onboarding.service.ts`, `backend/services/admin/student-onboarding.helpers.ts`, `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts`, `frontend/views/admin/students/onboarding/OnboardStudentDialog.tsx`.
- Test locks: `backend/services/admin/student-onboarding.service.test.ts`, `test/workflows/admin/direct-student-onboarding.journey.test.ts`, `test/workflows/admin/audit-completeness.journey.test.ts`.
