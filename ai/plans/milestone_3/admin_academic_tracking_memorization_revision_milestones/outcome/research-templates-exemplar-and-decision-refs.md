# Research: Spec-plan templates, exemplar plan, and decision refs for Admin Academic Tracking

Scope: reproduce the required template skeletons, distill the finished parent-portal exemplar plan's conventions, summarize the canonical read-only-portal doc, and quote the authoritative B.11 / FR-6.3 decision-ref sources, so authoring agents (specs/plan/tasks) can follow them exactly. No project source files were modified.

## (a) Template section skeletons (.agents/spec-process-guide/templates/)

All six templates were read this session. "REQUIRED" markers below come from the templates' own headings.

### requirements-template.md (307 lines, `.agents/spec-process-guide/templates/requirements-template.md`)

Section skeleton in order (heading : line):
- `## Document Information` :19 — placeholders: Feature Name, Target Directory `ai/plans/<feature-name>`, Outcome Directory `ai/plans/<feature-name>/outcome`, Version, Date, Author, Stakeholders
- `## Introduction` :29 → `### Feature Summary` :33, `### Business Value` :36, `### Scope` :39
- `## Requirements` :42 containing:
  - `### Requirement 0: Pre-Implementation Baseline & Execution Protocol` :44 (+ `#### Acceptance Criteria` :48) — 7 mandatory WHEN/THEN baseline ACs incl. deferred-items ledger creation, outcome-dir reads, per-task outcome files, `sub-loop.ts` per-file verification, checkbox updates, semantic review before `[x]`
  - `### Requirement 0.5: Translation System & Enum Import Compliance` :58 → `#### Acceptance Criteria (Translation System)` :62, `#### Translation System Anti-Patterns (FORBIDDEN)` :70, `#### Acceptance Criteria (Enum Imports)` :80
  - `### Requirement 1/2/3: [Requirement Title]` :86/:103/:118, each with `#### Acceptance Criteria` + `#### Additional Details`
- `## UX/Navigation Requirements (MANDATORY)` :133 → `### New Routes & Role-Based Access` :137 (route table), `### Sidebar Navigation Placement` :145
- `## Cross-Actor Workflow Scenarios (Journeys)` :148 → `### Actor Table` :152, `### Ordered Step List` :158, `### Cross-Actor EARS Criteria` :164
- `## Non-Functional Requirements` :172 → Performance :174, Security :178, Usability :182, Reliability :186
- `## Constraints and Assumptions` :190 → Technical :192, Business :196, Assumptions :200
- `## Success Criteria` :205 → Definition of Done :207, Acceptance Metrics :213
- `## Glossary` :218, `## Requirements Review Checklist` :228 (Completeness/Quality/EARS Format Validation/Clarity/Traceability), `## Tips` :268 incl. `### Common EARS Patterns` :284

### design-template.md (623 lines, `.agents/spec-process-guide/templates/design-template.md`)

Top-level order: `## Document Information` :19 → `## Overview` :30 (`### Design Goals` :34, `### Key Design Decisions` :39) → `### UX/Navigation Specification (REQUIRED)` :44 (`#### New Routes & URLs` :47 route table with Route/Purpose/Permission Required/Roles with Access, `#### Sidebar Navigation Integration` :54, `#### Role-Based Access Matrix` :60, `#### Per-Audience Rendering` :70, `#### Permission Mapping` :79) → `### Translation System Requirements (CRITICAL)` :86 → `### Concurrency & Race Condition Assessment (CONDITIONAL)` :144 → `### Cross-Actor Journey Design (CONDITIONAL)` :169 → `### Drizzle SQL Template Anti-Patterns (CRITICAL)` :198 → `### Outcome & Knowledge Transfer Protocol` :221 → `## Architecture` :226 (System Context :228, High-Level Architecture :239, Technology Stack :249) → `## Components and Interfaces` :257 (Component 1/2/3 :259/:277/:294) → `## Data Models` :311 (Entity 1/2 :313/:333, `### Data Flow` :351) → `## API Design` :368 (Endpoint 1/2 :370/:399) → `## Security Considerations` :417 (Authentication :419, Authorization :423, Data Protection :427, Input Validation :432) → `## Error Handling` :437 → `## Performance Considerations` :468 → `## Testing Strategy` :491 (Unit :493, Integration :498, `### Workflow Journey Testing` :503, Performance :508) → `## Deployment and Operations` :513 → `## Migration and Compatibility` :535 → `## Design Review Checklist` :554 (Architecture :558, Requirements Alignment :564, Technical Quality :571, Implementation Readiness :577, Maintainability :583, UX/Navigation Completeness :589).

### tasks-template.md (638 lines, `.agents/spec-process-guide/templates/tasks-template.md`)

Top-level order: `## Document Information` :19 → `## Non-Negotiable Execution Protocol for All Tasks` :31 (6 numbered protocol items) → `## MANDATORY Subtasks for Every Implementation Task` :50 → `### 1. Quality Loop Subtask (X.Y.QL)` :54 → `### 2. Test Engineering Subtask (X.Y.TE)` :65 → `### 3. Security & Tenancy Audit Subtask (X.Y.SEC)` :79 → `### 4. Semantic Review Subtask (X.Y.SR)` :89 → `### 5. Instruction Verification Subtask (X.Y.IV)` :108 → `**Sequence:** QL → TE → SEC → SR → IV → Mark [x]` :117 → `### Layer-to-Instructions Mapping` :119 → `### Drizzle Schema Convention` :137 → `## Implementation Overview` :141 → `## Implementation Plan` :155 with the phase skeleton:

| Phase | Heading | Line |
|---|---|---|
| 0 | `### Task 0: Pre-Implementation Baseline (MANDATORY)` | :157 |
| 1 | `### Phase 1: Foundation and Setup` | :175 |
| 1.5 | `### Phase 1.5: Plan Review Gate (MANDATORY)` — `@plan-review` skill, repeat until zero violations, write `outcome/plan-review-R1.md` | :189 |
| 2 | `### Phase 2: Core Business Logic` (template has a corrupted duplicated heading at :204) | :226 |
| 2.5 | `### Phase 2.5: Mid-Point Review Gate (CONDITIONAL — Multi-Phase Plans >15 Tasks)` | :254 |
| 3 | `### Phase 3: API Layer` | :273 |
| 4 | `### Phase 4: User Interface` | :300 |
| 5 | `### Phase 5: Integration and Testing` (incl. 4-Tier framework at :347-351, penetration testing :357) | :327 |
| 6 | `### Phase 6: Deployment and Documentation` | :366 |
| 7 | `### Phase 7: Knowledge Propagation (MANDATORY Final Task)` | :393 |

→ `### Domain-to-Docs Mapping` :421 → `## Task Planning Guidelines` :444 (incl. `### Requirements Traceability` :467) → `## Task Execution Checklist` :485 → `## Common Task Patterns` :518 (Data/Service/API/UI/Integration + `### Journey Test Tasks (Cross-Actor Workflows)` :580) → `## Estimation Guidelines` :597 → `## Quality Gates` :617.

### deferred-items-template.md (154 lines, `.agents/spec-process-guide/templates/deferred-items-template.md`)

Skeleton: `## Purpose` :9 → `## Ledger Table` :15 → `## Status Values` :25 → `## Usage Guidelines` :34 (When to Add :36, When to Update Status :49, When to Reference in Outcome Files :58) → `## Enforcement` :66 → `## Common Deferred Item Patterns` :82 → `## Anti-Patterns` :111 → `## Example: Complete Lifecycle` :121 → `## Related Documents` :150.

**Exact ledger format** (`deferred-items-template.md:17-19`):

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Example: `createManyDeliveries` bulk write | 6 | 13 | ✅ Done | R5 outcome | Implemented in Task 13.2 |

Status values (`:27-31`): ✅ Done (with verification reference — outcome file / commit / review round) · ⚠️ Partial · ❌ Blocked · 🔄 In Progress. New-row format: `| D<next-id> | <Brief description> | <source-task-id> | <target-task-id> | ❌ Blocked | — | <Context/rationale> |` (`:43`). Enforcement (`:71-75`): `grep -c "❌\|⚠️" ai/plans/<feature-name>/deferred-items.md` must be 0 at the final gate — plan cannot complete otherwise.

### plan-review-template.md (108 lines, `.agents/spec-process-guide/templates/plan-review-template.md`)

Title form: `# Plan Review Report — <feature-name>` :1, then `## Review Round: <N>` :3, `## Date: <YYYY-MM-DD>` :4, `## Subagents Dispatched: <list>` :5, `## Summary` :9, `## Findings by Dimension` :18, `## Detailed Findings` :33 (`### Dimension 1: <Name>` :35 with `[CRITICAL/HIGH/MEDIUM/LOW]` findings carrying Location/Expected/Actual/Fix Applied), `## Fix Subagents Dispatched` :55, `## Post-Fix Verification` :65, `## Lessons for Future Plans` :84, `## Traceability` :92, `## Next Steps` :104.
The 8 fixed dimensions in the Findings table (`:18-33`): Paths Existence · i18n Compliance · GraphQL Accuracy · Component Props · Permissions/Enums · Existing Components · Architecture Compliance · Cross-Reference Consistency.

### checklists.md (557 lines, `.agents/spec-process-guide/templates/checklists.md`)

Skeleton (headings :1-550): `## Requirements Phase Checklist` :5 → `## Design Phase Checklist` :70 → `## Tasks Phase Checklist` :142 → `## Cross-Phase Quality Checks` :211 → `## Implementation Execution Checklist` :249 → `## Troubleshooting Checklist` :296 → `## Quality Metrics and KPIs` :326 → `## Downloadable Checklists` :354 (quick checklists for Requirements/Design/Tasks :358/:377/:396) → `## Semantic Review Checklist (Per-Task)` :447 (Race Conditions & Concurrency :451, Environment & Configuration :457, Code Quality :462, Schema & Types :467, Deferred Work :472) → `## Translation & Enum Import Checklist (Per-Task)` :477 → `## Race Condition Review Checklist` :496 → `## Type Cascade Checklist` :522 → `## Scope Boundary Checklist (Review Phase)` :540.

## (b) Exemplar plan — `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/`

### REQ-id numbering scheme (specs.md, 667 lines)

Reqs are `REQ-0NN` grouped by tens with intentional gaps (grep `^#### REQ-` confirmed):

| Group | Meaning | Members (line) |
|---|---|---|
| 00x | Protocol / compliance | REQ-001 Pre-Implementation Baseline :94, REQ-002 Translation & Enum Import :109 |
| 01x | Data reads / feature surfaces | REQ-010 Linked-Children :128, REQ-011 Child Switcher :141, REQ-012 Attendance :156, REQ-013 Session Reports :169, REQ-014 Homework :182, REQ-015 Teacher Evaluations :195, REQ-016 Academic Progress :210 |
| 02x | Authz gates / security | REQ-020 Parent Role Gate :228, REQ-021 Confirmed-Link :241, REQ-022 403 Probes :254, REQ-023 Read-Only :268, REQ-024 BOLA Discipline :281 |
| 03x | GraphQL surface | REQ-030 Parent-Scoped Queries :298, REQ-031 Participant Queries Untouched :312 |
| 04x | UX / routes / i18n | REQ-040 Routes :328, REQ-041 Switcher URL Param :342, REQ-042 Sidebar :354, REQ-043 `parentMonitoring` namespace :366 |
| 05x | Testing | REQ-050 Repo Tests :383, REQ-051 Service Tests :396, REQ-052 Wire Tests :408, REQ-054 Journey :420 |
| 06x | Review / knowledge gates | REQ-060 Plan Review :436, REQ-061 Post-Implementation Wave :447, REQ-062 Knowledge Propagation :458 |

Each REQ has: `#### REQ-NNN: Title` → `**User Story:**` → `#### Acceptance Criteria` (numbered EARS) → `#### Additional Details` with a Priority/Complexity/Dependencies/Assumptions metadata line (e.g. `specs.md:266`). Spec also has a `## ⚠️ Phase-0 Ground-Truth Verification` block up front :24 and journeys referenced as J1–J4.

### EARS phrasing style — 2 quoted examples (verbatim)

REQ-010 AC1 (`specs.md:133`):

> 1. WHEN a parent opens the portal root THEN the system SHALL return exactly those students whose `students.parentId` equals the caller's id (R-A: the student row is the grant — `docs/parents/parent-link-request.md:121-122`) and whose student account is not soft-deleted (`users.isDeleted = false`), ordered stably (e.g. `createdAt ASC, id ASC`).

REQ-022 AC1 (`specs.md:259`):

> 1. WHEN a parent requests ANY portal surface with a `studentId` that is (a) their own non-linked id, (b) another student's id, or (c) a nonexistent id, THEN the response SHALL be the SAME localized `ForbiddenError` shape (`extensions.code = FORBIDDEN`, HTTP-classified 403) with constant copy across all three cases.

Style notes: numbered WHEN/THEN/SHALL; inline `path:line` grounding citations inside the AC text itself; rulings (R-A..R-J) cross-referenced in ACs and titles.

### plan.md section order actually used (657 lines)

Title `# Technical Architecture & Implementation Design: …` :1 → self-reference header block :3-8 (see below) → `## Document Information` :12 (`### Related Documents` :23) → `## 1. Overview` :35 (`### Design Goals` :39, `### 1.1 Key Design Decisions (log D1..D12)` :47, `### 1.2 Architecture & System Context` :109, `### Technology Stack` :124) → `## 2. Data Models & Database Schema` :136 (§2.1 Existing-Schema Verification :138, §2.2 NO schema changes :152, §2.3 New Canonical Types :156) → `## 3. API Contracts & Pothos Resolvers` :257 (§3.1 GraphQL SDL :259, §3.2 Pothos modules :295, §3.3 Permission matrix :337, §3.4 Codegen :347) → `## 4. Backend Services, Repositories & Concurrency Model` :353 (§4.1 Repos :355, §4.2 Service :369, §4.3 Concurrency Assessment :422, §4.4 Cross-Actor Journey Design :435) → `## 5. Frontend UX & Navigation Specification` :475 (routes :477, sidebar :488, role matrix :499, per-audience :507) → `## 6. Security, Authorization & Tenancy Mitigations` :575 → `## 7. Error Handling` :590 → `## 8. Testing Strategy` :605 → `## 9. Performance / Deployment / Migration Compatibility` :624 → `## 10. Outcome & Knowledge Transfer Protocol` :634 → `## Design Review Checklist (author self-certification)` :644.
Design decisions are logged as a numbered ruling list **D1..D12** inside §1.1 and referenced as "R-A"/"D7" style pins elsewhere (e.g. `plan.md:152` "### 2.2 NO schema changes (R-J / D7)").

### tasks.md phase structure (443 lines)

Top-level order: title :1 → self-reference header :3-8 → `> Source of truth:` summary blockquote :10 → `## Document Information` :11 → `### Numbering & Traceability Conventions` :22 → `## Non-Negotiable Execution Protocol` :31 (P1–P3) → `## Mandatory Subtask Pipeline (every implementation task, strict order)` :43 → `## Layer-to-Instructions Mapping` :79 → `## Implementation Overview` :101 → Phases → `## Traceability Map (REQ → tasks)` :394 → `## Completion Definition` :430.

Phase headings actually used (grep `^## Phase|^## Document`): `## Phase 0 — Pre-Implementation Baseline (blocking)` :111 · `## Phase 1 — Plan Review Gate (blocking, executed at authoring time)` :124 · `## Phase 2 — Backend types, repositories & services` :136 · `## Phase 3 — GraphQL layer` :190 · `## Phase 4 — i18n namespace (parentMonitoring full ceremony)` :227 · `## Phase 5 — Frontend documents, routes & views` :247 · `## Phase 6 — Testing & journeys` :298 · `## Phase 7 — Post-Implementation Review Wave (REQ-061)` :355 · `## Phase 8 — Final gate & knowledge propagation` :369.

### Per-subtask pipeline + one full quoted task

Pipeline suffixes, strict order (exemplar's own wording, `tasks.md:24`):

> Task ids `X.Y` follow phases; every implementation task carries the pipeline: `.QL` (per-file `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, exit 0) → `.TE` (4-tier test engineering) → `.SEC` (BOLA/BOPLA/BFLA/security audit) → `.SR` (semantic review) → `.IV` (instruction verification). Strict order; no skipping.

Full quoted task (verbatim from `tasks.md:138-152`, Phase 2 — shows the checkbox, files-to-create directives, and the five suffixed subtasks):

> - [x] 2.1 Canonical parent-monitoring types
>   - CREATE `backend/types/parents/parent-monitoring.types.ts` with the ten closed read projections verbatim from plan §2.3: `ParentLinkedChildReturnType`, `ParentAttendanceEntryReturnType`, `ParentAttendancePageReturnType`, `ParentReportEntryReturnType`, `ParentReportPageReturnType`, `ParentHomeworkTrackReturnType`, `ParentHomeworkEntryReturnType`, `ParentHomeworkPageReturnType`, `ParentHomeworkPositionReturnType`, `ParentChildProgressReturnType`, plus the shared `ParentPageInput` (`{ readonly page?: number; readonly pageSize?: number }`). All members `readonly`; `SessionStatus` / `SurahJuzRef` as VALUE imports from `@/backend/enum/...` …
>   - UPDATE `backend/types/parents/index.ts` with `export * from "./parent-monitoring.types";` (relative `./` only …)
>   - Deliberately NOT created (plan §2.3): `ParentChildOverviewReturnType`, `ParentReturnType`, any `evaluations` DTO.
>   - [x] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/parents/parent-monitoring.types.ts --lifecycle duplicates` (and the barrel) exit 0
>   - [x] 2.1.TE **Test Engineering**: type-level checks only — Tier 1 compile pass; a pinned type-assertion snippet in the file's verification outcome …
>   - [x] 2.1.SEC **Security & Tenancy Audit**: projections expose ONLY the plan §2.3 fields — no billing/dispute/internal columns reachable (BOPLA output side)
>   - [x] 2.1.SR **Semantic Review**: closed shapes, `readonly`, no re-opened entity types
>   - [x] 2.1.IV **Instruction Verification**: read files printed by sub-loop (`backend/types/AGENTS.md`, …)

### Header/footer self-reference convention

Every one of specs.md / plan.md / tasks.md opens with a `**Plan directory (verbatim):**` block listing, with full repo-relative paths, the plan directory, that file's own path, the companion docs, `deferred-items.md`, and `outcome/` (specs.md:3-8, plan.md:3-8, tasks.md:3-8). Document Information then repeats Target Directory / Outcome Directory and pins the ticket as `docs/planning/TICKETS.md:<lines>` (specs.md:10-14, tasks.md:13-14). tails: traceability loop is executed at final gate (`tasks.md:375`): `for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done` — zero misses; every task checkbox `[x]`.

### Traceability approach (requirements → tasks)

- Per-task `_Requirements:` lines list REQ ids EXPANDED (no ranges), grep-verifiable against `specs.md` (`tasks.md:26`).
- A final `## Traceability Map (REQ → tasks)` two-column table (`tasks.md:394-398`): `| REQ | Task(s) |` with comma-separated task ids, e.g. `| REQ-010 | 2.1, 2.2, 2.4, 6.5 |` (`tasks.md:397-402`).
- Gate REQs map to gate tasks, e.g. `| REQ-001 | 0.1, 8.1, 8.2 |` (`tasks.md:396`).

## (c) Canonical read-only-portal patterns — `docs/parents/monitoring-portal.md` (386 lines)

Patterns an ADMIN academic-tracking variant should mirror (with the admin-substitution noted):

| Pattern | Where | What the admin variant mirrors |
|---|---|---|
| Invariants first | `docs/parents/monitoring-portal.md:13-25` | INV-P1 (grant on student row) / INV-P2 (zero mutations) — admin analog: role gate replaces link grant; read-only posture still applies to an admin *monitoring* surface |
| Query surface = closed set of root `Query` fields | `:30-52` | Portal ships exactly 7 fields via side-effect registration `backend/graphql/query/parents/parent-monitoring.query.ts`; auth conjunction `{ $all: { authenticated: true; role: [UserRole.Parent] } }` declared WITHOUT `as const` (Pothos TS2322 note, `:40`) — admin variant: `role: [UserRole.Admin]` |
| Identity from context only | `:53` | "Identity arrives EXCLUSIVELY from `ctx.user.id`"; per-student `args.studentId` is the only client-supplied parameter, gated before any read |
| Single authorization spine gate | `:58-98` | `requireLinkedChild(parentActorId, studentId, locale, tx)` in `backend/services/parents/parent-monitoring.helpers.ts` — malformed id ≡ denial; `student?.parentId !== parentActorId` ≡ denial; soft-deleted child ≡ denial; gate runs FIRST inside ONE `withTransaction` shared with the data reads (TOCTOU seal) — admin variant: role/permission assertion replaces the link assertion, but malformed-id denial + single-snapshot discipline still apply |
| Constant-denial oracle (five-cause table) | `:99` | Every denial cause → SAME `ForbiddenError` (`t.forbidden`) + EXACTLY ONE `logDomainError` with the SAME bounded context bag `{ code: "FORBIDDEN", entity, entityId, locale }`; caller cannot distinguish cause from response bytes — admin variant: non-admin probes get this constant 403 (ticket scenario "Non-admin attempts access — 403") |
| BOLA/BFLA/BOPLA posture | `:120-125` | Layer-1 `authScopes` + layer-2 `requireActor` (soft-deleted actor always rejected); closed `interface` projections with NO `extends Entity`, NO `& SelectType`, NO `Omit` re-opening; audit stamps like `updatedAt` silently dropped at the mapping seam |
| Derived reads over existing tables | `:126-131` | Attendance derived from `session` rows (no attendance table) — admin academic tracking should likewise derive Surah/Juz progress from `home_work.current_*` / `revision_*` and Tajweed position from `progress`, not new tables |
| Honest counts | `:140-141` | `progressRowCount` via `COUNT(progress)` — "NEVER a fabricated percentage"; `latestJadidPosition`/`latestMadiPosition` derived from the newest `home_work` row's `current_*` (Jadid) and `revision_*` (Madi) columns, emitted ONLY when the track carries a surah/juz reference |
| Read-only posture | `:145-148` | Zero mutations on the monitoring surface — the admin tracking ticket scope (dashboard + drill-down) is also read-only monitoring |
| Untouched sibling surfaces | `:149-153` | Participant-only `sessionReport`/`sessionHomework` queries are byte-locked; new sibling scoped queries instead — admin variant: ship NEW admin-scoped queries rather than widening existing participant/parent queries |
| Apollo cache policy | `:153-163` | No-`id` value types get `keyFields: false` in `frontend/providers/apollo/apolloCache.ts`; `id`-carrying row types keep default normalization — do NOT misapply (anti-pattern `:240`) |
| URL-is-the-state | `:163-167` | No Zustand store; URL params carry child/drill-down selection (mirrors exemplar REQ-041) |
| Anti-patterns | `:215-240` | Do NOT vary denial shape by cause; do NOT log row fields on denial paths (log only the caller-supplied id); do NOT ship convenience mutations; do NOT gate outside the data-read transaction |

## (d) Decision refs — authoritative definitions (quoted)

### B.11 — Surah/Juz enum

Authoritative definition at `docs/specs/open-decisions-and-gaps.md:135-139`:

> ### B.11: Madi Homework — Surah/Juz Representation
> > **✅ RESOLVED**
> >
> > **Decision:** Use enum for Surah/Juz representation in homework.
> > **Schema impact:** `home_work.current_surah_juz` and `home_work.revision_surah_juz` columns added (`surah_juz_ref` enum). New `surah_juz_ref` enum created with all 114 Surahs (represented as examples) and all 30 Juz. This allows non-contiguous review assignments (e.g., "Surah Al-Baqarah" or "Juz 30").

Cross-references (secondary): `docs/planning/TICKETS.md:3113` (decision→tickets table: "B.11 (Surah/Juz enum) | Session Report Submission with Homework (Jadid & Madi), Surah/Juz Enum Homework Tracking"); `docs/planning/ROADMAP.md:54,58`; `docs/planning/TEAM_ALLOCATION.md:58`; `docs/planning/PRODUCTION_READINESS.md:328` (readiness check 8.21 "Verify surah_juz_ref enum and columns"); ticket bodies at `docs/planning/TICKETS.md:1091` ("home_work.current_surah_juz and revision_surah_juz use surah_juz_ref enum (B.11)"), `:1103`, `:1418`, `:1453`; our ticket's own ref line `:2217`.

### FR-6.3 — authoritative text vs ticket gloss

Authoritative definition at `docs/specs/functional-requirements.md:206-208`:

> ### FR-6.3: Progress Update
> - **Requirement:** Upon successful completion of a Tajweed session, the student's progress is updated and incremented.
> - **Schema:** `progress` (student_id, lesson_id, created_at, updated_at).

⚠️ **Naming discrepancy (verified):** the ticket glosses FR-6.3 as "(admin academic tracking)" (`docs/planning/TICKETS.md:2217`), but the authoritative FR-6.3 is the Tajweed progress-update mechanism (`docs/specs/functional-requirements.md:206`, inside `## 6. Tajweed Curriculum & Progress`, `:198`). Intended link: the admin dashboard surfaces academic advancement *driven by* FR-6.3 progress increments plus B.11 homework positions — FR-6.3 itself is not an admin-surface requirement. The plan should state this mapping explicitly rather than reading FR-6.3 as "admin tracking". Only other FR-6.3 usages in `docs/planning/`: `TICKETS.md:1214`, `TICKETS.md:2217`.

### Ticket body pins (for traceability)

`docs/planning/TICKETS.md:2184` heading "### Admin Academic Tracking (Memorization & Revision Milestones)"; Owner Stream Dev 2, Milestone 3, 3 SP (`:2188-2190`); **Blocked By** "Session Report Submission with Homework (Jadid & Madi)" (`:2191`); gherkin ACs: dashboard widgets (memorization progress, revision milestones, overall advancement stats, students needing attention) `:2196-2204` and per-student drill-down (all homework assignments, grades, progress over time) `:2206-2210`; test scenarios incl. "Non-admin attempts access — 403" (`:2213`); Decision Refs line `:2217`.

## (e) In-flight plan collision check (`ai/plans/`)

Verified tree (2026-09-21): `ai/plans/` contains exactly one milestone subtree — `ai/plans/milestone_3/` — and under it exactly one feature directory, `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/`, which contains only `outcome/` (this research file's home). No other in-flight plans exist; no adjacent-ticket plan (Admin CRUD Users/Teachers, Session Report, etc.) is present. `ai/finished_plans/` holds the completed plans (milestones 0-4 subdirs; `ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/` is the exemplar analyzed above).

**Blocker status (verified):** "Session Report Submission with Homework (Jadid & Madi)" (ticket at `docs/planning/TICKETS.md:1376`) is SHIPPED — finished plan exists at `ai/finished_plans/milestone_1_core_domain_mvp/session-report-homework-infrastructure/` (contains specs.md/plan.md/tasks.md). Its refs (`TICKETS.md:1103` B.11/C.4/INV-S7/INV-S8/INV-HW1/INV-HW2 and `:1418` B.11/INV-HW1-4/FR-5.2-5.4 for the dependent Surah/Juz Enum Homework Tracking ticket at `:1429`) show the `home_work` surface this ticket consumes is in place. The Admin Academic Tracking ticket is therefore unblocked.

## GAPS (verified NOT to exist)

1. No plan-review skill output template discrepancy: the 8 fixed subagent dimensions in `plan-review-template.md:20-28` are the ONLY enumerated review dimensions; there is no admin-dashboard-specific dimension.
2. No ticket-level acceptance criteria in `docs/planning/TICKETS.md` defining the low-grade / slow-progress thresholds (no numeric cutoff exists anywhere in the planning docs for "students needing attention") — the plan must define these as a ruling and log it as a design decision (D#).
3. No existing admin academic-tracking dashboard, admin monitoring service, or admin academic GraphQL query surface exists to extend — the parent portal (`docs/parents/monitoring-portal.md:30-52`, exactly 7 query fields, all `UserRole.Parent`-scoped) is the only read-only monitoring exemplar in the repo; verified via `docs/parents/monitoring-portal.md:13-52` (invariants named INV-P1/P2 are parent-specific) — no admin analog doc exists under `docs/` (no `docs/admin/academic-tracking.md`).
4. `docs/planning/PRODUCTION_READINESS.md:328` still lists 8.21/B.11 verification as unchecked (`☐`) in that document, but B.11 is shipped per `open-decisions-and-gaps.md:136` (✅ RESOLVED) and the blocker plan finished — readiness checkbox staleness only, not a missing implementation.
5. FR-6.3 has NO admin-tracking wording in `docs/specs/functional-requirements.md` (verified `:198-208`); the ticket's parenthetical is a gloss, not a spec definition — see discrepancy note in section (d).
6. `ai/plans/` contains no other concurrent plan for this or adjacent milestone-3 tickets (verified empty apart from this feature's `outcome/`), so no collision risk for this digest's location or for the plan to be authored.

## Corrections to the brief

- The brief's path for the exemplar plan ("ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/") is correct; files are `specs.md`, `plan.md`, `tasks.md` (no `deferred-items.md` is shipped alongside — the finished archive keeps only the three authoring docs plus `outcome/`).
- The brief's assumption "docs/planning/*.md" for decision refs was incomplete: B.11's authoritative definition lives in `docs/specs/open-decisions-and-gaps.md:135-139` (planning docs only cross-reference it), and FR-6.3's in `docs/specs/functional-requirements.md:206-208`.
- Ticket line range: heading at `docs/planning/TICKETS.md:2184`; the Decision Refs line is `:2217` (brief said "lines 2184-2217" — correct overall span).
