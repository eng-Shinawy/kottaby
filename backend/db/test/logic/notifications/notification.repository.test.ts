/**
 * NotificationRepository tests — all seven methods of the fresh
 * `notifications` data-access namespace against the live test PostgreSQL
 * instance.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call, entity-setup helper, and direct Drizzle query (the non-tx
 *    `queryDb` fast path cannot run inside a rolled-back transaction — the
 *    transactional branch is the one under test here, same as the sibling
 *    applicant-lifecycle suite).
 *  - Fixtures are created ONLY via `entity-setup.ts` (`createTestUser`) and
 *    direct multi-row inserts — never seed data, never the repository under
 *    test for setup.
 *  - The repository signals "no match" with `null` / `0` / `[]` (it maps no
 *    errors), so assertions are value-based; `expectRepoError` is reserved
 *    for the one integrity-chaos case (FK violation on a ghost recipient).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): every method happy path; filter branch ×
 *    combination (none / type / isRead / both / explicit nulls); empty-batch
 *    guard; countUnread mixed read states; markReadOnce flip + idempotent
 *    re-mark; markAllReadForUser type-null sweep / type-scoped sweep.
 *  - Tier 2 (boundary): limit 1 and 50 (the page-size bounds), offset 0 /
 *    offset advance / offset beyond the end, filter matching zero rows
 *    (list + count agree).
 *  - Tier 3 (chaos/concurrency): concurrent markReadOnce storms on the SAME
 *    row and on distinct rows via `Promise.allSettled`; paired
 *    markAllReadForUser sweeps; a mixed mark storm racing the set-based
 *    sweep; FK-integrity rejection of a ghost-recipient insert.
 *  - Tier 4 (security/tenancy): foreign-recipient markReadOnce → null with
 *    the owner's row byte-identical; every read/write scoped by the
 *    explicit userId parameter (another user's inbox stays invisible and
 *    untouched).
 */

import { describe, expect, test } from "bun:test";
import { desc, eq, sql } from "drizzle-orm";
import { NotificationRepository } from "@/backend/db/repo";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import type { DBTransaction, NotificationInsertType, NotificationSelectType } from "@/backend/types";

/** PostgreSQL error code for `foreign_key_violation`. */
const PG_FOREIGN_KEY_VIOLATION = "23503";

/** Page-size boundaries of the inbox contract. */
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 50;

/**
 * The persisted column value carried by session-request rows — the pgEnum
 * literal union, not the TS enum mirror, so comparisons against row data
 * stay type-identical on both sides.
 */
const SESSION_REQUEST_TYPE: NotificationSelectType["type"] = NotificationType.SessionRequest;

/**
 * Standard five-row fixture for one recipient, seeded oldest-first (the
 * LAST spec is the newest row):
 *   Notice 1: SessionRequest        unread
 *   Notice 2: SessionRequest        read
 *   Notice 3: SystemBroadcast       unread
 *   Notice 4: SystemBroadcast       read
 *   Notice 5: PaymentConfirmation   unread  (newest)
 */
const FILTER_FIXTURE: readonly RowSpec[] = [
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: true },
  { type: NotificationType.SystemBroadcast, isRead: false },
  { type: NotificationType.SystemBroadcast, isRead: true },
  { type: NotificationType.PaymentConfirmation, isRead: false },
];

/** Requested shape of one seeded row — defaults keep every list deterministic. */
interface RowSpec {
  readonly type: NotificationType;
  readonly isRead?: boolean;
  /**
   * Minutes subtracted from "now". Defaults to descending-from-now by spec
   * index so specs read oldest-first — the LAST spec is the newest row;
   * equal values produce same-timestamp rows (exercising the id DESC
   * tiebreaker).
   */
  readonly minutesAgo?: number;
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given code — Drizzle wraps driver
 * errors behind its own generic "failed query" message. Mirrors the
 * established traversal precedent in `applicant-lifecycle.test.ts`.
 */
function hasPostgresErrorCode(error: unknown, pgCode: string): boolean {
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

/**
 * Returns an integer id that cannot exist as a `notifications` row during
 * this transaction: anything above the current identity maximum (plus a
 * large offset no sequence reaches during a rolled-back test) is guaranteed
 * absent.
 */
async function absentNotificationId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${notifications.id}), 0)::int` }).from(notifications);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Builds insert payloads for one recipient from row specs — setup data
 * only, never routed through the repository under test.
 */
function buildInserts(userId: number, specs: readonly RowSpec[]): NotificationInsertType[] {
  const now = Date.now();
  return specs.map((spec, i) => ({
    userId,
    type: spec.type,
    title: `Notice ${i + 1}`,
    body: `Body ${i + 1}`,
    isRead: spec.isRead ?? false,
    relatedEntityType: "session",
    relatedEntityId: 9000 + i,
    createdAt: new Date(now - (spec.minutesAgo ?? specs.length - 1 - i) * 60_000),
  }));
}

/**
 * Seeds rows with a direct multi-row insert (NOT the repository under test)
 * so setup never depends on the code it is about to assert on. Returns the
 * persisted rows in input (oldest-first) order.
 */
async function seedRows(
  tx: DBTransaction,
  inserts: readonly NotificationInsertType[]
): Promise<NotificationSelectType[]> {
  return tx
    .insert(notifications)
    .values([...inserts])
    .returning();
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx,
 * newest first (`created_at DESC, id DESC`), never routed through the
 * repository under test.
 */
async function readUserRows(tx: DBTransaction, userId: number): Promise<NotificationSelectType[]> {
  return tx
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

/** Narrows a settled outcome to its fulfilled value, or null otherwise. */
function fulfilledValue<T>(outcome: PromiseSettledResult<T> | undefined): T | null {
  return outcome?.status === "fulfilled" ? outcome.value : null;
}

describe("NotificationRepository.createReturning", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("inserts a fully-specified row and returns it complete", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);

      const inserted = await NotificationRepository.createReturning(
        {
          userId: user.id,
          type: NotificationType.SessionRequest,
          title: "Session request received",
          body: "Ahmad requested a Tajweed session",
          isRead: false,
          relatedEntityType: "session",
          relatedEntityId: 4242,
        },
        tx
      );

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.userId).toBe(user.id);
      expect(inserted.type).toBe(NotificationType.SessionRequest);
      expect(inserted.title).toBe("Session request received");
      expect(inserted.body).toBe("Ahmad requested a Tajweed session");
      expect(inserted.isRead).toBe(false);
      expect(inserted.relatedEntityType).toBe("session");
      expect(inserted.relatedEntityId).toBe(4242);
      expect(inserted.createdAt).toBeInstanceOf(Date);

      // Independent read-back: the row persisted with these exact values.
      const persisted = await readUserRows(tx, user.id);
      expect(persisted[0]).toEqual(inserted);
    });
  });

  test("applies column defaults for omitted optional fields", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);

      const inserted = await NotificationRepository.createReturning(
        { userId: user.id, type: NotificationType.SystemBroadcast, title: "Maintenance window" },
        tx
      );

      expect(inserted.body).toBeNull();
      expect(inserted.isRead).toBe(false);
      expect(inserted.relatedEntityType).toBeNull();
      expect(inserted.relatedEntityId).toBeNull();
      expect(inserted.createdAt).toBeInstanceOf(Date);
    });
  });

  // ─── Tier 3: integrity chaos ────────────────────────────────────────

  test("rejects an insert addressed to a ghost recipient (FK violation)", async () => {
    await runInRollback(async tx => {
      const missingUserId = await absentNotificationId(tx);

      const error = await expectRepoError(() =>
        NotificationRepository.createReturning(
          { userId: missingUserId, type: NotificationType.SystemBroadcast, title: "Ghost recipient" },
          tx
        )
      );

      expect(hasPostgresErrorCode(error, PG_FOREIGN_KEY_VIOLATION)).toBe(true);
    });
  });
});

describe("NotificationRepository.createManyReturning", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("inserts every row in one multi-row statement, in input order", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);

      const rows = await NotificationRepository.createManyReturning(
        buildInserts(user.id, [
          { type: NotificationType.SessionRequest },
          { type: NotificationType.SystemBroadcast },
          { type: NotificationType.EvaluationResult, isRead: true },
        ]),
        tx
      );

      expect(rows).toHaveLength(3);
      expect(rows.map(row => row.title)).toEqual(["Notice 1", "Notice 2", "Notice 3"]);
      expect(rows.every(row => row.userId === user.id)).toBe(true);
      expect(rows[2]?.isRead).toBe(true);

      // Exactly three rows persisted — no duplicates, no losses.
      expect(await readUserRows(tx, user.id)).toHaveLength(3);
    });
  });

  test("returns an empty array for empty input (no rows materialize)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);

      const rows = await NotificationRepository.createManyReturning([], tx);

      expect(rows).toEqual([]);
      expect(await NotificationRepository.countForUser(user.id, {}, tx)).toBe(0);
    });
  });
});

describe("NotificationRepository.countUnread", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("counts only the recipient's unread rows", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const other = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE)); // 3 unread, 2 read
      await seedRows(
        tx,
        buildInserts(other.id, [{ type: NotificationType.SystemBroadcast }, { type: NotificationType.SystemBroadcast }])
      );

      expect(await NotificationRepository.countUnread(user.id, tx)).toBe(3);
    });
  });

  test("returns 0 for an all-read inbox and for an empty inbox", async () => {
    await runInRollback(async tx => {
      const readAll = await createTestUser(tx);
      const empty = await createTestUser(tx);
      await seedRows(
        tx,
        buildInserts(readAll.id, [
          { type: NotificationType.SessionRequest, isRead: true },
          { type: NotificationType.PaymentConfirmation, isRead: true },
        ])
      );

      expect(await NotificationRepository.countUnread(readAll.id, tx)).toBe(0);
      expect(await NotificationRepository.countUnread(empty.id, tx)).toBe(0);
    });
  });
});

describe("NotificationRepository.countForUser", () => {
  // ─── Tier 1: branch/statement (filter × combination) ────────────────

  test("unfiltered counts the full inbox; explicit null filters act the same", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      expect(await NotificationRepository.countForUser(user.id, {}, tx)).toBe(5);
      expect(await NotificationRepository.countForUser(user.id, { type: null, isRead: null }, tx)).toBe(5);
    });
  });

  test("type filter narrows to that notification kind", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      expect(await NotificationRepository.countForUser(user.id, { type: NotificationType.SessionRequest }, tx)).toBe(2);
      expect(
        await NotificationRepository.countForUser(user.id, { type: NotificationType.PaymentConfirmation }, tx)
      ).toBe(1);
    });
  });

  test("isRead filter narrows to that read state", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      expect(await NotificationRepository.countForUser(user.id, { isRead: false }, tx)).toBe(3);
      expect(await NotificationRepository.countForUser(user.id, { isRead: true }, tx)).toBe(2);
    });
  });

  test("combined type + isRead filters intersect conjunctively", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      expect(
        await NotificationRepository.countForUser(user.id, { type: NotificationType.SessionRequest, isRead: false }, tx)
      ).toBe(1);
      expect(
        await NotificationRepository.countForUser(user.id, { type: NotificationType.SystemBroadcast, isRead: true }, tx)
      ).toBe(1);
    });
  });

  // ─── Tier 2: filter-empty boundary ──────────────────────────────────

  test("a filter matching zero rows counts 0; other users' rows stay invisible", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const other = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      expect(
        await NotificationRepository.countForUser(
          user.id,
          { type: NotificationType.PaymentConfirmation, isRead: true },
          tx
        )
      ).toBe(0);
      expect(await NotificationRepository.countForUser(other.id, {}, tx)).toBe(0);
    });
  });
});

describe("NotificationRepository.listForUser", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns the full inbox newest-first, byte-equal to the direct DB oracle", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const seeded = await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      const rows = await NotificationRepository.listForUser(user.id, {}, MAX_PAGE_SIZE, 0, tx);

      expect(rows).toHaveLength(5);
      // Seeded order is oldest-first → newest-first is its reverse.
      expect(rows.map(row => row.id)).toEqual(seeded.map(row => row.id).toReversed());
      // Field-for-field equality with an independent newest-first select.
      expect(rows).toEqual(await readUserRows(tx, user.id));
    });
  });

  test("same-timestamp rows fall back to the id DESC tiebreaker", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const seeded = await seedRows(
        tx,
        buildInserts(user.id, [
          { type: NotificationType.SessionRequest, minutesAgo: 5 },
          { type: NotificationType.SessionCompletion, minutesAgo: 5 },
          { type: NotificationType.SessionCancellation, minutesAgo: 5 },
        ])
      );

      const rows = await NotificationRepository.listForUser(user.id, {}, MAX_PAGE_SIZE, 0, tx);

      expect(rows.map(row => row.id)).toEqual(seeded.map(row => row.id).toReversed());
    });
  });

  test("filters: type / isRead / combined / explicit nulls", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      const byType = await NotificationRepository.listForUser(
        user.id,
        { type: NotificationType.SessionRequest },
        MAX_PAGE_SIZE,
        0,
        tx
      );
      expect(byType.map(row => row.title)).toEqual(["Notice 2", "Notice 1"]);

      const unread = await NotificationRepository.listForUser(user.id, { isRead: false }, MAX_PAGE_SIZE, 0, tx);
      expect(unread.map(row => row.title)).toEqual(["Notice 5", "Notice 3", "Notice 1"]);

      const combined = await NotificationRepository.listForUser(
        user.id,
        { type: NotificationType.SystemBroadcast, isRead: true },
        MAX_PAGE_SIZE,
        0,
        tx
      );
      expect(combined.map(row => row.title)).toEqual(["Notice 4"]);

      const nullFilters = await NotificationRepository.listForUser(
        user.id,
        { type: null, isRead: null },
        MAX_PAGE_SIZE,
        0,
        tx
      );
      expect(nullFilters).toHaveLength(5);
    });
  });

  // ─── Tier 2: limit/offset boundaries ────────────────────────────────

  test("limit 1 / limit 50 / offset 0 / offset advance / offset beyond the end", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      // limit 1 (minimum page) at offset 0 → only the newest row.
      const first = await NotificationRepository.listForUser(user.id, {}, MIN_PAGE_SIZE, 0, tx);
      expect(first.map(row => row.title)).toEqual(["Notice 5"]);

      // limit 50 (maximum page) at offset 0 → the whole inbox.
      expect(await NotificationRepository.listForUser(user.id, {}, MAX_PAGE_SIZE, 0, tx)).toHaveLength(5);

      // limit 1 at offset 1 → the second-newest row.
      const second = await NotificationRepository.listForUser(user.id, {}, MIN_PAGE_SIZE, 1, tx);
      expect(second.map(row => row.title)).toEqual(["Notice 4"]);

      // a mid window: rows 3–4 of the newest-first ordering.
      const middle = await NotificationRepository.listForUser(user.id, {}, 2, 2, tx);
      expect(middle.map(row => row.title)).toEqual(["Notice 3", "Notice 2"]);

      // a window starting at the end → empty page, not an error.
      expect(await NotificationRepository.listForUser(user.id, {}, MAX_PAGE_SIZE, 5, tx)).toEqual([]);
    });
  });

  test("a filter matching zero rows returns an empty page; the count agrees", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const other = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE));

      const emptyFilter = { type: NotificationType.PaymentConfirmation, isRead: true };
      expect(await NotificationRepository.listForUser(user.id, emptyFilter, MAX_PAGE_SIZE, 0, tx)).toEqual([]);
      expect(await NotificationRepository.countForUser(user.id, emptyFilter, tx)).toBe(0);

      // Another user's inbox is invisible even unfiltered.
      expect(await NotificationRepository.listForUser(other.id, {}, MAX_PAGE_SIZE, 0, tx)).toEqual([]);
    });
  });
});

describe("NotificationRepository.markReadOnce", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("flips an unread row and returns it with the flag set", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const [seeded] = await seedRows(tx, buildInserts(user.id, [{ type: NotificationType.SessionRequest }]));
      if (!seeded) throw new Error("expected seeded row");

      const updated = await NotificationRepository.markReadOnce(seeded.id, user.id, tx);

      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.id).toBe(seeded.id);
      expect(updated.isRead).toBe(true);
      // Every other column is byte-identical to the seeded row.
      expect(updated).toEqual({ ...seeded, isRead: true });

      const persisted = await readUserRows(tx, user.id);
      expect(persisted[0]?.isRead).toBe(true);
    });
  });

  test("re-marking an already-read row returns it unchanged (idempotent)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const [seeded] = await seedRows(tx, buildInserts(user.id, [{ type: NotificationType.SessionCompletion }]));
      if (!seeded) throw new Error("expected seeded row");

      const first = await NotificationRepository.markReadOnce(seeded.id, user.id, tx);
      const second = await NotificationRepository.markReadOnce(seeded.id, user.id, tx);

      expect(second).toEqual(first);
      expect(await readUserRows(tx, user.id)).toHaveLength(1);
    });
  });

  test("returns null for a nonexistent notification id", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const missingId = await absentNotificationId(tx);

      expect(await NotificationRepository.markReadOnce(missingId, user.id, tx)).toBeNull();
    });
  });

  // ─── Tier 4: security/tenancy (guarded UPDATE, BOLA containment) ─────

  test("foreign recipient's mark returns null and the owner's row stays byte-identical", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const intruder = await createTestUser(tx);
      const [seeded] = await seedRows(tx, buildInserts(owner.id, [{ type: NotificationType.SessionRequest }]));
      if (!seeded) throw new Error("expected seeded row");
      const before = await readUserRows(tx, owner.id);

      const result = await NotificationRepository.markReadOnce(seeded.id, intruder.id, tx);

      expect(result).toBeNull();
      expect(await readUserRows(tx, owner.id)).toEqual(before);
      expect(await NotificationRepository.countUnread(owner.id, tx)).toBe(1);
    });
  });
});

describe("NotificationRepository.markAllReadForUser", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("null type sweeps every unread row; a repeat sweep reports 0", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(tx, buildInserts(user.id, FILTER_FIXTURE)); // 3 unread, 2 read

      const affected = await NotificationRepository.markAllReadForUser(user.id, null, tx);

      expect(affected).toBe(3);
      expect(await NotificationRepository.countUnread(user.id, tx)).toBe(0);
      const rows = await readUserRows(tx, user.id);
      expect(rows).toHaveLength(5);
      expect(rows.every(row => row.isRead === true)).toBe(true);

      // The is_read=false guard: an idempotent second sweep matches nothing.
      expect(await NotificationRepository.markAllReadForUser(user.id, null, tx)).toBe(0);
    });
  });

  test("a non-null type marks only that notification kind", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(
        tx,
        buildInserts(user.id, [
          { type: NotificationType.SessionRequest },
          { type: NotificationType.SystemBroadcast },
          { type: NotificationType.SystemBroadcast },
        ])
      );

      const affected = await NotificationRepository.markAllReadForUser(user.id, NotificationType.SystemBroadcast, tx);

      expect(affected).toBe(2);
      expect(await NotificationRepository.countUnread(user.id, tx)).toBe(1);
      const rows = await readUserRows(tx, user.id);
      const sessionRequest = rows.find(row => row.type === SESSION_REQUEST_TYPE);
      expect(sessionRequest?.isRead).toBe(false);
    });
  });

  test("returns 0 when nothing unread matches (empty inbox / all-read / foreign kind)", async () => {
    await runInRollback(async tx => {
      const empty = await createTestUser(tx);
      const readAll = await createTestUser(tx);
      await seedRows(tx, buildInserts(readAll.id, [{ type: NotificationType.SessionRequest, isRead: true }]));

      expect(await NotificationRepository.markAllReadForUser(empty.id, null, tx)).toBe(0);
      expect(await NotificationRepository.markAllReadForUser(readAll.id, NotificationType.SessionRequest, tx)).toBe(0);
      expect(await NotificationRepository.markAllReadForUser(readAll.id, NotificationType.SystemBroadcast, tx)).toBe(0);
    });
  });
});

describe("NotificationRepository concurrency (mark storms)", () => {
  // ─── Tier 3: chaos/concurrency ──────────────────────────────────────

  test("concurrent markReadOnce on the SAME row: all settle, row flips once, no duplicates", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const [seeded] = await seedRows(tx, buildInserts(user.id, [{ type: NotificationType.SessionRequest }]));
      if (!seeded) throw new Error("expected seeded row");

      const settled = await Promise.allSettled([
        NotificationRepository.markReadOnce(seeded.id, user.id, tx),
        NotificationRepository.markReadOnce(seeded.id, user.id, tx),
        NotificationRepository.markReadOnce(seeded.id, user.id, tx),
      ]);

      expect(settled).toHaveLength(3);
      const rows = settled.map(outcome => fulfilledValue(outcome));
      for (const row of rows) {
        expect(row).not.toBeNull();
        expect(row?.id).toBe(seeded.id);
        // Every caller observes the row read — the guarded UPDATE matches
        // already-read rows and returns them unchanged.
        expect(row?.isRead).toBe(true);
      }

      const persisted = await readUserRows(tx, user.id);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.isRead).toBe(true);
    });
  });

  test("concurrent markReadOnce on distinct rows of one user: every row flips, unread hits 0", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const seeded = await seedRows(
        tx,
        buildInserts(user.id, [
          { type: NotificationType.SessionRequest },
          { type: NotificationType.SessionCompletion },
          { type: NotificationType.SessionCancellation },
        ])
      );
      expect(await NotificationRepository.countUnread(user.id, tx)).toBe(3);

      const settled = await Promise.allSettled(
        seeded.map(row => NotificationRepository.markReadOnce(row.id, user.id, tx))
      );

      expect(settled).toHaveLength(3);
      for (const outcome of settled) {
        expect(outcome.status).toBe("fulfilled");
        expect(fulfilledValue(outcome)?.isRead).toBe(true);
      }
      expect(await NotificationRepository.countUnread(user.id, tx)).toBe(0);
    });
  });

  test("paired markAllReadForUser sweeps: exactly one sweep reports the rows", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await seedRows(
        tx,
        buildInserts(user.id, [
          { type: NotificationType.SystemBroadcast },
          { type: NotificationType.SystemBroadcast },
          { type: NotificationType.SystemBroadcast },
        ])
      );

      const settled = await Promise.allSettled([
        NotificationRepository.markAllReadForUser(user.id, null, tx),
        NotificationRepository.markAllReadForUser(user.id, null, tx),
      ]);

      const counts = settled.map(outcome => fulfilledValue(outcome) ?? -1).toSorted((a, b) => a - b);
      // The is_read=false guard makes the double-sweep cheap and
      // race-free: whichever sweep runs first flips all 3, the second
      // matches nothing.
      expect(counts).toEqual([0, 3]);
      expect(await NotificationRepository.countUnread(user.id, tx)).toBe(0);
    });
  });

  test("mixed storm: markAllReadForUser racing markReadOnce — inbox ends fully read", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const seeded = await seedRows(
        tx,
        buildInserts(user.id, [{ type: NotificationType.SessionRequest }, { type: NotificationType.SessionCompletion }])
      );
      const [firstRow, secondRow] = seeded;
      if (!firstRow || !secondRow) throw new Error("expected two seeded rows");

      const settled = await Promise.allSettled([
        NotificationRepository.markAllReadForUser(user.id, null, tx),
        NotificationRepository.markReadOnce(firstRow.id, user.id, tx),
        NotificationRepository.markReadOnce(secondRow.id, user.id, tx),
      ]);

      for (const outcome of settled) {
        expect(outcome.status).toBe("fulfilled");
      }
      // The guarded single-row marks return their row regardless of whether
      // the sweep or the mark won the race.
      expect(fulfilledValue(settled[1])).not.toBeNull();
      expect(fulfilledValue(settled[2])).not.toBeNull();

      // Whatever the interleaving: fully read, zero duplicates.
      expect(await NotificationRepository.countUnread(user.id, tx)).toBe(0);
      expect(await readUserRows(tx, user.id)).toHaveLength(2);
    });
  });
});
