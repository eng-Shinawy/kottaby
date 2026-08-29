---
name: spec-implementation
description: >
  Companion implementation skill to spec-driven-development. Executes feature plans
  task-by-task with per-file quality verification (sub-loop.ts), semantic review checklist,
  instruction verification, interleaved tests, mid-point review gate, post-implementation
  parallel review waves, deferred-items enforcement, and knowledge propagation. Adapts
  workflow for full-spec, quick-spec, and micro-spec plans. Keeps orchestrator context
  minimal by delegating all editing to pool-based parallel subagents.
license: MIT
compatibility: Claude Code, Cursor, VS Code, Windsurf
metadata:
  category: methodology
  complexity: advanced
  author: Kiro Team
  version: "1.0.0"
---

# Spec Implementation

You are an **implementation orchestrator** for plans created by the `spec-driven-development` skill. Your job is to execute a completed plan (specs, design/implementation, trackable-tasks) task-by-task, ensuring each task passes quality gates, semantic review, and instruction verification before proceeding.

## When to Use This Skill

**Use when:**
- A feature plan exists under `.ai/plans/<feature-name>/` with `trackable-tasks.md` (or `tasks.md`)
- The plan has passed `plan-review` ([.agents/skills/plan-review/SKILL.md](file://../.agents/skills/plan-review/SKILL.md)) (Phase 1.5 gate)
- Implementation work needs to begin

**Do NOT use when:**
- No plan exists yet — use [.agents/skills/spec-driven-development/SKILL.md](file://../.agents/skills/spec-driven-development/SKILL.md) to create one first
- The plan has NOT passed `plan-review` — invoke [.agents/skills/plan-review/SKILL.md](file://../.agents/skills/plan-review/SKILL.md) first 
- Only a simple bug fix is needed — fix directly

## Orchestrator Discipline (CRITICAL)

You are an **orchestrator**, not an editor. Following the pattern proven by `repo-review` and `fix-oxlint`:

1. **NEVER read source files yourself** — delegate all file reading to subagents
2. **NEVER run build/test commands yourself** — delegate to subagents or use `task` agent type
3. **Hold only**: the task list, outcome summaries, baseline counts, and aggregated findings
4. **Delegate all editing** to `general-purpose` subagents via the `task` tool
5. **Aggregate results** as one-line records: `[STATUS] <task-id>: <file> — <summary>`

This discipline is what allows you to manage 30+ task plans without exhausting context.

## Plan Intake & Validation

### Step 1: Detect Plan Type

Read the plan directory `.ai/plans/<feature-name>/` to determine the spec type:

| Files Present | Spec Type | Workflow |
|---|---|---|
| `specs.md` + `implementation.md` + `trackable-tasks.md` | Full spec | All phases, all gates |
| `spec.md` + `design.md` + `tasks.md` (older format) | Full spec (legacy) | All phases, all gates |
| `quick-spec.md` (or single combined doc) | Quick spec | Reduced gates (see §Quick-Spec Adaptation) |
| `micro-spec.md` (or minimal doc) | Micro spec | Minimal gates (see §Micro-Spec Adaptation) |

Also check for:
- `outcome/` directory — existing outcome files to read
- `deferred-items.md` — deferred-items ledger
- `ui-spec/` or `ui/` — nested sub-plans
- `prototype/` directory — Stitch MCP UI prototypes (see §Prototype-Aware Implementation)
- `skill-improvement-observations.md` or `skill-improvement-outcome.md` — prior learnings

### Step 2: Validate Plan Readiness

Before executing any task, verify:
1. **Plan-review gate passed**: Check for `outcome/plan-review-R*.md` files. If none exist, invoke `@plan-review` first.
2. **Tasks have checkboxes**: Every task in `trackable-tasks.md` must have `[ ]` checkboxes.
3. **Tasks reference requirements**: Each task should have `_Requirements: REQ-N_` traceability tags.
4. **No stale in-progress markers**: No `[-]` markers from a previous incomplete run (if found, resume from that point).
5. **Journey coverage (cross-actor workflows)**: If `specs.md` contains a "Cross-Actor Workflow Scenarios" / journeys section, every captured journey MUST have a corresponding `test/workflows/<domain>/<journey>.test.ts` task (see `docs/testing/workflow-journey-tests.md`). If missing, pause and flag it to the user before executing — the plan is incomplete.
6. **Test-kind inventory**: Scan the plan for which test layers it mandates (repo `test:db`, services `test:services`, journeys `bun test test/workflows`, GraphQL `test:graphql`, UI components, E2E). Record the inventory in memory — the Test-Layer Coverage Gate (below) verifies all of them ran before completion.
7. **X.Y subtask pipeline presence (PLAN-INDEPENDENT MANDATE)**: Check whether implementation tasks carry the mandatory `X.Y.QL` / `X.Y.TE` / `X.Y.SEC` / `X.Y.SR` / `X.Y.IV` subtask pipeline. **If the plan text omits it, that is a plan deficiency, not permission to skip**: the orchestrator MUST inject the pipeline into every per-subagent prompt at dispatch time (see Per-Task Execution Flow). Same rule for the 4-Tier framework in `X.Y.TE` — it applies to every implementation task even when the plan never mentions it.

### Step 3: Establish the Plan Inventory

Ask the user (via `ask_user`) which scope to execute:

```
Which scope would you like to implement?
- All phases (full plan execution)
- Specific phases only (e.g., Phase 1-3 backend only)
- Specific task IDs only (e.g., Task 1.1, 1.2, 5.3)
- Resume from last incomplete task
```

Parse the task list and build an in-memory execution queue. Group tasks by phase and dependency.

## Prototype-Aware Implementation

If the plan directory contains a `prototype/` subdirectory (typically produced by the `stitch` skill's Plan-to-Prototype Recipe — kebab-case `.html` + `.png` pairs, one per screen), treat it as a **first-class input to UI implementation**.

### Intake (Step 1 extension)

- List `.ai/plans/<feature-name>/prototype/`. If present, build the screen inventory: each kebab-case name maps to a UI surface (page, modal/tab state, drawer, mobile variant — `*-modal`, `*-drawer`, `*-mobile` suffixes are state/view variants of the base screen, not separate routes).
- If prototypes are missing AND the plan has meaningful UI work, offer to generate them via the `stitch` skill before starting (ask the user once; do not block on it).

### Before implementing any UI task

Dispatch the executing subagent with the matching prototype artifacts attached to its prompt:

1. **Screenshot first (`*.png`) — Single / Sequential Inspection (CRITICAL)**:
   - The subagent reads ONLY the specific screenshot for the active UI surface (e.g., via `ReadMediaFile`) to form a visual imagination of the target: layout structure, hierarchy, section ordering, density, and interaction affordances.
   - **NEVER batch-load multiple screenshots concurrently** (e.g., calling `ReadMediaFile` on 5–10+ images at once). Batching images creates multi-megabyte vision payloads that exceed upstream provider limits, triggering keepalive stream timeouts (`Stream ended before producing a non-ping SSE event`).
   - If multiple variant screenshots must be viewed (e.g., desktop vs mobile modal), inspect them **sequentially, 1–2 at a time**.
2. **HTML second (`*.html`)** — extract concrete details: element order, labels/copy, colors, spacing rhythm, component structure. Strip the Tailwind-CDN classes mentally; translate to the project's MUI + theme-palette conventions (never hardcode prototype colors; map to `theme.palette` tokens per `frontend/THEME_PALETTE.md`).
3. **Spec remains the authority** — prototype vs. spec conflicts are always resolved in favor of the plan's specs/design. The prototype is a visualization of the spec, not a source of new requirements.

### Prototype fidelity rules (CRITICAL)

- **Prototype data is 100% FAKE** — every name, row, metric, count, date, currency amount, and status in the screenshot/HTML is invented placeholder data. **Zero fake data may survive into the implementation.** EVERY rendered value must come from a real data source end-to-end: mock state is prohibited even temporarily — wire the actual path at implementation time (GraphQL document → generated Apollo hook → Pothos resolver → service → repository → Drizzle query; or server-component → service), never leaving hardcoded literals in JSX, fixtures, or stores. The only permitted exception is recognized scaffolding state (`AppSkeleton` placeholders, empty states via `AppEmptyState`, error states) — never fabricated rows.
- A prototype is an **imagination aid, not the final target**. The final implementation must be **equal or better** than the prototype: same information architecture and UX flow, but upgraded to project standards (MUI components, theme palette tokens, i18n via `shared/locale`, RTL support, accessibility, AppDataGrid/PageContainer/shared-scaffold patterns).
- **Never copy prototype HTML/CSS verbatim** — no Tailwind classes, no inline hex colors, no hardcoded strings. Translate, don't transplant.
- **Respect domain conventions over prototype shorthand** — e.g. if the prototype shows a table, implement `AppDataGrid` with the established grid patterns; if it shows a dialog, follow the existing dialog/form (RHF + Zod) patterns.
- Matches between prototype copy and i18n keys are hints for which translation namespaces/keys to create — still follow `shared/AGENTS.md` i18n rules.

### Subagent prompt integration

For every UI task, add to the per-subagent prompt:

```
Prototype reference (visual imagination aid — final must be equal or better, translated to MUI/theme/i18n conventions):
- Screenshot: .ai/plans/<feature-name>/prototype/<screen>.png (READ FIRST — inspect only this specific image; never batch-load multiple images in a single turn)
- HTML: .ai/plans/<feature-name>/prototype/<screen>.html
- State variants if present: <screen>-modal, <screen>-drawer, <screen>-mobile
ALL data in prototypes is fake placeholder content — implement real data flows only; zero hardcoded fixtures in components/stores.
Spec and design documents remain authoritative on any conflict.
```

### Review integration

- **Mid-point review + post-implementation review waves**: when reviewing UI tasks, reviewers compare the implementation against the corresponding prototype (layout/flow parity check) in addition to the spec — flag regressions where the result is worse than the prototype without a functional reason. Reviewers MUST also scan for leftover fake data: every hardcoded name, row, metric, or literal entity value in a component/store is a CRITICAL finding unless it is an approved skeleton/empty/error scaffolding state.
- **Execution Summary**: list which screens followed prototypes and note any intentional divergences (with reasons).

## Phase 0: Pre-Implementation Baseline (MANDATORY)

**Purpose:** Establish error baseline to distinguish new issues from pre-existing ones.

### Baseline Capture

Dispatch a `task` subagent to run:

```bash
# Record tsgo error count
~/.bun/bin/bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt

# Record biome warnings
~/.bun/bin/bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt

# Record lint output
~/.bun/bin/bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json

# Record modified file set baseline
git stash list > /tmp/baseline-stash.txt
git diff --name-only > /tmp/baseline-files.txt
```

### Deferred-Items Ledger

If `deferred-items.md` does not exist, create it from the template:

```bash
cp .agents/spec-process-guide/templates/deferred-items-template.md .ai/plans/<feature-name>/deferred-items.md
```

### Baseline Outcome File

Write `.ai/plans/<feature-name>/outcome/phase0-baseline-outcome.md` documenting:
- tsgo error count, biome warning count, lint status
- Any pre-existing issues to ignore during post-implementation review
- The `git diff --name-only` baseline (files already modified before implementation)

**Evidence:** Four implementations (quota, whatsapp, cron, auto-meeting-url) showed baseline confusion caused wasted debugging time. This step prevents that.

## Task Execution Protocol

### The Three Mandatory Execution Rules

Every task — without exception — follows these three rules:

1. **Pre-Execution Outcome Knowledge Read**: Before executing ANY task, read ALL existing files in `.ai/plans/<feature-name>/outcome/`. This absorbs prior research, pitfalls, and cross-file dependencies without re-doing analysis.

2. **Post-Execution Outcome File Creation**: Upon completing a task, create `.ai/plans/<feature-name>/outcome/<task-id>-outcome.md` documenting:
   - Summary of what was implemented
   - Files created/modified
   - Files NOT modified (and why)
   - Verification results (sub-loop.ts output)
   - Carry-forward knowledge for future subtasks
   - Cross-file dependencies discovered

3. **Task Progress Checkbox Tracking**: Update the task checkbox `[ ]` → `[x]` in `trackable-tasks.md` upon completing each subtask. Use `[-]` for in-progress.

### Per-Task Execution Flow

For each task in the execution queue:

```
┌─────────────────────────────────────────────────────────────┐
│  1. READ all existing outcome/ files                        │
│  2. READ the task definition from trackable-tasks          │
│  3. READ applicable AGENTS.md + instructions files          │
│  4. EXECUTE the implementation (create/modify source files) │
│  5. QUALITY LOOP (X.Y.QL via sub-loop.ts per file)          │
│  6. TEST ENGINEERING (X.Y.TE via write-tests/test-expert)   │
│  7. SECURITY AUDIT (X.Y.SEC via idor-testing/pentester)     │
│  8. SEMANTIC REVIEW (X.Y.SR agent self-review checklist)    │
│  9. INSTRUCTION VERIFICATION (X.Y.IV against rule files)    │
│ 10. WRITE outcome file (<task-id>-outcome.md)               │
│ 11. UPDATE checkboxes [ ] → [x]                             │
│ 12. CHECK deferred-items for new entries                    │
└─────────────────────────────────────────────────────────────┘
```

**This flow is mandatory even when the plan text omits it.** Plans that lack the `X.Y.QL/TE/SEC/SR/IV` subtasks (common in older plans) are executed with the pipeline injected at dispatch time: the orchestrator appends the full pipeline — including the 4-Tier test framework, journey-test verification, and security audit — to every implementation subagent's prompt. An implementation task is incomplete until its tests exist and pass, not merely until the code compiles.

### Dispatch Model

**Pool-based parallel dispatch** (proven by fix-oxlint):
- Maximum **16 concurrent** `general-purpose` subagents (24 causes rate-limiting)
- Fill-on-completion: when a subagent finishes, immediately dispatch the next queued task
- Tasks touching the same files or sharing types must be **grouped sequentially** (like quality-gate's tsgo grouping)
- Tasks touching disjoint files can run in parallel

**Grouping rules:**
1. Tasks sharing a type file (e.g., `backend/types/quota.types.ts`) → same group, sequential
2. Tasks sharing a schema file (e.g., `backend/db/schema/quota.ts`) → same group, sequential
3. Tasks in different layers with no file overlap → parallel
4. Tasks with explicit dependencies (`_Requirements: REQ-N_` pointing to prior task output) → sequential

**Per-subagent prompt must include:**
- Task ID and full task description from `trackable-tasks.md`
- Applicable AGENTS.md file paths (from the task's `Files/components` section)
- Applicable `.agents/instructions/*.md` file paths
- Requirement references for traceability
- The mandatory subtask pipeline (QL → TE → SEC → SR → IV) **in full, injected by the orchestrator** when the plan text lacks it — including the 4-Tier test requirements for any implementation task
- Outcome directory path: `.ai/plans/<feature-name>/outcome/`
- Instruction: "Read ALL existing outcome files first, then execute the task, then run quality verification, then write your outcome file, then update the checkbox"

## Per-File Quality Verification

### Unified Quality Gate

After creating/modifying ANY file, the executing subagent MUST run the **unified per-file quality verification script**:

```bash
bun run scripts/health/sub-loop.ts <the-file> --lifecycle duplicates
```

This single script replaces running `tsgo`, `biome:check`, `oxlint`, `lint:type-aware`, and `check:duplicates` individually. It runs them all in strict progressive order and short-circuits at the first failing check.

**Lifecycle stages:**

| `--lifecycle` | Checks run (strict order, short-circuit) |
|---|---|
| `tsgo` | tsgo only |
| `biome` | tsgo → oxlint → biome:check |
| `lint` | tsgo → oxlint → biome:check → lint:type-aware |
| `duplicates` | tsgo → oxlint → biome:check → lint:type-aware → check:duplicates |

**What the script handles automatically:**
- Discovers and prints ALL applicable `.agents/instructions/*.instructions.md` files
- Discovers and prints ALL applicable layer `AGENTS.md` files
- Enforces the Fix-Or-Report rule (fix within same file; report cross-file dependencies)
- Runs `check:duplicates` (at duplicates lifecycle)

**Exit codes:** `0` = all checks passed · `1` = stopped at a failing check · `2` = invalid arguments

Fix all errors and re-run until exit 0 before proceeding.

### Test File Verification

When the task involves test files, use the run-test script instead of sub-loop.ts:

```bash
bun run scripts/run-test/run-test.ts <test-path>
bun run scripts/run-test/run-test.ts --last <test-path>          # View result (AI-optimized)
bun run scripts/run-test/run-test.ts --last --focus "<pattern>" <test-path>  # Filtered
```

This is **mandatory for database tests** — raw `bun test` swallows deadlocks and transaction issues.

## Semantic Review Checklist (Agent Self-Review)

The `sub-loop.ts` script catches syntax/format/duplication/code-health issues but **structurally cannot detect** race conditions, dead code, type cascades, or cross-layer violations. Four implementations (whatsapp, quota, cron, auto-meeting-url) showed 100% of tasks reported "quality gate passed" while harboring semantic bugs requiring 5-12 post-implementation review rounds.

Before marking ANY subtask `[x]`, the executing subagent MUST verify:

### Race Conditions & Concurrency
- [ ] No read-then-write sequences without atomicity (SELECT FOR UPDATE / transaction / advisory lock)
- [ ] No module-level mutable state (Maps, Sets, arrays) without bounded size
- [ ] All async credit/balance/quota deductions use SELECT FOR UPDATE or advisory locks
- [ ] All Redis operations are atomic (use `SET NX EX`, not separate `SET NX` + `GET`)

### Environment & Configuration
- [ ] All `resolveEnvConfig("<KEY>")` calls have matching entry in `env-config-keys.ts`
- [ ] All `resetX()` / cache-invalidation functions invalidate ALL keys resolved via `resolveEnvConfig`
- [ ] No credential/secret setters accepting empty strings

### Code Quality & Clean Comments
- [ ] No dead branches (all `if` paths reachable, every `throw` reachable)
- [ ] No cross-layer imports (frontend → backend, shared → frontend/backend)
- [ ] No manual ReturnType construction (use `toReturnType` helper where applicable)
- [ ] **Clean Comments & JSDocs (CRITICAL)**:
  - ZERO references to internal plan artifacts (e.g. NEVER write `REQ-1`, `REQ-2.1`, `Task 3.2`, `Phase 4`, or cite `.ai/plans/...` / `specs.md` / `tasks.md` in code comments or JSDoc).
  - Code comments and JSDoc MUST describe the *what*, *why*, and *domain behavior* of the code in clean, production-grade technical terms without mentioning planning meta-artifacts.
  - No noisy or trivial comments repeating the obvious (e.g. `// calculate total` above `calculateTotal()`).

### Schema & Types
- [ ] Schema columns in migrations exist in Drizzle schema (and vice versa)
- [ ] All enums imported as value imports (not `import type`) when used in runtime expressions
- [ ] No string literals where enum types expected — always use enum members
- [ ] Pothos input types accept `T | null | undefined` (not just `T | undefined`)
- [ ] DB column names match `$inferSelect` names (e.g., `delta` not `amount`, `reasonNote` not `notes`)

### Deferred Work
- [ ] No deferred items without entry in `.ai/plans/<feature-name>/deferred-items.md`

### Scope Boundary
- [ ] Only files listed in the task definition were modified
- [ ] No refactoring of files outside the task scope (even if "while I'm here...")
- [ ] `git diff --name-only` matches expected file list from the task

## Instruction Verification

After `sub-loop.ts` passes, the subagent MUST read and validate the file against ALL applicable instruction files. The `sub-loop.ts` script **automatically discovers and prints** the applicable files — the subagent reads those printed paths (no manual lookup needed):

- **Layer AGENTS.md**: Printed by `sub-loop.ts` under "AGENTS.md files (read before fixing)"
- **.agents/instructions/*.md**: Printed by `sub-loop.ts` under "Instruction files (read before fixing)"

The task-to-instructions mapping:

| File Path Pattern | Instruction File |
|---|---|
| `frontend/**/*.ts(x)`, `app/**/*.ts(x)` | `frontend.instructions.md` |
| `backend/**/*.ts` | `backend.instructions.md` |
| `**/*.test.ts(x)`, `**/*.spec.ts(x)`, `scripts/run-test/**/*.ts` | `tests.instructions.md` |

| File Path Prefix | Additional AGENTS.md |
|---|---|
| `app/` | `app/AGENTS.md` |
| `shared/` | `shared/AGENTS.md` |
| `frontend/views/` | `frontend/views/AGENTS.md`, `frontend/AGENTS.md` |
| `frontend/stores/` | `frontend/stores/AGENTS.md`, `frontend/AGENTS.md` |
| `frontend/common/graphql/` | `frontend/common/graphql/AGENTS.md`, `frontend/AGENTS.md` |
| `backend/services/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` |
| `backend/graphql/` | `backend/graphql/AGENTS.md`, `backend/AGENTS.md` |
| `backend/db/repo/` | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` |
| `backend/db/seeds/` | `backend/db/seeds/AGENTS.md`, `backend/AGENTS.md` |
| `backend/types/` | `backend/types/AGENTS.md`, `backend/AGENTS.md` |
| `test/workflows/` | `test/workflows/AGENTS.md` |

## Interleaved Test Execution

Each builder/adapter/service task MUST include paired tests as subtasks. This is not advisory: whether or not the plan text spells it out, every implementation task leaves behind working tests, and the 4-Tier framework below is applied to each one (Tier depth scales with task complexity, but Tier 1 coverage and Tier 4 abuse/permission cases are never optional).

```
- [ ] 5. Implement MetaCloudApiAdapter
  - [ ] 5.1 Implement adapter interface methods
    - Core logic, error handling, retries
    - Quality Loop (sub-loop.ts --lifecycle duplicates) + Semantic Review
  - [ ] 5.2 Write paired tests via write-tests & test-expert
    - Test file: backend/services/.../test/meta-cloud-api.adapter.test.ts
    - Apply 4-Tier Test Framework (test-expert):
      • Tier 1: 100% branch and statement coverage
      • Tier 2: Boundary & edge cases (empty strings, nullability, unicode/emoji, limits)
      • Tier 3: Monkey & chaos cases (randomized fuzz payloads, concurrent replay bursts)
      • Tier 4: Security & abuse tests (payload injection, secret header leaks, forged signatures)
    - Enforce layer rules (write-tests): Mock outbound integrations, no live network calls
    - Quality Loop (sub-loop.ts --lifecycle duplicates)
  - [ ] 5.3 Run test suite via `bun run test/scripts/run-test.ts <test-path>` and verify all pass
  - [ ] 5.4 Quality loop on both implementation + test files
```

**When to interleave tests:**
- Builder/adapter tasks — always
- Service layer tasks — recommended
- Repository layer tasks — recommended (100% coverage target, `runInRollback` + `tx` propagation)
- Cross-actor journey tasks — always, and **test-first**: write `test/workflows/<domain>/<journey>.test.ts` before the service surface, then implement until the journey passes. Real services + real DB, committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`, honest role/authorization resolution, notification dispatch spied. Run via `bun run test/scripts/run-test.ts <path>` then `bun test test/workflows`. See `docs/testing/workflow-journey-tests.md` and `test/workflows/AGENTS.md`.
- Complex business logic tasks — recommended

**When to defer tests:**
- Simple utility functions — batch at phase end
- UI component tests — batch at phase end
- E2E & Penetration tests — requires complete feature (executed in Phase 5 / review wave via [.agents/skills/pentester/SKILL.md](file://../.agents/skills/pentester/SKILL.md))

**Evidence:** whatsapp Task 4 builders shipped without tests; integration issues discovered late. Interleaved tests provide immediate feedback.

## Mid-Point Review Gate (CONDITIONAL)

### When to Use
- Multi-phase plans with **>15 total tasks**
- Plans with distinct backend + frontend phases
- Features with complex service/repository layers

### When to Skip
- Single-phase plans
- Frontend-only features
- Plans with <10 tasks

### Process

After the backend phases complete and BEFORE frontend phases begin:

1. Dispatch backend-scoped review subagents in parallel:
   - `review-backend` (scope: all `backend/` files modified so far)
   - `review-types` (scope: all `backend/types/` files)
   - `review-config` (scope: env-config, drizzle.config, migration files)

2. Each review subagent:
   - Receives the list of modified files (from `git diff --name-only` vs baseline)
   - Reads the applicable instruction files and AGENTS.md
   - Reports findings as: `[SEVERITY] file:line — description`

3. Aggregate findings:
   - Deduplicate overlapping findings
   - Categorize: CRITICAL / HIGH / MEDIUM / LOW
   - **Filter out pre-existing issues** — compare against Phase 0 baseline
   - Focus on new code only

4. Dispatch fix subagents per file cluster (1 subagent per 3-5 related files):
   - Each uses `.agents/instructions/*.instructions.md` as guardrails
   - Runs `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per file
   - Reports cross-file dependencies using the standard block format

5. Re-run backend review on fixed files until zero backend-specific findings

6. Write outcome: `.ai/plans/<feature-name>/outcome/midpoint-review-R1.md`

**Evidence:** whatsapp R3 comprehensive review after 9 tasks found 23 findings (2 HIGH) that accumulated. Mid-point gate would have caught these after backend (Task 6) before frontend propagation.

## Post-Implementation Review Wave (MANDATORY for >10 tasks)

After ALL implementation tasks complete and BEFORE knowledge propagation:

### Step 1: Scope Determination

```bash
git diff --name-only  # vs Phase 0 baseline
```

This gives the exact set of files created/modified by this plan. Review is scoped to these files only.

### Step 2: Parallel Review Dispatch

Dispatch these review subagents via the `task` tool in a **single response** (parallel):

**review-types** (scope: all new/modified type files)
- Canonical type naming
- No duplicate type definitions
- Import path consistency (all `@/` aliases, no relative imports)
- Enum usage (value imports vs type imports) correct everywhere

**review-backend** (scope: all new/modified `backend/` files)
- Architecture compliance
- TOCTOU race conditions
- Dead code (unused exports, unreachable methods)
- Cross-layer imports
- Race conditions in repository methods

**review-frontend** (scope: all new/modified `frontend/`, `app/` files)
- MUI v9 compliance
- Apollo hook patterns
- Zustand store patterns
- Theme compliance
- Component patterns

**pentester & backend-security** (scope: all new/modified endpoints, resolvers, mutations, webhooks)
- Probing for BOLA / IDOR cross-tenant data leaks
- Vertical privilege escalation on admin/supervisor mutations
- GraphQL query depth/complexity and batching abuse
- Webhook signature forgery (timingSafeEqual verification)
- SQL/LIKE injection wildcard tests

### Step 3: Findings Aggregation

1. Collect findings from all subagents
2. Deduplicate overlapping findings
3. Categorize: CRITICAL / HIGH / MEDIUM / LOW
4. **Filter out pre-existing issues** — compare against Phase 0 baseline counts
5. Only NEW findings block — pre-existing issues are logged but not blocking

### Step 4: Fix Phase

1. Dispatch fix subagents per file cluster (1 subagent per 3-5 related files)
2. Each fix subagent:
   - Uses `.agents/instructions/*.instructions.md` as guardrails
   - Runs `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per file
   - Reports cross-file dependencies to orchestrator
3. Orchestrator coordinates multi-file fixes

### Step 5: Verification

- Re-run review subagents on fixed files
- Repeat until **zero feature-specific findings** remain
- Write outcome: `.ai/plans/<feature-name>/outcome/post-implementation-review.md`

**Evidence:** All four implementations required 5-12 post-implementation review rounds because this pattern was ad-hoc. Formalizing it reduces rounds to 2-3.

## Test-Layer Coverage Gate (MANDATORY before completion)

Before the Knowledge Propagation task, verify every test layer the plan mandated actually ran green — a plan that never executed a prescribed layer is NOT complete, even if all tasks are `[x]`:

| Layer | Verify | Command |
|---|---|---|
| Repository / DB logic | plan's `backend/db/test/**` tasks ran green | `bun run test:db` (or scoped `run-test.ts`) |
| Service unit | plan's `backend/services/**/*.test.ts` tasks ran green | `bun run test:services` |
| **Cross-actor journeys** | every journey from the specs' journeys section ran green | `bun test test/workflows` |
| GraphQL integration | plan's resolver/mutation test tasks ran green | `bun run test:graphql` |
| UI components | plan's component test tasks ran green | `bun run test:ui:components` |
| E2E | only if the plan mandated it | `bun run test:ui:e2e` |

If a prescribed layer has no tasks or never ran, stop and either execute it or get an explicit user decision to defer (with a `deferred-items.md` row). Do not silently skip.

## Deferred-Items Enforcement

### During Implementation
Any subagent that discovers work belonging to another task/phase, or encounters a blocking dependency, MUST:
1. Add a row to `.ai/plans/<feature-name>/deferred-items.md`
2. Use status: 🔄 In Progress or ❌ Blocked
3. Include the source task ID and target task ID

### Final Quality Gate (Before Knowledge Propagation)

Before executing the knowledge propagation task, verify all deferred items are resolved:

```bash
grep -c "❌\|⚠️" .ai/plans/<feature-name>/deferred-items.md
# Expected: 0 — otherwise plan is BLOCKED
```

If any ❌ or ⚠️ remains, the plan CANNOT be marked complete. Dispatch subagents to resolve the blocked items or escalate to the user.

## Knowledge Propagation (Final Task)

After all implementation tasks and post-implementation review are complete, execute the knowledge propagation task. This is the last task in every plan.

### Process

1. **Read ALL outcome files** in `.ai/plans/<feature-name>/outcome/`
2. **Extract recurring patterns/gotchas** — non-obvious engineering gotchas, library/runtime breaking behaviors, or architectural invariants discovered across tasks
3. **Filter for Global Battle-Tested Knowledge (CRITICAL)**:
   - **DO NOT add to AGENTS.md / instructions**: Plan-specific constraints, feature business logic, temporary migration steps, entity-specific database schemas/columns, or one-off feature instructions.
   - **DO add to AGENTS.md / instructions**: Permanent, codebase-wide architectural rules, library/tooling breaking pitfalls (Next.js 16, React 19, MUI v9, Drizzle, Apollo, Bun), concurrency/deadlock rules, or cross-cutting safety invariants that every future developer/agent must follow.
   - **DO add to `docs/<domain>/<topic>.md`**: Deep domain architecture guides, pattern catalogs, and feature references.
4. **Identify knowledge propagation targets** using the domain-to-artifacts mapping (below)
5. **Propagate learnings** to permanent project knowledge:

### What Gets Updated

| Artifact | Action |
|---|---|
| **Canonical reference doc** | Create `docs/<domain>/<topic>.md` consolidating patterns, rules, gotchas, architecture diagrams |
| **Layer AGENTS.md** | Add ONLY permanent, global, battle-tested architectural rules (1-2 lines, no code) and a one-line pointer to the doc in `Important References`. NEVER add plan-specific constraints or entity rules. |
| **Skills** | Update `.agents/skills/<skill>/SKILL.md` if new patterns affect the skill's domain |
| **Instructions** | Update `.agents/instructions/<layer>.instructions.md` if new permanent conventions should be enforced |
| **Root AGENTS.md** | Add new doc to "Important References" section |

### Domain-to-Artifacts Mapping

| Plan Domain | Docs Subdir | AGENTS.md to Update | Skills to Update | Instructions to Update |
|---|---|---|---|---|
| Drizzle / DB patterns | `docs/drizzle/` | `backend/db/repo/AGENTS.md`, `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/skills/drizzle/SKILL.md` | `backend.instructions.md` |
| DB migrations | `docs/drizzle/` | `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/skills/drizzle-migrations/SKILL.md`, `.agents/skills/drizzle-generate/SKILL.md` | `backend.instructions.md` |
| GraphQL / Pothos | `docs/graphql/` | `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `frontend/common/graphql/AGENTS.md` | — | `backend.instructions.md` |
| Backend services | `docs/services/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | — | `backend.instructions.md` |
| Backend types / enums | `docs/backend/` | `backend/types/AGENTS.md`, `backend/enum/AGENTS.md`, `backend/AGENTS.md` | — | `backend.instructions.md` |
| Frontend components / views | `docs/frontend/` | `frontend/AGENTS.md`, `frontend/views/AGENTS.md` | `.agents/skills/frontend-patterns/SKILL.md` | `frontend.instructions.md` |
| Frontend mobile/desktop | `docs/frontend/` | `frontend/mobile/AGENTS.md`, `frontend/desktop/AGENTS.md`, `frontend/views/AGENTS.md` | `.agents/skills/refactor-mobile-desktop/SKILL.md` | `mobile-desktop.instructions.md` |
| Frontend stores / state | `docs/frontend/` | `frontend/common/stores/AGENTS.md`, `frontend/AGENTS.md` | `.agents/skills/frontend-patterns/SKILL.md` | `frontend.instructions.md` |
| Frontend GraphQL / Apollo | `docs/frontend/` | `frontend/common/graphql/AGENTS.md`, `frontend/common/graphql/sharedDocuments/AGENTS.md` | — | `frontend.instructions.md` |
| Testing (DB) | `docs/testing/` | `backend/db/test/AGENTS.md`, `backend/db/test/logic/AGENTS.md` | `.agents/skills/fix-db-tests/SKILL.md` | `tests.instructions.md` |
| Testing (UI / E2E) | `docs/testing/` | `test/ui/AGENTS.md` | `.agents/skills/fix-tests/SKILL.md` | `tests.instructions.md` |
| i18n / locale | `docs/i18n/` | `shared/AGENTS.md` | — | — |
| Auth / security | `docs/auth/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `.agents/skills/security-review/SKILL.md` | `backend.instructions.md` |
| App Router / Next.js | `docs/app/` | `app/AGENTS.md` | — | `frontend.instructions.md` |
| Quality gates / CI | `docs/quality/` | `AGENTS.md` (root) | `.agents/skills/quality-gate/SKILL.md`, `.agents/skills/quality-loop/SKILL.md` | — |
| Idempotency | `docs/` (top-level) | `backend/services/AGENTS.md` | — | `backend.instructions.md` |
| Bun / runtime | `docs/bun/` | `AGENTS.md` (root) | — | — |

### Verification

```bash
bun run scripts/health/sub-loop.ts <each-modified-file> --lifecycle duplicates
```

Write outcome: `.ai/plans/<feature-name>/outcome/<task-id>-knowledge-propagation-outcome.md`

## Cross-File Dependency Protocol

When a subagent discovers that fixing an issue requires modifying ANOTHER file outside its assignment, it MUST NOT modify that file. Instead it reports:

```
CROSS-FILE DEPENDENCY:
  Target file: <this file>
  Blocked by: <other file that needs changes>
  Rule violated: <which rule from instruction file or AGENTS.md>
  Required fix: <description of what the other file needs>
```

### Orchestrator Handling

1. Collect all CROSS-FILE DEPENDENCY reports
2. Deduplicate by target file
3. Dispatch follow-up subagents for the blocked files
4. After follow-up completes, re-verify the original files

This protocol is critical for multi-file plans where type changes cascade across layers (e.g., `backend/types/` → `backend/services/` → `backend/graphql/` → `frontend/` → `codegen`).

**Evidence:** quota implementation documented "cross-file type cascade" as a key gap — type changes in Phase 1 rippled to Phase 4 and were discovered late.

## Quick-Spec Adaptation

For plans using `quick-spec-template.md` (1-3 day features, single combined document):

### What's Preserved
- Phase 0 baseline
- Per-task quality loop (sub-loop.ts)
- Semantic review checklist
- Outcome file protocol (read before, write after, checkbox update)
- Post-implementation review wave (if >10 tasks)

### What's Reduced
- No mid-point review gate (plans are typically <15 tasks)
- Knowledge propagation simplified: update only the most directly relevant AGENTS.md + create a single doc
- No plan-review gate (quick-specs skip Phase 1.5)
- Instruction verification still happens via sub-loop auto-discovery

### Execution
Parse the single combined document for task checkboxes. Execute each with the full per-task flow. No phase grouping needed — tasks are sequential.

## Micro-Spec Adaptation

For plans using `micro-spec-template.md` (<1 day changes, minimal documentation):

### What's Preserved
- Per-file quality loop (sub-loop.ts --lifecycle biome minimum, duplicates if available)
- Outcome file protocol (at least one outcome file)
- Checkbox tracking

### What's Skipped
- Phase 0 baseline (per-file verification is sufficient for small changes)
- Semantic review checklist (reduced to scope boundary check only)
- Post-implementation review wave
- Knowledge propagation (learns are captured in the outcome file)
- Mid-point review gate

### Execution
Single subagent, single file at a time. No parallel dispatch. Run sub-loop.ts per file, write one outcome file, update checkbox.

## Multi-Phase Plan Pattern

Some plans (e.g., duplications) split into multiple self-contained phase directories, each with its own requirements/design/tasks/outcome. For these:

1. Execute each phase as a **separate mini-plan**
2. Each phase re-establishes its own baseline (error counts may have changed from prior phases)
3. Each phase runs `@plan-review` at Task 0 before executing
4. Outcome files accumulate across phases — a later phase reads ALL prior phases' outcomes
5. Commit after each phase completes

## Commit Protocol

After each phase or logical task group completes:

1. **Stage only plan-related files** — never use `git add .`
2. Use the `commit-scoped` skill for automated scoped commits
3. Commit message format:
   ```
   <type>(<scope>): <description>

   Plan: .ai/plans/<feature-name>/
   Phase: <phase-name>
   Tasks: <task-ids>

   Co-authored-by: Copilot <[EMAIL_REDACTED]>
   ```

## Common Pitfalls to Avoid

1. **Skipping Phase 0 baseline**: Without baseline, you cannot distinguish new issues from pre-existing ones during post-implementation review. This caused wasted debugging in 4 implementations.

2. **Reading source files in orchestrator**: Keep context minimal. Delegate ALL file reading to subagents. The orchestrator only holds task lists, outcome summaries, and finding aggregates.

3. **Parallel dispatch of coupled tasks**: Tasks sharing types/schemas must be sequential. Parallel execution of coupled tasks causes type conflicts and race conditions.

4. **Skipping semantic review**: Quality loops (sub-loop.ts) catch mechanical issues but miss semantic bugs (race conditions, dead code, type cascades). 100% of tasks in past implementations reported "quality gate passed" while harboring semantic bugs.

5. **Not reading outcome files before execution**: Each task MUST read ALL existing outcome files first. This absorbs prior research and avoids re-doing analysis. Skipping this causes duplicate work and missed cross-file dependencies.

6. **Incomplete outcome files**: Outcome files that only list "what was done" without carry-forward knowledge, pitfalls, and cross-file dependencies are useless to future subtasks. Follow the full structure.

7. **Conflating migrate vs push**: Use `bun db push` for Drizzle schema changes. Use `bun db migrate` for custom SQL only. Document this in every plan's implementation guide.

8. **Deferring without logging**: Every deferred item MUST have a row in `deferred-items.md`. Untracked deferred items are lost work.

9. **Skipping plan-review gate**: Running `@plan-review` before implementation caught 28 issues in auto-meeting-url (requiring only 3 review rounds). Skipping it in quota/whatsapp/cron required 5-12 post-implementation rounds.

10. **Not filtering pre-existing issues in review**: Post-implementation review must compare against Phase 0 baseline. Reporting pre-existing issues as new wastes fix cycles.

11. **Ignoring the `prototype/` directory**: When prototypes exist, subagents that never open the screenshot arrive at generic layouts and lose layout/flow parity with what was already designed. Conversely, copying prototype Tailwind/hex colors verbatim violates MUI/theme conventions — translate, don't transplant.

12. **Letting prototype fake data leak into code**: Every row/name/amount in a prototype is invented. Hardcoding any of it into components, stores, or "temporary" fixtures is a critical defect — wire real data flows (GraphQL → hook → resolver → service → repository) from the start or use approved loading/empty/error scaffolding states only.

13. **Treating prototypes as spec**: The prototype visualizes the spec; it does not extend it. New fields/buttons seen only in a prototype are not requirements — check specs/`implementation.md` first.

14. **Batch-loading prototype images (`ReadMediaFile`)**: Reading all prototype screenshots (e.g. 5–11+ images) simultaneously in a single turn blows up prompt/vision payloads to 8MB+ and causes upstream inference timeouts or stream connection drops (`Error: Stream ended before producing a non-ping SSE event`). Always inspect screenshots sequentially or 1–2 at a time strictly as needed for the active subtask.

15. **Silently skipping journey tests**: When the specs define cross-actor journeys, a green unit/repo/GraphQL suite does NOT prove the actors interoperate — the `test/workflows/` journeys must be executed (test-first) and verified at the Test-Layer Coverage Gate. Treating them as optional because "the service tests pass" is how cross-actor regressions ship.

## Execution Summary Template

At the end of implementation, provide the user with:

```
## Implementation Summary

**Plan**: .ai/plans/<feature-name>/
**Spec Type**: Full / Quick / Micro
**Tasks Executed**: X/Y
**Tasks Deferred**: N (all resolved: ✅)

### Quality Verification
- tsgo: 0 new errors (baseline: N)
- biome: 0 new warnings (baseline: N)
- lint: 0 new errors (baseline: N)
- check:duplicates: 0 new warnings

### Review Waves
- Mid-point review: N rounds, M findings fixed
- Post-implementation review: N rounds, M findings fixed

### Test-Layer Coverage
- Repo/DB logic: ✅ / ❌ (command: test:db)
- Service unit: ✅ / ❌ (test:services)
- Cross-actor journeys: ✅ / ❌ / N/A (bun test test/workflows — N/A only when specs define no journeys)
- GraphQL integration: ✅ / ❌ (test:graphql)
- UI components: ✅ / ❌ (test:ui:components)
- E2E: ✅ / ❌ / N/A (only if mandated)

### Knowledge Propagation
- Doc created: docs/<domain>/<topic>.md
- AGENTS.md updated: <list>
- Skills updated: <list>
- Instructions updated: <list>

### Outcome Files
- <count> outcome files written to .ai/plans/<feature-name>/outcome/
```
