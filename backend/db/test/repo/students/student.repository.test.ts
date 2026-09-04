/**
 * StudentRepository tests — `findHandshakeCodeByStudentId`,
 * `findDiscoveryByHandshakeCode` (handshake-code self-read + parent
 * discovery lookup) PLUS the parent-link additive pair
 * `findLinkTargetByHandshakeCode` / `linkParentIfUnlinked` (tasks.md 2.2).
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - In-tx tests run inside `runInRollback` with `tx` passed to every repo
 *    call in the correct param position (last, optional).
 *  - Fixtures are created via `entity-setup.ts` helpers — never seed data.
 *  - Uses `bun:test`; no `console.*`; no `expect(...).rejects.toThrow()`
 *    inside `runInRollback`.
 *  - The committed Tier-2 fixture is inserted in `beforeAll` and hard-deleted
 *    in `afterAll` (rule 9) with a post-teardown invisibility probe.
 *
 * Tier map (4-Tier DB test convention):
 *  - Tier 1 (Contract): both methods return the expected rows/values for
 *    entity-setup fixtures; the discovery/link-target JOINs return EXACTLY
 *    the picked columns (Object.keys assertion — no extra columns);
 *    `linkParentIfUnlinked` wins once (guarded UPDATE … RETURNING) and a
 *    second call collapses to `null`.
 *  - Tier 2 (Executors): tx-provided and default-executor (no-tx) paths both
 *    work; the committed fixture proves the default (queryDb) branch.
 *  - Tier 3 (Hostile/miss): nonexistent ids/codes return `null`; unicode and
 *    garbage codes pass through the parameterized path harmlessly — the repo
 *    owns no validation (that is the service layer's contract);
 *    `linkParentIfUnlinked` on a nonexistent student also collapses to `null`.
 *  - Tier 4 (Rollback): fixtures written inside `runInRollback` are invisible
 *    after the forced rollback, on both read methods; a link written inside
 *    the tx unlinks again after the forced rollback.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { StudentRepository } from "@/backend/db/repo";
import { users } from "@/backend/db/schema/users/users";
import { createTestParent, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { HandshakeDiscoveryRowType, StudentLinkTargetRowType } from "@/backend/types";

/** The exact key set a discovery row may carry — nothing more, nothing less. */
const DISCOVERY_ROW_KEYS: readonly (keyof HandshakeDiscoveryRowType)[] = [
  "parentId",
  "fullName",
  "isDeleted",
  "isBlocked",
  "suspended",
  "suspendedAt",
  "suspendedPeriodDays",
];

/** Ascending key comparator — deterministic across locales (sonarjs-compliant). */
function byKeyAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Sorted copy for set-equality assertions (key ORDER is not part of the contract). */
const SORTED_DISCOVERY_ROW_KEYS: string[] = [...DISCOVERY_ROW_KEYS].toSorted(byKeyAscending);

/** Id far beyond the identity sequence's reach — guaranteed nonexistent. */
const NONEXISTENT_STUDENT_ID = 2_000_000_000;

/** A handshake code that no fixture ever carries (fixtures are random hex). */
const NONEXISTENT_HANDSHAKE_CODE = "KSB-FFFFFFFF";

interface CommittedFixture {
  readonly userId: number;
  readonly fullName: string;
  readonly handshakeCode: string;
}

/**
 * Committed ONCE in `beforeAll` for the default-executor (no-tx) tier — a
 * plain committed read target, since `queryDb` reads cannot see uncommitted
 * `runInRollback` fixtures. Hard-deleted (with proof) in `afterAll`.
 */
let committed: CommittedFixture | null = null;

/** Narrows the committed fixture, failing loudly if `beforeAll` never ran. */
function requireCommittedFixture(): CommittedFixture {
  if (!committed) {
    throw new Error("Committed fixture not initialized — beforeAll failed");
  }
  return committed;
}

/** Asserts set-equality of a discovery row's own keys against the picked set. */
function expectExactDiscoveryKeys(row: HandshakeDiscoveryRowType): void {
  expect(Object.keys(row).toSorted(byKeyAscending)).toEqual(SORTED_DISCOVERY_ROW_KEYS);
}

/** The exact key set a link-target row may carry — nothing more, nothing less. */
const LINK_TARGET_ROW_KEYS: readonly (keyof StudentLinkTargetRowType)[] = [
  "studentId",
  "parentId",
  "fullName",
  "isDeleted",
  "isBlocked",
  "suspended",
  "suspendedAt",
  "suspendedPeriodDays",
];

/** Sorted copy for set-equality assertions (key ORDER is not part of the contract). */
const SORTED_LINK_TARGET_ROW_KEYS: string[] = [...LINK_TARGET_ROW_KEYS].toSorted(byKeyAscending);

/** Asserts set-equality of a link-target row's own keys against the picked set. */
function expectExactLinkTargetKeys(row: StudentLinkTargetRowType): void {
  expect(Object.keys(row).toSorted(byKeyAscending)).toEqual(SORTED_LINK_TARGET_ROW_KEYS);
}

beforeAll(async () => {
  committed = await db.transaction(async tx => {
    const user = await createTestUser(tx, { fullName: "Committed Discovery Fixture" });
    const student = await createTestStudent(tx, user.id);
    return { userId: user.id, fullName: user.fullName, handshakeCode: student.handshakeCode };
  });
});

afterAll(async () => {
  const fixture = committed;
  committed = null;
  if (!fixture) {
    return;
  }
  // Hard delete — the users-row delete cascades to the students row
  // (shared-PK FK ON DELETE CASCADE).
  await db.delete(users).where(eq(users.id, fixture.userId));
  // Teardown proof: both read methods see nothing after the hard delete.
  expect(await StudentRepository.findDiscoveryByHandshakeCode(fixture.handshakeCode)).toBeNull();
  expect(await StudentRepository.findHandshakeCodeByStudentId(fixture.userId)).toBeNull();
});

describe("StudentRepository.createForRegistration (pre-existing write)", () => {
  test("Tier 1 — inserts the registration row with the supplied code and zeroed balances", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const registrationCode = `KSB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const row = await StudentRepository.createForRegistration(user.id, registrationCode, tx);
      // Write contract: shared PK, verbatim code, zeroed balances, unlinked.
      expect(row.id).toBe(user.id);
      expect(row.handshakeCode).toBe(registrationCode);
      expect(row.balanceHifz).toBe(0);
      expect(row.balanceTajweed).toBe(0);
      expect(row.balanceReviews).toBe(0);
      expect(row.parentId).toBeNull();
    });
  });
});

describe("StudentRepository.findHandshakeCodeByStudentId", () => {
  test("Tier 1 — returns the fixture row's handshake code inside the tx", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const code = await StudentRepository.findHandshakeCodeByStudentId(user.id, tx);
      expect(code).toBe(student.handshakeCode);
    });
  });

  test("Tier 2 — default-executor (no tx) path resolves the committed fixture's code", async () => {
    const fixture = requireCommittedFixture();
    const code = await StudentRepository.findHandshakeCodeByStudentId(fixture.userId);
    expect(code).toBe(fixture.handshakeCode);
  });

  test("Tier 3 — nonexistent id returns null on both executor paths", async () => {
    await runInRollback(async tx => {
      expect(await StudentRepository.findHandshakeCodeByStudentId(NONEXISTENT_STUDENT_ID, tx)).toBeNull();
    });
    expect(await StudentRepository.findHandshakeCodeByStudentId(NONEXISTENT_STUDENT_ID)).toBeNull();
  });
});

describe("StudentRepository.findDiscoveryByHandshakeCode", () => {
  test("Tier 1 — unlinked fixture: EXACTLY the picked columns with governance defaults", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const row = await StudentRepository.findDiscoveryByHandshakeCode(student.handshakeCode, tx);
      expect(row).not.toBeNull();
      if (!row) {
        return;
      }
      expectExactDiscoveryKeys(row);
      expect(row).toEqual({
        parentId: null,
        fullName: user.fullName,
        isDeleted: false,
        isBlocked: false,
        suspended: false,
        suspendedAt: null,
        suspendedPeriodDays: null,
      });
    });
  });

  test("Tier 1 — linked + governed fixture: parentId and governance columns map faithfully", async () => {
    await runInRollback(async tx => {
      const parent = await createTestUser(tx, { role: "parent" });
      const suspendedAt = new Date();
      const user = await createTestUser(tx, {
        isBlocked: true,
        suspended: true,
        suspendedAt,
        suspendedPeriodDays: 7,
      });
      const student = await createTestStudent(tx, user.id, { parentId: parent.id });
      const row = await StudentRepository.findDiscoveryByHandshakeCode(student.handshakeCode, tx);
      // Governed rows are returned FAITHFULLY — the repo never filters; the
      // service layer owns governance exclusion.
      expect(row?.parentId).toBe(parent.id);
      expect(row?.fullName).toBe(user.fullName);
      expect(row?.isDeleted).toBe(false);
      expect(row?.isBlocked).toBe(true);
      expect(row?.suspended).toBe(true);
      expect(row?.suspendedAt).toEqual(suspendedAt);
      expect(row?.suspendedPeriodDays).toBe(7);
    });
  });

  test("Tier 2 — default-executor (no tx) path returns the committed fixture row with EXACTLY the picked columns", async () => {
    const fixture = requireCommittedFixture();
    const row = await StudentRepository.findDiscoveryByHandshakeCode(fixture.handshakeCode);
    expect(row).not.toBeNull();
    if (!row) {
      return;
    }
    expectExactDiscoveryKeys(row);
    expect(row.fullName).toBe(fixture.fullName);
    expect(row.parentId).toBeNull();
  });

  test("Tier 3 — nonexistent code returns null on both executor paths", async () => {
    await runInRollback(async tx => {
      expect(await StudentRepository.findDiscoveryByHandshakeCode(NONEXISTENT_HANDSHAKE_CODE, tx)).toBeNull();
    });
    expect(await StudentRepository.findDiscoveryByHandshakeCode(NONEXISTENT_HANDSHAKE_CODE)).toBeNull();
  });

  test("Tier 3 — unicode/garbage codes pass through the parameterized path harmlessly", async () => {
    // The repo owns NO validation (normalize-then-validate is the service's
    // pre-DB contract) — every string is just a bound `$1` that matches
    // nothing. Nothing here may throw.
    const hostileCodes = [
      "",
      "   ",
      "%",
      "_",
      "\\",
      "KSB-00000000'; DROP TABLE students; --",
      'KSB-00000000" OR 1=1 --',
      "ك-عبد-الله",
      "KSB-😀😀😀😀",
      "\u202Eksb-12345678",
      `KSB-${"A".repeat(100)}`,
      "KSB-AB CD12 34",
    ];
    // Independent probes — fire them concurrently and assert every miss.
    const rows = await Promise.all(hostileCodes.map(code => StudentRepository.findDiscoveryByHandshakeCode(code)));
    expect(rows).toHaveLength(hostileCodes.length);
    for (const row of rows) {
      expect(row).toBeNull();
    }
  });
});

describe("StudentRepository.findLinkTargetByHandshakeCode (parent-link additive read)", () => {
  test("Tier 1 — hit on an unlinked fixture: EXACTLY the picked columns incl. the raw studentId", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);
      const row = await StudentRepository.findLinkTargetByHandshakeCode(student.handshakeCode, tx);
      expect(row).not.toBeNull();
      if (!row) {
        return;
      }
      expectExactLinkTargetKeys(row);
      expect(row.studentId).toBe(student.id);
      expect(row.parentId).toBeNull();
      expect(row.fullName).toBe(user.fullName);
      expect(row.isDeleted).toBe(false);
      expect(row.isBlocked).toBe(false);
      expect(row.suspended).toBe(false);
    });
  });

  test("Tier 1 — miss: nonexistent code returns null on both executor paths", async () => {
    await runInRollback(async tx => {
      expect(await StudentRepository.findLinkTargetByHandshakeCode(NONEXISTENT_HANDSHAKE_CODE, tx)).toBeNull();
    });
    expect(await StudentRepository.findLinkTargetByHandshakeCode(NONEXISTENT_HANDSHAKE_CODE)).toBeNull();
  });

  test("Tier 2 — default-executor (no tx) path resolves the committed fixture row", async () => {
    const fixture = requireCommittedFixture();
    const row = await StudentRepository.findLinkTargetByHandshakeCode(fixture.handshakeCode);
    expect(row).not.toBeNull();
    if (!row) {
      return;
    }
    expectExactLinkTargetKeys(row);
    expect(row.studentId).toBe(fixture.userId);
    expect(row.parentId).toBeNull();
    expect(row.fullName).toBe(fixture.fullName);
  });
});

describe("StudentRepository.linkParentIfUnlinked (parent-link additive write)", () => {
  test("Tier 1 — winner claims the unlinked student; second call (and a rival parent) collapse to null", async () => {
    await runInRollback(async tx => {
      const parentUser = await createTestUser(tx, { role: "parent" });
      await createTestParent(tx, parentUser.id);
      const rivalUser = await createTestUser(tx, { role: "parent" });
      await createTestParent(tx, rivalUser.id);
      const studentUser = await createTestUser(tx);
      const student = await createTestStudent(tx, studentUser.id);

      const winner = await StudentRepository.linkParentIfUnlinked(student.id, parentUser.id, tx);
      expect(winner).not.toBeNull();
      expect(winner?.id).toBe(student.id);
      expect(winner?.parentId).toBe(parentUser.id);
      expect(winner?.updatedAt).toBeInstanceOf(Date);

      // Second call — the `parent_id IS NULL` guard matches zero rows.
      const secondCall = await StudentRepository.linkParentIfUnlinked(student.id, parentUser.id, tx);
      expect(secondCall).toBeNull();
      // A different parent cannot steal the link through the same method.
      expect(await StudentRepository.linkParentIfUnlinked(student.id, rivalUser.id, tx)).toBeNull();
      // The winning link is still the one persisted.
      expect((await StudentRepository.findById(student.id, tx))?.parentId).toBe(parentUser.id);
    });
  });

  test("Tier 3 — nonexistent student collapses to null (zero-row guard)", async () => {
    await runInRollback(async tx => {
      const parentUser = await createTestUser(tx, { role: "parent" });
      expect(await StudentRepository.linkParentIfUnlinked(NONEXISTENT_STUDENT_ID, parentUser.id, tx)).toBeNull();
    });
  });
});

describe("StudentRepository rollback purity (Tier 4)", () => {
  test("fixtures written inside runInRollback are invisible after rollback (both methods)", async () => {
    const rollbackCode = `KSB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    let rollbackUserId = 0;
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { fullName: "Rollback Purity Fixture" });
      await createTestStudent(tx, user.id, { handshakeCode: rollbackCode });
      rollbackUserId = user.id;
      // Visible INSIDE the transaction…
      expect(await StudentRepository.findHandshakeCodeByStudentId(rollbackUserId, tx)).toBe(rollbackCode);
      const inside = await StudentRepository.findDiscoveryByHandshakeCode(rollbackCode, tx);
      expect(inside?.fullName).toBe("Rollback Purity Fixture");
    });
    // …and invisible on a fresh session AFTER the forced rollback.
    expect(await StudentRepository.findHandshakeCodeByStudentId(rollbackUserId)).toBeNull();
    expect(await StudentRepository.findDiscoveryByHandshakeCode(rollbackCode)).toBeNull();
  });

  test("a link written inside runInRollback unlinks again after the forced rollback", async () => {
    let rollbackStudentId = 0;
    let rollbackCode = "";
    await runInRollback(async tx => {
      const parentUser = await createTestUser(tx, { role: "parent" });
      const studentUser = await createTestUser(tx);
      const student = await createTestStudent(tx, studentUser.id);
      rollbackStudentId = student.id;
      rollbackCode = student.handshakeCode;
      const winner = await StudentRepository.linkParentIfUnlinked(student.id, parentUser.id, tx);
      expect(winner?.parentId).toBe(parentUser.id);
      // Visible INSIDE the transaction (the write joined the outer tx)…
      expect((await StudentRepository.findLinkTargetByHandshakeCode(rollbackCode, tx))?.parentId).toBe(parentUser.id);
    });
    // …and invisible on a fresh session AFTER the forced rollback — the
    // whole link (with its rollback-tx fixture) is gone: no students row,
    // hence no link target row at all.
    expect(await StudentRepository.findLinkTargetByHandshakeCode(rollbackCode)).toBeNull();
    expect(await StudentRepository.findById(rollbackStudentId)).toBeNull();
  });
});
