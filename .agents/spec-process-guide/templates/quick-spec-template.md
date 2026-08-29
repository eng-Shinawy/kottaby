# Quick Spec Template

<!-- Navigation Metadata -->
<!-- Section: Templates | Level: Practical | Prerequisites: ../methodology/lightweight-specs.md -->
<!-- Related: micro-spec-template.md, requirements-template.md -->

**📍 You are here:** [Main Guide](../../README.md) → [Templates](README.md) → **Quick Spec Template**

## Quick Navigation
- **Prerequisites:** [Lightweight Specs](../methodology/lightweight-specs.md)
- **Related:** [Micro Spec Template](micro-spec-template.md), [Full Templates](requirements-template.md)

---

Ready-to-use template for 1-3 day features that need requirements and tasks but can skip the design phase.

## Template Usage

**Copy the template below and fill in the bracketed sections. Delete any sections that don't apply to your specific feature.**

---

# [Feature Name] - Quick Spec

**Spec Type:** Quick Spec  
**Estimated Effort:** [X hours/days]  
**Priority:** [High/Medium/Low]  
**Assignee:** [Developer name]  
**Created:** [YYYY-MM-DD]  
**Status:** [Kottaby/Review/Approved/In Progress/Complete]

## Overview

**What:** [One sentence describing what this feature does]  
**Why:** [Brief justification - business value or user need]  
**Success Metric:** [How you'll know this succeeded]

## Requirements

### User Story
**As a** [user type]  
**I want** [capability]  
**So that** [benefit/value]

### Acceptance Criteria
- [ ] [Specific, testable criterion that defines success]
- [ ] [Another criterion - focus on the happy path]
- [ ] [Edge case or error handling requirement]
- [ ] [Performance/quality requirement if applicable]

### Constraints
- **Technical:** [Any technical limitations or requirements]
- **Business:** [Any business rules or constraints]
- **Timeline:** [Any deadline constraints]

## Implementation Plan

### Phase 0: Baseline (Simplified for Quick Specs)
- [ ] **Record error baseline** (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit code, plus granular `bun tsgo` / `bun biome:check` / `bun run scripts/lint-service.ts --json --id baseline` counts) - document in outcome file
- [ ] **Create deferred-items ledger** (if feature has >3 tasks) - use template

### Prerequisites
- [ ] [Any setup or dependencies needed before starting]
- [ ] [Access permissions or environment setup]

### Core Tasks (with Quality Loop)
1. **[Task Name]** - [Brief description]
   - **Estimate:** [X hours]
   - **Details:** [Specific implementation notes]
   - **Quality Loop:** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (runs tsgo → oxlint → biome → lint → duplicates; auto-discovers applicable AGENTS.md + instructions; exit code 0 = pass)
   - **Semantic Review:** Check race conditions, env-config, cross-layer, enums, deferred items (sub-loop.ts handles mechanical checks; this covers semantic bugs it can't detect)

2. **[Task Name]** - [Brief description]
   - **Estimate:** [X hours]
   - **Details:** [Specific implementation notes]
   - **Quality Loop:** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
   - **Semantic Review:** Self-review checklist

3. **[Task Name]** - [Brief description]
   - **Estimate:** [X hours]
   - **Details:** [Specific implementation notes]
   - **Quality Loop:** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0)
   - **Semantic Review:** Self-review checklist

**Note:** Quick specs skip Phase 1.5 (Plan Review) and Phase 4 (Parallel Review Waves) for speed. Use full spec process for features >3 days.

### Testing & Security Tasks
- [ ] **4-Tier Testing via [.agents/skills/write-tests/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/write-tests/SKILL.md) & [.agents/skills/test-expert/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/test-expert/SKILL.md):**
  - **Tier 1 (Branch Coverage):** 100% method and branch coverage on new logic/repos (`runInRollback` + `tx` propagation)
  - **Tier 2 (Boundary & Edge Cases):** Empty strings, unicode/RTL, numeric bounds, nullability fallbacks
  - **Tier 3 (Monkey & Chaos):** Randomized fuzz payloads, concurrent execution races
  - **Tier 4 (Security):** Injection strings, authorization checks, unauthenticated rejection
- [ ] **Penetration & Security Testing via [.agents/skills/pentester/SKILL.md](file:///home/ahmed/Projects/kottaby/.agents/skills/pentester/SKILL.md):**
  - Verify BOLA / IDOR cross-tenant data isolation
  - Probe GraphQL operations for complexity / batching abuse
  - Verify webhook HMAC signature verification (`timingSafeEqual`)
- [ ] **Journey test (cross-actor workflows, if any actor interacts with another's state):** write `test/workflows/<domain>/<journey>.test.ts` test-first per `docs/testing/workflow-journey-tests.md`; omit only when the change is strictly single-actor
- [ ] **Manual & Verification:** [What needs manual verification]

### Documentation Tasks
- [ ] **Code Comments:** [Areas needing documentation]
- [ ] **README Updates:** [What documentation needs updating]
- [ ] **API Docs:** [If API changes are involved]

## Technical Notes

### Files to Modify
- `[file/path]` - [What changes are needed]
- `[file/path]` - [What changes are needed]

### Dependencies
- **Internal:** [Other components this depends on]
- **External:** [Third-party services or libraries]

### Risks & Mitigation
- **Risk:** [Potential issue]  
  **Mitigation:** [How to address it]

## Definition of Done

- [ ] All acceptance criteria are met
- [ ] Code is reviewed and approved
- [ ] Tests are written and passing
- [ ] Documentation is updated
- [ ] Feature is deployed to staging
- [ ] Manual testing is complete
- [ ] Stakeholder approval received

## Rollback Plan

**If something goes wrong:**
1. [Step to revert changes]
2. [Step to restore previous state]
3. [How to communicate the rollback]

---

## Example: User Profile Picture Upload

# User Profile Picture Upload - Quick Spec

**Spec Type:** Quick Spec  
**Estimated Effort:** 2 days  
**Priority:** Medium  
**Assignee:** Sarah Chen  
**Created:** 2024-01-15  
**Status:** Approved

## Overview

**What:** Allow users to upload and display profile pictures in their account settings  
**Why:** Users want to personalize their profiles and be more recognizable to teammates  
**Success Metric:** 50% of active users upload a profile picture within 30 days

## Requirements

### User Story
**As a** registered user  
**I want** to upload a profile picture  
**So that** my profile is more personalized and I'm recognizable to teammates

### Acceptance Criteria
- [ ] User can click "Upload Photo" button in profile settings
- [ ] System accepts JPG, PNG, and GIF files up to 5MB
- [ ] Image is automatically resized to 200x200px
- [ ] Profile picture displays in navigation bar and profile page
- [ ] User can remove their profile picture and return to default avatar
- [ ] Error messages show for invalid file types or sizes

### Constraints
- **Technical:** Must integrate with existing S3 bucket for file storage
- **Business:** Images must be family-friendly (manual moderation for now)
- **Timeline:** Needed for Q1 user engagement goals

## Implementation Plan

### Prerequisites
- [ ] Confirm S3 bucket permissions for profile-images folder
- [ ] Install image processing library (sharp.js)

### Core Tasks
1. **Frontend Upload Component** - Add file upload UI to profile settings
   - **Estimate:** 6 hours
   - **Details:** File input, preview, progress indicator, error handling

2. **Backend Upload Endpoint** - Handle file upload and processing
   - **Estimate:** 8 hours
   - **Details:** Validate file, resize image, upload to S3, update user record

3. **Profile Display Updates** - Show profile pictures throughout app
   - **Estimate:** 4 hours
   - **Details:** Update navbar component, profile page, user cards

### Testing Tasks
- [ ] **Unit Tests:** File validation, image processing functions
- [ ] **Integration Tests:** Upload endpoint, S3 integration
- [ ] **Manual Testing:** Upload flow, different file types, error cases

### Documentation Tasks
- [ ] **Code Comments:** Image processing and S3 upload functions
- [ ] **API Docs:** Document new upload endpoint

## Technical Notes

### Files to Modify
- `components/ProfileSettings.jsx` - Add upload UI
- `api/users/upload-avatar.js` - New upload endpoint
- `components/Navbar.jsx` - Display profile picture
- `components/UserCard.jsx` - Display profile picture

### Dependencies
- **Internal:** User authentication, S3 service wrapper
- **External:** sharp.js for image processing

### Risks & Mitigation
- **Risk:** Large file uploads could impact performance  
  **Mitigation:** Client-side file size validation, server-side limits

## Definition of Done

- [ ] All acceptance criteria are met
- [ ] Code is reviewed and approved
- [ ] Tests are written and passing
- [ ] API documentation is updated
- [ ] Feature is deployed to staging
- [ ] Manual testing with different file types complete
- [ ] Product owner approval received

## Rollback Plan

**If something goes wrong:**
1. Disable upload endpoint via feature flag
2. Revert frontend changes to hide upload UI
3. Notify users via in-app message about temporary unavailability

---

## Template Variations

### API Endpoint Quick Spec
```markdown
# [Endpoint Name] API - Quick Spec

## Requirements
**Endpoint:** [Method] /api/[path]
**Purpose:** [What this endpoint does]
**Authentication:** [Required auth level]

### Request Format
```json
{
  "field": "value"
}
```

### Response Format
```json
{
  "result": "success"
}
```

### Error Responses
- `400` - [Bad request scenario]
- `401` - [Unauthorized scenario]
- `500` - [Server error scenario]

## Implementation Tasks
1. **Route Handler** - [X hours]
2. **Validation** - [X hours]  
3. **Database Operations** - [X hours]
4. **Tests** - [X hours]
```

### Bug Fix Quick Spec
```markdown
# Bug Fix: [Issue Description] - Quick Spec

## Problem
**Issue:** [What's broken]
**Impact:** [Who/what is affected]
**Root Cause:** [Why it's happening]

## Solution
**Fix:** [How to resolve it]
**Files:** [What files need changes]
**Risk:** [Potential side effects]

## Implementation
1. **[Fix step]** - [X hours]
2. **[Test step]** - [X hours]
3. **[Verification step]** - [X hours]

## Verification
- [ ] [How to test the fix]
- [ ] [How to ensure no regression]
```

---

## 🔗 Related Content

### Prerequisites
- [Lightweight Specs Guide](../methodology/lightweight-specs.md)

### Other Templates
- [Micro Spec Template](micro-spec-template.md) - For even smaller changes
- [Full Spec Templates](requirements-template.md) - For complex features

### Examples
- [Quick Spec Examples](../examples/lightweight-examples.md)

[← Back to Templates](README.md) | [Micro Spec Template →](micro-spec-template.md)