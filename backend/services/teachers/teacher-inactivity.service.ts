/**
 * TeacherInactivityService — the system-side inactivity sweep.
 *
 * Responsibilities:
 *  - `sweepInactiveTeachers` — ONE transaction, ONE captured now: the
 *    staleness cutoff is derived from the captured instant and never
 *    re-read, and the guarded batch transition
 *    (`TeacherRepository.sweepInactiveOnlineOnce`) flips every online
 *    teacher whose recorded activity is strictly older than the cutoff —
 *    or who has none — and who holds no started session, inside the same
 *    atomic unit.
 *
 * Disciplines enforced here:
 *  - Composition only: the service decides WHEN the sweep runs and derives
 *    the window; the repository primitive owns the guarded predicate and
 *    the write. No business logic is duplicated at this layer.
 *  - Transaction composition: the caller's outer transaction is joined
 *    (SAVEPOINT) when provided — a composed unit of work shares the
 *    sweep's atomicity; production callers (the cron route) omit it and
 *    the sweep opens its own top-level transaction. The global `db`
 *    handle is never touched outside the helper.
 *  - One-now discipline: exactly one clock read per pass. The threshold
 *    resolution comes from the environment snapshot getter (never a raw
 *    environment read here), so the derived cutoff is a pure function of
 *    the captured now and the configured window.
 *  - Honest counts: the return carries only the number of teachers
 *    actually transitioned online → offline. No row identities, no
 *    per-teacher fields — the count is the whole payload.
 *  - Silence: the sweep denies nobody, so there is no domain-error path
 *    and no bounded denial log. The happy path emits exactly ONE
 *    completion log line with the honest count, strictly AFTER the
 *    transaction resolves — a rolled-back sweep never reports a count.
 *  - Failure containment: the body adds no catch. Any failure inside the
 *    transaction rolls the whole pass back and propagates to the caller —
 *    the cron envelope owns failure surfacing and logging.
 */

import { TeacherRepository } from "@/backend/db/repo";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { getTeacherInactivityTimeoutMinutes } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, TeacherInactivitySweepReturnType } from "@/backend/types";

export namespace TeacherInactivityService {
  /**
   * Runs one inactivity sweep pass inside ONE transaction.
   *
   * ONE captured now — the staleness cutoff is derived from it
   * (`now − timeoutMinutes`) and never re-read, so every row the pass
   * evaluates shares one instant and every transitioned row is stamped
   * with it. The threshold resolution comes from the environment snapshot
   * getter; a malformed operator value can neither disable the sweep nor
   * hyper-accelerate it (the getter falls back to the safe default).
   *
   * The guarded batch primitive selects victims by predicate alone
   * (`is_online` + recorded activity strictly older than the cutoff or
   * NULL + no started session), so a replay is a zero-row no-op and the
   * count stays honest under overlapping invocations. The sweep touches
   * nothing else: no activity stamps, no session writes, no notifications.
   *
   * The happy path emits exactly ONE `logger.info` completion line with
   * the honest count, after the transaction resolves. There is no denial
   * path (the sweep denies nobody) and no catch: a failure rolls the whole
   * pass back and propagates to the caller.
   *
   * @param outerTx  Optional outer transaction. When provided (a composed
   *     unit of work), the pass runs inside a SAVEPOINT on it; production
   *     callers omit it and the pass opens its own top-level transaction.
   * @returns The honest count of teachers transitioned online → offline
   *     (zero when nothing matched — an idempotent no-op).
   */
  export async function sweepInactiveTeachers(outerTx?: DBTransaction): Promise<TeacherInactivitySweepReturnType> {
    const offlined = await withTransaction(outerTx, async tx => {
      // One captured now for the whole pass — the cutoff is derived from
      // it and never re-read.
      const now = new Date();
      const cutoff = new Date(now.getTime() - getTeacherInactivityTimeoutMinutes() * 60_000);
      return TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx);
    });

    // Strictly after the transaction resolves — a rolled-back sweep never
    // reports a count.
    logger.info("Teacher inactivity sweep completed", { offlined });

    return { offlined };
  }
}
