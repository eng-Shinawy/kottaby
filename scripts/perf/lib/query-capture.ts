/**
 * Production-SQL capture seam for the EXPLAIN query auditor.
 *
 * The canonical query registry must analyze the SQL the repository layer
 * actually sends — never a hand-copied approximation — so the auditor runs
 * each registered repository read inside a short capture window. This
 * module patches `pg`'s `Client.prototype.query` (the same seam the query
 * counter rides: pg's `Pool` borrows a `Client` per query and delegates to
 * that client's `query` method, so one patch covers pooled and
 * transaction-client round trips alike), records every statement's text
 * and binding values synchronously at invocation entry, delegates to the
 * original method unchanged, and restores the exact captured prototype
 * property descriptor when the window closes — on every path, including
 * invocation failure.
 *
 * Harness-process-only contract: this module patches a shared prototype
 * and MUST never be imported from `app/`, `backend/`, `frontend/`, or
 * `shared/` production code — only `scripts/perf/` harness tools may use
 * it. Captured statements live in memory only; the auditor redacts every
 * byte it persists.
 */

import { Client } from "pg";

/** One production statement exactly as pg received it: text + bound values. */
export interface CapturedStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Delegation-target shape of pg's overloaded `Client.prototype.query`. */
export type PgQueryBase = (this: unknown, ...args: unknown[]) => unknown;

/** Wraps one repository invocation in a capture window and returns every statement it sent. */
export type CaptureAround = (invoke: () => Promise<unknown>) => Promise<readonly CapturedStatement[]>;

/** Raised for capture-window misuse or unextractable query shapes. */
export class QueryCaptureError extends Error {}

export interface CaptureOptions {
  /** Substitutes the delegation target (test seam; default = the real pg method). */
  readonly baseQuery?: PgQueryBase;
}

/** One capture window may be active per process (single-owner discipline). */
let captureWindowActive = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPgQueryFn(value: unknown): value is PgQueryBase {
  return typeof value === "function";
}

/** Binding values of one invocation: the explicit array, the config's array, or none. */
function bindingValuesOf(args: readonly unknown[], config: unknown): readonly unknown[] {
  const second = args[1];
  if (Array.isArray(second)) {
    return second;
  }
  if (isRecord(config) && Array.isArray(config.values)) {
    return config.values;
  }
  return [];
}

/**
 * Extracts one statement from a `query()` argument list. pg accepts a
 * plain string, a config object carrying `text`, or a submittable Query
 * object that also carries `text`; anything else cannot be replayed under
 * EXPLAIN, so the window fails loudly instead of silently skipping a
 * production statement.
 */
function extractStatement(args: readonly unknown[]): CapturedStatement {
  const config = args[0];
  if (typeof config === "string") {
    return { sql: config, params: bindingValuesOf(args, config) };
  }
  if (isRecord(config) && typeof config.text === "string") {
    return { sql: config.text, params: bindingValuesOf(args, config) };
  }
  throw new QueryCaptureError(
    "a query() invocation carried no extractable SQL text — the capture window refuses to skip a production statement"
  );
}

/**
 * Runs `invoke` inside a capture window: every statement the underlying
 * repository call sends through pg is recorded (in invocation order, at
 * entry, before delegation) and returned once the call settles. The
 * prototype descriptor is restored on every exit path. Windows are
 * single-owner — a second concurrent window is refused, because a nested
 * patch would record statements twice.
 */
export function captureQueryStatements(
  invoke: () => Promise<unknown>,
  opts?: CaptureOptions
): Promise<readonly CapturedStatement[]> {
  if (captureWindowActive) {
    return Promise.reject(
      new QueryCaptureError("a capture window is already active — capture runs serially, one repository call at a time")
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(Client.prototype, "query");
  if (descriptor === undefined) {
    return Promise.reject(new QueryCaptureError("pg Client.prototype.query has no own property descriptor"));
  }
  const originalValue: unknown = descriptor.value;
  if (!isPgQueryFn(originalValue)) {
    return Promise.reject(new QueryCaptureError("pg Client.prototype.query is not a callable query method"));
  }
  const baseQuery: PgQueryBase = opts?.baseQuery ?? originalValue;

  const statements: CapturedStatement[] = [];
  const patchedQuery = function capturedPgQuery(this: unknown, ...args: unknown[]): unknown {
    statements.push(extractStatement(args));
    return baseQuery.call(this, ...args);
  };
  // Validation-first + assignment-after: every rejection above happens
  // before any mutation, and `Object.defineProperty` applies atomically, so
  // a failed window can never leave a patch behind.
  Object.defineProperty(Client.prototype, "query", {
    value: patchedQuery,
    writable: descriptor.writable ?? true,
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? true,
  });
  captureWindowActive = true;
  const restore = (): void => {
    captureWindowActive = false;
    Object.defineProperty(Client.prototype, "query", descriptor);
  };
  return Promise.resolve()
    .then(invoke)
    .then(
      () => {
        restore();
        return statements.slice();
      },
      error => {
        restore();
        throw error;
      }
    );
}
