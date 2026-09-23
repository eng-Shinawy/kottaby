/**
 * ParentMonitoringService tests — the six service operations over MOCKED
 * repository + actor seams.
 *
 * Per `backend/services/AGENTS.md` service-test rules: mock the persistence
 * seam and NEVER write real rows. The service is pure orchestration over
 * repos — the gate (`requireLinkedChild`) is imported from the same-domain
 * sibling helpers, and the actor re-check (`requireActor`) is imported
 * from `parent-link-request.helpers`. Both are exercised here through
 * repository spies (real resolution — never patched), with `runInRollback`
 * supplying a transactional `tx` that the service's `withTransaction` joins
 * as a SAVEPOINT (so denial throws inside the savepoint surface to the
 * test cleanly without aborting the outer tx).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): each of the six methods on the happy path
 *    (linked parent → data); the list-empty case (`listLinkedChildren` with
 *    zero linked children); the four per-student methods with empty
 *    sessions/reports/homework sets (honest empty payloads, never
 *    fabricated); `getSessionTarget` resolving the closed id pair for the
 *    linked parent's session.
 *  - Tier 2 (boundary): pagination clamp echo (page 0 → 1, pageSize 100 →
 *    25, pageSize exactly 50, out-of-range page → empty items next to true
 *    totalCount); null rating/notes/track blocks/missing latest position
 *    (mapper boundary arms); session with `startedAt: null`;
 *    `getSessionTarget` sessionId boundaries (0 / -1 / fractional / NaN →
 *    ValidationError; the 2^31 safe integer collapsing to the constant
 *    nonexistent-session denial).
 *  - Tier 3 (chaos): concurrent mixed reads on one parent via
 *    `Promise.allSettled` (five of the six namespace methods issued
 *    concurrently against the SAME parentActorId — each call resolves
 *    independently against the shared mocked repos).
 *  - Tier 4 (security): the denial oracle — every per-student method
 *    denies with the SAME constant ForbiddenError + localized message +
 *    ONE bounded logDomainError whose context bag is exactly
 *    `{ code, entity, entityId, locale }` (zero child fields), across the
 *    five denial causes (malformed id, missing row, foreign id,
 *    never-linked id, severed child). The BOLA arm: a non-parent actor
 *    (admin/teacher/student) is rejected by `requireActor(...,
 *    UserRole.Parent, ...)` with `ForbiddenError` BEFORE any data read
 *    (gate-before-read proven by call ordering spies). The
 *    `getSessionTarget` oracle arm: missing ≡ foreign session denial
 *    byte-identical per locale (en AND ar), exactly one bounded denial
 *    log with `{ entity: "sessions", entityId }` and no row fields, the
 *    session read resolved before the link gate, and the portal rate
 *    limit passed through as `RateLimitExceededError` before the
 *    transaction opens.
 *
 * All translated-message assertions compute the expected copy through
 * `getServerTranslations(locale).errorsTranslations.forbidden` — never raw
 * strings. Denial copy is asserted for BOTH `en` and `ar`.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  HomeWorkRepository,
  ProgressRepository,
  type ReportForStudentRow,
  ReportRepository,
  SessionRepository,
  StudentRepository,
  UserRepository,
} from "@/backend/db/repo";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ForbiddenError, RateLimitExceededError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { portalReadLimiter } from "@/backend/lib/ratelimit";
import { requireActor } from "@/backend/services/parents/parent-link-request.helpers";
import { ParentMonitoringService } from "@/backend/services/parents/parent-monitoring.service";
import type {
  DBTransaction,
  HomeWorkSelectType,
  SessionSelectType,
  StudentSelectType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE_EN = "en";
const LOCALE_AR = "ar";

const enErrors = getServerTranslations(LOCALE_EN).errorsTranslations;
const arErrors = getServerTranslations(LOCALE_AR).errorsTranslations;

const PARENT_ACTOR_ID = 10;
const CHILD_STUDENT_ID = 30;

type SpyInstance = ReturnType<typeof spyOn>;
const trackedSpies: SpyInstance[] = [];

function trackSpy<T extends SpyInstance>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

function silenceDomainLog() {
  return trackSpy(spyOn(logger, "logDomainError").mockImplementation(() => {}));
}

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Serially awaits thunk cells without an await inside a loop statement. */
async function runSequentially(cells: ReadonlyArray<() => Promise<void>>): Promise<void> {
  await cells.reduce<Promise<void>>((chain, cell) => chain.then(cell), Promise.resolve());
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const parentUser: UserSelectType = {
  id: PARENT_ACTOR_ID,
  fullName: "Linked Parent",
  email: "parent@test.local",
  phone: "+1234567890",
  passwordHash: "hash",
  role: "parent",
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

const childUser: UserSelectType = {
  ...parentUser,
  id: CHILD_STUDENT_ID,
  fullName: "Linked Child",
  email: "child@test.local",
  role: "student",
};

const childStudent: StudentSelectType = {
  id: CHILD_STUDENT_ID,
  balanceHifz: 0,
  balanceReviews: 0,
  balanceTajweed: 0,
  balanceTrial: 0,
  trialGrantedAt: null,
  primaryLanguage: null,
  anotherLanguage: null,
  handshakeCode: "ABC12345",
  parentId: PARENT_ACTOR_ID,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const childSession: SessionSelectType = {
  id: 100,
  teacherId: 5,
  studentId: CHILD_STUDENT_ID,
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

const childReportRow: ReportForStudentRow = {
  id: 300,
  sessionId: 100,
  teacherNotes: "Great focus.",
  studentRatingByTeacher: 4,
  createdAt: new Date("2026-02-01T10:00:00.000Z"),
  updatedAt: new Date("2026-02-01T10:00:00.000Z"),
  sessionStatus: SessionStatus.Completed,
  sessionStartedAt: new Date("2026-02-01T09:00:00.000Z"),
};

const childHomeWork: HomeWorkSelectType = {
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

/**
 * Mocks the actor re-check + the link gate's two repository calls so the
 * service's downstream reads (sessions/reports/homework/progress) can be
 * spied independently per test.
 */
function mockActorAndGateSuccess() {
  trackSpy(
    spyOn(UserRepository, "findById").mockImplementation(async id => {
      if (id === PARENT_ACTOR_ID) {
        return parentUser;
      }
      if (id === CHILD_STUDENT_ID) {
        return childUser;
      }
      return null;
    })
  );
  trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(childStudent));
}

// ─── Tier 1 — happy-path branches ───────────────────────────────────────────

describe("ParentMonitoringService — Tier 1 (happy paths)", () => {
  test("listLinkedChildren returns the linked-children rows from the repo", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(
        spyOn(StudentRepository, "listLinkedChildrenByParentId").mockResolvedValue([
          { id: CHILD_STUDENT_ID, fullName: "Linked Child", createdAt: childStudent.createdAt },
        ])
      );

      const result = await ParentMonitoringService.listLinkedChildren(PARENT_ACTOR_ID, LOCALE_EN, tx);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(CHILD_STUDENT_ID);
      expect(result[0]?.fullName).toBe("Linked Child");
    });
  });

  test("listLinkedChildren yields an empty array when the parent has zero linked children", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(StudentRepository, "listLinkedChildrenByParentId").mockResolvedValue([]));

      const result = await ParentMonitoringService.listLinkedChildren(PARENT_ACTOR_ID, LOCALE_EN, tx);
      expect(result).toEqual([]);
    });
  });

  test("getChildProgress composes child header + progress count + latest positions", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(ProgressRepository, "countForStudent").mockResolvedValue(7));
      trackSpy(spyOn(HomeWorkRepository, "findLatestByStudentId").mockResolvedValue(childHomeWork));

      const result = await ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx);
      expect(result.child.id).toBe(CHILD_STUDENT_ID);
      expect(result.child.fullName).toBe("Linked Child");
      expect(result.progressRowCount).toBe(7);
      expect(result.latestJadidPosition?.surahJuz).toBe(SurahJuzRef.SurahAlFatihah);
      expect(result.latestMadiPosition).toBeNull();
    });
  });

  test("getChildProgress emits zero progressRowCount when no progress rows exist", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(ProgressRepository, "countForStudent").mockResolvedValue(0));
      trackSpy(spyOn(HomeWorkRepository, "findLatestByStudentId").mockResolvedValue(null));

      const result = await ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx);
      expect(result.progressRowCount).toBe(0);
      expect(result.latestJadidPosition).toBeNull();
      expect(result.latestMadiPosition).toBeNull();
    });
  });

  test("listChildSessions returns the paginated attendance window", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([childSession]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(1));

      const result = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        { page: 1, pageSize: 25 },
        LOCALE_EN,
        tx
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(100);
      expect(result.items[0]?.status).toBe(SessionStatus.Completed);
      expect(result.totalCount).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });
  });

  test("listChildSessions yields an empty items array with honest totalCount when no sessions exist", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(0));

      const result = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  test("listChildReports returns the paginated report window", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(ReportRepository, "listForStudent").mockResolvedValue([childReportRow]));
      trackSpy(spyOn(ReportRepository, "countForStudent").mockResolvedValue(1));

      const result = await ParentMonitoringService.listChildReports(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(300);
      expect(result.items[0]?.teacherNotes).toBe("Great focus.");
      expect(result.items[0]?.studentRatingByTeacher).toBe(4);
    });
  });

  test("listChildReports yields empty items + honest total when no reports exist", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(ReportRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(ReportRepository, "countForStudent").mockResolvedValue(0));

      const result = await ParentMonitoringService.listChildReports(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  test("listChildHomework returns the paginated homework window", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(HomeWorkRepository, "listForStudent").mockResolvedValue([childHomeWork]));
      trackSpy(spyOn(HomeWorkRepository, "countForStudent").mockResolvedValue(1));

      const result = await ParentMonitoringService.listChildHomework(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(200);
      expect(result.items[0]?.jadid?.surahJuz).toBe(SurahJuzRef.SurahAlFatihah);
      expect(result.items[0]?.madi).toBeNull();
    });
  });

  test("listChildHomework yields empty items + honest total when no homework rows exist", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(HomeWorkRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(HomeWorkRepository, "countForStudent").mockResolvedValue(0));

      const result = await ParentMonitoringService.listChildHomework(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });
});

// ─── Tier 2 — boundary arms ─────────────────────────────────────────────────

describe("ParentMonitoringService — Tier 2 (boundary arms)", () => {
  test("listChildSessions clamps page 0 → 1 and echoes the effective page", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      const sessionSpy = trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(0));

      const result = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        { page: 0, pageSize: 10 },
        LOCALE_EN,
        tx
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      // listForStudent receives the clamped limit/offset pair (offset = (page - 1) * pageSize = 0).
      expect(sessionSpy.mock.calls[0]?.[2]).toBe(10);
      expect(sessionSpy.mock.calls[0]?.[3]).toBe(0);
    });
  });

  test("listChildSessions clamps pageSize 100 → 25 (default) and echoes the effective pageSize", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      const sessionSpy = trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(0));

      const result = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        { page: 1, pageSize: 100 },
        LOCALE_EN,
        tx
      );
      expect(result.pageSize).toBe(25);
      expect(sessionSpy.mock.calls[0]?.[2]).toBe(25);
    });
  });

  test("listChildSessions accepts pageSize exactly at the upper bound of 50", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      const sessionSpy = trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(0));

      const result = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        { page: 2, pageSize: 50 },
        LOCALE_EN,
        tx
      );
      expect(result.pageSize).toBe(50);
      expect(result.page).toBe(2);
      expect(sessionSpy.mock.calls[0]?.[3]).toBe(50);
    });
  });

  test("listChildSessions defaults page and pageSize when input is undefined", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(0));

      const result = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });
  });

  test("listChildReports out-of-range page yields empty items next to the true totalCount", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(ReportRepository, "listForStudent").mockResolvedValue([]));
      trackSpy(spyOn(ReportRepository, "countForStudent").mockResolvedValue(7));

      const result = await ParentMonitoringService.listChildReports(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        { page: 99, pageSize: 10 },
        LOCALE_EN,
        tx
      );
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(7);
      expect(result.page).toBe(99);
      expect(result.pageSize).toBe(10);
    });
  });

  test("listChildReports preserves null teacherNotes and null studentRatingByTeacher in the projection", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(
        spyOn(ReportRepository, "listForStudent").mockResolvedValue([
          { ...childReportRow, teacherNotes: null, studentRatingByTeacher: null },
        ])
      );
      trackSpy(spyOn(ReportRepository, "countForStudent").mockResolvedValue(1));

      const result = await ParentMonitoringService.listChildReports(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items[0]?.teacherNotes).toBeNull();
      expect(result.items[0]?.studentRatingByTeacher).toBeNull();
    });
  });

  test("listChildHomework collapses fully-null track blocks and preserves partial nullability", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(
        spyOn(HomeWorkRepository, "listForStudent").mockResolvedValue([
          {
            ...childHomeWork,
            currentFromAyah: null,
            currentToAyah: null,
            currentGrade: null,
            currentSurahJuz: null,
            revisionFromAyah: 10,
            revisionToAyah: 20,
            revisionGrade: null,
            revisionSurahJuz: SurahJuzRef.Juz1,
          },
        ])
      );
      trackSpy(spyOn(HomeWorkRepository, "countForStudent").mockResolvedValue(1));

      const result = await ParentMonitoringService.listChildHomework(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items[0]?.jadid).toBeNull();
      expect(result.items[0]?.madi).not.toBeNull();
      expect(result.items[0]?.madi?.surahJuz).toBe(SurahJuzRef.Juz1);
      expect(result.items[0]?.madi?.grade).toBeNull();
    });
  });

  test("getChildProgress yields null latest positions when the newest homework has no surah/juz reference on either track", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(ProgressRepository, "countForStudent").mockResolvedValue(3));
      trackSpy(
        spyOn(HomeWorkRepository, "findLatestByStudentId").mockResolvedValue({
          ...childHomeWork,
          currentSurahJuz: null,
          revisionSurahJuz: null,
        })
      );

      const result = await ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx);
      expect(result.progressRowCount).toBe(3);
      expect(result.latestJadidPosition).toBeNull();
      expect(result.latestMadiPosition).toBeNull();
    });
  });

  test("listChildSessions maps a scheduled session with null startedAt and endedAt", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(
        spyOn(SessionRepository, "listForStudent").mockResolvedValue([
          { ...childSession, id: 101, status: SessionStatus.Scheduled, startedAt: null, endedAt: null },
        ])
      );
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(1));

      const result = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      expect(result.items[0]?.status).toBe(SessionStatus.Scheduled);
      expect(result.items[0]?.startedAt).toBeNull();
      expect(result.items[0]?.endedAt).toBeNull();
    });
  });

  test("all page payloads expose ONLY the closed {items,totalCount,page,pageSize} shape", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([childSession]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(1));
      trackSpy(spyOn(ReportRepository, "listForStudent").mockResolvedValue([childReportRow]));
      trackSpy(spyOn(ReportRepository, "countForStudent").mockResolvedValue(1));
      trackSpy(spyOn(HomeWorkRepository, "listForStudent").mockResolvedValue([childHomeWork]));
      trackSpy(spyOn(HomeWorkRepository, "countForStudent").mockResolvedValue(1));

      const sessions = await ParentMonitoringService.listChildSessions(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      const reports = await ParentMonitoringService.listChildReports(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );
      const homework = await ParentMonitoringService.listChildHomework(
        PARENT_ACTOR_ID,
        CHILD_STUDENT_ID,
        undefined,
        LOCALE_EN,
        tx
      );

      const expectedKeys = ["items", "page", "pageSize", "totalCount"];
      expect(Object.keys(sessions).toSorted(compareStrings)).toEqual(expectedKeys);
      expect(Object.keys(reports).toSorted(compareStrings)).toEqual(expectedKeys);
      expect(Object.keys(homework).toSorted(compareStrings)).toEqual(expectedKeys);
    });
  });
});

// ─── Tier 3 — concurrent mixed calls on one parent ─────────────────────────

describe("ParentMonitoringService — Tier 3 (concurrent mixed calls on one parent)", () => {
  test("Promise.allSettled over five of the six namespace methods resolves independently against shared mocked repos", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      trackSpy(
        spyOn(StudentRepository, "listLinkedChildrenByParentId").mockResolvedValue([
          { id: CHILD_STUDENT_ID, fullName: "Linked Child", createdAt: childStudent.createdAt },
        ])
      );
      trackSpy(spyOn(ProgressRepository, "countForStudent").mockResolvedValue(4));
      trackSpy(spyOn(HomeWorkRepository, "findLatestByStudentId").mockResolvedValue(childHomeWork));
      trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([childSession]));
      trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(1));
      trackSpy(spyOn(ReportRepository, "listForStudent").mockResolvedValue([childReportRow]));
      trackSpy(spyOn(ReportRepository, "countForStudent").mockResolvedValue(1));
      trackSpy(spyOn(HomeWorkRepository, "listForStudent").mockResolvedValue([childHomeWork]));
      trackSpy(spyOn(HomeWorkRepository, "countForStudent").mockResolvedValue(1));

      const outcomes = await Promise.allSettled([
        ParentMonitoringService.listLinkedChildren(PARENT_ACTOR_ID, LOCALE_EN, tx),
        ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx),
        ParentMonitoringService.listChildSessions(PARENT_ACTOR_ID, CHILD_STUDENT_ID, undefined, LOCALE_EN, tx),
        ParentMonitoringService.listChildReports(PARENT_ACTOR_ID, CHILD_STUDENT_ID, undefined, LOCALE_EN, tx),
        ParentMonitoringService.listChildHomework(PARENT_ACTOR_ID, CHILD_STUDENT_ID, undefined, LOCALE_EN, tx),
      ]);

      expect(outcomes).toHaveLength(5);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("fulfilled");
      }
    });
  });

  test("Promise.allSettled over a denied child id alongside the linked-children list — denial does not poison the list", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      mockActorAndGateSuccess();
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...childStudent, parentId: 99 }));
      trackSpy(
        spyOn(StudentRepository, "listLinkedChildrenByParentId").mockResolvedValue([
          { id: CHILD_STUDENT_ID, fullName: "Linked Child", createdAt: childStudent.createdAt },
        ])
      );

      const outcomes = await Promise.allSettled([
        ParentMonitoringService.listLinkedChildren(PARENT_ACTOR_ID, LOCALE_EN, tx),
        ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx),
      ]);
      expect(outcomes[0]?.status).toBe("fulfilled");
      expect(outcomes[1]?.status).toBe("rejected");
      if (outcomes[1]?.status === "rejected") {
        expect(outcomes[1].reason).toBeInstanceOf(ForbiddenError);
      }
    });
  });
});

// ─── Tier 4 — security: denial oracle + BOLA + gate-before-read ─────────────

describe("ParentMonitoringService — Tier 4 (denial oracle across all per-student methods)", () => {
  /** The five per-student methods that funnel through `requireLinkedChild`. */
  const PER_STUDENT_METHODS: ReadonlyArray<{
    readonly name: string;
    readonly call: (parentActorId: number, studentId: number, locale: string, tx: DBTransaction) => Promise<unknown>;
  }> = [
    {
      name: "getChildProgress",
      call: (parentActorId, studentId, locale, tx) =>
        ParentMonitoringService.getChildProgress(parentActorId, studentId, locale, tx),
    },
    {
      name: "listChildSessions",
      call: (parentActorId, studentId, locale, tx) =>
        ParentMonitoringService.listChildSessions(parentActorId, studentId, undefined, locale, tx),
    },
    {
      name: "listChildReports",
      call: (parentActorId, studentId, locale, tx) =>
        ParentMonitoringService.listChildReports(parentActorId, studentId, undefined, locale, tx),
    },
    {
      name: "listChildHomework",
      call: (parentActorId, studentId, locale, tx) =>
        ParentMonitoringService.listChildHomework(parentActorId, studentId, undefined, locale, tx),
    },
  ];

  /** The five denial causes — each is set up via repo spies. */
  type CauseId = "malformed" | "missing" | "foreign" | "never-linked" | "severed";

  const CAUSES: CauseId[] = ["malformed", "missing", "foreign", "never-linked", "severed"];

  function causeStudentId(causeId: CauseId): number {
    switch (causeId) {
      case "malformed":
        return -1;
      case "missing":
        return 9999;
      case "foreign":
      case "severed":
        return CHILD_STUDENT_ID;
      case "never-linked":
        return 31;
      default: {
        throw new Error(`Unhandled cause: ${String(causeId)}`);
      }
    }
  }

  function setupCause(causeId: CauseId) {
    if (causeId === "malformed") {
      return;
    }
    if (causeId === "missing") {
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(null));
      return;
    }
    if (causeId === "foreign") {
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...childStudent, parentId: 99 }));
      return;
    }
    if (causeId === "never-linked") {
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...childStudent, id: 31, parentId: null }));
      return;
    }
    // severed: link valid, child user soft-deleted
    trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(childStudent));
    trackSpy(
      spyOn(UserRepository, "findById").mockImplementation(async id =>
        id === PARENT_ACTOR_ID ? parentUser : { ...childUser, isDeleted: true }
      )
    );
  }

  for (const method of PER_STUDENT_METHODS) {
    for (const causeId of CAUSES) {
      test(`${method.name} denies cause '${causeId}' with the constant ForbiddenError + en copy`, async () => {
        await runInRollback(async tx => {
          silenceDomainLog();
          mockActorAndGateSuccess();
          setupCause(causeId);

          let caught: unknown = null;
          try {
            await method.call(PARENT_ACTOR_ID, causeStudentId(causeId), LOCALE_EN, tx);
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

      test(`${method.name} denies cause '${causeId}' with the constant ForbiddenError + ar copy under ar locale`, async () => {
        await runInRollback(async tx => {
          silenceDomainLog();
          mockActorAndGateSuccess();
          setupCause(causeId);

          let caught: unknown = null;
          try {
            await method.call(PARENT_ACTOR_ID, causeStudentId(causeId), LOCALE_AR, tx);
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(ForbiddenError);
          if (caught instanceof ForbiddenError) {
            expect(caught.code).toBe("FORBIDDEN");
            expect(caught.message).toBe(arErrors.forbidden);
          }
        });
      });
    }
  }

  test("oracle uniformity: every (method × cause) cell produces the same denial fingerprint under en", async () => {
    const fingerprints: string[] = [];
    // Serial, deliberately NOT Promise.all: the per-cause repo spies target
    // shared module singletons, so parallel cells overwrite each other's mocks
    // mid-flight and a cell can slip past the denial oracle (CI flake: 19/20
    // fingerprints). The cells chain through reduce()/then() — awaited
    // sequentially without an await inside a loop statement.
    const cells: ReadonlyArray<() => Promise<void>> = PER_STUDENT_METHODS.flatMap(method =>
      CAUSES.map(causeId => async () => {
        await runInRollback(async tx => {
          silenceDomainLog();
          mockActorAndGateSuccess();
          setupCause(causeId);
          try {
            await method.call(PARENT_ACTOR_ID, causeStudentId(causeId), LOCALE_EN, tx);
            throw new Error(
              `oracle breach: ${method.name} did NOT deny cause '${causeId}' — expected the constant ForbiddenError`
            );
          } catch (err) {
            if (!(err instanceof ForbiddenError)) {
              throw err;
            }
            fingerprints.push(JSON.stringify({ code: err.code, message: err.message }));
          }
        });
      })
    );
    await cells.reduce<Promise<void>>((chain, cell) => chain.then(cell), Promise.resolve());
    expect(fingerprints).toHaveLength(PER_STUDENT_METHODS.length * CAUSES.length);
    expect(new Set(fingerprints).size).toBe(1);
    expect(fingerprints[0]).toBe(JSON.stringify({ code: "FORBIDDEN", message: enErrors.forbidden }));
  });

  test("every per-student method emits exactly ONE bounded logDomainError per denial (no child fields in the context bag)", async () => {
    await runInRollback(async tx => {
      const logSpy = silenceDomainLog();
      mockActorAndGateSuccess();
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...childStudent, parentId: 99 }));

      let caught: unknown = null;
      try {
        await ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx);
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
        expect(context.entityId).toBe(CHILD_STUDENT_ID);
      }
    });
  });
});

// ─── Tier 4 — BOLA: non-parent actor id rejection ───────────────────────────

describe("ParentMonitoringService — Tier 4 (BOLA: non-parent actor rejection)", () => {
  /**
   * Verifies that the actor re-check (`requireActor(..., UserRole.Parent,
   * ..., false)`) rejects a non-parent actor with `ForbiddenError` BEFORE
   * any per-student transaction opens. The actor re-check runs first in
   * every method — `withTransaction` is never reached.
   */

  function mockNonParentActor() {
    trackSpy(
      spyOn(UserRepository, "findById").mockResolvedValue({
        ...parentUser,
        role: "admin" as UserSelectType["role"],
      })
    );
  }

  test("listLinkedChildren rejects a non-parent actor with ForbiddenError (en copy)", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      mockNonParentActor();
      const listSpy = trackSpy(spyOn(StudentRepository, "listLinkedChildrenByParentId"));

      let caught: unknown = null;
      try {
        await ParentMonitoringService.listLinkedChildren(PARENT_ACTOR_ID, LOCALE_EN, tx);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      if (caught instanceof ForbiddenError) {
        expect(caught.code).toBe("FORBIDDEN");
        expect(caught.message).toBe(enErrors.forbidden);
      }
      // Gate-before-read: the list repo call never fires.
      expect(listSpy).not.toHaveBeenCalled();
    });
  });

  test("getChildProgress rejects a non-parent actor with ForbiddenError (ar copy)", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      mockNonParentActor();
      const progressSpy = trackSpy(spyOn(ProgressRepository, "countForStudent"));

      let caught: unknown = null;
      try {
        await ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_AR, tx);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      if (caught instanceof ForbiddenError) {
        expect(caught.message).toBe(arErrors.forbidden);
      }
      expect(progressSpy).not.toHaveBeenCalled();
    });
  });

  test("listChildSessions rejects a non-parent actor before any session repo call", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      mockNonParentActor();
      const listSpy = trackSpy(spyOn(SessionRepository, "listForStudent"));
      const countSpy = trackSpy(spyOn(SessionRepository, "countForStudent"));

      let caught: unknown = null;
      try {
        await ParentMonitoringService.listChildSessions(PARENT_ACTOR_ID, CHILD_STUDENT_ID, undefined, LOCALE_EN, tx);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      expect(listSpy).not.toHaveBeenCalled();
      expect(countSpy).not.toHaveBeenCalled();
    });
  });

  test("listChildReports rejects a non-parent actor before any report repo call", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      mockNonParentActor();
      const listSpy = trackSpy(spyOn(ReportRepository, "listForStudent"));
      const countSpy = trackSpy(spyOn(ReportRepository, "countForStudent"));

      let caught: unknown = null;
      try {
        await ParentMonitoringService.listChildReports(PARENT_ACTOR_ID, CHILD_STUDENT_ID, undefined, LOCALE_EN, tx);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      expect(listSpy).not.toHaveBeenCalled();
      expect(countSpy).not.toHaveBeenCalled();
    });
  });

  test("listChildHomework rejects a non-parent actor before any homework repo call", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      mockNonParentActor();
      const listSpy = trackSpy(spyOn(HomeWorkRepository, "listForStudent"));
      const countSpy = trackSpy(spyOn(HomeWorkRepository, "countForStudent"));

      let caught: unknown = null;
      try {
        await ParentMonitoringService.listChildHomework(PARENT_ACTOR_ID, CHILD_STUDENT_ID, undefined, LOCALE_EN, tx);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      expect(listSpy).not.toHaveBeenCalled();
      expect(countSpy).not.toHaveBeenCalled();
    });
  });
});

// ─── Tier 4 — gate-before-read call ordering ────────────────────────────────

describe("ParentMonitoringService — Tier 4 (gate-before-read call ordering)", () => {
  test("getChildProgress runs requireLinkedChild BEFORE any downstream data read", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      const studentFindSpy = trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(childStudent));
      const progressSpy = trackSpy(spyOn(ProgressRepository, "countForStudent").mockResolvedValue(2));
      const homeworkSpy = trackSpy(spyOn(HomeWorkRepository, "findLatestByStudentId").mockResolvedValue(null));

      await ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx);

      // Student lookup (the gate's first call) fires BEFORE progress / homework.
      expect(studentFindSpy).toHaveBeenCalled();
      const studentCallOrder = studentFindSpy.mock.invocationCallOrder[0];
      const progressCallOrder = progressSpy.mock.invocationCallOrder[0];
      const homeworkCallOrder = homeworkSpy.mock.invocationCallOrder[0];
      expect(studentCallOrder).toBeLessThan(progressCallOrder);
      expect(studentCallOrder).toBeLessThan(homeworkCallOrder);
    });
  });

  test("listChildSessions runs the gate BEFORE listForStudent / countForStudent", async () => {
    await runInRollback(async tx => {
      mockActorAndGateSuccess();
      const studentFindSpy = trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(childStudent));
      const listSpy = trackSpy(spyOn(SessionRepository, "listForStudent").mockResolvedValue([]));
      const countSpy = trackSpy(spyOn(SessionRepository, "countForStudent").mockResolvedValue(0));

      await ParentMonitoringService.listChildSessions(PARENT_ACTOR_ID, CHILD_STUDENT_ID, undefined, LOCALE_EN, tx);

      const studentCallOrder = studentFindSpy.mock.invocationCallOrder[0];
      expect(studentCallOrder).toBeLessThan(listSpy.mock.invocationCallOrder[0]);
      expect(studentCallOrder).toBeLessThan(countSpy.mock.invocationCallOrder[0]);
    });
  });

  test("denial arm: requireLinkedChild throws BEFORE any per-student data read fires", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      mockActorAndGateSuccess();
      // Foreign parent — gate denies on the student row mismatch.
      trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...childStudent, parentId: 999 }));
      const progressSpy = trackSpy(spyOn(ProgressRepository, "countForStudent"));
      const homeworkSpy = trackSpy(spyOn(HomeWorkRepository, "findLatestByStudentId"));

      let caught: unknown = null;
      try {
        await ParentMonitoringService.getChildProgress(PARENT_ACTOR_ID, CHILD_STUDENT_ID, LOCALE_EN, tx);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      expect(progressSpy).not.toHaveBeenCalled();
      expect(homeworkSpy).not.toHaveBeenCalled();
    });
  });
});

// ─── Direct requireActor coverage (token-role denial) ──────────────────────

describe("ParentMonitoringService — requireActor token-role denial (BFLA defense-in-depth)", () => {
  test("requireActor rejects a teacher-role actor with ForbiddenError + en copy", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      trackSpy(
        spyOn(UserRepository, "findById").mockResolvedValue({
          ...parentUser,
          role: "teacher" as UserSelectType["role"],
        })
      );

      let caught: unknown = null;
      try {
        await requireActor(PARENT_ACTOR_ID, UserRole.Parent, LOCALE_EN, tx, false);
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

  test("requireActor rejects a student-role actor with ForbiddenError + ar copy", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      trackSpy(
        spyOn(UserRepository, "findById").mockResolvedValue({
          ...parentUser,
          role: "student" as UserSelectType["role"],
        })
      );

      let caught: unknown = null;
      try {
        await requireActor(PARENT_ACTOR_ID, UserRole.Parent, LOCALE_AR, tx, false);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      if (caught instanceof ForbiddenError) {
        expect(caught.message).toBe(arErrors.forbidden);
      }
    });
  });

  test("requireActor rejects a SOFT-DELETED parent even on the relaxed read path", async () => {
    await runInRollback(async tx => {
      trackSpy(
        spyOn(UserRepository, "findById").mockResolvedValue({
          ...parentUser,
          // A deleted account has no reads: `isDeleted` is rejected on every
          // path. Only the blocked/suspended arms stay governance-scoped so
          // a governed-but-present parent's self-scoped reads stay visible.
          isDeleted: true,
        })
      );

      let caught: unknown = null;
      try {
        await requireActor(PARENT_ACTOR_ID, UserRole.Parent, LOCALE_EN, tx, false);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenError);
      if (caught instanceof ForbiddenError) {
        expect(caught.message).toBe(enErrors.forbidden);
      }
    });
  });

  test("requireActor allows a BLOCKED parent on the relaxed read path (governance arm disabled)", async () => {
    await runInRollback(async tx => {
      trackSpy(
        spyOn(UserRepository, "findById").mockResolvedValue({
          ...parentUser,
          // The self-scoped-history rationale: blocked/suspended flags are
          // governance-scoped (mutations), so the read path keeps the
          // parent's own lists visible.
          isBlocked: true,
        })
      );

      const actor = await requireActor(PARENT_ACTOR_ID, UserRole.Parent, LOCALE_EN, tx, false);
      expect(actor.id).toBe(PARENT_ACTOR_ID);
    });
  });
});

// ─── getSessionTarget — the session→linked-child deep-link resolution ──────

describe("ParentMonitoringService — getSessionTarget", () => {
  const TARGET_SESSION_ID = 100;

  /** Mocks the session lookup the resolution opens with. */
  function mockSessionRow(row: SessionSelectType | null) {
    return trackSpy(spyOn(SessionRepository, "findById").mockResolvedValue(row));
  }

  // ── Tier 1 — happy path ─────────────────────────────────────────────────

  describe("Tier 1 (happy path)", () => {
    test("resolves the closed id pair naming the LINKED child for the linked parent's session", async () => {
      await runInRollback(async tx => {
        mockActorAndGateSuccess();
        const sessionFindSpy = mockSessionRow(childSession);

        const result = await ParentMonitoringService.getSessionTarget(
          PARENT_ACTOR_ID,
          TARGET_SESSION_ID,
          LOCALE_EN,
          tx
        );

        const expectedKeys = ["sessionId", "studentId"];
        expect(Object.keys(result).toSorted(compareStrings)).toEqual(expectedKeys);
        expect(result.sessionId).toBe(childSession.id);
        expect(result.studentId).toBe(childStudent.id);

        // The session read runs inside the transaction unit with the probed
        // id as its first argument (the executor the savepoint resolves is
        // the unit's own transaction handle — identity differs from the
        // outer rollback wrapper, propagation itself is what's pinned).
        expect(sessionFindSpy).toHaveBeenCalledTimes(1);
        expect(sessionFindSpy.mock.calls[0]?.[0]).toBe(TARGET_SESSION_ID);
        expect(sessionFindSpy.mock.calls[0]?.[1]).toBeDefined();
      });
    });
  });

  // ── Tier 2 — boundary sessionId arms ────────────────────────────────────

  describe("Tier 2 (boundary sessionId arms)", () => {
    test.each([0, -1, 1.5, Number.NaN])(
      "rejects the non-positive or non-integer sessionId %p with ValidationError before any gate or read",
      async badId => {
        await runInRollback(async tx => {
          silenceDomainLog();
          const sessionFindSpy = mockSessionRow(childSession);

          let caught: unknown = null;
          try {
            await ParentMonitoringService.getSessionTarget(PARENT_ACTOR_ID, badId, LOCALE_EN, tx);
          } catch (err) {
            caught = err;
          }
          expect(caught).toBeInstanceOf(ValidationError);
          if (caught instanceof ValidationError) {
            expect(caught.code).toBe("VALIDATION");
            expect(caught.message).toBe(enErrors.validation);
          }
          // Fail-closed ordering: the session read (and everything behind
          // it) never fires for a malformed pointer.
          expect(sessionFindSpy).not.toHaveBeenCalled();
        });
      }
    );

    test("collapses an Int32-overflow sessionId (2^31) to the constant nonexistent-session denial", async () => {
      await runInRollback(async tx => {
        silenceDomainLog();
        mockActorAndGateSuccess();
        mockSessionRow(null);

        let caught: unknown = null;
        try {
          await ParentMonitoringService.getSessionTarget(PARENT_ACTOR_ID, 2 ** 31, LOCALE_EN, tx);
        } catch (err) {
          caught = err;
        }
        // A 2^31 id passes the safe-integer guard (the Int32 bound is the
        // wire layer's concern) and lands on the SAME constant denial a
        // normal missing id produces.
        expect(caught).toBeInstanceOf(ForbiddenError);
        if (caught instanceof ForbiddenError) {
          expect(caught.code).toBe("FORBIDDEN");
          expect(caught.message).toBe(enErrors.forbidden);
        }
      });
    });
  });

  // ── Tier 4 — denial oracle + gate ordering + rate-limit passthrough ────

  describe("Tier 4 (denial oracle, gate ordering, rate-limit passthrough)", () => {
    test("denies a missing session with the constant ForbiddenError + en copy and exactly ONE bounded log", async () => {
      await runInRollback(async tx => {
        const logSpy = silenceDomainLog();
        mockActorAndGateSuccess();
        mockSessionRow(null);

        let caught: unknown = null;
        try {
          await ParentMonitoringService.getSessionTarget(PARENT_ACTOR_ID, TARGET_SESSION_ID, LOCALE_EN, tx);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ForbiddenError);
        if (caught instanceof ForbiddenError) {
          expect(caught.code).toBe("FORBIDDEN");
          expect(caught.message).toBe(enErrors.forbidden);
        }

        // ONE bounded log per denial — the context bag carries the probed
        // id and NOTHING else (never a session row field).
        expect(logSpy).toHaveBeenCalledTimes(1);
        const context = logSpy.mock.calls[0]?.[1];
        expect(context).toBeDefined();
        if (context !== undefined) {
          const contextKeys = Object.keys(context).toSorted(compareStrings);
          expect(contextKeys).toEqual(["code", "entity", "entityId", "locale"]);
          expect(context.code).toBe("FORBIDDEN");
          expect(context.entity).toBe("sessions");
          expect(context.entityId).toBe(TARGET_SESSION_ID);
          expect(context.locale).toBe(LOCALE_EN);
        }
      });
    });

    test("denies a missing session with the ar copy under ar locale", async () => {
      await runInRollback(async tx => {
        silenceDomainLog();
        mockActorAndGateSuccess();
        mockSessionRow(null);

        let caught: unknown = null;
        try {
          await ParentMonitoringService.getSessionTarget(PARENT_ACTOR_ID, TARGET_SESSION_ID, LOCALE_AR, tx);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ForbiddenError);
        if (caught instanceof ForbiddenError) {
          expect(caught.message).toBe(arErrors.forbidden);
        }
      });
    });

    test("denies a foreign session (unlinked child) with the constant ForbiddenError + en copy", async () => {
      await runInRollback(async tx => {
        silenceDomainLog();
        mockActorAndGateSuccess();
        mockSessionRow(childSession);
        trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...childStudent, parentId: 99 }));

        let caught: unknown = null;
        try {
          await ParentMonitoringService.getSessionTarget(PARENT_ACTOR_ID, TARGET_SESSION_ID, LOCALE_EN, tx);
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

    test("oracle uniformity: nonexistent ≡ foreign denial copy byte-identical per locale (en AND ar)", async () => {
      const fingerprints: string[] = [];
      const cells: ReadonlyArray<{ locale: string; cause: "nonexistent" | "foreign" }> = [
        { locale: LOCALE_EN, cause: "nonexistent" },
        { locale: LOCALE_EN, cause: "foreign" },
        { locale: LOCALE_AR, cause: "nonexistent" },
        { locale: LOCALE_AR, cause: "foreign" },
      ];
      await runSequentially(
        cells.map(cell => async () => {
          await runInRollback(async tx => {
            silenceDomainLog();
            mockActorAndGateSuccess();
            if (cell.cause === "nonexistent") {
              mockSessionRow(null);
            } else {
              mockSessionRow(childSession);
              trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue({ ...childStudent, parentId: 99 }));
            }
            try {
              await ParentMonitoringService.getSessionTarget(PARENT_ACTOR_ID, TARGET_SESSION_ID, cell.locale, tx);
              throw new Error(
                `oracle breach: ${cell.cause} session did NOT deny — expected the constant ForbiddenError`
              );
            } catch (err) {
              if (!(err instanceof ForbiddenError)) {
                throw err;
              }
              fingerprints.push(JSON.stringify({ locale: cell.locale, code: err.code, message: err.message }));
            }
          });
        })
      );
      expect(fingerprints).toHaveLength(4);
      // Per-locale byte-identity: within a locale the two causes are
      // indistinguishable; the two locales differ only by the localized
      // copy itself.
      expect(new Set(fingerprints)).toEqual(
        new Set([
          JSON.stringify({ locale: LOCALE_EN, code: "FORBIDDEN", message: enErrors.forbidden }),
          JSON.stringify({ locale: LOCALE_AR, code: "FORBIDDEN", message: arErrors.forbidden }),
        ])
      );
    });

    test("resolves the session read BEFORE the linked-child gate fires", async () => {
      await runInRollback(async tx => {
        mockActorAndGateSuccess();
        const sessionFindSpy = mockSessionRow(childSession);
        const studentFindSpy = trackSpy(spyOn(StudentRepository, "findById").mockResolvedValue(childStudent));

        await ParentMonitoringService.getSessionTarget(PARENT_ACTOR_ID, TARGET_SESSION_ID, LOCALE_EN, tx);

        // The gate verifies the child the SESSION names — the row read
        // must come first.
        expect(sessionFindSpy.mock.invocationCallOrder[0]).toBeLessThan(studentFindSpy.mock.invocationCallOrder[0]);
      });
    });

    test("passes the portal rate limit through: the limiter trips as RateLimitExceededError before the transaction opens", async () => {
      await runInRollback(async tx => {
        const logSpy = silenceDomainLog();
        const limiterParentId = PARENT_ACTOR_ID + 777;
        trackSpy(
          spyOn(UserRepository, "findById").mockImplementation(async id =>
            id === limiterParentId ? { ...parentUser, id: limiterParentId } : null
          )
        );
        // The pass-through denials (calls 1..30) deny at the session read,
        // so the lookup is mocked at the persistence seam — the constant
        // missing-session oracle keeps the limiter arm deterministic
        // without a live row read.
        mockSessionRow(null);

        // The test-env bypass keeps the limiter inert everywhere else in
        // this suite; this test alone disables it so the REAL limiter arm
        // (portalReadLimiter, limit 30) is exercised through the service.
        const prevTestServer = process.env.TEST_SERVER;
        const prevTestCi = process.env.TEST_CI;
        delete process.env.TEST_SERVER;
        delete process.env.TEST_CI;

        const caught: unknown[] = [];
        const probes = 31;
        try {
          await runSequentially(
            Array.from({ length: probes }, () => async () => {
              try {
                await ParentMonitoringService.getSessionTarget(limiterParentId, TARGET_SESSION_ID, LOCALE_EN, tx);
                caught.push(null);
              } catch (err) {
                caught.push(err);
              }
            })
          );
        } finally {
          if (prevTestServer === undefined) {
            delete process.env.TEST_SERVER;
          } else {
            process.env.TEST_SERVER = prevTestServer;
          }
          if (prevTestCi === undefined) {
            delete process.env.TEST_CI;
          } else {
            process.env.TEST_CI = prevTestCi;
          }
        }

        // Calls 1..30 pass the limiter and deny at the (empty) session
        // read; call 31 trips the limiter BEFORE the session read opens.
        expect(caught).toHaveLength(probes);
        const forbiddenCount = caught.filter(err => err instanceof ForbiddenError).length;
        expect(forbiddenCount).toBe(portalReadLimiter.limit);
        const last = caught.at(-1);
        expect(last).toBeInstanceOf(RateLimitExceededError);
        if (last instanceof RateLimitExceededError) {
          expect(last.message).toBe(enErrors.rateLimitExceeded);
        }
        // The denial logs above are the 30 ForbiddenError denials only —
        // the limiter trip logs nothing domain-bounded here.
        expect(logSpy).toHaveBeenCalledTimes(portalReadLimiter.limit);
      });
    });
  });
});
