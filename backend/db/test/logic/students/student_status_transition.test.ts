/**
 * Student balance preservation across governance transitions — the INV-U5
 * probe (`docs/specs/state-machine-invariants.md` §6).
 *
 * Pins the TARGET student's OWN `students` row — all four balance lanes
 * (`balance_hifz`, `balance_tajweed`, `balance_reviews`, `balance_trial`)
 * plus the `trial_granted_at` marker — byte-identical across every
 * governance transition (suspend → block → soft-delete → reactivate →
 * unblock → unsuspend). Governance state lives on `users`
 * (`backend/db/schema/users/users.ts`); the guarded governance UPDATEs
 * touch only their own columns plus `updated_at` on the `users` row, so the
 * `students` row — where the balances live — is structurally unreachable
 * from a governance mutation. The test proves that property non-vacuously:
 * it re-reads the target's row after EVERY rung and liveness-checks the
 * governance columns at the ladder's peak, so byte-identity is anchored to
 * transitions that demonstrably fired.
 *
 * Not re-authored here (single-home rule, `backend/db/test/logic/AGENTS.md`):
 * sibling-user isolation (an admin governance operation never touches
 * ANOTHER user's balances) is pinned in
 * `backend/services/admin/user-management.service.test.ts` — this file owns
 * the target's own row.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestAdmin, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import type { DBTransaction, StudentSelectType } from "@/backend/types";

const LOCALE = "en";

/** Suspension window (days) for the ladder's suspend rung. */
const SUSPEND_PERIOD_DAYS = 7;

/** Provisions a super-admin actor (users row + admin role-child row). */
async function provisionAdminActor(tx: DBTransaction) {
  const actor = await createTestUser(tx, { role: "admin" });
  await createTestAdmin(tx, actor.id);
  return actor;
}

/** Full `students` row snapshot keyed by the fixture's own id. */
async function readStudentRow(tx: DBTransaction, id: number): Promise<StudentSelectType | null> {
  const [row] = await tx.select().from(students).where(eq(students.id, id)).limit(1);
  return row ?? null;
}

/** Full `users` governance-column snapshot keyed by the fixture's own id. */
async function readGovernanceRow(tx: DBTransaction, id: number) {
  const [row] = await tx
    .select({
      isDeleted: users.isDeleted,
      suspended: users.suspended,
      isBlocked: users.isBlocked,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

describe("INV-U5 — target balance preservation across governance transitions", () => {
  test("INV-U5: the target's own four balance lanes and trialGrantedAt are byte-identical across every governance transition", async () => {
    await runInRollback(async tx => {
      const actor = await provisionAdminActor(tx);
      const studentUser = await createTestUser(tx, { role: "student" });
      const trialGrantedAt = new Date();
      await createTestStudent(tx, studentUser.id, {
        balanceHifz: 3,
        balanceTajweed: 2,
        balanceReviews: 1,
        balanceTrial: 1,
        trialGrantedAt,
      });

      const before = await readStudentRow(tx, studentUser.id);
      if (!before) throw new Error("expected the seeded students row to exist");

      const expectBalancesUntouched = async (): Promise<void> => {
        const after = await readStudentRow(tx, studentUser.id);
        expect(after).toEqual(before);
      };

      // Outbound ladder: suspend → block → soft-delete. The guarded admin
      // mutations run on the SAME rolled-back transaction.
      await AdminUserManagementService.setUserSuspended(
        studentUser.id,
        true,
        SUSPEND_PERIOD_DAYS,
        actor.id,
        LOCALE,
        tx
      );
      await expectBalancesUntouched();

      await AdminUserManagementService.setUserBlocked(studentUser.id, true, actor.id, LOCALE, tx);
      await expectBalancesUntouched();

      await AdminUserManagementService.setUserDeleted(studentUser.id, true, actor.id, LOCALE, tx);
      await expectBalancesUntouched();

      // Liveness proof at the peak — all three governance flags are live on
      // the users row while the balances stayed byte-identical.
      const peak = await readGovernanceRow(tx, studentUser.id);
      expect(peak?.isDeleted).toBe(true);
      expect(peak?.suspended).toBe(true);
      expect(peak?.isBlocked).toBe(true);

      // Return ladder: reactivate → unblock → unsuspend.
      await AdminUserManagementService.setUserDeleted(studentUser.id, false, actor.id, LOCALE, tx);
      await expectBalancesUntouched();

      await AdminUserManagementService.setUserBlocked(studentUser.id, false, actor.id, LOCALE, tx);
      await expectBalancesUntouched();

      await AdminUserManagementService.setUserSuspended(studentUser.id, false, null, actor.id, LOCALE, tx);
      await expectBalancesUntouched();

      // Governance fully restored AND the target row still byte-identical
      // (all four lanes + the trial marker).
      const restored = await readGovernanceRow(tx, studentUser.id);
      expect(restored?.isDeleted).toBe(false);
      expect(restored?.suspended).toBe(false);
      expect(restored?.isBlocked).toBe(false);
      const after = await readStudentRow(tx, studentUser.id);
      expect(after).toEqual(before);
      expect(after?.balanceHifz).toBe(3);
      expect(after?.balanceTajweed).toBe(2);
      expect(after?.balanceReviews).toBe(1);
      expect(after?.balanceTrial).toBe(1);
      expect(after?.trialGrantedAt).toEqual(trialGrantedAt);
    });
  });
});
