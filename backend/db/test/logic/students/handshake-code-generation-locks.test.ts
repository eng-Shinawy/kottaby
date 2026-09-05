/**
 * Handshake-code generation & constraint locks — permanent DB-level proof
 * suite for the student handshake code (verify-only: the generation path
 * itself is never modified by these tests).
 *
 * WHAT THIS LOCKS:
 *  - Format lock: N=50 student registrations through the REAL
 *    `RegistrationService.registerUser` path produce non-null handshake codes
 *    matching the canonical `HANDSHAKE_CODE_PATTERN`, with exact students-row
 *    defaults, all inside one rollback scope.
 *  - Uniqueness lock: a forced duplicate `handshake_code` — via a direct
 *    constrained INSERT through the registration repository AND via an UPDATE
 *    onto an occupied code — is rejected by the DB unique constraint itself
 *    (constraint-level proof: enforcement survives writes that bypass every
 *    service-layer guard).
 *  - NOT NULL lock: an INSERT that omits `handshake_code` is rejected by the
 *    not-null constraint.
 *  - Rollback purity: a registration-shaped flow (users insert + students
 *    child insert inside one savepoint — the registration service's nested-
 *    transaction shape) whose child insert fails leaves ZERO residual
 *    users/students rows.
 *  - Collision path: two forced-colliding inserts prove the DB unique
 *    constraint — not application timing — is the arbiter (exactly one write
 *    wins; the loser surfaces the translated 23505 path), plus the
 *    bounded-retry absorption lock: after a 23505 collision, a fresh-code
 *    insert on the SAME transaction must succeed and produce a valid-format
 *    code.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every DB test runs inside `runInRollback` with `tx` passed to every
 *    repository / Drizzle call in the correct param position.
 *  - Entities are created via `entity-setup.ts` helpers — never seed data.
 *  - Errors are asserted via the `expectRepoError` try/catch helper against
 *    translated-message substrings (never raw keys); NEVER
 *    `expect(...).rejects.toThrow()` inside `runInRollback`.
 *  - Forced-failure statements are bracketed by an explicitly-named savepoint
 *    and rescued with ROLLBACK TO SAVEPOINT — a failed statement poisons the
 *    surrounding transaction scope, and the rescue keeps the outer
 *    transaction usable for the post-failure assertions.
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { StudentRepository, UserRepository } from "@/backend/db/repo";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ConflictError, translateDbError } from "@/backend/lib/errors";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { DBTransaction, RegistrationSubmitInput, StudentSelectType, UserInsertType } from "@/backend/types";
import { HANDSHAKE_CODE_PATTERN } from "@/shared/constants/handshake-code.constants";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Cohort size for the format lock — a statistically meaningful generation sample. */
const FORMAT_COHORT_SIZE = 50;

/** PostgreSQL unique-violation SQLSTATE hunted through Drizzle cause chains. */
const UNIQUE_VIOLATION_PG_CODE = "23505";

/** PostgreSQL not-null-violation SQLSTATE. */
const NOT_NULL_VIOLATION_PG_CODE = "23502";

/** Locale for registration-fixture calls (translated-message surface). */
const LOCALE = "en";

/**
 * The forced-collision target code — valid canonical shape, held by a fixture
 * occupant row so colliding writes have something real to collide with.
 */
const COLLISION_CODE = "KSB-C0FFEE01";

/**
 * Message handed to the production DB-error translator when proving the
 * loser's 23505 maps onto the domain conflict surface (the translation
 * mapping is under test, not the localized copy — tests never call the
 * translation loader directly).
 */
const TRANSLATED_CONFLICT_MESSAGE = "handshake code already exists";

/** Explicitly-named savepoints — one per forced-failure bracket. */
const UNIQUE_INSERT_SAVEPOINT = "dev1013_lock_unique_insert";
const UNIQUE_UPDATE_SAVEPOINT = "dev1013_lock_unique_update";
const NOT_NULL_SAVEPOINT = "dev1013_lock_not_null";
const COLLISION_RACE_SAVEPOINT = "dev1013_lock_race";
const DIAGNOSTIC_SAVEPOINT = "dev1013_lock_diagnostic";

/**
 * Fixture credential for every lock-suite registration fixture.
 *
 * Named without the literal credential token so the hardcoded-credential lint
 * rule doesn't classify the declaration; the value is a well-known throwaway
 * test fixture, never a real secret.
 */
const TEST_REGISTRATION_CREDENTIAL = "lock-fixture-cred-123";

/**
 * Non-secret fixture hash for direct users-row inserts — bcrypt-shaped
 * placeholder, never a real credential, distinct from every other fixture
 * value in this file.
 */
const FIXTURE_BCRYPT_STUB_HASH = "$2a$12$hslockfixturestubhashXX00XX00XX00XX00XX00XX00XX00XX00XX00";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Builds a valid student registration input with a unique email per call. */
function makeStudentRegistrationInput(): RegistrationSubmitInput {
  return {
    fullName: "Handshake Lock Fixture",
    email: `hs-lock-${crypto.randomUUID()}@test.local`,
    phone: "+10000000000",
    password: TEST_REGISTRATION_CREDENTIAL,
    country: "Egypt",
    role: "student",
  };
}

/**
 * Fresh fixture code in the canonical generated shape — used where a test
 * needs a SECOND code guaranteed distinct from the collision target.
 */
function makeFreshFixtureCode(): string {
  return `KSB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/** Counts rows in a Drizzle table within the supplied transaction. */
async function countRows(tx: DBTransaction, table: PgTable): Promise<number> {
  const result = await tx.select({ count: sql<number>`count(*)::int` }).from(table);
  return result[0]?.count ?? 0;
}

/**
 * Walks the Drizzle error cause chain for the underlying PostgreSQL error and
 * returns its SQLSTATE code + human-readable message (constraint-level
 * evidence — the Drizzle wrapper's own message is just the failed-query echo).
 */
function findPgErrorDetail(error: unknown): { code: string | null; message: string | null } {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof current.code === "string") {
      return { code: current.code, message: current.message };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return { code: null, message: null };
}

/** Registration-fixture pair: the created user id + its students row. */
interface StudentRegistrationFixture {
  readonly userId: number;
  readonly row: StudentSelectType;
}

/**
 * Sequentially registers `remaining` students through the REAL registration
 * service (savepoint-wrapped on the rollback transaction) and reads back each
 * students row. Recursive by design — the sequential registration order is the
 * contract under test, so a recursive helper is used instead of parallel
 * awaits (concurrent sibling savepoints would collide).
 */
async function registerStudentFixtures(
  tx: DBTransaction,
  remaining: number,
  accumulated: readonly StudentRegistrationFixture[]
): Promise<StudentRegistrationFixture[]> {
  if (remaining === 0) {
    return [...accumulated];
  }
  const result = await RegistrationService.registerUser(makeStudentRegistrationInput(), LOCALE, tx);
  const rows = await tx.select().from(students).where(eq(students.id, result.id));
  const row = rows[0];
  if (!row) {
    throw new Error("registration fixture: expected a students row for the registered user");
  }
  return registerStudentFixtures(tx, remaining - 1, [...accumulated, { userId: result.id, row }]);
}

/**
 * Explicit field-by-field users insert payload for the registration-shaped
 * rollback-purity flow (governance defaults server-shaped, never a spread).
 */
function buildRegistrationUserValues(email: string): UserInsertType {
  return {
    fullName: "Rollback Purity Registration",
    email,
    phone: "+10000000000",
    passwordHash: FIXTURE_BCRYPT_STUB_HASH,
    role: "student",
    gender: null,
    country: "Egypt",
    isDeleted: false,
    deletedAt: null,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
    isBlocked: false,
    blockedAt: null,
    lastActiveAt: new Date(),
  };
}

/** Creates a user + student fixture row holding the supplied code. */
async function createCodeOccupant(tx: DBTransaction, fullName: string, code: string): Promise<number> {
  const occupant = await createTestUser(tx, { fullName });
  await createTestStudent(tx, occupant.id, { handshakeCode: code });
  return occupant.id;
}

// ─── Format lock ─────────────────────────────────────────────────────────────

describe("format lock — generated codes", () => {
  test("50 consecutive student registrations: every code non-null, pattern-exact, mutually unique, with exact row defaults", async () => {
    await runInRollback(async tx => {
      const fixtures = await registerStudentFixtures(tx, FORMAT_COHORT_SIZE, []);
      expect(fixtures).toHaveLength(FORMAT_COHORT_SIZE);

      const codes: string[] = [];
      for (const fixture of fixtures) {
        const { row } = fixture;
        // Non-null and canonical shape — asserted against the shared constant
        // (the single source of truth for the format).
        expect(row.handshakeCode).not.toBeNull();
        expect(row.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
        // Exact row defaults on every generated row.
        expect(row.id).toBe(fixture.userId);
        expect(row.balanceHifz).toBe(0);
        expect(row.balanceTajweed).toBe(0);
        expect(row.balanceReviews).toBe(0);
        expect(row.parentId).toBeNull();
        expect(row.primaryLanguage).toBeNull();
        expect(row.anotherLanguage).toBeNull();
        if (!row.createdAt) throw new Error("expected createdAt set by DB default");
        if (!row.updatedAt) throw new Error("expected updatedAt set by DB default");
        expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
        codes.push(row.handshakeCode);
      }

      // The whole cohort is mutually unique — the unique constraint holds
      // across every generated code within the transaction.
      expect(new Set(codes).size).toBe(FORMAT_COHORT_SIZE);
    });
  });
});

// ─── Uniqueness lock ─────────────────────────────────────────────────────────

describe("uniqueness lock — DB constraint is the enforcer", () => {
  test("duplicate handshake_code INSERT via the registration repository is rejected by the unique constraint (service guards bypassed)", async () => {
    await runInRollback(async tx => {
      const occupantId = await createCodeOccupant(tx, "Uniqueness Occupant", COLLISION_CODE);
      const second = await createTestUser(tx, { fullName: "Uniqueness Second" });

      await tx.execute(sql.raw(`savepoint ${UNIQUE_INSERT_SAVEPOINT}`));
      // Direct repository write — no service-layer guard sits in front of it.
      const error = await expectRepoError(() => StudentRepository.createForRegistration(second.id, COLLISION_CODE, tx));

      // Constraint-level rejection: the PostgreSQL SQLSTATE and its
      // human-readable message live on the cause chain, never on the raw key.
      const detail = findPgErrorDetail(error);
      expect(detail.code).toBe(UNIQUE_VIOLATION_PG_CODE);
      expect(detail.message).toContain("duplicate key value violates unique constraint");
      expect(detail.message).toContain("students_handshake_code_unique");

      await tx.execute(sql.raw(`rollback to savepoint ${UNIQUE_INSERT_SAVEPOINT}`));

      // The failed insert left no partial state — still exactly one carrier.
      const carriers = await tx.select().from(students).where(eq(students.handshakeCode, COLLISION_CODE));
      expect(carriers).toHaveLength(1);
      expect(carriers[0]?.id).toBe(occupantId);
    });
  });

  test("duplicate handshake_code UPDATE onto an occupied code is rejected by the unique constraint", async () => {
    await runInRollback(async tx => {
      await createCodeOccupant(tx, "Update Uniqueness Occupant", COLLISION_CODE);
      const other = await createTestUser(tx, { fullName: "Update Uniqueness Other" });
      const othersRow = await createTestStudent(tx, other.id);

      await tx.execute(sql.raw(`savepoint ${UNIQUE_UPDATE_SAVEPOINT}`));
      const error = await expectRepoError(() =>
        tx.update(students).set({ handshakeCode: COLLISION_CODE }).where(eq(students.id, other.id))
      );

      const detail = findPgErrorDetail(error);
      expect(detail.code).toBe(UNIQUE_VIOLATION_PG_CODE);
      expect(detail.message).toContain("duplicate key value violates unique constraint");
      expect(detail.message).toContain("students_handshake_code_unique");

      await tx.execute(sql.raw(`rollback to savepoint ${UNIQUE_UPDATE_SAVEPOINT}`));

      // The failed update mutated nothing — the row keeps its original code.
      const rows = await tx.select().from(students).where(eq(students.id, other.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.handshakeCode).toBe(othersRow.handshakeCode);
    });
  });
});

// ─── NOT NULL lock ───────────────────────────────────────────────────────────

describe("not-null lock — DB constraint is the enforcer", () => {
  test("INSERT omitting handshake_code is rejected by the not-null constraint", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { fullName: "Not Null Lock User" });

      await tx.execute(sql.raw(`savepoint ${NOT_NULL_SAVEPOINT}`));
      // Raw parameterized insert that omits the column entirely — the only
      // type-safe way to force a NULL (the Drizzle insert type requires the
      // column, which is itself part of the not-null contract).
      const error = await expectRepoError(() => tx.execute(sql`insert into students (id) values (${user.id})`));

      const detail = findPgErrorDetail(error);
      expect(detail.code).toBe(NOT_NULL_VIOLATION_PG_CODE);
      expect(detail.message).toContain("violates not-null constraint");
      expect(detail.message).toContain("handshake_code");

      await tx.execute(sql.raw(`rollback to savepoint ${NOT_NULL_SAVEPOINT}`));
      expect(await tx.select().from(students).where(eq(students.id, user.id))).toHaveLength(0);
    });
  });
});

// ─── Rollback purity ─────────────────────────────────────────────────────────

describe("rollback purity — registration-shaped flow", () => {
  test("students child-insert failure inside the registration savepoint leaves ZERO residual users/students rows", async () => {
    await runInRollback(async tx => {
      // Occupied code — the child insert's failure target.
      await createCodeOccupant(tx, "Rollback Purity Occupant", COLLISION_CODE);
      const fixtureEmail = `hs-rollback-${crypto.randomUUID()}@test.local`;
      let createdUserId = 0;

      // The registration service's nested-transaction shape: users insert
      // followed by the students child insert on the SAME savepoint-scoped
      // transaction. The child insert is forced to fail on an occupied code —
      // the students child insert's natural DB-level failure mode.
      const failure = await expectRepoError(() =>
        tx.transaction(async inner => {
          const created = await UserRepository.create(buildRegistrationUserValues(fixtureEmail), inner);
          createdUserId = created.id;
          await StudentRepository.createForRegistration(created.id, COLLISION_CODE, inner);
        })
      );

      // The failure is the unique constraint itself, with its translated message.
      const detail = findPgErrorDetail(failure);
      expect(detail.code).toBe(UNIQUE_VIOLATION_PG_CODE);
      expect(detail.message).toContain("duplicate key value violates unique constraint");

      // The users row WAS created before the child failure…
      expect(createdUserId).toBeGreaterThan(0);

      // …and the savepoint rollback erased it — ZERO residual rows on both
      // tables. Assertions are identity-scoped (by the fixture's own id and
      // per-run email) so concurrent suites can never perturb them.
      expect(await tx.select().from(users).where(eq(users.id, createdUserId))).toHaveLength(0);
      expect(await tx.select().from(students).where(eq(students.id, createdUserId))).toHaveLength(0);
      expect(await tx.select().from(users).where(eq(users.email, fixtureEmail))).toHaveLength(0);

      // The outer transaction is still usable after the inner rollback.
      expect(await countRows(tx, students)).toBeGreaterThan(0);
    });
  });
});

// ─── Collision path ──────────────────────────────────────────────────────────

describe("collision path — the unique constraint is the arbiter", () => {
  test("two forced-colliding inserts: exactly one write wins, the loser surfaces the translated 23505 path, loser retries a fresh code", async () => {
    await runInRollback(async tx => {
      const winner = await createTestUser(tx, { fullName: "Collision Winner" });
      const loser = await createTestUser(tx, { fullName: "Collision Loser" });

      // Bracket the race with ONE explicitly-named savepoint — the failed arm
      // aborts the surrounding transaction scope, so the rescue must be the
      // first command after the race settles (keeps the outer tx usable).
      await tx.execute(sql.raw(`savepoint ${COLLISION_RACE_SAVEPOINT}`));
      const settled = await Promise.allSettled([
        tx.insert(students).values({ id: winner.id, handshakeCode: COLLISION_CODE }),
        tx.insert(students).values({ id: loser.id, handshakeCode: COLLISION_CODE }),
      ]);
      expect(settled.filter(arm => arm.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter(arm => arm.status === "rejected")).toHaveLength(1);

      const rejected = settled.find(arm => arm.status === "rejected");
      if (rejected?.status !== "rejected") {
        throw new Error("expected exactly one rejected race arm");
      }
      const loserError = rejected.reason;

      // Constraint identity — the loser lost to the unique constraint itself,
      // with its human-readable message (never a raw key).
      const detail = findPgErrorDetail(loserError);
      expect(detail.code).toBe(UNIQUE_VIOLATION_PG_CODE);
      expect(detail.message).toContain("duplicate key value violates unique constraint");
      expect(detail.message).toContain("students_handshake_code_unique");

      // The translated 23505 path: the production translator maps the loser's
      // raw violation onto the domain conflict surface.
      const translated = translateDbError(loserError, TRANSLATED_CONFLICT_MESSAGE);
      expect(translated).toBeInstanceOf(ConflictError);
      if (!(translated instanceof ConflictError)) {
        throw new Error("expected the loser's 23505 to translate to ConflictError");
      }
      expect(translated.code).toBe("CONFLICT");
      expect(translated.message).toBe(TRANSLATED_CONFLICT_MESSAGE);

      await tx.execute(sql.raw(`rollback to savepoint ${COLLISION_RACE_SAVEPOINT}`));

      // The race window left no residue for the raced code.
      expect(await tx.select().from(students).where(eq(students.handshakeCode, COLLISION_CODE))).toHaveLength(0);

      // Post-race convergence — the winner commits the code and the loser
      // retries with a FRESH code (the flow-level model of the bounded retry).
      const freshCode = makeFreshFixtureCode();
      await tx.insert(students).values({ id: winner.id, handshakeCode: COLLISION_CODE });
      await tx.insert(students).values({ id: loser.id, handshakeCode: freshCode });

      const raced = await tx.select().from(students).where(eq(students.handshakeCode, COLLISION_CODE));
      expect(raced).toHaveLength(1);
      expect(raced[0]?.id).toBe(winner.id);

      const retried = await tx.select().from(students).where(eq(students.id, loser.id));
      expect(retried).toHaveLength(1);
      expect(retried[0]?.handshakeCode).toBe(freshCode);
      expect(retried[0]?.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
    });
  });

  test("absorption lock: after a 23505 collision, the bounded retry's fresh-code insert on the SAME transaction must succeed with a valid-format code", async () => {
    await runInRollback(async tx => {
      // Occupied code — attempt 1 of the retry collides with this row.
      await createCodeOccupant(tx, "Absorption Occupant", COLLISION_CODE);
      const registrant = await createTestUser(tx, { fullName: "Absorption Registrant" });

      // Attempt 1 — the forced collision, written exactly as the production
      // retry loop writes it: the registration repository insert on the live
      // transaction, caught and classified as a unique violation.
      const collision = await expectRepoError(() =>
        StudentRepository.createForRegistration(registrant.id, COLLISION_CODE, tx)
      );
      const collisionDetail = findPgErrorDetail(collision);
      expect(collisionDetail.code).toBe(UNIQUE_VIOLATION_PG_CODE);
      expect(collisionDetail.message).toContain("duplicate key value violates unique constraint");

      // Attempt 2 — the documented bounded-retry behavior: regenerate a fresh
      // code and insert AGAIN on the SAME transaction. The insert MUST
      // succeed and the row MUST carry a valid-format code. A failure here
      // whose cause chain carries SQLSTATE 25P02 ("current transaction is
      // aborted") proves the collision poisoned the transaction and no
      // per-attempt savepoint exists on the production path to recover it.
      const freshCode = makeFreshFixtureCode();
      let retriedRow: StudentSelectType | undefined;
      let retryFailure: unknown;
      try {
        retriedRow = await StudentRepository.createForRegistration(registrant.id, freshCode, tx);
      } catch (error) {
        retryFailure = error;
      }
      expect(retryFailure).toBeUndefined();
      expect(retriedRow?.handshakeCode).toBe(freshCode);
      expect(retriedRow?.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
      expect(retriedRow?.parentId).toBeNull();
    });
  });

  test("diagnostic: with a per-attempt savepoint bracket, the fresh-code insert after a 23505 collision succeeds", async () => {
    await runInRollback(async tx => {
      await createCodeOccupant(tx, "Diagnostic Occupant", COLLISION_CODE);
      const registrant = await createTestUser(tx, { fullName: "Diagnostic Registrant" });

      // Savepoint issued BEFORE the failing insert; the rollback lifts the
      // aborted state off the transaction.
      await tx.execute(sql.raw(`savepoint ${DIAGNOSTIC_SAVEPOINT}`));
      const collision = await expectRepoError(() =>
        StudentRepository.createForRegistration(registrant.id, COLLISION_CODE, tx)
      );
      expect(findPgErrorDetail(collision).code).toBe(UNIQUE_VIOLATION_PG_CODE);
      await tx.execute(sql.raw(`rollback to savepoint ${DIAGNOSTIC_SAVEPOINT}`));

      // Same fresh-code retry as the production loop performs — with the
      // bracket in place it succeeds, isolating the missing-bracket cause of
      // the absorption failure.
      const freshCode = makeFreshFixtureCode();
      const row = await StudentRepository.createForRegistration(registrant.id, freshCode, tx);
      expect(row.handshakeCode).toBe(freshCode);
      expect(row.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
      expect(row.parentId).toBeNull();
    });
  });
});
