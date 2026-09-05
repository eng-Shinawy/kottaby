/**
 * Journey J1 — Targeted Single-Recipient Delivery (teacher session-request
 * notification).
 *
 * Cross-actor journey through the real notification engine against the real
 * test database: a test-invoked emitter persists one session-request
 * notification for a certified teacher, and only that teacher ever observes
 * or mutates it. Authored TEST-FIRST — the suite is written against the
 * engine's PLANNED API surface and stays RED (module-not-found) until the
 * engine service exists; the contract assumptions it encodes are recorded in
 * the plan's journey outcome document and are binding for the engine's
 * implementers.
 *
 * Journey rules (test/workflows/AGENTS.md) honored:
 * - fixtures COMMITTED in `beforeAll` inside one committing transaction
 *   (commit-or-nothing) and hard-deleted in `afterAll` via `TrackedFixtures`
 *   with post-teardown existence checks (zero residue); never `runInRollback`;
 * - actors provisioned by the actor-context factory — REAL `users` rows plus
 *   REAL role-child rows, so every ownership/denial check resolves through
 *   the genuine path (never monkey-patched permissions);
 * - the fan-out transport is SPIED at the engine's injection seam
 *   (`SpiedFanoutTransport`) — no Redis, no WebSocket frames, ever;
 * - sequential actor-attributed steps in declaration order; every service
 *   call carries the acting user's real id;
 * - cross-actor visibility asserted both ways: the intended recipient sees
 *   the change, everyone else's inbox stays untouched, and the outsider's
 *   mutation probe fails oracle-safely while the owner's row stays
 *   byte-identical.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NotFoundError } from "@/backend/lib/errors";
// RED until the engine service lands (emit + inbox surfaces):
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  NotificationDeliveryReceipt,
  NotificationEmitInput,
  NotificationListFilterInput,
  NotificationReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  type JourneyActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Per-run unique prefix so repeated or parallel runs never collide. */
const runPrefix = `jrn_notifications_${randomUUID().slice(0, 8)}`;

/** Emitted-notification copy (carries the run prefix; title max 255 chars). */
const EMIT_TITLE = `${runPrefix}: New session request`;
const EMIT_BODY = `${runPrefix}: A student requested a recurring session`;

/** Polymorphic entity pointer carried by the emitted notification. */
const RELATED_ENTITY_TYPE = "session";
const RELATED_ENTITY_ID = 4242;

/** Shared inbox window — every teacher/student list read uses the same page. */
const INBOX_PAGE: NotificationListFilterInput = { limit: 20, offset: 0 };

/** English translated error copy — denial assertions pin translated substrings, never hardcoded English. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught === null) {
    throw new Error("expected the call to throw, but it resolved successfully");
  }
  if (errorCaught instanceof Error) {
    return errorCaught;
  }
  return new Error(`[non-Error throw: ${typeof errorCaught}]`);
}

/**
 * Narrows the emit result to the single persisted row: `emitForUser` may
 * return the created row directly (own-commit path) or a delivery receipt
 * (caller-transaction path) — both carry the same row, and the journey
 * accepts either shape.
 */
function singleEmittedRow(result: NotificationReturnType | NotificationDeliveryReceipt): NotificationReturnType {
  if ("notifications" in result) {
    const first = result.notifications.at(0);
    if (!first) {
      throw new Error("emitForUser returned a delivery receipt with zero notifications");
    }
    return first;
  }
  return result;
}

/** Direct repo-less inbox row count for one recipient. */
async function inboxRowCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

describe("J1 — Targeted single-recipient delivery (teacher session request)", () => {
  const tracked = new TrackedFixtures();
  const transportSpy = new SpiedFanoutTransport();

  let teacher: JourneyActor;
  let student: JourneyActor;
  let parentOutsider: JourneyActor;
  let emittedRow: NotificationReturnType;
  let firstMarkedRow: NotificationReturnType;

  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      teacher = await provisionCertifiedTeacherActor(tx, { tracked });
      student = await provisionStudentActor(tx, { tracked });
      parentOutsider = await provisionParentActor(tx, { tracked });
    });
  });

  afterAll(async () => {
    // Reverse-registration-order hard delete + zero-residue existence checks
    // (a leaking afterAll fails the suite).
    await tracked.cleanup();
  });

  test("step 1 — System: fixtures committed; teacher and student inboxes are empty", async () => {
    // 3 actors × (users row + role-child row), all registered for teardown.
    expect(tracked.size).toBe(6);

    expect(await inboxRowCount(teacher.userId)).toBe(0);
    expect(await inboxRowCount(student.userId)).toBe(0);
    expect(transportSpy.publishCount).toBe(0);
  });

  test("step 2 — Teacher observes: empty inbox page and zero unread", async () => {
    const page = await NotificationEngine.listMyNotifications(teacher.userId, INBOX_PAGE, teacher.locale);

    expect(page.items).toEqual([]);
    expect(page.totalCount).toBe(0);
    expect(page.hasMore).toBe(false);

    const unread = await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale);
    expect(unread).toBe(0);
  });

  test("step 3 — Emitter: emitForUser persists exactly one unread row; transport publishes once, to the teacher only", async () => {
    const emitInput: NotificationEmitInput = {
      userId: teacher.userId,
      type: NotificationType.SessionRequest,
      title: EMIT_TITLE,
      body: EMIT_BODY,
      relatedEntityType: RELATED_ENTITY_TYPE,
      relatedEntityId: RELATED_ENTITY_ID,
    };

    const result = await NotificationEngine.emitForUser(emitInput, teacher.locale, undefined, {
      transport: transportSpy,
    });

    emittedRow = singleEmittedRow(result);
    // Side-effect row joins the tracked teardown set as soon as it is observed.
    tracked.register(notifications, emittedRow.id);

    // Shared state: EXACTLY one row, unread, addressed to the teacher.
    expect(emittedRow.userId).toBe(teacher.userId);
    expect(emittedRow.type).toBe(NotificationType.SessionRequest);
    expect(emittedRow.title).toBe(EMIT_TITLE);
    expect(emittedRow.body).toBe(EMIT_BODY);
    expect(emittedRow.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
    expect(emittedRow.relatedEntityId).toBe(RELATED_ENTITY_ID);
    expect(emittedRow.isRead).toBe(false);
    expect(await inboxRowCount(teacher.userId)).toBe(1);

    // Side effect: ONE publish, addressed ONLY to the teacher, valid payload shape.
    expect(transportSpy.publishCount).toBe(1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to have recorded the emit publish");
    }
    expect(publish.userIds).toEqual([teacher.userId]);
    expect(transportSpy.publishedUserIds).toEqual([teacher.userId]);
    expect(publish.payload.v).toBe(1);
    expect(publish.payload.kind).toBe("notification");
    expect(publish.payload.data.id).toBe(emittedRow.id);
    expect(publish.payload.data.type).toBe(NotificationType.SessionRequest);
    expect(publish.payload.data.title).toBe(EMIT_TITLE);
    expect(publish.payload.data.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
    expect(publish.payload.data.relatedEntityId).toBe(RELATED_ENTITY_ID);
    expect(publish.payload.data.createdAt).toEqual(emittedRow.createdAt);
    // No account identifier rides the payload — the recipient is implied by
    // the authenticated socket the payload travels on.
    expect(Object.hasOwn(publish.payload.data, "userId")).toBe(false);

    // Visibility matrix: no accidental fan-out to the other cast members.
    expect(await inboxRowCount(student.userId)).toBe(0);
    expect(await inboxRowCount(parentOutsider.userId)).toBe(0);
  });

  test("step 4 — Teacher observes: one unread; row content, type and entity ref are correct", async () => {
    const unread = await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale);
    expect(unread).toBe(1);

    const page = await NotificationEngine.listMyNotifications(teacher.userId, INBOX_PAGE, teacher.locale);
    expect(page.totalCount).toBe(1);
    expect(page.hasMore).toBe(false);
    const row = page.items.at(0);
    if (!row) {
      throw new Error("expected the teacher's inbox page to contain the emitted notification");
    }
    expect(row.id).toBe(emittedRow.id);
    expect(row.userId).toBe(teacher.userId);
    expect(row.type).toBe(NotificationType.SessionRequest);
    expect(row.title).toBe(EMIT_TITLE);
    expect(row.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
    expect(row.relatedEntityId).toBe(RELATED_ENTITY_ID);
    expect(row.isRead).toBe(false);

    // The realtime side effect stays settled at exactly the one step-3 publish.
    expect(transportSpy.publishCount).toBe(1);
  });

  test("step 5 — Student (denial observation): own inbox stays empty, unread count stays 0", async () => {
    const page = await NotificationEngine.listMyNotifications(student.userId, INBOX_PAGE, student.locale);

    expect(page.items).toEqual([]);
    expect(page.totalCount).toBe(0);
    expect(page.hasMore).toBe(false);

    const unread = await NotificationEngine.getMyUnreadCount(student.userId, student.locale);
    expect(unread).toBe(0);
  });

  test("step 6 — Teacher marks the row read: isRead=true and badge back to 0", async () => {
    firstMarkedRow = await NotificationEngine.markRead(teacher.userId, emittedRow.id, teacher.locale);

    expect(firstMarkedRow.id).toBe(emittedRow.id);
    expect(firstMarkedRow.isRead).toBe(true);

    const unread = await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale);
    expect(unread).toBe(0);

    // Marking read is not a realtime event — no additional publish happened.
    expect(transportSpy.publishCount).toBe(1);
  });

  test("step 7 — Teacher repeats the mark: idempotent success, no drift", async () => {
    const repeat = await NotificationEngine.markRead(teacher.userId, emittedRow.id, teacher.locale);

    expect(repeat.id).toBe(emittedRow.id);
    expect(repeat.isRead).toBe(true);
    // Same row returned — byte-identical to the first mark's result.
    expect(repeat).toEqual(firstMarkedRow);

    expect(await inboxRowCount(teacher.userId)).toBe(1); // no duplicate row was created
    const unread = await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale);
    expect(unread).toBe(0);
  });

  test("step 8 — Parent-outsider marks the teacher's row: NOTIFICATION_NOT_FOUND; teacher row byte-identical", async () => {
    const before = await db.select().from(notifications).where(eq(notifications.id, emittedRow.id)).limit(1);

    const error = await expectJourneyError(() =>
      NotificationEngine.markRead(parentOutsider.userId, emittedRow.id, parentOutsider.locale)
    );

    if (!(error instanceof NotFoundError)) {
      throw new Error(`expected NotFoundError from the outsider mark probe (got ${error.name}: ${error.message})`);
    }
    expect(error.code).toBe("NOTIFICATION_NOT_FOUND");
    expect(error.message).toContain(EN_ERRORS.notificationNotFound);

    // Oracle-safe denial: the owner's row is byte-identical after the probe.
    const after = await db.select().from(notifications).where(eq(notifications.id, emittedRow.id)).limit(1);
    expect(after).toEqual(before);

    // The outsider's own inbox stays untouched.
    expect(await inboxRowCount(parentOutsider.userId)).toBe(0);
  });

  test("step 9 — Teacher reconnects (simulated drop): catch-up refetch equals the DB listing exactly", async () => {
    const catchUpPage = await NotificationEngine.listMyNotifications(teacher.userId, INBOX_PAGE, teacher.locale);

    // Read the persisted listing directly (repo-less), in the engine's
    // documented ordering — the catch-up page must equal it field for field.
    const dbListing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, teacher.userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id));

    // No duplication, no loss.
    expect(catchUpPage.items).toEqual(dbListing);
    expect(catchUpPage.totalCount).toBe(dbListing.length);
    expect(catchUpPage.items).toHaveLength(dbListing.length);

    // A second identical read is stable — idempotent re-observe after the
    // simulated reconnect.
    const secondRead = await NotificationEngine.listMyNotifications(teacher.userId, INBOX_PAGE, teacher.locale);
    expect(secondRead).toEqual(catchUpPage);
  });
});
