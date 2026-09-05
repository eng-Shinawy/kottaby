/**
 * ParentLinkRequestService — chaos & concurrency suite.
 *
 * TRUE cross-connection races over the link-request lifecycle, run against
 * real PostgreSQL ONLY (all races are wholesale skip-gated via
 * `isPgliteProvider`). PGlite is a single-connection WASM Postgres — each
 * process gets its own in-memory instance and concurrent transactions from
 * one process cannot interleave on separate connections, so every race below
 * is wrapped in the wholesale-skip `describeOnRealPostgres` gate (same
 * expression as the repository suite's Tier-3 race arm).
 *
 * Execution plane — the COMMITTED-fixture convention of the sibling service
 * suite (`parent-link-request.service.test.ts`), not `runInRollback`: a race
 * needs TWO independent `db.transaction` sessions so the loser's guarded
 * statement re-evaluates against the winner's COMMITTED state (the very
 * semantics under test). Folding both arms into one rollback transaction
 * would serialize them onto one connection and prove nothing. Hygiene rule
 * therefore mirrors the sibling: every created row is tracked in module
 * registries, `afterAll` hard-deletes them in FK-safe order
 * (notifications → requests → students → users — RESTRICT references) and
 * re-probes ZERO residue by id and by the per-run `chaos_plink_<uuid8>`
 * identity prefix. All notifications ride the engine's `options.transport`
 * seam through a file-local recording transport — nothing reaches a real
 * channel.
 *
 * Coverage map:
 *  - Duplicate-create race: two parallel own-commit `requestLink` calls for
 *    the SAME (parent, student) pair → EXACTLY ONE committed row + exactly
 *    one success; the loser surfaces `PARENT_LINK_ALREADY_PENDING` (the
 *    partial-unique 23505 arbiter traversed and mapped at the service
 *    boundary — the RAW driver error never leaks).
 *  - Concurrent double-respond on ONE pending (two sessions) → exactly one
 *    claim wins; the loser gets the constant
 *    `PARENT_LINK_REQUEST_ALREADY_RESOLVED`; final state is exactly one
 *    terminal row and exactly one parent notification (no ghost states).
 *  - Cross-actor racer: a FOREIGN student's raced respond loses with the
 *    constant `PARENT_LINK_REQUEST_NOT_FOUND` shape and emits
 *    nothing.
 *  - Cancel-vs-respond race → deterministic single outcome; the silent
 *    withdrawal arm proves ZERO orphan notifications on either branch
 *    (in-tx `emitForUser` receipts notify only the own-commit path).
 *  - Two-parent confirm race: two pendings for ONE student, two raced
 *    confirms → EXACTLY ONE `students.parent_id` winner; the loser's whole
 *    unit rolls back (claim + link + notification — zero residual rows);
 *    final state = one confirmed request, one linked parent, remaining
 *    pendings expired (the loser surfaces a typed conflict or a 40P01
 *    deadlock abort — both mean it committed nothing; see in-test comment).
 *  - Confirm-during-expiry instant: respond at `expiresAt` exactly "now"
 *    deterministically materializes `expired` (strict `>` predicate)
 *    with no link and no notification.
 *  - Expiry race (repository primitives, ±1ms fixtures): `markExpiredIfPending` vs `respondToPendingForStudent`
 *    crossing the 7-day boundary → exactly one of EXPIRED/accepted, never
 *    pending, never both.
 *  - `linkParentIfUnlinked` single-writer: two parents racing to link the
 *    same unlinked student → exactly one row, the other arm null (the
 *    service-level whole-tx rollback on the null collapse is pinned by the
 *    two-parent confirm race and the sibling suite's Tier 3).
 *  - Forced post-claim failure: a repository failure injected AFTER the
 *    claim + link but BEFORE commit rolls back the OWN-COMMIT unit — ZERO
 *    residual rows across `parent_link_requests`/`students`/`notifications`
 *    (the rollback-proof pin), and the raw failure propagates unmasked.
 *  - Re-request after silent expiry (a CURRENT-contract pin): a pending row
 *    whose deadline lapsed with NO materializing
 *    touch still answers `PARENT_LINK_ALREADY_PENDING` on re-request (the
 *    liveness-free `findPendingByPair` pre-check + the partial unique, both
 *    status-only), while the SAME row renders `Expired` in the outgoing
 *    list. The UI hides Cancel on BOTH sides for such rows (no
 *    materialization path) until a cron-stream sweep owns it.
 *
 * Security invariants carried by every cell: the winner takes
 * exactly one row, the loser's state is untouched, notifications are bound
 * to the winner's own request id, and every race denial is a constant-shape
 * domain error (code + translated copy, never a driver message).
 */

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { ParentLinkRequestRepository, StudentRepository } from "@/backend/db/repo";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestParent, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError } from "@/backend/db/test/test-utils";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { ConflictError, DomainError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications/notification-engine.service";
import type { NotificationFanoutTransport } from "@/backend/services/notifications/realtime/fanout-transport";
import { ParentLinkRequestService } from "@/backend/services/parents/parent-link-request.service";
import type { DBTransaction, RealtimeNotificationPayload, StudentSelectType, UserSelectType } from "@/backend/types";
import { PARENT_LINK_REQUEST_MS } from "@/shared/constants/parent-link-request.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const LOCALE_EN = "en";

/** English translated literals — the message-comparison source of truth. */
const enErrors = getServerTranslations(LOCALE_EN).errorsTranslations;

/** Per-run identity prefix — `chaos_plink_<uuid8>` on every fixture identity field. */
const RUN_PREFIX = `chaos_plink_${crypto.randomUUID().slice(0, 8)}`;

/** LIKE patterns for the zero-residue probes (hoisted out of `sql` nesting). */
const RUN_PREFIX_SUFFIX_LIKE = `${RUN_PREFIX}%`;
const RUN_PREFIX_CONTAINS_LIKE = `%${RUN_PREFIX}%`;

type NotificationRow = typeof notifications.$inferSelect;
type ParentLinkRequestRow = typeof parentLinkRequests.$inferSelect;

/** Committed-fixture registries — module scope so `afterAll` can hard-delete unconditionally. */
const trackedUserIds: number[] = [];
const trackedRequestIds: number[] = [];

interface RecordedPublish {
  readonly userIds: readonly number[];
  readonly payload: RealtimeNotificationPayload;
}

/** Module-private recording fan-out transport — the spied publish boundary. */
class RecordingFanoutTransport implements NotificationFanoutTransport {
  private readonly published: RecordedPublish[] = [];

  async publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void> {
    this.published.push({ userIds: [...userIds], payload });
  }

  get publishCount(): number {
    return this.published.length;
  }

  clear(): void {
    this.published.length = 0;
  }
}

/** The engine call options every notify-bound service call passes. */
function callOptions(transport: RecordingFanoutTransport): NotificationEngineCallOptions {
  return { transport };
}

/** Installs a recording stub over `logger.logDomainError` (silences + counts). */
function silenceDomainLog() {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/** Narrow a caught error to a DomainError or fail the test with context. */
function requireDomainError(error: unknown): DomainError {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) {
    throw new Error("expected a DomainError instance");
  }
  return error;
}

/** Denial oracle for a caught race-loser reason: typed conflict, exact code, translated copy. */
function expectConflictReason(reason: unknown, code: string, translatedCopy: string): void {
  const domain = requireDomainError(reason);
  expect(domain).toBeInstanceOf(ConflictError);
  if (!(domain instanceof ConflictError)) {
    throw new Error(`expected a ConflictError with code ${code}`);
  }
  expect(domain.code).toBe(code);
  expect(domain.message).toBe(translatedCopy);
}

/**
 * Walks the Drizzle error cause chain hunting a PostgreSQL driver error code
 * (`23505` unique violation, `40P01` deadlock detector) — mirrors the
 * traversal precedents (`hasUniqueViolationCode` in the repository suite,
 * `isUniqueViolation` in `user-provisioning.helpers.ts`): Drizzle masks
 * driver errors behind its generic "failed query" message, so the code lives
 * on the cause-chain pg error.
 */
function hasPgCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Splits allSettled outcomes into (fulfilled values, rejection reasons) — the race-shape oracle. */
function settleRace<T>(outcomes: ReadonlyArray<PromiseSettledResult<T>>): {
  readonly values: T[];
  readonly reasons: unknown[];
} {
  const values: T[] = [];
  const reasons: unknown[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      values.push(outcome.value);
    } else {
      reasons.push(outcome.reason);
    }
  }
  return { values, reasons };
}

/**
 * Creates one committed (parent, student) pair — the `parents` role row is
 * included (the `parent_link_requests.parent_id` FK targets it). Every
 * identity field carries the per-run prefix so residue is greppable.
 */
async function createLinkPair(label: string): Promise<{ parent: UserSelectType; student: StudentSelectType }> {
  return db.transaction(async (tx: DBTransaction) => {
    const parent = await createTestUser(tx, {
      role: "parent",
      fullName: `${RUN_PREFIX} ${label} parent`,
      email: `${RUN_PREFIX}.${label}.parent@chaos.test`,
    });
    await createTestParent(tx, parent.id);
    trackedUserIds.push(parent.id);
    const studentUser = await createTestUser(tx, {
      fullName: `${RUN_PREFIX} ${label} student`,
      email: `${RUN_PREFIX}.${label}.student@chaos.test`,
    });
    const student = await createTestStudent(tx, studentUser.id);
    trackedUserIds.push(studentUser.id);
    return { parent, student };
  });
}

/** Inserts one live pending request for the pair in ONE committed transaction (tracked). */
async function createCommittedPending(
  parentId: number,
  studentId: number,
  expiresAt: Date
): Promise<ParentLinkRequestRow> {
  const row = await db.transaction(async (tx: DBTransaction) =>
    ParentLinkRequestRepository.create({ parentId, studentId, expiresAt }, tx)
  );
  trackedRequestIds.push(row.id);
  return row;
}

/** Persisted parent-link inbox rows of one user, read through the given executor. */
async function linkInboxRowsFor(executor: DBTransaction | typeof db, userId: number): Promise<NotificationRow[]> {
  return executor.select().from(notifications).where(eq(notifications.userId, userId));
}

/** Fresh read of one request row by id through the given executor (null when absent). */
async function requestRowById(executor: DBTransaction | typeof db, id: number): Promise<ParentLinkRequestRow | null> {
  const rows = await executor.select().from(parentLinkRequests).where(eq(parentLinkRequests.id, id));
  return rows.at(0) ?? null;
}

/** Fresh read of `students.parent_id` for one student through the given executor. */
async function studentParentId(executor: DBTransaction | typeof db, studentId: number): Promise<number | null> {
  const rows = await executor.select({ parentId: students.parentId }).from(students).where(eq(students.id, studentId));
  return rows.at(0)?.parentId ?? null;
}

/** Live pending requests for one student, read on the default executor. */
async function pendingCountForStudent(studentId: number): Promise<number> {
  return db.$count(
    parentLinkRequests,
    sql`(${parentLinkRequests.studentId} = ${studentId} AND ${parentLinkRequests.status} = 'pending')`
  );
}

afterAll(async () => {
  // Wholesale skip under PGlite — nothing was provisioned.
  if (isPgliteProvider()) {
    return;
  }
  // Unconditional teardown from the module-scope registries — a failed test
  // must never leave committed rows behind. FK-safe order: notifications →
  // requests → students → users (RESTRICT references).
  const allUserIds = [...trackedUserIds];
  await db.transaction(async (tx: DBTransaction) => {
    if (allUserIds.length > 0) {
      await tx.delete(notifications).where(inArray(notifications.userId, allUserIds));
    }
    if (trackedRequestIds.length > 0) {
      await tx.delete(parentLinkRequests).where(inArray(parentLinkRequests.id, trackedRequestIds));
    }
    if (allUserIds.length > 0) {
      // Any row created by the service for cast members but not yet tracked
      // (a crash between commit and tracking) still blocks user deletion —
      // sweep by parent/student membership as the belt-and-braces.
      await tx
        .delete(parentLinkRequests)
        .where(or(inArray(parentLinkRequests.parentId, allUserIds), inArray(parentLinkRequests.studentId, allUserIds)));
      await tx.delete(students).where(inArray(students.id, allUserIds));
      await tx.delete(users).where(inArray(users.id, allUserIds));
    }
  });

  // Mandatory zero-residue probes — nothing with this run's identity remains.
  const [userResidue, studentResidue, requestResidue, notificationResidue, prefixResidue] = await Promise.all([
    db.$count(users, sql`${users.email} LIKE ${RUN_PREFIX_SUFFIX_LIKE}`),
    db.$count(students, inArray(students.id, allUserIds)),
    db.$count(parentLinkRequests, inArray(parentLinkRequests.id, trackedRequestIds)),
    db.$count(notifications, sql`${notifications.title} LIKE ${RUN_PREFIX_CONTAINS_LIKE}`),
    db.$count(users, sql`${users.fullName} LIKE ${RUN_PREFIX_SUFFIX_LIKE}`),
  ]);
  expect(userResidue).toBe(0);
  expect(studentResidue).toBe(0);
  expect(requestResidue).toBe(0);
  expect(notificationResidue).toBe(0);
  expect(prefixResidue).toBe(0);
});

/** Wholesale-skip wrapper for every true race — PGlite cannot host cross-connection interleavings. */
const describeOnRealPostgres = isPgliteProvider() ? describe.skip : describe;

describeOnRealPostgres("ParentLinkRequestService — chaos & concurrency (real PostgreSQL)", () => {
  test("duplicate-create race: two parallel requestLink calls for the SAME pair — exactly ONE committed row, loser surfaces PARENT_LINK_ALREADY_PENDING (raw 23505 never leaks)", async () => {
    const { parent, student } = await createLinkPair("dup-create");
    const firstTransport = new RecordingFanoutTransport();
    const secondTransport = new RecordingFanoutTransport();

    const outcomes = await Promise.allSettled([
      ParentLinkRequestService.requestLink(
        student.handshakeCode,
        parent.id,
        LOCALE_EN,
        undefined,
        callOptions(firstTransport)
      ),
      ParentLinkRequestService.requestLink(
        student.handshakeCode,
        parent.id,
        LOCALE_EN,
        undefined,
        callOptions(secondTransport)
      ),
    ]);
    const { values, reasons } = settleRace(outcomes);
    expect(values).toHaveLength(1);
    expect(reasons).toHaveLength(1);

    const created = values.at(0);
    if (!created) {
      throw new Error("expected exactly one creation payload from the race");
    }
    expect(created.status).toBe(LinkStatus.Pending);

    // The loser surfaces the SAME conflict as the pre-check: the
    // partial-unique 23505 arbiter is traversed (cause chain) and mapped at
    // the service boundary — the RAW driver error never leaks past it.
    const loserReason: unknown = reasons.at(0);
    expectConflictReason(loserReason, "PARENT_LINK_ALREADY_PENDING", enErrors.parentLinkAlreadyPending);
    expect(hasPgCode(loserReason, "23505")).toBe(false);

    // Final state: EXACTLY ONE committed row for the pair, still pending.
    expect(await db.$count(parentLinkRequests, eq(parentLinkRequests.id, created.id))).toBe(1);
    expect(await pendingCountForStudent(student.id)).toBe(1);
    const row = await requestRowById(db, created.id);
    expect(row?.status).toBe(LinkStatus.Pending);
    expect(row?.respondedAt).toBeNull();

    // Exactly ONE inbox row for the student, bound to the winner's request.
    const inbox = await linkInboxRowsFor(db, student.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.relatedEntityType).toBe("parent_link_request");
    expect(inbox[0]?.relatedEntityId).toBe(created.id);

    // Only the own-commit path notifies: the winner publishes exactly once,
    // the loser emits NOTHING (its in-tx emit rolled back with its unit).
    const firstWon = outcomes[0]?.status === "fulfilled";
    expect(firstWon ? firstTransport.publishCount : secondTransport.publishCount).toBe(1);
    expect(firstWon ? secondTransport.publishCount : firstTransport.publishCount).toBe(0);
  });

  test("concurrent double-respond on ONE pending: exactly one claim wins — loser gets PARENT_LINK_REQUEST_ALREADY_RESOLVED, one terminal state, one notification", async () => {
    const { parent, student } = await createLinkPair("double-respond");
    const request = await createCommittedPending(parent.id, student.id, new Date(Date.now() + PARENT_LINK_REQUEST_MS));
    const acceptTransport = new RecordingFanoutTransport();
    const rejectTransport = new RecordingFanoutTransport();

    const outcomes = await Promise.allSettled([
      ParentLinkRequestService.respondToLinkRequest(
        request.id,
        true,
        student.id,
        LOCALE_EN,
        undefined,
        callOptions(acceptTransport)
      ),
      ParentLinkRequestService.respondToLinkRequest(
        request.id,
        false,
        student.id,
        LOCALE_EN,
        undefined,
        callOptions(rejectTransport)
      ),
    ]);
    const { values, reasons } = settleRace(outcomes);
    expect(values).toHaveLength(1);
    expect(reasons).toHaveLength(1);
    expectConflictReason(
      reasons.at(0),
      "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
      enErrors.parentLinkRequestAlreadyResolved
    );

    // Exactly one terminal state, decided by the winner's own decision.
    const winner = values.at(0);
    if (!winner) {
      throw new Error("expected exactly one respond payload from the race");
    }
    expect(winner.id).toBe(request.id);
    const winnerAccepted = winner.status === LinkStatus.Confirmed;
    const row = await requestRowById(db, request.id);
    expect(row?.status).toBe(winnerAccepted ? LinkStatus.Confirmed : LinkStatus.Rejected);
    expect(row?.respondedAt).not.toBeNull();
    if (winnerAccepted) {
      expect(await studentParentId(db, student.id)).toBe(parent.id);
    } else {
      expect(await studentParentId(db, student.id)).toBeNull();
    }

    // No ghost states: exactly ONE parent notification bound to the request —
    // the loser's classified denial emitted nothing.
    const inbox = await linkInboxRowsFor(db, parent.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.relatedEntityId).toBe(request.id);
    const firstWon = outcomes[0]?.status === "fulfilled";
    expect(firstWon ? acceptTransport.publishCount : rejectTransport.publishCount).toBe(1);
    expect(firstWon ? rejectTransport.publishCount : acceptTransport.publishCount).toBe(0);
  });

  test("cross-actor racer: a FOREIGN student's raced respond loses with the constant NOT_FOUND shape and emits nothing", async () => {
    const { parent, student } = await createLinkPair("owner");
    const { student: foreignStudent } = await createLinkPair("foreign");
    const request = await createCommittedPending(parent.id, student.id, new Date(Date.now() + PARENT_LINK_REQUEST_MS));
    const ownerTransport = new RecordingFanoutTransport();
    const foreignTransport = new RecordingFanoutTransport();

    const outcomes = await Promise.allSettled([
      ParentLinkRequestService.respondToLinkRequest(
        request.id,
        true,
        student.id,
        LOCALE_EN,
        undefined,
        callOptions(ownerTransport)
      ),
      ParentLinkRequestService.respondToLinkRequest(
        request.id,
        true,
        foreignStudent.id,
        LOCALE_EN,
        undefined,
        callOptions(foreignTransport)
      ),
    ]);
    // The owner fulfills; the foreign racer is denied the constant
    // shape (foreign ≡ nonexistent — never an id-enumeration oracle).
    expect(outcomes[0]?.status).toBe("fulfilled");
    expect(outcomes[1]?.status).toBe("rejected");
    const foreignReason: unknown = outcomes[1]?.status === "rejected" ? outcomes[1].reason : undefined;
    const foreignDomain = requireDomainError(foreignReason);
    expect(foreignDomain).toBeInstanceOf(NotFoundError);
    if (!(foreignDomain instanceof NotFoundError)) {
      throw new Error("expected a NotFoundError from the constant-shape denial");
    }
    expect(foreignDomain.code).toBe("PARENT_LINK_REQUEST_NOT_FOUND");
    expect(foreignDomain.message).toBe(enErrors.parentLinkRequestNotFound);

    // The owner's claim stands: confirmed + linked + exactly one publish.
    const row = await requestRowById(db, request.id);
    expect(row?.status).toBe(LinkStatus.Confirmed);
    expect(row?.respondedAt).not.toBeNull();
    expect(await studentParentId(db, student.id)).toBe(parent.id);
    const inbox = await linkInboxRowsFor(db, parent.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.relatedEntityId).toBe(request.id);
    expect(ownerTransport.publishCount).toBe(1);
    expect(foreignTransport.publishCount).toBe(0);
  });

  test("cancel-vs-respond race: deterministic single outcome, no ghost states, no orphan notifications on either branch", async () => {
    const { parent, student } = await createLinkPair("cancel-respond");
    const request = await createCommittedPending(parent.id, student.id, new Date(Date.now() + PARENT_LINK_REQUEST_MS));
    const respondTransport = new RecordingFanoutTransport();

    const outcomes = await Promise.allSettled([
      ParentLinkRequestService.respondToLinkRequest(
        request.id,
        true,
        student.id,
        LOCALE_EN,
        undefined,
        callOptions(respondTransport)
      ),
      ParentLinkRequestService.cancelLinkRequest(request.id, parent.id, LOCALE_EN),
    ]);
    // Exactly one winner; both orders converge on the SAME loser conflict:
    // whichever claim lost re-classified the row as already resolved.
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    const respondWon = outcomes[0]?.status === "fulfilled";
    const loserOutcome = outcomes[respondWon ? 1 : 0];
    const loserReason: unknown = loserOutcome?.status === "rejected" ? loserOutcome.reason : undefined;
    expectConflictReason(
      loserReason,
      "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
      enErrors.parentLinkRequestAlreadyResolved
    );

    // Deterministic single outcome — branch on the winner and probe the whole
    // committed plane for ghost states.
    const row = await requestRowById(db, request.id);
    expect(row).toBeDefined();
    if (respondWon) {
      expect(row?.status).toBe(LinkStatus.Confirmed);
      expect(await studentParentId(db, student.id)).toBe(parent.id);
      const inbox = await linkInboxRowsFor(db, parent.id);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.relatedEntityId).toBe(request.id);
      expect(respondTransport.publishCount).toBe(1);
    } else {
      // Silent withdrawal: folded to rejected (with a stamp), ZERO
      // notifications anywhere, publish count still zero.
      expect(row?.status).toBe(LinkStatus.Rejected);
      expect(row?.respondedAt).not.toBeNull();
      expect(await studentParentId(db, student.id)).toBeNull();
      expect(await linkInboxRowsFor(db, parent.id)).toHaveLength(0);
      expect(await linkInboxRowsFor(db, student.id)).toHaveLength(0);
      expect(respondTransport.publishCount).toBe(0);
    }
  });

  test("two-parent confirm race: exactly ONE students.parent_id winner — loser commits NOTHING, remaining pendings expired", async () => {
    const { parent: parentA } = await createLinkPair("race-a");
    const { parent: parentB, student } = await createLinkPair("race-b");
    const liveUntil = new Date(Date.now() + PARENT_LINK_REQUEST_MS);
    const requestA = await createCommittedPending(parentA.id, student.id, liveUntil);
    const requestB = await createCommittedPending(parentB.id, student.id, liveUntil);
    const aTransport = new RecordingFanoutTransport();
    const bTransport = new RecordingFanoutTransport();

    const outcomes = await Promise.allSettled([
      ParentLinkRequestService.respondToLinkRequest(
        requestA.id,
        true,
        student.id,
        LOCALE_EN,
        undefined,
        callOptions(aTransport)
      ),
      ParentLinkRequestService.respondToLinkRequest(
        requestB.id,
        true,
        student.id,
        LOCALE_EN,
        undefined,
        callOptions(bTransport)
      ),
    ]);
    const { values, reasons } = settleRace(outcomes);
    expect(values).toHaveLength(1);
    expect(reasons).toHaveLength(1);

    // Loser shape: a typed conflict (its claim collapsed against the winner's
    // committed state) or a 40P01 deadlock abort (the two units contend
    // claim-row → link-row in opposite order, so Postgres may abort one
    // waiter). BOTH shapes mean the loser committed nothing.
    const loserReason: unknown = reasons.at(0);
    const loserCode = loserReason instanceof ConflictError ? loserReason.code : null;
    if (loserCode === null) {
      expect(hasPgCode(loserReason, "40P01")).toBe(true);
    } else {
      expect(["PARENT_LINK_TARGET_ALREADY_LINKED", "PARENT_LINK_REQUEST_ALREADY_RESOLVED"]).toContain(loserCode);
    }

    // Final state: ONE confirmed request, ONE linked parent, the remaining
    // pending EXPIRED (the winner's sibling sweep).
    const winner = values.at(0);
    if (!winner) {
      throw new Error("expected exactly one confirmed payload from the race");
    }
    expect(winner.status).toBe(LinkStatus.Confirmed);
    const winnerParentId = winner.id === requestA.id ? parentA.id : parentB.id;
    const loserParentId = winner.id === requestA.id ? parentB.id : parentA.id;
    const winnerRow = await requestRowById(db, winner.id);
    const loserRow = await requestRowById(db, winner.id === requestA.id ? requestB.id : requestA.id);
    expect(winnerRow?.status).toBe(LinkStatus.Confirmed);
    expect(winnerRow?.respondedAt).not.toBeNull();
    expect(loserRow?.status).toBe(LinkStatus.Expired);
    expect(loserRow?.respondedAt).toBeNull();
    expect(await studentParentId(db, student.id)).toBe(winnerParentId);
    expect(await pendingCountForStudent(student.id)).toBe(0);

    // Zero cross-actor leakage: only the WINNER's parent was notified — the
    // loser's in-tx accepted copy rolled back with its whole unit.
    const winnerInbox = await linkInboxRowsFor(db, winnerParentId);
    expect(winnerInbox).toHaveLength(1);
    expect(winnerInbox[0]?.relatedEntityId).toBe(winner.id);
    expect(await linkInboxRowsFor(db, loserParentId)).toHaveLength(0);
    const firstWon = outcomes[0]?.status === "fulfilled";
    expect(firstWon ? aTransport.publishCount : bTransport.publishCount).toBe(1);
    expect(firstWon ? bTransport.publishCount : aTransport.publishCount).toBe(0);
  });

  test("confirm-during-expiry instant: respond at expiresAt exactly 'now' deterministically materializes EXPIRED (strict `>`)", async () => {
    const { parent, student } = await createLinkPair("expiry-instant");
    // The boundary instant: EVERY later captured `now` fails `expires_at > now`.
    const request = await createCommittedPending(parent.id, student.id, new Date());
    const transport = new RecordingFanoutTransport();
    const logSpy = silenceDomainLog();
    let denial: DomainError;
    try {
      const error = await expectRepoError(() =>
        ParentLinkRequestService.respondToLinkRequest(
          request.id,
          true,
          student.id,
          LOCALE_EN,
          undefined,
          callOptions(transport)
        )
      );
      denial = requireDomainError(error);
      // Exactly ONE bounded denial log — the expiry fold's own fingerprint
      // (asserted BEFORE the restore: bun's mockRestore clears mock state).
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]?.[1]).toMatchObject({
        code: "PARENT_LINK_REQUEST_EXPIRED",
        entity: "parent_link_requests",
        locale: LOCALE_EN,
      });
    } finally {
      logSpy.mockRestore();
    }
    expect(denial).toBeInstanceOf(ConflictError);
    if (!(denial instanceof ConflictError)) {
      throw new Error("expected the expiry instant to raise the expired conflict");
    }
    expect(denial.code).toBe("PARENT_LINK_REQUEST_EXPIRED");
    expect(denial.message).toBe(enErrors.parentLinkRequestExpired);

    // The expiry is MATERIALIZED (the row survives as expired),
    // with no link and no notification on the denial path.
    const row = await requestRowById(db, request.id);
    expect(row?.status).toBe(LinkStatus.Expired);
    expect(row?.respondedAt).toBeNull();
    expect(await studentParentId(db, student.id)).toBeNull();
    expect(await linkInboxRowsFor(db, parent.id)).toHaveLength(0);
    expect(transport.publishCount).toBe(0);
  });

  test("expiry race — live side (+1ms): markExpiredIfPending vs respondToPendingForStudent converge to EXACTLY ONE terminal state", async () => {
    const { parent, student } = await createLinkPair("expiry-race-live");
    const request = await createCommittedPending(parent.id, student.id, new Date(Date.now() + 1));

    const outcomes = await Promise.allSettled([
      db.transaction(async (tx: DBTransaction) =>
        ParentLinkRequestRepository.respondToPendingForStudent(
          request.id,
          student.id,
          LinkStatus.Confirmed,
          new Date(),
          tx
        )
      ),
      db.transaction(async (tx: DBTransaction) => ParentLinkRequestRepository.markExpiredIfPending(request.id, tx)),
    ]);
    // Neither primitive throws on collapse (null / void) — the race converges.
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(0);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(2);
    const respondOutcome = outcomes[0];
    const claimedRow = respondOutcome?.status === "fulfilled" ? respondOutcome.value : null;

    // Exactly one of EXPIRED/accepted — never pending, never both.
    const row = await requestRowById(db, request.id);
    expect(row).toBeDefined();
    if (claimedRow !== null) {
      // The claim crossed the boundary inside its 1ms window: confirmed + stamped.
      expect(claimedRow.id).toBe(request.id);
      expect(row?.status).toBe(LinkStatus.Confirmed);
      expect(row?.respondedAt).not.toBeNull();
    } else {
      // The sweep won (or the captured `now` crossed the deadline): expired.
      expect(row?.status).toBe(LinkStatus.Expired);
      expect(row?.respondedAt).toBeNull();
    }
    // Repository primitives never notify — zero orphan inbox rows.
    expect(await linkInboxRowsFor(db, parent.id)).toHaveLength(0);
  });

  test("expiry race — dead side (−1ms): the claim collapses and the sweep materializes EXPIRED", async () => {
    const { parent, student } = await createLinkPair("expiry-race-dead");
    const request = await createCommittedPending(parent.id, student.id, new Date(Date.now() - 1));

    const outcomes = await Promise.allSettled([
      db.transaction(async (tx: DBTransaction) =>
        ParentLinkRequestRepository.respondToPendingForStudent(
          request.id,
          student.id,
          LinkStatus.Confirmed,
          new Date(),
          tx
        )
      ),
      db.transaction(async (tx: DBTransaction) => ParentLinkRequestRepository.markExpiredIfPending(request.id, tx)),
    ]);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(0);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(2);
    // The claim deterministically collapsed: the captured `now` is already
    // past the deadline (strict `>` false) — and the row is EXPIRED either way.
    const respondOutcome = outcomes[0];
    const claimedRow = respondOutcome?.status === "fulfilled" ? respondOutcome.value : null;
    expect(claimedRow).toBeNull();
    const row = await requestRowById(db, request.id);
    expect(row?.status).toBe(LinkStatus.Expired);
    expect(row?.respondedAt).toBeNull();
    expect(await studentParentId(db, student.id)).toBeNull();
    expect(await linkInboxRowsFor(db, parent.id)).toHaveLength(0);
  });

  test("linkParentIfUnlinked single-writer: two parents racing to link the same unlinked student — exactly ONE row, the other arm null", async () => {
    const { parent: parentA } = await createLinkPair("link-writer-a");
    const { parent: parentB, student } = await createLinkPair("link-writer-b");

    const outcomes = await Promise.allSettled([
      db.transaction(async (tx: DBTransaction) => StudentRepository.linkParentIfUnlinked(student.id, parentA.id, tx)),
      db.transaction(async (tx: DBTransaction) => StudentRepository.linkParentIfUnlinked(student.id, parentB.id, tx)),
    ]);
    const { values, reasons } = settleRace(outcomes);
    // null is a VALUE here, not a throw — both arms fulfill.
    expect(reasons).toHaveLength(0);
    expect(values).toHaveLength(2);
    const winnerRow = values.at(0) ?? null;
    const loserRow = values.at(1) ?? null;
    const linkedRows = values.filter(row => row !== null);
    expect(linkedRows).toHaveLength(1);

    // The persisted link points at EXACTLY ONE parent — the whole-tx rollback
    // on the zero-row collapse is pinned at the service tier by the
    // two-parent confirm race and the sibling suite's Tier 3.
    const winner = winnerRow ?? loserRow;
    expect(winner).not.toBeNull();
    expect(winner?.id).toBe(student.id);
    expect(winner?.parentId === parentA.id || winner?.parentId === parentB.id).toBe(true);
    expect(await studentParentId(db, student.id)).toBe(winner?.parentId ?? null);
    if (winnerRow !== null) {
      expect(loserRow).toBeNull();
    } else {
      expect(loserRow).not.toBeNull();
    }
  });

  test("forced post-claim failure: repo failure AFTER claim+link but BEFORE commit rolls back the OWN-COMMIT unit — zero residual rows", async () => {
    const { parent, student } = await createLinkPair("forced-failure");
    const request = await createCommittedPending(parent.id, student.id, new Date(Date.now() + PARENT_LINK_REQUEST_MS));
    const transport = new RecordingFanoutTransport();

    // Inject the failure AFTER the claim + guarded link but BEFORE the
    // sibling sweep could complete the unit — the OWN-COMMIT transaction
    // must roll back EVERYTHING it wrote (claim, link, notification).
    const expireSpy = spyOn(ParentLinkRequestRepository, "expireSiblingPendingsForStudent").mockImplementation(
      async () => {
        throw new Error("forced post-claim failure");
      }
    );
    const logSpy = silenceDomainLog();
    try {
      const failure = await expectRepoError(() =>
        ParentLinkRequestService.respondToLinkRequest(
          request.id,
          true,
          student.id,
          LOCALE_EN,
          undefined,
          callOptions(transport)
        )
      );
      // The raw failure propagates UNMASKED (never a domain shape) and the
      // domain log stays silent (asserted BEFORE the restore: bun's
      // mockRestore clears mock state).
      expect(failure.message).toBe("forced post-claim failure");
      expect(failure).not.toBeInstanceOf(DomainError);
      expect(logSpy).toHaveBeenCalledTimes(0);
    } finally {
      expireSpy.mockRestore();
      logSpy.mockRestore();
    }

    // COMMITTED-state probes on the default executor — the rollback crossed
    // the commit boundary: ZERO residual rows across all three tables.
    const row = await requestRowById(db, request.id);
    expect(row?.status).toBe(LinkStatus.Pending);
    expect(row?.respondedAt).toBeNull();
    expect(await studentParentId(db, student.id)).toBeNull();
    expect(await linkInboxRowsFor(db, parent.id)).toHaveLength(0);
    expect(await linkInboxRowsFor(db, student.id)).toHaveLength(0);
    expect(transport.publishCount).toBe(0);
  });

  test("re-request after silent expiry: the lapsed-but-unmaterialized pending row still answers PARENT_LINK_ALREADY_PENDING (6.4-F1 pin — CURRENT contract, D1 interplay)", async () => {
    const { parent, student } = await createLinkPair("silent-expiry");
    const transport = new RecordingFanoutTransport();

    // Step 1 — the happy path: the original request commits (exactly one
    // row, one student inbox row, one publish).
    const created = await ParentLinkRequestService.requestLink(
      student.handshakeCode,
      parent.id,
      LOCALE_EN,
      undefined,
      callOptions(transport)
    );
    if (!created) {
      throw new Error("expected the original request to commit");
    }
    expect(created.status).toBe(LinkStatus.Pending);

    // Step 2 — the deadline lapses SILENTLY: no respond/cancel/sweep write
    // ever materializes the row (lazy expiry has no write path of its own —
    // D1's cron sweep does not exist yet), so the COMMITTED status stays
    // `pending`. Backdating `expires_at` on the tracked row is the honest
    // clock-passage simulation: byte-identical to a request whose 7 days
    // simply ran out (liveness is a read-side classification, strict `>`).
    await db
      .update(parentLinkRequests)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(parentLinkRequests.id, created.id));

    // The read-pure list surface renders that SAME row `Expired` (the
    // UX-visible half of the contradiction the re-request denial creates).
    const outgoing = await ParentLinkRequestService.listMyOutgoing(parent.id, LOCALE_EN);
    const rendered = outgoing.find(row => row.id === created.id);
    if (!rendered) {
      throw new Error("expected the lapsed row in the outgoing list");
    }
    expect(rendered.status).toBe(LinkStatus.Expired);

    // Step 3 — re-request the same code: the pre-check (`findPendingByPair`
    // matches status='pending' with NO liveness conjunct) answers the
    // constant PARENT_LINK_ALREADY_PENDING conflict; the partial unique on
    // `status='pending'` would 23505 into the SAME mapping regardless. This
    // pins the CURRENT contract honestly: the pair is locked out of
    // re-submission because the UI hides Cancel on BOTH sides for
    // computed-Expired rows (no materialization path) until a cron-stream
    // sweep owns it — backend behavior stays as pinned.
    const reRequestError = await expectRepoError(() =>
      ParentLinkRequestService.requestLink(
        student.handshakeCode,
        parent.id,
        LOCALE_EN,
        undefined,
        callOptions(transport)
      )
    );
    expectConflictReason(reRequestError, "PARENT_LINK_ALREADY_PENDING", enErrors.parentLinkAlreadyPending);

    // Row counts + notification hygiene: STILL exactly one committed row,
    // still `pending` (unmaterialized), and the denial emitted nothing.
    expect(await pendingCountForStudent(student.id)).toBe(1);
    const row = await requestRowById(db, created.id);
    expect(row?.status).toBe(LinkStatus.Pending);
    expect(row?.respondedAt).toBeNull();
    expect(await linkInboxRowsFor(db, student.id)).toHaveLength(1);
    expect(await linkInboxRowsFor(db, parent.id)).toHaveLength(0);
    expect(transport.publishCount).toBe(1);
  });
});
