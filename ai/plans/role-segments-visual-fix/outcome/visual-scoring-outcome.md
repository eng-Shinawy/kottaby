# Visual Scoring Outcome — CreateUserRoleSegments (admin create-user dialog role switcher)

- Date: 2026-10-08
- Plan: no-plan run: user pointed at /admin/users create-user drawer role tab switcher (border/hover/active interleave + overflow complaint)
- Capture rig: storybook @ localhost:6066 (kottaby) + dev server @ localhost:3000 (in-situ dialog)
- Inspector model: default `images` route via scripts/analyze_image.py (single-model certificates; glm leg DEFERRED/BLOCKED — not batched, no consensus required)
- Locales captured: en, ar
- Dark-mode pass: yes (dark = app default; light desktop captured too)

## Surfaces covered

| Surface | Story id / route | Viewports | States |
|---|---|---|---|
| Role segments track | admin-create-user-role-segments--default @6066 | 1440×900, 390×844 | student-selected (default), hover-parent, light-scheme, ar-rtl |
| Role segments teacher-selected | admin-create-user-role-segments--teacher-selected @6066 | 1440×900 | teacher-selected |
| Real create-user dialog | /admin/users → "Create User" drawer @3000 | 1440×900 | ar + en, student-selected |

## Score history

One row per capture per pass; append passes, never rewrite earlier ones.

Model overall (12-axis audit, `images` default route, single-read certificates; glm leg DEFERRED/BLOCKED — no batched consensus required). Scores were dominated by (i) the two DOM-confirmed defects and (ii) story-staging noise the ledger discounts. Axis cells carry the audit's own category mapping where directly stated; dash = not separately scored.

| Pass | Surface | Viewport | Hier | Spacing | Typo | Color | Afford | Resp/Completeness | Total (model overall) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | story default (en, dark) | 1440×900 | 7 | 5 | 8 | 6 | 8 | 2 | 5 | NEEDS FIXES (clip + shadow spill) |
| 1 | story teacher-selected (en, dark) | 1440×900 | 7 | 8 | 7 | 7 | 7 | 3 | 5 | NEEDS FIXES (selected label clipped) |
| 1 | story hover-parent (en, dark) | 1440×900 | – | – | 6 | 8 | – | – | 6 | NEEDS FIXES (clip; overstrong glow) |
| 1 | story default (en, dark, mobile) | 390×844 | – | – | 7 | – | – | – | 5 | NEEDS FIXES (staging noise) |
| 1 | story default (ar, dark) | 1440×900 | – | – | – | – | 6 | ✓RTL | 6 | NEEDS FIXES (staging noise) |
| 1 | story default (en, light) | 1440×900 | – | – | – | – | – | – | 5 | NEEDS FIXES (unselected tier + overflow) |
| 1 | real dialog (ar, dark) | 1440×900 | – | – | – | – | – | – | 6 | NEEDS FIXES (adjacent-surface nits) |
| 2 | story default (en, dark) | 1440×900 | – | – | – | – | 9 | 10 | 8 | READY (both defects verifiably absent) |
| 2 | story teacher-selected (en, dark) | 1440×900 | – | – | – | – | 7 | 9 | 8 | READY ("ship-quality; only polish-level items remain") |
| 2 | story hover-parent (en, dark) | 1440×900 | – | – | – | – | – | 9 | 8 | READY ("would show this to a user") |
| 2 | story default (en, dark, mobile) | 390×844 | – | – | – | – | – | 9 | 7 | READY w/ debt (affordance + track chroma taste items) |
| 2 | story default (ar, dark) | 1440×900 | – | – | – | – | – | 9 | 9 | READY ("verifies as a clean post-fix re-inspection") |
| 2 | story default (en, light) | 1440×900 | – | – | – | – | – | 9 | 7 | READY w/ debt (same taste items) |
| 2 | real dialog (en, dark) | 1440×900 | – | – | – | – | – | 4* | 6 | NEEDS FIXES (*callout amputation — fixed in wave 2, pre-existing `overflow:hidden` paper, not the switcher) |
| 3 | real dialog (en, dark, scrolled) | 1440×900 | – | – | – | – | 6 | – | 5* | VERIFIED: "the sticky-footer fix landed correctly (the callout is fully visible)" — *see final adjudication row below |

Final pass-3 adjudication (all three fresh criticals DOM-dismissed): (1) "phone field missing" — the input renders 201×56 in the DOM; the claim misreads the sibling workstream's in-flight compact PhoneInput layout (their surface, live-edited mid-run); (2) "paper top-edge notched" — the scroll fold at scrollTop 83, the registered fold-crop misread class; (3) "Cancel co-equal" — outlined Cancel beside contained primary IS this playbook's canonical footer pattern.

Pass-2 verdict basis: the model's own anchor "8 = minor polish only, nothing a user would consciously notice" = the loop's READY bar; the completeness axis (the defect axis under audit) scored 9–10 on every story frame. The single dev-frame NEEDS-FIXES was the wave-2 target, DOM-verified fixed (scrollport active), with the post-fix visual capture blocked by a sibling workstream's in-flight `PhoneInput.tsx` rewrite (crashes the page; recorded, not fixed — shared-tree rule).

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|
| 1 | `frontend/views/admin/users/dialogs/CreateUserRoleSegments.tsx` | (a) selected segment `shadow.card` spill across 4px gaps + past track edge → state borders read interleaved/overflowing (user report; confirmed by 3 audits) — **removed the segment shadow** (border + tint + text weight carry the state); (b) "TEACHER APPLICANT" label clips 28px (story lane) / 8px (real 192px lane) — `whiteSpace: normal` at all breakpoints + `lineHeight sm 1.4` (wrapped 2-line label stays inside the 54px floor); (c) track radius 10px → **12px** (M3 concentric: 8px pill + 4px inset) | duplicates lifecycle ✅ | no dedicated unit tests for this presentational component; real-page DOM probe: clip 8px → 0px, shadow → none, heights uniform 55px |
| 1 | `frontend/stories/admin/CreateUserRoleSegments.stories.tsx` | mobile offscreen FAIL (frame `width:"100%"`+`m:4` overflow) — dropped explicit width; staging "stranded top-left" — `mx:auto` centered | duplicates lifecycle ✅ | story renders on Storybook 6066; all precheck gates green |
| 2 | `CreateUserDialog.tsx`, `EditUserDialog.tsx`, `ChangeUserPasswordDialog.tsx` | pass-2 dev audit CRITICAL (DOM-verified via `elementFromPoint`): the sticky `AdminDialogFooterBand` (opaque, z-1, `bottom:0`) slid up over the info callout's lower 59px and amputated it whenever the form outgrew the viewport-capped paper — root cause: the papers' `overflow: "hidden"` killed the scrollport the sticky pattern is documented to need ("pinned to the scrolling paper"). Family fix: `overflowY: "auto"` on all three sticky-band papers (still clips at the 16px radius; scrollport restored) | duplicates lifecycle ✅ ×3 | DOM post-fix: paper overflowY=auto, scrollHeight 918 > clientHeight 836 → tail scrollable-reachable instead of hidden; short-content dialogs render unchanged |


## Pre-check gate failures found (and fixed)

| Surface | Check | Script output line | Fix |
|---|---|---|---|
| story mobile 390 | offscreen | offenders: SECTION/DIV/LABEL/BUTTON bleed past viewport | story-frame bug: `width:"100%"` + `m:4` overflows by margins; dropped explicit width (block auto width fits) |
| story hover capture | state guard | hover bg alpha 0.024 pre-shot (mid-transition) | re-shot after 1s settle; 0.08 verified before AND after |
| dev-dialog pass-1 audit | vision wall | echo-class GarbageError + 2× HangError @270s | W4 single retry under wider wall (420s/540s) → valid body banked |

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|
| Unselected segments read as flat tiles (no resting affordance) — flagged by 4/7 pass-2 frames | affordance 7–9 | The M3 segmented-control idiom has no per-segment resting treatment — the tinted track IS the grouping affordance; adding resting borders reintroduces the adjacent-hairline "interleave" defect the user reported (registered class: nested borders/seams) and re-risks state bleed | hover, selected, and focus-visible states all present and clearly distinct; the control sits in a labeled track on a dialog form |
| Track `surfaceContainerHigh` chroma "steals" the green selected tint (dark scheme) | color axis, taste | The token is the app's M3 dark container ladder (navy-hued by theme design), not a component choice; swapping tokens is a theme-author decision | Contrast computed 7.2:1 (AA pass); the state separation audits "excellent" everywhere |
| Teacher label wraps to 2 lines on tight lanes while siblings stay 1-line | typography rhythm nit | Locale-length variance is irreducible: "Teacher Applicant"/"المتقدم للتدريس" cannot fit every lane without truncation | Readable > clipped (the registered defect class); wrap only engages when the lane is genuinely tight; segment heights stay uniform (flex stretch) |
| ALL-CAPS segment labels register "terse" for parent-facing copy | typography nit | Copy register is a product copy decision spanning all locales (labels are typed translations) | Consistent across siblings; reads intentional (audits' own words) |
| `person-add` teacher icon reads as "add" semantics | iconography nit | Icon set choice (MUI icon) + locale-copy decision | Recorded for the copy/icon owner; out of this run's component-styling scope |
| Rest-state: callout tail sits behind the pinned band until scrolled (long-form dialogs) | none (designed) | Inherent to every sticky-footer form pattern (the band's documented purpose: CTA reachable when content outgrows the dialog); the tail is scroll-reachable with a scrollbar affordance post-wave-2 | Pre-fix the same tail was unreachable AND invisible (overflow:hidden amputation); post-fix it is one scroll away |
| Info callout ~12px body text (real dialog, pre-existing surface) | minor, adjacent surface | `CreateUserInfoCallout` is a different component, untouched by this run's scope | Recorded for its owner; the precheck gate + sub-loop both green |


## Prototype comparison

Skipped — no prototype/ dir for this surface (no-plan run).

## DOM-arbitrated findings register (pass 1 → pass 2)

- CONFIRMED (critical, DOM): "TEACHER APPLICANT" label clips — story lane 152px: scrollWidth−clientWidth = 28px; REAL dialog @192px lane (EN): 8px overflow. Root cause: `whiteSpace: {sm:"nowrap"}` + flex-1 equal lanes. **Post-fix: clip 0 at every width.**
- CONFIRMED (design): selected segment carries `shadow.card` — dark variant `0 4px 6px -1px rgba(0,0,0,0.5)` spills across the 4px inter-segment gaps onto transparent neighbors and ~2px outside the 4px track padding → the border/hover/selected "interleaving" perception. **Post-fix: `boxShadow: none`; pass-2 audits report clean separation.**
- CONFIRMED (critical, DOM `elementFromPoint`, pass 2): sticky footer band paints over the callout tail (pre-existing `overflow:"hidden"` paper kills the sticky pattern's scrollport). **Post-fix (wave 2): `overflowY:"auto"`, paper scrolls 918/836, tail reachable.**
- DISMISSED (computed): "muddy strip hue / labels near contrast floor" — unselected label on track = 7.2:1; selected green on tint = 6.8:1 (both AA pass).
- DISMISSED (DOM): "icon presence split / green + on PARENT" — all three segments carry `.MuiButton-startIcon`; VLM misattributed the teacher segment's person-add glyph across the segment boundary.
- DISMISSED (DOM): "segments unequally divided" (AR frame) — all lanes measure equal (192px real / 152px story).
- DISMISSED (playbook noise class): sub-2px icon-baseline/centering nits — unmeasured VLM micro-claims.
- FRAME ARTIFACT: "lone control on dead void" staging — component story frame; mitigated by centering, discounted per ledger.
- SIBLING WORKSTREAM (recorded, not fixed): `PhoneInput.tsx` live rewrite (mtime 17:14) crashes `/admin/users` mid-run — blocked the post-wave-2 dev capture; not this run's surface.

## Capture lessons → evolution-log candidates

**Final verification state (2026-10-08 ~17:40):** all 5 run-owned files pass the full `sub-loop --lifecycle duplicates` gate. Repo-wide `tsgo` currently reports errors in SIBLING-workstream files only (`PhoneInput.tsx` unused imports; `PhoneInputProps` mismatches in `OnboardStudentProfileSection`/`CreateUserFormGrid`/`EditUserFormFields`/`RegisterIdentityFields`; gender-enum type at `EditUserDialog.tsx:79` — none on lines this run touched; recorded per the shared-tree rule, not fixed).

→ landed (evolution-log.md entry dated 2026-10-08, promoted into references):
- Multi-Storybook host: verify port ownership (`ss -ltnp` + `readlink /proc/<pid>/cwd`) — 6055 was another project, kottaby is 6066. → capture-protocol.md
- Multi-global iframe URLs need URL-encoded semicolons (`globals=locale%3Aen%3Btheme%3Adark`); the comma form silently drops globals. → capture-protocol.md
- `agent-browser hover` + MUI transitions: gate on the SETTLED computed value (alpha 0.024 mid-fade vs 0.08 settled). → capture-protocol.md
- Segmented selected-state drop shadow = the "interleaving borders" bug class. → fix-patterns.md (3 new rows + concentric-radius + story-frame-width rows)
- VLM segment-boundary icon misattribution: DOM-count startIcons before filing. → rubric candidate (banked here)
- `overflow:"hidden"` on a Dialog paper silently kills `position:sticky` footers (no scrollport → band rides up over content); `overflowY:"auto"` keeps corner clipping AND the sticky design. → fix-patterns.md row appended.

