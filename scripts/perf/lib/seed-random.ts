/**
 * Determinism and identity helpers for the performance-data seeder.
 *
 * The seeded distributions are a pure function of the run identity: a
 * seeded PRNG (FNV-1a fold + mulberry32 core) derives every "random" choice,
 * so the same run id plus numeric seed always reproduces byte-identical
 * rows. This module also owns the synthetic identity vocabulary — run
 * prefix, per-role emails, the per-run credential, and the pure mirror of
 * the teacher matching pipeline's baseline eligibility predicate.
 */

import type { TeacherRoleSeedRow, UserSeedRow } from "@/scripts/perf/lib/seed-shapes";

/** Synthetic email domain for every seeded identity. */
const SEED_EMAIL_DOMAIN = "test.local";

/** FNV-1a 32-bit string fold — turns the seed key into a PRNG state. */
function hashSeedKey(seedKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seedKey.length; i += 1) {
    hash ^= seedKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic PRNG for the synthetic distributions: the same seed key
 * always yields the same value sequence, so identical run identities
 * reproduce byte-identical row sets.
 */
export function createSeededRandom(seedKey: string): () => number {
  let state = hashSeedKey(seedKey);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [min, max] from the seeded randomness source. */
export function intInRange(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Picks one array member from the seeded randomness source. */
export function pickRandom<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] ?? values[0];
}

/** Run prefix stamped into every synthetic identifier (`perf_<runId>_`). */
export function buildSeedPrefix(runId: string): string {
  return `perf_${runId}_`;
}

/**
 * Per-run credential for every synthetic account. Deterministically derived
 * from the run id (`perf-load-<runId>`), and the run id IS persisted (in the
 * seed manifest and every identifier prefix) — so the password is derivable
 * from persisted data by design; "never persisted" would overstate. This is
 * acceptable because the destructive-target guard confines every perf
 * identity to the `kottaby_test` database and the manifest is owner-only
 * (0600): the credential gates synthetic load-test accounts, not real users.
 * The manifest records only its bcrypt hash; the harness derives the same
 * value at mint time instead of storing it.
 */
export function buildRunPassword(runId: string): string {
  return `perf-load-${runId}`;
}

/** Zero-padded row index used inside synthetic names/emails (stable width up to the volume cap). */
export function padSeedIndex(index: number): string {
  return String(index).padStart(6, "0");
}

/** Synthetic teacher email for the given row index. */
export function teacherEmail(prefix: string, index: number): string {
  return `${prefix}teacher${padSeedIndex(index)}@${SEED_EMAIL_DOMAIN}`;
}

/** Synthetic student email for the given row index. */
export function studentEmail(prefix: string, index: number): string {
  return `${prefix}student${padSeedIndex(index)}@${SEED_EMAIL_DOMAIN}`;
}

/** Synthetic admin email (one admin per run). */
export function adminEmail(prefix: string): string {
  return `${prefix}admin@${SEED_EMAIL_DOMAIN}`;
}

/**
 * Mirrors the matching pipeline's baseline eligibility: the teacher is
 * online and certified, and the owning account is free of every governance
 * flag (not deleted, not suspended, not blocked).
 */
export function satisfiesMatcherEligibility(
  user: Pick<UserSeedRow, "isDeleted" | "suspended" | "isBlocked">,
  teacherRow: Pick<TeacherRoleSeedRow, "isOnline" | "isApproved">
): boolean {
  return teacherRow.isOnline && teacherRow.isApproved && !user.isDeleted && !user.suspended && !user.isBlocked;
}
