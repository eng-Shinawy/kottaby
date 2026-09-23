import { NotificationType as BackendNotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NotificationType } from "@/frontend/graphql/generated/gql/graphql";

/**
 * The student link-requests decision route — ONE definition site for every
 * parent-link deep-link consumer (the drawer's row anchors, the dashboard
 * discoverability-card CTA, and the student nav entry) so the three never
 * drift.
 *
 * Leaf module: directive-free and framework-free — NO `"use client"`,
 * NO Apollo, NO logger — so nav/card/test consumers import the constant and
 * resolver WITHOUT transitively dragging the drawer-actions hook graph.
 * (The generated-gql import is runtime-inert: the generated module's only
 * import is type-only, so the codegen enum adds no dependency edge.)
 */
export const STUDENT_LINK_REQUESTS_ROUTE = "/student/link-requests";

/** The admin arbitration console — the landing surface for dispute rows. */
const ADMIN_DISPUTES_ROUTE = "/disputes";

/**
 * The student sessions route — ONE definition site for every student
 * sessions-page navigation consumer (the student nav entry and the
 * session-completion notification deep link) so the two never drift.
 *
 * Same leaf-module discipline as `STUDENT_LINK_REQUESTS_ROUTE` above:
 * directive-free and framework-free, safe for nav/card/test consumers.
 */
export const STUDENT_SESSIONS_ROUTE = "/student/sessions";

/**
 * The teacher sessions route — ONE definition site for every teacher
 * sessions-page navigation consumer (the teacher nav entry, the
 * session-completion notification deep link, and the dashboard's
 * up-next glance rows) so they never drift.
 *
 * Same leaf-module discipline as `STUDENT_SESSIONS_ROUTE` above:
 * directive-free and framework-free, safe for nav/card/test consumers.
 */
export const TEACHER_SESSIONS_ROUTE = "/teacher/sessions";

/**
 * The parent portal's linked-children root — the entry surface of the parent
 * session deep link. ONE definition site for the route root the
 * SessionCompletion builder composes (the portal root's own session
 * resolution flow consumes the `session` parameter this route carries) so
 * the entry URL and the portal shell never drift.
 *
 * Same leaf-module discipline as the sibling route constants above:
 * directive-free and framework-free, safe for nav/card/test consumers.
 */
export const PARENT_PORTAL_ROOT_ROUTE = "/parent/children";

/** Fallback row target — the notifications feed page (the unchanged default). */
const NOTIFICATIONS_FEED_ROUTE = "/notifications";

/**
 * The session-entity pointer every session-family emitter persists (backend
 * `session-request-notification.service.ts` /
 * `session-request-notification.governance.ts` /
 * `session-report-notification.service.ts` /
 * `session-dispute-notification.service.ts` all write the same literal —
 * pinned here because no shared backend constant exists for it).
 */
const SESSION_ENTITY_TYPE = "session";

/**
 * The wire role vocabulary — EXACTLY the codegen `UserRole` values. Declared
 * as a string union so this leaf stays import-light; the conformance against
 * the generated enum is pinned in the deep-link suite (every member listed).
 */
type WireRole = "Admin" | "Parent" | "Student" | "Teacher";

/**
 * The wire notification-type vocabulary — EXACTLY the codegen
 * `NotificationType` values (PascalCase). String-union form for the same
 * leaf-import discipline; conformance pinned in the deep-link suite.
 */
const WIRE_NOTIFICATION_TYPES = [
  "EvaluationResult",
  "ParentLinkRequest",
  "PaymentConfirmation",
  "SessionCancellation",
  "SessionCompletion",
  "SessionDisputeOpened",
  "SessionDisputeResolved",
  "SessionRequest",
  "SystemBroadcast",
] as const;

/** Narrowing guard for the caller-supplied wire type (untrusted runtime shape). */
function isWireNotificationType(value: string): value is WireNotificationType {
  return (WIRE_NOTIFICATION_TYPES as readonly string[]).includes(value);
}

type WireNotificationType =
  | "EvaluationResult"
  | "ParentLinkRequest"
  | "PaymentConfirmation"
  | "SessionCancellation"
  | "SessionCompletion"
  | "SessionDisputeOpened"
  | "SessionDisputeResolved"
  | "SessionRequest"
  | "SystemBroadcast";

/** Narrowing guard for the caller-supplied wire role (untrusted runtime shape). */
function isWireRole(value: string | null | undefined): value is WireRole {
  return value === "Admin" || value === "Parent" || value === "Student" || value === "Teacher";
}

/**
 * The Parent audience's SessionCompletion cell — a BUILDER (not a static
 * string) composing the pure, synchronous ENTRY URL of the parent session
 * deep link: the portal root's linked-children route carrying the row's
 * session id as the `session` query parameter, which the portal root
 * resolves into the linked child's session view. This module stays a leaf
 * — no query, no side effect — and the resolver applies this builder ONLY
 * when the row carries a non-empty id, falling through to the feed page
 * otherwise: the matrix NEVER fabricates a route.
 */
function parentSessionCompletionEntry(relatedEntityId: string): string {
  return `${PARENT_PORTAL_ROOT_ROUTE}?session=${relatedEntityId}`;
}

/**
 * A session-matrix cell — either a static route string (the audience lands
 * on a fixed list surface) or a builder composing the route from the row's
 * `relatedEntityId` (the deep link needs the id). Builders receive a
 * non-empty string id; the resolver never invokes them without one.
 */
type SessionRouteCell = string | ((relatedEntityId: string) => string);

/**
 * The session-family deep-link matrix: `notificationType` → `role` → route.
 * A missing outer key (a session row whose type carries no routing contract)
 * or a missing inner cell (an audience the wave never reaches) resolves to
 * `undefined` and the resolver falls through to the feed page — the matrix
 * NEVER fabricates a route.
 *
 * Audiences (backend emitters):
 *  - `SessionDisputeOpened` reaches ONLY the admin cohort → the arbitration
 *    console; students/teachers never receive it (no cells for them).
 *  - `SessionDisputeResolved` reaches the two participants; a defensive
 *    admin cell routes to the console too (admins reviewing history land
 *    where the queue lives), while parents get none.
 *  - `SessionCompletion` / `SessionCancellation` / `SessionRequest` reach
 *    the participants → each role's own session list, except the parent
 *    audience of `SessionCompletion`: its cell is the builder composing
 *    the portal-root entry URL from the row's session id.
 */
const SESSION_ROUTES_BY_TYPE_AND_ROLE: Readonly<
  Partial<Record<WireNotificationType, Readonly<Partial<Record<WireRole, SessionRouteCell>>>>>
> = {
  SessionDisputeOpened: { Admin: ADMIN_DISPUTES_ROUTE },
  SessionDisputeResolved: {
    Admin: ADMIN_DISPUTES_ROUTE,
    Student: STUDENT_SESSIONS_ROUTE,
    Teacher: TEACHER_SESSIONS_ROUTE,
  },
  SessionCompletion: {
    Student: STUDENT_SESSIONS_ROUTE,
    Teacher: TEACHER_SESSIONS_ROUTE,
    Parent: parentSessionCompletionEntry,
  },
  SessionCancellation: { Student: STUDENT_SESSIONS_ROUTE, Teacher: TEACHER_SESSIONS_ROUTE },
  SessionRequest: { Student: STUDENT_SESSIONS_ROUTE, Teacher: TEACHER_SESSIONS_ROUTE },
};

/**
 * Drawer-row notification TYPE → deep-link route — the ROLE-LESS resolution
 * stage, consulted only when the row carries no resolvable wire role. The
 * row's `type` field carries the GraphQL wire name of the notification kind,
 * so every key is the codegen `NotificationType` enum's member — never a
 * bare string literal.
 *
 * The session-completion row routes by TYPE alone: its emitters persist the
 * plain table pointer `relatedEntityType: "session"` as the entity
 * discriminator, which is not a notification-kind marker — keying this deep
 * link on the varchar would key on the entity table and strand the row on
 * the feed (no emitter persists `"session_completion"` there). `undefined`
 * values model the runtime miss for an unknown type (the realtime
 * payload-map precedent in `use-notification-realtime.helpers.ts`).
 */
const NOTIFICATION_ROUTE_BY_TYPE: Readonly<Record<string, string | undefined>> = {
  // The student's session-completion row deep-links to the sessions list —
  // the surface where the Rate action lives.
  [NotificationType.SessionCompletion]: STUDENT_SESSIONS_ROUTE,
};

/**
 * `relatedEntityType` → deep-link route — the role-independent stage,
 * consulted before the session matrix. The persisted `related_entity_type`
 * varchar carries the backend `NotificationType` enum VALUE for the
 * STUDENT-targeted parent-link row (e.g. `"parent_link_request"`), so that
 * key is the enum's member — never a bare string literal. `undefined` values
 * model the runtime miss for an unknown entity type (the realtime payload-map
 * precedent in `use-notification-realtime.helpers.ts`).
 *
 * PARENT-targeted parent-link rows (issue #99) deliberately carry
 * audience-scoped refinement values (`parent_link_request_decision` /
 * `parent_link_request_expiry`, backend `parent-link-request.helpers.ts`)
 * that MISS this map — the fall-through below lands them on the notifications
 * feed instead of the student-only decision route. Adding them as keys is
 * intentionally avoided: the fall-through is the designed safe default, and
 * absence keeps this leaf module free of literals that could drift from the
 * backend constants.
 */
const NOTIFICATION_ROUTE_BY_ENTITY_TYPE: Readonly<Record<string, string | undefined>> = {
  [BackendNotificationType.ParentLinkRequest]: STUDENT_LINK_REQUESTS_ROUTE,
};

/**
 * The row id's string form. Wire rows carry the numeric id; the drawer/item
 * typing may deliver it stringified. `null` (the wire's null id) and
 * `undefined` (the parameter omitted) have NO string form, and an empty
 * string is no usable id — all three yield `null` so the caller's builder
 * application can never fabricate a route.
 */
function relatedEntityIdStringOf(relatedEntityId: string | number | null | undefined): string | null {
  if (typeof relatedEntityId === "number") {
    return String(relatedEntityId);
  }
  return typeof relatedEntityId === "string" && relatedEntityId.length > 0 ? relatedEntityId : null;
}

/**
 * Resolve a drawer/feed row's navigation target from its related-entity
 * pointer, its notification type, the viewer's role, and the row's
 * related-entity id.
 *
 * Resolution order (first hit wins):
 *  1. the parent-link entity map (`parent_link_request` → the student
 *     decision route — role-independent, only students receive those rows);
 *  2. the session matrix (session entity + known type + known role → the
 *     role's route; a builder cell composes the route from the row's
 *     related-entity id and is applied ONLY for a non-empty string id —
 *     absent/empty ids fall through to the feed page, the matrix NEVER
 *     fabricates a route);
 *  3. the role-less type stage (`NOTIFICATION_ROUTE_BY_TYPE` — the
 *     session-completion row deep-links to the student sessions list even
 *     when no wire role resolves; a bare `"session"` table pointer with a
 *     type the matrix and this stage do not route NEVER reaches the
 *     sessions list);
 *  4. the feed-page fall-through — UNKNOWN or absent pointers, unknown
 *     types, unknown roles, and matrix misses ALL land here. Never throws,
 *     never mis-routes.
 *
 * The optional `notificationType` / `role` / `relatedEntityId` keep the
 * original single-argument call sites compiling: without them only rule 1
 * and the role-less session-completion rule can ever hit, which covers the
 * pre-deep-link behavior.
 */
export function resolveNotificationRoute(
  relatedEntityType: string | null,
  notificationType?: string | null,
  role?: string | null,
  relatedEntityId?: string | number | null
): string {
  if (relatedEntityType === null) {
    return NOTIFICATIONS_FEED_ROUTE;
  }
  const parentLinkRoute = NOTIFICATION_ROUTE_BY_ENTITY_TYPE[relatedEntityType];
  if (parentLinkRoute !== undefined) {
    return parentLinkRoute;
  }
  if (
    relatedEntityType === SESSION_ENTITY_TYPE &&
    notificationType != null &&
    isWireNotificationType(notificationType) &&
    isWireRole(role)
  ) {
    const sessionRouteCell = SESSION_ROUTES_BY_TYPE_AND_ROLE[notificationType]?.[role];
    if (sessionRouteCell === undefined) {
      return NOTIFICATIONS_FEED_ROUTE;
    }
    if (typeof sessionRouteCell === "function") {
      const relatedEntityIdString = relatedEntityIdStringOf(relatedEntityId);
      return relatedEntityIdString === null ? NOTIFICATIONS_FEED_ROUTE : sessionRouteCell(relatedEntityIdString);
    }
    return sessionRouteCell;
  }
  if (!isWireRole(role) && notificationType != null && isWireNotificationType(notificationType)) {
    return NOTIFICATION_ROUTE_BY_TYPE[notificationType] ?? NOTIFICATIONS_FEED_ROUTE;
  }
  return NOTIFICATIONS_FEED_ROUTE;
}
