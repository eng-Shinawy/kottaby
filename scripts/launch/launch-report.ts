/**
 * The machine launch-report writer + verdict computation.
 *
 * Emits `docs/planning/launch-report-<UTC-stamp>.json` holding the per-row
 * evidence tuples, per-stage results, signed-waiver records, and the final
 * verdict, then prints the `VERDICT: PASS|FAIL` line (the ops
 * stdout-line-as-record pattern; stamped-name + verdict-print modeled on the
 * restore tool family).
 *
 * Verdict rule — FAIL iff any row's result is FAIL, any waiver record lacks a
 * signatory, or any row marked WAIVED has no signed waiver record for it. A
 * waived row without a signature blocks launch exactly like a failed row.
 *
 * Redaction: the serializer allowlists exactly the report fields — row
 * {rowId, section, modality, command, exitStatus, result, evidenceRef,
 * timestamp}, stage {stage, status, startedAt, finishedAt}, waiver {rowId,
 * why, owner, signatory}, plus the envelope {generatedAt, verdict}. This
 * module never reads env values, secrets, tokens, or connection strings, and
 * extra runtime properties on its inputs are dropped, never serialized.
 *
 * The write path is derived from the output directory and the clock only:
 * the stamp's charset is [0-9TZ], so row/stage/waiver data can never steer
 * where the report lands. The write uses exclusive create — a same-second
 * double run fails closed instead of clobbering a committed report.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LaunchReportRow, StageResult } from "@/scripts/launch/shared/launch-types";
import { utcStamp } from "@/scripts/ops/backup-artifacts";

/**
 * A signed waiver record as carried in the report's `waivers` array.
 *
 * `why`/`owner` mirror the row registry's waiver metadata; `signatory` is
 * collected at human sign-off. An empty or whitespace-only signatory means
 * the waiver is unsigned — launch-blocking.
 */
export interface SignedWaiver {
  readonly rowId: string;
  readonly why: string;
  readonly owner: string;
  readonly signatory: string;
}

/** Injectable seams for the stamped writer (tests pass temp dirs + fixed clocks). */
export interface LaunchReportWriteOptions {
  /**
   * Directory the stamped report is written into. Defaults to
   * `"docs/planning"` resolved against the process working directory (the
   * gate runs from the repo root, so the written path is repo-relative).
   */
  readonly outputDir?: string;
  /** Clock feeding the file stamp and `generatedAt`. Defaults to now. */
  readonly now?: Date;
  /** Sink for the `VERDICT:` print. Defaults to `console.log`. */
  readonly stdout?: (line: string) => void;
}

/** The emitted JSON document, field-for-field (the serializer's allowlist). */
export interface LaunchReport {
  readonly generatedAt: string;
  readonly verdict: "PASS" | "FAIL";
  readonly stages: readonly StageResult[];
  readonly rows: readonly LaunchReportRow[];
  readonly waivers: readonly SignedWaiver[];
}

/** Default report directory, resolved against the process working directory. */
const DEFAULT_REPORT_DIR = "docs/planning";

/**
 * Copies exactly the allowlisted row fields. Building a fresh object (rather
 * than serializing the input directly) is the redaction mechanism: any extra
 * runtime property on the input is dropped here.
 */
function serializeRow(row: LaunchReportRow): LaunchReportRow {
  return {
    rowId: row.rowId,
    section: row.section,
    modality: row.modality,
    command: row.command,
    exitStatus: row.exitStatus,
    result: row.result,
    evidenceRef: row.evidenceRef,
    timestamp: row.timestamp,
  };
}

/** Copies exactly the allowlisted stage fields (see {@link serializeRow}). */
function serializeStage(stage: StageResult): StageResult {
  return {
    stage: stage.stage,
    status: stage.status,
    startedAt: stage.startedAt,
    finishedAt: stage.finishedAt,
  };
}

/** Copies exactly the allowlisted waiver fields (see {@link serializeRow}). */
function serializeWaiver(waiver: SignedWaiver): SignedWaiver {
  return {
    rowId: waiver.rowId,
    why: waiver.why,
    owner: waiver.owner,
    signatory: waiver.signatory,
  };
}

/**
 * Final launch verdict over the executed rows and signed-waiver records.
 *
 * Returns `"FAIL"` iff any row's result is `FAIL`, any waiver record lacks a
 * signatory, or any row marked `WAIVED` has no signed waiver record for its
 * `rowId`; `"PASS"` otherwise.
 */
export function computeVerdict(
  rows: readonly LaunchReportRow[],
  waivers: readonly SignedWaiver[] = []
): "PASS" | "FAIL" {
  for (const waiver of waivers) {
    if (waiver.signatory.trim().length === 0) {
      return "FAIL";
    }
  }

  const signedRowIds = new Set(
    waivers.filter(waiver => waiver.signatory.trim().length > 0).map(waiver => waiver.rowId)
  );
  for (const row of rows) {
    if (row.result === "FAIL") {
      return "FAIL";
    }
    if (row.result === "WAIVED" && !signedRowIds.has(row.rowId)) {
      return "FAIL";
    }
  }
  return "PASS";
}

/**
 * Writes the stamped machine report and prints the final `VERDICT:` line.
 *
 * Returns the written path (repo-relative when the default output directory
 * is used from the repo root; exactly `join(outputDir, …)` otherwise). The
 * file name is `launch-report-<UTC-stamp>.json` with a second-resolution
 * stamp derived from the clock alone — never from row data. The write is an
 * exclusive create: if the stamped file already exists the call throws
 * rather than clobbering it.
 */
export function writeLaunchReport(
  rows: readonly LaunchReportRow[],
  stages: readonly StageResult[],
  waivers: readonly SignedWaiver[] = [],
  options: LaunchReportWriteOptions = {}
): string {
  const now = options.now ?? new Date();
  const outputDir = options.outputDir ?? DEFAULT_REPORT_DIR;
  const verdict = computeVerdict(rows, waivers);

  const report: LaunchReport = {
    generatedAt: now.toISOString(),
    verdict,
    stages: stages.map(serializeStage),
    rows: rows.map(serializeRow),
    waivers: waivers.map(serializeWaiver),
  };

  const reportPath = join(outputDir, `launch-report-${utcStamp(now)}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  (options.stdout ?? console.log)(`VERDICT: ${verdict}`);
  return reportPath;
}
