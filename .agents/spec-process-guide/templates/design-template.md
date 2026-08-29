# Design Template

<!-- Navigation Metadata -->
<!-- Template: Design | Level: Template | Prerequisites: requirements-template.md -->
<!-- Related: process/design-phase.md, ai-reasoning/decision-frameworks.md, examples/complex-system-spec.md -->

**📍 You are here:** [Main Guide](../../README.md) → [Templates](README.md) → **Design Template**

## Quick Navigation
- **📚 Learn Process:** [Design Phase Guide](../process/design-phase.md) - How to use this template
- **📖 See Example:** [Complex System Design](../examples/complex-system-spec.md#design-document) - Template in action
- **🧠 Decision Help:** [Decision Frameworks](../ai-reasoning/decision-frameworks.md) - How to make design choices
- **➡️ Next Template:** [Tasks Template](tasks-template.md) - After design is done

---

Use this template to create comprehensive design documents that translate requirements into technical specifications.

## Document Information

- **Feature Name**: [Your Feature Name]
- **Target Directory**: `ai/plans/<feature-name>`
- **Outcome Directory**: `ai/plans/<feature-name>/outcome`
- **Version**: 1.0
- **Date**: [Current Date]
- **Author**: [Your Name]
- **Reviewers**: [List technical reviewers]
- **Related Documents**: [Link to requirements document]

## Overview

[Provide a high-level summary of the design approach. Explain how this design addresses the requirements and fits into the overall system architecture. Keep this section concise but comprehensive.]

### Design Goals
- [Primary goal 1]
- [Primary goal 2]
- [Primary goal 3]

### Key Design Decisions
- [Decision 1 and rationale]
- [Decision 2 and rationale]
- [Decision 3 and rationale]

### UX/Navigation Specification (REQUIRED)
Every feature design MUST include a complete UX/Navigation section:

#### New Routes & URLs
| Route | Purpose | Permission Required | Roles with Access |
|-------|---------|---------------------|-------------------|
| `/feature` | List view | `FEATURE_VIEW` | SUPER_ADMIN, ACADEMY_ADMIN, STAFF |
| `/feature/new` | Create form | `FEATURE_MANAGE` | SUPER_ADMIN, ACADEMY_ADMIN |
| `/feature/[id]` | Detail/edit | `FEATURE_VIEW` | SUPER_ADMIN, ACADEMY_ADMIN, STAFF |

#### Sidebar Navigation Integration
- **Group**: [Parent navigation group name, e.g., "Billing (grp_billing)"]
- **Parent Item**: [Parent nav item, if nested]
- **Children**: [Child items with order]
- **Mobile Bottom Nav**: [Whether item appears in bottom nav, and order]

#### Role-Based Access Matrix
| Role | Routes Accessible | Permissions Granted |
|------|-------------------|---------------------|
| SUPER_ADMIN | All routes | All permissions |
| ACADEMY_ADMIN | `/feature`, `/feature/new`, `/feature/[id]` | `FEATURE_VIEW`, `FEATURE_MANAGE` |
| SUPERVISOR | `/feature`, `/feature/[id]` | `FEATURE_VIEW` |
| TEACHER | `/feature/[id]` (read-only) | `FEATURE_VIEW` (scoped) |
| PARENT | N/A | N/A |
| STUDENT | N/A | N/A |

#### Per-Audience Rendering
| Audience | Prominent Content / Differences |
|----------|----------------------------------|
| Student | [What students see - may be empty/limited] |
| Parent | [What parents see - may be empty/limited] |
| Teacher | [What teachers see - typically read-only views] |
| Supervisor | [What supervisors see - typically read access] |
| Admin/Staff | [Full CRUD access, management controls] |

#### Permission Mapping
| Component/Route | Required Permission | Source |
|-----------------|---------------------|--------|
| FeatureList | `FEATURE_VIEW` | `requirePermissionForPage` / `<RequirePermission>` |
| FeatureCreate | `FEATURE_MANAGE` | `requirePermissionForPage` / `<RequirePermission>` |
| FeatureDetail | `FEATURE_VIEW` | `requirePermissionForPage` / `<RequirePermission>` |

### Translation System Requirements (CRITICAL)

All user-facing strings MUST use the compile-time TypeScript i18n system:

**Client Components:**
```typescript
import { useAppTranslation } from "@/shared/locale/client";
import { Translation } from "@/shared/locale";

// ✅ CORRECT — Translation enum + property access
const t = useAppTranslation(Translation.Dashboard.FeatureName);
const label = t.propertyName;

// ❌ WRONG — string literal
const t = useAppTranslation("DashboardFeatureName");

// ❌ WRONG — function call
const label = t('propertyName');
```

**Server Components:**
```typescript
import { getTranslations } from "@/shared/locale/server";

// ✅ CORRECT — single arg, property access
const t = await getTranslations(locale);
const labels = t.Dashboard.FeatureName;
const label = labels.propertyName;

// ❌ WRONG — two args
const t = await getTranslations(locale, "namespace");
```

**GraphQL Resolvers:**
```typescript
// ✅ CORRECT — ctx.t already bound to locale
const t = ctx.t("Dashboard.FeatureName");
```

**Enum Value Imports:**
```typescript
// ✅ CORRECT — value import for runtime use
import { ClassType } from "@/backend/enum/class-type.enum";
const type = formData.type as ClassType;  // Used in cast expression

// ❌ WRONG — type import for runtime use
import type { ClassType } from "@/backend/enum/class-type.enum";
const type = formData.type as ClassType;  // Fails at runtime
```

**Forbidden Patterns:**
- ❌ `useAppTranslation("stringLiteral")`
- ❌ `t('functionCall')` or `t("functionCall")`
- ❌ `getTranslations(locale, "twoArgs")`
- ❌ Hardcoded strings in UI components
- ❌ `next-intl` imports
- ❌ String literals where enum types expected

### Concurrency & Race Condition Assessment (CONDITIONAL)

**Include this section if the feature involves:**
- Shared mutable state (counters, balances, quotas)
- Multiple concurrent actors modifying the same record
- Optimistic locking / version fields
- Transaction-isolation-dependent correctness

**Concurrency Model:**
[Describe how concurrent access is handled]

**Race Condition Scenarios:**
| Scenario | Actors | Risk | Mitigation |
|----------|--------|------|------------|
| Concurrent quota deduction | 2 teachers booking same slot | Credit leak | SELECT FOR UPDATE in `deductPendingRefresh` |
| WABA account sync | External webhook + manual trigger | Stale data | Advisory lock on account ID |

**SELECT FOR UPDATE Usage:**
List all repository methods that require row-level locking:
- `deductPendingRefresh(tx, accountId)` — locks account row
- `claimNextRun(tx, scheduleId)` — locks schedule row

**TOCTOU Windows:**
Document any read-then-write sequences and their atomicity guarantees.

### Cross-Actor Journey Design (CONDITIONAL)

**Include this section for every cross-actor workflow (journey) captured in the requirements.** The state machine and side-effect matrix defined here become the assertion set of the corresponding `test/workflows/<domain>/<journey>.test.ts` journey test.

**Shared-Entity State Machine:**
| Current State | Trigger (actor + action) | Next State | Guard / Permission |
|---------------|--------------------------|------------|--------------------|
| `PENDING_REVIEW` | supervisor approves | `APPROVED` | supervisor role |
| `PENDING_REVIEW` | supervisor rejects | `REJECTED` | supervisor role |

```mermaid
stateDiagram-v2
    [*] --> PendingReview: teacher submits
    PendingReview --> Approved: supervisor approves
    PendingReview --> Rejected: supervisor rejects
```

**Side-Effect Matrix (per transition):**
| Transition | Rows Created/Updated | Notifications (channel → recipient actor) | Idempotency Key |
|------------|----------------------|-------------------------------------------|-----------------|
| submit → PENDING_REVIEW | `lesson_reports` row | review request → supervisors | `lesson-report:{classInstanceId}` |
| → APPROVED | `teacher_dues` row | approval → teacher | unique `(class_instance_id)` index |

**Cross-Actor Visibility:**
| State | Teacher sees | Supervisor sees | Parent/Student sees |
|-------|--------------|-----------------|--------------------|
| PENDING_REVIEW | own report | report in review queue | nothing |
| APPROVED | approved status + due entry | removed from queue | approved report details |

### Drizzle SQL Template Anti-Patterns (CRITICAL)

**NEVER use inline `--` comments inside `sql`` templates** — they break parameter binding.

```typescript
// ❌ WRONG — inline comment shifts parameter positions
const query = sql`
  SELECT * FROM table
  WHERE status = ${status} -- filter by status
  AND id = ${id}
`;

// ✅ CORRECT — block comment outside or no comment
const query = sql`
  SELECT * FROM table
  WHERE status = ${status}
  AND id = ${id}
`;
/* Filter by status and id */
```

**Evidence:** cron implementation had inline `--` comment in CASE expression that shifted parameter bindings, causing test failures.

### Outcome & Knowledge Transfer Protocol (`ai/plans/<feature-name>/outcome/`)
- **BEFORE Execution:** Executing agents MUST read ALL existing files in `ai/plans/<feature-name>/outcome/` to avoid re-analysis.
- **AFTER Execution:** Executing agents MUST write `ai/plans/<feature-name>/outcome/<task-id>-outcome.md` with research/doc findings, implementation details, **cross-file dependencies**, and carry-over points.
- **PROGRESS TRACKING:** Executing agents MUST update task checkboxes `[ ]` -> `[x]` in `trackable-tasks.md`.

## Architecture

### System Context
[Describe how this feature fits into the broader system. Include external dependencies and integration points.]

```mermaid
graph TB
    A[External System 1] --> B[Your Feature]
    B --> C[Internal System 1]
    B --> D[Internal System 2]
    E[External System 2] --> B
```

### High-Level Architecture
[Describe the overall architectural approach and major components.]

```mermaid
graph LR
    A[Component 1] --> B[Component 2]
    B --> C[Component 3]
    C --> D[Component 4]
```

### Technology Stack
| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | [Technology] | [Why chosen] |
| Backend | [Technology] | [Why chosen] |
| Database | [Technology] | [Why chosen] |
| Infrastructure | [Technology] | [Why chosen] |

## Components and Interfaces

### Component 1: [Component Name]

**Purpose**: [What this component does]

**Responsibilities**:
- [Responsibility 1]
- [Responsibility 2]
- [Responsibility 3]

**Interfaces**:
- **Input**: [What it receives]
- **Output**: [What it produces]
- **Dependencies**: [What it depends on]

**Implementation Notes**:
- [Key implementation detail 1]
- [Key implementation detail 2]

### Component 2: [Component Name]

**Purpose**: [What this component does]

**Responsibilities**:
- [Responsibility 1]
- [Responsibility 2]

**Interfaces**:
- **Input**: [What it receives]
- **Output**: [What it produces]
- **Dependencies**: [What it depends on]

**Implementation Notes**:
- [Key implementation detail 1]
- [Key implementation detail 2]

### Component 3: [Component Name]

**Purpose**: [What this component does]

**Responsibilities**:
- [Responsibility 1]
- [Responsibility 2]

**Interfaces**:
- **Input**: [What it receives]
- **Output**: [What it produces]
- **Dependencies**: [What it depends on]

**Implementation Notes**:
- [Key implementation detail 1]
- [Key implementation detail 2]

## Data Models

### Entity 1: [Entity Name]

```typescript
interface EntityName {
  id: string;
  property1: string;
  property2: number;
  property3: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**Validation Rules**:
- [Validation rule 1]
- [Validation rule 2]

**Relationships**:
- [Relationship to other entities]

### Entity 2: [Entity Name]

```typescript
interface EntityName {
  id: string;
  property1: string;
  property2: EntityName[];
  status: 'active' | 'inactive' | 'pending';
}
```

**Validation Rules**:
- [Validation rule 1]
- [Validation rule 2]

**Relationships**:
- [Relationship to other entities]

### Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant Database
    
    User->>Frontend: Action
    Frontend->>API: Request
    API->>Database: Query
    Database-->>API: Result
    API-->>Frontend: Response
    Frontend-->>User: Update
```

## API Design

### Endpoint 1: [Endpoint Name]

**Method**: `POST`  
**Path**: `/api/v1/[resource]`

**Request**:
```json
{
  "property1": "string",
  "property2": "number",
  "property3": "boolean"
}
```

**Response**:
```json
{
  "id": "string",
  "property1": "string",
  "property2": "number",
  "createdAt": "ISO date string"
}
```

**Error Responses**:
- `400 Bad Request`: [When this occurs]
- `401 Unauthorized`: [When this occurs]
- `404 Not Found`: [When this occurs]

### Endpoint 2: [Endpoint Name]

**Method**: `GET`  
**Path**: `/api/v1/[resource]/{id}`

**Parameters**:
- `id` (path): [Description]
- `include` (query, optional): [Description]

**Response**:
```json
{
  "id": "string",
  "property1": "string",
  "property2": "number"
}
```

## Security Considerations

### Authentication
- [Authentication method and implementation]
- [Token management approach]

### Authorization
- [Authorization model and rules]
- [Permission checking strategy]

### Data Protection
- [Data encryption approach]
- [PII handling procedures]
- [Data retention policies]

### Input Validation
- [Validation strategies]
- [Sanitization procedures]
- [Rate limiting approach]

## Error Handling

### Error Categories
| Category | HTTP Status | Description | User Action |
|----------|-------------|-------------|-------------|
| Validation | 400 | Invalid input data | Fix input and retry |
| Authentication | 401 | Invalid credentials | Re-authenticate |
| Authorization | 403 | Insufficient permissions | Contact administrator |
| Not Found | 404 | Resource doesn't exist | Check resource identifier |
| Server Error | 500 | Internal system error | Retry later or contact support |

### Error Response Format
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Specific field error"
    },
    "timestamp": "ISO date string",
    "requestId": "unique-request-id"
  }
}
```

### Logging Strategy
- **Error Logs**: [What gets logged for errors]
- **Audit Logs**: [What gets logged for auditing]
- **Performance Logs**: [What gets logged for monitoring]

## Performance Considerations

### Expected Load
- **Concurrent Users**: [Number]
- **Requests per Second**: [Number]
- **Data Volume**: [Size/Growth rate]

### Performance Requirements
- **Response Time**: [Target response times]
- **Throughput**: [Target throughput]
- **Availability**: [Uptime requirements]

### Optimization Strategies
- [Caching strategy]
- [Database optimization approach]
- [CDN usage]
- [Load balancing approach]

### Monitoring and Metrics
- [Key performance indicators]
- [Monitoring tools and dashboards]
- [Alert thresholds]

## Testing Strategy

### Unit Testing
- **Coverage Target**: [Percentage]
- **Testing Framework**: [Framework name]
- **Key Test Areas**: [Critical functionality to test]

### Integration Testing
- **API Testing**: [Approach and tools]
- **Database Testing**: [Approach and tools]
- **External Service Testing**: [Mocking strategy]

### End-to-End Testing
- **User Scenarios**: [Key user journeys to test]
- **Testing Tools**: [E2E testing framework]
- **Test Environment**: [Environment setup]

### Performance Testing
- **Load Testing**: [Approach and tools]
- **Stress Testing**: [Limits to test]
- **Monitoring**: [Performance metrics to track]

## Deployment and Operations

### Deployment Strategy
- [Deployment approach (blue-green, rolling, etc.)]
- [Environment progression]
- [Rollback procedures]

### Configuration Management
- [Configuration approach]
- [Environment-specific settings]
- [Secret management]

### Monitoring and Alerting
- [Health checks]
- [Key metrics to monitor]
- [Alert conditions and escalation]

### Maintenance Procedures
- [Regular maintenance tasks]
- [Backup and recovery procedures]
- [Update and patching strategy]

## Migration and Compatibility

### Data Migration
- [Migration strategy if applicable]
- [Data transformation requirements]
- [Rollback procedures]

### Backward Compatibility
- [API versioning strategy]
- [Breaking change procedures]
- [Deprecation timeline]

### Integration Impact
- [Impact on existing systems]
- [Required changes to dependent systems]
- [Communication plan for changes]

---

## Design Review Checklist

Use this checklist to validate your design document:

### Architecture
- [ ] High-level architecture is clearly described
- [ ] Component responsibilities are well-defined
- [ ] Interfaces between components are specified
- [ ] Technology choices are justified

### Requirements Alignment
- [ ] Design addresses all functional requirements
- [ ] Non-functional requirements are considered
- [ ] Success criteria can be met with this design
- [ ] Constraints and assumptions are addressed
- [ ] **Every cross-actor journey has a state machine + side-effect matrix + cross-actor visibility table**

### Technical Quality
- [ ] Design follows established patterns and principles
- [ ] Security considerations are addressed
- [ ] Performance requirements are considered
- [ ] Error handling is comprehensive

### Implementation Readiness
- [ ] Design provides sufficient detail for implementation
- [ ] Data models are complete and validated
- [ ] API specifications are detailed
- [ ] Testing strategy is comprehensive

### Maintainability
- [ ] Design supports future extensibility
- [ ] Components are loosely coupled
- [ ] Configuration is externalized
- [ ] Monitoring and observability are included

### UX/Navigation Completeness (MANDATORY)
- [ ] New routes table complete with permissions and roles
- [ ] Sidebar navigation placement specified (group, parent, children, order)
- [ ] Role-based access matrix for ALL user types
- [ ] Per-audience rendering differences documented
- [ ] Permission mapping for each route/component specified

---

## Design Patterns Reference

### Common Patterns to Consider

**Creational Patterns**:
- Factory: When you need to create objects without specifying exact classes
- Builder: When constructing complex objects step by step
- Singleton: When you need exactly one instance of a class

**Structural Patterns**:
- Adapter: When integrating incompatible interfaces
- Decorator: When adding behavior without altering structure
- Facade: When simplifying complex subsystem interfaces

**Behavioral Patterns**:
- Observer: When objects need to be notified of state changes
- Strategy: When you need to switch between algorithms
- Command: When you need to parameterize objects with operations

**Architectural Patterns**:
- MVC/MVP/MVVM: For separating presentation from business logic
- Repository: For abstracting data access logic
- Unit of Work: For maintaining consistency across multiple operations

---

[← Requirements Template](requirements-template.md) | [Tasks Template →](tasks-template.md)