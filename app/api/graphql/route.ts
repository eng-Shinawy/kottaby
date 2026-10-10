/**
 * `/api/graphql` route handler — thin composition layer. The pipeline's
 * focused modules live beside this file (same route segment; colocated
 * non-route files are not routable and are excluded by Next.js):
 *
 *  - `./apollo-server` — ApolloServer construction (plugins, disclosure
 *    flags, error-format hop);
 *  - `./transport-rejection` — kind→wire mapping + guarded rejection
 *    envelope builder (emits `errorsTranslations.badRequest` for
 *    request-shape kinds, `errorsTranslations.forbidden` for cross-origin
 *    rejections);
 *  - `./rate-limit` — fail-open rate-limit wrapper (429 envelope emits
 *    `errorsTranslations.rateLimitExceeded`);
 *  - `./origin-guard` — same-origin CSRF gate for cookie-authenticated
 *    POSTs (`assertGraphqlPostOrigin`, wired FIRST in `POST`);
 *  - `./space-z-cors` — `*.space-z.ai` preview-panel CORS echo + preflight.
 *
 * Localized rejection emitters (post-split homes — keys unchanged):
 *  - transport rejections emit `errorsTranslations.badRequest` via `./transport-rejection`;
 *  - the 429 limiter branch emits `errorsTranslations.rateLimitExceeded` via `./rate-limit`;
 *  - the `POST` catch fallback below emits `errorsTranslations.internalServerError`.
 *
 * The transport-tier modules were extracted from a formerly oversized route
 * body; the origin gate is a later-added pre-engine tier.
 */

import type { ApolloServer } from "@apollo/server";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { NextRequest, NextResponse } from "next/server";
import { type ApolloEngineOptions, createApolloServer } from "@/app/api/graphql/apollo-server";
import { assertGraphqlPostOrigin } from "@/app/api/graphql/origin-guard";
import { withRateLimit } from "@/app/api/graphql/rate-limit";
import { spaceZCorsPreflightResponse } from "@/app/api/graphql/space-z-cors";
import { transportRejectionResponse } from "@/app/api/graphql/transport-rejection";
import { type Context, createGraphQLContext } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { ensureEnvironmentValidated, getEnvironmentConfig } from "@/backend/lib/env";
import { guardTransport } from "@/backend/lib/gateway";
import { logger } from "@/backend/lib/logger";
import { getServerTranslations } from "@/shared/locale/server-graphql";

ensureEnvironmentValidated();

const envConfig = getEnvironmentConfig();
const isProduction = envConfig.nodeEnv === "production";

/**
 * Env-derived Apollo engine options (single computation site).
 */
const apolloEngineOptions: ApolloEngineOptions = {
  // Introspection gate — explicit CODE-level constant: this value IS
  // `NODE_ENV !== "production"` (isProduction derives from the validated
  // env config's NODE_ENV above). Source-pin test-locked by the
  // health-probe suite — never an ambient default.
  introspection: !isProduction,
  isProduction,
};

/**
 * Per-request context map. The context factory builds a `Context` (with an
 * `authCookieOut` accumulator) for every request. Mutation resolvers (`login`,
 * `refreshToken`) push `Set-Cookie` header values into `ctx.authCookieOut`.
 *
 * The merge of those values onto the outgoing response does NOT live inside
 * `withRateLimit`: it runs in the POST handler UNCONDITIONALLY after
 * `finalizeGraphqlErrors` — error paths included (auth-cookie merge
 * atomicity). This map stays as the request-scoped hand-off channel between
 * the handler's context hook and that merge.
 *
 * `WeakMap` so the entry is GC'd once the request is dropped — no unbounded
 * memory growth across long-lived server processes.
 */
const requestContextMap = new WeakMap<NextRequest, Context>();

/**
 * Unconditional auth-cookie merge. Reads the per-request accumulator
 * populated by mutation resolvers and appends EVERY
 * entry via `headers.append("Set-Cookie", …)` — NEVER `headers.set` (a
 * multi-cookie matrix carries three independent Set-Cookie headers per
 * `docs/auth/jwt-authentication-service.md`). Runs after the engine has
 * finalized its result, on success AND on failure paths alike.
 *
 * A `null` engine-request (the request never reached the engine — transport
 * rejection / pre-engine throw) means no context was ever constructed and
 * the response passes through untouched.
 */
function flushAuthCookies(response: Response, engineRequest: NextRequest | null): Response {
  if (engineRequest === null) {
    return response;
  }
  const ctx = requestContextMap.get(engineRequest);
  if (!ctx || ctx.authCookieOut.length === 0) {
    return response;
  }
  for (const cookie of ctx.authCookieOut) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

/**
 * Handler factory binding an Apollo server to the Next.js route. Re-invoked
 * in development when HMR produces a new Pothos schema object so the engine
 * executes against the fresh SDL (see `getHandler` below).
 */
function createGraphqlHandler(apolloServer: ApolloServer<Context>) {
  return startServerAndCreateNextHandler<NextRequest, Context>(apolloServer, {
    context: async (req: NextRequest) => {
      const ctx = await createGraphQLContext(req);
      requestContextMap.set(req, ctx);
      return ctx;
    },
  });
}

let activeSchema = graphQLSchema;
let server = createApolloServer(activeSchema, apolloEngineOptions);
let handler = createGraphqlHandler(server);

function getHandler() {
  // After Turbopack HMR rebuilds the Pothos schema, swap Apollo onto the new
  // schema. Module scope never re-executes in production, so the swap is
  // dev-only by construction.
  if (!isProduction && graphQLSchema !== activeSchema) {
    activeSchema = graphQLSchema;
    server = createApolloServer(activeSchema, apolloEngineOptions);
    handler = createGraphqlHandler(server);
  }
  return handler;
}

/**
 * Health check handler — lightweight HEAD for connectivity checks.
 */
export function HEAD() {
  return new Response(null, { status: 204 });
}

/**
 * OPTIONS handler for CORS preflight requests from *.space-z.ai origins.
 * The header matrix itself lives in `./space-z-cors` (single vocabulary site).
 */
export async function OPTIONS(request: NextRequest) {
  return spaceZCorsPreflightResponse(request.headers.get("origin"));
}

/**
 * POST handler — the canonical GraphQL transport wired as the eight-step
 * pipeline:
 *
 *   1. `assertGraphqlPostOrigin(request)` — same-origin CSRF gate
 *      (`./origin-guard`): a cross-origin browser POST short-circuits with
 *      the 403 `CROSS_ORIGIN_REJECTED` envelope before any body work;
 *      identity-blind and pre-authorization (applies to authenticated and
 *      anonymous traffic alike);
 *   2. `guardTransport(request)` — method/content-type/size/parseability/
 *      batch-count guards result-mapped per `TRANSPORT_WIRE_MAP` (`./transport-rejection`);
 *      any `ok:false` short-circuits BELOW and the engine+context are never
 *      reached;
 *   3. correlation resolution happens inside the rejection builder on the
 *      failure branch and inside `createGraphQLContext` on the success branch
 *      — the SAME pure helper either way (single mint source);
 *   4. idempotency-key capture is realized IN the context factory
 *      (`ctx.idempotencyKey` — capture lives at exactly ONE site, not
 *      duplicated route-side);
 *   5. `ctx = await gqlContextFactory(request)` (handler context hook);
 *   6–7. engine invocation unchanged in ordering — validate → scopeAuth /
 *      authScopes → resolver run INSIDE Apollo execution;
 *   8a–b. `finalizeGraphqlErrors` finalizes inside Apollo's `willSendResponse`
 *      BEFORE the handler future resolves; THEN every `ctx.authCookieOut`
 *      entry merges via `headers.append` — unconditionally, error paths
 *      included;
 *   8c. JSON response returned (Apollo convention: domain errors stay HTTP
 *      200 with an `errors[]` payload).
 */
export async function POST(request: NextRequest) {
  let engineRequest: NextRequest | null = null;
  try {
    // Step 1 — same-origin CSRF gate BEFORE any body work (cheap header
    // check first: a cross-site forged POST never consumes rate-limiter
    // state and never reaches the transport tier).
    const origin = assertGraphqlPostOrigin(request);
    if (!origin.ok) {
      return transportRejectionResponse("CROSS_ORIGIN_REJECTED", request);
    }

    // Step 2 — transport guards (cheap constant work first: junk traffic
    // consumes zero rate-limiter state and never reaches the engine or the
    // context factory).
    const transport = await guardTransport(request);
    if (!transport.ok) {
      return transportRejectionResponse(transport.kind, request);
    }

    // Replayable re-buffer: `guardTransport` drained the original stream, and
    // both Apollo's handler and the step-8b WeakMap lookup need ONE stable
    // request object. The validated body is re-serialized deterministically
    // (parsed→stringified round-trip is value-identical for the engine).
    engineRequest = new NextRequest(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(transport.body),
      })
    );

    const response = await withRateLimit(engineRequest, getHandler());

    // Steps 8a–8c — finalize already ran inside Apollo; cookies append last,
    // unconditionally (this IS the success-shaped return of step 8c).
    return flushAuthCookies(response, engineRequest);
  } catch (error) {
    logger.error("Unhandled error in GraphQL POST handler", error);
    const errorsTranslations = getServerTranslations("en").errorsTranslations;
    const fallback = NextResponse.json(
      {
        errors: [
          {
            message: errorsTranslations.internalServerError,
            extensions: {
              code: "INTERNAL_SERVER_ERROR",
            },
          },
        ],
      },
      { status: 500 }
    );
    // Even a post-engine infrastructure fault must not swallow the
    // logout/login cookies the resolver already accumulated.
    return flushAuthCookies(fallback, engineRequest);
  }
}

/**
 * GET handler — DEFAULT-DENIED in every environment. The GraphQL endpoint
 * accepts `POST` only; queries-over-GET stay rejected because the
 * CSRF/cache-poisoning posture documented for this route leaves no GET
 * surface open. Mutation documents can therefore NEVER ride GET in any
 * configuration (hard invariant).
 *
 * A non-production interactive-tooling opt-in would require a registered
 * env-config key; until that key exists, denial is the only reachable branch
 * and this export still guarantees the explicit 405 ENVELOPE below instead of
 * Next.js' default-absent framework behavior.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return transportRejectionResponse("METHOD_NOT_ALLOWED", request);
}

/**
 * PUT/DELETE/PATCH handlers — explicitly exported so unsupported methods get
 * the SAME guarded 405 envelope (correlated, localized, `Allow: POST`) rather
 * than Next.js' default-absent behavior.
 */
export async function PUT(request: NextRequest): Promise<Response> {
  return transportRejectionResponse("METHOD_NOT_ALLOWED", request);
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return transportRejectionResponse("METHOD_NOT_ALLOWED", request);
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return transportRejectionResponse("METHOD_NOT_ALLOWED", request);
}
