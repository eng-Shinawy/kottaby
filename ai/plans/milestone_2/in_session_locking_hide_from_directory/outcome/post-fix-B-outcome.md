# Post-Fix-B Outcome — Cluster B (service tier): race-closed guard docblocks + retirement/caller-obligation pins

**Plan directory (verbatim):** `ai/plans/milestone_2/in_session_locking_hide_from_directory/`
**Branch at fix time:** `feat/in_session_locking_hide_from_directory` (HEAD `a1ebfea2` — includes fix-A's "serialize releases via FOR UPDATE preamble")
**Date:** 2026-10-05
**Scope:** pentester MEDIUM #2 (false "race-closed by the WHERE-guard" mechanism claim) + LOW #3 (missing source pins). Documentation + pin ONLY — zero logic changes.

---

## Ground truth established before editing

- Pentester's PG 17.11 proof stands: a guarded UPDATE that WAITS on a row lock can land via the executor's re-check reusing a stale pre-wait predicate result — the `NOT EXISTS (started)` WHERE-guard alone does NOT close the gate-vs-write window. (Domain phrasing kept in code: "a WHERE predicate cannot by itself serialize a concurrent session start against this write — the statement only sees committed session rows as of its own evaluation.")
- The invariant holds in production for a structural reason: the SOLE caller `TeacherAvailabilityService.setAvailability` takes `TeacherRepository.lockForCertificationCheck` (`SELECT … FOR UPDATE` on the teacher row) at the TOP of the toggle transaction (`teacher-availability.service.ts:208` post-edit), BEFORE the gates and the write. Every other teacher-row writer (a session start's `acquireInSessionLock` capture included) queues behind that lock, so the pre-check gates and the guarded write observe one consistent ordering. The write-time guard is defense-in-depth; the FOR UPDATE lock is the primary serialization.

## FIX-B1 (MEDIUM) — mechanism claim corrected (docblock-only)

1. `backend/db/repo/teachers/teacher.repository.ts` — `setAvailabilityIntent` docblock (was ~:709-729 pre-fix; post-edit :694-716 + :745-749):
   - "the guard is evaluated atomically with the write on the row lock" → "the predicate is evaluated with the statement itself. The guard is DEFENSE-IN-DEPTH, not the serialization …"; added: atomic gate-vs-start serialization is the CALLER's obligation — hold the teacher row lock (`lockForCertificationCheck`'s `SELECT … FOR UPDATE`) across the WHOLE toggle transaction.
   - Available-direction bullet: "the write is RACE-CLOSED: … can never flip a locked teacher back online" → "zero rows on this direction signal the guard fired at write time (a `started` session exists) or the row vanished; the caller maps that miss to the in-session conflict denial."
   - `@returns`: "race-blocked by a started session" → "the Available-direction guard fired at write time".
   - Domain language only; no engine-internals jargon; no plan-artifact tokens (keeps the repo suite's hygiene pins green).
2. `backend/services/teachers/teacher-availability.service.ts` — four comment sites, one finding:
   - Header discipline bullet (:15-22 post-edit): "guard closes the toggle-vs-start race window" → FOR UPDATE lock is the PRIMARY serialization, guard is the defense-in-depth backstop.
   - `setAvailability` docblock race paragraph (:164-180 post-edit): rewritten as "Race mechanics on the Available direction" — lock = primary serialization; guard = backstop; zero rows = guard fired (or row vanished) → SAME localized `ConflictError` (`TEACHER_IN_ACTIVE_SESSION`), message shared with the gate.
   - Inline comment above the `setAvailabilityIntent` call (:251-257 post-edit): same correction.
   - Zero-row mapping comment (:261-270 post-edit): states the certification-check FOR UPDATE lock (taken at :208/:225 pre-edit anchors; :208 post-edit — `lockForCertificationCheck` call and the `assertTeacherNotInActiveSession` gate) is the PRIMARY serialization; the mapping is the backstop on top of that lock.

## FIX-B2 (LOW) — static source pins added

`backend/services/teachers/teacher-availability.service.test.ts` — new Tier-4 static pin block at the end of the `TeacherAvailabilityService.setAvailability` describe (:1381-1410 post-edit), mirroring the repo suite's `readFileSync` + string-containment pin idiom (`teacher.repository.test.ts` Tier-4 "source:" pins, e.g. the interpolation allowlist and the absence pins):
- (a) Retirement regression pin: `serviceSource.includes("setOnline")` must be `false` — zero references of any kind in the service source (implements the plan §10 service-suite mandate "zero `setOnline` references remain (source pin)").
- (b) Caller-obligation pin (source-order, NOT a runtime spy): `indexOf("TeacherRepository.lockForCertificationCheck(teacherId, innerTx)")` must be `>= 0`, `indexOf("TeacherRepository.setAvailabilityIntent(teacherId, isOnline, innerTx)")` must be `>= 0`, and lock-index < write-index — the FOR UPDATE serialization structurally precedes the write.
- Added imports: `readFileSync` (`node:fs`), `join` (`node:path`), placed after the `bun:test` import (mirrors the repo suite's import order).

## Pin-interaction audit (stale-pin check — tests.instructions.md rule)

- Repo suite whole-file pins unaffected: no `--`, no `${` added (count pin still 13), no `.prepare(`/`sql.placeholder`, `lockForCertificationCheck` signature untouched, no `logger`/`console.`/`getServerTranslations` tokens, no `REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md` matches in the new docblock text.
- `repoSetAvailabilityIntentSource()` slices from the function signature onward — docblock edits are outside every function-slice pin.
- Service suite had NO pre-existing pins over the service source; the new pin is the first (and was verified against the post-edit source).

## Verification (all mandatory steps executed on the feature branch)

1. `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 for BOTH `backend/db/repo/teachers/teacher.repository.ts` and `backend/services/teachers/teacher-availability.service.ts` (tsgo + oxlint + biome:check + lint:type-aware + check:duplicates all green; the test file was also run through the sub-loop after its edit → exit 0).
2. `bun tsgo` → 0 errors.
3. `bun run test/scripts/run-test.ts backend/services/teachers/teacher-availability.service.test.ts` → **66 pass / 0 fail** (65 pre-existing + 1 new source pin), 299 expect() calls.
4. `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/teacher.repository.test.ts` → **82 pass / 0 fail** (regression clean, as expected for a docblock-only change).
5. `git diff --name-only` — cluster-B changed files are EXACTLY the three in-scope files: `backend/db/repo/teachers/teacher.repository.ts`, `backend/services/teachers/teacher-availability.service.ts`, `backend/services/teachers/teacher-availability.service.test.ts`. (The working tree ALSO carries files owned by concurrent clusters — `backend/services/classes/session-lifecycle.service.test.ts`, `docs/sessions/session-lifecycle.md`, `docs/teachers/teacher-availability.md`, and untracked outcome files from clusters C/D; none were touched by this fix. NOTE: the task's "exactly the two files" expectation does not count FIX-B2's test file — the pin work makes it three cluster-B files by construction.)

## Cross-file dependencies / carry-overs

- The repo test file's Tier-4 comment (`teacher.repository.test.ts:1744-1747`) still says "the guard is evaluated atomically with the write … (the race-closed write)" — the same superseded mechanism phrasing this fix corrects in the source docblocks. NOT touched here (outside cluster-B scope, `git diff` discipline); recommend the reviewer route it to the test-file owner for the same one-paragraph correction, else the corrected source docblock and the test comment disagree.
- `docs/teachers/teacher-availability.md` §6-race narrative (cluster D's file, concurrently modified) should carry the SAME corrected mechanism (lock = primary serialization, guard = backstop) so docs and docblocks do not drift again.
- The shared sandbox had concurrent agents flipping branches during the fix; every verification chain re-verified `feat/in_session_locking_hide_from_directory` first and last, per protocol.
- Nothing committed — all changes left uncommitted for the orchestrator's gate, per instructions.
