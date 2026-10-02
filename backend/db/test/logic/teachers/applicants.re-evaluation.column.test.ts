/**
 * `applicants.re_evaluation_started_at` schema-invariant suite — the nullable
 * re-evaluation cycle-anchor column on the failed-teacher-applicants table.
 *
 * WHAT THIS LOCKS
 *  - Drizzle schema invariants: the column is named `re_evaluation_started_at`,
 *    is NULLABLE, and declares NO default — `NULL` is the honest "this
 *    applicant has never been ordered a paid re-evaluation" state, so a
 *    default would lie about a cycle that never happened.
 *  - Round-trip behavior against the live PostgreSQL test instance: an insert
 *    that omits the column persists NULL (proving both nullability and the
 *    absence of a non-NULL default); an insert with an explicit instant
 *    persists and reads back that exact instant; and a NULL row can be
 *    stamped forward to an instant (the guarded re-open write pattern).
 *
 * Per `backend/db/test/AGENTS.md`: every DB test runs inside `runInRollback`
 * with the `tx` passed to every helper and direct Drizzle call; fixtures come
 * only from `entity-setup.ts` helpers (no seed data); no
 * `expect(...).rejects.toThrow()` inside the rollback wrapper.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/db/test/logic/teachers/applicants.re-evaluation.column.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import type { DBTransaction } from "@/backend/types";

/** The Drizzle column object under test, pulled off the canonical table definition. */
const reEvaluationStartedAtColumn = applicants.reEvaluationStartedAt;

/** Independent read-back oracle — direct Drizzle select, not via any repo. */
async function readApplicantRow(tx: DBTransaction, userId: number) {
  const rows = await tx.select().from(applicants).where(eq(applicants.id, userId));
  return rows[0] ?? null;
}

describe("applicants.re_evaluation_started_at — schema invariants", () => {
  // ---- Tier 1: Drizzle schema-object invariants ----
  describe("Tier 1 — column declaration", () => {
    test("column exists on the applicants table with the snake_case DB name", () => {
      expect(reEvaluationStartedAtColumn).toBeDefined();
      expect(reEvaluationStartedAtColumn.name).toBe("re_evaluation_started_at");
    });

    test("column is nullable (NOT NULL is never declared)", () => {
      expect(reEvaluationStartedAtColumn.notNull).toBe(false);
    });

    test("column declares NO default (NULL is the never-ordered state, not a synthesized instant)", () => {
      expect(reEvaluationStartedAtColumn.hasDefault).toBe(false);
    });
  });

  // ---- Tier 2: live-DB round-trip ----
  describe("Tier 2 — round-trip against the live database", () => {
    test("an insert that omits the column persists NULL (nullable + no non-NULL default)", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx, { role: "teacher" });
        await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

        const row = await readApplicantRow(tx, user.id);
        expect(row).not.toBeNull();
        expect(row?.reEvaluationStartedAt).toBeNull();
      });
    });

    test("an insert with an explicit instant round-trips the exact timestamp", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx, { role: "teacher" });
        const stamp = new Date("2026-01-15T10:30:00.123Z");
        await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed, reEvaluationStartedAt: stamp });

        const row = await readApplicantRow(tx, user.id);
        expect(row?.reEvaluationStartedAt).toBeInstanceOf(Date);
        expect(row?.reEvaluationStartedAt?.getTime()).toBe(stamp.getTime());
      });
    });

    test("a NULL row can be stamped forward to an instant (cycle-anchor write pattern)", async () => {
      await runInRollback(async tx => {
        const user = await createTestUser(tx, { role: "teacher" });
        await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });
        expect((await readApplicantRow(tx, user.id))?.reEvaluationStartedAt).toBeNull();

        const stamp = new Date("2026-02-01T08:00:00.000Z");
        await tx.update(applicants).set({ reEvaluationStartedAt: stamp }).where(eq(applicants.id, user.id));

        const row = await readApplicantRow(tx, user.id);
        expect(row?.status).toBe(ApplicantStatus.Passed);
        expect(row?.reEvaluationStartedAt?.getTime()).toBe(stamp.getTime());
      });
    });
  });
});
