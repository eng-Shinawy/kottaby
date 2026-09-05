/**
 * One extra lifecycle CTA rendered beside the Cancel button (teacher
 * Start/Complete today, the DEV3-012 student Confirm tomorrow; generically
 * shaped so the row stays role-agnostic). `disabled` is the CALLER'S
 * per-mutation in-flight state — the row never owns mutation bookkeeping.
 *
 * Exported from `SessionRow.tsx` (re-export) so teacher/student containers
 * keep importing it from the historical `SessionRow` path.
 */
export interface SessionRowAction {
  /** Stable affordance identity (doubles as the render key + testid suffix). */
  readonly id: "start" | "complete" | "confirm";
  /** Compile-time i18n copy resolved by the container. */
  readonly label: string;
  /** Disabled while THIS action's own mutation is in flight. */
  readonly disabled?: boolean;
  /**
   * Optional consequence explainer (DEV3-012 confirm) — rendered as a
   * tooltip; the row stays a pure affordance either way.
   */
  readonly tooltip?: string;
  /** MUI color token for the CTA (defaults to the lifecycle `primary`). */
  readonly color?: "primary" | "success" | "warning";
  /** Activation intent — the container owns the mutation launch. */
  readonly onIntent: (sessionId: string) => void;
}
