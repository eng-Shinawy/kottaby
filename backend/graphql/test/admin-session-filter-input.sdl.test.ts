/**
 * Admin session filter input SDL suite — the `AdminSessionListFilterInput`
 * registration contract pinned over a fresh deterministic schema emission.
 *
 * What this locks down:
 *  - **Clean construction** — the production builder emits a schema without
 *    throwing while both session filter inputs are registered (a duplicate
 *    input/enum registration would throw "has already been declared" at
 *    import time).
 *  - **Input shape** — the admin directory filter input carries EXACTLY the
 *    six optional filter members with their exact GraphQL types:
 *    `teacherUserId`/`studentUserId` as `Int`, `type` as the `SessionType`
 *    enum, `status` as the `SessionStatus` enum, and `dateFrom`/`dateTo` as
 *    the shared `DateTime` scalar. Every member is nullable on the wire
 *    (optional — absent members drop out at the service, never error).
 *  - **Closed whitelist** — no pagination member (`page`/`pageSize` stay
 *    top-level Int arguments of the directory query, mirroring the
 *    participant lists) and no identity/actor field of any kind: the filter
 *    speaks about session rows, never about the caller.
 *  - **Participant input untouched** — `SessionListFilterInput` still
 *    exposes EXACTLY its single `status: SessionStatus` member (the admin
 *    surface is a distinct input object, never an extension of the
 *    participant one).
 *
 * The production query module that consumes the input has landed —
 * `backend/graphql/query/classes/admin-session-governance.query.ts` registers
 * `adminSessions(filter: AdminSessionListFilterInput!, page, pageSize)` and
 * consumes the Pothos input at wire level. The input module is still imported
 * HERE because this suite pins the input contract in ISOLATION: the builder is
 * a leaf module, so the production registration is not part of this suite's
 * module graph and the side-effect import remains load-bearing (verified —
 * removing it leaves the inputs unregistered and fails all six tests). The
 * assertions run against a fresh deterministic `toSchema()` emission, the
 * same tier the session SDL suite uses.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner:
 *   bun run test/scripts/run-test.ts backend/graphql/test/admin-session-filter-input.sdl.test.ts
 */

import { describe, expect, test } from "bun:test";
import { GraphQLInputObjectType, lexicographicSortSchema, printSchema } from "graphql";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
// Side-effect registrations the fresh emission depends on: the shared
// `DateTime` scalar lives in the definitions barrel (its registration is
// NOT bundled with the builder), and the filter-input module registers both
// input objects. Both imports are load-bearing — without them the isolated
// emission carries neither the scalar nor the two filter inputs.
import "@/backend/graphql/pothos/shared/scalar.pothos";
import "@/backend/graphql/pothos/classes/session-filter-input.pothos";

// ─── Fresh deterministic emission (includes both filter inputs) ──────────────

const filterInputInclusiveSchema = gqlSchemaBuilder.toSchema();
const sdl = printSchema(lexicographicSortSchema(filterInputInclusiveSchema));

/** Fails the suite unless the named type is a registered GraphQL input. */
function requireInput(name: string): GraphQLInputObjectType {
  const type = filterInputInclusiveSchema.getType(name);

  if (!(type instanceof GraphQLInputObjectType)) {
    throw new Error(`${name} must be registered as a GraphQL input type`);
  }

  return type;
}

describe("AdminSessionListFilterInput SDL contract", () => {
  test("registers exactly once under its SDL name (clean construction)", () => {
    expect(sdl.match(/input AdminSessionListFilterInput \{/g)).toHaveLength(1);
  });

  test("exposes EXACTLY the six filter fields in the closed whitelist", () => {
    const inputType = requireInput("AdminSessionListFilterInput");
    const fields = inputType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "dateFrom",
      "dateTo",
      "status",
      "studentUserId",
      "teacherUserId",
      "type",
    ]);
  });

  test("field types match the canonical vocabulary (enum + DateTime + Int)", () => {
    const fields = requireInput("AdminSessionListFilterInput").getFields();
    expect(fields.teacherUserId?.type.toString()).toBe("Int");
    expect(fields.studentUserId?.type.toString()).toBe("Int");
    expect(fields.type?.type.toString()).toBe("SessionType");
    expect(fields.status?.type.toString()).toBe("SessionStatus");
    expect(fields.dateFrom?.type.toString()).toBe("DateTime");
    expect(fields.dateTo?.type.toString()).toBe("DateTime");
  });

  test("every member is optional (nullable — absent members drop out, never error)", () => {
    const fields = requireInput("AdminSessionListFilterInput").getFields();
    for (const field of Object.values(fields)) {
      expect(field.type.toString()).not.toContain("!");
    }
  });

  test("SEC: no pagination and no identity surface on the filter whitelist", () => {
    const fields = requireInput("AdminSessionListFilterInput").getFields();
    // Pagination stays resolver-level (top-level Int args of the directory
    // query) — never a filter member.
    expect(Object.hasOwn(fields, "page")).toBe(false);
    expect(Object.hasOwn(fields, "pageSize")).toBe(false);
    expect(Object.hasOwn(fields, "limit")).toBe(false);
    expect(Object.hasOwn(fields, "offset")).toBe(false);
    // No caller-identity or actor surface of any kind — the filter is
    // addressed BY an admin, it never carries one.
    expect(Object.hasOwn(fields, "actorId")).toBe(false);
    expect(Object.hasOwn(fields, "id")).toBe(false);
    expect(Object.hasOwn(fields, "sessionId")).toBe(false);
    expect(Object.hasOwn(fields, "userId")).toBe(false);
  });
});

describe("SessionListFilterInput regression pin", () => {
  test("participant input remains EXACTLY the single status member (no admin extension)", () => {
    expect(sdl.match(/input SessionListFilterInput \{/g)).toHaveLength(1);
    const fields = requireInput("SessionListFilterInput").getFields();
    expect(Object.keys(fields)).toEqual(["status"]);
    expect(fields.status?.type.toString()).toBe("SessionStatus");
  });
});
