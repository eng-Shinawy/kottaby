/**
 * Structural lock over the shared GraphQL documents.
 *
 * The contract/integration suites (`frontend/graphql/test/auth/auth.test.ts`,
 * warning-surfacing) consume the SHARED `TypedDocumentNode` documents from
 * `sharedDocuments/`. This colocated PURE suite pins the document-standard
 * contract those tests depend on, so drift fails at logic tier instead of
 * surfacing as confusing wire mismatches later:
 *
 *   1. NAMED operations — every shared document is a single named operation
 *      whose GraphQL operation name matches its `{entityName}…Document`
 *      export convention (`{EntityName}MutationDocument` ↔ `mutation …`).
 *   2. Channel table — mutations vs queries match `sharedDocuments/AGENTS.md`.
 *   3. Variable wiring — declared variable sets line up with the generated
 *      `…Variables` contracts (input / email+password / locale / refreshToken /
 *      none / the DEV3-004 session lifecycle signatures / the DEV3-013 payout).
 *   4. `id` field requirement — every object-typed selection set the Apollo
 *      cache normalizes (`registerUser`, `me`, `login.user`, `updateMyLocale`,
 *      EVERY DEV3-004 `Session` payload + `SessionPage.items`) selects `id`;
 *      scalar-only payloads (`refreshToken`, `logout`, `recitationReadings`)
 *      correctly select no objects needing one.
 *   5. Barrel parity — deep-import and top-level barrel paths resolve to the
 *      IDENTICAL document instance (consumer import conventions table).
 *
 * Zero server boot, zero DB, zero network: inspects only already-compiled
 * ASTs through graphql kind-guard narrowing — no unsafe assertions anywhere
 * (oxlint `no-unsafe-type-assertion`). NO useLazyQuery exists anywhere in
 * the documents layer; consumers import hooks from "@apollo/client/react".
 */

import { describe, expect, test } from "bun:test";
import type { TypedDocumentNode } from "@apollo/client";
import type { DocumentNode, FieldNode, OperationDefinitionNode } from "graphql";
import type {
  CancelSessionMutation,
  CancelSessionMutationVariables,
  CompleteSessionMutation,
  CompleteSessionMutationVariables,
  CreateSessionMutation,
  CreateSessionMutationVariables,
  LoginMutation,
  LoginMutationVariables,
  LogoutMutation,
  MeQuery,
  MyStudentSessionsQuery,
  MyStudentSessionsQueryVariables,
  MyTeacherSessionsQuery,
  MyTeacherSessionsQueryVariables,
  RecitationReadingsQuery,
  RefreshTokenMutation,
  RefreshTokenMutationVariables,
  RegisterUserMutation,
  RegisterUserMutationVariables,
  SessionByIdQuery,
  SessionByIdQueryVariables,
  StartSessionMutation,
  StartSessionMutationVariables,
  UpdateMyLocaleMutation,
  UpdateMyLocaleMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  registerUserMutationDocument as registerUserViaBarrel,
  sessionByIdQueryDocument as sessionByIdViaBarrel,
} from "@/frontend/graphql/sharedDocuments";
import {
  loginMutationDocument,
  logoutMutationDocument,
  meQueryDocument,
  refreshTokenMutationDocument,
  registerUserMutationDocument,
  updateMyLocaleMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { recitationReadingsQueryDocument } from "@/frontend/graphql/sharedDocuments/auth/recitation.documents";
import {
  cancelSessionMutationDocument,
  completeSessionMutationDocument,
  createSessionMutationDocument,
  myStudentSessionsQueryDocument,
  myTeacherSessionsQueryDocument,
  sessionByIdQueryDocument,
  startSessionMutationDocument,
} from "@/frontend/graphql/sharedDocuments/scheduling/session.documents";

// ---------------------------------------------------------------------------
// Assertion-free AST helpers

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
  // zero field selections (e.g. enum-list leaves like `recitationReadings`).
  const selectionSet = parent.selectionSet;
  if (!selectionSet) {
    return [];
  }
  return selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === "Field");
}

function namedField(parent: OperationDefinitionNode | FieldNode, name: string): FieldNode | undefined {
  return fieldSelections(parent).find(field => field.name.value === name);
}

function selectsId(node: OperationDefinitionNode | FieldNode): boolean {
  return fieldSelections(node).some(field => field.name.value === "id");
}

/** Declared-variable names of one operation, in GraphQL source order. */
function variableNames(operation: OperationDefinitionNode): string[] {
  return (operation.variableDefinitions ?? []).map(definition => definition.variable.name.value);
}

// ---------------------------------------------------------------------------
// Contract tables

interface DocumentContractRow {
  readonly document: DocumentNode;
  readonly operationName: string;
  readonly channel: "mutation" | "query";
  /** Expected `($var, …)` declarations ([] for no-arg operations), listed in
   * the SAME order the document declares them (wire/source order). */
  readonly variables: readonly string[];
  /** Dotted object-selection paths that must carry `id`. */
  readonly objectSelections: readonly string[];
}

const DOCUMENT_CONTRACT_TABLE: readonly DocumentContractRow[] = [
  {
    document: registerUserMutationDocument,
    operationName: "RegisterUser",
    channel: "mutation",
    variables: ["input"],
    objectSelections: ["registerUser"],
  },
  {
    document: loginMutationDocument,
    operationName: "Login",
    channel: "mutation",
    variables: ["email", "password"],
    objectSelections: ["login.user"],
  },
  {
    document: updateMyLocaleMutationDocument,
    operationName: "UpdateMyLocale",
    channel: "mutation",
    variables: ["locale"],
    objectSelections: ["updateMyLocale"],
  },
  {
    document: refreshTokenMutationDocument,
    operationName: "RefreshToken",
    channel: "mutation",
    variables: ["refreshToken"],
    objectSelections: [],
  },
  {
    document: logoutMutationDocument,
    operationName: "Logout",
    channel: "mutation",
    variables: [],
    objectSelections: [],
  },
  {
    document: meQueryDocument,
    operationName: "Me",
    channel: "query",
    variables: [],
    objectSelections: ["me"],
  },
  {
    document: recitationReadingsQueryDocument,
    operationName: "RecitationReadings",
    channel: "query",
    variables: [],
    objectSelections: [],
  },
  // --- DEV3-004 session lifecycle (scheduling/session.documents.ts) ---
  {
    document: sessionByIdQueryDocument,
    operationName: "SessionById",
    channel: "query",
    variables: ["id"],
    objectSelections: ["sessionById"],
  },
  {
    document: myStudentSessionsQueryDocument,
    operationName: "MyStudentSessions",
    channel: "query",
    variables: ["filter", "page", "pageSize"],
    objectSelections: ["myStudentSessions.items"],
  },
  {
    document: myTeacherSessionsQueryDocument,
    operationName: "MyTeacherSessions",
    channel: "query",
    variables: ["filter", "page", "pageSize"],
    objectSelections: ["myTeacherSessions.items"],
  },
  {
    document: createSessionMutationDocument,
    operationName: "CreateSession",
    channel: "mutation",
    variables: ["input"],
    objectSelections: ["createSession"],
  },
  {
    document: startSessionMutationDocument,
    operationName: "StartSession",
    channel: "mutation",
    variables: ["id"],
    objectSelections: ["startSession"],
  },
  {
    document: completeSessionMutationDocument,
    operationName: "CompleteSession",
    channel: "mutation",
    variables: ["id"],
    objectSelections: ["completeSession"],
  },
  {
    document: cancelSessionMutationDocument,
    operationName: "CancelSession",
    channel: "mutation",
    variables: ["id", "reason"],
    objectSelections: ["cancelSession"],
  },
];

describe("shared-document contract — named operations + channel + variables", () => {
  for (const row of DOCUMENT_CONTRACT_TABLE) {
    test(`${row.operationName} is a single named ${row.channel} operation`, () => {
      const operation = singleOperationOrThrow(row.document);
      expect(operation.name?.value).toBe(row.operationName);
      expect(operation.name?.value ?? "").not.toBe("");
      expect(operation.operation).toBe(row.channel);
      expect(variableNames(operation)).toEqual([...row.variables]);
    });
  }
});

describe("shared-document contract — id field requirement", () => {
  test("object selections include id exactly where Apollo normalizes cache entries", () => {
    for (const row of DOCUMENT_CONTRACT_TABLE) {
      const operation = singleOperationOrThrow(row.document);
      for (const path of row.objectSelections) {
        // Resolve dotted paths ("login.user") through nested sub-selections.
        let current: OperationDefinitionNode | FieldNode = operation;
        let resolved = true;
        for (const segment of path.split(".")) {
          const field = namedField(current, segment);
          if (field === undefined) {
            resolved = false;
            break;
          }
          current = field;
        }
        if (!resolved) {
          throw new Error(`${row.operationName}: expected selection ${path} to exist`);
        }
        expect(selectsId(current)).toBe(true);
      }
    }
  });

  test("scalar-only payloads select nothing beyond their scalars (no dangling objects)", () => {
    const refreshTokenOp = singleOperationOrThrow(refreshTokenMutationDocument);
    const payload = namedField(refreshTokenOp, "refreshToken");
    if (payload === undefined) {
      throw new Error("expected refreshToken payload selection");
    }
    const payloadNames = fieldSelections(payload).map(field => field.name.value);
    expect(payloadNames).toEqual(["accessToken", "refreshToken"]);

    const logoutOp = singleOperationOrThrow(logoutMutationDocument);
    const logoutPayload = namedField(logoutOp, "logout");
    if (logoutPayload === undefined) {
      throw new Error("expected logout payload selection");
    }
    expect(fieldSelections(logoutPayload).map(field => field.name.value)).toEqual(["success"]);
  });

  test("registration selector query returns enum values, not objects needing id", () => {
    const operation = singleOperationOrThrow(recitationReadingsQueryDocument);
    const readings = namedField(operation, "recitationReadings");
    expect(readings).toBeDefined();
    // Plain enum-list leaf: no sub-selection ⇒ no cache-normalization need.
    expect(readings?.selectionSet).toBeUndefined();
  });

  test("user-shaped selections carry the locale preference field (me + login mirror + updateMyLocale payload)", () => {
    // R2-users-locale-b: `me` and `login.user` MUST select `locale` in
    // lockstep (the AuthProvider stores the user from EITHER result — a
    // selection drift would desynchronize `useAuth().user.locale`), and the
    // `updateMyLocale` payload returns the persisted value so consumers can
    // write it back into the same normalized `User` cache entry.
    const meOperation = singleOperationOrThrow(meQueryDocument);
    const meField = namedField(meOperation, "me");
    if (meField === undefined) {
      throw new Error("expected me selection");
    }
    expect(fieldSelections(meField).some(field => field.name.value === "locale")).toBe(true);

    const loginOperation = singleOperationOrThrow(loginMutationDocument);
    const loginField = namedField(loginOperation, "login");
    const loginUserField = loginField === undefined ? undefined : namedField(loginField, "user");
    if (loginUserField === undefined) {
      throw new Error("expected login.user selection");
    }
    expect(fieldSelections(loginUserField).some(field => field.name.value === "locale")).toBe(true);

    const localeOperation = singleOperationOrThrow(updateMyLocaleMutationDocument);
    const localePayload = namedField(localeOperation, "updateMyLocale");
    if (localePayload === undefined) {
      throw new Error("expected updateMyLocale payload selection");
    }
    expect(fieldSelections(localePayload).map(field => field.name.value)).toEqual(["id", "email", "locale"]);
  });
});

describe("consumer import conventions — barrel ≡ deep import identity", () => {
  test("top-level barrel re-exports the SAME document instance (cache-key safety)", () => {
    expect(registerUserViaBarrel).toBe(registerUserMutationDocument);
    expect(sessionByIdViaBarrel).toBe(sessionByIdQueryDocument);
  });

  test("documents remain TypedDocumentNode-typed against generated operation types", () => {
    // Compile-time proof by assignment — tsgo fails if any exported constant
    // loses its codegen typing or picks up an inline type literal.
    const typedRegister: TypedDocumentNode<RegisterUserMutation, RegisterUserMutationVariables> =
      registerUserMutationDocument;
    const typedLogin: TypedDocumentNode<LoginMutation, LoginMutationVariables> = loginMutationDocument;
    const typedRefresh: TypedDocumentNode<RefreshTokenMutation, RefreshTokenMutationVariables> =
      refreshTokenMutationDocument;
    const typedLogout: TypedDocumentNode<LogoutMutation> = logoutMutationDocument;
    const typedMe: TypedDocumentNode<MeQuery> = meQueryDocument;
    const typedRecitation: TypedDocumentNode<RecitationReadingsQuery> = recitationReadingsQueryDocument;
    const typedUpdateMyLocale: TypedDocumentNode<UpdateMyLocaleMutation, UpdateMyLocaleMutationVariables> =
      updateMyLocaleMutationDocument;

    // DEV3-004 session lifecycle documents (compile-time proof that every
    // `Session` selection conforms to the generated operation types).
    const typedSessionById: TypedDocumentNode<SessionByIdQuery, SessionByIdQueryVariables> = sessionByIdQueryDocument;
    const typedMyStudentSessions: TypedDocumentNode<MyStudentSessionsQuery, MyStudentSessionsQueryVariables> =
      myStudentSessionsQueryDocument;
    const typedMyTeacherSessions: TypedDocumentNode<MyTeacherSessionsQuery, MyTeacherSessionsQueryVariables> =
      myTeacherSessionsQueryDocument;
    const typedCreateSession: TypedDocumentNode<CreateSessionMutation, CreateSessionMutationVariables> =
      createSessionMutationDocument;
    const typedStartSession: TypedDocumentNode<StartSessionMutation, StartSessionMutationVariables> =
      startSessionMutationDocument;
    const typedCompleteSession: TypedDocumentNode<CompleteSessionMutation, CompleteSessionMutationVariables> =
      completeSessionMutationDocument;
    const typedCancelSession: TypedDocumentNode<CancelSessionMutation, CancelSessionMutationVariables> =
      cancelSessionMutationDocument;

    // Runtime uses keep the bindings from being flagged as unused.
    expect(typedRegister.loc).toBeDefined();
    expect(typedLogin.loc).toBeDefined();
    expect(typedRefresh.loc).toBeDefined();
    expect(typedLogout.loc).toBeDefined();
    expect(typedMe.loc).toBeDefined();
    expect(typedRecitation.loc).toBeDefined();
    expect(typedSessionById.loc).toBeDefined();
    expect(typedMyStudentSessions.loc).toBeDefined();
    expect(typedMyTeacherSessions.loc).toBeDefined();
    expect(typedCreateSession.loc).toBeDefined();
    expect(typedStartSession.loc).toBeDefined();
    expect(typedCompleteSession.loc).toBeDefined();
    expect(typedCancelSession.loc).toBeDefined();
    expect(typedUpdateMyLocale.loc).toBeDefined();
  });
});
