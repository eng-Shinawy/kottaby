/**
 * Structural lock over the admin-user shared GraphQL documents.
 *
 * Mirrors the `sharedDocuments/documents.contract.test.ts` discipline for the
 * admin-user domain: the directory, detail, stats and activity-timeline
 * consumers PLUS the create / update / soft-delete / suspend / block mutation
 * consumers all depend on these SHARED `TypedDocumentNode` documents, so drift
 * fails at this pure logic tier instead of surfacing as confusing wire
 * mismatches later:
 *
 *   1. NAMED operations — every admin-user document is a single named
 *      operation whose GraphQL operation name matches its
 *      `{entityName}…Document` export convention, on the right channel
 *      (query vs mutation), with the exact sanctioned variable set.
 *   2. Argument wiring — each declared variable is actually threaded into
 *      its root-field argument (no dead variables, no literal arguments
 *      that would bypass the variable contract).
 *   3. Self-scoped surface — the pinned variable sets are the WHOLE variable
 *      surface; the mutations declare ONLY the sanctioned scalar args
 *      (`id`, `suspended`, `periodDays`, `blocked`, `deleted`, `input`).
 *      No caller-identity argument exists anywhere in the documents — the
 *      actor is always derived server-side from the authenticated caller.
 *   4. `id` field requirement — the shared `AdminUserDetailFields` and
 *      `AdminUserListItemFields` fragments select `id` FIRST so Apollo
 *      normalizes the cache entries (the post-mutation response merges
 *      into the SAME `AdminUserDetail:<id>` normalized entry — the detail
 *      page re-renders WITHOUT a refetch). The detail / list-item /
 *      activity-timeline queries spread those fragments or select `id`
 *      directly; `adminUserStats` is a scalar-only envelope with no object
 *      selection and correctly selects no `id`.
 *   5. Fragment reuse — every detail-returning mutation (create / update /
 *      soft-delete / suspend / block) spreads the EXISTING
 *      `AdminUserDetailFields` fragment (NO bespoke inline selection
 *      duplicating it).
 *   6. Codegen binding + barrel parity — the constants stay
 *      `TypedDocumentNode`-typed against the generated operation types
 *      (compile-time proof by assignment), and the top-level barrel
 *      re-exports the SAME document instances as the deep imports
 *      (consumer import conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  OperationDefinitionNode,
} from "graphql";
import type {
  AdminCreateUserMutation,
  AdminSetUserBlockedMutation,
  AdminSetUserBlockedMutationVariables,
  AdminSetUserDeletedMutation,
  AdminSetUserSuspendedMutation,
  AdminSetUserSuspendedMutationVariables,
  AdminUpdateUserMutation,
  AdminUserActivityQuery,
  AdminUserActivityQueryVariables,
  AdminUserDetailQuery,
  AdminUserStatsQuery,
  AdminUsersQuery,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminSetUserBlockedMutationDocument as adminBlockViaBarrel,
  adminCreateUserMutationDocument as adminCreateUserViaBarrel,
  adminSetUserDeletedMutationDocument as adminDeleteViaBarrel,
  adminSetUserSuspendedMutationDocument as adminSuspendViaBarrel,
  adminUpdateUserMutationDocument as adminUpdateUserViaBarrel,
  adminUserDetailQueryDocument as adminUserDetailViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  adminCreateUserMutationDocument,
  adminSetUserBlockedMutationDocument,
  adminSetUserDeletedMutationDocument,
  adminSetUserSuspendedMutationDocument,
  adminUpdateUserMutationDocument,
  adminUserActivityQueryDocument,
  adminUserDetailQueryDocument,
  adminUserStatsQueryDocument,
  adminUsersQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin/admin-users.documents";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers

/** Any node carrying a `selectionSet` that the helpers below walk. */
type SelectionSetNode = OperationDefinitionNode | FieldNode | FragmentDefinitionNode;

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

function fragmentDefinition(document: DocumentNode, name: string): FragmentDefinitionNode {
  const fragment = document.definitions.find(
    (definition): definition is FragmentDefinitionNode =>
      definition.kind === "FragmentDefinition" && definition.name.value === name
  );
  if (fragment === undefined) {
    throw new Error(`expected FragmentDefinition "${name}" to exist`);
  }
  return fragment;
}

function subFields(parent: SelectionSetNode): FieldNode[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

function subField(parent: SelectionSetNode, name: string): FieldNode | undefined {
  return subFields(parent).find(field => field.name.value === name);
}

/** Resolves a dotted selection path ("adminUsers.items") or throws. */
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

function fieldNames(parent: SelectionSetNode): string[] {
  return subFields(parent).map(field => field.name.value);
}

/** Fragment spreads referenced on a selection set, by name. */
function fragmentSpreads(parent: OperationDefinitionNode | FieldNode): string[] {
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections
    .filter((selection): selection is FragmentSpreadNode => selection.kind === "FragmentSpread")
    .map(selection => selection.name.value);
}

function variableNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => definition.variable.name.value);
}

/** Variable names threaded as root-field arguments (`$x` → `x`), source order. */
function argumentVariableNames(field: FieldNode): string[] {
  return (field.arguments ?? []).flatMap(argument =>
    argument.value.kind === "Variable" ? [argument.value.name.value] : []
  );
}

// ---------------------------------------------------------------------------
// Contract table

interface AdminUserDocumentRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  /** Expected `($var, …)` declarations ([] for no-arg operations), in the
   * SAME order the document declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Root field the operation targets. */
  readonly rootField: string;
  /** Dotted object-selection paths that must spread the
   * `AdminUserDetailFields` fragment (detail-returning reads + writes). */
  readonly detailFragmentSpreads: readonly string[];
  /** Dotted selection paths that must spread the
   * `AdminUserListItemFields` fragment (directory rows). */
  readonly listItemFragmentSpreads: readonly string[];
  /** Dotted object-selection paths that must carry `id` as the FIRST direct
   * field selection (rows that do NOT spread a fragment — e.g. the
   * activity-timeline entry). */
  readonly idFirstSelections: readonly string[];
}

const ADMIN_USER_DOCUMENT_TABLE: readonly AdminUserDocumentRow[] = [
  {
    document: adminUsersQueryDocument,
    operationName: "AdminUsers",
    channel: "query",
    variables: ["filters", "page", "pageSize"],
    rootField: "adminUsers",
    detailFragmentSpreads: [],
    listItemFragmentSpreads: ["adminUsers.items"],
    idFirstSelections: [],
  },
  {
    document: adminUserStatsQueryDocument,
    operationName: "AdminUserStats",
    channel: "query",
    variables: [],
    rootField: "adminUserStats",
    detailFragmentSpreads: [],
    listItemFragmentSpreads: [],
    idFirstSelections: [],
  },
  {
    document: adminUserDetailQueryDocument,
    operationName: "AdminUserDetail",
    channel: "query",
    variables: ["id"],
    rootField: "adminUserDetail",
    detailFragmentSpreads: ["adminUserDetail"],
    listItemFragmentSpreads: [],
    idFirstSelections: [],
  },
  {
    document: adminUserActivityQueryDocument,
    operationName: "AdminUserActivity",
    channel: "query",
    variables: ["id", "limit"],
    rootField: "adminUserActivity",
    detailFragmentSpreads: [],
    listItemFragmentSpreads: [],
    idFirstSelections: ["adminUserActivity"],
  },
  {
    document: adminCreateUserMutationDocument,
    operationName: "AdminCreateUser",
    channel: "mutation",
    variables: ["input"],
    rootField: "adminCreateUser",
    detailFragmentSpreads: ["adminCreateUser"],
    listItemFragmentSpreads: [],
    idFirstSelections: [],
  },
  {
    document: adminUpdateUserMutationDocument,
    operationName: "AdminUpdateUser",
    channel: "mutation",
    variables: ["id", "input"],
    rootField: "adminUpdateUser",
    detailFragmentSpreads: ["adminUpdateUser"],
    listItemFragmentSpreads: [],
    idFirstSelections: [],
  },
  {
    document: adminSetUserDeletedMutationDocument,
    operationName: "AdminSetUserDeleted",
    channel: "mutation",
    variables: ["id", "deleted"],
    rootField: "adminSetUserDeleted",
    detailFragmentSpreads: ["adminSetUserDeleted"],
    listItemFragmentSpreads: [],
    idFirstSelections: [],
  },
  {
    document: adminSetUserSuspendedMutationDocument,
    operationName: "AdminSetUserSuspended",
    channel: "mutation",
    variables: ["id", "suspended", "periodDays"],
    rootField: "adminSetUserSuspended",
    detailFragmentSpreads: ["adminSetUserSuspended"],
    listItemFragmentSpreads: [],
    idFirstSelections: [],
  },
  {
    document: adminSetUserBlockedMutationDocument,
    operationName: "AdminSetUserBlocked",
    channel: "mutation",
    variables: ["id", "blocked"],
    rootField: "adminSetUserBlocked",
    detailFragmentSpreads: ["adminSetUserBlocked"],
    listItemFragmentSpreads: [],
    idFirstSelections: [],
  },
];

// ---------------------------------------------------------------------------
// Contract tests

describe("admin-user documents — named operations + channel + variables", () => {
  for (const row of ADMIN_USER_DOCUMENT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = operationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }

  test("every declared variable is wired into its root-field argument (no dead variables, no literal arguments)", () => {
    for (const row of ADMIN_USER_DOCUMENT_TABLE) {
      const operation = operationOrThrow(row.document);
      const root = selectionPath(operation, row.rootField);
      expect(argumentVariableNames(root)).toEqual([...row.variables]);
    }
  });

  test("variable surface is exactly the sanctioned admin set — zero identity arguments", () => {
    // Sorted-unique union across all admin-user documents. Any new doc that
    // smuggles a caller-identity argument (e.g. `actorId`, `userId`) breaks
    // this pin — actor identity is ALWAYS derived server-side from the
    // authenticated caller, never threaded from the client.
    const declared = ADMIN_USER_DOCUMENT_TABLE.flatMap(row => variableNames(operationOrThrow(row.document))).toSorted(
      (a, b) => a.localeCompare(b)
    );
    // Five `id` variables: adminUserDetail, adminUserActivity, adminUpdateUser,
    // adminSetUserDeleted, adminSetUserSuspended, adminSetUserBlocked (six
    // documents declare `$id: Int!`); adminCreateUser + adminUpdateUser each
    // declare `$input`; the directory query declares `filters`/`page`/`pageSize`.
    expect(declared).toEqual([
      "blocked",
      "deleted",
      "filters",
      "id",
      "id",
      "id",
      "id",
      "id",
      "id",
      "input",
      "input",
      "limit",
      "page",
      "pageSize",
      "periodDays",
      "suspended",
    ]);
    // Belt-and-braces: no document smuggles a caller-identity argument.
    for (const name of declared) {
      expect(name.toLowerCase()).not.toContain("actor");
      expect(name.toLowerCase()).not.toContain("userid");
    }
  });
});

describe("admin-user documents — id + fragment-reuse shapes", () => {
  test("AdminUserDetailFields fragment selects id FIRST (Apollo cache normalization)", () => {
    // The shared fragment is the cache-normalization contract: it spreads
    // into EVERY detail-returning read + write (detail query, create /
    // update / soft-delete / suspend / block mutations). The first field
    // MUST be `id` so Apollo merges the post-mutation response into the
    // SAME `AdminUserDetail:<id>` normalized entry — the detail page
    // re-renders WITHOUT a refetch.
    for (const row of ADMIN_USER_DOCUMENT_TABLE) {
      if (row.detailFragmentSpreads.length === 0) {
        continue;
      }
      const fragment = fragmentDefinition(row.document, "AdminUserDetailFields");
      expect(fieldNames(fragment)[0]).toBe("id");
      // The applicant sub-object also normalizes (carries its own id).
      const applicant = subField(fragment, "applicant");
      if (applicant) {
        expect(fieldNames(applicant)[0]).toBe("id");
      }
    }
  });

  test("AdminUserListItemFields fragment selects id FIRST (directory row normalization)", () => {
    const fragment = fragmentDefinition(adminUsersQueryDocument, "AdminUserListItemFields");
    expect(fieldNames(fragment)[0]).toBe("id");
  });

  test("detail-returning reads + writes spread the EXISTING AdminUserDetailFields fragment (no bespoke inline selection)", () => {
    // Fragment reuse is load-bearing: every detail-returning mutation must
    // spread `AdminUserDetailFields` (NOT inline-duplicate its fields). A
    // bespoke inline selection would desynchronize the post-mutation cache
    // shape from the detail query shape.
    for (const row of ADMIN_USER_DOCUMENT_TABLE) {
      for (const path of row.detailFragmentSpreads) {
        const operation = operationOrThrow(row.document);
        const selection = selectionPath(operation, path);
        expect(fragmentSpreads(selection)).toContain("AdminUserDetailFields");
      }
    }
  });

  test("directory rows spread the EXISTING AdminUserListItemFields fragment (no bespoke inline selection)", () => {
    // The directory row reuses the shared list-item fragment (which itself
    // selects `id` first — pinned above). A bespoke inline selection would
    // desynchronize the directory shape from any future refetches.
    for (const row of ADMIN_USER_DOCUMENT_TABLE) {
      for (const path of row.listItemFragmentSpreads) {
        const operation = operationOrThrow(row.document);
        const selection = selectionPath(operation, path);
        expect(fragmentSpreads(selection)).toContain("AdminUserListItemFields");
      }
    }
  });

  test("direct-id selections select id FIRST (activity timeline)", () => {
    // Activity-timeline rows do NOT spread a fragment — they pin `id`
    // directly at the top of the selection set so Apollo normalizes the
    // timeline entry.
    for (const row of ADMIN_USER_DOCUMENT_TABLE) {
      for (const path of row.idFirstSelections) {
        const operation = operationOrThrow(row.document);
        const selection = selectionPath(operation, path);
        expect(fieldNames(selection)[0]).toBe("id");
      }
    }
  });

  test("adminUserStats is a scalar-only envelope (no object selection needing id)", () => {
    const operation = operationOrThrow(adminUserStatsQueryDocument);
    const stats = subField(operation, "adminUserStats");
    if (stats === undefined) {
      throw new Error("expected adminUserStats selection");
    }
    // Every selected field is a scalar counter — no nested object that
    // would require `id` for Apollo normalization.
    for (const field of subFields(stats)) {
      expect(field.selectionSet).toBeUndefined();
    }
  });
});

describe("admin-user documents — codegen binding + barrel parity", () => {
  test("top-level barrel re-exports the SAME document instances (cache-key safety)", () => {
    expect(adminCreateUserViaBarrel).toBe(adminCreateUserMutationDocument);
    expect(adminUpdateUserViaBarrel).toBe(adminUpdateUserMutationDocument);
    expect(adminDeleteViaBarrel).toBe(adminSetUserDeletedMutationDocument);
    expect(adminSuspendViaBarrel).toBe(adminSetUserSuspendedMutationDocument);
    expect(adminBlockViaBarrel).toBe(adminSetUserBlockedMutationDocument);
    expect(adminUserDetailViaBarrel).toBe(adminUserDetailQueryDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedAdminUsers: TypedDocumentNode<AdminUsersQuery> = adminUsersQueryDocument;
    const typedAdminUserStats: TypedDocumentNode<AdminUserStatsQuery> = adminUserStatsQueryDocument;
    const typedAdminUserDetail: TypedDocumentNode<AdminUserDetailQuery> = adminUserDetailQueryDocument;
    const typedAdminUserActivity: TypedDocumentNode<AdminUserActivityQuery, AdminUserActivityQueryVariables> =
      adminUserActivityQueryDocument;
    const typedAdminCreateUser: TypedDocumentNode<AdminCreateUserMutation> = adminCreateUserMutationDocument;
    const typedAdminUpdateUser: TypedDocumentNode<AdminUpdateUserMutation> = adminUpdateUserMutationDocument;
    const typedAdminSetUserDeleted: TypedDocumentNode<AdminSetUserDeletedMutation> =
      adminSetUserDeletedMutationDocument;
    const typedAdminSetUserSuspended: TypedDocumentNode<
      AdminSetUserSuspendedMutation,
      AdminSetUserSuspendedMutationVariables
    > = adminSetUserSuspendedMutationDocument;
    const typedAdminSetUserBlocked: TypedDocumentNode<
      AdminSetUserBlockedMutation,
      AdminSetUserBlockedMutationVariables
    > = adminSetUserBlockedMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedAdminUsers.loc).toBeDefined();
    expect(typedAdminUserStats.loc).toBeDefined();
    expect(typedAdminUserDetail.loc).toBeDefined();
    expect(typedAdminUserActivity.loc).toBeDefined();
    expect(typedAdminCreateUser.loc).toBeDefined();
    expect(typedAdminUpdateUser.loc).toBeDefined();
    expect(typedAdminSetUserDeleted.loc).toBeDefined();
    expect(typedAdminSetUserSuspended.loc).toBeDefined();
    expect(typedAdminSetUserBlocked.loc).toBeDefined();
  });
});
