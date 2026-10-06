# Post-Fix E Outcome — Carry-over Cleanup (branch: `feat/in_session_locking_hide_from_directory`)

## Scope
Two one-line carry-overs only; no test logic/assertions touched, no parallel cluster changes reverted.

## CLEANUP-1 — truth-test reword (`backend/db/test/repo/teachers/teacher.repository.test.ts` ~:1744-1748)
- Reworded the comment in the "direction guard rides ONE pinned predicate" source test that called the Available-direction guard "the race-closed write".
- Now truthful per the primitive's post-review docblock (defense-in-depth guard; serialization is the caller's FOR UPDATE row lock via `lockForCertificationCheck`): "the Available leg fires at write time when a started session exists — zero rows signal the guard fired, and the caller maps the miss to the conflict denial."
- No test name, assertion, or logic change.

## CLEANUP-2 — anchor refresh (`docs/specs/state-machine-invariants.md` ~:127)
- `releaseInSessionLock`: `:604` → `:624` (verified: definition at `teacher.repository.ts:624`).
- `setAvailabilityIntent`: `:709` → `:751` (verified: definition at `teacher.repository.ts:751`).
- Note: the task briefing suggested `:741`, but grep verified the definition at `:751`; the verified anchor was used per the task's verify-with-grep instruction.

## Verification
| Check | Result |
|---|---|
| Sub-loop `--lifecycle duplicates` on the test file | ✅ exit 0 (tsgo, oxlint, biome:check, lint:type-aware, check:duplicates all green) |
| `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/teacher.repository.test.ts` | ✅ 82 pass / 0 fail (unchanged count, 405 expect calls) |
| Every written anchor verified by grep | ✅ `:624` and `:751` match the verified definitions; stale `:604`/`:709` no longer present in the doc |
| `git status --porcelain` | ✅ only the two cleanup files joined the pre-existing cluster changes; nothing else new; no commit made |

## Observations (flagged, NOT acted on — outside scoped edits)
- Same doc line still cites `acquireInSessionLock` at `teacher.repository.ts:526`; verified definition is `:527` (pre-existing one-line drift).
- Test file retains two other pre-existing "race-blocked"/"race-closed" phrasings outside the scoped region (test name ~:1363, comment ~:1373), both already truthful in behavior (zero-row miss signal) though not reworded.
