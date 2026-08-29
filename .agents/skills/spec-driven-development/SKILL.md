---
name: spec-driven-development
description: Systematic three-phase approach to feature development using Requirements, Design, and Tasks phases. Transforms vague feature ideas into well-defined, implementable solutions that reduce ambiguity, improve quality, and enable effective AI collaboration.
license: MIT
compatibility: Claude Code, Cursor, VS Code, Windsurf
metadata:
  category: methodology
  complexity: intermediate
  author: Kiro Team
  version: "1.1.0"
---

# Spec-Driven Development

A comprehensive methodology for systematic software feature development that ensures quality, maintainability, and successful delivery through structured planning.

All feature plans created using this skill live under `ai/plans/<feature-name>/` and automatically include a dedicated outcome directory: `ai/plans/<feature-name>/outcome/`.

## Outcome Knowledge Base & Execution Rules

Every feature plan enforces three mandatory execution rules across all tasks:

1. **Pre-Execution Outcome Knowledge Read:**  
   Before executing ANY task, the executing agent MUST read ALL existing files in `ai/plans/<feature-name>/outcome/`. This ensures the agent absorbs prior research, web search results, documentation lookups, pitfalls, and misunderstandings without re-doing past analysis.

2. **Post-Execution Outcome File Creation:**  
   Upon completing a task, the executing agent MUST create a new outcome document under `ai/plans/<feature-name>/outcome/<task-id>-outcome.md` detailing research findings, docs/web search results, implementation details, and carry-over points for future subtasks.

3. **Task Progress Checkbox Tracking:**  
   The executing agent MUST update the task checkbox `[ ]` -> `[x]` in `tasks.md` upon completing each subtask.

## When to Use This Skill

**Ideal scenarios:**
- Complex features with multiple components, integrations, or user interactions
- High-stakes projects where rework costs are significant
- Team collaboration requiring shared understanding
- AI-assisted development where clear structure improves output quality
- Knowledge preservation for future maintainers

**Less suitable:**
- Simple bug fixes with obvious solutions
- Experimental prototypes for rapid iteration
- Time-critical hotfixes requiring immediate action
- Well-established patterns with minimal ambiguity

## The Development Lifecycle

### Phase 0: Pre-Implementation Baseline (MANDATORY)

**Purpose:** Establish error baseline to distinguish new issues from pre-existing ones

**Process:**
1. Record current error counts before any implementation work begins
2. Create deferred-items ledger from template
3. Document baseline in outcome file

**Baseline Commands:**
```bash
# Record tsgo error count
bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt

# Record biome warnings
bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt

# Record lint output
bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
```

> **Note:** These granular per-tool counts are for baseline comparison only. For per-file quality verification during implementation, use the unified script: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0 = pass).

**Why this matters:** During implementation, distinguishing "I introduced this error" from "this was already here" is critical for focused fixing. Four implementations (quota, whatsapp, cron, auto-meeting-url) showed baseline confusion caused wasted debugging time.

---

### Phase 1: Requirements Gathering

**Purpose:** Transform vague feature ideas into clear, testable requirements

**Process:**
1. Capture user stories expressing value and purpose
2. Define acceptance criteria using EARS format (Easy Approach to Requirements Syntax)
3. Include Feature 6 (Outcome Knowledge Base & Progress Tracking) as standard criteria
4. Identify edge cases and constraints
5. Validate completeness and feasibility

**EARS Format Patterns:**
```
WHEN [event] THEN [system] SHALL [response]
IF [precondition] THEN [system] SHALL [response]
WHEN [event] AND [condition] THEN [system] SHALL [response]
```

**Example:**
```markdown
**User Story:** As a new user, I want to create an account, so that I can access personalized features.

**Acceptance Criteria:**
1. WHEN user provides valid email and password THEN system SHALL create new account
2. WHEN user provides existing email THEN system SHALL display "email already registered" error
3. WHEN user provides password shorter than 8 characters THEN system SHALL display "password too short" error
4. WHEN account creation succeeds THEN system SHALL send confirmation email
```

**Cross-Actor Workflow Scenarios (Journeys) — REQUIRED when a feature spans 2+ actors:**

When a feature involves multiple roles interacting over shared state (e.g. teacher submits → manager approves → parent is notified), requirements MUST additionally capture:

1. **Actor Table**: every actor, their role/permission group, and what each can and cannot do.
2. **Ordered Step List**: `actor → action → expected shared-state change + side effects` per step (including negative steps: which actor is DENIED the action).
3. **Cross-Actor EARS Criteria**: phrase criteria from the perspective of the actor who OBSERVES the outcome, not only the actor who acts:
   ```
   WHEN teacher submits a lesson report THEN system SHALL set status PENDING_REVIEW AND surface it in the manager's review queue
   WHEN manager approves the report THEN system SHALL create a teacher-due entry AND notify the teacher
   IF the teacher did not teach the class THEN system SHALL reject the submission
   ```

These journeys map 1:1 onto `test/workflows/` journey tests (service-level, multi-actor, real DB). See `docs/testing/workflow-journey-tests.md` for the layer conventions.

### Phase 1.5: Plan Review Gate (MANDATORY)

**Purpose:** Catch plan-to-reality mismatches BEFORE implementation begins

**Process:**
1. After `specs.md`, `implementation.md`/`design.md`, and `trackable-tasks.md` 
2. Invoke the existing `@plan-review` skill on the complete plan
3. Fix all violations reported by the skill
4. Re-run `@plan-review` until output is: "Plan passes all AGENTS.md rules"
5. Write outcome file: `ai/plans/<feature-name>/outcome/plan-review-R1.md`
6. Commit patched plan files

**What this catches:**
- Path errors (cited files don't exist or wrong paths)
- i18n namespace mismatches (string literals vs `Translation` enum)
- GraphQL document naming violations
- Component prop interface mismatches
- Permission matrix vs seed data inconsistencies
- Cross-reference gaps (ACs without tasks, components without definitions)

**Evidence:** auto-meeting-url ran plan review pre-implementation and caught 28 issues across 8 dimensions → required only 3 total review rounds. Other implementations (quota, whatsapp, cron) skipped this gate → required 5-12 post-implementation review rounds.

**Invocation:**
```markdown
# In the planning session, after tasks.md complete:
"Please review this plan using @plan-review skill"
```

---

### Phase 2: Design Documentation

**Purpose:** Create a comprehensive technical plan for implementation

**Process:**
1. Research technical approaches and constraints
2. Define system architecture and component interactions
3. Specify data models and interfaces
4. Plan error handling and testing strategies

**Design Document Structure:**
```markdown
## Overview
[High-level summary of approach. Explain how this design addresses the requirements and fits into the overall system architecture.]

### Design Goals
- [Primary goal 1]
- [Primary goal 2]
- [Primary goal 3]

### Key Design Decisions
- [Decision 1 and rationale]
- [Decision 2 and rationale]
- [Decision 3 and rationale]

### UX/Navigation Specification (REQUIRED)
Every feature plan MUST include a UX/Navigation section defining:
- **New Routes & URLs**: Complete list of new pages/routes with path, purpose, and permission
- **Sidebar/Navigation Integration**: Where items appear in navigation (group, parent, order)
- **Role-Based Access Matrix**: Which roles (superadmin, admin, parent, student, teacher, supervisor, staff, etc.) access each route
- **Per-Audience Rendering**: How pages/tabs differ for each audience (student vs parent vs teacher vs supervisor)
- **Permission Mapping**: Exact permission strings required for each route/component

### Cross-Actor Journey Design (REQUIRED when the requirements contain journeys)

For every cross-actor workflow captured in the requirements, the design MUST specify:

- **Shared-Entity State Machine**: the states and allowed transitions of the entity the actors interact over (e.g. `PENDING_REVIEW → APPROVED | REJECTED`), including which actor/permission may drive each transition.
- **Side-Effect Matrix**: per transition, the rows created/updated (ledger entries, dues, quotas), the notifications dispatched (channel + recipient actor), and any idempotency keys.
- **Cross-Actor Visibility**: what each actor can read/observe after each step (which queries/queues surface the new state to whom — and who must NOT see it).

This state machine + side-effect matrix becomes the journey test's assertion set.

### Outcome & Knowledge Transfer Protocol (`ai/plans/<feature-name>/outcome/`)
- **BEFORE Execution:** Executing agents MUST read ALL existing files in `ai/plans/<feature-name>/outcome/` to avoid re-analysis.
- **AFTER Execution:** Executing agents MUST write `ai/plans/<feature-name>/outcome/<task-id>-outcome.md` with research/doc findings and implementation details.
- **PROGRESS TRACKING:** Executing agents MUST update task checkboxes `[ ]` -> `[x]` in `tasks.md`.
```

**Decision Documentation:**
```markdown
### Decision: [Title]
**Context:** [Situation requiring decision]
**Options Considered:**
1. [Option 1] - Pros: [benefits] / Cons: [drawbacks]
2. [Option 2] - Pros: [benefits] / Cons: [drawbacks]
**Decision:** [Chosen option]
**Rationale:** [Why this was selected]
```

### Phase 2.5: Mid-Point Review Gate (CONDITIONAL)

**Purpose:** Catch backend architecture issues before they propagate to frontend

**When to use:**
- Multi-phase plans with >15 total tasks
- Plans with distinct backend + frontend phases
- Features with complex service/repository layers

**When to skip:**
- Single-phase plans
- Frontend-only features
- Plans with <10 tasks

**Process:**
1. After Phase 2 (Backend Foundation) completes, BEFORE Phase 3 (Webhook/Frontend/Integration)
2. Dispatch backend-scoped review subagents:
   - `review-backend` (scope: all `backend/` files modified in Phases 1-2)
   - `review-types` (scope: all `backend/types/` files)
   - `review-config` (scope: env-config, drizzle.config, migration files)
3. Aggregate findings (filter to backend-specific issues only)
4. Dispatch fix subagents per file using `.agents/instructions/backend.instructions.md`
5. Run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per fixed file
6. Re-run backend review until zero backend-specific findings
7. Write outcome: `ai/plans/<feature-name>/outcome/midpoint-review-R1.md`

**Evidence:** whatsapp R3 comprehensive review after 9 tasks found 23 findings (2 HIGH) that accumulated. Mid-point gate would have caught these after backend (Task 6) before frontend propagation.

---

### Phase 3: Task Planning

**Purpose:** Break design into actionable, sequential implementation steps

**Process:**
1. Convert design elements into specific coding tasks
2. Sequence tasks to enable incremental progress
3. Define clear objectives and completion criteria
4. Reference requirements for traceability

**Task Structure:**
```markdown
- [ ] 1. [Epic/Major Component]
- [ ] 1.1 [Specific implementation task]
  - [Implementation details]
  - [Files/components to create]
  - _Requirements: [Requirement references]_
```

**Task Sequencing Strategies:**
- **Foundation-First + Interleaved Tests (RECOMMENDED):** Core interfaces before dependent components, with each implementation task including its paired test as a subtask
- **Feature-Slice:** End-to-end vertical slices for early validation
- **Risk-First:** Tackle uncertain areas early
- **Hybrid:** Combine approaches based on project needs

**Standard Subtask Pipeline per Implementation Task (MANDATORY):**

Every implementation task (X.Y) in `trackable-tasks.md` must follow the 5-stage subtask pipeline:

```markdown
- [ ] X.Y [Implement Target Component / Service / Resolver]
  - [ ] X.Y.QL **Quality Loop**: Run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - [ ] X.Y.TE **Test Engineering** ([.agents/skills/write-tests/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/write-tests/SKILL.md) & [.agents/skills/test-expert/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/test-expert/SKILL.md)):
    • Tier 1: 100% branch and statement coverage
    • Tier 2: Boundary & edge cases (empty strings, nullability, unicode/RTL, numeric/date bounds)
    • Tier 3: Monkey & chaos cases (randomized fuzz payloads, concurrency races via Promise.allSettled)
    • Tier 4: Security & abuse tests (payload injection, invalid roles, error handling)
    • Layer constraints: DB tests wrapped in `runInRollback` + `tx`; Service tests mock all external adapters
    • Cross-actor journey tests (`test/workflows/`): real services + real DB, committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`; permission checks resolve honestly; run via `bun test test/workflows` — see `docs/testing/workflow-journey-tests.md` and `test/workflows/AGENTS.md`
  - [ ] X.Y.SEC **Security & Tenancy Audit** ([.agents/skills/idor-testing/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/idor-testing/SKILL.md) & [.agents/skills/pentester/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/pentester/SKILL.md)):
    • BOLA / IDOR Defense: Assert caller ownership (`ctx.user.id`), verify tenant isolation
    • BOPLA Defense: Strict DTO mapping; ensure no `{ ...input }` spread into DB updates
    • BFLA Defense: Verify low-privilege tokens cannot execute administrative functions
    • Input Sanitization: Ensure search queries escape wildcards (`%`, `_`, `\`)
  - [ ] X.Y.SR **Semantic Review**: Verify atomicity, env-config registration, zero dead code, zero cross-layer imports
  - [ ] X.Y.IV **Instruction Verification**: Read and validate against auto-discovered AGENTS.md and instruction files
```

**When to interleave:**
- Builder/adapter tasks (always)
- Service layer tasks (always)
- Repository layer tasks (always — 100% coverage via `runInRollback` + `tx` propagation)
- GraphQL resolvers & mutation tasks (always — test via `setupTestServerLifecycle` + `testClient`)
- Cross-actor workflow journeys (always — write the `test/workflows/<domain>/<journey>.test.ts` journey **first**, then implement the service surface until the journey passes)
- Complex business logic tasks (always)

**When to defer tests:**
- Simple utility functions (test in batch)
- UI component tests (can batch at phase end)
- E2E & Penetration tests (requires complete feature — executed in Phase 5 via [.agents/skills/pentester/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/pentester/SKILL.md))

**Evidence:** whatsapp "Task 4 builders shipped without @live-comm tests; Task 5 adapter shipped without integration tests" — integration issues discovered late. Interleaved tests provide immediate feedback.

## Plan Templates

The official process templates for generating feature specifications are located in `.agents/spec-process-guide/templates/`:
- [requirements-template.md](file://.agents/spec-process-guide/templates/requirements-template.md) — Phase 1: Requirements Gathering Template
- [design-template.md](file://.agents/spec-process-guide/templates/design-template.md) — Phase 2: Technical Design Template
- [tasks-template.md](file://.agents/spec-process-guide/templates/tasks-template.md) — Phase 3: Actionable Tasks Template
- [quick-spec-template.md](file://.agents/spec-process-guide/templates/quick-spec-template.md) — 1–3 Day Features Quick Spec Template
- [micro-spec-template.md](file://.agents/spec-process-guide/templates/micro-spec-template.md) — < 1 Day Changes Micro Spec Template

## Quality Checklists

### Requirements Checklist
- [ ] All user roles identified and addressed
- [ ] Normal, edge, and error cases covered
- [ ] Requirements are testable and measurable
- [ ] No conflicting requirements
- [ ] EARS format used consistently
- [ ] **Cross-actor workflow journeys captured** (actor table + ordered step list + observer-perspective EARS criteria) for every flow spanning 2+ roles

### Design Checklist
- [ ] All requirements addressed in design
- [ ] Component responsibilities well-defined
- [ ] Interfaces between components specified
- [ ] Error handling covers expected failures
- [ ] Security considerations addressed
- [ ] **UX/Navigation Specification complete** (routes, sidebar, roles, per-audience, mobile/desktop, permissions)
- [ ] **Cross-actor journey design complete** (shared-entity state transitions + per-transition side-effect matrix + cross-actor visibility) for every journey captured in requirements

### Tasks Checklist
- [ ] All design components have implementation tasks
- [ ] Tasks ordered to respect dependencies
- [ ] Each task produces testable code
- [ ] Requirements references included
- [ ] Scope is appropriate (2-4 hours each)
- [ ] **Quality loop task per file** (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`)
- [ ] **Instruction verification task per subtask** (sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions files)
- [ ] **Drizzle schema handled correctly** (push for schema, migrate for custom SQL only)
- [ ] **Journey test task per captured cross-actor workflow** (`test/workflows/<domain>/<journey>.test.ts`, written test-first)

## Integration with AI Workflows

**For Claude Code / AI Assistants:**

1. **Start with context:** Provide project background, constraints, and goals
2. **Work in phases:** Complete requirements before design, design before tasks
3. **Iterate:** Refine outputs through conversation rather than single requests
4. **Validate:** Ask AI to review outputs against checklists
5. **Trace:** Maintain links between requirements, design, and tasks

**Example prompt for starting a spec:**
```
I'm working on [project context]. We need to add [feature description].

Context:
- Technology: [stack]
- Users: [target audience]
- Constraints: [key limitations]

Please help me develop requirements using the EARS format, starting with user stories and acceptance criteria.
```

## Parallel Review Wave Pattern (Post-Implementation)

After all implementation tasks complete and BEFORE marking the plan done, dispatch specialized review subagents in parallel to catch semantic bugs that quality loops miss.

### When to Use

- **MANDATORY** for all feature plans with >10 tasks
- Run AFTER all implementation tasks complete
- Run BEFORE Phase 7 (Knowledge Propagation) task executes
- Scope to files created/modified by the plan only (`git diff --name-only` vs baseline)

### Review Wave Dispatch

Dispatch these review subagents via Task tool:

**1. review-types** (scope: all new/modified type files)
- Canonical type naming
- No duplicate type definitions
- Import path consistency (all `@/` aliases, no relative imports)
- Enum usage (value imports vs type imports) correct everywhere

**2. review-backend** (scope: all new/modified `backend/` files)
- Architecture compliance
- TOCTOU race conditions
- Dead code (unused exports, unreachable methods)
- Cross-layer imports
- Race conditions in repository methods

**3. review-frontend** (scope: all new/modified `frontend/`, `app/` files)
- MUI v9 compliance
- Apollo hook patterns
- Zustand store patterns
- Theme compliance
- Component patterns

**4. idor-testing, pentester & backend-security** (scope: all endpoints, resolvers, mutations, webhooks)
- Probing for BOLA / IDOR cross-tenant data leaks across Parent, Student, and Teacher roles
- Testing Parent-Child tenancy integrity and composite ID mismatches
- Verifying Broken Object Property-Level Authorization (BOPLA / mass assignment defense)
- Probing Broken Function-Level Authorization (BFLA) on admin/supervisor mutations
- GraphQL query depth/complexity and batching abuse probes
- Webhook signature forgery testing (constant-time `timingSafeEqual` verification)
- SQL/LIKE injection wildcard tests (`%`, `_`, `\`)

### Findings Aggregation

1. Collect findings from all subagents
2. Deduplicate overlapping findings
3. Categorize: CRITICAL / HIGH / MEDIUM / LOW
4. **Filter out pre-existing code issues** — focus on new code only

### Fix Phase

1. Dispatch fix subagents per file cluster (1 subagent per cluster of 3-5 related files)
2. Each fix subagent:
   - Uses `.agents/instructions/*.instructions.md` as guardrails (auto-discovered by `sub-loop.ts`)
   - Runs `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per file for verification
   - Reports cross-file dependencies to orchestrator (sub-loop.ts enforces the Fix-Or-Report rule)
3. Orchestrator coordinates multi-file fixes

### Verification

- Re-run review subagents on fixed files
- Repeat until **zero feature-specific findings** remain
- Write outcome: `ai/plans/<feature-name>/outcome/post-implementation-review.md`

### Evidence

All four implementations required 5-12 post-implementation review rounds because this pattern was ad-hoc. Formalizing it as Phase 8 (numbered after Phase 7 to avoid renumbering existing phases; executes before Phase 7 propagation task) reduces rounds to 2-3.

---

## Outcome Synthesis Protocol (Post-Review)

After post-implementation review is clean:

1. **Read ALL outcome files** in `ai/plans/<feature-name>/outcome/`
2. **Extract recurring patterns/gotchas** (e.g., "dialog/ vs dialogs/ directory confusion appeared 3x")
3. **Identify knowledge propagation targets** based on plan domain (see table below)
4. **Phase 7 Knowledge Propagation task** creates docs and updates AGENTS.md files with learnings

This synthesis ensures learnings don't remain siloed in outcome files but propagate to permanent project knowledge.

---

## Knowledge Propagation from Plan Outcomes (CRITICAL)

Every feature plan that modifies code across layers MUST propagate learnings from its outcome files back into the project's permanent knowledge base. This ensures that patterns, rules, and conventions discovered during implementation are captured for future agents and developers.

### The `docs/` Directory

The project's canonical technical documentation lives under `docs/`. Each domain has its own subdirectory:

```
docs/
├── drizzle/          # Drizzle ORM patterns, prepared statements, migrations
├── auth/             # Authentication, sessions, impersonation
├── bun/              # Bun runtime specifics
├── IDEMPOTENCY.md    # Idempotency patterns (top-level, single doc)
├── DATABASE_MIGRATIONS.md
└── ...               # New subdirs created as needed per plan domain
```

**Creating a new docs file:**
1. If a matching subdirectory exists, create the file inside it: `docs/<domain>/<topic>.md`
2. If no matching subdirectory exists, create one: `mkdir -p docs/<domain>/` then create the file
3. File naming: `kebab-case.md` describing the topic (e.g., `prepared-statements.md`, `dataloader-batching.md`)
4. If the topic is a single standalone concern, a top-level `docs/<TOPIC>.md` is acceptable

**Docs file structure:**
```markdown
# <Topic Title>

Brief one-paragraph summary of what this doc covers and why it exists.

## Why <Pattern>

Explain the motivation — what problem does this solve, what performance/quality benefit.

## The Pattern

Show the canonical code pattern with annotated examples. Include imports.

## Rules / Conventions

Bulleted list of mandatory rules. Use MUST/MUST NOT for clarity.

## What NOT to Do

Anti-patterns and common mistakes with explanations.

## Rollout Summary (if from a plan)

Table of files modified, methods refactored, test results.

## Related Documents

- `path/to/AGENTS.md` — description
- `path/to/other-doc.md` — description
- `ai/plans/<name>/outcome/` — plan outcome files
```

### How AGENTS.md Files Reference Docs

Layer AGENTS.md files reference docs using relative paths from the repo root:

```markdown
## Rules

- **Prepared Statements (CRITICAL)**: All simple read-only repository methods MUST use
  Drizzle Prepared Statements 2.0 (`sql.placeholder(...)`) defined at module level.
  See `docs/drizzle/prepared-statements.md` for the complete pattern reference.
```

The root `AGENTS.md` lists all docs in its Important References section:

```markdown
## Important References

- `docs/drizzle/prepared-statements.md` - Drizzle Prepared Statements 2.0 pattern reference
- `docs/IDEMPOTENCY.md` - Idempotency patterns
```

### How Skills Reference Docs

Skills (`.agents/skills/<name>/SKILL.md`) reference docs in their domain-specific sections:

```markdown
## Prepared Statements (Drizzle Prepared Statements 2.0)

When reading or editing any `backend/db/repo/**/*.repository.ts` file, follow the
prepared statements pattern documented in `docs/drizzle/prepared-statements.md`. Key rules:
- ...
```

### How Instructions Reference Docs

Instruction files (`.agents/instructions/<layer>.instructions.md`) reference docs as mandatory reading:

```markdown
## Required Reading

Before modifying any repository file, read:
- `docs/drizzle/prepared-statements.md` — Prepared statements pattern
- `backend/db/repo/AGENTS.md` — Repository layer rules
```

### What Gets Updated

After all implementation tasks are complete, the final task in every plan MUST:

1. **Create a canonical reference doc** under `docs/<domain>/` consolidating all outcome learnings from the plan
2. **Update layer AGENTS.md files** that govern the modified layers — add ONLY layer-specific architectural rules and decisions (1-2 lines, no code). Add a one-line reference to the new doc. NEVER add implementation details, code examples, or fix recipes.
3. **Update `.agents/skills/<skill>/SKILL.md`** if the plan introduced new patterns relevant to a skill's domain — add a section with key rules and a reference to the new doc
4. **Update `.agents/instructions/<layer>.instructions.md`** — add ONLY rules and decisions, never implementation details. Add a one-line reference to the new doc.
5. **Update root `AGENTS.md`** Important References section with a one-line reference to the new doc only.

### AGENTS.md & Instructions Content Policy (CRITICAL)

AGENTS.md files and `.agents/instructions/*.md` files MUST contain ONLY:
1. **Global & Layer-Specific Architectural Rules** — permanent invariants and constraints unique to that layer (e.g., "shared/ must never import from frontend/backend", "all types must live in backend/types/", "pass tx to all repository calls inside runInRollback").
2. **Library & Runtime Battle-Tested Gotchas** — non-obvious breaking changes and bug-inducing patterns with libraries (e.g. Next.js 16 breaking changes, React 19 FormEvent removal, MUI v9 style props in sx, Emotion RTL stylis plugin crash, Postgres inArray limitation with prepared statements).
3. **Decisions** — global architectural choices and their rationale (1-2 lines, no code).
4. **References** — one-line pointers to `docs/` for detailed patterns, code examples, domain guides, and fix recipes.

AGENTS.md and instructions files MUST NOT contain:
- **Plan-specific constraints & feature notes** (e.g., entity column lists, temporary migration steps, feature-specific business logic)
- Implementation details (code examples, fix recipes, step-by-step patterns)
- Duplicated content from other AGENTS.md files or instructions files
- Command references (those live in root AGENTS.md "Essential Commands" only)
- Generic workflow documentation (e.g., quality-gate lifecycle)

When propagating learnings from a plan:
- Plan details and task outcomes → `.ai/plans/<feature-name>/outcome/`
- Full patterns, code examples, domain architecture, and implementation details → `docs/<domain>/<topic>.md`
- Permanent, global architectural rules and library battle-tested gotchas → AGENTS.md / instructions (1-2 lines + doc reference in Important References)

### Knowledge Propagation Task Template

```markdown
- [ ] X. **Knowledge Propagation & Documentation**
  - Read all outcome files in `ai/plans/<feature-name>/outcome/` to synthesize all learnings
  - Create canonical reference doc under `docs/<domain>/<topic>.md` consolidating patterns, rules, and gotchas
  - Update layer AGENTS.md files with layer-specific rules/decisions (no implementation details) and a one-line doc reference
  - Update `.agents/skills/<skill>/SKILL.md` if new patterns affect the skill's domain
  - Update `.agents/instructions/<layer>.instructions.md` with rules/decisions only and a one-line doc reference
  - Update root `AGENTS.md` Important References section with a one-line reference to the new doc
  - Run global check: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per modified file (0 errors, 0 warnings)
  - Write outcome file: `ai/plans/<feature-name>/outcome/X.Y-knowledge-propagation-outcome.md`
  - Update progress: Mark task X.Y as `[x]` in `tasks.md`
```

### Complete Domain-to-Artifacts Mapping

Use this table to determine which docs subdir, AGENTS.md files, skills, and instructions to update for a given plan domain:

| Plan Domain | Docs Subdir | AGENTS.md to Update | Skills to Update | Instructions to Update |
|---|---|---|---|---|
| Drizzle / DB patterns | `docs/drizzle/` | `backend/db/repo/AGENTS.md`, `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/skills/drizzle/SKILL.md` | `.agents/instructions/backend.instructions.md` |
| DB migrations | `docs/drizzle/` | `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/skills/drizzle-migrations/SKILL.md`, `.agents/skills/drizzle-generate/SKILL.md` | `.agents/instructions/backend.instructions.md` |
| GraphQL / Pothos | `docs/graphql/` | `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `frontend/graphql/AGENTS.md` | — | `.agents/instructions/backend.instructions.md` |
| Backend services | `docs/services/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | — | `.agents/instructions/backend.instructions.md` |
| Backend types / enums | `docs/backend/` | `backend/types/AGENTS.md`, `backend/enum/AGENTS.md`, `backend/AGENTS.md` | — | `.agents/instructions/backend.instructions.md` |
| Frontend components / views | `docs/frontend/` | `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md` | `.agents/skills/frontend-patterns/SKILL.md` | `.agents/instructions/frontend.instructions.md` |
| Frontend mobile/desktop | `docs/frontend/` | `frontend/mobile/AGENTS.md`, `frontend/desktop/AGENTS.md`, `frontend/views/AGENTS.md` | `.agents/skills/refactor-mobile-desktop/SKILL.md` | `.agents/instructions/mobile-desktop.instructions.md` |
| Frontend stores / state | `docs/frontend/` | `frontend/stores/AGENTS.md`, `frontend/AGENTS.md` | `.agents/skills/frontend-patterns/SKILL.md` | `.agents/instructions/frontend.instructions.md` |
| Frontend GraphQL / Apollo | `docs/frontend/` | `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md` | — | `.agents/instructions/frontend.instructions.md` |
| Testing (DB) | `docs/testing/` | `backend/db/test/AGENTS.md`, `backend/db/test/logic/AGENTS.md` | `.agents/skills/write-tests/SKILL.md`, `.agents/skills/test-expert/SKILL.md`, `.agents/skills/fix-db-tests/SKILL.md` | `.agents/instructions/tests.instructions.md` |
| Testing (UI / E2E) | `docs/testing/` | `test/ui/AGENTS.md` | `.agents/skills/write-tests/SKILL.md`, `.agents/skills/fix-tests/SKILL.md` | `.agents/instructions/tests.instructions.md` |
| Testing (general) | `docs/testing/` | `scripts/run-test/AGENTS.md` | `.agents/skills/write-tests/SKILL.md`, `.agents/skills/test-expert/SKILL.md`, `.agents/skills/fix-tests/SKILL.md` | `.agents/instructions/tests.instructions.md` |
| i18n / locale | `docs/i18n/` | `shared/AGENTS.md` | — | — |
| Auth / security | `docs/auth/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `.agents/skills/idor-testing/SKILL.md`, `.agents/skills/pentester/SKILL.md`, `.agents/skills/backend-security-review/SKILL.md`, `.agents/skills/security-and-hardening/SKILL.md` | `.agents/instructions/backend.instructions.md` |
| App Router / Next.js | `docs/app/` | `app/AGENTS.md` | — | `.agents/instructions/frontend.instructions.md` |
| Quality gates / CI | `docs/quality/` | `AGENTS.md` (root) | `.agents/skills/quality-gate/SKILL.md`, `.agents/skills/quality-loop/SKILL.md` | — |
| Idempotency | `docs/` (top-level) | `backend/services/AGENTS.md` | — | `.agents/instructions/backend.instructions.md` |
| Bun / runtime | `docs/bun/` | `AGENTS.md` (root) | — | — |

### Example: Full Propagation for a Drizzle Plan

Given a plan that introduced prepared statements across repositories:

1. **Create doc**: `docs/drizzle/prepared-statements.md` with pattern, rules, anti-patterns, rollout summary
2. **Update `backend/db/repo/AGENTS.md`**: Add "Prepared Statements (CRITICAL)" rule referencing the doc
3. **Update `backend/AGENTS.md`**: Add prepared statements bullet to Repository Layer section
4. **Update `.agents/skills/drizzle/SKILL.md`**: Add "Prepared Statements" section with key rules and doc reference
5. **Update root `AGENTS.md`**: Add `docs/drizzle/prepared-statements.md` to Important References
6. **Quality check**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per modified file

## Standard Task Enhancement Rules (Applied to Every Feature Plan)

### 1. Navigation/Sidebar/Tabs & Permissions (Default in Every Plan)
Every feature plan MUST include:
- Complete route table with paths, purposes, permissions
- Sidebar navigation placement (group, parent, children, mobile bottom nav)
- Role-based access matrix for all user types (SUPER_ADMIN, ACADEMY_ADMIN, SUPERVISOR, TEACHER, PARENT, STUDENT, STAFF, USER, GUEST)
- Per-audience rendering specifications (what each role sees differently)

### 2. Quality Loop Per File (Default in Every Subtask — EXPANDED)

After creating/modifying ANY file, the executing agent MUST run the **unified per-file quality verification script** `scripts/health/sub-loop.ts` on the modified file. This single script replaces running `tsgo`, `biome:check`, `oxlint`, `lint:type-aware`, `check:duplicates` individually — it runs them all in strict progressive order and short-circuits at the first failing check.

**Unified Quality Gate (replaces individual tsgo/biome/lint commands):**
```bash
# Run the progressive per-file quality loop (tsgo → oxlint → biome → lint → duplicates)
bun run scripts/health/sub-loop.ts <the-file> --lifecycle duplicates
```

**Lifecycle stages** (controls how deep the loop goes — pick the deepest stage needed for the file):

| `--lifecycle` | Checks run (in strict order, short-circuit at first failure) |
|---------------|-------------------------------------------------------------|
| `tsgo` | tsgo only |
| `biome` | tsgo → oxlint → biome:check |
| `lint` | tsgo → oxlint → biome:check → lint:type-aware (via lint service) |
| `duplicates` | tsgo → oxlint → biome:check → lint:type-aware → check:duplicates |

**What the script handles automatically (no manual steps needed):**
- ✅ Discovers and prints ALL applicable `.github/instructions/*.instructions.md` files for the target file
- ✅ Discovers and prints ALL applicable layer `AGENTS.md` files for the target file
- ✅ Enforces the Fix-Or-Report rule (fix within same file; report cross-file dependencies to orchestrator)
- ✅ Runs `check:duplicates` for single-file duplication detection (duplicates lifecycle)

**Exit codes:** `0` = all checks passed · `1` = stopped at a failing check (errors printed) · `2` = invalid arguments

Fix all errors reported by the script and re-run until it exits `0` before proceeding to the next file/subtask.

**Semantic Review Checklist (Agent Self-Review):**

Before marking ANY subtask `[x]`, verify (the sub-loop script handles mechanical checks; this checklist covers semantic bugs the script cannot detect):

**Authorization & Tenancy:**
- [ ] No client-supplied ID is used without verifying caller ownership or supervisor/admin permission
- [ ] Multi-tenant WHERE clauses include explicit tenancy scoping (`eq(table.parentId/tenantId, callerId)`)
- [ ] No unbounded input spread into Drizzle update methods (BOPLA / mass assignment defense)
- [ ] DataLoaders filter batch results against caller authorized tenancy
- [ ] Low-privilege tokens (student/parent) cannot invoke supervisor/admin mutations or internal cron triggers

**Race Conditions & Concurrency:**
- [ ] No read-then-write sequences without atomicity (SELECT FOR UPDATE / transaction / advisory lock)
- [ ] No module-level mutable state (Maps, Sets, arrays) without bounded size
- [ ] All async credit/balance/quota deductions use SELECT FOR UPDATE or advisory locks
- [ ] All Redis operations are atomic (use `SET NX EX`, not separate `SET NX` + `GET`)

**Environment & Configuration:**
- [ ] All `resolveEnvConfig("<KEY>")` calls have matching entry in `env-config-keys.ts`
- [ ] All `resetX()` / cache-invalidation functions invalidate ALL keys resolved via `resolveEnvConfig`
- [ ] No credential/secret setters accepting empty strings

**Code Quality & Clean Comments:**
- [ ] No dead branches (all `if` paths reachable, every `throw` reachable)
- [ ] No cross-layer imports (frontend → backend, shared → frontend/backend)
- [ ] No manual ReturnType construction (use `toReturnType` helper where applicable)
- [ ] **Clean Comments & JSDocs (CRITICAL)**:
  - ZERO references to internal plan artifacts (e.g. NEVER write `REQ-1`, `REQ-2.1`, `Task 3.2`, `Phase 4`, or cite `.ai/plans/...` / `specs.md` / `tasks.md` in code comments or JSDoc).
  - Code comments and JSDoc MUST describe the *what*, *why*, and *domain behavior* of the code in clean, production-grade technical terms without mentioning planning meta-artifacts.
  - No noisy or trivial comments repeating the obvious (e.g. `// calculate total` above `calculateTotal()`).

**Schema & Types:**
- [ ] Schema columns in migrations exist in Drizzle schema (and vice versa)
- [ ] All enums imported as value imports (not `import type`) when used in runtime expressions
- [ ] No string literals where enum types expected — always use enum members

**Deferred Work:**
- [ ] No deferred items without entry in `ai/plans/<feature-name>/deferred-items.md`

**Why this matters:** The `sub-loop.ts` script catches syntax/format/duplication/code-health issues but structurally cannot detect race conditions, dead code, type cascades, or cross-layer violations. Four implementations (whatsapp, quota, cron, auto-meeting-url) showed 100% of tasks reported "quality gate ✅" while harboring semantic bugs requiring 5-12 post-implementation review rounds. This semantic checklist is agent self-review (no scripts) — minimal overhead, high signal.

Fix all errors reported by `sub-loop.ts` and resolve all semantic checklist findings before proceeding to next file/subtask.

### 3. Instruction Verification Per Subtask (Default in Every Subtask)
After the `sub-loop.ts` quality loop passes, the agent MUST read and validate the file against ALL applicable instruction files. **The `sub-loop.ts` script automatically discovers and prints** the applicable `.github/instructions/*.instructions.md` and layer `AGENTS.md` files for the target file — the agent reads those printed paths (no manual lookup needed):
- **Layer AGENTS.md**: Printed by `sub-loop.ts` under the "AGENTS.md files (read before fixing)" section
- **.agents/instructions/*.md**: Printed by `sub-loop.ts` under the "Instruction files (read before fixing)" section

The task-to-instructions mapping is defined in the implementation guide and must be included in every plan as a reference, but `sub-loop.ts` performs the actual discovery at runtime.

### 4. Drizzle Schema Convention
- **Schema changes** (new tables, columns, indexes): Use `bun run db push` — creates schema automatically
- **Custom SQL migrations** (seed data, complex transforms): Use `bun db migrate` — for non-Drizzle SQL only
- Document this distinction in every plan's implementation guide

### 5. Layer AGENTS.md Compliance
Every task in the plan MUST specify:
- Absolute paths to all applicable AGENTS.md files for the files being modified
- Absolute paths to all applicable `.agents/instructions/*.md` files
- These paths must be included in the task definition so subagents have them immediately

## Common Pitfalls to Avoid

1. **Skipping phases:** Each phase builds on the previous; shortcuts create problems
2. **Vague requirements:** "System should be fast" vs specific, measurable criteria
3. **Implementation details in requirements:** Focus on what, not how
4. **Over-engineering design:** Solve current requirements, not hypothetical future ones
5. **Monolithic tasks:** Break down into 2-4 hour increments
6. **Missing error cases:** Always consider what happens when things go wrong
7. **Missing UX/Navigation spec:** Every feature needs routes, sidebar, permissions, audiences defined
8. **Missing quality loop:** Every file must pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` before moving on
9. **Missing instruction verification:** Every file must be validated against layer rules (sub-loop.ts auto-discovers applicable rule files)
10. **Confusing migrate vs push:** Use push for Drizzle schema, migrate for custom SQL only
11. **Single-actor-only requirements:** A feature spanning 2+ roles without journey capture ships with no proof the actors actually interoperate — capture the actor table + ordered steps in requirements and a test-first journey in `test/workflows/`

## Next Steps

After completing a spec:
1. Begin implementation following task sequence
2. Track progress by marking tasks complete
3. Update spec if implementation reveals gaps
4. Validate completed work against requirements
5. Document learnings for future specs

---

[← Back to Templates](README.md) | [Design Template →](design-template.md)