# Post Fix-D Outcome (canonical docs — post-implementation review, cluster D)

Branch: `feat/in_session_locking_hide_from_directory` (checked out and verified before and
after every command chain — the sandbox reset the checkout to `main` between tool calls, as
recorded by the 2.1–4.1 and 5.1 outcomes; edits were staged in `/tmp` and applied+re-verified
atomically per chain).
Scope: fix cluster D only — `docs/teachers/teacher-availability.md` and
`docs/sessions/session-lifecycle.md`. Not committed. No code touched (clusters A/B own code;
the docs are amended to match the shipped post-fix-A code). `AGENTS.md` / `.agents` /
`instructions/*` untouched.

Review findings addressed: pentester MEDIUM #2 (doc attribution — the Available-direction
WHERE guard overstated as an independent race-closer) and review-backend MEDIUM #1 (doc
anchors drifted by the post-review fix-A commit `a1ebfea2`, which added the FOR UPDATE
serialization preamble inside `releaseInSessionLock`).

---

## FIX-D1 — `docs/teachers/teacher-availability.md`

### Mechanism attribution (Available-direction write guard)

The docs claimed the repo primitive's WHERE direction-guard "closes" the toggle-vs-start
race ("race-closed 409"). Truth-first correction, in three places:

- **§2.1 operation table (Available row, `:41`)** — repo-primitive cell rewritten: zero rows
  while a `started` session exists ⇒ the service's 409 **backstop**; the race itself is
  serialized by the `lockForCertificationCheck` FOR UPDATE row lock (§3.1 pointer).
- **§2.2 gate-pipeline diagram (step 2f, `:77-78`)** — "the race-closed 409 backstop" →
  "the 409 backstop — defense-in-depth behind 2c's FOR UPDATE row lock, not an independent
  race-closer" (ASCII alignment preserved).
- **§3.1 (`:96-98`)** — the guard sentence no longer says "race-closed"; a NEW attribution
  paragraph states the real mechanism: the direction guard is a **defense-in-depth
  predicate**, NOT the mechanism that closes the toggle-vs-start race; the serialization is
  the `lockForCertificationCheck` FOR UPDATE teacher-row lock
  (`backend/services/teachers/teacher-availability.service.ts:208`) taken at the head of the
  pipeline and held across the whole toggle transaction — a concurrent session-start's
  acquire waits on the row lock while the INV-A2 gate re-checks the session table inside it;
  the guard's zero-row → conflict mapping is the backstop behind that lock (this service is
  the intent write's sole caller), never an independent race-closer. The "sole caller" claim
  is grep-verified: `TeacherRepository.setAvailabilityIntent` has exactly one production
  caller (`teacher-availability.service.ts:250`).

### Shipped-fix paragraph (§6.2) — post-fix-A release serialization + anchor shifts

- **§6.2 (`:315`)** — the shipped-fix paragraph now records the post-review addition:
  the release **OPENS with a `FOR UPDATE` serialization preamble on the teacher row**
  (`backend/db/repo/teachers/teacher.repository.ts:637`), taken BEFORE the last-exit probe:
  concurrent releases of the same teacher serialize on that row lock, and the later release
  re-evaluates the last-started-exit guard under the lock against the fresh post-wait state —
  closing the double-defer strand (each exit classifying `active_sessions_remain` from its
  own pre-lock snapshot would strand the lock: marker set, zero `started` sessions); the
  preamble writes nothing, so a classified no-op still leaves `is_online`, the marker and
  `updated_at` untouched. Matches `post-fix-A-outcome.md` FIX-A1 and the code comment at
  `teacher.repository.ts:628-636` verbatim in substance.
- **Anchor shifts applied** (fix-A grew the repo file by 62 lines below the acquire):
  `releaseInSessionLock` `:604` → `:624` (§4.1 trio list `:178`, §6.2 `:315`);
  `setAvailabilityIntent` `:709` → `:741` (§3.1 `:96`, §4.1 `:178`); the cold-path
  classification read added at `:666` is cited in §6.2 next to the `no_lock_held`
  description. `acquireInSessionLock` `:526` unaffected (fix-A inserted strictly below it).

## FIX-D2 — `docs/sessions/session-lifecycle.md`

- **§2.3 release-semantics blockquote (`:89`)** — serialization sentence INSERTED between
  the restore-once clause and the four-exit composition: the release OPENS with a `FOR
  UPDATE` serialization preamble on the teacher row
  (`backend/db/repo/teachers/teacher.repository.ts:637`) — taken BEFORE the last-exit probe:
  concurrent releases of the same teacher serialize on that row lock, and the later release
  evaluates the last-started-exit guard under the row lock against the fresh post-wait state
  (the earlier exit's committed session write is visible), closing the double-defer strand.
  The release primitive's anchor updated `:604` → `:624`. The FOUR-exit composition sentence
  and the deploy-cutover note are byte-identical to before (per instruction, kept intact).
- **§2.3 INV-S6 row (`:81`)** — drifted anchor only: `setAvailabilityIntent`
  `teacher.repository.ts:709` → `:741`.

## Verification battery (all green, run against `a1ebfea2` on the branch)

| Check | Result |
|---|---|
| `grep -rn "setOnline" docs/` | ✅ exactly the 5 known hits, ALL explicitly historical/retired (`teacher-availability.md` §4.1 `:178`, §5.1 `:219`, §6.2 `:311`, §6.3 `:321`; `session-lifecycle.md` §10 `:192`) — zero present-tense references; no `setOnline` line edited |
| `grep -rn "race-closed" docs/` | ✅ 0 hits (the overstated attribution phrase is gone; the only "race" language left attributes serialization to the FOR UPDATE lock) |
| `teacher.repository.ts:637` | ✅ `for("update")` serialization preamble line |
| `teacher.repository.ts:666-667` | ✅ typed outcome classification (`no_lock_held` / `active_sessions_remain`) |
| `teacher.repository.ts:624` / `:741` / `:527` | ✅ `releaseInSessionLock` / `setAvailabilityIntent` / `acquireInSessionLock` declarations (docs cite `:526`, the acquire docblock close — unchanged, still resolves into the primitive) |
| `teacher-availability.service.ts:208` | ✅ `lockForCertificationCheck(teacherId, innerTx)` — the FOR UPDATE lock at the pipeline head |
| `teacher-availability.service.ts:250-266` | ✅ intent write + zero-row → `ConflictError("TEACHER_IN_ACTIVE_SESSION")` mapping |
| `setAvailabilityIntent` callers | ✅ grep-verified: exactly one production caller (`teacher-availability.service.ts:250`) — the "sole caller" claim is true |
| `teacher.ts:36` · `session-lifecycle.service.ts:282/:403/:491/:663` · `transitions.ts:265` · `session-admin-governance.helpers.ts:387` | ✅ all re-verified on the branch (carried anchors, unchanged by fix-A) |
| `git diff --name-only` | ✅ exactly `docs/teachers/teacher-availability.md` + `docs/sessions/session-lifecycle.md` |
| Branch (first and last action of every chain) | ✅ `feat/in_session_locking_hide_from_directory` @ `a1ebfea2` |

## Diff summary

```
 docs/sessions/session-lifecycle.md     | 4 +-++ (2 anchor points + 1 inserted sentence, 1 line)
 docs/teachers/teacher-availability.md  | +10/-5 lines across §2.1, §2.2, §3.1, §4.1, §6.2
 2 files changed (no code files)
```

## Carry-forward (NOT this fix's scope — recorded for the owners)

- **`docs/specs/state-machine-invariants.md:127` anchor drift:** its §3.3 in-session-lock
  implementation-reference blockquote still cites `releaseInSessionLock … :604` and
  `setAvailabilityIntent … :709` — both shifted by fix-A (`:624` / `:741`). The review
  findings scoped cluster D to exactly the two docs above (and the diff gate requires
  exactly those two files), so this third doc was left untouched; a one-line anchor patch
  there is the natural follow-up.
- The code-side docblocks that still say "RACE-CLOSED" for the intent primitive's
  Available-direction guard (`teacher.repository.ts:704`, `teacher-availability.service.ts`
  comment at `:253`) carry the same nuance the docs no longer do — wording lives in
  clusters A/B's files and was deliberately not touched here (docs-only cluster).
- §6.2's historical hazard narrative and §6.3's sweep composition remain verbatim (5.1's
  SEC/IV constraints re-verified: §6.1 forward contract untouched, no new heading levels,
  blockquote/table style reused).
