/**
 * The per-cell sample loop. One cell runs its warmup iterations (durations
 * never recorded, but a FAILED warmup browse is recorded as an error sample
 * — a call that cannot even warm up must never let the cell pass) and then
 * its recorded samples. Every sampled call is measured end to end through
 * the REAL service seam (validation + caller resolution + filter build +
 * repository read + envelope assembly) and is verified against two
 * per-sample oracles before its duration is accepted:
 *
 *  - the envelope oracle: the page envelope must be internally consistent
 *    (`page`/`pageSize` echo the request, `pageCount = ceil(total/pageSize)`,
 *    and the page slice length matches the honest total);
 *  - the in-session exclusion oracle: no teacher holding a `started`
 *    session may ever appear in a result page, on ANY sample.
 *
 * A violated oracle, a thrown browse, or a broken clock marks that sample
 * as an error (`ok: false` + a stable `errorCode`; raw messages are never
 * stored). Durations are computed from the injected clock; a non-finite or
 * negative (clock ran backwards) duration invalidates the measurement — the
 * sample becomes a clock-error with a zero placeholder duration, so a
 * broken clock fails the gate instead of corrupting the percentiles.
 */

import type {
  TeacherMatchingItemReturnType,
  TeacherMatchingPageReturnType,
  TeacherMatchingSubmitInput,
} from "@/backend/types";
import { BENCH_LOCALE, BENCH_PAGE, BENCH_PAGE_SIZE } from "@/scripts/perf/lib/bench-matching-cells";
import { type LatencySample, type PercentileSummary, summarizeSamples } from "@/scripts/perf/lib/stats";

/** The service invocation seam (the real io binds the live matching service). */
export interface BrowseSeam {
  browse(
    studentUserId: number,
    input: TeacherMatchingSubmitInput,
    locale: string
  ): Promise<TeacherMatchingPageReturnType>;
}

/** One cell's execution inputs. */
export interface CellRunRequest {
  readonly id: string;
  readonly callerId: number;
  readonly input: TeacherMatchingSubmitInput;
}

/** One cell's recorded outcome. */
export interface CellRunResult {
  readonly summary: PercentileSummary;
  /** Honest `total` observed across successful samples (null when none succeeded). */
  readonly totalMin: number | null;
  readonly totalMax: number | null;
  /** Distinct error codes observed (stable identifiers, never raw messages). */
  readonly errorCodes: readonly string[];
}

/** Per-cell run options: counts, the exclusion oracle, and the effectful seams. */
export interface CellRunOptions {
  readonly warmup: number;
  readonly samples: number;
  readonly startedTeacherIds: readonly number[];
  readonly seam: BrowseSeam;
  readonly now: () => number;
}

const ENVELOPE_PAGE = "envelope:page";
const ENVELOPE_PAGE_SIZE = "envelope:page-size";
const ENVELOPE_PAGE_COUNT = "envelope:page-count";
const ENVELOPE_ITEMS_LENGTH = "envelope:items-length";
const EXCLUSION_STARTED = "exclusion:started-teacher";
const SERVICE_ERROR = "service-error";
const CLOCK_ERROR = "clock-error";

/** Verifies the page envelope's internal consistency; returns the violation code or null. */
export function findEnvelopeViolation(page: TeacherMatchingPageReturnType): string | null {
  if (page.page !== BENCH_PAGE) {
    return ENVELOPE_PAGE;
  }
  if (page.pageSize !== BENCH_PAGE_SIZE) {
    return ENVELOPE_PAGE_SIZE;
  }
  const expectedPageCount = Math.ceil(page.total / page.pageSize);
  if (page.pageCount !== expectedPageCount) {
    return ENVELOPE_PAGE_COUNT;
  }
  const expectedSlice = Math.min(page.pageSize, Math.max(0, page.total - (page.page - 1) * page.pageSize));
  if (page.items.length !== expectedSlice) {
    return ENVELOPE_ITEMS_LENGTH;
  }
  return null;
}

/** Verifies the in-session exclusion oracle on one result page; returns the violation code or null. */
export function findExclusionViolation(
  items: readonly TeacherMatchingItemReturnType[],
  startedTeacherIds: readonly number[]
): string | null {
  for (const item of items) {
    if (startedTeacherIds.includes(item.id)) {
      return EXCLUSION_STARTED;
    }
  }
  return null;
}

/** Observes one browse call: duration, oracle verdicts, and the honest total. */
async function observeSample(
  request: CellRunRequest,
  options: CellRunOptions
): Promise<{ sample: LatencySample; total: number | null }> {
  const start = options.now();
  let page: TeacherMatchingPageReturnType | null = null;
  let serviceFailed = false;
  try {
    page = await options.seam.browse(request.callerId, request.input, BENCH_LOCALE);
  } catch {
    serviceFailed = true;
  }
  const end = options.now();
  const rawDuration = end - start;
  let durationMs: number;
  let errorCode: string | null;
  if (!Number.isFinite(rawDuration) || rawDuration < 0) {
    durationMs = 0;
    errorCode = CLOCK_ERROR;
  } else if (serviceFailed || page === null) {
    durationMs = rawDuration;
    errorCode = SERVICE_ERROR;
  } else {
    durationMs = rawDuration;
    errorCode = findEnvelopeViolation(page) ?? findExclusionViolation(page.items, options.startedTeacherIds);
  }
  return {
    sample: {
      scenarioId: request.id,
      durationMs,
      ok: errorCode === null,
      ...(errorCode === null ? {} : { errorCode }),
    },
    total: errorCode === null && page !== null ? page.total : null,
  };
}

/** Recursive drain over one cell's iterations (no await inside a loop body). */
function runIterations(
  request: CellRunRequest,
  options: CellRunOptions,
  remaining: number,
  recordSamples: boolean,
  sink: LatencySample[],
  totals: number[]
): Promise<void> {
  if (remaining <= 0) {
    return Promise.resolve();
  }
  return observeSample(request, options).then(observed => {
    if (recordSamples || !observed.sample.ok) {
      sink.push(observed.sample);
    }
    if (observed.total !== null) {
      totals.push(observed.total);
    }
    return runIterations(request, options, remaining - 1, recordSamples, sink, totals);
  });
}

/** Runs one matrix cell end to end: warmup, then the recorded sample window. */
export async function runCell(request: CellRunRequest, options: CellRunOptions): Promise<CellRunResult> {
  const samples: LatencySample[] = [];
  const totals: number[] = [];
  await runIterations(request, options, options.warmup, false, samples, totals);
  await runIterations(request, options, options.samples, true, samples, totals);
  const summary = summarizeSamples(samples);
  return {
    summary,
    totalMin: totals.length > 0 ? Math.min(...totals) : null,
    totalMax: totals.length > 0 ? Math.max(...totals) : null,
    errorCodes: [...new Set(samples.filter(sample => !sample.ok).map(sample => sample.errorCode ?? "unknown"))],
  };
}
