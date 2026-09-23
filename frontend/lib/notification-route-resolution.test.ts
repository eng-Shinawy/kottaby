/**
 * Contract and routing tests for `notification-route-resolution.ts`.
 *
 * Verifies the staged deep-link resolution contract — the row's
 * `related_entity_type` pointer routes first (the parent-link entity map),
 * then the session matrix (entity "session" + the wire `type` + the wire
 * `role`), then the role-less notification-type stage — enforcing the safe
 * feed fallback strategy for null, unmapped, refinement, or unknown inputs.
 *
 * The parent session-completion cell is covered as its builder contract:
 * the portal-root entry URL is composed ONLY from a non-empty id (wire rows
 * carry the numeric id; its string form composes the URL), absent/empty ids
 * fall through to the feed, the static Student/Teacher cells ignore the id,
 * and fabricated types/roles never fabricate an entry URL.
 */

import { describe, expect, test } from "bun:test";
import { NotificationType as BackendNotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NotificationType, UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  PARENT_PORTAL_ROOT_ROUTE,
  resolveNotificationRoute,
  STUDENT_LINK_REQUESTS_ROUTE,
} from "@/frontend/lib/notification-route-resolution";

describe("STUDENT_LINK_REQUESTS_ROUTE constant", () => {
  test("exports canonical route string for student link requests", () => {
    expect(STUDENT_LINK_REQUESTS_ROUTE).toBe("/student/link-requests");
  });
});

describe("resolveNotificationRoute — staged resolution", () => {
  test("null related entity pointer falls back to notifications feed route", () => {
    expect(resolveNotificationRoute(null, NotificationType.SessionRequest)).toBe("/notifications");
  });

  test("parent-link entity map routes the parent_link_request pointer ahead of every type stage", () => {
    expect(resolveNotificationRoute(BackendNotificationType.ParentLinkRequest, null)).toBe("/student/link-requests");
    expect(resolveNotificationRoute(BackendNotificationType.ParentLinkRequest, NotificationType.SystemBroadcast)).toBe(
      "/student/link-requests"
    );
  });

  test("session matrix routes by notification type and viewer role", () => {
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Student)).toBe(
      "/student/sessions"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Teacher)).toBe(
      "/teacher/sessions"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Admin)).toBe(
      "/notifications"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionDisputeOpened, UserRole.Student)).toBe(
      "/notifications"
    );
  });

  test("role-less type stage routes session completion to the student sessions list", () => {
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion)).toBe("/student/sessions");
  });

  test("unmapped NotificationType enum values fall through to notifications feed route", () => {
    const unmappedTypes = [
      NotificationType.SessionRequest,
      NotificationType.SessionCancellation,
      NotificationType.SystemBroadcast,
      NotificationType.PaymentConfirmation,
      NotificationType.EvaluationResult,
    ];

    for (const notificationType of unmappedTypes) {
      expect(resolveNotificationRoute("session", notificationType)).toBe("/notifications");
    }
  });

  test("parent-targeted refinement entity pointers intentionally fall through to feed route", () => {
    // Parent-targeted rows carry audience-scoped refinement values (issue #99)
    // that deliberately miss the entity map to fall through safely to /notifications.
    const parentRefinementTypes = ["parent_link_request_decision", "parent_link_request_expiry"];

    for (const refinementType of parentRefinementTypes) {
      expect(resolveNotificationRoute(refinementType, NotificationType.ParentLinkRequest)).toBe("/notifications");
    }
  });

  test("unknown, empty, or hostile string entity pointers safely fall through to feed route", () => {
    const edgeCaseInputs = [
      "",
      "   ",
      "unknown_entity_type",
      "PARENT_LINK_REQUEST",
      "null",
      "undefined",
      "/student/link-requests",
      "../admin",
      "<script>alert(1)</script>",
    ];

    for (const input of edgeCaseInputs) {
      expect(resolveNotificationRoute(input, NotificationType.SystemBroadcast)).toBe("/notifications");
    }
  });
});

describe("PARENT_PORTAL_ROOT_ROUTE constant", () => {
  test("exports the canonical parent portal root route string", () => {
    expect(PARENT_PORTAL_ROOT_ROUTE).toBe("/parent/children");
  });
});

describe("resolveNotificationRoute — parent session-completion deep link", () => {
  test("parent session-completion rows with a non-empty id build the portal-root entry URL", () => {
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "2077")).toBe(
      "/parent/children?session=2077"
    );
    // Wire rows carry the numeric id — its string form composes the URL.
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, 2077)).toBe(
      "/parent/children?session=2077"
    );
  });

  test("absent, null, or empty-string ids fall through to the feed route — never a fabricated URL", () => {
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent)).toBe(
      "/notifications"
    );
    // The omitted 4th argument IS the undefined arm; the loop also pins the
    // explicit nullish forms — none carries a usable id, so the builder
    // must never fire for any of them.
    for (const absentId of [null, undefined] as const) {
      expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, absentId)).toBe(
        "/notifications"
      );
    }
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "")).toBe(
      "/notifications"
    );
  });

  test("id boundaries — zero and stringified ids still compose the entry URL", () => {
    // A non-empty id composes the URL even when unresolvable downstream:
    // the portal root's resolution flow owns the failure path — the resolver
    // only refuses to fabricate when NO id exists at all.
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "0")).toBe(
      "/parent/children?session=0"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "42")).toBe(
      "/parent/children?session=42"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, 42)).toBe(
      "/parent/children?session=42"
    );
  });

  test("other session types route the parent audience to the feed — no parent cells exist for them", () => {
    expect(resolveNotificationRoute("session", NotificationType.SessionCancellation, UserRole.Parent, "2077")).toBe(
      "/notifications"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionRequest, UserRole.Parent, "2077")).toBe(
      "/notifications"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionDisputeOpened, UserRole.Parent, "2077")).toBe(
      "/notifications"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionDisputeResolved, UserRole.Parent, "2077")).toBe(
      "/notifications"
    );
  });

  test("student and teacher cells stay static strings — a present id never alters their routes", () => {
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Student, "2077")).toBe(
      "/student/sessions"
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Teacher, "2077")).toBe(
      "/teacher/sessions"
    );
  });

  test("repeated and interleaved resolutions are stateless — a pure function of its arguments", () => {
    const feedFirst = resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "");
    const entryFirst = resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "31");
    expect(feedFirst).toBe("/notifications");
    expect(entryFirst).toBe("/parent/children?session=31");
    // Interleave repeats and other audiences — no call perturbs another's result.
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "")).toBe(
      feedFirst
    );
    resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Student, "31");
    resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Teacher, "31");
    resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent);
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "31")).toBe(
      entryFirst
    );
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, UserRole.Parent, "")).toBe(
      feedFirst
    );
  });

  test("fabricated types and roles never fabricate a parent entry URL", () => {
    // Fabricated wire TYPE with a real parent role: the matrix is unreachable — feed.
    expect(resolveNotificationRoute("session", "FabricatedWireType", UserRole.Parent, "2077")).toBe("/notifications");
    // Fabricated entity pointer with parent role + id: no stage routes it — feed.
    expect(resolveNotificationRoute("sessions", NotificationType.SessionCompletion, UserRole.Parent, "2077")).toBe(
      "/notifications"
    );
    // Fabricated ROLE: the matrix is unreachable; the row lands on the
    // role-less type stage's established static route — never the builder.
    expect(resolveNotificationRoute("session", NotificationType.SessionCompletion, "Grandparent", "2077")).toBe(
      "/student/sessions"
    );
    expect(resolveNotificationRoute("session", "FabricatedWireType", "Grandparent", "2077")).toBe("/notifications");
  });
});
