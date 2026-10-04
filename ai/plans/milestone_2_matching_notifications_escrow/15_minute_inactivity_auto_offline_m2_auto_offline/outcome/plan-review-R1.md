# Plan Review Gate — Round R1 (Phase 1.5)

**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/`
**Date:** 2026-10-04
**Reviewer:** plan-review skill via isolated review subagent (read-only; ~70 path:line anchors audited against the working tree)
**Input files:** `specs.md` (46 REQs, banded REQ-001..095), `plan.md` (D1-D10, §1-§13), `tasks.md` (Tasks 0-18, 5-stage pipelines), `deferred-items.md` (DEF-1..6)

## Verdict (R1)

**1 BLOCKING violation found** — all other dimensions passed. Fixes applied same-session (below); targeted re-verification round R2 dispatched to the same reviewer.

## R1 Findings & Resolution

### V1 (BLOCKING — backend/graphql layer rule) — RESOLVED

- **Finding:** `recordMyActivity` resolver was prescribed to call `UserRepository` directly with inline `withTransaction` business logic — violating `backend/graphql/mutation/AGENTS.md` ("Field resolvers delegate to the `backend/services/` layer — never to repositories directly and never with inline business logic"). Grep proof: zero of ~40 `*.mutation.ts` files import `@/backend/db/repo`; the sibling toggle resolver it claimed to mirror delegates to `TeacherAvailabilityService` (`teacher-availability.mutation.ts:86`).
- **Fix applied:** hoisted the transaction composition into `AuthService.recordMyActivity(userId): Promise<boolean>` (plan.md §4.5.2 — the service `user.mutation.ts` already imports; "I am alive" is a session-activity concern). The resolver is now a one-line delegation (plan.md §5.1); specs REQ-014.2 and tasks Task 10 rewritten service-first; architecture diagram (plan.md §1.2) updated. The per-request context stamp in `gqlContextFactory` was explicitly NOT flagged — in-file precedent at `:259`, and the context factory is not a field resolver.

### V2 (anchor discrepancy — schema-surface citation) — RESOLVED

- **Finding:** "spread at `:1128`, `:1279`, `:1507`" conflated three sibling inventories (query block / mutation block / type-names block); the mutation-fields spread exists only at `:1279` (const at `:944`).
- **Fix applied:** corrected in plan.md §5.1, specs REQ-060.2, tasks Task 10 → "const at `:944`, spread in the single mutation-assertion block at `:1279`".

### Non-blocking notes — ALL addressed

| # | Note | Resolution |
|---|---|---|
| N1 | D4-D9 had zero label references in tasks/specs (substance covered, labels missing) | D-labels added: D1→Task 0.3, D2→Task 6, D3→Task 12, D4/D5→Task 4, D6/D7→Task 5, D8→Task 11, D9→Task 2 |
| N2 | Task 15 would leave `docs/teachers/teacher-availability.md:174` ("exactly one repo method that writes the boolean") self-contradictory once the sweep primitive ships | REQ-081.2 + Task 15 now explicitly amend that sentence to name both `TeacherRepository` primitives |
| N3 | Hook test under-specified (`useAuth` throws outside provider; no `renderHook` under bun:test; Apollo API unstated) | REQ-015.1 now pins `useMutation(recordMyActivityMutationDocument)` from `@/apollo/client/react`; REQ-075.1 + Task 12 specify `mock.module` stubs for `@/frontend/hooks/auth` + `@apollo/client/react` (or provider-wrapped consumer component) |
| N4 | §4.2 doc comment "INV-A-inactivity" garbled label | Cleaned to domain language ("Inactivity sweep primitive") |
| N5 | §4.3 vs §10 disagreed on sweep-failure log owner | §10 now states the cron endpoint envelope owns failure surfacing (`cron-endpoint.ts:152-157`); service adds no catch |
| N6 | Coalesce-window export + dual-branch precedent wording imprecise | §4.1 now distinguishes the optional-executor shape (queryDb fallback, `platform-analytics.repository.ts:117-140`) from the write-side guarded precedent (`sweepExpiredScheduledOnce`), and justifies the EXPORT (in-tree consumer `gqlContextFactory`; knip-safe) |
| N7 | Wire-test placement matches sibling practice (`backend/graphql/test/`) | No action needed (noted) |
| N8 | Scalar mutation's `id`-field exemption | Already explicitly acknowledged in REQ-061.1 (noted) |

## What passed clean in R1 (no changes needed)

Canonical types (`backend/types/` only; `TeacherInactivitySweepReturnType`), zero-DDL claim (no task introduces DDL), guarded-write/Drizzle discipline (single-statement UPDATE…RETURNING, tx propagation, no `inArray`+prepared-statement hazard, no inline `--` comments), repo-layer rules (namespace pattern, no error strings in repos), i18n (verified one-arg APIs; zero-locale-keys ruling confirmed sound), logging (meta-first frontend logger path correct), test conventions (rollback/journey/wire/runner all correct), GraphQL document rules, Pothos authScopes/identity (BOLA), MUI (zero UI), anti-pattern scan (no `Translation.` enum, no two-arg `getTranslations`, no raw `bun test` on workflows, no `resolveEnvConfig`/`env-config-keys.ts`, no phantom scheduler artifacts, no invented paths — all ~70 anchors exact), REQ traceability (46/46 REQs covered in tasks.md, zero MISSING), subtask pipelines (all implementation tasks carry `.QL/.TE/.SEC/.SR/.IV`).

## R2 (re-verification)

Targeted re-review of the applied fixes dispatched to the same reviewer (context retained). Verdict:

> **"Plan passes all AGENTS.md rules for affected layers."** — all 7 fix verifications ✓ (resolver delegation across all three files with grep-proof of zero residual direct-repo resolver patterns; schema-surface citation corrected; all ten D-decisions label-referenced; doc self-contradiction mandate added; hook-test seams fully specified; cosmetics aligned; regression sweep clean — REQ traceability zero MISSING, anti-pattern scan clean, all 14 implementation tasks still carry the 5-stage pipeline).

One remaining anchor nit (`useAuth.ts:11-13` → actual guard at `:8-10`) — **fixed post-R2** in `specs.md` REQ-075.1 and `tasks.md` Task 12.

## Gate status

- [x] R1 complete: 1 blocking violation found and fixed; all non-blocking notes addressed
- [x] R2 verdict recorded: **"Plan passes all AGENTS.md rules for affected layers."**
- [x] GATE CLOSED — plan ratified for implementation (2 review rounds total; sibling-plan precedent: pre-implementation gates cut post-implementation rounds from 5-12 to ~3)

