/**
 * Single source of truth for suspension-window evaluation.
 *
 * Determines whether a user's suspension window is currently active at a given
 * point in time. The predicate is fail-closed: any corrupt or missing window
 * data (null `suspendedAt`, null/non-positive `suspendedPeriodDays` on a
 * flagged suspension) is treated as an indefinite suspension rather than a
 * lapse — incomplete or corrupt governance data must never widen access.
 *
 * Pure module: no I/O, no clock reads (the caller supplies the evaluation
 * instant), no module-level mutable state, no logging, no side effects.
 *
 * Consumed by:
 *  - the student-handshake discovery filter (`isGovernanceExcludedFromDiscovery`);
 *  - the auth boundary (`assertUserActive` on login + refresh);
 *  - the SSR boundary (`getServerUserContext`).
 *
 * `suspendedPeriodDays` is a plain nullable int with no CHECK constraint on
 * `users`, so 0/negative values can exist in the column — a zero-day window
 * would otherwise compute an `endsAt ≤ now` and masquerade as "lapsed" while
 * the user is actively suspended. The fail-closed arm collapses non-positive
 * values onto missing ones for exactly that reason.
 */

/** Milliseconds per day — the unit of `users.suspended_period_days`. */
const MS_PER_DAY = 86_400_000;

/** Input shape for the predicate — mirrors the nullable governance columns on `users`. */
interface SuspensionState {
  readonly suspended: boolean | null;
  readonly suspendedAt: Date | null;
  readonly suspendedPeriodDays: number | null;
}

/**
 * Returns `true` when the suspension is currently denying access at `now`.
 *
 * Semantics:
 *  - `suspended` falsy (false/null) → `false`;
 *  - `suspendedAt` missing OR `suspendedPeriodDays` missing OR `<= 0` → `true`
 *    (fail-closed — corrupt window data never widens access);
 *  - otherwise active IFF `suspendedAt.getTime() + suspendedPeriodDays × MS_PER_DAY`
 *    is STRICTLY greater than `now.getTime()` — a window ending exactly at
 *    `now` has lapsed (so the predicate returns `false`).
 */
export function isSuspensionActive(state: SuspensionState, now: Date): boolean {
  if (!state.suspended) {
    return false;
  }

  if (state.suspendedAt === null || state.suspendedPeriodDays === null || state.suspendedPeriodDays <= 0) {
    return true;
  }

  return state.suspendedAt.getTime() + state.suspendedPeriodDays * MS_PER_DAY > now.getTime();
}
