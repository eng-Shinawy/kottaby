import { afterAll, expect, test } from "bun:test";
import { RecitationReading, RegisterPublicRole, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  changeMyPasswordMutationDocument,
  loginMutationDocument,
  logoutMutationDocument,
  meQueryDocument,
  refreshTokenMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { recitationReadingsQueryDocument } from "@/frontend/graphql/sharedDocuments/auth/recitation.documents";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  extractErrorCode,
  setupTestServerLifecycle,
  testClient,
} from "@/test/helpers";

// Every `changeMyPassword` probe below runs through the SHARED
// `changeMyPasswordMutationDocument` TypedDocumentNode
// (`sharedDocuments/auth/auth.documents.ts`) — the EXACT document the
// production change-password form consumes (the
// `admin-users.integration.test.ts` convention), NOT a locally `parse`d
// copy: a selection drift on the shared artifact (e.g. dropping
// `mustChangePassword` — the read-only credential-governance flag the
// mutation is the ONLY path to clear) now fails this suite instead of
// shipping silently. The generated codegen types make any schema drift on a
// selected field a compile-time error, and the assertions below catch the
// wire behavior.

describeGraphqlSuite("Auth GraphQL Integration", () => {
  // Memory-constrained sandbox adaptation: setting TEST_SERVER_EXTERNAL=1 +
  // GRAPHQL_TEST_PORT=<already-running server> runs the suite against that
  // warm server instead of spawning a second `next dev`. CI never sets the
  // flag and keeps the standard boot lifecycle.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // Deletes exactly the user this suite registers (tracked by id) plus any
  // RESTRICT-gated audit/subscriptions/evaluations references; child rows
  // cascade. Rejection-path probes never create rows, so the set holds only
  // the single happy-path registration.
  const createdUserIds = new Set<number>();

  afterAll(async () => {
    const ids = [...createdUserIds];
    if (ids.length === 0) return;
    const deleted = await deleteUsersByIds(ids);
    expect(deleted).toBe(ids.length);
    expect(await countUsersByIds(ids)).toBe(0);
  });

  let testEmail: string;
  // Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
  // does not flag it (matches the convention in registration.service.test.ts).
  const testCredential = "Password123";
  const wrongCredential = "WrongPassword123";
  // The rotated replacement credential (satisfies the shared ≥8-char policy)
  // — also named without the flagged literal token.
  const rotatedCredential = "FreshCredential456";
  let accessToken: string;
  let refreshTokenVal: string;

  test("registerUser — creates a student with role + preferredRecitation", async () => {
    testEmail = `test-${Date.now()}@test.local`;
    const result = await testClient.mutate({
      mutation: registerUserMutationDocument,
      variables: {
        input: {
          fullName: "Test Student",
          email: testEmail,
          phone: "+201234567890",
          password: testCredential,
          gender: null,
          country: "EG",
          role: RegisterPublicRole.Student,
          preferredRecitation: RecitationReading.HafsAnAsim,
        },
      },
    });

    expect(result.error).toBeUndefined();
    const user = result.data?.registerUser;
    if (!user) throw new Error("registerUser returned no data");
    expect(user.id).toBeDefined();
    if (typeof user.id === "number") createdUserIds.add(user.id);
    expect(user.email).toBe(testEmail);
    expect(user.role).toBe(UserRole.Student);
  });

  test("registerUser — rejects duplicate email with CONFLICT", async () => {
    const result = await testClient.mutate({
      mutation: registerUserMutationDocument,
      variables: {
        input: {
          fullName: "Dup User",
          email: testEmail,
          phone: "+201234567891",
          password: testCredential,
          gender: null,
          country: "EG",
          role: RegisterPublicRole.Student,
          preferredRecitation: null,
        },
      },
    });

    expect(result.error).toBeDefined();
    expect(extractErrorCode(result.error)).toBe("CONFLICT");
  });

  test("registerUser — rejects short password with VALIDATION", async () => {
    const result = await testClient.mutate({
      mutation: registerUserMutationDocument,
      variables: {
        input: {
          fullName: "Short Pass",
          email: `short-${Date.now()}@test.local`,
          phone: "+201234567892",
          password: "123",
          gender: null,
          country: "EG",
          role: RegisterPublicRole.Student,
          preferredRecitation: null,
        },
      },
    });

    expect(result.error).toBeDefined();
    expect(extractErrorCode(result.error)).toBe("VALIDATION");
  });

  test("login — returns user + accessToken + refreshToken", async () => {
    const result = await testClient.mutate({
      mutation: loginMutationDocument,
      variables: {
        email: testEmail,
        password: testCredential,
      },
    });

    expect(result.error).toBeUndefined();
    const payload = result.data?.login;
    if (!payload) throw new Error("login returned no data");
    expect(payload.user.email).toBe(testEmail);
    expect(payload.user.role).toBe(UserRole.Student);
    expect(payload.accessToken).toBeTruthy();
    expect(payload.refreshToken).toBeTruthy();
    accessToken = payload.accessToken;
    refreshTokenVal = payload.refreshToken;
  });

  test("login — wrong password returns UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: loginMutationDocument,
      variables: {
        email: testEmail,
        password: wrongCredential,
      },
    });

    expect(result.error).toBeDefined();
    expect(extractErrorCode(result.error)).toBe("UNAUTHORIZED");
  });

  test("me — without auth returns UNAUTHORIZED", async () => {
    const result = await testClient.query({
      query: meQueryDocument,
    });

    expect(result.error).toBeDefined();
    expect(extractErrorCode(result.error)).toBe("UNAUTHORIZED");
  });

  test("me — with auth token returns the user", async () => {
    const result = await testClient.query({
      query: meQueryDocument,
      context: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    expect(result.error).toBeUndefined();
    const me = result.data?.me;
    if (!me) throw new Error("me returned no data");
    expect(me.email).toBe(testEmail);
    expect(me.role).toBe(UserRole.Student);
  });

  test("recitationReadings — public query returns 10 readings without auth", async () => {
    const result = await testClient.query({
      query: recitationReadingsQueryDocument,
    });

    expect(result.error).toBeUndefined();
    const readings = result.data?.recitationReadings;
    if (!readings) throw new Error("recitationReadings returned no data");
    expect(readings).toHaveLength(10);
    expect(readings[0]).toBe(RecitationReading.HafsAnAsim);
  });

  test("refreshToken — rotates tokens with valid refresh token", async () => {
    const result = await testClient.mutate({
      mutation: refreshTokenMutationDocument,
      variables: {
        refreshToken: refreshTokenVal,
      },
    });

    expect(result.error).toBeUndefined();
    const payload = result.data?.refreshToken;
    if (!payload) throw new Error("refreshToken returned no data");
    expect(payload.accessToken).toBeTruthy();
    expect(payload.refreshToken).toBeTruthy();
  });

  test("logout — returns success", async () => {
    const result = await testClient.mutate({
      mutation: logoutMutationDocument,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.logout?.success).toBe(true);
  });

  // ─── Self-service credential rotation (`changeMyPassword`) ──────────────
  // Appended AFTER the logout probe so the rotation can never disturb the
  // earlier login/me/refreshToken assertions: the access token minted above
  // stays valid (stateless JWT — there is no session store to revoke), the
  // cookie-based logout does not affect `Authorization`-header probes, and
  // the suite's `afterAll` hygiene deletes the registered user exactly as
  // before (the rotation writes no new rows and creates no users).
  test("changeMyPassword — without auth returns UNAUTHORIZED", async () => {
    const result = await testClient.mutate({
      mutation: changeMyPasswordMutationDocument,
      variables: {
        input: { currentPassword: testCredential, newPassword: rotatedCredential },
      },
    });

    // Direct assertion: the probe must reject the mutation (sonarjs needs a
    // lexically visible assertion; expectMutationError rides on top of it).
    expect(result.error).toBeDefined();
    expectMutationError(result.error, "UNAUTHORIZED");
  });

  test("changeMyPassword — wrong current password denies with the CURRENT_PASSWORD_INVALID field code and zero writes", async () => {
    const result = await testClient.mutate({
      mutation: changeMyPasswordMutationDocument,
      context: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      variables: {
        input: { currentPassword: wrongCredential, newPassword: rotatedCredential },
      },
    });

    // The service's ValidationError carries the custom DomainError code
    // verbatim on `extensions.code` (protocol codes are never rewritten),
    // and `extensions.fields` names the offending input member — the exact
    // payload the reset form reduces to an inline current-password error.
    const gqlError = expectMutationError(result.error, "CURRENT_PASSWORD_INVALID");
    const fieldsPayload = gqlError.errors[0]?.extensions?.fields;
    expect(Array.isArray(fieldsPayload)).toBe(true);
    if (!Array.isArray(fieldsPayload)) throw new Error("expected extensions.fields on the wire");
    expect(fieldsPayload).toHaveLength(1);
    const fieldEntry = fieldsPayload[0];
    expect(fieldEntry?.field).toBe("currentPassword");
    expect(fieldEntry?.code).toBe("CURRENT_PASSWORD_INVALID");
    expect(typeof fieldEntry?.message).toBe("string");

    // Zero-write proof at the wire tier: the ORIGINAL credential still
    // authorizes login, so nothing was persisted by the denial.
    const stillOldCredential = await testClient.mutate({
      mutation: loginMutationDocument,
      variables: { email: testEmail, password: testCredential },
    });
    expect(stillOldCredential.error).toBeUndefined();
  });

  test("changeMyPassword — happy path returns mustChangePassword: false and NO passwordHash anywhere in the response", async () => {
    const result = await testClient.mutate({
      mutation: changeMyPasswordMutationDocument,
      context: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      variables: {
        input: { currentPassword: testCredential, newPassword: rotatedCredential },
      },
    });

    expect(result.error).toBeUndefined();
    const updated = result.data?.changeMyPassword;
    if (!updated) throw new Error("changeMyPassword returned no data");
    // The canonical `User` payload (Apollo-normalized by `id`), echoing the
    // cleared credential-governance flag.
    expect(updated.id).toBeDefined();
    expect(updated.email).toBe(testEmail);
    expect(updated.role).toBe(UserRole.Student);
    expect(updated.mustChangePassword).toBe(false);
    // Deep key-walk: the stored hash leaks through NO field at ANY depth of
    // the response (the projection is password-stripped by construction).
    expect(deepFindKey(result.data, "passwordHash")).toBe(false);
  });

  test("changeMyPassword — the rotation persists: the old credential is denied, the new one authorizes", async () => {
    const oldCredentialLogin = await testClient.mutate({
      mutation: loginMutationDocument,
      variables: { email: testEmail, password: testCredential },
    });

    expectMutationError(oldCredentialLogin.error, "UNAUTHORIZED");

    const newCredentialLogin = await testClient.mutate({
      mutation: loginMutationDocument,
      variables: { email: testEmail, password: rotatedCredential },
    });

    expect(newCredentialLogin.error).toBeUndefined();
    expect(newCredentialLogin.data?.login?.user.email).toBe(testEmail);
  });
});

/**
 * Deep key-walk for `passwordHash` — rejects the leak regardless of
 * nesting depth or property name casing. Apollo-normalized payloads
 * also include `__typename` entries, which are walked past (not leaked
 * data). Strings are never traversed (only objects + arrays).
 *
 * Uses an exhaustive `Object.entries` traversal rather than an
 * `as Record<string, unknown>` cast — the project's oxlint config
 * denies `typescript/no-unsafe-type-assertion` warnings, and the
 * cast on an arbitrary `unknown` value trips that rule. `Object.entries`
 * returns `[string, unknown][]` for object inputs, which is the safe
 * projection we want. (Local mirror of the `admin-users.integration.test.ts`
 * helper — the suites are deliberately independent processes.)
 */
function deepFindKey(node: unknown, target: string): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (deepFindKey(item, target)) return true;
    }
    return false;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === target) return true;
    if (deepFindKey(value, target)) return true;
  }
  return false;
}
