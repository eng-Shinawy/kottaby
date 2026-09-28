# Teacher Verification Plan Purchase (5 Sessions)

> Contract doc for the teacher-applicant verification-plan purchase flow. Sibling docs:
> `docs/teachers/applicant-lifecycle.md` (lifecycle states, cooldown, certification),
> `docs/teachers/applicant-cooldown.md` (the cooldown state machine that arms the
> `APPLICANT_COOLDOWN_ACTIVE` denial and the admin extension primitive behind it), and
> `docs/billing/subscription-purchase.md` (the shared payment pipeline this flow rides).

## What this flow does

A teacher applicant buys the fixed verification plan — 5 evaluation sessions over 14 days
(150 EGP in the seed catalog) — to enter evaluation. The purchase reuses the student payment
pipeline end-to-end (plans → `subscriptions` → `student_payments` → idempotency → webhook
activation) and adds only what the applicant shape requires: a nullable payment owner, a
guarded lifecycle flip, and an activation credit-skip.

## Wire contract

`purchaseVerificationPlan: PurchaseSubscriptionPayload!` — a ZERO-ARGUMENT mutation
(`backend/graphql/mutation/verification-plan-purchase.mutation.ts`):

- Identity comes ONLY from the session (`ctx.user.id`); the applicant gate is service-level,
  so post-certification re-application attempts still resolve cleanly instead of being hidden
  by a role scope.
- No plan id, no amount, no currency, no user id ever crosses the wire. The plan is resolved
  server-side from the ACTIVE catalog by exact title match on the shared constant
  `VERIFICATION_PLAN_TITLE` (`shared/constants/verification-plan.constants.ts`), which the
  seed also sources — one source of truth for the plan's identity and session count (5).
- The idempotency key rides the `x-idempotency-key` context header (client-minted UUID),
  never an argument.

## Purchase flow (`VerificationPurchaseService.purchase`, steps in order)

1. Localized translations handle; `isPositiveSafeId` guard (`purchase-guards.helpers.ts` —
   the same promoted helpers the student purchase service imports).
2. `assertActorGovernanceClean` — deleted/blocked/suspended callers are denied before any I/O.
3. `isCarryableIdempotencyKey` — missing/oversized key → `VALIDATION`; the key is never logged.
4. Plan resolve: `PlanRepository.listActive` → exact `VERIFICATION_PLAN_TITLE` match; missing →
   `PLAN_NOT_FOUND`.
5. Gateway checkout OUTSIDE the transaction (network boundary; mock adapter settles with
   `checkoutUrl: null` — no redirect).
6. ONE transaction: authoritative plan re-read → `assertCanPurchaseVerification` (cooldown
   strict `>`, `passed` → `APPLICANT_ALREADY_CERTIFIED`, missing applicant →
   `APPLICANT_NOT_FOUND`) → idempotency claim insert behind the 23505 savepoint discipline
   (same caller → `DUPLICATE_REQUEST`; foreign owner → oracle-safe `PAYMENT_NOT_FOUND`) →
   pending `subscriptions` row → `student_payments` row with **`student_id = NULL`** (the
   owner is `subscriptions.user_id`; the payment junction insert is deliberately skipped) →
   `recordReapplication` ONLY when the applicant status is `failed` (attempt +1) → guarded
   `transitionToInEvaluation` (single-statement UPDATE with `status IN ('pending','failed')`
   folded into WHERE + RETURNING; zero rows = already `in_evaluation` = silent no-op) →
   claim backfill with the subscription id.

## Activation (webhook) integration

`SubscriptionActivationService` keeps its money finality (paid + active window + receipt
notification) and resolves the lane credit with a **students-first probe**:

- `students` row present → `creditLaneBalance` exactly as the student flow (the credited-null
  abort unchanged);
- students absent + `applicants` row present → **lane credit intentionally skipped** — the
  5-session grant is enforced by the booking flow against the ACTIVE subscription, not by
  lane balance;
- neither row → the existing corruption abort (fail-closed), byte-identical messaging.

Notification emission (recipient = `subscription.userId`, persisted in-tx, published
post-commit) is unchanged. On a `failed` webhook the applicant stays `in_evaluation` with a
`pending` subscription — re-purchase from `in_evaluation` is allowed (the flip is a no-op), so
there is no status trap.

## Status semantics (purchase-time flip)

| Current status | Purchase result |
|---|---|
| `pending` | flip → `in_evaluation`, attempts stay 0 (first purchase) |
| `failed`, cooldown expired | attempts +1, flip → `in_evaluation` |
| `failed`, cooldown active | `APPLICANT_COOLDOWN_ACTIVE`, zero writes |
| `passed` | `APPLICANT_ALREADY_CERTIFIED`, zero writes |
| `in_evaluation` | allowed; new pending pair; flip is a silent no-op |

The guard and every write share the purchase transaction, so cooldown arming cannot race the
gate (TOCTOU closed by construction; no SELECT-then-UPDATE anywhere).

## Idempotency & replay

Same claim table as student purchases (generic `user_id`): a spent key replayed by its owner →
`DUPLICATE_REQUEST` (zero new rows); a key owned by ANOTHER caller → `PAYMENT_NOT_FOUND`
(oracle-safe — nothing about the owner leaks). Keys are client-minted per attempt and rotated
only on success; domain rejections keep the key so the retry replays the same claim.

## Error codes (all ride `errors[].extensions.code`, HTTP 200)

`UNAUTHORIZED` · `APPLICANT_NOT_FOUND` · `APPLICANT_COOLDOWN_ACTIVE` ·
`APPLICANT_ALREADY_CERTIFIED` · `VALIDATION` · `PLAN_NOT_FOUND` · `DUPLICATE_REQUEST` ·
`PAYMENT_NOT_FOUND`.

## Testing map

| Layer | File |
|---|---|
| Repo (transition) | `backend/db/test/repo/teachers/applicant.repository.transition.test.ts` |
| Repo (nullable owner) | `backend/db/test/logic/billing/student-payment.repository.test.ts` (+ admin audit parity in `…/admin.test.ts`) |
| Service | `backend/services/teachers/verification-purchase.service.test.ts` |
| Activation | `backend/services/billing/subscription-activation.service.test.ts` (students-first probe describe) |
| GraphQL | `frontend/graphql/test/teachers/verification-plan-purchase.test.ts` |
| Journey (cross-actor) | `test/workflows/teachers/verification-plan-purchase.journey.test.ts` |
| i18n parity | `shared/locale/applicant-namespace.parity.test.ts`, `shared/locale/errors-namespace.parity.test.ts` |

## Admin-audit note

`student_payments` rows with a NULL owner (verification purchases) are consistently excluded
from BOTH the admin audit count and listing (INNER join semantics on both) — self-consistent
totals, zero phantom pages. Surfacing them in the admin audit is a deliberate future surface
change (LEFT JOIN + owner display), tracked in the plan ledger.
