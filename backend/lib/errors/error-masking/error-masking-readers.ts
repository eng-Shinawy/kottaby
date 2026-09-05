/**
 * Error-masking readers — assertion-free narrowing, response-shape
 * extractors, envelope-hop machinery, and bounded unwrap probes shared by
 * the redaction engine and the masking-item finalizer.
 *
 * Pure helpers: no logging, no localization, no environment reads.
 */

/** Upper character budget applied to opaque scalar renderings in logs/dev. */
export const OPAQUE_RENDER_BUDGET = 512;

// ─── Public transport shapes ─────────────────────────────────────────────────

/** A single response-path segment as carried by formatted GraphQL errors. */
export type GraphQLPathSegment = string | number;

/** Response path of field-level resolver errors (preserved verbatim). */
export type GraphQLResponsePath = readonly GraphQLPathSegment[];

/** Document location `{ line, column }` shape on formatted errors. */
export interface GraphQLLocationShape {
  readonly line: number;
  readonly column: number;
}

// ─── Generic safe readers (assertion-free narrowing everywhere) ─────────────

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string property that is non-empty, else `null`. */
export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Result wrapper used so getter failures never escape as exceptions. */
export type ReadOutcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export function readProperty(source: Record<string, unknown>, key: string): ReadOutcome {
  try {
    return { ok: true, value: source[key] };
  } catch {
    return { ok: false };
  }
}

export function readIndex(source: readonly unknown[], index: number): ReadOutcome {
  try {
    return { ok: true, value: source[index] };
  } catch {
    return { ok: false };
  }
}

/** Guards `path?: readonly (string|number)[]` shapes (class or plain objects). */
export function extractResponsePath(source: unknown): GraphQLResponsePath | undefined {
  if (!isRecordValue(source) || !("path" in source)) {
    return undefined;
  }
  const candidate = source.path;
  if (!Array.isArray(candidate)) {
    return undefined;
  }
  const wellFormed = candidate.every(segment => typeof segment === "string" || typeof segment === "number");
  return wellFormed ? [...candidate] : undefined;
}

/** Guards `locations?: readonly {line,column}[]` shapes (presence-preserving). */
export function extractLocations(source: unknown): readonly GraphQLLocationShape[] | undefined {
  if (!isRecordValue(source) || !("locations" in source)) {
    return undefined;
  }
  const candidate = source.locations;
  if (!Array.isArray(candidate)) {
    return undefined;
  }
  const shaped: GraphQLLocationShape[] = [];
  for (const loc of candidate) {
    if (!isRecordValue(loc)) {
      return undefined;
    }
    if (typeof loc.line !== "number" || typeof loc.column !== "number") {
      return undefined;
    }
    shaped.push({ line: loc.line, column: loc.column });
  }
  return shaped;
}

/** Caps rendered text to a byte-ish budget, appending a truncation notice. */
export function capRenderedText(raw: string, budget: number): string {
  return raw.length > budget ? `${raw.slice(0, budget)}…[TRUNCATED]` : raw;
}

// ─── Boundary envelope hop (formatError hook ⇄ finalizer contract) ──────────

/**
 * Non-enumerable property key under which the route's `formatError` hook
 * stores the RAW thrown value beside its formatted wire item. Never appears
 * in `JSON.stringify` output nor in `{...spread}` copies-only-enumerable —
 * the client can neither observe nor trigger it.
 */
export const RAW_ERROR_HOP: unique symbol = Symbol.for("dev3-002.graphqlBoundary.rawError");

/**
 * Attaches the raw throwable to a formatted wire item without affecting its
 * serialized shape. Frozen carriers silently lose the hop (masking still
 * applies — the hop is diagnostic enrichment, not a correctness dependency).
 */
export function attachRawErrorHop(carrier: object, rawError: unknown): void {
  try {
    Object.defineProperty(carrier, RAW_ERROR_HOP, {
      value: rawError,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // Hostile carrier — proceed without the diagnostic hop.
  }
}

/** Reads the envelope hop back off any carrier shape; absent ⇒ `undefined`. */
export function readRawErrorHop(candidate: unknown): unknown {
  if (!isRecordValue(candidate)) {
    return undefined;
  }
  try {
    return (candidate as { [RAW_ERROR_HOP]?: unknown })[RAW_ERROR_HOP];
  } catch {
    return undefined;
  }
}

// ─── Bounded unwrap probes ──────────────────────────────────────────────────

/**
 * Single structural unwrap (`originalError`, falling back to `cause`) from any
 * record- or Error-shaped root — graphql-js located errors, Apollo wrapped
 * errors, and boundary test fixtures all expose their real throwable through
 * one of these properties.
 */
export function firstStructuralHop(root: unknown): unknown {
  if (!isRecordValue(root)) {
    return undefined;
  }
  if ("originalError" in root) {
    const origin = root.originalError;
    if (origin !== undefined && origin !== null) {
      return origin;
    }
  }
  if ("cause" in root) {
    return root.cause;
  }
  return undefined;
}

/**
 * Bounded probe set for ONE wire item: the item itself, its envelope hop
 * (when attached by the route's `formatError`), and ONE structural unwrap of
 * each. Never a recursive chain walk — classification stays O(1)-depth per
 * element.
 */
export function boundaryProbes(candidate: unknown): readonly unknown[] {
  const rawHop = readRawErrorHop(candidate);
  const probes: unknown[] = [candidate];
  if (rawHop !== undefined) {
    probes.push(rawHop);
  }
  const structuralFromItem = firstStructuralHop(candidate);
  if (structuralFromItem !== undefined && !probes.includes(structuralFromItem)) {
    probes.push(structuralFromItem);
  }
  if (rawHop !== undefined) {
    const structuralFromRaw = firstStructuralHop(rawHop);
    if (structuralFromRaw !== undefined && !probes.includes(structuralFromRaw)) {
      probes.push(structuralFromRaw);
    }
  }
  return probes;
}

// ─── Apollo protocol-preset codes ───────────────────────────────────────────

/**
 * Apollo Server preset codes whose failures are AUTHORED BY THE PROTOCOL
 * LAYER (values match `ApolloServerErrorCode` from `@apollo/server/errors` —
 * mirrored as literals to keep this DB-free pure module decoupled from the
 * server framework). Their messages can never embed server internals; see
 * the module-header protocol-preserve rule.
 */
const APOLLO_PROTOCOL_PRESET_CODES: ReadonlySet<string> = new Set([
  "GRAPHQL_PARSE_FAILED",
  "GRAPHQL_VALIDATION_FAILED",
  "OPERATION_RESOLUTION_FAILURE",
  "BAD_USER_INPUT",
  "PERSISTED_QUERY_NOT_FOUND",
  "PERSISTED_QUERY_NOT_SUPPORTED",
]);

/** Reads a string-valued `extensions.code` off a record when present. */
function readExtensionsCode(source: unknown): string | null {
  if (!isRecordValue(source)) {
    return null;
  }
  let extensions: unknown;
  try {
    extensions = source.extensions;
  } catch {
    return null;
  }
  if (!isRecordValue(extensions)) {
    return null;
  }
  const code = extensions.code;
  return typeof code === "string" ? code : null;
}

/**
 * Protocol-preset detection over ONE level on each side: the wire item's own
 * enriched `extensions.code`, else the envelope-hop error's `extensions.code`
 * (covers callers that build items without running Apollo enrichment).
 * The generic `INTERNAL_SERVER_ERROR` default NEVER matches — unknowns stay
 * masked.
 */
export function readProtocolPresetCode(candidate: unknown): string | null {
  const rawHop = readRawErrorHop(candidate);
  for (const code of [readExtensionsCode(candidate), readExtensionsCode(rawHop)]) {
    if (code !== null && code !== "INTERNAL_SERVER_ERROR" && APOLLO_PROTOCOL_PRESET_CODES.has(code)) {
      return code;
    }
  }
  return null;
}

// ─── Wire-item readers ──────────────────────────────────────────────────────

/** Reads an own property defensively; absent/throwing ⇒ `undefined`. */
export function readWireProperty(source: unknown, key: "message" | "extensions"): unknown {
  if (!isRecordValue(source)) {
    return undefined;
  }
  try {
    return source[key];
  } catch {
    return undefined;
  }
}

/** Reads a record-shaped `extensions` bag off a wire item when present. */
export function readWireExtensions(candidate: unknown): Record<string, unknown> | undefined {
  const extensions = readWireProperty(candidate, "extensions");
  return isRecordValue(extensions) ? extensions : undefined;
}
