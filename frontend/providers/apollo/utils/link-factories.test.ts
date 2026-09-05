/**
 * Structural lock over `createAuthLink`'s outgoing-header writers.
 *
 * The auth link owns THREE fixed writers (`apollo-require-preflight`,
 * `x-apollo-operation-name`, and the conditional `authorization` bearer
 * header) and, since the broadcast compose work, ADDITIVELY merges the
 * caller-supplied `operation.getContext().headers` into the outgoing map —
 * the transport seam the `/admin/broadcasts` compose page uses to ride its
 * compose-session key as the `x-idempotency-key` header. This suite pins
 * the exact merge contract:
 *
 *   1. ABSENT context headers ⇒ byte-identical behavior — the outgoing map
 *      is exactly the pre-merge fixed-writer output (same keys, same
 *      values, same insertion order), token or no token.
 *   2. PRESENT context headers ⇒ merged — caller-supplied keys ride along
 *      next to every fixed writer.
 *   3. FIXED KEYS ARE FINAL — a context header that names a link-owned key
 *      (`apollo-require-preflight`, `x-apollo-operation-name`,
 *      `authorization`) never clobbers the writer's value: the gateway's
 *      preflight/operation-name contract and the session token are
 *      non-negotiable, so the fixed writers are applied AFTER the spread.
 *
 * The link is executed through the PUBLIC `ApolloLink.execute` machinery
 * with a capturing terminal link — the captured `Operation`'s context is
 * exactly what the terminal HTTP link reads, so the assertions see the
 * true outgoing header map. Documents are parsed with `parse()` from the
 * `graphql` package directly (the `gql` UMD-loader caveat — see
 * `apolloCache.test.ts`). No unsafe assertions anywhere.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/providers/apollo/utils/link-factories.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { parse } from "graphql";
import { createAuthLink } from "@/frontend/providers/apollo/utils/link-factories";

// ---------------------------------------------------------------------------
// Execution seam: run the link, capture the outgoing operation

const OPERATION_DOCUMENT = parse("mutation PingMutation { __typename }");

const FIXED_PREFLIGHT = "apollo-require-preflight";
const FIXED_OPERATION_NAME = "x-apollo-operation-name";

/** Execute the auth link with one token/context configuration and return the
 * outgoing headers the terminal HTTP link would read. */
async function outgoingHeadersFor(config: {
  readonly token: string | null;
  readonly contextHeaders?: Record<string, string>;
}): Promise<Record<string, string>> {
  const captured: ApolloLink.Operation[] = [];
  const capturingTerminal = new ApolloLink(operation => {
    captured.push(operation);
    return new Observable<ApolloLink.Result>(observer => observer.complete());
  });

  const client = new ApolloClient({ link: ApolloLink.empty(), cache: new InMemoryCache() });
  const chain = ApolloLink.from([createAuthLink(() => config.token), capturingTerminal]);
  const requestContext: Record<string, unknown> = config.contextHeaders ? { headers: config.contextHeaders } : {};

  const result = ApolloLink.execute(chain, { query: OPERATION_DOCUMENT, context: requestContext }, { client });
  await new Promise<void>((resolve, reject) => {
    result.subscribe({
      next: () => undefined,
      error: reject,
      complete: () => resolve(),
    });
  });

  expect(captured).toHaveLength(1);
  if (captured.length < 1) {
    throw new Error("expected the terminal link to capture exactly one forwarded operation");
  }
  return captured[0].getContext().headers;
}

// ---------------------------------------------------------------------------
// Merge contract

describe("createAuthLink — additive context-header merge", () => {
  test("absent context headers ⇒ byte-identical two-writer output (no token)", async () => {
    const headers = await outgoingHeadersFor({ token: null });
    expect(headers).toEqual({
      "apollo-require-preflight": "true",
      "x-apollo-operation-name": "PingMutation",
    });
    expect(Object.keys(headers)).toEqual([FIXED_PREFLIGHT, FIXED_OPERATION_NAME]);
  });

  test("absent context headers ⇒ byte-identical three-writer output (with token)", async () => {
    const headers = await outgoingHeadersFor({ token: "session-token-123" });
    expect(headers).toEqual({
      "apollo-require-preflight": "true",
      "x-apollo-operation-name": "PingMutation",
      authorization: "Bearer session-token-123",
    });
    expect(Object.keys(headers)).toEqual([FIXED_PREFLIGHT, FIXED_OPERATION_NAME, "authorization"]);
  });

  test("context headers present ⇒ merged additively next to the fixed writers", async () => {
    const headers = await outgoingHeadersFor({
      token: null,
      contextHeaders: {
        "x-idempotency-key": "compose-session-key",
        "x-trace": "trace-42",
      },
    });
    expect(headers).toEqual({
      "apollo-require-preflight": "true",
      "x-apollo-operation-name": "PingMutation",
      "x-idempotency-key": "compose-session-key",
      "x-trace": "trace-42",
    });
  });

  test("fixed keys are final — context headers never clobber the link-owned writers", async () => {
    const headers = await outgoingHeadersFor({
      token: "session-token-123",
      contextHeaders: {
        "apollo-require-preflight": "false",
        "x-apollo-operation-name": "SpoofedOperation",
        authorization: "Bearer impostor",
      },
    });
    expect(headers).toEqual({
      "apollo-require-preflight": "true",
      "x-apollo-operation-name": "PingMutation",
      authorization: "Bearer session-token-123",
    });
  });
});
