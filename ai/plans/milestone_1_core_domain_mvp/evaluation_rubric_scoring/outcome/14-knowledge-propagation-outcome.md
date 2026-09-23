# Task 14 Outcome — Knowledge Propagation & Documentation

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Task:** 14 — Knowledge propagation & documentation (Phase 6 — Final Gate)
**Scope:** docs-only. **AGENTS.md and `.agents/instructions/*` NOT touched** (verified: `git status --short` lists only the five doc files below; the tasks.md checkbox flip is the only other change).

---

## Summary

The rubric-scoring flow's knowledge is propagated to the permanent docs: a new canonical
domain doc, one consumer-guidance row updated in the lifecycle doc, a seven-code registry
section added to the error-code doc, and three recurring patterns/gotchas extracted from
the outcome files and propagated to the most fitting docs homes. No commit (orchestrator
owns commits).

## Docs created

| File | Sections |
|---|---|
| `docs/teachers/evaluation-rubric-scoring.md` (CREATE) | What this flow does (+ surfaces table incl. wire contract and scope conjunction) · The submission pipeline (fixed gate order: pre-DB validation → governance → session gate → certification re-check → applicant lock/status gate → cycle membership → duplicate pre-check → sealed insert → quorum read) · Per-evaluation ≥80 semantics (the 80/79 boundary: `{100,100,79,100,100}` mean 95.8 FAILS; exactly-80 passes; weakness iff-rule per submission, client mirrors / server authoritative) · Failure-area derivation (lowest score, ties → earliest `created_at`, fail-closed tripwire) + tajweed 30d / hifz 90d cooldowns stored verbatim · Finalization paths (PASS: savepoint cold-start insert → 23505 elevate arm with the LOCKED row's own `isEvaluator` demotion guard → `finalizeOnCertification`, zero-row ⇒ `APPLICANT_ALREADY_FINALIZED` + full rollback; FAIL: ONE guarded `transitionToFailed`, no `users.suspended*`/`students`/role writes) · Notifications receipt discipline (in-tx emit in the applicant's persisted locale, publish STRICTLY post-commit) · Reads (pending anti-join + own-submission pair scope, no `notes`) · Error-code table (7 custom + reused codes) · The two `evaluations` write paths (student rating vs rubric scoring) under the `evaluations_session_evaluator_unique` arbiter · Related documents (incl. the applicant-lifecycle cross-reference) |

Doc language is clean technical domain (no REQ-x / task / phase / plan-path artifacts;
the header tags the flow "DEV2-007" once, matching the sibling
`evaluation-loop-booking.md` house format). All cited paths verified present in the tree.

## Docs updated

| File | Change |
|---|---|
| `docs/teachers/applicant-lifecycle.md` | §6 Consumer Guidance row **"Evaluation sessions / aggregation"**: now names the evaluation-rubric-scoring flow as THE `in_evaluation → passed \| failed` writer, with the canonical-doc pointer (`docs/teachers/evaluation-rubric-scoring.md`), the guarded single-statement `ApplicantRepository.transitionToFailed(userId, cooldownUntil, tx)` (0-row miss ⇒ already finalized), and the strict-`>` cooldown read at `backend/services/teachers/applicant-lifecycle.service.ts` (`assertCanPurchaseVerification`, §2.1). Existing row format (bold consumer label + dense obligation prose) matched exactly; no other row touched. |
| `docs/graphql/domain-error-extensions-code.md` | NEW **"Domain Code Registry"** section (under Pattern, after the NotFoundError convention): the file had no per-code registry, so the section establishes it in the sibling-domain table shape — columns **Code / Meaning / Surface / GraphQL-HTTP semantics / i18n key** — with all 7 DEV2-007 rows (`RUBRIC_SCORE_INVALID`, `RUBRIC_NOTES_REQUIRED`, `RUBRIC_WEAKNESS_REQUIRED`, `RUBRIC_WEAKNESS_NOT_ALLOWED`, `RUBRIC_WEAKNESS_INVALID`, `RUBRIC_SESSION_NOT_COMPLETED`, `APPLICANT_ALREADY_FINALIZED`), the custom-codes-never-resolve-through-the-taxonomy rule (linking `error-handling-contract.md`), the code↔key bijection + `error-link.map.ts` row requirement, the canonical-flow pointer, and the reused-codes note. |

## Patterns extracted from outcome files → where propagated

| # | Pattern (evidence across outcome files) | Propagated to |
|---|---|---|
| 1 | **Sandbox quality-gate OOM + pristine-main attribution protocol.** `bun quality-gate`'s BASIC_CHECKS is OOM-killed (SIGKILL) during its own `tsgolint` companion run in the ~4 GB cgroup sandbox; `QUALITY_GATE_SETTLE_MS` does not help mid-run and oxlint hard-requires the companion (no bypass). Task 13 proved it byte-for-byte on a pristine `origin/main` worktree; Task 9 used the same pristine-main protocol to attribute a deterministically failing chaos test (D5). Generalizes to ANY gate/test failure attribution. | `docs/quality/unused-code-cleanup.md` §4 (the existing "Quality-gate on memory-constrained hosts" section — the section already carried the tsgolint memory cliff): two new bullets — the cgroup-SIGKILL/no-bypass fact with the sanctioned per-stage posture, and the pristine-main attribution protocol. |
| 2 | **Journey publish-window discipline for spied receipt assertions.** Task 8's RED finding: a spy window on `NotificationEngine.publishReceipts` opened BEFORE the preceding completion `await` flushed swallowed that step's own `session_completion` receipt (12 vs 11). Post-commit publishes are asynchronous relative to the causing step; windows must open after the trigger resolves and assert the exact delta + recipient. | `docs/testing/workflow-journey-tests.md` — "Notification spying" section gained the "Publish-window discipline" paragraph (diagnostic capture advice included). |
| 3 | **Test-runner dynamic-import resolution requires `@/` aliases.** Task 8: the journey's `SERVICE_PATH` dynamic-import specifier was corrected from a broken relative form to the `@/` alias convention — relative specifiers never resolve under the test runner, and the failure surfaces only at runtime. | `docs/testing/workflow-journey-tests.md` — new "Runner gotcha: dynamic-import specifiers need `@/` aliases" section. |

Skipped as plan-specific one-offs: the `EvaluationReturnType` Omit-union ripple (type-seam
detail of one delta), the mid-review provisioning drift fixes (env-maintenance, already
resolved), the kottaby_test migration-provisioning repairs (documented in the Task 9/13
outcomes where they belong), and the docblock-ordinal self-corrections.

## Verification

- `bun run scripts/health/sub-loop.ts docs/teachers/evaluation-rubric-scoring.md --lifecycle duplicates`
  → **n/a for markdown, per precedent** (Task 2 outcome: "sub-loop does not lint non-code
  files"): exit **1** with `No files found to lint. Please check your paths and ignore
  patterns.` after `tsgo passed (no errors)` for the filtered path. The same n/a applies
  to the four other markdown edits; no code files were touched by this task.
- Cross-reference integrity: all implementation paths cited in the new doc verified on
  disk (`backend/services/teachers/evaluation-rubric.service.ts` + `.helpers.ts`,
  `backend/graphql/mutation/evaluation-rubric.mutation.ts`,
  `backend/graphql/query/teachers/evaluation-rubric.query.ts`,
  `backend/db/repo/teachers/evaluation.repository.ts` /
  `applicant.repository.ts` (`transitionToFailed` at the guarded-transition block),
  `backend/db/schema/teachers/evaluations.ts` (`evaluations_session_evaluator_unique`),
  `shared/constants/evaluation-rubric.constants.ts`, frontend dialog/hook family, and
  `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`).
- `git status --short` (whole task): exactly
  `M docs/graphql/domain-error-extensions-code.md` ·
  `M docs/quality/unused-code-cleanup.md` ·
  `M docs/teachers/applicant-lifecycle.md` ·
  `M docs/testing/workflow-journey-tests.md` ·
  `?? docs/teachers/evaluation-rubric-scoring.md`.
- **AGENTS.md (all layers) and `.agents/instructions/*` untouched — confirmed by the
  status above and by construction (no edits issued against them).** Propagation stayed
  docs-only per the knowledge-propagation policy; anything rule-file-worthy was recorded
  in docs + outcome files for human curation instead.
- Test layers: all mandated layers already ran green at the Task 13 gate (test:db 1012/0 ×2,
  test:services 1792/0 ×2, rubric transport 15/0, documents 14/0, journey 16/0 ×2) — this
  task added no code, so no suites were re-run.

## Files Created / Modified

| File | Action |
|---|---|
| `docs/teachers/evaluation-rubric-scoring.md` | CREATED |
| `docs/teachers/applicant-lifecycle.md` | EDITED (§6 one row) |
| `docs/graphql/domain-error-extensions-code.md` | EDITED (Domain Code Registry section) |
| `docs/quality/unused-code-cleanup.md` | EDITED (§4 two bullets) |
| `docs/testing/workflow-journey-tests.md` | EDITED (publish-window paragraph + runner-gotcha section) |
| `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/outcome/14-knowledge-propagation-outcome.md` | CREATED (this file) |
| `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/tasks.md` | Task 14 checkbox flipped (only) |

**NO commit made** (orchestrator owns commits).

## Deferred-Items Check

No new deferred work. D1–D5 unchanged (all documented cross-ticket/host-limitation rows
with receiving pointers; the blocked-marker grep gate reads 0 on `deferred-items.md` per
the Task 12/13 gate — this file deliberately carries no literal marker glyphs so the
grep never self-trips on it). One non-blocking
doc-drift observation for the next docs touch (NOT a plan deliverable, recorded here for
the human curator): `docs/teachers/student-evaluation-submission.md` §1 still describes
applicant-evaluation rows as `session_id = NULL` — accurate pre-DEV2-007, superseded by
the session-linked rubric rows documented in the new canonical doc and the schema
docblock.
