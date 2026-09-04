/**
 * Generated-SDL static assertion suite — the notification GraphQL surface
 * pinned over the COMMITTED artifact (`frontend/graphql/generated/schema.graphql`),
 * NOT the in-memory builder output (schema-surface.test.ts owns the built-schema
 * tier plus the artifact↔builder byte-identity proof).
 *
 * Why an artifact-side tier: gateway Rule 8.5 requires schema/codegen artifacts
 * to be committed in the SAME change set as their registrations — this suite
 * fails when the committed SDL drifts from the sanctioned contract even while
 * the Pothos tree itself is momentarily consistent.
 *
 * What this locks down (REQ-032 / REQ-060 / REQ-061 / REQ-069):
 *  - **BFLA verdict (REQ-032)** — the generated SDL contains ZERO
 *    `createNotification` / `updateNotification` / `deleteNotification`
 *    operations: every field on every object AND input type is scanned by
 *    name, and the forbidden tokens must not appear anywhere in the artifact
 *    text. Notification emission is service-internal ONLY — the GraphQL
 *    write surface is exactly the read-latch pair.
 *  - **Root-set freeze** — the Mutation root is EXACTLY the re-pinned frozen
 *    set (auth quartet + the sanctioned notification read-latch pair + the
 *    sanctioned users-locale mutation + the plan-catalog CRUD trio + the
 *    admin user-management mutation trio + the admin cold-start
 *    certification mutation + the admin broadcast mutation + the
 *    parent-link trio) and the Query root is EXACTLY the re-pinned
 *    frozen set (the baseline + the `_health` probe + the inbox reads + the
 *    plan-catalog reads + the admin user-management directory reads + the
 *    `adminAuditLogs` trail read + the parent-link lists — mirrors the
 *    `PRE_3_1_*` inventories in schema-surface.test.ts). **The parent-link
 *    extension performed the documented reconcile-then-extend (REQ-061):**
 *    the stale arrays predated the DEV1-005 plan-catalog CRUD, the DEV1-013
 *    student-handshake queries, AND the shipped DEV3-016 admin surface —
 *    STEP ONE re-anchored them to the live artifact (+6 mutation fields, +8
 *    query fields); STEP TWO extended the now-current baselines with the
 *    parent-link surface (+3 mutation fields, +2 query fields). Growth is
 *    monotonic, nothing was deleted. **The parent-link↔DEV3-020 merge
 *    re-ran STEP ONE for the audit-trail surface**, and this merge absorbs
 *    the DEV3-004/005/012/013 session family + the DEV3-022d admin-broadcast
 *    surface additively the same way. **The DEV3-018 cold-start teacher
 *    certification merge adds `adminCertifyTeacherColdStart` to the mutation
 *    root additively the same way.**
 *  - **Parent-link surface (REQ-061 extend pins)** — the five root
 *    fields carry their EXACT SDL signatures on the artifact (both list
 *    queries NON-paginated `[T!]!` with ZERO arguments;
 *    `requestParentChildLink` the ONLY nullable new mutation — the
 *    null-collapse contract); the `LinkStatus` enum carries EXACTLY the four
 *    canonical members; both objects expose EXACTLY the six canonical
 *    fields with the `DateTime` scalar on ALL six timestamps (zero `String`
 *    leakage); and NO parent-link page/connection wrapper exists — the
 *    lists are plain arrays, the pagination contract is the service's 50-row
 *    cap, never SDL pagination plumbing.
 *  - **Users-locale surface (D2)** — `updateMyLocale(locale: AppLocale!): User!`
 *    is present with its EXACT SDL signature, `User.locale` is the nullable
 *    `AppLocale` enum, and the `AppLocale` enum carries exactly the two
 *    canonical values.
 *  - **REQ-060 four-ops contract** — `myNotifications`,
 *    `myUnreadNotificationCount`, `markNotificationRead`,
 *    `markAllNotificationsRead` are present with their EXACT SDL signatures
 *    (argument names/types + return types), and `MyNotificationsFilterInput`
 *    carries exactly the four nullable filter fields.
 *  - **Admin broadcast surface** — `adminBroadcastNotification(input:
 *    AdminBroadcastNotificationInput!): Int!` is present with its EXACT SDL
 *    signature, `BroadcastAudienceInput` carries exactly the four closed
 *    selector fields (discriminated `type` + three nullable companions), and
 *    `AdminBroadcastNotificationInput` carries exactly the three compose
 *    fields — zero identity surface of any kind.
 *  - **Apollo normalization** — the `Notification` object carries `id: ID!`
 *    among EXACTLY the eight inbox fields.
 *  - **Depth/complexity posture (REQ-069)** — `Notification` is FLAT: every
 *    field references a spec scalar or the `NotificationType` enum (zero
 *    object-typed or list-typed fields); no self-referential or recursive
 *    shape exists; the ONLY object-typed field in the notification family is
 *    the page wrapper's bounded `items: [Notification!]!` list (the 1..50
 *    page cap is enforced at the service boundary — the SDL carries the
 *    bounded window via the filter input, not an unbounded connection); and
 *    NO Subscription root exists — realtime delivery is the WebSocket
 *    sidecar's contract, never a GraphQL subscription.
 *
 * Pure static tier — the SDL text is parsed with `parse()` and walked as an
 * AST: NO schema build, NO DB, NO server boot, NO disk writes. Runs via the
 * mandated runner:
 *   bun run test/scripts/run-test.ts backend/graphql/test/sdl-static-assertions.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type EnumTypeDefinitionNode,
  type InputObjectTypeDefinitionNode,
  Kind,
  type ObjectTypeDefinitionNode,
  parse,
  type TypeNode,
} from "graphql";

// ─── Frozen baselines (mirror the refreshed PRE_3_1_* inventories in ─────────
// ─── schema-surface.test.ts — the single sanctioned growth history). RE-PINNED ─
// ─── against the regenerated SDL artifact; the DEV3-004/005/012/013 session ───
// ─── family, the DEV3-022d admin-broadcast surface and the audit-trail read ───
// ─── are absorbed additively — entries are NEVER dropped.                     ──
// ─── REQ-061 reconcile-then-extend: both steps recorded in the extend's     ─
// ─── outcome notes. RECONCILE (STEP 1 — never silent): the                   ─
// ─── arrays predated the DEV1-005 plan-catalog CRUD, the DEV1-013 handshake    ─
// ─── queries, and the shipped DEV3-016 admin surface — re-anchored to the     ─
// ─── live artifact. EXTEND (STEP 2): the parent-link surface folded in.     ─
// ─── Growth is monotonic; no stale entry was deleted, only re-anchored.      ─

/** Root mutation fields — auth quartet + notification read-latch pair + users-locale (D2) + plan-catalog CRUD + DEV3-016 admin writes + DEV3-018 admin cold-start certification + the admin broadcast mutation + the parent-link trio. */
const FROZEN_MUTATION_FIELDS = [
  // DEV3-016 reconcile: the admin user-management writes shipped before 3.1
  // (the DEV3-022d admin broadcast mutation absorbed alongside them).
  "adminBroadcastNotification",
  // DEV3-018: the admin cold-start teacher certification mutation ships on
  // this branch (absorbed additively, mirroring the DEV3-016 precedent).
  "adminCertifyTeacherColdStart",
  "adminCreateUser",
  "adminSetUserDeleted",
  "adminUpdateUser",
  // Parent-link extend: the three link-request mutations (`requestParentChildLink`
  // is the ONLY nullable one — pinned in the parent-link describe below).
  "cancelParentLinkRequest",
  "createPlan",
  "login",
  "logout",
  "markAllNotificationsRead",
  "markNotificationRead",
  "refreshToken",
  "registerUser",
  "requestParentChildLink",
  "respondToParentLinkRequest",
  "setPlanActiveStatus",
  "updateMyLocale",
  "updatePlan",
] as const;

/** Root query fields — the frozen baseline + the sanctioned inbox reads + the probe + plan-catalog + DEV1-013 handshake + DEV3-016 admin reads + the parent-link lists. */
const FROZEN_QUERY_FIELDS = [
  "_health",
  // Parent-link↔DEV3-020 merge reconcile: the global audit-trail read shipped on
  // main while this branch was in flight (mirrors the DEV3-016 precedent).
  "adminAuditLogs",
  // DEV1-005 reconcile: the plan-catalog reads shipped before 3.1.
  "adminPlans",
  // DEV3-016 reconcile: the admin user-management reads shipped before 3.1.
  "adminUserActivity",
  "adminUserDetail",
  "adminUsers",
  "adminUserStats",
  // DEV1-013 reconcile: the student-handshake queries shipped before 3.1.
  "findStudentByHandshakeCode",
  "me",
  "myApplicantProfile",
  "myHandshakeCode",
  // Parent-link extend: the two role-gated link-request lists (NON-paginated).
  "myIncomingParentLinkRequests",
  "myNotifications",
  "myOutgoingParentLinkRequests",
  "myUnreadNotificationCount",
  "planCatalog",
  "recitationReadings",
] as const;

/** REQ-032: emit is service-internal — these operations must NEVER exist. */
const FORBIDDEN_NOTIFICATION_CUD_FIELDS = ["createNotification", "deleteNotification", "updateNotification"] as const;

/** REQ-060: the exact eight-field inbox surface. */
const CANONICAL_NOTIFICATION_FIELDS = [
  "body",
  "createdAt",
  "id",
  "isRead",
  "relatedEntityId",
  "relatedEntityType",
  "title",
  "type",
] as const;

/** Leaf types a FLAT notification field may reference (spec scalars + the enum). */
const SDL_LEAF_TYPE_NAMES = new Set(["Boolean", "ID", "Int", "NotificationType", "String"]);

// ─── Artifact load + AST walk helpers (read-only; no schema build) ────────────

const SDL_PATH = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
const sdlText = readFileSync(SDL_PATH, "utf8");
const sdlDocument = parse(sdlText);

/** Renders a type node back to SDL notation (`ID!`, `[Notification!]!`, …). */
function renderType(node: TypeNode): string {
  switch (node.kind) {
    case Kind.NAMED_TYPE:
      return node.name.value;
    case Kind.LIST_TYPE:
      return `[${renderType(node.type)}]`;
    case Kind.NON_NULL_TYPE:
      return `${renderType(node.type)}!`;
    default:
      throw new Error("unexpected type node kind in the generated SDL");
  }
}

/** Unwraps `[…]`/`!` wrappers to the bare named type. */
function namedTypeName(node: TypeNode): string {
  return node.kind === Kind.NAMED_TYPE ? node.name.value : namedTypeName(node.type);
}

/** Field surface descriptor: name, rendered argument signatures, rendered + named type. */
interface FieldSurface {
  readonly name: string;
  readonly args: ReadonlyArray<{ readonly name: string; readonly type: string }>;
  readonly type: string;
  readonly namedType: string;
}

/** Locates one object type definition in the artifact (fail-fast when missing). */
function objectTypeDefinition(name: string): ObjectTypeDefinitionNode {
  const found = sdlDocument.definitions.find(
    (definition): definition is ObjectTypeDefinitionNode =>
      definition.kind === Kind.OBJECT_TYPE_DEFINITION && definition.name.value === name
  );
  if (!found) {
    throw new Error(`Generated SDL must define the \`${name}\` object type`);
  }
  return found;
}

/** Locates one input object type definition in the artifact (fail-fast when missing). */
function inputObjectTypeDefinition(name: string): InputObjectTypeDefinitionNode {
  const found = sdlDocument.definitions.find(
    (definition): definition is InputObjectTypeDefinitionNode =>
      definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION && definition.name.value === name
  );
  if (!found) {
    throw new Error(`Generated SDL must define the \`${name}\` input type`);
  }
  return found;
}

/** Field surfaces of one object type, in artifact definition order. */
function fieldSurfaces(typeName: string): FieldSurface[] {
  return (objectTypeDefinition(typeName).fields ?? []).map(field => ({
    name: field.name.value,
    args: (field.arguments ?? []).map(argument => ({
      name: argument.name.value,
      type: renderType(argument.type),
    })),
    type: renderType(field.type),
    namedType: namedTypeName(field.type),
  }));
}

/** Locates one field surface on one object type (fail-fast when missing). */
function fieldSurface(typeName: string, fieldName: string): FieldSurface {
  const found = fieldSurfaces(typeName).find(surface => surface.name === fieldName);
  if (!found) {
    throw new Error(`\`${typeName}\` must expose the \`${fieldName}\` field`);
  }
  return found;
}

/** Every field name defined on ANY object or input type in the artifact. */
function allFieldNames(): string[] {
  const names: string[] = [];
  for (const definition of sdlDocument.definitions) {
    if (definition.kind === Kind.OBJECT_TYPE_DEFINITION || definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
      for (const field of definition.fields ?? []) {
        names.push(field.name.value);
      }
    }
  }
  return names;
}

/** All object type names defined in the artifact (the node-typed reference set). */
function objectTypeNameSet(): Set<string> {
  return new Set(
    sdlDocument.definitions
      .filter((definition): definition is ObjectTypeDefinitionNode => definition.kind === Kind.OBJECT_TYPE_DEFINITION)
      .map(definition => definition.name.value)
  );
}

describe("BFLA structural verdict — zero notification CUD surface (REQ-032)", () => {
  test("ZERO createNotification/updateNotification/deleteNotification field definitions on ANY type", () => {
    const names = allFieldNames();
    for (const forbidden of FORBIDDEN_NOTIFICATION_CUD_FIELDS) {
      expect(names).not.toContain(forbidden);
    }
  });

  test("the CUD tokens appear NOWHERE in the artifact text (lexical belt-and-braces)", () => {
    for (const forbidden of FORBIDDEN_NOTIFICATION_CUD_FIELDS) {
      expect(sdlText).not.toContain(forbidden);
    }
  });

  test("Mutation root is EXACTLY the re-pinned frozen set — the notification write surface is the read-latch pair only", () => {
    const names = fieldSurfaces("Mutation").map(surface => surface.name);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([...FROZEN_MUTATION_FIELDS]);
  });

  test("Query root is EXACTLY the re-pinned frozen set (zero unsanctioned growth)", () => {
    const names = fieldSurfaces("Query").map(surface => surface.name);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([...FROZEN_QUERY_FIELDS]);
  });
});

describe("REQ-060 four-ops contract — exact SDL signatures on the artifact", () => {
  test("`myNotifications(filter: MyNotificationsFilterInput): NotificationListPage!`", () => {
    const surface = fieldSurface("Query", "myNotifications");
    expect(surface.type).toBe("NotificationListPage!");
    expect(surface.args).toEqual([{ name: "filter", type: "MyNotificationsFilterInput" }]);
  });

  test("`myUnreadNotificationCount: Int!` — zero arguments", () => {
    const surface = fieldSurface("Query", "myUnreadNotificationCount");
    expect(surface.type).toBe("Int!");
    expect(surface.args).toEqual([]);
  });

  test("`markNotificationRead(id: ID!): Notification!`", () => {
    const surface = fieldSurface("Mutation", "markNotificationRead");
    expect(surface.type).toBe("Notification!");
    expect(surface.args).toEqual([{ name: "id", type: "ID!" }]);
  });

  test("`markAllNotificationsRead(type: NotificationType): Int!`", () => {
    const surface = fieldSurface("Mutation", "markAllNotificationsRead");
    expect(surface.type).toBe("Int!");
    expect(surface.args).toEqual([{ name: "type", type: "NotificationType" }]);
  });

  test("`updateMyLocale(locale: AppLocale!): User!` — the D2 users-locale signature", () => {
    const surface = fieldSurface("Mutation", "updateMyLocale");
    expect(surface.type).toBe("User!");
    expect(surface.args).toEqual([{ name: "locale", type: "AppLocale!" }]);
  });

  test("MyNotificationsFilterInput carries EXACTLY the four REQ-060 filter fields, all nullable", () => {
    const fields = inputObjectTypeDefinition("MyNotificationsFilterInput").fields ?? [];
    expect(fields.map(field => field.name.value).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "isRead",
      "limit",
      "offset",
      "type",
    ]);
    const byName = new Map(fields.map(field => [field.name.value, renderType(field.type)]));
    expect(byName.get("type")).toBe("NotificationType");
    expect(byName.get("isRead")).toBe("Boolean");
    expect(byName.get("limit")).toBe("Int");
    expect(byName.get("offset")).toBe("Int");
  });
});

describe("Admin broadcast surface — exact SDL signatures on the artifact", () => {
  test("`adminBroadcastNotification(input: AdminBroadcastNotificationInput!): Int!`", () => {
    const surface = fieldSurface("Mutation", "adminBroadcastNotification");
    expect(surface.type).toBe("Int!");
    expect(surface.args).toEqual([{ name: "input", type: "AdminBroadcastNotificationInput!" }]);
  });

  test("`BroadcastAudienceInput` carries EXACTLY the four closed selector fields — zero identity surface", () => {
    const fields = inputObjectTypeDefinition("BroadcastAudienceInput").fields ?? [];
    expect(fields.map(field => field.name.value).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "country",
      "planId",
      "role",
      "type",
    ]);
    const byName = new Map(fields.map(field => [field.name.value, renderType(field.type)]));
    expect(byName.get("type")).toBe("BroadcastAudienceType!");
    expect(byName.get("role")).toBe("UserRole");
    expect(byName.get("country")).toBe("String");
    expect(byName.get("planId")).toBe("Int");
  });

  test("`AdminBroadcastNotificationInput` carries EXACTLY the three compose fields — zero identity surface", () => {
    const fields = inputObjectTypeDefinition("AdminBroadcastNotificationInput").fields ?? [];
    expect(fields.map(field => field.name.value).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "audience",
      "body",
      "title",
    ]);
    const byName = new Map(fields.map(field => [field.name.value, renderType(field.type)]));
    expect(byName.get("title")).toBe("String!");
    expect(byName.get("body")).toBe("String");
    expect(byName.get("audience")).toBe("BroadcastAudienceInput!");
  });
});

describe("Notification object — `id` + REQ-069 depth/complexity posture", () => {
  test("carries `id: ID!` among EXACTLY the eight REQ-060 inbox fields (Apollo normalization)", () => {
    const names = fieldSurfaces("Notification").map(surface => surface.name);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([...CANONICAL_NOTIFICATION_FIELDS]);
    expect(fieldSurface("Notification", "id").type).toBe("ID!");
  });

  test("is FLAT — every field references a spec scalar or the NotificationType enum (zero object/list-typed fields)", () => {
    for (const surface of fieldSurfaces("Notification")) {
      expect(SDL_LEAF_TYPE_NAMES.has(surface.namedType)).toBe(true);
    }
  });

  test("has NO self-referential or recursive shape — no field references Notification or NotificationListPage", () => {
    for (const surface of fieldSurfaces("Notification")) {
      expect(surface.namedType).not.toBe("Notification");
      expect(surface.namedType).not.toBe("NotificationListPage");
    }
  });

  test("the ONLY object-typed field in the notification family is the page wrapper's bounded `items` list", () => {
    const objectTypes = objectTypeNameSet();
    const family = [
      ...fieldSurfaces("Notification").map(surface => ({ owner: "Notification", surface })),
      ...fieldSurfaces("NotificationListPage").map(surface => ({ owner: "NotificationListPage", surface })),
    ];
    const objectTyped = family
      .filter(entry => objectTypes.has(entry.surface.namedType))
      .map(entry => `${entry.owner}.${entry.surface.name}: ${entry.surface.type}`);
    expect(objectTyped).toEqual(["NotificationListPage.items: [Notification!]!"]);
  });

  test("NotificationListPage exposes EXACTLY the bounded wrapper contract (items/totalCount/hasMore, no id)", () => {
    const surfaces = fieldSurfaces("NotificationListPage");
    expect(surfaces.map(surface => surface.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "hasMore",
      "items",
      "totalCount",
    ]);
    expect(fieldSurface("NotificationListPage", "items").type).toBe("[Notification!]!");
    expect(fieldSurface("NotificationListPage", "totalCount").type).toBe("Int!");
    expect(fieldSurface("NotificationListPage", "hasMore").type).toBe("Boolean!");
    // Embedded wrapper — the normalizable entities are the rows inside `items`.
    expect(surfaces.some(surface => surface.name === "id")).toBe(false);
  });

  test("NO Subscription root exists — realtime delivery is the WebSocket sidecar's contract, never a GraphQL subscription", () => {
    const hasSubscriptionRoot = sdlDocument.definitions.some(
      definition => definition.kind === Kind.OBJECT_TYPE_DEFINITION && definition.name.value === "Subscription"
    );
    expect(hasSubscriptionRoot).toBe(false);
    // Lexical belt-and-braces — WORD-BOUNDARY scoped: the artifact
    // legitimately carries the token as an INFIX inside field names
    // (`hasActiveSubscription`, `studentHasActiveSubscription`) and in
    // lowercase "subscription plan" description prose, so a raw substring
    // scan false-positives. The word-boundary scan still catches any real
    // `Subscription` type/root-field spelling (preceded/followed by
    // non-word characters in SDL).
    expect(sdlText).not.toMatch(/\bSubscription\b/);
  });
});

describe("Users-locale surface (D2) — AppLocale enum + User.locale on the artifact", () => {
  test("AppLocale enum carries EXACTLY the two canonical values (Ar, En)", () => {
    const appLocaleEnum = sdlDocument.definitions.find(
      (definition): definition is EnumTypeDefinitionNode =>
        definition.kind === Kind.ENUM_TYPE_DEFINITION && definition.name.value === "AppLocale"
    );
    if (!appLocaleEnum) {
      throw new Error("Generated SDL must define the `AppLocale` enum type");
    }
    const values = (appLocaleEnum.values ?? []).map(value => value.name.value).toSorted((a, b) => a.localeCompare(b));
    expect(values).toEqual(["Ar", "En"]);
  });

  test("`User.locale` is the NULLABLE AppLocale enum on the artifact", () => {
    const surface = fieldSurface("User", "locale");
    expect(surface.type).toBe("AppLocale");
    expect(surface.args).toEqual([]);
  });
});

describe("Parent-link surface (extend) — artifact-side pins (REQ-061)", () => {
  test("`myOutgoingParentLinkRequests: [OutgoingParentLinkRequest!]!` — NON-paginated, ZERO arguments", () => {
    const surface = fieldSurface("Query", "myOutgoingParentLinkRequests");
    expect(surface.type).toBe("[OutgoingParentLinkRequest!]!");
    expect(surface.args).toEqual([]);
  });

  test("`myIncomingParentLinkRequests: [IncomingParentLinkRequest!]!` — NON-paginated, ZERO arguments", () => {
    const surface = fieldSurface("Query", "myIncomingParentLinkRequests");
    expect(surface.type).toBe("[IncomingParentLinkRequest!]!");
    expect(surface.args).toEqual([]);
  });

  test("`requestParentChildLink(code: String!): OutgoingParentLinkRequest` — the ONLY nullable new mutation (null collapse)", () => {
    const surface = fieldSurface("Mutation", "requestParentChildLink");
    expect(surface.type).toBe("OutgoingParentLinkRequest");
    expect(surface.args).toEqual([{ name: "code", type: "String!" }]);

    // The only-nullable pin, across ALL THREE new mutations on the artifact:
    const newMutationSurfaces = ["cancelParentLinkRequest", "requestParentChildLink", "respondToParentLinkRequest"].map(
      name => fieldSurface("Mutation", name)
    );
    const nullableNames = newMutationSurfaces
      .filter(mutationSurface => !mutationSurface.type.endsWith("!"))
      .map(mutationSurface => mutationSurface.name);
    expect(nullableNames).toEqual(["requestParentChildLink"]);
  });

  test("`respondToParentLinkRequest(requestId: ID!, accept: Boolean!): IncomingParentLinkRequest!`", () => {
    const surface = fieldSurface("Mutation", "respondToParentLinkRequest");
    expect(surface.type).toBe("IncomingParentLinkRequest!");
    // The deterministic emission sorts arguments alphabetically.
    expect(surface.args).toEqual([
      { name: "accept", type: "Boolean!" },
      { name: "requestId", type: "ID!" },
    ]);
  });

  test("`cancelParentLinkRequest(requestId: ID!): OutgoingParentLinkRequest!`", () => {
    const surface = fieldSurface("Mutation", "cancelParentLinkRequest");
    expect(surface.type).toBe("OutgoingParentLinkRequest!");
    expect(surface.args).toEqual([{ name: "requestId", type: "ID!" }]);
  });

  test("LinkStatus enum carries EXACTLY the four canonical members on the artifact", () => {
    const linkStatusEnum = sdlDocument.definitions.find(
      (definition): definition is EnumTypeDefinitionNode =>
        definition.kind === Kind.ENUM_TYPE_DEFINITION && definition.name.value === "LinkStatus"
    );
    if (!linkStatusEnum) {
      throw new Error("Generated SDL must define the `LinkStatus` enum type");
    }
    const values = (linkStatusEnum.values ?? []).map(value => value.name.value).toSorted((a, b) => a.localeCompare(b));
    expect(values).toEqual(["Confirmed", "Expired", "Pending", "Rejected"]);
  });

  test("BOTH objects expose EXACTLY the six canonical fields — DateTime on ALL six timestamps, zero String leakage", () => {
    for (const [typeName, counterpartyField] of [
      ["OutgoingParentLinkRequest", "studentMaskedName"],
      ["IncomingParentLinkRequest", "parentFullName"],
    ] as const) {
      const surfaces = fieldSurfaces(typeName);
      expect(surfaces.map(surface => surface.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
        ["createdAt", "expiresAt", "id", counterpartyField, "respondedAt", "status"].toSorted((a, b) =>
          a.localeCompare(b)
        )
      );
      const byName = new Map(surfaces.map(surface => [surface.name, surface]));
      expect(byName.get("id")?.type).toBe("ID!");
      expect(byName.get("status")?.type).toBe("LinkStatus!");
      expect(byName.get(counterpartyField)?.type).toBe("String!");
      // NO String leakage — every timestamp rides the registered `DateTime`
      // scalar; `respondedAt` is the ONLY nullable field on either object.
      expect(byName.get("createdAt")?.type).toBe("DateTime!");
      expect(byName.get("expiresAt")?.type).toBe("DateTime!");
      expect(byName.get("respondedAt")?.type).toBe("DateTime");
    }
  });

  test("the parent-link family stays FLAT — the ONLY ParentLinkRequest-named SDL types are the two objects (no page/connection wrapper)", () => {
    const parentLinkTypeDeclarations =
      sdlText.match(/^(?:type|enum|input|scalar|interface|union) \w*ParentLinkRequest\w*/gm) ?? [];
    expect(
      parentLinkTypeDeclarations.map(declaration => declaration.split(" ")[1]).toSorted((a, b) => a.localeCompare(b))
    ).toEqual(["IncomingParentLinkRequest", "OutgoingParentLinkRequest"]);
    // Belt-and-braces: neither wrapper spelling exists anywhere in the artifact.
    expect(sdlText).not.toContain("ParentLinkRequestListPage");
    expect(sdlText).not.toContain("ParentLinkRequestConnection");
  });
});
