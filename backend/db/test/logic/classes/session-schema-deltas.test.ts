/**
 * Session schema-delta tests — the `session.held_balance_lane` provenance
 * column + the `session_request_idempotency` idempotency-claim table,
 * against the live test PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY direct
 *    Drizzle query and entity-setup call.
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus a
 *    file-local `setupSessionActors` (the `teacher` row has no entity-setup
 *    factory — it is a single shared-PK insert, see its schema definition).
 *  - Error assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and never used here.
 *    PostgreSQL driver errors are identified through the Drizzle error
 *    `cause` chain (same traversal precedent as the applicant-lifecycle
 *    suite in `logic/teachers/`).
 *  - A failed statement aborts its surrounding transaction (PostgreSQL
 *    semantics), so every error probe is the LAST statement of its own
 *    `runInRollback` body — nothing asserts inside an aborted transaction.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): lane-less insert reads `heldBalanceLane` as null;
 *    every held-balance-lane member round-trips the varchar(20) column and
 *    `$inferSelect` yields the enum-union type `HeldBalanceLane | null`
 *    (compile-pinned through the `acceptLane` sink with zero casts, plus the
 *    app-layer guard re-validation on the read-back); claim insert → select
 *    round-trip of all four columns.
 *  - Tier 2 (boundary): idempotency key at exactly 128 chars accepted and
 *    read back verbatim; 129 chars rejected with PG 22001 ("value too long").
 *  - Tier 3 (chaos/integrity): deleting the owning user cascades the claim
 *    away; deleting the session sets the claim's `session_id` to null while
 *    the claim itself survives; a duplicate key violates the unique
 *    constraint (PG 23505).
 *  - Tier 4 (security/tenancy): static reachability pins — the physical
 *    column/table names never appear anywhere under `backend/graphql/` and
 *    the lane enum is unregistered in the Pothos enum registry (the lane is
 *    server-internal provenance, structurally absent from the SDL), the
 *    schema source pins NO CHECK and NO index on the new column, and no
 *    schema file contains inline `--` SQL comments. Client-unreachability
 *    rationale: this slice adds no resolver and no input type; the claim
 *    table is written only by future repositories/services, and the closed
 *    create-input whitelist is specified to omit every server-controlled
 *    field including `heldBalanceLane` — nothing here is client-reachable.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { HeldBalanceLane, isHeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import type { DBTransaction } from "@/backend/types";

/** PostgreSQL error code for `string_data_right_truncation` (over-length varchar). */
const PG_VALUE_TOO_LONG = "22001";

/** PostgreSQL error code for `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";

/** Length boundary of the `idempotency_key` varchar column. */
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

interface SessionActors {
  studentUserId: number;
  studentRowId: number;
  teacherUserId: number;
}

/**
 * Creates a student user + students row and a teacher user + teacher row
 * (the minimal actor set a `session` row requires: its two restrict-deleted
 * FKs point at `students.id` and `teacher.id`).
 */
async function setupSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const studentUser = await createTestUser(tx);
  const student = await createTestStudent(tx, studentUser.id);
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await tx.insert(teacher).values({ id: teacherUser.id });
  return { studentUserId: studentUser.id, studentRowId: student.id, teacherUserId: teacherUser.id };
}

/** Inserts a minimal `session` row for the given actors inside `tx`. */
async function insertSession(tx: DBTransaction, actors: SessionActors) {
  const [row] = await tx
    .insert(session)
    .values({ teacherId: actors.teacherUserId, studentId: actors.studentRowId })
    .returning();
  if (!row) throw new Error("insertSession: insert returned no rows");
  return row;
}

/** Inserts an idempotency claim for the given user (optionally bound to a session). */
async function insertClaim(tx: DBTransaction, userId: number, sessionId: number | null, key: string) {
  const [row] = await tx
    .insert(sessionRequestIdempotency)
    .values({ idempotencyKey: key, userId, sessionId })
    .returning();
  if (!row) throw new Error("insertClaim: insert returned no rows");
  return row;
}

/**
 * Walks the Drizzle error `cause` chain to find whether the original
 * PostgreSQL error carries the given code — Drizzle wraps driver errors
 * behind its own generic "failed query" message.
 */
function hasPostgresErrorCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Returns the deepest `Error` in the Drizzle `cause` chain — the original
 * PostgreSQL error carrying the driver's own message (the top-level Drizzle
 * message is a generic "failed query" wrapper plus the SQL text).
 */
function rootCause(error: unknown): Error {
  let deepest = error;
  const seen = new Set<unknown>();
  while (deepest instanceof Error && !seen.has(deepest)) {
    seen.add(deepest);
    const cause = (deepest as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      deepest = cause;
    } else {
      break;
    }
  }
  return deepest instanceof Error ? deepest : new Error(String(deepest));
}

/**
 * Compile-level type sink: accepts exactly `HeldBalanceLane | null` — the
 * shape `$inferSelect` must yield for the lane column. If the column lost
 * its `$type<HeldBalanceLane>()` binding (or the column itself), assigning
 * a row's `heldBalanceLane` to this function fails the type check with
 * zero casts anywhere.
 */
function acceptLane(lane: HeldBalanceLane | null): HeldBalanceLane | null {
  return lane;
}

/**
 * Inserts a session, stamps the given lane on it, and reads the row back —
 * the full varchar(20) write → read cycle for one lane value.
 */
async function roundTripLane(tx: DBTransaction, actors: SessionActors, lane: HeldBalanceLane) {
  const created = await insertSession(tx, actors);
  await tx.update(session).set({ heldBalanceLane: lane }).where(eq(session.id, created.id));

  const [readBack] = await tx.select().from(session).where(eq(session.id, created.id));
  // The value survives the varchar(20) round-trip verbatim...
  expect(readBack?.heldBalanceLane).toBe(lane);
  // ...and the app-layer guard re-validates the read-back value.
  expect(isHeldBalanceLane(readBack?.heldBalanceLane)).toBe(true);
  // Compile pin: the select type IS `HeldBalanceLane | null` — this
  // assignment fails tsgo if the `$type<>()` binding is lost.
  acceptLane(readBack?.heldBalanceLane ?? null);
  return readBack;
}

/**
 * Project root derived from this file's location
 * (`backend/db/test/logic/classes/` is five levels deep).
 */
const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/** Recursively collects every `.ts` file below `rootDir`. */
function collectTypeScriptFiles(rootDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
  };
  walk(rootDir);
  return files;
}

describe("session.held_balance_lane schema delta", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("inserts a session without a lane and reads held_balance_lane back as null", async () => {
    await runInRollback(async tx => {
      const actors = await setupSessionActors(tx);
      const created = await insertSession(tx, actors);

      const [readBack] = await tx.select().from(session).where(eq(session.id, created.id));
      expect(readBack?.heldBalanceLane).toBeNull();
      expect(readBack?.feeHeld ?? false).toBe(false);
    });
  });

  test("round-trips every held-balance-lane member and $inferSelect yields HeldBalanceLane | null", async () => {
    await runInRollback(async tx => {
      const actors = await setupSessionActors(tx);

      // One explicit cycle per member — helper calls, not a loop: every
      // statement sequence runs inside the single rollback transaction.
      await roundTripLane(tx, actors, HeldBalanceLane.Trial);
      await roundTripLane(tx, actors, HeldBalanceLane.Hifz);
      await roundTripLane(tx, actors, HeldBalanceLane.Tajweed);
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("accepts a held_balance_lane value within its varchar(20) capacity", async () => {
    await runInRollback(async tx => {
      const actors = await setupSessionActors(tx);
      const created = await insertSession(tx, actors);
      await tx.update(session).set({ heldBalanceLane: HeldBalanceLane.Tajweed }).where(eq(session.id, created.id));

      const [readBack] = await tx.select().from(session).where(eq(session.id, created.id));
      expect(readBack?.heldBalanceLane).toBe(HeldBalanceLane.Tajweed);
    });
  });

  test("accepts an idempotency key at the 128-char boundary and reads it back verbatim", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const boundaryKey = randomUUID().replaceAll("-", "").repeat(16).slice(0, IDEMPOTENCY_KEY_MAX_LENGTH);
      expect(boundaryKey).toHaveLength(IDEMPOTENCY_KEY_MAX_LENGTH);

      const created = await insertClaim(tx, user.id, null, boundaryKey);
      expect(created.idempotencyKey).toBe(boundaryKey);

      const [readBack] = await tx
        .select()
        .from(sessionRequestIdempotency)
        .where(eq(sessionRequestIdempotency.idempotencyKey, boundaryKey));
      expect(readBack?.idempotencyKey).toHaveLength(IDEMPOTENCY_KEY_MAX_LENGTH);
      expect(readBack?.userId).toBe(user.id);
      expect(readBack?.sessionId).toBeNull();
      expect(readBack?.createdAt).toBeInstanceOf(Date);
    });
  });

  test("rejects a 129-char key with a value-too-long error (PG 22001)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const oversizedKey = randomUUID()
        .replaceAll("-", "")
        .repeat(16)
        .slice(0, IDEMPOTENCY_KEY_MAX_LENGTH + 1);
      expect(oversizedKey).toHaveLength(IDEMPOTENCY_KEY_MAX_LENGTH + 1);

      // Last statement of this rollback body — the failed insert aborts the tx.
      const error = await expectRepoError(() => insertClaim(tx, user.id, null, oversizedKey));

      expect(hasPostgresErrorCode(error, PG_VALUE_TOO_LONG)).toBe(true);
      // The DRIVER's message (deepest cause) carries the translated PostgreSQL
      // text; the top-level Drizzle message is a generic failed-query wrapper.
      expect(rootCause(error).message).toContain("value too long");
    });
  });

  // ─── Tier 3: chaos/integrity ────────────────────────────────────────

  test("claim insert → select round-trips all columns", async () => {
    await runInRollback(async tx => {
      const actors = await setupSessionActors(tx);
      const createdSession = await insertSession(tx, actors);
      const key = `claim-roundtrip-${randomUUID()}`;

      const created = await insertClaim(tx, actors.studentUserId, createdSession.id, key);

      const [readBack] = await tx
        .select()
        .from(sessionRequestIdempotency)
        .where(eq(sessionRequestIdempotency.idempotencyKey, key));
      expect(readBack?.id).toBe(created.id);
      expect(readBack?.idempotencyKey).toBe(key);
      expect(readBack?.userId).toBe(actors.studentUserId);
      expect(readBack?.sessionId).toBe(createdSession.id);
      expect(readBack?.createdAt).toBeInstanceOf(Date);
    });
  });

  test("deleting the owning user cascades the claim away", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const key = `cascade-${randomUUID()}`;
      await insertClaim(tx, user.id, null, key);
      expect(await tx.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, user.id))).toBe(1);

      await tx.delete(users).where(eq(users.id, user.id));

      expect(await tx.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, user.id))).toBe(0);
      expect(await tx.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.idempotencyKey, key))).toBe(0);
    });
  });

  test("deleting the session sets the claim's session_id to null and the claim survives", async () => {
    await runInRollback(async tx => {
      const actors = await setupSessionActors(tx);
      const createdSession = await insertSession(tx, actors);
      const key = `set-null-${randomUUID()}`;
      await insertClaim(tx, actors.studentUserId, createdSession.id, key);
      expect(
        await tx.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.sessionId, createdSession.id))
      ).toBe(1);

      await tx.delete(session).where(eq(session.id, createdSession.id));
      expect(await tx.$count(session, eq(session.id, createdSession.id))).toBe(0);

      const [readBack] = await tx
        .select()
        .from(sessionRequestIdempotency)
        .where(eq(sessionRequestIdempotency.idempotencyKey, key));
      expect(readBack).not.toBeNull();
      expect(readBack?.sessionId).toBeNull();
      expect(readBack?.userId).toBe(actors.studentUserId);
    });
  });

  test("a duplicate idempotency key violates the unique constraint (PG 23505)", async () => {
    await runInRollback(async tx => {
      const userA = await createTestUser(tx);
      const userB = await createTestUser(tx);
      const key = `dup-${randomUUID()}`;

      await insertClaim(tx, userA.id, null, key);
      expect(await tx.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.idempotencyKey, key))).toBe(1);

      // Last statement of this rollback body — the failed insert aborts the tx.
      const error = await expectRepoError(() => insertClaim(tx, userB.id, null, key));

      expect(hasPostgresErrorCode(error, PG_UNIQUE_VIOLATION)).toBe(true);
    });
  });

  // ─── Tier 4: security/tenancy (static reachability pins) ────────────

  test("physical names are absent from the GraphQL layer and the lane enum is unregistered in Pothos", () => {
    const graphQlFiles = collectTypeScriptFiles(join(PROJECT_ROOT, "backend", "graphql"));
    expect(graphQlFiles.length).toBeGreaterThan(0);

    for (const file of graphQlFiles) {
      const source = readFileSync(file, "utf8");
      expect(source.includes("session_request_idempotency")).toBe(false);
      expect(source.includes("held_balance_lane")).toBe(false);
    }

    const enumRegistrySource = readFileSync(
      join(PROJECT_ROOT, "backend", "graphql", "pothos", "shared", "enum.pothos.ts"),
      "utf8"
    );
    expect(enumRegistrySource.includes("HeldBalanceLane")).toBe(false);
  });

  test("schema sources pin: lane column has no CHECK and no index; no inline SQL comments", () => {
    const sessionSource = readFileSync(join(PROJECT_ROOT, "backend", "db", "schema", "classes", "session.ts"), "utf8");
    const claimSource = readFileSync(
      join(PROJECT_ROOT, "backend", "db", "schema", "classes", "session-request-idempotency.ts"),
      "utf8"
    );

    // The lane declaration binds the enum type and carries no index()/check()
    // (match the column declaration, not the JSDoc prose).
    const laneLine = sessionSource.split("\n").find(line => line.includes('varchar("held_balance_lane"'));
    expect(laneLine).toBeDefined();
    expect(laneLine).toContain("$type<HeldBalanceLane>()");
    expect(laneLine?.includes("index(")).toBe(false);
    expect(laneLine?.includes("check(")).toBe(false);
    // The session table declares no CHECK constraint anywhere.
    expect(sessionSource.includes("check(")).toBe(false);

    // No schema file in this delta contains inline `--` SQL comments
    // (nor any sql`` template at all — Drizzle builders only).
    expect(sessionSource.includes("--")).toBe(false);
    expect(claimSource.includes("--")).toBe(false);
    expect(sessionSource.includes("sql`")).toBe(false);
    expect(claimSource.includes("sql`")).toBe(false);
  });
});
