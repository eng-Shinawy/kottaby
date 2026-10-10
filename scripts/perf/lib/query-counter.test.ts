/**
 * Colocated bun:test suite for the query-counting oracle.
 *
 * Pure unit tests — no database server, no network: the real `pg`
 * `Client.prototype.query` is swapped for an in-memory fake that mimics pg's
 * query contract (promise / callback / synchronous-throw on null config),
 * the counter is installed over that fake, and every restoration/counting
 * contract is asserted. The real `pg.Pool` delegation path is exercised for
 * real: the pool's own `query` code borrows a client and calls the patched
 * prototype method — only the connection acquisition is stubbed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Client, Pool } from "pg";

import {
  FINGERPRINT_PREFIX_LENGTH,
  installQueryCounter,
  QueryCounterError,
  type QueryCountHandle,
  UNRECOGNIZED_QUERY_FINGERPRINT,
} from "@/scripts/perf/lib/query-counter";

function captureQueryDescriptor(): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(Client.prototype, "query");
  if (descriptor === undefined) {
    throw new Error("pg Client.prototype.query has no own property descriptor");
  }
  return descriptor;
}

/** The pristine pg prototype method + descriptor, captured before any swap. */
const REAL_DESCRIPTOR: PropertyDescriptor = captureQueryDescriptor();
const REAL_QUERY: unknown = Client.prototype.query;

/** Captured at module scope; swapped only inside tests, restored in afterEach. */
const consoleMethods = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
} as const;

type FakeQueryCallback = (error: Error | null, result: unknown) => void;

function isFakeCallback(value: unknown): value is FakeQueryCallback {
  return typeof value === "function";
}

const FAKE_RESULT = { rows: [], rowCount: 0, command: "SELECT" };

interface FakeBase {
  calls: Array<{ args: unknown[] }>;
  query: (this: unknown, ...args: unknown[]) => unknown;
}

/**
 * In-memory stand-in for pg's Client.query: mirrors pg's contract — throws a
 * TypeError for a null/undefined config, invokes a trailing callback with
 * (null, result), otherwise returns a promise. `latencyMs` simulates
 * in-flight queries (async resolution) for mid-flight uninstall tests.
 */
function makeFakeBase(latencyMs = 0): FakeBase {
  const calls: Array<{ args: unknown[] }> = [];
  const query = function fakePgClientQuery(this: unknown, ...args: unknown[]): unknown {
    calls.push({ args });
    const config = args[0];
    if (config === null || config === undefined) {
      throw new TypeError("Client was passed a null or undefined query");
    }
    const lastArg = args[args.length - 1];
    if (isFakeCallback(lastArg)) {
      if (latencyMs > 0) {
        setTimeout(() => lastArg(null, FAKE_RESULT), latencyMs);
        return undefined;
      }
      lastArg(null, FAKE_RESULT);
      return undefined;
    }
    if (latencyMs > 0) {
      return new Promise(resolve => {
        setTimeout(() => resolve(FAKE_RESULT), latencyMs);
      });
    }
    return Promise.resolve(FAKE_RESULT);
  };
  return { calls, query };
}

/** Replaces the prototype method with the given fake (descriptor mirrors pg's class-method shape). */
function swapPrototypeQuery(fn: (this: unknown, ...args: unknown[]) => unknown): void {
  Object.defineProperty(Client.prototype, "query", {
    value: fn,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/** Restores the pristine pg prototype method byte-exactly. */
function restoreRealPrototypeQuery(): void {
  Object.defineProperty(Client.prototype, "query", REAL_DESCRIPTOR);
}

let activeHandle: QueryCountHandle | null = null;

/** Reads the live prototype method as an opaque identity (widened for `toBe` comparisons). */
function queryIdentity(): unknown {
  return Client.prototype.query;
}

/** Installs the counter over a fresh fake base and registers the handle for afterEach cleanup. */
function installOverFakeBase(options?: { latencyMs: number }): { handle: QueryCountHandle; base: FakeBase } {
  const base = makeFakeBase(options?.latencyMs);
  swapPrototypeQuery(base.query);
  const handle = installQueryCounter();
  activeHandle = handle;
  return { handle, base };
}

/**
 * Invokes the (patched) instance method with arbitrary, untyped argument
 * shapes — pg's typed surface rejects them at compile time, but the oracle
 * must handle whatever arrives at runtime without casts.
 */
function invokeQuery(client: Client, ...args: unknown[]): unknown {
  const method: unknown = client.query;
  if (typeof method !== "function") {
    throw new Error("client.query is not callable");
  }
  const result: unknown = Reflect.apply(method, client, args);
  return result;
}

afterEach(() => {
  activeHandle?.uninstall();
  activeHandle = null;
  restoreRealPrototypeQuery();
  // Hard leak guard: after every test, pg's prototype method is the pristine one.
  expect(queryIdentity()).toBe(REAL_QUERY);
});

describe("query-counter: install / uninstall lifecycle", () => {
  test("install replaces the prototype method; uninstall restores the exact original identity", () => {
    const base = makeFakeBase();
    swapPrototypeQuery(base.query);
    const handle = installQueryCounter();
    activeHandle = handle;

    expect(queryIdentity()).not.toBe(base.query);
    handle.uninstall();
    expect(queryIdentity()).toBe(base.query);

    const restored = captureQueryDescriptor();
    expect(restored.value).toBe(base.query);
    expect(restored.writable).toBe(true);
    expect(restored.enumerable).toBe(false);
    expect(restored.configurable).toBe(true);
  });

  test("a full cycle leaves the pristine pg prototype descriptor untouched", () => {
    const { handle } = installOverFakeBase();
    handle.uninstall();
    restoreRealPrototypeQuery();
    expect(queryIdentity()).toBe(REAL_QUERY);
    expect(captureQueryDescriptor()).toEqual(REAL_DESCRIPTOR);
  });

  test("double install is refused loudly", () => {
    const first = installOverFakeBase();
    expect(() => installQueryCounter()).toThrow(QueryCounterError);
    expect(() => installQueryCounter()).toThrow(/already installed/);
    expect(first.handle.snapshot().total).toBe(0);
  });

  test("double uninstall is an idempotent no-op (prototype stays original)", () => {
    const { handle, base } = installOverFakeBase();
    handle.uninstall();
    handle.uninstall();
    expect(queryIdentity()).toBe(base.query);
  });

  test("re-install after uninstall starts from a fresh zero state; the old handle freezes", async () => {
    const first = installOverFakeBase();
    const client = new Client();
    await client.query("SELECT one");
    expect(first.handle.snapshot().total).toBe(1);
    first.handle.uninstall();

    // Prototype is back at the fake base; install a second window over it.
    const second = installOverFakeBase();
    await client.query("SELECT two");
    await client.query("SELECT two");
    expect(second.handle.snapshot().total).toBe(2);
    expect(second.handle.snapshot().byFingerprint.get("SELECT two")).toBe(2);
    // The disconnected handle froze at its final count and never sees the new window.
    expect(first.handle.snapshot().total).toBe(1);
  });

  test("the pristine pg prototype descriptor has the expected class-method shape", () => {
    expect(REAL_DESCRIPTOR.value).toBe(REAL_QUERY);
    expect(REAL_DESCRIPTOR.writable).toBe(true);
    expect(REAL_DESCRIPTOR.enumerable).toBe(false);
    expect(REAL_DESCRIPTOR.configurable).toBe(true);
  });

  test("a failed patch leaves no installed state behind", () => {
    // Reversible failure injection: intercept only the (Client.prototype,
    // "query") defineProperty call the install performs; everything else
    // (including this test's own restoration) hits the real function.
    const realDefineProperty = Object.defineProperty;
    const intercepted: typeof Object.defineProperty = (target, property, attributes) => {
      if (target === Client.prototype && property === "query") {
        throw new TypeError("simulated defineProperty failure");
      }
      return realDefineProperty(target, property, attributes);
    };
    Object.defineProperty = intercepted;
    try {
      expect(() => installQueryCounter()).toThrow(TypeError);
    } finally {
      Object.defineProperty = realDefineProperty;
    }
    // The failed patch never applied and no active state survived.
    expect(queryIdentity()).toBe(REAL_QUERY);

    const handle = installOverFakeBase();
    expect(handle.handle.snapshot().total).toBe(0);
  });

  test("a prototype with no own query descriptor is rejected before any patch", () => {
    // Reversible: the property is configurable, so the pristine descriptor
    // restores it exactly.
    expect(Reflect.deleteProperty(Client.prototype, "query")).toBe(true);
    try {
      expect(() => installQueryCounter()).toThrow(QueryCounterError);
      expect(() => installQueryCounter()).toThrow(/no own property descriptor/);
    } finally {
      restoreRealPrototypeQuery();
    }
    expect(queryIdentity()).toBe(REAL_QUERY);
  });

  test("a prototype whose query is not a callable data property is rejected before any patch", () => {
    // Reversible swap: shadow the data property with an accessor (configurable,
    // so the pristine descriptor comes back afterwards).
    Object.defineProperty(Client.prototype, "query", {
      get: () => REAL_QUERY,
      enumerable: false,
      configurable: true,
    });
    try {
      expect(() => installQueryCounter()).toThrow(QueryCounterError);
      expect(() => installQueryCounter()).toThrow(/not a callable query method/);
    } finally {
      restoreRealPrototypeQuery();
    }
    expect(queryIdentity()).toBe(REAL_QUERY);

    const { handle } = installOverFakeBase();
    expect(handle.snapshot().total).toBe(0);
  });
});

describe("query-counter: counting contract", () => {
  test("counts string queries with the fingerprint as the collapsed SQL prefix", async () => {
    const { handle, base } = installOverFakeBase();
    const client = new Client();

    await client.query("SELECT * FROM users WHERE id = $1", [7]);
    await client.query("SELECT 1");

    const snapshot = handle.snapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.byFingerprint.get("SELECT * FROM users WHERE id = $1")).toBe(1);
    expect(snapshot.byFingerprint.get("SELECT 1")).toBe(1);
    expect(base.calls).toHaveLength(2);
    expect(base.calls[0]?.args[0]).toBe("SELECT * FROM users WHERE id = $1");
    // Binding values are delegated but never fingerprinted.
    expect(base.calls[0]?.args[1]).toEqual([7]);
  });

  test("counts config-object queries and collapses whitespace into one fingerprint", async () => {
    const { handle } = installOverFakeBase();
    const client = new Client();

    await client.query("SELECT *\n  FROM   users\tWHERE id = $1");
    await client.query({ text: "SELECT * FROM users WHERE id = $1" });

    const snapshot = handle.snapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.byFingerprint.get("SELECT * FROM users WHERE id = $1")).toBe(2);
    expect(snapshot.byFingerprint.size).toBe(1);
  });

  test("fingerprints are the first 120 whitespace-collapsed characters", async () => {
    const { handle } = installOverFakeBase();
    const client = new Client();

    const exactlyPrefix = "a".repeat(FINGERPRINT_PREFIX_LENGTH);
    await client.query(`  ${exactlyPrefix}  `);
    const snapshot = handle.snapshot();
    expect(snapshot.byFingerprint.get(exactlyPrefix)).toBe(1);

    // Differences past the prefix intentionally collapse to the same fingerprint.
    await client.query(`${exactlyPrefix}TAIL-ONE`);
    await client.query(`${exactlyPrefix}TAIL-TWO`);
    const next = handle.snapshot();
    expect(next.total).toBe(3);
    expect(next.byFingerprint.get(exactlyPrefix)).toBe(3);
    expect(next.byFingerprint.size).toBe(1);

    const long = "b".repeat(FINGERPRINT_PREFIX_LENGTH * 3);
    await client.query(long);
    const last = handle.snapshot();
    expect(last.byFingerprint.get("b".repeat(FINGERPRINT_PREFIX_LENGTH))).toBe(1);
  });

  test("empty and whitespace-only SQL keep an honest empty-string fingerprint", async () => {
    const { handle } = installOverFakeBase();
    const client = new Client();
    await client.query("");
    await client.query("   \n\t ");
    const snapshot = handle.snapshot();
    expect(snapshot.total).toBe(2);
    expect(snapshot.byFingerprint.get("")).toBe(2);
  });

  test("invocations without extractable SQL fall into the unrecognized fingerprint", async () => {
    const { handle } = installOverFakeBase();
    const client = new Client();

    await invokeQuery(client, 123);
    await invokeQuery(client, {});
    await invokeQuery(client, { text: 42 });
    await invokeQuery(client, { submit: () => undefined, text: "SELECT submittable" });

    const snapshot = handle.snapshot();
    expect(snapshot.total).toBe(4);
    expect(snapshot.byFingerprint.get(UNRECOGNIZED_QUERY_FINGERPRINT)).toBe(3);
    expect(snapshot.byFingerprint.get("SELECT submittable")).toBe(1);
  });

  test("callback-style invocations are counted once and pass the result through", async () => {
    const { handle, base } = installOverFakeBase();
    const client = new Client();

    const observed = await new Promise<unknown>(resolve => {
      const returned = client.query("SELECT cb", (error: Error | null, result: unknown) => {
        expect(error).toBeNull();
        resolve(result);
      });
      expect(returned).toBeUndefined();
    });
    expect(observed).toBe(FAKE_RESULT);
    expect(handle.snapshot().total).toBe(1);
    expect(handle.snapshot().byFingerprint.get("SELECT cb")).toBe(1);
    expect(base.calls).toHaveLength(1);
  });

  test("zero-query window: snapshot is empty and delta is zero", () => {
    const { handle } = installOverFakeBase();
    const zero = handle.snapshot();
    expect(zero.total).toBe(0);
    expect(zero.byFingerprint.size).toBe(0);
    expect(handle.deltaSince(zero)).toBe(0);
  });

  test("deltaSince returns the exact number of queries since a snapshot", async () => {
    const { handle } = installOverFakeBase();
    const client = new Client();

    const before = handle.snapshot();
    await client.query("SELECT 1");
    await client.query("SELECT 2");
    await client.query("SELECT 1");
    expect(handle.deltaSince(before)).toBe(3);

    const middle = handle.snapshot();
    expect(handle.deltaSince(middle)).toBe(0);
    await client.query("SELECT 3");
    expect(handle.deltaSince(middle)).toBe(1);
    expect(handle.deltaSince(before)).toBe(4);
  });

  test("snapshots are immutable-in-time and defensively copied", async () => {
    const { handle } = installOverFakeBase();
    const client = new Client();

    const first = handle.snapshot();
    await client.query("SELECT x");
    expect(first.total).toBe(0);
    expect(first.byFingerprint.size).toBe(0);

    const second = handle.snapshot();
    if (!(second.byFingerprint instanceof Map)) {
      throw new Error("snapshot byFingerprint must be a Map at runtime");
    }
    // Mutating a taken snapshot must not affect the live counter.
    second.byFingerprint.set("hacked", 999);
    expect(handle.snapshot().byFingerprint.get("hacked")).toBeUndefined();
    expect(handle.snapshot().byFingerprint.get("SELECT x")).toBe(1);
  });

  test("queries issued after uninstall are not counted", async () => {
    const { handle, base } = installOverFakeBase();
    const client = new Client();
    await client.query("SELECT counted");
    handle.uninstall();
    await client.query("SELECT uncounted");
    expect(handle.snapshot().total).toBe(1);
    expect(base.calls).toHaveLength(2);
  });
});

describe("query-counter: real pg Pool delegation", () => {
  test("counts queries issued through a real pg Pool (borrowed-client semantics)", async () => {
    const { handle, base } = installOverFakeBase();
    const stubbedClient = Object.assign(new Client(), { release: () => undefined });
    const pool = new Pool({ max: 1 });
    // Only the connection acquisition is stubbed — the pool's own query path
    // (borrow a client, call client.query, release) runs for real.
    Object.defineProperty(pool, "connect", {
      value: (callback: (error: Error | null, client?: unknown) => void) => {
        callback(null, stubbedClient);
      },
      writable: true,
      enumerable: false,
      configurable: true,
    });

    const result: unknown = await pool.query("SELECT pooled");
    expect(result).toBe(FAKE_RESULT);
    expect(handle.snapshot().total).toBe(1);
    expect(handle.snapshot().byFingerprint.get("SELECT pooled")).toBe(1);
    expect(base.calls).toHaveLength(1);
    expect(base.calls[0]?.args[0]).toBe("SELECT pooled");

    await new Promise<void>(resolve => {
      pool.query("SELECT pooled-callback", (error: Error | undefined) => {
        expect(error).toBeUndefined();
        resolve();
      });
    });
    expect(handle.snapshot().total).toBe(2);
    expect(handle.snapshot().byFingerprint.get("SELECT pooled-callback")).toBe(1);

    await pool.end();
  });
});

describe("query-counter: chaos — concurrency and mid-flight uninstall", () => {
  test("a concurrent burst across clients is counted exactly (Promise.allSettled)", async () => {
    const { handle, base } = installOverFakeBase();
    const clients = [new Client(), new Client(), new Client()];
    const stringVariants = ["SELECT burst-a", "SELECT burst-b"];
    const configVariant = { text: "SELECT burst-c" };

    const promises: Array<Promise<unknown>> = [];
    for (let index = 0; index < 120; index += 1) {
      const client = clients[index % clients.length];
      if (index % 3 === 2) {
        promises.push(client.query(configVariant));
      } else {
        promises.push(client.query(stringVariants[index % 2]));
      }
    }
    expect(handle.snapshot().total).toBe(120);

    const settled = await Promise.allSettled(promises);
    expect(settled).toHaveLength(120);
    for (const outcome of settled) {
      expect(outcome.status).toBe("fulfilled");
      if (outcome.status === "fulfilled") {
        expect(outcome.value).toBe(FAKE_RESULT);
      }
    }

    const snapshot = handle.snapshot();
    expect(snapshot.total).toBe(120);
    expect(snapshot.byFingerprint.get("SELECT burst-a")).toBe(40);
    expect(snapshot.byFingerprint.get("SELECT burst-b")).toBe(40);
    expect(snapshot.byFingerprint.get("SELECT burst-c")).toBe(40);
    expect(snapshot.byFingerprint.size).toBe(3);
    expect(base.calls).toHaveLength(120);
  });

  test("interleaved snapshots stay monotonic while a burst is in flight", async () => {
    const { handle } = installOverFakeBase({ latencyMs: 5 });
    const client = new Client();

    const observed: number[] = [];
    const promises: Array<Promise<unknown>> = [];
    for (let index = 0; index < 30; index += 1) {
      promises.push(client.query("SELECT slow"));
      observed.push(handle.snapshot().total);
    }
    expect(observed).toEqual(Array.from({ length: 30 }, (_unused, index) => index + 1));

    const settled = await Promise.allSettled(promises);
    expect(settled.every(outcome => outcome.status === "fulfilled")).toBe(true);
    expect(handle.snapshot().total).toBe(30);
  });

  test("uninstall mid-flight stops counting later invocations without corrupting in-flight queries", async () => {
    const { handle, base } = installOverFakeBase({ latencyMs: 10 });
    const client = new Client();

    const inFlight = Array.from({ length: 15 }, () => client.query("SELECT in-flight"));
    expect(handle.snapshot().total).toBe(15);

    handle.uninstall();
    expect(queryIdentity()).toBe(base.query);

    const afterUninstall = Array.from({ length: 5 }, () => client.query("SELECT after"));
    const settled = await Promise.allSettled([...inFlight, ...afterUninstall]);
    expect(settled).toHaveLength(20);
    expect(settled.every(outcome => outcome.status === "fulfilled")).toBe(true);

    // The 15 in-flight invocations were counted at entry; the 5 later ones
    // went straight to the base and are invisible to the frozen handle.
    expect(handle.snapshot().total).toBe(15);
    expect(base.calls).toHaveLength(20);
  });
});

describe("query-counter: abuse — error paths, patch scope, hygiene", () => {
  test("a base-method throw propagates unchanged and leaves the patch functional", async () => {
    const { handle } = installOverFakeBase();
    const client = new Client();

    let caught: unknown = null;
    try {
      await invokeQuery(client, null);
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof TypeError)) {
      throw new Error("expected the base method's TypeError to propagate unchanged");
    }
    expect(caught.message).toBe("Client was passed a null or undefined query");
    // The rejected invocation still counts (documented: every invocation is
    // recorded, so harness bugs fail loudly instead of hiding in a delta).
    expect(handle.snapshot().total).toBe(1);
    expect(handle.snapshot().byFingerprint.get(UNRECOGNIZED_QUERY_FINGERPRINT)).toBe(1);

    await client.query("SELECT next");
    expect(handle.snapshot().total).toBe(2);
    expect(Client.prototype.query).not.toBe(REAL_QUERY);
  });

  test("the patch is scoped: no other prototype surface moves and no new keys appear", () => {
    const realConnect = Client.prototype.connect;
    const realEnd = Client.prototype.end;
    const poolQuery = Pool.prototype.query;
    const keysBefore = Object.getOwnPropertyNames(Client.prototype).toSorted((a, b) => a.localeCompare(b));

    const { handle } = installOverFakeBase();

    expect(Client.prototype.connect).toBe(realConnect);
    expect(Client.prototype.end).toBe(realEnd);
    const livePoolQuery: unknown = Pool.prototype.query;
    expect(livePoolQuery).toBe(poolQuery);
    expect(Object.getOwnPropertyNames(Client.prototype).toSorted((a, b) => a.localeCompare(b))).toEqual(keysBefore);

    handle.uninstall();
    expect(Object.getOwnPropertyNames(Client.prototype).toSorted((a, b) => a.localeCompare(b))).toEqual(keysBefore);
  });

  test("counting never writes to any console stream (query text stays in memory)", async () => {
    const seen: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      console[method] = (...args: unknown[]) => {
        seen.push(`${method}:${String(args[0])}`);
      };
    }
    try {
      const { handle } = installOverFakeBase();
      const client = new Client();
      await client.query("SELECT password FROM users WHERE token = 'super-secret-token-value'");
      expect(handle.snapshot().total).toBe(1);
      expect(seen).toHaveLength(0);
    } finally {
      console.log = consoleMethods.log;
      console.info = consoleMethods.info;
      console.warn = consoleMethods.warn;
      console.error = consoleMethods.error;
      console.debug = consoleMethods.debug;
    }
  });
});
