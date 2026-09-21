# Plan Review Gate — Round R1

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Reviewer scope:** `specs.md` · `plan.md` · `tasks.md` · `deferred-items.md` (+ `outcome/exploration-ground-truth.md` as seed ground truth)
**Methodology:** `.agents/skills/plan-review/SKILL.md` + root/layer AGENTS.md rules, verified against the live codebase (30+ `path:line` anchors spot-checked via Grep/Read).
**Date:** 2026-09-21

## Verdict

**PASS after R1 fixes.** All findings below were fixed in-place during this review round and re-verified. No blocking violations remain; residual risks are informational only.

## Review scope

1. Spot-checked 30+ existing-code `path:line` citations in plan.md/tasks.md against the real tree (schema columns/indexes, repo/service seams, census machinery, enum member lists, locale/server-graphql signature, workflow + GraphQL test helper exports, frontend hosts/documents/hooks, docs decision refs). All verified EXCEPT the citation drifts fixed below.
2. Anti-pattern sweep for invented symbols (see results below).
3. Cross-file consistency of canonical names across specs/plan/tasks.
4. Structure check (plan 9 sections; specs Actor Table + Ordered Step List + Cross-Actor EARS; tasks per-task .QL/.TE/.SEC/.SR/.IV + Phases 0/2.5/6/7).
5. Truncation check (last lines of all four files).
6. REQ traceability grep.

## Findings table

| ID | Severity | File:line (pre-fix) | Issue | Fix applied | Re-verified |
|---|---|---|---|---|---|
| R1-01 | Medium | `specs.md:284` (§4 REQ-010 row) | Service home named `direct-onboarding.service.ts` in `backend/services/billing/` — conflicts with plan D1 / tasks 2.4 (`backend/services/admin/student-onboarding.service.ts`) | Rewritten to the canonical admin/ service path + name | ✅ `student-onboarding.service.ts` now in 3/3 files |
| R1-02 | Medium | `specs.md:284` (same row) | Mutation file named `admin-onboarding.mutation.ts` vs plan/tasks `admin-student-onboarding.mutation.ts` | Renamed to `admin-student-onboarding.mutation.ts` | ✅ grep clean for the old name |
| R1-03 | Medium | `specs.md:207` (REQ-020.1) | Placeholder mutation signature `adminOnboardStudent(input: AdminOnboardStudentInput!): AdminOnboardStudentPayload!` diverged from the canonical naming used by plan/tasks | Replaced with canonical `adminOnboardStudentWithOfflinePayment(input: AdminOnboardStudentOfflineInput!): AdminOnboardStudentResult!` | ✅ mutation name now in 3/3 files |
| R1-04 | Medium | `specs.md:186` (§2.9 J-3 step 1) | "no `paymentReference`" for scholarship conflicted with plan D3's required-reference decision | Reworded: the leg supplies a unique admin-provided reference, REQUIRED for all three methods; D-ONB-002 tracks future relaxation | ✅ plan D3/J3-1 deviation notes updated to "reconciled at plan-review R1" |
| R1-05 | Low | `specs.md:224` (REQ-030.2) | "reference field, required for cash/bank-transfer" implied optional for scholarship — contradicted D3 | Made required for all three methods with D-ONB-002 pointer | ✅ |
| R1-06 | Medium | `deferred-items.md` (ledger table) | plan §8 pre-registers D-ONB-003 (admin parents-directory surface) but the ledger only seeded D-ONB-001/002 | Added the D-ONB-003 row (status ✅ re-pointed at a future UX ticket); updated ledger self-references + tasks 0.1 seed list | ✅ `grep -c "D-ONB-003"`: deferred-items 3, plan 1, tasks 1 |
| R1-07 | Low | `plan.md:79`, `plan.md:443`, `tasks.md:150` | Census 1:1-oracle citation `:1662-1663` wrong — the `countAuditRowsForActor(adminA.userId) === executedActions.length` oracle actually lives at `audit-completeness.journey.test.ts:1582,1646` | Corrected to `:1582,1646` (and fixed `adminA` → `adminA.userId`) | ✅ verified at both lines in-tree |
| R1-08 | Low | `specs.md:227`, `specs.md:291` | `withPageAuth.ts:66` off by one — the function is declared at `:67` | Corrected to `:67` | ✅ verified in-tree |
| R1-09 | Low | `specs.md:67` (REQ-001 details) | Named a hypothetical `adminOnboarding` namespace; plan/tasks mint `studentOnboarding` | Changed to `studentOnboarding` with plan §5.5 pointer | ✅ namespace in 3/3 files |
| R1-10 | Low | `specs.md:215` (REQ-020 details) | Result type left unnamed ("result type") | Named `AdminOnboardStudentReturnType` | ✅ in 3/3 files |
| R1-11 | Low | `specs.md:299` (DoD #2) | Journey file unnamed in specs | Added `test/workflows/admin/direct-student-onboarding.journey.test.ts` | ✅ in 3/3 files |

## Traceability grep (re-run post-fix, from repo root)

```bash
for r in $(grep -oE 'REQ-[0-9]+' .../specs.md | sort -u); do grep -q "$r" .../tasks.md || echo "MISSING: $r"; done
# Output: (empty — no MISSING lines)
# REQ ids found in specs.md and all present in tasks.md:
# REQ-000 REQ-001 REQ-010 REQ-011 REQ-012 REQ-013 REQ-014 REQ-015 REQ-020 REQ-030
```

## Truncation check

Last lines of all four files end cleanly (no mid-sentence/mid-table truncation):
- `specs.md` — ends with the Glossary table (`Zero-residue | … test/workflows/AGENTS.md:12-19`)
- `plan.md` — ends with the §9 traceability consumers note
- `tasks.md` — ends with the Dependency-Ordered Summary table (`7.1 | Canonical doc + outcome`)
- `deferred-items.md` — ends with the Related Documents list (execution-guide line)

## Anti-pattern sweep results (all clean)

- `Translation.` enum access: only negative-rule mentions ("no `Translation.` enum") — no usage.
- `SUPER_ADMIN`/`super_admin`: only negative-rule mentions + the "role enum is exactly four members" verification — no invented role.
- Two-arg `getTranslations`/`getServerTranslations`: none; every usage is the verified one-arg form (`shared/locale/server-graphql.ts:3`).
- `@/frontend/utils/logger`: none used; backend rejections use `@/backend/lib/logger` `logger.logDomainError`.
- Raw `bun test`: none — every test invocation is `bun run test/scripts/run-test.ts <path>` (or `test:services`/`test:graphql` layer scripts).
- Bottom-nav / `grp_*` / `AppDataGrid` / `PageContainer` / `requirePermissionForPage` / `RequirePermission` / `AppPermission`: only as verified-absence negative claims.
- Invented columns/tables/enums: none — all cited schema elements verified in-tree (`subscriptions.payment_method/payment_reference/payment_verified_at` + partial unique, `students.handshake_code/parent_id`, offline `payment_gateway` members, `subscription_credit_lane` members, `audit_action_type` members, `user_role` members).
- Invented permission strings: none (role-based gating only, matching `builder.ts` scope reality).

## Spot-check evidence highlights (30+ anchors verified)

`subscriptions.ts:38-43,54-56` (columns + partial unique) · `students.ts:24-32,40` · `user-management.service.ts:261-266,267,297-302` (createUser + trial dormancy + `assertActorAdmin` call) · `subscription-admin-settle.helpers.ts:43-49,76,98` · `student.repository.ts:163,373,440` · `user-provisioning.helpers.ts:30,43,54,118` · `audit.service.ts:82` · `subscription-admin.helpers.ts:354` · `plan.repository.ts:131` · `subscription.repository.ts:70` · `parent.repository.ts:21` · enum files (`enums.ts:9,56-66,68-74,86,102-110` + TS mirrors) · `errors.ts:37,44,51,65,171` · `enum.pothos.ts:70,226,266` · `admin-user.pothos.ts:225-227,298-305,317-331` · `subscription.pothos.ts:53-54,84-96` · `user-management.helpers.ts:334` · `admin-user.types.ts:160,192-197,209-217` · `admin-gate.helpers.ts:114` (`assertActorAdmin` — plan's citation verified; `admin-guards.helpers.ts:35` re-exports it) · census: `catalog.ts:47-59` (`AdminActionCensusEntry`), `journey.test.ts:362-377` (`record()`), `:1010-1011`, `:1582,1646`, `drift.test.ts:282-330` · `server-graphql.ts:3` (one-arg `getServerTranslations`) · workflow helpers (`actor-context.ts:88,122,136`, `session-cast.ts:314`, `journey-fixtures.ts:226`, `tracked-fixtures.ts:173`) · `test/helpers` (`test-lifecycle.ts:41`, `graphql-test-helpers.ts:8`, `expect-mutation-error.ts:33`, `fixture-rows.ts:69`, `db-cleanup.ts:83,123,143`) · frontend (`AdminStudentsToolbar.tsx` EXISTS, `admin-students.documents.ts:47`, `FormDialogShell.tsx:12-31` props, `navItems.ts:126-127`, `AdminUsersDirectoryContainer.tsx:47-54`, `message.ts:44,56` `<ns>Translations` registry) · docs refs (`open-decisions-and-gaps.md:35-40,123-127`, `state-machine-invariants.md:302`, `functional-requirements.md:263-264`).

## Residual risks

1. **Census composite-row extension is the plan's highest-risk item** (plan §4.7 / tasks 2.2): the additive `secondaryExpectedAuditRows` machinery touches a shared test oracle; tasks 2.2 correctly gates it with a before/after drift-test regression lock. Implementation must re-cite live line ranges (they will shift as the files change).
2. **Line citations drift naturally** as the codebase evolves; the plan already mandates re-anchoring in tasks 0.2/2.2/4.4 outcomes. The two off-by-one drifts found here (R1-07, R1-08) suggest implementers keep re-verifying rather than trusting citations blindly.
3. **Plan D3's required-reference contract** is now uniform across specs/plan/tasks, but the relaxation decision (D-ONB-002) remains a live product question post-M3; the ledger row is ✅ re-pointed, not deleted.
4. No code was executed in this review (plan-only gate); all verification was static (grep/read against the live tree).

**Gate decision: PASS — plan is approved for Phase 0 implementation start.**
