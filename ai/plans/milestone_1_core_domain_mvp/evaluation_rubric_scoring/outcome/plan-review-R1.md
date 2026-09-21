# Plan Review Report — evaluation_rubric_scoring (DEV2-007)

## Review Round: 1
## Date: 2026-09-21
## Subagents Dispatched: none (single-gate review per skill workflow; all 8 dimensions verified in this session)

---

## Summary

- **Total issues found:** 6
- **Blocking (CRITICAL/HIGH):** 0
- **Medium:** 3
- **Low/Notes:** 3

---

## Findings by Dimension

| Dimension | Subagent | Issues Found | Status |
|---|---|---|---|
| Paths Existence | verify-paths-exist | 3 | ✅ Fixed |
| i18n Compliance | verify-i18n-namespaces | 0 | ✅ Clean |
| GraphQL Accuracy | verify-graphql-accuracy | 1 | ✅ Fixed |
| Component Props | verify-component-props | 0 | ✅ Clean |
| Permissions/Enums | verify-permissions-enums | 0 | ✅ Clean |
| Existing Components | verify-existing-components | 0 | ✅ Clean |
| Architecture Compliance | verify-three-tier-architecture | 0 | ✅ Clean |
| Cross-Reference Consistency | verify-cross-ref-consistency | 2 | ✅ Fixed |

---

## Detailed Findings

### Dimension 1: Paths Existence

**Subagent:** `verify-paths-exist`

All ~60 `path:line` citations in specs.md §4 (G1–G38) and plan.md §2 Component Inventory were spot-checked against the working tree (branch `plans`); all resolve. Three off-by-one line refs found:

1. **[LOW]** `evaluationAlreadySubmitted` cited at `labels.ts:301` (actual `:300`)
   - **Location:** plan.md §5.3 error-code table
   - **Expected:** `labels.ts:300`
   - **Actual:** `labels.ts:301`
   - **Fix Applied:** corrected to `:300`

2. **[LOW]** `applicantNotInEvaluation` cited at `labels.ts:307` (actual `:310`)
   - **Location:** plan.md §5.3 error-code table
   - **Expected:** `labels.ts:310`
   - **Actual:** `labels.ts:307`
   - **Fix Applied:** corrected to `:310`

3. **[LOW]** `report` row-action descriptor cited at `teacherSessionCacheArms.ts:162-167` (actual `:160-164`)
   - **Location:** plan.md §2 Component Inventory ("Row actions" row) and §6 surface table
   - **Expected:** `:160-164`
   - **Actual:** `:162-167`
   - **Fix Applied:** corrected to `:160-164` (§2); §6 already cited the correct `:132-165` envelope

### Dimension 2: i18n Compliance

**Subagent:** `verify-i18n-namespaces`

All 7 new `errors` keys, 4 `applicant` notification keys, and ~10 `sessions` dialog keys are flagged NEW with a same-task triple-leaf (types + en + ar) + parity-test extension mandate (REQ-0.5.3, plan §6.2, Task 3). Verified: `errors-namespace.parity.test.ts`, `applicant-namespace.parity.test.ts`, `sessions-namespace.parity.test.ts` all exist; the reused keys (`sessionNotFound` :225, `teacherNotCertified` :229, `evaluationAlreadySubmitted` :300, `applicantNotInEvaluation` :310) all exist verbatim; `NotificationType.EvaluationResult` exists (:18 of the enum) with localized type labels in both locales; no key-name collisions in `applicant`/`sessions` namespaces. **Zero findings.**

### Dimension 3: GraphQL Accuracy

**Subagent:** `verify-graphql-accuracy`

1. **[MEDIUM]** SDL enum member casing wrong for the house convention
   - **Location:** plan.md §5.1 SDL sketch — `enum RubricWeaknessArea { TAJWEED HIFZ }`
   - **Expected:** PascalCase TS-enum member names (Pothos `enumType(TSEnum, ...)` maps the TS keys): `SessionType { ReEvaluation StudentSession TeacherEvaluation }`, `ApplicantStatus { Failed InEvaluation Passed Pending }` in `frontend/graphql/generated/schema.graphql`
   - **Actual:** SCREAMING_SNAKE members, which Pothos would never emit from the `RubricWeaknessArea` TS enum (`Tajweed`/`Hifz` keys)
   - **Fix Applied:** SDL sketch corrected to `enum RubricWeaknessArea { Tajweed Hifz }`

All other conventions verified clean: flat root mutation file (no named exports, `gqlSchemaBuilder.mutationField`, side-effect barrel import — matches `evaluation-booking.mutation.ts`), `$all: { authenticated: true, role: [...] }` conjunction form (matches `student-evaluation.mutation.ts:64-69`), `id` first on every object (canonical `SessionPage` reuse verified at `session.pothos.ts`), `{entity}QueryDocument`/`{verb}MutationDocument` naming, `DateTime` scalar exists (:600), `ApplicantStatus` Pothos enum registered (`enum.pothos.ts:114`).

### Dimension 4: Component Props

**Subagent:** `verify-component-props`

Verified: `teacherActionsForSession(session, wiring)` signature and `TeacherActionsWiring` extension point exist at `teacherSessionCacheArms.ts:132`; `RateTeacherDialog`/`EvaluationBookingDialog` precedents + Storybook stories exist; `myTeacherSessionsQueryDocument` carries `sessionType` + `intent` fields (session-reads.documents.ts:126-127) exactly as the row-gate relies on; `withPageAuth` exists; `error-link.map.ts` row pattern verified (`EVALUATION_ALREADY_SUBMITTED` → `evaluationAlreadySubmitted` row at :302-309). **Zero findings.**

### Dimension 5: Permissions/Enums

**Subagent:** `verify-permissions-enums`

Role model only — confirmed no permission-string tables exist and the plan invents none (G33 held). `UserRole` = Admin/Teacher/Student/Parent only (:6-10); the plan's evaluator gate is `teacher.is_approved && is_evaluator`, no invented role. `ApplicantStatus` already carries Failed/Passed vocabulary. **Zero findings.**

### Dimension 6: Existing Components

**Subagent:** `verify-existing-components`

All §4 signatures verified against code: `insertColdStartCertified(id, makeEvaluator, tx)` (:286), `elevateToCertified(id, makeEvaluator, …)` (:319), `findForEvaluationGateById` (:254, FOR UPDATE), `finalizeOnCertification(userId, tx?) → boolean` (:459), `transitionToInEvaluation` pattern (:407), `findForBookingGate` FOR UPDATE (:216), `insertOnce` 4-member Pick (:89-98 — the widening is correctly scoped), `emitForUser` (:42) + `publishReceipts` (:116), cold-start post-commit discipline (:216-237), `withTransaction(outerTx, fn)` (:42), `resolveCurrentEvaluationCycle`/`countEvaluationBookingsInCycle`/`listEvaluationSessionsForApplicant` (:138/:180/:225), `assertActorGovernanceClean` + `isPositiveSafeInteger`, `createJourneyFixtures(prefix)` (:141). **Zero findings.**

### Dimension 7: Architecture Compliance

**Subagent:** `verify-three-tier-architecture`

Client dialog → Apollo hook → mutation → Pothos resolver → service → repo: no layer violations. Server Components untouched (no new routes). Types canonical in `@/backend/types` (no local Pothos types — plan §4.1/§5.1 explicit). MUI v9 `sx`-only, `*Outlined` icons, theme-palette callbacks pinned (REQ-12.5). Logging: `logger.logDomainError` only, `notes` never logged (NFR-S2). Tests: `runInRollback` + `tx` + `expectRepoError` (never `rejects.toThrow`), journey tier committed-fixtures (no rollback) — both correct per layer AGENTS. **Zero findings.**

### Dimension 8: Cross-Reference Consistency

**Subagent:** `verify-cross-ref-consistency`

1. **[MEDIUM]** Three-way D4 divergence across the artifacts
   - **Location:** deferred-items.md D4 vs specs.md §11 D4 vs plan.md §12
   - **Expected:** one canonical set (specs §11): D4 = `average_rating` recompute + re-evaluation loop → Milestone 3 (`TICKETS.md:2143+`)
   - **Actual:** deferred-items D4 = re-evaluation only, generic "Milestone-3" pointer; plan §12 = "evaluator-side my-submitted-rubrics gallery" (stale — `myRubricEvaluation` is in-plan)
   - **Fix Applied:** deferred-items.md D4 rewritten to the specs §11 scope (average_rating + re-evaluation, explicit `TICKETS.md:2143+` + DEV2-006 D2-lineage pointer); plan.md §12 D-list rewritten to mirror the canonical D1–D4 verbatim (D3 reworded to the specs wording; stale D4 gallery mention dropped — the in-plan `myRubricEvaluation` query covers it)

2. **[MEDIUM — pre-flagged]** Literal emoji pattern in the Enforcement grep makes the final-gate grep count 1
   - **Location:** deferred-items.md §Enforcement code block
   - **Expected:** `grep -c "❌\|⚠️" deferred-items.md` → 0 at gate time while the rule stays documented
   - **Actual:** the block itself contained the literal `❌\|⚠️` → count 1
   - **Fix Applied:** command replaced with the emoji-free PCRE form `grep -cP "\x{274C}|\x{26A0}\x{FE0F}"` (U+274C / U+26A0+FE0F hex escapes) — same semantics, verified: it matches a seeded emoji file (count 1) and returns 0 on the patched ledger

REQ traceability (REQ-0..15) across specs §5 ↔ plan §14 ↔ tasks matrix verified complete and consistent; specs §11 was confirmed as the canonical D1–D4 set and required no edits.

---

## Fix Subagents Dispatched

| Subagent | Target Files | Findings Fixed | Status |
|---|---|---|---|
| plan-review gate (in-session) | `plan.md` | 4 fixes (§5.1 SDL casing; §5.3 two line refs; §2 report-descriptor ref; §12 D-list) | ✅ Complete |
| plan-review gate (in-session) | `deferred-items.md` | 2 fixes (D4 row; Enforcement grep block) | ✅ Complete |
| plan-review gate (in-session) | `specs.md` | 0 (canonical; no changes needed) | ✅ Complete |
| plan-review gate (in-session) | `tasks.md` | 0 (grep targets deferred-items.md only; no edits needed) | ✅ Complete |

---

## Post-Fix Verification

- [x] All stale references resolved (grep confirms: `grep -c "❌\|⚠️" deferred-items.md` → 0; PCRE form → 0 on the ledger, 1 on a seeded emoji probe)
- [x] No new tasks/components needed — all findings were reference/consistency fixes, not scope gaps
- [x] REQ-0..15 traceability complete across specs/plan/tasks
- [x] Quality loop n/a for markdown plan artifacts (sub-loop targets code files; this gate touched no code)
- [x] Re-run of the review dimensions post-fix confirms zero open findings

**Verification commands run:**
```bash
grep -c "❌\|⚠️" ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/deferred-items.md   # → 0
grep -cP "\x{274C}|\x{26A0}\x{FE0F}" ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/deferred-items.md  # → 0
```

---

## Lessons for Future Plans

- Copy-pasting the enforcement grep's emoji pattern into the ledger's own Enforcement section self-trips the gate — templates should ship the hex-escape PCRE form from the start.
- SDL sketches should be generated (or checked) against `frontend/graphql/generated/schema.graphql` conventions: Pothos `enumType` over TS enums yields PascalCase member names, never SCREAMING_SNAKE.
- The deferred ledger, specs §11, and plan §12 triple-state the D-ids; a single canonical source (specs §11) with the other two pointing at it verbatim avoids drift.

---

## Traceability

**Plan files modified:**
- `plan.md` — §2 report-descriptor line ref; §5.1 enum member casing; §5.3 two i18n key line refs; §12 deferred D-list reconciled to specs §11
- `deferred-items.md` — D4 row reconciled to specs §11 D4; Enforcement grep block made emoji-free
- `specs.md`, `tasks.md` — unchanged (verified clean)

**Outcome knowledge base updated:**
- This report saved as: `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/outcome/plan-review-R1.md`

---

## Next Steps

- [ ] Commit patched plan artifacts (plan.md, deferred-items.md, outcome/plan-review-R1.md)
- [ ] Flip the Task 1.5 checkbox in tasks.md and proceed to Phase 2 (Task 2: schema delta)

---

## Post-Gate Amendment (2026-09-21)

- `plan.md` UX section renumbered for heading-level integrity: `## 6.3 i18n Spec` -> `### 6.2 i18n Spec` (closes the 6.1 -> 6.3 numbering gap); cross-refs updated at the plan.md REQ-10/REQ-12 traceability rows and the tasks.md Task 3 i18n bullet. Editorial only — no semantic change; gate verdict unaffected.
