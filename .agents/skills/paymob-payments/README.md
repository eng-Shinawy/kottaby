# Paymob Payments — Agent Skill for Claude Code, Codex & AI Coding Agents

A self-contained [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills)
that teaches **Claude Code, OpenAI Codex, Cursor, and any AI coding agent** how to
integrate, configure, and debug **[Paymob](https://paymob.com)** (باي موب /
"Accept") — the Egypt-first MENA payment gateway (also KSA, UAE, Oman,
Pakistan) — in any codebase.

It bundles a **complete offline mirror of `developers.paymob.com/paymob-docs`**
(116 pages, both the Documentation and Developers tabs, with full request/response
schemas) plus a hand-written quick-reference cheatsheet, so an agent works from
the real API shapes instead of guessing endpoints, request bodies, HMAC key order,
or test credentials.

## What's inside

```
SKILL.md                      # the skill entry: core model, bug-preventing rules, pointers
references/
  cheatsheet.md               # condensed guide: endpoints, auth modes, HMAC algorithm
                              #   + exact key order, checkout URL format, test cards
  docs/                       # full offline mirror of developers.paymob.com (116 .md pages)
    INDEX.md                  #   table of contents with per-page `METHOD endpoint` labels
  MIRROR.md                   # how the mirror was generated + known source quirks
scripts/
  fetch_mirror.sh             # re-fetch every page from the live Theneo site
  convert.py                  # convert the fetched page JSON into the markdown mirror
  postpass.py                 # link/anchor fix-ups
```

## Using it

**As a Claude Code skill** — copy the `paymob-payments/` folder into your
project's `.claude/skills/` (or your personal `~/.claude/skills/`):

```bash
git clone https://github.com/karem505/paymob-payments-skill.git \
  .claude/skills/paymob-payments
```

Then just describe Paymob work ("add Paymob checkout", "verify the webhook HMAC",
"why is my intention returning 404") and the skill triggers automatically.

**With OpenAI Codex, Cursor, Copilot, or any other coding agent** — everything
here is plain markdown, so it works with any agent that can read files:

- **Codex CLI**: clone the repo into your project (e.g. `docs/paymob-skill/`) and
  point to it from `AGENTS.md` — *"For any Paymob work, read
  `docs/paymob-skill/SKILL.md` first and look up exact endpoint schemas in
  `references/docs/`."*
- **Cursor / Copilot / others**: add the same pointer to your agent's rules or
  instruction file, or simply tell the agent to grep `references/docs/` for the
  endpoint it needs.

**As plain reference** — the `references/docs/` tree is readable on its own; grep
it for any endpoint, or open `references/cheatsheet.md` for the 5-minute version.

## What it covers

Intention API v2 (`v1/intention`), Unified Checkout & Pixel, transaction
callbacks / webhooks and **HMAC-SHA512 verification** (the exact 20-key order,
POST-vs-GET differences), refunds / voids / captures, pay-with-saved-cards
(CIT / MIT, card tokens), subscriptions, QuickLinks / payment links, transaction
inquiry, mobile wallets (Vodafone Cash etc.), region hosts (EG / KSA / UAE / OM),
and the common-error catalogue for each endpoint.

## Refreshing the mirror

The mirror is a point-in-time snapshot (generated 2026-06 from the live site). To
rebuild it against current docs, see `references/MIRROR.md` — the pipeline
enumerates pages from the site's own section map, so new pages are picked up
automatically.

## Attribution & licensing

- The original skill authoring — **`SKILL.md`, `references/cheatsheet.md`,
  `references/MIRROR.md`, and everything under `scripts/`** — is released under the
  [MIT License](./LICENSE).
- **`references/docs/`** is a verbatim/derived mirror of Paymob's public
  documentation at <https://developers.paymob.com/paymob-docs>. That content is
  **© Paymob** and is included here only as an offline convenience reference; all
  rights to it remain with Paymob. If you are Paymob and would like it removed,
  open an issue.

This project is an independent, unofficial integration aid and is **not affiliated
with or endorsed by Paymob**.
