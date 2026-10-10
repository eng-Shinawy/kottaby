/**
 * Manifest persistence for the performance-data seeder. The run manifest is
 * written BEFORE the first insert (with a null completion timestamp, so a
 * crashed run stays discoverable) and finalized atomically after the last
 * one: the replacement writes a sibling temp file and renames it over the
 * target, so a reader never observes a half-written manifest.
 *
 * Files are created owner-only (0600) and creation refuses to clobber an
 * existing file — the same evidence-discipline conventions the harness
 * report files follow.
 */

import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import type { SeedManifest } from "@/scripts/perf/lib/seed-shapes";

export const MANIFEST_FILENAME = "seed-manifest.json";

/** Manifest persistence failure (unwritable run directory, clobbered file). */
export class SeedManifestWriteError extends Error {}

function writeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates a new manifest file (owner-only, refuses to clobber an existing one). */
export function writeManifestFile(path: string, manifest: SeedManifest): void {
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    throw new SeedManifestWriteError(`cannot create manifest at ${path}: ${writeErrorMessage(error)}`);
  }
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
}

/** Replaces the manifest atomically (write a sibling temp file, then rename over the target). */
export function replaceManifestFile(path: string, manifest: SeedManifest): void {
  const tmpPath = `${path}.tmp`;
  rmSync(tmpPath, { force: true });
  writeManifestFile(tmpPath, manifest);
  renameSync(tmpPath, path);
}
