---
name: visual-improvement-loop
description: >
  Visually polish a fully-implemented UI plan until every screen scores 10/10 across desktop/tablet/mobile,
  and compare the implementation against the plan's prototype images for structural parity-or-better.
  Use whenever the user asks to score/polish/restyle finished screens ("10/10", "get this page polished",
  "compare our implementation against the prototype", "fix responsiveness of page X", screenshots for review),
  especially for spec-driven-development plans that produced prototype/ dir images. Drives Storybook stories
  (creating them when missing), agent-browser captures with state verification, an objective pre-check gate,
  single-image inspector subagents, and disjoint-file fix waves gated by the per-file quality loop on every change.
---

# Visual Improvement Loop

Polish an **implemented** UI plan against its prototype and against a standing 10/10 visual bar, using Storybook stories, agent-browser captures, isolated image inspectors, and iterative fix waves until every screen scores READY.

## When to use

Trigger this skill when the user wants to visually perfect, score, or prototype-compare pages/views that came from an implemented plan: "get this page to 10/10", "compare our implementation against the prototype", "polish the new screens", "fix responsiveness for page X", "storybook screenshots for review". It expects the plan to be implemented (see Phase 0); if not, stop and report.

Do NOT use for: brand-new pages with no implementation yet (use spec-driven-development first), backend-only plans, or quick single-line style tweaks.

## Golden rules (from hard-won failures)

1. **One image per ReadMediaFile context.** Each visual inspection happens in a dedicated isolated subagent for ONE screenshot (never batch — multi-image payloads kill the upstream stream). The only permitted exception is the prototype-comparison inspector, which reads EXACTLY TWO images sequentially (prototype first, then implementation), never more.
2. **Never trust a capture without verifying the page state.** Verify `document.title` (auth bounce guard) and the interaction-driven DOM state (e.g. expanded sections) BEFORE and AFTER each screenshot. See `references/capture-protocol.md`.
3. **Prototype ≠ spec.** The prototype is an imagination aid: compare STRUCTURE ONLY — ignore colors entirely (prototypes ship arbitrary Tailwind colors). All row data in prototypes is fake — never let any of it leak into production code; the spec/docs always win on conflicts.
4. **Every fix wave passes the per-file quality loop.** No visual fix ships without `bun run scripts/health/sub-loop.ts <file> --lifecycle codescene` exit 0 and green component tests. This skill composes with the quality-loop skill — the loop runs per changed file, never skipped, even for "just CSS".
5. **Disjoint-file fix waves.** Parallel fix agents must own non-overlapping file sets (e.g. list vs form vs shared editor). Sharing the working tree with other workstreams: never touch files outside the assigned set; pre-existing failures in other domains are recorded, not fixed.
6. **Scripts measure, inspectors judge.** Mechanical defects (console errors, overflow, wrong page) are caught by the objective pre-check gate (Phase 3.5) BEFORE any image is inspected. Image inspectors are reserved for what requires eyes.

## Phase 0 — Implementation gate

Before any pixels are scored, prove the work is actually implemented. The gate adapts to the plan shape:

| Plan shape | Gate |
|---|---|
| Full spec (`specs.md` + `implementation.md` + `trackable-tasks.md`) | every task checked (or has an outcome file); tests for the touched layers green |
| Legacy spec (`spec.md` + `design.md` + `tasks.md`) | same, using `tasks.md` |
| Quick spec (`quick-spec.md`) | every checkbox done; touched-layer tests green |
| No plan (user points at pages directly) | reduced gate: each surface renders (DOM probe) and its component tests pass; Phase 7 skips automatically |

Universal rules:

- Prototypes absent (`prototype/` dir missing) in ANY shape → Phase 7 is skipped entirely; record the skip in one outcome line, never invent comparison targets.
- If the applicable gate fails: **stop** and report what's missing — polishing an unbuilt feature produces beautiful lies.

## Phase 1 — Surface inventory

- List the screens: base pages + state variants (`*-carryover`, `*-modal`), mobile variants where the design matters.
- If `.ai/plans/<plan>/prototype/` exists: map each `.png` to a screen + state (kebab names; `-mobile` = mobile variant of the base screen).
- Decide the comparison/proof set: one screenshot per (screen × viewport × state). Default viewports: **1440×900 desktop, 834×1112 tablet, 390×844 mobile**.
- Decide the locale set: EN always; AR in addition when the surface has meaningful RTL risk (forms, grids, banners). Record the locale set in the outcome header.

## Phase 2 — Stories first (Storybook is the capture rig)

Storybook's isolated iframe is faster, more deterministic, and needs no auth — strongly prefer it over the dev server for visual passes.

- Locate existing `*.stories.tsx` for the components. If missing, delegate story creation to a subagent following `references/storybook-protocol.md` (fixtures, providers, i18n, store seeding, cleanup).
- Stories must cover: each state you'll compare (empty, preselected, expanded, error incl. domain-error band).
- Fix waves that change component structure must update stories in the same wave — stale stories corrupt the next loop.

## Phase 3 — Capture

Per `references/capture-protocol.md`: authenticated session via `browser-login.ts --inject` (dev-server captures) or a public Storybook iframe session; viewport set per shot; title/verify guards; `--full` pitfalls (spell out when to use viewport+`scrollIntoView` instead).

## Phase 3.5 — Objective pre-check gate (mandatory)

Run the gate on EVERY capture before any inspector sees it:

```bash
scripts/visual-precheck.sh --url <capture-url> --settle 10 --expect-title "<page title substring>"
# or, between recaptures on an already-open page:
scripts/visual-precheck.sh --no-nav
```

Checks: title guard, console sweep, horizontal overflow, off-viewport bleed, a11y smoke — see `references/objective-prechecks.md`. Any FAIL becomes a HIGH finding, is fixed, and the capture is retaken; only fully green captures enter Phase 4. ERROR means the harness broke, not the page.

## Phase 4 — Score (inspector subagents)

Dispatch one subagent per screenshot. Give each exactly the image path, the screen, the viewport, the capture locale, and `references/rubric.md`'s scoring contract (inline the exact rubric axes/threshold from the reference, including the RTL checklist on AR captures). Each returns numeric axis scores, a total (mean), blind-actionable findings, and a READY (≥9.5) / NEEDS FIXES verdict.

Aggregate the pass table (screen × viewport → score) and sort findings by severity.

## Phase 5 — Fix waves

Cluster findings by shared files; dispatch one fixer per file set:

- Prompt: findings verbatim, the component file scope, conventions refs (`frontend/AGENTS.md`, `frontend/THEME_PALETTE.md`, per-dir AGENTS.md), the requirement to pass sub-loop `--lifecycle codescene` per touched file + the component test suite, and "no plan-tag comments, theme tokens only, RTL-safe".
- Fixers consult `references/fix-patterns.md` and apply the matching recipe; if no row matches a finding, the fixer says so in its report — that gap is a playbook candidate for the evolution log.
- Findings may point at a shared primitive (shared grids/containers). If so, the fix is a CROSS-FILE decision the orchestrator makes, not a silent edit the file-owner makes.

## Phase 6 — Iterate

Recapture after fixing (same viewport/state/locale mapping), re-run the Phase 3.5 gate, re-inspect, repeat until READY everywhere or the remaining findings are cosmetic-and-accepted — the acceptance bar is defined in `references/rubric.md` (both "why it can't reach 10" and "why acceptable" per item, listed in the outcome).

## Phase 7 — Prototype comparison (only when prototype/ exists)

This is the equal-or-better check: implementation must match or beat the prototype structurally.

- Skip rule: no `prototype/` dir → skip entirely, record the skip in the outcome. Never invent comparison targets.
- Per prototype screen, dispatch a **comparison inspector** with exactly the pair (prototype image, then implementation image) following the prompt in `references/prototype-compare.md` — including the structure-only rule and the scoring output contract.
- Deltas where the prototype is structurally richer (missing surfaces/fields/sections) go through a user decision; never silently scope-creep into schema changes. Schema/taxonomy-level deltas become plan amendments, not ad-hoc edits.

## Phase 8 — Close-out & evolve

- Re-run the affected component-test suites plus the plan's E2E/high-level journeys touching the same pages.
- Write the outcome following `references/outcome-template.md` exactly — score history per pass, pre-check failures found, fix-wave inventory, accepted debt with both justifications, capture lessons.
- **Evolve the skill (mandatory):** review the run for reusable lessons — new capture pitfalls, story tricks, fix recipes, inspector failure modes. Append each to `references/evolution-log.md` (dated, plan-linked) AND promote it in the same change: capture lessons into the protocol references, fix shapes into `references/fix-patterns.md`, and only GENERAL invariants into global rule files (AGENTS.md, instructions, agent-browser skill) — feature specifics stay in the plan outcome. A visual run that changed nothing in this skill is a run that taught nothing; if genuinely nothing was learned, the log gets a one-line "no new lessons" entry so the review visibly happened.
- Brief IN-CHAT summary for the user: per-surface final scores, what changed, what was consciously not done.

## Reference files

- `references/capture-protocol.md` — agent-browser sessions, auth injection, viewport setting, state-verified capture, `--full` pitfalls.
- `references/objective-prechecks.md` — the pre-inspection mechanical gate: checks, manual eval fallbacks, failure handling.
- `references/storybook-protocol.md` — story conventions, mock providers, store seeding/reset hygiene, locale globals usage for EN/AR captures.
- `references/rubric.md` — the 6-axis scoring rubric, RTL/i18n checklist, optional dark pass, debt-acceptance bar, per-image output format.
- `references/fix-patterns.md` — finding → canonical fix recipes for fix-wave convergence.
- `references/prototype-compare.md` — comparison-inspector prompt contract and delta-handling rules.
- `references/outcome-template.md` — canonical outcome file structure (score history, fix waves, accepted debt, lessons).
- `references/evolution-log.md` — the skill's self-improvement ledger: what each run taught and where the lesson landed.
- `scripts/visual-precheck.sh` — bundled gate runner (Bash + agent-browser CLI; exits non-zero on any FAIL).
