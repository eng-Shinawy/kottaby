# Requirements Template

<!-- Navigation Metadata -->
<!-- Template: Requirements | Level: Template | Prerequisites: None -->
<!-- Related: process/requirements-phase.md, resources/standards.md, examples/simple-feature-spec.md -->

**📍 You are here:** [Main Guide](../../README.md) → [Templates](README.md) → **Requirements Template**

## Quick Navigation
- **📚 Learn Process:** [Requirements Phase Guide](../process/requirements-phase.md) - How to use this template
- **📖 See Example:** [Simple Feature Requirements](../examples/simple-feature-spec.md#requirements-document) - Template in action
- **📋 EARS Reference:** [Standards Guide](../resources/standards.md) - EARS format details
- **➡️ Next Template:** [Design Template](design-template.md) - After requirements are done

---

Use this template to create comprehensive requirements documents using the EARS (Easy Approach to Requirements Syntax) format.

## Document Information

- **Feature Name**: [Your Feature Name]
- **Target Directory**: `ai/plans/<feature-name>`
- **Outcome Directory**: `ai/plans/<feature-name>/outcome`
- **Version**: 1.0
- **Date**: [Current Date]
- **Author**: [Your Name]
- **Stakeholders**: [List key stakeholders]

## Introduction

[Provide a clear, concise overview of the feature. Explain what problem it solves and why it's needed. Keep this section to 2-3 paragraphs maximum.]

### Feature Summary
[One sentence summary of what this feature does]

### Business Value
[Explain the business value and expected outcomes]

### Scope
[Define what is included and excluded from this feature]

## Requirements

### Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an AI agent or developer, I want to establish an error baseline before implementation and track outcomes persistently, so that I can distinguish new issues from pre-existing ones and avoid repeating past research.

#### Acceptance Criteria

1. WHEN feature implementation begins THEN system SHALL record baseline error counts (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit code, plus `bun tsgo` / `bun biome:check` / `bun run scripts/lint-service.ts --json --id baseline` for granular per-tool counts) to distinguish new from pre-existing issues.
2. WHEN feature implementation begins THEN system SHALL create deferred-items ledger at `ai/plans/<feature-name>/deferred-items.md` from template to track all deferred work.
3. WHEN an executing agent starts any task THEN system SHALL read ALL existing outcome files in `ai/plans/<feature-name>/outcome/` to absorb prior research, search results, and pitfalls.
4. WHEN an executing agent completes any task THEN system SHALL write a new outcome document under `ai/plans/<feature-name>/outcome/<task-id>-outcome.md` detailing research findings, docs/web search results, implementation details, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN system SHALL update the corresponding task checkbox `[ ]` -> `[x]` in `trackable-tasks.md`.
6. WHEN any file is modified THEN system SHALL execute per-file verification via the unified script `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (runs tsgo → oxlint → biome → lint:type-aware → check:duplicates --file; auto-discovers applicable AGENTS.md + .agents/instructions; exit code 0 = pass) on that specific file.
7. WHEN any subtask is marked complete THEN system SHALL complete semantic review checklist (race conditions, env-config, deferred items, cross-layer, enums) before marking `[x]`. The `sub-loop.ts` script handles mechanical checks but cannot detect semantic bugs — this checklist covers what the script cannot.

### Requirement 0.5: Translation System & Enum Import Compliance

**User Story:** As a developer implementing user-facing features, I want compile-time type-safe translations and correct enum imports, so that I catch i18n and type errors at build time instead of runtime.

#### Acceptance Criteria (Translation System)

1. WHEN client component renders user-facing text THEN system SHALL use `useAppTranslation(Translation.<Namespace>)` with Translation enum (not string literal).
2. WHEN translation object is accessed THEN system SHALL use property access (`t.propertyName`) NOT function calls (`t('propertyName')`).
3. WHEN server component renders user-facing text THEN system SHALL use `await getTranslations(locale)` (single arg) and access namespace as property: `t.Dashboard.FeatureName`.
4. WHEN GraphQL resolver returns user-facing text THEN system SHALL use `ctx.t("namespace")` with string key (already bound to `ctx.locale`).
5. WHEN namespace directory is created THEN system SHALL use lowercase casing (`shared/locale/namespaces/ui/featureName.namespace.ts` NOT `Ui/FeatureName/`).

#### Translation System Anti-Patterns (FORBIDDEN)

- ❌ `useAppTranslation("DashboardFeature")` — string literal
- ❌ `getTranslations(locale, "namespace")` — two args
- ❌ `t('propertyName')` — function call
- ❌ Hardcoded strings in UI components
- ❌ `next-intl` imports (legacy, removed)
- ❌ `getBackendTranslations` (legacy, removed)
- ❌ `shared/messages/` references (directory removed)

#### Acceptance Criteria (Enum Imports)

6. WHEN enum is used in runtime expression THEN system SHALL import as value (not `import type`).
7. WHEN enum is used in conditional/cast/object literal THEN system SHALL import as value.
8. WHEN enum consumer exists THEN system SHALL use enum members NOT string literals.

### Requirement 1: [Requirement Title]

**User Story:** As a [role/user type], I want [desired functionality], so that [benefit/value].

#### Acceptance Criteria

1. WHEN [specific event or trigger] THEN [system name] SHALL [specific system response]
2. IF [condition or state] THEN [system name] SHALL [required behavior]
3. WHILE [ongoing condition] [system name] SHALL [continuous behavior]
4. WHERE [context or location] [system name] SHALL [contextual behavior]

#### Additional Details
- **Priority**: [High/Medium/Low]
- **Complexity**: [High/Medium/Low]
- **Dependencies**: [List any dependencies on other requirements or systems]
- **Assumptions**: [List any assumptions made]

### Requirement 2: [Requirement Title]

**User Story:** As a [role/user type], I want [desired functionality], so that [benefit/value].

#### Acceptance Criteria

1. WHEN [specific event or trigger] THEN [system name] SHALL [specific system response]
2. IF [condition or state] THEN [system name] SHALL [required behavior]

#### Additional Details
- **Priority**: [High/Medium/Low]
- **Complexity**: [High/Medium/Low]
- **Dependencies**: [List any dependencies]
- **Assumptions**: [List any assumptions]

### Requirement 3: [Requirement Title]

**User Story:** As a [role/user type], I want [desired functionality], so that [benefit/value].

#### Acceptance Criteria

1. WHEN [specific event or trigger] THEN [system name] SHALL [specific system response]
2. IF [condition or state] THEN [system name] SHALL [required behavior]

#### Additional Details
- **Priority**: [High/Medium/Low]
- **Complexity**: [High/Medium/Low]
- **Dependencies**: [List any dependencies]
- **Assumptions**: [List any assumptions]

## UX/Navigation Requirements (MANDATORY)

Every feature MUST define its navigation, sidebar, tabs, and permissions for ALL user types.

### New Routes & Role-Based Access

| Route | Purpose | Permission | Roles with Access |
|-------|---------|------------|-------------------|
| `/feature` | List view | `FEATURE_VIEW` | SUPER_ADMIN, ACADEMY_ADMIN, STAFF |
| `/feature/new` | Create form | `FEATURE_MANAGE` | SUPER_ADMIN, ACADEMY_ADMIN |
| `/feature/[id]` | Detail view | `FEATURE_VIEW` | SUPER_ADMIN, ACADEMY_ADMIN, STAFF |

### Sidebar Navigation Placement
Feature pages appear as **sub-items under [Parent Group]** in the **[Group Name] (grp_xxx)** group.

## Cross-Actor Workflow Scenarios (Journeys)

**Include this section whenever the feature spans 2+ actors interacting over shared state** (e.g. teacher submits → supervisor approves → parent notified, or any chat-like/approval-like exchange). Each journey maps 1:1 onto a `test/workflows/<domain>/<journey>.test.ts` test.

### Actor Table
| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Teacher | `teacher` | submit lesson report | approve reports, submit for others' classes |
| Supervisor | `supervisor` | approve/reject reports | submit reports |

### Ordered Step List
Per journey, an ordered `actor → action → expected shared-state change + side effects` list:
1. Teacher → submits report for completed class → report created, status `PENDING_REVIEW`
2. Supervisor → views pending review queue → sees the report
3. Supervisor → approves → status `APPROVED` + teacher-due entry created + teacher notified

### Cross-Actor EARS Criteria
Phrase acceptance criteria from the perspective of the actor who OBSERVES the outcome, and always include the denial cases:
- WHEN [actor A] [action] THEN system SHALL [shared-state change] AND [side effect observed by actor B]
- WHEN [actor B] [responds] THEN system SHALL [transition] AND notify [actor A]
- IF [unauthorized actor] attempts [action] THEN system SHALL reject it

See `docs/testing/workflow-journey-tests.md` for how these map onto the journey test layer.

## Non-Functional Requirements

### Performance Requirements
- WHEN [load condition] THEN [system name] SHALL [performance criteria]
- IF [usage scenario] THEN [system name] SHALL [response time requirement]

### Security Requirements
- WHEN [security event] THEN [system name] SHALL [security response]
- IF [authentication condition] THEN [system name] SHALL [access control behavior]

### Usability Requirements
- WHEN [user interaction] THEN [system name] SHALL [usability standard]
- IF [accessibility condition] THEN [system name] SHALL [accessibility compliance]

### Reliability Requirements
- WHEN [failure condition] THEN [system name] SHALL [recovery behavior]
- IF [error state] THEN [system name] SHALL [error handling response]

## Constraints and Assumptions

### Technical Constraints
- [List technical limitations or constraints]
- [Include platform, technology, or integration constraints]

### Business Constraints
- [List business rules or policy constraints]
- [Include budget, timeline, or resource constraints]

### Assumptions
- [List assumptions about user behavior]
- [Include assumptions about system environment]
- [Note assumptions about external dependencies]

## Success Criteria

### Definition of Done
- [ ] All acceptance criteria are met
- [ ] Non-functional requirements are satisfied
- [ ] Integration requirements are fulfilled
- [ ] Testing criteria are passed

### Acceptance Metrics
- [Define measurable success criteria]
- [Include performance benchmarks]
- [Specify quality gates]

## Glossary

| Term | Definition |
|------|------------|
| [Term 1] | [Clear definition] |
| [Term 2] | [Clear definition] |
| [Term 3] | [Clear definition] |

---

## Requirements Review Checklist

Use this checklist to validate your requirements document:

### Completeness
- [ ] All user stories have clear roles, features, and benefits
- [ ] Each requirement has specific acceptance criteria using EARS format
- [ ] Non-functional requirements are addressed
- [ ] Success criteria are defined and measurable
- [ ] **Navigation/sidebar/tabs defined for all user types**
- [ ] **Permissions mapped to all new routes/pages**
- [ ] **Cross-actor workflow journeys captured** (actor table + ordered steps + observer-perspective EARS criteria) for every flow spanning 2+ roles

### Quality
- [ ] Requirements are written in active voice
- [ ] Each acceptance criterion is testable
- [ ] Requirements avoid implementation details
- [ ] Terminology is consistent throughout

### EARS Format Validation
- [ ] WHEN statements describe specific events or triggers
- [ ] IF statements describe clear conditions or states
- [ ] WHILE statements describe continuous behaviors
- [ ] WHERE statements describe specific contexts
- [ ] All statements use SHALL for system responses

### Clarity
- [ ] Requirements are unambiguous
- [ ] Technical jargon is explained in glossary
- [ ] Stakeholders can understand all requirements
- [ ] No conflicting requirements exist

### Traceability
- [ ] Requirements are numbered and organized
- [ ] Dependencies between requirements are clear
- [ ] Requirements link to business objectives
- [ ] Assumptions and constraints are documented

---

## Tips for Writing Good Requirements

### Do's
- ✅ Use active voice and specific language
- ✅ Focus on what the system should do, not how
- ✅ Make each requirement testable and verifiable
- ✅ Include both positive and negative scenarios
- ✅ Consider edge cases and error conditions

### Don'ts
- ❌ Don't use vague terms like "user-friendly" or "fast"
- ❌ Don't combine multiple requirements in one statement
- ❌ Don't specify implementation details
- ❌ Don't use subjective or unmeasurable criteria
- ❌ Don't forget to consider non-functional aspects

### Common EARS Patterns

**Event-Driven (WHEN)**
- User actions: "WHEN user clicks submit button"
- System events: "WHEN data sync completes"
- Time-based: "WHEN daily backup runs"

**Condition-Based (IF)**
- State checks: "IF user is authenticated"
- Data validation: "IF input is invalid"
- Permission checks: "IF user has admin role"

**Continuous (WHILE)**
- Ongoing processes: "WHILE file is uploading"
- Monitoring: "WHILE system is running"
- Real-time updates: "WHILE user is typing"

**Contextual (WHERE)**
- Platform-specific: "WHERE application runs on mobile"
- Environment-specific: "WHERE system is in production"
- Location-specific: "WHERE user is in restricted area"

---

[← Back to Templates](README.md) | [Design Template →](design-template.md)