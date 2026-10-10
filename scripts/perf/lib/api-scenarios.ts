/**
 * Scenario registry for the API load harness: the weighted mix of real
 * GraphQL operations every virtual user drives against the application
 * server, the request builders (cookie header, JSON body, and the booking
 * scenario's mandatory per-request idempotency key), and the outcome
 * expectation each scenario carries into the response classifier.
 *
 * Every document mirrors the repo's real shared GraphQL documents — same
 * operation names and field selections the application views send — so the
 * load exercises the production wire surface: login reuses the exact
 * minting document, reads select the post-enrichment subscription fields,
 * and the booking mutation sends the unique `x-idempotency-key` header the
 * server's idempotency claim table requires.
 */

import { LOGIN_MUTATION_DOCUMENT } from "@/scripts/perf/lib/auth-mint";

/** Identity class a scenario's cookie must belong to. */
export type ApiScenarioRole = "student" | "admin";

/**
 * Per-request build state. `runId` is the harness report run id (unique per
 * invocation) and `vu`/`iteration` are the request's coordinates — the
 * booking idempotency key derives from all three, so every key is unique
 * across the whole run. `targetUserId`/`teacherId` are the per-iteration
 * server-side row ids the admin read and the booking write address.
 * `credentials` carries the VU's own synthetic seed identity — only the
 * login scenario reads it (it re-authenticates as the VU); the values live
 * in harness memory and never leave the request body.
 */
export interface ApiScenarioRequestState {
  readonly runId: string;
  readonly vu: number;
  readonly iteration: number;
  readonly targetUserId: number;
  readonly teacherId: number;
  readonly credentials: { readonly email: string; readonly password: string };
}

/** One built HTTP request: JSON GraphQL body plus request headers. */
export interface ApiScenarioRequest {
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

/** One registry scenario: identity role, mix weight, builder, expectation. */
export interface ApiScenario {
  readonly id: string;
  /** The GraphQL operation the scenario drives (the data payload key). */
  readonly operationName: string;
  readonly weight: number;
  readonly role: ApiScenarioRole;
  readonly expect: { readonly kind: "graphql"; readonly mustSucceed: boolean };
  buildRequest(cookie: string, state: ApiScenarioRequestState): ApiScenarioRequest;
}

/** The booking write's mandatory unique-per-request idempotency key. */
export const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";

/** Server-side cap on the idempotency key length (varchar 128). */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * Builds the booking scenario's idempotency key: unique per request across
 * the whole run (per-invocation report run id × VU index × VU-local
 * iteration — both coordinates strictly increase).
 */
export function buildBookingIdempotencyKey(state: ApiScenarioRequestState): string {
  return `${state.runId}:vu${state.vu}:it${state.iteration}`;
}

// The documents below are whitespace-compressed mirrors of the repo's
// shared GraphQL documents (identical operation names, arguments, and
// field selections; GraphQL is whitespace-insensitive).

/** Student browse read (the plain directory page; the filtered variant reuses the same document). */
const BROWSE_TEACHERS_QUERY =
  "query BrowseAvailableTeachers($intent: SessionIntent, $minRating: Float, $page: Int, $pageSize: Int, " +
  "$recitation: RecitationReading, $search: String, $sort: TeacherMatchingSort) { browseAvailableTeachers(" +
  "intent: $intent, minRating: $minRating, page: $page, pageSize: $pageSize, recitation: $recitation, " +
  "search: $search, sort: $sort) { items { id fullName country countryCode subjects recitations languages " +
  "averageRating isOnline } total page pageSize pageCount } }";

/** Own subscription list with the enriched page fields selected. */
const MY_SUBSCRIPTIONS_QUERY =
  "query MySubscriptions { mySubscriptions { id planId plan { id title } status startDate endDate paymentMethod " +
  "paymentReference paymentVerifiedAt createdAt updatedAt auditEntriesCount auditTrailPeek { actionType at } } }";

/** One bounded page of the caller's own notification inbox. */
const MY_NOTIFICATIONS_QUERY =
  "query MyNotifications($filter: MyNotificationsFilterInput) { myNotifications(filter: $filter) { items { id " +
  "type title body isRead relatedEntityType relatedEntityId createdAt } totalCount hasMore } }";

/** The booking write (escrow-hold session creation). */
const CREATE_SESSION_MUTATION =
  "mutation CreateSession($input: CreateSessionInput!) { createSession(input: $input) { id status intent " +
  "sessionType fee feeHeld studentId teacherId startedAt endedAt confirmationDeadline confirmedByStudentAt " +
  "confirmedByTeacherAt createdAt updatedAt cancelReason disputeReason disputedAt resolutionNote " +
  "resolutionOutcome resolvedAt } }";

/** The admin read of one student's subscriptions (the enriched row selection inlined). */
const ADMIN_STUDENT_SUBSCRIPTIONS_QUERY =
  "query AdminStudentSubscriptions($userId: ID!) { adminStudentSubscriptions(userId: $userId) { id planId status " +
  "startDate endDate createdAt updatedAt auditEntriesCount auditTrailPeek { actionType at } plan { id title " +
  "sessionCount intervalDays price currency balanceLane } } }";

/** Default page bounds the browse reads send (the application's explicit-pagination convention). */
const BROWSE_PAGE = 1;
const BROWSE_PAGE_SIZE = 25;

/** The notifications page bound (bounded read). */
const NOTIFICATIONS_PAGE_LIMIT = 25;

/** The filter mix the filtered browse variant engages. */
const BROWSE_FILTERS = {
  intent: "Hifz",
  minRating: 4,
  recitation: "HAFS_AN_ASIM",
  sort: "NameAsc",
} as const;

function graphqlRequest(cookie: string, query: string, variables: Record<string, unknown>): ApiScenarioRequest {
  return {
    body: { query, variables },
    headers: { "content-type": "application/json", cookie },
  };
}

export const API_SCENARIOS: readonly ApiScenario[] = [
  {
    id: "login",
    operationName: "login",
    weight: 10,
    role: "student",
    expect: { kind: "graphql", mustSucceed: true },
    buildRequest: (cookie, state) =>
      graphqlRequest(cookie, LOGIN_MUTATION_DOCUMENT, {
        email: state.credentials.email,
        password: state.credentials.password,
      }),
  },
  {
    id: "browse-teachers",
    operationName: "browseAvailableTeachers",
    weight: 20,
    role: "student",
    expect: { kind: "graphql", mustSucceed: true },
    buildRequest: cookie =>
      graphqlRequest(cookie, BROWSE_TEACHERS_QUERY, { page: BROWSE_PAGE, pageSize: BROWSE_PAGE_SIZE }),
  },
  {
    id: "browse-teachers-filtered",
    operationName: "browseAvailableTeachers",
    weight: 20,
    role: "student",
    expect: { kind: "graphql", mustSucceed: true },
    buildRequest: cookie =>
      graphqlRequest(cookie, BROWSE_TEACHERS_QUERY, {
        intent: BROWSE_FILTERS.intent,
        minRating: BROWSE_FILTERS.minRating,
        page: BROWSE_PAGE,
        pageSize: BROWSE_PAGE_SIZE,
        recitation: BROWSE_FILTERS.recitation,
        search: null,
        sort: BROWSE_FILTERS.sort,
      }),
  },
  {
    id: "my-subscriptions",
    operationName: "mySubscriptions",
    weight: 20,
    role: "student",
    expect: { kind: "graphql", mustSucceed: true },
    buildRequest: cookie => graphqlRequest(cookie, MY_SUBSCRIPTIONS_QUERY, {}),
  },
  {
    id: "my-notifications",
    operationName: "myNotifications",
    weight: 20,
    role: "student",
    expect: { kind: "graphql", mustSucceed: true },
    buildRequest: cookie =>
      graphqlRequest(cookie, MY_NOTIFICATIONS_QUERY, { filter: { limit: NOTIFICATIONS_PAGE_LIMIT, offset: 0 } }),
  },
  {
    id: "book-session",
    operationName: "createSession",
    weight: 10,
    role: "student",
    expect: { kind: "graphql", mustSucceed: false },
    buildRequest: (cookie, state) => {
      const request = graphqlRequest(cookie, CREATE_SESSION_MUTATION, {
        input: { intent: "Hifz", teacherId: String(state.teacherId) },
      });
      const key = buildBookingIdempotencyKey(state);
      if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        throw new Error(
          `booking idempotency key exceeds the server's ${IDEMPOTENCY_KEY_MAX_LENGTH}-char cap (${key.length})`
        );
      }
      return { body: request.body, headers: { ...request.headers, [IDEMPOTENCY_KEY_HEADER]: key } };
    },
  },
  {
    id: "admin-student-subscriptions",
    operationName: "adminStudentSubscriptions",
    weight: 10,
    role: "admin",
    expect: { kind: "graphql", mustSucceed: true },
    buildRequest: (cookie, state) =>
      graphqlRequest(cookie, ADMIN_STUDENT_SUBSCRIPTIONS_QUERY, { userId: String(state.targetUserId) }),
  },
];

/** Registry lookup by scenario id (undefined when the id is unknown). */
export function findApiScenario(id: string): ApiScenario | undefined {
  return API_SCENARIOS.find(scenario => scenario.id === id);
}

/** Pages the browse read to harvest eligible teacher ids before the load window. */
export const TEACHER_HARVEST_PAGES = 2;

/** Builds one harvest page request (same wire shape as the browse scenario). */
export function buildTeacherHarvestRequest(cookie: string, page: number): ApiScenarioRequest {
  return graphqlRequest(cookie, BROWSE_TEACHERS_QUERY, { page, pageSize: BROWSE_PAGE_SIZE });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts the numeric teacher ids from one harvest page (empty when the shape is unusable). */
export function parseHarvestedTeacherIds(body: Record<string, unknown> | null): readonly number[] {
  if (body === null || !isPlainRecord(body.data)) {
    return [];
  }
  const page: unknown = body.data.browseAvailableTeachers;
  if (!isPlainRecord(page) || !Array.isArray(page.items)) {
    return [];
  }
  const ids: number[] = [];
  for (const item of page.items) {
    if (!isPlainRecord(item)) {
      continue;
    }
    const id: unknown = item.id;
    if (typeof id === "string" || typeof id === "number") {
      const numeric = Number(id);
      if (Number.isInteger(numeric) && numeric > 0) {
        ids.push(numeric);
      }
    }
  }
  return ids;
}
