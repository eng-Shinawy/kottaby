# Review Iteration — Round 4 (independent)

**Scope**: full feature diff vs baseline c4971c6 (source files only)
**Reviewer**: independent full-lens agent (types/backend/frontend/security), fresh context. R1-R3 fixes verified holding; R3 fixes themselves audited (int4 boundary accepted exactly at 2147483647; headroom boundary correct; remount semantics intentional).

## Findings & dispositions

| # | Severity | Location | Finding | Disposition |
|---|----------|----------|---------|-------------|
| R4-1 | LOW | subscription-plan-change.helpers.ts:375 | Lock-order inversion vs expiry sweep (students before subscriptions vs sweep's reverse) → possible 40P01 deadlock surfaced as 500 | FIXED — lock order now subscriptions→students (owner lock + proration read moved after source flip, held to commit) + `40P01` leg in `toSubscriptionAdminDomainError` → localized conflict; unit probe test added |
| R4-2 | LOW | subscription.repository.ts:200 | Concurrent extends with different day counts → stale audit `previousEndDate` pre-image under READ COMMITTED | FIXED — locking read (`findByIdForUpdate` on subscription repo) makes the opening read the true pre-image; `lt(endDate, newEndDate)` kept as replay backstop; concurrency test now proves the true pre-image chain (E→E+10→E+20, 2 audit rows) |
| R4-3 | LOW | subscriptionAdmin.helpers.ts:121 | `parseExtendDays` accepted > Int32 → protocol-layer English engine copy leaked into dialogs | FIXED — transport bound at 2147483647 (`MAX_WIRE_INT32`); server ceiling stays authoritative; boundary tests added |

## Verification after fixes

- tsgo 0 errors; QL (biome + oxlint) 0 issues on all 7 touched files
- Tests ×2: service 76/0 · repo 20/0 · helpers 15/0

## Verdict

**PASS after fixes** — 3 LOW concurrency/fidelity/UX-copy edges fixed; convergence trend continues (16 → 5 → 5 → 3 findings).
