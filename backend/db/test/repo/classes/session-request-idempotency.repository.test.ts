/**
 * SessionRequestIdempotencyRepository tests — the claim table's data-access
 * layer (`insertClaim`, `updateClaimSessionId`, `findByKey`) against the
 * live `kottaby_test_db` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    every method under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus
 *    file-local shared-PK helpers — never seed data.
 *  - No `expect(...).rejects.toThrow()` — constraint probes go through
 *    `expectRepoError` inside an explicit SAVEPOINT bracket (a failed
 *    statement aborts the surrounding PostgreSQL transaction, so the
 *    bracket keeps the outer transaction queryable).
 *  - A separate committed-fixture group covers the STANDALONE executor
 *    branches (`queryDb` read + the `tx ?? db` write fallback). Those
 *    branches by definition run without a transaction, so their fixtures
 *    must be committed (an uncommitted row is invisible outside the tx);
 *    they are registered and hard-deleted in `afterAll` (rule 9).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): insert/find/backfill round-trip — the inserted
 *    claim echoes every column (key verbatim, nullable sessionId, Date
 *    createdAt); `findByKey` reproduces the row; the backfill writes ONLY
 *    `sessionId` (key/userId/createdAt untouched); a miss returns `null`
 *    and writes nothing.
 *  - Tier 2 (boundary): a 128-char key (the varchar capacity) is accepted
 *    and read back verbatim through both lookup branches.
 *  - Tier 3 (chaos/integrity): a duplicate claim insert surfaces the
 *    PostgreSQL unique-violation (`23505`, constraint
 *    `session_request_idempotency_key_unique`) with the cause chain intact
 *    — asserted via the cycle-safe `hasPostgresErrorCode` walker (Drizzle
 *    masks driver errors behind a generic message); the repo does NOT
 *    translate or swallow it; after the probe rollback the original claim
 *    is still the sole row for its user and the backfill still works.
 *  - Tier 4 (security/tenancy/static): a 129-char key is rejected loudly
 *    (PG `22001`) — never silently truncated, and nothing is persisted;
 *    the key is opaque — case/prefix/suffix variants never match (exact
 *    byte semantics); a mixed-charset key round-trips verbatim; source
 *    pins — the key is always a bound parameter, no prepared statements,
 *    no array-membership operators, no SQL line-comment sequences, no
 *    i18n/logger/console, no key logging, tx last on every signature.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { SessionRequestIdempotencyRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import type { DBTransaction, SessionInsertType } from "@/backend/types";

/** PostgreSQL error code for `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";

/** PostgreSQL error code for `string_data_right_truncation` (over-length varchar). */
const PG_VALUE_TOO_LONG = "22001";

/** Length boundary of the `idempotency_key` varchar column. */
const KEY_MAX_LENGTH = 128;

/** Physical name of the rejecting unique constraint (cause-chain assertion). */
const KEY_UNIQUE_CONSTRAINT = "session_request_idempotency_key_unique";

/** Builds an opaque in-test key of the requested exact length. */
function makeKey(length: number, tag: string): string {
  const raw = `k-${tag}-${crypto.randomUUID()}`;
  if (raw.length > length) {
    return raw.slice(0, length);
  }
  return raw.padEnd(length, "x");
}

/** Shared-PK ids for one booking pair (the backfill target's FK parties). */
interface SessionActors {
  teacherUserId: number;
  studentUserId: number;
}

/** Creates the minimal claim owner — one `users` row is the whole actor set. */
async function createClaimOwner(tx: DBTransaction): Promise<number> {
  const user = await createTestUser(tx, { role: "student" });
  return user.id;
}

/** Shared-PK `teacher` row insert — mirrors the entity-setup role-child pattern. */
async function createTestTeacherRow(tx: DBTransaction, userId: number): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved: true });
}

/** Creates one teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** Direct session-row insert for the backfill target (test precondition). */
async function insertSessionRow(tx: DBTransaction, actors: SessionActors): Promise<number> {
  const insert: SessionInsertType = {
    teacherId: actors.teacherUserId,
    studentId: actors.studentUserId,
    status: SessionStatus.Scheduled,
    sessionType: SessionType.StudentSession,
    intent: SessionIntent.Hifz,
    fee: "10.00",
    feeHeld: true,
    heldBalanceLane: HeldBalanceLane.Hifz,
  };
  const [row] = await tx.insert(session).values(insert).returning({ id: session.id });
  if (!row) {
    throw new Error("insertSessionRow: insert returned no rows");
  }
  return row.id;
}

/**
 * Walks the Drizzle error cause chain (cycle-safe — a `seen` set guards
 * against self-referential `cause` loops) hunting for the given PostgreSQL
 * SQLSTATE code. Drizzle wraps driver errors behind its own generic
 * "failed query" message, so the code is reachable only through the chain —
 * exactly what the service's duplicate-branch translation will consume.
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
 * Walks the same cycle-safe cause chain searching for an `Error.message`
 * containing the given substring — used to confirm the underlying
 * PostgreSQL diagnostic (constraint name, truncation notice) survives the
 * Drizzle wrapper intact.
 */
function causeChainContainsMessage(error: unknown, substring: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === "string" && current.message.includes(substring)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Counts the claims owned by one user (in-tx read-back oracle). */
async function countClaimsForUser(tx: DBTransaction, userId: number): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.userId, userId));
  return row?.value ?? 0;
}

describe("SessionRequestIdempotencyRepository — transactional paths (runInRollback)", () => {
  // ─── Tier 1: insert / find / backfill round-trip ─────────────────────

  test("insertClaim echoes the full row; findByKey reproduces it; backfill writes ONLY sessionId", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(40, "roundtrip");

      const claim = await SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx);
      expect(claim.id).toBeGreaterThan(0);
      expect(claim.idempotencyKey).toBe(key);
      expect(claim.userId).toBe(owner);
      expect(claim.sessionId).toBeNull();
      expect(claim.createdAt).toBeInstanceOf(Date);

      const found = await SessionRequestIdempotencyRepository.findByKey(key, tx);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(claim.id);
      expect(found?.idempotencyKey).toBe(key);
      expect(found?.userId).toBe(owner);
      expect(found?.sessionId).toBeNull();
      expect(found?.createdAt).toEqual(claim.createdAt);

      const actors = await createSessionActors(tx);
      const sessionId = await insertSessionRow(tx, actors);
      await SessionRequestIdempotencyRepository.updateClaimSessionId(claim.id, sessionId, tx);

      const after = await SessionRequestIdempotencyRepository.findByKey(key, tx);
      expect(after?.sessionId).toBe(sessionId);
      expect(after?.idempotencyKey).toBe(key);
      expect(after?.userId).toBe(owner);
      expect(after?.createdAt).toEqual(claim.createdAt);
    });
  });

  test("findByKey returns null for an unclaimed key (miss writes nothing)", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(40, "miss");

      expect(await SessionRequestIdempotencyRepository.findByKey(key, tx)).toBeNull();
      expect(await countClaimsForUser(tx, owner)).toBe(0);

      await SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx);
      expect(await SessionRequestIdempotencyRepository.findByKey(makeKey(40, "other-miss"), tx)).toBeNull();
      expect(await countClaimsForUser(tx, owner)).toBe(1);
    });
  });

  test("updateClaimSessionId refuses to backfill an unknown claim (defensive invariant)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionId = await insertSessionRow(tx, actors);
      const [maxClaim] = await tx
        .select({ maxId: sql<number>`coalesce(max(${sessionRequestIdempotency.id}), 0)::int` })
        .from(sessionRequestIdempotency);
      const absentClaimId = (maxClaim?.maxId ?? 0) + 1_000_000;

      const error = await expectRepoError(() =>
        SessionRequestIdempotencyRepository.updateClaimSessionId(absentClaimId, sessionId, tx)
      );
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("update matched no rows");
    });
  });

  // ─── Tier 2: 128-char boundary ───────────────────────────────────────

  test("a 128-char key (varchar capacity) is accepted and read back verbatim", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(KEY_MAX_LENGTH, "boundary");
      expect(key).toHaveLength(KEY_MAX_LENGTH);

      const claim = await SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx);
      expect(claim.idempotencyKey).toHaveLength(KEY_MAX_LENGTH);

      const found = await SessionRequestIdempotencyRepository.findByKey(key, tx);
      expect(found?.id).toBe(claim.id);
      expect(found?.idempotencyKey).toBe(key);
      expect(found?.idempotencyKey).toHaveLength(KEY_MAX_LENGTH);
    });
  });

  // ─── Tier 3: duplicate insert → 23505 with the cause chain intact ────

  test("a duplicate key insert surfaces PG 23505 untranslated; the original claim stays sole and backfillable", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(48, "duplicate");
      const claim = await SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx);

      await tx.execute(sql`savepoint claim_dup_probe`);
      const dupError = await expectRepoError(() =>
        SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx)
      );
      await tx.execute(sql`rollback to savepoint claim_dup_probe`);

      // The 23505 bubbles RAW — the repo neither catches nor translates it.
      expect(hasPostgresErrorCode(dupError, PG_UNIQUE_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(dupError, KEY_UNIQUE_CONSTRAINT)).toBe(true);
      expect(hasPostgresErrorCode(dupError, PG_VALUE_TOO_LONG)).toBe(false);

      // Post-rollback: the original claim is still the sole row and the
      // replay path (find + backfill) is fully operational.
      expect(await countClaimsForUser(tx, owner)).toBe(1);
      const replayed = await SessionRequestIdempotencyRepository.findByKey(key, tx);
      expect(replayed?.id).toBe(claim.id);
      const actors = await createSessionActors(tx);
      const sessionId = await insertSessionRow(tx, actors);
      await SessionRequestIdempotencyRepository.updateClaimSessionId(claim.id, sessionId, tx);
      expect((await SessionRequestIdempotencyRepository.findByKey(key, tx))?.sessionId).toBe(sessionId);
    });
  });

  // ─── Tier 4: the key is opaque — never coerced or truncated silently ─

  test("a 129-char key is rejected loudly (22001) and nothing is persisted", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(KEY_MAX_LENGTH + 1, "overlong");
      expect(key).toHaveLength(KEY_MAX_LENGTH + 1);

      await tx.execute(sql`savepoint claim_len_probe`);
      const lenError = await expectRepoError(() =>
        SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx)
      );
      await tx.execute(sql`rollback to savepoint claim_len_probe`);

      expect(hasPostgresErrorCode(lenError, PG_VALUE_TOO_LONG)).toBe(true);
      expect(causeChainContainsMessage(lenError, "value too long")).toBe(true);

      // The over-length key was NOT silently truncated into a claim.
      expect(await countClaimsForUser(tx, owner)).toBe(0);
      const truncated = key.slice(0, KEY_MAX_LENGTH);
      expect(await SessionRequestIdempotencyRepository.findByKey(truncated, tx)).toBeNull();
    });
  });

  test("the key matches by exact bytes only — case/prefix/suffix variants never collide", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = `k-MiXeD-${randomUUID()}`;

      const claim = await SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx);
      expect(claim.idempotencyKey).toBe(key);

      expect(await SessionRequestIdempotencyRepository.findByKey(key.toUpperCase(), tx)).toBeNull();
      expect(await SessionRequestIdempotencyRepository.findByKey(key.toLowerCase(), tx)).toBeNull();
      expect(await SessionRequestIdempotencyRepository.findByKey(`${key}x`, tx)).toBeNull();
      expect(await SessionRequestIdempotencyRepository.findByKey(`x${key}`, tx)).toBeNull();

      const found = await SessionRequestIdempotencyRepository.findByKey(key, tx);
      expect(found?.id).toBe(claim.id);
    });
  });

  test("a mixed-charset key (unicode, punctuation) round-trips verbatim — opaque payload", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = `ключ-🔑-!@#<>&'%_${randomUUID()}`;

      const claim = await SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx);
      expect(claim.idempotencyKey).toBe(key);
      expect((await SessionRequestIdempotencyRepository.findByKey(key, tx))?.idempotencyKey).toBe(key);
    });
  });

  // ─── Tier 4: static source pins ──────────────────────────────────────

  const REPO_FILE = join(import.meta.dir, "../../../repo/classes/session-request-idempotency.repository.ts");
  const repoSource = readFileSync(REPO_FILE, "utf8");

  test("source: the key is always a bound parameter — never interpolated, logged, or coerced", () => {
    expect(repoSource.includes("eq(sessionRequestIdempotency.idempotencyKey, key)")).toBe(true);
    expect(repoSource.includes("WHERE idempotency_key = $1")).toBe(true);
    expect(repoSource.includes("[key]")).toBe(true);
    // The key flows from the typed insert object; no string transformation
    // (trim/slice/replace/normalize) is applied anywhere.
    expect(/(trim|slice|substring|replace|normalize|padStart|padEnd)\(/.test(repoSource)).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
  });

  test("source: no prepared statements, no array-membership operators, no SQL line-comment sequences", () => {
    expect(repoSource.includes(".prepare(")).toBe(false);
    expect(repoSource.includes("sql.placeholder")).toBe(false);
    expect(repoSource.includes("sql.raw")).toBe(false);
    expect(repoSource.includes("inArray")).toBe(false);
    expect(repoSource.includes("--")).toBe(false);
    expect(repoSource.includes("let ")).toBe(false);
  });

  test("source: executor discipline — writes on tx ?? db, standalone reads via queryDb, tx last everywhere", () => {
    expect(repoSource.match(/const executor = tx \?\? db;/g) ?? []).toHaveLength(2);
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(1);
    expect(repoSource.match(/export async function /g) ?? []).toHaveLength(3);
    // 4 = 3 method signatures + the header convention line ("Every method
    // takes `tx?: DBTransaction` as its LAST parameter").
    expect(repoSource.match(/tx\?: DBTransaction/g) ?? []).toHaveLength(4);
    expect(repoSource.includes("tx: DBTransaction")).toBe(false);
  });

  test("source: no i18n, no logger, one namespace, no plan-artifact references", () => {
    expect(repoSource.includes("getServerTranslations")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
    expect(repoSource.includes("export namespace SessionRequestIdempotencyRepository")).toBe(true);
    expect(repoSource.match(/export namespace /g) ?? []).toHaveLength(1);
    expect(/REQ-\d|DEV\d|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

/**
 * Standalone executor branches — the `queryDb` read path and the `tx ?? db`
 * write fallback. These branches run WITHOUT a transaction by definition,
 * so their fixtures must be COMMITTED (an uncommitted row is invisible to
 * the pool path). They are registered here and hard-deleted in `afterAll`
 * (rule 9) in FK-dependency order (claim + session first; the user delete
 * then cascades the role rows).
 */
describe("SessionRequestIdempotencyRepository — standalone executor paths (committed fixtures)", () => {
  let committedSessionId = 0;
  let committedClaimOwnerId = 0;
  const committedUserIds: number[] = [];
  const committedClaimIds: number[] = [];
  const committedKey = `standalone-${randomUUID()}`;
  const absentKey = `standalone-absent-${randomUUID()}`;

  afterAll(async () => {
    // Claims first, then the session (the claim's session FK is set-null,
    // but explicit order keeps the cleanup intent obvious); the user
    // deletes then cascade the role rows.
    await Promise.all(
      committedClaimIds.map(id => db.delete(sessionRequestIdempotency).where(eq(sessionRequestIdempotency.id, id)))
    );
    committedClaimIds.length = 0;
    if (committedSessionId > 0) {
      await db.delete(session).where(eq(session.id, committedSessionId));
      committedSessionId = 0;
    }
    await Promise.all(
      committedUserIds.map(async userId => {
        await db.delete(teacher).where(eq(teacher.id, userId));
        await db.delete(students).where(eq(students.id, userId));
        await db.delete(users).where(eq(users.id, userId));
      })
    );
    committedUserIds.length = 0;
  });

  test("insertClaim + updateClaimSessionId fall back to the pool and findByKey reads standalone via queryDb", async () => {
    const claimId = await db.transaction(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id);
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id);
      committedUserIds.push(teacherUser.id, studentUser.id);
      committedClaimOwnerId = studentUser.id;

      const [sessionRow] = await tx
        .insert(session)
        .values({
          teacherId: teacherUser.id,
          studentId: studentUser.id,
          status: SessionStatus.Scheduled,
          sessionType: SessionType.StudentSession,
          intent: SessionIntent.Hifz,
          fee: "10.00",
          feeHeld: true,
          heldBalanceLane: HeldBalanceLane.Hifz,
        })
        .returning({ id: session.id });
      if (!sessionRow) {
        throw new Error("standalone fixture: session insert returned no rows");
      }
      committedSessionId = sessionRow.id;
      return sessionRow.id;
    });
    expect(committedUserIds).toHaveLength(2);
    expect(committedClaimOwnerId).toBeGreaterThan(0);
    expect(committedSessionId).toBe(claimId);

    const claim = await SessionRequestIdempotencyRepository.insertClaim({
      idempotencyKey: committedKey,
      userId: committedClaimOwnerId,
    });
    committedClaimIds.push(claim.id);
    expect(claim.idempotencyKey).toBe(committedKey);
    expect(claim.sessionId).toBeNull();

    await SessionRequestIdempotencyRepository.updateClaimSessionId(claim.id, committedSessionId);

    const found = await SessionRequestIdempotencyRepository.findByKey(committedKey);
    expect(found?.id).toBe(claim.id);
    expect(found?.sessionId).toBe(committedSessionId);
    expect(found?.idempotencyKey).toBe(committedKey);

    expect(await SessionRequestIdempotencyRepository.findByKey(absentKey)).toBeNull();
  });
});
