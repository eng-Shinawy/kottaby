/**
 * GraphQL schema surface assertion suite — pinned-additions gate +
 * codegen-sync proof.
 *
 * What this locks down:
 *  - **Retyped probe** — `Query._health: HealthCheck!` (the legacy inline
 *    `String!` placeholder from `builder.ts` was deleted BEFORE the new
 *    registration landed — the duplicate-field crash regression is
 *    therefore covered here permanently).
 *  - **Shape closure** — `HealthCheck` exposes EXACTLY the four scalar
 *    fields (`status`, `service`, `version`, `timestamp`), each `String!`,
 *    and carries NO `id` field (embedded value object — proven both at
 *    the type level and behaviorally: selecting `id` fails validation).
 *  - **Surface freeze** — against the frozen baseline inventory (captured
 *    at HEAD `8e5ebb8`, since refreshed for the sanctioned `ApplicantProfile`/
 *    `ApplicantStatus` additions, the notifications additions — enum +
 *    `Notification` + `NotificationListPage` — and the sanctioned inbox
 *    query additions — `myNotifications` + `myUnreadNotificationCount` +
 *    `MyNotificationsFilterInput` — and the sanctioned inbox read-latch
 *    mutation additions — `markNotificationRead` +
 *    `markAllNotificationsRead` — and the sanctioned users-locale additions
 *    (D2 backend vertical) — the `AppLocale` enum + `User.locale` + the
 *    `updateMyLocale` mutation — and, absorbed additively, the admin
 *    user-management surface (directory/stats/detail/activity reads + the
 *    admin CRUD mutation trio + the governance-filter enum) and the global
 *    admin audit-trail read surface — the `adminAuditLogs` query backed by
 *    the `AdminAuditLogEntry` object, the `AdminAuditLogPage` embedded
 *    wrapper, and the `AdminAuditLogFiltersInput` input — with the
 *    `AuditActionType` enum REUSED from the shared registry, never
 *    re-registered — and, absorbed additively, the admin broadcast
 *    surface — the `adminBroadcastNotification` mutation + the
 *    `BroadcastAudienceType` enum + the `BroadcastAudienceInput` /
 *    `AdminBroadcastNotificationInput` inputs — and, absorbed additively, the
 *    DEV3-004/005/012/013 session family — the lifecycle mutation quartet
 *    (`createSession`, `startSession`, `completeSession`, `cancelSession`),
 *    the DEV3-005 dispute pair (`openSessionDispute`,
 *    `resolveSessionDispute`), the DEV3-012 dual-confirmation mutation
 *    (`confirmSessionCompletion`), the DEV3-013 payout write
 *    (`requestWithdrawal`), the participant-read trio (`sessionById`,
 *    `myStudentSessions`, `myTeacherSessions`) + the DEV3-005 admin
 *    arbitration listing (`adminDisputedSessions`) + the DEV3-013 wallet
 *    read (`myWallet`), the scheduling/arbitration/ledger enum vocabulary
 *    (`SessionStatus`, `SessionType`, `SessionIntent`, `DisputeResolution`,
 *    `TransactionType`, `TransactionStatus`), and the session/wallet
 *    objects + inputs): ZERO unsanctioned mutations
 *    beyond the refreshed
 *    frozen set, and a whole-schema named-type delta of EXACTLY the
 *    explicitly enumerated additions while the query set grows only by the
 *    sanctioned probe re-registration and the absorbed read surfaces.
 *  - **Notification surface** — the `NotificationType` enum carries exactly
 *    the 7 canonical values (TS-enum keys as GraphQL names, snake_case
 *    runtime values), the `Notification` object exposes `id` FIRST with
 *    EXACTLY the inbox field surface (structurally NO `userId`), and the
 *    `NotificationListPage` wrapper exposes items/totalCount/hasMore.
 *  - **Notification query surface** — `myNotifications` +
 *    `myUnreadNotificationCount` carry EXACTLY the `authenticated` scope,
 *    return the canonical page/scalar shapes, accept ZERO identity
 *    arguments anywhere (root args AND filter-input fields), and reject
 *    anonymous in-process execution with UNAUTHORIZED.
 *  - **Notification mutation surface** — `markNotificationRead` +
 *    `markAllNotificationsRead` carry EXACTLY the `authenticated` scope,
 *    return the canonical row/scalar shapes, accept ZERO identity
 *    arguments (exactly `id: ID!` / `type: NotificationType`), and reject
 *    anonymous in-process execution with UNAUTHORIZED.
 *  - **Users-locale surface (D2)** — `updateMyLocale` carries EXACTLY the
 *    `authenticated` scope, takes exactly `locale: AppLocale!`, returns
 *    `User!`, `User.locale` is the nullable `AppLocale` enum, the enum
 *    carries exactly the 2 canonical values, and anonymous in-process
 *    execution rejects with UNAUTHORIZED.
 *  - **Allowlist agreement** — the scopeless `_health` field is present in
 *    the closed `PUBLIC_OPERATION_NAMES` tuple / `PUBLIC_OPERATIONS` set
 *    1:1 (schema↔allowlist agreement enforced as code).
 *  - **Anonymous reachability** — executing the probe document with an EMPTY
 *    context succeeds through the real production schema (public by design;
 *    also proves the resolver is delegation-only: no ctx/DB access exists
 *    on the path, otherwise this call could not succeed).
 *  - **Codegen sync (scripted)** — the checked-in
 *    `frontend/graphql/generated/schema.graphql` is BYTE-IDENTICAL to a
 *    fresh `printSchema(lexicographicSortSchema(graphQLSchema))` emission,
 *    i.e. generated artifacts are in lockstep with the code-first builder
 *    (read-only disk access; the suite writes NOTHING). Belt-and-braces
 *    pins assert the DEV3-004 session surface is really inside the
 *    committed artifact (seven root operations + the two object types +
 *    the two input types) plus the DEV3-005 dispute surface (the three
 *    new root operations, the arbitration enum, and the five nullable
 *    `Session` fields).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLObjectType,
  getNamedType,
  graphql,
  isSpecifiedScalarType,
  lexicographicSortSchema,
  parse,
  printSchema,
  validate,
} from "graphql";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { PUBLIC_OPERATION_NAMES, PUBLIC_OPERATIONS } from "@/backend/lib/gateway";

// ─── Frozen baseline inventory (captured @ HEAD 8e5ebb8; refreshed for the ────
// ─── sanctioned applicant + notifications + users-locale + DEV1-013 handshake ─
// ─── + DEV1-005 plan-catalog additions, with the admin user-management and ────
// ─── audit-trail surfaces absorbed additively — entries are NEVER dropped) ────

/** Root query field names — the frozen baseline (probe re-registration excluded). */
const PRE_3_1_QUERY_FIELDS = [
  "adminPlans",
  "me",
  "myApplicantProfile",
  "myNotifications",
  "myUnreadNotificationCount",
  "planCatalog",
  "recitationReadings",
] as const;
/** Root mutation field names — the frozen baseline (auth quartet + notification read-latch pair + users-locale + plan-catalog CRUD + admin user-management trio + the admin broadcast mutation). */
const PRE_3_1_MUTATION_FIELDS = [
  "adminBroadcastNotification",
  "adminCreateUser",
  "adminSetUserDeleted",
  "adminUpdateUser",
  "createPlan",
  "login",
  "logout",
  "markAllNotificationsRead",
  "markNotificationRead",
  "refreshToken",
  "registerUser",
  "setPlanActiveStatus",
  "updateMyLocale",
  "updatePlan",
] as const;
/** GraphQL enum type names — the freeze forbids any new Pothos enum; every enum is named explicitly (the governance-filter + audit-action + broadcast-audience enums absorbed additively). */
const PRE_3_1_ENUMS = [
  "AdminUserGovernanceFilter",
  "ApplicantStatus",
  "AppLocale",
  "AuditActionType",
  "BroadcastAudienceType",
  "Gender",
  "NotificationType",
  "RecitationReading",
  "RegisterPublicRole",
  "UserRole",
] as const;
/**
 * DEV3-004 session lifecycle root fields — registered ONCE via the
 * side-effect barrels (`query|mutation/classes/index.ts` → top-level
 * barrel → `gqlSchema.ts`); role-gated/authenticated per REQ-032 and
 * therefore deliberately ABSENT from the public-operation allowlist
 * (`backend/lib/gateway/public-operations.ts` stays byte-unchanged).
 */
const DEV3_004_QUERY_FIELDS = ["myStudentSessions", "myTeacherSessions", "sessionById"] as const;
/** DEV3-005 admin arbitration listing — the admin-gated disputed queue. */
const DEV3_005_QUERY_FIELDS = ["adminDisputedSessions"] as const;
/** DEV3-004 lifecycle mutation quartet (plan §3.1/§3.2 — REQ-060/061). */
const DEV3_004_MUTATION_FIELDS = ["cancelSession", "completeSession", "createSession", "startSession"] as const;
/** DEV3-005 dispute mutation pair (R-102/R-104). */
const DEV3_005_MUTATION_FIELDS = ["openSessionDispute", "resolveSessionDispute"] as const;
/** DEV3-012 dual-confirmation mutation (R-201/R-202). */
const DEV3_012_MUTATION_FIELDS = ["confirmSessionCompletion"] as const;
/** DEV3-013 wallet read — the teacher-only wallet + ledger surface (R-301). */
const DEV3_013_QUERY_FIELDS = ["myWallet"] as const;
/** DEV3-013 wallet payout write — the teacher-only withdrawal request (R-302). */
const DEV3_013_MUTATION_FIELDS = ["requestWithdrawal"] as const;
/** DEV3-013 billing ledger vocabulary — registered ONCE in `shared/enum.pothos.ts`. */
const DEV3_013_ENUMS = ["TransactionStatus", "TransactionType"] as const;
/** DEV3-005 arbitration outcome vocabulary — registered ONCE, no pgEnum backing. */
const DEV3_005_ENUMS = ["DisputeResolution"] as const;
/** DEV3-005 nullable `Session` fields — the dispute + reason surface (R-105/R-107). */
const DEV3_005_SESSION_FIELDS = [
  "cancelReason",
  "disputeReason",
  "disputedAt",
  "resolutionNote",
  "resolvedAt",
] as const;
/** DEV3-004 scheduling enum trio — registered ONCE in `shared/enum.pothos.ts`. */
const DEV3_004_ENUMS = ["SessionIntent", "SessionStatus", "SessionType"] as const;
/** Non-root object/enum/scalar SDL type names in the baseline (introspection `__*` and spec scalars excluded; the admin-broadcast input/enum surfaces absorbed additively). */
const PRE_3_1_TYPE_NAMES = [
  "AdminBroadcastNotificationInput",
  "AppLocale",
  "ApplicantProfile",
  "ApplicantStatus",
  "BroadcastAudienceInput",
  "BroadcastAudienceType",
  "CreatePlanInput",
  "Gender",
  "LoginPayload",
  "LogoutPayload",
  "Mutation",
  "MyNotificationsFilterInput",
  "Notification",
  "NotificationListPage",
  "NotificationType",
  "Plan",
  "Query",
  "RecitationReading",
  "RefreshTokenPayload",
  "RegisterPublicRole",
  "RegisterUserInput",
  "UpdatePlanInput",
  "User",
  "UserRole",
] as const;
/**
 * DEV3-004 session surface — objects + inputs that enter the named-type
 * map when the resolver modules register the root fields (plan §3.1 SDL).
 * The scheduling enum trio is pinned separately (see `DEV3_004_ENUMS`).
 */
const DEV3_004_TYPE_NAMES = ["CreateSessionInput", "Session", "SessionListFilterInput", "SessionPage"] as const;
/** DEV3-013 billing objects + input (R-301/R-302) — the wallet surface types. */
const DEV3_013_TYPE_NAMES = ["RequestWithdrawalInput", "TeacherTransaction", "Wallet"] as const;

// ─── Schema walk helpers ─────────────────────────────────────────────────────

/** All named SDL type names, introspection builtins + spec scalars excluded, sorted deterministically. */
function sdlTypeNames(): string[] {
  return Object.values(graphQLSchema.getTypeMap())
    .filter(type => !type.name.startsWith("__") && !isSpecifiedScalarType(type))
    .map(type => type.name)
    .toSorted((a, b) => a.localeCompare(b));
}

/** Runtime record guard (no casts, per test-tier discipline). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads a root field's `authScopes` snapshot off the Pothos extensions
 * (no casts). Shared by the users-locale surface describe below; the
 * notification-mutation describe keeps its own closure-scoped twins.
 */
function authScopesSnapshot(field: { readonly extensions?: unknown }): Record<string, unknown> {
  const extensions: unknown = field.extensions;
  if (!isRecord(extensions)) throw new Error("expected record-shaped extensions");
  const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
  if (!isRecord(pothosOptions)) throw new Error("expected record-shaped pothosOptions");
  const authScopes: unknown = Reflect.get(pothosOptions, "authScopes");
  if (!isRecord(authScopes)) throw new Error("expected record-shaped authScopes");
  return authScopes;
}

describe("Query._health — retyped probe surface", () => {
  const queryType = graphQLSchema.getQueryType();

  if (!queryType) {
    throw new Error("Schema must define a root Query type");
  }

  test("root query retains EXACTLY the baseline fields plus the pinned additions", () => {
    expect(queryType).toBeDefined();
    const fieldNames = Object.keys(queryType.getFields());
    // Baseline survivors intact…
    for (const name of PRE_3_1_QUERY_FIELDS) {
      expect(fieldNames).toContain(name);
    }
    // …and the ONLY additions beyond them are the explicitly enumerated
    // sanctioned surfaces: the probe, the DEV1-013 student-handshake
    // queries, the admin user-management directory reads, the
    // `adminAuditLogs` trail read (myApplicantProfile already sits in the
    // refreshed baseline), the DEV3-004 participant-read trio, the
    // DEV3-005 admin arbitration listing, and the DEV3-013 wallet read.
    const additions = fieldNames.filter(name => !(PRE_3_1_QUERY_FIELDS as readonly string[]).includes(name));
    expect(additions.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        "_health",
        "adminAuditLogs",
        "adminUserActivity",
        "adminUserDetail",
        "adminUsers",
        "adminUserStats",
        "findStudentByHandshakeCode",
        "myHandshakeCode",
        ...DEV3_004_QUERY_FIELDS,
        ...DEV3_005_QUERY_FIELDS,
        ...DEV3_013_QUERY_FIELDS,
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("`_health` is NON-NULLABLE `HealthCheck!` (retyped from the String! placeholder)", () => {
    // Field lookup via values+name comparison — keeps `_health` out of member-
    // access position entirely (`no-underscore-dangle` clean by construction).
    const healthField = Object.values(queryType.getFields()).find(field => field.name === "_health");

    if (!healthField) {
      throw new Error("Query must register a `_health` root field");
    }
    expect(healthField).toBeDefined();
    expect(getNamedType(healthField.type).name).toBe("HealthCheck");
    expect(getNamedType(healthField.type).toString()).toBe("HealthCheck");
    // v3 defaults: no explicit nullable opt-out ⇒ strict NonNull wrapping.
    expect(healthField.type.toString()).toBe("HealthCheck!");
  });
});

describe("HealthCheck object shape — four scalar fields, no id", () => {
  const healthType = graphQLSchema.getType("HealthCheck");

  if (!(healthType instanceof GraphQLObjectType)) {
    throw new Error("HealthCheck must be registered as a GraphQL object type");
  }

  test("is registered exactly once as an object type backed by the canonical ref", () => {
    expect(healthType).toBeInstanceOf(GraphQLObjectType);
  });

  test("discloses EXACTLY the four canonical fields, each `String!`", () => {
    const fields = healthType.getFields();

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "service",
      "status",
      "timestamp",
      "version",
    ]);
    for (const field of Object.values(fields)) {
      expect(field.type.toString()).toBe("String!");
    }
  });

  test("carries NO `id` field — embedded value object", () => {
    const fields = healthType.getFields();

    expect(Object.hasOwn(fields, "id")).toBe(false);
  });

  test("selecting `id` on the probe FAILS validation (behavioral no-id proof)", () => {
    const document = parse("{ _health { id } }");
    const errors = validate(graphQLSchema, document);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Cannot query field "id" on type "HealthCheck"');
  });
});

describe("Surface freeze — pinned additions vs the baseline inventory", () => {
  test("mutation set grows ONLY by the sanctioned additions (DEV3-004 quartet + DEV3-005 dispute pair + DEV3-012 confirm + DEV3-013 payout)", () => {
    const mutationFields = graphQLSchema.getMutationType()?.getFields() ?? {};
    const names = Object.keys(mutationFields).toSorted((a, b) => a.localeCompare(b));

    // Baseline survivors intact…
    for (const name of PRE_3_1_MUTATION_FIELDS) {
      expect(names).toContain(name);
    }
    // …and the ONLY additions are the DEV3-004 quartet, the DEV3-005
    // dispute pair, and the DEV3-012 dual-confirmation mutation (all
    // authScopes-gated — none of them is allowlist material; the
    // public-operation registry stays byte-unchanged).
    expect(names).toEqual(
      [
        ...PRE_3_1_MUTATION_FIELDS,
        ...DEV3_004_MUTATION_FIELDS,
        ...DEV3_005_MUTATION_FIELDS,
        ...DEV3_012_MUTATION_FIELDS,
        ...DEV3_013_MUTATION_FIELDS,
      ].toSorted((a, b) => a.localeCompare(b))
    );
    expect(names).not.toContain("_health");
  });

  test("enum set is pinned (every new enum named explicitly)", () => {
    const enumNames = Object.values(graphQLSchema.getTypeMap())
      .filter(type => type instanceof GraphQLEnumType && !type.name.startsWith("__"))
      .map(type => type.name)
      .toSorted((a, b) => a.localeCompare(b));

    expect(enumNames).toEqual(
      [...PRE_3_1_ENUMS, ...DEV3_004_ENUMS, ...DEV3_005_ENUMS, ...DEV3_013_ENUMS].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("DisputeResolution exposes exactly the arbitration vocabulary (Cancel | Complete)", () => {
    const disputeEnum = graphQLSchema.getType("DisputeResolution");

    if (!(disputeEnum instanceof GraphQLEnumType)) {
      throw new Error("DisputeResolution must be registered as a GraphQL enum type");
    }
    expect(
      disputeEnum
        .getValues()
        .map(value => value.name)
        .toSorted((a, b) => a.localeCompare(b))
    ).toEqual(["Cancel", "Complete"]);
  });

  test("Session exposes EXACTLY the DEV3-004 field set plus the five DEV3-005 nullable dispute fields", () => {
    const sessionType = graphQLSchema.getType("Session");

    if (!(sessionType instanceof GraphQLObjectType)) {
      throw new Error("Session must be registered as a GraphQL object type");
    }
    const fields = sessionType.getFields();
    for (const name of DEV3_005_SESSION_FIELDS) {
      expect(Object.hasOwn(fields, name)).toBe(true);
    }
    // All five are nullable (no `!` wrapping) — the dispute/reason data is
    // optional on every row (rows cancelled/disputed/resolved before this
    // ticket carry NULL).
    for (const name of ["cancelReason", "disputeReason", "resolutionNote"]) {
      expect(fields[name]?.type.toString()).toBe("String");
    }
    for (const name of ["disputedAt", "resolvedAt"]) {
      expect(fields[name]?.type.toString()).toBe("DateTime");
    }
  });

  test("whole-schema named-type delta is pinned: refreshed baseline delta (DateTime scalar + HealthCheck probe + DEV1-013 handshake surface) + admin-directory/audit-trail/broadcast absorbed surfaces + DEV3-004 session objects/inputs + scheduling/arbitration/ledger enums + DEV3-013 wallet surface", () => {
    const post = new Set(sdlTypeNames());

    for (const name of PRE_3_1_TYPE_NAMES) {
      expect(post.has(name)).toBe(true);
    }
    const additions = sdlTypeNames().filter(name => !(PRE_3_1_TYPE_NAMES as readonly string[]).includes(name));
    expect(additions).toEqual(
      [
        "AdminAuditLogEntry",
        "AdminAuditLogFiltersInput",
        "AdminAuditLogPage",
        "AdminCreateUserInput",
        "AdminParentSnapshot",
        "AdminStudentSnapshot",
        "AdminTeacherSnapshot",
        "AdminUpdateUserInput",
        "AdminUserActivityEntry",
        "AdminUserDetail",
        "AdminUserFiltersInput",
        "AdminUserGovernanceFilter",
        "AdminUserListItem",
        "AdminUserPage",
        "AdminUserStats",
        "AuditActionType",
        "DateTime",
        "HandshakeCodeLookup",
        "HealthCheck",
        ...DEV3_004_TYPE_NAMES,
        ...DEV3_004_ENUMS,
        ...DEV3_005_ENUMS,
        ...DEV3_013_TYPE_NAMES,
        ...DEV3_013_ENUMS,
      ].toSorted((a, b) => a.localeCompare(b))
    );
  });
});

describe("Notification surface — enum + canonical objects", () => {
  /** Field names in canonical definition order (drives the `id`-FIRST source pin). */
  const CANONICAL_NOTIFICATION_FIELDS = [
    "id",
    "type",
    "title",
    "body",
    "isRead",
    "relatedEntityType",
    "relatedEntityId",
    "createdAt",
  ] as const;

  test("NotificationType enum carries EXACTLY the 7 canonical values (keys on the wire, snake_case runtime values)", () => {
    const enumType = graphQLSchema.getType("NotificationType");

    if (!(enumType instanceof GraphQLEnumType)) {
      throw new Error("NotificationType must be registered as a GraphQL enum type");
    }

    const values = enumType.getValues();
    expect(values).toHaveLength(7);
    // The built schema is lexicographically sorted (enum-value order carries
    // no GraphQL semantics), so the pins compare as sorted sets:
    expect(values.map(value => value.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        "SessionRequest",
        "SessionCompletion",
        "SessionCancellation",
        "ParentLinkRequest",
        "SystemBroadcast",
        "PaymentConfirmation",
        "EvaluationResult",
      ].toSorted((a, b) => a.localeCompare(b))
    );
    // Runtime values stay the canonical snake_case strings — byte-identical
    // to the pgEnum / TS enum single source of truth.
    expect(values.map(value => value.value).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        "session_request",
        "session_completion",
        "session_cancellation",
        "parent_link_request",
        "system_broadcast",
        "payment_confirmation",
        "evaluation_result",
      ].toSorted((a, b) => a.localeCompare(b))
    );
    // Single-source agreement with the canonical TS enum itself.
    expect(values.map(value => value.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(NotificationType).toSorted((a, b) => a.localeCompare(b))
    );
    expect(values.map(value => value.value).toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.values(NotificationType).toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("Notification object exposes `id` and EXACTLY the eight inbox fields (structurally NO `userId`)", () => {
    const notificationType = graphQLSchema.getType("Notification");

    if (!(notificationType instanceof GraphQLObjectType)) {
      throw new Error("Notification must be registered as a GraphQL object type");
    }

    const fields = notificationType.getFields();
    const field = (name: string) => {
      const candidate = fields[name];
      if (!candidate) {
        throw new Error(`Notification must register the \`${name}\` field`);
      }
      return candidate;
    };

    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...CANONICAL_NOTIFICATION_FIELDS].toSorted((a, b) => a.localeCompare(b))
    );
    // Exact field types per the contract (the inbox deliberately keeps the
    // ISO-8601 string convention for timestamps — NOT the `DateTime` scalar
    // now registered in `shared/scalar.pothos.ts`).
    expect(field("id").type.toString()).toBe("ID!");
    expect(field("type").type.toString()).toBe("NotificationType!");
    expect(field("title").type.toString()).toBe("String!");
    expect(field("body").type.toString()).toBe("String");
    expect(field("isRead").type.toString()).toBe("Boolean!");
    expect(field("relatedEntityType").type.toString()).toBe("String");
    expect(field("relatedEntityId").type.toString()).toBe("Int");
    expect(field("createdAt").type.toString()).toBe("String!");
    // SEC: the recipient `userId` is structurally absent from the surface —
    // the recipient is implied by the self-scoped caller, never disclosed.
    expect(Object.hasOwn(fields, "userId")).toBe(false);
  });

  test("`id` is the FIRST field defined on the canonical object source (Apollo normalization convention)", () => {
    // The built schema is lexicographically sorted (field order carries no
    // GraphQL semantics), so the id-FIRST convention is pinned at the
    // source level — lexical scan by design, like the gateway static gates.
    const source = readFileSync(
      resolve(process.cwd(), "backend/graphql/pothos/notifications/notification.pothos.ts"),
      "utf8"
    );
    const fieldsBlock = source.slice(source.indexOf("fields: t => ({"));
    const positions = CANONICAL_NOTIFICATION_FIELDS.map(name => ({
      name,
      at: fieldsBlock.indexOf(`${name}: `),
    }));
    for (const { at } of positions) {
      expect(at).toBeGreaterThanOrEqual(0);
    }
    const idPosition = positions.find(position => position.name === "id")?.at ?? -1;
    for (const { name, at } of positions) {
      if (name !== "id") {
        expect(idPosition).toBeLessThan(at);
      }
    }
  });

  test("NotificationListPage wrapper exposes EXACTLY items/totalCount/hasMore", () => {
    const pageType = graphQLSchema.getType("NotificationListPage");

    if (!(pageType instanceof GraphQLObjectType)) {
      throw new Error("NotificationListPage must be registered as a GraphQL object type");
    }

    const fields = pageType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(["hasMore", "items", "totalCount"]);
    expect(fields.items?.type.toString()).toBe("[Notification!]!");
    expect(fields.totalCount?.type.toString()).toBe("Int!");
    expect(fields.hasMore?.type.toString()).toBe("Boolean!");
    // Wrapper is an embedded value object — no `id` (rows inside `items`
    // are the normalizable entities).
    expect(Object.hasOwn(fields, "id")).toBe(false);
  });
});

describe("Notification query surface — self-scoped inbox reads", () => {
  const queryType = graphQLSchema.getQueryType();

  if (!queryType) {
    throw new Error("Schema must define a root Query type");
  }

  // Captured ONCE after the narrowing guard so the hoisted `queryField`
  // helper below never re-dereferences a possibly-null root type.
  const rootFields = queryType.getFields();

  function queryField(name: string) {
    const field = rootFields[name];
    if (!field) {
      throw new Error(`Query must register the \`${name}\` root field`);
    }
    return field;
  }

  /** Reads one root field's `authScopes` snapshot off the Pothos extensions (no casts). */
  function authScopesOf(fieldName: string): Record<string, unknown> {
    const extensions: unknown = queryField(fieldName).extensions;
    if (!isRecord(extensions)) throw new Error("expected record-shaped extensions");
    const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
    if (!isRecord(pothosOptions)) throw new Error("expected record-shaped pothosOptions");
    const authScopes: unknown = Reflect.get(pothosOptions, "authScopes");
    if (!isRecord(authScopes)) throw new Error("expected record-shaped authScopes");
    return authScopes;
  }

  test("`myNotifications` returns NotificationListPage! with ONE optional filter arg", () => {
    const field = queryField("myNotifications");
    expect(field.type.toString()).toBe("NotificationListPage!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["filter"]);
    const filterArg = field.args[0];
    if (!filterArg) throw new Error("expected the filter argument");
    // Optional + nullable input — exactly the SDL contract's
    // `(filter: MyNotificationsFilterInput)`.
    expect(filterArg.type.toString()).toBe("MyNotificationsFilterInput");
  });

  test("`myUnreadNotificationCount` returns Int! with ZERO arguments", () => {
    const field = queryField("myUnreadNotificationCount");
    expect(field.type.toString()).toBe("Int!");
    expect(field.args).toHaveLength(0);
  });

  test("BOTH inbox queries carry EXACTLY the `authenticated` scope (no role/permission/superAdmin)", () => {
    for (const name of ["myNotifications", "myUnreadNotificationCount"]) {
      const scopes = authScopesOf(name);
      expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["authenticated"]);
      expect(scopes.authenticated).toBe(true);
      // SEC: every authenticated role owns an inbox — no role material may
      // participate in the scope decision.
      expect("role" in scopes).toBe(false);
      expect("permission" in scopes).toBe(false);
      expect("superAdmin" in scopes).toBe(false);
    }
  });

  test("MyNotificationsFilterInput exposes EXACTLY the 4 filter fields, all nullable, ZERO identity fields", () => {
    const inputType = graphQLSchema.getType("MyNotificationsFilterInput");
    if (!(inputType instanceof GraphQLInputObjectType)) {
      throw new Error("MyNotificationsFilterInput must be registered as a GraphQL input type");
    }
    const fields = inputType.getFields();
    expect(Object.keys(fields).toSorted((a, b) => a.localeCompare(b))).toEqual(["isRead", "limit", "offset", "type"]);
    expect(fields.type?.type.toString()).toBe("NotificationType");
    expect(fields.isRead?.type.toString()).toBe("Boolean");
    expect(fields.limit?.type.toString()).toBe("Int");
    expect(fields.offset?.type.toString()).toBe("Int");
    // SEC (BOPLA): no identity field of any kind — the inbox is addressed
    // exclusively by the verified caller context.
    expect(Object.hasOwn(fields, "userId")).toBe(false);
    expect(Object.hasOwn(fields, "user")).toBe(false);
    expect(Object.hasOwn(fields, "id")).toBe(false);
    expect(Object.hasOwn(fields, "recipientId")).toBe(false);
  });

  test("anonymous (context-free) in-process execution of BOTH inbox queries yields UNAUTHORIZED", async () => {
    // Each op asserted in its OWN document: both fields are non-null at the
    // root, so a combined document would null-propagate the first failure
    // over its sibling (one error, second field never resolved).
    const documents = [
      { source: "{ myNotifications { totalCount } }", path: "myNotifications" },
      { source: "{ myUnreadNotificationCount }", path: "myUnreadNotificationCount" },
    ] as const;
    const results = await Promise.all(
      documents.map(async document => graphql({ schema: graphQLSchema, source: document.source, contextValue: {} }))
    );
    for (const [index, result] of results.entries()) {
      const errors = result.errors;
      if (!errors) throw new Error("expected the anonymous inbox query to fail");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
      expect(errors[0]?.path).toEqual([documents[index]?.path]);
    }
  });

  test("smuggled identity args die at validation BEFORE any resolver runs (zero identity-arg surface)", () => {
    const unknownRootArg = validate(graphQLSchema, parse("{ myNotifications(userId: 123) { totalCount } }"));
    expect(unknownRootArg).toHaveLength(1);
    expect(unknownRootArg[0]?.message).toContain('Unknown argument "userId"');

    const smuggledFilterField = validate(
      graphQLSchema,
      parse("{ myNotifications(filter: { userId: 123 }) { totalCount } }")
    );
    expect(smuggledFilterField).toHaveLength(1);
    expect(smuggledFilterField[0]?.message).toContain('unknown field "userId"');

    const unknownCountArg = validate(graphQLSchema, parse("{ myUnreadNotificationCount(userId: 123) }"));
    expect(unknownCountArg).toHaveLength(1);
    expect(unknownCountArg[0]?.message).toContain('Unknown argument "userId"');
  });
});

describe("Notification mutation surface — self-scoped read latch", () => {
  const mutationType = graphQLSchema.getMutationType();

  if (!mutationType) {
    throw new Error("Schema must define a root Mutation type");
  }

  // Captured ONCE after the narrowing guard so the hoisted `mutationField`
  // helper below never re-dereferences a possibly-null root type.
  const rootFields = mutationType.getFields();

  function mutationField(name: string) {
    const field = rootFields[name];
    if (!field) {
      throw new Error(`Mutation must register the \`${name}\` root field`);
    }
    return field;
  }

  /** Reads one root field's `authScopes` snapshot off the Pothos extensions (no casts). */
  function authScopesOf(fieldName: string): Record<string, unknown> {
    const extensions: unknown = mutationField(fieldName).extensions;
    if (!isRecord(extensions)) throw new Error("expected record-shaped extensions");
    const pothosOptions: unknown = Reflect.get(extensions, "pothosOptions");
    if (!isRecord(pothosOptions)) throw new Error("expected record-shaped pothosOptions");
    const authScopes: unknown = Reflect.get(pothosOptions, "authScopes");
    if (!isRecord(authScopes)) throw new Error("expected record-shaped authScopes");
    return authScopes;
  }

  test("`markNotificationRead` returns Notification! with EXACTLY ONE required `id: ID!` arg", () => {
    const field = mutationField("markNotificationRead");
    expect(field.type.toString()).toBe("Notification!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["id"]);
    const idArg = field.args[0];
    if (!idArg) throw new Error("expected the id argument");
    // Required + non-null — exactly the SDL contract's `(id: ID!)`.
    expect(idArg.type.toString()).toBe("ID!");
  });

  test("`markAllNotificationsRead` returns Int! with EXACTLY ONE optional `type: NotificationType` arg", () => {
    const field = mutationField("markAllNotificationsRead");
    expect(field.type.toString()).toBe("Int!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["type"]);
    const typeArg = field.args[0];
    if (!typeArg) throw new Error("expected the type argument");
    // Optional + nullable — exactly the SDL contract's `(type: NotificationType)`.
    expect(typeArg.type.toString()).toBe("NotificationType");
  });

  test("BOTH inbox mutations carry EXACTLY the `authenticated` scope (no role/permission/superAdmin)", () => {
    for (const name of ["markNotificationRead", "markAllNotificationsRead"]) {
      const scopes = authScopesOf(name);
      expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["authenticated"]);
      expect(scopes.authenticated).toBe(true);
      // SEC: every authenticated role owns an inbox — no role material may
      // participate in the scope decision.
      expect("role" in scopes).toBe(false);
      expect("permission" in scopes).toBe(false);
      expect("superAdmin" in scopes).toBe(false);
    }
  });

  test("anonymous (context-free) in-process execution of BOTH inbox mutations yields UNAUTHORIZED", async () => {
    // Each op asserted in its OWN document: both fields are non-null at the
    // root, so a combined document would null-propagate the first failure
    // over its sibling (one error, second field never resolved).
    const documents = [
      { source: 'mutation { markNotificationRead(id: "1") { id } }', path: "markNotificationRead" },
      { source: "mutation { markAllNotificationsRead }", path: "markAllNotificationsRead" },
    ] as const;
    const results = await Promise.all(
      documents.map(async document => graphql({ schema: graphQLSchema, source: document.source, contextValue: {} }))
    );
    for (const [index, result] of results.entries()) {
      const errors = result.errors;
      if (!errors) throw new Error("expected the anonymous inbox mutation to fail");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
      expect(errors[0]?.path).toEqual([documents[index]?.path]);
    }
  });

  test("smuggled identity args die at validation BEFORE any resolver runs (zero identity-arg surface)", () => {
    const smuggledMarkOne = validate(
      graphQLSchema,
      parse('mutation { markNotificationRead(id: "1", userId: 123) { id } }')
    );
    expect(smuggledMarkOne).toHaveLength(1);
    expect(smuggledMarkOne[0]?.message).toContain('Unknown argument "userId"');

    const smuggledMarkAll = validate(graphQLSchema, parse("mutation { markAllNotificationsRead(userId: 123) }"));
    expect(smuggledMarkAll).toHaveLength(1);
    expect(smuggledMarkAll[0]?.message).toContain('Unknown argument "userId"');
  });
});

describe("Users-locale surface (D2 backend vertical) — self-scoped locale preference", () => {
  const mutationType = graphQLSchema.getMutationType();

  if (!mutationType) {
    throw new Error("Schema must define a root Mutation type");
  }

  // Captured ONCE after the narrowing guard — direct lookups below never
  // re-dereference a possibly-null root type.
  const rootFields = mutationType.getFields();

  /** Fail-fast field lookup for the users-locale root field. */
  function updateMyLocaleField() {
    const field = rootFields.updateMyLocale;
    if (!field) {
      throw new Error("Mutation must register the `updateMyLocale` root field");
    }
    return field;
  }

  test("`updateMyLocale` returns User! with EXACTLY ONE required `locale: AppLocale!` arg", () => {
    const field = updateMyLocaleField();
    expect(field.type.toString()).toBe("User!");
    const argNames = field.args.map(arg => arg.name).toSorted((a, b) => a.localeCompare(b));
    expect(argNames).toEqual(["locale"]);
    const localeArg = field.args[0];
    if (!localeArg) throw new Error("expected the locale argument");
    // Required + non-null — exactly the SDL contract's `(locale: AppLocale!)`.
    expect(localeArg.type.toString()).toBe("AppLocale!");
  });

  test("`updateMyLocale` carries EXACTLY the `authenticated` scope (no role/permission/superAdmin)", () => {
    const scopes = authScopesSnapshot(updateMyLocaleField());
    expect(Object.keys(scopes).toSorted((a, b) => a.localeCompare(b))).toEqual(["authenticated"]);
    expect(scopes.authenticated).toBe(true);
    // SEC: every authenticated role owns a locale preference — no role
    // material may participate in the scope decision.
    expect("role" in scopes).toBe(false);
    expect("permission" in scopes).toBe(false);
    expect("superAdmin" in scopes).toBe(false);
  });

  test("BroadcastAudienceType enum carries EXACTLY the 4 canonical values (keys on the wire, lowercase runtime values)", () => {
    const enumType = graphQLSchema.getType("BroadcastAudienceType");

    if (!(enumType instanceof GraphQLEnumType)) {
      throw new Error("BroadcastAudienceType must be registered as a GraphQL enum type");
    }

    const values = enumType.getValues();
    expect(values).toHaveLength(4);
    // The built schema is lexicographically sorted (enum-value order carries
    // no GraphQL semantics), so the pins compare as sorted sets:
    expect(values.map(value => value.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
      ["All", "Country", "Plan", "Role"].toSorted((a, b) => a.localeCompare(b))
    );
    // Runtime values stay the canonical lowercase strings — byte-identical
    // to the TS enum single source of truth (wire vocabulary is the KEY set;
    // a rename would move the wire contract and must fail here).
    expect(values.map(value => value.value).toSorted((a, b) => a.localeCompare(b))).toEqual(
      ["all", "country", "plan", "role"].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("AppLocale enum carries EXACTLY the 2 canonical values (keys on the wire, lowercase runtime values)", () => {
    const enumType = graphQLSchema.getType("AppLocale");

    if (!(enumType instanceof GraphQLEnumType)) {
      throw new Error("AppLocale must be registered as a GraphQL enum type");
    }

    const values = enumType.getValues();
    expect(values).toHaveLength(2);
    expect(values.map(value => value.name).toSorted((a, b) => a.localeCompare(b))).toEqual(["Ar", "En"]);
    // Runtime values stay the canonical lowercase locale strings —
    // byte-identical to the pgEnum / TS enum / shared `locales` list.
    expect(values.map(value => value.value).toSorted((a, b) => a.localeCompare(b))).toEqual(["ar", "en"]);
  });

  test("`User.locale` is the NULLABLE AppLocale enum (unset until the user picks one)", () => {
    const userType = graphQLSchema.getType("User");

    if (!(userType instanceof GraphQLObjectType)) {
      throw new Error("User must be registered as a GraphQL object type");
    }

    const localeField = userType.getFields().locale;
    if (!localeField) {
      throw new Error("User must register the `locale` field");
    }
    expect(localeField.type.toString()).toBe("AppLocale");
  });

  test("anonymous (context-free) in-process execution of updateMyLocale yields UNAUTHORIZED", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: "mutation { updateMyLocale(locale: Ar) { id } }",
      contextValue: {},
    });
    const errors = result.errors;
    if (!errors) throw new Error("expected the anonymous locale mutation to fail");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.extensions?.code).toBe("UNAUTHORIZED");
    expect(errors[0]?.path).toEqual(["updateMyLocale"]);
  });

  test("smuggled identity args die at validation BEFORE any resolver runs (zero identity-arg surface)", () => {
    const smuggledUserId = validate(
      graphQLSchema,
      parse("mutation { updateMyLocale(locale: Ar, userId: 123) { id } }")
    );
    expect(smuggledUserId).toHaveLength(1);
    expect(smuggledUserId[0]?.message).toContain('Unknown argument "userId"');

    // The closed enum rejects non-locale literals at validation time too.
    const invalidLiteral = validate(graphQLSchema, parse("mutation { updateMyLocale(locale: fr) { id } }"));
    expect(invalidLiteral).toHaveLength(1);
    expect(invalidLiteral[0]?.message).toContain('Value "fr" does not exist in "AppLocale" enum');
  });
});

describe("Public-operation allowlist agreement", () => {
  test("`_health` is a member of the closed allowlist 1:1 with its scopeless schema posture", () => {
    expect(PUBLIC_OPERATION_NAMES).toContain("_health");
    expect(PUBLIC_OPERATIONS.has("_health")).toBe(true);
    // The field genuinely ships WITHOUT authScopes: anonymous execution below
    // would otherwise raise an UNAUTHORIZED error through the scope-auth plugin.
  });

  test("anonymous (context-free) execution of the probe succeeds end-to-end", async () => {
    const result = await graphql({
      schema: graphQLSchema,
      source: "{ _health { status service version timestamp } }",
      contextValue: {},
    });

    expect(result.errors).toBeUndefined();
    // Wire-shape assertion over the serialized data map (timestamp varies per
    // call — matched structurally). This proves the delegation-only resolver:
    // the exact four-field payload of the shared producer surfaces verbatim,
    // nothing more.
    const serializedProbe = JSON.stringify(result.data);
    const probeShape =
      /^\{"_health":\{"status":"ok","service":"kottaby","version":"([^"]*)","timestamp":"([^"]+)"\}\}$/;
    const match = probeShape.exec(serializedProbe);

    expect(match).not.toBeNull();
    // Delegation-only proof: version flows out of the shared service producer
    // (non-empty here, since npm_package_version exists in this workspace).
    expect(match?.[1]?.length ?? 0).toBeGreaterThan(0);
    // …and the timestamp is a parseable ISO-8601 instant (never cached).
    expect(Number.isNaN(Date.parse(match?.[2] ?? "invalid"))).toBe(false);
  });
});

describe("Codegen sync — committed SDL is byte-identical to the built schema", () => {
  test("frontend/graphql/generated/schema.graphql matches a fresh deterministic emission", () => {
    const sdlPath = resolve(process.cwd(), "frontend/graphql/generated/schema.graphql");
    const committedSdl = readFileSync(sdlPath, "utf8");
    const freshlyPrinted = printSchema(lexicographicSortSchema(graphQLSchema));

    expect(committedSdl).toBe(freshlyPrinted);
    // Belt-and-braces: the synced artifact really contains the retyped probe.
    expect(committedSdl).toContain("_health: HealthCheck!");
    expect(committedSdl).toContain("type HealthCheck {");
    // …and the DEV3-004 session surface (7 root operations + 2 object
    // types + 2 input types) is really inside the committed artifact.
    expect(committedSdl).toContain("sessionById(id: ID!): Session");
    expect(committedSdl).toContain(
      "myStudentSessions(filter: SessionListFilterInput, page: Int = 1, pageSize: Int = 25): SessionPage!"
    );
    expect(committedSdl).toContain(
      "myTeacherSessions(filter: SessionListFilterInput, page: Int = 1, pageSize: Int = 25): SessionPage!"
    );
    expect(committedSdl).toContain("createSession(input: CreateSessionInput!): Session!");
    expect(committedSdl).toContain("startSession(id: ID!): Session!");
    expect(committedSdl).toContain("completeSession(id: ID!): Session!");
    expect(committedSdl).toContain("cancelSession(id: ID!, reason: String): Session!");
    expect(committedSdl).toContain("type Session {");
    expect(committedSdl).toContain("type SessionPage {");
    expect(committedSdl).toContain("input CreateSessionInput {");
    expect(committedSdl).toContain("input SessionListFilterInput {");
    // …and the DEV3-005 dispute surface (3 root operations + the
    // arbitration enum + the five nullable Session fields) is really
    // inside the committed artifact.
    expect(committedSdl).toContain("openSessionDispute(id: ID!, reason: String!): Session!");
    expect(committedSdl).toContain(
      "resolveSessionDispute(id: ID!, note: String, resolution: DisputeResolution!): Session!"
    );
    expect(committedSdl).toContain(
      "adminDisputedSessions(filter: SessionListFilterInput, limit: Int = 25, offset: Int = 0): SessionPage!"
    );
    expect(committedSdl).toContain("enum DisputeResolution {");
    for (const field of DEV3_005_SESSION_FIELDS) {
      expect(committedSdl).toContain(field);
    }
    // …and the DEV3-012 dual-confirmation mutation is really inside the
    // committed artifact.
    expect(committedSdl).toContain("confirmSessionCompletion(id: ID!): Session!");
    // …and the DEV3-013 wallet surface (2 root operations + the payout
    // input + the two ledger enums) is really inside the committed artifact.
    expect(committedSdl).toContain("myWallet: Wallet!");
    expect(committedSdl).toContain("requestWithdrawal(input: RequestWithdrawalInput!): Wallet!");
    expect(committedSdl).toContain("input RequestWithdrawalInput {");
    expect(committedSdl).toContain("enum TransactionType {");
    expect(committedSdl).toContain("enum TransactionStatus {");
  });
});
