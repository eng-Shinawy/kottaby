
## Gaps

No row is MISSING an artifact, but three findings affect how the launch plan should verify and sign off:

1. **No DB-level backstop for `session.status` (INV-S1/S2).** Financial tables have `prevent_*` triggers (`backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:43-48`) and `student_payments` has a guarded transition trigger (`20260907182426_custom_4-*`), but grep across `backend/drizzle/*/migration.sql` finds **zero** `CREATE TRIGGER` touching the `session` table. INV-S1/S2 are enforced only by application-layer guarded UPDATEs (pre-state folded into WHERE clauses). The checklist's "Attempt transition — must fail" therefore holds only through the service/GraphQL surface; a raw SQL UPDATE by an operator would succeed. Needed: either (a) a `prevent_session_status_update`-style trigger permitting only the eight legal edges, or (b) an explicit sign-off note that enforcement is app-layer-only plus a documented negative probe (assert no non-repo writer exists — e.g. a lint/grep rule or the single-writer discipline note).

2. **Docs-vs-code drift on the INV-S7/INV-S8 "gate" functions.** `docs/sessions/session-lifecycle.md:82-83` says the gates are "consumed by the session report/homework write surface", but grep shows `assertSessionCompletedForReport` / `assertReportSubmittedForHomework` (`session-lifecycle.enforcement.ts:127,164`) have **no production consumer** — only `assertTeacherNotInActiveSession` is imported (`backend/services/teachers/teacher-availability.service.ts:63`). The real enforcement is `session-report.service.ts:262-274` (`lockForReportGate` fused gate) and the structural atomic co-creation. The launch checklist verification for rows 5.1.7/5.1.8 must cite the report service (or the drift gets baked into the sign-off). Note: the unconsumed gates are fully tested, so they are available if a future surface needs them; knip tolerates them via the services barrel.

3. **No consolidated invariant manifest.** The M4 Dev-2 ticket (docs/planning/TICKETS.md:2883-2906) demands "Automated tests that verify all state machine invariants … 50+ invariants" covering 10 state machines, and the launch ticket's criteria (TICKETS.md:3060) includes "All state machine invariants pass". No single suite or manifest named for state-machine invariants exists (`grep "State machine invariant verification" docs/planning/TICKETS.md` finds only the ticket; `test/integration/` holds only provider smokes; no `invariant` suite in `backend/db/test/`). The evidence is real but scattered across ~15 files in 4 layers. Needed: a launch-artifact matrix (the executed checklist itself) mapping each of the 14 rows here (and the other sections' rows) to the exact test IDs + the commands that run them, so sign-off is reproducible.

4. **Minor nuance for row 5.2.2 (record, not fix):** distinctness is enforced at BOOKING time per cycle; the rubric quorum read (`evaluation-rubric.helpers.ts:511`) does not re-verify distinctness — it counts submissions. INV-TV2 holds transitively (distinct booking ⇒ distinct submissions; per-cycle `evaluations_session_evaluator_unique` backstops per-session). Also documented (state-machine-invariants.md:68): a cancel frees the evaluator slot, and a fresh activation re-admits previously used evaluators — the launch verification should assert the as-built semantics, not a naive "never twice, ever".

## Harness Recommendations

For the launch plan's execution of §5.1/§5.2, prefer **running and citing existing suites** over writing new tests:

1. **Execution commands (existing, per layer):**
   - `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` (+ `.enforcement.test.ts`, `session-report.service.test.ts`)
   - `bun run test/scripts/run-test.ts backend/services/teachers/evaluation-rubric.service.test.ts` (+ `evaluation-booking.service.test.ts`, `applicant-lifecycle.service.test.ts`, `verification-purchase.service.test.ts`)
   - `bun run test/scripts/run-test.ts backend/db/test/repo/classes/session.repository.test.ts` (INV-S4 23502 probes)
   - `bun run test/scripts/run-test.ts test/workflows/sessions` and `test/workflows/teachers` (journeys; committed-fixture layer, mandatory per `test/workflows/AGENTS.md`)
   - `bun run scripts/verify-unique-constraints.ts` (live-DB catalog probe for 5.1.8 arbiters)
   - `bun run test:graphql`-layer files: `backend/graphql/test/admin-applicant-override.wire.test.ts`, `admin-teachers.mutation.test.ts`
2. **New artifact to create (one):** a launch verification manifest — `test/config/` or `scripts/` is the consistent home (e.g. `scripts/launch/invariant-verification.ts` or a markdown matrix appended to the executed checklist): per row → {enforcement site, test files, runner command, result}. This is what the sign-off table in PRODUCTION_READINESS §9 references when checked.
3. **DB probe (gap 1), if the trigger route is chosen:** follow the existing `custom_*` migration pattern under `backend/drizzle/` (see `custom_3-immutability-triggers`) — a `custom_6-session-status-guard` trigger permitting only the 8 matrix edges; then add a repo-tier probe mirroring `session.repository.test.ts:2311`'s savepoint/23502 technique (expect the trigger to raise). If the app-layer-only ruling is accepted instead, record it as a deliberate exception in the launch notes — do NOT silently skip row 5.1.1/5.1.2 sign-off.
4. **Docs fix (gap 2):** update `docs/sessions/session-lifecycle.md:82-83` consumer claim, or wire the report surface to the shared gates — pick one; the launch matrix should cite whichever is true at execution time.
5. **Do not add `*.integration.test.ts`** for these rows — `test/integration/AGENTS.md` reserves that layer for live provider smokes only; these invariants are DB/service behavior and belong in the existing layers.
6. **Journey-test discipline:** any new launch journey must follow `test/workflows/AGENTS.md` (no `runInRollback`, committed fixtures + tracked cleanup, spied transports, try/catch denial helpers). For cooldown-window assertions reuse the window-bracket technique (`cooldown-state-machine.test.ts:986`: `windowStart + 30d − skew ≤ stamped ≤ windowEnd + 30d + skew`).

## Evidence Appendix

- `session-lifecycle.enforcement.ts:84-85` — terminal rows:
  ```ts
  [SessionStatus.Completed]: new Set<SessionStatus>([]),
  [SessionStatus.Cancelled]: new Set<SessionStatus>([]),
  ```
- `session.repository.lifecycle.helpers.ts:47-57` — INV-S5 fused into completion (zero-row = deny):
  ```ts
  eq(session.status, SessionStatus.Started),
  sql`EXISTS (SELECT 1 FROM ${teacher} WHERE ${eq(teacher.id, session.teacherId)} AND ${eq(teacher.isApproved, true)})`
  ```
- `teacher.repository.ts:460-466` — INV-S6 capture+lock in ONE statement:
  ```ts
  .set({ wasOnlineBeforeLock: sql`COALESCE(${teacher.wasOnlineBeforeLock}, ${teacher.isOnline})`,
        isOnline: false, updatedAt: sql`now()` })
  ```
- `session-lifecycle.confirmation.ts:129-140` — INV-S3 exactly-once earning:
  ```ts
  const confirmed = await SessionRepository.confirmStudentCompletionOnce(sessionId, callerUserId, tx);
  if (confirmed !== null) { … await creditTeacherEarning(confirmed, confirmed.fee, tx); }
  ```
- `session-report.service.ts:272-274` — INV-S7 live gate (the actual enforcement point):
  ```ts
  if (probe.status !== SESSION_COMPLETED_STATUS) { … throw new ConflictError("SESSION_INVALID_TRANSITION", …); }
  ```
- `evaluation-rubric.helpers.ts:511` — INV-TV1 quorum gate:
  ```ts
  if (submissions.length < VERIFICATION_PLAN_SESSION_COUNT) { return { submission: …, receipt: undefined, … }; }
  ```
- `session.repository.evaluation.helpers.ts:256` — INV-TV2 distinctness memory:
  ```ts
  evaluators: sql<…>`array_agg(distinct ${session.teacherId}) filter (where ${session.status} <> ${SessionStatus.Cancelled})`,
  ```
- `shared/constants/evaluation-rubric.constants.ts:21,24` — INV-TV4 periods:
  ```ts
  export const TAJWEED_COOLDOWN_DAYS = 30 as const;
  export const HIFZ_COOLDOWN_DAYS = 90 as const;
  ```
- `applicant-lifecycle.service.ts:236-244` — INV-TV3 strict cooldown gate:
  ```ts
  if (cooldownUntil !== null && cooldownUntil > now) { … throw new ValidationError("APPLICANT_COOLDOWN_ACTIVE", message); }
  ```
- `admin-teachers.mutation.ts:44` — INV-TV1 arm (b) cold-start:
  ```ts
  "Admin-only cold-start certification (INV-TV1(b) / FR-3.9): promotes an existing teacher-role user …"
  ```
- `session.repository.test.ts:2311` — INV-S4 constraint probe:
  ```ts
  test("INV-S4: a session row without its teacher party is rejected by the NOT NULL constraint (23502)", …
  ```
