/**
 * Handshake-code shared documents — document-shape + cache round-trip suite
 * (documents tier, NO server / DB / network).
 *
 * Companion to the wire-tier `handshake-code.test.ts` in this directory (which
 * pins the GraphQL boundary against the dev server): this file locks the
 * SHARED DOCUMENTS themselves — the exact operation surface the parent-side
 * discovery and the self-read expose to every Apollo consumer.
 *
 * WHAT THIS LOCKS (the shared handshake-code read documents — self-read +
 * parent-side discovery)
 *   1. SHAPE — both documents are single named query operations with exactly
 *      the sanctioned surface: `MyHandshakeCode` (scalar-only root field, ZERO
 *      variables, no object selection at all) and `FindStudentByHandshakeCode`
 *      (exactly one variable `$code: String!`, selecting EXACTLY `maskedName`
 *      + `linkable`). NEITHER document selects `id` anywhere — verified both
 *      on the parsed AST (deep selection walk) and on the printed source body
 *      (`loc.source.body`): `HandshakeCodeLookup` is an embedded value type
 *      whose payload must carry no identity surface whatsoever.
 *   2. BARREL PARITY — the top-level `@/frontend/graphql/sharedDocuments`
 *      barrel and the deep import resolve to the IDENTICAL document instances
 *      (consumer import conventions; Apollo document-keyed cache/dedup safety).
 *   3. TYPING — the exported constants keep their codegen `TypedDocumentNode`
 *      typing (compile-time proof by assignment, `documents.contract.test.ts`
 *      precedent).
 *   4. ROUND-TRIP — the REAL documents execute through a real Apollo pipeline
 *      (`ApolloClient` + `MockLink` + the production `createApolloCache()`)
 *      and emit ZERO "Cache data may be lost" (invariant 118) diagnostics —
 *      including a cache-hit re-read of a previously written lookup. The
 *      `HandshakeCodeLookup: { keyFields: false }` typePolicy registration
 *      itself is locked in `frontend/providers/apollo/apolloCache.test.ts`
 *      (NOT re-asserted here — no duplicate coverage).
 *   5. DEV-MODE CANARY (LAST in this file, order-sensitive) — a control write
 *      that WOULD lose data through an UNPOLICIED cache DOES emit the warning,
 *      proving the warning machinery is live in this process so the zero
 *      assertions in (4) can never pass vacuously.
 *
 * gql IMPORT NOTE — unlike `apolloCache.test.ts`, this suite imports the
 * shared documents module directly (so the REAL documents are the ones under
 * test). That module builds them with `gql` from `@apollo/client`; the
 * `bunfig.toml` `[test]` preload chain (`graphql-interop.ts` before any test
 * file) seeds `require.cache` so graphql-tag resolves under Bun. The
 * `apollo-dev-flag` preload is likewise global (it evaluates before this file
 * — and thus before any `@apollo/client` import below — regardless of in-file
 * import order); `apolloDevModePreloaded` is value-imported in-file (bare
 * side-effect imports are lint-forbidden) to keep the dev-mode dependency
 * explicit, and the canary at the bottom of this file fails loudly if the
 * flag ever stops capturing.
 *
 * Pure unit tier — runs via the mandated runner:
 * `bun run test/scripts/run-test.ts frontend/graphql/test/students/handshake-code.documents.test.ts`.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { ApolloClient, InMemoryCache, type TypedDocumentNode } from "@apollo/client";
import { MockLink } from "@apollo/client/testing";
import {
  type DocumentNode,
  type FieldNode,
  type OperationDefinitionNode,
  parse,
  type VariableDefinitionNode,
} from "graphql";
import type {
  FindStudentByHandshakeCodeQuery,
  FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode,
  FindStudentByHandshakeCodeQueryVariables,
  MyHandshakeCodeQuery,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  findStudentByHandshakeCodeQueryDocument as findStudentByHandshakeCodeViaBarrel,
  myHandshakeCodeQueryDocument as myHandshakeCodeViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  findStudentByHandshakeCodeQueryDocument,
  myHandshakeCodeQueryDocument,
} from "@/frontend/graphql/sharedDocuments/students/handshake-code.documents";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import { apolloDevModePreloaded } from "@/test/preload/apollo-dev-flag";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers (guard-and-throw narrowing, same style as
// `documents.contract.test.ts` — `sonarjs/no-unsafe-type-assertion` clean).

function singleOperationOrThrow(document: DocumentNode): OperationDefinitionNode {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition"
  );
  expect(operations).toHaveLength(1);
  if (operations.length < 1) {
    throw new Error("expected exactly one OperationDefinition");
  }
  return operations[0];
}

function fieldSelections(parent: OperationDefinitionNode | FieldNode): FieldNode[] {
  // graphql-js types `selectionSet` as optional; an absent one simply yields
  // zero field selections (scalar leaves like `myHandshakeCode`).
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

function selectionFieldNames(parent: OperationDefinitionNode | FieldNode): string[] {
  return fieldSelections(parent).map(field => field.name.value);
}

function namedFieldOrThrow(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode {
  const field = fieldSelections(parent).find(candidate => candidate.name.value === name);
  if (field === undefined) {
    throw new Error(`expected selection field ${name} to exist`);
  }
  return field;
}

/** Every field name in the whole operation, at any selection depth. */
function deepFieldNames(parent: OperationDefinitionNode | FieldNode): string[] {
  const nested = fieldSelections(parent).flatMap(field => deepFieldNames(field));
  return [...selectionFieldNames(parent), ...nested];
}

/** Renders one declared variable's type as GraphQL source notation (e.g. `String!`). */
function variableTypeOrThrow(definition: VariableDefinitionNode): string {
  const type = definition.type;
  if (type.kind === "NonNullType") {
    const inner = type.type;
    if (inner.kind !== "NamedType") {
      throw new Error(`unexpected non-null wrapping of ${inner.kind}`);
    }
    return `${inner.name.value}!`;
  }
  if (type.kind === "NamedType") {
    return type.name.value;
  }
  throw new Error(`unexpected list-typed variable (${type.kind})`);
}

/** The printed source body of a document — fails loudly when the loc is gone. */
function requireSourceBody(document: DocumentNode): string {
  const loc = document.loc;
  if (loc === undefined) {
    throw new Error("document has no source location (printed body unavailable)");
  }
  return loc.source.body;
}

/** Unwraps a query result's data — fails loudly instead of asserting non-undefined. */
function requireQueryData<TData>(result: { readonly data: TData | undefined }, label: string): TData {
  if (result.data === undefined) {
    throw new Error(`${label} returned no data`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Warning-signature helper — Apollo's "Cache data may be lost" diagnostic.

/**
 * Detects Apollo invariant 118 (the cache-data-loss warning) in one captured
 * `console.warn`/`console.error` argument list. Apollo 4 renders numeric
 * invariant codes either as the friendly "Cache data may be lost…" text or as
 * a URL-encoded payload (`…go.apollo.dev/c/err#%7B…%22message%22:118…`),
 * depending on which invariant bundle loaded — both signatures are matched.
 */
function isCacheDataLossWarning(args: readonly unknown[]): boolean {
  return args.some(arg => {
    const text = String(arg);
    if (text.includes("Cache data may be lost")) {
      return true;
    }
    try {
      return decodeURIComponent(text).includes('"message":118');
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Round-trip fixtures (test data only — masked names and codes are technical
// fixtures, not rendered UI copy).

const FIRST_CODE = "KSB-ABCD1234";
const SECOND_CODE = "KSB-WXYZ9876";
const MY_CODE_FIXTURE = "KSB-PROBE0001";

/** Wire payload type: the codegen operation type plus the physical __typename. */
type WireLookupPayload = FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode & {
  readonly __typename: "HandshakeCodeLookup";
};

const FIRST_LOOKUP_PAYLOAD: WireLookupPayload = {
  __typename: "HandshakeCodeLookup",
  maskedName: "A***",
  linkable: true,
};

const SECOND_LOOKUP_PAYLOAD: WireLookupPayload = {
  __typename: "HandshakeCodeLookup",
  maskedName: "B***",
  linkable: false,
};

// Console spies — installed per test, restored together in afterEach. (The
// bunfig logger-mock preload has already no-op'd console.*; spyOn wraps
// whatever is installed, and Apollo resolves `console.warn` dynamically at
// call time, so the capture works regardless.)

const activeSpies: { mockRestore(): void }[] = [];

afterEach(() => {
  for (const spy of activeSpies.splice(0)) {
    spy.mockRestore();
  }
});

// ===========================================================================
describe("handshake-code documents — operation shape (zero identity surface)", () => {
  test("MyHandshakeCode: single named query, ZERO variables, scalar-only root field", () => {
    const operation = singleOperationOrThrow(myHandshakeCodeQueryDocument);
    expect(operation.name?.value).toBe("MyHandshakeCode");
    expect(operation.operation).toBe("query");
    expect(operation.variableDefinitions ?? []).toHaveLength(0);

    const rootFields = fieldSelections(operation);
    expect(rootFields.map(field => field.name.value)).toEqual(["myHandshakeCode"]);
    // Scalar-only payload (`String!`): no sub-selection ⇒ nothing for the
    // Apollo cache to normalize ⇒ the shared-documents `id` rule cannot apply.
    expect(rootFields[0]?.selectionSet).toBeUndefined();

    // Printed-source evidence: the self-read body selects nothing but the
    // scalar — no object selection, no `id` token anywhere.
    const body = requireSourceBody(myHandshakeCodeQueryDocument);
    expect(body).toContain("myHandshakeCode");
    expect(body).not.toMatch(/\bid\b/);
  });

  test("FindStudentByHandshakeCode: exactly $code: String! and EXACTLY the two public fields", () => {
    const operation = singleOperationOrThrow(findStudentByHandshakeCodeQueryDocument);
    expect(operation.name?.value).toBe("FindStudentByHandshakeCode");
    expect(operation.operation).toBe("query");

    const variables = operation.variableDefinitions ?? [];
    expect(variables.map(definition => definition.variable.name.value)).toEqual(["code"]);
    // The only client-controllable input is a non-null String.
    expect(variables.map(definition => variableTypeOrThrow(definition))).toEqual(["String!"]);

    const lookup = namedFieldOrThrow(operation, "findStudentByHandshakeCode");
    // Read-side hygiene: exactly the two public fields — nothing else is
    // requested (no extra-field leak beyond the sanctioned surface).
    expect(selectionFieldNames(lookup).toSorted((a, b) => a.localeCompare(b))).toEqual(["linkable", "maskedName"]);

    // Printed-source evidence: no `id` token anywhere in the discovery body.
    const body = requireSourceBody(findStudentByHandshakeCodeQueryDocument);
    expect(body).toContain("maskedName");
    expect(body).toContain("linkable");
    expect(body).not.toMatch(/\bid\b/);
  });

  test("NEITHER document selects `id` at any selection depth (embedded-value exception)", () => {
    const myCodeOperation = singleOperationOrThrow(myHandshakeCodeQueryDocument);
    const findOperation = singleOperationOrThrow(findStudentByHandshakeCodeQueryDocument);
    expect(deepFieldNames(myCodeOperation).includes("id")).toBe(false);
    expect(deepFieldNames(findOperation).includes("id")).toBe(false);
  });

  test("documents remain TypedDocumentNode-typed against the generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if either exported
    // constant loses its codegen typing or picks up an inline type literal.
    const typedMyCode: TypedDocumentNode<MyHandshakeCodeQuery> = myHandshakeCodeQueryDocument;
    const typedFind: TypedDocumentNode<FindStudentByHandshakeCodeQuery, FindStudentByHandshakeCodeQueryVariables> =
      findStudentByHandshakeCodeQueryDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedMyCode.loc).toBeDefined();
    expect(typedFind.loc).toBeDefined();
  });
});

// ===========================================================================
describe("consumer import conventions — barrel ≡ deep import identity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    // An accidental re-declaration in the barrel (a second `gql` call instead
    // of a re-export) would mint a second DocumentNode: equal text, different
    // identity — which would fragment Apollo's document-keyed caches and
    // request-dedup sets, and break the barrel-deep-import equivalence the
    // sharedDocuments convention promises (see its AGENTS.md §Consumer import
    // conventions).
    expect(myHandshakeCodeViaBarrel).toBe(myHandshakeCodeQueryDocument);
    expect(findStudentByHandshakeCodeViaBarrel).toBe(findStudentByHandshakeCodeQueryDocument);
  });
});

// ===========================================================================
describe("Apollo round-trip — real documents through the production cache", () => {
  test("the dev-mode flag captured (precondition: the zero assertions below are live)", () => {
    // The bunfig preload sets globalThis.__DEV__ before the first
    // @apollo/client import; this in-file value import re-asserts it so a
    // preload-chain regression cannot silently make this suite vacuous.
    expect(apolloDevModePreloaded).toBe(true);
  });

  test("lookup discovery round-trip emits ZERO cache-data-loss warnings (incl. cache-hit re-read)", async () => {
    const warnSpy = spyOn(console, "warn");
    const errorSpy = spyOn(console, "error");
    activeSpies.push(warnSpy, errorSpy);

    // Real documents + production cache + MockLink: the full Apollo pipeline
    // minus the network. Both mocks are registered up-front; the cache-hit
    // re-read below must be served WITHOUT contacting the link again (both
    // mocks are consumed by then, so a network fallback would fail loudly).
    const client = new ApolloClient({
      link: new MockLink([
        {
          request: { query: findStudentByHandshakeCodeQueryDocument, variables: { code: FIRST_CODE } },
          result: { data: { findStudentByHandshakeCode: FIRST_LOOKUP_PAYLOAD } },
        },
        {
          request: { query: findStudentByHandshakeCodeQueryDocument, variables: { code: SECOND_CODE } },
          result: { data: { findStudentByHandshakeCode: SECOND_LOOKUP_PAYLOAD } },
        },
      ]),
      cache: createApolloCache(),
    });

    // First search: writes the masked lookup payload inline under its parent
    // query field (keyFields:false — no identity-derived cache key).
    const first = await client.query({
      query: findStudentByHandshakeCodeQueryDocument,
      variables: { code: FIRST_CODE },
    });
    const firstData = requireQueryData(first, "first search");
    expect(firstData.findStudentByHandshakeCode?.maskedName).toBe("A***");
    expect(firstData.findStudentByHandshakeCode?.linkable).toBe(true);

    // Second, different search: a second inline lookup write into the SAME
    // cache under different variables — the replace-without-warning path.
    const second = await client.query({
      query: findStudentByHandshakeCodeQueryDocument,
      variables: { code: SECOND_CODE },
    });
    const secondData = requireQueryData(second, "second search");
    expect(secondData.findStudentByHandshakeCode?.maskedName).toBe("B***");
    expect(secondData.findStudentByHandshakeCode?.linkable).toBe(false);

    // Cache-hit re-read of the FIRST search (default cache-first policy: no
    // link pass, both mocks already consumed).
    const reread = await client.query({
      query: findStudentByHandshakeCodeQueryDocument,
      variables: { code: FIRST_CODE },
    });
    const rereadData = requireQueryData(reread, "cache-hit re-read");
    expect(rereadData.findStudentByHandshakeCode?.maskedName).toBe("A***");

    // Zero console.warn calls of ANY kind during the full round-trip…
    expect(warnSpy.mock.calls).toHaveLength(0);
    // …and no cache-data-loss diagnostics on the error channel either.
    expect(errorSpy.mock.calls.filter(call => isCacheDataLossWarning(call))).toHaveLength(0);
  });

  test("scalar self-read round-trip (MyHandshakeCode) stays warning-free", async () => {
    const warnSpy = spyOn(console, "warn");
    const errorSpy = spyOn(console, "error");
    activeSpies.push(warnSpy, errorSpy);

    const client = new ApolloClient({
      link: new MockLink([
        {
          request: { query: myHandshakeCodeQueryDocument },
          result: { data: { myHandshakeCode: MY_CODE_FIXTURE } },
        },
      ]),
      cache: createApolloCache(),
    });

    const result = await client.query({ query: myHandshakeCodeQueryDocument });
    expect(requireQueryData(result, "self-read").myHandshakeCode).toBe(MY_CODE_FIXTURE);

    expect(warnSpy.mock.calls).toHaveLength(0);
    expect(errorSpy.mock.calls.filter(call => isCacheDataLossWarning(call))).toHaveLength(0);
  });
});

// ===========================================================================
// DEV-MODE CANARY — MUST stay LAST in this file.
//
// Apollo dedups the data-loss warning per `Parent.field` in a module-level
// set: if this control ran first, it would silence a genuine warning for the
// same field in the round-trip above. Running it last keeps the round-trip's
// zero assertion non-vacuous while still proving the machinery is live.
describe("dev-mode canary — the zero-warning assertions above are not vacuous", () => {
  // Client-side probe documents only (no server schema involved): the full
  // selection mirrors the shared document; the partial one deliberately drops
  // `linkable` so the second write replaces the stored inline object with a
  // payload missing a previously stored key.
  const LOSSY_FULL_DOCUMENT = parse(`
    query HandshakeLookupProbe($code: String!) {
      findStudentByHandshakeCode(code: $code) {
        __typename
        maskedName
        linkable
      }
    }
  `);
  const LOSSY_PARTIAL_DOCUMENT = parse(`
    query HandshakeLookupProbePartial($code: String!) {
      findStudentByHandshakeCode(code: $code) {
        __typename
        maskedName
      }
    }
  `);

  test("a WOULD-lose-data write through an UNPOLICIED cache DOES emit the warning", () => {
    const warnSpy = spyOn(console, "warn");
    activeSpies.push(warnSpy);

    const cache = new InMemoryCache(); // deliberately NO typePolicies
    cache.writeQuery({
      query: LOSSY_FULL_DOCUMENT,
      variables: { code: FIRST_CODE },
      data: { findStudentByHandshakeCode: { __typename: "HandshakeCodeLookup", maskedName: "A***", linkable: true } },
    });
    cache.writeQuery({
      query: LOSSY_PARTIAL_DOCUMENT,
      variables: { code: FIRST_CODE },
      data: { findStudentByHandshakeCode: { __typename: "HandshakeCodeLookup", maskedName: "B***" } },
    });

    // If this ever fails, Apollo's dev mode (or the console spy) is inert in
    // this process — the round-trip zero assertions would be vacuously green.
    // See test/preload/apollo-dev-flag.ts for the flag-capture semantics.
    expect(warnSpy.mock.calls.some(call => isCacheDataLossWarning(call))).toBe(true);
  });
});
