# Inspector Rubric

Contract for the single-image visual inspector subagents.

## Prompts must state

- Exactly one image path; the screen being inspected; the viewport; **the locale of the capture (en/ar)**.
- HARD RULE: one `ReadMediaFile` call on that file; optional `region` crops of the same file for detail; never a second image; no file edits.
- What the app shell looks like and that the shell (sidebar/topbar/bottom nav) is pre-existing and never scored.
- On re-inspection passes: the prior known issues being re-checked (so the inspector confirms or contradicts intentionally).
- The capture already passed the objective pre-check gate (console clean, no overflow, right page). Inspectors judge visual quality only — never re-litigate what the gate measures.
- **Describe the SURFACE, not the component contract (added 2026-10-01):** naming a feature's
  implementation ("the CountrySelector is an MUI Autocomplete with label + helper") in a prompt for
  a surface that legitimately renders NO input (dashboards with distribution rows, read-only detail
  views) makes inspectors hallucinate a missing form field — 3 phantom findings on one run, all
  DOM-disproven. On non-form surfaces describe what the surface IS; component contracts belong only
  on surfaces that actually host the component.

## Scoring axis (0–10 each; total = mean)

1. **Hierarchy & layout** — eye guidance: title → sections → actions in sensible order.
2. **Spacing & alignment** — consistent paddings; a shared rhythm; no accidental gutters or dead bands.
3. **Typography** — heading/label/caption scale, weight contrast, no cramped/oversized text. AR captures: bidi-correct rendering — no broken Arabic shaping, ellipsis on the correct (inline-end) side.
4. **Color & theming** — semantic color usage (success/error/info in roles that make sense); tokens, not ad-hoc colors.
5. **Control affordance** — buttons/inputs look interactive and equal in quality; selected/checked states unambiguous; empty/placeholder states deliberately composed.
6. **Responsiveness (for this viewport)** — no overflow, no dead space, purposeful reflow. AR captures: the layout actually mirrors — no "stuck" left/right regions.

## Structure deltas vs axis scores (observed 2026-09-13)

Prototype structure gaps (a surface/section the implementation deliberately lacks) are reported in
the "Prototype structure delta" line ONLY — they are NOT findings and MUST NOT reduce the six axis
scores. A rubric that leaves them coupled turned 9.2-10 pixels into 6.5-8.5 verdicts dominated by
out-of-scope redesign requests; the decoupled rubric scored the same captures 9.2-10. When a pass
must compare against a rich prototype, say so twice in the prompt: "score what EXISTS; missing
features are not findings".

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
- Calibration note (observed 2026-09-13): VLM inspectors score in integer steps and reserve 10 for "flawless" — totals plateau ≈9.0–9.2 even on surfaces whose every reported finding was fixed or DOM-disproven. When residuals are LOW-only, mutually contradictory across passes, or pixel-disproven, adjudicate via the accepted-debt clause instead of looping indefinitely on inspector noise.
- Contradiction signature (observed 2026-09-23): at the plateau, the DOMINANT noise class is findings that contradict earlier passes on unchanged pixels — a divider reported "missing" while the DOM shows two hairlines per card, "add a tooltip" while the `title` attribute is present, a fold-crop reported as truncation, pass-to-pass verdicts flipping READY↔NEEDS-FIXES (±0.4 total) on identical pixels. Run the DOM arbitration BEFORE any fix wave item is accepted, and record each arbitration in the outcome — a disproven finding is dismissed, never "fixed".

## Output contract from each inspector

```
=== <image> (locale: <en|ar>) ===
Scores: hierarchy X · spacing X · typography X · color X · affordance X · responsive X → total X
Findings ([HIGH/MEDIUM/LOW] element — defect — concrete fix): ...
Verdict: READY | NEEDS FIXES
```

Findings must be actionable blind: name the exact element, describe the defect precisely, and propose a fix kind. An inspector must verify claims with a `region` crop before reporting them; otherwise keep quiet about it. If the image is a blank/error/login page, report that and stop.

## DOM arbitration of disputed findings (orchestrator rule)

VLM inspectors hallucinate label text (especially Arabic) and estimate sizes/alignment that pixels
cannot prove. Before acting on any disputed finding — and before accepting any READY score that
rests on a dismissed finding — arbitrate with DOM ground truth via `agent-browser eval`: computed
styles (`letterSpacing`, `minHeight`, `textAlign`), `getBoundingClientRect` for sizes/centering,
Range client-rects for bidi/line ordering, and the translation source for copy claims. Record the
measurement in the outcome; a finding disproven by DOM evidence is dismissed, not accepted debt.

## Contrast findings are computed, never eyeballed (added 2026-10-01)

A VLM inspector invented "white text at ~2.8:1" on a copper CTA whose real pairing was near-black
text at 7.94:1 — VLMs frequently misidentify BOTH the text color and the background of tinted
buttons. Any color/contrast finding is a LEAD, not evidence: read `getComputedStyle`
backgroundColor/color from the live DOM and compute the WCAG ratio (both palette modes — a
dark-default app makes eyeballed light-mode claims doubly wrong) before accepting or dismissing.
The finding that survives computation may point at the OTHER mode than the capture showed.

## Modal-capture arbitration (added 2026-09-23)

Dialog/overlay captures attract modal-semantics delusions: inspectors score a modal DOWN for
"obscuring the primary content" (its purpose), claim "lacks a backdrop" against a DOM-verified
`rgba(0, 0, 0, 0.5)` `.MuiBackdrop-root`, and invent phantom UI states. Arbitrate EVERY
backdrop/centering/occlusion claim against `getComputedStyle` before acting, and treat
re-inspection findings that contradict the prior pass's DOM evidence as inspector noise —
never as new regressions.
