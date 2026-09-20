# Post-Implementation Review — Round 1 (Wave)

**Plan**: `ai/plans/milestone_1_core_domain_mvp/Admin Subscription Management-admin-subscription-management/`
**Scope**: `git diff --name-only c4971c6` (75 files: ~45 source/test, rest plan artifacts + generated)
**Reviewers**: 4 parallel read-only agents — review-types, review-backend, review-frontend, pentester (independent, fresh context)
**Baseline filter**: Phase 0 baseline is fully green (tsgo 0 / biome 0 / lint pass) — all findings are feature-specific.

## Findings & dispositions

| # | Severity | Lens | Location | Finding | Disposition |
|---|----------|------|----------|---------|-------------|
| B1 | MEDIUM | backend | subscription-plan-change.helpers.ts:292 | Service-layer `FOR UPDATE` on students table (layer violation) | FIXED — `StudentRepository.findByIdForUpdate` extracted; helper delegates |
| B2 | MEDIUM | backend | subscription-admin.helpers.ts:99 + service.ts:319 | renew claim key composed inline twice (drift risk) | FIXED — single `renewClaimKey(sourceId)` builder used at both sites |
| F1 | MEDIUM | frontend | subscriptionAdmin.helpers.ts | Pure client-side contracts (action matrix, days gate, reason clamp, lane filter, sort) had no tests | FIXED — `subscriptionAdmin.helpers.test.ts` added (13 tests, green ×2) |
| F2 | MEDIUM | frontend | SubscriptionAdminSection.tsx:108 + ChangeSubscriptionPlanDialog | Plans-catalog loading rendered as false "no eligible plan" empty state | FIXED — `plansLoading` threaded; skeleton/disabled select while loading |
| B3 | LOW | backend | subscription-proration.helpers.ts:74 | `ProrationComputation.newSessionCount` computed, never consumed | FIXED — dropped from interface + computation sites |
| B4 | LOW | backend | subscription-admin.service.ts:178 | Unreachable `!Number.isFinite(days)` leg (isInteger supersedes) + comment misattribution | FIXED — redundant leg removed, comment corrected |
| B5 | LOW | backend | subscription-admin.helpers.ts:257 | `CANCEL_REASON_MAX_LENGTH` exported unused; "200" hardcoded in pothos description | FIXED — pothos description composed from the constant |
| B6 | LOW | backend | verification-purchase.service.test.ts | Missing mirrored reserved-key denial test for the verification purchase surface | FIXED — mirrored test added (suite 19/19 green) |
| B7 | LOW | backend | subscription-plan-change.helpers.ts:373 | Plan-change denials logged with misleading "cancel denied" label | FIXED — log label parameterized per flow |
| B8 | LOW | backend | admin.helpers:188 vs plan-change.helpers:220/252 | Near-identical insert/settle pairs risk lockstep drift | FIXED — shared builders extracted, parameterized by lane write; tests byte-green |
| B9 | LOW | backend | subscription.repository.ts:186 | timestamptz equality vs ms-precision JS Date (sub-ms rows → spurious conflict) | FIXED — predicate changed to `end_date < $newEndDate` (replay ⇒ zero rows preserved; sub-ms safe); repo tests updated (20/20) |
| F3 | LOW | frontend | dialogs/index.ts + hooks/index.ts | Dead barrels vs users-surface convention | FIXED — consumers import through barrels (convention-consistent option) |
| F4 | LOW | frontend/i18n | ar/subscriptionAdmin/index.ts:54,50 | Arabic count copy hardcoded singular for 3–10 (ungrammatical) | FIXED — pluralization-aware templates per repo i18n conventions (en+ar), parity updated |
| F5 | LOW | frontend/i18n | CancelSubscriptionDialog.tsx:102 | Reason counter prefix composed outside the namespace | FIXED — routed through a namespace function leaf |
| S1 | LOW | security | subscription-admin.helpers.ts:352 | `coerceSubscriptionId` bare `Number()` accepts non-canonical wire ids | FIXED — canonical-decimal gate mirrored from `coerceUserId` |
| S2 | LOW | security | subscription-proration.helpers.ts:72 (+2 sites) | Legacy int-overflow sessionCount → raw 22003 → 500 instead of localized denial | FIXED — `sessionCount ≤ MAX_SESSION_COUNT` re-asserted at ceiling checks; settled total clamped |

## Verification after fixes

- `bun tsgo`: 0 errors
- `bun biome:check`: 0 warnings (2074 files)
- Tests (×2 identical): service 73/0 · repo 20/0 · purchase 22/0 · verification 19/0 · locale parity 21/0 · helpers 13/0 — **168/168 green**
- Per-file QL (`sub-loop --lifecycle duplicates`): exit 0 on all touched files

## Verdict

**PASS after fixes** — 16/16 findings fixed and verified. No CRITICAL findings. Round 2 follows as an independent re-review.
