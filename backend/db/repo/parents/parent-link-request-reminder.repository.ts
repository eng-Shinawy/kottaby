/**
 * Parent-link expiry-reminder repository — the expiry-reminder-slice data
 * access, split from `parent-link-request.repository.ts` to keep both files
 * inside the lint line budgets.
 *
 * The claim primitive is the notification-carrying counterpart of the
 * sweep: ONE set-based guarded UPDATE whose predicate both selects the
 * remindable rows and (by setting `reminder_sent_at`) dedupes them — no
 * idempotency cache, no notification probe. Everything here is system-scope
 * (actor-less) maintenance access; user-facing flows never touch it.
 */
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import type { DBTransaction } from "@/backend/types";

/**
 * A row claimed by the expiry-reminder primitive: the request columns the
 * notification emission needs (the claimed parent, the student whose masked
 * name composes the copy, and the expiry instant for ops records).
 */
export interface ExpiryReminderClaimRow {
  readonly id: number;
  readonly parentId: number;
  readonly studentId: number;
  readonly expiresAt: Date;
}

export namespace ParentLinkRequestReminderRepository {
  /**
   * Claims every LIVE pending request whose expiry falls inside the reminder
   * window and whose reminder has not been sent yet.
   *
   * ONE set-based guarded statement (the sweep's exact pattern): `status =
   * 'pending' AND expires_at > now AND expires_at <= horizon AND
   * reminder_sent_at IS NULL`. The boundary pair mirrors the lifecycle
   * rules — strict-`>` liveness (a row at or past `now` has lapsed; the
   * SWEEP owns it, not the reminder) and a horizon that is the INCLUSIVE
   * upper edge of the reminder window. Setting `reminder_sent_at` in the
   * same statement makes the claim itself the dedupe: a concurrent or
   * repeated run can never double-claim a row (the row-lock + the `IS NULL`
   * conjunct serialize claimers), so no idempotency cache or notification
   * probe is needed. Rows are claimed ATOMICALLY with the notifications that
   * describe them — the caller emits inside the SAME transaction, so a
   * failure anywhere rolls the whole unit (markers + inbox rows) back.
   *
   * Actor-less by design: system maintenance, not a user operation (the
   * same carve-out as the sweep — system writes carry no user-facing actor
   * re-check); a future cron-stream job owns the trigger identity. REQUIRED
   * `tx` per the repo convention.
   *
   * @param now     The single captured claim instant (strict-`>` liveness side).
   * @param horizon The inclusive upper edge of the reminder window.
   * @param tx      The caller's transaction (required for every write).
   * @returns The claimed rows (id/parentId/studentId/expiresAt) — empty on a
   *   re-run or when nothing is in window.
   */
  export async function claimPendingForExpiryReminder(
    now: Date,
    horizon: Date,
    tx: DBTransaction
  ): Promise<ExpiryReminderClaimRow[]> {
    return tx
      .update(parentLinkRequests)
      .set({ reminderSentAt: now })
      .where(
        and(
          eq(parentLinkRequests.status, LinkStatus.Pending),
          gt(parentLinkRequests.expiresAt, now),
          lte(parentLinkRequests.expiresAt, horizon),
          isNull(parentLinkRequests.reminderSentAt)
        )
      )
      .returning({
        id: parentLinkRequests.id,
        parentId: parentLinkRequests.parentId,
        studentId: parentLinkRequests.studentId,
        expiresAt: parentLinkRequests.expiresAt,
      });
  }

  /**
   * Resolves the display names of the STUDENT side of the given link
   * requests (students.id → users.fullName shared-PK join) — the raw input
   * for the reminder copy's `maskFullName` composition (the parent-bound
   * pre-decision copy NEVER carries the full name; the service masks it).
   *
   * Read-only helper for the reminder primitive, one query per batch; the
   * service calls it inside its claim transaction.
   */
  export async function listStudentFullNamesByIds(
    studentIds: readonly number[],
    tx: DBTransaction
  ): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    if (studentIds.length === 0) {
      return names;
    }
    const rows = await tx
      .select({ studentId: students.id, fullName: users.fullName })
      .from(students)
      .innerJoin(users, eq(students.id, users.id))
      .where(inArray(students.id, [...studentIds]));
    for (const row of rows) {
      names.set(row.studentId, row.fullName);
    }
    return names;
  }
}
