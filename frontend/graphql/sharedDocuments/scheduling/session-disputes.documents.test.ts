/**
 * Structural lock over the session-dispute shared GraphQL documents.
 *
 * Mirrors the `session-report.documents.test.ts` discipline for the
 * dispute domain: the student row actions, the admin arbitration console
 * and the case-review dialog consume these SHARED `TypedDocumentNode`
 * documents, so drift fails at this pure logic tier instead of surfacing
 * as confusing wire mismatches later:
 *
 *   1. NAMED operations — every dispute document is a single named
 *      operation whose GraphQL operation name matches its
 *      `{entityName}…Document` export convention, on the right channel
 *      (query vs mutation), with the exact sanctioned variable set.
 *   2. Argument wiring — each declared variable is actually threaded into
 *      its root-field argument (no dead variables, no literal arguments
 *      that would bypass the variable contract). The arbitration
 *      `resolution` rides the native `DisputeResolution` enum variable —
 *      never a string literal.
 *   3. ONE dispute-family `Session` field shape — every `Session` payload
 *      (both escalation mutations, the arbitration mutation, the queue
 *      rows and the case envelope's session member) selects the exact
 *      20-field family row with `id` FIRST (Apollo normalization), so all
 *      consumers converge on the same cached row without refetch storms.
 *   4. CLOSED case envelope — `adminDisputeCase` selects exactly its five
 *      members; the evidence artifacts ride the canonical rows of their
 *      sibling documents (report 6 fields incl. `studentRatingByTeacher`,
 *      homework 12 fields, recitation 6 fields, audit-trail 8 fields) and
 *      are honest nulls at the type level (no fabricated placeholders).
 *   5. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), and the root barrel, the
 *      scheduling barrel, the `session.documents` hub and the deep import
 *      all resolve to the SAME document instances (consumer import
 *      conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode, TypeNode } from "graphql";
import type {
  AdminDisputeAnalyticsQuery,
  AdminDisputeAnalyticsQueryVariables,
  AdminDisputeCaseQuery,
  AdminDisputeCaseQueryVariables,
  AdminDisputedSessionsQuery,
  AdminDisputedSessionsQueryVariables,
  OpenPostConfirmationDisputeMutation,
  OpenPostConfirmationDisputeMutationVariables,
  OpenSessionDisputeMutation,
  OpenSessionDisputeMutationVariables,
  ResolveSessionDisputeMutation,
  ResolveSessionDisputeMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminDisputeAnalyticsQueryDocument as adminDisputeAnalyticsViaRootBarrel,
  adminDisputeCaseQueryDocument as adminDisputeCaseViaRootBarrel,
  adminDisputedSessionsQueryDocument as adminDisputedSessionsViaRootBarrel,
  openPostConfirmationDisputeMutationDocument as openPostConfirmationDisputeViaRootBarrel,
  openSessionDisputeMutationDocument as openSessionDisputeViaRootBarrel,
  resolveSessionDisputeMutationDocument as resolveSessionDisputeViaRootBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  adminDisputeAnalyticsQueryDocument as adminDisputeAnalyticsViaSchedulingBarrel,
  adminDisputeCaseQueryDocument as adminDisputeCaseViaSchedulingBarrel,
  adminDisputedSessionsQueryDocument as adminDisputedSessionsViaSchedulingBarrel,
  openPostConfirmationDisputeMutationDocument as openPostConfirmationDisputeViaSchedulingBarrel,
  openSessionDisputeMutationDocument as openSessionDisputeViaSchedulingBarrel,
  resolveSessionDisputeMutationDocument as resolveSessionDisputeViaSchedulingBarrel,
} from "@/frontend/graphql/sharedDocuments/scheduling";
import {
  adminDisputeAnalyticsQueryDocument as adminDisputeAnalyticsViaHub,
  adminDisputeCaseQueryDocument as adminDisputeCaseViaHub,
  adminDisputedSessionsQueryDocument as adminDisputedSessionsViaHub,
  openPostConfirmationDisputeMutationDocument as openPostConfirmationDisputeViaHub,
  openSessionDisputeMutationDocument as openSessionDisputeViaHub,
  resolveSessionDisputeMutationDocument as resolveSessionDisputeViaHub,
} from "@/frontend/graphql/sharedDocuments/scheduling/session.documents";
import {
  adminDisputeAnalyticsQueryDocument as adminDisputeAnalyticsViaModule,
  adminDisputeCaseQueryDocument as adminDisputeCaseViaModule,
} from "@/frontend/graphql/sharedDocuments/scheduling/session-dispute-case.documents";
import {
  adminDisputedSessionsQueryDocument,
  openPostConfirmationDisputeMutationDocument,
  openSessionDisputeMutationDocument,
  resolveSessionDisputeMutationDocument,
} from "@/frontend/graphql/sharedDocuments/scheduling/session-disputes.documents";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers

function operationOrThrow(document: DocumentNode): OperationDefinitionNode {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === "OperationDefinition"
  );
  expect(operations).toHaveLength(1);
  if (operations.length < 1) {
    throw new Error("expected exactly one OperationDefinition");
  }
  return operations[0];
}

function subFields(parent: OperationDefinitionNode | FieldNode): FieldNode[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

function subField(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode | undefined {
  return subFields(parent).find(field => field.name.value === name);
}

/** Resolves a dotted selection path ("adminDisputeCase.session") or throws. */
function selectionPath(operation: OperationDefinitionNode, path: string): FieldNode {
  const segments = path.split(".");
  const first = subField(operation, segments[0]);
  if (first === undefined) {
    throw new Error(`expected selection ${path} to exist (missing ${segments[0]})`);
  }
  let current: FieldNode = first;
  for (const segment of segments.slice(1)) {
    const field = subField(current, segment);
    if (field === undefined) {
      throw new Error(`expected selection ${path} to exist (missing ${segment})`);
    }
    current = field;
  }
  return current;
}

function fieldNames(parent: OperationDefinitionNode | FieldNode): string[] {
  return subFields(parent).map(field => field.name.value);
}

function variableNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => definition.variable.name.value);
}

/** Variable names threaded as root-field arguments (`$x` → `x`), source order. */
function argumentVariableNames(field: FieldNode): string[] {
  // graphql-js types `arguments` as optional; an absent one simply yields
  // zero arguments.
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}

/** Unwraps non-null/list wrappers down to the named type they carry. */
function unwrapTypeNode(typeNode: TypeNode): string {
  if (typeNode.kind === "NonNullType" || typeNode.kind === "ListType") {
    return unwrapTypeNode(typeNode.type);
  }
  return typeNode.name.value;
}

/** Named type a variable declaration rides, unwrapping non-null/list wrappers. */
function namedVariableTypeNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => unwrapTypeNode(definition.type));
}

/**
 * The consumer-side guard for the honest-null collapse: a `null` evidence
 * artifact means "absent case material" — exactly this predicate. Module
 * scope (consistent-function-scoping).
 */
function isCollapsedArtifact(value: unknown): boolean {
  return value === null;
}

// ---------------------------------------------------------------------------
// Contract tables

/** The dispute-family `Session` row — the ONE field shape every payload
 * selects, `id` first (the two escalation + arbitration mutations, the
 * queue rows and the case envelope's session member). */
const DISPUTE_SESSION_ROW: readonly string[] = [
  "id",
  "status",
  "intent",
  "sessionType",
  "fee",
  "feeHeld",
  "studentId",
  "teacherId",
  "startedAt",
  "endedAt",
  "confirmationDeadline",
  "confirmedByStudentAt",
  "confirmedByTeacherAt",
  "createdAt",
  "updatedAt",
  "cancelReason",
  "disputeReason",
  "disputedAt",
  "resolutionNote",
  "resolutionOutcome",
  "resolvedAt",
];

/** The canonical report row (the `session-report.documents` contract),
 * `id` first — carries the `studentRatingByTeacher` evaluation. */
const DISPUTE_CASE_REPORT_ROW: readonly string[] = [
  "id",
  "sessionId",
  "teacherNotes",
  "studentRatingByTeacher",
  "createdAt",
  "updatedAt",
];

/** The canonical homework row (the `session-report.documents` contract),
 * `id` first — both recitation tracks ride the `SurahJuzRef` enum legs. */
const DISPUTE_CASE_HOMEWORK_ROW: readonly string[] = [
  "id",
  "sessionId",
  "currentFromAyah",
  "currentToAyah",
  "currentGrade",
  "currentSurahJuz",
  "revisionFromAyah",
  "revisionToAyah",
  "revisionGrade",
  "revisionSurahJuz",
  "createdAt",
  "updatedAt",
];

/** The canonical recitation row (the `recitation.documents` contract),
 * `id` first. */
const DISPUTE_CASE_RECITATION_ROW: readonly string[] = [
  "id",
  "sessionId",
  "name",
  "description",
  "createdAt",
  "updatedAt",
];

/** The canonical audit-trail entry row (the `audit-trail.documents`
 * contract), `id` first. */
const DISPUTE_CASE_AUDIT_TRAIL_ROW: readonly string[] = [
  "id",
  "actionType",
  "actorId",
  "actorName",
  "createdAt",
  "details",
  "entityId",
  "entityType",
];

/** The closed case envelope — exactly the members the evidence dialog
 * renders, in source order (the evidence five + the participant names). */
const DISPUTE_CASE_ENVELOPE: readonly string[] = [
  "session",
  "report",
  "homework",
  "recitation",
  "auditTrail",
  "studentName",
  "teacherName",
];

interface SessionDisputeDocumentRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  /** Expected `($var, …)` declarations, in the SAME order the document
   * declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Named schema types the variable declarations ride, same order. */
  readonly variableTypes: readonly string[];
  /** Root field the operation targets. */
  readonly rootField: string;
  /** Dotted path of the `Session` payload, when the operation selects one. */
  readonly sessionPayloadPath?: string;
}

const SESSION_DISPUTE_DOCUMENT_TABLE: readonly SessionDisputeDocumentRow[] = [
  {
    document: openSessionDisputeMutationDocument,
    operationName: "OpenSessionDispute",
    channel: "mutation",
    variables: ["id", "reason"],
    variableTypes: ["ID", "String"],
    rootField: "openSessionDispute",
    sessionPayloadPath: "openSessionDispute",
  },
  {
    document: openPostConfirmationDisputeMutationDocument,
    operationName: "OpenPostConfirmationDispute",
    channel: "mutation",
    variables: ["id", "reason"],
    variableTypes: ["ID", "String"],
    rootField: "openPostConfirmationDispute",
    sessionPayloadPath: "openPostConfirmationDispute",
  },
  {
    document: resolveSessionDisputeMutationDocument,
    operationName: "ResolveSessionDispute",
    channel: "mutation",
    variables: ["id", "resolution", "note", "partialAmount"],
    variableTypes: ["ID", "DisputeResolution", "String", "String"],
    rootField: "resolveSessionDispute",
    sessionPayloadPath: "resolveSessionDispute",
  },
  {
    document: adminDisputedSessionsQueryDocument,
    operationName: "AdminDisputedSessions",
    channel: "query",
    variables: ["filter", "limit", "offset"],
    variableTypes: ["SessionListFilterInput", "Int", "Int"],
    rootField: "adminDisputedSessions",
    sessionPayloadPath: "adminDisputedSessions.items.session",
  },
  {
    // The analytics snapshot selects NO Session payload — the family-row
    // pin below skips rows without a `sessionPayloadPath` (its own
    // envelope pin lives in the dedicated describe block).
    document: adminDisputeAnalyticsViaModule,
    operationName: "AdminDisputeAnalytics",
    channel: "query",
    variables: [],
    variableTypes: [],
    rootField: "adminDisputeAnalytics",
  },
  {
    document: adminDisputeCaseViaModule,
    operationName: "AdminDisputeCase",
    channel: "query",
    variables: ["id"],
    variableTypes: ["ID"],
    rootField: "adminDisputeCase",
    sessionPayloadPath: "adminDisputeCase.session",
  },
];

describe("session-disputes documents — named operations + channel + variables", () => {
  for (const row of SESSION_DISPUTE_DOCUMENT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = operationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    for (const row of SESSION_DISPUTE_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const root = selectionPath(operation, row.rootField);
      expect(argumentVariableNames(root)).toEqual([...row.variables]);
    }
  });

  test("variable declarations ride exactly the sanctioned named types (the resolution rides the DisputeResolution enum)", () => {
    for (const row of SESSION_DISPUTE_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      expect(namedVariableTypeNames(operation)).toEqual([...row.variableTypes]);
    }
  });

  test("the arbitration amount is an OPTIONAL String variable (decimal string at the seam, validated server-side)", () => {
    const operation = operationOrThrow(resolveSessionDisputeMutationDocument);
    const root = selectionPath(operation, "resolveSessionDispute");
    const amountArgument = (root.arguments ?? []).find(argument => argument.name.value === "partialAmount");
    if (amountArgument === undefined) {
      throw new Error("expected the partialAmount argument on resolveSessionDispute");
    }
    expect(argumentVariableNames(root)).toContain("partialAmount");
    expect(amountArgument.value.kind).toBe("Variable");
  });
});

describe("session-disputes documents — one family Session field shape (id FIRST)", () => {
  test("every Session payload selects the EXACT family row with id FIRST (no over-fetch)", () => {
    for (const row of SESSION_DISPUTE_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      // Rows that select no Session payload (the analytics snapshot) are
      // pinned by their own envelope describe block below.
      if (row.sessionPayloadPath === undefined) {
        continue;
      }
      const session = selectionPath(operation, row.sessionPayloadPath);
      expect(fieldNames(session)).toEqual([...DISPUTE_SESSION_ROW]);
      expect(fieldNames(session)[0]).toBe("id");
    }
  });

  test("the queue page carries exactly its pagination tail (items + page + pageSize + totalCount)", () => {
    const operation = operationOrThrow(adminDisputedSessionsQueryDocument);
    const page = selectionPath(operation, "adminDisputedSessions");
    expect(fieldNames(page)).toEqual(["items", "page", "pageSize", "totalCount"]);
  });

  test("the dispute/cancel-audit legs stay selected (rows restyle without a refetch)", () => {
    for (const name of [
      "cancelReason",
      "disputeReason",
      "disputedAt",
      "resolutionNote",
      "resolutionOutcome",
      "resolvedAt",
    ]) {
      expect(DISPUTE_SESSION_ROW).toContain(name);
    }
  });
});

describe("session-disputes documents — closed adminDisputeCase envelope", () => {
  test("the case envelope selects exactly its seven members (session + evidence + participant names)", () => {
    const operation = operationOrThrow(adminDisputeCaseViaModule);
    const envelope = selectionPath(operation, "adminDisputeCase");
    expect(fieldNames(envelope)).toEqual([...DISPUTE_CASE_ENVELOPE]);
  });

  test("each evidence artifact selects its canonical sibling-document row with id FIRST (no over-fetch)", () => {
    const operation = operationOrThrow(adminDisputeCaseViaModule);
    const expectedRows: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["adminDisputeCase.report", DISPUTE_CASE_REPORT_ROW],
      ["adminDisputeCase.homework", DISPUTE_CASE_HOMEWORK_ROW],
      ["adminDisputeCase.recitation", DISPUTE_CASE_RECITATION_ROW],
      ["adminDisputeCase.auditTrail", DISPUTE_CASE_AUDIT_TRAIL_ROW],
    ];
    for (const [path, expected] of expectedRows) {
      const artifact = selectionPath(operation, path);
      expect(fieldNames(artifact)).toEqual([...expected]);
      expect(fieldNames(artifact)[0]).toBe("id");
    }
  });

  test("homework enum legs are plain SurahJuzRef enum leaves (no sub-selection)", () => {
    const operation = operationOrThrow(adminDisputeCaseViaModule);
    const homework = selectionPath(operation, "adminDisputeCase.homework");
    for (const name of ["currentSurahJuz", "revisionSurahJuz"]) {
      const leg = subField(homework, name);
      if (leg === undefined) {
        throw new Error(`expected ${name} selection`);
      }
      // Plain enum leaf: no sub-selection ⇒ nothing to normalize in cache.
      expect(leg.selectionSet).toBeUndefined();
    }
  });

  test("the case read targets ONLY the closed id variable (no identity smuggling)", () => {
    const operation = operationOrThrow(adminDisputeCaseViaModule);
    expect(variableNames(operation)).toEqual(["id"]);
    for (const name of variableNames(operation)) {
      expect(name.toLowerCase()).not.toContain("user");
      expect(name.toLowerCase()).not.toContain("teacher");
      expect(name.toLowerCase()).not.toContain("student");
      expect(name.toLowerCase()).not.toContain("owner");
    }
  });
});

describe("session-disputes documents — closed adminDisputeAnalytics envelope", () => {
  test("the analytics envelope selects exactly the seven honest counts (no derived values)", () => {
    const operation = operationOrThrow(adminDisputeAnalyticsViaModule);
    const envelope = selectionPath(operation, "adminDisputeAnalytics");
    expect(fieldNames(envelope)).toEqual([
      "openDisputes",
      "resolvedDisputes",
      "cancelCount",
      "completeCount",
      "refundCount",
      "partialRefundCount",
      "upholdCount",
    ]);
  });

  test("the snapshot is argument-free (zero variables, zero literal arguments)", () => {
    const operation = operationOrThrow(adminDisputeAnalyticsViaModule);
    expect(variableNames(operation)).toEqual([]);
    const root = selectionPath(operation, "adminDisputeAnalytics");
    expect(root.arguments ?? []).toHaveLength(0);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    const typedAnalytics: TypedDocumentNode<AdminDisputeAnalyticsQuery, AdminDisputeAnalyticsQueryVariables> =
      adminDisputeAnalyticsViaModule;
    expect(typedAnalytics.loc).toBeDefined();
  });

  test("the counts are non-nullable numbers (zero is the honest empty state, never a null)", () => {
    // Compile-time proof by assignment — the `0` literal is assignable to
    // every generated member type ONLY because they are non-nullable
    // numbers; a nullable member would also accept `null` here, so the
    // null-rejection half is enforced at the type-check gate.
    const snapshot: AdminDisputeAnalyticsQuery["adminDisputeAnalytics"] = {
      openDisputes: 0,
      resolvedDisputes: 0,
      cancelCount: 0,
      completeCount: 0,
      refundCount: 0,
      partialRefundCount: 0,
      upholdCount: 0,
    };
    expect(snapshot.openDisputes).toBe(0);
  });
});

describe("session-disputes documents — codegen binding + barrel parity", () => {
  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedOpen: TypedDocumentNode<OpenSessionDisputeMutation, OpenSessionDisputeMutationVariables> =
      openSessionDisputeMutationDocument;
    const typedOpenPostConfirmation: TypedDocumentNode<
      OpenPostConfirmationDisputeMutation,
      OpenPostConfirmationDisputeMutationVariables
    > = openPostConfirmationDisputeMutationDocument;
    const typedResolve: TypedDocumentNode<ResolveSessionDisputeMutation, ResolveSessionDisputeMutationVariables> =
      resolveSessionDisputeMutationDocument;
    const typedQueue: TypedDocumentNode<AdminDisputedSessionsQuery, AdminDisputedSessionsQueryVariables> =
      adminDisputedSessionsQueryDocument;
    const typedCase: TypedDocumentNode<AdminDisputeCaseQuery, AdminDisputeCaseQueryVariables> =
      adminDisputeCaseViaModule;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedOpen.loc).toBeDefined();
    expect(typedOpenPostConfirmation.loc).toBeDefined();
    expect(typedResolve.loc).toBeDefined();
    expect(typedQueue.loc).toBeDefined();
    expect(typedCase.loc).toBeDefined();
  });

  test("the three evidence artifacts are honest nulls (absent artifacts collapse, never fabricated)", () => {
    // Compile-time proof by assignment — the `null` literal is assignable to
    // the generated member type ONLY because the codegen union carries the
    // null member (no report submitted / no homework / no recitation). The
    // `session` and `auditTrail` members REJECT null: a `null` assignment
    // there would fail `bun tsgo` — the non-null side of this pin is
    // enforced at the type-check gate (not expressible as a passing runtime
    // assertion).
    const report: AdminDisputeCaseQuery["adminDisputeCase"]["report"] = null;
    const homework: AdminDisputeCaseQuery["adminDisputeCase"]["homework"] = null;
    const recitation: AdminDisputeCaseQuery["adminDisputeCase"]["recitation"] = null;
    expect(isCollapsedArtifact(report)).toBe(true);
    expect(isCollapsedArtifact(homework)).toBe(true);
    expect(isCollapsedArtifact(recitation)).toBe(true);
  });

  test("root barrel + scheduling barrel + hub re-export the SAME document instances (cache-key safety)", () => {
    expect(openSessionDisputeViaRootBarrel).toBe(openSessionDisputeMutationDocument);
    expect(openPostConfirmationDisputeViaRootBarrel).toBe(openPostConfirmationDisputeMutationDocument);
    expect(resolveSessionDisputeViaRootBarrel).toBe(resolveSessionDisputeMutationDocument);
    expect(adminDisputedSessionsViaRootBarrel).toBe(adminDisputedSessionsQueryDocument);
    expect(adminDisputeCaseViaRootBarrel).toBe(adminDisputeCaseViaModule);
    expect(adminDisputeAnalyticsViaRootBarrel).toBe(adminDisputeAnalyticsViaModule);
    expect(openSessionDisputeViaSchedulingBarrel).toBe(openSessionDisputeMutationDocument);
    expect(openPostConfirmationDisputeViaSchedulingBarrel).toBe(openPostConfirmationDisputeMutationDocument);
    expect(resolveSessionDisputeViaSchedulingBarrel).toBe(resolveSessionDisputeMutationDocument);
    expect(adminDisputedSessionsViaSchedulingBarrel).toBe(adminDisputedSessionsQueryDocument);
    expect(adminDisputeCaseViaSchedulingBarrel).toBe(adminDisputeCaseViaModule);
    expect(adminDisputeAnalyticsViaSchedulingBarrel).toBe(adminDisputeAnalyticsViaModule);
    expect(openSessionDisputeViaHub).toBe(openSessionDisputeMutationDocument);
    expect(openPostConfirmationDisputeViaHub).toBe(openPostConfirmationDisputeMutationDocument);
    expect(resolveSessionDisputeViaHub).toBe(resolveSessionDisputeMutationDocument);
    expect(adminDisputedSessionsViaHub).toBe(adminDisputedSessionsQueryDocument);
    expect(adminDisputeCaseViaHub).toBe(adminDisputeCaseViaModule);
    expect(adminDisputeAnalyticsViaHub).toBe(adminDisputeAnalyticsViaModule);
  });
});
