/**
 * SQL query-counting oracle for the performance harness library.
 *
 * Patches `pg`'s `Client.prototype.query` so every database round trip in
 * this process — pooled, transaction-client, or direct — is counted, with
 * per-fingerprint breakdowns for N+1-style regressions. pg's `Pool` does not
 * subclass `Client`; it borrows a `Client` per query and delegates to that
 * client's `query` method, so patching the prototype covers pool round trips
 * and transaction-client round trips alike.
 *
 * Harness-process-only contract: this module patches a shared prototype and
 * MUST never be imported from `app/`, `backend/`, `frontend/`, or `shared/`
 * production code — only `scripts/perf/` harness tools may use it. The patch
 * never touches the network, never logs query text, and restores the exact
 * original prototype property descriptor on uninstall, so nothing leaks past
 * the bracketing install/uninstall window.
 */

import { Client } from "pg";

/** Point-in-time view of the counter; immutable-in-time once taken. */
export interface QueryCountSnapshot {
  total: number;
  byFingerprint: ReadonlyMap<string, number>;
}

/**
 * Bracket handle for one counting window. `snapshot`/`deltaSince` stay
 * callable after `uninstall` (the counts freeze); a fresh install returns a
 * fresh zero-state handle.
 */
export interface QueryCountHandle {
  snapshot(): QueryCountSnapshot;
  deltaSince(snapshot: QueryCountSnapshot): number;
  uninstall(): void;
}

/** Raised for invalid install states; harnesses surface it as a usage error. */
export class QueryCounterError extends Error {}

/** Length of the normalized SQL prefix used as the fingerprint key. */
export const FINGERPRINT_PREFIX_LENGTH = 120;

/** Fingerprint for invocations whose SQL text cannot be extracted. */
export const UNRECOGNIZED_QUERY_FINGERPRINT = "<unrecognized>";

/** Minimal structural view of pg's overloaded `Client.prototype.query`. */
type PgQueryFn = (this: unknown, ...args: unknown[]) => unknown;

/** The single active handle; only one counter may be installed per process. */
let activeHandle: QueryCountHandle | null = null;

/** Runtime-validated narrowing to a callable query method (no unsafe casts). */
function isPgQueryFn(value: unknown): value is PgQueryFn {
  return typeof value === "function";
}

/**
 * Extracts the SQL text from a `query()` argument list. pg accepts a plain
 * string, a config object carrying `text`, or a submittable Query object
 * that also carries `text`; anything else (including the null/undefined
 * config pg rejects with a TypeError) yields null.
 */
function sqlTextOf(args: readonly unknown[]): string | null {
  const config = args[0];
  if (typeof config === "string") {
    return config;
  }
  if (typeof config === "object" && config !== null && "text" in config) {
    const text: unknown = config.text;
    if (typeof text === "string") {
      return text;
    }
  }
  return null;
}

/** Whitespace-collapsed SQL prefix used to group structurally equal queries. */
function fingerprintOfSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, FINGERPRINT_PREFIX_LENGTH);
}

interface CounterState {
  total: number;
  byFingerprint: Map<string, number>;
}

/**
 * Records one invocation. Runs synchronously before the real query is
 * delegated and is infallible by construction (typed narrowings only — no
 * throwing operation), so counting can never corrupt the measured path.
 * Binding-parameter values are never part of the fingerprint.
 */
function recordInvocation(state: CounterState, args: readonly unknown[]): void {
  const sql = sqlTextOf(args);
  const fingerprint = sql === null ? UNRECOGNIZED_QUERY_FINGERPRINT : fingerprintOfSql(sql);
  state.total += 1;
  state.byFingerprint.set(fingerprint, (state.byFingerprint.get(fingerprint) ?? 0) + 1);
}

/**
 * Installs the counter by replacing `Client.prototype.query` with a wrapper
 * that records every invocation and delegates to the captured original.
 * Throws if a counter is already installed (single-owner discipline — a
 * silent second patch would double-count every round trip) or if the
 * prototype property is not a replaceable data-property method. If the patch
 * step itself fails, no installed state is left behind.
 */
export function installQueryCounter(): QueryCountHandle {
  if (activeHandle !== null) {
    throw new QueryCounterError(
      "a query counter is already installed in this process — uninstall the active handle before installing another"
    );
  }

  const originalDescriptor = Object.getOwnPropertyDescriptor(Client.prototype, "query");
  if (originalDescriptor === undefined) {
    throw new QueryCounterError("pg Client.prototype.query has no own property descriptor");
  }
  const originalValue: unknown = originalDescriptor.value;
  if (!isPgQueryFn(originalValue)) {
    throw new QueryCounterError("pg Client.prototype.query is not a callable query method");
  }
  const originalQuery = originalValue;

  const state: CounterState = { total: 0, byFingerprint: new Map<string, number>() };

  const patchedQuery = function patchedPgQuery(this: unknown, ...args: unknown[]): unknown {
    recordInvocation(state, args);
    return originalQuery.call(this, ...args);
  };

  let uninstalled = false;
  const handle: QueryCountHandle = {
    snapshot(): QueryCountSnapshot {
      return { total: state.total, byFingerprint: new Map(state.byFingerprint) };
    },
    deltaSince(snapshot: QueryCountSnapshot): number {
      return state.total - snapshot.total;
    },
    uninstall(): void {
      if (uninstalled) {
        return;
      }
      uninstalled = true;
      if (activeHandle === handle) {
        activeHandle = null;
      }
      Object.defineProperty(Client.prototype, "query", originalDescriptor);
    },
  };
  // Validation-first + assignment-after: every throw above happens before any
  // mutation, and `Object.defineProperty` applies atomically (on failure the
  // property is unchanged), so a failed install can never leave a patch or a
  // half-installed handle behind.
  Object.defineProperty(Client.prototype, "query", {
    value: patchedQuery,
    writable: originalDescriptor.writable ?? true,
    enumerable: originalDescriptor.enumerable ?? false,
    configurable: originalDescriptor.configurable ?? true,
  });
  activeHandle = handle;

  return handle;
}
