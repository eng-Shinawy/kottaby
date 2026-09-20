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

import { eq } from "drizzle-orm";

import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import type { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { hashPassword } from "@/backend/lib/auth/password";
import { VERIFICATION_PLAN_TITLE } from "@/shared/constants/verification-plan.constants";

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

/**
 * Evaluation-booking fixture set — the applicant/evaluator state that has no
 * public GraphQL surface in the dev environment (the applicant lifecycle
 * flip and the gateway-side subscription activation are admin/payment
 * pipeline outcomes, not wire operations). Each helper is a full-column
 * direct-DB write, mirroring the fixture-row conventions above.
 */

/**
 * Flips an existing `applicants` row to `in_evaluation` — the state the
 * booking gate requires. The row itself is provisioned by the real public
 * registration service (`teacher` role); only the lifecycle state is
 * fixture-owned. Returns the effective status for assertion convenience.
 */
export async function promoteApplicantToEvaluation(userId: number): Promise<string> {
  const [row] = await db
    .update(applicants)
    .set({ status: ApplicantStatus.InEvaluation })
    .where(eq(applicants.id, userId))
    .returning({ status: applicants.status });
  if (!row) throw new Error("applicant promotion returned no rows (applicants row missing?)");
  // The varchar column is nullable in the Drizzle projection; a null here
  // means the promotion never applied — fail loudly instead of leaking it.
  if (row.status === null) throw new Error("applicant promotion returned a null status");
  return row.status;
}

/**
 * Inserts an ACTIVE verification-plan subscription for the given user — the
 * fixture stand-in for the gateway-confirmed purchase activation (the cycle
 * probe reads the newest ACTIVE subscription on the canonical verification
 * plan). The plan row is resolved by the canonical shared title constant;
 * a missing plan row is a fixture setup failure (seeded catalog data).
 * Returns the subscription id.
 */
export async function insertActiveVerificationSubscription(userId: number): Promise<number> {
  const [planRow] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.title, VERIFICATION_PLAN_TITLE))
    .limit(1);
  if (!planRow) throw new Error(`plan row missing for title "${VERIFICATION_PLAN_TITLE}" — run the seeds`);
  const [row] = await db
    .insert(subscriptions)
    .values({
      userId,
      planId: planRow.id,
      status: SubscriptionStatus.Active,
      startDate: new Date(),
    })
    .returning({ id: subscriptions.id });
  if (!row) throw new Error("subscription insert returned no rows");
  return row.id;
}

/**
 * Certified-evaluator `teacher` child row for an already-registered teacher
 * user — the only shape the booking gate admits (`isApproved=true` AND
 * `isEvaluator=true`). Returns the teacher/users id.
 */
export async function insertEvaluatorTeacherRow(userId: number): Promise<number> {
  const [teacherRow] = await db
    .insert(teacher)
    .values({ id: userId, isApproved: true, isEvaluator: true })
    .returning({ id: teacher.id });
  if (!teacherRow) throw new Error("evaluator teacher child-row insert returned no rows");
  return teacherRow.id;
}
