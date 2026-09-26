/**
 * `studentProgress` GraphQL wire matrix — the role × scope × payload tier for
 * the curriculum-progress read (`setupTestServerLifecycle` + `testClient`,
 * raw `fetch` where byte-shape matters).
 *
 * This suite drives the REAL wire (HTTP → gateway pipeline → scope-auth →
 * resolver → StudentProgressService → PostgreSQL → back) for the ONE new
 * root query field `studentProgress(studentId: Int!): StudentProgress!`:
 *
 *  - **Happy path × 3 roles** — the student themself, a teacher sharing at
 *    least one session row with the student, and an admin each read the SAME
 *    full pointer payload over the wire: the governing plan echo, the
 *    current lesson (id/title/1-based position), the completed count, the
 *    floor percentage, and the final-lesson flag. The three responses carry
 *    identical field values (shared-state visibility).
 *  - **Honest-zero payload** — a student holding an active tajweed-lane
 *    subscription but no pointer row yet reads `hasProgress: false` with
 *    null lesson fields and zeroed counters — never a fabricated percentage.
 *  - **Anonymous (401)** — the `authenticated` scope answers UNAUTHORIZED
 *    before any resolver runs; the raw-wire body carries a single error item
 *    with a correlated `requestId`, the localized copy, and NEVER a
 *    stacktrace.
 *  - **Parent (403, scope layer)** — the parent role fails the `role` scope
 *    leg into the canonical localized FORBIDDEN. The denial is proven to
 *    happen WITHOUT any service invocation: three probes with three
 *    different `studentId` values (a real foreign id, `0`, `-1`) answer
 *    BYTE-IDENTICAL bodies — the argument never reaches the resolver body
 *    (and therefore never reaches the service gate or the database), since
 *    only scope-auth ran.
 *  - **Foreign teacher (403, service gate)** — a teacher sharing no session
 *    row with the student is denied by the service's constant-shape
 *    `ForbiddenError`: probing a REAL student id and a NON-EXISTENT id
 *    yields BYTE-IDENTICAL denials (no existence oracle).
 *  - **Malformed id, pre-service** — a non-integer variable and an
 *    out-of-range `Int` literal die at GRAPHQL_VALIDATION_FAILED (parse /
 *    coercion — `data` absent from the body); non-positive ids pass the
 *    Int gate and are rejected by the service's own validation with the
 *    localized `STUDENT_NOT_FOUND` code.
 *  - **Locale negotiation** — denial copy localized through the error
 *    translations: one en + one ar assertion per denial class (UNAUTHORIZED
 *    + FORBIDDEN), expected copy resolved through the locale keys (never
 *    hardcoded strings). `Accept-Language` is the locale channel.
 *
 * Fixture strategy (matches the sibling parent-monitoring wire suite):
 *  - Actors ride the PUBLIC `registerUser` mutation over the wire (real
 *    credential path — registration mints the Student/Parent role-child
 *    rows server-side); the admin rides the sanctioned direct-DB
 *    provisioning seam (no public admin registration), then logs in over the
 *    real login path.
 *  - The linked teacher is anchored with the certified `teacher` child-row
 *    insert (registerUser never mints one) and ONE session row linking it to
 *    the student — the service's pair-count gate counts ANY lifecycle state.
 *  - The curriculum context (tajweed-lane plan + three id-ASC lessons +
 *    ACTIVE subscriptions + the pointer row) is provisioned through direct-DB
 *    fixture inserts — the only writer of the pointer row is the internal
 *    settlement path, which no wire operation exercises here.
 *  - Teardown in `afterAll` deletes session/pointer/subscription rows
 *    BEFORE the role-child rows and users (RESTRICT FKs), with the
 *    audit-delete triggers suspended around the plan/lesson deletes (the
 *    lessons-suite precedent), and closes with a zero-residue re-probe on
 *    the fixture users.
 *
 * ENVIRONMENT NOTE (sandbox): the canonical lifecycle helper boots its own
 * dev server on TEST_PORT (3066) when nothing answers there; where a server
 * already owns the port the liveness probe succeeds and no second server is
 * spawned.
 *
 * Mandated runner: bun run test/scripts/run-server-tests.ts backend/graphql/test/student-progress.wire.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { gql } from "@apollo/client";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { plans as plansSchema } from "@/backend/db/schema/billing/plans";
import { subscriptions as subscriptionsSchema } from "@/backend/db/schema/billing/subscriptions";
import { lessons as lessonsSchema } from "@/backend/db/schema/classes/lessons";
import { progress as progressSchema } from "@/backend/db/schema/classes/progress";
import { session as sessionSchema } from "@/backend/db/schema/classes/session";
import { parents as parentsSchema } from "@/backend/db/schema/parents/parents";
import { students as studentsSchema } from "@/backend/db/schema/students/students";
import { applicants as applicantsSchema } from "@/backend/db/schema/teachers/applicants";
import { teacher as teacherSchema } from "@/backend/db/schema/teachers/teacher";
import { admin as adminSchema } from "@/backend/db/schema/users/admin";
import { users as usersSchema } from "@/backend/db/schema/users/users";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  expectMutationError,
  insertAdminUserWithChildRow,
  setupTestServerLifecycle,
  TEST_PORT,
  testClient,
} from "@/test/helpers";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";

setupTestServerLifecycle();

// ─── Locale-key expected copy (never hardcoded strings) ──────────────────────

const tEn = getServerTranslations("en").errorsTranslations;
const tAr = getServerTranslations("ar").errorsTranslations;

// ─── Runtime guards (no casts, per test-tier discipline) ─────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

/** The single GraphQL error item of a denial response, runtime-guarded. */
function soleErrorItemOf(body: Record<string, unknown>): Record<string, unknown> {
  const errors = recordOf(body, "expected a response body").errors;
  if (!Array.isArray(errors) || errors.length !== 1) {
    throw new Error("expected exactly one error item");
  }
  return recordOf(errors[0], "expected a record-shaped error item");
}

function errorCodeOf(errorItem: Record<string, unknown>): string {
  const code = recordOf(errorItem.extensions, "expected record-shaped extensions").code;
  if (typeof code !== "string") {
    throw new Error("expected a string error code");
  }
  return code;
}

function errorMessageOf(errorItem: Record<string, unknown>): string {
  const message = errorItem.message;
  if (typeof message !== "string") {
    throw new Error("expected a string error message");
  }
  return message;
}

/**
 * Serializes a wire body with the per-request `requestId` redacted — the
 * correlation id is intentionally unique per request, so byte-identical
 * denial-shape comparisons across multiple probes must normalize it. Every
 * other field is preserved verbatim (message, path, locations, extensions).
 */
function bodyShapeOf(body: Record<string, unknown>): string {
  return JSON.stringify(body).replace(/"requestId":"[^"]+"/g, '"requestId":"<redacted>"');
}

// ─── Wire helpers ────────────────────────────────────────────────────────────

const GRAPHQL_URL = `http://localhost:${TEST_PORT}/api/graphql`;
const WIRE_CREDENTIAL = "WireProgress!Pass1";
const FIXTURE_MARKER = `spwire-${randomUUID().slice(0, 8)}`;
const FIXTURE_ADMIN_EMAIL = `${FIXTURE_MARKER}-admin@test.local`;
const FIXTURE_PLAN_TITLE = `${FIXTURE_MARKER} Tajweed Plan`;

const STUDENT_PROGRESS_DOCUMENT = `
  query WireStudentProgress($studentId: Int!) {
    studentProgress(studentId: $studentId) {
      hasProgress
      studentId
      planId
      planTitle
      totalLessons
      currentLessonId
      currentLessonTitle
      currentLessonPosition
      lessonsCompleted
      completionPercent
      isOnFinalLesson
    }
  }
`;

/** POSTs one document over the wire with a Bearer access token (+ extra headers). */
async function postDocument(
  query: string,
  accessToken: string,
  variables?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
    },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

/** POSTs one document over the wire with NO credential headers (+ extra headers). */
async function postAnonymous(
  query: string,
  variables?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  return recordOf(await response.json(), "expected a JSON object response");
}

/**
 * Asserts one raw-wire denial body answers the expected extensions.code with
 * the shipped error contract: single-item envelope, `data: null` (the root
 * field is non-nullable — a field error nulls the whole data object), a
 * correlated requestId, and NEVER a stacktrace. Returns the error item.
 */
function expectDenialCode(body: Record<string, unknown>, expectedCode: string): Record<string, unknown> {
  const errorItem = soleErrorItemOf(body);
  expect(errorCodeOf(errorItem)).toBe(expectedCode);
  expect(body.data).toBeNull();
  const requestId = recordOf(errorItem.extensions, "expected extensions").requestId;
  expect(typeof requestId === "string" && requestId.length > 0).toBe(true);
  expect(JSON.stringify(errorItem)).not.toContain("stacktrace");
  return errorItem;
}

/** The `studentProgress` wire payload, runtime-guarded (no casts). */
function progressPayloadOf(body: Record<string, unknown>): {
  readonly hasProgress: boolean;
  readonly studentId: number;
  readonly planId: number | null;
  readonly planTitle: string | null;
  readonly totalLessons: number;
  readonly currentLessonId: number | null;
  readonly currentLessonTitle: string | null;
  readonly currentLessonPosition: number | null;
  readonly lessonsCompleted: number;
  readonly completionPercent: number;
  readonly isOnFinalLesson: boolean;
} {
  const data = recordOf(recordOf(body, "expected a body").data, "expected a data object");
  const payload = recordOf(data.studentProgress, "expected a studentProgress payload");
  const num = (key: string): number => {
    const value = payload[key];
    if (typeof value !== "number") {
      throw new Error(`expected a numeric ${key} on the wire`);
    }
    return value;
  };
  const numOrNull = (key: string): number | null => (payload[key] === null ? null : num(key));
  const strOrNull = (key: string): string | null => {
    const value = payload[key];
    if (value !== null && typeof value !== "string") {
      throw new Error(`expected a string or null ${key} on the wire`);
    }
    return value;
  };
  const bool = (key: string): boolean => {
    const value = payload[key];
    if (typeof value !== "boolean") {
      throw new Error(`expected a boolean ${key} on the wire`);
    }
    return value;
  };
  return {
    hasProgress: bool("hasProgress"),
    studentId: num("studentId"),
    planId: numOrNull("planId"),
    planTitle: strOrNull("planTitle"),
    totalLessons: num("totalLessons"),
    currentLessonId: numOrNull("currentLessonId"),
    currentLessonTitle: strOrNull("currentLessonTitle"),
    currentLessonPosition: numOrNull("currentLessonPosition"),
    lessonsCompleted: num("lessonsCompleted"),
    completionPercent: num("completionPercent"),
    isOnFinalLesson: bool("isOnFinalLesson"),
  };
}

/** Extracts the access token from a login mutation result. */
function accessTokenOf(result: { readonly data?: unknown }): string {
  const data = recordOf(result.data, "login returned no data");
  const payload = recordOf(data.login, "login returned no payload");
  const token = payload.accessToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("login accessToken must be a non-empty string");
  }
  return token;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** One wire-tier actor: identity bits + the access token. */
interface WireActor {
  readonly label: string;
  readonly userId: number;
  readonly accessToken: string;
}

let actors: WireActor[] = [];
let studentMainId = 0;
let studentNoProgressId = 0;
let linkedTeacherId = 0;
let foreignTeacherId = 0;
let parentId = 0;
let adminId = 0;
let planId = 0;
const lessonIds: number[] = [];
let pointerLessonId = 0;
let linkedSessionId = 0;

/** Registers one actor over the wire through the PUBLIC registerUser mutation. */
async function registerActor(label: string, role: "Student" | "Teacher" | "Parent"): Promise<number> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation RegisterStudentProgressWireActor($input: RegisterUserInput!) {
        registerUser(input: $input) {
          id
        }
      }
    `,
    variables: {
      input: {
        fullName: `Wire Progress ${label} ${FIXTURE_MARKER}`,
        email: `${FIXTURE_MARKER}-${label}@test.local`,
        phone: "+15551234567",
        password: WIRE_CREDENTIAL,
        country: "US",
        role,
      },
    },
  });
  if (result.error) {
    throw new Error(`registerUser failed for ${label}`);
  }
  const data = recordOf(result.data, "registerUser returned no data");
  const payload = recordOf(data.registerUser, "registerUser returned no payload");
  const parsed = Number.parseInt(String(payload.id), 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("registerUser id must be a safe integer");
  }
  return parsed;
}

/**
 * Registers the fixture cast ONE AT A TIME (sequential reduce — the sanctioned
 * no-await-in-loop idiom; the registration service transaction is the one
 * step whose nesting must not interleave).
 */
async function registerActorCast(
  specs: readonly (readonly [label: string, role: "Student" | "Teacher" | "Parent"])[]
): Promise<number[]> {
  return specs.reduce<Promise<number[]>>(
    async (ids, [label, role]) => [...(await ids), await registerActor(label, role)],
    Promise.resolve([])
  );
}

/** Logs one actor in over the wire and returns the access token. */
async function loginActor(email: string, credential: string): Promise<string> {
  const result = await testClient.mutate({
    mutation: gql`
      mutation LoginStudentProgressWireActor($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          accessToken
        }
      }
    `,
    variables: { email, password: credential },
  });
  if (result.error) {
    throw new Error(`login failed for ${email}`);
  }
  return accessTokenOf(result);
}

function actorByLabel(label: string): WireActor {
  const actor = actors.find(candidate => candidate.label === label);
  if (!actor) {
    throw new Error(`expected the ${label} actor fixture`);
  }
  return actor;
}

/** The expected full-pointer payload for the fixture student (single truth). */
function expectedPointerPayload() {
  return {
    hasProgress: true,
    studentId: studentMainId,
    planId,
    planTitle: FIXTURE_PLAN_TITLE,
    totalLessons: 3,
    currentLessonId: lessonIds[1],
    currentLessonTitle: `${FIXTURE_MARKER} Lesson 2`,
    currentLessonPosition: 2,
    lessonsCompleted: 1,
    completionPercent: 33, // floor(1 * 100 / 3)
    isOnFinalLesson: false,
  };
}

beforeAll(async () => {
  // Real registrations through the public mutation (committed users + the
  // role-child rows), SEQUENTIAL via registerActorCast:
  //  - studentMain — owns the curriculum context + pointer row.
  //  - studentNoProgress — active subscription, NO pointer row (honest zero).
  //  - teacherLinked — shares one session row with studentMain.
  //  - teacherForeign — shares NO session row (the service-gate denial arm).
  //  - parentP — the wrong-role scope denial arm.
  const [
    registeredStudentMain,
    registeredStudentNoProgress,
    registeredTeacherLinked,
    registeredTeacherForeign,
    registeredParent,
  ] = await registerActorCast([
    ["studentMain", "Student"],
    ["studentNoProgress", "Student"],
    ["teacherLinked", "Teacher"],
    ["teacherForeign", "Teacher"],
    ["parentP", "Parent"],
  ]);

  // Admin has no public registration (RegisterPublicRole BFLA exclusion) —
  // the sanctioned direct-DB provisioning seam, then a REAL wire login.
  adminId = await insertAdminUserWithChildRow({
    fullName: `Wire Progress admin ${FIXTURE_MARKER}`,
    email: FIXTURE_ADMIN_EMAIL,
    phone: "+15551234568",
    password: WIRE_CREDENTIAL,
  });

  const [studentMainToken, studentNoProgressToken, teacherLinkedToken, teacherForeignToken, parentToken, adminToken] =
    await Promise.all([
      loginActor(`${FIXTURE_MARKER}-studentMain@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-studentNoProgress@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-teacherLinked@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-teacherForeign@test.local`, WIRE_CREDENTIAL),
      loginActor(`${FIXTURE_MARKER}-parentP@test.local`, WIRE_CREDENTIAL),
      loginActor(FIXTURE_ADMIN_EMAIL, WIRE_CREDENTIAL),
    ]);

  studentMainId = registeredStudentMain;
  studentNoProgressId = registeredStudentNoProgress;
  linkedTeacherId = registeredTeacherLinked;
  foreignTeacherId = registeredTeacherForeign;
  parentId = registeredParent;

  actors = [
    { label: "studentMain", userId: studentMainId, accessToken: studentMainToken },
    { label: "studentNoProgress", userId: studentNoProgressId, accessToken: studentNoProgressToken },
    { label: "teacherLinked", userId: linkedTeacherId, accessToken: teacherLinkedToken },
    { label: "teacherForeign", userId: foreignTeacherId, accessToken: teacherForeignToken },
    { label: "parentP", userId: parentId, accessToken: parentToken },
    { label: "admin", userId: adminId, accessToken: adminToken },
  ];

  // Certified-teacher child row for the linked teacher (registerUser never
  // mints one) — the session FK needs it.
  await db.insert(teacherSchema).values({ id: linkedTeacherId, isApproved: true });

  // Curriculum context: ONE tajweed-lane plan + THREE lessons created
  // sequentially (creation order IS the `id ASC` sequence) + an ACTIVE
  // subscription per student on that plan + the pointer row for studentMain
  // pointing at the SECOND lesson.
  const [planRow] = await db
    .insert(plansSchema)
    .values({
      title: FIXTURE_PLAN_TITLE,
      sessionCount: 5,
      price: "100.00",
      currency: "EGP",
      intervalDays: 30,
      balanceLane: SubscriptionCreditLane.Tajweed,
    })
    .returning({ id: plansSchema.id });
  if (!planRow) {
    throw new Error("plan insert returned no rows");
  }
  planId = planRow.id;

  const createdLessonIds = await [1, 2, 3].reduce<Promise<number[]>>(async (ids, ordinal) => {
    const settled = await ids;
    const [lessonRow] = await db
      .insert(lessonsSchema)
      .values({ planId, title: `${FIXTURE_MARKER} Lesson ${ordinal}` })
      .returning({ id: lessonsSchema.id });
    if (!lessonRow) {
      throw new Error("lesson insert returned no rows");
    }
    return [...settled, lessonRow.id];
  }, Promise.resolve([]));
  lessonIds.push(...createdLessonIds);
  pointerLessonId = lessonIds[1];

  await db.insert(subscriptionsSchema).values({
    userId: studentMainId,
    planId,
    status: SubscriptionStatus.Active,
    startDate: new Date(),
  });
  await db.insert(subscriptionsSchema).values({
    userId: studentNoProgressId,
    planId,
    status: SubscriptionStatus.Active,
    startDate: new Date(),
  });

  await db.insert(progressSchema).values({ studentId: studentMainId, lessonId: pointerLessonId });

  // ONE session row links teacherLinked ↔ studentMain — the service's
  // pair-count gate counts ANY lifecycle state; everything else rides
  // schema defaults (the sibling wire-suite minimal-insert shape).
  const [sessionRow] = await db
    .insert(sessionSchema)
    .values({ teacherId: linkedTeacherId, studentId: studentMainId })
    .returning({ id: sessionSchema.id });
  if (!sessionRow) {
    throw new Error("session insert returned no rows");
  }
  linkedSessionId = sessionRow.id;
}, 120_000);

afterAll(async () => {
  const fixtureUserIds = actors.map(actor => actor.userId);
  // FK-safe order: sessions (RESTRICT FKs into teacher/students) → pointer
  // rows → subscriptions (RESTRICT FKs into users/plans) → plans/lessons
  // (audit-delete triggers suspended — the lessons-suite precedent) →
  // role-child rows → users.
  if (linkedSessionId > 0) {
    await db.delete(sessionSchema).where(eq(sessionSchema.id, linkedSessionId));
  }
  if (fixtureUserIds.length > 0) {
    await db.delete(progressSchema).where(inArray(progressSchema.studentId, fixtureUserIds));
    await db.delete(subscriptionsSchema).where(inArray(subscriptionsSchema.userId, fixtureUserIds));
  }
  await withAuditDeleteTriggersSuspended(async () => {
    if (lessonIds.length > 0) {
      await db.delete(lessonsSchema).where(inArray(lessonsSchema.id, lessonIds));
    }
    if (planId > 0) {
      await db.delete(plansSchema).where(eq(plansSchema.id, planId));
    }
  });
  if (fixtureUserIds.length > 0) {
    await db.delete(studentsSchema).where(inArray(studentsSchema.id, fixtureUserIds));
    await db.delete(applicantsSchema).where(inArray(applicantsSchema.id, fixtureUserIds));
    await db.delete(teacherSchema).where(inArray(teacherSchema.id, fixtureUserIds));
    await db.delete(parentsSchema).where(inArray(parentsSchema.id, fixtureUserIds));
    await db.delete(adminSchema).where(inArray(adminSchema.id, fixtureUserIds));
    await db.delete(usersSchema).where(inArray(usersSchema.id, fixtureUserIds));
    // Closing zero-residue re-probe (the journey-suite pattern): the
    // fixture users are asserted gone, not assumed gone.
    expect(await db.$count(usersSchema, inArray(usersSchema.id, fixtureUserIds))).toBe(0);
  }
}, 60_000);

// ─── Happy path: every admitted role reads the same pointer payload ─────────

describe("studentProgress — happy path per role (real pointer payload)", () => {
  test("the student themself reads the full pointer payload over the wire", async () => {
    const body = await postDocument(STUDENT_PROGRESS_DOCUMENT, actorByLabel("studentMain").accessToken, {
      studentId: studentMainId,
    });
    expect(body.errors).toBeUndefined();
    expect(progressPayloadOf(body)).toEqual(expectedPointerPayload());
  });

  test("the linked teacher reads the IDENTICAL payload (shared-session gate + shared-state visibility)", async () => {
    const body = await postDocument(STUDENT_PROGRESS_DOCUMENT, actorByLabel("teacherLinked").accessToken, {
      studentId: studentMainId,
    });
    expect(body.errors).toBeUndefined();
    expect(progressPayloadOf(body)).toEqual(expectedPointerPayload());
  });

  test("the admin reads the IDENTICAL payload (role scope + service bypass)", async () => {
    const body = await postDocument(STUDENT_PROGRESS_DOCUMENT, actorByLabel("admin").accessToken, {
      studentId: studentMainId,
    });
    expect(body.errors).toBeUndefined();
    expect(progressPayloadOf(body)).toEqual(expectedPointerPayload());
  });

  test("a student with an active tajweed subscription but NO pointer row reads the honest zero (never a fabricated percentage)", async () => {
    const body = await postDocument(STUDENT_PROGRESS_DOCUMENT, actorByLabel("studentNoProgress").accessToken, {
      studentId: studentNoProgressId,
    });
    expect(body.errors).toBeUndefined();
    expect(progressPayloadOf(body)).toEqual({
      hasProgress: false,
      studentId: studentNoProgressId,
      planId,
      planTitle: FIXTURE_PLAN_TITLE,
      totalLessons: 3,
      currentLessonId: null,
      currentLessonTitle: null,
      currentLessonPosition: null,
      lessonsCompleted: 0,
      completionPercent: 0,
      isOnFinalLesson: false,
    });
  });
});

// ─── Anonymous tier (401 — the `authenticated` scope, before any DB read) ────

describe("studentProgress — anonymous tier (401)", () => {
  test("a credential-less caller answers UNAUTHORIZED (testClient)", async () => {
    const result = await testClient.query({
      query: gql`
        query WireAnonymousStudentProgress($studentId: Int!) {
          studentProgress(studentId: $studentId) {
            hasProgress
          }
        }
      `,
      variables: { studentId: studentMainId },
      fetchPolicy: "no-cache",
    });
    const error = expectMutationError(result.error, "UNAUTHORIZED");
    expect(error.errors).toHaveLength(1);
  });

  test("the anonymous raw-wire body carries the localized copy (en + ar) and the constant error contract", async () => {
    const enBody = await postAnonymous("{ studentProgress(studentId: 1) { hasProgress } }");
    const enItem = expectDenialCode(enBody, "UNAUTHORIZED");
    expect(errorMessageOf(enItem)).toBe(tEn.unauthorized);

    const arBody = await postAnonymous("{ studentProgress(studentId: 1) { hasProgress } }", undefined, {
      "accept-language": "ar",
    });
    const arItem = expectDenialCode(arBody, "UNAUTHORIZED");
    expect(errorMessageOf(arItem)).toBe(tAr.unauthorized);
  });
});

// ─── Parent tier (403 — the `role` scope, WITHOUT any service invocation) ───

describe("studentProgress — parent tier (403 at the scope layer, pre-service)", () => {
  test("the parent is FORBIDDEN and three different arg values answer BYTE-IDENTICAL bodies (the arg never reaches the resolver)", async () => {
    // The BFLA proof shape of the sibling wire suites: the scope rejects
    // before the resolver body runs, so the `studentId` argument can never
    // reach the service gate or the database. Byte-identical denials across
    // a REAL foreign student id, `0`, and `-1` are the wire-level evidence
    // that NO service invocation happened — a service-passing call would
    // diverge (a real id returns a payload; 0/-1 raise STUDENT_NOT_FOUND),
    // while these three bodies are the same denial down to the redacted
    // requestId.
    const parentToken = actorByLabel("parentP").accessToken;
    const realIdBody = await postDocument(STUDENT_PROGRESS_DOCUMENT, parentToken, { studentId: studentNoProgressId });
    const zeroIdBody = await postDocument(STUDENT_PROGRESS_DOCUMENT, parentToken, { studentId: 0 });
    const negativeIdBody = await postDocument(STUDENT_PROGRESS_DOCUMENT, parentToken, { studentId: -1 });

    const realIdItem = expectDenialCode(realIdBody, "FORBIDDEN");
    expectDenialCode(zeroIdBody, "FORBIDDEN");
    expectDenialCode(negativeIdBody, "FORBIDDEN");
    expect(bodyShapeOf(realIdBody)).toBe(bodyShapeOf(zeroIdBody));
    expect(bodyShapeOf(zeroIdBody)).toBe(bodyShapeOf(negativeIdBody));
    expect(errorMessageOf(realIdItem)).toBe(tEn.forbidden);
  });

  test("the parent denial copy is localized through the Accept-Language channel (ar)", async () => {
    const body = await postDocument(
      "{ studentProgress(studentId: 1) { hasProgress } }",
      actorByLabel("parentP").accessToken,
      undefined,
      { "accept-language": "ar" }
    );
    const item = expectDenialCode(body, "FORBIDDEN");
    expect(errorMessageOf(item)).toBe(tAr.forbidden);
  });
});

// ─── Foreign teacher (403 — the service gate's constant shape, no oracle) ───

describe("studentProgress — foreign teacher tier (403 at the service gate)", () => {
  test("a teacher sharing no session row is FORBIDDEN with a constant shape across real + nonexistent ids (no existence oracle)", async () => {
    const foreignToken = actorByLabel("teacherForeign").accessToken;
    const realStudentBody = await postDocument(STUDENT_PROGRESS_DOCUMENT, foreignToken, { studentId: studentMainId });
    const nonexistentBody = await postDocument(STUDENT_PROGRESS_DOCUMENT, foreignToken, { studentId: 999_999_999 });

    const realStudentItem = expectDenialCode(realStudentBody, "FORBIDDEN");
    expectDenialCode(nonexistentBody, "FORBIDDEN");
    expect(bodyShapeOf(realStudentBody)).toBe(bodyShapeOf(nonexistentBody));
    expect(errorMessageOf(realStudentItem)).toBe(tEn.forbidden);
  });
});

// ─── Malformed id (pre-service: parse rejection or service validation) ──────

describe("studentProgress — malformed id rejected before the service", () => {
  test("a non-integer variable dies at variable-coercion (BAD_USER_INPUT — data absent, pre-service)", async () => {
    const body = await postDocument(STUDENT_PROGRESS_DOCUMENT, actorByLabel("admin").accessToken, {
      studentId: 1.5,
    });
    expect(body.data).toBeUndefined();
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("BAD_USER_INPUT");
  });

  test("an out-of-range Int literal dies at GRAPHQL_VALIDATION_FAILED before any resolver", async () => {
    const body = await postDocument(
      `{ studentProgress(studentId: 2147483648) { hasProgress } }`,
      actorByLabel("admin").accessToken
    );
    expect(body.data).toBeUndefined();
    expect(errorCodeOf(soleErrorItemOf(body))).toBe("GRAPHQL_VALIDATION_FAILED");
  });

  test("non-positive ids pass the Int gate and are rejected by the service validation (STUDENT_NOT_FOUND)", async () => {
    const adminToken = actorByLabel("admin").accessToken;
    const zeroIdBody = await postDocument(STUDENT_PROGRESS_DOCUMENT, adminToken, { studentId: 0 });
    const negativeIdBody = await postDocument(STUDENT_PROGRESS_DOCUMENT, adminToken, { studentId: -1 });
    expectDenialCode(zeroIdBody, "STUDENT_NOT_FOUND");
    expectDenialCode(negativeIdBody, "STUDENT_NOT_FOUND");
  });
});
