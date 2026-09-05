/**
 * StudentHandshakeService tests — student self-read + parent discovery
 * against the live PostgreSQL instance.
 *
 * Per `backend/services/AGENTS.md` (service tests live next to the code) and
 * `backend/db/test/AGENTS.md`:
 *  - 4-Tier mixed suite. Transaction-plumbed cases run inside `runInRollback`
 *    with `tx` passed to every service/entity-setup call. The no-transaction
 *    service reads (both flows are single reads through the repository's
 *    default executor) cannot see uncommitted rollback fixtures, so they run
 *    against ONE committed `beforeAll` cast that is hard-deleted in `afterAll`
 *    with tracked ids + residue probes (the committed-fixture hygiene rule).
 *  - Entities ONLY via `entity-setup.ts` helpers (randomized emails/codes);
 *    governance variants are seeded via `createTestUser` overrides.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` appears nowhere.
 *  - Translated-message assertions use translated literals computed in-file
 *    through `getServerTranslations` (the service-test precedent) — never
 *    raw keys, never hardcoded UI copy.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): self-read verbatim + missing-row NotFoundError;
 *    discovery exact-code hit (two-key payload, maskedName), already-linked
 *    (linkable:false, no parentId key), valid-miss null, in-transaction hit
 *    through the propagated tx; governance predicate clean/deleted/blocked
 *    arms + fail-closed arms.
 *  - Tier 2 (boundary): lowercase + surrounding-whitespace variants resolve
 *    identically; suspension ended-in-past is VISIBLE; suspension window
 *    ending EXACTLY at the evaluation instant has lapsed (strict comparison)
 *    vs one ending after it (excluded); suspended with missing window data
 *    fails closed; suspended with a NON-POSITIVE duration (0/negative —
 *    corrupt data the unchecked int column accepts) fails closed too.
 *  - Tier 3 (chaos): malformed fuzz (%/_/\, unicode, RTL, emoji, NUL,
 *    empty/whitespace-only, over/under-length) rejects with ValidationError
 *    BEFORE any DB read (repo-method spy: zero calls); three governance
 *    fixtures each collapse to null deep-equal to the nonexistent-code null.
 *  - Tier 4 (security/logging): extensions-code mapping (VALIDATION,
 *    STUDENT_NOT_FOUND); localized denials resolve distinctly in ar + en;
 *    domain-rejection logs carry bounded context and NEVER the submitted
 *    code; happy paths / misses / governance collapses emit NOTHING; read
 *    flows write zero rows (per-actor attributable audit/notification
 *    probes — global table totals would race with concurrent files).
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { StudentRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { isGovernanceExcludedFromDiscovery } from "@/backend/services/students/student-handshake.helpers";
import { StudentHandshakeService } from "@/backend/services/students/student-handshake.service";
import type { DBTransaction, StudentSelectType, UserSelectType } from "@/backend/types";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE_EN = "en";
const LOCALE_AR = "ar";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** English translated literals — the message-comparison source of truth. */
const enErrors = getServerTranslations(LOCALE_EN).errorsTranslations;

/** Governance input shape accepted by the pure predicate. */
type GovernanceInputType = Parameters<typeof isGovernanceExcludedFromDiscovery>[0];

/**
 * Fixture display name — rides along in the governance input shape (the
 * `UserSelectType` half of the canonical discovery row) and is ignored by
 * the predicate.
 */
const GOVERNANCE_FIXTURE_FULL_NAME = "Governance Fixture";

/** A committed student fixture: real users + students rows with a known code. */
interface StudentFixtureType {
  readonly userId: number;
  readonly handshakeCode: string;
  readonly fullName: string;
}

/** The committed cast provisioned once in `beforeAll` (tracked for teardown). */
interface CommittedCastType {
  readonly student: StudentFixtureType;
  readonly linkedStudent: StudentFixtureType;
  readonly linkedParentUserId: number;
  readonly governedDeletedCode: string;
  readonly governedBlockedCode: string;
  readonly governedSuspendedCode: string;
  readonly lapsedSuspension: StudentFixtureType;
  readonly incompleteSuspensionCode: string;
  readonly zeroPeriodSuspensionCode: string;
  readonly negativePeriodSuspensionCode: string;
  readonly parentUserId: number;
  readonly absentUserId: number;
  readonly absentProbeCode: string;
}

let cast: CommittedCastType | null = null;

/**
 * Tracked committed-fixture ids — MODULE scope, populated as the `beforeAll`
 * fixture helpers run, so `afterAll` can hard-delete them even when a
 * post-commit step in `beforeAll` fails BEFORE `cast` is assigned (a `null`
 * cast must never prevent teardown: `requireCast()` would throw here and the
 * already-committed rows would leak in the shared test DB).
 */
const trackedUserIds: number[] = [];
const trackedStudentIds: number[] = [];

function requireCast(): CommittedCastType {
  if (cast === null) {
    throw new Error("committed cast missing: beforeAll fixture was not provisioned");
  }
  return cast;
}

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Installs a recording stub over `logger.logDomainError` (silences + counts). */
function silenceDomainLog() {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/** Asserts that a caught error carries a DomainError extensions.code value. */
function assertErrorCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) {
    throw new Error("expected a DomainError instance");
  }
  expect(error.code).toBe(expectedCode);
}

/** Builds a governance input explicitly (field-by-field — no spreads). */
function governanceFixture(
  isDeleted: boolean,
  isBlocked: boolean,
  suspended: boolean,
  suspendedAt: Date | null,
  suspendedPeriodDays: number | null
): GovernanceInputType {
  return {
    fullName: GOVERNANCE_FIXTURE_FULL_NAME,
    isDeleted,
    isBlocked,
    suspended,
    suspendedAt,
    suspendedPeriodDays,
  };
}

/**
 * Creates a committed student fixture (user + students row); both ids are
 * tracked in the module-scope registries for the `afterAll` hard delete.
 */
async function createStudentFixture(
  tx: DBTransaction,
  userOverrides: Partial<UserSelectType>,
  studentOverrides: Partial<StudentSelectType> = {}
): Promise<StudentFixtureType> {
  const user = await createTestUser(tx, userOverrides);
  trackedUserIds.push(user.id);
  const student = await createTestStudent(tx, user.id, studentOverrides);
  trackedStudentIds.push(student.id);
  return { userId: user.id, handshakeCode: student.handshakeCode, fullName: user.fullName };
}

/** Derives a valid-format code that differs from `existing` (nonexistent probe). */
function deriveAbsentHandshakeCode(existing: string): string {
  const lastChar = existing.slice(-1);
  const replacement = lastChar === "0" ? "1" : "0";
  return `${existing.slice(0, -1)}${replacement}`;
}

/** Malformed probes — every one stays invalid AFTER trim+uppercase normalization. */
const MALFORMED_PROBES: readonly string[] = [
  "%KSB-ABCD1234",
  "KSB-ABCD123%",
  "KSB-AB_D1234",
  "KSB-AB\\D1234",
  "_",
  "\\",
  "KSB-",
  "KSB-ABCD123",
  "KSB-ABCD12345",
  "XSB-ABCD1234",
  "KSBABCD1234",
  "ksb-abcd123g",
  "",
  "   ",
  "  KSB-  ",
  "رمز-دخول",
  "\u202EKSB-ABCD1234",
  "\u2066KSB-ABCD1234\u2069",
  "KSB-\u{1F600}BCD1234",
  "KSB-ABCD1234\u0000",
  `KSB-${"A".repeat(5000)}`,
];

/** Distinctive malformed probes asserted absent from every domain log payload. */
const LOG_SECURITY_PROBES: readonly string[] = [
  "%KSB-ABCD1234",
  "KSB-ABCD12345",
  "ksb-abcd123g",
  "\u202EKSB-ABCD1234",
  "رمز-دخول",
  "KSB-\u{1F600}BCD1234",
];

// ─── Committed cast provisioning + tracked teardown ────────────────────

beforeAll(async () => {
  const provisioned = await db.transaction(async tx => {
    const student = await createStudentFixture(tx, {
      fullName: "Yusuf Rahman",
    });
    const linkedParent = await createTestUser(tx, { role: "parent", fullName: "Fatima Nour" });
    trackedUserIds.push(linkedParent.id);
    const linkedStudent = await createStudentFixture(tx, { fullName: "Bilal Said" }, { parentId: linkedParent.id });
    const governedDeleted = await createStudentFixture(tx, {
      fullName: "Mariam Fouad",
      isDeleted: true,
    });
    const governedBlocked = await createStudentFixture(tx, {
      fullName: "Omar Adel",
      isBlocked: true,
    });
    const governedSuspended = await createStudentFixture(tx, {
      fullName: "Hana Mostafa",
      suspended: true,
      suspendedAt: new Date(Date.now() - HOUR_MS),
      suspendedPeriodDays: 30,
    });
    const lapsedSuspension = await createStudentFixture(tx, {
      fullName: "Sara Ibrahim",
      suspended: true,
      suspendedAt: new Date(Date.now() - 30 * DAY_MS),
      suspendedPeriodDays: 1,
    });
    const incompleteSuspension = await createStudentFixture(tx, {
      fullName: "Nour Khaled",
      suspended: true,
    });
    // Corrupt-duration variants: `suspended_period_days` is a plain nullable
    // int with NO CHECK constraint, so 0/negative values can sit in the table.
    // Both students are actively suspended in intent — the predicate must
    // treat the non-positive durations as INVALID (fail-closed), never as a
    // zero-length window that already lapsed.
    const zeroPeriodSuspension = await createStudentFixture(tx, {
      fullName: "Laila Tariq",
      suspended: true,
      suspendedAt: new Date(Date.now() - HOUR_MS),
      suspendedPeriodDays: 0,
    });
    const negativePeriodSuspension = await createStudentFixture(tx, {
      fullName: "Adham Sami",
      suspended: true,
      suspendedAt: new Date(Date.now() - HOUR_MS),
      suspendedPeriodDays: -7,
    });
    const bareParent = await createTestUser(tx, { role: "parent", fullName: "Karim Mansour" });
    trackedUserIds.push(bareParent.id);
    return {
      student,
      linkedStudent,
      linkedParentUserId: linkedParent.id,
      governedDeletedCode: governedDeleted.handshakeCode,
      governedBlockedCode: governedBlocked.handshakeCode,
      governedSuspendedCode: governedSuspended.handshakeCode,
      lapsedSuspension,
      incompleteSuspensionCode: incompleteSuspension.handshakeCode,
      zeroPeriodSuspensionCode: zeroPeriodSuspension.handshakeCode,
      negativePeriodSuspensionCode: negativePeriodSuspension.handshakeCode,
      parentUserId: bareParent.id,
    };
  });

  // Definitely-absent user id (far above the committed id space) + a
  // valid-format probe code derived to match NO committed students row.
  const [maxRow] = await db.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  const absentUserId = (maxRow?.maxId ?? 0) + 1_000_000;
  const absentProbeCode = deriveAbsentHandshakeCode(provisioned.student.handshakeCode);
  const probeRow = await StudentRepository.findDiscoveryByHandshakeCode(absentProbeCode);
  if (probeRow !== null) {
    throw new Error("derived absent probe code unexpectedly matches a students row");
  }

  cast = {
    student: provisioned.student,
    linkedStudent: provisioned.linkedStudent,
    linkedParentUserId: provisioned.linkedParentUserId,
    governedDeletedCode: provisioned.governedDeletedCode,
    governedBlockedCode: provisioned.governedBlockedCode,
    governedSuspendedCode: provisioned.governedSuspendedCode,
    lapsedSuspension: provisioned.lapsedSuspension,
    incompleteSuspensionCode: provisioned.incompleteSuspensionCode,
    zeroPeriodSuspensionCode: provisioned.zeroPeriodSuspensionCode,
    negativePeriodSuspensionCode: provisioned.negativePeriodSuspensionCode,
    parentUserId: provisioned.parentUserId,
    absentUserId,
    absentProbeCode,
  };
});

afterAll(async () => {
  // Unconditional teardown from the MODULE-scope id arrays — deliberately NOT
  // gated on `requireCast()`: when a post-commit step of `beforeAll` failed
  // before `cast` was assigned, the fixture rows are STILL committed and must
  // still be hard-deleted (the committed-fixture hygiene rule). Both arrays
  // are empty-safe (a failed-before-any-fixture beforeAll leaves nothing to
  // delete; drizzle's `inArray(col, [])` folds to `false`).
  if (trackedStudentIds.length > 0 || trackedUserIds.length > 0) {
    // FK-safe hard delete inside one committing transaction: students rows
    // first, then the users rows they reference.
    await db.transaction(async tx => {
      await Promise.all(trackedStudentIds.map(id => tx.delete(students).where(eq(students.id, id))));
      await Promise.all(trackedUserIds.map(id => tx.delete(users).where(eq(users.id, id))));
    });
  }
  // Residue probes — every tracked row is gone on a fresh read.
  const [userRows, studentRows] = await Promise.all([
    db.select({ id: users.id }).from(users).where(inArray(users.id, trackedUserIds)),
    db.select({ id: students.id }).from(students).where(inArray(students.id, trackedStudentIds)),
  ]);
  expect(userRows).toHaveLength(0);
  expect(studentRows).toHaveLength(0);
});

// ─── StudentHandshakeService.getMyHandshakeCode ────────────────────────

describe("StudentHandshakeService.getMyHandshakeCode", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns the caller's own committed code verbatim through the default read path", async () => {
    const c = requireCast();
    const ownCode = await StudentHandshakeService.getMyHandshakeCode(c.student.userId, LOCALE_EN);
    expect(ownCode).toBe(c.student.handshakeCode);
  });

  test("rejects with a localized NotFoundError STUDENT_NOT_FOUND when no students row exists (parent edge + absent id)", async () => {
    const c = requireCast();
    const logSpy = silenceDomainLog();
    try {
      const parentEdge = await expectRepoError(() =>
        StudentHandshakeService.getMyHandshakeCode(c.parentUserId, LOCALE_EN)
      );
      const absentEdge = await expectRepoError(() =>
        StudentHandshakeService.getMyHandshakeCode(c.absentUserId, LOCALE_EN)
      );

      for (const error of [parentEdge, absentEdge]) {
        expect(error).toBeInstanceOf(NotFoundError);
        assertErrorCode(error, "STUDENT_NOT_FOUND");
        expect(error.message).toBe(enErrors.studentHandshakeNotFound);
      }

      // Each missing-row rejection logged once, with bounded canonical context.
      expect(logSpy).toHaveBeenCalledTimes(2);
      const loggedIds = logSpy.mock.calls.map(call => call?.[1]?.entityId);
      expect(loggedIds).toEqual([c.parentUserId, c.absentUserId]);
      for (const call of logSpy.mock.calls) {
        const ctx = call?.[1];
        expect(ctx).toMatchObject({
          code: "STUDENT_NOT_FOUND",
          entity: "students",
          locale: LOCALE_EN,
        });
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  // ─── Tier 4: localized denials ──────────────────────────────────────

  test("missing-row denial resolves localized and DISTINCTLY in ar and en", async () => {
    const c = requireCast();
    const logSpy = silenceDomainLog();
    try {
      const arError = await expectRepoError(() =>
        StudentHandshakeService.getMyHandshakeCode(c.parentUserId, LOCALE_AR)
      );
      const enError = await expectRepoError(() =>
        StudentHandshakeService.getMyHandshakeCode(c.parentUserId, LOCALE_EN)
      );

      expect(arError.message).toBe(getServerTranslations(LOCALE_AR).errorsTranslations.studentHandshakeNotFound);
      expect(enError.message).toBe(enErrors.studentHandshakeNotFound);
      expect(arError.message).not.toBe(enError.message);
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ─── StudentHandshakeService.findStudentByHandshakeCode ────────────────

describe("StudentHandshakeService.findStudentByHandshakeCode", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("exact-code discovery returns EXACTLY the two-key payload with linkable true", async () => {
    const c = requireCast();
    const payload = await StudentHandshakeService.findStudentByHandshakeCode(c.student.handshakeCode, LOCALE_EN);
    if (payload === null) {
      throw new Error("expected a discovery payload for the committed unlinked student");
    }
    expect(Object.keys(payload).toSorted(compareStrings)).toEqual(["linkable", "maskedName"]);
    expect(payload.maskedName).toBe(maskFullName(c.student.fullName));
    expect(payload.maskedName).not.toBe(c.student.fullName);
    expect(payload.linkable).toBe(true);
  });

  test("already-linked child resolves linkable:false with NO parentId key or id leakage", async () => {
    const c = requireCast();
    const payload = await StudentHandshakeService.findStudentByHandshakeCode(c.linkedStudent.handshakeCode, LOCALE_EN);
    if (payload === null) {
      throw new Error("expected a discovery payload for the committed linked student");
    }
    expect(Object.keys(payload).toSorted(compareStrings)).toEqual(["linkable", "maskedName"]);
    expect(payload.linkable).toBe(false);
    expect(payload.maskedName).toBe(maskFullName(c.linkedStudent.fullName));
    // Belt-and-braces: no incumbent-parent identity survives serialization.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(String(c.linkedParentUserId));
    expect(serialized).not.toContain("parentId");
  });

  test("valid-format but nonexistent code resolves null (never an error)", async () => {
    const c = requireCast();
    const miss = await StudentHandshakeService.findStudentByHandshakeCode(c.absentProbeCode, LOCALE_EN);
    expect(miss).toBeNull();
  });

  test("in-rollback fixture is discoverable ONLY through the propagated transaction", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { fullName: "In Tx Child" });
      const student = await createTestStudent(tx, user.id);
      // The fixture exists solely inside this transaction — a hit proves the
      // service propagated `tx` into the repository read.
      const payload = await StudentHandshakeService.findStudentByHandshakeCode(student.handshakeCode, LOCALE_EN, tx);
      if (payload === null) {
        throw new Error("expected an in-transaction discovery payload");
      }
      expect(Object.keys(payload).toSorted(compareStrings)).toEqual(["linkable", "maskedName"]);
      expect(payload.linkable).toBe(true);
      expect(payload.maskedName).toBe(maskFullName(user.fullName));
    });
  });

  // ─── Tier 2: normalization + suspension boundaries ──────────────────

  test("lowercase variant of a real code resolves IDENTICALLY to the exact-code lookup", async () => {
    const c = requireCast();
    const lowered = await StudentHandshakeService.findStudentByHandshakeCode(
      c.student.handshakeCode.toLowerCase(),
      LOCALE_EN
    );
    const exact = await StudentHandshakeService.findStudentByHandshakeCode(c.student.handshakeCode, LOCALE_EN);
    expect(lowered).toEqual(exact);
  });

  test("surrounding-whitespace variants resolve identically (trim precedes validation)", async () => {
    const c = requireCast();
    const padded = await Promise.all([
      StudentHandshakeService.findStudentByHandshakeCode(`  ${c.student.handshakeCode}  `, LOCALE_EN),
      StudentHandshakeService.findStudentByHandshakeCode(`\t${c.student.handshakeCode}\n`, LOCALE_EN),
    ]);
    const exact = await StudentHandshakeService.findStudentByHandshakeCode(c.student.handshakeCode, LOCALE_EN);
    for (const payload of padded) {
      expect(payload).toEqual(exact);
    }
  });

  test("suspension that ENDED in the past is VISIBLE (lapsed suspensions do not exclude)", async () => {
    const c = requireCast();
    const payload = await StudentHandshakeService.findStudentByHandshakeCode(
      c.lapsedSuspension.handshakeCode,
      LOCALE_EN
    );
    if (payload === null) {
      throw new Error("expected the lapsed-suspension student to stay discoverable");
    }
    expect(payload.linkable).toBe(true);
    expect(payload.maskedName).toBe(maskFullName(c.lapsedSuspension.fullName));
  });

  test("suspended with MISSING window data fails closed (excluded, indistinguishable from nonexistent)", async () => {
    const c = requireCast();
    const collapsed = await StudentHandshakeService.findStudentByHandshakeCode(c.incompleteSuspensionCode, LOCALE_EN);
    expect(collapsed).toBeNull();
    expect(collapsed).toEqual(await StudentHandshakeService.findStudentByHandshakeCode(c.absentProbeCode, LOCALE_EN));
  });

  test("suspended with a NON-POSITIVE period fails closed (corrupt 0/negative durations never widen discovery)", async () => {
    const c = requireCast();
    // Both fixtures are actively suspended with a window START an hour ago;
    // the zero/negative durations are corrupt data the unchecked int column
    // accepts. Pre-fix, both computed `endsAt ≤ now` and masqueraded as
    // "lapsed" — keeping an actively-suspended student discoverable.
    const collapsed = await Promise.all([
      StudentHandshakeService.findStudentByHandshakeCode(c.zeroPeriodSuspensionCode, LOCALE_EN),
      StudentHandshakeService.findStudentByHandshakeCode(c.negativePeriodSuspensionCode, LOCALE_EN),
    ]);
    const nonexistent = await StudentHandshakeService.findStudentByHandshakeCode(c.absentProbeCode, LOCALE_EN);
    for (const outcome of collapsed) {
      expect(outcome).toBeNull();
      // Same null channel — corrupt governance data is indistinguishable
      // from a code that never existed.
      expect(outcome).toEqual(nonexistent);
    }
  });

  // ─── Tier 3: malformed fuzz rejected PRE-DB ─────────────────────────

  test("malformed inputs reject with VALIDATION BEFORE any DB read (repo spy: zero calls)", async () => {
    const repoSpy = spyOn(StudentRepository, "findDiscoveryByHandshakeCode");
    const logSpy = silenceDomainLog();
    try {
      const errors = await Promise.all(
        MALFORMED_PROBES.map(probe =>
          expectRepoError(() => StudentHandshakeService.findStudentByHandshakeCode(probe, LOCALE_EN))
        )
      );
      for (const error of errors) {
        expect(error).toBeInstanceOf(ValidationError);
        assertErrorCode(error, "VALIDATION");
        expect(error.message).toBe(enErrors.handshakeCodeInvalid);
      }
      // Validation strictly precedes persistence reads — the repository
      // method never executed for ANY malformed probe.
      expect(repoSpy).toHaveBeenCalledTimes(0);
      expect(logSpy).toHaveBeenCalledTimes(MALFORMED_PROBES.length);
    } finally {
      repoSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test("governance fixtures (deleted, blocked, active suspension) each collapse to null, deep-equal to a nonexistent code", async () => {
    const c = requireCast();
    const outcomes = await Promise.all([
      StudentHandshakeService.findStudentByHandshakeCode(c.governedDeletedCode, LOCALE_EN),
      StudentHandshakeService.findStudentByHandshakeCode(c.governedBlockedCode, LOCALE_EN),
      StudentHandshakeService.findStudentByHandshakeCode(c.governedSuspendedCode, LOCALE_EN),
    ]);
    const nonexistent = await StudentHandshakeService.findStudentByHandshakeCode(c.absentProbeCode, LOCALE_EN);
    for (const outcome of outcomes) {
      expect(outcome).toBeNull();
      // The null channel is IDENTICAL for governed and nonexistent codes.
      expect(outcome).toEqual(nonexistent);
    }
  });

  // ─── Tier 4: localized denial + logging + write-freedom ─────────────

  test("malformed-code denial resolves localized and DISTINCTLY in ar and en", async () => {
    const logSpy = silenceDomainLog();
    try {
      const arError = await expectRepoError(() =>
        StudentHandshakeService.findStudentByHandshakeCode("KSB-NOPE", LOCALE_AR)
      );
      const enError = await expectRepoError(() =>
        StudentHandshakeService.findStudentByHandshakeCode("KSB-NOPE", LOCALE_EN)
      );

      expect(arError.message).toBe(getServerTranslations(LOCALE_AR).errorsTranslations.handshakeCodeInvalid);
      expect(enError.message).toBe(enErrors.handshakeCodeInvalid);
      expect(arError.message).not.toBe(enError.message);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("domain-rejection logs carry bounded context and NEVER the submitted code", async () => {
    const logSpy = silenceDomainLog();
    try {
      await Promise.all(
        LOG_SECURITY_PROBES.map(probe =>
          expectRepoError(() => StudentHandshakeService.findStudentByHandshakeCode(probe, LOCALE_EN))
        )
      );
      expect(logSpy).toHaveBeenCalledTimes(LOG_SECURITY_PROBES.length);
      const loggedPayload = JSON.stringify(logSpy.mock.calls);
      for (const probe of LOG_SECURITY_PROBES) {
        // No submitted value — raw, normalized, or fragment — reaches a log.
        expect(loggedPayload.includes(probe)).toBe(false);
        expect(loggedPayload.includes(probe.toUpperCase().trim())).toBe(false);
      }
      for (const call of logSpy.mock.calls) {
        const ctx = call?.[1];
        // Bounded key set: no entity id exists at this layer, and nothing else.
        expect(Object.keys(ctx ?? {}).toSorted(compareStrings)).toEqual(["code", "entity", "locale"]);
        expect(ctx).toMatchObject({ code: "VALIDATION", entity: "students", locale: LOCALE_EN });
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  test("happy paths, misses, and governance collapses emit NOTHING to the domain log", async () => {
    const c = requireCast();
    const logSpy = silenceDomainLog();
    try {
      await StudentHandshakeService.getMyHandshakeCode(c.student.userId, LOCALE_EN);
      await StudentHandshakeService.findStudentByHandshakeCode(c.student.handshakeCode, LOCALE_EN);
      await StudentHandshakeService.findStudentByHandshakeCode(c.absentProbeCode, LOCALE_EN);
      await StudentHandshakeService.findStudentByHandshakeCode(c.governedDeletedCode, LOCALE_EN);
      expect(logSpy).toHaveBeenCalledTimes(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("read flows write ZERO rows — no attributable audit/notification rows", async () => {
    const c = requireCast();
    const logSpy = silenceDomainLog();
    try {
      // Exercise every read path, including both rejection arms. No global
      // audit/notification totals are snapshotted: global table counts
      // race with concurrent files' fixture cleanup under parallel bun
      // test execution — the per-actor attributable probe below is the
      // hermetic zero-write evidence.
      await StudentHandshakeService.getMyHandshakeCode(c.student.userId, LOCALE_EN);
      await StudentHandshakeService.findStudentByHandshakeCode(c.student.handshakeCode, LOCALE_EN);
      await StudentHandshakeService.findStudentByHandshakeCode(c.absentProbeCode, LOCALE_EN);
      await StudentHandshakeService.findStudentByHandshakeCode(c.governedSuspendedCode, LOCALE_EN);
      await expectRepoError(() => StudentHandshakeService.getMyHandshakeCode(c.parentUserId, LOCALE_EN));
      await expectRepoError(() => StudentHandshakeService.findStudentByHandshakeCode("KSB-NOPE", LOCALE_EN));

      // Per-actor probes: no side-effect row is attributable to any tracked id.
      const attributable = await Promise.all(
        trackedUserIds.map(async id => {
          const [notificationRows, auditRows] = await Promise.all([
            db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, id)),
            db
              .select({ id: auditLogs.id })
              .from(auditLogs)
              .where(or(eq(auditLogs.actorId, id), eq(auditLogs.entityId, id))),
          ]);
          return notificationRows.length + auditRows.length;
        })
      );
      for (const count of attributable) {
        expect(count).toBe(0);
      }
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ─── isGovernanceExcludedFromDiscovery (pure predicate) ────────────────

describe("isGovernanceExcludedFromDiscovery (pure predicate)", () => {
  // ─── Tier 1: branch arms ────────────────────────────────────────────

  test("clean governance stays discoverable; deleted and blocked each exclude alone", () => {
    const now = new Date();
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, false, null, null), now)).toBe(false);
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(true, false, false, null, null), now)).toBe(true);
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, true, false, null, null), now)).toBe(true);
  });

  test("suspended with missing window start or duration fails closed (excluded)", () => {
    const now = new Date();
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, null, 30), now)).toBe(true);
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, now, null), now)).toBe(true);
  });

  test("suspended with a NON-POSITIVE duration fails closed (corrupt data treated as invalid)", () => {
    const now = new Date();
    const startedAnHourAgo = new Date(now.getTime() - HOUR_MS);
    // `suspended_period_days` is a plain nullable int with no CHECK
    // constraint — 0 and negative values are corrupt governance data. A
    // zero-day window would otherwise compute `endsAt == suspendedAt` (in the
    // past) and masquerade as "lapsed" while the student is actively
    // suspended; the predicate must fail closed on both.
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, startedAnHourAgo, 0), now)).toBe(
      true
    );
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, startedAnHourAgo, -7), now)).toBe(
      true
    );
    // The invalid-duration verdict is independent of the window start: a
    // current start with a zero duration is excluded exactly the same way.
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, now, 0), now)).toBe(true);
  });

  // ─── Tier 2: strict active-window boundary ──────────────────────────

  test("window ending EXACTLY at the evaluation instant has lapsed (strict comparison)", () => {
    const now = new Date(1_700_000_000_000);
    const startsOneDayEarlier = new Date(now.getTime() - DAY_MS);
    // endsAt == now exactly → NOT excluded.
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, startsOneDayEarlier, 1), now)).toBe(
      false
    );
    // endsAt one full day AFTER now → actively suspended → excluded.
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, now, 1), now)).toBe(true);
    // endsAt one full day BEFORE now → lapsed → visible.
    const startsTwoDaysEarlier = new Date(now.getTime() - 2 * DAY_MS);
    expect(isGovernanceExcludedFromDiscovery(governanceFixture(false, false, true, startsTwoDaysEarlier, 1), now)).toBe(
      false
    );
  });
});
