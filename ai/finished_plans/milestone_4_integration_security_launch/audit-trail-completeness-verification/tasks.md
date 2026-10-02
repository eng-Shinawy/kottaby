# Tasks: Audit Trail Completeness Verification

## Document Information

- **Feature**: Audit Trail Completeness Verification (Milestone 4)
- **Plan Directory**: `ai/plans/milestone_4_integration_security_launch/audit-trail-completeness-verification`
- **Spec**: `specs.md` · **Design**: `plan.md` · **Ledger**: `deferred-items.md` · **Outcomes**: `outcome/`

## Non-Negotiable Execution Protocol for All Tasks

1. Read ALL files in `outcome/` before starting any task; write `outcome/<task-id>-outcome.md` after; flip `[ ]`→`[x]`.
2. Per modified/created file: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` must exit 0 before the next file is touched.
3. Semantic checklist per subtask: actorId from ctx/user (never input), no `{...input}` spreads into audit contracts, value-import enums, translated error messages only, caller-tx atomicity, zero dead code, no REQ/task refs in comments.
4. Test layers: workflows via `bun test test/workflows/...`; backend logic via `bun run test/scripts/run-test.ts`; never raw `bun test` on `backend/db/test/**`.
5. Denial assertions: try/catch helper + translated substrings; never `.rejects.toThrow()`.

## Mandatory Subtask Pipeline (every implementation task X.Y)

- `QL` quality loop (sub-loop.ts --lifecycle duplicates, exit 0)
- `TE` tests (tiers 1–4 as scoped; real-DB for census journeys)
- `SEC` security/tenancy audit (BOLA/BOPLA/BFLA + input sanitization)
- `SR` semantic review (atomicity, dead code, cross-layer, clean comments)
- `IV` instruction verification (read files printed by sub-loop discovery)

## Layer-to-Instructions Mapping

| Files | AGENTS.md | Instructions |
|---|---|---|
| `backend/services/**` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `.github/instructions/backend.instructions.md` |
| `backend/graphql/mutation/**` | `backend/graphql/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/db/test/**` | `backend/db/test/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `test/workflows/**` | root + `test/workflows/AGENTS.md` | `tests.instructions.md` |
| `docs/**` | root | — |

## Phase 0 — Pre-Implementation Baseline (blocking)

- [x] 0.1 **Record baseline**: tsgo error count, biome warnings, lint JSON snapshot → `outcome/phase0-baseline.md`; confirm `deferred-items.md` ledger pre-seeded (D-001..D-004); probe anchors in census plan (grep-verify each file:line cited in G-05..G-13).
  - _Requirements: REQ-000_

## Phase 1 — Plan Review Gate (blocking)

- [x] 1.1 **Plan review**: invoke the `plan-review` skill on this plan directory; fix ALL findings; re-run until clean; write `outcome/plan-review-R1.md`.
  - _Requirements: REQ-000_

## Phase 2 — Census & Anti-Drift (foundation)

- [x] 2.1 **CREATE `test/workflows/admin/audit-completeness.catalog.ts`**: `AdminActionCensusEntry`, `ADMIN_ACTION_CENSUS` (9 wired + 4 deferred rows per plan §Component 2), `ACTION_TYPE_COVERAGE` exhaustive record; `export *` from a NEW `test/workflows/admin/` barrel if the layer convention requires (check sibling journeys' import style first).
  - QL + TE (type-level: exhaustiveness breaks on enum change) + SEC (no secrets in catalog) + SR + IV
  - _Requirements: REQ-010, REQ-042.3_
- [x] 2.2 **CREATE `backend/db/test/logic/audit/audit-census-drift.test.ts`**: corpus walk of `backend/graphql/mutation/**`; extract admin-gated mutation fields (plain-map AND `$all` forms); bijection vs census wired rows; corpus sanity ≥9; deferred rows reference existing ledger ids; negative self-test harness (helper accepts an injected extra field and the assertion fails).
  - QL + TE (t1: both directions; t2: malformed authScopes blocks skipped honestly; t4: injected fake mutation fails) + SEC + SR + IV
  - _Requirements: REQ-020_

## Phase 3 — Plan-Catalog Emission (gap G-06)

- [x] 3.1 **MODIFY `backend/services/billing/plan-catalog.service.ts`**: new actorId-threaded signatures (plan §Component 4 order); `assertActorAdmin` gate first; emissions at the three seams (`createPlan`→Create, `updatePlan`→Update, `setPlanActiveStatus`→Suspend/Reactivate); `buildPlanAuditContract` helper colocated (name-unique, no barrel collision).
  - QL + TE (tier1 all three paths; tier2 unknown id / already-in-status / empty patch; tier3 concurrent toggles via Promise.allSettled leave consistent trail; tier4 non-admin actorId denied before any write) + SEC + SR + IV
  - _Requirements: REQ-030.1–.4, REQ-070.1–.2_
- [x] 3.2 **MODIFY `backend/graphql/mutation/plan-catalog.mutation.ts`**: thread `ctx.user.id` into the three resolvers (assert non-null as in session-lifecycle mutations); authScopes unchanged.
  - QL + TE (resolver wiring covered by service tests + journey; add GraphQL-level assertion only if the layer's convention requires) + SEC (BFLA re-check) + SR + IV
  - _Requirements: REQ-030.5..6_
- [x] 3.3 **Outcome**: `outcome/3.x-plan-catalog-outcome.md` (seam consumption, signature ripple, test deltas).

## Phase 4 — Dispute Arbitration Emission (gap G-07)

- [x] 4.1 **MODIFY `backend/services/classes/session-lifecycle.service.ts`**: one `AuditService.createAuditLog` inside `resolveSessionDispute`'s `withTransaction` after guarded update (+refund ordering for Cancel); shape per plan §Component 5.
  - QL + TE (tier1 Cancel+Complete both mint; tier2 notePresent false/true; tier4 bad-state denial mints zero) + SEC (note content excluded) + SR + IV
  - _Requirements: REQ-031.1–.3_
- [x] 4.2 **Regression sweep**: existing `session-lifecycle` service tests + `test/workflows/classes/session-lifecycle*.test.ts` updated ONLY where they assert audit counts (expected: minimal-to-none); run via canonical runners.
  - _Requirements: REQ-031.4_
- [x] 4.3 **Outcome**: `outcome/4.x-dispute-outcome.md`.

## Phase 5 — Completeness Journey

- [x] 5.1 **CREATE `test/workflows/admin/audit-completeness.journey.test.ts`** (steps 1–12 of specs'): cast (2 admins + parent/student/teacher denials), census-driven action execution, full row-shape assertions, observer filtered reads (`listAuditTrail` filters: actor/actionType/entityType/entityId/time window), Adjust fixture lane, denials zero-mint, 1:1 mapping + count oracles, rerun-repeats oracle, teardown with baseline restore.
  - QL + TE (the file IS the test) + SEC (denial matrix) + SR + IV
  - _Requirements: REQ-040, REQ-041, REQ-042, REQ-043, REQ-070_
- [x] 5.2 **Outcome**: `outcome/5.x-journey-outcome.md` (oracle table, timings, flakes-if-any).

## Phase 6 — Documentation & Propagation

- [x] 6.1 **MODIFY `docs/admin/audit-trail.md`**: add "Completeness Verification" section (census module path, drift test, journey, PRODUCTION_READINESS §1.3 evidence mapping).
  - QL + SR + IV
  - _Requirements: REQ-080.1_
- [x] 6.2 **MODIFY `docs/admin/user-management.md` §2.4**: note plan-catalog + dispute surfaces now conform to the emission contract.
  - _Requirements: REQ-080.2_
- [x] 6.3 **Propagation sweep**: only if a NEW permanent rule emerged (census-before-admin-mutation) — add 1–2 lines to `backend/graphql/AGENTS.md` with doc reference; otherwise record "no propagation warranted" in the outcome. Ledger sweep: D-001..D-004 statuses final.
  - _Requirements: REQ-080.3–.4_

## Phase 7 — Post-Implementation Review Wave (plan has >10 subtasks)

- [x] 7.1 **Dispatch review subagents** (files touched only): backend-review (atomicity, deny-path zero-mint, dead code), security-review (actor sourcing, PII in details, BFLA), types-review (census typing, enum value imports). Aggregate; fix; re-run until zero findings.
  - _Requirements: REQ-060, REQ-070_
- [x] 7.2 **Final gate**: `bun quality-gate` vs Phase-0 baseline; all suites green (`backend/db/test/logic/audit/*`, `test/workflows/admin/*`, session lifecycle regression, plan-catalog tests); all checkboxes `[x]`; final outcome summary written.
  - _Requirements: REQ-060.4_

## Requirements Coverage Checklist

| REQ | Tasks |
|---|---|
| REQ-000 | 0.1, 1.1 |
| REQ-000.5 | every task (QL/IV) |
| REQ-010 | 2.1 |
| REQ-020 | 2.2 |
| REQ-030 | 3.1, 3.2 |
| REQ-031 | 4.1, 4.2 |
| REQ-040..043 | 5.1 |
| REQ-060 | all (QL/TE), 7.2 |
| REQ-070 | 3.1, 3.2, 4.1, 5.1, 7.1 |
| REQ-080 | 6.1–6.3 |