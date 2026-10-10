import { describe, expect, it } from "bun:test";
import {
  API_SCENARIOS,
  type ApiScenarioRequest,
  type ApiScenarioRequestState,
  buildBookingIdempotencyKey,
  buildTeacherHarvestRequest,
  findApiScenario,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  parseHarvestedTeacherIds,
  TEACHER_HARVEST_PAGES,
} from "@/scripts/perf/lib/api-scenarios";
import { LOGIN_MUTATION_DOCUMENT } from "@/scripts/perf/lib/auth-mint";

const COOKIE = "access_token=jwt-one; refresh_token=jwt-two; session_id=sess";

function buildState(overrides: Partial<ApiScenarioRequestState> = {}): ApiScenarioRequestState {
  return {
    runId: "2026-10-09T18-00-00_load-api",
    vu: 3,
    iteration: 7,
    targetUserId: 421,
    teacherId: 77,
    credentials: { email: "perf_deadbeef_student000003@test.local", password: "perf-load-deadbeef" },
    ...overrides,
  };
}

function scenarioById(id: string): (typeof API_SCENARIOS)[number] {
  const scenario = findApiScenario(id);
  if (scenario === undefined) {
    throw new Error(`scenario "${id}" is missing from the registry`);
  }
  return scenario;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBody(request: ApiScenarioRequest): { query: string; variables: Record<string, unknown> } {
  const raw: unknown = request.body;
  if (!isRecord(raw)) {
    throw new Error("scenario request body is not a record");
  }
  const variables: unknown = raw.variables;
  if (typeof raw.query !== "string" || !isRecord(variables)) {
    throw new Error("scenario request body is malformed (query/variables)");
  }
  return { query: raw.query, variables };
}

describe("API_SCENARIOS registry (Tier 1 — contract)", () => {
  it("covers the seven load scenarios with unique ids and explicit operation names", () => {
    const ids = API_SCENARIOS.map(scenario => scenario.id);
    expect(new Set(ids).size).toBe(API_SCENARIOS.length);
    expect(ids).toEqual([
      "login",
      "browse-teachers",
      "browse-teachers-filtered",
      "my-subscriptions",
      "my-notifications",
      "book-session",
      "admin-student-subscriptions",
    ]);
    for (const scenario of API_SCENARIOS) {
      expect(scenario.operationName.length).toBeGreaterThan(0);
      expect(["student", "admin"]).toContain(scenario.role);
      expect(scenario.weight).toBeGreaterThan(0);
    }
  });

  it("carries the default weight mix (10/20/20/20/20/10/10)", () => {
    expect(API_SCENARIOS.map(scenario => scenario.weight)).toEqual([10, 20, 20, 20, 20, 10, 10]);
  });

  it("marks every read must-succeed and the booking write probe-only", () => {
    for (const scenario of API_SCENARIOS) {
      if (scenario.id === "book-session") {
        expect(scenario.expect.mustSucceed).toBe(false);
      } else {
        expect(scenario.expect.mustSucceed).toBe(true);
      }
      expect(scenario.expect.kind).toBe("graphql");
    }
  });

  it("restricts the admin read to the admin role and everything else to students", () => {
    expect(scenarioById("admin-student-subscriptions").role).toBe("admin");
    for (const scenario of API_SCENARIOS) {
      if (scenario.id !== "admin-student-subscriptions") {
        expect(scenario.role).toBe("student");
      }
    }
  });

  it("findApiScenario resolves known ids and rejects unknown ones", () => {
    expect(findApiScenario("login")?.id).toBe("login");
    expect(findApiScenario("nope")).toBeUndefined();
  });
});

describe("scenario request builders (Tier 1 — wire shapes)", () => {
  it("builds the login request with the VU credentials and the real login document", () => {
    const request = scenarioById("login").buildRequest(COOKIE, buildState());
    const body = asBody(request);
    expect(body.query).toBe(LOGIN_MUTATION_DOCUMENT);
    expect(body.variables).toEqual({
      email: "perf_deadbeef_student000003@test.local",
      password: "perf-load-deadbeef",
    });
    expect(request.headers.cookie).toBe(COOKIE);
    expect(request.headers["content-type"]).toBe("application/json");
  });

  it("builds the plain browse with explicit page bounds and no filters", () => {
    const request = scenarioById("browse-teachers").buildRequest(COOKIE, buildState());
    const body = asBody(request);
    expect(body.query).toContain("query BrowseAvailableTeachers(");
    expect(body.variables).toEqual({ page: 1, pageSize: 25 });
  });

  it("builds the filtered browse with the filter set engaged", () => {
    const request = scenarioById("browse-teachers-filtered").buildRequest(COOKIE, buildState());
    const body = asBody(request);
    expect(body.variables).toEqual({
      intent: "Hifz",
      minRating: 4,
      page: 1,
      pageSize: 25,
      recitation: "HAFS_AN_ASIM",
      search: null,
      sort: "NameAsc",
    });
  });

  it("builds the subscription read with the enriched fields selected", () => {
    const request = scenarioById("my-subscriptions").buildRequest(COOKIE, buildState());
    const body = asBody(request);
    expect(body.query).toContain("query MySubscriptions {");
    expect(body.query).toContain("auditEntriesCount");
    expect(body.query).toContain("auditTrailPeek { actionType at }");
    expect(body.variables).toEqual({});
  });

  it("builds a bounded notifications page", () => {
    const request = scenarioById("my-notifications").buildRequest(COOKIE, buildState());
    const body = asBody(request);
    expect(body.query).toContain("query MyNotifications(");
    expect(body.variables).toEqual({ filter: { limit: 25, offset: 0 } });
  });

  it("builds the admin read against the per-iteration target student", () => {
    const request = scenarioById("admin-student-subscriptions").buildRequest(COOKIE, buildState());
    const body = asBody(request);
    expect(body.query).toContain("query AdminStudentSubscriptions($userId: ID!)");
    expect(body.variables).toEqual({ userId: "421" });
  });
});

describe("booking idempotency discipline (Tier 4 — security/abuse)", () => {
  it("mints a unique x-idempotency-key per request across VUs and iterations", () => {
    const keys = new Set<string>();
    for (let vu = 0; vu < 5; vu += 1) {
      for (let iteration = 0; iteration < 5; iteration += 1) {
        const request = scenarioById("book-session").buildRequest(COOKIE, buildState({ vu, iteration }));
        const key = request.headers[IDEMPOTENCY_KEY_HEADER];
        if (typeof key !== "string") {
          throw new Error("the booking request is missing the idempotency key header");
        }
        expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
        keys.add(key);
      }
    }
    expect(keys.size).toBe(25);
  });

  it("carries the booking mutation with the intent + teacherId input", () => {
    const request = scenarioById("book-session").buildRequest(COOKIE, buildState());
    const body = asBody(request);
    expect(body.query).toContain("mutation CreateSession($input: CreateSessionInput!)");
    expect(body.variables).toEqual({ input: { intent: "Hifz", teacherId: "77" } });
  });

  it("only the booking scenario sends the idempotency header", () => {
    for (const scenario of API_SCENARIOS) {
      const headers = scenario.buildRequest(COOKIE, buildState()).headers;
      if (scenario.id === "book-session") {
        expect(headers[IDEMPOTENCY_KEY_HEADER]).toBe(buildBookingIdempotencyKey(buildState()));
      } else {
        expect(headers[IDEMPOTENCY_KEY_HEADER]).toBeUndefined();
      }
    }
  });

  it("never leaks the cookie into the request body", () => {
    for (const scenario of API_SCENARIOS) {
      const request = scenario.buildRequest(COOKIE, buildState());
      expect(JSON.stringify(request.body)).not.toContain("jwt-one");
      expect(request.headers.cookie).toBe(COOKIE);
    }
  });
});

describe("teacher-pool harvest wire helpers (Tier 1 + 2)", () => {
  it("harvests two pages at the browse page size", () => {
    expect(TEACHER_HARVEST_PAGES).toBe(2);
    const request = buildTeacherHarvestRequest(COOKIE, 2);
    const body = asBody(request);
    expect(body.variables).toEqual({ page: 2, pageSize: 25 });
  });

  it("parses numeric teacher ids from string or number id fields", () => {
    const body = {
      data: { browseAvailableTeachers: { items: [{ id: "11" }, { id: 12 }, { id: "x" }, { id: "0" }, {}] } },
    };
    expect(parseHarvestedTeacherIds(body)).toEqual([11, 12]);
  });

  it("returns an empty pool for unusable shapes (Tier 2 boundaries)", () => {
    expect(parseHarvestedTeacherIds(null)).toEqual([]);
    expect(parseHarvestedTeacherIds({})).toEqual([]);
    expect(parseHarvestedTeacherIds({ data: null })).toEqual([]);
    expect(parseHarvestedTeacherIds({ data: { browseAvailableTeachers: null } })).toEqual([]);
    expect(parseHarvestedTeacherIds({ data: { browseAvailableTeachers: { items: null } } })).toEqual([]);
  });
});
