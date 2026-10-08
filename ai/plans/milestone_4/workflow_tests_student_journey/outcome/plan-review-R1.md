# Phase 1.5 Plan Review — Round R1 (Verdict Record)

**Plan:** `ai/plans/milestone_4/workflow_tests_student_journey` · **Reviewed:** 2026-10-08
**Inputs:** `specs.md` + `plan.md` + `tasks.md` (+ `deferred-items.md`, `outcome/0-planning-outcome.md`)
**Method:** `plan-review` skill workflow — affected-layer mapping → layer AGENTS.md read → cross-cutting dimension checks → citation spot-verification (grep/read of every load-bearing anchor) → anti-pattern sweep → traceability loop → truncation check.

## 1. Affected layers & rule files read

| Path touched | Layer law read |
|---|---|
| `test/workflows/students/student-full-journey.journey.test.ts` (new) | root `AGENTS.md`, `test/workflows/AGENTS.md` (all 12 rules), `.agents/instructions/tests.instructions.md` |
| `test/workflows/helpers/journey-fixtures.ts` (comment-only, task 2.1) | `test/workflows/AGENTS.md`, `backend/AGENTS.md` context |
| `docs/testing/workflow-journey-tests.md` (examples list, task 2.3) | docs conventions (no AGENTS.md rule file) |

No `app/`, `frontend/`, `backend/services|graphql|db` files are created or modified by this plan — it is a test-only ticket (the production-code dimensions below are therefore consumption checks, not authoring checks).

## 2. Findings (R1) — all FIXED in-plan before verdict

**F1 — [TEST-FACTS] specs.md REQ-004.2 + §7; plan.md D7: invented env-var location**
→ Expected: cited env state must match the real repository (`verify-then-claim`).
→ Plan had: "`PAYMENT_GATEWAY_PROVIDER=mock` in `.env.test`".
→ Verified reality: `.env.test` does NOT set it; the factory DEFAULTS to `"mock"` when the var is unset (`backend/lib/env.ts:415`; `.env.example:384` documents the switch; runtime guard refuses mock only in real production — `payment-gateway.factory.ts:83`). The no-network assumption itself HOLDS.
→ **Fix applied:** all three spots re-cited to the factory-default fact.

**F2 — [TEST-FACTS] specs.md REQ-005.3 + §5.2 step 5; plan.md §4.2/§7/§8; tasks.md 1.2: wrong denial-code label**
→ Expected: denial codes must be the exact codes the cited precedent asserts.
→ Plan had: "UNAUTHENTICATED-family" for the anonymous GraphQL probe.
→ Verified reality: precedent asserts **`UNAUTHORIZED`** (anonymous) and **`FORBIDDEN`** (parent/teacher) — `subscription-purchase.journey.test.ts:735-737, :767-770` (`expectSingleDenial(result, "FORBIDDEN")` / `"UNAUTHORIZED")`).
→ **Fix applied:** 8 occurrences across all 3 files renamed to the exact codes (grep re-check: 0 remaining, 6 corrected `UNAUTHORIZED` references present).

**F3 — [TEST-PATHS] plan.md §3.1: vague/invented table citation**
→ Plan had: "`admin` (schema/admin)" — no such directory.
→ Verified reality: `admin` table at `backend/db/schema/users/admin.ts:10`.
→ **Fix applied:** citation firmed.

**F4 — [TEST-PATHS] plan.md §3.2: vague audit-table citation**
→ Plan had: "`audit_logs` | audit schema".
→ Verified reality: `auditLogs` exported at `backend/db/schema/audit/audit-logs.ts:30`.
→ **Fix applied:** citation firmed to export + path:line.

**F5 — [TEST-RULES] reviewed-and-cleared tension (NO fix needed, documented):**
`.agents/instructions/tests.instructions.md` warns "NEVER call `getServerTranslations` from `@/shared/locale/server-graphql` directly in tests — causes the i18n loader to hang", while `test/workflows/AGENTS.md:33-36` (rule 6) PRESCRIBES exactly that call for journey error assertions. Resolution: the layer-specific law wins for `test/workflows/` — the hang applies to the `runInRollback` loader context of `backend/db/test/`, and the live journey precedent uses the direct import safely (`session-lifecycle-denials.journey.test.ts:59` import, `:71` `getServerTranslations("en").errorsTranslations`). The plan's REQ-001.3 keeps the layer-law prescription and now cites the precedent.

## 3. Cross-cutting dimension checks (plan-review skill step 4)

| Dimension | Result |
|---|---|
| Type imports (canonical `@/backend/types`) | PASS — plan consumes existing types only; invents no types, no Pothos files |
| Service boundaries | N/A — no components; journeys call services directly per `docs/testing/workflow-journey-tests.md:16-28` |
| MUI v9 | N/A — explicit no-UI ruling (specs §4) |
| i18n | PASS — translated substrings via `getServerTranslations("en").errorsTranslations` (layer rule 6 + F5 precedent); zero hardcoded English asserts; zero `Translation.` enum usage; zero locale keys minted |
| Logging | PASS — no `console.*` anywhere in plan artifacts or the planned suite |
| Test conventions | PASS with documented exception — `runInRollback` is FORBIDDEN here by `test/workflows/AGENTS.md:8-11` (the ticket's stale wording is reconciled by ruling R1); `expect().rejects.toThrow()` forbidden (REQ-001.3); committed fixtures + tracked teardown (REQ-014) |
| GraphQL documents | N/A — no Apollo documents created; the only GraphQL touch is the in-process schema harness (ruling R2, precedent-copied) |

## 4. Verification passes beyond the skill checklist

- **Citation spot-verification:** all load-bearing anchors re-verified by direct grep/read during review — gateway default (`env.ts:415`), denial codes (`:735/:767`), harness lines (`:200-260`), wallet repo (`wallet.repository.ts:59, :78`), `confirmCompletionInTx` (`:123`), `graphQLSchema` (`gqlSchema.ts:25`), `Context` (`gqlContextFactory.ts:49`), admin/users/audit tables (`admin.ts:10`, `users.ts`, `audit-logs.ts:30`), entity-setup anchors (`:169, :180, :550`), `journeyPrefix` (`:314`), `TrackedFixtures` (`:173`), cleanup helpers (`db-cleanup.ts:83, :229`), TICKETS.md blocked-by rows (`:66, :401, :962, :1853, :2509`), fee/trial constants, `plans.balanceLane` + `SubscriptionCreditLane`, browse filters (`teacher.repository.matching.helpers.ts:131-137`), teacher fixture recipe (`on-demand-matching.journey.test.ts:113, :119, :435, :455-465`), registration echo (`registration.types.ts:106-109`).
- **Traceability loop:** `for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done` → **zero misses** (REQ-000…REQ-014 all mapped; matrix at tasks.md tail).
- **Truncation check:** last line of every artifact (`specs.md`, `plan.md`, `tasks.md`, `deferred-items.md`, `outcome/0-planning-outcome.md`) ends on a complete section — no mid-sentence/mid-table cutoffs.
- **Anti-pattern sweep:** zero hits for `Translation.` enum, two-arg `getTranslations`, `@/frontend/utils/logger`, raw `bun test test/workflows` (approved runner mandated instead), bottom-nav, invented paths (F3/F4 were the only path defects, both fixed).
- **Structure check (mandated sections):** plan.md contains Overview+decisions (D1–D8) ✓ · Data Models ✓ · API Contracts + SDL + permission matrix ✓ · Services signatures + concurrency assessment + Journey Design ✓ · UX/Nav spec (explicit no-UI) ✓ · Security/Tenancy mitigations ✓.

## 5. Verdict

**R1 found 4 fixable findings (F1–F4) + 1 cleared tension (F5). All fixes were applied to `specs.md`, `plan.md`, and `tasks.md` immediately; post-fix grep confirms zero residual occurrences.**

**Final verdict: Plan passes all AGENTS.md rules for affected layers (root, test/workflows, tests.instructions). ZERO unresolved violations. Implementation may begin with Task 0.1.**
