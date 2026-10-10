/**
 * Seed-manifest selection for the matching benchmark. The benchmark runs
 * against a seeded perf dataset; the newest seed manifest under
 * `logs/perf/` is its data contract (run id, prefix, and the per-run
 * password hash reused for bench-owned caller rows). Only a COMPLETED
 * seed run is usable — an interrupted run's manifest keeps
 * `completedAt: null` and its rows may be partial, so it is refused with
 * an actionable message instead of benchmarked.
 */

import {
  type RawCleanupManifestEntry,
  selectCleanupManifestEntry,
  validateCleanupManifest,
} from "@/scripts/perf/lib/cleanup-manifest";

/** The validated seed facts the benchmark consumes. */
export interface BenchSeedPlan {
  readonly runId: string;
  readonly prefix: string;
  readonly passwordHash: string;
}

/** Actionable operator error (no usable seed run) — usage-class exit. */
export class BenchManifestError extends Error {}

interface BenchManifestBody {
  readonly completedAt: unknown;
  readonly identities: { readonly passwordHash: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Narrows a manifest body to the fields the benchmark reads beyond the cleanup plan. */
function readBenchFields(body: unknown): BenchManifestBody | null {
  if (!isRecord(body) || !("identities" in body)) {
    return null;
  }
  const identities = body.identities;
  if (!isRecord(identities) || !("passwordHash" in identities)) {
    return null;
  }
  return {
    completedAt: "completedAt" in body ? body.completedAt : undefined,
    identities: { passwordHash: identities.passwordHash },
  };
}

/**
 * Selects the newest seed manifest and validates it into a benchmark plan.
 * Refuses when no manifest exists, the newest is unreadable, its shape is
 * untrusted, its seed run is incomplete (`completedAt` is null), or its
 * identity inventory carries no password hash.
 */
export function selectBenchSeedPlan(entries: readonly RawCleanupManifestEntry[]): BenchSeedPlan {
  const entry = selectCleanupManifestEntry(entries, { runId: null, last: true });
  const plan = validateCleanupManifest(entry.body, entry.manifestPath);
  const fields = readBenchFields(entry.body);
  if (fields === null) {
    throw new BenchManifestError(`seed manifest ${entry.manifestPath} carries no identity inventory`);
  }
  if (typeof fields.completedAt !== "string") {
    throw new BenchManifestError(
      `seed run ${plan.runId} is incomplete (manifest completedAt is null) — re-run the seeder or clean the run up first`
    );
  }
  if (typeof fields.identities.passwordHash !== "string" || fields.identities.passwordHash.length === 0) {
    throw new BenchManifestError(`seed manifest ${entry.manifestPath} carries no password hash for bench callers`);
  }
  return { runId: plan.runId, prefix: plan.prefix, passwordHash: fields.identities.passwordHash };
}
