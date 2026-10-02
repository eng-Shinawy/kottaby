# Visual Scoring Outcome — #229 No Phone Input Component

- Date: 2026-10-02
- Plan: ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/
- Capture rig: dev server @ 127.0.0.1:3100 (PGlite, DB_PROVIDER=pglite, seeded via scripts/visual-loop/pglite-bootstrap.ts; Storybook not booted — pages are auth-gated surfaces, session rig per capture-protocol)
- Inspector model: z-ai vision CLI (one image per call, rubric inlined; subagent image channel unavailable in this sandbox)
- Locales captured: ar (default, RTL) + en
- Dark-mode pass: yes (the app's default color scheme is dark — html[data-mui-color-scheme="dark"]; all captures are the shipped default)
- Viewports: 1440×900 desktop, 834×1112 tablet, 390×844 mobile
- Objective pre-check gate: title guard + console sweep + horizontal overflow + off-viewport bleed + a11y smoke (manual eval fallback — no bundled visual-precheck.sh in this repo) on EVERY capture; only gate-green captures entered scoring.

## Surfaces covered

| Surface | Story id / route | Viewports | States |
|---|---|---|---|
| S1 Register (RegisterIdentityFields + RegisterAccountSection grid) | /register | 1440, 834, 390 (ar); 1440, 390 (en) | page, phone field visible |
| S2 Users directory | /admin/users | 1440, 834, 390 (ar); 1440, 390 (en) | table + mobile cards + toolbar |
| S2b Create-user dialog (CreateUserFormGrid + CreateUserRoleSegments) | /admin/users (dialog) | 1440, 390 (ar); 390 (en) | dialog open |
| S3 User detail (TeacherApplicationPanels stats) | /admin/users/2 | 1440, 390 (ar); 1440 (en) | page |
| S3b Edit-user dialog (EditUserFormFields + AdminDialogFooterBand) | /admin/users/2 (dialog) | 1440, 390 (ar); 390 (en) | dialog open |
| S4 Students directory | /students | 1440, 390 (ar); 1440 (en) | table + toolbar |
| S4b Onboard-student dialog (OnboardStudentProfileSection + FormDialogShell) | /students (dialog) | 1440, 390 (ar); 390 (en) | dialog open |

25 captures pass 1 + 15 recaptures pass 2 (14 fix-affected + tablet re-verified). Every capture includes the PhoneInput surface or its host dialog; `input[autocomplete="tel"]` presence asserted per shot.

## Score history

Pass 1 (baseline; findings triaged → DOM arbitration → fix waves):

| Pass | Surface | Viewport | Hier | Spacing | Typo | Color | Afford | Resp | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | S1 register ar | 1440 | 9 | 9 | 10 | 9 | 9 | 10 | 9.3 | NEEDS FIXES |
| 1 | S1 register ar | 834 | 9 | 9 | 10 | 9 | 8.5 | 9 | 9.08 | NEEDS FIXES |
| 1 | S1 register ar | 390 | 9 | 9 | 10 | 9 | 8.5 | 9 | 9.08 | NEEDS FIXES |
| 1 | S1 register en | 1440 | 9 | 9 | 10 | 9 | 8.5 | 9 | 9.08 | NEEDS FIXES |
| 1 | S1 register en | 390 | 9 | 9 | 10 | 9 | 8.5 | 9 | 9.08 | NEEDS FIXES |
| 1 | S2 users ar | 1440 | 9 | 9 | 10 | 9 | 10 | 10 | 9.5 | READY |
| 1 | S2 users ar | 834 | 9 | 9 | 10 | 9 | 8 | 9 | 9.0 | NEEDS FIXES |
| 1 | S2 users ar | 390 | 9 | 9 | 10 | 9 | 8.5 | 9 | 9.08 | NEEDS FIXES |
| 1 | S2 users en | 1440 | 9 | 9 | 8 | 10 | 9 | 10 | 9.2 | NEEDS FIXES |
| 1 | S2 users en | 390 | 9 | 9 | 10 | 10 | 8 | 9 | 9.2 | NEEDS FIXES |
| 1 | S2b create dialog ar | 1440 | 9 | 9 | 10 | 9 | 9 | 10 | 9.3 | NEEDS FIXES |
| 1 | S2b create dialog ar | 390 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES |
| 1 | S2b create dialog en | 390 | 9 | 9 | 9 | 9 | 8 | 9 | 8.8 | NEEDS FIXES |
| 1 | S3 detail ar | 1440 | 9 | 9 | 10 | 9 | 9 | 9 | 9.2 | NEEDS FIXES |
| 1 | S3 detail ar | 390 | 9 | 9 | 9 | 10 | 10 | 10 | 9.5 | READY |
| 1 | S3 detail en | 1440 | 9 | 9 | 9 | 9 | 10 | 9 | 9.2 | NEEDS FIXES |
| 1 | S3b edit dialog ar | 1440 | 9 | 9 | 9 | 10 | 8 | 10 | 9.2 | NEEDS FIXES |
| 1 | S3b edit dialog ar | 390 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES |
| 1 | S3b edit dialog en | 390 | 9 | 9 | 9 | 10 | 9 | 9 | 9.2 | NEEDS FIXES |
| 1 | S4 students ar | 1440 | 9 | 8 | 10 | 9 | 9 | 10 | 9.2 | NEEDS FIXES |
| 1 | S4 students ar | 390 | 9 | 9 | 10 | 9 | 9 | 9 | 9.2 | NEEDS FIXES |
| 1 | S4 students en | 1440 | 9 | 9 | 8 | 10 | 9 | 10 | 9.2 | NEEDS FIXES |
| 1 | S4b onboard dialog ar | 1440 | 9 | 9 | 9 | 8 | 10 | 10 | 9.2 | NEEDS FIXES |
| 1 | S4b onboard dialog ar | 390 | 9 | 9 | 9 | 9 | 8 | 9 | 8.83 | NEEDS FIXES |
| 1 | S4b onboard dialog en | 390 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES |

Pass 2 (after fix waves; recaptured only fix-affected captures):

| Pass | Surface | Viewport | Hier | Spacing | Typo | Color | Afford | Resp | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | S1 register ar | 1440 | 9 | 9 | 10 | 10 | 9 | 10 | 9.5 | READY |
| 2 | S1 register ar | 834 | 9 | 9 | 10 | 9 | 8.5 | 9 | 9.08 | NEEDS FIXES* |
| 2 | S1 register en | 1440 | 9 | 9 | 10 | 9 | 8 | 9 | 9.0 | NEEDS FIXES* |
| 2 | S2b create dialog ar | 1440 | 9 | 9 | 10 | 9 | 9 | 10 | 9.3 | NEEDS FIXES* |
| 2 | S2b create dialog ar | 390 | 9 | 9 | 9 | 9 | 9 | 9 | 9.0 | NEEDS FIXES* |
| 2 | S2b create dialog en | 390 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES* (zero findings text) |
| 2 | S3b edit dialog ar | 1440 | 9 | 9 | 10 | 9 | 8.5 | 9 | 9.08 | NEEDS FIXES* |
| 2 | S3b edit dialog ar | 390 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES* |
| 2 | S3b edit dialog en | 390 | 9 | 9 | 9 | 10 | 9 | 10 | 9.2 | NEEDS FIXES* |
| 2 | S4 students ar | 1440 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES* |
| 2 | S4 students ar | 390 | 9 | 9 | 10 | 9 | 8 | 9 | 9.0 | NEEDS FIXES* |
| 2 | S4 students en | 1440 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES* |
| 2 | S4b onboard dialog ar | 1440 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES* |
| 2 | S4b onboard dialog ar | 390 | 9 | 9 | 10 | 9 | 8 | 10 | 9.2 | NEEDS FIXES* (was 8.83) |
| 2 | S4b onboard dialog en | 390 | 9 | 9 | 9 | 9 | 9 | 10 | 9.2 | NEEDS FIXES* (was 9.2, findings changed class) |

`*` = verdict driven ONLY by findings adjudicated as inspector noise (DOM-disproven or pass-to-pass contradictions) — see Accepted cosmetic debt. Every MEDIUM/HIGH from pass 1 that survived DOM arbitration was fixed in a wave; no finding that survived arbitration was left unfixed.

## Pre-check gate failures found (and fixed)

| Surface | Check | Script output line | Fix |
|---|---|---|---|
| (harness) | console sweep | `[log] Download the Apollo DevTools…` / `[log] [Fast Refresh] rebuilding` counted as errors | Known-ignored entries filtered in the gate runner (dev-build noise, not page errors) |
| (harness) | gate JSON parse | rg pattern missed `\"` escaped output | Parse via json.loads once, emit tokens |
| S1 register | title guard | EN batch returned `Kottaby Academy — Create account` vs AR guard | Locale-pinned expected title per batch (protocol rule) |
| S2b/S3b/S4b dialogs | dialog-absent | click target localized (`إنشاء مستخدم` vs `Create user`) after locale re-pin | aria-label/text re-resolved per locale; NEXT_LOCALE re-pinned before every batch |

No page-level gate failures: zero horizontal overflow, zero off-viewport bleed, zero missing img alt, zero unnamed icon buttons across all 40 captures.

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|
| W1 | frontend/views/auth/register/RegisterAccountSection.tsx | Gender lone half-width orphan row (flagged independently by ar-1440 + en-1440) → `gridColumn: 1/-1` full-width span, consistent with password/role rows | ✅ duplicates+tsgo+oxlint | n/a (view-only) |
| W2 | frontend/views/admin/users/dialogs/CreateUserRoleSegments.tsx | (a) selected segment fill DARKER than its track in dark mode → success-tinted `color-mix` fill; (b) "Teacher Applicant"/"المتقدم للتدريس" label silently clipped inside ~90px row segment at 390px → compact column stack + wrapping label (sm+ row layout untouched) | ✅ (after fixing `no-misused-spread` via sx array + inferred return type) | n/a |
| W3 | frontend/views/admin/users/dialogs/AdminDialogBands.tsx | Bare-text Cancel (create+edit dialogs) → `variant="outlined" color="inherit"` (playbook row); DialogActions pinned `position: sticky; bottom: 0` so the submit CTA stays reachable on compact viewports (was 800px deep on mobile) | ✅ | n/a |
| W4 | frontend/views/admin/forms/FormDialogShell.tsx | Same sticky pin for the onboarding dialog; keyboard-hint caption (`Ctrl + Enter…`) hidden below sm — it wrapped to 2 lines at 390px and unbalanced the action pair, and is a desktop-only affordance; Cancel/submit minHeight 54 | ✅ (twice — re-gated after hint change) | n/a |
| W5 | frontend/views/admin/students/AdminStudentsToolbarFields.tsx | Toolbar row mixed 44px/54px controls (primary CTA the SHORTEST) → uniform 54px token | ✅ | n/a |
| W6 | frontend/views/admin/users/detail/UserDetailPrimitives.tsx + TeacherApplicationPanels.tsx | "No cooldown" stats chip truncated in squeezed grid column with no recovery → `title` prop + full label | ✅ | n/a |

Post-fix DOM verification: gender 640px full-width; segments `scrollWidth==clientWidth` (no truncation) + selected `bg ≠ track`; cancel `outlined`; actions `position: sticky` and submit visible at 390×844 (top=725 ≤ 844); toolbar all h=54. Project-wide gates: `tsgo -b --noEmit` 0, knip 0, jscpd 0 clones, biome clean, `bun run lint` 0.

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|
| Submit CTAs below the fold on static captures (S1 full page, dialogs' actions pre-fix positions) | caps responsive/hierarchy axes at ~9 | Inspectors score a static viewport crop; below-fold CTAs exist in DOM (verified: submit at top=1091/900vh; sticky actions visible at 390) and one scroll reaches them — a static PNG cannot show scroll affordance | Functional reachability DOM-proven; sticky pin makes the CTA always-visible on the surfaces where it previously scrolled away |
| Gender has no required asterisk (register) | affordance 8–8.5 | Gender is intentionally OPTIONAL (demographic, non-validated); adding `*` would be wrong | Requiredness semantics come from specs.md; the asterisk convention only marks required fields — correct as-is |
| Inspector asks for "more vibrant primary", "brighter borders" (dark mode) | color/affordance ±0.5 | Theme tokens are the design source of truth (THEME_PALETTE); ad-hoc saturation would break token discipline (playbook: hex/ad-hoc color = wave rejection) | Dark-mode contrast uses theme container pairs; no AA failure measured |
| VLM "identical button weight" on create/edit dialogs after W3 | affordance 8.5–9 | Disproven by DOM (`contained` vs `outlined` classes) — the SAME passes that requested outlined cancel now read it as "too similar"; contradiction signature | Rubric: contradiction across passes on unchanged pixels = noise; the applied fix matches the canonical playbook recipe |
| Placeholder/empty-state styling of `—` cells (S4 parent column) | spacing ±0.5 | Muted em-dash is the app-wide empty-value convention shared with S3 | Consistent cross-surface convention; not page-specific debt |
| Onboarding password field lacks a live strength meter (S4b inspector request) | affordance ±0.5 | Feature addition outside plan #229 scope (registration owns the strength meter component; onboarding generates the credential server-side) | Recorded as scope boundary, not styling debt |

## Prototype comparison

No `prototype/` dir exists for this plan → Phase 7 skipped entirely per skill rules (one-line record, no comparison targets invented).

## Capture lessons → evolution-log candidates

- **Orphaned Chrome daemons multiply memory until the dev server OOM-dies mid-compile**: every `agent-browser session id` call after a daemon crash left a new Chrome (~400MB) alive; 3 instances + turbopack workers OOM-killed `next-server` twice (dmesg confirmed). Kill ALL `agent-browser`/`chrome` processes before restarting captures, keep exactly ONE daemon, and `curl`-warm every route BEFORE opening the browser (compile is browser-free memory-wise).
- **`rg -rln` foot-gun**: `-r` is REPLACE, not recursive — `rg -rln "x"` rewrites matched output text to "ln" and mangles search results (read-only, but corrupts analysis). Use `-l -n` or `-rn` never.
- **Stale score-verdict caching between recapture rounds** (already in evolution log 2026-09-28; re-confirmed — clear verdict dir or alias-costs a wasted loop).
- **`--max-old-space-size=2048` does not cap turbopack workers**: even at 1536 the compile-time RSS spike with a browser open exceeds the sandbox; the curl-warm pattern is the reliable mitigation.
- **Locale cookie must be re-pinned per capture BATCH and the click-target re-derived from the pinned locale** (re-confirmed; title guard caught it both times).
