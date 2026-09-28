/**
 * ApplicantRepository tests — the guarded cooldown-extension write
 * (`extendCooldownOnce`) against the live PostgreSQL test instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data. The repo signals a miss by returning `null`, so this suite has
 *    no throwing paths to probe (no `expect(...).rejects.toThrow()`).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): a failed applicant's cooldown is lengthened to
 *    the caller's instant and the FULL updated row is returned; a certified
 *    (`passed`) applicant and a nonexistent id match zero rows (null).
 *  - Tier 2 (boundary): `pending` / `in_evaluation` applicants are admitted
 *    (pre-arming before evaluation is legal); an already-expired cooldown
 *    is overwritten verbatim (the base instant is the caller's concern —
 *    no duration arithmetic in the repo); `updated_at` stamps forward; the
 *    attempt audit trail, the lifecycle status, and the user account's
 *    governance flags all survive the write untouched.
 *  - Tier 4 (hostile/static): non-positive ids (0, negative) return null;
 *    the extension is a single REQUIRED-tx guarded UPDATE (eligible
 *    pre-states folded into WHERE as enum members), writes ONLY the
 *    cooldown instant + `updated_at`, is fully parameterized, and adds no
 *    prepared statements, logging surface, or cross-table columns.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { ApplicantRepository } from "@/backend/db/repo";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import type { DBTransaction } from "@/backend/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns an integer id that cannot exist as an applicants row this tx. */
async function absentApplicantId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${applicants.id}), 0)::int` }).from(applicants);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Independent read-back oracle — direct Drizzle select, not via the repo. */
async function readApplicantRow(tx: DBTransaction, userId: number) {
  const rows = await tx.select().from(applicants).where(eq(applicants.id, userId));
  return rows[0] ?? null;
}

describe("ApplicantRepository.extendCooldownOnce", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("lengthens a failed applicant's cooldown to the caller's instant and returns the FULL updated row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const originalCooldown = new Date(Date.now() + 30 * DAY_MS);
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Failed, cooldownUntil: originalCooldown });
      const newExpiry = new Date(Date.now() + 90 * DAY_MS);

      const row = await ApplicantRepository.extendCooldownOnce(user.id, newExpiry, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated applicant row");
      // RETURNING * — exactly the canonical seven select columns.
      expect(Object.keys(row).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "cooldownUntil",
        "createdAt",
        "id",
        "lastAttemptAt",
        "status",
        "updatedAt",
        "verificationAttempts",
      ]);
      expect(row.id).toBe(user.id);
      expect(row.status).toBe(ApplicantStatus.Failed);
      // The expiry is the caller's value, stored verbatim — the repo
      // performs no duration arithmetic, and the window only lengthens.
      expect(row.cooldownUntil?.getTime()).toBe(newExpiry.getTime());
      expect(row.cooldownUntil?.getTime()).toBeGreaterThan(originalCooldown.getTime());
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.cooldownUntil?.getTime()).toBe(newExpiry.getTime());
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
    });
  });

  test("matches ZERO rows for a passed applicant (a certified applicant has no cooldown to extend)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

      const row = await ApplicantRepository.extendCooldownOnce(user.id, new Date(Date.now() + 30 * DAY_MS), tx);

      expect(row).toBeNull();
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();
    });
  });

  test("returns null for a nonexistent applicant id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentApplicantId(tx);

      const row = await ApplicantRepository.extendCooldownOnce(missingId, new Date(), tx);

      expect(row).toBeNull();
    });
  });

  // ─── Tier 2: boundary / data-shape edges ────────────────────────────

  test("admits a pending applicant (pre-arming before the first evaluation is legal)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });
      const newExpiry = new Date(Date.now() + 45 * DAY_MS);

      const row = await ApplicantRepository.extendCooldownOnce(user.id, newExpiry, tx);

      expect(row?.id).toBe(user.id);
      expect(row?.status).toBe(ApplicantStatus.Pending);
      expect(row?.cooldownUntil?.getTime()).toBe(newExpiry.getTime());
      expect((await readApplicantRow(tx, user.id))?.cooldownUntil?.getTime()).toBe(newExpiry.getTime());
    });
  });

  test("admits an in_evaluation applicant", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });
      const newExpiry = new Date(Date.now() + 45 * DAY_MS);

      const row = await ApplicantRepository.extendCooldownOnce(user.id, newExpiry, tx);

      expect(row?.id).toBe(user.id);
      expect(row?.status).toBe(ApplicantStatus.InEvaluation);
      expect(row?.cooldownUntil?.getTime()).toBe(newExpiry.getTime());
      expect((await readApplicantRow(tx, user.id))?.cooldownUntil?.getTime()).toBe(newExpiry.getTime());
    });
  });

  test("overwrites an already-expired cooldown with the caller's instant verbatim", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const expiredCooldown = new Date(Date.now() - DAY_MS);
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Failed, cooldownUntil: expiredCooldown });
      const newExpiry = new Date(Date.now() + 60 * DAY_MS);

      const row = await ApplicantRepository.extendCooldownOnce(user.id, newExpiry, tx);

      expect(row?.cooldownUntil?.getTime()).toBe(newExpiry.getTime());
      expect(row?.cooldownUntil?.getTime()).not.toBe(expiredCooldown.getTime());
    });
  });

  test("stamps updated_at forward (strictly later than the seeded instant)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const seededUpdatedAt = new Date(Date.now() - 60_000);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Failed,
        updatedAt: seededUpdatedAt,
      });

      const row = await ApplicantRepository.extendCooldownOnce(user.id, new Date(Date.now() + DAY_MS), tx);

      expect(row).not.toBeNull();
      expect(row?.updatedAt?.getTime()).toBeGreaterThan(seededUpdatedAt.getTime());
    });
  });

  test("preserves the attempt audit trail and the lifecycle status (cooldown-only write)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const lastAttemptAt = new Date(Date.now() - 4 * DAY_MS);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Failed,
        verificationAttempts: 3,
        lastAttemptAt,
      });

      const row = await ApplicantRepository.extendCooldownOnce(user.id, new Date(Date.now() + 30 * DAY_MS), tx);

      expect(row?.status).toBe(ApplicantStatus.Failed);
      expect(row?.verificationAttempts).toBe(3);
      expect(row?.lastAttemptAt?.getTime()).toBe(lastAttemptAt.getTime());
    });
  });

  test("leaves the user account's governance flags untouched (the cooldown lives only on the applicant row)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Failed });

      await ApplicantRepository.extendCooldownOnce(user.id, new Date(Date.now() + 30 * DAY_MS), tx);

      const [account] = await tx
        .select({
          suspended: users.suspended,
          suspendedAt: users.suspendedAt,
          suspendedPeriodDays: users.suspendedPeriodDays,
        })
        .from(users)
        .where(eq(users.id, user.id));
      expect(account?.suspended).toBe(false);
      expect(account?.suspendedAt).toBeNull();
      expect(account?.suspendedPeriodDays).toBeNull();
    });
  });

  // ─── Tier 4: hostile ids ────────────────────────────────────────────

  test("returns null for non-positive applicant ids (0, negative) and for an id beyond the table", async () => {
    await runInRollback(async tx => {
      const missingId = await absentApplicantId(tx);

      expect(await ApplicantRepository.extendCooldownOnce(0, new Date(), tx)).toBeNull();
      expect(await ApplicantRepository.extendCooldownOnce(-1, new Date(), tx)).toBeNull();
      expect(await ApplicantRepository.extendCooldownOnce(missingId, new Date(), tx)).toBeNull();
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const REPO_FILE = join(import.meta.dir, "../../../repo/teachers/applicant.repository.ts");
  const repoSource = readFileSync(REPO_FILE, "utf8");

  /** The extendCooldownOnce slice of the repository source (the static pin target). */
  function extendSource(): string {
    const start = repoSource.indexOf("export async function extendCooldownOnce(");
    return repoSource.slice(start, repoSource.indexOf("\n  }\n", start));
  }

  /** The extendCooldownOnce slice, whitespace-normalized for shape pins. */
  function extendShape(): string {
    return extendSource().replace(/\s+/g, " ").trim();
  }

  test("source: a single guarded UPDATE with the non-terminal pre-states folded into WHERE", () => {
    expect(extendShape()).toContain(".update(applicants)");
    expect(extendShape()).toContain(
      "inArray(applicants.status, [ApplicantStatus.Pending, ApplicantStatus.InEvaluation, ApplicantStatus.Failed])"
    );
    expect(extendSource().includes(".select(")).toBe(false);
    expect(extendShape()).toContain(".returning()");
    // Exactly the three eligible members are admitted — nothing else.
    expect(extendSource().match(/ApplicantStatus\./g)).toHaveLength(3);
  });

  test("source: REQUIRED tx — no standalone global-handle branch, no prepared statements", () => {
    expect(extendSource()).toContain("tx: DBTransaction");
    expect(extendSource().includes("tx?")).toBe(false);
    expect(extendSource().includes("tx ?? db")).toBe(false);
    expect(extendSource().includes("db.update")).toBe(false);
    expect(repoSource.includes(".prepare(")).toBe(false);
  });

  test("source: writes ONLY the cooldown instant + updated_at (no status write, no cross-table columns)", () => {
    expect(extendShape()).toContain("cooldownUntil: newExpiry");
    expect(extendShape()).toContain("updatedAt: sql`now()`");
    expect(extendShape().includes("status: ApplicantStatus")).toBe(false);
    expect(extendSource().includes("users")).toBe(false);
  });

  test("source: the two-source split — the write never touches the account-governance columns", () => {
    expect(extendSource().includes("suspended")).toBe(false);
    expect(extendSource().includes("users")).toBe(false);
  });

  test("source: parameterized only — enum members, no status string literals, no interpolation, no inline SQL comments", () => {
    expect(/'(pending|failed|in_evaluation|passed)'/.test(extendSource())).toBe(false);
    expect(extendSource().includes("${")).toBe(false);
    expect(extendSource().includes("--")).toBe(false);
  });

  test("source: no i18n, no logger, no console (repo stays data-access only)", () => {
    expect(extendSource().includes("getServerTranslations")).toBe(false);
    expect(extendSource().includes("logger")).toBe(false);
    expect(extendSource().includes("console.")).toBe(false);
  });

  test("source: comments describe domain behavior only (no plan-artifact references)", () => {
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});
