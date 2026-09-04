/**
 * ParentLinkRequestRepository — data-access layer for the
 * `parent_link_requests` append-and-transition table (parent→student link
 * requests).
 *
 * Every row starts `pending` (schema default) and moves through the
 * `link_status` lifecycle; rows are never deleted in production flows, so
 * the table doubles as the pair's request history. All state transitions
 * are SINGLE guarded `UPDATE … WHERE <ownership + liveness predicates>
 * RETURNING *` statements — the predicate evaluation and the column
 * mutation occur in the same SQL statement, so there is NO read-then-write
 * window (zero TOCTOU), no `SELECT FOR UPDATE`, and no advisory locks.
 * Ownership predicates (BOLA) are folded INTO the UPDATE WHERE-clause: a
 * foreign or nonexistent id matches zero rows, indistinguishably
 * (precedent: `NotificationRepository.markReadOnce`).
 *
 * Liveness is the strict `expires_at > <now>` predicate inlined into the
 * claim/withdraw guards; the repository never derives liveness on reads —
 * reads return stored rows faithfully and the service layer owns the
 * render-time expiry mapping and the raw-23505 → domain-error
 * classification (the partial unique index
 * `parent_link_requests_pending_pair_unique` is the final arbiter against
 * duplicate-pending rows; the losing insert surfaces 23505 unchanged).
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - All methods take `tx` LAST. Writes take a REQUIRED `tx: DBTransaction`
 *    so every transition joins the caller's atomic unit — a repo
 *    write can never silently escape a transaction. Reads take an OPTIONAL
 *    `tx?: DBQueryExecutor`: Drizzle select on the supplied transaction, or
 *    raw parameterized SQL via `queryDb` (Neon HTTP fast path) when called
 *    standalone — mirroring `StudentRepository.findById`.
 *  - No business logic, no permission checks, no localized strings, no
 *    `console.*` — the service layer translates raw outcomes (null / count /
 *    thrown 23505) into typed `DomainError`s.
 *  - No LIKE/ILIKE anywhere: every predicate is parameterized
 *    equality/liveness on indexed columns.
 *  - Joined-row shapes are repo-local exported interfaces mirroring the
 *    `AdminUserDirectoryRow` precedent (`backend/db/repo/admin/`): readonly,
 *    closed, composed from raw columns + exactly one joined counterpart
 *    name column; the raw pgEnum string union is carried as-is and the
 *    service re-applies the canonical `LinkStatus` via `isLinkStatus`.
 */
import { and, desc, eq, gt, lte, ne } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { users } from "@/backend/db/schema/users/users";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import type { DBQueryExecutor, DBTransaction, ParentLinkRequestSelectType } from "@/backend/types";

/** Hard cap on list reads — the `LIMIT 50` listing contract. */
const LIST_LIMIT = 50;

/** The raw pgEnum string union mirrored from `ParentLinkRequestSelectType["status"]`. */
export type RawLinkStatus = ParentLinkRequestSelectType["status"];

/**
 * Raw joined row for the requesting parent's view (outgoing list +
 * `findOutgoingRowById`): the request columns plus the STUDENT counterpart
 * display name joined from `users` via `student_id`. The service maps
 * `studentFullName` to the masked `studentMaskedName` wire shape — the raw
 * student identity never crosses the service boundary.
 */
export interface OutgoingParentLinkRequestRow {
  readonly id: number;
  readonly parentId: number;
  readonly studentId: number;
  readonly status: RawLinkStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt: Date | null;
  readonly studentFullName: string;
}

/**
 * Raw joined row for the deciding student's view (incoming list +
 * `findIncomingRowById`): the request columns plus the PARENT counterpart
 * display name joined from `users` via `parent_id`.
 */
export interface IncomingParentLinkRequestRow {
  readonly id: number;
  readonly parentId: number;
  readonly studentId: number;
  readonly status: RawLinkStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt: Date | null;
  readonly parentFullName: string;
}

/** Type guard — narrows `DBQueryExecutor` to `DBTransaction` (Drizzle executor). */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

/** The fixed joined projection for parent-facing (outgoing) reads. */
const OUTGOING_ROW_SHAPE = {
  id: parentLinkRequests.id,
  parentId: parentLinkRequests.parentId,
  studentId: parentLinkRequests.studentId,
  status: parentLinkRequests.status,
  createdAt: parentLinkRequests.createdAt,
  expiresAt: parentLinkRequests.expiresAt,
  respondedAt: parentLinkRequests.respondedAt,
  studentFullName: users.fullName,
} as const;

/** The fixed joined projection for student-facing (incoming) reads. */
const INCOMING_ROW_SHAPE = {
  id: parentLinkRequests.id,
  parentId: parentLinkRequests.parentId,
  studentId: parentLinkRequests.studentId,
  status: parentLinkRequests.status,
  createdAt: parentLinkRequests.createdAt,
  expiresAt: parentLinkRequests.expiresAt,
  respondedAt: parentLinkRequests.respondedAt,
  parentFullName: users.fullName,
} as const;

/** Shared ordering: newest first, deterministic tie-break by id DESC. */
const LIST_ORDER = [desc(parentLinkRequests.createdAt), desc(parentLinkRequests.id)] as const;

export namespace ParentLinkRequestRepository {
  /**
   * Inserts a new link request with the schema-default `pending` status.
   *
   * BOPLA: the insert payload is EXACTLY the three supplied fields —
   * `parentId`, `studentId`, `expiresAt` — written field-by-field (no
   * spread of any caller-supplied object). `status`/`createdAt` come from
   * the schema defaults. Requires a transaction so the insert joins the
   * service's atomic unit (notification row + publish receipt).
   *
   * The partial unique index `parent_link_requests_pending_pair_unique`
   * rejects a second live `pending` row for the same (parent, student)
   * pair — under the creation race the LOSING insert throws the raw
   * PostgreSQL `23505` unique-violation, which this repository propagates
   * UNCHANGED (the service owns the final `PARENT_LINK_ALREADY_PENDING`
   * mapping).
   *
   * @returns The inserted row (`status: "pending"`, `respondedAt: null`).
   */
  export async function create(
    input: { parentId: number; studentId: number; expiresAt: Date },
    tx: DBTransaction
  ): Promise<ParentLinkRequestSelectType> {
    const [row] = await tx
      .insert(parentLinkRequests)
      .values({
        parentId: input.parentId,
        studentId: input.studentId,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) {
      throw new Error("ParentLinkRequestRepository.create: insert returned no rows");
    }
    return row;
  }

  /**
   * Reads one request row by primary key (classifier read).
   *
   * Read-only, lock-free. Returns the row FAITHFULLY — including
   * non-`pending` and past-`expiresAt` rows; liveness classification is the
   * service's concern.
   *
   * @returns The matching row, or `null` when no row carries that id.
   */
  export async function findById(id: number, tx?: DBQueryExecutor): Promise<ParentLinkRequestSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      const rows = await tx.select().from(parentLinkRequests).where(eq(parentLinkRequests.id, id)).limit(1);
      return rows[0] ?? null;
    }
    const result = await queryDb<ParentLinkRequestSelectType>(
      `SELECT id, parent_id AS "parentId", student_id AS "studentId", status,
              created_at AS "createdAt", expires_at AS "expiresAt", responded_at AS "respondedAt"
       FROM parent_link_requests
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Reads the live `pending` request for one (parent, student) pair.
   *
   * @returns The pending row, or `null` when the pair has no live pending
   *          request (never-pending, resolved, or expired — the caller owns
   *          the distinction via `findById`).
   */
  export async function findPendingByPair(
    parentId: number,
    studentId: number,
    tx?: DBQueryExecutor
  ): Promise<ParentLinkRequestSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      const rows = await tx
        .select()
        .from(parentLinkRequests)
        .where(
          and(
            eq(parentLinkRequests.parentId, parentId),
            eq(parentLinkRequests.studentId, studentId),
            eq(parentLinkRequests.status, LinkStatus.Pending)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    }
    const result = await queryDb<ParentLinkRequestSelectType>(
      `SELECT id, parent_id AS "parentId", student_id AS "studentId", status,
              created_at AS "createdAt", expires_at AS "expiresAt", responded_at AS "respondedAt"
       FROM parent_link_requests
       WHERE parent_id = $1 AND student_id = $2 AND status = $3
       LIMIT 1`,
      [parentId, studentId, LinkStatus.Pending]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Atomically claims a pending request for the deciding student.
   *
   * ONE guarded statement: the ownership predicate (`student_id`), the
   * state predicate (`status = 'pending'`) and the liveness predicate
   * (`expires_at > now`, STRICT — a claim attempted exactly AT the expiry
   * instant matches zero rows) are all inlined into the UPDATE WHERE-clause
   * with `RETURNING *`; there is no read-then-write window. `target` is the
   * canonical post-claim status (`confirmed` on accept, `rejected` on
   * reject) and `now` is the caller-captured instant stamped into
   * `responded_at`.
   *
   * @returns The updated row, or `null` when the guard matched zero rows
   *          (nonexistent id ≡ foreign owner ≡ already-resolved ≡ expired —
   *          indistinguishable by design; the service re-classifies via
   *          `findById`).
   */
  export async function respondToPendingForStudent(
    requestId: number,
    studentId: number,
    target: LinkStatus.Confirmed | LinkStatus.Rejected,
    now: Date,
    tx: DBTransaction
  ): Promise<ParentLinkRequestSelectType | null> {
    const [row] = await tx
      .update(parentLinkRequests)
      .set({ status: target, respondedAt: now })
      .where(
        and(
          eq(parentLinkRequests.id, requestId),
          eq(parentLinkRequests.studentId, studentId),
          eq(parentLinkRequests.status, LinkStatus.Pending),
          gt(parentLinkRequests.expiresAt, now)
        )
      )
      .returning();
    return row ?? null;
  }

  /**
   * Atomically withdraws a pending request for the requesting parent.
   *
   * ONE guarded statement folding the ownership predicate (`parent_id`),
   * the state predicate and the same strict liveness predicate into the
   * UPDATE WHERE-clause. Withdrawal FOLDS to `rejected` (a silent fold) — the
   * flipped row persists forever as request history and the withdrawal is
   * silent (no notification semantics at this layer).
   *
   * @returns The updated row, or `null` when the guard matched zero rows
   *          (same zero-row collapse as `respondToPendingForStudent`).
   */
  export async function cancelPendingForParent(
    requestId: number,
    parentId: number,
    now: Date,
    tx: DBTransaction
  ): Promise<ParentLinkRequestSelectType | null> {
    const [row] = await tx
      .update(parentLinkRequests)
      .set({ status: LinkStatus.Rejected, respondedAt: now })
      .where(
        and(
          eq(parentLinkRequests.id, requestId),
          eq(parentLinkRequests.parentId, parentId),
          eq(parentLinkRequests.status, LinkStatus.Pending),
          gt(parentLinkRequests.expiresAt, now)
        )
      )
      .returning();
    return row ?? null;
  }

  /**
   * Materializes the `expired` status on one request IF it is still
   * `pending`.
   *
   * Idempotent BY PREDICATE: the `status = 'pending'` conjunct makes a
   * second call (row already `expired`/`confirmed`/`rejected`) match zero
   * rows — double-materialization is a no-op, never an error. The service
   * invokes this on the pending-but-stale claim arm and on lazily observed
   * stale rows. `responded_at` is intentionally left NULL (expiry is not a
   * participant response).
   */
  export async function markExpiredIfPending(requestId: number, tx: DBTransaction): Promise<void> {
    await tx
      .update(parentLinkRequests)
      .set({ status: LinkStatus.Expired })
      .where(and(eq(parentLinkRequests.id, requestId), eq(parentLinkRequests.status, LinkStatus.Pending)));
  }

  /**
   * Bulk-materializes the `expired` status on EVERY lapsed live pending row
   * (the bulk sweep primitive — the unit of work a future cron-stream
   * scheduler registers as its job handler).
   *
   * ONE set-based guarded statement: `WHERE status = 'pending' AND
   * expires_at <= now` — the expiry side of the strict-`>` liveness
   * boundary: a row whose `expires_at` equals the sweep instant IS lapsed
   * (the same deterministic boundary the respond path pins at chaos tier,
   * `parent-link-request.chaos.test.ts` "confirm-during-expiry instant").
   * The `status = 'pending'` conjunct makes re-runs match zero rows —
   * idempotent by predicate, never an error. `responded_at` is intentionally
   * left NULL (expiry is not a participant response), and the sweep performs
   * ZERO notifications and ZERO audit rows (full silence —
   * expiry has no audience-facing event; the read side already renders the
   * computed `Expired` chip, so materialization changes storage only).
   *
   * Actor-less by design: this is a system maintenance write, not a user
   * operation — the fresh actor re-check governs user-facing mutations; a
   * future cron-stream job owns the trigger identity and its guard.
   * The write takes a REQUIRED `tx` per the repo convention (a
   * repo write can never silently escape a transaction); the sweep is one
   * statement, so the transaction IS the atomic unit.
   *
   * @param now The single captured sweep instant (strict-`>` boundary side).
   * @param tx  The caller's transaction (required for every write).
   * @returns The number of rows materialized to `expired` (0 on a re-run).
   */
  export async function markAllExpiredIfPending(now: Date, tx: DBTransaction): Promise<number> {
    // No `.returning()` — only the affected-row count is consumed, and
    // shipping every expired id to the application would grow memory and
    // transaction duration with the backlog (same pattern as
    // `markAllReadForUser` in the notifications repository).
    const result = await tx
      .update(parentLinkRequests)
      .set({ status: LinkStatus.Expired })
      .where(and(eq(parentLinkRequests.status, LinkStatus.Pending), lte(parentLinkRequests.expiresAt, now)));
    return result.rowCount ?? 0;
  }

  /**
   * Expires every OTHER live `pending` request addressed to one student.
   *
   * ONE set-based guarded statement: `WHERE student_id = ? AND
   * status = 'pending' AND id <> ?` — the `id <>` conjunct excludes the
   * winning request (the one being confirmed). Already-resolved rows never
   * match, so confirmed/rejected history is untouched.
   *
   * @returns The number of sibling rows expired (0 when none).
   */
  export async function expireSiblingPendingsForStudent(
    studentId: number,
    winnerRequestId: number,
    tx: DBTransaction
  ): Promise<number> {
    const rows = await tx
      .update(parentLinkRequests)
      .set({ status: LinkStatus.Expired })
      .where(
        and(
          eq(parentLinkRequests.studentId, studentId),
          eq(parentLinkRequests.status, LinkStatus.Pending),
          ne(parentLinkRequests.id, winnerRequestId)
        )
      )
      .returning({ id: parentLinkRequests.id });
    return rows.length;
  }

  /**
   * Lists the requesting parent's link requests, newest first, with the
   * student counterpart display name joined from `users`.
   *
   * Deterministic ordering: `created_at DESC, id DESC` (id tie-break makes
   * same-instant rows — e.g. inserts sharing one transaction timestamp —
   * totally ordered). Capped at `LIMIT 50`. All statuses are returned
   * faithfully; render-time expiry mapping is the service's concern.
   *
   * @returns At most 50 joined rows, deterministic order.
   */
  export async function listOutgoingForParent(
    parentId: number,
    tx?: DBQueryExecutor
  ): Promise<OutgoingParentLinkRequestRow[]> {
    if (tx && isDBTransaction(tx)) {
      return tx
        .select(OUTGOING_ROW_SHAPE)
        .from(parentLinkRequests)
        .innerJoin(users, eq(users.id, parentLinkRequests.studentId))
        .where(eq(parentLinkRequests.parentId, parentId))
        .orderBy(...LIST_ORDER)
        .limit(LIST_LIMIT);
    }
    const result = await queryDb<OutgoingParentLinkRequestRow>(
      `SELECT r.id, r.parent_id AS "parentId", r.student_id AS "studentId", r.status,
              r.created_at AS "createdAt", r.expires_at AS "expiresAt", r.responded_at AS "respondedAt",
              u.full_name AS "studentFullName"
       FROM parent_link_requests r
       JOIN users u ON u.id = r.student_id
       WHERE r.parent_id = $1
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${LIST_LIMIT}`,
      [parentId]
    );
    return result.rows;
  }

  /**
   * Lists the deciding student's incoming link requests, newest first, with
   * the parent counterpart display name joined from `users` (via
   * `parent_id`). Same ordering/cap contract as `listOutgoingForParent`.
   *
   * @returns At most 50 joined rows, deterministic order.
   */
  export async function listIncomingForStudent(
    studentId: number,
    tx?: DBQueryExecutor
  ): Promise<IncomingParentLinkRequestRow[]> {
    if (tx && isDBTransaction(tx)) {
      return tx
        .select(INCOMING_ROW_SHAPE)
        .from(parentLinkRequests)
        .innerJoin(users, eq(users.id, parentLinkRequests.parentId))
        .where(eq(parentLinkRequests.studentId, studentId))
        .orderBy(...LIST_ORDER)
        .limit(LIST_LIMIT);
    }
    const result = await queryDb<IncomingParentLinkRequestRow>(
      `SELECT r.id, r.parent_id AS "parentId", r.student_id AS "studentId", r.status,
              r.created_at AS "createdAt", r.expires_at AS "expiresAt", r.responded_at AS "respondedAt",
              u.full_name AS "parentFullName"
       FROM parent_link_requests r
       JOIN users u ON u.id = r.parent_id
       WHERE r.student_id = $1
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${LIST_LIMIT}`,
      [studentId]
    );
    return result.rows;
  }

  /**
   * Reads ONE outgoing joined row by request id (parent-facing payload
   * source for the cancel SUCCESS path).
   *
   * @returns The joined row, or `null` when no row carries that id.
   */
  export async function findOutgoingRowById(
    requestId: number,
    tx?: DBQueryExecutor
  ): Promise<OutgoingParentLinkRequestRow | null> {
    if (tx && isDBTransaction(tx)) {
      const rows = await tx
        .select(OUTGOING_ROW_SHAPE)
        .from(parentLinkRequests)
        .innerJoin(users, eq(users.id, parentLinkRequests.studentId))
        .where(eq(parentLinkRequests.id, requestId))
        .limit(1);
      return rows[0] ?? null;
    }
    const result = await queryDb<OutgoingParentLinkRequestRow>(
      `SELECT r.id, r.parent_id AS "parentId", r.student_id AS "studentId", r.status,
              r.created_at AS "createdAt", r.expires_at AS "expiresAt", r.responded_at AS "respondedAt",
              u.full_name AS "studentFullName"
       FROM parent_link_requests r
       JOIN users u ON u.id = r.student_id
       WHERE r.id = $1
       LIMIT 1`,
      [requestId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Reads ONE incoming joined row by request id (student-facing payload
   * source for the respond SUCCESS path).
   *
   * @returns The joined row, or `null` when no row carries that id.
   */
  export async function findIncomingRowById(
    requestId: number,
    tx?: DBQueryExecutor
  ): Promise<IncomingParentLinkRequestRow | null> {
    if (tx && isDBTransaction(tx)) {
      const rows = await tx
        .select(INCOMING_ROW_SHAPE)
        .from(parentLinkRequests)
        .innerJoin(users, eq(users.id, parentLinkRequests.parentId))
        .where(eq(parentLinkRequests.id, requestId))
        .limit(1);
      return rows[0] ?? null;
    }
    const result = await queryDb<IncomingParentLinkRequestRow>(
      `SELECT r.id, r.parent_id AS "parentId", r.student_id AS "studentId", r.status,
              r.created_at AS "createdAt", r.expires_at AS "expiresAt", r.responded_at AS "respondedAt",
              u.full_name AS "parentFullName"
       FROM parent_link_requests r
       JOIN users u ON u.id = r.parent_id
       WHERE r.id = $1
       LIMIT 1`,
      [requestId]
    );
    return result.rows[0] ?? null;
  }
}
