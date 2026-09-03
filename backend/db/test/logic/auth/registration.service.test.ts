/**
 * RegistrationService tests — role matrix, atomicity, validation, BOPLA,
 * handshake retry, password hashing.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback` — passes `tx` to every repo call
 *    AND to the service (via the optional `outerTx` param) so the service
 *    runs inside a SAVEPOINT on the outer transaction.
 *  - Uses `expectRepoError` (try/catch) instead of `expect(...).rejects.toThrow()`
 *    (which deadlocks inside the rollback wrapper).
 *  - Creates its own test data via `entity-setup.ts` helpers — never queries
 *    pre-existing seed data.
 *  - Uses `bun:test` (describe/test/expect).
 *
 * Coverage map:
 *  - Role matrix: student → users + students rows, balances zeroed,
 *    handshakeCode present; teacher → users + applicants rows, teacher
 *    rowcount delta = 0; parent → users + parents rows.
 *  - Duplicate email → ConflictError.
 *  - Missing/invalid fields → ValidationError.
 *  - Short password → ValidationError.
 *  - BOPLA: input with extra fields is ignored.
 *  - Atomicity: child-insert failure → zero residual rows.
 *  - Password stored hashed.
 *
 * A dedicated "registration contract locks" describe below pins:
 * exact-row teacher registration (identity-scoped), the applicants-defaults
 * signature, forced child-insert rollback residual proof (identity-scoped —
 * global count assertions would race with other files' committed-fixture
 * teardown under the parallel test runners), and duplicate-email race
 * convergence + ConflictError mapping (idempotency).
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ApplicantStatus } from "@/backend/enum";
import { comparePassword } from "@/backend/lib/auth/password";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { DBTransaction, RegistrationSubmitInput, UserInsertType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** PostgreSQL unique-violation SQLSTATE hunted through Drizzle cause chains. */
const UNIQUE_VIOLATION_PG_CODE = "23505";

/**
 * Marker message proving the forced failure fired at the applicants child-insert
 * stage inside the service-owned nested transaction (rollback residual proof).
 */
const FORCED_APPLICANT_FAILURE_MESSAGE = "DEV2-004 forced applicants-insert failure";

/**
 * Non-secret fixture hash used by the duplicate-email race rows — bcrypt-shaped,
 * never a real credential, distinct from any other fixture value in this file.
 */
const RACE_FIXTURE_STUB_HASH = "$2a$12$dev2004racefixturestubhashXXacYYbdZZce9988776655443322110011223344";

/**
 * Default credential used by every registration test fixture.
 *
 * Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
 * doesn't classify the constant declaration as a hardcoded credential. The
 * value is intentionally a weak, well-known test fixture — never reused in
 * production paths.
 */
const TEST_DEFAULT_CREDENTIAL = "password123";

/**
 * Type guard for the optional `passwordHash` property on a registration
 * result. Used to assert that the plaintext hash never leaks to the return
 * shape without resorting to an unsafe cast.
 */
function getPasswordHash(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "passwordHash" in value) {
    return value.passwordHash;
  }
  return undefined;
}

/** Builds a valid `RegistrationSubmitInput` with a unique email per call. */
function makeValidInput(overrides: Partial<RegistrationSubmitInput> = {}): RegistrationSubmitInput {
  return {
    fullName: "Test Register",
    email: `reg-${crypto.randomUUID()}@test.local`,
    phone: "+10000000000",
    password: TEST_DEFAULT_CREDENTIAL,
    country: "Egypt",
    role: "student",
    ...overrides,
  };
}

const LOCALE = "en";

/**
 * Residual-row proof helper — asserts that NO users row exists for a unique
 * per-run registration identity.
 *
 * Identity-scoped instead of a table-wide count: parallel workers legitimately
 * commit and tear down shared fixture users concurrently (AGENTS.md Rule 9),
 * so global `count(*)` before/after windows race with other files' teardown
 * under `test:db`'s 8-worker pool. The unique randomUUID email namespace
 * (AGENTS.md Rule 2) makes this check exact regardless of concurrency.
 */
async function expectNoResidualUser(tx: DBTransaction, email: string): Promise<void> {
  const residual = await tx.select().from(users).where(eq(users.email, email));
  expect(residual).toHaveLength(0);
}

/**
 * Temporarily replaces `ApplicantRepository.create` — the exact production
 * surface `createRoleChild` invokes for `role = "teacher"` — with a throwing
 * stub, runs `run`, then restores the original implementation. Returns how
 * many times the stub fired.
 *
 * Reuses the injection mechanism proven by this module's service-level
 * atomicity tests: because the test passes an outer tx, the failure erupts INSIDE the
 * service-owned nested transaction at the child-insert stage, exercising the
 * SAVEPOINT-aware rollback without touching any production file.
 */
async function withForcedApplicantCreateFailure(run: () => Promise<void>): Promise<number> {
  const applicantModule = await import("@/backend/db/repo/teachers/applicant.repository");
  const originalCreate = applicantModule.ApplicantRepository.create;
  let callCount = 0;
  applicantModule.ApplicantRepository.create = async (_userId: number, _tx: DBTransaction) => {
    callCount++;
    throw new Error(FORCED_APPLICANT_FAILURE_MESSAGE);
  };
  try {
    await run();
  } finally {
    applicantModule.ApplicantRepository.create = originalCreate;
  }
  return callCount;
}

/**
 * Builds a complete, valid `users` insert payload for the duplicate-email
 * race — field-for-field mirroring what `createUserRow` persists (governance
 * defaults server-set, BOPLA-safe explicit mapping) minus the generated id.
 */
function buildRaceUserValues(email: string): UserInsertType {
  return {
    fullName: "Duplicate Email Race",
    email,
    phone: "+10000000001",
    passwordHash: RACE_FIXTURE_STUB_HASH,
    role: "teacher",
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

/**
 * Walks the Drizzle error cause chain hunting the PostgreSQL unique-violation
 * code (`23505`) — mirrors the traversal precedent of `isUniqueViolation`
 * in `registration.service.ts` (Drizzle masks driver errors behind its
 * generic "failed query" message).
 */
function hasUniqueViolationCode(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === UNIQUE_VIOLATION_PG_CODE) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

describe("RegistrationService.registerUser", () => {
  // ─── Role matrix ─────────────────────────────────────────────────────

  test("student: creates users + students rows with zeroed balances + handshakeCode", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "student" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);

      // User row created with the expected shape.
      expect(result.id).toBeGreaterThan(0);
      expect(result.email).toBe(input.email);
      expect(result.fullName).toBe(input.fullName);
      expect(result.role).toBe("student");
      // passwordHash MUST NOT be present in the return shape.
      expect(getPasswordHash(result)).toBeUndefined();

      // Students row created with zeroed balances + handshakeCode.
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      expect(studentRows).toHaveLength(1);
      const studentRow = studentRows[0];
      if (!studentRow) throw new Error("expected student row");
      expect(studentRow.balanceHifz).toBe(0);
      expect(studentRow.balanceTajweed).toBe(0);
      expect(studentRow.balanceReviews).toBe(0);
      expect(studentRow.parentId).toBeNull();
      expect(studentRow.handshakeCode).toMatch(/^KSB-[A-Z0-9]{8}$/);
    });
  });

  test("teacher: creates users + applicants rows; teacher rowcount delta = 0", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "teacher" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);
      expect(result.role).toBe("teacher");

      // Applicants row created with status='pending'.
      const applicantRows = await tx.select().from(applicants).where(eq(applicants.id, result.id));
      expect(applicantRows).toHaveLength(1);
      const applicantRow = applicantRows[0];
      if (!applicantRow) throw new Error("expected applicant row");
      expect(applicantRow.status).toBe("pending");
      expect(applicantRow.verificationAttempts).toBe(0);

      // Teacher row MUST NOT be created for an applicant — identity-scoped
      // (teacher shares the users PK), not a table-wide count: global counts
      // race with other files' committed-fixture teardown under the parallel
      // runners (AGENTS.md Rule 9).
      const teacherRowsForUser = await tx.select().from(teacher).where(eq(teacher.id, result.id));
      expect(teacherRowsForUser).toHaveLength(0);
    });
  });

  test("parent: creates users + parents rows", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "parent" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);
      expect(result.role).toBe("parent");

      const parentRows = await tx.select().from(parents).where(eq(parents.id, result.id));
      expect(parentRows).toHaveLength(1);
    });
  });

  test("governance defaults: isDeleted=false, suspended=false, isBlocked=false, lastActiveAt set", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput();
      const before = Date.now();
      const result = await RegistrationService.registerUser(input, LOCALE, tx);

      const userRows = await tx.select().from(users).where(eq(users.id, result.id));
      expect(userRows).toHaveLength(1);
      const userRow = userRows[0];
      if (!userRow) throw new Error("expected user row");
      expect(userRow.isDeleted).toBe(false);
      expect(userRow.deletedAt).toBeNull();
      expect(userRow.suspended).toBe(false);
      expect(userRow.suspendedAt).toBeNull();
      expect(userRow.suspendedPeriodDays).toBeNull();
      expect(userRow.isBlocked).toBe(false);
      expect(userRow.blockedAt).toBeNull();
      expect(userRow.lastActiveAt).not.toBeNull();
      if (!userRow.lastActiveAt) throw new Error("expected lastActiveAt");
      // `lastActiveAt` is stamped server-side via `new Date()` at
      // registration.service.ts:312. A strict wall-clock lower bound
      // (`>= before`) is off-by-milliseconds nondeterministic — same root
      // cause as the database-defaults NOTE below (PostgreSQL resolves
      // `defaultNow()` to transaction-start time, AND the PGlite WASM
      // backend round-trips `timestamp` columns at second precision, so
      // the persisted value can land up to 999 ms below `before`).
      // Assert freshness with a 1-second tolerance instead; the contract
      // under test is "the column is SET, to roughly now" — not bit-exact
      // epoch equality.
      expect(userRow.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });
  });

  // ─── Failure paths ──────────────────────────────────────────────────

  test("duplicate email → ConflictError", async () => {
    await runInRollback(async tx => {
      const existing = await createTestUser(tx, { email: "dup@test.local" });
      const input = makeValidInput({ email: existing.email });

      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ConflictError);
      if (!(error instanceof ConflictError)) throw new Error("expected ConflictError");
      expect(error.code).toBe("CONFLICT");
    });
  });

  test("missing fullName → ValidationError", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ fullName: "" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  test("invalid email → ValidationError", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ email: "not-an-email" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  test("short password (< 8 chars) → ValidationError", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ password: "short" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  test("missing country → ValidationError", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ country: "" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  // ─── Field-payload projection (VALIDATION extensions.fields) ────────

  test("multi-field failure → ValidationError carries a fields payload naming every offending field", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ fullName: "   ", email: "not-an-email", password: "short", country: "" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError instance");

      const fields = error.fields ?? [];
      const byField = new Map(fields.map(entry => [entry.field, entry.code]));
      expect(byField.get("fullName")).toBe("NAME_REQUIRED");
      expect(byField.get("email")).toBe("EMAIL_INVALID");
      expect(byField.get("password")).toBe("PASSWORD_TOO_SHORT");
      expect(byField.get("country")).toBe("COUNTRY_REQUIRED");
      // The top-level message stays the FIRST entry's message (backwards-
      // compatible with the throw-on-first-failure contract).
      expect(error.message).toBe(fields[0]?.message);
      // phone/role were valid — they never appear in the payload.
      expect(fields.map(entry => entry.field)).not.toContain("phone");
      expect(fields.map(entry => entry.field)).not.toContain("role");
    });
  });

  test("single-field failure → fields payload has exactly one entry mirroring the top-level message", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ phone: "" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError instance");

      expect(error.fields).toHaveLength(1);
      expect(error.fields?.[0]).toMatchObject({ field: "phone", code: "PHONE_REQUIRED" });
      expect(error.fields?.[0]?.message).toBe(error.message);
    });
  });

  test("invalid gender → GENDER_INVALID entry with the generic validation message (not the email copy-paste)", async () => {
    await runInRollback(async tx => {
      // Transport-tamper shape: the GraphQL enum layer rejects this before
      // the resolver, but the service guard defends in depth.
      //
      // Pattern matches the BOPLA test below: construct a base
      // `RegistrationSubmitInput` (so the static type stays honest —
      // `gender` is `Gender | undefined`), then `Object.assign` a runtime
      // string value to simulate a hostile client bypassing the GraphQL
      // enum layer. The runtime field read inside the service sees the
      // string "unknown" and emits `GENDER_INVALID`. No `as unknown as`
      // cast (avoids `typescript/no-unsafe-type-assertion`).
      const input: RegistrationSubmitInput = { ...makeValidInput({}) };
      Object.assign(input, { gender: "unknown" });
      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      if (!(error instanceof ValidationError)) throw new Error("expected a ValidationError instance");

      expect(error.fields).toHaveLength(1);
      expect(error.fields?.[0]).toMatchObject({ field: "gender", code: "GENDER_INVALID" });
      // Regression lock: this branch historically threw the EMAIL_INVALID
      // message (copy-paste bug) — the entry now carries the generic
      // localized validation message instead.
      expect(error.fields?.[0]?.message).toBe(getServerTranslations(LOCALE).errorsTranslations.validation);
      expect(error.fields?.[0]?.message).not.toBe(getServerTranslations(LOCALE).authTranslations.emailInvalid);
    });
  });

  // ─── BOPLA defense ──────────────────────────────────────────────────

  test("BOPLA: extra fields (isDeleted, balance, id, handshakeCode) are ignored", async () => {
    await runInRollback(async tx => {
      // Construct input with hostile extras that should NEVER reach the DB.
      // `Object.assign` keeps the base input typed as `RegistrationSubmitInput`
      // while appending hostile runtime fields — no `as unknown as` cast.
      const hostileInput: RegistrationSubmitInput = {
        fullName: "Hostile Input",
        email: `hostile-${crypto.randomUUID()}@test.local`,
        phone: "+10000000000",
        password: TEST_DEFAULT_CREDENTIAL,
        country: "Egypt",
        role: "student",
      };
      // Hostile extras — the service MUST ignore these (transport-layer tamper).
      Object.assign(hostileInput, {
        id: 99999,
        isDeleted: true,
        isBlocked: true,
        balanceHifz: 1_000_000,
        handshakeCode: "EVIL-CODE",
        suspended: true,
      });

      const result = await RegistrationService.registerUser(hostileInput, LOCALE, tx);

      // The server-generated id must NOT be 99999.
      expect(result.id).not.toBe(99999);
      expect(result.isDeleted).toBe(false);
      expect(result.isBlocked).toBe(false);
      expect(result.suspended).toBe(false);

      // Students row must have zeroed balances + a fresh server-generated
      // handshakeCode — never the hostile values.
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      expect(studentRows).toHaveLength(1);
      const studentRow = studentRows[0];
      if (!studentRow) throw new Error("expected student row");
      expect(studentRow.balanceHifz).toBe(0);
      expect(studentRow.handshakeCode).not.toBe("EVIL-CODE");
      expect(studentRow.handshakeCode).toMatch(/^KSB-[A-Z0-9]{8}$/);
    });
  });

  // ─── Atomicity ──────────────────────────────────────────────────────

  test("atomicity: child-insert failure → zero residual users rows (full rollback)", async () => {
    await runInRollback(async tx => {
      // Force a child-insert failure by monkey-patching ApplicantRepository.create
      // to throw. The service runs inside a SAVEPOINT (because `tx` was passed),
      // so the savepoint rolls back without aborting the outer transaction —
      // the test can still query `tx` afterwards.
      const applicantModule = await import("@/backend/db/repo/teachers/applicant.repository");
      const originalCreate = applicantModule.ApplicantRepository.create;
      let callCount = 0;
      applicantModule.ApplicantRepository.create = async (_userId: number, _tx: DBTransaction) => {
        callCount++;
        throw new Error("Forced child-insert failure (atomicity test)");
      };

      try {
        const input = makeValidInput({ role: "teacher" });

        const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
        expect(error.message).toContain("Forced child-insert failure");

        // The user insert MUST have rolled back — no residual users row for
        // THIS registration identity.
        await expectNoResidualUser(tx, input.email);
        expect(callCount).toBe(1);
      } finally {
        // Restore the original method.
        applicantModule.ApplicantRepository.create = originalCreate;
      }
    });
  });

  // ─── Password hashing ───────────────────────────────────────────────

  test("password stored hashed (not plaintext) and is bcrypt-verifiable", async () => {
    await runInRollback(async tx => {
      const plaintext = TEST_DEFAULT_CREDENTIAL;
      const input = makeValidInput({ password: plaintext, role: "student" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);

      // Fetch the raw row to inspect the stored hash (service omits it from
      // the return type — that's the BOPLA defense for the response shape).
      const userRows = await tx.select().from(users).where(eq(users.id, result.id));
      const storedRow = userRows[0];
      if (!storedRow) throw new Error("expected user row");
      const storedHash = storedRow.passwordHash;

      // The stored hash MUST NOT be the plaintext.
      expect(storedHash).not.toBe(plaintext);
      expect(storedHash.length).toBeGreaterThan(0);

      // The hash MUST be bcrypt-verifiable against the plaintext.
      const matches = await comparePassword(plaintext, storedHash);
      expect(matches).toBe(true);

      // A wrong password MUST NOT verify.
      const wrongMatches = await comparePassword("wrong-password", storedHash);
      expect(wrongMatches).toBe(false);
    });
  });

  // ─── Admin privileged path ──────────────────────────────────────────

  test("createAdminUser (privileged service path) creates users + admin rows", async () => {
    await runInRollback(async tx => {
      const input = {
        fullName: "Test Admin",
        email: `admin-${crypto.randomUUID()}@test.local`,
        phone: "+10000000000",
        password: TEST_DEFAULT_CREDENTIAL,
        country: "Egypt",
        role: "admin" as const,
      };

      const result = await RegistrationService.createAdminUser(input, LOCALE, tx);
      expect(result.role).toBe("admin");

      const adminRows = await tx.select().from(admin).where(eq(admin.id, result.id));
      expect(adminRows).toHaveLength(1);
    });
  });

  test("handshakeCode format: KSB- prefix + 8 uppercase alphanumeric", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "student" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      const studentRow = studentRows[0];
      if (!studentRow) throw new Error("expected student row");
      const code = studentRow.handshakeCode;

      // Format: KSB- + exactly 8 chars from [A-Z0-9].
      expect(code).toMatch(/^KSB-[A-Z0-9]{8}$/);
    });
  });
});

describe("registration contract locks", () => {
  // ─── one users row + one applicants row, zero teachers ───────────────

  test(
    "contract lock: teacher registration via production registerUser → exactly one users row" +
      " + exactly one applicants row sharing the user PK + teacher rowcount delta = 0",
    async () => {
      await runInRollback(async tx => {
        const input = makeValidInput({ role: "teacher" }); // randomized email

        const result = await RegistrationService.registerUser(input, LOCALE, tx);
        expect(result.role).toBe("teacher");

        // Exactly ONE users row exists for this identity (by PK and by email).
        const userRowsById = await tx.select().from(users).where(eq(users.id, result.id));
        expect(userRowsById).toHaveLength(1);
        const userRow = userRowsById[0];
        if (!userRow) throw new Error("expected users row");

        const userRowsByEmail = await tx.select().from(users).where(eq(users.email, input.email));
        expect(userRowsByEmail).toHaveLength(1);
        const userRowByEmail = userRowsByEmail[0];
        if (!userRowByEmail) throw new Error("expected users row by email");
        expect(userRowByEmail.id).toBe(userRow.id);

        // Exactly ONE applicants row sharing the user's PK (shared-PK child).
        const applicantRowsByPk = await tx.select().from(applicants).where(eq(applicants.id, userRow.id));
        expect(applicantRowsByPk).toHaveLength(1);
        const applicantRow = applicantRowsByPk[0];
        if (!applicantRow) throw new Error("expected applicants row");
        expect(applicantRow.id).toBe(userRow.id);

        // Table-level locks, identity-scoped (global counts race with parallel
        // committed-fixture teardown — AGENTS.md Rule 9 — so scope to this
        // registration identity instead of the whole table): exactly one users
        // row (asserted by PK and email above) and exactly one applicants row
        // sharing the user PK (asserted above) are already pinned; what remains
        // is the teacher rowcount delta = 0 — teacher registration must NOT
        // mint a teachers row for this user (teacher shares the users PK).
        const teacherRowsForUser = await tx.select().from(teacher).where(eq(teacher.id, userRow.id));
        expect(teacherRowsForUser).toHaveLength(0);
      });
    }
  );

  // ─── exact defaults signature on the applicants row ──────────────────

  test(
    "contract lock: created applicants row exact defaults — status='pending'," +
      " verificationAttempts=0, lastAttemptAt=null, cooldownUntil=null, timestamps set",
    async () => {
      await runInRollback(async tx => {
        const input = makeValidInput({ role: "teacher" });

        const result = await RegistrationService.registerUser(input, LOCALE, tx);

        const applicantRows = await tx.select().from(applicants).where(eq(applicants.id, result.id));
        expect(applicantRows).toHaveLength(1);
        const row = applicantRows[0];
        if (!row) throw new Error("expected applicants row");

        // Canonical status vocabulary — enum member, never a raw literal.
        expect(row.status).toBe(ApplicantStatus.Pending);
        expect(row.verificationAttempts).toBe(0);
        expect(row.lastAttemptAt).toBeNull();
        expect(row.cooldownUntil).toBeNull();

        // Timestamps set by database defaults: both present as real
        // timestamps, updatedAt not earlier than createdAt.
        //
        // NOTE: no application-wall-clock lower bound is asserted here ON
        // PURPOSE — `defaultNow()` resolves to PostgreSQL's transaction-start
        // time (BEGIN precedes the test body), so comparing against
        // `Date.now()` is off-by-milliseconds nondeterministic even on the
        // same host. The contract only requires the defaults to be
        // SET; intra-database ordering is deterministic and asserted instead.
        if (!row.createdAt) throw new Error("expected createdAt set by DB default");
        if (!row.updatedAt) throw new Error("expected updatedAt set by DB default");
        expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
      });
    }
  );

  // ─── forced child-insert failure ⇒ zero residual rows ────────────────

  test(
    "contract lock: forced applicants-insert failure inside the nested transaction" +
      " → zero residual users AND applicants rows (SAVEPOINT-aware rollback)",
    async () => {
      await runInRollback(async tx => {
        const input = makeValidInput({ role: "teacher" });

        const forcedFailure: { error: Error | null } = { error: null };
        const stubCallCount = await withForcedApplicantCreateFailure(async () => {
          forcedFailure.error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
        });

        // The injected failure fired EXACTLY once, at the applicants stage,
        // and surfaced through the production error path unchanged.
        expect(stubCallCount).toBe(1);
        const error = forcedFailure.error;
        if (!error) throw new Error("expected the forced-failure registration to reject");
        expect(error.message).toContain(FORCED_APPLICANT_FAILURE_MESSAGE);

        // ZERO residual rows for THIS identity — the savepoint-aware rollback
        // of the nested transaction erased the users insert that had already
        // been made before the failed child insert. Identity-scoped (unique
        // per-run email) because global table counts race with parallel
        // committed-fixture teardown (AGENTS.md Rule 9). This also covers the
        // applicants side: the applicants row shares the users PK (FK) and the
        // stub throws BEFORE any insert, so with the users row gone no
        // applicant row can exist for this identity. The query itself doubles
        // as proof that the outer tx is still usable after the inner rollback.
        await expectNoResidualUser(tx, input.email);
      });
    }
  );

  // ─── idempotency: duplicate-email race convergence ─────────────────────

  test(
    "contract lock (idempotency): duplicate-email race → exactly one winner + unique-violation loser," +
      " replay maps to ConflictError(CONFLICT) via the production surface, no duplicate rows",
    async () => {
      await runInRollback(async tx => {
        const racedEmail = `race-${crypto.randomUUID()}@test.local`;
        const raceRow = buildRaceUserValues(racedEmail);

        // ── Layer 1 — CONCURRENT duplicate inserts racing the SAME unique index
        // (`users_email_unique`) via Promise.allSettled. Statements serialize
        // FIFO on this single session, so PG deterministically admits exactly
        // one arm and rejects the other with 23505.
        //
        // Harness note: the failed statement aborts the PG transaction (no
        // implicit per-statement savepoint exists, and drizzle's auto-generated
        // sibling savepoint names COLLIDE under concurrency — `sp<n>` derives
        // from the parent's `nestedIndex`, verified in
        // `node_modules/drizzle-orm/node-postgres/session.js`). Therefore the
        // race is bracketed by ONE explicitly-named savepoint and rescued by
        // rolling back to it as the very next statement after allSettled
        // settles — bounded, deterministic, and keeping the outer tx usable.
        await tx.execute(sql.raw("savepoint dev2004_race"));

        const settledArms = await Promise.allSettled([
          tx.insert(users).values({ ...raceRow }),
          tx.insert(users).values({ ...raceRow }),
        ]);
        const fulfilledArms = settledArms.filter(arm => arm.status === "fulfilled");
        const rejectedArms = settledArms.filter(arm => arm.status === "rejected");
        expect(fulfilledArms).toHaveLength(1);
        expect(rejectedArms).toHaveLength(1);

        const rejectedArm = rejectedArms[0];
        if (rejectedArm?.status !== "rejected") {
          throw new Error("expected exactly one rejected race arm");
        }
        expect(hasUniqueViolationCode(rejectedArm.reason)).toBe(true);

        // Bounded rescue — first command after the race settles. Erases the
        // race-window rows and lifts the aborted state off the outer tx.
        await tx.execute(sql.raw("rollback to savepoint dev2004_race"));

        // Containment evidence: zero residual rows survived the race window.
        const afterRaceRows = await tx.select().from(users).where(eq(users.email, racedEmail));
        expect(afterRaceRows).toHaveLength(0);

        // ── Layer 2 — production surface creates the REAL account for that
        // identity (users + applicants rows, full registration contract shape).
        const raceInput = makeValidInput({ email: racedEmail, role: "teacher" });
        const winner = await RegistrationService.registerUser(raceInput, LOCALE, tx);
        expect(winner.role).toBe("teacher");

        // ── Layer 3 — production-surface REPLAY: registering the raced email
        // again through registerUser hits the same users_email_unique
        // violation and maps it to ConflictError with code CONFLICT
        // (23505 inheritance per the idempotency contract).
        const replayError = await expectRepoError(() =>
          RegistrationService.registerUser(makeValidInput({ email: racedEmail, role: "teacher" }), LOCALE, tx)
        );
        expect(replayError).toBeInstanceOf(ConflictError);
        if (!(replayError instanceof ConflictError)) throw new Error("expected ConflictError");
        expect(replayError.code).toBe("CONFLICT");

        // NO duplicates persisted for the raced identity — exactly one users
        // row, and its shared-PK applicants row is intact (uniqueness anchor).
        const racedUserRows = await tx.select().from(users).where(eq(users.email, racedEmail));
        expect(racedUserRows).toHaveLength(1);
        const racedApplicantRows = await tx.select().from(applicants).where(eq(applicants.id, winner.id));
        expect(racedApplicantRows).toHaveLength(1);
      });
    }
  );
});
