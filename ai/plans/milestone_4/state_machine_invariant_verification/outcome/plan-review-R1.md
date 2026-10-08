# Plan Review R1 — State Machine Invariant Verification

**Plan directory (verbatim):** `ai/plans/milestone_4/state_machine_invariant_verification`
**Reviewed artifacts:** `specs.md` (479 lines) · `plan.md` (413 lines) · `tasks.md` (203 lines) · `deferred-items.md` (81 lines) — plus the 12 research dossiers under `outcome/research/` (treated as verified research inputs, not review targets).
**Review method:** `plan-review` skill 5-step workflow (layer AGENTS.md compliance for `backend/db/test/logic/**`, `backend/services/**` test extensions, `test/workflows/**`, `docs/**`) + machine checks (REQ traceability loop, anti-pattern grep sweep, INV-ID cross-counts, truncation check) + 86 distinct live-tree `path:line` citation spot-checks.
**Ticket:** `docs/planning/TICKETS.md:2873-2910` · **Date:** 2026-10-08

---

## Round 1 — Verdict: FAIL (16 findings)

### HIGH (2 blocking)

| # | Finding | Disposition |
|---|---|---|
| F1 | `tasks.md` task 1.1 (Phase-1.5 gate) marked `[x]` while `outcome/plan-review-R1.md` did not exist — violates the plan's own REQ-000.4 gate chain | Re-opened to `[ ]`; re-flipped only after this file landed |
| F2 | Wire-tier command `bun run test:graphql` never discovers `backend/graphql/test/**` — `test/scripts/run-server-tests.ts:15` `DEFAULT_TEST_PATH = "frontend/graphql/test/"` — so the A3 wire deliverable would be silently skipped by baseline (task 0.1) and the all-green gate (task 5.1) while the census drift oracle stays green | Switched to `bun run test/scripts/run-test.ts backend/graphql/test/...` (per-test and layer-wide forms) across tasks rule 4, tasks 0.1/4.7/5.1, and `plan.md` §C6; remaining bare `test:graphql` strings are explanatory notes only |

### MEDIUM (9)

Line-cite drift traced to two dirty working-tree files (`backend/graphql/query/teachers/teacher-matching.query.ts`, `backend/db/test/repo/teachers/teacher.repository.test.ts`); live tree is authoritative:

- F3/F7/F14: `teacher-matching.query.ts` `:78` → `:81` (queryField registration), `:114-119` → `:123-128` (authScopes Student gate) — 10 sites across specs/plan/tasks.
- F4/F8/F15: `teacher.repository.test.ts:2443` → `:2447` (E4 `teacher_average_rating_check` trip test) — 4 sites.
- F5/F9: compose-rule journey trio `:2761/:2774/:2793` → `:2765/:2778/:2793` — 3 sites.
- F10: parent-monitoring test path corrected to `backend/db/test/repo/students/student.parent-monitoring.repository.test.ts:126-131`.

### LOW (4)

- F6: INV-P2 had no explicit task binding → task 4.4 census note now binds P1/P2/P4 by reference (corpus `:533`, SDL freeze `:1417`, handshake `:219`) + REQ-080 checklist row gained task 2.1.
- F11: "seven parent journeys" → "six" (`specs.md:371`; six journey files verified in `test/workflows/parents/`).
- F12: plan-directory verbatim callouts normalized (no trailing slash) across all four headers.
- F16: `plan.md` §5.4 gained the DIAGRAMS.md + `bun run validate:mermaid` rule (workflows AGENTS.md rule 13; teachers domain gains its missing `DIAGRAMS.md` in task 4.4).

### Fix wave (applied post-R1)

All 16 findings applied via targeted edits; `outcome/research/03-teacher-availability.md` gained a `## 7. Erratum (post-review)` appendix recording the drift (body untouched); task 6.1 gained the verified real logic-dir inventory (`admin, audit, auth, billing, classes, notifications, students, teachers, users` + planned `invariants/`).

---

## Round 2 — Verdict: PASS

Re-verification against the live tree (not the fix agent's claims), per finding:

- **Machine checks:** REQ traceability loop prints zero misses (every `REQ-[0-9]+` id in `specs.md` appears in `tasks.md`). Anti-pattern sweep clean: zero hits for `Translation.` enum, two-arg `getTranslations(`, `@/frontend/utils/logger`, `next-intl`, `shared/messages/`, bottom-nav, `useAppTranslation(`, `.documents.ts` (no GraphQL documents created); the 4 `bun test` hits are the FORBIDDEN-declaration negative mentions; the 2 remaining bare `bun run test:graphql` strings are explanatory notes about the default path.
- **Citation spot-checks:** all 16 corrected values re-verified on the live tree (`:81`, `:123-128`, `:2447`, `:2765/:2778/:2793`, six parent files, `run-server-tests.ts` constant); zero stray stale values anywhere in the four artifacts.
- **INV-ID cross-counts:** specs.md 67 · plan.md 67 (set-identical) · tasks.md 39 explicit + range-bound remainder · deferred-items.md 6 (exactly the PIN rows). Disposition tallies unchanged and consistent: 32 VERIFY-BY-REFERENCE · 24 EXTEND · 5 NEW-PROBE · 6 PIN-APP-LAYER+DOC-DRIFT = 67; verdicts 45 COVERED · 18 PARTIAL · 4 GAP.
- **Structure:** `plan.md` contains all mandatory sections (Overview+decisions D1–D5, Data Models with no-schema-change ruling, API/SDL no-change ruling + actor provisioning matrix, Services/Repo signatures + concurrency assessment + Journey Design incl. the 67-row §5.2 matrix, UX/Nav no-UI ruling, Security/Tenancy mitigations). No truncation — all artifacts end cleanly.
- **One residual LOW (introduced by the fix wave, applied immediately):** the two explanatory notes cited `run-server-tests.ts:16` for `DEFAULT_TEST_PATH`; the constant lives at `:15` (verified: line 15). Corrected in `tasks.md` rule 4 and `plan.md` §C6 during gate closure.

### Sibling boundaries confirmed (no re-authoring)

- `financial-safety-verification` (finished plan) owns the wallet CHECK probes, financial-immutability trigger tier, dual-confirmation journey, and concurrency races — this plan adds only residual probes (W3 23505, W5 trigger matrix, W4 arbitration read-back oracle, W7 app-layer pin).
- `workflow_tests_parent_journey_and_subscription_lifecycle` (finished plan) owns the INV-P legs and subscription chained journeys — this plan binds P1/P2/P4 by reference plus one P3 absence pin.
- Live Paymob E2E (`test:ui:e2e:paymob`) excluded: every INV-PAY invariant verified at unit/integration/workflow layers via the mock channel.

### Verdict

**Round 2: PASS — Plan passes all AGENTS.md rules for affected layers.**

Gate closed 2026-10-08. Task 1.1 re-flipped to `[x]` in `tasks.md` with this file as its evidence. The Phase 0 baseline command fix (`test:graphql` → `run-test.ts backend/graphql/test`) is recorded in tasks 0.1/5.1 so the implementation baseline and all-green gate exercise every file this plan ships.
