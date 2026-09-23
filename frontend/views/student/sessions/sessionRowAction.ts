/**
 * One extra lifecycle affordance rendered beside the Cancel button (the
 * teacher starts/completes the session, the student confirms its completion,
 * the student rates once the row is dual-confirmed; the teacher views
 * homework on Started rows, submits the session report on Completed rows,
 * and files the rubric evaluation on completed evaluation rows).
 * `disabled` is the CALLER'S per-mutation in-flight state —
 * the row never owns mutation bookkeeping. `readOnly` renders a
 * NON-INTERACTIVE chip instead of a Button (`onIntent` unused) — the
 * write-once end-state of the rate affordance.
 *
 * Exported from `SessionRow.tsx` (re-export) so teacher/student containers
 * keep importing it from the historical `SessionRow` path.
 */
export interface SessionRowAction {
  /** Stable affordance identity (doubles as the render key + testid suffix). */
  readonly id: "start" | "complete" | "confirm" | "rate" | "homework" | "report" | "submitEvaluation";
  /** Compile-time i18n copy resolved by the container. */
  readonly label: string;
  /** Disabled while THIS action's own mutation is in flight. */
  readonly disabled?: boolean;
  /**
   * Optional consequence explainer (confirm) — rendered as a
   * tooltip; the row stays a pure affordance either way.
   */
  readonly tooltip?: string;
  /** MUI color token for the CTA (defaults to the lifecycle `primary`). */
  readonly color?: "primary" | "success" | "warning";
  /**
   * Read-only affordance — renders as a non-interactive chip (the rated
   * end-state of the rate affordance); `onIntent` is unused for it.
   */
  readonly readOnly?: boolean;
  /** Activation intent — the container owns the mutation launch. */
  readonly onIntent?: (sessionId: string) => void;
}
