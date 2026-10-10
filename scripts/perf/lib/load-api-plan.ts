/**
 * Pure scheduling math for the API load harness: the VU ramp offsets, the
 * role partition (which VUs hold student vs admin identities), the identity
 * round-robin assignment, the deterministic weighted scenario picker, and
 * the per-iteration target picks (booking teacher, admin read target).
 */

import {
  API_SCENARIOS,
  type ApiScenario,
  type ApiScenarioRole,
  findApiScenario,
} from "@/scripts/perf/lib/api-scenarios";
import { createSeededRandom, pickRandom } from "@/scripts/perf/lib/seed-random";

/** Parsed ramp: how many virtual users start per interval. */
export interface LoadApiRampSpec {
  readonly count: number;
  readonly intervalMs: number;
}

/** Raised for unsatisfiable scheduling requests (empty pools, empty mixes). */
export class LoadApiPlanError extends Error {}

/** Runtime guard narrowing a thrown value to the plan error. */
export function isLoadApiPlanError(value: unknown): value is LoadApiPlanError {
  return value instanceof LoadApiPlanError;
}

/**
 * One VU's resolved identity + schedule slot.
 * `role` decides which scenario subset the VU may drive; `email` is its
 * synthetic seed identity; `startOffsetMs` is the ramp position.
 */
export interface VuPlan {
  readonly index: number;
  readonly role: ApiScenarioRole;
  readonly email: string;
  readonly startOffsetMs: number;
}

/**
 * Builds the per-VU ramp offsets: `ramp.count` VUs start at t=0, another
 * batch every `ramp.intervalMs`, last batch partial. The ramp span feeds
 * the window arithmetic (steady window begins when the last batch starts).
 */
export function buildVuRampOffsets(vus: number, ramp: LoadApiRampSpec): readonly number[] {
  if (vus < 1) {
    throw new LoadApiPlanError(`the VU count must be positive (got ${vus})`);
  }
  const offsets: number[] = [];
  for (let index = 0; index < vus; index += 1) {
    offsets.push(Math.floor(index / ramp.count) * ramp.intervalMs);
  }
  return offsets;
}

/** Total ramp span in ms (the offset of the last VU batch). */
export function rampSpanMs(vus: number, ramp: LoadApiRampSpec): number {
  const offsets = buildVuRampOffsets(vus, ramp);
  return offsets[offsets.length - 1] ?? 0;
}

/**
 * Partitions the VU count into admin and student VUs so the realized global
 * scenario mix matches the registry weights in expectation: the admin share
 * of active VUs equals the admin scenarios' share of the total weight.
 * With ≥2 VUs both roles are always represented when both have weight; a
 * single-VU run goes to the heavier side.
 */
export function partitionVuRoles(
  vus: number,
  scenarios: readonly ApiScenario[],
  weights: ReadonlyMap<string, number>
): { adminVus: number; studentVus: number } {
  let adminWeight = 0;
  let studentWeight = 0;
  for (const scenario of scenarios) {
    const weight = weights.get(scenario.id) ?? 0;
    if (weight <= 0) {
      continue;
    }
    if (scenario.role === "admin") {
      adminWeight += weight;
    } else {
      studentWeight += weight;
    }
  }
  if (adminWeight === 0) {
    return { adminVus: 0, studentVus: vus };
  }
  if (studentWeight === 0) {
    return { adminVus: vus, studentVus: 0 };
  }
  const total = adminWeight + studentWeight;
  let adminVus = Math.round((vus * adminWeight) / total);
  if (vus >= 2) {
    if (adminVus < 1) {
      adminVus = 1;
    }
    if (adminVus >= vus) {
      adminVus = vus - 1;
    }
  } else {
    adminVus = adminWeight * 2 > total ? 1 : 0;
  }
  return { adminVus, studentVus: vus - adminVus };
}

/**
 * Assigns every VU its identity and ramp slot. Student VUs draw student
 * emails round-robin, admin VUs admin emails round-robin (multiple VUs may
 * share the single admin identity — each mints its own session).
 */
export function assignVuIdentities(
  vus: number,
  ramp: LoadApiRampSpec,
  studentEmails: readonly string[],
  adminEmails: readonly string[],
  scenarios: readonly ApiScenario[],
  weights: ReadonlyMap<string, number>
): readonly VuPlan[] {
  if (studentEmails.length === 0) {
    throw new LoadApiPlanError("the seed manifest lists no student identities — run perf:seed first");
  }
  if (adminEmails.length === 0) {
    throw new LoadApiPlanError("the seed manifest lists no admin identities — run perf:seed first");
  }
  const { adminVus } = partitionVuRoles(vus, scenarios, weights);
  const offsets = buildVuRampOffsets(vus, ramp);
  const plans: VuPlan[] = [];
  for (let index = 0; index < vus; index += 1) {
    const isAdmin = index < adminVus;
    const pool = isAdmin ? adminEmails : studentEmails;
    const slot = isAdmin ? index : index - adminVus;
    plans.push({
      index,
      role: isAdmin ? "admin" : "student",
      email: pool[slot % pool.length] ?? "",
      startOffsetMs: offsets[index] ?? 0,
    });
  }
  return plans;
}

/**
 * Deterministic weighted scenario picker for one VU. Draws come from a
 * seeded PRNG keyed by the report run id + VU index, so a given run's
 * schedule is reproducible; every pick is a weighted choice over the
 * VU's-role scenarios with positive weight.
 */
export function createScenarioPicker(
  activeScenarios: readonly ApiScenario[],
  weights: ReadonlyMap<string, number>,
  seedKey: string
): () => ApiScenario {
  const candidates = activeScenarios.filter(scenario => (weights.get(scenario.id) ?? 0) > 0);
  if (candidates.length === 0) {
    throw new LoadApiPlanError("no scenario with a positive weight is available for this virtual user");
  }
  const total = candidates.reduce((sum, scenario) => sum + (weights.get(scenario.id) ?? 0), 0);
  const random = createSeededRandom(seedKey);
  return () => {
    let cursor = random() * total;
    for (const scenario of candidates) {
      cursor -= weights.get(scenario.id) ?? 0;
      if (cursor < 0) {
        return scenario;
      }
    }
    return candidates[candidates.length - 1];
  };
}

/**
 * Picks one pool member from the caller's randomness source (empty pools
 * are the caller's refusal — booking needs a teacher; the admin read falls
 * back to the admin's own user id when no student session exists).
 */
export function pickFromPool(pool: readonly number[], random: () => number): number {
  if (pool.length === 0) {
    throw new LoadApiPlanError("cannot pick from an empty id pool");
  }
  return pickRandom(random, pool);
}

/**
 * Parses a `--weights id=weight[,id=weight…]` override specification into
 * an id → weight map. Unknown ids, non-integer or negative weights, and a
 * full-registry all-zero list are refused; unspecified scenarios keep
 * their registry defaults and a last-wins rule applies to repeats.
 */
export function parseWeightOverrides(spec: string): Map<string, number> {
  const overrides = new Map<string, number>();
  const parts = spec
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    throw new LoadApiPlanError("--weights must look like id=weight[,id=weight…] (got an empty list)");
  }
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0 || separator === part.length - 1) {
      throw new LoadApiPlanError(`--weights entries must look like id=weight (got "${part}")`);
    }
    const id = part.slice(0, separator);
    const weightText = part.slice(separator + 1);
    if (!/^\d+$/.test(weightText)) {
      throw new LoadApiPlanError(`--weights weight for "${id}" must be a non-negative integer (got "${weightText}")`);
    }
    if (findApiScenario(id) === undefined) {
      const known = API_SCENARIOS.map(scenario => scenario.id).join(", ");
      throw new LoadApiPlanError(`--weights names an unknown scenario "${id}" (known: ${known})`);
    }
    overrides.set(id, Number(weightText));
  }
  if (overrides.size === API_SCENARIOS.length) {
    let positive = 0;
    for (const weight of overrides.values()) {
      if (weight > 0) {
        positive += 1;
      }
    }
    if (positive === 0) {
      throw new LoadApiPlanError("--weights set every scenario weight to zero — at least one must stay positive");
    }
  }
  return overrides;
}

/** The effective weight of one scenario after overrides (registry default when unnamed). */
function effectiveScenarioWeight(scenario: ApiScenario, overrides: ReadonlyMap<string, number>): number {
  return overrides.get(scenario.id) ?? scenario.weight;
}

/**
 * Resolves the effective scenario weights after overrides. Every scenario
 * keeps its registry weight unless the override map names it.
 */
export function resolveScenarioWeights(overridesSpec: string | null): Map<string, number> {
  const overrides = overridesSpec === null ? new Map<string, number>() : parseWeightOverrides(overridesSpec);
  const weights = new Map<string, number>();
  for (const scenario of API_SCENARIOS) {
    weights.set(scenario.id, effectiveScenarioWeight(scenario, overrides));
  }
  return weights;
}
