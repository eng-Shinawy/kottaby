# Review Iteration R6 — review-frontend lens (independent RESCAN)

- **Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
- **Task:** 6.1 (post-implementation review iteration R6 — independent reviewer, no prior-round context)
- **Branch:** `feat/direct_student_onboarding_with_offline_payment` · **Tip at review:** `bfbe666`
- **Baseline:** `6bf6c71` (Plans #222) · **Diff scope:** `git diff 6bf6c71..HEAD --name-only` → 78 files (52 code/test + 26 plan/outcome docs)
- **Lens:** review-frontend RESCAN of the whole frontend diff — `frontend/views/admin/students/onboarding/**` (dialog + sections + hooks + the new `catalogEmpty` / `submitDisabled` / `disabled` changes from fix wave `bfbe666`), the `AdminStudentsToolbar` / `AdminStudentsDirectoryContainer` / `useAdminStudentsDirectory` deltas, the sharedDocuments document + contract test, and the `FormDialogShell` additive `submitDisabled` prop (**all other consumers verified unaffected**)
- **Checks applied:** MUI `sx`-only / palette-only / `*Outlined`; `@apollo/client/react`-only hook imports; zero `useLazyQuery`; namespace-handle-only copy; en↔ar key usage (used vs defined); password handling; id-first selections; unused props/imports; dead branches; loading/disabled-state coherence (incl. stuck-disabled / dialog-reopen resets); aria/labels; clean comments (zero plan-artifact refs)
- **Method:** read-only; atomic `checkout && verify` chain on every command; all file reads pinned via `git show HEAD:<path>`. Independent re-verification: `bun run tsgo` → clean exit, 0 errors; `studentOnboarding-namespace.parity.test.ts` → **50 pass / 0 fail** (355 expects); `admin-student-onboarding.documents.test.ts` → **10 pass / 0 fail** (27 expects). Greps for colors/hooks/imports/artifact-refs over the full scope. (Service/journey suites not re-run here — DB-backed; fix-wave results recorded in `post-implementation-review.md` §"fix wave R2-R3".)

**Session hazards (repeat of R3/R4 notes, confirmed again this round):** (1) the shared working tree flipped to `main` (`07c2675`) between tool calls — every read was re-pinned via the atomic chain and cited from `HEAD` of the feature branch; (2) terminal rendering swallowed the `[` at `useOnboardStudentMutation.ts:47` — byte-verified with `od -c`: the real source is `const [mutate, { loading }] = useMutation(...)`; not a finding.

## Fix wave `bfbe666` verification (R2/R3 findings re-checked at HEAD)

| Prior finding | Fix at HEAD | Verdict |
|---|---|---|
| R3-F1 / R2-03 (MEDIUM silent no-op submit) | `OnboardStudentDialog.tsx`: `catalogEmpty = !plansLoading && planOptions.length === 0`, `submitUnavailable = plansLoading \|\| parentsLoading \|\| catalogEmpty`; `submitDisabled` threaded to the shell, the SAME predicate guards `handleSubmit` (belt for Enter-key implicit submit), and `OnboardStudentPlanSection` renders the new `planSection.emptyCatalog` hint (en+ar+types added; parity suite green) | **FIXED — verified** |
| R2-01 / R3-F2 (LOW dead loading flags) | `AdminStudentsDirectoryContainer` destructures `plansLoading`/`parentsLoading` and passes them into the dialog as required props | **FIXED — verified** |
| R3-F3 (LOW gender select not disabled) | `AdminUserGenderSelect` gains additive optional `disabled` wired to the MUI `Select`; `OnboardStudentProfileSection` passes `disabled={submitting}` | **FIXED — verified** |
| R2-04 (LOW enum-literal in journey test) | `expect(account.role).toBe(UserRole.Student)` + `UserRole` value import added | **FIXED — verified** |
| R2-02 (LOW duplicated lane-narrow type literal) | `OnboardablePlan` exported once from `student-onboarding.helpers.ts`; guard asserts `plan is OnboardablePlan`; service drops its local alias + the unused `PlanSelectType` import | **FIXED — verified** |

## FormDialogShell `submitDisabled` — consumer-impact audit

- Consumers at HEAD: `LessonFormContent.tsx`, `PlanFormContent.tsx` (pre-existing), `OnboardStudentDialog.tsx` (new). Grep-verified: only the onboarding dialog passes `submitDisabled`.
- The prop is additive-optional with default `false` → `disabled={loading || submitDisabled}` ≡ the previous `disabled={loading}` for callers that omit it. **Both pre-existing consumers are behaviorally unchanged.** The prop JSDoc documents the gate semantics without plan-artifact references.
- The Enter-key implicit-submission gap the disabled button cannot cover is closed by the dialog-level belt (same predicate in `handleSubmit`), which is the correct belt-and-suspenders placement.

## Other-consumer audit — `AdminUserGenderSelect`

- Consumers: `CreateUserFormGrid.tsx`, `EditUserFormFields.tsx` (both omit `disabled` → MUI `Select` receives `undefined` → always-enabled behavior preserved exactly, as documented) and the onboarding profile section (passes `disabled={submitting}`). **No behavior change for the pre-existing hosts.**

## Verified clean (rescan axes with zero NEW findings)

- **MUI discipline** — zero hex/rgba literals in the entire scope (grep); all color via `sx={(theme) => …}` palette callbacks or `var(--mui-palette-scrim)` (pre-existing precedent); icons `PersonAddOutlined` / `CheckCircleOutlined`; `Card variant="outlined"`; layout `sx`-only.
- **Apollo patterns** — hooks imported only from `@apollo/client/react` (`useQuery` ×2, `useMutation` ×1); documents use `gql` + `TypedDocumentNode` from `@apollo/client` core per the layer convention; **zero `useLazyQuery`** in the scope; mutation rejections propagate to the single `runWithFeedback` catch; refetch contract uses the caller's live `directory.variables` with `awaitRefetchQueries: true`.
- **Copy/i18n** — namespace-handle imports only (`StudentOnboarding`, `AdminUsers`); zero string-literal namespace lookups; every USED key present in BOTH en and ar (including the new `planSection.emptyCatalog`, idiomatic Arabic, CLDR plural branches intact); the five server-consumed `errors.*` keys remain present in both catalogs — zero dead keys; parity suite re-run: 50/50.
- **Password handling** — `type="password"` + `autoComplete="new-password"`, exact-value (never trimmed in `buildOnboardStudentInput`), structurally absent from the mutation result selection and from the success/error surfaces.
- **Id-first selections** — `student`, `applicant`, `subscription` select `id` FIRST; the contract test (re-run: 10/10) pins the exact shared detail field set, zero fragments, named operation, exact variable surface, barrel identity.
- **Unused props/imports / dead branches** — none: `plansLoading`/`parentsLoading`/`catalogEmpty`/`disabled` are all consumed end-to-end; the `!catalogEmpty && fieldErrors.planId` guard is reachable and correct (server plan error suppressed exactly when the hint replaces the cards); barrels unchanged and consistent.
- **Loading/disabled coherence** — no stuck-disabled path: the flags are container-level query state (error ⇒ `loading=false`, so a failed catalog read degrades to the empty-catalog hint + disabled save, never a permanent dead end); dialog draft, client errors, success payload and server feedback all reset on every close (`handleClose` + container `closeOnboarding`); mutation `loading` self-resets; the toolbar's `onboardDisabled={onboardingOpen || submitting}` stays coherent with the write lifecycle.
- **A11y** — `aria-labelledby` ↔ `DialogTitle id` in both dialog states; `AdminDialogFieldLabel htmlFor` ↔ stable ids on all TextFields; autocomplete `aria-label` merged through `params.slotProps` (merge-not-replace preserved); `aria-pressed` duplication pre-accepted (R3-F6); toolbar label↔id wiring intact.
- **Clean comments** — zero plan-artifact references added anywhere in the frontend/shared diff (grep over `^\+` lines: REQ-x / Task N / Phase N / plan paths / tasks.md / specs.md / D-ONB → no hits); new JSDocs describe domain behavior only.
- **Independent verification** — `tsgo` 0 errors (re-run this round); parity 50/50; documents contract 10/10.

## Findings

| ID | Severity | File:Line | Description | Disposition |
|---|---|---|---|---|
| R6-01 | INFO | `frontend/views/admin/users/ui/AdminUserGenderSelect.tsx:4-5,36-37` | The shared component's docblock still says it is "shared by `EditUserDialog` and the directory's `CreateUserDialog`" — the onboarding `OnboardStudentProfileSection` is now a THIRD consumer and the fix wave added the `disabled` prop without refreshing that consumer list. The text itself is pre-existing (verbatim at baseline `6bf6c71`); the inaccuracy is a consequence of this plan adding the consumer. | Advisory, non-blocking. Follow-up candidate: one-line docblock refresh naming the third consumer. |
| R6-02 | INFO | `frontend/views/admin/students/onboarding/OnboardStudentDialog.tsx:111-118` + `OnboardStudentPlanSection.tsx:122-124` | While `plansLoading`/`parentsLoading` are in flight the save button is disabled but the plan section offers no in-flight affordance — the cards area is blank and the `emptyCatalog` hint only renders AFTER the load resolves empty — and the hint is not programmatically associated with the disabled save (no `aria-describedby`/live-region link). Transient (typically sub-second; longer only on a slow catalog read), and the belt guarantees no phantom submit. | Advisory, non-blocking polish candidate: an optional loading hint (or `aria-describedby` from the save button to the section hint) if the in-flight window is ever noticeable. |
| — | INFO (pre-existing, out of scope) | `backend/graphql/test/schema-surface.test.ts`, `frontend/graphql/test/warnings/warning-surfacing.test.ts` | Plan-artifact-style comments (`REQ-032`, `REQ-060/061`, `D2`) — unchanged, already logged by R2/R4; the diff hunks add none. | Logged only — carried from prior rounds. |

## Findings count

- **New (this round):** 2 — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 2 INFO (R6-01, R6-02).
- **Fixed (prior findings verified resolved at HEAD this round):** 5 — R3-F1/R2-03 (MEDIUM), R2-01/R3-F2 (LOW), R3-F3 (LOW), R2-04 (LOW), R2-02 (LOW) via fix wave `bfbe666`.
- **Remaining (open from prior rounds):** 0 blocking. Prior accepted/no-action INFOs (R2-05…07, R3-F4…F7, R4-01…02) unchanged; 1 pre-existing out-of-scope INFO row carried.

## Stop-condition tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 new |
| INFO | 2 new + 1 pre-existing out-of-scope |

**Blocking total = 0 → stop condition met.** The R6 rescan independently confirms the fix wave: every R2/R3 finding is verifiably resolved at HEAD, the two shared-seam changes (`FormDialogShell.submitDisabled`, `AdminUserGenderSelect.disabled`) are strictly additive with all other consumers unaffected, and no new blocking or advisory-beyond-INFO issues exist on any rescan axis. The review loop remains concluded; the two INFO rows are follow-up candidates only.
