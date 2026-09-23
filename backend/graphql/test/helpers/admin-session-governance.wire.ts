/**
 * Shared wire-tier helpers for the admin session-governance suites (the
 * query directory/detail suite and the mutation suite) — the byte-identical
 * helper set both suites previously declared inline, hoisted so the two
 * harnesses stay in lockstep.
 *
 * HARNESS ADAPTATION (single-process full pipeline) — the canonical
 * live-wire harness spawns the Next.js dev server in a SECOND OS process,
 * which is structurally impossible under the sandbox's sanctioned
 * `DB_PROVIDER=pglite` provider (single-connection WASM Postgres — each
 * process opening the data dir gets its OWN instance and the second opener
 * aborts; see `test/helpers/skip-when-pglite.ts`). The adaptation executes
 * THE PRODUCTION ROUTE PIPELINE IN-PROCESS: `POST` from
 * `@/app/api/graphql/route` driven by synthesized `NextRequest` objects —
 * transport guards → rate-limit wrapper (fail-open stub) → Apollo engine
 * (validate → scope-auth/authScopes → resolver) with the REAL
 * `createGraphQLContext` (Bearer-token verification + requestId) → the
 * governance services → PostgreSQL → `finalizeGraphqlErrors`. The only
 * absent stage is the HTTP socket itself. See the suite headers for the
 * full contract each suite locks down over this pipeline.
 */

import { expect } from "bun:test";
import { CombinedGraphQLErrors } from "@apollo/client";
import { and, eq, sql } from "drizzle-orm";
import { type DocumentNode, print } from "graphql";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/graphql/route";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { expectMutationError, TEST_PORT } from "@/test/helpers";

// ─── Narrowing helpers (runtime-guarded — zero casts) ────────────────────────

/** Runtime record guard — the suites' narrowing vocabulary stays cast-free. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

/** Extracts the root-field payload object of a happy-path result. */
export function payloadOf(result: { readonly data?: unknown }, rootField: string): Record<string, unknown> {
  if (!isRecord(result.data)) {
    throw new Error(`missing data for ${rootField} (error: ${String(result.data)})`);
  }
  const payload: unknown = result.data[rootField];
  if (!isRecord(payload)) {
    throw new Error(`missing ${rootField} payload in response data`);
  }
  return payload;
}

/** First finalized error item off a denial result, code-asserted. */
export function firstWireItem(error: unknown, expectedCode: string): Record<string, unknown> {
  const container = expectMutationError(error, expectedCode);
  const candidate: unknown = container.errors[0];
  return recordOf(candidate, "expected record-shaped finalized error item");
}

/** The byte-identical fingerprint of one finalized denial item. */
export interface DenialFingerprint {
  readonly message: string;
  readonly code: string;
  readonly extensionKeys: readonly string[];
}

export function fingerprintOf(item: Record<string, unknown>): DenialFingerprint {
  const message = item.message;
  if (typeof message !== "string") {
    throw new Error("expected a string error message");
  }
  const extensions = recordOf(item.extensions, "expected record-shaped extensions");
  const code = extensions.code;
  if (typeof code !== "string") {
    throw new Error("expected a string error code");
  }
  return {
    message,
    code,
    extensionKeys: Object.keys(extensions).toSorted((a, b) => a.localeCompare(b)),
  };
}

/**
 * Asserts one denial is byte-identical to the reference fingerprint (same
 * localized message, same extensions.code, same extension key set) and
 * rode the given root field. The per-request `extensions.requestId`
 * VALUE is deliberately not compared — it is per-request correlation
 * metadata, never part of the error contract; its PRESENCE is covered by
 * the key-set equality.
 */
export function expectDenialIdenticalToReference(
  error: unknown,
  expectedCode: string,
  reference: DenialFingerprint,
  rootField: string
): void {
  const item = firstWireItem(error, expectedCode);
  expect(fingerprintOf(item)).toEqual(reference);
  expect(item.path).toEqual([rootField]);
}

// ─── Wire helpers (single-process full pipeline — see module header) ─────────

/** One finalized pipeline result, shaped like an Apollo result. */
interface WireResult {
  readonly data?: unknown;
  readonly error?: CombinedGraphQLErrors;
}

/** Narrows one finalized error item onto the wire's formatted shape. */
function toFormattedErrorItem(item: unknown): { message: string } & Record<string, unknown> {
  const record = recordOf(item, "finalized GraphQL error item must be an object");
  const message = record.message;
  if (typeof message !== "string") {
    throw new Error("finalized GraphQL error item must carry a string message");
  }
  return { ...record, message };
}

/**
 * Drives the production `/api/graphql` POST pipeline in-process: builds the
 * `NextRequest` exactly as the HTTP layer would (JSON body, optional
 * `Authorization: Bearer` and `X-Idempotency-Key` headers), invokes the real
 * route handler, and shapes the finalized body like an Apollo result (`data`
 * + a `CombinedGraphQLErrors` container when the envelope carries errors) so
 * the canonical `expectMutationError` helper applies unchanged.
 */
export async function wireGraphQL(
  document: DocumentNode,
  options: {
    readonly token?: string | null;
    readonly idempotencyKey?: string | null;
    readonly variables?: Record<string, unknown>;
  } = {}
): Promise<WireResult> {
  const request = new NextRequest(
    new Request(`http://localhost:${TEST_PORT}/api/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.idempotencyKey ? { "x-idempotency-key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify({ query: print(document), variables: options.variables ?? {} }),
    })
  );
  const response = await POST(request);
  const body = recordOf(await response.json(), "GraphQL response must be a JSON object");
  const rawErrors: unknown = body.errors;
  const formatted = Array.isArray(rawErrors) ? rawErrors.map(toFormattedErrorItem) : [];
  return {
    data: body.data,
    ...(formatted.length > 0 ? { error: new CombinedGraphQLErrors({ errors: formatted }) } : {}),
  };
}

/** Counts `audit_logs` rows for one session entity. */
export async function countAuditForSession(sessionId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "session"), eq(auditLogs.entityId, sessionId)));
  return result[0]?.count ?? 0;
}
