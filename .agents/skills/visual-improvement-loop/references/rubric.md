# Inspector Rubric

Contract for the single-image visual inspector subagents.

## Prompts must state

- Exactly one image path; the screen being inspected; the viewport; **the locale of the capture (en/ar)**.
- HARD RULE: one `ReadMediaFile` call on that file; optional `region` crops of the same file for detail; never a second image; no file edits.
- What the app shell looks like and that the shell (sidebar/topbar/bottom nav) is pre-existing and never scored.
- On re-inspection passes: the prior known issues being re-checked (so the inspector confirms or contradicts intentionally).
- The capture already passed the objective pre-check gate (console clean, no overflow, right page). Inspectors judge visual quality only — never re-litigate what the gate measures.

## Scoring axis (0–10 each; total = mean)

1. **Hierarchy & layout** — eye guidance: title → sections → actions in sensible order.
2. **Spacing & alignment** — consistent paddings; a shared rhythm; no accidental gutters or dead bands.
3. **Typography** — heading/label/caption scale, weight contrast, no cramped/oversized text. AR captures: bidi-correct rendering — no broken Arabic shaping, ellipsis on the correct (inline-end) side.
4. **Color & theming** — semantic color usage (success/error/info in roles that make sense); tokens, not ad-hoc colors.
5. **Control affordance** — buttons/inputs look interactive and equal in quality; selected/checked states unambiguous; empty/placeholder states deliberately composed.
6. **Responsiveness (for this viewport)** — no overflow, no dead space, purposeful reflow. AR captures: the layout actually mirrors — no "stuck" left/right regions.

## RTL / i18n checklist (Arabic captures)

Applied on top of the axes when the capture locale is AR; each failure lands on the axis it belongs to:

- Layout mirrors end-to-end: nav/drawer on the mirrored side, breadcrumbs and chevrons flipped, steppers flow right-to-left.
- Directional icons (arrows, back/forward) mirror; neutral icons (check, search, settings) do not.
- Text is start-aligned — no hard left-justified Arabic paragraphs; no clipped or overlapping Arabic glyphs.
- Numerals/dates follow one consistent locale decision per screen (no mixed digit formats).
- Physical left/right spacing artifacts: symmetric paddings stay symmetric; asymmetric ones mirror.

## Dark-mode pass (optional, run-scoped)

If the run includes a dark pass (only when the app supports it — record `dark: yes/no` in the outcome header): capture each surface in dark color-scheme and score the same axes. Contrast failures are HIGH findings on the color axis, never cosmetic.

## Thresholds

- READY = average ≥ 9.5
- NEEDS FIXES otherwise. The orchestrator may accept a final LOW-only list as accepted debt, and only when every item is recorded in the outcome with BOTH: (a) why it cannot reach 10 (platform limitation, content-length variance, etc.), and (b) why that is acceptable (no impact on task success or perceived quality). Anything that degrades perceived quality is NOT cosmetic — it goes to a fix wave regardless of its severity label.

## Output contract from each inspector

```
=== <image> (locale: <en|ar>) ===
Scores: hierarchy X · spacing X · typography X · color X · affordance X · responsive X → total X
Findings ([HIGH/MEDIUM/LOW] element — defect — concrete fix): ...
Verdict: READY | NEEDS FIXES
```

Findings must be actionable blind: name the exact element, describe the defect precisely, and propose a fix kind. An inspector must verify claims with a `region` crop before reporting them; otherwise keep quiet about it. If the image is a blank/error/login page, report that and stop.
