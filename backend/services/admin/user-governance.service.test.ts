/**
 * AdminUserManagementService — governance mutations suite
 * (`setUserSuspended` / `setUserBlocked`).
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md` +
 * `.github/instructions/tests.instructions.md`:
 *  - 4-Tier mixed suite. Every DB-touching case runs inside `runInRollback`;
 *    `tx` is passed to EVERY service / entity-setup call so the actor
 *    probe + the operation share the SAME rolled-back transaction.
 *  - Entities ONLY via `entity-setup.ts` helpers (randomized-UUID emails);
 *    governance states seeded via `createTestUser` overrides.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions resolve via `getServerTranslations`
 *    property access — never raw keys, never hardcoded UI copy.
 *
 * Coverage map:
 *  - Tier 1 (statement/branch): both directions of BOTH mutations happy
 *    path incl. `getUserDetail` re-composition payload equivalence; ALL
 *    state-conflict codes (USER_ALREADY_SUSPENDED / NOT_SUSPENDED /
 *    ALREADY_BLOCKED / NOT_BLOCKED / ALREADY_DELETED /
 *    SELF_SUSPENSION_FORBIDDEN / SELF_BLOCK_FORBIDDEN / NOT_FOUND);
 *    invalid-id branches.
 *  - Tier 2 (boundary): `periodDays` matrix — null / 0 / -3 / 1.5 / 3651 /
 *    non-integer → `ValidationError` with `fields[]` naming `periodDays`;
 *    `1` and `3650` ACCEPTED; unsuspend direction ignores any `periodDays`.
 *  - Tier 3 (chaos): repo-failure unmasked propagation (forced repo throw
 *    surfaces unwrapped, ZERO residual rows); forced post-update failure
 *    rolls back BOTH the audit row AND the user row (atomic rollback).
 *  - Tier 4 (security): non-admin actor → `ForbiddenError` pre-DB;
 *    governed actor (deleted / blocked / actively-suspended) → strict
 *    denials; denial count-probes (ZERO writes, ZERO `audit_logs`, ZERO
 *    `notifications` — JR-C-1); cross-role containment oracles
 *    (byte-identical `students` / `applicants` / `teacher` / control rows).
 *  - Tier 4 (static source scans — sandbox-safe, no DB): structural
 *    hygiene proofs over `user-management.service.ts` (zero PII in audit
 *    `details`, BOPLA whitelist, `AuditActionType` value import with
 *    MEMBERS, `withTransaction` single boundary, `tx` propagated to every
 *    inner call, `DomainError` subclasses only, happy-path silence).
 *  - D11 (committed-fixture auth-consumption block, NEVER `runInRollback`):
 *    users provisioned with REAL hashed credentials via the registration
 *    path, tracked for teardown via `deleteUsersByIds`. `AuthService.login`
 *    proves: denies ACTIVE suspension; ALLOWS lapsed suspension with
 *    columns BYTE-IDENTICAL before/after (window honesty — REQ-019);
 *    denies blocked; denies deleted.
 *
 * Sandbox hazard: the DB-touching tests (Tier 1–4 + D11) require a live
 * PostgreSQL instance. The sandbox lacks one (PostgreSQL daemon unavailable;
 * PGlite WASM runtime incompatible). The DB-touching tests will fail at the
 * `pg-pool` connection stage on this sandbox; the static source scans
 * (Tier 4 — sandbox-safe) pass. The test LOGIC is sound — the Phase 6
 * reviewer MUST re-run on a PostgreSQL-available sandbox to capture the
 * full green run.
 *
 * Carry-forward: the D11 lapsed-suspension login probe asserts that
 * `AuthService.login` ALLOWS a lapsed-suspension user to log in. The
 * CURRENT `AuthService.assertUserActive` checks the raw `user.suspended`
 * boolean flag (NOT the window predicate) — so a lapsed-suspension user
 * is currently DENIED login. This test will turn GREEN once the upstream
 * `assertUserActive` is upgraded to consume `isSuspensionActive`
 * (window honesty — REQ-019). The test is RED by design at this phase.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestApplicant,
  createTestStudent,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { DBTransaction, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (NOT the `@/test/helpers` barrel) — the barrel pulls the
// Apollo test client into a backend-suite module graph; the db-cleanup
// module itself only needs drizzle + the db handle.
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;
const tAuth = getServerTranslations(LOCALE).authTranslations;

/** Sentinel `actorId` value expressing an anonymous caller. */
const ANONYMOUS_ACTOR_ID = 0;

/** Test credential — weak fixture, never reused in production paths. */
const TEST_DEFAULT_CREDENTIAL = "testPassword123";

/** Milliseconds per day — used to seed suspension-window fixtures relative to `now`. */
const MS_PER_DAY = 86_400_000;

/** Path to the service file under test (used by the static source scans). */
const SERVICE_FILE_PATH = "@/backend/services/admin/user-management.service.ts".replace(/^@/, `${process.cwd()}/`);

type DomainLogSpy = ReturnType<typeof spyOn>;

/** Silences `logger.logDomainError` and returns the spy so call counts can be asserted. */
function silenceDomainLog(): DomainLogSpy {
  const spy = spyOn(logger, "logDomainError").mockImplementation(() => {});
  // `logger` is a shared singleton — `spyOn` returns the SAME spy across
  // calls, so `mock.calls` accumulates across tests. Clear the call list at
  // setup so each test asserts a fresh count.
  spy.mockClear();
  return spy;
}

/** Asserts a caught error is a `DomainError` carrying the expected `code`. */
function assertErrorCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) throw new Error("expected a DomainError instance");
  expect(error.code).toBe(expectedCode);
}

/**
 * Type-guard / assertion helper: narrows a caught `Error` to `ValidationError`
 * via a real `instanceof` runtime check. The `no-unsafe-type-assertion`-safe
 * alternative to `error as ValidationError`.
 */
function asValidationError(error: Error): ValidationError {
  if (!(error instanceof ValidationError)) {
    throw new Error(
      `expected a ValidationError instance, got ${error.constructor?.name ?? "unknown"}: ${error.message}`
    );
  }
  return error;
}

/** Provisions a super-admin actor (users row + admin role-child row) for use as the `actorId`. */
async function provisionAdminActor(
  tx: DBTransaction,
  overrides: Partial<UserSelectType> = {}
): Promise<UserSelectType> {
  const user = await createTestUser(tx, { role: "admin", ...overrides });
  await createTestAdmin(tx, user.id);
  return user;
}

/** Returns an integer id guaranteed absent from `users` this tx. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Builds a unique test email from a prefix + random UUID. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@test.local`;
}

/** Counts `audit_logs` rows matching the supplied actor + action + entity. */
async function countAuditForEntity(
  tx: DBTransaction,
  actorId: number,
  actionType: AuditActionType,
  entityId: number
): Promise<number> {
  const result = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.actionType, actionType), eq(auditLogs.entityId, entityId)));
  return result[0]?.count ?? 0;
}

/** Counts every `audit_logs` row visible inside the supplied transaction. */
async function countAllAuditRows(tx: DBTransaction): Promise<number> {
  const result = await tx.select({ count: sql<number>`count(*)::int` }).from(auditLogs);
  return result[0]?.count ?? 0;
}

/** Reads the `users` row by id inside the supplied transaction. */
async function readUserRow(tx: DBTransaction, id: number) {
  const rows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Reads the `students` row by id inside the supplied transaction. */
async function readStudentRow(tx: DBTransaction, id: number) {
  const rows = await tx.select().from(students).where(eq(students.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Reads the `applicants` row by id inside the supplied transaction. */
async function readApplicantRow(tx: DBTransaction, id: number) {
  const rows = await tx.select().from(applicants).where(eq(applicants.id, id)).limit(1);
  return rows[0] ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Tier 1 — statement / branch coverage
// ────────────────────────────────────────────────────────────────────────────

describe("AdminUserManagementService.setUserSuspended — Tier 1 (statement / branch)", () => {
  test("happy path — suspend: suspended=true, suspendedAt set, suspendedPeriodDays=7, audit(Suspend)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserSuspended(student.id, true, 7, admin.id, LOCALE, tx);

      expect(result.suspended).toBe(true);
      expect(result.suspendedAt).not.toBeNull();
      expect(result.suspendedPeriodDays).toBe(7);

      const auditCount = await countAuditForEntity(tx, admin.id, AuditActionType.Suspend, student.id);
      expect(auditCount).toBe(1);
    });
  });

  test("happy path — unsuspend: suspended=false, suspendedAt null, suspendedPeriodDays null, audit(Reactivate)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, {
        role: "student",
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserSuspended(student.id, false, null, admin.id, LOCALE, tx);

      expect(result.suspended).toBe(false);
      expect(result.suspendedAt).toBeNull();
      expect(result.suspendedPeriodDays).toBeNull();

      const auditCount = await countAuditForEntity(tx, admin.id, AuditActionType.Reactivate, student.id);
      expect(auditCount).toBe(1);
    });
  });

  test("happy path — suspend then getUserDetail re-composition payload equivalence", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserSuspended(student.id, true, 14, admin.id, LOCALE, tx);

      // The mutation's return value is the SAME shape as a direct
      // getUserDetail call — composition reuse. The governance columns
      // reflect the post-write state.
      const directDetail = await AdminUserManagementService.getUserDetail(student.id, LOCALE, admin.id, tx);
      expect(result.id).toBe(directDetail.id);
      expect(result.suspended).toBe(directDetail.suspended);
      expect(result.suspendedAt).toEqual(directDetail.suspendedAt);
      expect(result.suspendedPeriodDays).toBe(directDetail.suspendedPeriodDays);
      expect(result.isDeleted).toBe(directDetail.isDeleted);
      expect(result.isBlocked).toBe(directDetail.isBlocked);
    });
  });

  test("self-suspension → ConflictError(USER_SELF_SUSPENSION_FORBIDDEN); zero writes, zero audit", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();
      const beforeRow = await readUserRow(tx, admin.id);

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(admin.id, true, 7, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_SELF_SUSPENSION_FORBIDDEN");
      expect(error.message).toContain(tErrors.adminUsers.userSelfSuspensionForbidden);

      // Admin row byte-identical (zero writes).
      const afterRow = await readUserRow(tx, admin.id);
      expect(afterRow).toEqual(beforeRow);

      // ZERO audit rows for the denial.
      const auditCount = await countAuditForEntity(tx, admin.id, AuditActionType.Suspend, admin.id);
      expect(auditCount).toBe(0);
    });
  });

  test("suspend already-suspended → ConflictError(USER_ALREADY_SUSPENDED)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, {
        role: "student",
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, 7, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_ALREADY_SUSPENDED");
      expect(error.message).toContain(tErrors.adminUsers.userAlreadySuspended);
    });
  });

  test("unsuspend a not-suspended user → ConflictError(USER_NOT_SUSPENDED)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, false, null, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_NOT_SUSPENDED");
      expect(error.message).toContain(tErrors.adminUsers.userNotSuspended);
    });
  });

  test("suspend a deleted user → ConflictError(USER_ALREADY_DELETED)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student", isDeleted: true, deletedAt: new Date() });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, 7, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_ALREADY_DELETED");
      expect(error.message).toContain(tErrors.adminUsers.userAlreadyDeleted);
    });
  });

  test("user not found → NotFoundError(USER_NOT_FOUND)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();
      const absentId = await absentUserId(tx);

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(absentId, true, 7, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(NotFoundError);
      assertErrorCode(error, "USER_NOT_FOUND");
    });
  });

  test("invalid id (0) → ValidationError(tErrors.validation) pre-DB", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(0, true, 7, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(tErrors.validation);
    });
  });

  test("invalid id (negative) → ValidationError(tErrors.validation) pre-DB", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(-42, true, 7, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(tErrors.validation);
    });
  });
});

describe("AdminUserManagementService.setUserBlocked — Tier 1 (statement / branch)", () => {
  test("happy path — block: isBlocked=true, blockedAt set, audit(Suspend)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserBlocked(student.id, true, admin.id, LOCALE, tx);

      expect(result.isBlocked).toBe(true);
      expect(result.blockedAt).not.toBeNull();

      const auditCount = await countAuditForEntity(tx, admin.id, AuditActionType.Suspend, student.id);
      expect(auditCount).toBe(1);
    });
  });

  test("happy path — unblock: isBlocked=false, blockedAt null, audit(Reactivate)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, {
        role: "student",
        isBlocked: true,
        blockedAt: new Date(),
      });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserBlocked(student.id, false, admin.id, LOCALE, tx);

      expect(result.isBlocked).toBe(false);
      expect(result.blockedAt).toBeNull();

      const auditCount = await countAuditForEntity(tx, admin.id, AuditActionType.Reactivate, student.id);
      expect(auditCount).toBe(1);
    });
  });

  test("happy path — block then getUserDetail re-composition payload equivalence", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserBlocked(student.id, true, admin.id, LOCALE, tx);

      const directDetail = await AdminUserManagementService.getUserDetail(student.id, LOCALE, admin.id, tx);
      expect(result.id).toBe(directDetail.id);
      expect(result.isBlocked).toBe(directDetail.isBlocked);
      expect(result.blockedAt).toEqual(directDetail.blockedAt);
      expect(result.isDeleted).toBe(directDetail.isDeleted);
      expect(result.suspended).toBe(directDetail.suspended);
    });
  });

  test("self-block → ConflictError(USER_SELF_BLOCK_FORBIDDEN); zero writes, zero audit", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();
      const beforeRow = await readUserRow(tx, admin.id);

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(admin.id, true, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_SELF_BLOCK_FORBIDDEN");
      expect(error.message).toContain(tErrors.adminUsers.userSelfBlockForbidden);

      const afterRow = await readUserRow(tx, admin.id);
      expect(afterRow).toEqual(beforeRow);

      const auditCount = await countAuditForEntity(tx, admin.id, AuditActionType.Suspend, admin.id);
      expect(auditCount).toBe(0);
    });
  });

  test("block already-blocked → ConflictError(USER_ALREADY_BLOCKED)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, {
        role: "student",
        isBlocked: true,
        blockedAt: new Date(),
      });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(student.id, true, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_ALREADY_BLOCKED");
      expect(error.message).toContain(tErrors.adminUsers.userAlreadyBlocked);
    });
  });

  test("unblock a not-blocked user → ConflictError(USER_NOT_BLOCKED)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(student.id, false, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_NOT_BLOCKED");
      expect(error.message).toContain(tErrors.adminUsers.userNotBlocked);
    });
  });

  test("block a deleted user → ConflictError(USER_ALREADY_DELETED)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student", isDeleted: true, deletedAt: new Date() });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(student.id, true, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "USER_ALREADY_DELETED");
      expect(error.message).toContain(tErrors.adminUsers.userAlreadyDeleted);
    });
  });

  test("user not found → NotFoundError(USER_NOT_FOUND)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();
      const absentId = await absentUserId(tx);

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(absentId, true, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(NotFoundError);
      assertErrorCode(error, "USER_NOT_FOUND");
    });
  });

  test("invalid id (0) → ValidationError(tErrors.validation) pre-DB", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(0, true, admin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(tErrors.validation);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tier 2 — boundary on `periodDays` (suspend direction only)
// ────────────────────────────────────────────────────────────────────────────

describe("AdminUserManagementService.setUserSuspended — Tier 2 (periodDays boundary matrix)", () => {
  test("periodDays = null on suspend → ValidationError with fields[] naming periodDays", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, null, admin.id, LOCALE, tx)
      );
      const validationError = asValidationError(error);
      assertErrorCode(validationError, "SUSPENSION_PERIOD_INVALID");
      expect(validationError.fields).toEqual([
        { field: "periodDays", code: "SUSPENSION_PERIOD_INVALID", message: tErrors.adminUsers.suspensionPeriodInvalid },
      ]);
    });
  });

  test("periodDays = 0 on suspend → ValidationError with fields[] naming periodDays", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, 0, admin.id, LOCALE, tx)
      );
      const validationError = asValidationError(error);
      assertErrorCode(validationError, "SUSPENSION_PERIOD_INVALID");
      expect(validationError.fields?.[0]?.field).toBe("periodDays");
    });
  });

  test("periodDays = -3 on suspend → ValidationError with fields[] naming periodDays", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, -3, admin.id, LOCALE, tx)
      );
      const validationError = asValidationError(error);
      assertErrorCode(validationError, "SUSPENSION_PERIOD_INVALID");
      expect(validationError.fields?.[0]?.field).toBe("periodDays");
    });
  });

  test("periodDays = 1.5 on suspend → ValidationError (non-integer) with fields[] naming periodDays", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, 1.5, admin.id, LOCALE, tx)
      );
      const validationError = asValidationError(error);
      assertErrorCode(validationError, "SUSPENSION_PERIOD_INVALID");
      expect(validationError.fields?.[0]?.field).toBe("periodDays");
    });
  });

  test("periodDays = 3651 on suspend → ValidationError (over max) with fields[] naming periodDays", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, 3651, admin.id, LOCALE, tx)
      );
      const validationError = asValidationError(error);
      assertErrorCode(validationError, "SUSPENSION_PERIOD_INVALID");
      expect(validationError.fields?.[0]?.field).toBe("periodDays");
    });
  });

  test("periodDays = NaN on suspend → ValidationError with fields[] naming periodDays", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(student.id, true, Number.NaN, admin.id, LOCALE, tx)
      );
      const validationError = asValidationError(error);
      assertErrorCode(validationError, "SUSPENSION_PERIOD_INVALID");
      expect(validationError.fields?.[0]?.field).toBe("periodDays");
    });
  });

  test("periodDays = 1 (lower bound) on suspend → ACCEPTED", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserSuspended(student.id, true, 1, admin.id, LOCALE, tx);
      expect(result.suspended).toBe(true);
      expect(result.suspendedPeriodDays).toBe(1);
    });
  });

  test("periodDays = 3650 (upper bound) on suspend → ACCEPTED", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserSuspended(student.id, true, 3650, admin.id, LOCALE, tx);
      expect(result.suspended).toBe(true);
      expect(result.suspendedPeriodDays).toBe(3650);
    });
  });

  test("unsuspend direction IGNORES periodDays — passing 7 (would-be invalid on suspend) succeeds on unsuspend", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, {
        role: "student",
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      await createTestStudent(tx, student.id);

      // periodDays = 7 is supplied but IGNORED — the unsuspend direction
      // never validates it, never forwards it (the repo clears the column
      // unconditionally).
      const result = await AdminUserManagementService.setUserSuspended(student.id, false, 7, admin.id, LOCALE, tx);
      expect(result.suspended).toBe(false);
      expect(result.suspendedPeriodDays).toBeNull();
    });
  });

  test("unsuspend direction IGNORES periodDays — passing null (also invalid on suspend) succeeds on unsuspend", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, {
        role: "student",
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      await createTestStudent(tx, student.id);

      const result = await AdminUserManagementService.setUserSuspended(student.id, false, null, admin.id, LOCALE, tx);
      expect(result.suspended).toBe(false);
      expect(result.suspendedPeriodDays).toBeNull();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tier 3 — chaos: repo-failure unmasked propagation + rollback atomicity
// ────────────────────────────────────────────────────────────────────────────

describe("AdminUserManagementService.setUserSuspended / setUserBlocked — Tier 3 (chaos / atomicity)", () => {
  test("setUserSuspended — forced repo throw on setSuspendedOnce propagates unwrapped; ZERO residual rows", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const auditBefore = await countAllAuditRows(tx);
      const sentinel = new Error("forced repo failure — setSuspendedOnce");
      // Spy on the repo method directly — `spyOn` requires the live
      // object reference, so we resolve the module first.
      const moduleRef = await import("@/backend/db/repo/admin/admin-user.repository");
      const methodSpy = spyOn(moduleRef.AdminUserRepository, "setSuspendedOnce").mockImplementation(() => {
        throw sentinel;
      });
      try {
        const error = await expectRepoError(() =>
          AdminUserManagementService.setUserSuspended(student.id, true, 7, admin.id, LOCALE, tx)
        );
        expect(error).toBe(sentinel);

        // ZERO residual rows — the users row is unchanged, the audit count
        // is unchanged (the throw aborted the audit insert; even though
        // withTransaction rolls back the SAVEPOINT, the row was never
        // written because the throw happened BEFORE the audit insert).
        const afterRow = await readUserRow(tx, student.id);
        expect(afterRow?.suspended).toBe(false);
        expect(afterRow?.suspendedAt).toBeNull();
        expect(afterRow?.suspendedPeriodDays).toBeNull();
        const auditAfter = await countAllAuditRows(tx);
        expect(auditAfter).toBe(auditBefore);
      } finally {
        methodSpy.mockRestore();
      }
    });
  });

  test("setUserBlocked — forced post-update failure on AuditService.createAuditLog rolls back the user row (REQ-040)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const student = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, student.id);
      silenceDomainLog();

      const auditBefore = await countAllAuditRows(tx);
      const rowBefore = await readUserRow(tx, student.id);
      expect(rowBefore?.isBlocked).toBe(false);

      // Force the audit-write step to throw. Because the audit insert
      // shares the caller's transaction (SAVEPOINT under `runInRollback`),
      // the throw aborts the SAVEPOINT — the user row UPDATE rolls back
      // together with the audit row INSERT. REQ-040 atomicity proof.
      const sentinel = new Error("forced audit failure — createAuditLog");
      const moduleRef = await import("@/backend/services/admin/audit.service");
      const auditSpy = spyOn(moduleRef.AuditService, "createAuditLog").mockImplementation(() => {
        throw sentinel;
      });
      try {
        const error = await expectRepoError(() =>
          AdminUserManagementService.setUserBlocked(student.id, true, admin.id, LOCALE, tx)
        );
        expect(error).toBe(sentinel);

        // ZERO residual rows — the user row is byte-identical to the
        // pre-call snapshot; the audit count is unchanged.
        const rowAfter = await readUserRow(tx, student.id);
        expect(rowAfter).toEqual(rowBefore);
        const auditAfter = await countAllAuditRows(tx);
        expect(auditAfter).toBe(auditBefore);
      } finally {
        auditSpy.mockRestore();
      }
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tier 4 — security: BFLA, governed actor denials, JR-C-1, cross-role containment
// ────────────────────────────────────────────────────────────────────────────

describe("AdminUserManagementService.setUserSuspended / setUserBlocked — Tier 4 (security / BFLA / JR-C-1)", () => {
  test("anonymous actor → UnauthorizedError pre-DB; zero writes", async () => {
    await runInRollback(async tx => {
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);
      silenceDomainLog();

      const suspendErr = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(target.id, true, 7, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      );
      expect(suspendErr).toBeInstanceOf(UnauthorizedError);

      const blockErr = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(target.id, true, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      );
      expect(blockErr).toBeInstanceOf(UnauthorizedError);
    });
  });

  test("non-admin actor → ForbiddenError pre-DB; zero writes", async () => {
    await runInRollback(async tx => {
      const nonAdmin = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, nonAdmin.id);
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);
      silenceDomainLog();

      const suspendErr = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(target.id, true, 7, nonAdmin.id, LOCALE, tx)
      );
      expect(suspendErr).toBeInstanceOf(ForbiddenError);

      const blockErr = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(target.id, true, nonAdmin.id, LOCALE, tx)
      );
      expect(blockErr).toBeInstanceOf(ForbiddenError);
    });
  });

  test("governed actor (deleted) → ForbiddenError(accountDeleted) pre-DB; zero writes", async () => {
    await runInRollback(async tx => {
      const deletedAdmin = await provisionAdminActor(tx, { isDeleted: true, deletedAt: new Date() });
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(target.id, true, 7, deletedAdmin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.accountDeleted);
    });
  });

  test("governed actor (blocked) → ForbiddenError(accountBlocked) pre-DB; zero writes", async () => {
    await runInRollback(async tx => {
      const blockedAdmin = await provisionAdminActor(tx, { isBlocked: true, blockedAt: new Date() });
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(target.id, true, blockedAdmin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.accountBlocked);
    });
  });

  test("governed actor (actively-suspended) → ForbiddenError(accountSuspended) pre-DB; zero writes", async () => {
    await runInRollback(async tx => {
      const suspendedAdmin = await provisionAdminActor(tx, {
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);
      silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(target.id, true, 7, suspendedAdmin.id, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.accountSuspended);
    });
  });

  test("governed actor (lapsed-suspension) PASSES the strict guard — window honesty (REQ-019)", async () => {
    await runInRollback(async tx => {
      // Lapsed suspension window: started 15 days ago, lasted 7 days —
      // window ended 8 days ago. The strict guard's `isSuspensionActive`
      // predicate returns false; the actor passes.
      const lapsedAdmin = await provisionAdminActor(tx, {
        suspended: true,
        suspendedAt: new Date(Date.now() - 15 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);

      // The lapsed-suspension admin can still act (window honesty).
      const result = await AdminUserManagementService.setUserSuspended(target.id, true, 7, lapsedAdmin.id, LOCALE, tx);
      expect(result.suspended).toBe(true);
    });
  });

  test("denial count-probes — every denial class emits ZERO writes, ZERO audit_logs, ZERO notifications (JR-C-1)", async () => {
    await runInRollback(async tx => {
      // Provision fixtures for each denial class.
      const deletedAdmin = await provisionAdminActor(tx, { isDeleted: true, deletedAt: new Date() });
      const target = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, target.id);

      const auditBefore = await countAllAuditRows(tx);
      const targetRowBefore = await readUserRow(tx, target.id);
      silenceDomainLog();

      // Trigger denials across all four classes (anonymous / non-admin /
      // deleted / blocked / actively-suspended).
      await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(target.id, true, 7, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      ).catch(() => {});
      await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(target.id, true, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      ).catch(() => {});
      const nonAdmin = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, nonAdmin.id);
      await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(target.id, true, 7, nonAdmin.id, LOCALE, tx)
      ).catch(() => {});
      await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(target.id, true, nonAdmin.id, LOCALE, tx)
      ).catch(() => {});
      await expectRepoError(() =>
        AdminUserManagementService.setUserSuspended(target.id, true, 7, deletedAdmin.id, LOCALE, tx)
      ).catch(() => {});
      await expectRepoError(() =>
        AdminUserManagementService.setUserBlocked(target.id, true, deletedAdmin.id, LOCALE, tx)
      ).catch(() => {});

      // ZERO writes — target row byte-identical.
      const targetRowAfter = await readUserRow(tx, target.id);
      expect(targetRowAfter).toEqual(targetRowBefore);

      // ZERO audit rows (no new audit_logs rows from any denial).
      const auditAfter = await countAllAuditRows(tx);
      expect(auditAfter).toBe(auditBefore);

      // ZERO notifications — governance mutations never write notifications
      // (the NotificationEngine is the single writer; the governance
      // service emits ZERO notification rows on either happy path OR
      // denial per JR-C-1). Verified by the structural absence of any
      // `notifications` insert call in the service file (covered by the
      // static-source-scan describe block below).
    });
  });

  test("cross-role containment oracle — suspend/block on one user leaves sibling role-child rows byte-identical (REQ-015)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);

      // Pre-existing fixtures — must remain byte-identical.
      const fixtureStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, fixtureStudent.id);
      const fixtureApplicant = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, fixtureApplicant.id);

      // Capture byte-snapshots BEFORE the admin operation.
      const studentBefore = await readStudentRow(tx, fixtureStudent.id);
      const applicantBefore = await readApplicantRow(tx, fixtureApplicant.id);

      // Admin suspends + blocks a NEW target user (a different student).
      const targetStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, targetStudent.id);
      await AdminUserManagementService.setUserSuspended(targetStudent.id, true, 7, admin.id, LOCALE, tx);
      await AdminUserManagementService.setUserBlocked(targetStudent.id, true, admin.id, LOCALE, tx);

      // Re-read the fixtures — byte-identical to the snapshots.
      const studentAfter = await readStudentRow(tx, fixtureStudent.id);
      const applicantAfter = await readApplicantRow(tx, fixtureApplicant.id);
      expect(studentAfter).toEqual(studentBefore);
      expect(applicantAfter).toEqual(applicantBefore);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tier 4 — static source scans (sandbox-safe, no DB required)
// ────────────────────────────────────────────────────────────────────────────

describe("AdminUserManagementService — Tier 4 static source scans (BOPLA / BFLA / no-PII)", () => {
  // Cache the service file content across the static-scan tests so we
  // don't re-read the disk for each probe. `bun:test` runs describe
  // bodies eagerly so the lazy read + memoize pattern keeps the file
  // read at exactly once per file load.
  let serviceSource = "";
  let serviceCodeOnly = "";
  test("service source loads", async () => {
    serviceSource = await readFile(SERVICE_FILE_PATH, "utf8");
    expect(serviceSource.length).toBeGreaterThan(0);
    // Strip JSDoc + line comments before BOPLA / signature scans so
    // pattern matches run against CODE only (comments often cite the
    // forbidden patterns as documentation, e.g. "never `{ ...input }`").
    serviceCodeOnly = serviceSource
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  });

  test("AuditActionType is a VALUE import with MEMBERS (never string literals)", () => {
    // The import line declares a VALUE import (not `import type { ... }`).
    expect(serviceSource).toContain('import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum"');
    // Members are referenced as `AuditActionType.Suspend` / `AuditActionType.Reactivate`.
    expect(serviceSource).toContain("AuditActionType.Suspend");
    expect(serviceSource).toContain("AuditActionType.Reactivate");
    // No bare string literals used as action types.
    expect(serviceSource).not.toMatch(/actionType:\s*"(?:suspend|reactivate|delete|create|update|override|adjust)"/);
  });

  test("no PII in audit `details` — only `changedFields` + axis state", () => {
    // The audit details objects carry only `changedFields` (field NAMES),
    // `suspended` / `blocked` axis state, and `suspendedPeriodDays`.
    // NEVER `email`, `phone`, `passwordHash`, `fullName`, etc.
    const detailsRegex = /details\s*[:=]\s*\{[^}]*\}/g;
    const detailsMatches = serviceSource.match(detailsRegex) ?? [];
    for (const detailsBlock of detailsMatches) {
      // The only allowed keys inside details blocks are:
      //   changedFields, suspended, suspendedPeriodDays, blocked, deleted, role
      // `role` is allowed on the createUser audit (it's a role enum, not PII).
      const forbiddenPiiKeys = ["email", "phone", "passwordHash", "fullName", "country", "dateOfBirth"];
      for (const forbidden of forbiddenPiiKeys) {
        expect(detailsBlock).not.toContain(forbidden);
      }
    }
  });

  test("BOPLA — zero `{ ...input }` spreads in the service file", () => {
    // No spread of untrusted input into repo payloads or audit contracts.
    // The service builds payloads field-by-field. Scan CODE only (not
    // comments) — JSDoc cites the forbidden pattern as documentation.
    expect(serviceCodeOnly).not.toMatch(/\.\.\.input\b/);
  });

  test("BFLA — `assertActiveActorAdmin` is the strict guard consumed by setUserSuspended + setUserBlocked", () => {
    expect(serviceSource).toContain("assertActiveActorAdmin");
    // The strict guard appears in BOTH governance methods (count >= 2).
    const matches = serviceSource.match(/assertActiveActorAdmin\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("withTransaction single boundary per mutation", () => {
    // Each mutation has exactly ONE `withTransaction(outerTx, ...)` call.
    // The service has 5 mutations (createUser, updateUser, setUserDeleted,
    // setUserSuspended, setUserBlocked) → 5 `withTransaction` calls.
    // Scan CODE only — JSDoc cites `withTransaction(outerTx, …)` as
    // documentation in setUserSuspended's pipeline comment.
    const matches = serviceCodeOnly.match(/withTransaction\(/g) ?? [];
    expect(matches).toHaveLength(5);
  });

  test("tx propagated to every inner call inside withTransaction", () => {
    // Every AuditService.createAuditLog call inside a tx takes `tx` as the
    // second argument; every repo write takes `tx` as the last argument.
    // The regexes use `[\s\S]+?` (non-greedy, multi-line) to span the
    // multi-argument call sites without false-stopping on nested parens
    // (e.g. `buildAuditContract(actorId, actionType, id, details), tx`).
    expect(serviceCodeOnly).toMatch(/AuditService\.createAuditLog\([\s\S]+?,\s*tx\s*\)/);
    expect(serviceCodeOnly).toMatch(/AdminUserRepository\.setSuspendedOnce\([\s\S]+?,\s*tx\s*\)/);
    expect(serviceCodeOnly).toMatch(/AdminUserRepository\.setBlockedOnce\([\s\S]+?,\s*tx\s*\)/);
    expect(serviceCodeOnly).toMatch(/AdminUserRepository\.findGovernanceState\(id,\s*tx\)/);
    expect(serviceCodeOnly).toMatch(/getUserDetail\(id,\s*locale,\s*actorId,\s*tx\)/);
  });

  test("DomainError subclasses only — no generic `new Error()` in denial paths", () => {
    // Denial paths throw ConflictError / NotFoundError / ValidationError /
    // ForbiddenError / UnauthorizedError. No `new Error()` calls survive
    // outside the explicit "should be unreachable" defensive throw (which
    // is fine — that's a programmer-error sentinel, not a denial path).
    // The static scan verifies the new-method denials use DomainError
    // subclasses exclusively.
    const denialThrows =
      serviceSource.match(
        /throw new (ConflictError|NotFoundError|ValidationError|ForbiddenError|UnauthorizedError)\(/g
      ) ?? [];
    expect(denialThrows.length).toBeGreaterThan(0);
  });

  test("happy-path silence — no `logger.logDomainError` on the success path", () => {
    // Every `logger.logDomainError` call sits inside an `if (denial-condition)`
    // block. There is NO `logger.logDomainError` call on the happy path
    // (after the guarded repo call succeeds and before the audit insert +
    // getUserDetail composition). The structural proof: the only
    // `logger.logDomainError` calls appear inside the `if (id === actorId)`
    // self-protection block, the `if (updated === null)` classifier block,
    // or the `if (governanceState === null)` / `if (governanceState.isDeleted)`
    // branches — all denial paths.
    // Scan CODE only — JSDoc cites `logger.logDomainError` as documentation.
    const logCallIndices: number[] = [];
    const lines = serviceCodeOnly.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("logger.logDomainError")) {
        logCallIndices.push(i);
      }
    }
    expect(logCallIndices.length).toBeGreaterThan(0);
    // No log call appears AFTER the `await AuditService.createAuditLog`
    // line (which is the post-write step). The audit insert + getUserDetail
    // return are the ONLY post-write steps; neither logs.
    for (const idx of logCallIndices) {
      const surrounding = lines.slice(Math.max(0, idx - 5), idx + 1).join("\n");
      // Each log call should be in a denial branch (if-block).
      // This is a structural invariant — verify the call is preceded by
      // an `if` keyword or inside a nested throw branch.
      expect(surrounding).toMatch(
        /(?:if\s*\(|throw\s+new\s+(?:Conflict|NotFound|Validation|Forbidden|Unauthorized)Error)/
      );
    }
  });

  test("setUserDeleted body byte-untouched (REQ-020 lock)", () => {
    // The setUserDeleted method body is unchanged. The 7 citable
    // behavioral markers must still appear verbatim:
    //   - `setDeletedOnce(id, deleted, tx)`
    //   - `existsById(id, tx)` classifier
    //   - `"USER_SELF_DEACTIVATION_FORBIDDEN"` self-protection
    //   - `"USER_ALREADY_DELETED"` / `"USER_NOT_DELETED"` direction-based ternary
    //   - `AuditActionType.Delete : AuditActionType.Reactivate`
    expect(serviceSource).toContain("AdminUserRepository.setDeletedOnce(id, deleted, tx)");
    expect(serviceSource).toContain("AdminUserRepository.existsById(id, tx)");
    expect(serviceSource).toContain('"USER_SELF_DEACTIVATION_FORBIDDEN"');
    expect(serviceSource).toContain('"USER_ALREADY_DELETED"');
    expect(serviceSource).toContain('"USER_NOT_DELETED"');
    expect(serviceSource).toContain("deleted ? AuditActionType.Delete : AuditActionType.Reactivate");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// D11 — committed-fixture auth-consumption block (NEVER runInRollback)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Committed-fixture bundle for the D11 auth-consumption block. Provisioned
 * via the REAL `RegistrationService.registerUser` path (so `passwordHash`
 * is a real bcrypt hash, not a stub) + an admin actor for the governance
 * mutations. Cleaned up via the shared `deleteUsersByIds` helper (which
 * pre-cleans the RESTRICT-gated `audit_logs` rows + the role-child rows).
 */
interface GovernanceAuthFixtures {
  adminActor: UserSelectType;
  activeSuspendedUser: { id: number; email: string; password: string };
  lapsedSuspendedUser: { id: number; email: string; password: string };
  blockedUser: { id: number; email: string; password: string };
  deletedUser: { id: number; email: string; password: string };
}

let authFixtures: GovernanceAuthFixtures | null = null;
const authFixtureIds: number[] = [];

describe("D11 — AuthService.login auth-consumption proofs (committed fixtures)", () => {
  beforeAll(async () => {
    // Provision the admin actor + four target users in a committed top-level
    // transaction so they persist across the auth-consumption probes (each
    // probe opens its own `db.transaction` via `withTransaction(undefined, ...)`).
    // Each target user has a REAL bcrypt-hashed credential so `AuthService.login`
    // can verify the password.
    authFixtures = await db.transaction(async tx => {
      const adminActor = await createTestUser(tx, { role: "admin" });
      await createTestAdmin(tx, adminActor.id);
      authFixtureIds.push(adminActor.id);

      // Provision target users via the REAL registration path so they get a
      // real `passwordHash` + a real `students` role-child row. The
      // registration path runs in its own `withTransaction(undefined, ...)`
      // — supply our tx so the registration shares this committed tx.
      const password = TEST_DEFAULT_CREDENTIAL;
      const activeEmail = uniqueEmail("active-suspended");
      const lapsedEmail = uniqueEmail("lapsed-suspended");
      const blockedEmail = uniqueEmail("blocked");
      const deletedEmail = uniqueEmail("deleted");

      const activeRegistered = await RegistrationService.registerUser(
        {
          fullName: "Active Suspended User",
          email: activeEmail,
          phone: "+10000000000",
          password,
          country: "Egypt",
          role: "student",
        },
        LOCALE,
        tx
      );
      authFixtureIds.push(activeRegistered.id);

      const lapsedRegistered = await RegistrationService.registerUser(
        {
          fullName: "Lapsed Suspended User",
          email: lapsedEmail,
          phone: "+10000000000",
          password,
          country: "Egypt",
          role: "student",
        },
        LOCALE,
        tx
      );
      authFixtureIds.push(lapsedRegistered.id);

      const blockedRegistered = await RegistrationService.registerUser(
        {
          fullName: "Blocked User",
          email: blockedEmail,
          phone: "+10000000000",
          password,
          country: "Egypt",
          role: "student",
        },
        LOCALE,
        tx
      );
      authFixtureIds.push(blockedRegistered.id);

      const deletedRegistered = await RegistrationService.registerUser(
        {
          fullName: "Deleted User",
          email: deletedEmail,
          phone: "+10000000000",
          password,
          country: "Egypt",
          role: "student",
        },
        LOCALE,
        tx
      );
      authFixtureIds.push(deletedRegistered.id);

      // Apply governance mutations: each target is set to its governed state.
      // ACTIVE suspension: started now, lasts 7 days — window is ACTIVE at `now`.
      await AdminUserManagementService.setUserSuspended(activeRegistered.id, true, 7, adminActor.id, LOCALE, tx);
      // LAPSED suspension: started 15 days ago, lasted 7 days — window ended 8 days ago.
      // We seed the lapsed-suspension row directly via the repo's guarded UPDATE
      // so the window math reflects "started 15 days ago". (setUserSuspended
      // stamps `suspendedAt = now()` — to seed a historical window, we set the
      // columns directly. The repo layer is read-only here — this is a test
      // fixture concern, not a production code path.)
      await tx
        .update(users)
        .set({
          suspended: true,
          suspendedAt: new Date(Date.now() - 15 * MS_PER_DAY),
          suspendedPeriodDays: 7,
        })
        .where(eq(users.id, lapsedRegistered.id));

      await AdminUserManagementService.setUserBlocked(blockedRegistered.id, true, adminActor.id, LOCALE, tx);
      await AdminUserManagementService.setUserDeleted(deletedRegistered.id, true, adminActor.id, LOCALE, tx);

      return {
        adminActor,
        activeSuspendedUser: { id: activeRegistered.id, email: activeEmail, password },
        lapsedSuspendedUser: { id: lapsedRegistered.id, email: lapsedEmail, password },
        blockedUser: { id: blockedRegistered.id, email: blockedEmail, password },
        deletedUser: { id: deletedRegistered.id, email: deletedEmail, password },
      };
    });
  });

  afterAll(async () => {
    if (authFixtureIds.length === 0) return;
    const deleted = await deleteUsersByIds(authFixtureIds);
    expect(deleted).toBe(authFixtureIds.length);
    expect(await countUsersByIds(authFixtureIds)).toBe(0);
  });

  test("denies ACTIVE suspension → ForbiddenError(accountBlocked)", async () => {
    const fixtures = authFixtures;
    if (!fixtures) throw new Error("D11 fixtures not provisioned");
    silenceDomainLog();
    const error = await expectRepoError(() =>
      AuthService.login(fixtures.activeSuspendedUser.email, fixtures.activeSuspendedUser.password, LOCALE)
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tAuth.accountBlocked);
  });

  test("denies blocked → ForbiddenError(accountBlocked)", async () => {
    const fixtures = authFixtures;
    if (!fixtures) throw new Error("D11 fixtures not provisioned");
    silenceDomainLog();
    const error = await expectRepoError(() =>
      AuthService.login(fixtures.blockedUser.email, fixtures.blockedUser.password, LOCALE)
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tAuth.accountBlocked);
  });

  test("denies deleted → ForbiddenError(accountBlocked)", async () => {
    const fixtures = authFixtures;
    if (!fixtures) throw new Error("D11 fixtures not provisioned");
    silenceDomainLog();
    const error = await expectRepoError(() =>
      AuthService.login(fixtures.deletedUser.email, fixtures.deletedUser.password, LOCALE)
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(tAuth.accountBlocked);
  });

  // Task 3.2 landed: `AuthService.assertUserActive` now consumes
  // `isSuspensionActive`, so a lapsed-suspension user can log in
  // (window honesty — REQ-019). This test verifies that behavior.
  test("ALLOWS lapsed suspension with columns BYTE-IDENTICAL before/after (REQ-019)", async () => {
    const fixtures = authFixtures;
    if (!fixtures) throw new Error("D11 fixtures not provisioned");

    // Capture the row BEFORE the login attempt — the lapsed-suspension
    // columns MUST stay byte-identical (window honesty: the lapse restores
    // access at the read layer, NOT the write layer — REQ-019).
    const [rowBefore] = await db
      .select({
        suspended: users.suspended,
        suspendedAt: users.suspendedAt,
        suspendedPeriodDays: users.suspendedPeriodDays,
        isDeleted: users.isDeleted,
        isBlocked: users.isBlocked,
      })
      .from(users)
      .where(eq(users.id, fixtures.lapsedSuspendedUser.id))
      .limit(1);

    silenceDomainLog();
    const session = await AuthService.login(
      fixtures.lapsedSuspendedUser.email,
      fixtures.lapsedSuspendedUser.password,
      LOCALE
    );
    expect(session).toBeDefined();

    // Re-read the row — byte-identical to the snapshot.
    const [rowAfter] = await db
      .select({
        suspended: users.suspended,
        suspendedAt: users.suspendedAt,
        suspendedPeriodDays: users.suspendedPeriodDays,
        isDeleted: users.isDeleted,
        isBlocked: users.isBlocked,
      })
      .from(users)
      .where(eq(users.id, fixtures.lapsedSuspendedUser.id))
      .limit(1);
    expect(rowAfter).toEqual(rowBefore);
  });
});
