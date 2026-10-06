# Round R4 — fix outcome

Branch: `feat/in_session_locking_hide_from_directory` @ `73716ea8` (uncommitted working-tree fixes; nothing committed).

## FIX-1 — `releaseInSessionLock` docblock ¶1 (`backend/db/repo/teachers/teacher.repository.ts` ~:543-547)

Removed the superseded serialization claim ("the release path has no read-then-write window: concurrent releases serialize on the row lock the UPDATE takes" — false: a zero-row UPDATE takes no row lock). Reworded to the truthful mechanism, one sentence consistent with ¶2 and the inline preamble comment:

> The guard and the mutation are the same statement, and the captured intent is restored exactly once: concurrent releases serialize on the teacher-row `FOR UPDATE` preamble taken before the probe, whose lock-wait re-evaluates the last-exit predicate against fresh committed state.

## FIX-2 — stale anchors (`docs/teachers/teacher-availability.md`)

- :96 — `teacher-availability.service.ts:250-266` → `:258` for the intent write, `:259-283` for the zero-row → 409 mapping (ConflictError at `:277`).
- :98 — `lockForCertificationCheck` FOR UPDATE call `:208` → `:215`.

(Anchors verified against the service source on the branch before writing: `:215` lock call, `:258` `setAvailabilityIntent`, `:259-283` mapping, `:277` `ConflictError`.)

## Verification

- `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/teacher.repository.ts --lifecycle duplicates` → exit 0 (tsgo / oxlint / biome / lint:type-aware / duplicates all pass).
- `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/teacher.repository.test.ts` → **82 pass / 0 fail** (405 expect calls), exit 0.
- `git diff --name-only` → exactly `backend/db/repo/teachers/teacher.repository.ts` + `docs/teachers/teacher-availability.md`.

Not committed (per instructions).
