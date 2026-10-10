/**
 * Shared types for the launch gate harness family of scripts.
 *
 * The launch gate executes the production-readiness checklist in nine
 * resumable stages, persists its progress to a repo-root state file
 * (`.launch-gate-state.json`), and emits a per-row machine report under
 * `docs/planning/` with a final `VERDICT: PASS|FAIL` line. This module is
 * the single home for every type shared across that harness:
 *
 *   • `scripts/launch/launch-gate.ts`    — the thin resumable CLI (state,
 *     stage iteration, per-row result collection).
 *   • `scripts/launch/launch-checklist.ts` — the row registry (which rows
 *     exist, which stage owns them, which command proves them).
 *   • `scripts/launch/launch-report.ts`  — the stamped report writer and
 *     verdict computation.
 *   • the probe CLIs (`probe-decisions.ts`, `probe-constraints.ts`,
 *     `secrets-scan.ts`, `verify-cron.ts`) — each emits `ProbeLine`s.
 *
 * Conventions:
 *   • Pure types only — no runtime code, no imports. Consumers deep-import
 *     via the `@/` alias (e.g. `import type { LaunchRow } from
 *     "@/scripts/launch/shared/launch-types"`); there is intentionally no
 *     barrel `index.ts` for this directory.
 *   • Report-bound types mirror the emitted JSON field-for-field; the
 *     report serializer allowlists exactly these fields (never env values,
 *     secrets, tokens, or connection strings).
 */

// ─── Stages & Modalities ─────────────────────────────────────────────────────

/**
 * The nine launch-gate stages, mirroring the production-readiness
 * checklist sections they verify.
 *
 * The literal order is load-bearing: the gate resumes from the persisted
 * stage by looking the stage up in the canonical ordered stage array
 * exported beside the row registry (see
 * `scripts/launch/launch-checklist.ts`), so that array must list these
 * literals in this exact order.
 */
export type LaunchStage =
  | "s1-data-integrity"
  | "s2-financial"
  | "s3-realtime"
  | "s4-security"
  | "s5-invariants"
  | "s6-performance"
  | "s7-dr"
  | "s8-decisions"
  | "s9-gate";

/**
 * How a checklist row is proven before it can be marked done.
 *
 *   • `AUTOMATED-TEST` — an existing bun test suite, invoked through its
 *     canonical runner; the captured suite log is the evidence.
 *   • `SCRIPT-PROBE`   — a read-only probe CLI (DB introspection, static
 *     scan, live-envelope check); the probe's output lines are the
 *     evidence.
 *   • `MANUAL-DRILL`   — a human-operated drill (DR cold-operator, load);
 *     marked from the existence of its filed evidence artifact, never
 *     auto-passed.
 *   • `DOC-SIGNOFF`    — a human signature or ratified document row;
 *     marked from the existence of the signed entry, never auto-passed.
 */
export type LaunchModality = "AUTOMATED-TEST" | "SCRIPT-PROBE" | "MANUAL-DRILL" | "DOC-SIGNOFF";

/**
 * Final disposition of a checklist row in the launch report.
 *
 *   • `PASS`   — the row's evidence executed and succeeded.
 *   • `WAIVED` — the row is waived with a named owner and rationale.
 *   • `FAIL`   — the row's evidence executed and failed (launch-blocking).
 */
export type RowDisposition = "PASS" | "WAIVED" | "FAIL";

// ─── Gate State ─────────────────────────────────────────────────────────────

/**
 * Persisted shape of the repo-root `.launch-gate-state.json` state file
 * (model: the quality gate's `.quality-gate-state.json`).
 *
 * The state is written by the single lock-holding gate process after each
 * stage. Resume trusts the stage index, not the lifecycle label — a stale
 * `lifecycle: "DONE"` on a non-final stage is still resumable.
 */
export interface LaunchGateState {
  /** The stage the gate last reached (resume starts at this stage's index). */
  stage: LaunchStage;
  /** Always `"launch-gate"` — distinguishes this state file's writer. */
  owner: "launch-gate";
  /**
   * Gate progress: `FRESH` (no stage completed yet), `IN_PROGRESS`
   * (mid-run or interrupted), `DONE` (all stages completed).
   */
  lifecycle: "FRESH" | "IN_PROGRESS" | "DONE";
  /** ISO-8601 timestamp of the most recent state write. */
  lastRun: string;
}

// ─── Row Registry ────────────────────────────────────────────────────────────

/**
 * One production-readiness checklist row: its identity, owning section,
 * proof modality, and the canonical command + evidence reference that
 * prove it.
 *
 * `evidenceRef` resolves to a captured suite log (via the test runner's
 * log capture), a probe output, a stamped script artifact, or a filed
 * drill artifact — always a repo-relative path.
 */
export interface LaunchRow {
  /** Checklist row identifier (e.g. `"1.1.1"`, `"5.3.3"`, `"8.21"`). */
  readonly rowId: string;
  /** The checklist section (1–9) the row belongs to. */
  readonly section: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** How the row is proven (see `LaunchModality`). */
  readonly modality: LaunchModality;
  /** Canonical runner command that proves the row. */
  readonly command: string;
  /** Repo-relative path to the captured evidence for the row. */
  readonly evidenceRef: string;
  /**
   * Present only on waived rows: the rationale and the named owner
   * accountable for the waiver. A waiver without a named owner is
   * launch-blocking.
   */
  readonly waiver?: {
    readonly why: string;
    readonly owner: string;
  };
}

// ─── Report ─────────────────────────────────────────────────────────────────

/**
 * One row's executed outcome in the machine launch report
 * (`docs/planning/launch-report-<UTC-stamp>.json`).
 *
 * This is the evidence tuple plus the row's owning `section` and computed
 * `result`. The report serializer allowlists exactly these fields.
 */
export interface LaunchReportRow {
  /** Checklist row identifier this outcome belongs to. */
  readonly rowId: string;
  /** The checklist section (1–9) the row belongs to. */
  readonly section: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** How the row was proven (see `LaunchModality`). */
  readonly modality: LaunchModality;
  /** The canonical command that was executed for the row. */
  readonly command: string;
  /** Exit status of the executed command (`0` on success). */
  readonly exitStatus: number;
  /** Final disposition of the row (see `RowDisposition`). */
  readonly result: RowDisposition;
  /** Repo-relative path to the captured evidence for the row. */
  readonly evidenceRef: string;
  /** ISO-8601 timestamp of when the row was dispositioned. */
  readonly timestamp: string;
}

/**
 * Outcome of one launch-gate stage as recorded in the machine report.
 *
 * `status` is strictly `PASS` or `FAIL` — waivers are a row-level
 * disposition and never apply to a whole stage.
 */
export interface StageResult {
  /** The stage this outcome belongs to. */
  readonly stage: LaunchStage;
  /** Whether every row in the stage passed or was validly waived. */
  readonly status: "PASS" | "FAIL";
  /** ISO-8601 timestamp of when the stage started. */
  readonly startedAt: string;
  /** ISO-8601 timestamp of when the stage finished. */
  readonly finishedAt: string;
}

// ─── Probe Output ───────────────────────────────────────────────────────────

/**
 * A single verification line emitted by a probe CLI
 * (`probe-decisions.ts`, `probe-constraints.ts`, `secrets-scan.ts`,
 * `verify-cron.ts`).
 *
 * A probe exits `0` iff every emitted line has `result: "PASS"` — a probe
 * never silently skips a check; an unreachable check is emitted as a
 * named `FAIL` line (e.g. a connection error gets its own rowId).
 */
export interface ProbeLine {
  /** Checklist row identifier this probe line proves. */
  readonly rowId: string;
  /** Whether the checked condition holds. */
  readonly result: "PASS" | "FAIL";
  /** Human-readable explanation of what was checked (never a secret value). */
  readonly detail: string;
}
