#!/usr/bin/env python3
"""
Spec-Driven Plan Generator with Kimi K3 & Repomix
Bundles project context (AGENTS.md, docs, skills, schema, tickets, templates),
embeds the Spec-Driven Development methodology, and generates production-grade,
line-accurate Spec-Driven Plan files under ai/plans/<dev-ticket-slug>/:
  - specs.md (Requirements, EARS acceptance criteria, Traceability Matrix)
  - plan.md (Technical Architecture, DB Schema, UX & APIs, Security Mitigations)
  - tasks.md (Phased, trackable implementation tasks with 5-stage subtask pipeline)
  - deferred-items.md (Deferred items ledger)
  - outcome/ (Knowledge base & task outcomes directory)

Supports multi-stage generation (specs -> plan -> tasks) to ensure maximum depth
and avoid context/token dilution. Supports fuzzy autocomplete ticket selection.
"""

import argparse
import datetime
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import openai
from prompt_toolkit.application import Application
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout.containers import HSplit, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.styles import Style
from prompt_toolkit.widgets import TextArea


DEFAULT_ROUTER_DIR = Path.home() / "Projects" / "router" / "nvidia"
DEFAULT_KEYS_PATH = DEFAULT_ROUTER_DIR / ".keys" / "nvapi"
DEFAULT_LOCAL_BASE_URL = "http://localhost:20128/v1"
DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_MODEL = "nvidia/moonshotai/kimi-k3"

DEFAULT_INCLUDE_PATTERNS = (
    "AGENTS.md,"
    "app/AGENTS.md,"
    "backend/AGENTS.md,"
    "backend/db/repo/AGENTS.md,"
    "backend/db/schema/AGENTS.md,"
    "backend/db/seeds/AGENTS.md,"
    "backend/db/test/AGENTS.md,"
    "backend/db/test/logic/AGENTS.md,"
    "backend/enum/AGENTS.md,"
    "backend/graphql/AGENTS.md,"
    "backend/graphql/pothos/AGENTS.md,"
    "backend/services/AGENTS.md,"
    "backend/types/AGENTS.md,"
    "frontend/AGENTS.md,"
    "frontend/graphql/AGENTS.md,"
    "frontend/graphql/sharedDocuments/AGENTS.md,"
    "frontend/stores/AGENTS.md,"
    "shared/AGENTS.md,"
    "shared/locale/AGENTS.md,"
    "test/integration/AGENTS.md,"
    "test/ui/AGENTS.md,"
    "test/workflows/AGENTS.md,"
    "docs/**,"
    ".agents/skills/spec-driven-development/SKILL.md,"
    ".agents/skills/spec-implementation/SKILL.md,"
    ".agents/skills/plan-review/SKILL.md,"
    ".agents/skills/quality-gate/SKILL.md,"
    ".agents/skills/quality-loop/SKILL.md,"
    ".agents/skills/drizzle-best-practices/SKILL.md,"
    ".agents/skills/drizzle-migrations/SKILL.md,"
    ".agents/skills/database-schema-designer/SKILL.md,"
    ".agents/spec-process-guide/templates/**,"
    ".agents/spec-process-guide/process/**,"
    ".agents/spec-process-guide/execution/**,"
    ".agents/spec-process-guide/ai-reasoning/**,"
    ".agents/spec-process-guide/resources/standards.md,"
    "backend/types/**,"
    "backend/enum/**,"
    "backend/db/schema/**,"
    "shared/constants/**,"
    "ai/plans/**/specs.md,"
    "ai/plans/**/plan.md"
)

SYSTEM_BASE_PROMPT = """# Kottab LMS — Principal Software Architect & Spec-Driven Engine

You are a Principal Software Architect and Technical Lead creating an exhaustive, production-grade Implementation Plan for a feature ticket in the Kottab LMS codebase.
The Kottab stack: Next.js 16 App Router, React 19, MUI v9, Apollo Client v4, Pothos GraphQL, Drizzle ORM, PostgreSQL, Bun runtime (`~/.bun/bin/bun`), custom compile-time i18n (`shared/locale/`).

## Architectural & Codebase Invariants (STRICTLY ENFORCED)

1. **Layer Separation & Data Flow**:
   - Client Component -> Apollo Hook -> GraphQL API -> Pothos Resolver -> Service -> Repository -> Database
   - Server Component -> Cached Wrapper -> Service -> Repository -> Database
   - Server Components call services directly; NEVER GraphQL. Client Components use Apollo hooks.
   - `shared/` must NEVER import from `@/frontend/**`, `@/backend/**`, or `@/app/**`.
2. **Canonical Types (`backend/types/{{entity}}.types.ts`)**:
   - `{{Entity}}SelectType`, `{{Entity}}InsertType` for DB.
   - `{{Entity}}ReturnType`, `{{Entity}}SubmitInput` for Service/API.
   - `DBTransaction`, `DBQueryExecutor` for database transactions.
   - NEVER create local types in Pothos resolvers; always import canonical types.
   - Service-layer `.types.ts` files are PROHIBITED. All types live in `backend/types/`.
3. **Database Repository & Transaction Rules**:
   - All DB operations wrapped in `runInRollback` for testing.
   - ALWAYS pass `tx` to all repository methods inside transactions (`repo.method(params, tx)`).
   - Use Drizzle Prepared Statements 2.0 (`sql.placeholder(...)`) for simple reads.
   - Schema updates use `bun run db push` (migrations for raw custom SQL only).
   - NEVER use inline `--` comments inside Drizzle `sql` templates (they break parameter binding).
4. **MUI v9 & React 19 Frontend**:
   - NO direct style props (`fontWeight`, `mb`, `mt`, `p`, `textAlign`, `display`, etc.) on Typography/Box/Stack/Grid. Must use `sx={{{{ ... }}}}`.
   - Icon naming: `*Outline` -> `*Outlined` (e.g. `ErrorOutline` -> `ErrorOutlined`).
   - `FormEvent` is removed -> use `React.SubmitEvent` or `React.SyntheticEvent<HTMLFormElement>`.
   - NO hardcoded colors -> use `theme.palette.*`.
5. **i18n & Localization**:
   - All user-facing strings and errors must use compile-time i18n in `shared/locale/`.
   - Server components: `getTranslations(locale, "namespace")` from `@/shared/locale/server`.
   - Client components: `useAppTranslation("namespace")` from `@/shared/locale/client`.
   - Resolvers: `ctx.t("namespace")`.
   - Never import `next-intl` (removed).
6. **Logging**:
   - NEVER use `console.*`. Use `logger` from `@/backend/lib/logger` or `@/frontend/utils/logger`.
7. **Security & Defenses**:
   - BOLA / IDOR Defense: Assert caller ownership (`ctx.user.id`), verify tenant isolation (`tenantId`).
   - BOPLA Defense: Strict DTO mapping; ensure no `{{ ...input }}` spread into DB updates/inserts.
   - BFLA Defense: Verify role/permission checks on mutations.
   - Input Sanitization: Ensure search queries escape wildcards (`escapeLikeWildcards`).
8. **System Decisions & Specification Ground Truth (MANDATORY)**:
   - Always consult and adhere to `docs/specs/open-decisions-and-gaps.md` (33 resolved decisions A.1–C.5).
   - Always enforce invariants from `docs/specs/state-machine-invariants.md` (Session INV-S1..S8, Teacher Verification INV-TV1..TV7, Student/Parent INV-B1..B5, Wallet/Escrow INV-W1..W8, Payment INV-PAY1..PAY4).
   - Always follow canonical workflows in `docs/workflows/` (01 Teacher Verification, 02 On-Demand Matching, 03 Session Lifecycle & Escrow, 04 Parent Supervision Handshake, 05 Admin Governance Override).
   - Always adhere to architectural standards in `docs/IDEMPOTENCY.md`, `docs/DATABASE_MIGRATIONS.md`, `docs/drizzle/prepared-statements.md`, and `docs/graphql/dataloader-batching.md`.
9. **Existing Codebase State & Implemented Plans Awareness**:
   - The foundational database schema (`DEV1-001`) and initial features (`DEV1-002`, `DEV1-003`, etc.) are ALREADY IMPLEMENTED in `backend/db/schema/`, `backend/types/`, `backend/services/`, and `ai/plans/`.
   - NEVER re-plan or re-invent already implemented tables, types, repositories, or services.
   - For any new ticket, inspect the existing codebase in context, build incrementally on top of established schemas/services, and only plan the NEW additions, mutations, resolvers, and UI views required for that specific ticket.
10. **Cross-Actor Journey Tests (`test/workflows/`)**:
   - Any feature where 2+ actors/roles interact over shared state (e.g. teacher submits -> supervisor approves -> parent notified) MUST be covered by a journey test: sequential, actor-attributed steps calling REAL services against the REAL test DB.
   - Journey tests call services with `actorUserId` directly (no HTTP server, no GraphQL layer). Permissions MUST resolve honestly via real permission-group membership, never monkey-patched.
   - `runInRollback` is FORBIDDEN for journey tests (services spawn their own transactions): fixtures are committed in `beforeAll` and hard-deleted in `afterAll` with tracked IDs; side effects (notifications/email/SMS) are spied, never sent.
   - Journey tests are written TEST-FIRST, before the service surface is implemented.
   - If `test/workflows/` does not exist in the packaged context, the plan MUST include tasks to scaffold it (helpers + `test/workflows/AGENTS.md`) following these rules.
"""


def load_all_tickets(tickets_file: Path) -> List[Tuple[str, str]]:
    """Loads all ticket IDs and titles from TICKETS.md"""
    if not tickets_file.is_file():
        return []
    content = tickets_file.read_text(encoding="utf-8")
    matches = re.findall(r"###\s*\[(.*?)\]\s*(.*?)(?=\n)", content)
    return [(tid.strip(), title.strip()) for tid, title in matches]


def select_ticket_interactively(tickets: List[Tuple[str, str]]) -> Optional[Tuple[str, str]]:
    """Interactive searchable autocomplete selection with arrow keys and Enter."""
    if not tickets:
        return None

    state = {
        "query": "",
        "filtered": tickets,
        "selected_idx": 0,
        "result": None,
    }

    def update_filter(new_query: str):
        state["query"] = new_query
        q = new_query.lower().strip()
        if not q:
            state["filtered"] = tickets
        else:
            state["filtered"] = [
                (tid, title) for tid, title in tickets
                if q in tid.lower() or q in title.lower()
            ]
        state["selected_idx"] = 0

    search_field = TextArea(
        height=1,
        prompt="🔍 Search ticket (type to filter): ",
        multiline=False,
        wrap_lines=False,
    )

    def on_text_changed(_):
        update_filter(search_field.text)

    search_field.buffer.on_text_changed += on_text_changed

    def get_list_text():
        lines = []
        filtered = state["filtered"]
        total = len(filtered)
        if total == 0:
            return [("class:empty", "  No tickets match your search query.\n")]

        selected_idx = state["selected_idx"]
        visible_count = 14
        start_idx = max(0, min(selected_idx - (visible_count // 2), max(0, total - visible_count)))
        end_idx = min(total, start_idx + visible_count)

        for i in range(start_idx, end_idx):
            tid, title = filtered[i]
            is_selected = (i == selected_idx)
            prefix = " ❯ " if is_selected else "   "
            style_class = "class:selected" if is_selected else "class:item"
            tid_style = "class:selected-tid" if is_selected else "class:tid"
            
            lines.append((style_class, prefix))
            lines.append((tid_style, f"[{tid}]"))
            lines.append((style_class, f" {title}\n"))

        info_text = f"\n Showing {start_idx + 1}-{end_idx} of {total} tickets (↑/↓ Navigate, Enter Select, Esc Cancel)"
        lines.append(("class:help", info_text))
        return lines

    list_window = Window(
        content=FormattedTextControl(get_list_text),
        height=17,
        wrap_lines=False,
    )

    root_container = HSplit([
        Window(
            content=FormattedTextControl(
                [("class:header", "🎯 Kottaby — Interactive Ticket Selector\n")]
            ),
            height=2,
        ),
        search_field,
        Window(height=1, char="─", style="class:separator"),
        list_window,
    ])

    kb = KeyBindings()

    @kb.add("up")
    def _move_up(event):
        if state["filtered"]:
            state["selected_idx"] = max(0, state["selected_idx"] - 1)

    @kb.add("down")
    def _move_down(event):
        if state["filtered"]:
            state["selected_idx"] = min(len(state["filtered"]) - 1, state["selected_idx"] + 1)

    @kb.add("enter")
    def _select(event):
        if state["filtered"] and 0 <= state["selected_idx"] < len(state["filtered"]):
            state["result"] = state["filtered"][state["selected_idx"]]
            event.app.exit(result=state["result"])
        else:
            event.app.exit(result=None)

    @kb.add("c-c")
    @kb.add("escape")
    def _cancel(event):
        event.app.exit(result=None)

    style = Style.from_dict({
        "header": "bold cyan",
        "separator": "#555555",
        "item": "white",
        "tid": "bold yellow",
        "selected": "bold reverse #00d7af",
        "selected-tid": "bold reverse #ffffff",
        "empty": "italic #888888",
        "help": "#777777 italic",
    })

    app = Application(
        layout=Layout(root_container, focused_element=search_field),
        key_bindings=kb,
        style=style,
        full_screen=False,
    )

    return app.run()


def optimize_code_whitespace(raw_xml: str) -> str:
    out_lines = []
    for line in raw_xml.splitlines():
        line = line.rstrip()
        if not line:
            continue
        m = re.match(r"^(\s*\d+\s*[:|]\s*)(.*)$", line)
        if m:
            prefix, code = m.groups()
            code_m = re.match(r"^(\s+)(.*)$", code)
            if code_m:
                spaces, rest = code_m.groups()
                level = len(spaces.replace("\t", "    ")) // 4
                rem = len(spaces.replace("\t", "    ")) % 4
                indent = ("  " * level) + (" " * (rem // 2))
                out_lines.append(f"{prefix.strip()}|{indent}{rest}")
            else:
                out_lines.append(f"{prefix.strip()}|{code}")
        else:
            out_lines.append(line)
    return "\n".join(out_lines)


def run_repomix(
    include_patterns: str,
    output_file: Path,
    compress: bool = False,
    show_line_numbers: bool = True,
    remove_comments: bool = True,
    remove_empty_lines: bool = True,
) -> bool:
    print(f"📦 Packing codebase context with Repomix (include: '{include_patterns}')...")
    runner = "bunx" if subprocess.run(["which", "bun"], capture_output=True).returncode == 0 else "npx"

    ignore_patterns = [
        "**/node_modules/**",
        "**/.git/**",
        "**/*.png",
        "**/*.jpg",
        "**/*.jpeg",
        "**/*.gif",
        "**/*.svg",
        "**/*.pdf",
        "**/drizzle/**",
        "**/drizzle-sqlite/**",
        "**/snapshot.json",
        "backend/storage/disk/**",
        "docs/bun/**",
    ]

    cmd = [
        runner,
        "repomix",
        ".",
        "--include",
        include_patterns,
        "-o",
        str(output_file),
        "--style",
        "xml",
        "--ignore",
        ",".join(ignore_patterns),
    ]

    if remove_comments:
        cmd.append("--remove-comments")
    if remove_empty_lines:
        cmd.append("--remove-empty-lines")
    if compress:
        cmd.append("--compress")
    if show_line_numbers:
        cmd.append("--output-show-line-numbers")

    print(f"Executing: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0 or not output_file.is_file():
        print(f"❌ Repomix failed with exit code {result.returncode}", file=sys.stderr)
        return False

    size_mb = output_file.stat().st_size / (1024 * 1024)
    print(f"✅ Repomix packed successfully ({size_mb:.2f} MB) -> {output_file}")
    return True


def load_nvidia_keys(keys_path: Path) -> List[Tuple[str, str]]:
    if not keys_path.is_file():
        return []
    keys = []
    with open(keys_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "|" in line:
                name, k = line.split("|", 1)
                keys.append((name.strip(), k.strip()))
    return keys


def resolve_model_name(client: openai.OpenAI, requested_model: str) -> str:
    try:
        models_resp = client.models.list()
        available_ids = [m.id for m in models_resp.data]
        if requested_model in available_ids:
            return requested_model
        bare_model = requested_model.removeprefix("nvidia/")
        prefixed_model = f"nvidia/{bare_model}"
        if prefixed_model in available_ids:
            return prefixed_model
        if bare_model in available_ids:
            return bare_model
        for model_id in available_ids:
            if bare_model in model_id or model_id.endswith(bare_model):
                return model_id
    except Exception:
        pass
    return requested_model


def create_client(
    direct_nvidia: bool,
    base_url: Optional[str],
    api_key: Optional[str],
    keys_path: Path,
) -> Tuple[openai.OpenAI, str]:
    if base_url and api_key:
        return openai.OpenAI(base_url=base_url, api_key=api_key), "explicit_custom"
    if direct_nvidia:
        env_key = os.environ.get("NVIDIA_API_KEY")
        if env_key:
            return openai.OpenAI(base_url=base_url or DEFAULT_NVIDIA_BASE_URL, api_key=env_key), "nvidia_env_key"
        keys = load_nvidia_keys(keys_path)
        if keys:
            name, key = keys[0]
            return openai.OpenAI(base_url=base_url or DEFAULT_NVIDIA_BASE_URL, api_key=key), f"nvidia_keyfile_{name}"
    target_base_url = base_url or DEFAULT_LOCAL_BASE_URL
    return openai.OpenAI(base_url=target_base_url, api_key=api_key or "none"), "local_router"


def find_ticket_in_file(ticket_id: str, tickets_file: Path) -> Optional[Tuple[str, str]]:
    """Returns (ticket_title, ticket_full_body)"""
    if not tickets_file.is_file():
        return None
    content = tickets_file.read_text(encoding="utf-8")
    escaped_id = re.escape(ticket_id)
    pattern = rf"###\s*\[{escaped_id}\]\s*(.*?)\n([\s\S]*?)(?=\n###\s*\[|\Z)"
    match = re.search(pattern, content)
    if match:
        title = match.group(1).strip()
        body = f"### [{ticket_id}] {title}\n" + match.group(2).strip()
        return (title, body)
    return None


def extract_sprint_from_ticket(ticket_id: str, tickets_file: Path) -> Optional[str]:
    """Extract sprint number from ticket table in TICKETS.md"""
    if not tickets_file.is_file():
        return None
    content = tickets_file.read_text(encoding="utf-8")
    escaped_id = re.escape(ticket_id)
    # Look for the table after the ticket header
    pattern = rf"###\s*\[{escaped_id}\][\s\S]*?^\|\s*\*\*Sprint\*\*\s*\|\s*(\d+)\s*\|"
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return match.group(1)
    return None


def slugify(text: str) -> str:
    """Converts a string to kebab-case slug"""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text.strip("-")


def create_deferred_items_ledger(plan_dir: Path, feature_slug: str):
    """Creates the standard deferred-items.md file."""
    deferred_file = plan_dir / "deferred-items.md"
    if not deferred_file.exists():
        today = datetime.datetime.now().strftime("%Y-%m-%d")
        content = f"""# Deferred Items Ledger

**Feature:** `{feature_slug}`  
**Plan Directory:** `ai/plans/{feature_slug}/`  
**Created:** `{today}`

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|

---

## Status Values

- ✅ **Done** — Item completed and verified
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on
"""
        deferred_file.write_text(content, encoding="utf-8")


def call_llm_stream(
    client: openai.OpenAI,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
    thinking: str,
    stage_name: str,
) -> str:
    """Invokes the LLM with streaming output and returns the full generated text."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    extra_body = {}
    if thinking != "off":
        thinking_config = {"enable_thinking": True}
        if thinking in ("low", "high", "max"):
            thinking_config["thinking_level"] = thinking
        extra_body["chat_template_kwargs"] = thinking_config

        if thinking in ("low", "high"):
            extra_body["reasoning_effort"] = thinking
        elif thinking == "max":
            extra_body["reasoning_effort"] = "high"
    else:
        extra_body["chat_template_kwargs"] = {"enable_thinking": False}

    print(f"\n=======================================================")
    print(f"📡 Generating [{stage_name}] via {model} (max_tokens={max_tokens})...")
    print(f"=======================================================\n")

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True,
        stream_options={"include_usage": True},
        extra_body=extra_body if extra_body else None,
    )

    collected_chunks = []
    try:
        for chunk in response:
            delta = chunk.choices[0].delta.content if chunk.choices and chunk.choices[0].delta else ""
            if delta:
                collected_chunks.append(delta)
                sys.stdout.write(delta)
                sys.stdout.flush()
    except KeyboardInterrupt:
        print("\n\n⚠️ Generation interrupted by user (Ctrl+C).")
        try:
            response.close()
        except Exception:
            pass
        sys.exit(130)

    print("\n")
    return "".join(collected_chunks).strip()


def build_specs_prompt(packed_xml: str, ticket_text: str) -> Tuple[str, str]:
    system_prompt = f"""{SYSTEM_BASE_PROMPT}

You are generating **Phase 1: Requirements & Specification (`specs.md`)** for the given ticket.
Follow the official `requirements-template.md` and standard Kottab specifications (like DEV1-001 and DEV1-002).

### Output Structure for specs.md:
```markdown
# Requirements & Specification: [Ticket ID] — [Ticket Title]

## 1. Executive Summary & Problem Statement
- **Feature**: Comprehensive summary of the feature and its place in Kottab LMS.
- **Problem from user perspective**: Persona workflows (Student, Parent, Teacher, Supervisor, Admin).
- **Business value**: Platform impact, revenue, integrity, downstream dependencies.
- **Actors involved**: Caller roles and downstream consumers.
- **Non-goals**: Explicitly list what is OUT of scope for this ticket.

## 2. Requirements & Acceptance Criteria (EARS Format)
Group requirements logically into numbered subsections:
- 2.1 Baseline & Foundational Preparation (MANDATORY):
  • **REQ-001 (Pre-Implementation Baseline & Ledger)**: WHEN implementation begins THEN system SHALL record baseline error counts (`tsgo`, `biome:check`, `lint-service`) and initialize `ai/plans/<feature-slug>/deferred-items.md` from template.
  • **REQ-002 (Type-Safe i18n & Enum Value Imports Compliance)**:
    - Client components MUST use `useAppTranslation(Translation.<Namespace>)` with Translation enum and property access (`t.property`), never string literals or function calls `t('key')`.
    - Server components MUST use `await getTranslations(locale)` (single argument) and property access.
    - GraphQL resolvers MUST use `ctx.t("namespace")`.
    - All enum usages in runtime expressions/casts MUST use value imports (not `import type`), and enum members instead of raw string literals.
  • **REQ-003 (Canonical Types Discipline)**: Entity types MUST come from `backend/types/<domain>/<entity>.types.ts` (`{{Entity}}SelectType`, `{{Entity}}InsertType`, `{{Entity}}ReturnType`, `{{Entity}}SubmitInput`), no local type definitions in Pothos resolvers.
- 2.2 Core Feature Logic / Happy Paths (Numbered REQ-010 to REQ-029 with strict EARS syntax: `WHEN... THEN... SHALL...` and `IF... THEN... SHALL...`)
- 2.3 Security, Authorization & Tenancy (BOLA/IDOR, BOPLA mass assignment whitelist, BFLA role gating, rate limiting)
- 2.4 Atomicity, Concurrency & Data Integrity (Transaction boundaries, rollback rules, unique race conditions, concurrency locks)
- 2.5 Validation & Error Contracts (DomainError subclasses, extensions.code mappings, localized i18n errors)
- 2.6 GraphQL & Frontend Contracts (Pothos mutation/query signature, TypedDocumentNode with id, MUI v9 sx rules)
- 2.7 Test Coverage (100% statement/branch target, runInRollback, tx propagation, expectRepoError try/catch; cross-actor journeys use the `test/workflows/` layer instead — real services + real DB, committed fixtures, NO runInRollback)
- 2.8 Documentation & Knowledge Gates (Canonical doc in docs/<domain>/, layer AGENTS.md updates)
- 2.9 Cross-Actor Workflow Scenarios (Journeys) — MANDATORY whenever the feature spans 2+ actors/roles interacting over shared state:
  • **Actor Table**: every actor, its role/permission group, what each can and cannot do.
  • **Ordered Step List**: per step `actor -> action -> expected shared-state change + side effects`, including denial steps (who MUST be rejected).
  • **Cross-Actor EARS Criteria**: phrase each criterion from the perspective of the actor who OBSERVES the outcome (e.g. "WHEN teacher submits X THEN system SHALL set state AND notify manager"), not only the acting actor.
  • Each journey maps 1:1 onto a `test/workflows/<domain>/<journey>.test.ts` test in tasks.md.

## 3. System Decisions & State Machine Invariants Alignment
- **Decision References**: Explicitly map feature behavior to resolved decisions in `docs/specs/open-decisions-and-gaps.md` (e.g. Decision A.1, A.2, B.4 Escrow model, B.12 Single parent link).
- **State Machine & Lifecycle Invariants**: Enforce exact invariants from `docs/specs/state-machine-invariants.md` (e.g., Session INV-S1..S8, Teacher Verification INV-TV1..TV7, Wallet INV-W1..W8) and canonical workflows in `docs/workflows/`.

## 4. Cross-Layer Traceability Matrix
Complete Markdown table:
| Requirement ID | Decision Ref / Invariant | Backend Service | GraphQL Mutation/Query | Frontend View | Test Coverage |
```

Do NOT include plan.md or tasks.md in this output. Output ONLY the complete markdown content for `specs.md`."""

    user_prompt = f"""Codebase Context:
```xml
{packed_xml}
```

Target Ticket / Request:
{ticket_text}

Generate the exhaustive, production-grade `specs.md` following all EARS requirements, architectural invariants, system decisions (`docs/specs/open-decisions-and-gaps.md`, `docs/specs/state-machine-invariants.md`, `docs/workflows/`), and the Cross-Layer Traceability Matrix."""
    return system_prompt, user_prompt


def build_plan_prompt(packed_xml: str, ticket_text: str, specs_content: str) -> Tuple[str, str]:
    system_prompt = f"""{SYSTEM_BASE_PROMPT}

You are generating **Phase 2: Technical Architecture & Implementation Design (`plan.md`)** for the given ticket.
You have access to the approved `specs.md`. Follow `design-template.md` and existing gold-standard designs.

### Output Structure for plan.md:
```markdown
# Technical Architecture & Implementation Design: [Ticket ID] — [Ticket Title]

## 1. System Overview & Architecture Diagram
- ASCII / Mermaid interaction diagrams showing: Client -> Apollo -> Pothos -> Service -> Repository -> Database.
- **Key Design Decisions Table**:
| # | Decision | Options Considered | Pros / Cons | Rationale (Maintainability, Scalability, Reliability) |
|---|---|---|---|---|

## 2. Data Models & Database Schema
- Existing schema verification (from `backend/db/schema/` — the Drizzle schema is the sole structural ground truth).
- Drizzle table modifications or additions under `backend/db/schema/<domain>/`.
- Canonical types to create/export in `backend/types/<domain>/<entity>.types.ts` (`{{Entity}}SelectType`, `{{Entity}}InsertType`, `{{Entity}}ReturnType`, `{{Entity}}SubmitInput`).
- Enums required in `backend/enum/` and registered in `backend/db/schema/enums.ts`.

## 3. API Contracts & Pothos Resolvers
- GraphQL Schema additions (Query / Mutation SDL with input types and return payload including `id`).
- Pothos resolver definition details (`authScopes`, rate-limit wrapping, error mappings to `extensions.code`).
- Permission matrix table for caller roles (Anonymous, Student, Parent, Teacher, Supervisor, Super Admin).

## 4. Backend Services, Repositories & Concurrency Model
- Service methods signatures in `backend/services/<domain>/<name>.service.ts` (validation, hashing, transaction boundaries, localized error throws).
- Repository methods in `backend/db/repo/<domain>/<name>.repository.ts` (all accepting `tx?: DBTransaction`).
- **Concurrency & Race Condition Assessment**:
  • Table of Race Condition Scenarios (Scenario, Actors, Risk, Mitigation).
  • Explicit `SELECT FOR UPDATE` or advisory lock usage on mutable balance/quota/escrow rows.
  • TOCTOU (Time-of-Check to Time-of-Use) window guarantees.
  • Atomic Redis operations (`SET NX EX`) if caching/locking is involved.
- **Cross-Actor Journey Design (MANDATORY when specs.md section 2.9 has journeys)**:
  • Shared-entity state machine per journey (states + allowed transitions + which actor/permission may drive each transition; Mermaid stateDiagram).
  • Side-effect matrix per transition: rows created/updated, notifications dispatched (channel -> recipient actor), idempotency keys.
  • Cross-actor visibility table: after each step, which actors can observe the new state — and who must NOT see it.
  • These become the journey test's assertion set.

## 5. Frontend UX & Navigation Specification
- **Routes & URLs Table**: Path, purpose, required permission, allowed roles.
- **Sidebar & Navigation Integration**: Group name, parent item, order, mobile bottom nav.
- **Per-Audience Rendering Table**: Differences between Student, Parent, Teacher, Supervisor, Admin.
- **Apollo GraphQL Documents & UI Components**: Component tree, hooks (`useAppTranslation`, `useMutation`), MUI v9 `sx` tokens.
- **Visual Design & Responsive Specifications**:
  • Breakpoint specifications: Desktop (1440px), Tablet (768px), Mobile (375px).
  • Multi-Language & RTL Layout: Bidirectional mirroring for Arabic (RTL) vs English (LTR), start/end alignments, Arabic typography line-heights.
  • Visual State Matrix: Empty states, skeleton loading, interactive form errors, success states, and disabled submit states.
  • Agent-Browser Verification Protocol: URL endpoints and workflows for automated screenshot capture and interactive functional verification.

## 6. Security, Authorization & Tenancy Mitigations
- Detailed BOLA / IDOR mitigations (asserting caller ownership via `ctx.user.id`).
- BOPLA mass assignment whitelist mapping (no `{{{{ ...input }}}}` spread into Drizzle).
- BFLA role and function gating.
- SQL injection / LIKE wildcard sanitization (`escapeLikeWildcards`).
- Error disclosure confidentiality (no leaking soft-deleted or sensitive account states).
```

Do NOT include tasks.md. Output ONLY the complete markdown content for `plan.md`."""

    user_prompt = f"""Codebase Context:
```xml
{packed_xml}
```

Target Ticket:
{ticket_text}

Approved Specifications (specs.md):
{specs_content}

Generate the exhaustive, production-grade `plan.md` implementing every requirement from `specs.md` with complete technical specificity."""
    return system_prompt, user_prompt


def build_tasks_prompt(packed_xml: str, ticket_text: str, specs_content: str, plan_content: str) -> Tuple[str, str]:
    system_prompt = f"""{SYSTEM_BASE_PROMPT}

You are generating **Phase 3: Trackable Implementation Tasks (`tasks.md`)** for the given ticket.
You have access to the approved `specs.md` and `plan.md`. Follow `tasks-template.md` and `spec-implementation` skill rules.

### STRICT RULES FOR tasks.md:
1. Include the **Non-Negotiable Execution Protocol**:
   - Pre-Execution outcome knowledge read
   - Post-Edit verification via `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`
   - Test files via `bun run test/scripts/run-test.ts <test-path>`
   - Semantic review checklist self-review
   - Outcome documentation under `outcome/<task-id>-outcome.md`
   - Checkbox tracking `[ ]` -> `[x]`
2. Follow the 8-Phase Spec-Driven Lifecycle:
   - **Phase 0: Pre-Implementation Baseline** (0.1 error baseline recording & deferred-items ledger, 0.2 prerequisite verification)
   - **Phase 1: Types, Enums & Database Schema**
   - **Phase 2: Repositories & Backend Services** (including Phase 2.M Mid-Point Review Gate)
   - **Phase 3: GraphQL Resolvers & API Handlers**
   - **Phase 4: Frontend GraphQL Documents, Stores & UI Views**
   - **Phase 5: Integration & Differential Testing**
   - **Phase 6: Post-Implementation Review Waves** (Parallel review waves: review-types, review-backend, review-frontend, pentester + deferred items check)
   - **Phase 7: Knowledge Propagation & Documentation** (Canonical doc in `docs/<domain>/`, layer `AGENTS.md` updates, outcome synthesis)

3. **SCOPE PHASES TO WHAT THE TICKET ACTUALLY TOUCHES**:
   - Backend-only tickets MUST NOT include frontend/UI tasks (no `.BF`/`.BS` agent-browser loops, no frontend stores/views phases).
   - Frontend-only tickets MUST NOT include Phase 1 database schema tasks; the Drizzle schema in `backend/db/schema/` is the sole structural ground truth — do not reference or update any external schema-definition artifacts.
   - Pure refactor/internal tickets may collapse to only the phases they touch. Never pad phases to hit a phase count.

5. **MANDATORY JOURNEY TEST TASKS (Cross-Actor Workflows)**:
   For EVERY journey captured in specs.md section 2.9, add one test-first journey task (before the service-surface tasks it covers):
```markdown
- [ ] X.J [Write <workflow name> journey test — TEST-FIRST]
  - Create `test/workflows/<domain>/<journey-name>.test.ts` — one file per cross-actor workflow
  - Provision the actor cast via a per-domain cast helper in `test/workflows/helpers/` (real permission-group membership rows — NEVER monkey-patch permission resolution)
  - Steps as sequential service calls with `actorUserId`: actor A action -> assert shared-state transition -> actor B observes -> actor B responds -> assert side effects
  - Assert cross-actor visibility (who sees what after each step) AND denial paths (unauthorized actor rejected, honest permission failure)
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` — NEVER `runInRollback` (services spawn their own transactions)
  - Spy notification dispatch; NEVER hit real email/SMS/push channels
  - If `test/workflows/` does not exist yet, this task also scaffolds the layer (helpers + `test/workflows/AGENTS.md`) per Architectural Invariant 10
  - Verify: `bun run test/scripts/run-test.ts <path>` green, then `bun test test/workflows`
  - _Requirements: REQ-XXX (the journey's cross-actor EARS criteria)_
```

6. **MANDATORY SUBTASK PIPELINES**:
- **For Backend / Repository / Service / Resolver Tasks (X.Y)**:
```markdown
- [ ] X.Y [Implement Backend Component / Service]
  - [Files to modify/create with exact paths]
  - [Applicable AGENTS.md paths and instruction files]
  - _Requirements: REQ-XXX_
  - [ ] X.Y.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` (exit code 0)
  - [ ] X.Y.TE **Test Engineering**: 4-Tier Framework (Tier 1 branch/stmt coverage, Tier 2 boundary, Tier 3 chaos, Tier 4 security; `runInRollback`, `tx` propagation, mock adapters)
  - [ ] X.Y.SEC **Security & Tenancy Audit**: BOLA/IDOR caller verification, BOPLA whitelist validation, BFLA function gating, wildcard escaping
  - [ ] X.Y.SR **Semantic Review**: Agent self-review against semantic checklist (atomicity, env-config, zero dead code, no cross-layer imports, enums as value imports)
  - [ ] X.Y.IV **Instruction Verification**: Read and validate against auto-discovered AGENTS.md and instruction files
```

- **For Frontend Views / Pages / UI Component Tasks (X.Y)**:
UI tasks MUST include 2 dedicated agent-browser self-loops (functional loop and visual/styling loop with screenshot analysis):
```markdown
- [ ] X.Y [Implement Frontend View / Component]
  - [Files to modify/create with exact paths under frontend/views/, frontend/components/ui/, app/]
  - [Applicable AGENTS.md paths: frontend/AGENTS.md, frontend/views/AGENTS.md, frontend/components/ui/AGENTS.md]
  - _Requirements: REQ-XXX_
  - [ ] X.Y.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` (exit code 0)
  - [ ] X.Y.TE **Unit / Component Tests**: Happy DOM + Apollo MockedProvider component tests, form submit tests (React.SubmitEvent), validation error rendering
  - [ ] X.Y.BF **Agent-Browser Functional Self-Loop**:
    • Launch dev server / connect via agent-browser (Playwright)
    • Navigate to page URL, execute end-to-end interactive workflows (form inputs, button clicks, tab transitions, modals/dialogs)
    • Assert network requests, GraphQL payload submissions, and error toast / inline validation states
    • Iterative self-loop: if user interaction or validation fails, patch code and re-test until clean
  - [ ] X.Y.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    • Capture high-resolution screenshots across Viewports (Desktop 1440x900, Tablet 768x1024, Mobile 375x812) and Locales (English LTR, Arabic RTL)
    • Visually inspect and analyze screenshots for: MUI v9 theme palette compliance (no hardcoded hex/rgb), typography hierarchy, padding/margin rhythm, text truncation/overflows, RTL mirroring alignments, dark/light contrast
    • Iterative self-loop: inspect screenshot -> identify UI defect -> patch MUI `sx` tokens -> re-capture screenshot -> repeat until visually polished
  - [ ] X.Y.SR **Semantic Review**: Verify zero direct style props (sx only), no hardcoded strings/colors, useAppTranslation property access, *Outlined icons
  - [ ] X.Y.IV **Instruction Verification**: Validate against frontend.instructions.md, mobile-desktop.instructions.md, and layer AGENTS.md
```

Do NOT omit subtasks. Do NOT use `...` placeholders. Provide the complete, exhaustive task breakdown."""

    user_prompt = f"""Target Ticket:
{ticket_text}

Approved Requirements (specs.md):
{specs_content}

Approved Technical Architecture (plan.md):
{plan_content}

Generate the complete, trackable `tasks.md` with all phases (Phase 0 through 7) including the mandatory 5-stage subtask pipeline for backend tasks, the expanded 7-stage pipeline with dual Agent-Browser self-loops (.BF for functional testing & .BS for screenshot analysis and styling) for UI tasks, and one test-first journey task (`test/workflows/<domain>/`) per cross-actor workflow captured in specs.md section 2.9."""
    return system_prompt, user_prompt


def validate_plan_against_rules(plan_dir: Path) -> List[str]:
    """Automated Plan-Review Gate (Phase 1.5): Scans generated artifacts against AGENTS.md rules."""
    violations = []
    specs_file = plan_dir / "specs.md"
    plan_file = plan_dir / "plan.md"
    tasks_file = plan_dir / "tasks.md"

    if not specs_file.exists():
        violations.append("Missing specs.md")
    if not plan_file.exists():
        violations.append("Missing plan.md")
    if not tasks_file.exists():
        violations.append("Missing tasks.md")

    if tasks_file.exists():
        t_content = tasks_file.read_text(encoding="utf-8")
        if "..." in t_content or "TODO" in t_content:
            violations.append("tasks.md contains incomplete placeholders ('...' or 'TODO')")
        if "X.Y.QL" not in t_content and ".QL" not in t_content:
            violations.append("tasks.md is missing mandatory Quality Loop (.QL) subtasks")
        if ".TE" not in t_content:
            violations.append("tasks.md is missing mandatory Test Engineering (.TE) subtasks")
        if ".TE" in t_content and "Tier" not in t_content:
            violations.append("tasks.md has .TE subtasks but omits the 4-Tier framework (Tier 1-4)")
        if ".SEC" not in t_content:
            violations.append("tasks.md is missing mandatory Security & Tenancy (.SEC) subtasks")
        if ".SR" not in t_content:
            violations.append("tasks.md is missing mandatory Semantic Review (.SR) subtasks")
        if ".IV" not in t_content:
            violations.append("tasks.md is missing mandatory Instruction Verification (.IV) subtasks")

    if specs_file.exists() and tasks_file.exists():
        s_content = specs_file.read_text(encoding="utf-8")
        t_content = tasks_file.read_text(encoding="utf-8")
        if re.search(r"cross-actor|workflow scenarios|journeys?", s_content, re.IGNORECASE):
            if "test/workflows/" not in t_content:
                violations.append(
                    "specs.md captures cross-actor journeys but tasks.md has no "
                    "test/workflows/ journey test tasks (test-first per Architectural Invariant 10)"
                )

    if plan_file.exists():
        p_content = plan_file.read_text(encoding="utf-8")
        if "console.log" in p_content or "console.error" in p_content:
            violations.append("plan.md references forbidden console.* logging")
        if "next-intl" in p_content:
            violations.append("plan.md references legacy next-intl package")

    for artifact in (specs_file, plan_file, tasks_file):
        if artifact.exists():
            a_content = artifact.read_text(encoding="utf-8")
            if re.search(r"\bdbml\b", a_content, re.IGNORECASE):
                violations.append(
                    f"{artifact.name} references DBML — external schema-definition files were retired; "
                    "backend/db/schema/ (Drizzle) is the sole structural ground truth"
                )

    return violations


def main():
    parser = argparse.ArgumentParser(description="Generate Spec-Driven Plan for a Ticket using Kimi K3 & Repomix")
    parser.add_argument("--ticket", default=None, help="Ticket ID (e.g., DEV1-002, DEV2-005) or search term from docs/planning/TICKETS.md")
    parser.add_argument("--query", default=None, help="Custom feature prompt if not using a ticket ID")
    parser.add_argument("--tickets-file", type=Path, default=Path("docs/planning/TICKETS.md"), help="Path to TICKETS.md")
    parser.add_argument("--include", default=DEFAULT_INCLUDE_PATTERNS, help="Glob patterns to pack via repomix")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model name (default: {DEFAULT_MODEL})")
    parser.add_argument("--base-url", default=None, help=f"Custom API base URL (default: {DEFAULT_LOCAL_BASE_URL})")
    parser.add_argument("--api-key", default=None, help="API Key")
    parser.add_argument("--direct-nvidia", action="store_true", help="Connect directly to NVIDIA API")
    parser.add_argument("--compress", action="store_true", help="Enable repomix compression")
    parser.add_argument("--thinking", default="max", choices=["off", "low", "high", "max"], help="Thinking/reasoning effort level (default: max)")
    parser.add_argument("--output-dir", type=Path, default=None, help="Custom plan directory path under ai/plans/")
    parser.add_argument("--sprint", default=None, help="Sprint identifier (e.g. '0', '1'); nests the plan directory under ai/plans/sprint_<value>/")
    parser.add_argument("--repomix-output", type=Path, default=Path("/tmp/kottab_spec_plan_repomix.xml"))
    parser.add_argument("--max-tokens", type=int, default=32768)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--context-limit", type=int, default=1000000)
    parser.add_argument("--single-pass", action="store_true", help="Run monolithic single-pass generation instead of multi-stage")
    parser.add_argument("--dry-run", action="store_true", help="Dry run repomix and token check only")

    args = parser.parse_args()
    project_root = Path.cwd()

    ticket_text = ""
    dir_slug = "feature"
    selected_ticket_title = ""

    # Interactive ticket selection if neither --ticket nor --query was passed
    if not args.ticket and not args.query:
        all_tickets = load_all_tickets(args.tickets_file)
        if all_tickets:
            print("🚀 Launching interactive ticket selector...")
            selected = select_ticket_interactively(all_tickets)
            if not selected:
                print("❌ No ticket selected. Aborting.")
                sys.exit(0)
            args.ticket, selected_ticket_title = selected
        else:
            print(f"❌ Error: Could not find tickets in {args.tickets_file}", file=sys.stderr)
            sys.exit(1)

    if args.ticket:
        clean_id = args.ticket.strip("[]")
        found = find_ticket_in_file(clean_id, args.tickets_file)
        if found:
            title, body = found
            ticket_text = f"Selected Ticket [{clean_id}] - {title}:\n\n{body}"
            title_slug = slugify(title)[:40].rstrip("-")
            dir_slug = f"{clean_id.lower()}-{title_slug}" if title_slug else clean_id.lower()
            print(f"🎯 Selected Ticket: [{clean_id}] {title}")
        else:
            print(f"⚠️ Ticket [{clean_id}] not found as explicit header in {args.tickets_file}. Using raw input as query.")
            ticket_text = f"Target Ticket: {args.ticket}"
            dir_slug = clean_id.lower().replace(" ", "-")
    elif args.query:
        ticket_text = f"Target Feature Request:\n{args.query}"
        query_slug = slugify(args.query)[:35].rstrip("-")
        dir_slug = f"custom-{query_slug}" if query_slug else "custom-feature"

    if args.output_dir:
        plan_dir = args.output_dir
    elif args.ticket:
        # Automatically determine sprint from ticket
        clean_id = args.ticket.strip("[]")
        sprint_number = extract_sprint_from_ticket(clean_id, args.tickets_file)
        if sprint_number:
            plan_dir = Path("ai/plans") / f"sprint_{sprint_number}" / dir_slug
        else:
            # Fallback to sprint_0 if no sprint found (should not happen with proper tickets)
            plan_dir = Path("ai/plans") / "sprint_0" / dir_slug
    elif args.query:
        # For custom queries, use sprint_0
        plan_dir = Path("ai/plans") / "sprint_0" / dir_slug
    else:
        # Should not reach here due to earlier interactive selection
        plan_dir = Path("ai/plans") / "sprint_0" / dir_slug

    print(f"🚀 Kottab LMS — Spec-Driven Plan Generator")
    print(f"📁 Root: {project_root}")
    print(f"🎯 Target Plan Directory: {plan_dir}")

    success = run_repomix(
        include_patterns=args.include,
        output_file=args.repomix_output,
        compress=args.compress,
        show_line_numbers=True,
    )
    if not success:
        sys.exit(1)

    print(f"📖 Reading repomix bundle ({args.repomix_output})...")
    raw_code = args.repomix_output.read_text(encoding="utf-8")

    print(f"✨ Optimizing whitespace...")
    context_code = optimize_code_whitespace(raw_code)
    reduction = len(raw_code) - len(context_code)
    pct = (reduction / len(raw_code)) * 100 if raw_code else 0
    print(f"📉 Whitespace minified: {len(raw_code):,} -> {len(context_code):,} chars (-{pct:.1f}%)")

    if args.dry_run:
        plan_dir.mkdir(parents=True, exist_ok=True)
        (plan_dir / "outcome").mkdir(parents=True, exist_ok=True)
        create_deferred_items_ledger(plan_dir, dir_slug)
        print(f"🔍 Dry-run complete. Directory {plan_dir} and outcome/ prepared. Repomix validated.")
        return

    client, auth_mode = create_client(
        direct_nvidia=args.direct_nvidia,
        base_url=args.base_url,
        api_key=args.api_key,
        keys_path=DEFAULT_KEYS_PATH,
    )
    resolved_model = resolve_model_name(client, args.model)
    print(f"🤖 Client ready [{auth_mode}] targeting: {resolved_model}")

    plan_dir.mkdir(parents=True, exist_ok=True)
    (plan_dir / "outcome").mkdir(parents=True, exist_ok=True)
    create_deferred_items_ledger(plan_dir, dir_slug)

    t0 = time.time()

    if not args.single_pass:
        print("\n🚀 Executing 3-Stage Sequential Generation (specs.md -> plan.md -> tasks.md)...")

        # Stage 1: specs.md
        sys_p1, user_p1 = build_specs_prompt(context_code, ticket_text)
        specs_content = call_llm_stream(
            client=client,
            model=resolved_model,
            system_prompt=sys_p1,
            user_prompt=user_p1,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            thinking=args.thinking,
            stage_name="Stage 1/3: specs.md",
        )
        (plan_dir / "specs.md").write_text(f"{specs_content}\n", encoding="utf-8")
        print(f"💾 Saved -> {plan_dir / 'specs.md'}")

        # Stage 2: plan.md
        sys_p2, user_p2 = build_plan_prompt(context_code, ticket_text, specs_content)
        plan_content = call_llm_stream(
            client=client,
            model=resolved_model,
            system_prompt=sys_p2,
            user_prompt=user_p2,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            thinking=args.thinking,
            stage_name="Stage 2/3: plan.md",
        )
        (plan_dir / "plan.md").write_text(f"{plan_content}\n", encoding="utf-8")
        print(f"💾 Saved -> {plan_dir / 'plan.md'}")

        # Stage 3: tasks.md
        sys_p3, user_p3 = build_tasks_prompt(context_code, ticket_text, specs_content, plan_content)
        tasks_content = call_llm_stream(
            client=client,
            model=resolved_model,
            system_prompt=sys_p3,
            user_prompt=user_p3,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            thinking=args.thinking,
            stage_name="Stage 3/3: tasks.md",
        )
        (plan_dir / "tasks.md").write_text(f"{tasks_content}\n", encoding="utf-8")
        print(f"💾 Saved -> {plan_dir / 'tasks.md'}")

    else:
        # Fallback single-pass mode
        sys_p = f"""{SYSTEM_BASE_PROMPT}

Generate all 3 files separated by:
<<<FILE: specs.md>>>
...
<<<END_FILE>>>

<<<FILE: plan.md>>>
...
<<<END_FILE>>>

<<<FILE: tasks.md>>>
...
<<<END_FILE>>>"""
        user_p = f"Codebase:\n```xml\n{context_code}\n```\n\nTicket:\n{ticket_text}\n\nGenerate complete specs.md, plan.md, tasks.md."
        full_text = call_llm_stream(
            client=client,
            model=resolved_model,
            system_prompt=sys_p,
            user_prompt=user_p,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            thinking=args.thinking,
            stage_name="Single-Pass Plan Generation",
        )
        file_blocks = re.findall(r"<<<FILE:\s*(.*?)>>>([\s\S]*?)(?:<<<END_FILE>>>|(?=<<<FILE:)|\Z)", full_text)
        if file_blocks:
            for filename, content in file_blocks:
                fname = filename.strip()
                if fname in ("implementation.md", "design.md"):
                    fname = "plan.md"
                elif fname == "trackable-tasks.md":
                    fname = "tasks.md"
                (plan_dir / fname).write_text(f"{content.strip()}\n", encoding="utf-8")
        else:
            (plan_dir / "plan.md").write_text(f"{full_text.strip()}\n", encoding="utf-8")

    elapsed = time.time() - t0
    minutes = int(elapsed // 60)
    seconds = elapsed % 60
    time_str = f"{minutes}m {seconds:.2f}s" if minutes > 0 else f"{seconds:.2f}s"

    # Automated Plan Review Gate (Phase 1.5)
    violations = validate_plan_against_rules(plan_dir)

    print(f"\n=======================================================")
    print(f"✅ Spec-Driven Plan Generation Completed Successfully!")
    print(f"⏱️ Time Taken: {time_str} ({elapsed:.2f}s total)")
    print(f"📁 Plan Directory: {plan_dir}")
    print(f"📄 Created Plan Artifacts:")
    print(f"   - specs.md -> {plan_dir / 'specs.md'}")
    print(f"   - plan.md -> {plan_dir / 'plan.md'}")
    print(f"   - tasks.md -> {plan_dir / 'tasks.md'}")
    print(f"   - deferred-items.md -> {plan_dir / 'deferred-items.md'}")
    print(f"   - outcome/ -> {plan_dir / 'outcome/'}")
    print(f"-------------------------------------------------------")
    print(f"🛡️ Automated Plan Review Gate (Phase 1.5):")
    if violations:
        for v in violations:
            print(f"   ⚠️ WARNING: {v}")
    else:
        print(f"   ✅ Plan passes all AGENTS.md and spec-process-guide baseline rules!")
    print(f"=======================================================")


if __name__ == "__main__":
    main()

