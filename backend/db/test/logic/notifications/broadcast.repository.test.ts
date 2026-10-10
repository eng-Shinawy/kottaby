/**
 * BroadcastRepository tests — the `broadcasts` header table's data-access
 * surface (`create`, `findByIdempotencyKey`, `list` + `count`, `findById`,
 * `transitionToStopped`) across the full path family.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md`:
 *  - Every case runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call and direct Drizzle query. Uncommitted fixtures are invisible to
 *    the global `db` handle, so a successful in-tx read is itself the
 *    tx-propagation proof (pinned explicitly below); the no-transaction
 *    read branches are covered by post-rollback pool reads against the
 *    committed database (run-unique keys — the committed DB never saw the
 *    fixtures, so a `null` / `[]` there is exact).
 *  - Writes (`create`, `transitionToStopped`) take a REQUIRED `tx` — the
 *    repository's own signature enforces the transaction discipline, so
 *    there is no unguarded committed-write branch to cover.
 *  - Fixtures are created ONLY via `entity-setup.ts` helpers
 *    (`createTestUser` for senders/stoppers) plus direct broadcast inserts
 *    (no entity-setup helper exists for that table) — never seed data, and
 *    never the repository under test for setup.
 *  - Every error case uses the `expectRepoError` try/catch helper — never
 *    `.rejects.toThrow()`.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): `create` persists the verbatim copy with
 *    the DB-generated id/status/`sentAt`; `findByIdempotencyKey` found +
 *    null miss; `list`/`count` share one predicate builder with honest
 *    totals and the `sent_at DESC, id DESC` order; `findById` resolves the
 *    sender/stopper names via the SAME-query joins; the CAS stop wins once
 *    and reports zero rows on both miss branches.
 *  - Tier 2 (boundary): all-null audience snapshots; unicode/RTL titles
 *    round-trip verbatim; page-window edges (limit caps, offset past the
 *    end with the honest total unchanged); empty result sets.
 *  - Tier 3 (concurrency): two concurrent CAS stops on one active
 *    broadcast — exactly one winner.
 *  - Tier 4 (hostile input): ILIKE wildcard probes (`%`, `_`, `\` stored
 *    in titles stay inert; escaped search terms cannot widen the match);
 *    SQL-flavored search payloads stay bound parameters; a duplicate
 *    idempotency key raises the PostgreSQL `23505` unique violation
 *    translated into a `ConflictError`.
 *  - Schema contract: both user FKs are index-backed —
 *    `broadcasts_sent_by_id_idx` and `broadcasts_stopped_by_id_idx` are
 *    asserted live in `pg_indexes` as btrees with their FK column as the
 *    key column (the sender/stopper joins never seq-scan).
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { type BroadcastEntryRow, BroadcastRepository } from "@/backend/db/repo";
import { broadcasts } from "@/backend/db/schema/notifications/broadcasts";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { BroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { ConflictError } from "@/backend/lib/errors";
import type { BroadcastSelectType, DBTransaction } from "@/backend/types";

/** Run-unique token so fixtures and probes never collide across runs. */
function uniqueToken(): string {
  return randomUUID().slice(0, 8);
}

/** Run-unique title with a stable prefix so filter sets are exact. */
function uniqueTitle(prefix: string): string {
  return `${prefix}-${uniqueToken()}`;
}

/** The final escaped + `%…%`-wrapped ILIKE pattern (the service's mapping). */
function titlePattern(raw: string): string {
  return `%${escapeLikeWildcards(raw)}%`;
}

/**
 * Shape of one direct broadcast insert (no entity-setup helper exists).
 * Only fields a fixture needs; the DB generates the id, the `active`
 * status default, and `sentAt` unless overridden.
 */
interface BroadcastSpec {
  readonly title: string;
  readonly body?: string;
  readonly audienceType?: "all" | "role" | "country" | "plan";
  readonly audienceRole?: "admin" | "teacher" | "student" | "parent";
  readonly audienceCountry?: string | null;
  readonly audiencePlanId?: number | null;
  readonly status?: "active" | "stopped";
  readonly recipientCount?: number;
  readonly sentById: number;
  readonly sentAt?: Date;
  readonly stoppedById?: number | null;
  readonly stoppedAt?: Date | null;
  readonly idempotencyKey?: string | null;
}

/** Seeds one broadcast row directly — setup only, never the repo under test. */
async function insertBroadcast(tx: DBTransaction, spec: BroadcastSpec): Promise<BroadcastSelectType> {
  const [row] = await tx
    .insert(broadcasts)
    .values({
      title: spec.title,
      body: spec.body ?? "broadcast body copy",
      audienceType: spec.audienceType,
      audienceRole: spec.audienceRole,
      audienceCountry: spec.audienceCountry ?? null,
      audiencePlanId: spec.audiencePlanId ?? null,
      status: spec.status ?? "active",
      recipientCount: spec.recipientCount ?? 3,
      sentById: spec.sentById,
      sentAt: spec.sentAt,
      stoppedById: spec.stoppedById ?? null,
      stoppedAt: spec.stoppedAt ?? null,
      idempotencyKey: spec.idempotencyKey ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("insertBroadcast: insert returned no rows");
  }
  return row;
}

/** Extracts one fixture's entry from a listing — null-guarded for clarity. */
function entryById(rows: readonly BroadcastEntryRow[], id: number): BroadcastEntryRow {
  const row = rows.find(candidate => candidate.id === id);
  if (!row) {
    throw new Error(`fixture entry ${id} missing from the listing`);
  }
  return row;
}

/** Sorted id projection of a listing — filter sets are compared as exact sets. */
function idsOf(page: readonly BroadcastEntryRow[]): number[] {
  return page.map(row => row.id).toSorted((a, b) => a - b);
}

/** Narrows a settled CAS outcome to its row (null = CAS miss). */
function settledRow(outcome: PromiseSettledResult<BroadcastSelectType | null>): BroadcastSelectType | null {
  return outcome.status === "fulfilled" ? outcome.value : null;
}

describe("BroadcastRepository.create", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Tier 1 — persists the verbatim copy and returns the DB-generated columns", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx, { role: UserRole.Admin });
      const title = uniqueTitle("CRT");
      const body = "line one\ntab\there — verbatim copy";

      const row = await BroadcastRepository.create(
        {
          title,
          body,
          audienceType: BroadcastAudienceType.Role,
          audienceRole: UserRole.Teacher,
          audienceCountry: null,
          audiencePlanId: null,
          recipientCount: 42,
          sentById: sender.id,
          idempotencyKey: `key-${uniqueToken()}`,
        },
        tx
      );

      expect(row.id).toBeGreaterThan(0);
      // The status default and the sent-at stamp are database-generated.
      expect(row.status).toBe(BroadcastStatus.Active);
      expect(row.sentAt).toBeInstanceOf(Date);
      // The copy is verbatim, never normalized.
      expect(row.title).toBe(title);
      expect(row.body).toBe(body);
      expect(row.recipientCount).toBe(42);
      expect(row.sentById).toBe(sender.id);
      expect(row.stoppedById).toBeNull();
      expect(row.stoppedAt).toBeNull();
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("Tier 2 — nullable audience snapshot columns persist as null", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);

      const row = await BroadcastRepository.create(
        { title: uniqueTitle("NULLSNAP"), body: "body", recipientCount: 1, sentById: sender.id },
        tx
      );

      expect(row.audienceType).toBeNull();
      expect(row.audienceRole).toBeNull();
      expect(row.audienceCountry).toBeNull();
      expect(row.audiencePlanId).toBeNull();
    });
  });
});

describe("BroadcastRepository.findByIdempotencyKey", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Tier 1 — finds the header row for a claimed key, null for an unclaimed one", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const key = `key-${uniqueToken()}`;
      const created = await insertBroadcast(tx, {
        title: uniqueTitle("IDEM"),
        sentById: sender.id,
        idempotencyKey: key,
      });

      const found = await BroadcastRepository.findByIdempotencyKey(key, tx);
      expect(found?.id).toBe(created.id);

      const unclaimed = await BroadcastRepository.findByIdempotencyKey(`key-${uniqueToken()}`, tx);
      expect(unclaimed).toBeNull();
    });
  });

  test("Tier 1 — null keys never match (only key-declaring sends are discoverable)", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      await insertBroadcast(tx, { title: uniqueTitle("NULLKEY"), sentById: sender.id, idempotencyKey: null });

      // An empty-string probe is the closest a caller can get to the null
      // rows — the unique index permits multiple NULLs and `= ''` matches
      // none of them.
      const probe = await BroadcastRepository.findByIdempotencyKey("", tx);
      expect(probe).toBeNull();
    });
  });

  // ─── tx propagation + rollback isolation ────────────────────────────

  test("tx propagation — an uncommitted header resolves only through the supplied tx", async () => {
    const key = `key-${uniqueToken()}`;
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const created = await insertBroadcast(tx, {
        title: uniqueTitle("PROP"),
        sentById: sender.id,
        idempotencyKey: key,
      });

      const found = await BroadcastRepository.findByIdempotencyKey(key, tx);
      // Visible through the tx — the read ran on the caller's transaction.
      expect(found?.id).toBe(created.id);
    });

    // After the forced rollback the same key on the global db handle
    // resolves nobody: the committed database never saw the fixture.
    const afterRollback = await BroadcastRepository.findByIdempotencyKey(key);
    expect(afterRollback).toBeNull();
  });
});

describe("BroadcastRepository.list + count", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Tier 1 — lists newest-first (sent_at DESC, id DESC tiebreak) with an honest total", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const initialCount = await BroadcastRepository.count({}, tx);
      const now = Date.now();

      // Explicit sentAt windows pin the DESC order; the two identical
      // timestamps pin the id DESC tiebreak (insertion order: first the
      // tiebreak pair, so the higher id is newest among them).
      const older = await insertBroadcast(tx, {
        title: uniqueTitle("ORD"),
        sentById: sender.id,
        sentAt: new Date(now - 7_200_000),
      });
      const mid = await insertBroadcast(tx, {
        title: uniqueTitle("ORD"),
        sentById: sender.id,
        sentAt: new Date(now - 3_600_000),
      });
      const tieA = await insertBroadcast(tx, {
        title: uniqueTitle("ORD"),
        sentById: sender.id,
        sentAt: new Date(now - 3_600_000),
      });
      const tieB = await insertBroadcast(tx, {
        title: uniqueTitle("ORD"),
        sentById: sender.id,
        sentAt: new Date(now - 3_600_000),
      });
      const newest = await insertBroadcast(tx, {
        title: uniqueTitle("ORD"),
        sentById: sender.id,
        sentAt: new Date(now),
      });
      const createdIdSet = new Set([older.id, mid.id, tieA.id, tieB.id, newest.id]);
      const expectedOrder = [newest.id, tieB.id, tieA.id, mid.id, older.id];

      const page = await BroadcastRepository.list({}, 50, 0, tx);
      // Pre-existing committed rows may interleave — compare only the
      // created fixtures' relative order.
      const createdOrder = page.map(row => row.id).filter(id => createdIdSet.has(id));
      expect(createdOrder).toEqual(expectedOrder);

      const total = await BroadcastRepository.count({}, tx);
      expect(total).toBe(initialCount + createdIdSet.size);
    });
  });

  test("Tier 1 — sender/stopper display names resolve via the SAME-query joins", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx, { role: UserRole.Admin });
      const stopper = await createTestUser(tx, { role: UserRole.Admin });
      const now = Date.now();
      const stopped = await insertBroadcast(tx, {
        title: uniqueTitle("JOIN"),
        sentById: sender.id,
        stoppedById: stopper.id,
        stoppedAt: new Date(now - 60_000),
      });
      const active = await insertBroadcast(tx, { title: uniqueTitle("JOIN"), sentById: sender.id });

      const page = await BroadcastRepository.list({}, 50, 0, tx);

      const stoppedEntry = entryById(page, stopped.id);
      expect(stoppedEntry.sentByName).toBe(sender.fullName);
      expect(stoppedEntry.stoppedByName).toBe(stopper.fullName);
      expect(stoppedEntry.stoppedAt).toEqual(stopped.stoppedAt);

      const activeEntry = entryById(page, active.id);
      expect(activeEntry.sentByName).toBe(sender.fullName);
      // An active broadcast carries no stopper — the LEFT join yields null.
      expect(activeEntry.stoppedByName).toBeNull();
      expect(activeEntry.stoppedAt).toBeNull();
    });
  });

  test("Tier 1 — titleSearch, status, and audienceType filters compose AND-wise", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const prefix = uniqueTitle("FLTR");
      const pattern = titlePattern(prefix);

      const allActive = await insertBroadcast(tx, {
        title: `${prefix} all`,
        sentById: sender.id,
        audienceType: "all",
      });
      const roleActiveAdmin = await insertBroadcast(tx, {
        title: `${prefix} role admin`,
        sentById: sender.id,
        audienceType: "role",
        audienceRole: "admin",
      });
      const roleActiveTeacher = await insertBroadcast(tx, {
        title: `${prefix} role teacher`,
        sentById: sender.id,
        audienceType: "role",
        audienceRole: "teacher",
      });
      const roleStopped = await insertBroadcast(tx, {
        title: `${prefix} role stopped`,
        sentById: sender.id,
        audienceType: "role",
        audienceRole: "teacher",
        status: "stopped",
      });
      const planActive = await insertBroadcast(tx, {
        title: `${prefix} plan`,
        sentById: sender.id,
        audienceType: "plan",
        audiencePlanId: 4_000_000,
      });
      const elsewhere = await insertBroadcast(tx, { title: uniqueTitle("OTHER"), sentById: sender.id });

      const byTitle = await BroadcastRepository.list({ titleSearch: pattern }, 50, 0, tx);
      expect(idsOf(byTitle)).toEqual(
        [allActive, roleActiveAdmin, roleActiveTeacher, roleStopped, planActive]
          .map(row => row.id)
          .toSorted((a, b) => a - b)
      );
      expect(byTitle).toHaveLength(5);
      expect(idsOf(byTitle)).not.toContain(elsewhere.id);

      const byStatusActive = await BroadcastRepository.list(
        { titleSearch: pattern, status: BroadcastStatus.Active },
        50,
        0,
        tx
      );
      expect(idsOf(byStatusActive)).toEqual(
        [allActive.id, roleActiveAdmin.id, roleActiveTeacher.id, planActive.id].toSorted((a, b) => a - b)
      );

      const byStatusStopped = await BroadcastRepository.list(
        { titleSearch: pattern, status: BroadcastStatus.Stopped },
        50,
        0,
        tx
      );
      expect(idsOf(byStatusStopped)).toEqual([roleStopped.id]);

      const byAudienceRole = await BroadcastRepository.list(
        { titleSearch: pattern, audienceType: BroadcastAudienceType.Role },
        50,
        0,
        tx
      );
      expect(idsOf(byAudienceRole)).toEqual(
        [roleActiveAdmin.id, roleActiveTeacher.id, roleStopped.id].toSorted((a, b) => a - b)
      );

      const byAudiencePlan = await BroadcastRepository.list(
        { titleSearch: pattern, audienceType: BroadcastAudienceType.Plan },
        50,
        0,
        tx
      );
      expect(idsOf(byAudiencePlan)).toEqual([planActive.id]);

      // The count shares the same predicate builder — one count per filter
      // family, honest for each.
      expect(await BroadcastRepository.count({ titleSearch: pattern }, tx)).toBe(5);
      expect(await BroadcastRepository.count({ titleSearch: pattern, status: BroadcastStatus.Stopped }, tx)).toBe(1);
      expect(
        await BroadcastRepository.count({ titleSearch: pattern, audienceType: BroadcastAudienceType.Plan }, tx)
      ).toBe(1);
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("Tier 2 — the page window: limit caps rows, offset past the end yields empty items with the honest total", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const now = Date.now();
      const newest = await insertBroadcast(tx, {
        title: uniqueTitle("WIN"),
        sentById: sender.id,
        sentAt: new Date(now),
      });
      const second = await insertBroadcast(tx, {
        title: uniqueTitle("WIN"),
        sentById: sender.id,
        sentAt: new Date(now - 60_000),
      });
      const third = await insertBroadcast(tx, {
        title: uniqueTitle("WIN"),
        sentById: sender.id,
        sentAt: new Date(now - 120_000),
      });
      const createdIdSet = new Set([newest.id, second.id, third.id]);
      const total = await BroadcastRepository.count({}, tx);

      // The limit caps how many rows transfer, never which ones: the two
      // newest of the created set.
      const capped = await BroadcastRepository.list({}, 2, 0, tx);
      const cappedCreated = capped.map(row => row.id).filter(id => createdIdSet.has(id));
      expect(cappedCreated).toEqual([newest.id, second.id]);

      // An offset past the end of the filtered set — empty items, the
      // honest total unchanged (never clamped, never an error).
      const pastEnd = await BroadcastRepository.list({}, 25, 1_000_000, tx);
      expect(pastEnd).toEqual([]);
      expect(await BroadcastRepository.count({}, tx)).toBe(total);
    });
  });

  test("Tier 2 — filters that match nothing yield [] and a zero count", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      await insertBroadcast(tx, { title: uniqueTitle("VOID"), sentById: sender.id });

      const emptyPattern = titlePattern(uniqueTitle("NOMATCH"));
      const page = await BroadcastRepository.list({ titleSearch: emptyPattern }, 25, 0, tx);
      const total = await BroadcastRepository.count({ titleSearch: emptyPattern }, tx);

      expect(page).toEqual([]);
      expect(total).toBe(0);
    });
  });

  test("Tier 2 — unicode and RTL titles round-trip verbatim and match through the escaped pattern", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const token = uniqueToken();
      const title = `إعلان-${token} \u200F مرحبا بكم %100`;

      const created = await insertBroadcast(tx, { title, sentById: sender.id });

      const found = await BroadcastRepository.findById(created.id, tx);
      expect(found?.title).toBe(title);

      // The escaped substring probe finds the RTL title; the stored `%`
      // inside it does not widen the match (the probe is exact).
      const matched = await BroadcastRepository.list({ titleSearch: titlePattern(`إعلان-${token}`) }, 50, 0, tx);
      expect(matched.map(row => row.id)).toEqual([created.id]);

      // A probe that mixes a wildcard into the RTL term matches nothing —
      // unescaped, the `%` would bridge the gap and widen the match.
      const wildProbe = await BroadcastRepository.list(
        { titleSearch: titlePattern(`إعلان-${token}%مرحبا`) },
        50,
        0,
        tx
      );
      expect(wildProbe).toEqual([]);
    });
  });
});

describe("BroadcastRepository.findById", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Tier 1 — resolves the joined row for an existing id, null for a missing one", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx, { role: UserRole.Admin });
      const stopper = await createTestUser(tx, { role: UserRole.Admin });
      const now = Date.now();
      const stopped = await insertBroadcast(tx, {
        title: uniqueTitle("FBI"),
        body: "stopped body",
        sentById: sender.id,
        stoppedById: stopper.id,
        stoppedAt: new Date(now - 60_000),
        recipientCount: 7,
      });

      const found = await BroadcastRepository.findById(stopped.id, tx);
      expect(found?.id).toBe(stopped.id);
      expect(found?.title).toBe(stopped.title);
      expect(found?.body).toBe("stopped body");
      expect(found?.status).toBe("active");
      expect(found?.recipientCount).toBe(7);
      expect(found?.sentById).toBe(sender.id);
      expect(found?.sentByName).toBe(sender.fullName);
      expect(found?.stoppedById).toBe(stopper.id);
      expect(found?.stoppedByName).toBe(stopper.fullName);

      const missing = await BroadcastRepository.findById(stopped.id + 1_000_000, tx);
      expect(missing).toBeNull();
    });
  });

  // ─── no-transaction read branch (post-rollback pool read) ───────────

  test("no-tx read branch — list/count/findById on the global db handle see only committed data", async () => {
    const emptyPattern = titlePattern(uniqueTitle("NOTX"));

    // Run-unique probes: the committed database never holds these, so the
    // empty outcomes are exact — and they execute the no-tx branch of each
    // read method.
    const list = await BroadcastRepository.list({ titleSearch: emptyPattern }, 25, 0);
    expect(list).toEqual([]);
    expect(await BroadcastRepository.count({ titleSearch: emptyPattern })).toBe(0);
    expect(await BroadcastRepository.findById(2_000_000_000)).toBeNull();
  });
});

describe("BroadcastRepository.transitionToStopped", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("Tier 1 — the CAS wins once: status flips to stopped with the stopper + now() stamp", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx, { role: UserRole.Admin });
      const stopper = await createTestUser(tx, { role: UserRole.Admin });
      const beforeStop = new Date(Date.now() - 3_600_000);
      const active = await insertBroadcast(tx, {
        title: uniqueTitle("CAS"),
        sentById: sender.id,
        recipientCount: 12,
        sentAt: beforeStop,
      });

      const row = await BroadcastRepository.transitionToStopped(active.id, stopper.id, tx);

      expect(row).not.toBeNull();
      expect(row?.id).toBe(active.id);
      expect(row?.status).toBe(BroadcastStatus.Stopped);
      expect(row?.stoppedById).toBe(stopper.id);
      expect(row?.stoppedAt).toBeInstanceOf(Date);
      const stoppedAt = row?.stoppedAt;
      if (stoppedAt) {
        expect(stoppedAt.getTime()).toBeGreaterThan(beforeStop.getTime());
      }
      // The immutable header fields are untouched by the transition.
      expect(row?.recipientCount).toBe(12);
      expect(row?.title).toBe(active.title);
    });
  });

  test("Tier 1 — the CAS misses with zero rows on both branches (unknown id, already stopped)", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx, { role: UserRole.Admin });
      const stopper = await createTestUser(tx, { role: UserRole.Admin });
      const active = await insertBroadcast(tx, { title: uniqueTitle("MISS"), sentById: sender.id });
      const alreadyStopped = await insertBroadcast(tx, {
        title: uniqueTitle("MISS"),
        sentById: sender.id,
        status: "stopped",
      });

      // Unknown id — the caller arbitrates NotFound.
      const unknownId = await BroadcastRepository.transitionToStopped(active.id + 1_000_000, stopper.id, tx);
      expect(unknownId).toBeNull();

      // Present-but-not-active — the caller arbitrates Conflict. The row is
      // untouched (status stays stopped, no second stopper stamped).
      const conflict = await BroadcastRepository.transitionToStopped(alreadyStopped.id, stopper.id, tx);
      expect(conflict).toBeNull();

      const untouched = await BroadcastRepository.findById(alreadyStopped.id, tx);
      expect(untouched?.status).toBe("stopped");
      expect(untouched?.stoppedById).toBeNull();
      expect(untouched?.stoppedAt).toBeNull();

      // The active broadcast is unaffected by both misses.
      const stillActive = await BroadcastRepository.findById(active.id, tx);
      expect(stillActive?.status).toBe("active");
    });
  });

  // ─── Tier 3: concurrency ────────────────────────────────────────────

  test("Tier 3 — two concurrent CAS stops race: exactly one winner", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx, { role: UserRole.Admin });
      const stopperA = await createTestUser(tx, { role: UserRole.Admin });
      const stopperB = await createTestUser(tx, { role: UserRole.Admin });
      const active = await insertBroadcast(tx, { title: uniqueTitle("RACE"), sentById: sender.id, recipientCount: 5 });

      const settled = await Promise.allSettled([
        BroadcastRepository.transitionToStopped(active.id, stopperA.id, tx),
        BroadcastRepository.transitionToStopped(active.id, stopperB.id, tx),
      ]);
      const rows = settled.map(settledRow);
      const winners = rows.filter(row => row !== null);

      // The CAS UPDATE's row lock serializes the race — exactly one
      // winner, the loser sees zero rows (never a partial stop).
      expect(winners).toHaveLength(1);
      expect(winners[0]?.id).toBe(active.id);
      expect(winners[0]?.status).toBe(BroadcastStatus.Stopped);

      // Exactly one stopper is recorded — the winner's (either of the two
      // racers; the CAS row lock decides which queued first).
      const winnerStopperId = winners[0]?.stoppedById;
      expect(winnerStopperId === stopperA.id || winnerStopperId === stopperB.id).toBe(true);

      // The broadcast is terminal: a third stop misses too.
      const thirdStop = await BroadcastRepository.transitionToStopped(active.id, stopperB.id, tx);
      expect(thirdStop).toBeNull();
    });
  });
});

describe("BroadcastRepository — Tier 4: hostile input", () => {
  // ─── Tier 4: ILIKE wildcard probes ──────────────────────────────────

  test("Tier 4 — `%`, `_`, and `\\` stored in titles stay inert (escaped probes match exactly)", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const token = uniqueToken();
      const pctTitle = `P-${token}%tail`;
      const underTitle = `U-${token}_mid`;
      const backTitle = `B-${token}\\slash`;
      const pct = await insertBroadcast(tx, { title: pctTitle, sentById: sender.id });
      const under = await insertBroadcast(tx, { title: underTitle, sentById: sender.id });
      const back = await insertBroadcast(tx, { title: backTitle, sentById: sender.id });

      // Escaped exact probes: each wildcard-bearing title is found by its
      // own escaped pattern — and by nothing else's.
      const pctProbe = await BroadcastRepository.list({ titleSearch: titlePattern(pctTitle) }, 50, 0, tx);
      expect(pctProbe.map(row => row.id)).toEqual([pct.id]);
      const underProbe = await BroadcastRepository.list({ titleSearch: titlePattern(underTitle) }, 50, 0, tx);
      expect(underProbe.map(row => row.id)).toEqual([under.id]);
      const backProbe = await BroadcastRepository.list({ titleSearch: titlePattern(backTitle) }, 50, 0, tx);
      expect(backProbe.map(row => row.id)).toEqual([back.id]);

      // Escaped wildcard probes: a term that is ONLY a wildcard matches the
      // rows carrying that literal character and never widens to the rest.
      const pctOnly = await BroadcastRepository.list({ titleSearch: titlePattern("%") }, 50, 0, tx);
      expect(pctOnly.map(row => row.id)).toContain(pct.id);
      expect(pctOnly.map(row => row.id)).not.toContain(under.id);
      expect(pctOnly.map(row => row.id)).not.toContain(back.id);

      const underOnly = await BroadcastRepository.list({ titleSearch: titlePattern("_") }, 50, 0, tx);
      expect(underOnly.map(row => row.id)).toContain(under.id);
      expect(underOnly.map(row => row.id)).not.toContain(pct.id);
      expect(underOnly.map(row => row.id)).not.toContain(back.id);

      // The escaped backslash quotes the next character verbatim: a
      // wildcard probe carrying it matches the backslash-bearing title.
      const backOnly = await BroadcastRepository.list({ titleSearch: titlePattern("\\") }, 50, 0, tx);
      expect(backOnly.map(row => row.id)).toContain(back.id);
      expect(backOnly.map(row => row.id)).not.toContain(pct.id);
      expect(backOnly.map(row => row.id)).not.toContain(under.id);
    });
  });

  test("Tier 4 — wildcard-shaped probes that escape nothing would widen; the escaped contract keeps them exact", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const token = uniqueToken();
      const target = await insertBroadcast(tx, { title: `T-${token}X`, sentById: sender.id });

      // The underscore is escaped to a literal: probing for `T-<token>_`
      // matches nothing (an unescaped `_` would match the single `X` and
      // widen to the target row).
      const underProbe = await BroadcastRepository.list({ titleSearch: titlePattern(`T-${token}_`) }, 50, 0, tx);
      expect(underProbe).toEqual([]);

      // The target is still reachable by its exact literal.
      const exact = await BroadcastRepository.list({ titleSearch: titlePattern(`T-${token}X`) }, 50, 0, tx);
      expect(exact.map(row => row.id)).toEqual([target.id]);
    });
  });

  test("Tier 4 — SQL-flavored search payloads stay bound parameters (no concatenation, no side effects)", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      await insertBroadcast(tx, { title: uniqueTitle("SEC"), sentById: sender.id });

      const tautology = await BroadcastRepository.list({ titleSearch: titlePattern("' OR '1'='1") }, 50, 0, tx);
      const dropShaped = await BroadcastRepository.list(
        { titleSearch: titlePattern("x'; DROP TABLE broadcasts; --") },
        50,
        0,
        tx
      );

      // Concatenation would have widened the tautology probe to every row
      // and broken the statement after it — binding keeps both empty.
      expect(tautology).toEqual([]);
      expect(dropShaped).toEqual([]);

      // The broadcasts table is intact and the listing still resolves.
      const healthy = await BroadcastRepository.list({ titleSearch: titlePattern("SEC-") }, 50, 0, tx);
      expect(healthy).toHaveLength(1);
    });
  });

  // ─── Tier 4: idempotency unique violation ───────────────────────────

  test("Tier 4 — a duplicate idempotency key raises the PostgreSQL 23505 unique violation translated into a ConflictError", async () => {
    await runInRollback(async tx => {
      const sender = await createTestUser(tx);
      const key = `key-${uniqueToken()}`;

      const first = await BroadcastRepository.create(
        { title: uniqueTitle("DUP"), body: "body", recipientCount: 1, sentById: sender.id, idempotencyKey: key },
        tx
      );
      expect(first.idempotencyKey).toBe(key);

      // The second insert violates the unique index — the replay arbiter.
      // The translated error is asserted LAST in this transaction: a 23505
      // aborts it, so no further query runs in this body (the wrapper then
      // forces the rollback).
      const error = await expectRepoError(() =>
        BroadcastRepository.create(
          { title: uniqueTitle("DUP"), body: "body", recipientCount: 2, sentById: sender.id, idempotencyKey: key },
          tx
        )
      );
      expect(error).toBeInstanceOf(ConflictError);
    });
  });

  // ─── Schema contract: the sent_by_id / stopped_by_id FK indexes ───────

  test("broadcasts_sent_by_id_idx and broadcasts_stopped_by_id_idx exist as btrees on their FK columns", async () => {
    await runInRollback(async tx => {
      const indexes = await tx.execute<{ indexname: string; indexdef: string }>(
        sql`SELECT indexname, indexdef FROM pg_indexes
            WHERE tablename = 'broadcasts'
              AND indexname IN ('broadcasts_sent_by_id_idx', 'broadcasts_stopped_by_id_idx')
            ORDER BY indexname`
      );
      expect(indexes.rows).toHaveLength(2);

      const sentBy = indexes.rows.find(row => row.indexname === "broadcasts_sent_by_id_idx");
      expect(sentBy?.indexdef).toContain("USING btree");
      expect(sentBy?.indexdef).toContain("(sent_by_id)");

      const stoppedBy = indexes.rows.find(row => row.indexname === "broadcasts_stopped_by_id_idx");
      expect(stoppedBy?.indexdef).toContain("USING btree");
      expect(stoppedBy?.indexdef).toContain("(stopped_by_id)");
    });
  });
});
