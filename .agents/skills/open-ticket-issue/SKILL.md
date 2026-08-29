---
name: open-ticket-issue
description: >
  Open a GitHub issue for a planning ticket (e.g. DEV1-005) on this repo's GitHub remote,
  with the correct sprint milestone, labels, assignee, dependency cross-links, and a plan-backed
  issue body. Use this skill when: (1) the user asks to open/create a GitHub issue for a ticket,
  sprint, or plan under ai/plans, (2) the user wants issues synced from docs/planning/TICKETS.md,
  (3) the user asks to retroactively track implemented tickets as issues.
license: MIT
compatibility: Works with Kimi Code CLI and similar AI coding assistants; requires the `gh` CLI authenticated to the repo.
metadata:
  author: kottaby
  version: "1.0.0"
allowed-tools: Read Grep Glob Bash Write
---

# Open GitHub Issue for a Planning Ticket

Create a single GitHub issue that faithfully represents one ticket from `docs/planning/TICKETS.md`,
backed by its implementation plan under `ai/plans/sprint_N/<slug>/` when one exists.

## Required Inputs (confirm before creating)

- **Ticket ID** (e.g. `DEV1-005`) or the plan directory path.
- **Assignee** (GitHub login). NEVER create the issue without one — ask if not given.
- Whether the ticket is **already implemented** (a "Status" line is only allowed with evidence; see Content Rules).

Use the conversation context for these when already established (repo milestones, label scheme,
assignee preferences); ask only for what is genuinely missing.

## Process

- [ ] Extract the ticket entry from `docs/planning/TICKETS.md` (search `### \[<TICKET-ID>`); capture title, sprint, story points, blocked-by, description, acceptance criteria, test scenarios, decision refs.
- [ ] Cross-check dependencies against the sprint backlog table in `docs/planning/SPRINT_PLAN.md` (the sprint plan may list dependencies not in the ticket entry).
- [ ] Map every dependency ticket to an existing GitHub issue number: `gh issue list -R <owner>/<repo> --state all --json number,title`. Titles carry no ticket prefixes, so match by title keywords. If a dependency has no issue, report it — do not invent a reference.
- [ ] Locate the plan bundle: `ls ai/plans/sprint_<N>/<slug>/` (expect `plan.md`, `specs.md`, `tasks.md`, optional `deferred-items.md`, `outcome/`, `prototype/`). Read `specs.md` for the summary material.
- [ ] Verify plan paths exist on `origin/main` before linking them: `git cat-file -e origin/main:<path>`. If not on main, link the tree without per-file links or note the branch that has them.
- [ ] Resolve milestone: `gh api repos/<owner>/<repo>/milestones --jq '.[].title'`. Sprint 0 → `Foundation`, Sprint 1 → `Core Domain MVP`. For sprints without an existing milestone, create one named per `docs/planning/SPRINT_PLAN.md` and tell the user.
- [ ] Ensure labels exist: `sprint-<N>` (create it if missing, e.g. `gh label create sprint-2 --color 0052CC`) and `enhancement`. NEVER create or apply `dev-1`/`dev-2`/`dev-3` stream labels.
- [ ] Compose the issue body per the template below.
- [ ] Create the issue: `gh issue create -R <owner>/<repo> --title "..." --assignee <login> --milestone "<Milestone>" --label sprint-<N>,enhancement --body "$(cat <<'EOF' ... EOF)"` (quoted heredoc delimiter so backticks in Gherkin/code survive).
- [ ] Verify: `gh issue view <n> -R <owner>/<repo> --json title,milestone,labels,assignees` — confirm all metadata landed; report the issue URL to the user.

## Issue Body Template

```markdown
## Overview

<description from TICKETS.md>

| Field | Value |
|---|---|
| **Sprint** | <N> |
| **Story Points** | <n> |
| **Status** | ✅ Implemented (tracked retroactively) |   <- only with evidence, else omit the row

## Dependencies

- **Blocked by:** #<n> (<title> — why, one phrase)
- **Builds on:** #<n> (...)
- **Unblocks:** <downstream ticket titles, no fake refs>

## Implementation Plan

Full plan bundle under [`ai/plans/sprint_<N>/<slug>/`](<GitHub tree URL on main>):
- [`plan.md`](<blob URL>) — architecture & design decisions
- [`specs.md`](<blob URL>) — requirements (EARS format)
- [`tasks.md`](<blob URL>) — task breakdown

### Specification Summary

<5–12 concise bullets distilled from specs.md: key rulings, schema deltas, GraphQL surface,
state machines, security posture, forward contracts. Bullet sentences, no code dumps.>

## Acceptance Criteria

```gherkin
<verbatim from TICKETS.md>
```

## Test Scenarios

<verbatim from TICKETS.md>

## References

- Ticket catalog: `docs/planning/TICKETS.md`
- Specs: `docs/specs/`
- **Decision Refs:** <verbatim>
```

## Content Rules (hard-won project conventions)

- **Title**: ticket title WITHOUT the `[DEVx-XXX]` prefix (e.g. `Plan Catalog CRUD (Admin Only)`).
- **No ticket IDs in prose**: bodies must not use `DEVx-XXX` as text or `Dev N` stream names. Replace dependency mentions with issue refs (`#4`). Keep the "Decision Refs" line verbatim from the ticket (e.g. FR-2.1, INV-S3 — these are spec refs, not ticket refs).
- **File paths stay verbatim**: plan directory paths inside `ai/plans/` keep their slug (e.g. `.../dev1-005-plan-catalog-crud-admin-only/plan.md`) — they are real locations, not labels.
- **Status line evidence**: add "**Status**: ✅ Implemented (tracked retroactively)" only when there is concrete evidence — an `outcome/` directory in the plan bundle, a merged PR touching the ticket, or a canonical implementation doc on `main` — or when the user states the ticket is done.
- **Dependencies section is mandatory** when dependencies exist: map `Blocked By` to issue numbers, add builds-on/unblocks context where the plan spec names them.
- **Specification summary is a summary**: distill `specs.md`, do not copy section text wholesale. Capture the reconciliations and rulings a reviewer most needs (schema deltas, contract surfaces, invariants, security posture).
- **One issue per turn by default** unless the user asks for a batch; batch creations still follow every rule per issue.

## Media & Prototype Images

- NEVER embed images in issue bodies — the project decided against prototype screenshots in issues.
- Do not call `ReadMediaFile` for this skill's work. If any prototype inspection is ever needed, delegate to a dedicated subagent, one image at a time (per the global media-isolation rule), and keep the main context text-only.

## Ground Rules

- ALWAYS confirm the assignee before creating (never guess from ticket ownership streams).
- ALWAYS check existing milestones and labels before creating new ones.
- ALWAYS verify the created issue's metadata and report the URL back to the user.
- ALWAYS map dependencies to real issue numbers checked against `gh issue list`.
- NEVER add dev-stream tags (`dev-1`/`dev-2`/`dev-3`) or ticket-ID prefixes to titles or bodies.
- NEVER claim a ticket is implemented without evidence.
- NEVER create summary markdown files; report results in chat.
- NEVER embed or batch-load prototype images.
