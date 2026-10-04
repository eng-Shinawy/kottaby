# Plan Review — Round 1 (Phase 1.5 Gate)

**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline`
**Reviewed:** 2026-10-04 · **Reviewer model:** three parallel review subagents (rules-compliance, citation-accuracy, consistency/traceability) + orchestrator re-verification sweep after fixes
**Inputs:** `specs.md` · `plan.md` · `tasks.md` · `deferred-items.md` · layer AGENTS.md files · the working tree

---

## R1 Findings (aggregated + deduplicated)

Three review waves ran in parallel, scoped to the plan-review skill's dimensions (layer rules, citation accuracy, traceability, anti-patterns, structure). Verdict before fixes: **3 violations (0 BLOCKER, 2 MAJOR, 1 MINOR)** + 3 MINOR citation-range defects + 2 MINOR wording defects.

| # | Severity | Dimension | Finding | Fix applied |
|---|---|---|---|---|
| F1 | MAJOR | i18n layer rules (`shared/AGENTS.md:201-216` registration recipe) | Task 1.4 / plan §2.4 file list omitted the FOUR per-namespace directory barrels (`types/teacherDirectory/index.ts`, `en/teacherDirectory/index.ts`, `ar/teacherDirectory/index.ts`, `namespaces/teacherDirectory/index.ts`) that the recipe's own exemplars all carry — the plan's imports (`namespaces/index.ts` → `./teacherDirectory`, `message.ts` → `@/shared/locale/types/teacherDirectory`) would not resolve | Added all 4 barrel rows to plan.md §2.4 (now 13 touchpoints) + named the leaf consts (`teacherDirectoryEn`/`teacherDirectoryAr`) + updated tasks.md 1.4 accordingly |
| F2 | MAJOR | journey rules (`test/workflows/AGENTS.md` Rules 2 + 5) | The journey's step 6 model ("lifecycle steps mutate ONLY `is_online` + session state"; "zero notifications") contradicted the SHIPPED `completeSession`: it inserts a student confirm-prompt notification row on the completion transaction and publishes a receipt via `NotificationEngine.publishReceipts` after commit (`backend/services/classes/session-lifecycle.service.ts:402-418`) — untracked side-effect row would break the mandatory zero-residue teardown, and no dispatch spy was specified | Corrected specs.md §4.2 step 6, plan.md §4.5 Side-Effect Matrix, and tasks.md 2.1: spy `NotificationEngine.publishReceipts` (precedent `spyPublication`, `test/workflows/sessions/session-lifecycle.journey.test.ts:238-244`), assert the receipt targets the session's student, register the notification row in the fixture registry; "zero side effects" claim now scoped to BROWSE steps only |
| F3 | MINOR | test-runner discipline (`test/workflows/AGENTS.md:94-97`) | Two spots used raw `bun test test/workflows` for the whole-layer sweep; the layer's own rules mandate `bun run test/scripts/run-test.ts test/workflows` | Both replaced with the approved-runner form (plan.md Verification Anchor 5 + tasks.md 2.3.TE) |
| F4 | MINOR | citation accuracy | `docs/specs/functional-requirements.md:137` → the quoted sentence is at `:138` | Fixed in specs.md §1.2 |
| F5 | MINOR | citation accuracy | `user-management.query.helpers.ts:45-60` → function spans `:45-62` (signature/behavior claims exact) | Fixed in all 3 occurrences (specs REQ-012, plan D11, plan §4.1) |
| F6 | MINOR | citation accuracy | `navItems.ts:129-140` → student block spans `:129-142` | Fixed in specs.md §3.1 + plan.md §5.2 |
| F7 | MINOR | EARS consistency | REQ-018 block (and REQ-001.4/REQ-002.4) lacked WHEN/THEN/IF/SHALL phrasing, contradicting specs' own checklist claim | REQ-018 rewritten as six EARS clauses; REQ-001.4/REQ-002.4 rephrased with SHALL |
| F8 | MINOR | wording | tasks.md 1.2 said "two new type exports" for a single barrel line | Reworded: one barrel line covers the file's exports; the second export is the contracts-file keyword (separate item) |

**Explicitly verified clean (no action):** type-layer discipline (repo-file-local shapes match the verified `NormalizedAdminTeacherFilters`/`AdminTeacherDirectoryRow` precedent at `teacher.repository.ts:81-95`); one-arg i18n claims true of the code (the two-arg prose in `backend/services/AGENTS.md:7`/`backend/db/repo/AGENTS.md:33` is stale AGENTS.md text, not a plan defect); logging via `@/backend/lib/logger`; repo rules (no `inArray`+prepared, one-escape-point, `count(*)::int`); schema rules (no new pgEnum, push-only, exact index style); service boundaries; the zero-GraphQL/frontend ruling internally consistent; all ~120 load-bearing citations OK except F4-F6; bidirectional REQ traceability zero-miss; zero cross-file signature drift; plan-directory self-references exact (13/13); task sequencing correct (2.1 journey-first, 1.1→2.2, 1.3→2.3); anti-pattern sweep zero hits; all four files end cleanly (no truncation).

---

## Re-review verification (post-fix sweep — evidence)

Executed after applying F1–F8; every probe printed empty (clean) except the ledger gate which printed `0`:

| Probe | Result |
|---|---|
| `for r in $(grep -oE 'REQ-[0-9]+' specs.md \| sort -u); do grep -q "$r" tasks.md \|\| echo "MISSING: $r"; done` | **empty** — every REQ covered by tasks (incl. all sub-REQ ranges) |
| `grep -rn 'bun test test/workflows' specs.md plan.md tasks.md deferred-items.md` | **empty** — approved runner everywhere |
| `grep -rn 'getTranslations(locale, "' / 'getServerTranslations(locale, "'` | **empty** — one-arg discipline holds |
| `grep -rn 'frontend/utils/logger'` | **empty** — backend logger only |
| `grep -rn 'useAppTranslation(Translation'` | **empty** — no Translation enum invented |
| `grep -rn '45-60\|129-140\|functional-requirements.md:137)'` | **empty** — stale ranges purged |
| `grep -cE '^\s*\|.*(❌\|⚠️)' deferred-items.md` | **0** — resolved-pointer ledger gate |

## Verdict

**R1: 8 findings → all fixed → re-verification sweep clean. Plan passes all AGENTS.md rules for affected layers** (`backend/db/schema`, `backend/db/repo`, `backend/db/test`, `backend/types`, `backend/services`, `shared` + `shared/locale`, `test/workflows`, root). The plan is approved for execution; no further review rounds required at the planning gate. Implementation-time gates remain: per-file `sub-loop.ts --lifecycle duplicates`, the 2.M mid-point backend review, and the Phase 3 post-implementation review waves (all defined in `tasks.md`).

## Notes for the executing agents

- The journey's `completeSession` step MUST install the `publishReceipts` spy in `beforeAll` and restore it in `afterAll`; the confirm-prompt notification row is a tracked fixture (FK-safe deletion order: notifications BEFORE users).
- The `teacherDirectory` namespace requires all four directory `index.ts` barrels — copying only the `labels.ts`/`.namespace.ts` files will not compile.
- Registry member insertion follows the existing registry ordering, which is not strictly alphabetical — place `TeacherDirectory` to match neighboring entries' style.
