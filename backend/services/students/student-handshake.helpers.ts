/**
 * Governance predicate for parent-side handshake-code discovery.
 *
 * Pure module: no I/O, no clock reads (the caller supplies the evaluation
 * instant), no module-level mutable state. Repositories return governance
 * columns faithfully; deciding whether a governed child stays discoverable is
 * a service concern, and this helper is that single decision point.
 *
 * Fail-closed by design: when governance data is incomplete or corrupt (a
 * suspended row missing its window start or duration, or carrying a
 * non-positive duration), the child is treated as actively governed —
 * missing or invalid data must never widen discovery visibility.
 */
import { isSuspensionActive } from "@/backend/lib/auth/suspension-window";
import type { HandshakeDiscoveryRowType } from "@/backend/types";

/**
 * Fail-closed: any governed state excludes the child from parent discovery by
 * collapsing the lookup to "does not exist".
 *
 * The input is the `UserSelectType` half of the canonical discovery row —
 * `Omit<HandshakeDiscoveryRowType, "parentId">`, single-sourced from
 * `@/backend/types` so the governance key set can never drift from the row
 * type (`fullName` rides along and is ignored by the predicate).
 *
 *  - `isDeleted` or `isBlocked` → always excluded;
 *  - not suspended → included;
 *  - suspended with a missing window start, a missing duration, or a
 *    NON-POSITIVE duration → excluded (fail-closed — incomplete or
 *    corrupt governance data never widens visibility; `suspended_period_days`
 *    is a plain nullable int with no CHECK constraint, so 0/negative values
 *    can exist, and a zero-day window would otherwise compute a past `endsAt`
 *    and masquerade as "lapsed" while the student is actively suspended);
 *  - actively suspended (window end strictly after `now`) → excluded;
 *  - lapsed suspension (window end at or before `now`) → included.
 */
export function isGovernanceExcludedFromDiscovery(
  governance: Omit<HandshakeDiscoveryRowType, "parentId">,
  now: Date
): boolean {
  if (governance.isDeleted || governance.isBlocked) {
    return true;
  }
  return isSuspensionActive(
    {
      suspended: governance.suspended,
      suspendedAt: governance.suspendedAt,
      suspendedPeriodDays: governance.suspendedPeriodDays,
    },
    now
  );
}
