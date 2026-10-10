/**
 * In-process SQL capture for the `scripts/load/` DB-backed probes.
 *
 * Patches `pg`'s `Client.prototype.query` so every database round trip in
 * THIS process — pooled or transaction-client — is captured as
 * `{ text, values }`. pg's `Pool` borrows a `Client` per query and
 * delegates to that client's `query` method, so patching the prototype
 * covers pool round trips and transaction round trips alike.
 *
 * Harness-process-only contract: this module patches a shared prototype
 * and must never be imported from `app/`, `backend/`, `frontend/`, or
 * `shared/` code — only `scripts/load/` tools may use it. The patch never
 * logs query text outside the capturing process and restores the exact
 * original prototype property on uninstall.
 */

import { Client } from "pg";

/** One captured database round trip. */
export interface CapturedStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** Bracket handle for one capture window; `uninstall` restores the prototype. */
export interface SqlCapture {
  statements(): readonly CapturedStatement[];
  uninstall(): void;
}

type PgQueryFn = (this: unknown, ...args: unknown[]) => unknown;

/** Extracts the SQL text from pg's overloaded `query()` argument shapes. */
function sqlTextOf(args: readonly unknown[]): string {
  const config = args[0];
  if (typeof config === "string") {
    return config;
  }
  if (config !== null && typeof config === "object" && "text" in config) {
    const text: unknown = (config as Record<string, unknown>).text;
    if (typeof text === "string") {
      return text;
    }
  }
  return "<unrecognized>";
}

/** Extracts the bound parameter array when present. */
function valuesOf(args: readonly unknown[]): readonly unknown[] {
  const config = args[0];
  if (config !== null && typeof config === "object" && "values" in config) {
    const values: unknown = (config as Record<string, unknown>).values;
    if (Array.isArray(values)) {
      return values;
    }
  }
  const second = args[1];
  return Array.isArray(second) ? second : [];
}

/**
 * Installs the capture patch. Only one capture may be installed per
 * process; a second install while active throws.
 */
export function installSqlCapture(): SqlCapture {
  const descriptor = Object.getOwnPropertyDescriptor(Client.prototype, "query");
  if (activeCapture !== null) {
    throw new Error("sql-capture: an active capture already exists");
  }
  const original = descriptor?.value;
  if (descriptor === undefined || typeof original !== "function") {
    throw new Error("sql-capture: pg Client.prototype.query is not a patchable function");
  }

  const captured: CapturedStatement[] = [];
  const patched: PgQueryFn = function patchedQuery(this: unknown, ...args: unknown[]) {
    captured.push({ text: sqlTextOf(args), values: valuesOf(args) });
    return Reflect.apply(original, this, args);
  };
  Object.defineProperty(Client.prototype, "query", { ...descriptor, value: patched });

  const handle: SqlCapture = {
    statements: () => [...captured],
    uninstall: () => {
      if (activeCapture === handle) {
        Object.defineProperty(Client.prototype, "query", descriptor);
        activeCapture = null;
      }
    },
  };
  activeCapture = handle;
  return handle;
}

/** The single active capture — one per process, enforced at install time. */
let activeCapture: SqlCapture | null = null;
