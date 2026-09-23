# Task 2 Outcome — Schema Delta: weakness enum + column + constants + docblock/DBML parity

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Task:** 2 — Schema delta (Phase 2 — Backend Foundation)
**Date:** executed from repo root `/home/z/my-project` (branch `main`, clean tree apart from prior-task artifacts)
**Environment:** PostgreSQL 17 at `127.0.0.1:5432`; `.env` → `kottaby_db` (26 public tables, 20 pgEnums pre-push — full pre-existing schema present). `kottaby_test` NOT touched (refresh stays with the orchestrator).

---

## Summary

The single schema delta of the plan landed exactly as designed and nothing else:

1. **pgEnum** `rubricWeaknessArea = pgEnum("rubric_weakness_area", ["tajweed", "hifz"])` added in `backend/db/schema/enums.ts` immediately after `sessionIntent` (with a domain docblock contrasting it with `session_intent`; the registry header count corrected 20 → 21).
2. **Column** `weaknessArea: rubricWeaknessArea("weakness_area")` added nullable to the `evaluations` table after `notes`; the stale header docblock was corrected — rubric rows are session-linked (`session_id` NOT NULL for rubric submissions) and `evaluations_session_evaluator_unique` is named as the write-once arbiter for BOTH flows. No FK/tenancy surface touched; no index, no constraint, no DEFAULT, no backfill.
3. **Applied** via `bun run db push` only (the script resolves `.env` itself; drizzle-kit push `--force` under the hood). DDL diff inspected pre-apply (pre-push pg_dump snapshot + DB absence probes) and verified post-apply (post-push snapshot diff) — see the verbatim diff block below.
4. **TS mirror + guard**: `backend/enum/teachers/rubric-weakness-area.enum.ts` (`RubricWeaknessArea`, fail-closed `isRubricWeaknessArea`, the `applicant-status.enum.ts` pattern including the pre-allocated membership set) + colocated 4-Tier test + barrel update.
5. **Constants**: `shared/constants/evaluation-rubric.constants.ts` (`RUBRIC_PASS_THRESHOLD=80`, `TAJWEED_COOLDOWN_DAYS=30`, `HIFZ_COOLDOWN_DAYS=90`, `RUBRIC_NOTES_MAX_LENGTH=2000`, all `as const`, clean domain JSDoc, zero layer imports) + barrel update.
6. **DBML mirror**: `db/schema.dbml` gains `Enum rubric_weakness_area` (after `session_intent`) and the `weakness_area` column on `evaluations` (Drizzle stays canonical).

`bun tsgo` full-tree: **0 `error TS` lines** (equals the recorded baseline) after resolving the one derived-type ripple the push surfaced (see Cross-File Dependencies).

---

## DDL Diff Applied (verbatim evidence)

`bun run db push` (exit 0) prints only `[✓] Changes applied` in this drizzle-kit version, so the exact DDL was evidenced by pre/post `pg_dump --schema-only` snapshots of `kottaby_db` (`/tmp/pre-push-schema.sql` → `/tmp/post-push-schema.sql`, diff exit 1 = differences found). Schema-object delta, verbatim (the `\restrict`/`\unrestrict` token lines are pg_dump session noise, identical-shape in both snapshots):

```diff
165a166,175
> -- Name: rubric_weakness_area; Type: TYPE; Schema: public; Owner: -
> --
>
> CREATE TYPE public.rubric_weakness_area AS ENUM (
>     'tajweed',
>     'hifz'
> );
>
>
> --
438a449
>     weakness_area public.rubric_weakness_area,
```

Canonical Drizzle-equivalent statements (what the above two hunks are):

```sql
CREATE TYPE "rubric_weakness_area" AS ENUM ('tajweed', 'hifz');
ALTER TABLE "evaluations" ADD COLUMN "weakness_area" "rubric_weakness_area";
```

Nothing else changed — confirmed three ways:
- pg_dump diff shows exactly two schema hunks (plus session tokens);
- table count unchanged: 26 → 26; enum count 20 → 21 (`SELECT count(*) FROM pg_type WHERE typtype='e'`);
- post-push probe: `evaluations.weakness_area` was appended at the table end (ordinal position 11, after `updated_at` — `notes` sits at ordinal 6; PostgreSQL `ADD COLUMN` always appends, never inserts mid-table), `is_nullable = YES`, `udt_name = rubric_weakness_area`. The canonical order contract is the Drizzle source declaration order — `weaknessArea` is declared after `notes` in `backend/db/schema/teachers/evaluations.ts` — not the table ordinal position.
- Pre-apply probes confirmed absence before pushing: no `rubric_weakness_area` in `pg_type`, no `weakness_area` in `information_schema.columns`.

Additive-only verified: no FK, no tenancy column, no index, no constraint, no DEFAULT, no data backfill; student-rating rows keep `weakness_area = NULL` by design.

---

## Files Created

| File | Purpose | Sub-loop (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`) |
|---|---|---|
| `backend/enum/teachers/rubric-weakness-area.enum.ts` | `RubricWeaknessArea` (`Tajweed="tajweed"`, `Hifz="hifz"`) + fail-closed `isRubricWeaknessArea` (applicant-status pattern) | exit **0** — rules read: `.agents/instructions/backend.instructions.md`, `AGENTS.md`, `backend/AGENTS.md` |
| `backend/enum/teachers/rubric-weakness-area.enum.test.ts` | Tier-1–4 guard suite incl. value-for-value parity with the `rubric_weakness_area` pgEnum (static `enumValues` comparison — no DB connection) | exit **0** — rules read: `.agents/instructions/tests.instructions.md`, `.agents/instructions/backend.instructions.md`, `AGENTS.md`, `backend/AGENTS.md` |
| `shared/constants/evaluation-rubric.constants.ts` | The four rubric constants (`as const`) with domain JSDoc; shared-layer isolation honored (imports nothing) | exit **0** — rules read: `AGENTS.md` (no instruction file applies per sub-loop discovery; `shared/AGENTS.md` absorbed pre-edit) |

## Files Modified

| File | Change | Sub-loop exit |
|---|---|---|
| `backend/db/schema/enums.ts` | + `rubricWeaknessArea` pgEnum after `sessionIntent` (domain docblock); registry header "20 → 21" | **0** (rules: backend.instructions.md, AGENTS.md, backend/AGENTS.md) |
| `backend/db/schema/teachers/evaluations.ts` | + `weaknessArea` column after `notes`; header docblock corrected (session-linked rubric rows; unique index = write-once arbiter for both flows); + value import of `rubricWeaknessArea` from the shared registry (the AGENTS cross-domain import convention) | **0** (same rule set) |
| `backend/enum/teachers/index.ts` | + `export * from "./rubric-weakness-area.enum";` | **0** (same rule set) |
| `shared/constants/index.ts` | + `export * from "./evaluation-rubric.constants";` | **0** (AGENTS.md only — per discovery) |
| `backend/types/teachers/evaluation.types.ts` | + `"weaknessArea"` to the `EvaluationReturnType` Omit union (see Cross-File Dependencies) | **0** (rules: backend.instructions.md, AGENTS.md, backend/types/AGENTS.md, backend/AGENTS.md) |
| `db/schema.dbml` | + `Enum rubric_weakness_area` + `weakness_area` column mirror | n/a — sub-loop does not lint non-code files (exit 1 "No files found to lint"; plan-review precedent: sub-loop targets code files) |
| `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/tasks.md` | Task 2 checkbox flipped (the working tree also carries the earlier Task 0 / 1.5 flips from prior tasks) | n/a — plan artifact |

## Files NOT Modified (scope guard)

No backend/repos, services, GraphQL, seeds, frontend, app, tests infra, AGENTS.md, or instruction files touched. `git status --short` at completion:

```
 M ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/tasks.md          (Task 0/1.5 flips + Task 2 flip)
 M backend/db/schema/enums.ts
 M backend/db/schema/teachers/evaluations.ts
 M backend/enum/teachers/index.ts
 M backend/types/teachers/evaluation.types.ts
 M db/schema.dbml
 M shared/constants/index.ts
?? backend/enum/teachers/rubric-weakness-area.enum.ts
?? backend/enum/teachers/rubric-weakness-area.enum.test.ts
?? shared/constants/evaluation-rubric.constants.ts
?? ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/outcome/0-baseline-verified-outcome.md  (pre-existing, Task 0)
?? ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/outcome/2-schema-outcome.md             (this file)
```

---

## Test Evidence

Command (the mandated runner — raw `bun test` never used):

```
bun run test/scripts/run-test.ts backend/enum/teachers/rubric-weakness-area.enum.test.ts
```

Result: **exit 0 — 22 pass, 0 fail, 281 expect() calls** (Tier-1 parity + branch coverage, Tier-2 boundary, Tier-3 chaos/fuzz, Tier-4 security). The parity test pins `rubricWeaknessArea.enumValues.join("|") === "tajweed|hifz"` and strict-equals against `Object.values(RubricWeaknessArea)` — Drizzle pgEnum and TS enum cannot drift silently.

Full-tree type check after all edits: `bun tsgo 2>&1 | grep "error TS" | wc -l` → **0** (baseline parity; the transient error introduced mid-task is documented below and fixed).

---

## Cross-File Dependencies Discovered (for later tasks)

1. **`EvaluationReturnType` Omit ripple (fixed in-task, minimal edit).** Adding the column flows into `EvaluationSelectType` via `$inferSelect`, which made `weaknessArea` a REQUIRED member of the canonical `EvaluationReturnType` (it was not in the Omit list) and broke `student-evaluation.service.ts:115`'s literal build (TS2741) — a NEW error against the zero baseline. Resolution: `"weaknessArea"` added to the `EvaluationReturnType` Omit union in `backend/types/teachers/evaluation.types.ts` — the exact mechanism the type already uses to keep table-only columns (`notes`, soft-delete internals) out of the student-rating read shape. The canonical surface keeps its precise pre-delta shape; the student-rating service needed no change. This is the same "student-rating call site stays type-compatible" outcome the plan intended, achieved at the type-derivation seam instead of a service edit. Flagging explicitly because plan §3.2 listed `EvaluationReturnType` as "UNTOUCHED" — its SHAPE is untouched (field set byte-identical); the Omit list necessarily grew by one token.
2. **Task 3 imports:** `RubricEvaluationSubmitInput` / `RubricSubmissionInsertInput` / `RubricCycleSubmissionRow` / `RubricEvaluationReturnType` should value-import `RubricWeaknessArea` from `@/backend/enum/teachers/rubric-weakness-area.enum` (deep import per enum-layer convention; barrel also exports it).
3. **Task 4 repo work:** the widened `insertOnce` Pick can now name `weaknessArea`; `$inferInsert` types it as `"tajweed" | "hifz" | null | undefined` (optional) — the student-rating insert path is unaffected without any Pick change there.
4. **Task 7 GraphQL:** the pgEnum exists in the dev DB; `RubricWeaknessAreaPothosEnum` registration + `generate:gqlSchema` + `bun codegen` remain Task 7's obligation (NOT run in Task 2 — no GraphQL surface exists yet).
5. **Test DB:** `kottaby_test` was deliberately NOT pushed; it still lacks `rubric_weakness_area` until the orchestrator's refresh. Any DB-backed suite using the new column fails until then.
6. **Baseline artifacts:** fresh `/tmp/pre-push-schema.sql` / `/tmp/post-push-schema.sql` / `/tmp/schema-delta.diff` / `/tmp/db-push-task2.log` capture this task's DB evidence.

---

## Semantic Self-Review (all items)

- **No dead branches:** constants are plain `as const` values; guard has a single return expression; no unreachable code.
- **No cross-layer imports:** `shared/constants/evaluation-rubric.constants.ts` imports nothing (shared-layer isolation); enum file imports nothing but its own stdlib-free values; schema file imports only from the schema registry per convention.
- **Enums as value imports in runtime code:** `rubricWeaknessArea` (pgEnum) is a value import in `evaluations.ts` (runtime column-builder call) and in the test (runtime `.enumValues` access); `RubricWeaknessArea` is a value import in the test. No `import type` on any enum symbol used in a runtime expression.
- **No plan-artifact references in code:** grep across all touched files for `REQ-`, `Task 2`, `DEV2-007`, `plan.md`, `tasks.md`, `specs.md`, `.ai/plans` → zero matches; JSDocs describe domain behavior only.
- **No `console.*`:** zero occurrences in created/modified files.
- **No noisy/trivial comments:** docblocks only where they carry domain facts (registry count, failure-area vocabulary distinction, write-once arbiter, shared-layer isolation, constant semantics).
- **Scope:** `git diff --name-only` matches the file list above exactly; no table/index/FK/tenancy change beyond the two DDL statements (pg_dump diff evidence).
- **Security:** additive-only push; no client-facing surface added; no `notes` exposure surface introduced (notes remain server-side and out of every return shape).

## Deferred-Items Check

No new deferred work discovered — the ledger stays at D1–D4 (all cross-ticket, all `Blocked`, all with target-ticket pointers). The `EvaluationReturnType` ripple was resolved in-task (not deferred); no row added.

## Verification Line (task-scoped)

`15 REQ targets tracked for the plan · this task verified REQ-4 + REQ-0.5.2 · BUN cmd(s) that passed: bun run db push; bun run test/scripts/run-test.ts backend/enum/teachers/rubric-weakness-area.enum.test.ts; bun tsgo; sub-loop × 8 files · requirements deferred (IDs): none new (D1–D4 unchanged)`
