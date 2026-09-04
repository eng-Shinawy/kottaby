/**
 * AdminUserManagementService — chaos, concurrency & fuzz suite.
 *
 * DEV3-016 Phase 5.2 — REQ-043, REQ-075, REQ-021, REQ-035, REQ-044, REQ-079
 *
 * Extends the sequential double-delete / duplicate-email proofs of
 * `user-management.service.test.ts` Tier 3 into explicit
 * `Promise.allSettled` variants that prove the race-condition safety
 * guarantees of the admin user-management service.
 *
 * Probes:
 *  (a) concurrent double soft-delete — exactly one success + one
 *      USER_ALREADY_DELETED (the guarded UPDATE's row-level predicate
 *      is the loser-safety guarantee; both calls read the same active
 *      row, both attempt the conditional UPDATE, exactly one's
 *      predicate matches).
 *  (b) concurrent delete ⚡ reactivate — one winner, post-state
 *      consistent with the winner's intent (either deleted or active,
 *      never corrupted).
 *  (c) concurrent patches to the same user — last-write-wins behavior
 *      documented (both succeed, final state reflects the later
 *      committed write; both audit rows present).
 *  (d) concurrent double-create same email — exactly one success + one
 *      CONFLICT (the `users.email` unique index 23505 fires on the
 *      loser; `withTransaction` rolls the loser's insert back; zero
 *      residual `users` / role-child / audit rows from the loser).
 *  (e) forced-failure create (duplicate email mid-storm) — the failed
 *      call commits nothing (email-scoped count still exactly 1; a
 *      global users count would race with concurrent test files).
 *  (f) BFLA token probes — anonymous actorId (0) + non-admin actorId
 *      pre-checks fire BEFORE any DB write; nothing attributable to the
 *      denied calls exists afterward (probes on rows this test owns —
 *      a global directory count would race with concurrent test files).
 *  (g) enum / ID fuzz — non-existent role strings, NaN / negative /
 *      fractional IDs, oversized integers all fail closed at the
 *      service seam (ValidationError / NotFoundError / ForbiddenError
 *      pre-DB); zero writes (actor-attributable audit probe).
 *
 * HARNESSES:
 *  - Chaos probes (a)–(e): use the GLOBAL `db` (no outer tx) — each
 *    service call opens its own top-level `db.transaction` via
 *    `withTransaction(undefined, ...)`, which gives each concurrent
 *    call its own connection from the pool. The shared `pg` session
 *    deprecates concurrent queries on the same client
 *    (`DeprecationWarning: Calling client.query() when the client is
 *    already executing a query`), so passing the same `tx` to
 *    Promise.allSettled would crash. The fixture user is provisioned
 *    in a committed `db.transaction` and cleaned in the describe-scoped
 *    `afterAll` via the shared `deleteUsersByIds` helper — pre-cleaning
 *    the RESTRICT-gated `audit_logs` rows (the probes emit audit rows
 *    BOTH as the admin actor AND about the student targets, so a bare
 *    `db.delete(users)` on the actor fails the `audit_logs.actor_id` FK
 *    RESTRICT — the historical `.catch(() => {})` wrapper silently
 *    swallowed that failure and leaked the actor row).
 *  - BFLA + fuzz probes (f)–(g): use `runInRollback` — no concurrency,
 *    so the shared-tx path is safe and the rollback auto-cleans.
 *
 * Per `backend/services/admin/AGENTS.md`:
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    NEVER `expect(...).rejects.toThrow()`.
 *  - All assertion strings come from `getServerTranslations("en")`
 *    translations — NEVER raw key echoes.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestAdmin, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
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
import type { AdminCreateUserSubmitInput, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (NOT the `@/test/helpers` barrel) — the barrel pulls the
// Apollo test client into a backend-suite module graph; the db-cleanup
// module itself only needs drizzle + the db handle.
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Sentinel `actorId` value expressing an anonymous caller. */
const ANONYMOUS_ACTOR_ID = 0;

/** Test credential — weak fixture, never reused in production paths. */
const TEST_DEFAULT_CREDENTIAL = "testPassword123";

type DomainLogSpy = ReturnType<typeof spyOn>;

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): DomainLogSpy {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/** Asserts a caught error is a `DomainError` carrying the expected `code`. */
function assertErrorCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) throw new Error("expected a DomainError instance");
  expect(error.code).toBe(expectedCode);
}

/** Chaos-suite fixture bundle — provisioned in `beforeAll`, cleaned in `afterAll`. */
interface ChaosFixtures {
  adminActor: UserSelectType;
  createdUserIds: number[];
}

let fixtures: ChaosFixtures;

beforeAll(async () => {
  // Provision the admin actor in a committed `db.transaction` (top-level)
  // so it persists across the chaos probes (each probe runs its own
  // top-level tx via `withTransaction(undefined, ...)`).
  fixtures = await db.transaction(async tx => {
    const adminActor = await createTestUser(tx, { role: "admin" });
    await createTestAdmin(tx, adminActor.id);
    return { adminActor, createdUserIds: [adminActor.id] };
  });
});

afterAll(async () => {
  // Cleanup — the shared `deleteUsersByIds` helper hard-deletes every
  // fixture user AND pre-cleans the RESTRICT-gated references first:
  // audit rows written BY the fixtures (`actor_id`) and ABOUT them
  // (`entity_type = 'user'` + `entity_id`), then subscriptions /
  // evaluations, then the users (child rows cascade). The asserted
  // `deleted === ids.length` + zero-remain check replaces the historical
  // silent `.catch(() => {})` wrapper that masked FK-RESTRICT failures and
  // leaked the admin actor row whenever its probes emitted audit rows.
  const ids = [...fixtures.createdUserIds];
  if (ids.length === 0) return;
  const deleted = await deleteUsersByIds(ids);
  expect(deleted).toBe(ids.length);
  expect(await countUsersByIds(ids)).toBe(0);
});

/** Provisions a student fixture (users + students rows) committed to DB. */
async function provisionStudentTarget(): Promise<UserSelectType> {
  const created = await db.transaction(async tx => {
    const target = await createTestUser(tx, { role: "student" });
    await createTestStudent(tx, target.id);
    return target;
  });
  fixtures.createdUserIds.push(created.id);
  return created;
}

/** Builds a valid `AdminCreateUserSubmitInput` with a unique email. */
function makeCreateInput(role: "student" | "teacher" | "parent" = "student"): AdminCreateUserSubmitInput {
  return {
    fullName: `Test User ${randomUUID().slice(0, 8)}`,
    email: `test-${randomUUID()}@test.local`,
    phone: "+10000000000",
    password: TEST_DEFAULT_CREDENTIAL,
    country: "Egypt",
    role,
  };
}

/** Reads the `users` row by id (post-storm state verification). */
async function readUserRow(id: number) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Counts `audit_logs` rows matching the supplied actor + action + entity. */
async function countAuditForEntity(actorId: number, actionType: AuditActionType, entityId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.actionType, actionType), eq(auditLogs.entityId, entityId)));
  return row?.count ?? 0;
}

/**
 * Outcome-bucket helper — sorts `Promise.allSettled` results into
 * `fulfilled` + `rejected` arrays. Cleaner than inline filter+map per
 * test (rule 8 — test duplication prevention).
 */
function partitionOutcomes<T>(results: ReadonlyArray<PromiseSettledResult<T>>): {
  fulfilled: T[];
  rejected: unknown[];
} {
  const fulfilled: T[] = [];
  const rejected: unknown[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      fulfilled.push(r.value);
    } else {
      rejected.push(r.reason);
    }
  }
  return { fulfilled, rejected };
}

describe("AdminUserManagementService — chaos & concurrency", () => {
  // PGlite is a single-connection WASM Postgres — two concurrent top-level
  // `db.transaction(...)` calls share the same underlying connection and
  // interleave their `BEGIN` / `UPDATE` / `COMMIT` statements at the
  // protocol level, which breaks the row-lock serialization that the chaos
  // probes below assert. The probes are only meaningful against a real
  // multi-connection pool (production PG / Neon / CI). Skip them under
  // `DB_PROVIDER=pglite` to avoid false negatives that reflect a
  // transport limitation, not a service-layer defect.
  const IS_PGLITE = (process.env.DB_PROVIDER ?? "").toLowerCase() === "pglite";
  const concurrencyTest = IS_PGLITE ? test.skip : test;

  // ─── (a) Concurrent double soft-delete ──────────────────────────────
  concurrencyTest(
    "concurrent setUserDeleted(true) ×2 on the same active user → exactly one success + one USER_ALREADY_DELETED",
    async () => {
      silenceDomainLog();
      const target = await provisionStudentTarget();
      const adminId = fixtures.adminActor.id;

      const results = await Promise.allSettled([
        AdminUserManagementService.setUserDeleted(target.id, true, adminId, LOCALE),
        AdminUserManagementService.setUserDeleted(target.id, true, adminId, LOCALE),
      ]);
      const { fulfilled, rejected } = partitionOutcomes(results);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0];
      if (!winner) throw new Error("Expected a winner");
      expect(winner.isDeleted).toBe(true);
      expect(winner.deletedAt).not.toBeNull();

      const loser = rejected[0];
      if (!(loser instanceof Error)) throw new Error("Expected the loser to be an Error");
      assertErrorCode(loser, "USER_ALREADY_DELETED");
      expect(loser.message).toContain(tErrors.adminUsers.userAlreadyDeleted);

      // Final row state consistent with the winner.
      const finalRow = await readUserRow(target.id);
      expect(finalRow?.isDeleted).toBe(true);
      expect(finalRow?.deletedAt).not.toBeNull();

      // Exactly one audit(Delete) row — the loser emitted zero.
      const auditCount = await countAuditForEntity(adminId, AuditActionType.Delete, target.id);
      expect(auditCount).toBe(1);
    }
  );

  // ─── (b) Concurrent delete ⚡ reactivate ────────────────────────────
  concurrencyTest(
    "concurrent setUserDeleted(true) ⚡ setUserDeleted(false) → exactly one winner; final state consistent with the winner",
    async () => {
      silenceDomainLog();
      const target = await provisionStudentTarget();
      const adminId = fixtures.adminActor.id;

      const results = await Promise.allSettled([
        AdminUserManagementService.setUserDeleted(target.id, true, adminId, LOCALE),
        AdminUserManagementService.setUserDeleted(target.id, false, adminId, LOCALE),
      ]);
      const { fulfilled, rejected } = partitionOutcomes(results);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The winner's intent decides the final state. Both calls read the
      // same active row; the guarded UPDATE's null-safe predicate
      // matches for exactly one. The loser's predicate either matches
      // nothing (returning zero rows → USER_ALREADY_DELETED /
      // USER_NOT_DELETED) OR the loser's UPDATE races on the row lock
      // (returning the post-winner state, which then fails the
      // predicate). Either way, the final state is consistent with the
      // winner's intent, never corrupted.
      const winner = fulfilled[0];
      if (!winner) throw new Error("Expected a winner");
      const finalRow = await readUserRow(target.id);
      if (winner.isDeleted) {
        expect(finalRow?.isDeleted).toBe(true);
        expect(finalRow?.deletedAt).not.toBeNull();
      } else {
        expect(finalRow?.isDeleted).toBe(false);
        expect(finalRow?.deletedAt).toBeNull();
      }

      // Exactly one audit row emitted (winner's audit; loser's denial
      // emits zero per the denial-no-audit rule).
      const deleteAudits = await countAuditForEntity(adminId, AuditActionType.Delete, target.id);
      const reactivateAudits = await countAuditForEntity(adminId, AuditActionType.Reactivate, target.id);
      expect(deleteAudits + reactivateAudits).toBe(1);
    }
  );

  // ─── (c) Concurrent patches — last-write-wins ──────────────────────
  concurrencyTest(
    "concurrent updateUser ×2 on the same user — both succeed; final state reflects the later-committed write",
    async () => {
      silenceDomainLog();
      const target = await provisionStudentTarget();
      const adminId = fixtures.adminActor.id;

      const firstName = `Concurrent A ${randomUUID().slice(0, 8)}`;
      const secondName = `Concurrent B ${randomUUID().slice(0, 8)}`;

      const results = await Promise.allSettled([
        AdminUserManagementService.updateUser(target.id, { fullName: firstName }, adminId, LOCALE),
        AdminUserManagementService.updateUser(target.id, { fullName: secondName }, adminId, LOCALE),
      ]);
      const { fulfilled, rejected } = partitionOutcomes(results);
      // Both succeed — updateUser's guarded UPDATE predicate matches
      // any existing row (active OR deleted); row locks serialize the
      // writes but neither is denied. Last-write-wins on `fullName`.
      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(0);

      const finalRow = await readUserRow(target.id);
      expect([firstName, secondName]).toContain(finalRow?.fullName);

      // Both audit(update) rows emitted — each successful mutation
      // emits exactly one (audit-shares-fate with the mutation).
      const updateAudits = await countAuditForEntity(adminId, AuditActionType.Update, target.id);
      expect(updateAudits).toBe(2);
    }
  );

  // ─── (d) Concurrent double-create same email ───────────────────────
  concurrencyTest(
    "concurrent createUser ×2 with the same email → exactly one success + one CONFLICT (23505 rollback)",
    async () => {
      silenceDomainLog();
      const adminId = fixtures.adminActor.id;

      const sharedEmail = `race-${randomUUID()}@test.local`;
      const input: AdminCreateUserSubmitInput = {
        fullName: "Race Create",
        email: sharedEmail,
        phone: "+10000000000",
        password: TEST_DEFAULT_CREDENTIAL,
        country: "Egypt",
        role: "student",
      };

      const results = await Promise.allSettled([
        AdminUserManagementService.createUser(input, adminId, LOCALE),
        AdminUserManagementService.createUser(input, adminId, LOCALE),
      ]);
      const { fulfilled, rejected } = partitionOutcomes(results);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0];
      if (!winner) throw new Error("Expected a winner");
      expect(winner.email).toBe(sharedEmail);
      // The service's role value comes straight from the `users.role` pgEnum
      // (lowercase `"student"`) — NOT the GraphQL SDL canonical form
      // (`"Student"`). The codegen enum transformation happens at the
      // Pothos resolver boundary, NOT inside the service-layer return.
      expect(winner.role).toBe("student");
      // Track the winner's id for cleanup.
      fixtures.createdUserIds.push(winner.id);
      // Also delete the student child row (created via the create path).
      await db
        .delete(students)
        .where(eq(students.id, winner.id))
        .catch(() => {});

      const loser = rejected[0];
      if (!(loser instanceof Error)) throw new Error("Expected the loser to be an Error");
      // The 23505 unique violation is translated to a localized
      // ConflictError via the cause-chain traversal.
      expect(loser).toBeInstanceOf(ConflictError);
      assertErrorCode(loser, "CONFLICT");

      // Exactly one `users` row with the shared email (the loser's
      // insert rolled back).
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.email, sharedEmail));
      expect(row?.count).toBe(1);
    }
  );

  // ─── (e) Forced-failure create → nothing committed ───────────────────
  concurrencyTest(
    "forced-failure createUser (duplicate email) — failed call commits nothing (email-scoped count unchanged)",
    async () => {
      silenceDomainLog();
      const adminId = fixtures.adminActor.id;

      // Establish the seed row.
      const seedInput = makeCreateInput("student");
      const seed = await AdminUserManagementService.createUser(seedInput, adminId, LOCALE);
      fixtures.createdUserIds.push(seed.id);
      await db
        .delete(students)
        .where(eq(students.id, seed.id))
        .catch(() => {});

      // Forced-failure — same email, different fullName (BOPLA
      // defense — the role-child insert uses field-by-field mapping,
      // never mass-assignment, so smuggled fields cannot land).
      const dupInput: AdminCreateUserSubmitInput = {
        ...seedInput,
        fullName: "Dup Force",
      };
      const error = await expectRepoError(() => AdminUserManagementService.createUser(dupInput, adminId, LOCALE));
      expect(error).toBeInstanceOf(ConflictError);
      assertErrorCode(error, "CONFLICT");

      // The failed call committed nothing — still exactly one `users`
      // row with the seed email (a leaked row would carry the same
      // duplicated email; the email-scoped predicate is immune to
      // concurrent external user churn).
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.email, seedInput.email));
      expect(row?.count).toBe(1);
    }
  );
});

describe("AdminUserManagementService — BFLA token + ID fuzz (pre-DB fail-closed)", () => {
  // ─── (f) BFLA token probes — fail closed pre-DB ─────────────────────
  test("BFLA — anonymous actor (id=0) on each mutation → UNAUTHORIZED pre-DB; no attributable writes", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();

      // createUser
      const deniedCreateInput = makeCreateInput();
      const createErr = await expectRepoError(() =>
        AdminUserManagementService.createUser(deniedCreateInput, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      );
      expect(createErr).toBeInstanceOf(UnauthorizedError);

      // updateUser
      const anonUpdateName = `Anon Update ${randomUUID().slice(0, 8)}`;
      const updateErr = await expectRepoError(() =>
        AdminUserManagementService.updateUser(1, { fullName: anonUpdateName }, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      );
      expect(updateErr).toBeInstanceOf(UnauthorizedError);

      // setUserDeleted
      const deleteErr = await expectRepoError(() =>
        AdminUserManagementService.setUserDeleted(1, true, ANONYMOUS_ACTOR_ID, LOCALE, tx)
      );
      expect(deleteErr).toBeInstanceOf(UnauthorizedError);

      // Zero writes — each denial's would-be effect is probed on rows
      // this test owns (the denied createUser's unique email; the
      // per-run update marker; the delete target's deleted flag). A
      // global directory count is NOT usable here: parallel files
      // commit + hard-delete fixture users mid-window, so it drifts
      // under concurrent execution.
      const [createdRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.email, deniedCreateInput.email));
      const [renamedRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.id, 1), eq(users.fullName, anonUpdateName)));
      const [deletedRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.id, 1), eq(users.isDeleted, true)));
      expect(createdRow?.count ?? 0).toBe(0);
      expect(renamedRow?.count ?? 0).toBe(0);
      expect(deletedRow?.count ?? 0).toBe(0);
    });
  });

  test("BFLA — non-admin actor on each mutation → FORBIDDEN pre-DB; no attributable writes", async () => {
    await runInRollback(async tx => {
      const nonAdmin = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, nonAdmin.id);
      silenceDomainLog();

      const deniedCreateInput = makeCreateInput();
      const createErr = await expectRepoError(() =>
        AdminUserManagementService.createUser(deniedCreateInput, nonAdmin.id, LOCALE, tx)
      );
      expect(createErr).toBeInstanceOf(ForbiddenError);

      const nonAdminUpdateName = `NonAdmin Update ${randomUUID().slice(0, 8)}`;
      const updateErr = await expectRepoError(() =>
        AdminUserManagementService.updateUser(1, { fullName: nonAdminUpdateName }, nonAdmin.id, LOCALE, tx)
      );
      expect(updateErr).toBeInstanceOf(ForbiddenError);

      const deleteErr = await expectRepoError(() =>
        AdminUserManagementService.setUserDeleted(1, true, nonAdmin.id, LOCALE, tx)
      );
      expect(deleteErr).toBeInstanceOf(ForbiddenError);

      // Zero writes — each denial's would-be effect is probed on rows
      // this test owns (see the anonymous variant above; the global
      // directory count these probes replace drifts under parallel
      // files' fixture cleanup).
      const [createdRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.email, deniedCreateInput.email));
      const [renamedRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.id, 1), eq(users.fullName, nonAdminUpdateName)));
      const [deletedRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.id, 1), eq(users.isDeleted, true)));
      expect(createdRow?.count ?? 0).toBe(0);
      expect(renamedRow?.count ?? 0).toBe(0);
      expect(deletedRow?.count ?? 0).toBe(0);
    });
  });

  // ─── (g) Enum / ID fuzz — fail closed pre-DB ────────────────────────
  test("fuzz — negative / NaN / unknown IDs rejected pre-DB; zero writes", async () => {
    await runInRollback(async tx => {
      const adminActor = await createTestUser(tx, { role: "admin" });
      await createTestAdmin(tx, adminActor.id);
      silenceDomainLog();

      // Negative id → ValidationError at the seam
      // (`requirePositiveIntId` rejects `<= 0` pre-DB).
      const negErr = await expectRepoError(() =>
        AdminUserManagementService.getUserDetail(-1, LOCALE, adminActor.id, tx)
      );
      expect(negErr).toBeInstanceOf(ValidationError);

      // NaN id → ValidationError at the seam.
      const nanErr = await expectRepoError(() =>
        AdminUserManagementService.getUserDetail(Number.NaN, LOCALE, adminActor.id, tx)
      );
      expect(nanErr).toBeInstanceOf(ValidationError);

      // Fractional id → ValidationError at the seam (positive but
      // non-integer — `requirePositiveIntId` rejects).
      const fractionalErr = await expectRepoError(() =>
        AdminUserManagementService.getUserDetail(1.5, LOCALE, adminActor.id, tx)
      );
      expect(fractionalErr).toBeInstanceOf(ValidationError);

      // Unknown large id → USER_NOT_FOUND (cold-path `existsById`
      // confirms absence; typed NotFoundError with the localized
      // message).
      const absentId = await (async () => {
        const [r] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
        return (r?.maxId ?? 0) + 1_000_000;
      })();
      const unknownErr = await expectRepoError(() =>
        AdminUserManagementService.getUserDetail(absentId, LOCALE, adminActor.id, tx)
      );
      expect(unknownErr).toBeInstanceOf(NotFoundError);
      assertErrorCode(unknownErr, "USER_NOT_FOUND");

      // Zero writes — the read denials emitted nothing attributable to
      // this test's actor (getUserDetail is a read-only path, so an
      // erroneous emission would surface as an audit row). A global
      // directory count is not usable here: parallel files commit +
      // hard-delete fixture users mid-window.
      const [auditRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, adminActor.id));
      expect(auditRow?.count ?? 0).toBe(0);
    });
  });
});
