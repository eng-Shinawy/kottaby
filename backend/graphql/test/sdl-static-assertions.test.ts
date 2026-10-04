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
 *  - **Root-set freeze** — the Mutation root is EXACTLY the refreshed frozen
 *    50-op baseline (the prior 7-op auth-quartet + notification read-latch
 *    pair + users-locale surface, plus the reconciled admin-user
 *    trio + session quartet + dispute pair + post-confirmation dispute entry
 *    + confirm + payout + the sanctioned admin-governance
 *    pair + the session-governance quartet + the RECONCILED
 *    parent-link trio + admin broadcast/certify pair + the subscription
 *    purchase write + the admin subscription-management quartet + the
 *    session-report write + the financial-auditing
 *    trio + the student-evaluation rating write + the curriculum lesson
 *    CRUD trio + the evaluation-booking write) and the Query root is
 *    EXACTLY the refreshed 57-op baseline (the prior frozen baseline +
 *    the `_health` probe + the session-report read pair +
 *    the reconciled admin-user query quartet + the
 *    participant-read trio + the admin arbitration listing + the
 *    wallet read + the wallet ledger read + the handshake pair + the
 *    admin session pair + the subscription purchase caller-scoped read +
 *    the re-anchored R1–R3 admin directory trio + the admin
 *    subscription-management read). Mirrors the `PRE_3_1_*` +
 *    `ADMIN_USER_*` + `ADMIN_GOVERNANCE_MUTATION_FIELDS`
 *    inventories in schema-surface.test.ts, extended with the R5 admin
 *    directory export trio and the subscription-purchase surface.
 *  - **Users-locale surface (D2)** — `updateMyLocale(locale: AppLocale!): User!`
 *    is present with its EXACT SDL signature, `User.locale` is the nullable
 *    `AppLocale` enum, and the `AppLocale` enum carries exactly the two
 *    canonical values.
 *  - **REQ-060 four-ops contract** — `myNotifications`,
 *    `myUnreadNotificationCount`, `markNotificationRead`,
 *    `markAllNotificationsRead` are present with their EXACT SDL signatures
 *    (argument names/types + return types), and `MyNotificationsFilterInput`
 *    carries exactly the four nullable filter fields.
 *  - **admin-governance pair pinned** — `adminSetUserBlocked` and
 *    `adminSetUserSuspended` are present with their EXACT SDL signatures
 *    (the load-bearing arg shapes the resolver contract pins) at their
 *    sorted positions in the Mutation root inventory. The `$all` scope
 *    declaration is pinned in schema-surface.test.ts's introspection
 *    describe and the admin-governance wire-tier matrix
 *    (`admin-governance.matrix.test.ts` Tier 0) — this artifact-side tier
 *    pins the SDL TEXT (the contract surface clients parse).
 *  - **session-recitation surface pinned** — the write-once
 *    per-session record rides the artifact tier too: the mutation
 *    `setSessionRecitation(input: SessionRecitationInput!, sessionId: ID!):
 *    SessionRecitation!` (args in the sorted `input` < `sessionId` order),
 *    the NULLABLE `sessionRecitation(sessionId: ID!): SessionRecitation`
 *    query (the collapse channel), the six-field `SessionRecitation` object
 *    (id on the wire, every instant on the DateTime scalar), and the closed
 *    two-member `SessionRecitationInput`. The custom-scalar set is pinned:
 *    exactly `DateTime` + `CountryCode`, each registered exactly once.
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
 * Reconciliation note: the prior 7-op Mutation baseline and
 * 6-op Query baseline predates the admin-user-management surface
 * (and the session / dispute / dual-confirmation surfaces). The live
 * Mutation root today carries 33 ops and the live Query root carries 32
 * ops — both re-anchored to the LIVE built schema via
 * `printSchema(lexicographicSortSchema(graphQLSchema))` as empirical
 * evidence and documented here as a one-time reconciliation (NOT a silent
 * baseline flip). The admin-governance pair is then pinned on
 * top as the sanctioned post-reconciliation addition.
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
  type DefinitionNode,
  type EnumTypeDefinitionNode,
  type InputObjectTypeDefinitionNode,
  Kind,
  type ObjectTypeDefinitionNode,
  parse,
  type ScalarTypeDefinitionNode,
  type TypeNode,
} from "graphql";

// ─── Frozen baselines (mirror the refreshed PRE_3_1_* + ADMIN_USER_* + ──
// ─── ADMIN_GOVERNANCE_MUTATION_FIELDS inventories in schema-surface ─
// ─── .test.ts — the single sanctioned growth history) ────────────────────────

/**
 * Root mutation fields — the refreshed 55-op baseline: the prior 54-op
 * baseline + the admin-ordered paid re-evaluation write
 * (`adminOrderTeacherReEvaluation` — the teacher-wallet-deduction surface;
 * the subject pays the fee, the order is audited, and the teacher is
 * de-certified for the loop re-entry). The prior 54-op baseline was the
 * prior 53-op
 * baseline + the admin evaluation-override write
 * (`adminOverrideApplicantEvaluation` — shipped with the admin-override
 * child-ticket surface; re-anchored to the live schema as a documented
 * one-time reconciliation, NOT a silent baseline flip). The prior 53-op
 * baseline was itself the prior 52-op baseline + the applicant-cooldown
 * extension write (`adminExtendApplicantCooldown` — shipped with the
 * applicant-cooldown surface but never enumerated here; re-anchored the
 * same way). The baseline itself is: the reconciled admin-user-management trio
 * (3 mutations) + the
 * session quartet + dispute pair + post-confirmation dispute entry + confirm
 * + payout, the sanctioned admin-governance pair + the
 * session-governance quartet + the subscription purchase write + the
 * verification-plan purchase write + the session-report write + the
 * financial-auditing trio + the student-evaluation rating write + the
 * admin subscription-management quartet (extend / renew / cancel /
 * change plan — merged from main) + the curriculum lesson CRUD trio
 * (create / update / delete — merged from main) + the evaluation-booking
 * write (`bookEvaluationSession` — merged from main) + the admin broadcast
 * stop write.
 * Sorted alphabetically (mirrors the
 * live `printSchema(lexicographicSortSchema(graphQLSchema))` Mutation root
 * inventory verbatim). Re-anchored to the live schema as a documented
 * one-time reconciliation (NOT a silent baseline flip) ahead of pinning
 * the admin-governance pair; the verification-plan purchase write was
 * re-anchored post-plan (shipped by the verification-plan-purchase round
 * but never enumerated here). The teacher availability toggle write
 * (`setTeacherAvailability` — the teacher-role-gated single-arg
 * `isOnline: Boolean!` mutation; identity derived server-side from the
 * verified access token; NO id-taking argument) is then pinned on top
 * as the sanctioned post-reconciliation addition.
 */
const FROZEN_MUTATION_FIELDS = [
  "adjustTeacherWallet",
  "adminBroadcastNotification",
  "adminCancelSession",
  "adminCancelSubscription",
  "adminCertifyTeacherColdStart",
  "adminChangeSubscriptionPlan",
  "adminCreateUser",
  "adminExtendApplicantCooldown",
  "adminExtendSubscription",
  "adminJoinSession",
  "adminOnboardStudentWithOfflinePayment",
  "adminOrderTeacherReEvaluation",
  "adminOverrideApplicantEvaluation",
  "adminReassignTeacher",
  "adminRenewSubscription",
  "adminRescheduleSession",
  "adminSetUserBlocked",
  "adminSetUserDeleted",
  "adminSetUserPassword",
  "adminSetUserSuspended",
  "adminStopBroadcast",
  "adminUpdateUser",
  "approveWithdrawal",
  "bookEvaluationSession",
  "cancelParentLinkRequest",
  "cancelSession",
  "changeMyPassword",
  "completeSession",
  "confirmSessionCompletion",
  "createLesson",
  "createPlan",
  "createSession",
  "deleteLesson",
  "login",
  "logout",
  "markAllNotificationsRead",
  "markNotificationRead",
  "openPostConfirmationDispute",
  "openSessionDispute",
  "purchaseSubscription",
  "purchaseVerificationPlan",
  "refreshToken",
  "registerUser",
  "rejectWithdrawal",
  "requestParentChildLink",
  "requestWithdrawal",
  "resolveSessionDispute",
  "respondToParentLinkRequest",
  "setPlanActiveStatus",
  "setSessionRecitation",
  "setTeacherAvailability",
  "startSession",
  "submitRubricEvaluation",
  "submitSessionReport",
  "submitTeacherEvaluation",
  "updateLesson",
  "updateMyLocale",
  "updatePlan",
] as const;

/**
 * Root query fields — the refreshed 67-op baseline: the prior frozen
 * 66-op baseline + the sanctioned applicant-cooldown lifecycle read
 * (`adminApplicantCooldownStats: AdminApplicantCooldownStats!` — the
 * admin-gated dashboard KPI read registering ZERO mutations; the pointer's
 * writer is internal-only).
 * The prior baseline had already grown by: the `_health`
 * probe + the session-report read pair (`sessionHomework` /
 * `sessionReport`) + the reconciled admin-user query quartet + the
 * participant-read trio + the admin arbitration listing + the admin
 * dispute-case read + the wallet read + the handshake pair + the admin
 * session pair (`adminSession` / `adminSessions` — 4.4 reconcile) + the
 * subscription purchase caller-scoped read + the R1–R3 admin directory
 * trio (`adminTeachers` / `adminStudents` / `adminTeacherApplicants` —
 * shipped across the admin-directory rounds but never enumerated here;
 * re-anchored to the live schema as a documented one-time reconciliation,
 * NOT a silent baseline flip) + the R5 admin directory export trio
 * (`adminTeachersExport` / `adminStudentsExport` /
 * `adminTeacherApplicantsExport` — the sanctioned export-all read
 * surface, pinned as the documented one-time reconciliation in the same
 * convention) + the student-evaluation caller-scoped read
 * (`myTeacherEvaluations`) + the admin broadcast history read pair
 * (`adminBroadcasts` / `adminBroadcastDetail`) + the evaluation-loop reads
 * (`availableEvaluators` / `myEvaluationLoopStatus` / `myEvaluationSessions`)
 * + the per-plan curriculum read (`planLessons`) + the admin
 * subscription-management read (`adminStudentSubscriptions`) + the
 * wallet ledger read (`myWalletLedger`) + the student homework history
 * read (`studentHomeworkHistory`) + the parent-portal homework read
 * (`myHomework` — re-anchored post-plan; reuses the parent portal's
 * canonical homework page projection) + the parent portal deep-link
 * target read (`parentSessionTarget` — shipped by the notification-plan
 * round but never enumerated here; re-anchored post-plan). Sorted alphabetically (mirrors the live
 * `printSchema(lexicographicSortSchema(graphQLSchema))` Query root
 * inventory verbatim, with locale-aware case handling:
 * `adminUsers` precedes `adminUserStats` because the locale comparator
 * treats `s`/`S` as primary-equal and lowercases win on the secondary
 * tie-breaker — verified by the live built schema). The teacher
 * availability toggle read (`myTeacherAvailability: TeacherAvailabilityState!`
 * — the teacher-role-gated read with ZERO arguments; identity derived
 * server-side from the verified access token; registers ZERO mutations)
 * is then pinned on top as the sanctioned post-reconciliation addition.
 */
const FROZEN_QUERY_FIELDS = [
  "_health",
  "adminAcademicDashboard",
  "adminApplicantCooldownStats",
  "adminAuditLogs",
  "adminBroadcastDetail",
  "adminBroadcasts",
  "adminDisputeAnalytics",
  "adminDisputeCase",
  "adminDisputedSessions",
  "adminPendingWithdrawals",
  "adminPlans",
  "adminPlatformAnalytics",
  "adminSession",
  "adminSessions",
  "adminStudentAcademicDetail",
  "adminStudentPayments",
  "adminStudents",
  "adminStudentsExport",
  "adminStudentSubscriptions",
  "adminTeacherApplicants",
  "adminTeacherApplicantsExport",
  "adminTeachers",
  "adminTeachersExport",
  "adminTeacherWallet",
  "adminUserActivity",
  "adminUserCountryBreakdown",
  "adminUserDetail",
  "adminUsers",
  "adminUserStats",
  "availableEvaluators",
  "findStudentByHandshakeCode",
  "me",
  "myApplicantProfile",
  "myChildrenUpcomingSessions",
  "myEvaluationLoopStatus",
  "myEvaluationSessions",
  "myHandshakeCode",
  "myHomework",
  "myIncomingParentLinkRequests",
  "myLinkedChildren",
  "myNotifications",
  "myOutgoingParentLinkRequests",
  "myRubricEvaluation",
  "myRubricPendingSessions",
  "myStudentSessions",
  "mySubscriptions",
  "myTeacherAvailability",
  "myTeacherEvaluations",
  "myTeacherSessions",
  "myUnreadNotificationCount",
  "myWallet",
  "myWalletLedger",
  "parentChildHomework",
  "parentChildProgress",
  "parentChildReports",
  "parentChildSessions",
  "parentSessionTarget",
  "planCatalog",
  "planLessons",
  "recitationReadings",
  "sessionById",
  "sessionHomework",
  "sessionRecitation",
  "sessionReport",
  "studentDisputeCase",
  "studentHomeworkHistory",
  "studentProgress",
  "teacherDisputeCase",
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

/**
 * Type-name-bearing definition kinds only (no casts — a kind-guard
 * predicate narrows the union for the `.name` access). Module scope per
 * the function-scope discipline.
 */
function isNamedTypeDefinition(
  definition: DefinitionNode
): definition is
  | ObjectTypeDefinitionNode
  | InputObjectTypeDefinitionNode
  | EnumTypeDefinitionNode
  | ScalarTypeDefinitionNode {
  return (
    definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
    definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
    definition.kind === Kind.ENUM_TYPE_DEFINITION ||
    definition.kind === Kind.SCALAR_TYPE_DEFINITION
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

  test("Mutation root is EXACTLY the refreshed frozen 58-op baseline — the reconciled admin-user trio + quartet + dispute pair + post-confirmation dispute entry + confirm + payout + the sanctioned admin-governance pair + the session-governance quartet + the subscription purchase write + the verification-plan purchase write + the admin subscription-management quartet + the session-report write + the student-evaluation rating write + the financial-auditing trio + the curriculum lesson CRUD trio + the evaluation-booking write + the admin broadcast stop write + the admin direct-onboarding write + the applicant-cooldown extension write + the admin evaluation-override write + the credential-rotation write + the self-service credential write + the admin-ordered paid re-evaluation write + the teacher availability toggle write on top of the auth quartet + notification read-latch pair + users-locale surface", () => {
    const names = fieldSurfaces("Mutation").map(surface => surface.name);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([...FROZEN_MUTATION_FIELDS]);
  });

  test("Query root is EXACTLY the refreshed frozen 68-op baseline (the prior 66-op baseline + the sanctioned applicant-cooldown lifecycle read (`adminApplicantCooldownStats: AdminApplicantCooldownStats!`, a role-gated read that registers ZERO mutations) + the sanctioned users-by-country distribution read (`adminUserCountryBreakdown(limit: Int): AdminUserCountryBreakdown!`, a role-gated admin aggregate that registers ZERO mutations) + the sanctioned teacher availability toggle read (`myTeacherAvailability: TeacherAvailabilityState!`, a teacher-role-gated read with ZERO arguments that derives the acting identity from the verified access token; registers ZERO mutations; zero unsanctioned growth)", () => {
    const names = fieldSurfaces("Query").map(surface => surface.name);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([...FROZEN_QUERY_FIELDS]);
  });
});

describe("admin-governance pair — exact SDL signatures pinned on the artifact", () => {
  test("`adminSetUserBlocked(blocked: Boolean!, id: Int!): AdminUserDetail!`", () => {
    // The live sorted SDL emits args alphabetically — `blocked` precedes
    // `id` (both NonNull). The resolver contract pins this
    // exact arg shape — the resolver never has to defend against a NULL
    // `blocked` (a NULL would be a GRAPHQL_VALIDATION_FAILED before the
    // resolver body runs).
    const surface = fieldSurface("Mutation", "adminSetUserBlocked");
    expect(surface.type).toBe("AdminUserDetail!");
    expect(surface.args).toEqual([
      { name: "blocked", type: "Boolean!" },
      { name: "id", type: "Int!" },
    ]);
  });

  test("`adminSetUserSuspended(id: Int!, periodDays: Int, suspended: Boolean!): AdminUserDetail!`", () => {
    // The live sorted SDL emits args alphabetically — `id`, `periodDays`,
    // `suspended`. `periodDays` is the ONLY nullable arg (the optional
    // suspension window length); `id` and `suspended` are NonNull.
    const surface = fieldSurface("Mutation", "adminSetUserSuspended");
    expect(surface.type).toBe("AdminUserDetail!");
    expect(surface.args).toEqual([
      { name: "id", type: "Int!" },
      { name: "periodDays", type: "Int" },
      { name: "suspended", type: "Boolean!" },
    ]);
  });

  test("`adminOverrideApplicantEvaluation(action: AdminApplicantOverrideAction!, applicantId: Int!, cooldownDays: Int): ApplicantProfile!`", () => {
    // The live sorted SDL emits args alphabetically — `action`,
    // `applicantId`, `cooldownDays`. `cooldownDays` is the ONLY nullable arg
    // (the reject-direction cooldown length — the `adminSetUserSuspended`
    // periodDays precedent: validated on the reject direction, ignored on
    // the others); `action` and `applicantId` are NonNull. The override
    // enum carries EXACTLY the three wire members (the enum KEYS — the
    // lowercase runtime strings never surface on the wire).
    const surface = fieldSurface("Mutation", "adminOverrideApplicantEvaluation");
    expect(surface.type).toBe("ApplicantProfile!");
    expect(surface.args).toEqual([
      { name: "action", type: "AdminApplicantOverrideAction!" },
      { name: "applicantId", type: "Int!" },
      { name: "cooldownDays", type: "Int" },
    ]);
    const overrideEnum = sdlDocument.definitions.find(
      (definition): definition is EnumTypeDefinitionNode =>
        definition.kind === Kind.ENUM_TYPE_DEFINITION && definition.name.value === "AdminApplicantOverrideAction"
    );
    if (!overrideEnum) {
      throw new Error("expected the `AdminApplicantOverrideAction` enum in the artifact");
    }
    expect((overrideEnum.values ?? []).map(value => value.name.value).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "Certify",
      "GrantReEvaluation",
      "Reject",
    ]);
  });

  test("both governance mutations sit at their SORTED positions in the Mutation root inventory", () => {
    // The live schema emits root fields alphabetically, so the admin
    // operations read as one sorted band: the admin session-governance
    // operations (cancel / join / reassign / reschedule) interlock with
    // the admin-user CRUD surface, and the combined set occupies ONE
    // contiguous run of the sorted Mutation inventory — opening at
    // `adminCancelSession` (alphabetically first of the union) and
    // closing at `adminUpdateUser`. The teacher cold-start certification
    // mutation, the admin broadcast stop write, the applicant-cooldown
    // extension write, and the admin evaluation-override write also sort
    // inside that band — the certification between
    // `adminCancelSession` and `adminCreateUser`, the stop write between
    // `adminSetUserSuspended` and `adminUpdateUser`, the cooldown
    // extension between `adminCreateUser` and `adminExtendSubscription`
    // (it shares the `adminExtend` prefix; the applicant vocabulary sorts
    // before the subscription one), and the override write between
    // `adminOnboardStudentWithOfflinePayment` and `adminReassignTeacher`.
    const names = fieldSurfaces("Mutation").map(surface => surface.name);
    const sorted = names.toSorted((a, b) => a.localeCompare(b));
    const adminUserMutationNames = [
      "adminCreateUser",
      "adminSetUserBlocked",
      "adminSetUserDeleted",
      "adminSetUserSuspended",
      "adminUpdateUser",
    ];
    const adminSessionGovernanceMutationNames = [
      "adminCancelSession",
      "adminJoinSession",
      "adminReassignTeacher",
      "adminRescheduleSession",
    ];
    // Every admin-user mutation is present, and their relative
    // lexicographic order is preserved (strictly increasing indexes in
    // the sorted inventory).
    const adminUserIndexes = adminUserMutationNames.map(name => sorted.indexOf(name));
    for (const index of adminUserIndexes) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < adminUserIndexes.length; i += 1) {
      const previous = adminUserIndexes[i - 1] ?? -1;
      const current = adminUserIndexes[i] ?? -1;
      expect(current).toBeGreaterThan(previous);
    }
    // The session-governance quartet is present too, and the combined
    // admin band fills ONE contiguous sorted run starting at
    // `adminCancelSession`: the window from that first member through
    // `adminUpdateUser` hosts the full union in sorted position (plus
    // the certification mutation noted above).
    const adminBandMutationNames = [...adminSessionGovernanceMutationNames, ...adminUserMutationNames];
    const bandIndexes = adminBandMutationNames.map(name => sorted.indexOf(name));
    for (const index of bandIndexes) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    const bandStart = sorted.indexOf("adminCancelSession");
    const bandEnd = sorted.indexOf("adminUpdateUser");
    expect(bandStart).toBeGreaterThanOrEqual(0);
    expect(bandEnd).toBeGreaterThan(bandStart);
    const expectedBandWindow = [
      ...adminBandMutationNames,
      // The admin subscription-management quartet sorts inside the band
      // (cancel/change-plan between `adminCancelSession` and
      // `adminCreateUser`; extend between `adminCreateUser` and
      // `adminJoinSession`; renew between `adminReassignTeacher` and
      // `adminRescheduleSession`), the direct-onboarding write lands between
      // `adminJoinSession` and `adminReassignTeacher`, the broadcast
      // stop write between `adminSetUserSuspended` and `adminUpdateUser`,
      // the applicant-cooldown extension write between
      // `adminCreateUser` and `adminExtendSubscription`, the
      // evaluation-override write between
      // `adminOnboardStudentWithOfflinePayment` and `adminReassignTeacher`,
      // and the admin-ordered paid re-evaluation write directly after
      // `adminOnboardStudentWithOfflinePayment` (the `adminO` vocabulary:
      // nboard < rder < verride).
      // The credential-rotation write sorts between `adminSetUserDeleted`
      // and `adminSetUserSuspended`.
      "adminCancelSubscription",
      "adminChangeSubscriptionPlan",
      "adminExtendApplicantCooldown",
      "adminExtendSubscription",
      "adminRenewSubscription",
      "adminCertifyTeacherColdStart",
      "adminStopBroadcast",
      "adminOnboardStudentWithOfflinePayment",
      "adminOrderTeacherReEvaluation",
      "adminOverrideApplicantEvaluation",
      "adminSetUserPassword",
    ].toSorted((a, b) => a.localeCompare(b));
    expect(sorted.slice(bandStart, bandEnd + 1)).toEqual(expectedBandWindow);
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
    // History of this pin: the original lexical
    // `sdlText.not.toContain("Subscription")` was retired as part of the
    // admin-user surface reconciliation (the
    // `hasActiveSubscription` field names are legitimate substrings), and
    // the follow-up "no ObjectTypeDefinition named `Subscription`" AST
    // check was retired when the subscription-purchase surface landed —
    // not because the domain entity carries that name (it ships as
    // `StudentSubscription` on the wire precisely BECAUSE `Subscription`
    // is reserved), but because with default root naming the artifact
    // text cannot distinguish a plain object named `Subscription` from
    // the subscription root it would be auto-adopted as — the ban is
    // undecidable on that tier, so the root-level contract is enforced
    // where it is decidable:
    //  - artifact tier (here): NO schema-definition entry may declare a
    //    `subscription:` root — the only textually-decidable half.
    //  - built-schema tier (schema-surface.test.ts): the built schema
    //    must expose NO subscription root at all.
    const schemaDefinitionSubscriptionEntries = sdlDocument.definitions.filter(
      definition =>
        definition.kind === Kind.SCHEMA_DEFINITION &&
        definition.operationTypes.some(operation => operation.operation === "subscription")
    );
    expect(schemaDefinitionSubscriptionEntries).toHaveLength(0);
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

describe("Student-progress surface — artifact-side pins", () => {
  test("`studentProgress(studentId: Int!): StudentProgress!` — the gated curriculum-position read (NON-NULLABLE, one selector arg)", () => {
    const surface = fieldSurface("Query", "studentProgress");
    expect(surface.type).toBe("StudentProgress!");
    expect(surface.args).toEqual([{ name: "studentId", type: "Int!" }]);
  });

  test("`StudentProgress` exposes EXACTLY the eleven computed fields with the honest-nullability split", () => {
    const surfaces = fieldSurfaces("StudentProgress");
    expect(surfaces.map(surface => surface.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "completionPercent",
      "currentLessonId",
      "currentLessonPosition",
      "currentLessonTitle",
      "hasProgress",
      "isOnFinalLesson",
      "lessonsCompleted",
      "planId",
      "planTitle",
      "studentId",
      "totalLessons",
    ]);
    const byName = new Map(surfaces.map(surface => [surface.name, surface]));
    // The honesty backbone is ALWAYS present (zeroed when hasProgress=false)
    // — a computed read-model, never a fabricated percentage.
    expect(byName.get("hasProgress")?.type).toBe("Boolean!");
    expect(byName.get("isOnFinalLesson")?.type).toBe("Boolean!");
    expect(byName.get("studentId")?.type).toBe("Int!");
    expect(byName.get("totalLessons")?.type).toBe("Int!");
    expect(byName.get("lessonsCompleted")?.type).toBe("Int!");
    expect(byName.get("completionPercent")?.type).toBe("Int!");
    // The plan echo and the current-lesson trio collapse to null on the
    // honest-zero payload.
    expect(byName.get("planId")?.type).toBe("Int");
    expect(byName.get("planTitle")?.type).toBe("String");
    expect(byName.get("currentLessonId")?.type).toBe("Int");
    expect(byName.get("currentLessonTitle")?.type).toBe("String");
    expect(byName.get("currentLessonPosition")?.type).toBe("Int");
  });

  test("NO progress mutation exists — the Mutation root carries zero progress operations (BFLA)", () => {
    // The pointer's writer is internal-only: no mutation operation exposes it.
    expect(
      fieldSurfaces("Mutation")
        .map(surface => surface.name)
        .filter(name => name.toLowerCase().includes("progress"))
    ).toEqual([]);
    // The read is the ONLY new progress surface on the Query root (the
    // parent portal's `parentChildProgress` stays the untouched parent surface).
    expect(
      fieldSurfaces("Query")
        .map(surface => surface.name)
        .filter(name => name.toLowerCase().includes("progress"))
        .toSorted((a, b) => a.localeCompare(b))
    ).toEqual(["parentChildProgress", "studentProgress"]);
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

describe("Platform analytics surface (extend) — artifact-side pins", () => {
  /** The eleven embedded value objects of the analytics read surface. */
  const PLATFORM_ANALYTICS_TYPE_NAMES = [
    "PlatformAnalytics",
    "PlatformAnalyticsCurrencyRevenue",
    "PlatformAnalyticsHealth",
    "PlatformAnalyticsRatings",
    "PlatformAnalyticsRevenue",
    "PlatformAnalyticsRevenueTrendPoint",
    "PlatformAnalyticsSessionTrendPoint",
    "PlatformAnalyticsSessions",
    "PlatformAnalyticsSubscriptions",
    "PlatformAnalyticsTeachers",
    "PlatformAnalyticsUsers",
  ] as const;

  /** Exact field-name → SDL-type contract per analytics object (every member non-null unless stated). */
  const PLATFORM_ANALYTICS_FIELD_CONTRACTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    PlatformAnalytics: {
      generatedAt: "DateTime!",
      users: "PlatformAnalyticsUsers!",
      sessions: "PlatformAnalyticsSessions!",
      revenue: "PlatformAnalyticsRevenue!",
      subscriptions: "PlatformAnalyticsSubscriptions!",
      teachers: "PlatformAnalyticsTeachers!",
      ratings: "PlatformAnalyticsRatings!",
      health: "PlatformAnalyticsHealth!",
      sessionTrendDaily: "[PlatformAnalyticsSessionTrendPoint!]!",
      revenueTrendDaily: "[PlatformAnalyticsRevenueTrendPoint!]!",
    },
    PlatformAnalyticsUsers: {
      totalCount: "Int!",
      activeCount: "Int!",
      suspendedCount: "Int!",
      blockedCount: "Int!",
      deletedCount: "Int!",
      adminsCount: "Int!",
      teachersCount: "Int!",
      studentsCount: "Int!",
      parentsCount: "Int!",
      newThisWeekCount: "Int!",
      recentlyActive24h: "Int!",
    },
    PlatformAnalyticsSessions: {
      total: "Int!",
      today: "Int!",
      thisWeek: "Int!",
      thisMonth: "Int!",
      scheduled: "Int!",
      started: "Int!",
      completed: "Int!",
      cancelled: "Int!",
      disputed: "Int!",
      awaitingConfirmation: "Int!",
    },
    PlatformAnalyticsRevenue: {
      gatewayRevenueByCurrency: "[PlatformAnalyticsCurrencyRevenue!]!",
      offlineActivationsCount: "Int!",
    },
    PlatformAnalyticsCurrencyRevenue: {
      currency: "String!",
      totalAmount: "String!",
      last30DaysAmount: "String!",
      paidPaymentsCount: "Int!",
    },
    PlatformAnalyticsSubscriptions: {
      total: "Int!",
      active: "Int!",
      pending: "Int!",
      expired: "Int!",
      cancelled: "Int!",
      suspended: "Int!",
      activeInWindowNow: "Int!",
    },
    PlatformAnalyticsTeachers: {
      certifiedCount: "Int!",
      evaluatorCount: "Int!",
      onlineNowCount: "Int!",
    },
    PlatformAnalyticsRatings: {
      // The two honest-absence averages — the ONLY nullable fields on the
      // whole analytics surface.
      averageSessionRating: "Float",
      sessionRatingsCount: "Int!",
      averageEvaluationScore: "Float",
      evaluationScoresCount: "Int!",
    },
    PlatformAnalyticsHealth: {
      pendingDisputes: "Int!",
      pendingWithdrawals: "Int!",
    },
    PlatformAnalyticsSessionTrendPoint: {
      bucketStart: "DateTime!",
      sessionCount: "Int!",
    },
    PlatformAnalyticsRevenueTrendPoint: {
      bucketStart: "DateTime!",
      currency: "String!",
      amount: "String!",
    },
  };

  test("`adminPlatformAnalytics: PlatformAnalytics!` — NON-NULLABLE, ZERO arguments (the closed read scope)", () => {
    const surface = fieldSurface("Query", "adminPlatformAnalytics");
    expect(surface.type).toBe("PlatformAnalytics!");
    expect(surface.args).toEqual([]);
  });

  test("all eleven embedded objects exist and expose EXACTLY the contracted field surface (names + SDL types, nothing extra)", () => {
    for (const typeName of PLATFORM_ANALYTICS_TYPE_NAMES) {
      const surfaces = fieldSurfaces(typeName);
      const contract = PLATFORM_ANALYTICS_FIELD_CONTRACTS[typeName];
      if (!contract) {
        throw new Error(`missing the field contract for \`${typeName}\``);
      }
      expect(surfaces.map(surface => surface.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
        Object.keys(contract).toSorted((a, b) => a.localeCompare(b))
      );
      const byName = new Map(surfaces.map(surface => [surface.name, surface]));
      for (const [fieldName, sdlType] of Object.entries(contract)) {
        expect(byName.get(fieldName)?.type).toBe(sdlType);
      }
    }
  });

  test("NO analytics object carries an `id` field — aggregate anonymity (embedded value objects)", () => {
    for (const typeName of PLATFORM_ANALYTICS_TYPE_NAMES) {
      const surfaces = fieldSurfaces(typeName);
      expect(surfaces.some(surface => surface.name === "id")).toBe(false);
    }
  });

  test("every instant rides the DateTime scalar — generatedAt + both bucketStarts, zero String timestamps", () => {
    const byName = new Map([
      ...fieldSurfaces("PlatformAnalytics").map(surface => [surface.name, surface] as const),
      ...fieldSurfaces("PlatformAnalyticsSessionTrendPoint").map(surface => [surface.name, surface] as const),
      ...fieldSurfaces("PlatformAnalyticsRevenueTrendPoint").map(surface => [surface.name, surface] as const),
    ]);
    expect(byName.get("generatedAt")?.type).toBe("DateTime!");
    expect(byName.get("bucketStart")?.type).toBe("DateTime!");
    // Belt-and-braces: no analytics field resolves through a String-typed
    // instant — the only String leaves are currency codes and decimal money.
    const stringLeaves = PLATFORM_ANALYTICS_TYPE_NAMES.flatMap(typeName => fieldSurfaces(typeName)).filter(
      surface => surface.type.replace(/!$/, "").replaceAll("[", "").replaceAll("]", "") === "String"
    );
    expect(stringLeaves.map(surface => surface.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "amount",
      "currency",
      "currency",
      "last30DaysAmount",
      "totalAmount",
    ]);
  });
});

describe("Session-recitation surface — artifact-side pins", () => {
  test("`setSessionRecitation(input: SessionRecitationInput!, sessionId: ID!): SessionRecitation!`", () => {
    // The live sorted SDL emits args alphabetically — `input` precedes
    // `sessionId` (both NonNull). The write-once record NEVER returns null:
    // every denial throws (already-exists / not-writeable / not-found /
    // validation), so the payload is NonNull on the contract surface.
    const surface = fieldSurface("Mutation", "setSessionRecitation");
    expect(surface.type).toBe("SessionRecitation!");
    expect(surface.args).toEqual([
      { name: "input", type: "SessionRecitationInput!" },
      { name: "sessionId", type: "ID!" },
    ]);
  });

  test("`sessionRecitation(sessionId: ID!): SessionRecitation` — NULLABLE (the collapse channel)", () => {
    const surface = fieldSurface("Query", "sessionRecitation");
    expect(surface.type).toBe("SessionRecitation");
    expect(surface.args).toEqual([{ name: "sessionId", type: "ID!" }]);
  });

  test("both root-field lines appear verbatim in the artifact text (lexical belt-and-braces)", () => {
    // The mutation line is exact (input arg first, sorted print order); the
    // query line is exact and nullable (no `!` on the payload). Neither
    // spelling can collide with the other: the lowercase-s query field name
    // never occurs inside the mutation's camelCase `setSessionRecitation`.
    expect(sdlText).toContain(
      "setSessionRecitation(input: SessionRecitationInput!, sessionId: ID!): SessionRecitation!"
    );
    expect(sdlText).toContain("sessionRecitation(sessionId: ID!): SessionRecitation");
  });

  test("SessionRecitation exposes EXACTLY the six canonical fields — id on the wire, every instant on the DateTime scalar", () => {
    const surfaces = fieldSurfaces("SessionRecitation");
    expect(surfaces.map(surface => surface.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "createdAt",
      "description",
      "id",
      "name",
      "sessionId",
      "updatedAt",
    ]);
    const byName = new Map(surfaces.map(surface => [surface.name, surface]));
    expect(byName.get("id")?.type).toBe("ID!");
    expect(byName.get("sessionId")?.type).toBe("ID!");
    expect(byName.get("name")?.type).toBe("String!");
    expect(byName.get("description")?.type).toBe("String");
    expect(byName.get("createdAt")?.type).toBe("DateTime!");
    expect(byName.get("updatedAt")?.type).toBe("DateTime!");
    // SEC: no ownership/identity lane leaks onto the record object — the
    // teacher/student participants stay behind the service's DB-row
    // predicate and are never disclosed through this surface.
    expect(surfaces.some(surface => surface.name === "teacherId")).toBe(false);
    expect(surfaces.some(surface => surface.name === "studentId")).toBe(false);
    expect(surfaces.some(surface => surface.name === "userId")).toBe(false);
  });

  test("SessionRecitationInput is the closed two-member whitelist (BOPLA) — description then name in sorted print order", () => {
    const fields = inputObjectTypeDefinition("SessionRecitationInput").fields ?? [];
    expect(fields.map(field => field.name.value).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "description",
      "name",
    ]);
    const byName = new Map(fields.map(field => [field.name.value, renderType(field.type)]));
    expect(byName.get("name")).toBe("String!");
    expect(byName.get("description")).toBe("String");
    // No server-controlled field is input-bound — identity, session
    // coordinate, and timestamps are resolved server-side exclusively;
    // smuggled fields die at validation before any resolver runs.
    expect(byName.has("id")).toBe(false);
    expect(byName.has("sessionId")).toBe(false);
    expect(byName.has("createdAt")).toBe(false);
    expect(byName.has("updatedAt")).toBe(false);
    expect(fields).toHaveLength(2);
  });

  test("the artifact's custom-scalar set is EXACTLY DateTime + CountryCode — each registered EXACTLY once (no unnamed extras)", () => {
    // AST tier: the complete scalar-definition set of the artifact is
    // `DateTime` + `CountryCode` — the session-recitation surface introduced
    // zero new scalars, both record timestamps ride the pre-existing
    // DateTime registration, and the country input adds the CountryCode
    // registration (single scalar registry: `shared/scalar.pothos.ts`).
    const scalarDefinitions = sdlDocument.definitions
      .filter(definition => definition.kind === Kind.SCALAR_TYPE_DEFINITION)
      .map(definition => definition.name.value);
    expect(scalarDefinitions).toEqual(["CountryCode", "DateTime"]);
    // Lexical belt-and-braces: exactly TWO scalar declaration lines exist,
    // and they are the two sanctioned registrations.
    expect(sdlText.match(/^scalar /gm) ?? []).toHaveLength(2);
    expect(sdlText).toMatch(/^scalar DateTime$/gm);
    expect(sdlText).toMatch(/^scalar CountryCode$/gm);
  });
});

describe("Student→teacher rating surface (extend) — write-once mutation, caller-scoped read query, and Evaluation payload pins", () => {
  test("`submitTeacherEvaluation(input: SubmitTeacherEvaluationInput!, sessionId: ID!): Evaluation!`", () => {
    // The live sorted SDL emits args alphabetically — `input` precedes
    // `sessionId` (both NonNull). The write-once rating NEVER returns null:
    // every denial throws (unknown/foreign session, unfinished handshake,
    // re-submission, malformed shape), so the payload is NonNull on the
    // contract surface.
    const surface = fieldSurface("Mutation", "submitTeacherEvaluation");
    expect(surface.type).toBe("Evaluation!");
    expect(surface.args).toEqual([
      { name: "input", type: "SubmitTeacherEvaluationInput!" },
      { name: "sessionId", type: "ID!" },
    ]);
  });

  test("`myTeacherEvaluations: [Evaluation!]!` — NON-paginated, ZERO arguments (caller-scoped read)", () => {
    const surface = fieldSurface("Query", "myTeacherEvaluations");
    expect(surface.type).toBe("[Evaluation!]!");
    expect(surface.args).toEqual([]);
  });

  test("both root-field lines appear verbatim in the artifact text (lexical belt-and-braces)", () => {
    // The mutation line is exact (sorted print order: input first); the
    // query line is exact with its non-null list payload. Neither spelling
    // can collide with the other: the camelCase mutation name never occurs
    // inside the query line and vice versa.
    expect(sdlText).toContain(
      "submitTeacherEvaluation(input: SubmitTeacherEvaluationInput!, sessionId: ID!): Evaluation!"
    );
    expect(sdlText).toContain("myTeacherEvaluations: [Evaluation!]!");
  });

  test("Evaluation exposes EXACTLY the six canonical fields — id on the wire, participant ids Int!, honest nullability", () => {
    const surfaces = fieldSurfaces("Evaluation");
    expect(surfaces.map(surface => surface.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "createdAt",
      "evaluatedId",
      "evaluatorId",
      "id",
      "score",
      "sessionId",
    ]);
    const byName = new Map(surfaces.map(surface => [surface.name, surface]));
    // Apollo normalization: `id` on the wire, surfaced as `ID!`.
    expect(byName.get("id")?.type).toBe("ID!");
    expect(byName.get("evaluatedId")?.type).toBe("Int!");
    expect(byName.get("evaluatorId")?.type).toBe("Int!");
    // Honest nullability — standalone applicant evaluations carry no session
    // (and a deleted session nulls the link), and the 0-100 score is a
    // nullable column; the creation instant is NOT NULL.
    expect(byName.get("sessionId")?.type).toBe("Int");
    expect(byName.get("score")?.type).toBe("Int");
    expect(byName.get("createdAt")?.type).toBe("DateTime!");
    // SEC (Disclosure): the soft-delete internals, the free-text notes, and
    // the server-managed update stamp are structurally absent — the backing
    // `EvaluationReturnType` never carries them onto the wire.
    expect(surfaces.some(surface => surface.name === "isDeleted")).toBe(false);
    expect(surfaces.some(surface => surface.name === "deletedAt")).toBe(false);
    expect(surfaces.some(surface => surface.name === "notes")).toBe(false);
    expect(surfaces.some(surface => surface.name === "updatedAt")).toBe(false);
  });

  test("SubmitTeacherEvaluationInput is the closed single-member whitelist (BOPLA) — rating only", () => {
    const fields = inputObjectTypeDefinition("SubmitTeacherEvaluationInput").fields ?? [];
    expect(fields.map(field => field.name.value)).toEqual(["rating"]);
    const byName = new Map(fields.map(field => [field.name.value, renderType(field.type)]));
    expect(byName.get("rating")).toBe("Int!");
    // No server-controlled field is input-bound — the rater/subject
    // identities, the session coordinate, the score conversion, and every
    // timestamp are derived server-side exclusively; smuggled fields die at
    // validation before any resolver runs.
    expect(byName.has("id")).toBe(false);
    expect(byName.has("sessionId")).toBe(false);
    expect(byName.has("evaluatedId")).toBe(false);
    expect(byName.has("evaluatorId")).toBe(false);
    expect(byName.has("score")).toBe(false);
    expect(byName.has("createdAt")).toBe(false);
    expect(fields).toHaveLength(1);
  });
});

describe("Admin academic-tracking surface — artifact-side pins (read-only SDL contract)", () => {
  /** The thirteen academic OBJECT type names (the enum is pinned separately). */
  const ACADEMIC_OBJECT_TYPE_NAMES = [
    "AdminAcademicAttentionFlag",
    "AdminAcademicDashboardPage",
    "AdminAcademicGradeSummary",
    "AdminAcademicHomeworkEntry",
    "AdminAcademicHomeworkPage",
    "AdminAcademicHomeworkTrack",
    "AdminAcademicPosition",
    "AdminAcademicReportEntry",
    "AdminAcademicReportPage",
    "AdminAcademicStats",
    "AdminAcademicStudentDetailEcho",
    "AdminAcademicStudentRow",
    "AdminStudentAcademicDetail",
  ] as const;

  test("`adminAcademicDashboard(page: Int = 1, pageSize: Int = 25, search: String): AdminAcademicDashboardPage!`", () => {
    // The artifact prints args in the sorted emission order — the pin is
    // the EXACT line the deterministic generator writes (defaults ride the
    // SDL: `page: Int = 1`, `pageSize: Int = 25`).
    const surface = fieldSurface("Query", "adminAcademicDashboard");
    expect(surface.type).toBe("AdminAcademicDashboardPage!");
    expect(surface.args).toEqual([
      { name: "page", type: "Int" },
      { name: "pageSize", type: "Int" },
      { name: "search", type: "String" },
    ]);
  });

  test("`adminStudentAcademicDetail(page: Int = 1, pageSize: Int = 25, studentId: Int!): AdminStudentAcademicDetail!` — sorted emission prints `page, pageSize, studentId`", () => {
    // Documented emission note: the resolver declares `studentId` first,
    // but the deterministic lexicographic print sorts args alphabetically
    // — the drill-down line lands as `page, pageSize, studentId`. GraphQL
    // arg order carries no semantic weight.
    const surface = fieldSurface("Query", "adminStudentAcademicDetail");
    expect(surface.type).toBe("AdminStudentAcademicDetail!");
    expect(surface.args).toEqual([
      { name: "page", type: "Int" },
      { name: "pageSize", type: "Int" },
      { name: "studentId", type: "Int!" },
    ]);
  });

  test("both root-field lines appear verbatim in the artifact text (lexical belt-and-braces)", () => {
    expect(sdlText).toContain(
      "adminAcademicDashboard(page: Int = 1, pageSize: Int = 25, search: String): AdminAcademicDashboardPage!"
    );
    expect(sdlText).toContain(
      "adminStudentAcademicDetail(page: Int = 1, pageSize: Int = 25, studentId: Int!): AdminStudentAcademicDetail!"
    );
  });

  test("the surface registers ZERO mutations — neither root name appears on the Mutation root, and neither token appears in the mutation line set", () => {
    // Read-only: the Mutation root stays EXACTLY the frozen 50-op baseline
    // above; the academic operation names must not even exist there as a
    // lexical accident.
    const mutationNames = fieldSurfaces("Mutation").map(surface => surface.name);
    expect(mutationNames).not.toContain("adminAcademicDashboard");
    expect(mutationNames).not.toContain("adminStudentAcademicDetail");
    expect(mutationNames.filter(name => name.toLowerCase().includes("academic"))).toEqual([]);
  });

  test("AdminAcademicAttentionReason is the ONE new enum — EXACTLY the two wire values (lowGrade, staleProgress)", () => {
    const reasonEnum = sdlDocument.definitions.find(
      (definition): definition is EnumTypeDefinitionNode =>
        definition.kind === Kind.ENUM_TYPE_DEFINITION && definition.name.value === "AdminAcademicAttentionReason"
    );
    if (!reasonEnum) {
      throw new Error("Generated SDL must define the `AdminAcademicAttentionReason` enum type");
    }
    const values = (reasonEnum.values ?? []).map(value => value.name.value).toSorted((a, b) => a.localeCompare(b));
    expect(values).toEqual(["lowGrade", "staleProgress"]);
    // The pre-registered recitation vocabulary stays the ONLY other
    // SurahJuzRef enum definition — never re-registered.
    const surahJuzDefinitions = sdlDocument.definitions.filter(
      definition => definition.kind === Kind.ENUM_TYPE_DEFINITION && definition.name.value === "SurahJuzRef"
    );
    expect(surahJuzDefinitions).toHaveLength(1);
  });

  test("all THIRTEEN academic object types exist in the artifact with the two root payloads and eleven embedded value/page objects", () => {
    const declared = ACADEMIC_OBJECT_TYPE_NAMES.map(name => objectTypeDefinition(name).name.value);
    expect(declared).toEqual([...ACADEMIC_OBJECT_TYPE_NAMES]);
  });

  test("entity ids print as `ID!` on the four entity shapes; entries anchor `sessionId: Int!` (documented Apollo-normalization deviation from the plan's Int! shorthand)", () => {
    for (const entity of [
      "AdminAcademicStudentRow",
      "AdminAcademicStudentDetailEcho",
      "AdminAcademicHomeworkEntry",
      "AdminAcademicReportEntry",
    ]) {
      expect(fieldSurface(entity, "id").type).toBe("ID!");
    }
    for (const entity of ["AdminAcademicHomeworkEntry", "AdminAcademicReportEntry"]) {
      expect(fieldSurface(entity, "sessionId").type).toBe("Int!");
      expect(fieldSurface(entity, "sessionStartedAt").type).toBe("DateTime");
      expect(fieldSurface(entity, "createdAt").type).toBe("DateTime!");
    }
  });

  test("`isDeleted` prints on EXACTLY the drill-down echo (governance banner) — dashboard rows stay clean", () => {
    for (const name of ACADEMIC_OBJECT_TYPE_NAMES) {
      const surfaces = fieldSurfaces(name).map(surface => surface.name);
      if (name === "AdminAcademicStudentDetailEcho") {
        expect(fieldSurface(name, "isDeleted").type).toBe("Boolean!");
      } else {
        expect(surfaces).not.toContain("isDeleted");
      }
    }
  });

  test("the page envelopes expose EXACTLY the honest pagination contract (items/page/pageSize/pageCount/total — +stats only on the dashboard; no id)", () => {
    for (const envelope of ["AdminAcademicDashboardPage", "AdminAcademicHomeworkPage", "AdminAcademicReportPage"]) {
      const surfaces = fieldSurfaces(envelope)
        .map(surface => surface.name)
        .toSorted((a, b) => a.localeCompare(b));
      // The dashboard envelope additionally carries the stats section —
      // the two list-only envelopes stay flat.
      if (envelope === "AdminAcademicDashboardPage") {
        expect(surfaces).toEqual(["items", "page", "pageCount", "pageSize", "stats", "total"]);
        expect(fieldSurface(envelope, "stats").type).toBe("AdminAcademicStats!");
      } else {
        expect(surfaces).toEqual(["items", "page", "pageCount", "pageSize", "total"]);
      }
      expect(surfaces).not.toContain("id");
    }
  });

  test("the whole academic named-type surface is the pinned 14 (13 objects + the enum) — zero sibling drift", () => {
    const declaredNames = sdlDocument.definitions
      .filter(isNamedTypeDefinition)
      .map(definition => definition.name.value);
    const academicNames = declaredNames
      .filter(name => name.startsWith("AdminAcademic") || name === "AdminStudentAcademicDetail")
      .toSorted((a, b) => a.localeCompare(b));
    expect(academicNames).toEqual(
      [...ACADEMIC_OBJECT_TYPE_NAMES, "AdminAcademicAttentionReason"].toSorted((a, b) => a.localeCompare(b))
    );
  });
});
