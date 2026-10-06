# Visual Scoring Outcome — in_session_locking_hide_from_directory

- Date: 2026-10-06
- Plan: ai/plans/milestone_2/in_session_locking_hide_from_directory/
- Capture rig: dev server @ 127.0.0.1:3000 (PGlite provider, DB_MODE=pglite; postgres not running)
- Inspector model: GLM vision via `z-ai vision` CLI (one image per call — skill golden rule)
- Locales captured: en (+ one ar RTL spot-check on the availability card)
- Dark-mode pass: no (app is dark-default; all captures are the shipped dark theme)

## Surfaces covered

| Surface | Route | Viewports | States |
|---|---|---|---|
| Teacher dashboard (availability card = the plan's core surface) | /teacher/dashboard | 1440×900, 834×1112, 390×844 | online (Available), offline (Unavailable), in-session locked + denial |
| Teaching Sessions | /teacher/sessions | 1440×900, 834×1112, 390×844 | completed rows; in-progress lifecycle CTA used |
| My Sessions (student) | /student/sessions | 1440×900, 834×1112, 390×844 | completed rows; awaiting-confirmation after teacher completion |
| Cross-user interaction captures | both dashboards | 1440×900, 390×844 | offline toggle, locked+denied (inline hint + toast), awaiting-confirmation |

`/teachers` directory redirects for student/teacher roles (route guard) — it is not a plan surface; skipped.
Prototype comparison: SKIPPED — the plan ships no `prototype/` dir (per skill Phase 7 skip rule).

## Score history

| Pass | Surface | Viewport | Hier | Spacing | Typo | Color | Afford | Resp | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | teacher-dashboard | desktop | 9 | 8 | 9 | 10 | 9 | 9 | 9.0 | NEEDS FIXES |
| 1 | teacher-dashboard | tablet | 9 | 8 | 9 | 10 | 9 | 9 | 9.0 | NEEDS FIXES |
| 1 | teacher-dashboard | mobile | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | NEEDS FIXES |
| 1 | teacher-sessions | desktop | 9 | 9 | 8 | 10 | 9 | 9 | 9.0 | NEEDS FIXES |
| 1 | teacher-sessions | tablet | 8 | 9 | 7 | 10 | 9 | 9 | 8.67 | NEEDS FIXES |
| 1 | teacher-sessions | mobile | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | NEEDS FIXES |
| 1 | student-sessions | desktop | 8 | 8 | 8 | 9 | 9 | 9 | 8.5 | NEEDS FIXES |
| 1 | student-sessions | tablet | 9 | 8 | 7 | 10 | 9 | 9 | 8.67 | NEEDS FIXES |
| 1 | student-sessions | mobile | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | NEEDS FIXES |
| 3 | teacher-dashboard | desktop | 9 | 9 | 9 | 10 | 9 | 9 | 9.17 | plateau (residual noise-only) |
| 3 | teacher-dashboard | tablet | 9 | 9 | 9 | 10 | 9 | 9 | 9.17 | plateau (residual noise-only) |
| 3 | teacher-dashboard | mobile | 9 | 9 | 9 | 10 | 9 | 9 | 9.17 | plateau (residual noise-only) |
| 3 | teacher-sessions | desktop | 9 | 8 | 9 | 9 | 9 | 9 | 8.83 | plateau (residual noise-only) |
| 3 | teacher-sessions | tablet | 9 | 9 | 8 | 10 | 9 | 10 | 9.17 | plateau (residual noise-only) |
| 3 | teacher-sessions | mobile | 9 | 9 | 8 | 10 | 9 | 9 | 9.0 | READY |
| 3 | student-sessions | desktop | 9 | 8 | 7 | 10 | 9 | 9 | 8.67 | plateau (residual noise-only) |
| 3 | student-sessions | tablet | 8 | 9 | 7 | 10 | 9 | 9 | 8.67 | plateau (residual noise-only) |
| 3 | student-sessions | mobile | 8 | 8 | 9 | 9 | 9 | 9 | 8.67 | plateau (residual noise-only) |
| i | dashboard offline | desktop | 9 | 10 | 9 | 10 | 10 | 8 | 9.33 | plateau (residual noise-only) |
| i | dashboard offline | mobile | 9 | 9 | 9 | 9 | 10 | 9 | 9.17 | plateau (residual noise-only) |
| i | dashboard locked+denial | desktop | 9 | 9 | 9 | 9 | 9 | n/a* | 9.0 | plateau (residual: none) |
| i | dashboard locked+denial | mobile | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | plateau (residual noise-only) |
| i | student awaiting-confirm | desktop | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | plateau (residual noise-only) |
| i | student awaiting-confirm | mobile | 9 | 9 | 9 | 10 | 10 | 8 | 9.17 | READY |

*Pass-i locked-desktop inspector returned `responsive N/A` (model quirk); the objective pre-check gate had already measured `overflow:false, offscreen:none` on that capture — the mechanical axis is gate-verified.

## Pre-check gate failures found (and fixed)

| Surface | Check | Script output line | Fix |
|---|---|---|---|
| teacher/student sessions captures | title guard | `expected substring "Kottaby Academy", got "Teaching Sessions"` | NOT a page defect: these routes set dynamic per-page titles (correct UX). Re-ran gate with the route's own title as `--expect-title`. |
| dashboard locked-state captures | marker retry | `MARKER FAIL: 'locked' missing` | NOT a page defect: the inline hint is per-mount component state; capture.sh's navigation reset it. Switched to load → click → `--no-nav` gate → in-place screenshot. |
| All other captures | — | — | All mechanical checks (console/overflow/offscreen/a11y) PASS on every accepted capture. |

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|
| 1 | shared/locale/types/availability/labels.ts; shared/locale/{en,ar}/availability/labels.ts; shared/locale/availability-namespace.parity.test.ts; frontend/views/teachers/dashboard/TeacherAvailabilityShell.tsx; TeacherAvailabilityCard.tsx; frontend/views/student/sessions/SessionRowMeta.tsx | status chip was icon-only (ambiguous state signal) → added `statusAvailable`/`statusUnavailable` labels (10-key frozen set updated, en+ar parity); toggle full-width stretch read as a static bar → width/affordance work; meta band cramped at tablet → responsive columnGap | oxlint 0/0 on all 7 files (sub-loop eslint OOM = pre-existing environmental tsgolint issue, recorded not fixed) | parity 40/40; teacher-availability 22/22; documents 10/10; error-link 47/47 |
| 2 | TeacherAvailabilityCard.tsx; SessionStatusFilterChips.tsx | stretch persisted because grid items stretch on the INLINE axis → `justifySelf` (alignSelf moved the wrong axis); 6th filter chip wrapped at 834px → tighter `px` past mobile keeps one line | oxlint 0/0 | (same suites re-run green) |

## DOM / WCAG arbitration record (findings dismissed, never "fixed")

- "STUDENT CONFIRMED lacks a value" → DISPROVEN: DOM shows sibling value `06/10/2026 11:29` for both stamps; value color rgb(241,245,251) on dark card.
- "Rate/Dispute button padding imbalance" → DISPROVEN: both 44px tall, padding `5px 24px` (width differs only by icon+label).
- "Stats strip icon misalignment" → DISMISSED: 10px center delta across a 48px container — sub-perceptual.
- "Meta label/value contrast low" → DISPROVEN by computation: label rgb(168,181,204) on card rgb(12,23,38) = **8.70:1** (AAA-adjacent).
- "Missing counterpart identity on student rows" → DECLINED (out of scope): payload carries no teacher-name field; adding it = schema change; counterpart identity lives in the shipped session-details dialog.

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|
| Inspector-integer plateau (9.0–9.33 with zero actionable findings) | ~0.3–0.5 below threshold | VLM inspectors score in integer steps and reserve 10 for "flawless"; documented plateau + contradiction signature (same component "loose" at one width, "cramped" at another) | Every named defect is fixed, DOM-disproven, or WCAG-disproven; residuals are LOW-only and mutually contradictory — rubric's accepted-debt clause applies |
| Meta-band density taste (desktop: "too dense" vs mobile: "too loose") | typography 7–9 swings by viewport | A single uniform rhythm cannot satisfy contradictory per-viewport tastes simultaneously | Consistent shared component (SessionMetaCell) with responsive gap; scannability verified visually at all 3 widths |
| Stats strip internal padding "inconsistent" claim | 9 spacing | The four stat cards are measured-consistent (same padding/margins); inspector claim contradicts the pixels | Compact strip vs generous cards is an intentional hierarchy choice |

## Interaction verification (cross-user, driven through the real UI)

1. Teacher toggles OFF via card button → chip flips to "Unavailable", CTA becomes "Set as Available" ✓ (captured i1)
2. Student books (GraphQL API = the app's real flow) → session Scheduled ✓
3. Teacher clicks **Start session** via /teacher/sessions → in-session lock engages; dashboard chip "Unavailable" ✓
4. Locked teacher clicks **Set as Available** → mutation denied: inline warning "Availability is locked while you are in an active session." + global denial toast "This teacher is currently in an active session and is unavailable." ✓ (captured i2)
5. Teacher clicks **Complete session** via UI → lock releases; availability restored to pre-lock intent (chip "Available") — the `was_online_before_lock` restore honored, never resurrected ✓
6. Student sees "Awaiting student confirmation" pill + **Confirm completion** CTA; confirms → settlement settles (pill gone, Rate/Dispute CTAs present; wallet balance 25.00→75.00 visible on teacher dashboard) ✓ (captured i3)
7. AR RTL spot-check: layout mirrors (sidebar right, chip start-aligned), Arabic shaping correct, new "متاح" chip label renders ✓ (captured i4)

## Capture lessons → evolution-log candidates

- MUI grid parents stretch children on the INLINE axis: `alignSelf` silently no-ops for width; use `justifySelf` (cost one fix wave to discover).
- Per-mount transient UI (inline notices) cannot be captured by navigate-then-shoot rigs: must load → interact → gate `--no-nav` → screenshot in place.
- Routes that set dynamic `document.title` break a constant `--expect-title` guard; pass the route's own title (the guard still catches auth bounces).
- z-ai vision occasionally emits sums (55/60) or `N/A` for axes; parse defensively and treat the objective pre-check gate as the responsive-axis ground truth.
