/**
 * ApplicantConversionService tests — the applicant→student conversion seam
 * against the live pglite/PostgreSQL test instance on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; `tx` is handed to
 *    the service (and to every direct Drizzle read) — the conversion joins
 *    the caller's transaction exactly like it joins the rubric finalization
 *    transaction in production, so a service-level throw discards every
 *    write of the case.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data. Repo-call arguments are pinned with through-spies on the
 *    repository namespaces (restored after each case).
 *  - NO `expect(...).rejects.toThrow()` — both expected throws go through
 *    `expectRepoError`.
 *
 * Coverage map (the four-tier contract):
 *  - Tier 1 (branches): the full 2×2 matrix of the idempotency probe × the
 *    guarded flip — row-absent × flip-true (fresh conversion: zeroed row +
 *    role flip), row-absent × flip-false (non-teacher precondition → the
 *    internal-invariant plain Error), row-exists × flip-true (re-conversion
 *    after re-certification: the historical row is reused, only the role
 *    flips), row-exists × flip-false (idempotent replay → silent no-op);
 *    plus both restore outcomes (flip applied / zero-row no-op).
 *  - Tier 2 (boundaries): a converted user with no `applicants` row at all
 *    (the idempotent path is independent of the applicants table); exact
 *    zero balances (=== 0, not falsy) and `parentId === null`; the
 *    handshake code is NEVER regenerated on an existing row.
 *  - Tier 3 (chaos): a duplicate finalization replay through the SAME
 *    transaction — the second conversion probes the surviving row, skips
 *    the insert, and the guarded flip misses harmlessly: exactly ONE
 *    `students` row survives and the role is coherent. (The single-connection
 *    rollback harness serializes what the production race arbitrates through
 *    the guarded writes and the probe; the committed-fixture cross-connection
 *    race belongs to the journey suite.) Plus the forced handshake-collision
 *    exhaustion: the localized `ConflictError` with the collision cause.
 *  - Tier 4 (security/abuse): the role-pair matrix is FIXED by the service
 *    signatures (no caller-supplied pair exists to pass) — proven at runtime
 *    by the two-member namespace surface and by driving non-teacher roles
 *    through both directions (`admin` and `student` are unreachable through
 *    the pinned pairs: the convert direction trips the invariant, the
 *    restore direction discards the miss); the conversion never touches the
 *    `applicants` row (byte-identical after a fresh conversion).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { StudentRepository, UserRepository } from "@/backend/db/repo";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import { ApplicantConversionService } from "@/backend/services/teachers/applicant-conversion.service";
import type { ApplicantSelectType, DBTransaction, StudentSelectType, UserSelectType } from "@/backend/types";
import { HANDSHAKE_CODE_PATTERN } from "@/shared/constants/handshake-code.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The tests run on the default locale throughout. */
const LOCALE = "en";

/**
 * The exact internal-inconsistency message the conversion throws when the
 * guarded flip matches zero rows on a FIRST conversion (no prior student
 * row) — the stored role was not `teacher`.
 */
const ROLE_FLIP_INVARIANT_MESSAGE =
  "ApplicantConversionService: role flip matched zero rows for a non-teacher applicant";

// ─── Assertion helpers (module scope — sibling-suite conventions) ────────

/** The errors-namespace translations for the default test locale. */
function tErrors() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Reads one user's role back through the SAME transaction. */
async function readRole(tx: DBTransaction, userId: number): Promise<UserSelectType["role"] | null> {
  const [row] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.role ?? null;
}

/** Reads the FULL `students` row through the SAME transaction (or null). */
async function readStudentRow(tx: DBTransaction, userId: number): Promise<StudentSelectType | null> {
  const [row] = await tx.select().from(students).where(eq(students.id, userId)).limit(1);
  return row ?? null;
}

/** Reads the FULL `applicants` row through the SAME transaction (or null). */
async function readApplicantRow(tx: DBTransaction, userId: number): Promise<ApplicantSelectType | null> {
  const [row] = await tx.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  return row ?? null;
}

/** Counts the `students` rows stored for one user id (0 or 1 — shared PK). */
async function countStudentRows(tx: DBTransaction, userId: number): Promise<number> {
  const rows = await tx.select({ id: students.id }).from(students).where(eq(students.id, userId));
  return rows.length;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function codeOf(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

// ─── Through-spy machinery (restored after every case) ───────────────────

const trackedSpies: ReturnType<typeof spyOn>[] = [];

/** Registers a spy for the afterEach restore sweep. */
function trackSpy<T extends ReturnType<typeof spyOn>>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

// ─── convertToStudent ─────────────────────────────────────────────────────

describe("ApplicantConversionService.convertToStudent", () => {
  test("fresh conversion inserts a zeroed student row and flips the role", async () => {
    await runInRollback(async tx => {
      const applicantUser = await createTestUser(tx, { role: UserRole.Teacher });
      const applicantRow = await createTestApplicant(tx, applicantUser.id, {
        status: ApplicantStatus.InEvaluation,
      });

      await ApplicantConversionService.convertToStudent(applicantUser.id, tx, tErrors());

      // The role-child row: shared PK, exact-zero balances (not falsy),
      // no parent linkage, and a well-formed handshake code.
      const studentRow = await readStudentRow(tx, applicantUser.id);
      expect(studentRow).not.toBeNull();
      if (!studentRow) throw new Error("expected the created students row");
      expect(studentRow.id).toBe(applicantUser.id);
      expect(studentRow.balanceHifz).toBe(0);
      expect(studentRow.balanceTajweed).toBe(0);
      expect(studentRow.balanceReviews).toBe(0);
      expect(studentRow.balanceTrial).toBe(0);
      expect(studentRow.parentId).toBeNull();
      expect(studentRow.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);

      // The guarded role flip took effect.
      expect(await readRole(tx, applicantUser.id)).toBe(UserRole.Student);

      // The conversion itself never touches the applicants row — the
      // verdict write owns it; the row survives byte-identical here.
      const applicantAfter = await readApplicantRow(tx, applicantUser.id);
      expect(applicantAfter).toEqual(applicantRow);
    });
  });

  test("re-conversion after re-certification reuses the historical students row and flips the role", async () => {
    await runInRollback(async tx => {
      // Post-restore state: role teacher again, the students row preserved
      // as history. A second failure re-converts WITHOUT a second row.
      const applicantUser = await createTestUser(tx, { role: UserRole.Teacher });
      const historicalRow = await createTestStudent(tx, applicantUser.id);
      const insertSpy = trackSpy(spyOn(StudentRepository, "createForRegistration"));

      await ApplicantConversionService.convertToStudent(applicantUser.id, tx, tErrors());

      // The insert never ran — the historical row and its handshake code
      // are kept verbatim.
      expect(insertSpy).not.toHaveBeenCalled();
      expect(await countStudentRows(tx, applicantUser.id)).toBe(1);
      const rowAfter = await readStudentRow(tx, applicantUser.id);
      expect(rowAfter).toEqual(historicalRow);

      // The role coherence WAS re-ensured: teacher → student applied.
      expect(await readRole(tx, applicantUser.id)).toBe(UserRole.Student);
    });
  });

  test("re-invocation on an already-converted user is a no-op (idempotency)", async () => {
    await runInRollback(async tx => {
      // A user with NO applicants row at all — the idempotent path is
      // independent of the applicants table.
      const convertedUser = await createTestUser(tx, { role: UserRole.Student });
      const storedRow = await createTestStudent(tx, convertedUser.id);
      const insertSpy = trackSpy(spyOn(StudentRepository, "createForRegistration"));

      await ApplicantConversionService.convertToStudent(convertedUser.id, tx, tErrors());

      // No duplicate insert, exactly one row, byte-identical, role coherent.
      expect(insertSpy).not.toHaveBeenCalled();
      expect(await countStudentRows(tx, convertedUser.id)).toBe(1);
      const rowAfter = await readStudentRow(tx, convertedUser.id);
      expect(rowAfter).toEqual(storedRow);
      expect(await readRole(tx, convertedUser.id)).toBe(UserRole.Student);
    });
  });

  test("a non-teacher role with no prior student row trips the internal invariant", async () => {
    await runInRollback(async tx => {
      // A student-role user WITHOUT a students row: the probe misses, the
      // insert lands, then the guarded flip (pinned to the teacher source
      // role) matches zero rows — the plain-Error internal inconsistency.
      const user = await createTestUser(tx, { role: UserRole.Student });

      const error = await expectRepoError(() => ApplicantConversionService.convertToStudent(user.id, tx, tErrors()));

      expect(error).not.toBeInstanceOf(DomainError);
      expect(error.message).toBe(ROLE_FLIP_INVARIANT_MESSAGE);

      // The user's role was never moved by the missed flip.
      expect(await readRole(tx, user.id)).toBe(UserRole.Student);
    });
  });

  test("an admin role is unreachable through the conversion pair", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: UserRole.Admin });

      const error = await expectRepoError(() => ApplicantConversionService.convertToStudent(admin.id, tx, tErrors()));

      // The pinned pair cannot demote an admin — the invariant fires and
      // the stored role is untouched.
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error.message).toBe(ROLE_FLIP_INVARIANT_MESSAGE);
      expect(await readRole(tx, admin.id)).toBe(UserRole.Admin);
    });
  });

  test("duplicate finalization replay: exactly ONE students row survives", async () => {
    await runInRollback(async tx => {
      const applicantUser = await createTestUser(tx, { role: UserRole.Teacher });

      // First invocation: fresh conversion (insert + flip).
      await ApplicantConversionService.convertToStudent(applicantUser.id, tx, tErrors());
      // Second invocation: the replay probes the surviving row, skips the
      // insert, and the guarded flip misses harmlessly — a safe no-op.
      await ApplicantConversionService.convertToStudent(applicantUser.id, tx, tErrors());

      expect(await countStudentRows(tx, applicantUser.id)).toBe(1);
      expect(await readRole(tx, applicantUser.id)).toBe(UserRole.Student);
    });
  });

  test("issues exactly the pinned repo calls on the caller's transaction", async () => {
    await runInRollback(async tx => {
      const applicantUser = await createTestUser(tx, { role: UserRole.Teacher });
      const probeSpy = trackSpy(spyOn(StudentRepository, "findHandshakeCodeByStudentId"));
      const flipSpy = trackSpy(spyOn(UserRepository, "transitionRoleOnce"));

      await ApplicantConversionService.convertToStudent(applicantUser.id, tx, tErrors());

      // The idempotency probe: (applicantUserId, tx).
      expect(probeSpy).toHaveBeenCalledTimes(1);
      const [probeId, probeTx] = probeSpy.mock.calls[0] ?? [];
      expect(probeId).toBe(applicantUser.id);
      expect(probeTx).toBe(tx);

      // The flip: the HARD-CODED teacher→student pair — never a
      // caller-supplied role pair — on the caller's tx.
      expect(flipSpy).toHaveBeenCalledTimes(1);
      const [flipId, flipFrom, flipTo, flipTx] = flipSpy.mock.calls[0] ?? [];
      expect(flipId).toBe(applicantUser.id);
      expect(flipFrom).toBe(UserRole.Teacher);
      expect(flipTo).toBe(UserRole.Student);
      expect(flipTx).toBe(tx);
    });
  });

  test("handshake retry exhaustion surfaces the localized ConflictError with the collision cause", async () => {
    await runInRollback(async tx => {
      const applicantUser = await createTestUser(tx, { role: UserRole.Teacher });
      const collision = Object.assign(
        new Error('duplicate key value violates unique constraint "students_handshake_code_unique"'),
        {
          code: "23505",
        }
      );
      trackSpy(
        spyOn(StudentRepository, "createForRegistration").mockImplementation(async () => {
          throw collision;
        })
      );

      const error = await expectRepoError(() =>
        ApplicantConversionService.convertToStudent(applicantUser.id, tx, tErrors())
      );

      // The localized, typed conflict — the nested adminUsers leaf, with
      // the collision carried as the cause.
      expect(error).toBeInstanceOf(ConflictError);
      expect(codeOf(error)).toBe("HANDSHAKE_EXHAUSTED");
      expect(error.message).toBe(tErrors().adminUsers.handshakeExhausted);
      expect(error.cause).toBe(collision);

      // The flip was never reached; the caller's transaction rolls back.
      expect(await readRole(tx, applicantUser.id)).toBe(UserRole.Teacher);
      expect(await countStudentRows(tx, applicantUser.id)).toBe(0);
    });
  });
});

// ─── restoreTeacherRole ───────────────────────────────────────────────────

describe("ApplicantConversionService.restoreTeacherRole", () => {
  test("flips student → teacher and preserves the students row byte-identical", async () => {
    await runInRollback(async tx => {
      const convertedUser = await createTestUser(tx, { role: UserRole.Student });
      const storedRow = await createTestStudent(tx, convertedUser.id);

      await ApplicantConversionService.restoreTeacherRole(convertedUser.id, tx);

      expect(await readRole(tx, convertedUser.id)).toBe(UserRole.Teacher);

      // Historical preservation: the students row is untouched — every
      // column, including the timestamps and the handshake code.
      const rowAfter = await readStudentRow(tx, convertedUser.id);
      expect(rowAfter).toEqual(storedRow);
    });
  });

  test("a never-converted teacher is a silent no-op", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: UserRole.Teacher });

      await ApplicantConversionService.restoreTeacherRole(teacherUser.id, tx);

      // Zero-row guarded miss discarded silently — no throw, role intact,
      // nothing created.
      expect(await readRole(tx, teacherUser.id)).toBe(UserRole.Teacher);
      expect(await countStudentRows(tx, teacherUser.id)).toBe(0);
    });
  });

  test("an admin role is unreachable through the restore pair", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: UserRole.Admin });

      await ApplicantConversionService.restoreTeacherRole(admin.id, tx);

      // The pinned pair cannot elevate an admin — the miss is discarded.
      expect(await readRole(tx, admin.id)).toBe(UserRole.Admin);
    });
  });

  test("issues the pinned student→teacher flip on the caller's transaction", async () => {
    await runInRollback(async tx => {
      const convertedUser = await createTestUser(tx, { role: UserRole.Student });
      const flipSpy = trackSpy(spyOn(UserRepository, "transitionRoleOnce"));

      await ApplicantConversionService.restoreTeacherRole(convertedUser.id, tx);

      expect(flipSpy).toHaveBeenCalledTimes(1);
      const [flipId, flipFrom, flipTo, flipTx] = flipSpy.mock.calls[0] ?? [];
      expect(flipId).toBe(convertedUser.id);
      expect(flipFrom).toBe(UserRole.Student);
      expect(flipTo).toBe(UserRole.Teacher);
      expect(flipTx).toBe(tx);
    });
  });
});

// ─── The fixed role-pair matrix (service surface) ─────────────────────────

describe("ApplicantConversionService — the fixed role-pair matrix", () => {
  test("exposes exactly the two conversion operations — no caller-supplied role pair exists", () => {
    // The escalating-pair hazard is closed at the type level (neither
    // signature accepts a role argument) and at the runtime surface level:
    // the namespace carries ONLY the two pinned-pair operations.
    const surface = Object.keys(ApplicantConversionService);
    expect(surface).toHaveLength(2);
    expect(surface).toContain("convertToStudent");
    expect(surface).toContain("restoreTeacherRole");
  });
});
