/**
 * Error-contract integration matrix over the canonical code↔HTTP taxonomy.
 *
 * Structure: a GRID of rows keyed by
 * `{DomainError subclass × wire shape}`, exercised through the REAL boundary
 * composition (`finalizeGraphqlErrors` + `attachRawErrorHop`, imported from
 * the exact modules the single registration site consumes). Failure-side
 * assertions all go through real Apollo Client v4
 * `CombinedGraphQLErrors` containers and the shared
 * `expectMutationError(container, expectedCode)` helper.
 *
 * Wire shapes covered per subclass:
 *  - `located` — graphql-js-style carrier `{message, path, locations,
 *    originalError}` (what graphql-js hands to formatError);
 *  - `envelopeHop` — plain formatted item with the raw throwable attached via
 *    the non-enumerable `RAW_ERROR_HOP` (exactly what the route's formatError
 *    hook ships to the finalizer under Apollo ≥5 toJSON flattening).
 *
 * Sections:
 *  1. Pass-through grid — subclass × shape; code/message/path/locations/
 *     requestId attachment; locale-invariant codes.
 *  2. authScopes pairing — UNAUTHORIZED vs FORBIDDEN non-interchange pinning.
 *  3. Masked tier — raw non-DomainError throwables → generic localized
 *     INTERNAL_SERVER_ERROR with requestId correlation and EXACTLY ONE redacted
 *     correlated `logger.error` per masked element (module-seam spy).
 *  4. Protocol presets — all six Apollo preset codes pass AS-IS untouched
 *     (message verbatim, code unchanged, only requestId added, DEV stacktrace
 *     key stripped, zero logger.error emissions).
 *  5. Legacy alias cross-checks — RATE_LIMIT_EXCEEDED passes through VERBATIM
 *     while status/category derivation normalizes via the taxonomy map.
 *  6. Plugin registration surface — the once-per-server artifact's hook shape.
 *  7. Wire tier (live HTTP boot) — health identity, protocol presets and the
 *     anonymous-gated-field authScopes probe end-to-end through
 *     `setupTestServerLifecycle` + `testClient`.
 *
 * Mandated runner: bun run test/scripts/run-test.ts backend/graphql/test/error-contract-matrix.test.ts
 */

import { describe, expect, spyOn, test } from "bun:test";
import { CombinedGraphQLErrors, gql } from "@apollo/client";
import type { GraphQLFormattedError } from "graphql";
import { createGraphqlErrorsFinalizerPlugin } from "@/backend/graphql/graphqlErrorsFinalizer";
import {
  attachRawErrorHop,
  ConflictError,
  DomainError,
  ERROR_CODE_HTTP_STATUS,
  type ErrorFinalizationContext,
  ForbiddenError,
  finalizeGraphqlErrors,
  isErrorCode,
  NotFoundError,
  normalizeErrorCode,
  RateLimitExceededError,
  UnauthorizedError,
  ValidationError,
} from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { expectMutationError, setupTestServerLifecycle, TEST_PORT, testClient } from "@/test/helpers";

const tEn = getServerTranslations("en").errorsTranslations;
const tAr = getServerTranslations("ar").errorsTranslations;

// ─── Assertion-free narrowing helpers ────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** First finalized item off a container, runtime-guarded (no casts). */
function firstWireItem(container: CombinedGraphQLErrors): Record<string, unknown> {
  const candidate: unknown = container.errors[0];
  if (!isRecord(candidate)) {
    throw new Error("expected record-shaped finalized error item");
  }
  return candidate;
}

function extensionsOf(item: Record<string, unknown>): Record<string, unknown> {
  const candidate: unknown = item.extensions;
  if (!isRecord(candidate)) {
    throw new Error("expected record-shaped extensions on finalized item");
  }
  return candidate;
}

/**
 * Rebuilds a finalized element as a transport-typed GraphQLFormattedError so
 * the CombinedGraphQLErrors constructor receives honestly-shaped items —
 * explicit property mapping, zero casts.
 */
function formattedLocation(candidate: unknown): { line: number; column: number } | undefined {
  if (!isRecord(candidate)) {
    return undefined;
  }
  const { line, column } = candidate;
  return typeof line === "number" && typeof column === "number" ? { line, column } : undefined;
}

function toFormattedElement(source: unknown): GraphQLFormattedError {
  if (!isRecord(source)) {
    return { message: "" };
  }
  const message = typeof source.message === "string" ? source.message : "";
  const path =
    Array.isArray(source.path) &&
    source.path.every(segment => typeof segment === "string" || typeof segment === "number")
      ? [...source.path]
      : undefined;
  const rawLocations: unknown = source.locations;
  const hadLocations = isUnknownArray(rawLocations);
  const locations = hadLocations
    ? rawLocations.map(entry => formattedLocation(entry)).filter(entry => entry !== undefined)
    : [];
  const extensions = isRecord(source.extensions) ? source.extensions : undefined;
  return {
    message,
    ...(path === undefined ? {} : { path }),
    ...(hadLocations ? { locations } : {}),
    ...(extensions === undefined ? {} : { extensions }),
  };
}

// ─── Boundary composition fixtures ───────────────────────────────────────────

interface FinalizeOutcome {
  readonly container: CombinedGraphQLErrors;
  readonly serializedBody: string;
}

/**
 * Drives ONE wire element through the boundary classifier and re-wraps the
 * rebuilt element into a REAL v4 CombinedGraphQLErrors so assertions run
 * through the shared helper (`expectMutationError`) instead of raw
 * object equality on internal classification output.
 */
function finalizeSingleElement(carrier: unknown, ctx: ErrorFinalizationContext): FinalizeOutcome {
  const finalized = finalizeGraphqlErrors({ errors: [carrier] }, ctx);
  const errors = finalized.errors;
  if (!Array.isArray(errors)) {
    throw new Error("finalizer returned no errors array");
  }
  return {
    container: new CombinedGraphQLErrors({ errors: errors.map(toFormattedElement) }),
    serializedBody: JSON.stringify(finalized) ?? "",
  };
}

type WireShape = "located" | "envelopeHop";
type ResponsePath = readonly (string | number)[];

/** Builds the carrier exactly like each transport shape produces it. */
function buildCarrier(error: Error, shape: WireShape, path: ResponsePath): Record<string, unknown> {
  const base: Record<string, unknown> = {
    message: error.message,
    path: [...path],
    locations: [{ line: 2, column: 9 }],
  };
  if (shape === "located") {
    return { ...base, originalError: error };
  }
  const hopOnly: Record<string, unknown> = { ...base };
  attachRawErrorHop(hopOnly, error);
  return hopOnly;
}

/** Module-seam logger spy captured synchronously around ONE classification body. */
function captureMaskedLogCalls(body: () => void): ReadonlyArray<ReadonlyArray<unknown>> {
  const errorSpy = spyOn(logger, "error");
  try {
    body();
    return errorSpy.mock.calls;
  } finally {
    errorSpy.mockRestore();
  }
}

// ─── Section 1 — pass-through grid ({subclass × shape}) ─────────────────────

interface SubclassRowSpec {
  readonly label: string;
  readonly makeError: () => DomainError;
  readonly expectedCode: string;
}

const SUBCLASS_ROWS: readonly SubclassRowSpec[] = [
  {
    label: "NotFoundError → USER_NOT_FOUND",
    makeError: () => new NotFoundError("USER", tEn.notFound),
    expectedCode: "USER_NOT_FOUND",
  },
  {
    label: "UnauthorizedError → UNAUTHORIZED",
    makeError: () => new UnauthorizedError(tEn.unauthorized),
    expectedCode: "UNAUTHORIZED",
  },
  {
    label: "ForbiddenError → FORBIDDEN",
    makeError: () => new ForbiddenError(tEn.forbidden),
    expectedCode: "FORBIDDEN",
  },
  {
    label: "ConflictError → CONFLICT",
    makeError: () => new ConflictError(tEn.conflict),
    expectedCode: "CONFLICT",
  },
  {
    label: "ValidationError → VALIDATION (+fields)",
    makeError: () =>
      new ValidationError("VALIDATION", tEn.validation, undefined, [
        { field: "email", code: "EMAIL_TAKEN", message: tEn.duplicateRequest },
        { field: "homeWork.currentGrade", code: "GRADE_OUT_OF_RANGE", message: tEn.validation },
      ]),
    expectedCode: "VALIDATION",
  },
  {
    label: "custom DomainError('BAD_REQUEST') passthrough",
    makeError: () => new DomainError("BAD_REQUEST", tEn.badRequest),
    expectedCode: "BAD_REQUEST",
  },
  {
    label: "RateLimitExceededError → RATE_LIMIT_EXCEEDED (legacy literal)",
    makeError: () => new RateLimitExceededError(tEn.rateLimitExceeded),
    expectedCode: "RATE_LIMIT_EXCEEDED",
  },
];

const WIRE_SHAPES: readonly WireShape[] = ["located", "envelopeHop"];
const GRID_PATH: ResponsePath = ["mutation", "registerUser", 0];
const GRID_LOCATIONS = [{ line: 2, column: 9 }];

describe("error-contract matrix — pass-through grid (subclass × shape)", () => {
  for (const row of SUBCLASS_ROWS) {
    for (const shape of WIRE_SHAPES) {
      test(`${row.label} · ${shape}`, () => {
        const domainError = row.makeError();
        const outcome = finalizeSingleElement(buildCarrier(domainError, shape, GRID_PATH), {
          locale: "en",
          requestId: "matrix-corr-1",
        });

        // The shared helper drives every grid cell's code check.
        expectMutationError(outcome.container, row.expectedCode);
        const item = firstWireItem(outcome.container);
        expect(item.message).toBe(domainError.message);
        expect(item.path).toEqual([...GRID_PATH]);
        expect(item.locations).toEqual(GRID_LOCATIONS);

        const extensions = extensionsOf(item);
        expect(extensions.code).toBe(row.expectedCode);
        expect(extensions.requestId).toBe("matrix-corr-1");
        expect(outcome.serializedBody.includes("debug")).toBe(false);

        // ValidationError-only extras: fields mirror (exact order, values).
        if (domainError instanceof ValidationError && Array.isArray(domainError.fields)) {
          const mirrored = extensions.fields;
          if (!Array.isArray(mirrored)) throw new Error("expected mirrored fields payload");
          expect(mirrored).toHaveLength(2);
          const secondField: unknown = mirrored[1];
          if (!isRecord(secondField)) throw new Error("expected field entry");
          expect(secondField.field).toBe("homeWork.currentGrade");
          expect(secondField.code).toBe("GRADE_OUT_OF_RANGE");
          expect(secondField.message).toBe(tEn.validation);
        }
      });
    }
  }

  test("omitted ctx.requestId stays ABSENT from extensions (no empty-string correlation)", () => {
    const outcome = finalizeSingleElement(buildCarrier(new ConflictError(tEn.conflict), "located", ["m"]), {
      locale: "en",
    });
    expectMutationError(outcome.container, "CONFLICT");
    expect("requestId" in extensionsOf(firstWireItem(outcome.container))).toBe(false);
  });

  test("ValidationError presence semantics: deliberate EMPTY fields[] survives verbatim", () => {
    const outcome = finalizeSingleElement(
      buildCarrier(new ValidationError("VALIDATION", tEn.validation, undefined, []), "envelopeHop", ["m"]),
      { locale: "en", requestId: "empty-fields-id" }
    );
    expectMutationError(outcome.container, "VALIDATION");
    const fields = extensionsOf(firstWireItem(outcome.container)).fields;
    expect(Array.isArray(fields)).toBe(true);
    expect(fields).toHaveLength(0);
  });

  test("codes are locale-invariant transport constants (ar context keeps identical codes)", () => {
    const outcome = finalizeSingleElement(
      buildCarrier(new UnauthorizedError(tAr.unauthorized), "envelopeHop", ["me"]),
      {
        locale: "ar",
        requestId: "ar-correlation",
      }
    );
    expectMutationError(outcome.container, "UNAUTHORIZED");
    expect(firstWireItem(outcome.container).message).toBe(tAr.unauthorized);
    expect(tAr.unauthorized !== "" && tAr.unauthorized !== tEn.unauthorized).toBe(true);
  });
});

// ─── Section 2 — authScopes pairing (non-interchangeable) ───────────────────

describe("error-contract matrix — UNAUTHORIZED vs FORBIDDEN pairing", () => {
  test("both scope failures classify at the boundary WITHOUT interchange or masking", () => {
    const anonymousRow = finalizeSingleElement(
      buildCarrier(new UnauthorizedError("Authentication required."), "located", ["me"]),
      { locale: "en", requestId: "pair-anon" }
    );
    const lowPrivilegeRow = finalizeSingleElement(
      buildCarrier(new ForbiddenError(tEn.forbidden), "envelopeHop", ["adminAction"]),
      { locale: "en", requestId: "pair-lowpriv" }
    );

    expectMutationError(anonymousRow.container, "UNAUTHORIZED");
    expectMutationError(lowPrivilegeRow.container, "FORBIDDEN");
    expect(extensionsOf(firstWireItem(anonymousRow.container)).code).not.toBe(
      extensionsOf(firstWireItem(lowPrivilegeRow.container)).code
    );
    // Statuses derive apart through the taxonomy map (401 vs 403).
    expect(ERROR_CODE_HTTP_STATUS.UNAUTHORIZED).toBe(401);
    expect(ERROR_CODE_HTTP_STATUS.FORBIDDEN).toBe(403);
  });

  test("neither scope failure emits the masked logger.error channel", () => {
    const calls = captureMaskedLogCalls(() => {
      finalizeSingleElement(buildCarrier(new ForbiddenError(tEn.forbidden), "located", ["x"]), {
        locale: "en",
        requestId: "silent-pair",
      });
    });
    expect(calls).toHaveLength(0);
  });
});

// ─── Section 3 — masked tier (raw non-domain throwables) ─────────────────────

const LEAK_PATTERN = /SQLSTATE|SELECT\s|\/srv\/|password_hash|NODE_ENV|driver died/u;

describe("error-contract matrix — masked raw-error tier", () => {
  test("raw Error behind the envelope hop masks to localized INTERNAL_SERVER_ERROR + correlated log", () => {
    const leaky: Record<string, unknown> = {
      message: "SOMEDRIVER SQLSTATE=abc SELECT password_hash FROM users",
      path: ["leakyField"],
    };
    attachRawErrorHop(leaky, new Error("stack-frame /srv/app/x.ts driver died"));

    let outcome!: FinalizeOutcome;
    const calls = captureMaskedLogCalls(() => {
      outcome = finalizeSingleElement(leaky, { locale: "en", requestId: "mask-corr-en" });
    });

    expectMutationError(outcome.container, "INTERNAL_SERVER_ERROR");
    const item = firstWireItem(outcome.container);
    expect(item.message).toBe(tEn.internalServerError);
    expect(extensionsOf(item).requestId).toBe("mask-corr-en");
    expect(LEAK_PATTERN.test(outcome.serializedBody)).toBe(false);

    expect(calls).toHaveLength(1);
    const bag: unknown = calls[0]?.[1];
    if (!isRecord(bag)) throw new Error("logger.error context bag missing");
    expect(bag.requestId).toBe("mask-corr-en");
  });

  test("arabic locale masks through server translations with its own correlation id", () => {
    let outcome!: FinalizeOutcome;
    const calls = captureMaskedLogCalls(() => {
      outcome = finalizeSingleElement(
        buildCarrier(new TypeError("cannot read properties of undefined"), "located", ["f"]),
        { locale: "ar", requestId: "mask-corr-ar" }
      );
    });
    expectMutationError(outcome.container, "INTERNAL_SERVER_ERROR");
    expect(firstWireItem(outcome.container).message).toBe(tAr.internalServerError);
    const bag: unknown = calls[0]?.[1];
    if (!isRecord(bag)) throw new Error("logger.error context bag missing");
    expect(bag.requestId).toBe("mask-corr-ar");
  });

  test("opaque probe-less items still mask (classification never throws, kind metadata rides the LOG only)", () => {
    let outcome!: FinalizeOutcome;
    const calls = captureMaskedLogCalls(() => {
      outcome = finalizeSingleElement({ message: "telemetry glitch" }, { locale: "en", requestId: "mask-opaque" });
    });
    expectMutationError(outcome.container, "INTERNAL_SERVER_ERROR");
    expect(firstWireItem(outcome.container).message).toBe(tEn.internalServerError);
    expect(outcome.serializedBody.includes("telemetry glitch")).toBe(false);
    expect(calls).toHaveLength(1);
    const bag: unknown = calls[0]?.[1];
    if (!isRecord(bag)) throw new Error("logger.error context bag missing");
    expect(typeof bag.errorKind).toBe("string");
  });

  test("two masked elements in one result produce one correlated log EACH (same requestId)", () => {
    let finalized!: ReturnType<typeof finalizeGraphqlErrors>;
    const calls = captureMaskedLogCalls(() => {
      finalized = finalizeGraphqlErrors(
        { errors: [{ message: "raw one" }, { message: "raw two" }] },
        { locale: "en", requestId: "mask-two-elements" }
      );
    });
    expect(finalized.errors).toHaveLength(2);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const bag: unknown = call[1];
      if (!isRecord(bag)) throw new Error("logger.error context bag missing");
      expect(bag.requestId).toBe("mask-two-elements");
    }
  });
});

// ─── Section 4 — protocol presets pass AS-IS untouched ──────────────────────

interface PresetRowSpec {
  readonly code: string;
  readonly message: string;
  readonly withEnvelopeHop: boolean;
}

const PRESET_ROWS: readonly PresetRowSpec[] = [
  { code: "GRAPHQL_PARSE_FAILED", message: "Syntax error near token.", withEnvelopeHop: false },
  { code: "GRAPHQL_VALIDATION_FAILED", message: 'Cannot query field "nonsense".', withEnvelopeHop: true },
  { code: "OPERATION_RESOLUTION_FAILURE", message: 'Unknown operation named "missing".', withEnvelopeHop: false },
  { code: "BAD_USER_INPUT", message: "Variable '$id' got invalid value.", withEnvelopeHop: true },
  { code: "PERSISTED_QUERY_NOT_FOUND", message: "PersistedQueryNotFound", withEnvelopeHop: false },
  { code: "PERSISTED_QUERY_NOT_SUPPORTED", message: "PersistedQueryNotSupported", withEnvelopeHop: false },
];

describe("error-contract matrix — protocol-preset passthrough pins", () => {
  for (const preset of PRESET_ROWS) {
    test(`${preset.code} crosses AS-IS (message+extra kept, DEV stacktrace stripped, requestId attached, silent)`, () => {
      const carrier: Record<string, unknown> = {
        message: preset.message,
        locations: [{ line: 1, column: 3 }],
        extensions: { code: preset.code, protocolExtra: "preset-authored", stacktrace: ["fake-dev-frame"] },
      };
      if (preset.withEnvelopeHop) {
        attachRawErrorHop(carrier, Object.assign(new Error(preset.message), { extensions: { code: preset.code } }));
      }

      let outcome!: FinalizeOutcome;
      const calls = captureMaskedLogCalls(() => {
        outcome = finalizeSingleElement(carrier, { locale: "en", requestId: "preset-corr" });
      });

      const item = firstWireItem(outcome.container);
      expect(item.message).toBe(preset.message); // untouched — never localized/masked
      const extensions = extensionsOf(item);
      expect(extensions.code).toBe(preset.code); // NOT rewritten to INTERNAL_SERVER_ERROR
      expect(extensions.protocolExtra).toBe("preset-authored");
      expect("stacktrace" in extensions).toBe(false);
      expect(extensions.requestId).toBe("preset-corr");
      expect(calls).toHaveLength(0); // protocol hops stay silent
    });
  }
});

// ─── Section 5 — legacy alias cross-checks ───────────────────────────────────

describe("error-contract matrix — legacy alias cross-checks", () => {
  test("alias stays a legal producer literal while derivation normalizes it (only statuses fold)", () => {
    const legacyCode = new RateLimitExceededError(tEn.rateLimitExceeded).code;
    expect(legacyCode).toBe("RATE_LIMIT_EXCEEDED");
    expect(isErrorCode(legacyCode)).toBe(true);
    expect(normalizeErrorCode(legacyCode)).toBe("RATE_LIMITED");
    expect(ERROR_CODE_HTTP_STATUS.RATE_LIMITED).toBe(429);
    expect(legacyCode).not.toBe(normalizeErrorCode(legacyCode));
    // Casing variants are data lookups — never coerced into aliases/categories.
    expect(isErrorCode("rate_limit_exceeded")).toBe(false);
    // A canonical sibling category derives independently for contrast.
    expect(normalizeErrorCode("DUPLICATE_REQUEST")).toBe("DUPLICATE_REQUEST");
    expect(ERROR_CODE_HTTP_STATUS.DUPLICATE_REQUEST).toBe(409);
  });

  test("alias-bearing producers classify as DOMAIN pass-through (never masked by Hop C)", () => {
    let outcome!: FinalizeOutcome;
    const calls = captureMaskedLogCalls(() => {
      outcome = finalizeSingleElement(
        buildCarrier(new RateLimitExceededError(tEn.rateLimitExceeded), "located", ["burst"]),
        { locale: "en", requestId: "alias-corr" }
      );
    });
    expectMutationError(outcome.container, "RATE_LIMIT_EXCEEDED");
    expect(extensionsOf(firstWireItem(outcome.container)).requestId).toBe("alias-corr");
    expect(calls).toHaveLength(0);
  });
});

// ─── Section 6 — plugin registration surface ─────────────────────────────────

describe("error-contract matrix — finalizer plugin registration surface", () => {
  test("factory exposes exactly the requestDidStart hook (the once-per-server registration artifact)", () => {
    const plugin = createGraphqlErrorsFinalizerPlugin();
    const keys = Object.keys(plugin);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("requestDidStart");
    expect(typeof plugin.requestDidStart).toBe("function");
  });
});

// ─── Section 7 — wire tier over live HTTP (boot-dependent) ───────────────────

setupTestServerLifecycle();

describe("error-contract matrix — wire tier over live HTTP", () => {
  test("_health answers with intact data and NO error channel (zero-op identity over full stack)", async () => {
    const result = await testClient.query({
      query: gql`
        query HealthProbe {
          _health {
            status
          }
        }
      `,
      fetchPolicy: "no-cache",
    });
    // `_health` is the `HealthCheck!` value object (DEV1-001 retype) — the
    // probe selects its `status` subfield; a bare `_health` leaf selection
    // now fails validation (see test/helpers/test-lifecycle.ts pollOnce).
    // Field-level assertion — Apollo's HttpLink adds `__typename` to the
    // object payload, and this tier pins DATA INTEGRITY, not cache shape.
    expect(result.error).toBeUndefined();
    const healthPayload = result.data as { _health?: { status?: string } } | undefined;
    expect(healthPayload?._health?.status).toBe("ok");
  });

  test("malformed GraphQL document over raw HTTP crosses as GRAPHQL_PARSE_FAILED preset (correlated)", async () => {
    // Raw fetch: an unparseable document cannot ride the client's gql parser.
    const response = await fetch(`http://localhost:${TEST_PORT}/api/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "wire-parse-failed" },
      body: JSON.stringify({ query: "{ _health }definitely-not-graphql" }),
    });
    const parsed: unknown = await response.json();
    if (!isRecord(parsed)) throw new Error("expected JSON body");
    const errors: unknown = parsed.errors;
    expect(Array.isArray(errors)).toBe(true);
    if (!Array.isArray(errors) || !isRecord(errors[0])) throw new Error("expected first wire error");
    const extensions: unknown = errors[0].extensions;
    if (!isRecord(extensions)) throw new Error("expected extensions");
    expect(extensions.code).toBe("GRAPHQL_PARSE_FAILED");
    expect(extensions.requestId).toBe("wire-parse-failed");
    expect("data" in parsed).toBe(false);
  });

  test("unknown-field validation failure crosses as GRAPHQL_VALIDATION_FAILED preset", async () => {
    const result = await testClient.query({
      query: gql`
        query UnknownFieldProbe {
          totallyUnknownRootField
        }
      `,
      fetchPolicy: "no-cache",
    });
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "GRAPHQL_VALIDATION_FAILED");
  });

  test("anonymous gated-field probe: schema-level me { id } yields UNAUTHORIZED (never FORBIDDEN)", async () => {
    const result = await testClient.query({
      query: gql`
        query AuthenticatedViewer {
          me {
            id
          }
        }
      `,
      fetchPolicy: "no-cache",
    });
    const combined = expectMutationError(result.error, "UNAUTHORIZED");
    expect(firstWireItem(combined).path).toEqual(["me"]);
  });
});
