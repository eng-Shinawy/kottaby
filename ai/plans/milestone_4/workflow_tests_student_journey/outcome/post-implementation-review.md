# Post-Implementation Review — Review-Wave Fixes (A1–A4, B)

**Plan:** `ai/plans/milestone_4/workflow_tests_student_journey` · **Date:** 2026-10-09
**Wave:** post-implementation review — two review agents, 10 aggregated findings, all LOW severity, 0 blocking.

## 1. Aggregated findings (both review agents)

10 findings, every one LOW; none blocking. Orchestrator triage split them into FIX (5) and ACCEPT-AS-IS (5).

### Fixed (this change)

| ID | File | Finding | Fix |
|---|---|---|---|
| A1 | `student-full-journey.journey.test.ts` step 29 | Comment claimed the arbitration note's content "never enters the trail" but only `notePresent === true` was asserted — comment and assertion disagreed | Added the real absence assertion matching the ~:1848 report-copy pattern |
| A2 | `student-full-journey.journey.test.ts` step 17 | Every other denial step (13/23/26/28/29) proves the publish spy recorded zero calls; step 17 proved only zero inbox movement — per-step zero-publish consistency gap | Wrapped the denial call in the established `spyLifecyclePublication()` try/finally pattern and asserted zero calls |
| A3a | `student-full-journey.journey.test.ts` file header (~:8-50) | Header narrated development history ("grown incrementally, one leg per change… first landing… this final landing") instead of describing what the suite IS | Collapsed into a concise behavioral description (arc via real services, money semantics, teardown discipline); cast/rules/run sections kept |
| A3b | `test/workflows/students/DIAGRAMS.md` intro (~:7) | Same landing-history narration in the diagram intro; `test/workflows/AGENTS.md` rule 13 prescribes a 1-2 sentence behavioral intro | Replaced with a 2-sentence behavioral intro per rule 13 |
| A4 | `student-full-journey.journey.test.ts` step 0 (~:844-848) | Step 0 re-implemented the teacher-profile read inline although `readTeacherProfileRow()` (~:614-622) exists in the same file | Step 0 now calls the helper; assertions unchanged |
| B | `test/workflows/helpers/journey-fixtures.ts` file-top docblock (~:22-23) | Docblock still claimed the fixture writes emulate "future production mutations (the parent-link flow, …)" — the same stale-claim class the D5 fix (task 2.1) removed from the `linkStudentToParentFixture` docblock | Rewritten in accurate present tense: fixture shortcuts for suites needing an end state without walking the production chain; chain-verification suites must drive the production services. Comment-only; the `country: "Egypt"` line (:266) untouched per ledger D8's out-of-scope ruling |

### Accepted-as-is (documented, NOT changed)

1. **Claim-select/register-loop triplication (steps 12/24/27)** — pure intra-file style; refactoring a green 31-test suite for it is risk without payoff (orchestrator ruling).
2. **Early-steps inbox-loop style variance** — same class; accepted.
3. **specs.md wording overclaim** — informational; the plan artifacts are historical records, not living docs, so no edit was made.
4. **R6 lean-coverage informational note (1 of 2)** — informational coverage observation, no action.
5. **R6 lean-coverage informational note (2 of 2)** — same.

## 2. Exact changes applied

### `test/workflows/students/student-full-journey.journey.test.ts`

- **A1 — :2694** — after `expect(parsedDetails.notePresent).toBe(true);` added `expect(JSON.stringify(parsedDetails)).not.toContain(RESOLUTION_NOTE_C);` (the parsed-object stringify pattern already used by `admin-broadcast.journey.test.ts:403` / `broadcast-retraction.journey.test.ts:461`; the string-field analogue is the report-copy absence at :1848). The comment at :2673-2675 now agrees exactly with what is asserted — no comment edit needed once the assertion landed.
- **A2 — :1706, :1724-1731, :1737-1739** — step 17 installs `const publication = spyLifecyclePublication();` before the denial, wraps the `catchJourneyError` call in try/finally with `publication.stop()`, and adds `expect(publication.calls).toHaveLength(0);` under the same trailing-comment style as steps 13/23/26 ("The denial dispatched nothing and moved no inbox."). The zero-writes comment no longer mentions the inbox inline (moved into the dispatch section).
- **A3a — :9-25** — the landing-history paragraph replaced by a concise behavioral description: sequential real-service journey, declaration-order steps, honest denials, money moves only along stepped transitions (escrow at booking, released once by dual confirmation, refunded on cancel, reversed by Refund arbitration), the closing System end-state sweep, and the zero-residue teardown discipline. The Cast section, the Journey-rules-honored section, and the Run section are unchanged.
- **A4 — :817** — `const teacherProfile = await readTeacherProfileRow();` replaces the inline 5-line read+guard; the five verbatim assertions on the profile row are unchanged (the helper carries the identical vanish guard).

### `test/workflows/students/DIAGRAMS.md`

- **A3b — :7** — one behavioral paragraph (2 sentences) per rule 13: the arc's legs in journey order + the diagram-fidelity note. The mermaid block, actors, and teardown note are unchanged; re-validated OK.

### `test/workflows/helpers/journey-fixtures.ts`

- **B — :22-28** — the file-top fixture-writes bullet rewritten: fixture shortcuts for an end state without walking the full production chain; suites verifying a chain itself must drive the production services (`ParentLinkRequestService.requestLink` / `respondToLinkRequest` for the link chain); explicit field-mapped updates, never client-input spreads. `git diff` confirms comment lines only; no executable line changed. The `country: "Egypt"` line (:266) was NOT touched — ledger D8's out-of-scope baseline issue, owned by the foreign country-selector workstream.

## 3. Verification results (strict order, all via `~/.bun/bin/bun`)

| # | Check | Result |
|---|---|---|
| 1 | `bun run scripts/health/sub-loop.ts test/workflows/students/student-full-journey.journey.test.ts --lifecycle duplicates` | **exit 0** — tsgo → oxlint → biome → lint:type-aware → check:duplicates all passed first run (no iteration needed) |
| 2 | `bun run scripts/health/sub-loop.ts test/workflows/helpers/journey-fixtures.ts --lifecycle duplicates` | **exit 0** — all stages passed first run |
| 3 | `bun run test/scripts/run-test.ts test/workflows/students/student-full-journey.journey.test.ts` | **31 pass / 0 fail / 716 expect() calls** (714 + the 2 new assertions: A1's not-contains + A2's zero-publish) — all steps green including the modified step 0, step 17, and step 29 |
| 4 | `bun run test/scripts/run-test.ts test/workflows/helpers/helpers.self-test.test.ts` | **17 pass / 0 fail / 70 expect() calls** — helper contract unchanged |
| 5 | `bun run validate:mermaid test/workflows/students/DIAGRAMS.md` | **OK — 1 diagram** |

No fix caused a red state; nothing was reverted.

## 4. Final verdict

**Zero blocking findings.** All 5 triaged fixes (A1–A4, B) applied and verified green; the 5 accepted-as-is items are documented above (2 pure intra-file style items, 1 informational specs.md wording note, 2 R6 lean-coverage informational notes). The suite remains 31/31 green with zero-residue teardown intact (the afterAll discipline was untouched).

## 5. Scope discipline

Only the four permitted surfaces were modified: the journey test file, `DIAGRAMS.md`, `journey-fixtures.ts` (comment-only), and this outcome file. No production code, no helpers' executable lines, no locale keys, no commits. No checkbox flips (review wave is not a numbered task); no ledger rows added (no new deferred work discovered — the `country: "Egypt"` baseline remains D8's, untouched).
