# Review Iteration R9 — Independent Review (i18n + repo-conventions lens)

**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Task:** 6.1 (post-implementation review iteration R9 — independent reviewer, no prior-round context)
**Branch:** `feat/direct_student_onboarding_with_offline_payment` · **Tip at review:** `4d19242` (code byte-identical to the fix wave `bfbe666` — R5–R7 added plan docs only)
**Method:** read-only rescan over the full diff (`git diff 6bf6c71..4d19242` — 85 files, of which 53 are source/test files under `backend|frontend|shared|test`, 2 generated wire artifacts, 1 canonical doc, 29 plan artifacts). Every locale delta was read byte-level, every locale USAGE in the new frontend tree traced key-by-key against BOTH catalogs, service translation consumption verified, and the repo-convention axes (aliases, barrels, naming, cross-layer, docblocks, plan-artifact hygiene) swept. Branch-flap hazard handled per the R7 method note: all reads pinned to ref `4d19242` / run as atomic `git checkout … && …` chains.

## Scope (lens focus)

- **Locale deltas:** `shared/locale/types/message.ts`, `shared/locale/types/studentOnboarding/`, `shared/locale/{en,ar}/studentOnboarding/index.ts`, `shared/locale/{en,ar}/messages.ts`, `shared/locale/namespaces/{index,registry}.ts`, `shared/locale/namespaces/studentOnboarding/`, `shared/locale/studentOnboarding-namespace.parity.test.ts` (487 lines).
- **Locale USAGE:** the full `frontend/views/admin/students/onboarding/` tree (dialog, 4 sections, success content, 3 hooks, 2 barrels, view-model), the `FormDialogShell` / `AdminUserGenderSelect` shared-component deltas, the toolbar/container/directory-hook deltas, and the backend service/helpers translation consumption + journey-test locale assertions.
- **Conventions:** `@/` aliases, barrel mechanics/sort, file naming vs siblings, cross-layer import ban, docblock accuracy of the recently-changed shared components, plan-artifact reference sweep over ALL new/modified source files.

## i18n verification (all axes walked)

| Axis | Evidence | Verdict |
|---|---|---|
| en↔ar key parity (incl. `planSection.emptyCatalog`) | Compile-typed on both leaves (`StudentOnboardingLabels`); 487-line parity test enforces identical depth-first leaf-path sets, per-path leaf-TYPE agreement, block pins (sections ×4, methods ×3, lane ×3, errors ×7), non-emptiness both locales; `emptyCatalog` present both sides with equivalent meaning (en "No active plans are available yet. A plan must be active before a student can be onboarded." / ar "لا توجد خطط نشطة متاحة بعد. يجب أن تكون هناك خطة نشطة قبل تجهيز الطالب.") | **PASS** |
| Typed function leaves | Exactly 4 slots typed as functions in the labels interface (`planSection.sessions`/`intervalDays`, `success.handshakeCode`/`balanceCredited`), implemented as arrows on BOTH leaves; the parity test locks the function inventory ("no minting, no downgrade") and probes CLDR Arabic plural boundaries (1/2/3–10/11–99/100–102 branch-word tables, dual-form in-sentence vs nominative caption distinction) | **PASS** |
| Arabic copy RTL-safety | No physical LTR/RTL properties anywhere in the new tree (grep `marginLeft/Right`, `paddingLeft/Right`, `textAlign: left/right`, `left:/right:` → zero); em-dash joins sit between same-direction runs; `dir="ltr"` pinned on phone + reference inputs (matching the `AdminStudentIdentityCell` sibling pattern); Latin handshake code rides a trailing LTR island inside the RTL sentence (`userSelect: "all"` handoff box); Arabic-script sweep in the parity test kills English fallthrough | **PASS** |
| Namespace handle registration | `studentOnboarding.namespace.ts` declares `defineNamespace<StudentOnboardingLabels>("studentOnboarding.studentOnboarding", …)` — the conventional `<ns>.<ns>` id; registered in `registry.ts` + re-exported by `namespaces/index.ts` + wired into BOTH `messages.ts` bundles (`studentOnboardingTranslations`); the parity test pins all three wiring seams + the bundle-slice getter | **PASS** |
| No string-literal namespaces / no next-intl | Grep over the entire new frontend+shared tree: zero `useTranslations(`, `next-intl`, `useAppTranslation("…")`, `Translation.` enum; every consumer resolves through the imported handles (`useAppTranslation(StudentOnboarding)`, `(AdminUsers)`) | **PASS** |
| One-arg `getServerTranslations` (backend) | `student-onboarding.service.ts:301` `getServerTranslations(locale)` — single locale arg; journey test `:94-95` same; signature `shared/locale/server-graphql.ts` takes exactly `(locale: string)` | **PASS** |
| Reuse-not-remint | Gender option labels stay single-sourced in `AdminUsers` (`adminUsersLabels.genderOptions.*` via the shared `AdminUserGenderSelect`); toolbar affordance reuses `StudentOnboarding.title` instead of minting an `AdminStudents` key; ar method copy `offlineCash: "نقداً عند الاستلام"` matches the pre-existing `ar/adminFinance gatewayOfflineCash` verbatim; deliberate non-duplications documented in the labels docblock (email conflict → `authTranslations.emailAlreadyExists`, lookup misses → `errorsTranslations`) | **PASS** |
| No PII in copy | Copy interpolates only counts, the plan's counted fragments, and the sanctioned handshake code; parent name/email render as entity data in the admin-only picker (documented scope note in the labels docblock); no credential copy anywhere (input label only) | **PASS** |
| Zero dead keys | All 7 `errors.*` leaves consumed server-side (helpers `:51,:66,:91,:94,:111,:114` + service `:378`), client-side leaves consumed in the dialog tree; `planSection.emptyCatalog` consumed at `OnboardStudentPlanSection.tsx:123` behind the `!catalogEmpty &&` guard | **PASS** |

## Convention verification

| Axis | Evidence | Verdict |
|---|---|---|
| `@/` aliases only | Zero deep relative imports (`../`) across all 53 scope source files | **PASS** |
| Barrel mechanics | Both new barrels (`onboarding/index.ts`, `onboarding/hooks/index.ts`) are pure relative `export *` re-exports (root AGENTS §Import & Barrel Conventions); both genuinely consumed (container/toolbar imports); sort order is byte-sort in `onboarding/index.ts` (lowercase `onboardingDialog.types` last — same pattern as the sibling `students/index.ts` with `students-directory-csv`) and case-insensitive in `hooks/index.ts` — the repo has BOTH precedents (`users/detail/index.ts` itself mixes the two), so neither ordering is flaggable | **PASS** (noted, not flagged) |
| Registry/messages/types ordering | `namespaces/index.ts` + `registry.ts` imports + `en/ar/messages.ts` + `types/message.ts` all insert `studentOnboarding` in strict alphabetical position; the `namespaces` OBJECT literal was already non-alphabetical at baseline (`UpNext` before `SubscriptionAdmin`), so the new key's placement mirrors the existing list — not flaggable | **PASS** |
| File naming vs siblings | Sections/dialog/hooks follow the sibling view conventions; one deviation recorded as R9-04 below | **INFO** |
| No cross-layer imports | `shared/` imports neither `@/frontend` nor `@/backend` (grep clean; AGENTS examples only); frontend production files import no `@/backend` (the pre-existing test-tier gateway/integration exception is untouched by this diff); the `backend/services/...helpers.ts` reference in `onboardingDialog.types.ts` is a JSDoc duplication rationale (accepted R2-07), not an import | **PASS** |
| Docblocks of recently-changed shared components | `FormDialogShell.submitDisabled` + `AdminUserGenderSelect.disabled` prop docs are accurate (additive-optional semantics match the diff); one stale consumer enumeration found — R9-02 below; the `AdminUserGenderSelect` header staleness is the already-logged R6-01 (not re-reported) | **INFO** |
| Plan-artifact hygiene | `git grep -E "REQ-[0-9]+\|D-ONB\|Phase [0-9]\|Task [0-9.]+\|tasks\.md\|specs\.md\|ai/plans"` over ALL new/modified source files → **zero hits**; the only REQ-style comments live in the two test-anchor files (`schema-surface.test.ts`, `warning-surfacing.test.ts`) and are pre-existing at baseline `6bf6c71` (excluded per protocol, carried since R2) | **PASS** |
| Harcoded-boundary copy check | `UnauthorizedError("Authentication required.")` in the new resolver guard follows the repo's DOMINANT precedent (~20 existing resolver guards use the same literal; `admin-governance`/`admin-teachers` are the localized minority) — matches convention, not flagged | **PASS** |

## Findings (NEW this round)

| ID | Severity | File:line | Description | Disposition |
|---|---|---|---|---|
| R9-01 | LOW | `shared/locale/ar/studentOnboarding/index.ts:81` (`errors.planLaneUnconfigured`) | Arabic gender-agreement defect in shipped rejection copy: the equational predicate **«غير مهيأة»** (feminine) disagrees with its masculine subject **«مسار الرصيد»** — correct MSA is **«غير مهيأ»** (the em-dash-side en copy "its balance lane is not configured" is unaffected). One-word fix; meaning stays recoverable, so copy-only severity. | Advisory, non-blocking. Follow-up candidate: one-word ar copy correction (or a deferred-items row). |
| R9-02 | INFO | `frontend/views/admin/forms/FormDialogShell.tsx:2-5` | File docblock still enumerates the shell's consumers as "every admin entity form content **(plans, lessons)**" — this plan added the onboarding dialog (`OnboardStudentDialog`) as a third consumer family without refreshing the enumeration. Identical class to R6-01 (which covered `AdminUserGenderSelect`); the enumeration text is pre-existing at baseline, the inaccuracy is a consequence of this plan's consumer addition. The newly-added `submitDisabled` prop docblock itself is accurate. | Advisory, non-blocking. Follow-up candidate: one-line docblock refresh naming the onboarding consumer (could ride the same touch as R6-01). |
| R9-03 | INFO | `shared/locale/en/studentOnboarding/index.ts:46` vs `shared/locale/ar/studentOnboarding/index.ts:49` | In-namespace ellipsis style divergence for the SAME affordance: en `actions.saving` = `"Saving…"` (U+2026) while ar = `"جارٍ الحفظ..."` (three ASCII dots). Repo precedent is genuinely MIXED (auth/checkout/common/landing use ASCII dots in BOTH locales; adminBroadcasts/adminFinance/analytics/dashboard/notifications/parentLink/parentMonitoring use U+2026 in both), so no repo rule is broken — but within one namespace pair the in-progress glyph now differs per locale. | Advisory, non-blocking. Follow-up candidate: align the pair (either style has precedent; U+2026 dominates the newer files). |
| R9-04 | INFO | `frontend/views/admin/students/onboarding/onboardingDialog.types.ts` | Naming-vs-content mismatch: the file is the ONLY `*.types.ts` under `frontend/views/**`, yet it carries RUNTIME surface (the two submit-time mapping/validation functions, `EMPTY_ONBOARD_STUDENT_FORM`, the two token maps) alongside the form-state types. Sibling frontend convention for such logic modules is `*.helpers.ts` (`broadcast-compose.helpers.ts`, `adminStudentsDirectory.helpers.ts`, `subscriptionAdmin.helpers.ts`, `subscriptionView.helpers.ts`), and repo-wide `.types.ts` is type-only (the backend helpers file even states "no `.types.ts` beside this file" for runtime code). No codified frontend rule is violated — hence INFO. | Advisory, non-blocking. Follow-up candidate: rename to `onboardingDialog.helpers.ts` (or split types/helpers) in a later conventions sweep; pure rename + import updates. |

## Examined and dismissed (for future reviewers — do not re-raise)

- **ar `searchPlaceholder`** omits the "parents" object the en copy carries ("ابحث بالاسم أو البريد الإلكتروني") — accurate-in-context placeholder inside the parent picker; not a parity defect.
- **`registry.ts` object-literal placement** of `StudentOnboarding` after `SubscriptionAdmin` — the object was already non-alphabetical at baseline; every OTHER locale wiring list (imports, barrels, `messages.ts`, `types/message.ts`) is strictly alphabetical.
- **`adminStudents`/`StudentOnboarding` toolbar label mount** — the toolbar instantiates a second `useAppTranslation(StudentOnboarding)` for one string; handle-based, single-sourced, consistent with the reuse-first rule.
- **`getServerTranslations`-free helpers** — `student-onboarding.helpers.ts` takes pre-resolved `StudentOnboardingLabels["errors"]` params (copy threaded once from the service); matches the pure-function design and avoids a second server lookup.

## Findings count

- **New (this round):** 4 — 0 CRITICAL / 0 HIGH / 0 MEDIUM / 1 LOW (R9-01) / 3 INFO (R9-02, R9-03, R9-04).
- **Fixed this round:** 0 (read-only review).
- **Prior fixes verified intact at tip:** not re-audited (security/functional lenses own those; R7's 18-probe PASS at byte-identical code stands).
- **Remaining open from prior rounds:** 0 blocking; accepted/advisory INFOs stand (R2-05…07, R3-F4…F7, R4-01…02, R5-01, R6-01…02 + the pre-existing out-of-scope comment row).

## Stop-condition tally

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 1 new (copy-only) |
| INFO | 3 new |

**Blocking total = 0 → stop condition MET.** The i18n layer is structurally and semantically sound: en↔ar parity is compile-typed AND runtime-pinned (including the recent `planSection.emptyCatalog` addition and the four typed function leaves with CLDR-correct Arabic plurals), the namespace handle is registered through all four seams with the `<ns>.<ns>` id, zero string-literal namespaces and zero next-intl exist in the new tree, the backend resolves all rejection copy through one-arg `getServerTranslations`, the copy is PII-free and RTL-safe, and no plan-artifact references leak into any new/modified source file. The four new findings are polish-tier (one ar word, two docblock/naming-consistency notes, one glyph-style divergence) and require no fix wave.

## Method note (for future reviewers of this workspace)

1. **Concurrent branch flipping (re-hit this round):** the shared working tree bounced between `main` and the feature branch between commands (reflog shows repeated checkouts from other sessions). All reads were pinned to the tip REF (`git show 4d19242:<path>`, `git grep <ref>`, `git diff 6bf6c71..4d19242`) or run as atomic `git checkout <branch> -q && …` chains; never trust bare working-tree state here.
2. **Terminal backtick-swallow artifact (re-confirmed):** `useOnboardStudentMutation.ts:47` renders as `const utate, { loading }] = …` — the real source is `const [mutate, { loading }] = useMutation(…)`; false alarm carried since R3/R4.
3. **Verification basis:** read-only rescan; no suites re-run. The locale gates' green state (parity 50/50, tsgo 0) is recorded by R5–R7 against byte-identical code; the new findings above are copy/doc/naming-level and do not depend on re-running them.
