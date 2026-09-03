/**
 * Teacher sessions — shared slot-book vocabulary and pure helpers.
 *
 * Extracted verbatim from `TeacherSessionsContainer` (the max-lines split):
 * the per-row in-flight slot book (`Record<sessionId, Set<actionKind>>`),
 * its immutable open/close/predicate helpers, the row-alert dropper, and
 * the module-scope constants shared by the container, its hooks, and the
 * mutation error-arm router. All functions here are PURE — no React, no
 * Apollo — so every `setState` consumer stays on stable `useCallback` deps.
 */

/** Snackbar autohide — parity with the app-scope `GraphQLErrorSurfaceHost` toasts. */
export const SNACKBAR_AUTOHIDE_MS = 6000;

/** `__typename` of the normalized `Session` cache entity. */
export const SESSION_TYPE_NAME = "Session";

/** Unmapped lifecycle-reject code (the mapping table defines NO row for it). */
export const SESSION_INVALID_TRANSITION_CODE = "SESSION_INVALID_TRANSITION";

/** Unmapped certification-reject code (no mapping row — caller-kept arm). */
export const TEACHER_NOT_CERTIFIED_CODE = "TEACHER_NOT_CERTIFIED";

/** One transient container-level notice rendered in the MUI Snackbar slot. */
export interface ContainerNotice {
  readonly message: string;
  readonly severity: "success" | "info" | "error";
}

/**
 * Per-row lifecycle action kinds tracked in the container's in-flight slots.
 * `cancel` is reserved for the dialog-owned mutation (its busy state lives
 * inside `CancelSessionConfirmDialog`); `dispute` marks the row whose
 * dispute dialog is open (dialog-owned mutation — the slot book extended
 * with the dispute kind); the container slots start/complete.
 */
export type RowActionKind = "start" | "complete" | "cancel" | "dispute";

/**
 * In-flight slot book — sessionId → the set of action kinds currently in
 * flight FOR THAT ROW. Immutable records + copied sets only: the
 * React state is never mutated in place, so every `setState` yields a new
 * snapshot and per-row slots clear independently of their siblings.
 */
export type InFlightSlots = Readonly<Record<string, ReadonlySet<RowActionKind>>>;

/** Removes one row-scoped alert entry (pure — stable `useCallback` deps). */
export function dropRowAlert(
  alerts: Readonly<Record<string, string>>,
  sessionId: string
): Readonly<Record<string, string>> {
  if (!(sessionId in alerts)) return alerts;
  return Object.fromEntries(Object.entries(alerts).filter(([id]) => id !== sessionId));
}

/** Opens a row+kind slot (pure — returns a new record, never mutating). */
export function addInFlightAction(slots: InFlightSlots, sessionId: string, kind: RowActionKind): InFlightSlots {
  const next = new Set(slots[sessionId] ?? []);
  next.add(kind);
  return { ...slots, [sessionId]: next };
}

/** Closes a row+kind slot, dropping the entry once its set drains (pure). */
export function removeInFlightAction(slots: InFlightSlots, sessionId: string, kind: RowActionKind): InFlightSlots {
  const previous = slots[sessionId];
  if (!previous?.has(kind)) return slots;
  const next = new Set(previous);
  next.delete(kind);
  if (next.size === 0) {
    return Object.fromEntries(Object.entries(slots).filter(([id]) => id !== sessionId));
  }
  return { ...slots, [sessionId]: next };
}

/** Whether THIS row's slot for THIS action kind is currently in flight. */
export function isInFlight(slots: InFlightSlots, sessionId: string, kind: RowActionKind): boolean {
  return slots[sessionId]?.has(kind) ?? false;
}
