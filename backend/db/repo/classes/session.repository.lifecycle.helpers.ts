/**
 * SessionRepository lifecycle helpers — the implementations of the
 * participant-side lifecycle transition primitives, extracted behind the
 * public `SessionRepository` namespace (the max-lines refactor pattern of
 * the sibling helpers modules; the namespace binds them one-to-one so the
 * public API is unchanged). Nothing in this module is part of the public
 * API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - every function takes `tx?: DBTransaction` as its LAST parameter and
 *    executes on `tx ?? db`;
 *  - no prepared statements, no SQL line-comment sequences, and the
 *    lifecycle vocabulary is carried by the `SessionStatus` enum members,
 *    never string literals;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what a `null` transition result means.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { DBTransaction, SessionSelectType } from "@/backend/types";

/**
 * Completes a session exactly once: a single guarded UPDATE whose predicate
 * fuses the ownership/state conditions with the certification re-assertion —
 * an `EXISTS (SELECT 1 FROM teacher …)` subquery evaluated inside the same
 * statement, so a teacher decertified between booking and completion can
 * never complete (zero rows match; no separate read exists to race against).
 * Writes the end stamp, the teacher confirmation stamp, and the audit stamp
 * from one captured instant. Report/homework side effects are deliberately
 * absent — this method touches ONLY the session row.
 *
 * @returns The updated row, or `null` when zero rows matched (unknown id,
 *          non-owner, wrong state, or the owning teacher no longer holds a
 *          strictly-true certification — the caller classifies via the
 *          transition probe).
 */
export async function completeSessionOnce(
  id: number,
  teacherId: number,
  tx?: DBTransaction
): Promise<SessionSelectType | null> {
  const now = new Date();
  const executor = tx ?? db;
  const rows = await executor
    .update(session)
    .set({ status: SessionStatus.Completed, endedAt: now, confirmedByTeacherAt: now, updatedAt: now })
    .where(
      and(
        eq(session.id, id),
        eq(session.teacherId, teacherId),
        eq(session.status, SessionStatus.Started),
        sql`EXISTS (SELECT 1 FROM ${teacher} WHERE ${eq(teacher.id, session.teacherId)} AND ${eq(teacher.isApproved, true)})`
      )
    )
    .returning();
  return rows[0] ?? null;
}
