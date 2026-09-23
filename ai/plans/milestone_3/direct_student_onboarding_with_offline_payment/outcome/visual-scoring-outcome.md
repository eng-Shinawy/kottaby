# Visual Scoring Outcome — direct_student_onboarding_with_offline_payment

- Date: 2026-09-23
- Plan: ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/
- Capture rig: dev server @ 127.0.0.1:3000 (PGlite, DB_PROVIDER=pglite, dataDir db/pglite)
- Inspector model: glm-5v-turbo (one image per `z-ai vision` call) + orchestrator DOM arbitration
- Locales captured: en, ar
- Dark-mode pass: no (run-scoped decision: the plan's surfaces were light-mode-reviewed; the app's dark toggle exists but the review bar this round was the light-theme default)
- Prototype comparison: SKIPPED — no `prototype/` directory exists in the plan (recorded per skill §Phase 7 skip rule).

## Surfaces covered

| Surface | Route / state | Viewports | States |
|---|---|---|---|
| Admin students directory | `/students` (read view) | 1440×900, 834×1112, 390×844 | en, ar |
| Onboarding dialog | `/students` → toolbar CTA → 4-section form | 1440×900, 834×1112, 390×844 | en, ar (form filled via native-setter + MUI selects) |
| Success handoff | dialog post-submit state | 1440×900, 834×1112, 390×844 | en, ar (real submissions: KSB-CB98114C / KSB-1EE57B68) |
| Onboarding history dialog | `/students` → toolbar history icon | 1440×900, 834×1112, 390×844 | en, ar |

24 captures total; every capture passed the objective pre-check gate (title guard, console sweep, horizontal overflow, off-viewport bleed, a11y smoke) — zero gate failures across both passes.

## Score history

Pass 1 (v1) and pass 2 (v2, recaptured history-dialog only):

| Pass | Surface | Viewport | Loc | Hier | Spacing | Typo | Color | Afford | Resp | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | dir | 1440 | ar | 9 | 9 | 9 | 9 | 10 | 10 | 9.3 | NF* |
| 1 | dir | 834 | ar | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | NF* |
| 1 | dir | 390 | ar | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NF* |
| 1 | dir | 1440 | en | 9 | 9 | 8.5 | 9 | 9 | 9 | 8.9 | NF* |
| 1 | dir | 834 | en | 9 | 9 | 10 | 10 | 10 | 10 | 9.7 | READY |
| 1 | dir | 390 | en | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NF* |
| 1 | onb | 1440 | ar | 9 | 9 | 10 | 10 | 10 | 10 | 9.7 | READY |
| 1 | onb | 834 | ar | 9 | 9 | 10 | 9 | 9 | 10 | 9.3 | NF* |
| 1 | onb | 390 | ar | 9 | 9 | 10 | 10 | 9 | 9 | 9.3 | NF* |
| 1 | onb | 1440 | en | 9 | 9 | 8.5 | 10 | 9 | 9 | 9.1 | NF* |
| 1 | onb | 834 | en | 9 | 8 | 9 | 10 | 9 | 9 | 9.0 | NF* |
| 1 | onb | 390 | en | 9 | 9 | 10 | 10 | 9 | 10 | 9.5 | READY |
| 1 | succ | 1440 | ar | 9 | 9 | 10 | 10 | 9 | 10 | 9.5 | READY |
| 1 | succ | 834 | ar | 9 | 9 | 10 | 10 | 9 | 9 | 9.3 | NF* |
| 1 | succ | 390 | ar | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NF* |
| 1 | succ | 1440 | en | 9 | 9 | 10 | 10 | 10 | 10 | 9.7 | READY |
| 1 | succ | 834 | en | 9 | 9.5 | 10 | 10 | 9.5 | 10 | 9.7 | READY |
| 1 | succ | 390 | en | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | NF* |
| 1 | hist | 1440 | ar | 9 | 9 | 9 | 10 | 9 | 10 | 9.3 | NF (real) |
| 1 | hist | 834 | ar | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NF (real) |
| 1 | hist | 390 | ar | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NF (real) |
| 1 | hist | 1440 | en | 9 | 9 | 9 | 10 | 9 | 10 | 9.3 | NF (noise) |
| 1 | hist | 834 | en | 9 | 10 | 9 | 10 | 9 | 10 | 9.5 | NF (noise) |
| 1 | hist | 390 | en | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NF (real) |
| 2 | hist | 1440 | ar | 9 | 8 | 10 | 9 | 9 | 9 | 9.0 | NF (noise) |
| 2 | hist | 834 | ar | 9 | 9 | 9 | 10 | 9 | 10 | 9.3 | NF (noise) |
| 2 | hist | 390 | ar | 8 | 9 | 10 | 10 | 7 | 9 | 8.8 | NF (noise) |
| 2 | hist | 1440 | en | 8 | 8 | 9 | 10 | 9 | 9 | 8.8 | NF (noise) |
| 2 | hist | 834 | en | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NF (noise) |
| 2 | hist | 390 | en | 9 | 8 | 7 | 10 | 9 | 9 | 8.7 | NF (noise) |

\* NF = NEEDS FIXES whose findings were then individually adjudicated (see below).

## Pre-check gate failures found (and fixed)

None — all 24 v1 captures and all 6 v2 recaptures passed every check on the first attempt.

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|
| R1 | `frontend/views/admin/students/OnboardingHistoryDialog.tsx` | (a) row-name ellipsis was dead without `whiteSpace: "nowrap"`; (b) long emails wrapped unevenly — the row email now carries the directory identity-cell's truncation recipe (`overflow: hidden` + `textOverflow: ellipsis` + `nowrap`); (c) device-note caption measured 15.96px line-height (~1.33) — lifted to 1.6 | `sub-loop.ts --lifecycle duplicates` exit 0 (after compacting the patch to stay under the 150-line function cap — first attempt tripped it at 160 lines) | tsgo 0 · eslint 0 · parity 52/52 |

## DOM arbitration record (disputed findings)

Per the rubric's arbitration rule, every mechanical claim was checked against the live DOM before acting:

| Finding (pass) | Claim | DOM evidence | Disposition |
|---|---|---|---|
| dir-ar-1440 / dir-en-1440 MEDIUM-LOW | "email cells lack ellipsis" | The email `Typography` computes `overflow: hidden · text-overflow: ellipsis · white-space: nowrap · flex: 1 1 0%` — the wide-viewport captures simply show full addresses (no truncation needed). First probe hit the cell wrapper, not the leaf; re-arbitrated on the exact leaf element. | DISPROVEN — dismissed |
| dir-ar-834 / onb-ar-* / dir-ar-390 (MEDIUM/LOW) | "search placeholder misaligned in RTL / icon at wrong edge" | Input computes `direction: inherit; text-align: start`; the magnifier is a `startAdornment` with logical `marginInlineEnd` — the MUI-correct RTL pattern (icon leads at inline-start, i.e. right in RTL). | DISPROVEN — dismissed |
| hist-en-1440 / 834 / 390 MEDIUM | "modal lacks a backdrop / obscuring content without dimming" | `.MuiBackdrop-root` present with `background-color: rgba(0, 0, 0, 0.5)`, `opacity: 1`; the dialog container computes `flex · center · center`. | DISPROVEN — dismissed (modal semantics: a modal covering the page is its purpose) |
| hist-ar-834 MEDIUM | "dialog body text center-aligned" | The device note computes `text-align: start` (the only `textAlign: center` in the file is the EMPTY state, deliberately composed, not visible with entries present). | DISPROVEN — dismissed |
| dir-en-390 LOW | "mobile card cramped bottom padding" | Shared `DirectoryMobileCard` computes `padding: 24px` (symmetric), `radius: 12px` — QA-verified shared primitive. | DISPROVEN — dismissed |
| onb-en-1440 MEDIUM | "meter caption and step labels same size/weight" | Meter caption = `caption` (12px, 600, `text.secondary`); section headings = `subtitle2` (14px, 600, default) — distinct tokens by design. | DISPROVEN — dismissed |
| onb-en-1440 LOW | "'No parent — link later' lacks clickability" | It is `helperText` — informational by design, not a control; adding a pointer affordance would misrepresent interactivity. | DISPROVEN — dismissed |
| onb-en-834 LOW ×2 | "plan-card spacing/tag imbalance" | Plan list = uniform `Stack gap: 1`; chips = `flexWrap: wrap` row with uniform `gap: 0.5`. | DISPROVEN — dismissed |
| succ-en-390 LOW | "copy button icon/text misaligned" | MUI `Button` with native `startIcon` composition — platform handles vertical centering. | DISPROVEN — dismissed |
| hist-ar-1440 LOW | "history icon not mirrored" | History/counter-clockwise icon is direction-NEUTRAL per the rubric's own RTL checklist (neutral icons don't mirror). | DISPROVEN — dismissed |
| hist-ar-834 LOW | "mixed numeral systems (Arabic-Indic vs Western)" | Cross-surface Intl formatting convention (platform i18n decision), not this dialog's defect. | ACCEPTED DEBT (below) |
| hist v2 MEDIUMs | "Duplicate Students dialog / 'Try!' button / hallucinated title strings" | No such elements exist in the DOM or the component tree; the v2 pass invented them (and quoted dialog copy that is not in any locale file). | Inspector hallucination — dismissed |

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|
| Cross-surface numeral style (AR locale renders Intl-formatted values locale-correct; digits vary between surfaces) | None measurable on any single axis | Platform-wide i18n/Intl convention — changing it belongs to a repo-level locale decision, not a per-surface polish wave | Consistent within every surface; no task-comprehension impact |
| VLM integer-step plateau (totals ≈8.7–9.7 even where every reported finding was DOM-disproven) | Totals rest at the calibration plateau | Inspectors reserve 10 for "flawless" and cannot verify their own disputed claims | Per the rubric's calibration note: residuals that are LOW-only, mutually contradictory across passes, or pixel-disproven adjudicate to READY instead of looping on noise |

Final disposition: **all 24 surface × viewport × locale cells adjudicated READY** — three real code defects existed (all in the history dialog), all fixed and DOM-verified; every other NEEDS-FIXES verdict rested on findings disproven by DOM evidence.

## Prototype comparison

Skipped — the plan directory contains no `prototype/` subdirectory (skill §Phase 7 skip rule; recorded, not invented).

## Capture lessons → evolution-log candidates

1. Subagent image inspection is unavailable in this sandbox (`Read` renders images in the orchestrator context only; task-subagents receive "[1 image(s) omitted]") — the established fallback is the `z-ai vision` CLI (one image per call, preserving the golden rule) with absolute output paths (`-o /abs/path.json`; relative `-o` paths silently fail).
2. `scripts/visual-loop/vlm-score-pass.sh`'s relative `vi-out/` output path breaks under this harness — replaced by `/tmp/vlm-score.sh` with absolute paths (idempotent skip-on-verdict preserved).
3. Locale drift between capture batches: the sandbox flips HEAD and re-logs are needed; the per-user locale can silently re-assert between batches — always re-set the locale cookie AND re-verify the toolbar button's aria-label before each batch (EN `Onboarding history` / AR `سجل التجهيز`).
4. Real form submissions double as denial-path evidence: the duplicate-email and duplicate-payment-reference guards rendered their localized inline errors during the capture drive — a free E2E confirmation of the plan's idempotency UX.
5. Draft persistence excludes the initial credential by design — re-opened dialogs need the password re-entered before resubmitting.
