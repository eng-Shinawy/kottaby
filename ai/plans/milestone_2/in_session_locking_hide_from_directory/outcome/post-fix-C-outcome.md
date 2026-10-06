# Post Fix-C Outcome (service tier — INV-S6 deferral-matrix case)

Branch: `feat/in_session_locking_hide_from_directory` (verified before and after every command
chain; the sandbox re-flipped the checkout to `main` between tool calls early in the session —
every chain re-checked out the branch first; once the test file carried its uncommitted edit the
flip stopped touching the tree, matching the 3.1 outcome's observed behavior).
Scope: fix cluster C only — `backend/services/classes/session-lifecycle.service.test.ts`.
Not committed. No other files touched by this agent.

## FIX-C1 [LOW — tier-fidelity gap] — SERVICE-tier two-started-sessions deferral matrix — CONFIRMED COMPLETE

The INV-S6 describe block (`SessionLifecycleService — INV-S6 in-session lock (runInRollback)`)
gained the plan §10 "two-started-sessions deferral matrix" case as TWO verdicts (the finding's
true AND false marker variants), appended after the "release verdicts surface in logs" case so
the block stays in verdict order:

1. **"two started sessions ⇒ the first exit defers the release, the second restores the captured
   ONLINE intent"** — fixture idiom of the neighboring started-leg cases: `createSessionActors` +
   `forceTeacherOnline`, TWO `insertSessionRow` rows (`Started` + `startedAt`) on the SAME teacher,
   then the suite's lock-posture write `.set({ isOnline: false, wasOnlineBeforeLock: true })`
   (ONE captured marker over TWO started rows — first-lock-wins), pre-read via the two-column
   oracle. Completing session A returns success (`Completed`); the release DEFERS — exactly ONE
   debug line (`"In-session lock release deferred: active sessions remain"`, payload pinned
   `toEqual({ teacherId, outcome: "active_sessions_remain" })` via the neighboring `logger.debug`
   spy idiom, restored in `finally`) — and the oracle proves the deferral wrote NOTHING:
   `{ isOnline: false, wasOnlineBeforeLock: true }` (marker INTACT). Completing session B (the
   last exit) restores per the ORIGINAL marker: `{ isOnline: true, wasOnlineBeforeLock: null }`,
   with ZERO release lines at debug or error level (silent happy path, spy-filtered on the
   `"In-session lock release"` prefix exactly like the neighboring log-verdict case).
2. **"two started sessions ⇒ the captured OFFLINE intent survives the deferral and restores
   verbatim (never resurrect)"** — the false variant, fixture idiom of the neighboring
   never-resurrect case (repo offline default, no `forceTeacherOnline`), lock posture
   `.set({ isOnline: false, wasOnlineBeforeLock: false })`. Same two-gate structure: A completes
   → deferral line + `{ isOnline: false, wasOnlineBeforeLock: false }` (the OFFLINE intent is
   NOT minted into availability by the deferred exit); B completes → the restore writes the
   captured intent VERBATIM `{ isOnline: false, wasOnlineBeforeLock: null }` + zero release lines.

Mechanics under test (service tier, ONE `runInRollback` transaction, no cross-connection racing —
that is the repo tier's FIX-A2 territory): the completion flow's unconditional
`releaseTeacherInSessionLock` → `TeacherRepository.releaseInSessionLock`, whose guarded UPDATE's
`NOT EXISTS (started session)` probe still sees the sibling `started` row on the first exit
(classified `active_sessions_remain`, no write) and matches on the last exit (restore + marker
consume). Everything asserts through the suite's established `readTeacherLockState` two-column
oracle — `is_online` AND the marker asserted TOGETHER at every step (pre-flight, after the
deferred exit, after the last exit). No new imports, no helper changes, no `any`, no
`expect(...).rejects.toThrow()`, all DB work inside `runInRollback` with `tx` propagated — the
Tier-4 static source pins are untouched and green (the edit adds zero service-unit surface).

## Verification battery (all green)

| Check | Result |
|---|---|
| sub-loop `--lifecycle duplicates` `backend/services/classes/session-lifecycle.service.test.ts` | ✅ exit 0 — tsgo ✓ (no errors for the file), oxlint ✓, biome:check ✓, lint:type-aware ✓, check:duplicates ✓ (outside jscpd scan scope — skipped by policy, tool-noted) |
| `bun tsgo` | ✅ exit 0, 0 errors |
| `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | ✅ **83 pass / 0 fail, 930 expect() calls, exit 0** — 81 prior cases + the 2 new deferral-matrix verdicts (both RAN, ~11–22ms each, visible in the INV-S6 block). The one `[ERROR] Session lifecycle blocked: in-session lock write matched zero teacher rows` line is the pre-existing zero-row-acquire case's expected fail-closed log (benign, asserted by that case). |
| `git diff --name-only` | ✅ MY delta is exactly `backend/services/classes/session-lifecycle.service.test.ts` (127 insertions, 0 deletions). Two OTHER working-tree modifications exist that this agent did NOT touch and did NOT revert: `docs/sessions/session-lifecycle.md` and `docs/teachers/teacher-availability.md` (a concurrent fix cluster's doc updates describing fix-A's FOR UPDATE serialization; `post-fix-D-outcome.md` was observed appearing concurrently in the same outcome dir). Per the no-scope-creep mandate they were left byte-untouched. |

## Diff summary

```
 backend/services/classes/session-lifecycle.service.test.ts | 127 +++++++++++++++++++++
 1 file changed, 127 insertions(+), 0 deletions(-)   (this agent's delta)
```

Pure append inside the INV-S6 describe: two `test(...)` blocks + blank-line separators; the
neighboring cases, both oracles (`readTeacherOnline`, `readTeacherLockState`), all helpers, and
the file's import block are byte-identical.

## Instruction verification (.agents/instructions/tests.instructions.md)

- Runner `bun run test/scripts/run-test.ts` (never raw `bun test`) ✓; `runInRollback` + `tx`
  propagation to every service call ✓; logger spied with `spyOn` + `mockRestore()` in `finally`
  ✓; no `console.*`, no `any`, no new imports, no seed data (fixtures via the suite's own
  helpers) ✓; source-scan pins untouched and verified green in the same run ✓; quality loop
  (tsgo + lint) exit 0 after the change ✓.

## Notes for the orchestrator

- Behavior was already pinned at the repo tier (FIX-A's cross-connection race tests, 82 repo
  tests) and end-to-end in journey J4; this change closes ONLY the service-tier mechanics gap
  (review-backend LOW #2) — zero production files touched, zero behavior change.
- Concurrent-agent working-tree traffic (two doc files + `post-fix-D-outcome.md`) was present at
  hand-off; this agent's fingerprint is the single test-file edit listed above. DO NOT commit
  still holds for the whole tree.
