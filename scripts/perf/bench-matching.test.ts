import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import type {
  TeacherMatchingItemReturnType,
  TeacherMatchingPageReturnType,
  TeacherMatchingSubmitInput,
} from "@/backend/types";
import {
  type BenchMatchingIo,
  type BenchMatchingOutcome,
  BenchMatchingRefusalError,
  runBenchMatching,
} from "@/scripts/perf/bench-matching";
import {
  BENCH_PAGE,
  BENCH_PAGE_SIZE,
  buildCellId,
  buildSelfCheckCell,
  cellsPerVolume,
  enumerateCells,
  GATE_VOLUME,
  MIN_RATING_FLOOR,
  NAME_SEARCH_TOKEN,
} from "@/scripts/perf/lib/bench-matching-cells";
import {
  type BenchMatchingCliOptions,
  DEFAULT_GATE_MS,
  DEFAULT_SAMPLES,
  DEFAULT_VOLUMES,
  DEFAULT_WARMUP,
  isBenchMatchingCliUsageError,
  MAX_GATE_MS,
  MAX_SAMPLES,
  parseBenchMatchingCli,
} from "@/scripts/perf/lib/bench-matching-cli";
import type { BenchDatabase } from "@/scripts/perf/lib/bench-matching-db";
import { BenchManifestError, selectBenchSeedPlan } from "@/scripts/perf/lib/bench-matching-manifest";
import {
  type BenchCallerInsert,
  buildVolumeSteps,
  planCallers,
  resolveCallerLanguageToken,
  type StudentCandidateRow,
} from "@/scripts/perf/lib/bench-matching-plan";
import {
  type BrowseSeam,
  findEnvelopeViolation,
  findExclusionViolation,
  runCell,
} from "@/scripts/perf/lib/bench-matching-runner";
import type { RawCleanupManifestEntry } from "@/scripts/perf/lib/cleanup-manifest";
import type { PerfRunContext } from "@/scripts/perf/lib/report";
import { createSeededRandom } from "@/scripts/perf/lib/seed-random";
import { SEED_MANIFEST_TABLES } from "@/scripts/perf/lib/seed-shapes";
import type { GateResult } from "@/scripts/perf/lib/stats";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const BENCH_SCRIPT_PATH = join(REPO_ROOT, "scripts", "perf", "bench-matching.ts");
const PERF_LOGS_DIR = join(REPO_ROOT, "logs", "perf");

/** A well-formed page envelope for the given honest total. */
function makePage(total: number, itemIds: readonly number[] = []): TeacherMatchingPageReturnType {
  return {
    items: itemIds.map(id => makeItem(id)),
    total,
    page: BENCH_PAGE,
    pageSize: BENCH_PAGE_SIZE,
    pageCount: Math.ceil(total / BENCH_PAGE_SIZE),
  };
}

function makeItem(id: number): TeacherMatchingItemReturnType {
  return {
    id,
    fullName: `Teacher ${id}`,
    country: "Egypt",
    countryCode: "EG",
    subjects: ["hifz"],
    recitations: [],
    languages: ["english"],
    averageRating: 4.5,
    isOnline: true,
  };
}

/** Clock producing the given per-iteration durations (pairs of reads). */
function pairClock(durations: readonly number[]): () => number {
  let time = 0;
  let tick = 0;
  return () => {
    const span = durations[Math.floor(tick / 2)] ?? 1;
    const isStart = tick % 2 === 0;
    tick += 1;
    if (isStart) {
      const start = time;
      time += span;
      return start;
    }
    return time;
  };
}

type BrowseBehavior = (request: {
  callerId: number;
  input: TeacherMatchingSubmitInput;
  locale: string;
}) => TeacherMatchingPageReturnType | Promise<TeacherMatchingPageReturnType>;

/** Records every browse call; behavior is programmable per invocation. */
class FakeSeam implements BrowseSeam {
  readonly calls: { callerId: number; input: TeacherMatchingSubmitInput; locale: string }[] = [];

  constructor(private readonly behavior: BrowseBehavior) {}

  async browse(
    studentUserId: number,
    input: TeacherMatchingSubmitInput,
    locale: string
  ): Promise<TeacherMatchingPageReturnType> {
    this.calls.push({ callerId: studentUserId, input, locale });
    const result = this.behavior({ callerId: studentUserId, input, locale });
    if (result instanceof Promise) {
      return result;
    }
    return Promise.resolve(result);
  }
}

/** In-memory database seam recording flips, inserts, and closes. */
class FakeBenchDatabase implements BenchDatabase {
  offlineCalls: number[][] = [];
  onlineCalls: number[][] = [];
  inserted: BenchCallerInsert[] = [];
  closeCount = 0;
  offlineFailure: Error | null = null;

  constructor(
    readonly censusIds: number[],
    readonly startedIds: number[],
    readonly students: StudentCandidateRow[]
  ) {}

  async findEligibleTeacherIds(): Promise<number[]> {
    return this.censusIds;
  }

  async findStartedTeacherIds(): Promise<number[]> {
    return this.startedIds;
  }

  async setTeachersOffline(ids: readonly number[]): Promise<number> {
    if (this.offlineFailure !== null) {
      throw this.offlineFailure;
    }
    this.offlineCalls.push([...ids]);
    return ids.length;
  }

  async setTeachersOnline(ids: readonly number[]): Promise<number> {
    this.onlineCalls.push([...ids]);
    return ids.length;
  }

  async listStudentCandidates(): Promise<StudentCandidateRow[]> {
    return this.students;
  }

  async insertBenchCaller(insert: BenchCallerInsert): Promise<number> {
    this.inserted.push(insert);
    return 900_000 + this.inserted.length;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface MatrixCellRow {
  readonly id: string;
  readonly volume: number;
  readonly gateCell: boolean;
}

function isMatrixCellRow(value: unknown): value is MatrixCellRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.volume === "number" &&
    typeof value.gateCell === "boolean"
  );
}

function matrixRows(sections: Record<string, unknown>): MatrixCellRow[] {
  const value = sections.matrix;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isMatrixCellRow);
}

/** The plain-variant browse input shared by direct runner tests. */
const PLAIN_INPUT: TeacherMatchingSubmitInput = {
  recitation: null,
  intent: null,
  page: BENCH_PAGE,
  pageSize: BENCH_PAGE_SIZE,
  search: null,
  minRating: null,
  sort: TeacherMatchingSort.RatingDesc,
};

/** Builds one readable, shape-valid seed manifest entry. */
function manifestEntry(
  runId: string,
  options: {
    readonly completedAt?: string | null;
    readonly passwordHash?: string;
    readonly omitIdentities?: boolean;
    readonly stamp?: string;
  } = {}
): RawCleanupManifestEntry {
  const identities = options.omitIdentities
    ? undefined
    : {
        studentEmails: [] as string[],
        adminEmails: [] as string[],
        wsIdentityEmails: [] as string[],
        hotTeacherEmails: [] as string[],
        passwordHash: options.passwordHash ?? "$2b$12$seedhashvalue",
        passwordNote: "bcrypt hash only",
      };
  const completedAt = options.completedAt === undefined ? "2026-10-09T00:00:01.000Z" : options.completedAt;
  const body: Record<string, unknown> = {
    runId,
    prefix: `perf_${runId}_`,
    startedAt: "2026-10-09T00:00:00.000Z",
    completedAt,
    database: "kottaby_test",
    tables: [...SEED_MANIFEST_TABLES],
  };
  if (identities !== undefined) {
    body.identities = identities;
  }
  return {
    runDirName: `${options.stamp ?? "2026-10-09T00-00-00"}_seed`,
    manifestPath: `logs/perf/fake-${runId}/seed-manifest.json`,
    body,
    readError: null,
  };
}

interface FakeIoState {
  readonly io: BenchMatchingIo;
  readonly db: FakeBenchDatabase;
  readonly seam: FakeSeam;
  readonly effectCalls: string[];
  report: { ctx: PerfRunContext; gates: readonly GateResult[]; sections: Record<string, unknown> } | null;
  openedRuns: number;
}

/** Assembles a full fake io with an in-memory database and programmable seam. */
function createFakeIo(params: {
  readonly censusIds?: number[];
  readonly startedIds?: number[];
  readonly students?: StudentCandidateRow[];
  readonly manifestEntries?: readonly RawCleanupManifestEntry[];
  readonly behavior?: BrowseBehavior;
  readonly clock?: () => number;
}): FakeIoState {
  const db = new FakeBenchDatabase(
    params.censusIds ?? Array.from({ length: 12 }, (_, index) => index + 1),
    params.startedIds ?? [],
    params.students ?? [{ id: 41, primaryLanguage: "arabic", anotherLanguage: null }]
  );
  const seam = new FakeSeam(params.behavior ?? (() => makePage(1, [999])));
  const state: FakeIoState = {
    db,
    seam,
    effectCalls: [],
    report: null,
    openedRuns: 0,
    io: {
      env: () => ({ databaseUrl: "postgres://user@localhost/kottaby_test" }),
      assertTarget: () => {
        state.effectCalls.push("assertTarget");
        return { ok: true, dbName: "kottaby_test" };
      },
      listManifests: () => {
        state.effectCalls.push("listManifests");
        return params.manifestEntries ?? [manifestEntry("5eedc0de")];
      },
      connect: async () => {
        state.effectCalls.push("connect");
        return db;
      },
      openRun: () => {
        state.effectCalls.push("openRun");
        state.openedRuns += 1;
        return { runDir: "logs/perf/fake-bench-run", runId: "2026-10-09T00-00-00_bench-matching" };
      },
      writeReport: (ctx, gates, sections) => {
        state.effectCalls.push("writeReport");
        state.report = { ctx, gates, sections };
      },
      now: params.clock ?? pairClock([1]),
      browse: (studentUserId, input, locale) => seam.browse(studentUserId, input, locale),
    },
  };
  return state;
}

const CLI_OPTIONS: BenchMatchingCliOptions = {
  volumes: [10],
  samples: 2,
  warmup: 1,
  gateMs: DEFAULT_GATE_MS,
  selfCheck: false,
};

/** Parses and narrows to the options arm (throws on an unexpected usage refusal). */
function parseOk(argv: readonly string[]): BenchMatchingCliOptions {
  const parsed = parseBenchMatchingCli(argv);
  if (isBenchMatchingCliUsageError(parsed)) {
    throw new Error(`unexpected usage refusal: ${parsed.message}`);
  }
  return parsed;
}

/** Runs a promise expected to reject; asserts the catch and returns the error. */
async function expectRunError(run: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).not.toBeNull();
  return caught;
}

describe("parseBenchMatchingCli", () => {
  it("parses the documented defaults", () => {
    expect(parseOk([])).toEqual({
      volumes: DEFAULT_VOLUMES,
      samples: DEFAULT_SAMPLES,
      warmup: DEFAULT_WARMUP,
      gateMs: DEFAULT_GATE_MS,
      selfCheck: false,
    });
  });

  it("sorts volumes descending, de-duplicates, and honors any input order", () => {
    expect(parseOk(["--volumes", "100, 2000,500, 100"]).volumes).toEqual([2000, 500, 100]);
  });

  it("parses every numeric knob and the boolean self-check switch (last flag wins)", () => {
    const parsed = parseOk([
      "--samples",
      "7",
      "--samples",
      "9",
      "--warmup",
      "2",
      "--gate-ms",
      "250",
      "--self-check",
      "stray-bare-token",
    ]);
    expect(parsed.samples).toBe(9);
    expect(parsed.warmup).toBe(2);
    expect(parsed.gateMs).toBe(250);
    expect(parsed.selfCheck).toBe(true);
  });

  it("refuses unknown flags once each and lists the accepted flags", () => {
    const parsed = parseBenchMatchingCli(["--bogus", "--other", "--bogus"]);
    expect(isBenchMatchingCliUsageError(parsed)).toBe(true);
    if (isBenchMatchingCliUsageError(parsed)) {
      expect(parsed.unknownFlags).toEqual(["--bogus", "--other"]);
      expect(parsed.message).toContain("unknown flag(s): --bogus, --other");
      expect(parsed.message).toContain("accepted flags: --volumes, --samples, --warmup, --gate-ms, --self-check");
    }
  });

  it("refuses missing, non-integer, and out-of-range values", () => {
    const missing = parseBenchMatchingCli(["--samples"]);
    expect(isBenchMatchingCliUsageError(missing)).toBe(true);
    const flagAsValue = parseBenchMatchingCli(["--volumes", "--samples"]);
    expect(isBenchMatchingCliUsageError(flagAsValue)).toBe(true);
    for (const argv of [
      ["--samples", "abc"],
      ["--samples", "-3"],
      ["--samples", `${MAX_SAMPLES + 1}`],
      ["--warmup", "1.5"],
      ["--gate-ms", "0"],
      ["--gate-ms", `${MAX_GATE_MS + 1}`],
      ["--volumes", ""],
      ["--volumes", "100,,200"],
      ["--volumes", "x"],
    ]) {
      const parsed = parseBenchMatchingCli(argv);
      expect(isBenchMatchingCliUsageError(parsed)).toBe(true);
    }
  });

  it("allows a zero volume (the zero-eligible window) and zero sample counts", () => {
    expect(parseOk(["--volumes", "0", "--samples", "0", "--warmup", "0"]).volumes).toEqual([0]);
  });
});

describe("matrix enumeration", () => {
  it("enumerates every volume × sort × variant deterministically with stable ids", () => {
    const cells = enumerateCells([2000, 100]);
    expect(cells).toHaveLength(2 * cellsPerVolume());
    expect(cells[0]).toMatchObject({
      id: "matching-2000-rating-desc-plain",
      volume: 2000,
      sort: TeacherMatchingSort.RatingDesc,
      sortToken: "rating-desc",
      variantToken: "plain",
      caller: "no-filter",
    });
    expect(cells.map(cell => cell.id)).toContain("matching-100-newest-min-rating");
    const ids = new Set(cells.map(cell => cell.id));
    expect(ids.size).toBe(cells.length);
    const tokens = cells.slice(0, 4).map(cell => cell.variantToken);
    expect(tokens).toEqual(["plain", "subject-language", "name-search", "min-rating"]);
    const sortTokens = cells.slice(0, cellsPerVolume()).map(cell => cell.sortToken);
    expect(sortTokens).toEqual([
      "rating-desc",
      "rating-desc",
      "rating-desc",
      "rating-desc",
      "name-asc",
      "name-asc",
      "name-asc",
      "name-asc",
      "newest",
      "newest",
      "newest",
      "newest",
    ]);
  });

  it("builds each variant's input with the wire page bounds and the right caller kind", () => {
    const cells = enumerateCells([100]);
    const byVariant = new Map(
      cells.filter(cell => cell.sortToken === "rating-desc").map(cell => [cell.variantToken, cell])
    );
    const plain = byVariant.get("plain");
    const subjectLanguage = byVariant.get("subject-language");
    const nameSearch = byVariant.get("name-search");
    const minRating = byVariant.get("min-rating");
    expect(plain?.input).toEqual({
      recitation: null,
      intent: null,
      page: BENCH_PAGE,
      pageSize: BENCH_PAGE_SIZE,
      search: null,
      minRating: null,
      sort: TeacherMatchingSort.RatingDesc,
    });
    expect(subjectLanguage?.input.intent).toBe(SessionIntent.Hifz);
    expect(subjectLanguage?.caller).toBe("language");
    expect(nameSearch?.input.search).toBe(NAME_SEARCH_TOKEN);
    expect(minRating?.input.minRating).toBe(MIN_RATING_FLOOR);
    expect(subjectLanguage?.id).toBe(buildCellId(100, "rating-desc", "subject-language"));
  });

  it("builds the self-check cell over the live census with the default sort", () => {
    const cell = buildSelfCheckCell(12);
    expect(cell.id).toBe("matching-12-rating-desc-plain");
    expect(cell.caller).toBe("no-filter");
    expect(cell.input.sort).toBe(TeacherMatchingSort.RatingDesc);
  });
});

describe("volume window planning", () => {
  it("builds cumulative descending steps that flip only the delta beyond each window", () => {
    const census = Array.from({ length: 10 }, (_, index) => index + 1);
    const steps = buildVolumeSteps([10, 5, 2], census);
    expect(steps.map(step => step.volume)).toEqual([10, 5, 2]);
    expect(steps[0]?.flipIds).toEqual([]);
    expect(steps[1]?.flipIds).toEqual([6, 7, 8, 9, 10]);
    expect(steps[2]?.flipIds).toEqual([3, 4, 5]);
  });

  it("clamps oversized volumes to the census without flipping anything", () => {
    const census = [1, 2, 3];
    const steps = buildVolumeSteps([5, 0], census);
    expect(steps[0]?.windowSize).toBe(3);
    expect(steps[0]?.flipIds).toEqual([]);
    expect(steps[1]?.flipIds).toEqual([1, 2, 3]);
  });
});

describe("caller resolution", () => {
  it("mirrors the service's language resolution for every token shape", () => {
    expect(resolveCallerLanguageToken(null, null)).toBeNull();
    expect(resolveCallerLanguageToken("arabic", null)).toBeNull();
    expect(resolveCallerLanguageToken("Arabic ", null)).toBeNull();
    expect(resolveCallerLanguageToken(null, "English")).toBe("english");
    expect(resolveCallerLanguageToken(null, "French")).toBe("french");
    expect(resolveCallerLanguageToken('"quoted"', null)).toBe("invalid");
    expect(resolveCallerLanguageToken("back\\slash", null)).toBe("invalid");
    expect(resolveCallerLanguageToken("x".repeat(51), null)).toBe("invalid");
    expect(resolveCallerLanguageToken("   ", null)).toBe("invalid");
  });

  it("picks seeded identities and plans bench inserts only for missing kinds", () => {
    const both = planCallers(
      [
        { id: 1, primaryLanguage: "arabic", anotherLanguage: null },
        { id: 2, primaryLanguage: "english", anotherLanguage: null },
      ],
      "perf_ab12cd34_",
      "$2b$12$hash"
    );
    expect(both.noFilterCallerId).toBe(1);
    expect(both.languageCallerId).toBe(2);
    expect(both.inserts).toEqual([]);

    const missingEnglish = planCallers(
      [{ id: 7, primaryLanguage: "arabic", anotherLanguage: null }],
      "perf_ab12cd34_",
      "$2b$12$hash"
    );
    expect(missingEnglish.languageCallerId).toBeNull();
    expect(missingEnglish.inserts).toHaveLength(1);
    expect(missingEnglish.inserts[0]?.email).toBe("perf_ab12cd34_bench-caller-english@test.local");
    expect(missingEnglish.inserts[0]?.primaryLanguage).toBe("english");

    const none = planCallers([], "perf_ab12cd34_", "$2b$12$hash");
    expect(none.inserts).toHaveLength(2);
    expect(
      none.inserts.map(insert => insert.primaryLanguage).toSorted((left, right) => left.localeCompare(right))
    ).toEqual(["arabic", "english"]);
  });
});

describe("selectBenchSeedPlan", () => {
  it("selects the newest completed manifest into a benchmark plan", () => {
    // entries arrive newest-first (the scan's ordering contract)
    const plan = selectBenchSeedPlan([
      manifestEntry("5eedc0de", { stamp: "2026-10-09T00-00-01" }),
      manifestEntry("aaaa0000"),
    ]);
    expect(plan).toEqual({ runId: "5eedc0de", prefix: "perf_5eedc0de_", passwordHash: "$2b$12$seedhashvalue" });
  });

  it("refuses an incomplete seed run and a manifest without identities", () => {
    expect(() => selectBenchSeedPlan([manifestEntry("5eedc0de", { completedAt: null })])).toThrow(BenchManifestError);
    const noIdentities = manifestEntry("5eedc0de", { omitIdentities: true });
    expect(() => selectBenchSeedPlan([noIdentities])).toThrow(BenchManifestError);
  });

  it("propagates the actionable refusal when no manifests exist", () => {
    expect(() => selectBenchSeedPlan([])).toThrow(/no seed manifests found/);
  });
});

describe("runCell (sample loop and per-sample oracles)", () => {
  const REQUEST = { id: "matching-1-rating-desc-plain", callerId: 41, input: PLAIN_INPUT };

  function makeOptions(overrides: Partial<Parameters<typeof runCell>[1]>): Parameters<typeof runCell>[1] {
    return {
      warmup: 1,
      samples: 4,
      startedTeacherIds: [7],
      seam: new FakeSeam(() => makePage(1, [999])),
      now: pairClock([10, 20, 30, 40, 50, 60]),
      ...overrides,
    };
  }

  it("records exactly the post-warmup samples and summarizes their durations", async () => {
    const seam = new FakeSeam(() => makePage(2, [999, 998]));
    const result = await runCell(REQUEST, makeOptions({ seam }));
    expect(seam.calls).toHaveLength(5);
    expect(result.summary).toEqual({ count: 4, errorCount: 0, p50: 30, p95: 50, p99: 50, max: 50 });
    expect(result.totalMin).toBe(2);
    expect(result.totalMax).toBe(2);
    expect(result.errorCodes).toEqual([]);
  });

  it("records a failed warmup browse as an error sample (fail-closed warmup)", async () => {
    let call = 0;
    const seam = new FakeSeam(() => {
      call += 1;
      if (call === 1) {
        throw new Error("cold path failure");
      }
      return makePage(1, [999]);
    });
    const result = await runCell(REQUEST, makeOptions({ seam }));
    expect(result.summary.count).toBe(5);
    expect(result.summary.errorCount).toBe(1);
    expect(result.errorCodes).toEqual(["service-error"]);
  });

  it("flags a thrown sample browse as a service error without storing messages", async () => {
    let call = 0;
    const seam = new FakeSeam(() => {
      call += 1;
      if (call === 3) {
        throw new Error("SECRET-NEVER-STORED");
      }
      return makePage(1, [999]);
    });
    const result = await runCell(REQUEST, makeOptions({ seam }));
    expect(result.summary.errorCount).toBe(1);
    expect(result.errorCodes).toEqual(["service-error"]);
    expect(JSON.stringify(result)).not.toContain("SECRET-NEVER-STORED");
  });

  it("accepts an honest empty page (zero-eligible volume)", async () => {
    const seam = new FakeSeam(() => makePage(0));
    const result = await runCell(REQUEST, makeOptions({ seam }));
    expect(result.summary.errorCount).toBe(0);
    expect(result.totalMin).toBe(0);
  });

  it("detects every envelope inconsistency per sample", () => {
    const page = makePage(30);
    expect(
      findEnvelopeViolation(
        makePage(
          30,
          Array.from({ length: 25 }, (_, i) => 500 + i)
        )
      )
    ).toBeNull();
    expect(findEnvelopeViolation({ ...page, page: 2 })).toBe("envelope:page");
    expect(findEnvelopeViolation({ ...page, pageSize: 50 })).toBe("envelope:page-size");
    expect(findEnvelopeViolation({ ...page, pageCount: 0 })).toBe("envelope:page-count");
    expect(findEnvelopeViolation({ ...page, items: [...page.items, makeItem(1)] })).toBe("envelope:items-length");
    expect(findEnvelopeViolation(makePage(0))).toBeNull();
  });

  it("detects an in-session teacher on any result page (per-sample exclusion oracle)", () => {
    expect(findExclusionViolation([makeItem(1), makeItem(2)], [7])).toBeNull();
    expect(findExclusionViolation([makeItem(1), makeItem(7)], [7])).toBe("exclusion:started-teacher");
    expect(findExclusionViolation([], [7])).toBeNull();
  });

  it("marks a clock that runs backwards or yields non-finite durations as a clock error", async () => {
    const backwards = await runCell(REQUEST, makeOptions({ now: pairClock([10, -5, 10, 10, 10, 10]) }));
    expect(backwards.errorCodes).toContain("clock-error");
    expect(backwards.summary.errorCount).toBe(1);
    const nan = await runCell(REQUEST, makeOptions({ now: pairClock([Number.NaN, 10, 10, 10, 10, 10]) }));
    expect(nan.errorCodes).toContain("clock-error");
  });

  it("survives a single-sample and a zero-sample cell", async () => {
    const single = await runCell(REQUEST, makeOptions({ samples: 1, now: pairClock([10, 10]) }));
    expect(single.summary).toEqual({ count: 1, errorCount: 0, p50: 10, p95: 10, p99: 10, max: 10 });
    const zero = await runCell(REQUEST, makeOptions({ samples: 0 }));
    expect(zero.summary).toEqual({ count: 0, errorCount: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  it("keeps concurrent cells' sample sets isolated", async () => {
    const seam = new FakeSeam(() => makePage(1, [999]));
    const options = makeOptions({ seam, samples: 5 });
    const [left, right] = await Promise.all([
      runCell({ ...REQUEST, id: "cell-left" }, options),
      runCell({ ...REQUEST, id: "cell-right", callerId: 42 }, options),
    ]);
    expect(left.summary.count).toBe(5);
    expect(right.summary.count).toBe(5);
    expect(seam.calls).toHaveLength(12);
    expect(seam.calls.filter(call => call.callerId === 41)).toHaveLength(6);
    expect(seam.calls.filter(call => call.callerId === 42)).toHaveLength(6);
  });

  it("holds the exclusion oracle under a mid-stream poisoned page (adversarial fixture)", async () => {
    let call = 0;
    const seam = new FakeSeam(() => {
      call += 1;
      return call === 2 ? makePage(1, [7]) : makePage(1, [999]);
    });
    const result = await runCell(REQUEST, makeOptions({ samples: 3, seam }));
    expect(result.summary.errorCount).toBe(1);
    expect(result.errorCodes).toEqual(["exclusion:started-teacher"]);
  });
});

describe("runBenchMatching (orchestration)", () => {
  it("runs the guard before any other effectful call", async () => {
    const state = createFakeIo({});
    await runBenchMatching(CLI_OPTIONS, state.io);
    expect(state.effectCalls[0]).toBe("assertTarget");
    expect(state.effectCalls.indexOf("assertTarget")).toBeLessThan(state.effectCalls.indexOf("listManifests"));
  });

  it("runs every cell under its volume window and restores every flip on success", async () => {
    const census = Array.from({ length: 10 }, (_, index) => index + 1);
    const state = createFakeIo({
      censusIds: census,
      startedIds: [1],
      students: [
        { id: 41, primaryLanguage: "arabic", anotherLanguage: null },
        { id: 42, primaryLanguage: "english", anotherLanguage: null },
      ],
    });
    const outcome = await runBenchMatching({ ...CLI_OPTIONS, volumes: [10, 5] }, state.io);
    expect(state.db.offlineCalls).toEqual([[6, 7, 8, 9, 10]]);
    expect(state.db.onlineCalls).toEqual([[6, 7, 8, 9, 10]]);
    expect(state.seam.calls).toHaveLength(24 * (CLI_OPTIONS.samples + CLI_OPTIONS.warmup));
    const noFilterCalls = state.seam.calls.filter(call => call.callerId === 41);
    const languageCalls = state.seam.calls.filter(call => call.callerId === 42);
    expect(noFilterCalls.length + languageCalls.length).toBe(state.seam.calls.length);
    expect(languageCalls.every(call => call.input.intent === SessionIntent.Hifz)).toBe(true);
    expect(outcome.sections).toHaveProperty("matrix");
    expect(state.db.closeCount).toBe(1);
    expect(state.report?.ctx.args.volumes).toBe("10,5");
  });

  it("gates only the 100-teacher cells and reports the rest as scale evidence", async () => {
    const census = Array.from({ length: 120 }, (_, index) => index + 1);
    const state = createFakeIo({ censusIds: census, startedIds: [1, 2] });
    const outcome = await runBenchMatching({ ...CLI_OPTIONS, volumes: [120, GATE_VOLUME] }, state.io);
    const gateCells = outcome.gates.map(gate => gate.id);
    expect(gateCells).toHaveLength(cellsPerVolume());
    for (const gate of gateCells) {
      expect(gate.startsWith(`matching-${GATE_VOLUME}-`)).toBe(true);
    }
    const matrix = matrixRows(state.report?.sections ?? {});
    expect(matrix).toHaveLength(24);
    expect(matrix.filter(cell => cell.volume === 120).every(cell => !cell.gateCell)).toBe(true);
    expect(outcome.passed).toBe(true);
  });

  it("fails the gate when a gate cell breaches p95 exactly at the budget (strict below)", async () => {
    const census = Array.from({ length: GATE_VOLUME }, (_, index) => index + 1);
    const state = createFakeIo({ censusIds: census, behavior: () => makePage(1, [999]) });
    const outcome = await runBenchMatching(
      { ...CLI_OPTIONS, volumes: [GATE_VOLUME], samples: 4, warmup: 0, gateMs: 5 },
      { ...state.io, now: pairClock([5, 5, 5, 5]) }
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.gates[0]?.passed).toBe(false);
    expect(outcome.gates[0]?.breaches[0]).toContain("not below the 5ms limit");
  });

  it("fails closed when a gate cell collects zero samples", async () => {
    const census = Array.from({ length: GATE_VOLUME }, (_, index) => index + 1);
    const state = createFakeIo({ censusIds: census });
    const outcome = await runBenchMatching({ ...CLI_OPTIONS, volumes: [GATE_VOLUME], samples: 0, warmup: 0 }, state.io);
    expect(outcome.passed).toBe(false);
    expect(outcome.gates[0]?.breaches[0]).toContain("no samples collected");
  });

  it("fails the gate on any assertion error, wherever the poisoned page lands", async () => {
    const census = Array.from({ length: GATE_VOLUME }, (_, index) => index + 1);
    let call = 0;
    const state = createFakeIo({
      censusIds: census,
      startedIds: [1],
      behavior: () => {
        call += 1;
        return call === 10 ? makePage(1, [1]) : makePage(1, [999]);
      },
    });
    const outcome = await runBenchMatching({ ...CLI_OPTIONS, volumes: [GATE_VOLUME], samples: 3, warmup: 0 }, state.io);
    expect(outcome.passed).toBe(false);
    expect(outcome.gates.some(gate => gate.breaches.some(breach => breach.includes("exceeds the maximum")))).toBe(true);
  });

  it("self-check runs one ungated cell over the live census without any flips", async () => {
    const state = createFakeIo({ censusIds: [1, 2, 3], startedIds: [1] });
    const outcome = await runBenchMatching({ ...CLI_OPTIONS, volumes: [2000], selfCheck: true }, state.io);
    expect(state.seam.calls).toHaveLength(4);
    expect(state.db.offlineCalls).toEqual([]);
    expect(outcome.gates).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(state.report?.ctx.args.volumes).toBe("self-check@3");
  });

  it("refuses a volume beyond the seeded census before opening a run directory", async () => {
    const state = createFakeIo({ censusIds: [1, 2, 3] });
    const error = await expectRunError(() => runBenchMatching({ ...CLI_OPTIONS, volumes: [10] }, state.io));
    expect(error).toBeInstanceOf(BenchMatchingRefusalError);
    expect(state.openedRuns).toBe(0);
    expect(state.effectCalls).not.toContain("writeReport");
  });

  it("refuses an incomplete seed run before connecting to the database", async () => {
    const state = createFakeIo({ manifestEntries: [manifestEntry("5eedc0de", { completedAt: null })] });
    const error = await expectRunError(() => runBenchMatching(CLI_OPTIONS, state.io));
    expect(error).toBeInstanceOf(BenchManifestError);
    expect(state.effectCalls).not.toContain("connect");
  });

  it("seeds a bench caller when no suitable seeded identity exists", async () => {
    const state = createFakeIo({ students: [{ id: 41, primaryLanguage: "arabic", anotherLanguage: null }] });
    await runBenchMatching(CLI_OPTIONS, state.io);
    expect(state.db.inserted.map(insert => insert.primaryLanguage)).toEqual(["english"]);
    expect(state.seam.calls.some(call => call.callerId === 900_001)).toBe(true);
    const sections = state.report?.sections ?? {};
    const callers = isRecord(sections.callers) ? sections.callers : {};
    expect(callers.benchSeededCallerCount).toBe(1);
  });

  it("restores the window flips and closes the database when the matrix fails mid-run", async () => {
    const census = Array.from({ length: 10 }, (_, index) => index + 1);
    const state = createFakeIo({ censusIds: census });
    state.db.offlineFailure = new Error("flip exploded");
    const error = await expectRunError(() => runBenchMatching({ ...CLI_OPTIONS, volumes: [10, 5] }, state.io));
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain("flip exploded");
    }
    expect(state.db.onlineCalls).toEqual([[6, 7, 8, 9, 10]]);
    expect(state.db.closeCount).toBe(1);
  });

  it("never writes the seed manifest's password hash into the report", async () => {
    const state = createFakeIo({
      manifestEntries: [manifestEntry("5eedc0de", { passwordHash: "$2b$12$TOP-SECRET-HASH" })],
      students: [],
    });
    await runBenchMatching(CLI_OPTIONS, state.io);
    const serialized = JSON.stringify(state.report?.sections);
    expect(serialized).not.toContain("TOP-SECRET-HASH");
    expect(serialized).not.toContain("$2b$12$");
  });
});

describe("runBenchMatching (chaos fuzz)", () => {
  it("survives fuzzed durations, violations, and throws with exact accounting", async () => {
    const random = createSeededRandom("bench-fuzz");
    const trials = Array.from({ length: 30 }, (_, trial) => trial);
    const checks = trials.map(() => {
      const sampleCount = 1 + Math.floor(random() * 8);
      let expectedErrors = 0;
      const seam = new FakeSeam(() => {
        const roll = random();
        if (roll < 0.15) {
          expectedErrors += 1;
          throw new Error("fuzzed failure");
        }
        if (roll < 0.3) {
          expectedErrors += 1;
          return makePage(1, [7]);
        }
        return makePage(1, [999]);
      });
      return runCell(
        { id: "fuzz-cell", callerId: 1, input: PLAIN_INPUT },
        { warmup: 0, samples: sampleCount, startedTeacherIds: [7], seam, now: () => 0 }
      ).then(result => ({ result, sampleCount, expectedErrors }));
    });
    for (const check of await Promise.all(checks)) {
      expect(check.result.summary.count).toBe(check.sampleCount);
      expect(check.result.summary.errorCount).toBe(check.expectedErrors);
    }
  });
});

describe("security: guard refusal, usage refusal, and injection-free seams", () => {
  interface SubprocessResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }

  function runSubprocess(args: readonly string[], env: Record<string, string>): SubprocessResult {
    const proc = Bun.spawnSync({
      cmd: [process.execPath, BENCH_SCRIPT_PATH, ...args],
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: proc.exitCode,
      stdout: new TextDecoder().decode(proc.stdout),
      stderr: new TextDecoder().decode(proc.stderr),
    };
  }

  it("refuses a non-test database target in a real subprocess before any run directory", () => {
    const benchRunDirs = (): string[] => readdirSync(PERF_LOGS_DIR).filter(name => name.endsWith("_bench-matching"));
    const before = existsSync(PERF_LOGS_DIR) ? benchRunDirs() : [];
    const result = runSubprocess([], { DATABASE_URL: "postgres://op:s3cret-pw@127.0.0.1:5432/kottaby" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("kottaby");
    expect(result.stderr).not.toContain("s3cret-pw");
    expect(result.stderr).not.toContain("postgres://");
    const after = existsSync(PERF_LOGS_DIR) ? benchRunDirs() : [];
    expect(after).toHaveLength(before.length);
  });

  it("refuses unknown flags in a real subprocess before the guard", () => {
    const result = runSubprocess(["--bogus"], { DATABASE_URL: "" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown flag(s): --bogus");
  });

  it("keeps the database client and matching service behind dynamic imports (source pin)", () => {
    const source = readFileSync(BENCH_SCRIPT_PATH, "utf8");
    expect(source).not.toMatch(/from\s+"@\/backend\/(db|services)\//);
    expect(source).toContain('await import("@/backend/db/client")');
    expect(source).toContain('await import("@/backend/services/teachers/teacher-matching.service")');
    const dbModule = readFileSync(join(REPO_ROOT, "scripts", "perf", "lib", "bench-matching-db.ts"), "utf8");
    expect(dbModule).not.toMatch(/from\s+"@\/backend\/db\/client"/);
  });
});

describe("report wiring (real writer, real run directory)", () => {
  const createdRunDirs: string[] = [];

  it("round-trips through the shared report writer redacted and parseable", async () => {
    const census = Array.from({ length: 10 }, (_, index) => index + 1);
    const state = createFakeIo({ censusIds: census, startedIds: [1] });
    const { openRunDirectory, writeReport } = await import("@/scripts/perf/lib/report");
    const run = openRunDirectory("bench-matching");
    createdRunDirs.push(run.runId);
    const io: BenchMatchingIo = {
      ...state.io,
      openRun: () => run,
      writeReport: (ctx, gates, sections) => {
        writeReport(ctx, gates, sections);
      },
    };
    const outcome: BenchMatchingOutcome = await runBenchMatching(CLI_OPTIONS, io);
    expect(outcome.runDir).toBe(run.runDir);
    const reportJson = JSON.parse(readFileSync(join(run.runDir, "report.json"), "utf8"));
    expect(reportJson.tool).toBe("bench-matching");
    expect(reportJson.verdict).toBe("PASS");
    expect(reportJson.sections.matrix).toHaveLength(12);
    const reportMd = readFileSync(join(run.runDir, "report.md"), "utf8");
    expect(reportMd).toContain("# Performance Run Report");
    expect(reportMd).not.toContain("$2b$12$");
  });

  it("cleans up the run directories this suite created", () => {
    for (const runId of createdRunDirs) {
      rmSync(join(PERF_LOGS_DIR, runId), { recursive: true, force: true });
    }
    for (const runId of createdRunDirs) {
      expect(existsSync(join(PERF_LOGS_DIR, runId))).toBe(false);
    }
  });
});
