/**
 * Window mechanics for the API load harness: the per-VU session minting,
 * the teacher-pool harvest, the ramped per-VU request loops, and the
 * pg_stat_activity sampler that observes the window alongside them.
 * Any mid-window failure is funneled into a single shared failure
 * channel so the orchestrator can capture a partial report.
 */

import {
  type ApiScenario,
  buildTeacherHarvestRequest,
  parseHarvestedTeacherIds,
  TEACHER_HARVEST_PAGES,
} from "@/scripts/perf/lib/api-scenarios";
import type { LoadApiCliOptions } from "@/scripts/perf/lib/load-api-cli";
import {
  type ApiIdentitySession,
  type ApiLoadIo,
  errorMessage,
  LoadApiRefusalError,
} from "@/scripts/perf/lib/load-api-io";
import { classifyApiResponse, type PgActivityTracker, type ScenarioLedger } from "@/scripts/perf/lib/load-api-ledger";

import { createScenarioPicker, pickFromPool, type VuPlan } from "@/scripts/perf/lib/load-api-plan";
import { buildRunPassword, createSeededRandom } from "@/scripts/perf/lib/seed-random";

/** pg_stat_activity sampling cadence during the load window. */
const PG_SAMPLE_INTERVAL_MS = 5_000;
/** Sampler wake quantum: the sampler polls the window in small steps so short windows stay observable. */
const PG_SAMPLE_WAKE_MS = 250;

export interface WindowState {
  readonly io: ApiLoadIo;
  readonly options: LoadApiCliOptions;
  readonly baseUrl: string;
  readonly seedRunId: string;
  readonly runId: string;
  readonly windowEndMs: number;
  readonly weights: ReadonlyMap<string, number>;
  readonly ledgers: ReadonlyMap<string, ScenarioLedger>;
  readonly vuFacts: { index: number; role: string; email: string; iterations: number }[];
  readonly pgTracker: PgActivityTracker;
  readonly sessions: ReadonlyMap<number, ApiIdentitySession>;
  readonly plans: readonly VuPlan[];
  readonly teacherIds: readonly number[];
  readonly studentUserIds: readonly number[];
  abortedWithError: string | null;
}

/** Mints every VU's session up front (all-or-nothing; refusal on any failure). */
export async function mintVuSessions(
  io: ApiLoadIo,
  baseUrl: string,
  plans: readonly VuPlan[],
  seedRunId: string
): Promise<Map<number, ApiIdentitySession>> {
  const password = buildRunPassword(seedRunId);
  try {
    const minted = await Promise.all(
      plans.map(async plan => ({ plan, session: await io.mintSession(baseUrl, plan.email, password) }))
    );
    const sessions = new Map<number, ApiIdentitySession>();
    for (const entry of minted) {
      sessions.set(entry.plan.index, entry.session);
    }
    return sessions;
  } catch (error) {
    throw new LoadApiRefusalError(
      `session minting failed (the harness logs in through the real login mutation at ${baseUrl}; ` +
        `check the server is up and the seed run "${seedRunId}" is present): ${errorMessage(error)}`
    );
  }
}

/** Harvests the eligible-teacher id pool through the browse read (2 pages x 25). */
export async function harvestTeacherIds(
  io: ApiLoadIo,
  baseUrl: string,
  sessions: ReadonlyMap<number, ApiIdentitySession>,
  plans: readonly VuPlan[]
): Promise<readonly number[]> {
  const student = plans.find(plan => plan.role === "student");
  const session = student === undefined ? undefined : sessions.get(student.index);
  if (session === undefined) {
    throw new LoadApiRefusalError("no student session is available to harvest the teacher pool");
  }
  const ids: number[] = [];
  for (let page = 1; page <= TEACHER_HARVEST_PAGES; page += 1) {
    const request = buildTeacherHarvestRequest(session.cookieHeader, page);
    const result = await io.fetchGraphql(baseUrl, request.body, request.headers);
    const outcome = classifyApiResponse({ ok: result.ok, status: result.status, body: result.body });
    if (outcome.kind !== "success" || outcome.body === null) {
      const codeSuffix = outcome.errorCode === null ? "" : ` [${outcome.errorCode}]`;
      throw new LoadApiRefusalError(
        `the teacher pool harvest failed (browse page ${page} at ${baseUrl}: ${outcome.kind}${codeSuffix})`
      );
    }
    ids.push(...parseHarvestedTeacherIds(outcome.body));
  }
  if (ids.length === 0) {
    throw new LoadApiRefusalError(
      "the harvested teacher pool is empty — the seed run has no eligible teachers; run perf:seed first"
    );
  }
  return ids;
}

/** Builds, sends, and records one scenario request. */
async function runOneIteration(
  state: WindowState,
  plan: VuPlan,
  session: ApiIdentitySession,
  picker: () => ApiScenario,
  poolRandom: () => number,
  iteration: number
): Promise<void> {
  const scenario = picker();
  const ledger = state.ledgers.get(scenario.id);
  if (ledger === undefined) {
    return;
  }
  const targetUserId =
    state.studentUserIds.length > 0 ? pickFromPool(state.studentUserIds, poolRandom) : session.userId;
  const teacherId = scenario.id === "book-session" ? pickFromPool(state.teacherIds, poolRandom) : 0;
  const request = scenario.buildRequest(session.cookieHeader, {
    runId: state.runId,
    vu: plan.index,
    iteration,
    targetUserId,
    teacherId,
    credentials: { email: plan.email, password: buildRunPassword(state.seedRunId) },
  });
  const startedAt = state.io.now();
  const result = await state.io.fetchGraphql(state.baseUrl, request.body, request.headers);
  const durationMs = state.io.now() - startedAt;
  const outcome = classifyApiResponse({ ok: result.ok, status: result.status, body: result.body });
  ledger.record(outcome, durationMs);
}

/** Drives one VU's request loop until the window ends (one in-flight overshoot per VU is recorded honestly). */
async function runVuLoop(state: WindowState, plan: VuPlan): Promise<void> {
  if (plan.startOffsetMs > 0) {
    await state.io.sleep(plan.startOffsetMs);
  }
  const session = state.sessions.get(plan.index);
  if (session === undefined) {
    throw new Error(`virtual user ${plan.index} has no minted session`);
  }
  const activeForRole = [...state.ledgers.values()]
    .map(ledger => ledger.scenario)
    .filter(scenario => scenario.role === plan.role);
  const picker = createScenarioPicker(activeForRole, state.weights, `${state.runId}:vu:${plan.index}`);
  const poolRandom = createSeededRandom(`${state.runId}:vu:${plan.index}:pool`);
  let iterations = 0;
  while (state.io.now() < state.windowEndMs) {
    iterations += 1;
    await runOneIteration(state, plan, session, picker, poolRandom, iterations);
  }
  state.vuFacts.push({ index: plan.index, role: plan.role, email: plan.email, iterations });
}

/** Samples pg_stat_activity through the window: an immediate sample at the
 * window start, then every interval, waking in small quanta so the sampler
 * never overshoots the window by more than one quantum. */
async function runPgSampler(state: WindowState): Promise<void> {
  let nextSampleAt = state.io.now();
  while (true) {
    const now = state.io.now();
    if (now >= state.windowEndMs) {
      return;
    }
    if (now >= nextSampleAt) {
      const snapshot = await state.io.samplePgActivity();
      state.pgTracker.observe(
        snapshot === null ? null : { takenAtMs: now, rows: snapshot.rows, nonIdleCount: snapshot.nonIdleCount }
      );
      nextSampleAt = now + PG_SAMPLE_INTERVAL_MS;
    }
    await state.io.sleep(Math.min(PG_SAMPLE_WAKE_MS, state.windowEndMs - now));
  }
}

/** Runs the window: every VU loop plus the sampler, one shared failure channel. */
export async function runWindow(state: WindowState): Promise<void> {
  const tasks = state.plans.map(plan => runVuLoop(state, plan));
  tasks.push(runPgSampler(state));
  try {
    await Promise.all(tasks);
  } catch (error) {
    state.abortedWithError = errorMessage(error);
    state.io.log(`perf:load-api: run aborted: ${state.abortedWithError}`);
  }
}
