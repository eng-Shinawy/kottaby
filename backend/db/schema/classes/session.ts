import { boolean, decimal, index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { sessionIntent, sessionStatus, sessionType } from "@/backend/db/schema/enums";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import type { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";

/**
 * Session table (`session`).
 *
 * The central scheduling entity: a single meeting between a teacher and a
 * student. `teacher_id` → teacher.id (restrict: cannot delete a teacher who
 * still has sessions) and `student_id` → students.id (restrict: same for
 * students). Both are required (NOT NULL).
 *
 * Lifecycle is driven by `status` (session_status enum, default "scheduled"):
 * scheduled → started → completed | cancelled, and both scheduled and
 * started may pass through `disputed` (an arbitration state that every
 * admin resolution exits into exactly one terminal state:
 * disputed → cancelled | completed). `session_type` distinguishes regular
 * student sessions from teacher evaluations and re-evaluations. `intent`
 * is an optional classification of what the session is for (hifz,
 * tajweed, evaluation) — nullable.
 *
 * Dispute + reason surface: `cancel_reason` persists the trimmed
 * free-text reason a participant supplied when cancelling (NULL for rows
 * cancelled before the column existed or without a reason);
 * `dispute_reason` records why a participant opened a dispute and
 * `disputed_at` when; `resolution_note` + `resolved_at` record the admin
 * arbitration outcome's note and instant. All five are nullable, carry no
 * defaults, and are plain data — the guarded transitions own their writes.
 *
 * Financial escrow: `fee` is the platform-set session fee (nullable
 * decimal); `fee_held` flags whether the fee is currently in escrow (held at
 * request, decremented at completion). `held_balance_lane` records which
 * student balance lane funded the hold ('trial' | 'hifz' | 'tajweed',
 * nullable varchar) and is the row's PERMANENT refund provenance: NULL only
 * while no fee has ever been held; once a booking places a hold the lane is
 * never rewritten or nulled — release and consumption flip `fee_held` only,
 * and every cancellation/timeout refund reads the recorded lane and returns
 * to that same lane that paid. Dual confirmation:
 * `confirmed_by_student_at` + `confirmed_by_teacher_at` track each side's
 * confirmation; `confirmation_deadline` is the 24h window from request.
 *
 * No circular deps: imports only teacher, students, enums. The reverse FKs
 * (evaluations.session_id, teacher_transaction.session_id) reference this
 * table from those domains — they import `session`, session does NOT import
 * them. Authored first in the classes domain to unblock the evaluations and
 * teacher-transaction cross-domain resolution.
 */
export const session = pgTable(
  "session",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    teacherId: integer("teacher_id")
      .notNull()
      .references(() => teacher.id, { onDelete: "restrict" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    status: sessionStatus("status").notNull().default("scheduled"),
    sessionType: sessionType("session_type").notNull().default("student_session"),
    intent: sessionIntent("intent"),
    fee: decimal("fee", { precision: 10, scale: 2 }),
    feeHeld: boolean("fee_held").default(false),
    heldBalanceLane: varchar("held_balance_lane", { length: 20 }).$type<HeldBalanceLane>(),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    confirmedByStudentAt: timestamp("confirmed_by_student_at"),
    confirmedByTeacherAt: timestamp("confirmed_by_teacher_at"),
    confirmationDeadline: timestamp("confirmation_deadline"),
    cancelReason: varchar("cancel_reason", { length: 500 }),
    disputeReason: varchar("dispute_reason", { length: 500 }),
    disputedAt: timestamp("disputed_at"),
    resolutionNote: varchar("resolution_note", { length: 500 }),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    index("session_teacher_id_idx").on(t.teacherId),
    index("session_student_id_idx").on(t.studentId),
    index("session_teacher_id_student_id_idx").on(t.teacherId, t.studentId),
  ]
);
