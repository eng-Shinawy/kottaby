import { eq, inArray } from "drizzle-orm";
import { students, users } from "@/backend/db/schema";
import type { DBTransaction } from "@/backend/types";

export interface ResolvedRecipient {
  studentId: number;
  studentName: string;
  affectedUserIds: number[];
}

/**
 * Resolves notification recipients for a set of student IDs: queries the
 * student + users tables, determines whether a parent is linked, and
 * prefers the parent's userId as the notification recipient (falling back
 * to the student's own userId when no parent is linked).
 *
 * Returns a Map keyed by `studentId` so callers can look up recipients
 * for individual students without re-querying.
 *
 * @param studentIds - Distinct student IDs to resolve recipients for.
 * @param tx - Optional transaction handle; when omitted, uses the default db client.
 */
export async function resolveStudentNotificationRecipients(
  studentIds: number[],
  tx?: DBTransaction
): Promise<Map<number, ResolvedRecipient>> {
  const result = new Map<number, ResolvedRecipient>();
  if (studentIds.length === 0) return result;

  // The db client binds LAZILY so importing this module (via `@/scripts/lib`,
  // which every locked runner loads) never opens a pool/PGlite instance —
  // only an actual recipient resolution pays for the connection.
  const client = tx ?? (await import("@/backend/db")).db;

  const studentRows = await client
    .select({
      studentId: students.id,
      studentName: users.fullName,
      parentId: students.parentId,
    })
    .from(students)
    .innerJoin(users, eq(students.id, users.id))
    .where(inArray(students.id, studentIds));

  for (const row of studentRows) {
    const affectedUserIds: number[] = [];
    if (row.parentId !== null) {
      affectedUserIds.push(row.parentId);
    } else {
      affectedUserIds.push(row.studentId);
    }

    result.set(row.studentId, {
      studentId: row.studentId,
      studentName: row.studentName,
      affectedUserIds,
    });
  }

  return result;
}
