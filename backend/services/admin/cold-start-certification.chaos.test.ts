/**
 * ColdStartCertificationService — chaos, concurrency & fuzz suite.
 *
 * Extends the sequential proofs of `cold-start-certification.service.test.ts`
 * into explicit `Promise.allSettled` variants that prove the race-condition
 * and rollback-safety guarantees of the cold-start certification service.
 *
 * Probes:
 *  (a) concurrent double-certify on the SAME target:
 *      - row-absent path — exactly one success + one
 *        TEACHER_ALREADY_CERTIFIED (the `teacher` PK unique constraint is
 *        the loser-safety guarantee; both calls read row-absent, both
 *        attempt the insert, exactly one's statement lands).
 *      - elevation path (pre-existing unapproved row) — same outcome via
 *        the guarded UPDATE + zero-row re-read disambiguation.
 *      DB oracle for both variants: exactly ONE `teacher` row, ONE audit
 *      row TOTAL, ONE notification row TOTAL, ONE recorded publish.
 *  (b) forced mid-transaction failure — a spy-injected repository failure
 *      on the applicants-finalize stage rolls the whole transaction back:
 *      ZERO residue across `teacher` / `applicants` / `audit_logs` /
 *      `notifications`, and the spied fan-out transport proves ZERO
 *      publishes (the publish step is structurally unreachable pre-commit).
 *  (c) hostile `userId` fuzz — 0 / -1 / 1.5 / NaN / 2^53 are rejected with
 *      the VALIDATION code class PRE-DB: a `UserRepository.findById` spy
 *      proves no repository read ever probed the fuzzed id (only the
 *      gate's actor read is permitted).
 *  (d) 25-way parallel certify storm over DISTINCT targets — all settle
 *      fulfilled with per-target correctness (certified row, flags honored)
 *      and totals-based oracles (25 audit rows, 25 notification rows, 25
 *      publishes, each addressed to its own target).
 *
 * HARNESSES:
 *  - Chaos probes (a), (b), (d) use the GLOBAL `db` (no outer tx) — each
 *    service call opens its own top-level transaction via
 *    `withTransaction(undefined, ...)`, which gives each concurrent call
 *    its own connection from the pool. Fixtures are provisioned in
 *    committed `db.transaction`s and tracked in `createdUserIds` for the
 *    describe-scoped `afterAll`, which hard-deletes them via the shared
 *    `deleteUsersByIds` helper (it pre-cleans the RESTRICT-gated
 *    `audit_logs` rows written BY the admin actor — every certification
 *    audit row carries the actor's id, so the actor-clause covers them).
 *  - Fuzz probes (c) use `runInRollback` — no concurrency, so the
 *    shared-tx path is safe and the rollback auto-cleans.
 *  - Rows are resolved by database CONSTRAINTS + guarded writes, never by
 *    sleeps; there are no timing-based assertions anywhere in this file.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { ApplicantRepository, UserRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { DomainError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { ColdStartCertificationService } from "@/backend/services/admin/cold-start-certification.service";
import type { ApplicantSelectType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (NOT the `@/test/helpers` barrel) — the barrel pulls the
// Apollo test client into a backend-suite module graph; the db-cleanup
// module itself only needs drizzle + the db handle.
import { countUsersByIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";
import { SpiedFanoutTransport } from "@/test/workflows/helpers";

const LOCALE_EN = "en";
const tErrors = getServerTranslations(LOCALE_EN).errorsTranslations;

/** Parallel breadth of the distinct-target certify storm. */
const STORM_SIZE = 25;

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

/**
 * Outcome-bucket helper — sorts `Promise.allSettled` results into
 * `fulfilled` + `rejected` arrays (mirrors the sibling chaos suite).
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

/** Chaos-suite fixture bundle — provisioned in `beforeAll`, cleaned in `afterAll`. */
interface ChaosFixtures {
  adminActor: UserSelectType;
  createdUserIds: number[];
}

let fixtures: ChaosFixtures;

beforeAll(async () => {
  // Provision the admin actor in a committed top-level transaction so it
  // persists across the chaos probes (each probe runs its own top-level
  // transaction via `withTransaction(undefined, ...)`).
  fixtures = await db.transaction(async tx => {
    const adminActor = await createTestUser(tx, { role: "admin" });
    return { adminActor, createdUserIds: [adminActor.id] };
  });
});

afterAll(async () => {
  const ids = [...fixtures.createdUserIds];
  if (ids.length === 0) return;
  const deleted = await deleteUsersByIds(ids);
  expect(deleted).toBe(ids.length);
  expect(await countUsersByIds(ids)).toBe(0);
});

/** Provisioned target bundle — the committed user plus its optional rows. */
interface ProvisionedTarget {
  target: UserSelectType;
  applicant: ApplicantSelectType | null;
}

/**
 * Provisions a committed teacher-role target (user row, optional pre-existing
 * unapproved `teacher` row, optional `applicants` row) and registers the
 * user id for teardown.
 */
async function provisionTeacherTarget(options: {
  withUnapprovedRow?: boolean;
  withApplicant?: boolean;
}): Promise<ProvisionedTarget> {
  const created = await db.transaction(async tx => {
    const target = await createTestUser(tx, { role: "teacher" });
    if (options.withUnapprovedRow === true) {
      await tx.insert(teacher).values({ id: target.id });
    }
    const applicant = options.withApplicant === true ? await createTestApplicant(tx, target.id) : null;
    return { target, applicant };
  });
  fixtures.createdUserIds.push(created.target.id);
  return created;
}

/** Common committed call expression — service under test, spied transport seam, no outer tx. */
async function callCommitted(
  targetId: number,
  makeEvaluator: boolean,
  transport: SpiedFanoutTransport
): ReturnType<typeof ColdStartCertificationService.certifyTeacherColdStart> {
  return ColdStartCertificationService.certifyTeacherColdStart(
    fixtures.adminActor.id,
    { userId: targetId, makeEvaluator },
    LOCALE_EN,
    { transport }
  );
}

/** Counts `teacher` rows among the given ids (committed oracle). */
async function countTeacherRows(ids: readonly number[]): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teacher)
    .where(inArray(teacher.id, [...ids]));
  return row?.count ?? 0;
}

/** Counts certification audit rows (`entityType = "teacher"`) for the given entity ids. */
async function countCertAuditRows(ids: readonly number[]): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "teacher"), inArray(auditLogs.entityId, [...ids])));
  return row?.count ?? 0;
}

/** Counts `notifications` rows addressed to the given recipients. */
async function countNotificationRows(ids: readonly number[]): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(inArray(notifications.userId, [...ids]));
  return row?.count ?? 0;
}

/** Reads the single `teacher` row for the id, or null. */
async function readTeacherRow(id: number) {
  const rows = await db.select().from(teacher).where(eq(teacher.id, id));
  return rows[0] ?? null;
}

/** Reads the certification audit rows for one target (exact-JSON oracle). */
async function readCertAuditRows(targetId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, targetId)));
}

describe("ColdStartCertificationService — chaos & concurrency", () => {
  // PGlite is a single-connection WASM Postgres — two concurrent top-level
  // `db.transaction(...)` calls share the same underlying connection and
  // interleave their `BEGIN` / `INSERT` / `COMMIT` statements at the
  // protocol level, which breaks the unique-index / row-lock serialization
  // the probes below assert. The probes are only meaningful against a real
  // multi-connection pool (production PG / Neon / CI). Skip them under
  // `DB_PROVIDER=pglite` to avoid false negatives that reflect a transport
  // limitation, not a service-layer defect.
  const IS_PGLITE = (process.env.DB_PROVIDER ?? "").toLowerCase() === "pglite";
  const concurrencyTest = IS_PGLITE ? test.skip : test;

  // ─── (a) Concurrent double-certify — row-absent path ────────────────
  concurrencyTest(
    "concurrent double-certify on the same row-absent target → exactly one success + one TEACHER_ALREADY_CERTIFIED",
    async () => {
      silenceDomainLog();
      const { target } = await provisionTeacherTarget({});
      const transport = new SpiedFanoutTransport();

      const results = await Promise.allSettled([
        callCommitted(target.id, true, transport),
        callCommitted(target.id, true, transport),
      ]);
      const { fulfilled, rejected } = partitionOutcomes(results);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0];
      if (!winner) throw new Error("Expected a winner");
      expect(winner.id).toBe(target.id);
      expect(winner.teacher?.isApproved).toBe(true);
      expect(winner.teacher?.isEvaluator).toBe(true);

      const loser = rejected[0];
      if (!(loser instanceof Error)) throw new Error("Expected the loser to be an Error");
      assertErrorCode(loser, "TEACHER_ALREADY_CERTIFIED");
      expect(loser.message).toContain(tErrors.teacherAlreadyCertified);

      // Totals oracles: exactly ONE teacher row, ONE audit row, ONE
      // notification row, ONE publish — the loser appended nothing.
      expect(await countTeacherRows([target.id])).toBe(1);
      const row = await readTeacherRow(target.id);
      expect(row?.isApproved).toBe(true);
      expect(row?.isEvaluator).toBe(true);
      expect(await countCertAuditRows([target.id])).toBe(1);
      expect(await countNotificationRows([target.id])).toBe(1);
      const auditRows = await readCertAuditRows(target.id);
      expect(auditRows[0]?.details).toBe(
        JSON.stringify({ makeEvaluator: true, applicantRow: "absent", elevation: "created" })
      );
      expect(transport.publishCount).toBe(1);
      expect(transport.publishedUserIds).toEqual([target.id]);
    }
  );

  // ─── (a) Concurrent double-certify — elevation path ─────────────────
  concurrencyTest(
    "concurrent double-certify on a pre-existing unapproved row → exactly one elevation wins + one TEACHER_ALREADY_CERTIFIED",
    async () => {
      silenceDomainLog();
      const { target } = await provisionTeacherTarget({ withUnapprovedRow: true });
      const transport = new SpiedFanoutTransport();

      const results = await Promise.allSettled([
        callCommitted(target.id, true, transport),
        callCommitted(target.id, true, transport),
      ]);
      const { fulfilled, rejected } = partitionOutcomes(results);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0];
      if (!winner) throw new Error("Expected a winner");
      expect(winner.id).toBe(target.id);
      expect(winner.teacher?.isApproved).toBe(true);

      const loser = rejected[0];
      if (!(loser instanceof Error)) throw new Error("Expected the loser to be an Error");
      // Loser-safety on the elevation path: the guarded UPDATE matches zero
      // rows against the winner's committed state and the re-read resolves
      // the race to the conflict — never a silent no-op.
      assertErrorCode(loser, "TEACHER_ALREADY_CERTIFIED");
      expect(loser.message).toContain(tErrors.teacherAlreadyCertified);

      // Exactly ONE teacher row (the pre-existing one, elevated), ONE
      // audit row recording the elevation, ONE notification, ONE publish.
      expect(await countTeacherRows([target.id])).toBe(1);
      const row = await readTeacherRow(target.id);
      expect(row?.isApproved).toBe(true);
      expect(row?.isEvaluator).toBe(true);
      expect(await countCertAuditRows([target.id])).toBe(1);
      expect(await countNotificationRows([target.id])).toBe(1);
      const auditRows = await readCertAuditRows(target.id);
      expect(auditRows[0]?.details).toBe(
        JSON.stringify({ makeEvaluator: true, applicantRow: "absent", elevation: "elevated" })
      );
      expect(transport.publishCount).toBe(1);
      expect(transport.publishedUserIds).toEqual([target.id]);
    }
  );

  // ─── (d) 25-way parallel storm over DISTINCT targets ────────────────
  concurrencyTest(
    "25-way parallel certify storm over distinct targets → all fulfilled with per-target correctness",
    async () => {
      silenceDomainLog();
      // Provision the targets in parallel — each gets its own committed
      // transaction, so the storm itself starts from a steady state.
      const provisioned = await Promise.all(Array.from({ length: STORM_SIZE }, () => provisionTeacherTarget({})));
      const targetIds = provisioned.map(p => p.target.id);
      const transport = new SpiedFanoutTransport();

      const results = await Promise.allSettled(
        targetIds.map((id, index) => callCommitted(id, index % 2 === 0, transport))
      );
      const { fulfilled, rejected } = partitionOutcomes(results);
      expect(rejected).toHaveLength(0);
      expect(fulfilled).toHaveLength(STORM_SIZE);

      // Per-target correctness — `Promise.allSettled` preserves input order,
      // slot i answers target i with the flags its call requested.
      for (const [index, detail] of fulfilled.entries()) {
        expect(detail.id).toBe(targetIds[index]);
        expect(detail.teacher?.isApproved).toBe(true);
        expect(detail.teacher?.isEvaluator).toBe(index % 2 === 0);
      }

      // Totals oracles: every target got exactly one row in each of the
      // three write tables, and exactly one publish addressed to it alone.
      expect(await countTeacherRows(targetIds)).toBe(STORM_SIZE);
      expect(await countCertAuditRows(targetIds)).toBe(STORM_SIZE);
      expect(await countNotificationRows(targetIds)).toBe(STORM_SIZE);
      expect(transport.publishCount).toBe(STORM_SIZE);
      expect(new Set(transport.publishedUserIds)).toEqual(new Set(targetIds));
    }
  );
});

describe("ColdStartCertificationService — forced mid-transaction failure", () => {
  // Single-threaded proof (no cross-transaction concurrency involved), so
  // this probe is NOT provider-gated: it also exercises the PGlite harness.
  test("spy-injected finalize failure rolls back EVERYTHING — zero residue across all four tables, zero publishes", async () => {
    silenceDomainLog();
    const { target, applicant } = await provisionTeacherTarget({ withApplicant: true });
    if (!applicant) throw new Error("expected the applicant fixture to exist");
    const transport = new SpiedFanoutTransport();

    // Inject the failure at the applicants-finalize stage — AFTER the
    // teacher-row insert has already executed inside the service's
    // transaction, so the rollback oracle proves the earlier stage's work
    // was rolled back too.
    const finalizeSpy = spyOn(ApplicantRepository, "finalizeOnCertification").mockImplementation(() =>
      Promise.reject(new Error("forced finalize failure"))
    );
    const error = await expectRepoError(() => callCommitted(target.id, true, transport));
    finalizeSpy.mockRestore();
    expect(error.message).toContain("forced finalize failure");

    // Zero residue across all four tables:
    //  - teacher: the inserted certified row rolled back.
    expect(await countTeacherRows([target.id])).toBe(0);
    //  - applicants: the pre-existing row is untouched (byte-stable).
    const [applicantRow] = await db.select().from(applicants).where(eq(applicants.id, target.id));
    expect(applicantRow?.status).toBe(applicant.status);
    expect(applicantRow?.cooldownUntil?.getTime() ?? null).toBe(applicant.cooldownUntil?.getTime() ?? null);
    //  - audit_logs: nothing recorded for the aborted certification.
    expect(await countCertAuditRows([target.id])).toBe(0);
    //  - notifications: the emit stage was never reached.
    expect(await countNotificationRows([target.id])).toBe(0);
    //  - publish: structurally unreachable pre-commit.
    expect(transport.publishCount).toBe(0);
  });
});

describe("ColdStartCertificationService — hostile userId fuzz (pre-DB fail-closed)", () => {
  const FUZZ_VALUES: ReadonlyArray<[name: string, value: number]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["beyond MAX_SAFE_INTEGER", 2 ** 53],
  ];

  for (const [name, value] of FUZZ_VALUES) {
    test(`userId fuzz (${name}) → VALIDATION, rejected before any repository probe of the id`, async () => {
      await runInRollback(async tx => {
        const admin = await createTestUser(tx, { role: "admin" });
        silenceDomainLog();
        const transport = new SpiedFanoutTransport();
        const findSpy = spyOn(UserRepository, "findById");

        const error = await expectRepoError(() =>
          ColdStartCertificationService.certifyTeacherColdStart(
            admin.id,
            { userId: value, makeEvaluator: true },
            LOCALE_EN,
            { transport },
            tx
          )
        );
        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "VALIDATION");
        expect(error.message).toContain(tErrors.validation);

        // Pre-DB proof: the ONLY `findById` calls permitted are the gate's
        // actor reads; the fuzzed id is never probed against the database.
        for (const call of findSpy.mock.calls) {
          expect(call[0]).toBe(admin.id);
        }
        findSpy.mockRestore();

        // Zero side effects: no audit row, no notification, no publish.
        const [auditCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLogs)
          .where(eq(auditLogs.actorId, admin.id));
        expect(auditCount?.count ?? 0).toBe(0);
        expect(transport.publishCount).toBe(0);
      });
    });
  }
});
