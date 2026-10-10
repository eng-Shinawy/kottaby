/**
 * Shared report seam for perf harness entrypoints: opens the timestamped
 * run directory, keeps the open-run context, and routes report writes and
 * the terminal verdict through the report writer — one scaffold so every
 * harness io reports through the identical lifecycle (open → write →
 * verdict, with a loud refusal on write-before-open).
 */

import { emitVerdict, openRunDirectory, writeReport } from "@/scripts/perf/lib/report";
import type { GateResult } from "@/scripts/perf/lib/stats";

export type HarnessReportArgs = Record<string, string | number | boolean>;

export interface HarnessReportSeam {
  openReport(this: void, args: HarnessReportArgs): { runId: string; runDir: string };
  writeReport(this: void, runId: string, gates: readonly GateResult[], sections: Record<string, unknown>): void;
  emitVerdict(this: void, gates: readonly GateResult[]): boolean;
}

export function createHarnessReportSeam(toolId: string): HarnessReportSeam {
  let reportCtx: { startedAt: string; args: HarnessReportArgs } | null = null;
  return {
    openReport: args => {
      const opened = openRunDirectory(toolId);
      reportCtx = { startedAt: new Date().toISOString(), args };
      return opened;
    },
    writeReport: (runId, gates, sections) => {
      const ctx = reportCtx;
      if (ctx === null) {
        throw new Error("report context missing — openReport must run first");
      }
      writeReport({ runId, tool: toolId, startedAt: ctx.startedAt, args: ctx.args }, gates, sections);
    },
    emitVerdict: gates => emitVerdict(gates),
  };
}
