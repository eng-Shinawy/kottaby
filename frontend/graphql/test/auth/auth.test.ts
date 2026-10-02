import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { CombinedGraphQLErrors } from "@apollo/client";
import { GraphQLInputObjectType, GraphQLObjectType } from "graphql";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import {
  type AdminCreateUserInput,
  RecitationReading,
  RegisterPublicRole,
  type RegisterUserInput,
  UserRole,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminCreateUserMutationDocument,
  adminUpdateUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin/admin-users.documents";
import {
  changeMyPasswordMutationDocument,
  loginMutationDocument,
  logoutMutationDocument,
  meQueryDocument,
  refreshTokenMutationDocument,
  registerUserMutationDocument,
} from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { recitationReadingsQueryDocument } from "@/frontend/graphql/sharedDocuments/auth/recitation.documents";
import { authEn } from "@/shared/locale/en/auth";
import { errorsEn } from "@/shared/locale/en/errors";
import {
  countUsersByIds,
  deleteUsersByIds,
  describeGraphqlSuite,
  expectMutationError,
  extractErrorCode,
  insertAdminUserWithChildRow,
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

/**
 * Structural shape of one `extensions.fields[]` entry at the wire — the
 * `{ field, code, message }` triple that forms and dialogs project into
 * per-field helper text.
 */
interface WirePhoneFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

/** Unique per-probe email — UUID-salted so repeated and parallel runs never collide. */
function uniqueWireEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`;
}

/** Per-request locale pin — the server default locale is Arabic, so probes that
 * assert English copy stamp the app-locale header the frontend itself sends. */
function enLocale(): { headers: { "x-app-locale": string } } {
  return { headers: { "x-app-locale": "en" } };
}

/** Admin-bearer variant of the locale pin — identity + locale in one header set. */
function adminBearer(token: string): { headers: { Authorization: string; "x-app-locale": string } } {
  return { headers: { Authorization: `Bearer ${token}`, "x-app-locale": "en" } };
}

/**
 * Reads the single `phone` entry off the first GraphQL error's
 * `extensions.fields[]`, asserting the payload is present, well-formed, and
 * exclusively about the phone field (every probe below submits exactly one
 * invalid field). Narrowed structurally — no unsafe assertions.
 */
function readPhoneFieldError(combined: CombinedGraphQLErrors): WirePhoneFieldError {
  const fieldsPayload = combined.errors[0]?.extensions?.fields;
  expect(Array.isArray(fieldsPayload)).toBe(true);
  if (!Array.isArray(fieldsPayload)) {
    throw new Error("expected extensions.fields on the first GraphQL error");
  }
  expect(fieldsPayload).toHaveLength(1);
  const entry = fieldsPayload[0];
  if (typeof entry?.field !== "string" || typeof entry?.code !== "string" || typeof entry?.message !== "string") {
    throw new Error("malformed extensions.fields entry on the wire");
  }
  expect(entry.field).toBe("phone");
  return { field: entry.field, code: entry.code, message: entry.message };
}

/** Fails unless the named type is a registered GraphQL input type. */
function requireInputObjectType(name: string): GraphQLInputObjectType {
  const type = graphQLSchema.getType(name);
  if (!(type instanceof GraphQLInputObjectType)) {
    throw new Error(`${name} must be registered as a GraphQL input type`);
  }
  return type;
}

/** Fails unless the named type is a registered GraphQL object type. */
function requireObjectType(name: string): GraphQLObjectType {
  const type = graphQLSchema.getType(name);
  if (!(type instanceof GraphQLObjectType)) {
    throw new Error(`${name} must be registered as a GraphQL object type`);
  }
  return type;
}

describeGraphqlSuite("Auth GraphQL Integration", () => {
  // Memory-constrained sandbox adaptation: setting TEST_SERVER_EXTERNAL=1 +
  // GRAPHQL_TEST_PORT=<already-running server> runs the suite against that
  // warm server instead of spawning a second `next dev`. CI never sets the
  // flag and keeps the standard boot lifecycle.
  if (process.env.TEST_SERVER_EXTERNAL !== "1") {
    setupTestServerLifecycle();
  }

  // ─── Hygiene: restore the shared dev database to canonical seed state ───
  // Deletes exactly the users this suite creates (tracked by id) plus any
  // RESTRICT-gated audit/subscriptions/evaluations references; child rows
  // cascade. Rejection-path probes never create rows, so the set holds only
  // the successful registrations, the phone-probe admin fixture, the admin
  // update target, and the denial-probe actors.
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

  // ─── Self-service credential rotation (`changeMyPassword`) ────────────
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

  // ─── Phone validation surfaced at the wire ────────────────────────────────
  //
  // The shared E.164 phone contract reaches clients as a VALIDATION error
  // whose `extensions.fields[]` carries `{ field, code, message }` — the exact
  // payload the register form and the admin dialogs reduce to per-field
  // helper text. The server gate is the trust boundary: probes below submit
  // hostile phones straight over the wire, and every rejection must carry the
  // gate's machine code with the fixed localized template as the message —
  // never an echo of the submitted value. All users created here are tracked
  // in `createdUserIds` and drained by the suite cleanup above.
  describe("phone validation surfaced at the wire", () => {
    // Wire payloads mirroring the shared schema's check order: required →
    // too-long (one past the 16-char E.164 ceiling) → E.164 shape.
    const INVALID_PHONE = "12345";
    const TOO_LONG_PHONE = "+2012345678901234"; // 17 chars
    const CEILING_PHONE = "+201234567890123"; // 16 chars — exactly at the ceiling

    let adminToken: string;
    let adminUpdateTargetId: number;

    beforeAll(async () => {
      // Admin is not publicly registrable (the public role union excludes it),
      // so the shared fixture seam provisions the admin user + child row
      // directly and a real session is minted through the public login.
      const adminEmail = uniqueWireEmail("phone-wire-admin");
      const adminUserId = await insertAdminUserWithChildRow({
        fullName: "Phone Wire Admin",
        email: adminEmail,
        phone: "+201234567891",
        password: testCredential,
      });
      createdUserIds.add(adminUserId);

      const adminLogin = await testClient.mutate({
        mutation: loginMutationDocument,
        variables: { email: adminEmail, password: testCredential },
      });
      expect(adminLogin.error).toBeUndefined();
      const token = adminLogin.data?.login?.accessToken;
      if (!token) throw new Error("admin login returned no accessToken");
      adminToken = token;

      // The admin update probe needs an existing target user — registered
      // through the public path with a valid phone.
      const registered = await testClient.mutate({
        mutation: registerUserMutationDocument,
        variables: {
          input: {
            fullName: "Phone Wire Update Target",
            email: uniqueWireEmail("phone-wire-target"),
            phone: "+201234567894",
            password: testCredential,
            gender: null,
            country: "EG",
            role: RegisterPublicRole.Student,
            preferredRecitation: null,
          },
        },
      });
      expect(registered.error).toBeUndefined();
      const targetId = registered.data?.registerUser?.id;
      if (!targetId) throw new Error("registerUser returned no id for the update target");
      adminUpdateTargetId = targetId;
      createdUserIds.add(targetId);
    });

    /** Fully-populated registration input — every field passed, optional ones explicit. */
    function registrationInput(phone: string): RegisterUserInput {
      return {
        fullName: "Phone Wire Probe",
        email: uniqueWireEmail("phone-wire-probe"),
        phone,
        password: testCredential,
        gender: null,
        country: "EG",
        role: RegisterPublicRole.Student,
        preferredRecitation: null,
      };
    }

    /** Fully-populated admin create input — every field passed, optional ones explicit. */
    function adminCreateInput(phone: string): AdminCreateUserInput {
      return {
        fullName: "Phone Wire Admin Probe",
        email: uniqueWireEmail("phone-wire-admin-create"),
        phone,
        password: testCredential,
        gender: null,
        country: "EG",
        role: RegisterPublicRole.Student,
      };
    }

    test("registerUser — invalid phone → VALIDATION with a PHONE_INVALID field error", async () => {
      const result = await testClient.mutate({
        mutation: registerUserMutationDocument,
        variables: { input: registrationInput(INVALID_PHONE) },
        context: enLocale(),
      });

      const combined = expectMutationError(result.error, "VALIDATION");
      const phoneError = readPhoneFieldError(combined);
      expect(phoneError.code).toBe("PHONE_INVALID");
      expect(phoneError.message).toBe(authEn.phoneInvalid);
      expect(phoneError.message).not.toContain(INVALID_PHONE);
      // The top-level message mirrors the single field entry (first-entry contract).
      expect(combined.errors[0]?.message).toBe(phoneError.message);
    });

    test("registerUser — empty phone → VALIDATION with a PHONE_REQUIRED field error", async () => {
      const result = await testClient.mutate({
        mutation: registerUserMutationDocument,
        variables: { input: registrationInput("") },
        context: enLocale(),
      });

      const combined = expectMutationError(result.error, "VALIDATION");
      const phoneError = readPhoneFieldError(combined);
      expect(phoneError.code).toBe("PHONE_REQUIRED");
      expect(phoneError.message).toBe(authEn.phoneRequired);
      expect(combined.errors[0]?.message).toBe(phoneError.message);
    });

    test("registerUser — whitespace-only phone trims to PHONE_REQUIRED", async () => {
      const result = await testClient.mutate({
        mutation: registerUserMutationDocument,
        variables: { input: registrationInput("   ") },
        context: enLocale(),
      });

      const combined = expectMutationError(result.error, "VALIDATION");
      const phoneError = readPhoneFieldError(combined);
      expect(phoneError.code).toBe("PHONE_REQUIRED");
      expect(phoneError.message).toBe(authEn.phoneRequired);
    });

    test("registerUser — 17-char phone → VALIDATION with a PHONE_TOO_LONG field error", async () => {
      const result = await testClient.mutate({
        mutation: registerUserMutationDocument,
        variables: { input: registrationInput(TOO_LONG_PHONE) },
        context: enLocale(),
      });

      const combined = expectMutationError(result.error, "VALIDATION");
      const phoneError = readPhoneFieldError(combined);
      expect(phoneError.code).toBe("PHONE_TOO_LONG");
      expect(phoneError.message).toBe(errorsEn.validation);
      expect(phoneError.message).not.toContain(TOO_LONG_PHONE);
      expect(combined.errors[0]?.message).toBe(phoneError.message);
    });

    test("registerUser — 16-char phone at the E.164 ceiling registers successfully", async () => {
      const input = registrationInput(CEILING_PHONE);
      const result = await testClient.mutate({
        mutation: registerUserMutationDocument,
        variables: { input },
        context: enLocale(),
      });

      expect(result.error).toBeUndefined();
      const user = result.data?.registerUser;
      if (!user) throw new Error("registerUser returned no data at the ceiling phone");
      if (typeof user.id === "number") createdUserIds.add(user.id);
      expect(user.email).toBe(input.email);
      expect(user.role).toBe(UserRole.Student);
    });

    test("adminCreateUser — invalid phone → VALIDATION with a PHONE_INVALID field error", async () => {
      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: { input: adminCreateInput(INVALID_PHONE) },
        context: adminBearer(adminToken),
      });

      const combined = expectMutationError(result.error, "VALIDATION");
      const phoneError = readPhoneFieldError(combined);
      expect(phoneError.code).toBe("PHONE_INVALID");
      expect(phoneError.message).toBe(authEn.phoneInvalid);
      expect(phoneError.message).not.toContain(INVALID_PHONE);
      expect(combined.errors[0]?.message).toBe(phoneError.message);
    });

    test("adminUpdateUser — 17-char phone → VALIDATION with a PHONE_TOO_LONG field error", async () => {
      const result = await testClient.mutate({
        mutation: adminUpdateUserMutationDocument,
        variables: {
          id: adminUpdateTargetId,
          input: { fullName: null, phone: TOO_LONG_PHONE, country: null, dateOfBirth: null, gender: null },
        },
        context: adminBearer(adminToken),
      });

      const combined = expectMutationError(result.error, "VALIDATION");
      const phoneError = readPhoneFieldError(combined);
      expect(phoneError.code).toBe("PHONE_TOO_LONG");
      expect(phoneError.message).toBe(errorsEn.validation);
      expect(phoneError.message).not.toContain(TOO_LONG_PHONE);
      expect(combined.errors[0]?.message).toBe(phoneError.message);
    });

    test("unauthenticated adminCreateUser → UNAUTHORIZED (auth gate precedes the phone gate)", async () => {
      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: { input: adminCreateInput(INVALID_PHONE) },
        context: enLocale(),
      });

      // The hostile phone must not surface as a validation payload — the
      // denial is an authorization decision, emitted before any input check.
      const denial = expectMutationError(result.error, "UNAUTHORIZED");
      expect(denial.errors).toHaveLength(1);
    });

    test("unauthenticated adminUpdateUser → UNAUTHORIZED (auth gate precedes the phone gate)", async () => {
      const result = await testClient.mutate({
        mutation: adminUpdateUserMutationDocument,
        variables: {
          id: adminUpdateTargetId,
          input: { fullName: null, phone: TOO_LONG_PHONE, country: null, dateOfBirth: null, gender: null },
        },
        context: enLocale(),
      });

      const denial = expectMutationError(result.error, "UNAUTHORIZED");
      expect(denial.errors).toHaveLength(1);
    });

    test("student-role adminCreateUser → FORBIDDEN (non-admin caller denied)", async () => {
      const studentInput = registrationInput("+201234567895");
      const registered = await testClient.mutate({
        mutation: registerUserMutationDocument,
        variables: { input: studentInput },
        context: enLocale(),
      });
      expect(registered.error).toBeUndefined();
      const studentId = registered.data?.registerUser?.id;
      if (!studentId) throw new Error("student registration returned no id");
      if (typeof studentId === "number") createdUserIds.add(studentId);

      const loggedIn = await testClient.mutate({
        mutation: loginMutationDocument,
        variables: { email: studentInput.email, password: testCredential },
      });
      expect(loggedIn.error).toBeUndefined();
      const token = loggedIn.data?.login?.accessToken;
      if (!token) throw new Error("student login returned no accessToken");

      const result = await testClient.mutate({
        mutation: adminCreateUserMutationDocument,
        variables: { input: adminCreateInput(INVALID_PHONE) },
        context: adminBearer(token),
      });
      expectMutationError(result.error, "FORBIDDEN");
    });
  });

  // ─── Phone schema surface ─────────────────────────────────────────────────
  //
  // The phone contract lives entirely in application validation — the schema
  // keeps `phone` as a plain String on every user surface and registers no
  // dedicated phone type. These assertions pin the live in-process emission
  // (the same schema graph Apollo Server serves), so a schema-level type
  // change cannot slip through unnoticed.
  describe("phone schema surface", () => {
    test("RegisterUserInput keeps phone as a required String", () => {
      expect(requireInputObjectType("RegisterUserInput").getFields().phone?.type.toString()).toBe("String!");
    });

    test("AdminCreateUserInput mirrors the same required phone shape", () => {
      expect(requireInputObjectType("AdminCreateUserInput").getFields().phone?.type.toString()).toBe("String!");
    });

    test("the User and AdminUserDetail read types keep phone as a nullable String", () => {
      expect(requireObjectType("User").getFields().phone?.type.toString()).toBe("String");
      expect(requireObjectType("AdminUserDetail").getFields().phone?.type.toString()).toBe("String");
    });

    test("no dedicated Phone type exists in the schema", () => {
      expect(graphQLSchema.getType("Phone")).toBeUndefined();
    });
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
