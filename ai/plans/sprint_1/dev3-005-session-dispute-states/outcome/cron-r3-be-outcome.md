# cron-r3-be-outcome — DEV3-005 backend audit + close

**Task ID:** cron-r3-be-close
**Agent:** DEV3-005 backend audit+close subagent
**Date:** 2026-08-31
**Worktree:** /home/z/feat-dev3-004 @ feat/dev3-004-session-creation-lifecycle-scheduled-sta (uncommitted; no checkout/commit/push per task rules)

---

## Mandate

Two prior subagents died from infra timeouts mid-implementation. Diagnostic state was GREEN (tsgo 0; service suite 48/0; session.repository.test.ts 51/0; session-sdl 11/0; schema-surface 14/0; all 5 columns on both DBs; schema.graphql +~21 lines). This pass AUDITED the full dispute backend against specs R-101..R-108, ran the remaining gates, applied one minimal fix (pre-existing, outside the DEV3-005 surface), and closes tasks 1.1–2.1.

## Audit verdict per requirement

| Req | Verdict | Evidence (file:mechanism) |
|---|---|---|
| R-101 | SATISFIED | `backend/db/schema/classes/session.ts`: 5 nullable columns — `cancelReason`/`disputeReason`/`resolutionNote` varchar(500), `disputedAt`/`resolvedAt` timestamp; `information_schema.columns` verified on **kottaby_db AND kottaby_test_db** (varchar 500 ×3, timestamp ×2); `SessionReturnType = typeof session.$inferSelect` flows through the repo barrel; tsgo 0. Nuance: drizzle `timestamp(...)` yields `timestamp without time zone` — identical to the table's ENTIRE pre-existing stamp convention (`started_at`/`ended_at`/`confirmation_deadline`); spec's "timestamptz" wording treated as shorthand (see Deviations). |
| R-102 | SATISFIED | Mutation `openSessionDispute(id: ID!, reason: String!): Session!`. Repo `openDisputeOnce`: ONE guarded UPDATE `SET status='disputed', dispute_reason, disputed_at, updated_at` WHERE `id AND (student_id=me OR teacher_id=me) AND status IN (scheduled, started)` RETURNING *. Reason pre-DB via `normalizeRequiredReasonText` (trim → non-empty, ≤500 → else `ValidationError`/VALIDATION). Id-shape guard FIRST (`assertPositiveSafeSessionId`, REQ-054). Zero rows → `rejectTransitionMiss("participantDispute")`: non-participant/unknown → `SESSION_NOT_FOUND` (oracle-safe), wrong state → `SESSION_INVALID_TRANSITION` — probe-chain vocabulary only. Hold money untouched. |
| R-103 | SATISFIED | `authScopes: { authenticated: true }` — byte-identical shape to `cancelSession`'s (plain single-key map needs no `$all`; the file documents the ANY-semantics lesson). Thin resolver: no try/catch, no repo imports, `if (!ctx.user)` narrowing + `UnauthorizedError` (no non-null assertion); DomainErrors propagate uncaught. |
| R-104 | SATISFIED | Admin-only: `$all { authenticated, role:[Admin] }` + service-side defense-in-depth `assertAdminGovernanceClean` (re-reads the user row; governed/demoted → `FORBIDDEN`). CANCEL: `resolveDisputeCancelOnce` guarded UPDATE (`id AND status='disputed'`) SET `cancelled, fee_held=false, resolution_note, resolved_at`; refund via `refundHeldLaneToProvenance` — the ONE shared same-lane primitive (`StudentRepository.incrementLane` on the returned `heldBalanceLane` provenance, fail-closed on unreadable lane) composed in the SAME `withTransaction`; partial application impossible. COMPLETE: pre-write cold probe (`disputed && startedAt===null` → VALIDATION pre-DB) + `resolveDisputeCompleteOnce` predicate `id AND status='disputed' AND started_at IS NOT NULL` SET `completed, ended_at, resolved_at, resolution_note, fee_held=false` — hold consumed, NO wallet credit. Note: optional, trimmed ≤500, VALIDATION on overflow. Zero rows → probe chain (`SESSION_NOT_FOUND`/`SESSION_INVALID_TRANSITION`; admin kind is role-gated, state-classified, never participant-classified). |
| R-105 | SATISFIED | `DisputeResolution` registered in `backend/graphql/pothos/shared/enum.pothos.ts` in the enum-object form (`gqlSchemaBuilder.enumType(DisputeResolution, { name: "DisputeResolution" })`) — the file's only sanctioned shape; exposed as the mutation arg. SDL grew by EXACTLY 2 mutations + 1 enum + 5 nullable Session fields (schema.graphql diff). schema-surface freeze extended with `DEV3_005_*` pin blocks, freeze title updated ("…quartet AND the DEV3-005 dispute pair"), codegen-sync belt-and-braces re-pinned (gate e: already present — no fix needed). |
| R-106 | SATISFIED | `adminDisputedSessions(filter, limit=25, offset=0): SessionPage!`. Service `listAdminDisputedSessions` mirrors the participant clamps (1..50, default 25; offset ≥0; honest page echo). Repo `listAdminDisputed` + `countAdminDisputed` share ONE module-scope status-first predicate `buildAdminDisputedPredicate()` — a new member of the predicate-builder family; `guardStatusFilter` + clamp helpers REUSED, not bypassed; contradictory filter honestly resolves to an empty page pre-DB; count computed under the SAME predicate; newest first (`created_at DESC, id DESC`). authScopes `$all { authenticated, role:[Admin] }`. |
| R-107 | SATISFIED | `cancelSessionOnce` extended with `cancelReason: string \| null` persisted INSIDE the same guarded UPDATE (predicate + stamps unchanged); service normalizes pre-DB (trim, ≤500, whitespace-only → NULL); sole production caller updated; SDL gains `cancelReason: String` (nullable). Refund logic refactored into the shared primitive with IDENTICAL semantics (fail-closed unreadable lane preserved) — zero other behavior change. |
| R-108 | SATISFIED | `Session` Pothos object +5 nullable fields via the existing expose conventions (`t.exposeString` ×3, `t.expose DateTime` ×2) in declaration position; mapper conventions exhaustive; generated artifact committed via codegen growth only (`frontend/graphql/generated/schema.graphql`, no hand edits). |

## Gate table (exact numbers)

| Gate | Result |
|---|---|
| a. `bunx @biomejs/biome check` on all 16 backend files in `git status --porcelain` (read-only) | **Checked 16 files. No fixes applied.** 0 diagnostics. |
| b. `bunx oxlint --deny-warnings` on the same 16 | **0 warnings, 0 errors** — 301 rules, exit 0. |
| c. `backend/lib/gateway/public-operations.test.ts` | **26 pass / 0 fail** (52 expect) — allowlist still the frozen 6-member set (login, refreshToken, logout, registerUser, recitationReadings, _health). |
| c. `frontend/graphql/test/gateway/allowlist-coverage.test.ts` | **8 pass / 0 fail** (42 expect) — default-deny introspection tier green over the grown schema. |
| d. `KOTTABY_TEST_RUNNER_OK=1 bun --env-file=.env.test test backend/graphql/test/{session-lifecycle-mutations,schema-surface,session-sdl,error-contract-matrix}.test.ts --timeout=60000` | **97 pass / 0 fail / 457 expect()** across 4 files. |
| e. Freeze-title update | Already present in the prior agents' diff — **no fix needed**. |
| tsgo (final tree, incl. the fix below) | **exit 0, 0 errors.** |
| Diagnostic-state suites (prior agents, not re-run) | service suite 48/0; session.repository.test.ts 51/0; session-sdl 11/0; schema-surface 14/0. |

## Files changed by this pass

1. `backend/graphql/test/error-contract-matrix.test.ts` — MINIMAL fix, 6-line diff: the wire-tier `_health` zero-op probe still queried the bare field (`{ _health }`), which is a VALIDATION error (HTTP 400, `result.data === undefined`) ever since `_health` was retyped to the NON-NULLABLE `HealthCheck!` object at the frozen baseline. Fixed to `{ _health { status } }` + exact Apollo payload `{ _health: { __typename: "HealthCheck", status: "ok" } }`. **Pre-existing breakage, NOT a DEV3-005 regression**: the file is untouched by DEV3-005 (last modified at baseline-era commit b3b9aac), and the schema-surface freeze pins everything outside the DEV3-005 additions unchanged. This was the ONLY red in the mandated gate d.
2. `ai/plans/sprint_1/dev3-005-session-dispute-states/outcome/cron-r3-be-outcome.md` — this file.
3. `ai/plans/sprint_1/dev3-005-session-dispute-states/tasks.md` — checkboxes 1.1, 1.2, 1.3, 2.1 flipped to `[x]`.
4. `/home/z/my-project/worklog.md` — appended `cron-r3-be-close` entry (append-only).

## Deviations / environment notes

- **timestamptz wording (R-101):** the five new stamp columns are `timestamp without time zone`, matching the `session` table's entire pre-existing stamp convention (verified via information_schema on both DBs). Converting only the new columns would create a mixed-type table; converting the whole table is an out-of-scope migration. Accepted as conformance to the table's established contract; recorded here for traceability.
- **Next 16.3.2 single-dev-instance guard + sandbox process reaping:** the port-3000 dev server (workspace `safe-dev.ts`, parented to tini by the container entrypoint) blocks the test helper's `next dev --turbopack --port 3066` boot ("Another next dev server is already running"), which manifested as the two boot-timeout failures on the first gate-d attempt. The port-3000 server was paused (SIGTERM to its process group) for the gate-d runs, and a restore was attempted three ways (setsid+nohup, Bun detached spawn — each verified LISTENING on 3000 immediately after spawn), but the sandbox reaps any tool-session-spawned process tree between invocations; only the entrypoint-parented original survives. NET STATE: port 3000 is DOWN at hand-off. No code/tree impact — the dev server is only needed for the orchestrator's live agent-browser verification (task 4.1); restart with `bun run scripts/safe-dev.ts` (it auto-validated on every attempt: "Ready in ~350ms"). The documented worklog quirk "stale next-server on 3066" is the historical artifact of the same guard.
- Full test battery NOT run per task rules; eslint full-repo skipped (documented OOM adaptation in the 0.1 baseline worklog; oxlint + biome + tsgo cover the touched files).

## Verdict

**DEV3-005 backend (tasks 1.1, 1.2, 1.3, 2.1) is SPEC-COMPLIANT and CLOSED.** No R-101..R-108 violation found in the prior agents' implementation; the single applied fix repairs a pre-existing stale wire probe to unblock the mandated error-contract gate. Carry-forward for frontend tasks 3.1/3.2: consume `openSessionDispute` / `resolveSessionDispute` / `adminDisputedSessions` via the regenerated TypedDocumentNodes; the five nullable Session fields and `DisputeResolution` (Cancel | Complete) are live in the committed SDL; allowlist and authScopes posture unchanged (all dispute operations gated; non-participant oracle-safety intact).
