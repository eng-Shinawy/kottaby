/**
 * Unit tests for `parent-link-request.helpers.ts`.
 *
 * Tests all exported constants, type guards, mappers, and orchestration helpers:
 *  - Constants (`PARENT_LINK_REQUEST_ENTITY`, `PARENT_LINK_RELATED_ENTITY_TYPE`)
 *  - Type guards & Guards (`isDeliveryReceipt`, `toCanonicalLinkStatus`)
 *  - Mappers (`mapOutgoing`, `mapIncoming`)
 *  - `requireActor` gate
 *  - `insertPendingRequestTx` helper
 *  - `emitRequestNotificationTx` helper
 *  - `classifyUnclaimableRequest` helper
 *  - `raiseUnclaimableDenial` helper
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  type IncomingParentLinkRequestRow,
  type OutgoingParentLinkRequestRow,
  ParentLinkRequestRepository,
  StudentRepository,
  UserRepository,
} from "@/backend/db/repo";
import { runInRollback } from "@/backend/db/test/test-utils";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import {
  classifyUnclaimableRequest,
  emitRequestNotificationTx,
  insertPendingRequestTx,
  isDeliveryReceipt,
  mapIncoming,
  mapOutgoing,
  PARENT_LINK_DECISION_RELATED_ENTITY_TYPE,
  PARENT_LINK_EXPIRY_RELATED_ENTITY_TYPE,
  PARENT_LINK_RELATED_ENTITY_TYPE,
  PARENT_LINK_REQUEST_ENTITY,
  raiseUnclaimableDenial,
  requireActor,
  toCanonicalLinkStatus,
} from "@/backend/services/parents/parent-link-request.helpers";
import type {
  NotificationDeliveryReceipt,
  NotificationReturnType,
  ParentLinkRequestSelectType,
  UserSelectType,
} from "@/backend/types";
import { PARENT_LINK_REQUEST_MS } from "@/shared/constants/parent-link-request.constants";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

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

describe("parent-link-request.helpers — Constants", () => {
  test("PARENT_LINK_REQUEST_ENTITY and PARENT_LINK_RELATED_ENTITY_TYPE have expected values", () => {
    expect(PARENT_LINK_REQUEST_ENTITY).toBe("PARENT_LINK_REQUEST");
    expect(PARENT_LINK_RELATED_ENTITY_TYPE).toBe("parent_link_request");
  });

  test("audience-scoped related-entity-type refinements have expected values (issue #99)", () => {
    // The parent-audience wire values the frontend route map deliberately
    // misses — both MUST stay prefixed by the student value's family so the
    // fall-through route stays the notifications feed.
    expect(PARENT_LINK_DECISION_RELATED_ENTITY_TYPE).toBe("parent_link_request_decision");
    expect(PARENT_LINK_EXPIRY_RELATED_ENTITY_TYPE).toBe("parent_link_request_expiry");
    expect(PARENT_LINK_DECISION_RELATED_ENTITY_TYPE.startsWith(PARENT_LINK_RELATED_ENTITY_TYPE)).toBe(true);
    expect(PARENT_LINK_EXPIRY_RELATED_ENTITY_TYPE.startsWith(PARENT_LINK_RELATED_ENTITY_TYPE)).toBe(true);
  });
});

describe("parent-link-request.helpers — isDeliveryReceipt", () => {
  test("returns true when value is a NotificationDeliveryReceipt", () => {
    const receipt: NotificationDeliveryReceipt = {
      notifications: [],
      recipientUserIds: [1, 2],
    };
    expect(isDeliveryReceipt(receipt)).toBe(true);
  });

  test("returns false when value is a NotificationReturnType", () => {
    const notificationRow: NotificationReturnType = {
      id: 10,
      userId: 1,
      type: NotificationType.ParentLinkRequest,
      title: "Title",
      body: "Body",
      isRead: false,
      relatedEntityType: PARENT_LINK_RELATED_ENTITY_TYPE,
      relatedEntityId: 10,
      createdAt: new Date(),
    };
    expect(isDeliveryReceipt(notificationRow)).toBe(false);
  });
});

describe("parent-link-request.helpers — toCanonicalLinkStatus", () => {
  test("returns valid LinkStatus enum value unchanged", () => {
    expect(toCanonicalLinkStatus(LinkStatus.Pending, 1)).toBe(LinkStatus.Pending);
    expect(toCanonicalLinkStatus(LinkStatus.Confirmed, 2)).toBe(LinkStatus.Confirmed);
    expect(toCanonicalLinkStatus(LinkStatus.Rejected, 3)).toBe(LinkStatus.Rejected);
    expect(toCanonicalLinkStatus(LinkStatus.Expired, 4)).toBe(LinkStatus.Expired);
  });

  test("throws error and logs domain error when status is corrupt/invalid", () => {
    const logSpy = silenceDomainLog();

    // @ts-expect-error - testing runtime fail-closed handling of invalid corrupt status
    expect(() => toCanonicalLinkStatus("INVALID_STATUS", 99)).toThrow(
      "ParentLinkRequestService: corrupt link_status value on request 99"
    );
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]).toEqual([
      "Parent-link read rejected: stored link status failed the enum guard",
      expect.objectContaining({
        code: "PARENT_LINK_REQUEST_STATUS_CORRUPT",
        entity: "parent_link_requests",
        entityId: 99,
      }),
    ]);
  });
});

describe("parent-link-request.helpers — mapOutgoing and mapIncoming", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const futureExpires = new Date("2026-03-01T13:00:00.000Z");
  const pastExpires = new Date("2026-03-01T11:00:00.000Z");
  const createdAt = new Date("2026-03-01T10:00:00.000Z");

  const outgoingRow: OutgoingParentLinkRequestRow = {
    id: 1,
    parentId: 10,
    studentId: 20,
    status: LinkStatus.Pending,
    studentFullName: "Jane Doe",
    createdAt,
    expiresAt: futureExpires,
    respondedAt: null,
  };

  test("mapOutgoing masks student full name and preserves unexpired pending status", () => {
    const mapped = mapOutgoing(outgoingRow, now);

    expect(mapped.id).toBe(1);
    expect(mapped.status).toBe(LinkStatus.Pending);
    expect(mapped.studentMaskedName).not.toBe("Jane Doe");
    expect(mapped.createdAt).toEqual(createdAt);
    expect(mapped.expiresAt).toEqual(futureExpires);
    expect(mapped.respondedAt).toBeNull();
  });

  test("mapOutgoing maps pending status to Expired if expiresAt <= now", () => {
    const mapped = mapOutgoing({ ...outgoingRow, id: 2, expiresAt: pastExpires }, now);

    expect(mapped.status).toBe(LinkStatus.Expired);
  });

  const incomingRow: IncomingParentLinkRequestRow = {
    id: 3,
    parentId: 10,
    studentId: 20,
    status: LinkStatus.Pending,
    parentFullName: "John Doe",
    createdAt,
    expiresAt: futureExpires,
    respondedAt: null,
  };

  test("mapIncoming preserves parent full name unmasked and maps expired when expired", () => {
    const unexpired = mapIncoming(incomingRow, now);

    expect(unexpired.id).toBe(3);
    expect(unexpired.status).toBe(LinkStatus.Pending);
    expect(unexpired.parentFullName).toBe("John Doe");

    const expired = mapIncoming({ ...incomingRow, id: 4, expiresAt: pastExpires }, now);

    expect(expired.status).toBe(LinkStatus.Expired);
  });
});

describe("parent-link-request.helpers — requireActor", () => {
  const baseUser: UserSelectType = {
    id: 10,
    fullName: "Parent User",
    email: "parent@test.local",
    phone: "+1234567890",
    passwordHash: "hash",
    mustChangePassword: false,
    role: "parent",
    isDeleted: false,
    isBlocked: false,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
    lastActiveAt: new Date(),
    country: null,
    countryCode: null,
    dateOfBirth: null,
    gender: null,
    blockedAt: null,
    deletedAt: null,
    locale: "en",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test("succeeds when actor exists, matches role, and passes governance checks", async () => {
    await runInRollback(async tx => {
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(baseUser));

      const actor = await requireActor(10, UserRole.Parent, LOCALE, tx, true);
      expect(actor.id).toBe(10);
    });
  });

  test("rejects non-positive / non-safe-integer actorId with UnauthorizedError", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();

      try {
        await requireActor(0, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedError);
      }

      try {
        await requireActor(-5, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedError);
      }

      try {
        await requireActor(Number.NaN, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedError);
      }
    });
  });

  test("rejects missing actor with UnauthorizedError", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(null));

      try {
        await requireActor(999, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedError);
      }
    });
  });

  test("rejects role mismatch with ForbiddenError", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue({ ...baseUser, role: "student" }));

      try {
        await requireActor(10, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });
  });

  test("rejects governed actor when enforceGovernance is true", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();

      // Deleted
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue({ ...baseUser, isDeleted: true }));
      try {
        await requireActor(10, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }

      // Blocked
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue({ ...baseUser, isBlocked: true }));
      try {
        await requireActor(10, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }

      // Suspended
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue({ ...baseUser, suspended: true }));
      try {
        await requireActor(10, UserRole.Parent, LOCALE, tx, true);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });
  });

  test("rejects a SOFT-DELETED actor even when enforceGovernance is false", async () => {
    await runInRollback(async tx => {
      // A deleted account has no reads: `isDeleted` is rejected on every
      // path, governance arm or not.
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue({ ...baseUser, isDeleted: true }));

      try {
        await requireActor(10, UserRole.Parent, LOCALE, tx, false);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
      }
    });
  });

  test("allows a BLOCKED actor when enforceGovernance is false (governance arm scoped to mutations)", async () => {
    await runInRollback(async tx => {
      // The self-scoped-history rationale: blocked/suspended flags are
      // governance-scoped, so the relaxed read path keeps the actor's own
      // lists visible.
      trackSpy(spyOn(UserRepository, "findById").mockResolvedValue({ ...baseUser, isBlocked: true }));

      const actor = await requireActor(10, UserRole.Parent, LOCALE, tx, false);
      expect(actor.id).toBe(10);
    });
  });
});

describe("parent-link-request.helpers — insertPendingRequestTx", () => {
  const targetStudent = {
    studentId: 20,
    fullName: "Student Name",
    parentId: null as number | null,
    isDeleted: false,
    isBlocked: false,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
  };

  test("returns null when handshake code target is null", async () => {
    await runInRollback(async tx => {
      trackSpy(spyOn(StudentRepository, "findLinkTargetByHandshakeCode").mockResolvedValue(null));

      const result = await insertPendingRequestTx("INVALID_CODE", 10, LOCALE, tx);
      expect(result).toBeNull();
    });
  });

  test("throws PARENT_LINK_TARGET_ALREADY_LINKED if target student already has a parentId", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      trackSpy(
        spyOn(StudentRepository, "findLinkTargetByHandshakeCode").mockResolvedValue({
          ...targetStudent,
          parentId: 99,
        })
      );

      try {
        await insertPendingRequestTx("VALID_CODE", 10, LOCALE, tx);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        if (err instanceof ConflictError) {
          expect(err.code).toBe("PARENT_LINK_TARGET_ALREADY_LINKED");
          expect(err.message).toContain(tErrors.parentLinkTargetAlreadyLinked);
        }
      }
    });
  });

  test("throws PARENT_LINK_ALREADY_PENDING if a live pending request exists", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      trackSpy(spyOn(StudentRepository, "findLinkTargetByHandshakeCode").mockResolvedValue(targetStudent));
      trackSpy(
        spyOn(ParentLinkRequestRepository, "findPendingByPair").mockResolvedValue({
          id: 50,
          parentId: 10,
          studentId: 20,
          status: LinkStatus.Pending,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS),
          respondedAt: null,
          reminderSentAt: null,
        })
      );

      try {
        await insertPendingRequestTx("VALID_CODE", 10, LOCALE, tx);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        if (err instanceof ConflictError) {
          expect(err.code).toBe("PARENT_LINK_ALREADY_PENDING");
          expect(err.message).toContain(tErrors.parentLinkAlreadyPending);
        }
      }
    });
  });

  test("creates pending request when target is unlinked and no pending request exists", async () => {
    await runInRollback(async tx => {
      trackSpy(spyOn(StudentRepository, "findLinkTargetByHandshakeCode").mockResolvedValue(targetStudent));
      trackSpy(spyOn(ParentLinkRequestRepository, "findPendingByPair").mockResolvedValue(null));

      const createdRecord: ParentLinkRequestSelectType = {
        id: 100,
        parentId: 10,
        studentId: 20,
        status: LinkStatus.Pending,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS),
        respondedAt: null,
        reminderSentAt: null,
      };
      trackSpy(spyOn(ParentLinkRequestRepository, "create").mockResolvedValue(createdRecord));

      const outcome = await insertPendingRequestTx("VALID_CODE", 10, LOCALE, tx);
      expect(outcome).not.toBeNull();
      expect(outcome?.created.id).toBe(100);
      expect(outcome?.studentId).toBe(20);
      expect(outcome?.targetFullName).toBe("Student Name");
    });
  });

  test("handles 23505 unique violation on insert race and throws PARENT_LINK_ALREADY_PENDING", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      trackSpy(spyOn(StudentRepository, "findLinkTargetByHandshakeCode").mockResolvedValue(targetStudent));
      trackSpy(spyOn(ParentLinkRequestRepository, "findPendingByPair").mockResolvedValue(null));

      const uniqueViolationError = new Error("duplicate key value violates unique constraint") as Error & {
        code?: string;
      };
      uniqueViolationError.code = "23505";
      trackSpy(spyOn(ParentLinkRequestRepository, "create").mockRejectedValue(uniqueViolationError));

      try {
        await insertPendingRequestTx("VALID_CODE", 10, LOCALE, tx);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        if (err instanceof ConflictError) {
          expect(err.code).toBe("PARENT_LINK_ALREADY_PENDING");
        }
      }
    });
  });
});

describe("parent-link-request.helpers — emitRequestNotificationTx", () => {
  test("emits notification for target student and returns receipt and resolved locale", async () => {
    await runInRollback(async tx => {
      const localeMap = new Map<number, AppLocale>([[20, "en"]]);
      trackSpy(spyOn(UserRepository, "findLocalesByIds").mockResolvedValue(localeMap));

      const receipt: NotificationDeliveryReceipt = {
        notifications: [],
        recipientUserIds: [20],
      };
      trackSpy(spyOn(NotificationEngine, "emitForUser").mockResolvedValue(receipt));

      const outcome = await emitRequestNotificationTx(20, 100, "Parent Name", tx);
      expect(outcome.recipientLocale).toBe("en");
      expect(outcome.receipt).toEqual(receipt);
    });
  });

  test("throws Error if emitForUser returns row instead of receipt", async () => {
    await runInRollback(async tx => {
      const localeMap = new Map<number, AppLocale>();
      trackSpy(spyOn(UserRepository, "findLocalesByIds").mockResolvedValue(localeMap));

      const notificationRow: NotificationReturnType = {
        id: 55,
        userId: 20,
        type: NotificationType.ParentLinkRequest,
        title: "Title",
        body: "Body",
        isRead: false,
        relatedEntityType: PARENT_LINK_RELATED_ENTITY_TYPE,
        relatedEntityId: 100,
        createdAt: new Date(),
      };
      trackSpy(spyOn(NotificationEngine, "emitForUser").mockResolvedValue(notificationRow));

      try {
        await emitRequestNotificationTx(20, 100, "Parent Name", tx);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        if (err instanceof Error) {
          expect(err.message).toContain("in-tx emit returned a row instead of the receipt");
        }
      }
    });
  });
});

describe("parent-link-request.helpers — classifyUnclaimableRequest and raiseUnclaimableDenial", () => {
  test("classifyUnclaimableRequest classifies nonexistent or unowned request as not-found", async () => {
    await runInRollback(async tx => {
      trackSpy(spyOn(ParentLinkRequestRepository, "findById").mockResolvedValue(null));

      const verdict = await classifyUnclaimableRequest(100, 10, "parent", tx);
      expect(verdict).toBe("not-found");
    });
  });

  test("classifyUnclaimableRequest classifies non-pending status as already-resolved", async () => {
    await runInRollback(async tx => {
      trackSpy(
        spyOn(ParentLinkRequestRepository, "findById").mockResolvedValue({
          id: 100,
          parentId: 10,
          studentId: 20,
          status: LinkStatus.Confirmed,
          createdAt: new Date(),
          expiresAt: new Date(),
          respondedAt: new Date(),
          reminderSentAt: null,
        })
      );

      const verdict = await classifyUnclaimableRequest(100, 10, "parent", tx);
      expect(verdict).toBe("already-resolved");
    });
  });

  test("classifyUnclaimableRequest classifies pending request as expired when unclaimable", async () => {
    await runInRollback(async tx => {
      trackSpy(
        spyOn(ParentLinkRequestRepository, "findById").mockResolvedValue({
          id: 100,
          parentId: 10,
          studentId: 20,
          status: LinkStatus.Pending,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() - 1000),
          respondedAt: null,
          reminderSentAt: null,
        })
      );

      const verdict = await classifyUnclaimableRequest(100, 10, "parent", tx);
      expect(verdict).toBe("expired");
    });
  });

  test("raiseUnclaimableDenial throws NotFoundError on not-found verdict", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();

      try {
        await raiseUnclaimableDenial(100, "not-found", LOCALE, tx);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError);
        if (err instanceof NotFoundError) {
          expect(err.message).toContain(tErrors.parentLinkRequestNotFound);
        }
      }
    });
  });

  test("raiseUnclaimableDenial throws ConflictError on already-resolved verdict", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();

      try {
        await raiseUnclaimableDenial(100, "already-resolved", LOCALE, tx);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        if (err instanceof ConflictError) {
          expect(err.code).toBe("PARENT_LINK_REQUEST_ALREADY_RESOLVED");
          expect(err.message).toContain(tErrors.parentLinkRequestAlreadyResolved);
        }
      }
    });
  });

  test("raiseUnclaimableDenial marks expired and throws ConflictError on expired verdict", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const markSpy = trackSpy(spyOn(ParentLinkRequestRepository, "markExpiredIfPending").mockResolvedValue());

      try {
        await raiseUnclaimableDenial(100, "expired", LOCALE, tx);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictError);
        if (err instanceof ConflictError) {
          expect(err.code).toBe("PARENT_LINK_REQUEST_EXPIRED");
          expect(err.message).toContain(tErrors.parentLinkRequestExpired);
        }
        expect(markSpy).toHaveBeenCalledTimes(1);
        expect(markSpy.mock.calls[0][0]).toBe(100);
      }
    });
  });
});
