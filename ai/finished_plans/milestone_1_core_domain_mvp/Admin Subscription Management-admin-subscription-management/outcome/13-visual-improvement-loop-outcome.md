# Visual Scoring Outcome — Admin Subscription Management (drawer subscription surface)

- Date: 2026-09-23
- Plan: `ai/finished_plans/milestone_1_core_domain_mvp/Admin Subscription Management-admin-subscription-management/` (run executed on branch `feat/evaluation_rubric_scoring` — the plan files live on `main`; this outcome lands on the run branch and merges back alongside them)
- Capture rig: dev server @ localhost:3000 (`DB_PROVIDER=pglite`, data dir `db/app_db`, seeded admin + demo cast)
- Inspector model: GLM-5V via `z-ai vision` CLI (one image per call; subagent image delivery unavailable in this sandbox — documented harness fallback)
- Locales captured: en, ar
- Dark-mode pass: no (the app's default rendering in this environment is the dark scheme; all captures share one scheme for comparability)

## Surfaces covered

| Surface | Story id / route | Viewports | States |
|---|---|---|---|
| Students directory (host page) | `/students` | 1440×900, 834×1112, 390×844 | table + toolbar, drawer closed |
| Student detail drawer — SUBSCRIPTIONS section | `/students` + drawer | 1440×900, 834×1112, 390×844 | section scrolled into view, 1 active subscription |
| Extend subscription dialog | drawer action | 1440×900, 390×844, 390×844 (ar) | pristine form |
| Change plan dialog | drawer action | 1440×900, 390×844 | plan select + copy |
| Cancel subscription dialog | drawer action | 1440×900, 390×844, recaptured both after fix | optional reason + warning alert |

## Score history

| Pass | Surface | Viewport | Hier | Spacing | Typo | Color | Afford | Resp | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | directory | 1440 | 9.0 | 9.5 | 8.5 | 10 | 9.5 | 9.5 | 9.3 | NEEDS FIXES (finding dismissed — see arbitration) |
| 1 | directory | 834 | 9.0 | 8.0 | 9.0 | 10 | 9.0 | 9.0 | 9.0 | NEEDS FIXES (findings dismissed — shared wrap layout) |
| 1 | directory | 390 | 9.0 | 8.5 | 9.0 | 9.0 | 9.0 | 9.0 | 8.9 | NEEDS FIXES (findings dismissed — uniform `gap: 2` proven) |
| 1 | drawer subs | 1440 | 9.0 | 9.5 | 9.5 | 10 | 9.5 | 9.5 | 9.5 | READY (copy-icon finding disproven — Tooltip exists in code) |
| 1 | drawer subs | 834 | 9.5 | 9.0 | 9.0 | 10 | 8.5 | 9.5 | 9.3 | NEEDS FIXES (destructive-color claim arbitrated as correct-by-design; bottom cut = mid-scroll, `p: 2` exists) |
| 1 | drawer subs | 390 | 9.5 | 9.0 | 9.0 | 9.5 | 8.5 | 10 | 9.3 | NEEDS FIXES (below-fold actions = drawer scroll nature) |
| 1 | extend dialog | 1440 | 9.5 | 9.0 | 10 | 9.5 | 9.5 | 10 | 9.6 | READY |
| 1 | extend dialog | 390 | 9.0 | 8.5 | 9.0 | 9.0 | 9.0 | 9.0 | 8.9 | NEEDS FIXES (focus-ring claim disproven — 2px ring under focus) |
| 1 | change plan | 1440 | 9.5 | 10 | 9.0 | 10 | 9.5 | 10 | 9.7 | READY |
| 1 | change plan | 390 | 9.0 | 9.0 | 9.0 | 9.5 | 9.0 | 9.5 | 9.2 | NEEDS FIXES (line-length LOW — accepted) |
| 1 | cancel dialog | 1440 | 9.5 | 9.0 | 9.0 | 10 | 8.5 | 9.5 | 9.3 | NEEDS FIXES → fixed (double "Cancel") |
| 1 | cancel dialog | 390 | 9.0 | 8.5 | 9.0 | 9.0 | 8.5 | 9.0 | 8.8 | NEEDS FIXES → fixed |
| 2 | cancel dialog | 1440 | 9.5 | 10 | 10 | 10 | 10 | 10 | 9.9 | READY |
| 2 | cancel dialog | 390 | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 | 10 | 9.2 | NEEDS FIXES (destructive-color claim contradicts pass-1 claim — adjudicated as noise; xs width accepted) |
| 2 | drawer subs (ar) | 1440 | 9.0 | 8.5 | 8.0 | 9.0 | 9.0 | 9.0 | 8.7 | NEEDS FIXES (all findings DOM-disproven: digits 35 latin/0 arabic-indic = one consistent decision) |
| 2 | drawer subs (ar) | 390 | 9.0 | 9.5 | 8.5 | 10 | 9.0 | 9.5 | 9.3 | NEEDS FIXES (Active-chip contrast disproven — 12.05:1 measured; bidi claim inherent-to-script) |
| 2 | extend dialog (ar) | 390 | 8.5 | 9.0 | 9.0 | 9.5 | 9.0 | 9.0 | 9.0 | NEEDS FIXES (title alignment disproven — computed `textAlign: start` = right in RTL) |

## Pre-check gate failures found (and fixed)

| Surface | Check | Script output line | Fix |
|---|---|---|---|
| all (first gate runs) | title | `expected substring "Students", got ""` + `{sw:1280...}` | harness error, not the page: `visual-precheck.sh` does not inherit `AGENT_BROWSER_SESSION` — it gated a blank default browser. Fixed procedurally: `export AGENT_BROWSER_SESSION=<session>` before every gate (capture.sh already does this; recorded as an evolution-log candidate) |

No page-level gate failures occurred on any capture that entered scoring (all five checks green per capture).

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|
| 1 | `frontend/views/admin/students/subscriptions/dialogs/{Extend,Renew,Cancel,ChangePlan}SubscriptionDialog.tsx` | double-"Cancel" action pair (dismiss `Common.cancel` → `Common.close`; key already registered in en+ar — zero i18n-registry impact) | ✅ exit 0 ×4 (isolated `PGLITE_DATA_DIR`) | no test asserts the dismiss text (grep-verified); testids unchanged |
| 1 | `frontend/views/admin/shared/dialogFormAtoms.tsx` | destructive/primary submit prominence — `fontWeight: 600` on the single contained submit (generic improvement across admin form dialogs) | ✅ exit 0 (tsgo clean, rule files validated) | same |

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|
| Change-plan dialog body line length at 390px | 9.2 | MUI `maxWidth="xs"` is the app-wide dialog shell; widening breaks cross-dialog consistency | standard MUI pattern, no task impact |
| Drawer subscription actions require scroll at 390px | 9.3 | content taller than a 844px phone viewport by construction (identity + balances + subscriptions sections) | native drawer scroll, `p: 2` bottom padding present |
| Latin-script plan title ("Hifz Jadid (Memorization)") inside RTL card | typography axis | bidi rendering of Latin runs inside RTL paragraphs is script behavior, not a layout defect | seeded data is English; real plans may be Arabic — rendering is bidi-correct |
| Destructive submit reads as strong red CTA (cancel dialog, 390 ar) | 9.2 | inspectors gave contradictory directions across passes (v1: "more weight"; v2: "less weight") — design intent documented in code (`error` contained + disabled error-container identity) | fontWeight bump landed; contradiction adjudicated as inspector noise |

## Prototype comparison

No `prototype/` dir exists in the plan directory — Phase 7 skipped entirely per the skill's skip rule.

## Capture lessons → evolution-log candidates

- `visual-precheck.sh` does not inherit `AGENT_BROWSER_SESSION`: a gate without the export judges a blank default browser (empty title, 1280px) and FAILS spuriously. Proposed target: capture-protocol.md (make the export requirement explicit at the top).
- `z-ai vision` CLI prints a banner before its JSON — parse with a regex JSON extraction, not `json.load(stdin)`. Proposed target: capture-protocol.md VLM-CLI section.
- Inspector contradiction pattern: destructive-action prominence drew opposite findings across passes (more weight vs less weight). Proposed target: rubric.md arbitration note (already covered by the calibration note; add the "opposite-direction findings across passes" telltale).
- The plan files for a finished plan can live off-branch while the visual run happens on a feature branch — the outcome file must travel with the run branch and merge back. Proposed target: outcome-template.md header note.

NOTE: the skill's own `references/evolution-log.md` lives on `main` (not present in this branch's tree), so the lessons are recorded here; transplant them into the log when merging.
