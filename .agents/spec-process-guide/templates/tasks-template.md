# Tasks Template

<!-- Navigation Metadata -->
<!-- Template: Tasks | Level: Template | Prerequisites: design-template.md -->
<!-- Related: process/tasks-phase.md, execution/implementation-guide.md, examples/simple-feature-spec.md -->

**📍 You are here:** [Main Guide](../../README.md) → [Templates](README.md) → **Tasks Template**

## Quick Navigation
- **📚 Learn Process:** [Tasks Phase Guide](../process/tasks-phase.md) - How to use this template
- **📖 See Example:** [Simple Feature Tasks](../examples/simple-feature-spec.md#tasks-document) - Template in action
- **⚡ Execute Tasks:** [Implementation Guide](../execution/implementation-guide.md) - How to work through tasks
- **🔄 Start Over:** [Requirements Template](requirements-template.md) - Full workflow

---

Use this template to create actionable implementation plans that break down your design into manageable coding tasks.

## Document Information

- **Feature Name**: [Your Feature Name]
- **Target Directory**: `ai/plans/<feature-name>`
- **Outcome Directory**: `ai/plans/<feature-name>/outcome`
- **Version**: 1.0
- **Date**: [Current Date]
- **Author**: [Your Name]
- **Related Documents**: 
  - Requirements: [Link to requirements document]
  - Design: [Link to design document]

## Non-Negotiable Execution Protocol for All Tasks

1. **Pre-Execution Outcome Knowledge Read:**  
   Before executing ANY task, the executing agent MUST read ALL existing files in `ai/plans/<feature-name>/outcome/` to absorb prior research, search results, docs, and pitfalls so analysis is not repeated.
2. **Per-File Quality Verification Loop (Immediate post-edit):**  
   Whenever a file is modified, execute the unified per-file quality verification script BEFORE moving to another file or subtask:
   ```bash
   bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates
   ```
   This single script runs `tsgo → oxlint → biome:check → lint:type-aware → check:duplicates` in strict progressive order, short-circuiting at the first failing check. It also auto-discovers and prints the applicable `.github/instructions/*.instructions.md` and layer `AGENTS.md` files for the target file. Exit code `0` = all checks passed.
3. **Semantic Review Checklist (Pre-Completion Gate):**  
   Before marking any subtask as complete, execute agent self-review against semantic checklist (race conditions, env-config, dead code, cross-layer, enums, deferred items). The `sub-loop.ts` script handles mechanical checks but cannot detect semantic bugs — this checklist covers what the script cannot.
4. **Global Health Check (Completion Gate):**  
   Before marking any subtask as complete, re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on all modified files. All MUST exit with **code 0** (zero errors, zero warnings).
5. **Post-Execution Outcome File Creation:**  
   Upon completing the task implementation and quality checks, write a new outcome document under `ai/plans/<feature-name>/outcome/<task-id>-outcome.md` summarizing research, analysis, changes, cross-file dependencies, and carry-over knowledge.
6. **Task Progress Tracking:**  
   The executing agent MUST update the task checkbox `[ ]` -> `[x]` in this `trackable-tasks.md` file upon successful completion.

## MANDATORY Subtasks for Every Implementation Task

**EVERY implementation task (X.Y) MUST include these 5 subtasks in strict order:**

### 1. Quality Loop Subtask (X.Y.QL)
```markdown
- [ ] X.Y.QL **Quality Loop**: Per-file verification on `<file-path>`
  - Run: `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates`
  - The script runs: tsgo → oxlint → biome:check → lint:type-aware → check:duplicates
  - It auto-discovers & prints applicable AGENTS.md + .agents/instructions files
  - It enforces the Fix-Or-Report rule (fix within same file; report cross-file deps to orchestrator)
  - Exit code 0 = all checks passed; 1 = stopped at failing check (errors printed)
  - Fix all errors and re-run until exit code 0 before proceeding
```

### 2. Test Engineering Subtask (X.Y.TE) — [.agents/skills/write-tests/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/write-tests/SKILL.md) & [.agents/skills/test-expert/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/test-expert/SKILL.md)
```markdown
- [ ] X.Y.TE **Test Engineering**: Author / expand tests using 4-Tier Framework
  - **Tier 1 (Branch & Statement Coverage)**: 100% method and branch coverage for new logic/methods.
  - **Tier 2 (Boundary Value Analysis)**: Test empty strings, nullability fallbacks, unicode/RTL, numeric limits, timezone/date boundaries.
  - **Tier 3 (Monkey & Chaos Testing)**: Execute randomized fuzz payloads, concurrent execution races (`Promise.allSettled`), and out-of-order state transitions.
  - **Tier 4 (Security & Abuse Testing)**: Probe SQL/LIKE wildcards (`%`, `_`, `\`), unauthenticated rejections, and invalid role handling.
  - **Layer Rules Enforced**:
    • Database tests: Wrapped in `runInRollback` + `tx` propagation to every repository method (`expectRepoError` try/catch).
    • Service tests: Mock all external channels (WhatsApp, Resend, Twilio, Fixer, Upstash Redis).
    • GraphQL tests: Setup via `setupTestServerLifecycle()` + execute via `testClient`.
    • Journey tests (`test/workflows/`): Real services + real DB, committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`; authorization resolves honestly via real user roles; side effects (notifications) spied — see `docs/testing/workflow-journey-tests.md` and `test/workflows/AGENTS.md`.
```

### 3. Security & Tenancy Audit Subtask (X.Y.SEC) — [.agents/skills/idor-testing/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/idor-testing/SKILL.md) & [.agents/skills/pentester/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/pentester/SKILL.md)
```markdown
- [ ] X.Y.SEC **Security & Tenancy Audit**: Probe for authorization and boundary vulnerabilities
  - **BOLA / IDOR Defense**: Verify identity is derived from `ctx.user.id` / session context; confirm caller cannot read/mutate sibling tenant records.
  - **BOPLA Mass Assignment Defense**: Verify strict DTO mapping; ensure no `{ ...input }` spread into Drizzle `update()` / `set()` calls.
  - **BFLA Function Access**: Verify low-privilege tokens (e.g. students/parents/guests) cannot call admin/supervisor mutations or internal triggers.
  - **Composite Relations**: Verify child resources belong to the verified parent resource (`child.parentId === callerParentId`).
  - **Input Sanitization**: Ensure LIKE/ILIKE search queries escape wildcard characters (`escapeLikeWildcards`).
```

### 4. Semantic Review Subtask (X.Y.SR) — MANDATORY
```markdown
- [ ] X.Y.SR **Semantic Review**: Agent self-review before marking complete
  - [ ] No client-supplied ID used without caller ownership or role permission assertion (IDOR/BOLA defense)
  - [ ] Multi-tenant Drizzle queries include explicit tenancy filter (`eq(table.parentId/tenantId, callerId)`)
  - [ ] No unvalidated `...input` spreading into Drizzle update methods (BOPLA mass assignment defense)
  - [ ] DataLoaders filter batch results against caller authorized tenancy
  - [ ] No read-then-write without atomicity (SELECT FOR UPDATE / tx / advisory lock)
  - [ ] No module-level mutable state without bounds
  - [ ] All `resolveEnvConfig` calls registered in `env-config-keys.ts`
  - [ ] All `resetX()` functions invalidate all resolved keys
  - [ ] No empty-string credential acceptance
  - [ ] No dead branches (all paths reachable)
  - [ ] No cross-layer imports (frontend→backend, shared→frontend/backend)
  - [ ] Enums imported as values (not `import type`) when used at runtime
  - [ ] Schema migrations match Drizzle schema
  - [ ] All deferred items logged in `deferred-items.md`
```

### 5. Instruction Verification Subtask (X.Y.IV)
```markdown
- [ ] X.Y.IV **Instruction Verification**: Read & validate `<file-path>` against rule files
  - The `sub-loop.ts` script (run in X.Y.QL) auto-discovers & prints applicable rule files
  - Read ALL printed AGENTS.md files (e.g., `/home/ahmed/Projects/kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby/<layer>/AGENTS.md`)
  - Read ALL printed .agents/instructions files (e.g., `/home/ahmed/Projects/kottaby/.agents/instructions/<layer>.instructions.md`)
  - Validate the file against the rules in those files
```

**Sequence:** QL (Quality Loop) → TE (Test Engineering) → SEC (Security Audit) → SR (Semantic Review) → IV (Instruction Verification) → Mark `[x]`

### Layer-to-Instructions Mapping (Reference for ALL Plans)

| Layer | AGENTS.md Files (absolute paths) | .agents/instructions Files (absolute paths) |
|-------|----------------------------------|---------------------------------------------|
| Root | `/home/ahmed/Projects/kottaby/AGENTS.md` | — |
| Backend Schema | `/home/ahmed/Projects/kottaby/backend/db/schema/AGENTS.md`, `/home/ahmed/Projects/kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md` |
| Backend Repos | `/home/ahmed/Projects/kottaby/backend/db/repo/AGENTS.md`, `/home/ahmed/Projects/kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md` |
| Backend Tests | `/home/ahmed/Projects/kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby/.agents/instructions/tests.instructions.md` |
| Backend Services | `/home/ahmed/Projects/kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md` |
| Backend GraphQL | `/home/ahmed/Projects/kottaby/backend/graphql/AGENTS.md`, `/home/ahmed/Projects/kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md` |
| Backend Types | `/home/ahmed/Projects/kottaby/backend/types/AGENTS.md`, `/home/ahmed/Projects/kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md` |
| Backend Enums | `/home/ahmed/Projects/kottaby/backend/enum/AGENTS.md`, `/home/ahmed/Projects/kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md` |
| Scripts | `/home/ahmed/Projects/kottaby/scripts/run-test/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby/.agents/instructions/tests.instructions.md` |
| Shared Locale | `/home/ahmed/Projects/kottaby/shared/AGENTS.md` | (none) |
| App Router | `/home/ahmed/Projects/kottaby/app/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/frontend.instructions.md` |
| Frontend Common | `/home/ahmed/Projects/kottaby/frontend/views/AGENTS.md`, `/home/ahmed/Projects/kottaby/frontend/graphql/AGENTS.md`, `/home/ahmed/Projects/kottaby/frontend/stores/AGENTS.md`, `/home/ahmed/Projects/kottaby/frontend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/frontend.instructions.md` |
| Frontend Desktop | `/home/ahmed/Projects/kottaby/frontend/desktop/AGENTS.md`, `/home/ahmed/Projects/kottaby/frontend/views/AGENTS.md`, `/home/ahmed/Projects/kottaby/frontend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/frontend.instructions.md`, `/home/ahmed/Projects/kottaby/.agents/instructions/mobile-desktop.instructions.md` |
| Frontend Mobile | `/home/ahmed/Projects/kottaby/frontend/mobile/AGENTS.md`, `/home/ahmed/Projects/kottaby/frontend/views/AGENTS.md`, `/home/ahmed/Projects/kottaby/frontend/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/frontend.instructions.md`, `/home/ahmed/Projects/kottaby/.agents/instructions/mobile-desktop.instructions.md` |
| Test UI | `/home/ahmed/Projects/kottaby/test/ui/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/tests.instructions.md` |
| Journey/Workflow Tests | `/home/ahmed/Projects/kottaby/test/workflows/AGENTS.md` | `/home/ahmed/Projects/kottaby/.agents/instructions/tests.instructions.md` |

### Drizzle Schema Convention (Reference)
- **Schema changes** (new tables, columns, indexes): `bun run db push` — creates schema automatically
- **Custom SQL migrations** (seed data, complex transforms): `bun db migrate` — for non-Drizzle SQL only

## Implementation Overview

[Provide a brief summary of the implementation approach. Explain the overall strategy for building this feature and any key considerations for the development process.]

### Implementation Strategy
- [Key strategy point 1]
- [Key strategy point 2]
- [Key strategy point 3]

### Development Approach
- **Testing Strategy**: [TDD, BDD, or other approach]
- **Integration Strategy**: [How components will be integrated]
- **Deployment Strategy**: [How features will be deployed]

## Implementation Plan

### Task 0: Pre-Implementation Baseline (MANDATORY)

- [ ] 0. Establish error baseline and create deferred-items ledger
  - Record baseline error counts BEFORE any implementation:
    ```bash
    # Record tsgo error count
    bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt
    
    # Record biome warnings
    bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt
    
    # Record lint output
    bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
    ```
  - Create deferred-items ledger: `ai/plans/<feature-name>/deferred-items.md` (use template at `.agents/spec-process-guide/templates/deferred-items-template.md`)
  - Write outcome file: `ai/plans/<feature-name>/outcome/0-baseline-outcome.md` documenting baseline counts
  - _Requirements: REQ-0 (Pre-Implementation Baseline)_

### Phase 1: Foundation and Setup

- [ ] 1. Set up project structure and development environment
  - Read all existing files in `ai/plans/<feature-name>/outcome/`
  - Create directory structure for the feature and outcome directory `ai/plans/<feature-name>/outcome/`
  - Set up build configuration and dependencies
  - Configure development tools and linting
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Semantic Review**: Check against semantic checklist
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - Write outcome file: `ai/plans/<feature-name>/outcome/1-setup-outcome.md`
  - Update progress: Mark task 1 as `[x]` in `trackable-tasks.md`
  - _Requirements: [Reference specific requirements]_

### Phase 1.5: Plan Review Gate (MANDATORY)

- [ ] 1.5 Review complete plan using @plan-review skill
  - **Input files:** `specs.md`, `implementation.md`/`design.md`, `trackable-tasks.md`
  - **Invoke:** `@plan-review` skill on complete plan
  - **Expected output:** "Plan passes all AGENTS.md rules" OR structured violation list
  - If violations found:
    - Fix all reported violations in plan files
    - Re-run `@plan-review` 
    - Repeat until zero violations
  - Write outcome: `ai/plans/<feature-name>/outcome/plan-review-R1.md` (use template)
  - Commit patched plan files (do NOT push until implementation starts)
  - Mark complete ONLY when plan passes all checks
  - _Requirements: REQ-0 (Execution Protocol)_

### Phase 2: Core Business Logicalidate modified files against applicable AGENTS.md and .agents/instructions
  - Run global check: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per modified file (exit code 0)
  - Write outcome file: `ai/plans/<feature-name>/outcome/1.1-setup-outcome.md`
  - Update progress: Mark task 1.1 as `[x]` in `tasks.md`
  - _Requirements: [Reference specific requirements]_

- [ ] 2. Implement core data models and interfaces
  - Define TypeScript interfaces for all data models
  - Implement validation functions for data integrity
  - Create unit tests for data model validation
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 3. Set up database schema and migrations
  - Create database tables and relationships
  - Write migration scripts for schema changes
  - Set up database connection and configuration
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

### Phase 2: Core Business Logic

- [ ] 4. Implement core business logic components
- [ ] 4.1 Create [Component Name] service
  - Implement core business rules and validation
  - Add error handling and logging
  - Write comprehensive unit tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 4.2 Create [Component Name] repository
  - Implement data access layer with CRUD operations
  - Add query optimization and caching
  - Write integration tests with database
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 4.3 Implement [Business Process] workflow
  - Code the main business process flow
  - Add state management and transitions
  - Write unit tests for workflow logic
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Semantic Review**: Check against semantic checklist
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

### Phase 2.5: Mid-Point Review Gate (CONDITIONAL — Multi-Phase Plans >15 Tasks)

- [ ] 2.5 Backend architecture review checkpoint
  - **When to include:** Plans with >15 total tasks AND distinct backend+frontend phases
  - **When to skip:** Plans with <10 tasks OR single-phase plans OR frontend-only features
  - **Scope:** All `backend/` files modified in Phases 1-2 (foundation + business logic)
  - **Dispatch review subagents in parallel:**
    - `review-backend` (scope: backend services, repositories, business logic)
    - `review-types` (scope: backend/types files)
    - `review-config` (scope: env-config, drizzle.config, migration files)
  - **Aggregate findings:** Filter to backend-specific issues only (ignore frontend/integration issues for now)
  - **Fix phase:** Dispatch fix subagents per file using `.agents/instructions/backend.instructions.md` as guardrails
  - **Verify:** Run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per fixed file
  - **Re-review:** Dispatch review subagents again until zero backend-specific findings
  - Write outcome: `ai/plans/<feature-name>/outcome/midpoint-review-R1.md` (use template)
  - Mark complete ONLY when backend review is clean
  - **Evidence:** whatsapp R3 found 23 backend findings after 9 tasks — mid-point gate would have caught these after Task 6 (backend complete) before frontend propagation
  - _Requirements: REQ-0 (Execution Protocol)_

### Phase 3: API Layer

- [ ] 5. Implement REST API endpoints
- [ ] 5.1 Create [Resource] API endpoints
  - Implement GET, POST, PUT, DELETE operations
  - Add request validation and sanitization
  - Write API integration tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 5.2 Add authentication and authorization
  - Implement JWT token validation
  - Add role-based access control
  - Write security tests and validation
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 5.3 Implement error handling and logging
  - Create consistent error response format
  - Add comprehensive logging and monitoring
  - Write error handling tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

### Phase 4: User Interface

- [ ] 6. Implement user interface components
- [ ] 6.1 Create [UI Component] components
  - Build reusable UI components
  - Add responsive design and accessibility
  - Write component unit tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 6.2 Implement [Feature] user flows
  - Create complete user interaction flows
  - Add form validation and error handling
  - Write end-to-end tests for user scenarios
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 6.3 Add state management and data fetching
  - Implement client-side state management
  - Add API integration and caching
  - Write integration tests for data flow
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

### Phase 5: Integration and Testing

- [ ] 7. Implement system integration
- [ ] 7.1 Integrate with external services
  - Implement external API integrations
  - Add retry logic and error handling
  - Write integration tests with mocked services
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 7.2 Add monitoring and observability
  - Implement health checks and metrics
  - Add performance monitoring and alerting
  - Write monitoring validation tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 7.3 Implement comprehensive testing suite via [.agents/skills/test-expert/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/test-expert/SKILL.md) & [.agents/skills/write-tests/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/write-tests/SKILL.md)
  - Apply 4-Tier Testing Framework:
    - **Tier 1: 100% Branch & Core Coverage**: Exercise all conditional branches, fallbacks, and error paths.
    - **Tier 2: Boundary & Edge Cases**: Test empty/whitespace strings, max integers, boundary dates/timezones, and optimistic version races.
    - **Tier 3: Monkey & Chaos Testing**: Execute randomized fuzz payloads and concurrent balance/quota deduction races (`Promise.allSettled`).
    - **Tier 4: Security & Abuse Testing**: SQL/LIKE wildcard injection tests and unauthenticated access rejections.
  - Enforce layer rules: Database tests wrapped in `runInRollback` + `tx` propagation; Services external integrations mocked.
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 7.4 Execute penetration testing & vulnerability assessment via [.agents/skills/pentester/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/pentester/SKILL.md)
  - Probe GraphQL endpoints for query depth/circular complexity and batching abuse
  - Execute BOLA / IDOR tenant isolation tests across Parent, Student, and Teacher roles
  - Test for vertical privilege escalation on administrative mutations and cron triggers
  - Verify webhook HMAC signature verification (`crypto.timingSafeEqual`)
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

### Phase 6: Deployment and Documentation

- [ ] 8. Prepare for deployment
- [ ] 8.1 Create deployment configuration
  - Write deployment scripts and configuration
  - Set up environment-specific settings
  - Create rollback procedures
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 8.2 Create operational documentation
  - Write API documentation and examples
  - Create troubleshooting guides
  - Document configuration and maintenance procedures
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

- [ ] 8.3 Implement final validation and cleanup
  - Run complete test suite and validation
  - Perform code review and quality checks
  - Clean up temporary code and comments
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [Reference specific requirements]_

### Phase 7: Knowledge Propagation (MANDATORY Final Task)

- [ ] 9. **Final Quality Gate & Deferred Items Enforcement**
  - **Deferred Items Enforcement (BLOCKING):**
    ```bash
    # Count unresolved deferred items
    grep -c "❌\|⚠️" ai/plans/<feature-name>/deferred-items.md
    # Expected: 0
    # If >0: Task is BLOCKED — resolve all ❌/⚠️ items before proceeding
    ```
  - All deferred items MUST be resolved (status = ✅ Done) with verification references
  - Any ❌ Blocked or ⚠️ Partial items MUST be completed or have explicit target tasks created
  - Run full baseline comparison: compare current errors vs `/tmp/baseline-*.txt` — document new errors introduced
  - _Requirements: REQ-0 (Execution Protocol)_

- [ ] 10. **Knowledge Propagation & Documentation**
  - Read all outcome files in `ai/plans/<feature-name>/outcome/` to synthesize all learnings
  - Create canonical reference doc under `docs/<domain>/<topic>.md` consolidating patterns, rules, and gotchas from all outcome files
    - If a matching subdirectory exists under `docs/`, create the file inside it
    - If no matching subdirectory exists, create one: `mkdir -p docs/<domain>/`
    - File naming: `kebab-case.md` (e.g., `prepared-statements.md`, `dataloader-batching.md`)
    - Follow the docs file structure: Why → Pattern → Rules → Anti-patterns → Rollout Summary → Related Documents
  - Update layer AGENTS.md files with new rules/patterns discovered during implementation
    - Add rules inline with a reference to the new doc: `See docs/<domain>/<topic>.md for the complete pattern reference.`
  - Update `.agents/skills/<skill>/SKILL.md` if new patterns affect the skill's domain
    - Add a domain-specific section with key rules and a reference to the new doc
  - Update `.agents/instructions/<layer>.instructions.md` if new conventions should be enforced by instruction files
  - Update root `AGENTS.md` Important References section with the new doc
  - Run global check: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per modified file (exit code 0)
  - Write outcome file: `ai/plans/<feature-name>/outcome/10-knowledge-propagation-outcome.md`
  - Update progress: Mark task 10 as `[x]` in `trackable-tasks.md`
  - _Requirements: Knowledge propagation protocol_

### Domain-to-Artifacts Mapping (Reference for Knowledge Propagation)

Use this table to determine which docs subdir, AGENTS.md files, skills, and instructions to update:

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

---

## Task Planning Guidelines

### Task Structure Best Practices

#### Task Naming
- Use action verbs (Implement, Create, Add, Build)
- Be specific about what's being built
- Include the component or feature name
- Keep titles concise but descriptive

#### Task Details
- **Scope**: Clearly define what's included/excluded
- **Acceptance Criteria**: Specific, testable outcomes
- **Dependencies**: Prerequisites and blockers
- **Estimates**: Time or complexity estimates

#### Sub-task Organization
- Break large tasks into smaller, manageable pieces
- Each sub-task should be completable in 1-2 days
- Maintain logical sequence and dependencies
- Ensure each sub-task has clear deliverables
- **EVERY sub-task MUST include Quality Loop + Instruction Verification subtasks**

### Requirements Traceability

Each task should reference specific requirements:
- Use requirement numbers or identifiers
- Link to acceptance criteria being addressed
- Ensure all requirements are covered by tasks
- Validate task completion against requirements

### Testing Integration

Every implementation task should include testing:
- **Unit Tests**: For individual components and functions
- **Integration Tests**: For component interactions
- **End-to-End Tests**: For complete user scenarios
- **Performance Tests**: For non-functional requirements

---

## Task Execution Checklist

Use this checklist when executing each task:

### Before Starting
- [ ] Requirements and design documents are reviewed
- [ ] Dependencies are identified and available
- [ ] Development environment is set up
- [ ] Task scope and acceptance criteria are clear

### During Implementation
- [ ] Code follows established patterns and standards
- [ ] Unit tests are written alongside implementation
- [ ] Error handling and edge cases are considered
- [ ] Code is documented with clear comments

### Before Completion
- [ ] All acceptance criteria are met
- [ ] Tests pass and coverage is adequate
- [ ] Code review is completed
- [ ] Integration with existing code is verified
- [ ] **Quality Loop passed** (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit code 0)
- [ ] **Instruction Verification passed** (sub-loop.ts auto-discovered & printed applicable AGENTS.md + .agents/instructions; agent read & validated against them)

### Task Completion
- [ ] Feature works as specified in requirements
- [ ] No regressions in existing functionality
- [ ] Documentation is updated if needed
- [ ] Task is marked as complete in tracking system
- [ ] Outcome file written to `ai/plans/<feature-name>/outcome/`

---

## Common Task Patterns

### Data Layer Tasks
```markdown
- [ ] X. Implement [Entity] data model
  - Create TypeScript interface with validation
  - Implement database schema and migrations
  - Add CRUD operations with error handling
  - Write unit and integration tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [X.X]_
```

### Service Layer Tasks
```markdown
- [ ] X. Create [Service] business logic
  - Implement core business rules and validation
  - Add error handling and logging
  - Create service interfaces and abstractions
  - Write comprehensive unit tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [X.X]_
```

### API Layer Tasks
```markdown
- [ ] X. Implement [Resource] API endpoints
  - Create REST endpoints with proper HTTP methods
  - Add request/response validation
  - Implement authentication and authorization
  - Write API integration tests
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [X.X]_
```

### UI Layer Tasks
```markdown
- [ ] X. Build [Component] user interface
  - Create reusable UI components
  - Implement responsive design
  - Add accessibility features
  - Write component tests and user scenarios
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [X.X]_
```

### Integration Tasks
```markdown
- [ ] X. Integrate with [External System]
  - Implement API client with error handling
  - Add retry logic and circuit breakers
  - Create integration tests with mocking
  - Document integration procedures
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - _Requirements: [X.X]_
```

### Journey Test Tasks (Cross-Actor Workflows)
```markdown
- [ ] X. Write [workflow name] journey test (TEST-FIRST, before implementing the service surface)
  - Create `test/workflows/<domain>/<workflow-name>.test.ts` — one file per cross-actor workflow
  - Provision the actor cast via a per-domain cast helper in `test/workflows/helpers/` (real user roles; authorization never monkey-patched)
  - Encode each requirement step as: `actor → action → expected shared-state change + side effects`
  - Assert cross-actor visibility (who sees what after each step) and denial paths (unauthorized actor rejected)
  - Spy on the notification dispatch boundary — NEVER hit real channels
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` — NEVER wrap service calls in `runInRollback`
  - Run: `bun run test/scripts/run-test.ts test/workflows/<domain>/<workflow-name>.test.ts` until green, then `bun test test/workflows`
  - **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
  - **Instruction Verification**: sub-loop.ts auto-discovers & prints applicable AGENTS.md + .agents/instructions; read & validate against them
  - Reference: `docs/testing/workflow-journey-tests.md` + `test/workflows/AGENTS.md`
  - _Requirements: [X.X — the journey's cross-actor EARS criteria]_
```

---

## Estimation Guidelines

### Task Sizing
- **Small (1-2 days)**: Simple components, basic CRUD operations
- **Medium (3-5 days)**: Complex business logic, API integrations
- **Large (1-2 weeks)**: Major features, complex UI flows

### Complexity Factors
- **Technical Complexity**: New technologies, complex algorithms
- **Integration Complexity**: Multiple system interactions
- **Business Complexity**: Complex rules, edge cases
- **Testing Complexity**: Extensive test scenarios

### Risk Assessment
- **High Risk**: New technologies, external dependencies
- **Medium Risk**: Complex business logic, performance requirements
- **Low Risk**: Standard CRUD operations, familiar patterns

---

## Quality Gates

### Code Quality
- [ ] Code follows team standards and conventions
- [ ] No code smells or technical debt introduced
- [ ] Proper error handling and logging implemented
- [ ] Security best practices followed

### Testing Quality
- [ ] Unit test coverage meets minimum threshold
- [ ] Integration tests cover key scenarios
- [ ] End-to-end tests validate user workflows
- [ ] Performance tests meet requirements

### Documentation Quality
- [ ] Code is self-documenting with clear naming
- [ ] Complex logic is explained with comments
- [ ] API changes are documented
- [ ] README and setup instructions are updated

---

[← Design Template](design-template.md) | [Back to Templates](README.md)