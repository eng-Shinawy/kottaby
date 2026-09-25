/**
 * Structural lock over the admin academic-tracking shared GraphQL documents.
 *
 * Mirrors the `admin-finance.documents.test.ts` discipline for the
 * academic-tracking domain: the dashboard and drill-down containers consume
 * these SHARED `TypedDocumentNode` documents, so drift fails at this pure
 * logic tier instead of surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operations — one named query per document whose GraphQL
 *      operation name matches the `{entityName}…Document` export convention.
 *   2. Variable wiring — the declared variable set is EXACTLY the sanctioned
 *      set (source order) and every declared variable is threaded into its
 *      root-field argument (no dead variables, no literal arguments that
 *      would bypass the variable contract). No caller-identity argument
 *      exists anywhere — the actor is derived server-side from the
 *      authenticated caller (read-only surface, zero mutations).
 *   3. `id` field requirement — every entity selection that carries an `id`
 *      (`AdminAcademicStudentRow` rows, `AdminAcademicStudentDetailEcho`,
 *      `AdminAcademicHomeworkEntry` rows, `AdminAcademicReportEntry` rows)
 *      selects `id` FIRST so Apollo normalizes the cache entries; the
 *      id-less wrapper/value types (`AdminAcademicDashboardPage`,
 *      `AdminAcademicStats`, `AdminAcademicPosition`,
 *      `AdminAcademicGradeSummary`, `AdminAcademicAttentionFlag`,
 *      `AdminStudentAcademicDetail`, `AdminAcademicHomeworkPage`,
 *      `AdminAcademicHomeworkTrack`, `AdminAcademicReportPage`) are
 *      embedded value types (`keyFields: false` in
 *      `frontend/providers/apollo/apolloCache.ts`) and correctly select no
 *      `id`.
 *   4. Codegen binding + barrel parity — every constant stays
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment) and the admin documents barrel
 *      re-exports the SAME document instances as the deep imports (consumer
 *      import conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only the already-compiled
 * AST through graphql kind-guard narrowing — no unsafe assertions anywhere.
 * NO useLazyQuery exists anywhere in the documents layer; consumers import
 * hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { FieldNode, OperationDefinitionNode } from "graphql";
import type {
  AdminAcademicDashboardQuery,
  AdminAcademicDashboardQueryVariables,
  AdminStudentAcademicDetailQuery,
  AdminStudentAcademicDetailQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminAcademicDashboardQueryDocument as adminAcademicDashboardViaBarrel,
  adminStudentAcademicDetailQueryDocument as adminStudentAcademicDetailViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  adminAcademicDashboardQueryDocument,
  adminStudentAcademicDetailQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin/academic-tracking.documents";
import {
  argumentVariableNames,
  fieldNames,
  operationOrThrow,
  selectionPath,
  subField,
  variableNames,
} from "@/frontend/graphql/sharedDocuments/document-test-kit";

// ---------------------------------------------------------------------------
// Contract pins

/** Dashboard row selection, `id` FIRST (Apollo cache normalization). */
const DASHBOARD_ROW_FIELDS = [
  "id",
  "fullName",
  "email",
  "latestJadidPosition",
  "latestMadiPosition",
  "jadidGradeSummary",
  "madiGradeSummary",
  "progressRowCount",
  "lastGradedHomeworkAt",
  "needsAttention",
] as const;

/** Advancement statistics block. */
const STATS_FIELDS = [
  "trackedStudentCount",
  "studentsWithGradedHomeworkCount",
  "averageJadidGrade",
  "averageMadiGrade",
  "needingAttentionCount",
] as const;

/** Drill-down student echo, `id` FIRST + the soft-delete marker. */
const DETAIL_ECHO_FIELDS = ["id", "fullName", "email", "isDeleted"] as const;

/** Homework history entry, `id` FIRST + session anchor + both tracks. */
const HOMEWORK_ENTRY_FIELDS = [
  "id",
  "sessionId",
  "sessionStartedAt",
  "teacherName",
  "jadid",
  "madi",
  "createdAt",
] as const;

/** Session-report history entry, `id` FIRST + notes + rating. */
const REPORT_ENTRY_FIELDS = [
  "id",
  "sessionId",
  "sessionStartedAt",
  "teacherName",
  "teacherNotes",
  "studentRatingByTeacher",
  "createdAt",
] as const;

/** Honest pagination envelope shared by both history pages. */
const PAGE_ENVELOPE_FIELDS = ["items", "total", "page", "pageSize", "pageCount"] as const;

/** Per-track position value object (no id — embedded). */
const POSITION_FIELDS = ["surahJuz", "fromAyah", "toAyah"] as const;

/** Per-track grade summary value object (no id — embedded). */
const GRADE_SUMMARY_FIELDS = ["gradedCount", "averageGrade"] as const;

/** Homework track block value object (no id — embedded). */
const HOMEWORK_TRACK_FIELDS = ["surahJuz", "fromAyah", "toAyah", "grade"] as const;

// ---------------------------------------------------------------------------
// Local AST helpers (beyond the shared kit)

/** Declared variable names as an ordered name → (non-null) type-name map. */
function variableTypeNames(operation: OperationDefinitionNode): Map<string, string> {
  const types = new Map<string, string>();
  for (const definition of operation.variableDefinitions ?? []) {
    let type = definition.type;
    if (type.kind === "NonNullType") {
      type = type.type;
    }
    if (type.kind !== "NamedType") {
      throw new Error(`variable ${definition.variable.name.value} must be a named type`);
    }
    types.set(definition.variable.name.value, type.name.value);
  }
  return types;
}

/** FieldNode of a sub-selection whose presence is part of the contract. */
function subFieldOrThrow(parent: FieldNode, name: string): FieldNode {
  const field = subField(parent, name);
  if (field === undefined) {
    throw new Error(`expected selection ${name} to exist`);
  }
  return field;
}

// ---------------------------------------------------------------------------
// Contract pins

describe("academic-tracking documents — named operations + variables", () => {
  test("AdminAcademicDashboard is a single named query with the exact sanctioned variable set", () => {
    const operation = operationOrThrow(adminAcademicDashboardQueryDocument);
    expect(operation.name?.value).toBe("AdminAcademicDashboard");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual(["page", "pageSize", "search"]);
    const types = variableTypeNames(operation);
    expect(types.get("page")).toBe("Int");
    expect(types.get("pageSize")).toBe("Int");
    expect(types.get("search")).toBe("String");
  });

  test("AdminStudentAcademicDetail is a single named query with the exact sanctioned variable set", () => {
    const operation = operationOrThrow(adminStudentAcademicDetailQueryDocument);
    expect(operation.name?.value).toBe("AdminStudentAcademicDetail");
    expect(operation.operation).toBe("query");
    expect(variableNames(operation)).toEqual(["studentId", "page", "pageSize"]);
    const types = variableTypeNames(operation);
    expect(types.get("studentId")).toBe("Int");
    expect(types.get("page")).toBe("Int");
    expect(types.get("pageSize")).toBe("Int");
  });

  test("the declared variable surface carries no caller-identity argument (read-only surface)", () => {
    for (const document of [adminAcademicDashboardQueryDocument, adminStudentAcademicDetailQueryDocument]) {
      const names = variableNames(operationOrThrow(document));
      expect(names).not.toContain("actorId");
      expect(names).not.toContain("adminId");
      expect(names).not.toContain("locale");
    }
  });
});

describe("academic-tracking documents — variable wiring into root-field arguments", () => {
  test("every dashboard variable is threaded into its root-field argument (no dead variables)", () => {
    const root = selectionPath(operationOrThrow(adminAcademicDashboardQueryDocument), "adminAcademicDashboard");
    expect(argumentVariableNames(root)).toEqual(["page", "pageSize", "search"]);
  });

  test("every drill-down variable is threaded into its root-field argument (no dead variables)", () => {
    const root = selectionPath(operationOrThrow(adminStudentAcademicDetailQueryDocument), "adminStudentAcademicDetail");
    expect(argumentVariableNames(root)).toEqual(["studentId", "page", "pageSize"]);
  });
});

describe("academic-tracking documents — id + selection shapes", () => {
  test("the dashboard row selects the full row with id first", () => {
    const operation = operationOrThrow(adminAcademicDashboardQueryDocument);
    const row = selectionPath(operation, "adminAcademicDashboard.items");
    expect(fieldNames(row)).toEqual([...DASHBOARD_ROW_FIELDS]);
    expect(fieldNames(row)[0]).toBe("id");
  });

  test("each latest-position slot selects the surah/juz reference triple and no id (embedded value)", () => {
    const operation = operationOrThrow(adminAcademicDashboardQueryDocument);
    for (const slot of ["latestJadidPosition", "latestMadiPosition"]) {
      const position = subFieldOrThrow(selectionPath(operation, "adminAcademicDashboard.items"), slot);
      expect(fieldNames(position)).toEqual([...POSITION_FIELDS]);
      expect(fieldNames(position)).not.toContain("id");
    }
  });

  test("each grade summary selects the honest graded-count/average pair and no id (embedded value)", () => {
    const operation = operationOrThrow(adminAcademicDashboardQueryDocument);
    for (const slot of ["jadidGradeSummary", "madiGradeSummary"]) {
      const summary = subFieldOrThrow(selectionPath(operation, "adminAcademicDashboard.items"), slot);
      expect(fieldNames(summary)).toEqual([...GRADE_SUMMARY_FIELDS]);
      expect(fieldNames(summary)).not.toContain("id");
    }
  });

  test("the attention flag selects only the reason list and no id (embedded value)", () => {
    const operation = operationOrThrow(adminAcademicDashboardQueryDocument);
    const flag = subFieldOrThrow(selectionPath(operation, "adminAcademicDashboard.items"), "needsAttention");
    expect(fieldNames(flag)).toEqual(["reasons"]);
    expect(fieldNames(flag)).not.toContain("id");
  });

  test("the dashboard envelope selects the honest pagination + stats and no id (embedded value)", () => {
    const wrapper = selectionPath(operationOrThrow(adminAcademicDashboardQueryDocument), "adminAcademicDashboard");
    expect(fieldNames(wrapper)).toEqual([...PAGE_ENVELOPE_FIELDS, "stats"]);
    expect(fieldNames(wrapper)).not.toContain("id");
    const stats = subFieldOrThrow(wrapper, "stats");
    expect(fieldNames(stats)).toEqual([...STATS_FIELDS]);
    expect(fieldNames(stats)).not.toContain("id");
  });

  test("the drill-down echo selects the identity + isDeleted marker with id first", () => {
    const operation = operationOrThrow(adminStudentAcademicDetailQueryDocument);
    const echo = selectionPath(operation, "adminStudentAcademicDetail.student");
    expect(fieldNames(echo)).toEqual([...DETAIL_ECHO_FIELDS]);
    expect(fieldNames(echo)[0]).toBe("id");
  });

  test("each homework entry selects the session anchor + both track blocks with id first", () => {
    const operation = operationOrThrow(adminStudentAcademicDetailQueryDocument);
    const entry = selectionPath(operation, "adminStudentAcademicDetail.homeworkPage.items");
    expect(fieldNames(entry)).toEqual([...HOMEWORK_ENTRY_FIELDS]);
    expect(fieldNames(entry)[0]).toBe("id");
    for (const track of ["jadid", "madi"]) {
      const block = subFieldOrThrow(entry, track);
      expect(fieldNames(block)).toEqual([...HOMEWORK_TRACK_FIELDS]);
      expect(fieldNames(block)).not.toContain("id");
    }
  });

  test("each report entry selects the session anchor + notes + rating with id first", () => {
    const operation = operationOrThrow(adminStudentAcademicDetailQueryDocument);
    const entry = selectionPath(operation, "adminStudentAcademicDetail.reportPage.items");
    expect(fieldNames(entry)).toEqual([...REPORT_ENTRY_FIELDS]);
    expect(fieldNames(entry)[0]).toBe("id");
  });

  test("both history envelopes select the honest pagination and no id (embedded values)", () => {
    const operation = operationOrThrow(adminStudentAcademicDetailQueryDocument);
    const root = selectionPath(operation, "adminStudentAcademicDetail");
    for (const pageField of ["homeworkPage", "reportPage"]) {
      const envelope = subFieldOrThrow(root, pageField);
      expect(fieldNames(envelope)).toEqual([...PAGE_ENVELOPE_FIELDS]);
      expect(fieldNames(envelope)).not.toContain("id");
    }
  });

  test("the drill-down payload selects echo + both pages + progress + attention and no id (embedded wrapper)", () => {
    const root = selectionPath(operationOrThrow(adminStudentAcademicDetailQueryDocument), "adminStudentAcademicDetail");
    expect(fieldNames(root)).toEqual(["student", "homeworkPage", "reportPage", "progressRowCount", "needsAttention"]);
    expect(fieldNames(root)).not.toContain("id");
    const flag = subFieldOrThrow(root, "needsAttention");
    expect(fieldNames(flag)).toEqual(["reasons"]);
  });
});

describe("academic-tracking documents — codegen binding + barrel parity", () => {
  test("admin barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(adminAcademicDashboardViaBarrel).toBe(adminAcademicDashboardQueryDocument);
    expect(adminStudentAcademicDetailViaBarrel).toBe(adminStudentAcademicDetailQueryDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if an exported constant
    // loses its codegen typing or picks up an inline type literal.
    const dashboard: TypedDocumentNode<AdminAcademicDashboardQuery, AdminAcademicDashboardQueryVariables> =
      adminAcademicDashboardQueryDocument;
    const detail: TypedDocumentNode<AdminStudentAcademicDetailQuery, AdminStudentAcademicDetailQueryVariables> =
      adminStudentAcademicDetailQueryDocument;

    // Runtime use keeps the bindings from being flagged as unused.
    expect(dashboard.loc).toBeDefined();
    expect(detail.loc).toBeDefined();
  });
});
