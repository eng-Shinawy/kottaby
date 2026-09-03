/**
 * HealthCheck + HandshakeCodeLookup Apollo cache-policy suite.
 * Embedded-type normalization opt-out (`keyFields: false`) for the
 * scalar-only `_health` probe object and the masked parent-discovery lookup
 * payload (`HandshakeCodeLookup` — `maskedName` + `linkable` only, no `id`
 * by design).
 *
 * WHAT THIS LOCKS
 *   1. CONFIG EXPOSURE (the task-def gate): an `InMemoryCache` built by
 *      `createApolloCache()` exposes `config.typePolicies.HealthCheck
 *      .keyFields === false` AND `config.typePolicies.HandshakeCodeLookup
 *      .keyFields === false` — the embedded-value declarations that keep any
 *      future consumer of `_health` / `findStudentByHandshakeCode` from ever
 *      triggering Apollo's "Cache data may be lost" heuristic. Behavioral
 *      halves below additionally pin the written-back value as an INLINE
 *      child of its parent (never a standalone `HealthCheck:*` /
 *      `HandshakeCodeLookup:*` entity) with loss-free rewrites.
 *   2. SIBLING REGRESSION PIN — the pre-existing embedded entries
 *      (`AdminNoteInfo`, `OnlineMeetingInfo`) keep their `keyFields: false`
 *      posture and the `AdminDashboardScheduleResult.rows` replace-not-merge
 *      precedent stays exactly as authored (the seven-entry policy surface is
 *      FROZEN; a new embedded type must extend, never shrink, this list per
 *      frontend/graphql/AGENTS.md embedded-type policy).
 *
 * NARROWING DISCIPLINE
 *   Policies internals are reached through guarded `Reflect.get` walks that
 *   THROW descriptive errors instead of casting (`sonarjs/
 *   no-unsafe-type-assertion` clean by construction) — the same
 *   guard-and-throw pattern used by `error-link.map.test.ts`.
 *
 * gql IMPORT NOTE
 *   Documents are parsed with `parse()` from the `graphql` package directly —
 *   importing `gql` from `@apollo/client` pulls `graphql-tag`'s UMD bundle,
 *   which dies under Bun's loader (known pre-existing breakage recorded in
 *   C2-phase3b for auth.test.ts).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts frontend/providers/apollo/apolloCache.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { InMemoryCache } from "@apollo/client";
import { parse } from "graphql";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";

// ---------------------------------------------------------------------------
// Guarded reflection helpers (assertion-free narrowing)
//
// WHY `config`, not `policies.typePolicies`: Apollo normalizes lazily — the
// user-supplied policy map lives on `cache.config.typePolicies` at construction
// time (`policies.typePolicies` only fills per-type as reads/writes touch each
// type). `config` is `protected` in the @apollo/client typings and the runtime
// map replaces `keyFields:false` during normalization, so the RAW config map
// is BOTH the authoritative registration site AND the only one whose shape
// mirrors the source. `Reflect.get` keeps us cast-free across the protected
// boundary.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Verifies one value is a record BEFORE any member access happens on it. */
function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`cache internals shape broken at ${path}`);
  }
  return value;
}

/**
 * Reads record slot `path.key` off a verified parent record — every hop is
 * type-checked before descent, so no property access assumes internal Apollo
 * shapes and NO cast is needed anywhere in this suite.
 */
function slot(parent: unknown, path: string, key: string): Record<string, unknown> {
  const holder = requireRecord(parent, path);
  if (!Object.hasOwn(holder, key)) {
    throw new Error(`cache internals missing ${path}.${key}`);
  }
  return requireRecord(Reflect.get(holder, key), `${path}.${key}`);
}

/** Walks cache → config → typePolicies without a single unsafe cast.
 *  Values stay `unknown` — every consumer narrows through {@link slot}/
 *  `{@link requireRecord}` before touching members. */
function typePoliciesOf(cache: InMemoryCache): Record<string, unknown> {
  const config = slot(cache, "InMemoryCache", "config");
  return slot(config, "config", "typePolicies");
}

/** Reads `keyFields` off one named policy, failing loudly when unregistered. */
function keyFieldsOf(policies: Record<string, unknown>, typeName: string): unknown {
  if (!Object.hasOwn(policies, typeName)) {
    throw new Error(`no typePolicy registered for ${typeName}`);
  }
  return Reflect.get(requireRecord(policies[typeName], `typePolicies.${typeName}`), "keyFields");
}

// ---------------------------------------------------------------------------
// Fixture: a document whose result embeds a HealthCheck-shaped value under a
// synthetic parent field (client-side cache only — no server schema needed).

const GATEWAY_PROBE_DOCUMENT = parse(`
  query GatewayProbeStatus {
    gatewayProbe {
      __typename
      status
      service
      version
      timestamp
    }
  }
`);

const FIRST_PROBE_VALUE = () => ({
  __typename: "HealthCheck",
  status: "ok",
  service: "kottaby",
  version: "0.1.0",
  timestamp: "2026-08-27T00:00:00.000Z",
});

const SECOND_PROBE_VALUE = () => ({
  __typename: "HealthCheck",
  status: "ok",
  service: "kottaby",
  version: "0.2.0",
  timestamp: "2026-08-27T00:01:00.000Z",
});

// ---------------------------------------------------------------------------
// Fixture: the handshake discovery document shape (client-side cache only —
// no server schema needed; mirrors the shared document's selection set).

const HANDSHAKE_LOOKUP_DOCUMENT = parse(`
  query HandshakeLookupProbe($code: String!) {
    findStudentByHandshakeCode(code: $code) {
      __typename
      maskedName
      linkable
    }
  }
`);

const FIRST_LOOKUP_VALUE = () => ({
  __typename: "HandshakeCodeLookup",
  maskedName: "A***",
  linkable: true,
});

const SECOND_LOOKUP_VALUE = () => ({
  __typename: "HandshakeCodeLookup",
  maskedName: "B***",
  linkable: false,
});

// ===========================================================================
describe("createApolloCache — initialised InMemoryCache config exposure", () => {
  test("returns a genuine initialised InMemoryCache instance", () => {
    const cache: InMemoryCache = createApolloCache();
    expect(cache).toBeInstanceOf(InMemoryCache);
  });

  test("typePolicies.HealthCheck.keyFields === false", () => {
    const cache = createApolloCache();
    const policies = typePoliciesOf(cache);
    expect(keyFieldsOf(policies, "HealthCheck")).toBe(false);
  });

  test("typePolicies.HandshakeCodeLookup.keyFields === false", () => {
    const cache = createApolloCache();
    const policies = typePoliciesOf(cache);
    expect(keyFieldsOf(policies, "HandshakeCodeLookup")).toBe(false);
  });

  test("typePolicies.AdminAuditLogPage.keyFields === false", () => {
    const cache = createApolloCache();
    const policies = typePoliciesOf(cache);
    expect(keyFieldsOf(policies, "AdminAuditLogPage")).toBe(false);
  });

  test("policy surface is FROZEN to the seven documented entries", () => {
    const cache = createApolloCache();
    expect(Object.keys(typePoliciesOf(cache)).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "AdminAuditLogPage",
      "AdminDashboardScheduleResult",
      "AdminNoteInfo",
      "HandshakeCodeLookup",
      "HealthCheck",
      "NotificationListPage",
      "OnlineMeetingInfo",
    ]);
  });
});

describe("sibling regression pins — pre-existing policies untouched", () => {
  test("`AdminNoteInfo` / `OnlineMeetingInfo` keep keyFields:false", () => {
    const policies = typePoliciesOf(createApolloCache());
    expect(keyFieldsOf(policies, "AdminNoteInfo")).toBe(false);
    expect(keyFieldsOf(policies, "OnlineMeetingInfo")).toBe(false);
  });

  test("`AdminDashboardScheduleResult.rows` keeps merge:false (replace semantics)", () => {
    const cache = createApolloCache();
    const policies = typePoliciesOf(cache);
    if (!Object.hasOwn(policies, "AdminDashboardScheduleResult")) {
      throw new Error("AdminDashboardScheduleResult policy vanished");
    }
    const resultPolicy = policies.AdminDashboardScheduleResult;
    const rows = slot(slot(resultPolicy, "AdminDashboardScheduleResult", "fields"), "fields", "rows");
    expect(Reflect.get(rows, "merge")).toBe(false);
  });
});

describe("behavioral proof — HealthCheck writes stay embedded (no standalone entity)", () => {
  test("written payloads normalize INLINE: extract contains no `HealthCheck:` entity id", () => {
    const cache = createApolloCache();
    expect(() =>
      cache.writeQuery({
        query: GATEWAY_PROBE_DOCUMENT,
        data: { gatewayProbe: FIRST_PROBE_VALUE() },
      })
    ).not.toThrow();

    const extracted = JSON.stringify(cache.extract());
    expect(extracted).toContain('"status":"ok"');
    // A normalized entry would appear as a top-level `HealthCheck:<key>` id —
    // keyFields:false forbids exactly that.
    expect(extracted.includes('"HealthCheck:')).toBe(false);
  });

  test("second write REPLACES the inline value cleanly (loss-safe rewrite)", () => {
    const cache = createApolloCache();
    cache.writeQuery({ query: GATEWAY_PROBE_DOCUMENT, data: { gatewayProbe: FIRST_PROBE_VALUE() } });
    expect(() =>
      cache.writeQuery({
        query: GATEWAY_PROBE_DOCUMENT,
        data: { gatewayProbe: SECOND_PROBE_VALUE() },
      })
    ).not.toThrow();

    const reread: unknown = cache.readQuery({ query: GATEWAY_PROBE_DOCUMENT });
    if (!isRecord(reread) || !Object.hasOwn(reread, "gatewayProbe")) {
      throw new Error("embedded probe value unreadable after rewrite");
    }
    const probe = requireRecord(Reflect.get(reread, "gatewayProbe"), "reread.gatewayProbe");
    expect(Reflect.get(probe, "version")).toBe("0.2.0");
    expect(Reflect.get(probe, "timestamp")).toBe("2026-08-27T00:01:00.000Z");

    const extracted = JSON.stringify(cache.extract());
    expect(extracted.includes('"version":"0.1.0"')).toBe(false);
    expect(extracted.includes('"HealthCheck:')).toBe(false);
  });
});

describe("behavioral proof — HandshakeCodeLookup writes stay embedded (no standalone entity)", () => {
  test("lookup payloads normalize INLINE: extract contains no `HandshakeCodeLookup:` entity id", () => {
    const cache = createApolloCache();
    expect(() =>
      cache.writeQuery({
        query: HANDSHAKE_LOOKUP_DOCUMENT,
        variables: { code: "KSB-ABCD1234" },
        data: { findStudentByHandshakeCode: FIRST_LOOKUP_VALUE() },
      })
    ).not.toThrow();

    const extracted = JSON.stringify(cache.extract());
    expect(extracted).toContain('"maskedName":"A***"');
    // A normalized entry would appear as a top-level `HandshakeCodeLookup:<key>`
    // id — keyFields:false forbids exactly that, so NO identity-derived cache
    // key can ever exist for the masked discovery payload.
    expect(extracted.includes('"HandshakeCodeLookup:')).toBe(false);
  });

  test("second search REPLACES the inline value cleanly under the SAME field (loss-safe rewrite)", () => {
    const cache = createApolloCache();
    cache.writeQuery({
      query: HANDSHAKE_LOOKUP_DOCUMENT,
      variables: { code: "KSB-ABCD1234" },
      data: { findStudentByHandshakeCode: FIRST_LOOKUP_VALUE() },
    });
    // Same code, different payload (e.g. linkable flipped server-side between
    // searches) — the full-field selection set keeps the rewrite loss-free.
    expect(() =>
      cache.writeQuery({
        query: HANDSHAKE_LOOKUP_DOCUMENT,
        variables: { code: "KSB-ABCD1234" },
        data: { findStudentByHandshakeCode: SECOND_LOOKUP_VALUE() },
      })
    ).not.toThrow();

    const reread: unknown = cache.readQuery({
      query: HANDSHAKE_LOOKUP_DOCUMENT,
      variables: { code: "KSB-ABCD1234" },
    });
    if (!isRecord(reread) || !Object.hasOwn(reread, "findStudentByHandshakeCode")) {
      throw new Error("embedded lookup value unreadable after rewrite");
    }
    const lookup = requireRecord(
      Reflect.get(reread, "findStudentByHandshakeCode"),
      "reread.findStudentByHandshakeCode"
    );
    expect(Reflect.get(lookup, "maskedName")).toBe("B***");
    expect(Reflect.get(lookup, "linkable")).toBe(false);

    const extracted = JSON.stringify(cache.extract());
    expect(extracted.includes('"maskedName":"A***"')).toBe(false);
    expect(extracted.includes('"HandshakeCodeLookup:')).toBe(false);
  });
});
