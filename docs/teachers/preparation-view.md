# Teacher Preparation View (Read-Only Pre-Session Glance)

> Contract doc for the teacher preparation dialog — the read-only readiness
> view a teacher opens from a scheduled session row before starting it.
> Sibling docs: `docs/teachers/evaluation-loop-booking.md` (the booking/
> lifecycle CTAs this dialog sits beside), `docs/sessions/session-lifecycle.md`
> (the state machine the host row rides), and `docs/sessions/session-report-homework.md`
> (the flow that owns homework writes).

**Domain:** Teachers / session preparation
**Status:** Implemented and verified (dialog cluster + read documents + cross-actor
journey landed; this doc was written from the shipped surface).

## Why

When a student requests a Tajweed session, the teacher must review the student's
current lesson progress before starting it — a prepared teacher opens the right
lesson material (functional requirement FR-6.2). The preparation dialog is that
review surface: on a scheduled tajweed row the teacher opens **Prepare** and sees
two things at a glance —

1. **Progress** — the student's curriculum position: current lesson, its 1-based
   position, completion percent, plan title, final-lesson flag — or the honest
   "first session — diagnostic" state when no progress exists yet.
2. **Previous homework** — the student's homework history, newest-first, with
   jadid/madi track spans and their grades (or the not-yet-graded presentation).

The surface is deliberately **read-only with zero write affordances**: no
accept/decline (booking confirmation rides the existing confirmation handshake),
no grading (session report owns it), no progress writes (settlement owns them).
Opening the dialog issues reads only; it creates no rows, sends no notifications,
and moves no money. Its entire purpose is to make shared state visible *before*
the session starts.

## Pattern

The dialog cluster follows the repo's established dialog-cluster anatomy — the
same split the session report dialog uses (all view files under
`frontend/views/teacher/sessions/`):

| Layer | File | Role |
|---|---|---|
| Helpers | `teacherPrepDialog.helpers.ts` | The ONLY derivation layer. Pure functions fold codegen payloads into view models: `resolvePrepSection` (first-session vs positioned card), `resolvePrepHomeworkRows` (jadid/madi span shaping, null-grade preservation), `resolveHiddenHomeworkCount` ("+N more" math), `shouldOfferPrep` (the Prepare-affordance gate). No React, no hooks, no network — directly bun-testable, which matters because the repo has no component-render test layer. |
| Hook | `useTeacherPrepQueries.ts` | Two stateful `useQuery` calls (`@apollo/client/react`) composing the two existing read documents — `studentProgressQueryDocument` and `studentHomeworkHistoryQueryDocument`. Shared skip gate `!open || !studentId` (nothing runs while closed), folded `loading`, explicit homework window `{ page: 1, pageSize: 5 }`. |
| Parts | `TeacherPrepDialog.parts.tsx` + `TeacherPrepHomeworkList.tsx` | Presentational blocks only: progress card / first-session banner, homework rows, skeleton, denial and retry chrome. Each section folds its OWN loading/error — one section's failure never blanks the other. |
| Orchestrator | `TeacherPrepDialog.tsx` | Thin wiring: hook → helpers → parts, zero inline derivation. Two translation handles (Sessions + Homework), `Dialog fullWidth maxWidth="sm"` with `aria-labelledby`, read-only hint footer. |
| Mount | `TeacherPrepDialogMount.tsx` | Row-keyed conditional mount: gates on `sessionId === null`, resolves the row from the cached `myTeacherSessions` page data, derives `studentId` server-side, renders `<TeacherPrepDialog key={sessionId} … />`. |
| CTA matrix | `teacherSessionCacheArms.ts` | The Scheduled branch pushes the Prepare descriptor `{ id: "prepare", label: t.prepAction, onIntent: wiring.onPrepare }` FIRST when `shouldOfferPrep(session)` admits the row — no in-flight slot (the dialog owns loading). The dialog-session slot (`prepDialogSessionId` / `openPrepDialog` / `closePrepDialog`) lives in `useTeacherSessionDialogSessions.ts`. |

Three disciplines make this composition work:

**Consume-don't-duplicate.** The dialog composes two reads that already exist and
are already gated — `studentProgress` (the progress ticket's read model) and
`studentHomeworkHistory` (the report flow's history page) — instead of adding a
new composite "studentPreparation" resolver. Two round-trips per open is the
accepted composition cost. Both reads re-verify the teacher↔student shared-session
relationship server-side (any session status qualifies), so the composition stays
tenancy-safe without minting a new gate to keep in sync.

**Row-keyed mount.** The row identity (`sessionId`) is the only payload the CTA
carries; the mount — not the user, not the CTA — derives the student id from the
cached session row. The `key={sessionId}` conditional render means every open is a
fresh mount and every row switch unmounts the old dialog: stale-dialog races are
structurally impossible rather than guarded against.

**Freshness contract: network-only per open.** Both queries run
`fetchPolicy: "network-only"`. This is not decoration: the progress payload is an
id-less read model stored inline under `ROOT_QUERY.studentProgress({studentId})`,
so with the default cache-first policy a same-student reopen is served from the
warm cache entry with no network request — silently swallowing exactly the
progress advance (a settlement that confirmed elsewhere) the dialog exists to
show. `network-only` restores "next open shows current state" at the cost of two
round-trips; the fetched rows still land in the cache for DevTools/hot-reload.

## Rules

1. **First-session honesty — `hasProgress` is the ONLY signal.** The
   first-session banner renders if and only if `hasProgress` is false; a
   positioned card is unreachable without the flag, even when lesson fields ride
   along populated (an active plan without a settled pointer row is a real server
   state, and a broken payload must never upgrade into a curriculum position).
   Hostile shapes fold to the honest state too: a missing or blank lesson title,
   a position outside the 1-based band, a zero lesson total, a percent outside
   0–100, a missing final-lesson flag. The helpers never invent a number to fill
   a gap — the server is the authority on every value.

2. **Null grades are preserved, never zeroed.** An assigned-but-ungraded track
   keeps its span with `grade: null` and renders a muted not-yet-graded chip —
   never a fabricated `0`. A row with both spans null is still kept and renders
   the no-assignment state. The view model holds nulls; rendering decides the
   presentation.

3. **Read-only guarantee, provable by imports.** The cluster imports only the two
   query documents — zero mutation imports anywhere (grep `useMutation` /
   `MutationDocument` across the cluster returns nothing). Progress and homework
   writes stay inside their owning flows; this surface cannot mutate anything.

4. **Denials render `PermissionDeniedFallback`; denials are constant-shape.** The
   server denies a foreign teacher with the same `FORBIDDEN` code and translated
   message whether or not the student exists — no existence oracle. The UI maps
   the FORBIDDEN code to the shared `PermissionDeniedFallback` seam; any OTHER
   settled failure (uncoded or network) surfaces as a localized retry alert. Test
   the query `error` field directly — never a code gate, which would swallow
   uncoded errors into a silent empty render.

5. **Id-less read models opt out of normalization.** `StudentProgress` carries no
   `id`, so Apollo cannot normalize it; the type registers
   `StudentProgress: { keyFields: false }` in `frontend/providers/apollo/apolloCache.ts`
   (the documented opt-out for id-less/embedded types —
   `frontend/graphql/AGENTS.md:87-96`). Registering the policy prevents
   "Cache data may be lost" warnings and keeps the payload read back inline under
   its root field. Any new GraphQL type without an `id` gets the same one-line
   policy + docblock inventory entry.

6. **i18n: leaves in the sessions namespace; function leaves registered in the
   parity belt.** The prep vocabulary (15 leaves — action label, dialog title,
   position line, first-session banner, homework empty states, "+N more" line,
   read-only hint, …) lives in the `sessions` namespace (en + ar identical key
   sets). Interpolating function leaves MUST be registered in
   `shared/locale/sessions-namespace.parity.test.ts` — both in `FUNCTION_LABEL_KEYS`
   and with arity-exact `sampleArgsFor` — or the belt's non-empty-string check
   throws on the function value. Homework row labels are REUSED from the existing
   homework namespace (`trackJadid`, `trackMadi`, `gradeLabel`, `sessionLine`,
   `statusPendingChip`) through a second `useAppTranslation(Homework)` handle:
   the hook takes exactly one namespace handle, so a second vocabulary means a
   second call, not a union type.

7. **Identity is row-derived and NaN-guarded.** The session row's `studentId` is
   a GraphQL `ID` string over the shared numeric student PK; the progress read's
   variables demand `Int!`. The mount converts once, guarded:
   `Number.isFinite(Number(row.studentId))` — a malformed id folds to `null`,
   which skips both reads and renders the no-student state instead of a bogus
   `Student #NaN` line. Apply the same parse-once-plus-guard discipline to every
   numeric re-parse of a serialized id (homework rows re-parse their session
   reference the same way). Apollo Client v4 gotcha: `useQuery` results expose no
   `called` field (only `useMutation` results carry it) — gate "did the read
   execute" on the skip inputs themselves.

## What NOT to Do

- **No composite resolver for teacher+student reads that already exist gated.**
  Compose the shipped reads; two round-trips beat a second server gate.
- **No fetchPolicy-less (cache-first) reads for current-position data.** The warm
  `ROOT_QUERY` entry makes a same-student reopen silently stale.
- **No deriving first-session from homework emptiness.** The states diverge: a
  student with no curriculum progress can still have graded homework history from
  earlier work, and the honest presentation shows BOTH (banner + rows).
- **No display names on teacher surfaces yet.** The numeric `Student #id` line is
  the deliberate contract (identity rides the teacher's own row payload; both
  reads re-verify server-side).
- **No `studentId` from user input.** It is row-derived in the mount, then
  re-verified server-side — the closed loop that closes IDOR.
- **No `useLazyQuery`.** Stateful `useQuery` with `skip` is the repo-wide
  pattern; the skip gate keeps closed dialogs network-silent.
- **No mutations on this surface.** If a task seems to need one here, the design
  is wrong — the write belongs to its owning flow (report, settlement, booking).
- **No new nav/routes for row-scoped actions.** Row CTAs ride the existing
  session-row action matrix; the dialog opens over the sessions page.

## Rollout Summary

What shipped:

- **Affordance**: scheduled tajweed rows offer **Prepare** before Start Session
  (order asserted by the CTA matrix suite); hifz/evaluation and non-scheduled
  rows are unaffected.
- **Dialog**: the two-section read-only preparation view (progress card /
  first-session banner + previous-homework list) with independent per-section
  loading/denial/retry folds, a read-only footer hint, and Escape-close + keyed
  re-open.
- **15 i18n leaves** in the sessions namespace (en + formal-MSA ar) with
  parity-belt registration for both function leaves.
- **Read document** `frontend/graphql/sharedDocuments/scheduling/student-progress.documents.ts`
  (the plan's only new operation surface) + the `keyFields: false` cache policy.
- **10 Storybook stories** covering every visual branch (positioned, final-lesson,
  first-session ± homework, null grades, "+N more", both denial folds, retry,
  skeleton) — zero component logic added to make them work.

How it was verified:

- Helpers suite **33 pass / 0 fail** (53 expect calls); CTA matrix suite
  **26 pass / 0 fail** (81 expect calls); i18n parity belt **45 pass / 0 fail**
  (2,081 expect calls).
- Cross-actor journey **6/6 green on two consecutive runs** (84 expect calls):
  honest zero vs positioned payload, foreign-teacher denial probes with the
  constant FORBIDDEN shape, notification dispatch spied at the boundary with
  zero unexpected fan-out, zero DB residue after teardown.
- Review convergence: a mid-point review plus five post-implementation review
  rounds (each with independent frontend/types, boundary, and security
  reviewers) converged to zero findings — the round fixes themselves hardened
  the rules above (per-open freshness, blank-title fold, NaN guards, aria for
  the ungraded chip, executed-read gating).
- Static gates clean at close: `tsgo` 0 errors repo-wide, biome clean (~2.5k
  files), lint-service clean, per-file quality sub-loop exit 0 on every touched
  file; diff audit confirmed zero backend/app/nav files.
- **Dev-server DOM smoke** (teacher login → `/teacher/sessions`): the scheduled
  tajweed row rendered PREPARE before START SESSION; the dialog showed the honest
  first-session banner plus previous homework with both null-grade "—" chips and
  graded chips; Escape closed cleanly and re-open rendered identical content
  (keyed remount); **0 console errors** across the session.

## Related

- **Pattern source** — the session report dialog cluster, which this cluster
  mirrors file-for-file: `frontend/views/teacher/sessions/TeacherSessionReportDialogMount.tsx`,
  `TeacherSessionReportDialog.tsx`, `useTeacherSessionReportQueries.ts`,
  `TeacherSessionReportHomeworkReview.tsx`, and
  `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts`
  (owner of `studentHomeworkHistoryQueryDocument`).
- **Sibling journey** — `test/workflows/classes/tajweed-progress-increment.test.ts`
  owns the settlement/pointer-advance mechanics; the preparation journey
  (`test/workflows/classes/teacher-preparation-read.journey.test.ts`) only
  consumes the state one settled session produces.
- **Read model owner** — the student progress surface (service
  `getStudentProgress` + the `studentProgress` query field), shipped by the
  progress-tracking feature.
- `docs/specs/functional-requirements.md` — FR-6.2 (Teacher Preparation).
- Plan of record and outcome directory:
  `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/`.
