/**
 * Matrix execution for the matching benchmark: runs every cell over the
 * descending volume-window steps, restoring each step's offline flips on
 * every path (success and failure alike), and joins each cell's summary
 * with its spec and gate flag. Gate cells are exactly the gate-volume
 * cells; every other volume's records are scale-evolution evidence.
 *
 * The context carries only the seams and facts the executor needs — the
 * database adapter (window flips + restore), the browse seam and clock
 * (the live service and `performance.now` in production, fakes in tests),
 * the per-sample exclusion oracle, and the resolved caller identities —
 * so the module never reaches back into the entrypoint's io type.
 */

import { type BenchCellSpec, GATE_VOLUME } from "@/scripts/perf/lib/bench-matching-cells";
import type { BenchDatabase } from "@/scripts/perf/lib/bench-matching-db";
import type { VolumeStep } from "@/scripts/perf/lib/bench-matching-plan";
import {
  type BenchCellRecord,
  type BenchWindowRecord,
  windowRecordFor,
} from "@/scripts/perf/lib/bench-matching-report";
import {
  type BrowseSeam,
  type CellRunOptions,
  type CellRunResult,
  runCell,
} from "@/scripts/perf/lib/bench-matching-runner";

/** The seams and facts one matrix execution runs over. */
export interface MatrixRunContext {
  readonly database: BenchDatabase;
  readonly seam: BrowseSeam;
  readonly now: () => number;
  readonly startedTeacherIds: readonly number[];
  readonly censusIds: readonly number[];
  readonly callerIds: { readonly noFilter: number; readonly language: number };
  readonly warmup: number;
  readonly samples: number;
  readonly gateEnabled: boolean;
}

/** The executor's result: per-cell records plus per-volume window records. */
export interface MatrixRunResult {
  readonly records: BenchCellRecord[];
  readonly windows: BenchWindowRecord[];
}

/** Runs one cell and joins its result with the spec and gate flag. */
async function runCellRecord(spec: BenchCellSpec, ctx: MatrixRunContext): Promise<BenchCellRecord> {
  const callerId = spec.caller === "no-filter" ? ctx.callerIds.noFilter : ctx.callerIds.language;
  const options: CellRunOptions = {
    warmup: ctx.warmup,
    samples: ctx.samples,
    startedTeacherIds: ctx.startedTeacherIds,
    seam: ctx.seam,
    now: ctx.now,
  };
  const run: CellRunResult = await runCell({ id: spec.id, callerId, input: spec.input }, options);
  return { spec, run, gateCell: ctx.gateEnabled && spec.volume === GATE_VOLUME };
}

/** Recursive drain over one volume's cells (no await inside a loop body). */
function drainCells(
  cells: readonly BenchCellSpec[],
  index: number,
  ctx: MatrixRunContext,
  sink: BenchCellRecord[]
): Promise<void> {
  if (index >= cells.length) {
    return Promise.resolve();
  }
  const cell = cells[index];
  return runCellRecord(cell, ctx).then(record => {
    sink.push(record);
    return drainCells(cells, index + 1, ctx, sink);
  });
}

/** Recursive drain over the descending volume steps: flip, record, run cells. */
function drainSteps(
  steps: readonly VolumeStep[],
  cells: readonly BenchCellSpec[],
  ctx: MatrixRunContext,
  index: number,
  flipped: number[],
  windows: BenchWindowRecord[],
  records: BenchCellRecord[]
): Promise<void> {
  if (index >= steps.length) {
    return Promise.resolve();
  }
  const step = steps[index];
  const flip =
    step.flipIds.length === 0
      ? Promise.resolve()
      : (async () => {
          flipped.push(...step.flipIds);
          await ctx.database.setTeachersOffline(step.flipIds);
        })();
  return flip
    .then(() => {
      windows.push(windowRecordFor(step, ctx.startedTeacherIds, ctx.censusIds));
      return drainCells(
        cells.filter(cell => cell.volume === step.volume),
        0,
        ctx,
        records
      );
    })
    .then(() => drainSteps(steps, cells, ctx, index + 1, flipped, windows, records));
}

/** Runs the full volume matrix; every window flip is restored on every path. */
export async function runVolumeMatrix(
  steps: readonly VolumeStep[],
  cells: readonly BenchCellSpec[],
  ctx: MatrixRunContext
): Promise<MatrixRunResult> {
  const records: BenchCellRecord[] = [];
  const windows: BenchWindowRecord[] = [];
  const flipped: number[] = [];
  try {
    await drainSteps(steps, cells, ctx, 0, flipped, windows, records);
    return { records, windows };
  } finally {
    if (flipped.length > 0) {
      await ctx.database.setTeachersOnline(flipped);
    }
  }
}

/** Runs the self-check mini-run: one cell over the live census, no flips, no gates. */
export async function runSelfCheckMatrix(cell: BenchCellSpec, ctx: MatrixRunContext): Promise<MatrixRunResult> {
  const record = await runCellRecord(cell, ctx);
  const censusSize = ctx.censusIds.length;
  const startedWithinWindow = ctx.startedTeacherIds.length;
  return {
    records: [record],
    windows: [
      {
        volume: censusSize,
        windowSize: censusSize,
        flippedOffline: 0,
        startedWithinWindow,
        browsableEstimate: censusSize - startedWithinWindow,
      },
    ],
  };
}
