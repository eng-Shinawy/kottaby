/**
 * Unit tests for `parent-monitoring.helpers.ts`.
 *
 * Co-located with the helpers file (mirrors the
 * `parent-link-request.helpers.test.ts` convention). Covers:
 *  - `clampPageInput` — pagination clamp + echo
 *  - `mapSessionToAttendanceEntry` — session row → attendance entry
 *  - `mapReportRowToEntry` — report row → report entry (null passthrough)
 *  - `mapHomeWorkRowToEntry` — homework row → homework entry (track collapse)
 *  - `composeChildProgress` — composite progress payload assembly
 *  - `requireLinkedChild` gate — the constant-shape denial oracle
 *
 * The gate's denial oracle is pinned across all five causes (malformed id,
 * missing row, foreign id, never-linked id, severed child) — every arm
 * throws the SAME `ForbiddenError` carrying the SAME localized message and
 * emits exactly ONE bounded `logDomainError` whose context bag is exactly
 * `{ code, entity, entityId, locale }` (zero child fields).
 *
 * All translated-message assertions compute the expected copy through
 * `getServerTranslations(locale).errorsTranslations.forbidden` — never raw
 * strings. Denial copy is asserted for BOTH `en` and `ar`.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type ReportForStudentRow, StudentRepository, UserRepository } from "@/backend/db/repo";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ForbiddenError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  clampPageInput,
  composeChildProgress,
  mapHomeWorkRowToEntry,
  mapReportRowToEntry,
  mapSessionToAttendanceEntry,
  requireLinkedChild,
} from "@/backend/services/parents/parent-monitoring.helpers";
import type { HomeWorkSelectType, SessionSelectType, StudentSelectType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE_EN = "en";
const LOCALE_AR = "ar";

const enErrors = getServerTranslations(LOCALE_EN).errorsTranslations;
const arErrors = getServerTranslations(LOCALE_AR).errorsTranslations;

type SpyInstance = ReturnType<typeof spyOn>;
const trackedSpies: SpyInstance[] = [];

function trackSpy<T extends SpyInstance>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

function silenceDomainLog() {
  return trackSpy(spyOn(logger, "logDomainError").mockImplementation(() => {}));
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const baseUser: UserSelectType = {
  id: 30,
  fullName: "Linked Child",
  email: "child@test.local",
  phone: "+1234567890",
  passwordHash: "hash",
  role: "student",
  isDeleted: false,
  isBlocked: false,
  suspended: false,
  suspendedAt: null,
  suspendedPeriodDays: null,
  lastActiveAt: null,
  country: null,
  dateOfBirth: null,
  gender: null,
  blockedAt: null,
  deletedAt: null,
  locale: "en",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const baseStudent: StudentSelectType = {
  id: 30,
  balanceHifz: 0,
  balanceReviews: 0,
  balanceTajweed: 0,
  balanceTrial: 0,
  trialGrantedAt: null,
  primaryLanguage: null,
  anotherLanguage: null,
  handshakeCode: "ABC12345",
  parentId: 10,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const baseSession: SessionSelectType = {
  id: 100,
  teacherId: 5,
  studentId: 30,
  status: SessionStatus.Completed,
  sessionType: "student_session",
  intent: null,
  fee: null,
  feeHeld: false,
  heldBalanceLane: null,
  startedAt: new Date("2026-02-01T09:00:00.000Z"),
  endedAt: new Date("2026-02-01T09:45:00.000Z"),
  confirmedByStudentAt: null,
  confirmedByTeacherAt: null,
  confirmationDeadline: null,
  cancelReason: null,
  disputeReason: null,
  disputedAt: null,
  resolutionNote: null,
  resolutionOutcome: null,
  resolvedAt: null,
  createdAt: new Date("2026-01-31T10:00:00.000Z"),
  updatedAt: new Date("2026-01-31T10:00:00.000Z"),
};

const baseHomeWork: HomeWorkSelectType = {
  id: 200,
  sessionId: 100,
  currentFromAyah: 1,
  currentToAyah: 7,
  currentGrade: 80,
  currentSurahJuz: SurahJuzRef.SurahAlFatihah,
  revisionFromAyah: null,
  revisionToAyah: null,
  revisionGrade: null,
  revisionSurahJuz: null,
  createdAt: new Date("2026-01-31T10:00:00.000Z"),
  updatedAt: new Date("2026-01-31T10:00:00.000Z"),
};

// ─── clampPageInput ─────────────────────────────────────────────────────────

describe("parent-monitoring.helpers — clampPageInput", () => {
  test("defaults to page 1 and pageSize 25 when input is undefined", () => {
    const result = clampPageInput(undefined);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
    expect(result.offset).toBe(0);
  });

  test("defaults to page 1 and pageSize 25 when input is an empty object", () => {
    const result = clampPageInput({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
    expect(result.offset).toBe(0);
  });

  test("echoes valid page and pageSize", () => {
    const result = clampPageInput({ page: 3, pageSize: 10 });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
    expect(result.offset).toBe(20);
  });

  test("clamps pageSize to the upper bound of 50", () => {
    const result = clampPageInput({ page: 1, pageSize: 100 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
    expect(result.offset).toBe(0);
  });

  test("accepts pageSize exactly at the upper bound of 50", () => {
    const result = clampPageInput({ page: 2, pageSize: 50 });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
    expect(result.offset).toBe(50);
  });

  test("rejects non-positive page (defaults to 1)", () => {
    expect(clampPageInput({ page: 0, pageSize: 10 }).page).toBe(1);
    expect(clampPageInput({ page: -3, pageSize: 10 }).page).toBe(1);
  });

  test("rejects non-integer page (defaults to 1)", () => {
    expect(clampPageInput({ page: 1.5, pageSize: 10 }).page).toBe(1);
    expect(clampPageInput({ page: Number.NaN, pageSize: 10 }).page).toBe(1);
  });

  test("rejects non-positive pageSize (defaults to 25)", () => {
    expect(clampPageInput({ page: 1, pageSize: 0 }).pageSize).toBe(25);
    expect(clampPageInput({ page: 1, pageSize: -5 }).pageSize).toBe(25);
  });

  test("computes offset as (page - 1) * pageSize", () => {
    expect(clampPageInput({ page: 4, pageSize: 15 }).offset).toBe(45);
  });
});

// ─── mapSessionToAttendanceEntry ────────────────────────────────────────────

describe("parent-monitoring.helpers — mapSessionToAttendanceEntry", () => {
  test("maps a completed session row with all timestamps present", () => {
    const entry = mapSessionToAttendanceEntry(baseSession);
    expect(entry.id).toBe(100);
    expect(entry.status).toBe(SessionStatus.Completed);
    expect(entry.startedAt).toEqual(baseSession.startedAt);
    expect(entry.endedAt).toEqual(baseSession.endedAt);
    expect(entry.createdAt).toEqual(baseSession.createdAt);
  });

  test("maps a scheduled session row with null startedAt and endedAt", () => {
    const entry = mapSessionToAttendanceEntry({
      ...baseSession,
      id: 101,
      status: SessionStatus.Scheduled,
      startedAt: null,
      endedAt: null,
    });
    expect(entry.status).toBe(SessionStatus.Scheduled);
    expect(entry.startedAt).toBeNull();
    expect(entry.endedAt).toBeNull();
  });

  test("does not expose internal columns (teacherId, fee, heldBalanceLane, etc.)", () => {
    const entry = mapSessionToAttendanceEntry(baseSession);
    const keys = Object.keys(entry).toSorted(compareStrings);
    expect(keys).toEqual(["createdAt", "endedAt", "id", "startedAt", "status"]);
  });

  test("fails closed on a corrupt stored session_status value", () => {
    const logSpy = silenceDomainLog();
    // @ts-expect-error exercising the fail-closed guard with a corrupt value
    const corruptRow: SessionSelectType = { ...baseSession, status: "totally_invalid_status" };

    expect(() => mapSessionToAttendanceEntry(corruptRow)).toThrow(/corrupt session_status value/);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        code: "PARENT_PORTAL_SESSION_STATUS_CORRUPT",
        entity: "session",
      })
    );
  });
});

// ─── mapReportRowToEntry ────────────────────────────────────────────────────

describe("parent-monitoring.helpers — mapReportRowToEntry", () => {
  const baseReportRow: ReportForStudentRow = {
    id: 300,
    sessionId: 100,
    teacherNotes: "Great focus today.",
    studentRatingByTeacher: 4,
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
    updatedAt: new Date("2026-02-01T10:00:00.000Z"),
    sessionStatus: SessionStatus.Completed,
    sessionStartedAt: new Date("2026-02-01T09:00:00.000Z"),
  };

  test("maps a complete report row", () => {
    const entry = mapReportRowToEntry(baseReportRow);
    expect(entry.id).toBe(300);
    expect(entry.sessionId).toBe(100);
    expect(entry.sessionStatus).toBe(SessionStatus.Completed);
    expect(entry.sessionStartedAt).toEqual(baseReportRow.sessionStartedAt);
    expect(entry.teacherNotes).toBe("Great focus today.");
    expect(entry.studentRatingByTeacher).toBe(4);
    expect(entry.createdAt).toEqual(baseReportRow.createdAt);
  });

  test("preserves null teacherNotes — never coerced to empty string", () => {
    const entry = mapReportRowToEntry({ ...baseReportRow, teacherNotes: null });
    expect(entry.teacherNotes).toBeNull();
  });

  test("preserves null studentRatingByTeacher — never coerced to 0", () => {
    const entry = mapReportRowToEntry({ ...baseReportRow, studentRatingByTeacher: null });
    expect(entry.studentRatingByTeacher).toBeNull();
  });

  test("preserves null sessionStartedAt", () => {
    const entry = mapReportRowToEntry({ ...baseReportRow, sessionStartedAt: null });
    expect(entry.sessionStartedAt).toBeNull();
  });

  test("does not expose internal columns (updatedAt dropped, no fee/teacherId)", () => {
    const entry = mapReportRowToEntry(baseReportRow);
    const keys = Object.keys(entry).toSorted(compareStrings);
    expect(keys).toEqual([
      "createdAt",
      "id",
      "sessionId",
      "sessionStartedAt",
      "sessionStatus",
      "studentRatingByTeacher",
      "teacherNotes",
    ]);
    expect("updatedAt" in entry).toBe(false);
  });
});

// ─── mapHomeWorkRowToEntry ──────────────────────────────────────────────────

describe("parent-monitoring.helpers — mapHomeWorkRowToEntry", () => {
  test("maps a row with only the Jadid track populated (Madi null)", () => {
    const entry = mapHomeWorkRowToEntry(baseHomeWork);
    expect(entry.id).toBe(200);
    expect(entry.sessionId).toBe(100);
    expect(entry.jadid).toEqual({
      surahJuz: SurahJuzRef.SurahAlFatihah,
      fromAyah: 1,
      toAyah: 7,
      grade: 80,
    });
    expect(entry.madi).toBeNull();
  });

  test("maps a row with only the Madi track populated (Jadid null)", () => {
    const entry = mapHomeWorkRowToEntry({
      ...baseHomeWork,
      currentFromAyah: null,
      currentToAyah: null,
      currentGrade: null,
      currentSurahJuz: null,
      revisionFromAyah: 10,
      revisionToAyah: 20,
      revisionGrade: 65,
      revisionSurahJuz: SurahJuzRef.Juz1,
    });
    expect(entry.jadid).toBeNull();
    expect(entry.madi).toEqual({
      surahJuz: SurahJuzRef.Juz1,
      fromAyah: 10,
      toAyah: 20,
      grade: 65,
    });
  });

  test("collapses a fully-null Jadid block to null", () => {
    const entry = mapHomeWorkRowToEntry({
      ...baseHomeWork,
      currentFromAyah: null,
      currentToAyah: null,
      currentGrade: null,
      currentSurahJuz: null,
    });
    expect(entry.jadid).toBeNull();
  });

  test("keeps a partially-null Jadid block non-null with per-field nullability", () => {
    const entry = mapHomeWorkRowToEntry({
      ...baseHomeWork,
      currentFromAyah: null,
      currentToAyah: null,
      currentGrade: null,
      currentSurahJuz: SurahJuzRef.SurahAlBaqarah,
    });
    expect(entry.jadid).not.toBeNull();
    expect(entry.jadid?.surahJuz).toBe(SurahJuzRef.SurahAlBaqarah);
    expect(entry.jadid?.fromAyah).toBeNull();
    expect(entry.jadid?.toAyah).toBeNull();
    expect(entry.jadid?.grade).toBeNull();
  });

  test("preserves null grade in a non-null block — never coerced to 0", () => {
    const entry = mapHomeWorkRowToEntry({
      ...baseHomeWork,
      currentGrade: null,
    });
    expect(entry.jadid).not.toBeNull();
    expect(entry.jadid?.grade).toBeNull();
  });

  test("does not expose internal columns (updatedAt dropped, no sessionId-internal fields)", () => {
    const entry = mapHomeWorkRowToEntry(baseHomeWork);
    const keys = Object.keys(entry).toSorted(compareStrings);
    expect(keys).toEqual(["createdAt", "id", "jadid", "madi", "sessionId"]);
    expect("updatedAt" in entry).toBe(false);
  });
});

// ─── composeChildProgress ───────────────────────────────────────────────────

describe("parent-monitoring.helpers — composeChildProgress", () => {
  test("composes a complete progress payload from a populated latest homework row", () => {
    const payload = composeChildProgress(baseStudent, baseUser, 12, baseHomeWork);
    expect(payload.child).toEqual({
      id: 30,
      fullName: "Linked Child",
      createdAt: baseStudent.createdAt,
    });
    expect(payload.progressRowCount).toBe(12);
    expect(payload.latestJadidPosition).toEqual({
      surahJuz: SurahJuzRef.SurahAlFatihah,
      fromAyah: 1,
      toAyah: 7,
    });
    expect(payload.latestMadiPosition).toBeNull();
  });

  test("echoes zero progressRowCount honestly — never a fabricated percentage", () => {
    const payload = composeChildProgress(baseStudent, baseUser, 0, baseHomeWork);
    expect(payload.progressRowCount).toBe(0);
  });

  test("yields null latest positions when latest homework is null", () => {
    const payload = composeChildProgress(baseStudent, baseUser, 5, null);
    expect(payload.latestJadidPosition).toBeNull();
    expect(payload.latestMadiPosition).toBeNull();
  });

  test("yields null Jadid position when latest homework has null current_surah_juz", () => {
    const row: HomeWorkSelectType = {
      ...baseHomeWork,
      currentSurahJuz: null,
      revisionSurahJuz: SurahJuzRef.Juz30,
    };
    const payload = composeChildProgress(baseStudent, baseUser, 3, row);
    expect(payload.latestJadidPosition).toBeNull();
    expect(payload.latestMadiPosition).toEqual({
      surahJuz: SurahJuzRef.Juz30,
      fromAyah: null,
      toAyah: null,
    });
  });

  test("emits a non-null position with nullable ayah range when surah/juz is set but ayahs are null", () => {
    const row: HomeWorkSelectType = {
      ...baseHomeWork,
      currentFromAyah: null,
      currentToAyah: null,
      currentSurahJuz: SurahJuzRef.SurahAnNisa,
    };
    const payload = composeChildProgress(baseStudent, baseUser, 7, row);
    expect(payload.latestJadidPosition).toEqual({
      surahJuz: SurahJuzRef.SurahAnNisa,
      fromAyah: null,
      toAyah: null,
    });
  });

  test("child header does not surface internal student columns (handshakeCode, parentId, balance*)", () => {
    const payload = composeChildProgress(baseStudent, baseUser, 1, null);
    const keys = Object.keys(payload.child).toSorted(compareStrings);
    expect(keys).toEqual(["createdAt", "fullName", "id"]);
  });
});

// ─── requireLinkedChild gate — denial oracle ────────────────────────────────

describe("parent-monitoring.helpers — requireLinkedChild (happy path)", () => {
  test("returns the student row when the link is in force and the child is not soft-deleted", async () => {
    await runInRollback(async tx => {
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(baseStudent));
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(baseUser));

      const result = await requireLinkedChild(10, 30, LOCALE_EN, tx);
      expect(result).toBe(baseStudent);
    });
  });
});

describe("parent-monitoring.helpers — requireLinkedChild denial oracle (5 causes)", () => {
  /**
   * The denial-oracle posture: every cause throws the SAME ForbiddenError
   * with the SAME localized message and emits exactly ONE bounded
   * `logDomainError` whose context bag is exactly
   * `{ code: "FORBIDDEN", entity: "students", entityId: <studentId>, locale }`.
   * The caller cannot distinguish the cause from the response bytes.
   */
  type CauseId = "malformed" | "missing" | "foreign" | "never-linked" | "severed";

  function setupCause(causeId: CauseId) {
    if (causeId === "malformed") {
      return;
    }
    if (causeId === "missing") {
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(null));
      return;
    }
    if (causeId === "foreign") {
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...baseStudent, parentId: 99 }));
      return;
    }
    if (causeId === "never-linked") {
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...baseStudent, id: 31, parentId: null }));
      return;
    }
    // severed: student link valid, child user soft-deleted
    trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(baseStudent));
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue({ ...baseUser, isDeleted: true }));
  }

  function runFor(causeId: CauseId) {
    const { studentId, locale } = expectedFingerprint(causeId);
    if (causeId === "severed") {
      // The student row's `parentId` matches the parent actor; only the
      // user row's `isDeleted` flag triggers the severed-child denial.
      return requireLinkedChild(10, studentId, locale, undefined);
    }
    return requireLinkedChild(10, studentId, locale, undefined);
  }

  const CAUSES: CauseId[] = ["malformed", "missing", "foreign", "never-linked", "severed"];

  function expectedFingerprint(causeId: CauseId): { readonly studentId: number; readonly locale: string } {
    switch (causeId) {
      case "malformed":
        return { studentId: -1, locale: LOCALE_EN };
      case "missing":
        return { studentId: 9999, locale: LOCALE_EN };
      case "foreign":
        return { studentId: 30, locale: LOCALE_EN };
      case "never-linked":
        return { studentId: 31, locale: LOCALE_EN };
      case "severed":
        return { studentId: 30, locale: LOCALE_EN };
      default: {
        throw new Error(`Unhandled cause: ${String(causeId)}`);
      }
    }
  }

  test.each(CAUSES)("denial arm '%s' throws ForbiddenError with localized English copy", async causeId => {
    await runInRollback(async () => {
      silenceDomainLog();
      setupCause(causeId);

      let caught: unknown = null;
      try {
        await runFor(causeId);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      if (caught instanceof ForbiddenError) {
        expect(caught.code).toBe("FORBIDDEN");
        expect(caught.message).toBe(enErrors.forbidden);
      }
    });
  });

  test.each(CAUSES)(
    "denial arm '%s' throws ForbiddenError with localized Arabic copy under ar locale",
    async causeId => {
      await runInRollback(async () => {
        silenceDomainLog();
        setupCause(causeId);

        const { studentId } = expectedFingerprint(causeId);
        let caught: unknown = null;
        try {
          await requireLinkedChild(10, studentId, LOCALE_AR, undefined);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ForbiddenError);
        if (caught instanceof ForbiddenError) {
          expect(caught.code).toBe("FORBIDDEN");
          expect(caught.message).toBe(arErrors.forbidden);
        }
      });
    }
  );

  test.each(CAUSES)(
    "denial arm '%s' emits exactly ONE bounded logDomainError with the constant context bag",
    async causeId => {
      await runInRollback(async () => {
        const logSpy = silenceDomainLog();
        setupCause(causeId);

        let caught: unknown = null;
        try {
          await runFor(causeId);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ForbiddenError);
        expect(logSpy).toHaveBeenCalledTimes(1);

        const { studentId, locale } = expectedFingerprint(causeId);
        const [message, context] = logSpy.mock.calls[0];
        expect(typeof message).toBe("string");
        expect(context).toEqual({
          code: "FORBIDDEN",
          entity: "students",
          entityId: studentId,
          locale,
        });
      });
    }
  );

  async function captureFingerprint(causeId: CauseId): Promise<string | null> {
    silenceDomainLog();
    setupCause(causeId);
    try {
      await runFor(causeId);
      return null;
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return JSON.stringify({ code: err.code, message: err.message });
      }
      return null;
    }
  }

  test("oracle uniformity: all five causes produce byte-identical denial fingerprints (code + message) under en", async () => {
    const fingerprints = await Promise.all(CAUSES.map(c => captureFingerprint(c)));
    const valid = fingerprints.filter((f): f is string => f !== null);
    expect(valid).toHaveLength(CAUSES.length);
    expect(new Set(valid).size).toBe(1);
    expect(valid[0]).toBe(JSON.stringify({ code: "FORBIDDEN", message: enErrors.forbidden }));
  });

  test("denial context bag carries ZERO child fields (no parentId, fullName, handshakeCode, etc.)", async () => {
    await runInRollback(async () => {
      const logSpy = silenceDomainLog();
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...baseStudent, parentId: 99 }));

      let caught: unknown = null;
      try {
        await requireLinkedChild(10, 30, LOCALE_EN, undefined);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      expect(logSpy).toHaveBeenCalledTimes(1);

      const context = logSpy.mock.calls[0]?.[1];
      expect(context).toBeDefined();
      if (context !== undefined) {
        const contextKeys = Object.keys(context).toSorted(compareStrings);
        expect(contextKeys).toEqual(["code", "entity", "entityId", "locale"]);
        expect(context.entityId).toBe(30);
      }
    });
  });

  test("malformed id arms (non-integer, zero, negative, NaN) all deny without touching the repository", async () => {
    await runInRollback(async () => {
      const logSpy = silenceDomainLog();
      const studentSpy = trackSpy(spyOn(StudentRepository, "findById"));
      const userSpy = trackSpy(spyOn(UserRepository, "findById"));

      const malformedIds = [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
      const results = await Promise.allSettled(
        malformedIds.map(id => requireLinkedChild(10, id, LOCALE_EN, undefined))
      );
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(ForbiddenError);
        }
      }
      expect(studentSpy).not.toHaveBeenCalled();
      expect(userSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(malformedIds.length);
    });
  });

  test("severed child denial — child user row missing also denies (defense-in-depth)", async () => {
    await runInRollback(async () => {
      const logSpy = silenceDomainLog();
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(baseStudent));
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(null));

      let caught: unknown = null;
      try {
        await requireLinkedChild(10, 30, LOCALE_EN, undefined);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      if (caught instanceof ForbiddenError) {
        expect(caught.code).toBe("FORBIDDEN");
        expect(caught.message).toBe(enErrors.forbidden);
      }
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("happy path emits ZERO logDomainError (logs are denial-only)", async () => {
    await runInRollback(async () => {
      const logSpy = silenceDomainLog();
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(baseStudent));
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(baseUser));

      const result = await requireLinkedChild(10, 30, LOCALE_EN, undefined);
      expect(result).toBe(baseStudent);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
