/**
 * Users hard-delete guard — database probe tier for the GUC-gated
 * `prevent_users_delete` trigger (`backend/db/migration/14-prevent-users-delete.sql`).
 *
 * The application layer has zero hard-delete paths for `users`; this probe
 * proves the DATABASE-tier backstop for the raw-SQL hole the app layer
 * cannot see:
 *
 *  1. Trigger-presence probe — `pg_trigger` must carry
 *     `prevent_users_delete_trigger` on `users`, wired as an enabled
 *     row-level BEFORE DELETE trigger (wiring proven from the `tgtype`
 *     bitmask, firing state from `tgenabled` — a disabled trigger never
 *     guards).
 *
 *  2. Armed-guard tamper probe — inside `runInRollback`, the guard is
 *     re-armed transaction-locally via
 *     `SELECT set_config('kottaby.users_delete_guard', 'on', true)` (the
 *     setting auto-reverts at rollback), then a direct `tx.delete(users)`
 *     is bracketed in its own SAVEPOINT and MUST throw the trigger's
 *     RAISE text with the row surviving. The production-default leg pins
 *     the same rejection with the GUC set to the empty string — the
 *     coalesced value an unset (never-configured) connection sees.
 *
 *  3. Environment branch — on push-provisioned databases the trigger is
 *     absent, so the DB-layer backstop is the restrict-FK chain instead:
 *     a user with an `audit_logs` actor row hard-deletes into SQLSTATE
 *     23503 (`audit_logs_actor_id_users_id_fkey`). The branch mirrors the
 *     audit-immutability trigger-tier pattern.
 *
 *  4. Test-path opt-out pin — every pooled test connection inherits
 *     `kottaby.users_delete_guard=off` from the DB client's startup
 *     options packet (`backend/db/client.ts`), so the SAME hard DELETE
 *     proceeds — teardown hard-deletes of fixture users stay green with
 *     zero test-helper edits. A second transaction proves the
 *     transaction-local re-arm never leaks past its rollback.
 *
 * DB SAFETY: every database statement runs inside `runInRollback` with the
 * `tx` passed through; each expected-failure statement is bracketed in its
 * own SAVEPOINT via the shared probe scaffold (a raised exception never
 * aborts the outer transaction — never `rejects.toThrow()`, which
 * deadlocks the rollback wrapper); fixture users are created via the
 * entity-setup helper, never queried from seed data.
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { auditLogs, users } from "@/backend/db/schema";
import { createTestUser } from "@/backend/db/test/entity-setup";
import {
  expectFkViolation,
  expectTriggerRaise,
  probeInsideSavepoint,
} from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { DBTransaction } from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/** The users-delete guard trigger the canonical migration installs. */
const USERS_DELETE_GUARD_TRIGGER = "prevent_users_delete_trigger";
/** Raised message substring (canonical migration DDL). */
const USERS_DELETE_RAISE_TEXT = "users is not hard-deletable";
/** Custom GUC gating the guard; armed whenever the value is anything but 'off'. */
const USERS_DELETE_GUARD_GUC = "kottaby.users_delete_guard";
/** The restrict-FK that blocks a user hard-delete with audit history. */
const AUDIT_ACTOR_FK = "audit_logs_actor_id_users_id_fkey";

/** `pg_trigger.tgtype` bit values (PostgreSQL trigger type bitmask). */
const TGTYPE_ROW = 1;
const TGTYPE_BEFORE = 2;
const TGTYPE_DELETE = 8;

// ─── Probe helpers ───────────────────────────────────────────────────────────

/** Presence + firing wiring of the users-delete guard trigger. */
interface UsersDeleteGuardState {
  readonly installed: boolean;
  readonly enforcing: boolean;
}

/**
 * True when the guard trigger is installed AND fires for application-origin
 * DML: enabled (`tgenabled` 'O'/'A' — a disabled or replica-only trigger
 * never guards), row-level, BEFORE timing, bound to DELETE.
 */
async function probeUsersDeleteGuard(tx: DBTransaction): Promise<UsersDeleteGuardState> {
  const discovered = await tx.execute<{
    tgname: string;
    tgenabled: string;
    isBefore: boolean;
    isRowLevel: boolean;
    onDelete: boolean;
  }>(
    sql`SELECT
          tgname,
          tgenabled,
          (tgtype & ${TGTYPE_BEFORE}) > 0 AS "isBefore",
          (tgtype & ${TGTYPE_ROW}) > 0 AS "isRowLevel",
          (tgtype & ${TGTYPE_DELETE}) > 0 AS "onDelete"
        FROM pg_trigger
        WHERE tgrelid = 'users'::regclass AND NOT tgisinternal AND tgname = ${USERS_DELETE_GUARD_TRIGGER}`
  );
  const row = discovered.rows.at(0);
  if (row === undefined) {
    return { installed: false, enforcing: false };
  }
  const firesForApplicationDml = row.tgenabled === "O" || row.tgenabled === "A";
  return {
    installed: true,
    enforcing: firesForApplicationDml && row.isBefore && row.isRowLevel && row.onDelete,
  };
}

/**
 * Overrides the guard GUC for THIS transaction only (`is_local = true` — the
 * setting reverts at rollback/commit and never leaks to the pooled
 * connection's inherited startup value).
 */
async function setGuardGucTransactionLocally(tx: DBTransaction, value: string): Promise<void> {
  await tx.execute(sql`SELECT set_config(${USERS_DELETE_GUARD_GUC}, ${value}, true)`);
}

/** INSERTs one audit row referencing the fixture user (restrict-FK dependent). */
async function insertAuditRowFor(tx: DBTransaction, userId: number): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId: userId,
    actionType: AuditActionType.Create,
    entityType: "user",
    entityId: userId,
    details: null,
  });
}

/** Independent read-back oracle — proves the fixture user is really there. */
async function expectUserPresent(tx: DBTransaction, id: number): Promise<void> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  expect(rows).toHaveLength(1);
}

/** Independent read-back oracle — proves the hard delete really happened. */
async function expectUserAbsent(tx: DBTransaction, id: number): Promise<void> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  expect(rows).toHaveLength(0);
}

const describeTriggerTier = isPgliteProvider() ? describe.skip : describe;

// ─── Tier 1: trigger presence ───────────────────────────────────────────────

describeTriggerTier("users hard-delete guard — database probe tier", () => {
  test("the guard trigger is installed on users as an enabled row-level BEFORE DELETE trigger", async () => {
    await runInRollback(async tx => {
      // Push-provisioned environments install no trigger — the behavioral
      // proof there is the restrict-FK leg below.
      const guard = await probeUsersDeleteGuard(tx);
      if (!guard.installed) {
        return;
      }
      expect(guard.enforcing).toBe(true);
    });
  });

  test("a raw hard DELETE of a fixture user is rejected with the row surviving (restrict-FK class when the trigger is absent)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const guard = await probeUsersDeleteGuard(tx);
      if (guard.enforcing) {
        await setGuardGucTransactionLocally(tx, "on");
        const error = await probeInsideSavepoint(tx, "armed users delete probe", () =>
          tx.delete(users).where(eq(users.id, user.id))
        );
        expectTriggerRaise(error, USERS_DELETE_RAISE_TEXT);
      } else {
        await insertAuditRowFor(tx, user.id);
        const error = await probeInsideSavepoint(tx, "push provisioned users delete probe", () =>
          tx.delete(users).where(eq(users.id, user.id))
        );
        expectFkViolation(error, AUDIT_ACTOR_FK);
      }
      await expectUserPresent(tx, user.id);
    });
  });

  test("production-default posture: an unset (empty) guard GUC rejects the same hard DELETE", async () => {
    await runInRollback(async tx => {
      const guard = await probeUsersDeleteGuard(tx);
      if (!guard.enforcing) {
        return;
      }
      const user = await createTestUser(tx);
      // The empty string is exactly what `current_setting(..., true)`
      // coalesces to on a connection that never configured the GUC —
      // the production default must keep the guard armed.
      await setGuardGucTransactionLocally(tx, "");
      const error = await probeInsideSavepoint(tx, "unset guard users delete probe", () =>
        tx.delete(users).where(eq(users.id, user.id))
      );
      expectTriggerRaise(error, USERS_DELETE_RAISE_TEXT);
      await expectUserPresent(tx, user.id);
    });
  });

  test("the inherited test-path opt-out lets the same hard DELETE proceed (teardown parity)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await tx.delete(users).where(eq(users.id, user.id));
      await expectUserAbsent(tx, user.id);
    });
  });

  test("the transaction-local re-arm never leaks past its rollback", async () => {
    await runInRollback(async tx => {
      const guard = await probeUsersDeleteGuard(tx);
      if (!guard.enforcing) {
        return;
      }
      const user = await createTestUser(tx);
      await setGuardGucTransactionLocally(tx, "on");
      const error = await probeInsideSavepoint(tx, "re-arm leak probe", () =>
        tx.delete(users).where(eq(users.id, user.id))
      );
      expectTriggerRaise(error, USERS_DELETE_RAISE_TEXT);
    });
    // Fresh transaction: the is_local re-arm above reverted at rollback, so
    // the connection's inherited opt-out is in force again.
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await tx.delete(users).where(eq(users.id, user.id));
      await expectUserAbsent(tx, user.id);
    });
  });
});
