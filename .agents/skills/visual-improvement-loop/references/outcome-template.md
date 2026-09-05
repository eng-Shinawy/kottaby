# Outcome Template — Visual Scoring

Canonical shape of `.ai/plans/<plan>/outcome/visual-scoring-outcome.md` (or a named notes file for
no-plan runs). The fixed structure is what makes scores comparable pass-over-pass and run-over-run —
do not restructure it per run.

```markdown
# Visual Scoring Outcome — <plan or surface set>

- Date: <YYYY-MM-DD>
- Plan: .ai/plans/<plan>/ (or "no-plan run: <how surfaces were chosen>")
- Capture rig: storybook @ localhost:6006 | dev server @ localhost:3000
- Inspector model: <model>
- Locales captured: en [, ar]
- Dark-mode pass: yes | no

## Surfaces covered

| Surface | Story id / route | Viewports | States |
|---|---|---|---|

## Score history

One row per capture per pass; append passes, never rewrite earlier ones.

| Pass | Surface | Viewport | Hier | Spacing | Typo | Color | Afford | Resp | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|

## Pre-check gate failures found (and fixed)

| Surface | Check | Script output line | Fix |
|---|---|---|---|

## Fix waves

| Wave | Files | Findings addressed | Per-file sub-loop | Tests |
|---|---|---|---|---|

## Accepted cosmetic debt

| Item | Current score impact | Why it can't reach 10 | Why acceptable |
|---|---|---|---|

## Prototype comparison (skip section when no prototype dir — say so in one line)

| Screen | Better | Still missing vs prototype | Decision (implemented / user-declined / spec amendment) |
|---|---|---|---|

## Capture lessons → evolution-log candidates

- <lesson>: proposed target (skill reference / agent-browser gotcha / global rule file)
```
