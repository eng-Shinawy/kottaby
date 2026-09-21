# Draft Academy — Team Allocation & Stream Ownership

> **Source of truth:** `docs/specs/`, `backend/db/schema/`, `DELIVERY_PLAN_PROMPT.md`
> **Related:** `docs/planning/ROADMAP.md`, `docs/planning/MILESTONE_PLAN.md`, `docs/planning/TICKETS.md`

---

## Overview

Draft Academy is built by a **3-developer team** organized into **vertical tracer-bullet streams**. Each developer owns a complete vertical slice through every layer (schema, API, UI, tests) for their domain. Streams are designed to minimize cross-dependencies and blocking bottlenecks.

---

## Stream Ownership Matrix

| Stream | Developer | Domain | Primary Tables |
|---|---|---|---|
| **Student & Parent Experience** | Dev 1 | Registration, subscriptions, quotas, parent handshake, parent portal, Tajweed curriculum | `users`, `students`, `parents`, `subscriptions`, `student_subscriptions`, `plans`, `student_payments`, `progress`, `lessons` |
| **Teacher Lifecycle & Certification** | Dev 2 | Applicant registration, 5-session evaluation, cooldown, availability, session reports, homework | `users`, `teacher`, `applicants`, `teacher_verification`, `evaluations`, `reports`, `home_work`, `recitation` |
| **Matching, Escrow & Admin** | Dev 3 | Matching algorithm, notifications, dual-confirmation, wallet, admin operations, audit logs | `users`, `session`, `wallet`, `teacher_transaction`, `notifications`, `audit_logs`, `admin` |

---

## Dev 1 — Student & Parent Experience Stream

### Owned Domain

| Area | Scope | Key Decisions |
|---|---|---|
| **User Registration & Onboarding** | Student registration with role-specific child table creation, free trial session provisioning | A.7 (governance on users), C.1 (parent role) |
| **Plan Subscription & Balance Management** | Plan catalog (admin CRUD), subscription purchase, segregated session balance crediting (Hifz/Tajweed/Reviews), 30-day interval expiry, non-carryover rules | A.9 (subscription status), B.8/C.2 (user_id generic), B.17 (prorated plan changes) |
| **Tajweed Curriculum & Progress** | Static curriculum lessons, student progress tracking, progress increment on session completion | — |
| **Parent Pairing Handshake** | Unique handshake code generation, parent link request workflow, student confirmation, 7-day expiry | A.2 (parent_id FK), A.3 (handshake_code), B.12 (one parent per student), B.13 (parent multiple children), B.14 (7-day expiry) |
| **Parent Supervision Portal** | Read-only monitoring of linked children's sessions, reports, homework, evaluations, progress | — |

### Milestone Allocation

| Milestone | Focus | Tickets |
|---|---|---|
| Milestone 0 | Schema migrations, user registration, role-based child table creation | Database Schema Migration through Free Trial Session Provisioning |
| Milestone 1 | Plan catalog, subscription purchase, session balance crediting, free trial | Plan Catalog CRUD (Admin Only) through Admin Subscription Management (Extend/Renew/Cancel/Upgrade/Downgrade) |
| Milestone 2 | Tajweed curriculum lessons, progress tracking | Tajweed Curriculum Lessons CRUD through Teacher Preparation View (Student Progress Before Session) |
| Milestone 3 | Parent handshake portal, parent monitoring portal | Student Handshake Code Generation through Parent Session Completion Notification Display |
| Milestone 4 | Journey workflow tests, parent portal polish | Workflow Tests: Student Journey through Workflow Tests: Subscription Lifecycle |

---

## Dev 2 — Teacher Lifecycle & Certification Engine Stream

### Owned Domain

| Area | Scope | Key Decisions |
|---|---|---|
| **Teacher Applicant Registration** | Applicant registration (status = Pending_Evaluation), verification plan purchase, applicants table management | B.6 (applicants table), B.7 (teacher record after verification), B.8/C.2 (user_id generic) |
| **5-Session Evaluation Loop** | Booking evaluation sessions with 5 distinct certified Shuyukh, evaluation recording, rubric scoring with ≥80% pass threshold | B.1 (80% threshold), C.3 (evaluated_id/evaluator_id) |
| **Cooldown State Machine** | 1-month cooldown for Tajweed failure, 3-month cooldown for Hifz failure, re-application after cooldown | — |
| **Teacher Availability** | Manual toggle (Available/Unavailable), 15-minute inactivity auto-offline, in-session locking | B.15 (15-min inactivity), B.16 (request_preference) |
| **Session Reports & Homework** | Session report submission, homework assignment (Jadid new memorization & Madi review), Surah/Juz enum tracking | B.11 (Surah/Juz enum), C.4 (reports.teacher_id removed), C.5 (recitation 1:1 session) |
| **Re-Evaluation** | Admin-ordered re-evaluation with teacher wallet deduction | B.5 (re-eval paid by teacher) |

### Milestone Allocation

| Milestone | Focus | Tickets |
|---|---|---|
| Milestone 0 | Auth & RBAC middleware, role-based access contracts | JWT Authentication Service through Shared Types & Interface Contracts |
| Milestone 1 | Applicant registration, verification plan, 5-session evaluation loop, cooldown | Teacher Applicant Registration & Applicants Table through Admin Override of Evaluation Results |
| Milestone 2 | Teacher availability toggle, in-session locking, session report & homework submission | Teacher Availability Toggle (Available/Unavailable) through Surah/Juz Enum Homework Tracking |
| Milestone 3 | Evaluation system (student ratings → teacher rating), re-evaluation workflow | Student Evaluation Submission (Teacher Rating) through Admin Academic Tracking (Memorization & Revision Milestones) |
| Milestone 4 | Security hardening, audit trail verification | Security Hardening: Input Validation & SQL Injection Prevention through State Machine Invariant Verification Tests |

---

## Dev 3 — Matching Engine, Financial Escrow & Admin Governance Stream

### Owned Domain

| Area | Scope | Key Decisions |
|---|---|---|
| **On-Demand Matching Algorithm** | Filter/sort pipeline (Qira'ah, subject, country, language, rating), teacher discovery | B.10 (on-demand model), A.6 (teacher.subjects) |
| **Real-Time Notification Engine** | Session request, completion, cancellation, parent link, broadcast, payment, evaluation notifications | A.4 (notifications table) |
| **Dual-Confirmation Escrow** | 24-hour timeout, fee hold at request, decrement at completion, release on cancellation | B.2 (24h timeout), B.3 (platform-set fees), B.4 (escrow hold-at-request) |
| **Wallet & Transactions** | Teacher wallet crediting, withdrawal workflow, admin approval/rejection, manual adjustments | — |
| **Dispute Resolution** | Post-confirmation dispute with admin arbitration | B.18 (admin arbitration) |
| **Super Admin Operations** | Cold-start bootstrapping, direct student onboarding (offline payment), account soft-delete, verification override | B.9 (offline payment) |
| **Audit Logging** | Immutable audit trail for all admin actions | A.5 (audit_logs table) |
| **Admin Governance** | Full CRUD, session governance, financial auditing, platform analytics, broadcast notifications | — |

### Milestone Allocation

| Milestone | Focus | Tickets |
|---|---|---|
| Milestone 0 | CI/CD pipeline, Mermaid validation, shared types & interfaces | CI/CD Pipeline with Mermaid Validation through API Gateway & Routing Skeleton |
| Milestone 1 | Basic session lifecycle (scheduled → started → completed/cancelled), session creation | Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled) through Recitation Record per Session (1:1) |
| Milestone 2 | Matching algorithm, notification engine, dual-confirmation escrow, wallet & transactions | On-Demand Matching Algorithm (Filter/Sort Pipeline) through Teacher Withdrawal Workflow & Admin Approval |
| Milestone 3 | Admin governance, audit logging, cold-start bootstrapping, direct onboarding, dispute resolution | Admin CRUD: Users, Teachers, Students, Parents through Dispute Resolution with Admin Arbitration |
| Milestone 4 | Load testing, disaster recovery, production launch checklist | Load Testing & Performance Optimization through Production Launch Checklist Execution |

---

## Cross-Stream Interface Contracts

These are the shared contracts between streams. Each contract defines the interface boundary and the data that crosses it.

### Contract 1: Session Creation (Dev 1 → Dev 3)

| Aspect | Detail |
|---|---|
| **Provider** | Dev 1 (Student Experience) |
| **Consumer** | Dev 3 (Matching & Session Engine) |
| **Interface** | When a student requests a session, Dev 1's subscription/balance system validates the student has available session balance and decrements it (escrow hold). Dev 3's session engine creates the session record. |
| **Data Flow** | `student_id`, `teacher_id`, `intent` (hifz/tajweed), `session_type` (student_session), `fee` (from plan), `fee_held = true` |
| **Contract** | Dev 1 guarantees: student has `balance > 0` for the requested intent; balance is held (not decremented yet). Dev 3 guarantees: session record created with `fee_held = true`, `confirmation_deadline = now + 24h`. |
| **Decision Ref** | B.4 (escrow hold-at-request), B.3 (platform-set fees) |

### Contract 2: Teacher Availability (Dev 2 → Dev 3)

| Aspect | Detail |
|---|---|
| **Provider** | Dev 2 (Teacher Lifecycle) |
| **Consumer** | Dev 3 (Matching Engine) |
| **Interface** | Dev 3's matching algorithm queries Dev 2's teacher availability status to filter the directory. |
| **Data Flow** | `teacher.is_online`, `teacher.subjects`, `teacher.average_rating`, `teacher.request_preference` |
| **Contract** | Dev 2 guarantees: `is_online` is accurate within 15 minutes of last activity; in-session teachers have `is_online = false`. Dev 3 guarantees: only teachers with `is_online = true` and matching criteria appear in the directory. |
| **Decision Ref** | B.15 (15-min inactivity), B.16 (request_preference), A.6 (subjects) |

### Contract 3: Session Completion & Escrow (Dev 3 → Dev 1 & Dev 2)

| Aspect | Detail |
|---|---|
| **Provider** | Dev 3 (Session Engine & Escrow) |
| **Consumer** | Dev 1 (Student Balance) & Dev 2 (Session Reports) |
| **Interface** | Upon dual confirmation, Dev 3 triggers: (1) Dev 1 decrements the student's session balance, (2) Dev 2's session report is finalized, (3) Dev 3 credits the teacher's wallet. |
| **Data Flow** | `session.status = completed`, `session.confirmed_by_student_at`, `session.confirmed_by_teacher_at` |
| **Contract** | Dev 3 guarantees: dual confirmation verified before triggering balance decrement and wallet credit. Dev 1 guarantees: balance decremented atomically. Dev 2 guarantees: report and homework are submitted before completion. |
| **Decision Ref** | B.2 (24h timeout), B.4 (escrow decrement at completion) |

### Contract 4: Evaluation Sessions (Dev 2 → Dev 3)

| Aspect | Detail |
|---|---|
| **Provider** | Dev 2 (Teacher Lifecycle) |
| **Consumer** | Dev 3 (Session Engine) |
| **Interface** | Evaluation sessions use the same session table but with `session_type = teacher_evaluation`. Dev 2 manages the evaluation loop; Dev 3 provides the session infrastructure. |
| **Data Flow** | `session.session_type = 'teacher_evaluation'`, `session.intent = 'evaluation'`, `evaluations.evaluated_id`, `evaluations.evaluator_id` |
| **Contract** | Dev 2 guarantees: 5 distinct evaluators, ≥80% threshold logic. Dev 3 guarantees: session lifecycle works for evaluation sessions same as student sessions. |
| **Decision Ref** | A.8 (session_type), A.10 (session_intent), B.1 (80% threshold), C.3 (evaluated_id/evaluator_id) |

### Contract 5: Parent Notifications (Dev 3 → Dev 1)

| Aspect | Detail |
|---|---|
| **Provider** | Dev 3 (Notification Engine) |
| **Consumer** | Dev 1 (Parent Portal) |
| **Interface** | When a child's session completes, Dev 3's notification engine fires a notification to the linked parent. Dev 1's parent portal displays the notification. |
| **Data Flow** | `notifications.user_id = parent_id`, `notifications.type = 'session_completion'`, `notifications.related_entity_type = 'session'`, `notifications.related_entity_id = session.id` |
| **Contract** | Dev 3 guarantees: notification created when session reaches `completed` status and student has a linked parent. Dev 1 guarantees: parent portal displays notifications for linked children only. |
| **Decision Ref** | A.4 (notifications table) |

### Contract 6: Admin Operations (Dev 3 → Dev 1 & Dev 2)

| Aspect | Detail |
|---|---|
| **Provider** | Dev 3 (Admin Governance) |
| **Consumer** | Dev 1 (Student/Plan Management) & Dev 2 (Teacher/Evaluation Management) |
| **Interface** | Admin operations (cold-start bootstrapping, direct onboarding, subscription management, evaluation override) touch tables owned by Dev 1 and Dev 2. |
| **Data Flow** | Admin actions via Dev 3's admin endpoints → Dev 1's subscription/plan tables, Dev 2's teacher/evaluation tables |
| **Contract** | Dev 3 guarantees: all admin actions are logged in `audit_logs`. Dev 1 & Dev 2 guarantee: their tables accept admin-level mutations via the shared service layer. |
| **Decision Ref** | A.5 (audit_logs), B.9 (offline payment), B.17 (prorated plan changes) |

---

## Branching Strategy

### Branch Model

```
main (protected)
  ├── develop (integration branch)
  │     ├── dev1/milestone-N/feature-xxx   (Dev 1 feature branches)
  │     ├── dev2/milestone-N/feature-xxx   (Dev 2 feature branches)
  │     └── dev3/milestone-N/feature-xxx   (Dev 3 feature branches)
  └── release/vX.Y.Z                     (release branches)
```

### Rules

| Rule | Description |
|---|---|
| **`main` is protected** | No direct pushes. Only release merges via PR. |
| **`develop` is the integration branch** | All feature branches merge into `develop` via PR. |
| **Feature branch naming** | `dev{N}/milestone-{N}/{kebab-case-feature}` |
| **PR target** | All PRs target `develop`. Release PRs target `main`. |
| **Merge strategy** | Squash-and-merge for feature PRs. Merge-commit for release PRs. |

### PR Review Protocol

| Rule | Description |
|---|---|
| **Minimum reviewers** | 1 reviewer from a different stream |
| **Cross-stream review required** | If a PR touches a cross-stream interface contract, a reviewer from the affected stream must approve |
| **CI must be green** | All CI checks (lint, test, Mermaid validation) must pass |
| **Schema changes** | Any PR modifying `backend/db/schema/` requires review from all 3 developers |
| **Contract changes** | Any PR modifying a cross-stream interface contract requires explicit acknowledgment from all affected stream owners |

### Merge Conflict Prevention

| Strategy | Description |
|---|---|
| **Schema ownership** | Dev 1 owns migrations for student/parent/subscription tables. Dev 2 owns teacher/applicant/evaluation tables. Dev 3 owns session/wallet/notification/audit tables. Shared tables (`users`) require coordination. |
| **Interface-first development** | Define the interface contract before implementing. Both sides code to the contract. |
| **Daily integration** | Merge to `develop` at least once per day to catch conflicts early. |
| **Shared types** | Cross-stream shared types live in a shared module owned collectively. Changes require PR review from all streams. |

---

## RACI Matrix

| Activity | Dev 1 | Dev 2 | Dev 3 |
|---|---|---|---|
| User registration & auth | **R/A** | C | C |
| Student subscriptions & balances | **R/A** | I | C |
| Teacher verification & evaluation | I | **R/A** | C |
| Teacher availability | I | **R/A** | C |
| Session lifecycle | C | C | **R/A** |
| Matching algorithm | I | C | **R/A** |
| Notification engine | I | I | **R/A** |
| Escrow & wallet | C | I | **R/A** |
| Parent portal | **R/A** | I | C |
| Admin governance | C | C | **R/A** |
| Audit logging | I | I | **R/A** |
| Homework & reports | I | **R/A** | C |
| Tajweed curriculum & progress | **R/A** | C | I |
| CI/CD & validation | C | C | **R/A** |
| Security hardening | C | C | **R/A** |

**Legend:** R = Responsible, A = Accountable, C = Consulted, I = Informed
