/**
 * Warning-surfacing contract lock.
 *
 * WHAT THIS LOCKS:
 *   Warnings produced by partial-success mutations travel INSIDE the GraphQL
 *   payload `data` channel (never log-only); hard failures travel EXCLUSIVELY
 *   in `errors[]` carrying their `DomainError` `extensions.code`. This is the
 *   documented convention at `docs/graphql/domain-error-extensions-code.md`
 *   §Rules #6/#7 (`releaseQuotaIfDeducted → { success, warning }`,
 *   `deleteClassInstance → DeleteClassInstanceResult { success, warnings }`,
 *   "not `Boolean`" anti-pattern) — it is **convention-only**: NO new
 *   production result types are invented here.
 *
 * GROUND TRUTH ANCHOR (honesty pin, Section A):
 *   The quota / class-instance domains are NOT yet materialized in this tree —
 *   the live schema exposes exactly { login, logout, refreshToken,
 *   registerUser }. Test A2 pins that inventory gap so the moment those
 *   domains land, this suite fails loudly until they adopt the locked shapes
 *   (and gets updated to point Section B's reproduction directly at them).
 *   The gap is a known wiring task, owned by whichever change introduces
 *   `deleteClassInstance`.
 *
 * SECTION B mechanics (propagation semantics, deterministic):
 *   Reproduces the two documented precedent shapes verbatim in a test-local
 *   graphql-js schema and executes named-operation documents against it.
 *   Failure items are wrapped in the genuine Apollo Client v4
 *   `CombinedGraphQLErrors` container — exactly what the HTTP link builds —
 *   so every failure assertion goes through the canonical
 *   `expectMutationError(container, expectedCode)` helper. The local mirror
 *   error classes replicate the `DomainError extends GraphQLError`
 *   `extensions.code` mechanics verbatim from the canonical doc §Pattern;
 *   they exist ONLY because `frontend/graphql/test/AGENTS.md` rule 10
 *   ("Strict Interface Layer Separation") forbids importing backend modules
 *   into integration suites — production-truth for real codes over the full
 *   stack is anchored by test A4 instead.
 *
 * Runs via (verified in-sandbox): KOTTABY_TEST_RUNNER_OK=1 bun --env-file=.env.test
 *   test --timeout=150000 frontend/graphql/test/warnings/warning-surfacing.test.ts
 * Requires NO other `next dev` process in this project directory (Next 16
 * holds a per-directory dev lock; leaks make beforeAll time out). The
 * run-test/run-server-tests wrappers are the intended CI path but currently
 * die at ENTRY-module load under this sandbox (graphql-tag async-require
 * TypeError before any preload applies); the authored suite itself is
 * wrapper-agnostic.
 */

import { describe, expect, test } from "bun:test";
import { CombinedGraphQLErrors, gql } from "@apollo/client";
import {
  type DocumentNode,
  type ExecutionResult,
  execute,
  GraphQLBoolean,
  GraphQLError,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { logoutMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { expectMutationError, setupTestServerLifecycle, testClient } from "@/test/helpers";

// ─── Surfaced-literal fixtures (SEC: literal-pinned ⇒ PII/secret-free) ──────

const QUOTA_WARNING_MESSAGE = "Wallet debit skipped - the active subscription already covered this session cost.";
const DELETE_WARNING_MESSAGES = [
  "Two linked home-work records were soft-deleted along with the class instance.",
  "Session escrow release was queued for the next settlement run.",
];
const DELETE_FAILURE_MESSAGE = "Class instance is locked by an active session.";
const QUOTA_FAILURE_MESSAGE = "Quota ledger update failed after deletion.";

/** Anything matching this must never appear inside a surfaced warning payload. */
const SECRET_OR_PII_PATTERN = /@|\b(?:password|passwd|secret|token|apikey|api_key|credential)\b/iu;

// ─── Local mirror of the documented DomainError→extensions.code mechanics ───

class DomainErrorMirror extends GraphQLError {
  protected readonly domainCode: string;

  constructor(domainCode: string, message: string) {
    super(message, { extensions: { code: domainCode } });
    this.domainCode = domainCode;
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Named mirrors keep the throw sites reading like the documented services. */
function conflictError(message: string): DomainErrorMirror {
  return new DomainErrorMirror("CONFLICT", message);
}

/** Verbatim `ValidationError(code, message)` overloaded-form reproduction. */
function validationErrorWithCustomCode(customCode: string, message: string): DomainErrorMirror {
  return new DomainErrorMirror(customCode, message);
}

// ─── Test-local reproduction of the two documented precedent shapes ─────────

const DELETE_INSTANCE_RESULT_TYPE = new GraphQLObjectType({
  name: "DeleteClassInstanceResult",
  fields: {
    success: { type: new GraphQLNonNull(GraphQLBoolean) },
    warnings: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
  },
});

const RELEASE_QUOTA_PAYLOAD_TYPE = new GraphQLObjectType({
  name: "ReleaseQuotaIfDeductedPayload",
  fields: {
    success: { type: new GraphQLNonNull(GraphQLBoolean) },
    warning: { type: new GraphQLNonNull(GraphQLString) },
  },
});

type ScenarioMode = "success" | "conflict" | "ledger-validation";

/**
 * Execution is sequential under bun:test, so a module-level scenario selector
 * (set immediately before each execute call) keeps resolvers free of
 * untyped-`context` plumbing while staying deterministic per test.
 */
let activeScenario: ScenarioMode = "success";

const MUTATION_ROOT_TYPE = new GraphQLObjectType({
  name: "Mutation",
  fields: () => ({
    releaseQuotaIfDeducted: {
      type: new GraphQLNonNull(RELEASE_QUOTA_PAYLOAD_TYPE),
      args: { sessionId: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: () => {
        if (activeScenario === "ledger-validation") {
          throw validationErrorWithCustomCode("QUOTA_LEDGER_ERROR", QUOTA_FAILURE_MESSAGE);
        }
        return { success: true, warning: QUOTA_WARNING_MESSAGE };
      },
    },
    deleteClassInstance: {
      type: new GraphQLNonNull(DELETE_INSTANCE_RESULT_TYPE),
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: () => {
        if (activeScenario === "conflict") {
          throw conflictError(DELETE_FAILURE_MESSAGE);
        }
        return { success: true, warnings: DELETE_WARNING_MESSAGES };
      },
    },
  }),
});

const WARNING_SHAPE_SCHEMA = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: { _health: { type: GraphQLBoolean } },
  }),
  mutation: MUTATION_ROOT_TYPE,
});

/** Named operations per the sharedDocuments AGENTS rule (operationName set). */
const DELETE_CLASS_INSTANCE_WARNING_DOCUMENT: DocumentNode = gql`
  mutation DeleteClassInstance($id: ID!) {
    deleteClassInstance(id: $id) {
      success
      warnings
    }
  }
`;

const RELEASE_QUOTA_IF_DEDUCTED_WARNING_DOCUMENT: DocumentNode = gql`
  mutation ReleaseQuotaIfDeducted($sessionId: ID!) {
    releaseQuotaIfDeducted(sessionId: $sessionId) {
      success
      warning
    }
  }
`;

/** Deliberately invalid selection set — pins the PRESET pass-through tier:
 * document-validation failures must land in `errors[]` carrying the classic
 * `GRAPHQL_VALIDATION_FAILED` code END-TO-END (route formatError envelope hop
 * + boundary finalizer protocol-preset pass-through), i.e. the SAME
 * expectMutationError convention applies before any resolver even runs.
 * Chosen for this wire leg because it is deterministic (no DB row warm-up,
 * no locale-dependent message wording); domain-code preservation through real
 * resolvers is locked at the container tier by B3/B4 and re-anchored over the
 * wire once the boot-tier environment stabilizes. */
const INVALID_MUTATION_DOCUMENT: DocumentNode = gql`
  mutation ProbeInvalidMutationSelection {
    logout {
      success
      nonexistentFieldForValidationProbe
    }
  }
`;

// ─── Small deterministic execution helpers ──────────────────────────────────

async function runWarningScenario(document: DocumentNode, mode: ScenarioMode): Promise<ExecutionResult> {
  activeScenario = mode;
  // graphql's `execute` returns PromiseOrValue — awaiting normalizes it.
  const result = await execute({
    schema: WARNING_SHAPE_SCHEMA,
    document,
    variableValues: { id: "fixture-instance-id", sessionId: "fixture-session-id" },
  });
  return result;
}

function requireExecutionData(result: ExecutionResult, label: string): Record<string, unknown> {
  if (result.data === null || result.data === undefined) {
    throw new Error(`${label}: expected payload \`data\` - got none (failure tier unexpectedly fired)`);
  }
  return result.data;
}

function requireExecutionErrors(result: ExecutionResult): ReadonlyArray<GraphQLError> {
  if (!result.errors?.length) {
    throw new Error("Expected execution `errors[]` - got none (success tier unexpectedly fired)");
  }
  return result.errors;
}

/** Builds the SAME Apollo v4 container the HTTP link would produce for `result`. */
function toCombinedContainer(result: ExecutionResult): CombinedGraphQLErrors {
  return new CombinedGraphQLErrors({ errors: [...requireExecutionErrors(result)] });
}

// ─── Live-surface inventory document ────────────────────────────────────────
// Typed via a narrowing extractor (no assertion casts) because generated
// codegen types cannot exist for an inventory pin whose job is to prove which
// surfaces do NOT exist yet. The meta-field is aliased (`schemaMeta:`) so no
// dangling-underscore identifier ever appears on the TS side; the wire field
// is still plain `__schema` introspection. Named operation (operationName set).

interface MutationSurfaceInventory {
  typeName: string | null;
  fieldNames: string[];
}

/** Assertion-free structural guard down the (aliased) introspection payload. */
function extractMutationSurfaceInventory(data: unknown): MutationSurfaceInventory | undefined {
  if (typeof data !== "object" || data === null || !("schemaMeta" in data)) return undefined;
  const schemaMeta = data.schemaMeta;
  if (typeof schemaMeta !== "object" || schemaMeta === null || !("mutationType" in schemaMeta)) return undefined;
  const mutationType = schemaMeta.mutationType;
  if (typeof mutationType !== "object" || mutationType === null) return undefined;
  if (!("fields" in mutationType) || !Array.isArray(mutationType.fields)) return undefined;

  const fieldNames: string[] = [];
  for (const entry of mutationType.fields) {
    if (typeof entry === "object" && entry !== null && "name" in entry && typeof entry.name === "string") {
      fieldNames.push(entry.name);
    }
  }
  const typeName = "name" in mutationType && typeof mutationType.name === "string" ? mutationType.name : null;
  return { typeName, fieldNames };
}

const MUTATION_SURFACE_INVENTORY_QUERY_DOCUMENT: DocumentNode = gql`
  query MutationSurfaceInventory {
    schemaMeta: __schema {
      mutationType {
        name
        fields {
          name
        }
      }
    }
  }
`;

/**
 * The exhaustive live root-mutation inventory (ground truth, reconciled):
 * the auth baseline + the DEV1-005 admin plan-catalog trio + the DEV1-006
 * Phase A subscriber request. New sanctioned root mutations MUST be
 * appended here AND in schema-surface.test.ts's POST_BASELINE_MUTATION_ADDITIONS.
 */
const KNOWN_LIVE_MUTATION_FIELDS = [
  "login",
  "logout",
  "refreshToken",
  "registerUser",
  "createPlan",
  "updatePlan",
  "setPlanActiveStatus",
  "requestPlanSubscription",
  "verifySubscriptionPayment",
];
/** Documented precedent surfaces that must ADOPT Rules #6/#7 when wired. */
const DOCUMENTED_WARNING_SURFACES_PENDING = ["releaseQuotaIfDeducted", "deleteClassInstance"];

describe("Warning-surfacing contract lock — Section A: live GraphQL surface (wire)", () => {
  setupTestServerLifecycle();

  test("A1. deployed Mutation root exposes exactly the documented inventory set", async () => {
    const result = await testClient.query({ query: MUTATION_SURFACE_INVENTORY_QUERY_DOCUMENT });
    expect(result.error).toBeUndefined();

    const inventory = extractMutationSurfaceInventory(result.data);
    if (!inventory) throw new Error("introspection payload did not expose the mutation-type envelope");

    expect(inventory.typeName).toBe("Mutation");
    expect([...inventory.fieldNames].toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...KNOWN_LIVE_MUTATION_FIELDS].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("A2. inventory-gap pin: documented warning surfaces not wired yet", async () => {
    const result = await testClient.query({ query: MUTATION_SURFACE_INVENTORY_QUERY_DOCUMENT });
    const liveNames = new Set(extractMutationSurfaceInventory(result.data)?.fieldNames ?? []);
    const prematureSurfaces = DOCUMENTED_WARNING_SURFACES_PENDING.filter(name => liveNames.has(name));
    // When this flips red, someone wired deleteClassInstance/releaseQuota:
    // extend Section B to execute THEM over the wire and enforce Rule #6/#7
    // result shapes end-to-end.
    expect(prematureSurfaces).toEqual([]);
  });

  test("A3. logout — structured wrapper result rides INSIDE the payload data channel", async () => {
    const result = await testClient.mutate({ mutation: logoutMutationDocument });
    expect(result.error).toBeUndefined();
    expect(result.data?.logout?.success).toBe(true);
  });

  test("A4. mutation validation failure lands in errors[] via expectMutationError over the full stack", async () => {
    const result = await testClient.mutate({ mutation: INVALID_MUTATION_DOCUMENT });

    // Route transport preflight accepts the body; graphql-js document
    // validation rejects the bogus selection BEFORE execution and the preset
    // pass-through keeps the classic code intact through the finalizer.
    const combined = expectMutationError(result.error, "GRAPHQL_VALIDATION_FAILED");
    const firstItem = combined.errors[0];
    if (!firstItem) throw new Error("CombinedGraphQLErrors carried no items");
    expect(firstItem.message).toContain("nonexistentFieldForValidationProbe");
  });
});

describe("Warning-surfacing contract lock — Section B: documented propagation semantics", () => {
  test("B1. deleteClassInstance-shaped partial success surfaces warnings INSIDE payload data", async () => {
    const result = await runWarningScenario(DELETE_CLASS_INSTANCE_WARNING_DOCUMENT, "success");
    expect(result.errors).toBeUndefined();

    const payload = requireExecutionData(result, "DeleteClassInstance");
    // Whole-shape pin: wrapper object — the canonical-doc anti-pattern forbids
    // a bare Boolean return for warning-capable deletions (§Anti-patterns).
    expect(payload).toEqual({ deleteClassInstance: { success: true, warnings: DELETE_WARNING_MESSAGES } });

    const inner = payload.deleteClassInstance;
    expect(typeof inner).toBe("object");
    if (typeof inner !== "object" || inner === null) throw new Error("wrapper result was not an object");
    expect(Object.keys(inner).toSorted((a, b) => a.localeCompare(b))).toEqual(["success", "warnings"]);
  });

  test("B2. releaseQuotaIfDeducted-shaped partial success surfaces its single warning inside data", async () => {
    const result = await runWarningScenario(RELEASE_QUOTA_IF_DEDUCTED_WARNING_DOCUMENT, "success");
    expect(result.errors).toBeUndefined();
    expect(requireExecutionData(result, "ReleaseQuotaIfDeducted")).toEqual({
      releaseQuotaIfDeducted: { success: true, warning: QUOTA_WARNING_MESSAGE },
    });
  });

  test("B3. failure of a warning-capable mutation travels EXCLUSIVELY in errors[]", async () => {
    const result = await runWarningScenario(DELETE_CLASS_INSTANCE_WARNING_DOCUMENT, "conflict");
    expect(result.data).toBeFalsy();

    const combined = expectMutationError(toCombinedContainer(result), "CONFLICT");
    const firstItem = combined.errors[0];
    if (!firstItem) throw new Error("CombinedGraphQLErrors carried no items");
    expect(firstItem.path).toEqual(["deleteClassInstance"]);

    // Channel separation: warning text never leaks onto the failure channel.
    const serializedFailure = JSON.stringify(firstItem);
    const leakedWarnings = DELETE_WARNING_MESSAGES.some(entry => serializedFailure.includes(entry));
    expect(leakedWarnings).toBe(false);
  });

  test("B4. custom-code validation failures keep DomainError codes through the container", async () => {
    const result = await runWarningScenario(RELEASE_QUOTA_IF_DEDUCTED_WARNING_DOCUMENT, "ledger-validation");
    const combined = expectMutationError(toCombinedContainer(result), "QUOTA_LEDGER_ERROR");
    const firstItem = combined.errors[0];
    if (!firstItem) throw new Error("CombinedGraphQLErrors carried no items");
    expect(firstItem.message).toBe(QUOTA_FAILURE_MESSAGE);
    expect(firstItem.extensions?.code).toBe("QUOTA_LEDGER_ERROR");
  });

  test("B5. SEC pin: surfaced warning payloads carry no secrets or PII markers", async () => {
    const deletePayload = JSON.stringify(
      requireExecutionData(await runWarningScenario(DELETE_CLASS_INSTANCE_WARNING_DOCUMENT, "success"), "sec-delete")
    );
    const quotaPayload = JSON.stringify(
      requireExecutionData(await runWarningScenario(RELEASE_QUOTA_IF_DEDUCTED_WARNING_DOCUMENT, "success"), "sec-quota")
    );

    // Literal equality is proven by B1/B2; here we prove NOTHING beyond those
    // documented contract strings reaches the payload channel.
    expect(SECRET_OR_PII_PATTERN.test(`${deletePayload}\n${quotaPayload}`)).toBe(false);
  });
});
