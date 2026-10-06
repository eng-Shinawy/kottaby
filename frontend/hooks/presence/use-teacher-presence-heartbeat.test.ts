/**
 * Contract lock over `useTeacherPresenceHeartbeat` — the client presence
 * heartbeat hook (pure logic tier: NO server boot, NO DB, NO network).
 *
 * WHAT THIS LOCKS
 *   1. ROLE GATING — a student/parent/admin session, a null session user,
 *      a still-loading session, and an anonymous session mount NO timer at
 *      all and never request the beat; only a settled authenticated
 *      teacher session starts the schedule.
 *   2. CADENCE — the teacher schedule fires the beat exactly at
 *      `TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS`: nothing before the first
 *      interval, exactly one beat per interval afterwards.
 *   3. VISIBILITY GATING — hiding the document pauses the schedule (the
 *      pending timer is cleared, no trailing beat); showing it again
 *      resumes with a fresh full interval; a duplicate visible event never
 *      double-arms; a tick landing on a hidden document (missed
 *      transition) fires nothing and stays paused.
 *   4. FAILURE SILENCE — a repeatedly rejecting (or synchronously
 *      throwing) beat is logged through the frontend logger (meta-first
 *      warn carrying the error NAME only) and swallowed: no unhandled
 *      rejection reaches the runner and the schedule survives the storm.
 *   5. TEARDOWN — unmount clears the pending timer, removes the
 *      visibility listener, and leaves the schedule inert; a logout flips
 *      the gate so the re-run effect mounts nothing.
 *   6. SEAM WIRING — the hook reads the session through the `useAuth()`
 *      seam, obtains the beat via `useMutation` (never `useLazyQuery`)
 *      bound to the REAL shared `recordMyActivityMutationDocument`
 *      (argless scalar mutation), and logs through `@/frontend/lib/logger`.
 *
 * HOW (the mandated stub approach): `renderHook` is unavailable under
 * bun:test and the repo has no DOM component-test layer, so the seams are
 * replaced with `mock.module` and the hook function is driven directly:
 *   - `mock.module("react")` captures the hook's `useEffect` bodies (and
 *     passes `useCallback` through as identity) so each test can mount and
 *     tear the effect body by hand;
 *   - `mock.module("@/frontend/hooks/auth")` stubs the auth seam (the real
 *     `useAuth` throws outside `AuthProvider`) and
 *     `mock.module("@apollo/client/react")` stubs the mutation seam with a
 *     recording beat;
 *   - the module under test is imported AFTER the mock registrations (the
 *     cron route test's documented import-order idiom);
 *   - the timer + `document` globals are stubbed manually (bun:test has no
 *     fake-timer API) and restored after every test.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/hooks/presence/use-teacher-presence-heartbeat.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { recordMyActivityMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { logger } from "@/frontend/lib/logger";

// ─── Seam stubs (registered BEFORE the module under test is imported) ──────

/** The auth snapshot the mocked `useAuth()` seam hands to the hook. */
interface AuthSnapshot {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { role: UserRole } | null;
}

/** One `useEffect` body captured from the hook, with its declared deps. */
interface CapturedEffect {
  body: () => (() => void) | undefined;
  deps: readonly unknown[];
}

const capturedEffects: CapturedEffect[] = [];

void mock.module("react", () => ({
  // Pass-through: the hook's beat runner keeps its own identity.
  useCallback: <T>(fn: T) => fn,
  // Capture (never auto-run): each test mounts the effect body by hand —
  // exactly what a renderer would do at commit time.
  useEffect: (body: CapturedEffect["body"], deps: readonly unknown[]): void => {
    capturedEffects.push({ body, deps: [...deps] });
  },
}));

let authSnapshot: AuthSnapshot = { isAuthenticated: true, isLoading: false, user: { role: UserRole.Teacher } };
let useAuthCalls = 0;

void mock.module("@/frontend/hooks/auth", () => ({
  useAuth: (): AuthSnapshot => {
    useAuthCalls += 1;
    return authSnapshot;
  },
}));

const mutationDocuments: unknown[] = [];
const beatCalls: number[] = [];
let beatImplementation: () => Promise<unknown> = async () => ({ data: { recordMyActivity: true } });

void mock.module("@apollo/client/react", () => ({
  useMutation: (document: unknown) => {
    mutationDocuments.push(document);
    return [
      (): Promise<unknown> => {
        beatCalls.push(beatCalls.length + 1);
        return beatImplementation();
      },
    ];
  },
}));

// The module under test MUST trail its mock registrations (bun resolves the
// module registry in import order — the cron route test's documented idiom).
import {
  startTeacherPresenceHeartbeatSession,
  TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS,
  useTeacherPresenceHeartbeat,
} from "@/frontend/hooks/presence/use-teacher-presence-heartbeat";

// ─── Manual timer + document stubs (bun:test has no fake-timer API) ────────

interface StubTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
  cleared: boolean;
  fired: boolean;
}

const stubClock = {
  now: 0,
  nextId: 1,
  timers: [] as StubTimer[],
};

const stubDocument = {
  visibilityState: "visible" as "visible" | "hidden",
  listeners: new Map<string, Set<() => void>>(),
  addEventListener(type: string, listener: () => void): void {
    const registered = stubDocument.listeners.get(type) ?? new Set<() => void>();
    registered.add(listener);
    stubDocument.listeners.set(type, registered);
  },
  removeEventListener(type: string, listener: () => void): void {
    stubDocument.listeners.get(type)?.delete(listener);
  },
};

function installGlobal(key: string, value: unknown): void {
  Reflect.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

function stubSetTimeout(callback: () => void, delayMs?: number): number {
  const timer: StubTimer = {
    id: stubClock.nextId++,
    dueAt: stubClock.now + (delayMs ?? 0),
    callback,
    cleared: false,
    fired: false,
  };
  stubClock.timers.push(timer);
  return timer.id;
}

function stubClearTimeout(handle: unknown): void {
  if (typeof handle !== "number") {
    return;
  }
  for (const timer of stubClock.timers) {
    if (timer.id === handle) {
      timer.cleared = true;
    }
  }
}

/** Advances the virtual clock, firing due timers in scheduling order. */
function advanceClock(ms: number): void {
  stubClock.now += ms;
  for (;;) {
    const due = stubClock.timers.find(timer => !timer.cleared && !timer.fired && timer.dueAt <= stubClock.now);
    if (due === undefined) {
      return;
    }
    due.fired = true;
    due.callback();
  }
}

function pendingTimers(): StubTimer[] {
  return stubClock.timers.filter(timer => !timer.cleared && !timer.fired);
}

function documentListenerCount(type: string): number {
  return stubDocument.listeners.get(type)?.size ?? 0;
}

function setVisibility(next: "visible" | "hidden"): void {
  stubDocument.visibilityState = next;
  for (const listener of stubDocument.listeners.get("visibilitychange") ?? []) {
    listener();
  }
}

// ─── Harness ────────────────────────────────────────────────────────────────

const GLOBAL_STUB_KEYS = ["setTimeout", "clearTimeout", "document"] as const;
const originalGlobals = new Map<string, unknown>(GLOBAL_STUB_KEYS.map(key => [key, Reflect.get(globalThis, key)]));

const warnSpy = spyOn(logger, "warn");

function teacherSnapshot(): AuthSnapshot {
  return { isAuthenticated: true, isLoading: false, user: { role: UserRole.Teacher } };
}

function flushMicrotasks(): Promise<void> {
  // A fixed chain of microtask turns — enough for the beat-failure catch
  // handlers queued by the synchronous tick advances above to have run.
  const turns = Array.from({ length: 10 }, () => Promise.resolve());
  return turns.reduce<Promise<void>>((chain, turn) => chain.then(() => turn), Promise.resolve());
}

/**
 * The consumer probe — a minimal component body that mounts the hook.
 *
 * bun:test has no renderer (and `renderHook` is unavailable), so the probe
 * is INVOKED as a plain function: with the react / auth / apollo seams
 * stubbed above, the invocation performs exactly the work a commit-time
 * render would — consult `useAuth()`, bind the mutation seam, and register
 * the effect body + deps that each test then mounts by hand.
 */
function HeartbeatProbe(): null {
  useTeacherPresenceHeartbeat();
  return null;
}

/** Calls the hook once and returns the effect body it registered. */
function runHook(): CapturedEffect {
  const before = capturedEffects.length;
  HeartbeatProbe();
  if (capturedEffects.length !== before + 1) {
    throw new Error("expected the hook to register exactly one effect");
  }
  return capturedEffects[before];
}

/** Mounts a settled teacher session and returns its teardown. */
function mountTeacherSession(): () => void {
  authSnapshot = teacherSnapshot();
  const teardown = runHook().body();
  if (teardown === undefined) {
    throw new Error("expected a settled teacher session to mount the schedule");
  }
  return teardown;
}

beforeEach(() => {
  stubClock.now = 0;
  stubClock.nextId = 1;
  stubClock.timers.length = 0;
  stubDocument.visibilityState = "visible";
  stubDocument.listeners = new Map();
  authSnapshot = teacherSnapshot();
  useAuthCalls = 0;
  mutationDocuments.length = 0;
  beatCalls.length = 0;
  beatImplementation = async () => ({ data: { recordMyActivity: true } });
  installGlobal("setTimeout", stubSetTimeout);
  installGlobal("clearTimeout", stubClearTimeout);
  installGlobal("document", stubDocument);
});

afterEach(() => {
  for (const [key, value] of originalGlobals) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      installGlobal(key, value);
    }
  }
  warnSpy.mockClear();
});

// ─── Role gating (through the hook, both context seams mocked) ─────────────

describe("useTeacherPresenceHeartbeat — role gating", () => {
  test("non-teacher / null-user / loading / anonymous sessions mount NO timer and never call the beat", () => {
    const denied: readonly AuthSnapshot[] = [
      { isAuthenticated: true, isLoading: false, user: { role: UserRole.Student } },
      { isAuthenticated: true, isLoading: false, user: { role: UserRole.Parent } },
      { isAuthenticated: true, isLoading: false, user: { role: UserRole.Admin } },
      { isAuthenticated: true, isLoading: false, user: null },
      { isAuthenticated: true, isLoading: true, user: { role: UserRole.Teacher } },
      { isAuthenticated: false, isLoading: false, user: null },
    ];
    for (const snapshot of denied) {
      authSnapshot = { ...snapshot };
      const effect = runHook();
      expect(effect.body()).toBeUndefined();
      expect(pendingTimers()).toHaveLength(0);
      expect(beatCalls).toHaveLength(0);
    }
    // The auth seam was consulted once per hook call — nothing else ran.
    expect(useAuthCalls).toBe(denied.length);
  });

  test("a settled authenticated teacher session starts the schedule on the shared document", () => {
    authSnapshot = teacherSnapshot();
    const effect = runHook();
    // The effect re-runs whenever the auth snapshot or the beat runner
    // changes — the four declared deps.
    expect(effect.deps).toHaveLength(4);
    const teardown = effect.body();
    if (teardown === undefined) {
      throw new Error("expected a settled teacher session to mount the schedule");
    }
    expect(pendingTimers()).toHaveLength(1);
    // The beat rides the REAL shared document through the mocked seam.
    expect(mutationDocuments).toEqual([recordMyActivityMutationDocument]);
    teardown();
  });
});

// ─── Cadence (timer stub advanced by hand) ─────────────────────────────────

describe("useTeacherPresenceHeartbeat — cadence", () => {
  test("the beat fires exactly at the interval — never before, once per interval", () => {
    const teardown = mountTeacherSession();
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS - 1);
    expect(beatCalls).toHaveLength(0);
    advanceClock(1);
    expect(beatCalls).toHaveLength(1);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(2);
    // A long elapsed stretch (a blocked event loop) yields exactly ONE beat
    // at its end — never a catch-up burst; the schedule re-arms from the
    // fire instant.
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS * 3);
    expect(beatCalls).toHaveLength(3);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(4);
    teardown();
  });
});

// ─── Visibility gating ──────────────────────────────────────────────────────

describe("useTeacherPresenceHeartbeat — visibility gating", () => {
  test("hiding the document pauses the schedule — pending timer cleared, no trailing beat", () => {
    const teardown = mountTeacherSession();
    advanceClock(60_000);
    expect(beatCalls).toHaveLength(0);
    setVisibility("hidden");
    expect(pendingTimers()).toHaveLength(0);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS * 4);
    expect(beatCalls).toHaveLength(0);
    teardown();
  });

  test("showing the document again resumes the schedule with a fresh full interval", () => {
    const teardown = mountTeacherSession();
    setVisibility("hidden");
    setVisibility("visible");
    expect(pendingTimers()).toHaveLength(1);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS - 1);
    expect(beatCalls).toHaveLength(0);
    advanceClock(1);
    expect(beatCalls).toHaveLength(1);
    teardown();
  });

  test("a duplicate visible event never double-arms the schedule", () => {
    const teardown = mountTeacherSession();
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("visible");
    expect(pendingTimers()).toHaveLength(1);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(1);
    teardown();
  });

  test("a tick landing on a hidden document (missed transition) fires nothing and stays paused", () => {
    const teardown = mountTeacherSession();
    // Hide WITHOUT dispatching the transition — simulates a missed event.
    stubDocument.visibilityState = "hidden";
    expect(pendingTimers()).toHaveLength(1);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(0);
    expect(pendingTimers()).toHaveLength(0);
    // The real transition event later resumes the schedule.
    setVisibility("visible");
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(1);
    teardown();
  });
});

// ─── Failure silence ────────────────────────────────────────────────────────

describe("useTeacherPresenceHeartbeat — failure silence", () => {
  test("a repeatedly rejecting beat is logged (meta-first warn) and the schedule survives", async () => {
    const teardown = mountTeacherSession();
    beatImplementation = async () => {
      throw new Error("network unreachable");
    };
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(3);
    await flushMicrotasks();
    expect(warnSpy).toHaveBeenCalledTimes(3);
    const [meta, message, payload] = warnSpy.mock.calls[0];
    expect(meta).toEqual({ caller: "useTeacherPresenceHeartbeat" });
    expect(message).toContain("Beat failed");
    expect(payload).toEqual({ errorName: "Error" });
    // The error NAME crosses the log boundary — never the full error.
    expect(JSON.stringify(warnSpy.mock.calls[0])).not.toContain("network unreachable");
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(4);
    teardown();
  });

  test("a synchronously throwing beat seam is contained the same way", async () => {
    const teardown = mountTeacherSession();
    beatImplementation = (): Promise<unknown> => {
      throw new Error("sync seam failure");
    };
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    await flushMicrotasks();
    expect(beatCalls).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(2);
    teardown();
  });

  test("a failure storm — six consecutive rejections across ticks — never breaks the schedule or the runner", async () => {
    const teardown = mountTeacherSession();

    // A sustained outage, not a flake: every tick's beat rejects with a
    // DIFFERENT error kind, so the storm also re-proves that only the error
    // NAME crosses the log boundary, tick after tick.
    const STORM_TICKS = 6;
    const stormErrorNames = ["Error", "TypeError", "RangeError", "Error", "TypeError", "RangeError"];
    let tick = 0;
    beatImplementation = async () => {
      const name = stormErrorNames[tick] ?? "Error";
      tick += 1;
      if (name === "TypeError") {
        throw new TypeError("beat socket closed mid-flight");
      }
      if (name === "RangeError") {
        throw new RangeError("beat payload quota exhausted");
      }
      throw new Error("beat gateway unreachable");
    };

    for (let index = 0; index < STORM_TICKS; index += 1) {
      advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
      expect(beatCalls).toHaveLength(index + 1);
      // The schedule re-arms THROUGH every failed beat — it never drops.
      expect(pendingTimers()).toHaveLength(1);
    }

    await flushMicrotasks();
    expect(warnSpy).toHaveBeenCalledTimes(STORM_TICKS);
    expect(warnSpy.mock.calls.map(call => call[2])).toEqual(stormErrorNames.map(name => ({ errorName: name })));
    for (const call of warnSpy.mock.calls) {
      expect(call[0]).toEqual({ caller: "useTeacherPresenceHeartbeat" });
      expect(call[1]).toContain("Beat failed");
    }
    // No error text ever crossed the log boundary during the storm.
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("beat socket closed mid-flight");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("beat payload quota exhausted");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("beat gateway unreachable");

    // The storm ends (the outage clears) — the very next interval beats.
    beatImplementation = async () => ({ data: { recordMyActivity: true } });
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(STORM_TICKS + 1);
    teardown();
  });
});

// ─── Teardown ───────────────────────────────────────────────────────────────

describe("useTeacherPresenceHeartbeat — teardown", () => {
  test("unmount clears the pending timer, removes the listener, and leaves the schedule inert", () => {
    const teardown = mountTeacherSession();
    expect(documentListenerCount("visibilitychange")).toBe(1);
    expect(pendingTimers()).toHaveLength(1);
    teardown();
    expect(pendingTimers()).toHaveLength(0);
    expect(documentListenerCount("visibilitychange")).toBe(0);
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS * 2);
    setVisibility("hidden");
    setVisibility("visible");
    expect(beatCalls).toHaveLength(0);
  });

  test("a logout flips the gate — the re-run effect mounts nothing", () => {
    const teardown = mountTeacherSession();
    advanceClock(TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS);
    expect(beatCalls).toHaveLength(1);
    teardown();
    authSnapshot = { isAuthenticated: false, isLoading: false, user: null };
    const effect = runHook();
    expect(effect.body()).toBeUndefined();
    expect(pendingTimers()).toHaveLength(0);
  });
});

// ─── Session-seam direct pins (React-free body) ─────────────────────────────

describe("startTeacherPresenceHeartbeatSession — gate returns nothing for denied sessions", () => {
  test("a denied auth snapshot mounts no session without consulting the beat", () => {
    const teardown = startTeacherPresenceHeartbeatSession(
      { isAuthenticated: true, isLoading: false, user: { role: UserRole.Student } },
      async () => ({ data: { recordMyActivity: true } })
    );
    expect(teardown).toBeUndefined();
    expect(pendingTimers()).toHaveLength(0);
    expect(beatCalls).toHaveLength(0);
  });
});

// ─── Hook wiring source pins (backend service-suite discipline) ─────────────

const HOOK_SOURCE = await Bun.file(new URL("./use-teacher-presence-heartbeat.ts", import.meta.url)).text();

describe("useTeacherPresenceHeartbeat — hook wiring (module source pins)", () => {
  test("the beat is obtained via useMutation imported from @apollo/client/react (NEVER useLazyQuery)", () => {
    expect(HOOK_SOURCE).toContain('import { useMutation } from "@apollo/client/react"');
    expect(HOOK_SOURCE).not.toContain("useLazyQuery");
  });

  test("the mutation rides the REAL shared recordMyActivity document (no inline gql)", () => {
    expect(HOOK_SOURCE).toContain("useMutation(recordMyActivityMutationDocument)");
    expect(HOOK_SOURCE).not.toContain("gql`");
  });

  test("the gate is the settled-teacher predicate and the effect delegates to the session seam", () => {
    expect(HOOK_SOURCE).toContain("auth.user?.role !== UserRole.Teacher");
    expect(HOOK_SOURCE).toContain(
      "startTeacherPresenceHeartbeatSession({ isAuthenticated, isLoading, user }, sendBeat)"
    );
  });

  test("failures are logged through the frontend logger (meta-first warn, never console.*)", () => {
    expect(HOOK_SOURCE).toContain('from "@/frontend/lib/logger"');
    expect(HOOK_SOURCE).toContain("logger.warn(");
    expect(HOOK_SOURCE).not.toContain("console.");
  });

  test("the hook renders nothing and holds no render state", () => {
    expect(HOOK_SOURCE).toContain("useTeacherPresenceHeartbeat(): void");
    expect(HOOK_SOURCE).not.toContain("useState");
  });
});
