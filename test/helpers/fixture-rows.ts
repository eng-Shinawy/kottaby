/**
 * Direct-DB fixture-row primitives for the live-server GraphQL integration
 * suites — the sanctioned provisioning seam (frontend/graphql/test/AGENTS.md:
 * integration test FILES interact via testClient exclusively; shared test
 * infrastructure under `test/helpers/` owns entity provisioning that has no
 * public GraphQL surface, e.g. the admin role-child row or a certified
 * `teacher` child row). Rows are inserted with full column control over
 * lifecycle state; the suites accumulate committed rows on the test
 * database by convention (no cleanup).
 */

import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import type { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { hashPassword } from "@/backend/lib/auth/password";

/** Direct-DB session-row insert (full column control over lifecycle state). */
export async function insertSessionRow(overrides: {
  teacherId: number;
  studentId: number;
  status: SessionStatus;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(session)
    .values({
      teacherId: overrides.teacherId,
      studentId: overrides.studentId,
      status: overrides.status,
      sessionType: SessionType.StudentSession,
      intent: SessionIntent.Hifz,
      fee: "10.00",
      feeHeld: true,
      heldBalanceLane: HeldBalanceLane.Hifz,
    })
    .returning({ id: session.id });
  if (!row) throw new Error("session insert returned no rows");
  return row;
}

/**
 * Certified-teacher child row for an already-registered teacher user
 * (`isApproved=true` — the only shape that hosts real sessions).
 */
export async function insertCertifiedTeacherRow(userId: number): Promise<number> {
  const [teacherRow] = await db.insert(teacher).values({ id: userId, isApproved: true }).returning({ id: teacher.id });
  if (!teacherRow) throw new Error("teacher child-row insert returned no rows");
  return teacherRow.id;
}

/**
 * Admin user + `admin` child row for an email that must NOT go through the
 * public registration (RegisterPublicRole BFLA exclusion). Returns the
 * admin user's numeric id so the suite can log in over the real login path.
 */
export async function insertAdminUserWithChildRow(params: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}): Promise<number> {
  const [adminUser] = await db
    .insert(users)
    .values({
      fullName: params.fullName,
      email: params.email,
      phone: params.phone,
      passwordHash: await hashPassword(params.password),
      role: "admin",
      isDeleted: false,
      suspended: false,
      isBlocked: false,
      lastActiveAt: new Date(),
    })
    .returning();
  if (!adminUser) throw new Error("admin user insert returned no rows");
  const [adminRow] = await db.insert(admin).values({ id: adminUser.id }).returning({ id: admin.id });
  if (!adminRow) throw new Error("admin child-row insert returned no rows");
  return adminUser.id;
}
