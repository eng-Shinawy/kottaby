/**
 * Journey harness smoke test — proves the cast fixtures and the tracked-ID
 * teardown run GREEN through EXISTING services only.
 *
 * The harness itself must be verifiable NOW, independently of the
 * `StudentHandshakeService` surface the handshake-discovery journey awaits
 * (test-first): every path exercised here — real registration of student and
 * parent actors, governance flips, the parent-link emulation write, the
 * side-effect probes, and the tracked hard-delete teardown — runs through the
 * real `RegistrationService` / `StudentRepository` and direct committed
 * fixture writes against the real test database.
 *
 * Layer rules (`test/workflows/AGENTS.md`): committed fixtures (rule 2),
 * per-run UUID prefix (rule 3), honest real roles (rule 4), `bun:test`
 * (rule 7), `@/` aliases (rule 8), own entities only — never seed rows (rule 9).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { StudentRepository } from "@/backend/db/repo";
import { parents } from "@/backend/db/schema/parents/parents";
import { users } from "@/backend/db/schema/users/users";
import { HANDSHAKE_CODE_PATTERN } from "@/shared/constants/handshake-code.constants";
import {
  createJourneyCast,
  type JourneyCastType,
  linkStudentToParentFixture,
  type ParentActorType,
  type StudentActorType,
  setGovernanceFixture,
} from "@/test/workflows/helpers";

const cast: JourneyCastType = createJourneyCast("harness");

let student: StudentActorType | null = null;
let parent: ParentActorType | null = null;

function requireStudent(): StudentActorType {
  if (student === null) {
    throw new Error("smoke state missing: student actor was not provisioned");
  }
  return student;
}

function requireParent(): ParentActorType {
  if (parent === null) {
    throw new Error("smoke state missing: parent actor was not provisioned");
  }
  return parent;
}

/** An hour-old suspension start: a strictly ACTIVE suspension window at probe time. */
const SUSPENSION_STARTED_AT = new Date(Date.now() - 60 * 60 * 1000);
const SUSPENSION_PERIOD_DAYS = 7;

describe("Journey harness smoke — cast fixtures + tracked teardown (existing services only)", () => {
  beforeAll(async () => {
    student = await cast.registerStudentActor("Harun Smoke");
    parent = await cast.registerParentActor("Layla Smoke");
  });

  test("cast prefix follows the per-run UUID discipline", () => {
    expect(cast.prefix).toMatch(/^jrn_harness_[0-9a-f]{8}$/);
  });

  test("registerStudentActor provisions a real student holding a canonical handshake code", async () => {
    const actor = requireStudent();
    expect(actor.userId).toBeGreaterThan(0);
    expect(actor.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
    expect(actor.email).toContain(cast.prefix);

    // Honest-authorization substrate: the committed users row carries the
    // real `student` role (no monkey-patched role resolution anywhere).
    const roleRows = await db.select({ role: users.role }).from(users).where(eq(users.id, actor.userId));
    expect(roleRows[0]?.role).toBe("student");

    // The code is committed and readable through the real repository read path.
    expect(await StudentRepository.findHandshakeCodeByStudentId(actor.userId)).toBe(actor.handshakeCode);
  });

  test("registerParentActor provisions a real parent (users + parents rows)", async () => {
    const actor = requireParent();
    expect(actor.userId).toBeGreaterThan(0);

    const roleRows = await db.select({ role: users.role }).from(users).where(eq(users.id, actor.userId));
    expect(roleRows[0]?.role).toBe("parent");

    const parentRows = await db.select({ id: parents.id }).from(parents).where(eq(parents.id, actor.userId));
    expect(parentRows).toHaveLength(1);
  });

  test("governance fixture flips committed governance state", async () => {
    const actor = requireStudent();

    const deleted = await setGovernanceFixture(actor.userId, { isDeleted: true });
    expect(deleted.isDeleted).toBe(true);

    const suspended = await setGovernanceFixture(actor.userId, {
      isDeleted: false,
      suspended: true,
      suspendedAt: SUSPENSION_STARTED_AT,
      suspendedPeriodDays: SUSPENSION_PERIOD_DAYS,
    });
    expect(suspended.isDeleted).toBe(false);
    expect(suspended.suspended).toBe(true);
    expect(suspended.suspendedPeriodDays).toBe(SUSPENSION_PERIOD_DAYS);

    // Re-read the committed row: the fixture writes survive their transactions.
    const governanceRows = await db
      .select({
        isDeleted: users.isDeleted,
        suspended: users.suspended,
        suspendedPeriodDays: users.suspendedPeriodDays,
      })
      .from(users)
      .where(eq(users.id, actor.userId));
    expect(governanceRows[0]?.isDeleted).toBe(false);
    expect(governanceRows[0]?.suspended).toBe(true);
    expect(governanceRows[0]?.suspendedPeriodDays).toBe(SUSPENSION_PERIOD_DAYS);
  });

  test("link fixture commits students.parent_id (link-flow emulation)", async () => {
    const linkedParentId = await linkStudentToParentFixture(requireStudent().userId, requireParent().userId);
    expect(linkedParentId).toBe(requireParent().userId);
  });

  test("registry tracks every provisioned actor and side-effect probes stay at zero", async () => {
    expect(cast.trackedUserIds()).toHaveLength(2);
    const sideEffects = await cast.countSideEffectRows();
    expect(sideEffects.notifications).toBe(0);
    expect(sideEffects.auditLogs).toBe(0);
  });

  afterAll(async () => {
    // Tracked hard-delete teardown + residue probes: every tracked id must be
    // gone from every table the harness touches.
    await cast.teardown();
    const residue = await cast.residueCounts();
    expect(residue.users).toBe(0);
    expect(residue.students).toBe(0);
    expect(residue.parents).toBe(0);
    expect(residue.notifications).toBe(0);
    expect(residue.auditLogs).toBe(0);
  });
});
