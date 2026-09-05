/**
 * Per-row in-flight slot book for the student sessions container —
 * sessionId → the set of action kinds currently in flight FOR THAT ROW.
 * Immutable records + copied sets only: the React state is never mutated
 * in place, so every `setState` yields a new snapshot and per-row slots
 * clear independently.
 */

/**
 * Per-row action kinds tracked in the container's in-flight slots. `cancel`
 * is reserved for the dialog-owned mutation (its busy state lives inside
 * `CancelSessionConfirmDialog`); `dispute` marks the row whose dispute
 * dialog is open (the dialog-owned mutation — the per-row slot book
 * extended with the dispute kind); `confirm` marks the row whose
 * confirm mutation is in flight (container-owned, no dialog).
 */
export type RowActionKind = "cancel" | "dispute" | "confirm";

/** The immutable in-flight slot book state shape. */
export type InFlightSlots = Readonly<Record<string, ReadonlySet<RowActionKind>>>;

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
