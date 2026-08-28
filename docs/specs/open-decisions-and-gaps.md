# Draft Academy — Resolved Decisions & Edge Cases

> **Source of truth:** `draft_docs/1-sc.en.md`, `draft_docs/2-admin-sc.en.md`, `backend/db/schema/` (Drizzle schema)
> **Purpose:** All 33 open decisions have been resolved through stakeholder review. This document records each decision, its resolution, and the schema/specification impact.
> **Status:** ✅ All decisions resolved. Schema updated and validated.

---

## A. Schema Gaps — Missing Entities & Fields

### A.1: No `parents` Table
> **✅ RESOLVED**
>
> **Decision:** Add a `parents` table (shared PK with `users`, similar to `admin`/`teacher`/`students`).
> **Schema impact:** New `parents` table added with `id` (PK, shared with `users.id`), `created_at`, `updated_at`. `parent` added to `user_role` enum (see C.1).

### A.2: No Parent-Child Linking Table
> **✅ RESOLVED**
>
> **Decision:** Add `parent_id` FK to the `students` table (simpler model, no separate linking table).
> **Schema impact:** `students.parent_id` column added (FK to `users.id`). Supports one parent per student (B.12). Parent can link to multiple children (B.13) since each student record has its own `parent_id`.

### A.3: No Student Unique Handshake Code Field
> **✅ RESOLVED**
>
> **Decision:** Add `handshake_code` column to the `students` table (unique, generated on creation).
> **Schema impact:** `students.handshake_code` column added (`varchar(50)`, unique, not null).

### A.4: No `notification` Table
> **✅ RESOLVED**
>
> **Decision:** Create a `notifications` table in the database.
> **Schema impact:** New `notifications` table added with `id`, `user_id` (FK), `type` (notification_type enum), `title`, `body`, `is_read`, `related_entity_type`, `related_entity_id`, `created_at`. New `notification_type` enum created.

### A.5: No Audit Log Table
> **✅ RESOLVED**
>
> **Decision:** Create an `audit_logs` table in the database.
> **Schema impact:** New `audit_logs` table added with `id`, `actor_id` (FK to users), `action_type` (audit_action_type enum), `entity_type`, `entity_id`, `details` (varchar for JSON), `created_at`. New `audit_action_type` enum created. Append-only (immutable).

### A.6: No Teacher Subject Availability Field
> **✅ RESOLVED**
>
> **Decision:** Add `subjects` array field to the `teacher` table (JSON array of subjects: quran, tajweed, tafsir, etc.).
> **Schema impact:** `teacher.subjects` column added (`varchar(255)` with note for JSON array storage).

### A.7: No Teacher Soft Delete / Suspension Fields
> **✅ RESOLVED**
>
> **Decision:** Move governance fields (`is_deleted`, `deleted_at`, `suspended`, `suspended_at`, `suspended_period_days`, `is_blocked`, `blocked_at`) to the base `users` table (applies to all roles).
> **Schema impact:** Governance fields removed from `students` table and added to `users` table. Also added `last_active_at` to `users` for inactivity tracking (B.15).

### A.8: No Session Type Distinction
> **✅ RESOLVED**
>
> **Decision:** Add `session_type` enum to the `session` table.
> **Schema impact:** `session.session_type` column added (`session_type` enum: `student_session`, `teacher_evaluation`, `re_evaluation`). New `session_type` enum created.

### A.9: No Subscription Status Field
> **✅ RESOLVED**
>
> **Decision:** Add `status` enum to the `subscriptions` table.
> **Schema impact:** `subscriptions.status` column added (`subscription_status` enum: `active`, `pending`, `expired`, `cancelled`, `suspended`). New `subscription_status` enum created.

### A.10: No Session Intent Field
> **✅ RESOLVED**
>
> **Decision:** Add `intent` enum to the `session` table.
> **Schema impact:** `session.intent` column added (`session_intent` enum: `hifz`, `tajweed`, `evaluation`). New `session_intent` enum created.

---

## B. Business Rule Ambiguities

### B.1: Evaluation Pass Threshold
> **✅ RESOLVED**
>
> **Decision:** 80% pass threshold for evaluation sessions.
> **Spec impact:** Teacher applicants must score ≥ 80 out of 100 on each evaluation session. The `evaluations.score` check constraint already supports 0–100 range.

### B.2: Dual Confirmation Timeout
> **✅ RESOLVED**
>
> **Decision:** 24-hour dual confirmation timeout.
> **Schema impact:** `session.confirmation_deadline` and `session.confirmed_by_student_at` / `session.confirmed_by_teacher_at` columns added. If neither party confirms within 24 hours, the session is auto-cancelled and any held funds are refunded.

### B.3: Session Fee Determination
> **✅ RESOLVED**
>
> **Decision:** Platform sets the session price (fixed per subject/plan).
> **Schema impact:** `session.fee` column added. The fee is determined by the platform based on the plan and subject type, not negotiated between teacher and student.

### B.4: Session Balance Decrement Timing
> **✅ RESOLVED**
>
> **Decision:** Hold at request, decrement at completion (escrow model).
> **Schema impact:** `session.fee_held` boolean column added. When a session is requested, the fee is held (escrow). Upon dual confirmation of completion, the balance is decremented and the teacher's wallet is credited. If cancelled, held funds are released back.

### B.5: Admin Re-Evaluation — Free or Paid?
> **✅ RESOLVED**
>
> **Decision:** Paid by the teacher (deducted from teacher's wallet).
> **Spec impact:** When an admin orders a re-evaluation, the cost is deducted from the teacher's wallet balance. This is recorded as a `teacher_transaction` with type `withdrawal`.

### B.6: Failed Applicant — Teacher vs. Student Record
> **✅ RESOLVED**
>
> **Decision:** Move failed applicants to a separate `applicants` table.
> **Schema impact:** New `applicants` table added with `id` (shared PK with users), `verification_attempts`, `last_attempt_at`, `cooldown_until`, `status`, timestamps. The `teacher` table is reserved for verified sheikhs only. When an applicant fails, their record is moved to `applicants`. If they re-apply after cooldown, a new `teacher` record is created upon passing.

### B.7: Teacher Record Creation Timing
> **✅ RESOLVED**
>
> **Decision:** Create `teacher` record only after passing verification.
> **Spec impact:** The `teacher` table record is created only when an applicant passes all evaluation sessions. Before that, the user exists in the `applicants` table. This resolves the `subscriptions.teacher_id` FK issue (C.2) since subscriptions now reference `users.id` generically.

### B.8: Subscriptions Table — Teacher vs. Student Ownership
> **✅ RESOLVED**
>
> **Decision:** Rename `teacher_id` to `user_id` (generic user reference).
> **Schema impact:** `subscriptions.teacher_id` renamed to `subscriptions.user_id` (FK to `users`). This supports both teacher verification subscriptions and student plan subscriptions through a single table.

### B.9: Offline Payment Audit Trail
> **✅ RESOLVED**
>
> **Decision:** Add payment method fields to the `subscriptions` table.
> **Schema impact:** `subscriptions.payment_method` (payment_gateway enum, extended with `offline_cash`, `bank_transfer`, `scholarship`), `subscriptions.payment_reference` (varchar), `subscriptions.payment_verified_at` (timestamp) columns added. The `payment_gateway` enum was extended with offline payment types.

### B.10: Teacher Assignment vs. On-Demand Model
> **✅ RESOLVED**
>
> **Decision:** On-demand model (students browse and request).
> **Spec impact:** The platform operates purely on-demand. Students browse available teachers, filter by subject/criteria, and request sessions. No platform-assigned teachers. The admin "assign" capability is interpreted as a recommendation/routing hint, not a fixed assignment.

### B.11: Madi Homework — Surah/Juz Representation
> **✅ RESOLVED**
>
> **Decision:** Use enum for Surah/Juz representation in homework.
> **Schema impact:** `home_work.current_surah_juz` and `home_work.revision_surah_juz` columns added (`surah_juz_ref` enum). New `surah_juz_ref` enum created with all 114 Surahs (represented as examples) and all 30 Juz. This allows non-contiguous review assignments (e.g., "Surah Al-Baqarah" or "Juz 30").

### B.12: Multiple Parents per Student
> **✅ RESOLVED**
>
> **Decision:** No — limited to one parent per student.
> **Schema impact:** `students.parent_id` is a single FK (not a junction table). Only one parent can be linked to a student at a time.

### B.13: Parent Linking Multiple Children
> **✅ RESOLVED**
>
> **Decision:** Yes — a parent can link to multiple children.
> **Schema impact:** Since `parent_id` is on the `students` table, multiple student records can reference the same `parent_id`. Each child requires a separate handshake code confirmation.

### B.14: Link Request Expiry
> **✅ RESOLVED**
>
> **Decision:** 7 days expiry for pending link requests.
> **Spec impact:** A pending parent link request (parent enters handshake code, student must confirm) expires after 7 days. The student must confirm within this window. After expiry, the parent must re-initiate the link request.

### B.15: Inactivity Timeout for Teachers
> **✅ RESOLVED**
>
> **Decision:** 15-minute inactivity timeout.
> **Schema impact:** `users.last_active_at` column added. Teachers are marked unavailable (`teacher.is_online = false`) after 15 minutes of inactivity (no WebSocket heartbeat or API call).

### B.16: Session Request Queue
> **✅ RESOLVED**
>
> **Decision:** Flexible by teacher — all options (queue, reject, offer alternatives) configurable per teacher preference.
> **Schema impact:** `teacher.request_preference` column added (`teacher_request_preference` enum: `queue`, `reject`, `offer_alternatives`). Each teacher can configure how concurrent session requests are handled. New `teacher_request_preference` enum created.

### B.17: Plan Upgrade/Downgrade Balance Handling
> **✅ RESOLVED**
>
> **Decision:** Prorated balance handling.
> **Spec impact:** When a student upgrades or downgrades their plan mid-cycle, the remaining session balance is prorated. The value of unused sessions is credited toward the new plan. The validity window resets to the new plan's `interval_days`.

### B.18: Dispute Resolution After Confirmation
> **✅ RESOLVED**
>
> **Decision:** Admin arbitration for post-confirmation disputes.
> **Schema impact:** `session_status` enum extended with `disputed` value. After dual confirmation, if a student disputes, the session enters `disputed` status. An admin reviews the case via the audit log and makes a binding arbitration decision (refund, partial refund, or uphold).

---

## C. Cross-Cutting Concerns

### C.1: `user_role` Enum — Missing `parent`
> **✅ RESOLVED**
>
> **Decision:** Add `parent` to the `user_role` enum.
> **Schema impact:** `user_role` enum extended with `parent` value. Parents are full users with their own role, child table (`parents`), and permissions (read-only monitoring of linked children).

### C.2: `subscriptions.teacher_id` — NOT NULL Constraint
> **✅ RESOLVED**
>
> **Decision:** Rename `teacher_id` to `user_id` (FK to `users`).
> **Schema impact:** `subscriptions.teacher_id` renamed to `subscriptions.user_id` (FK to `users.id`, NOT NULL). This resolves the constraint issue — any user (teacher or student) can own a subscription. The FK relationship changed from `teacher` to `users`.

### C.3: `evaluations.user_id` — Ambiguous Target
> **✅ RESOLVED**
>
> **Decision:** Rename `user_id` to `evaluated_id` (the person being evaluated) and add `evaluator_id` (the certified sheikh submitting the evaluation).
> **Schema impact:** `evaluations.user_id` renamed to `evaluations.evaluated_id` (FK to `users`). New `evaluations.evaluator_id` column added (FK to `users`). Both columns indexed. The evaluator is always a certified teacher (`is_approved = true`).

### C.4: `reports.teacher_id` — Redundant with Session
> **✅ RESOLVED**
>
> **Decision:** Remove the redundant `teacher_id` field (use `session.teacher_id` via session FK).
> **Schema impact:** `reports.teacher_id` column and its index removed. The teacher is accessed via `reports.session_id → session.teacher_id`. The `reports` table now has only `session_id` as its foreign key.

### C.5: `recitation` Table — 1:M Relationship
> **✅ RESOLVED**
>
> **Decision:** One recitation record per session.
> **Schema impact:** `recitation.user_id` renamed to `recitation.session_id` (FK to `session`, unique). Each session has exactly one recitation record. The relationship changed from 1:M (user → recitations) to 1:1 (session → recitation).

---

## D. Resolved During Implementation (DEV1-004 — Free Trial Session Provisioning)

### D.1: Trial Placement — Dedicated `balance_trial` Lane (NOT `balance_hifz`)
> **✅ RESOLVED** (per FR-2.6)
>
> **Decision:** The free trial credit for newly registered students lives in a dedicated, segregated `balance_trial` column on the `students` table, paired with a `trial_granted_at` one-time marker column. The alternative — crediting the trial into `balance_hifz` — was explicitly rejected.
>
> **Schema impact:** `students.balance_trial INTEGER NOT NULL DEFAULT 0` + `students.trial_granted_at TIMESTAMP NULL` + CHECK constraint `students_balance_trial_check` (`balance_trial >= 0`). The `students_balance_hifz_check` / `students_balance_tajweed_check` / `students_balance_reviews_check` constraints are unchanged.
>
> **Three-point rationale:**
> 1. **INV-B5 purity (paid-lane segregation)** — a trial is not a Hifz purchase. Crediting `balance_hifz` with a trial would dilute the semantic meaning of that column for every consumer that reads it (booking eligibility, analytics dashboards, refund flows). The dedicated lane keeps the paid lanes pure: a non-zero `balance_hifz` always means "the student (or their parent) paid for Hifz sessions via a subscription."
> 2. **INV-B2 subscription-binding** — paid crediting ties to subscription activation (a `subscriptions` row transitioning to `active`). A trial has no `subscriptions` row, no payment, and no validity window. Crediting `balance_hifz` would require either fabricating a synthetic subscription (which would corrupt the subscription state machine) or bypassing the crediting discipline that INV-B2 mandates — both unacceptable.
> 3. **Analytics separability** — Admin needs to distinguish granted trials from paid credits for the M3 trial-funnel conversion dashboard (trials granted → trials consumed → trials converted to paid). With a dedicated lane + marker, the query `SELECT count(*) FROM students WHERE trial_granted_at IS NOT NULL` is a clean grant-count metric; with a co-mingled `balance_hifz`, that query would require joining against `subscriptions` and filtering out non-trial credits — fragile, slow, and structurally unable to distinguish a trial grant from a paid top-up.
>
> **Reference:** Canonical implementation documented in `docs/students/free-trial-provisioning.md`. Invariant addenda (INV-B7 grant-once, INV-B8 trial-first decrement) recorded in `docs/specs/state-machine-invariants.md` §4.2.

---

## Summary

| Category | Count | Status |
|---|---|---|
| Schema Gaps (Missing Entities & Fields) | 10 | ✅ All Resolved |
| Business Rule Ambiguities | 18 | ✅ All Resolved |
| Cross-Cutting Concerns | 5 | ✅ All Resolved |
| **Total** | **33** | **✅ All Resolved** |

### Schema Changes Summary

| Change | Decision(s) | Impact |
|---|---|---|
| New `parents` table | A.1, C.1 | Parent role with shared PK |
| New `applicants` table | B.6, B.7 | Failed teacher applicants |
| New `notifications` table | A.4 | Persisted notifications |
| New `audit_logs` table | A.5 | Immutable admin action log |
| Governance fields moved to `users` | A.7 | Unified governance for all roles |
| `students.handshake_code` added | A.3 | Parent-child linking |
| `students.parent_id` added | A.2, B.12, B.13 | One parent per student, parent links multiple children |
| `teacher.subjects` added | A.6 | Subject availability |
| `teacher.request_preference` added | B.16 | Configurable request handling |
| `session.session_type` added | A.8 | Session type distinction |
| `session.intent` added | A.10 | Session purpose |
| `session.fee`, `session.fee_held` added | B.3, B.4 | Escrow model |
| `session.confirmation_*` fields added | B.2 | 24h dual confirmation |
| `session_status` enum extended | B.18 | `disputed` status |
| `subscriptions.teacher_id` → `user_id` | B.8, C.2 | Generic user ownership |
| `subscriptions.status` added | A.9 | Subscription lifecycle |
| `subscriptions.payment_*` fields added | B.9 | Offline payment tracking |
| `payment_gateway` enum extended | B.9 | `offline_cash`, `bank_transfer`, `scholarship` |
| `evaluations.user_id` → `evaluated_id` + `evaluator_id` | C.3 | Disambiguated evaluation target |
| `reports.teacher_id` removed | C.4 | Redundancy eliminated |
| `recitation.user_id` → `session_id` (unique) | C.5 | One per session |
| `home_work.current_surah_juz`, `revision_surah_juz` added | B.11 | Surah/Juz enum |
| `users.last_active_at` added | B.15 | Inactivity tracking |
| 7 new enums created | Multiple | `session_type`, `session_intent`, `subscription_status`, `link_status`, `notification_type`, `audit_action_type`, `surah_juz_ref`, `teacher_request_preference` |

All schema changes have been validated against the Drizzle schema in `backend/db/schema/` (the sole structural ground truth).
