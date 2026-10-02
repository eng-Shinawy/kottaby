/**
 * Cross-actor journey — student confirmation of the parent link.
 *
 * Executes the confirmation/rejection workflow against REAL services on
 * the REAL test database (sequential, actor-attributed steps; later steps
 * observe the shared state earlier steps committed). The request journey owns
 * the request-creation loop; THIS journey owns the decision legs and pins:
 *
 *  - Step 1  — Parent A creates the request: pending row, ONE deep-linked
 *              notification row, EXACTLY ONE publish to the student.
 *  - Step 2  — Student lists incoming: parent FULL name + expiry.
 *  - Step 3  — DENIAL: teacher/admin/parent cannot decide or list; a foreign
 *              student gets the constant NOT_FOUND — zero rows, zero
 *              notification rows.
 *  - Step 4  — DENIAL: foreign ≡ nonexistent requestId — byte-identical
 *              constant NOT_FOUND, zero writes (BOLA, no oracle).
 *  - Step 5  — DENIAL: the governed (suspended) student's respond is the
 *              constant ForbiddenError copy via the real `requireActor`
 *              re-check, zero side effects.
 *  - Step 6  — REJECT leg: rejected + respondedAt, `students.parent_id`
 *              unchanged (NULL), sibling pendings untouched, exactly ONE
 *              rejection notification in the parent's PERSISTED locale,
 *              fanout spied post-commit.
 *  - Step 7  — CONFIRM leg: confirmed row, `students.parent_id = parentId`,
 *              ALL sibling pendings expired, exactly ONE acceptance
 *              notification, INV-P1 probes.
 *  - Step 8  — Parent-side visibility pin: terminal statuses surface while
 *              the student name stays masked FOREVER (maskFullName).
 *  - Step 9  — RACE: winner/loser confirmation. 9a is the deterministic
 *              loser-collapse emulation (runs everywhere, the
 *              journey-C guard pattern); 9b is the TRUE concurrent
 *              `Promise.allSettled` race, wholesale-skip-gated via
 *              `isPgliteProvider` exactly like the chaos tier — PGlite is
 *              single-connection and cannot host cross-connection
 *              interleavings.
 *  - Step 10 — BOUNDARY: respond at the expiry instant denies EXPIRED
 *              deterministically; the read renders Expired WITHOUT writing
 *              (service-side render parity through `toCanonicalLinkStatus`;
 *              the frontend `displayLinkRequestStatus` helper is
 *              frontend-layer-owned and is NEVER imported here).
 *  - Step 11 — NOTIFICATION deep-link data contract: every persisted
 *              parent-link row carries the (type, relatedEntityType,
 *              relatedEntityId) triple the drawer route resolution consumes.
 *
 * Cast (the confirmation workflow's actor table): Parent A + Parent B, unlinked decider
 * Student S, unlinked Student F (foreign/race target), Already-Linked
 * Student L (pre-linked to Parent A — the foreign-student probe), Governed
 * Student G (active suspension), plus a certified Teacher and an Admin for
 * the cross-role denial leg. Every fixture identity field carries the
 * per-run `jrn_sconfirm_<uuid8>` prefix so repeated or parallel runs never
 * collide and teardown residue is greppable.
 *
 * Harness: the shared helpers at `test/workflows/helpers/` are REUSED
 * verbatim (provisioning, TrackedFixtures, SpiedFanoutTransport,
 * setGovernanceFixture, linkStudentToParentFixture, catchJourneyError) — no
 * helper file is created or modified here. Permission/role resolution is
 * NEVER monkey-patched: every denial fails through the real `requireActor`
 * re-check against the real committed rows.
 *
 * Notification boundary (AGENTS.md rule 5): the fan-out transport is SPIED
 * at the `options.transport` injection seam (`SpiedFanoutTransport`) —
 * nothing reaches a real channel. Every notify-boundary publishes EXACTLY
 * once; every denial and the expiry path publish ZERO.
 *
 * Committed fixtures in `beforeAll` (ONE committing transaction, plus the
 * governance/link fixture writers that own their transactions); tracked
 * hard-delete in `afterAll` in FK-safe order (notifications →
 * parent_link_requests → students → parents → users) with mandatory
 * zero-residue re-probes. NEVER `runInRollback` — the services spawn their
 * own transactions.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { ParentLinkRequestRepository } from "@/backend/db/repo";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@/backend/lib/errors";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications/notification-engine.service";
import { ParentLinkRequestService } from "@/backend/services/parents/parent-link-request.service";
import type {
  DBTransaction,
  IncomingParentLinkRequestReturnType,
  OutgoingParentLinkRequestReturnType,
  UserSelectType,
} from "@/backend/types";
import { HANDSHAKE_CODE_PATTERN } from "@/shared/constants/handshake-code.constants";
import { PARENT_LINK_REQUEST_MS, PARENT_LINK_REQUEST_TTL_DAYS } from "@/shared/constants/parent-link-request.constants";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";
import {
  catchJourneyError,
  type JourneyActor,
  linkStudentToParentFixture,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  setGovernanceFixture,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";

/** Translated error copy source — never hardcoded English expectation strings (AGENTS.md rule 6). */
const errorsTranslations = getServerTranslations(LOCALE).errorsTranslations;

/** Translated notification copy source — the recipient-locale composition oracle. */
const enNotifications = getServerTranslations(LOCALE).notificationsTranslations;

/** Per-run identity prefix — `jrn_sconfirm_<uuid8>` on every fixture identity field (rule 3). */
const RUN_PREFIX = `jrn_sconfirm_${randomUUID().slice(0, 8)}`;

type NotificationRow = typeof notifications.$inferSelect;
type ParentLinkRequestRow = typeof parentLinkRequests.$inferSelect;

/**
 * The parent-link notification type typed AS the DB column's primitive union —
 * `notificationType` infers a string union (not the enum), so comparisons and
 * typed `toBe` matchers go through this constant, which is assignable in both
 * directions without any unsafe enum comparison (linting-rules.md).
 */
const PARENT_LINK_NOTIFICATION_TYPE: NotificationRow["type"] = NotificationType.ParentLinkRequest;

/**
 * The free-varchar `related_entity_type` value the notification rows carry —
 * the drawer's deep-link key (no enum exists for it; the value is the
 * emitted rows' own constant).
 */
const PARENT_LINK_RELATED_ENTITY_TYPE = "parent_link_request";
// Parent-audience refinement (issue #99) — the decision rows carry this
// instead, so the drawer routes them to the feed, not the student-only
// decision route.
const PARENT_LINK_DECISION_RELATED_ENTITY_TYPE = "parent_link_request_decision";

/** Closed outgoing wire shape (the parent never sees raw student identity). */
const OUTGOING_KEYS = ["createdAt", "expiresAt", "id", "respondedAt", "status", "studentMaskedName"];

/** Closed incoming wire shape (the student sees the parent's FULL name, nothing else). */
const INCOMING_KEYS = ["createdAt", "expiresAt", "id", "parentFullName", "respondedAt", "status"];

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Byte fingerprint of a denial — the constant-shape oracle (code + message only). */
function errorFingerprint(error: DomainError): string {
  return JSON.stringify({ code: error.code, message: error.message });
}

interface JourneyCastState {
  readonly parentA: JourneyActor;
  readonly parentB: JourneyActor;
  readonly studentS: JourneyActor;
  readonly studentF: JourneyActor;
  readonly studentL: JourneyActor;
  readonly studentG: JourneyActor;
  readonly teacher: JourneyActor;
  readonly admin: JourneyActor;
  /** Canonical `KSB-` handshake codes, read back from the role-child rows. */
  readonly sCode: string;
  readonly fCode: string;
}

let state: JourneyCastState | null = null;

/**
 * Keyed registry of the request rows the journey's service calls create.
 * Each key is written exactly once by the step that created the row (the row
 * itself is registered in `tracked` at the same moment); the map is the
 * cross-step handle that keeps every later step selecting BY ID, never by
 * list position (the repo pins `created_at DESC` ordering).
 */
const REQUEST = {
  rejectTarget: "reject-target (Parent A → S, step 1)",
  foreignTarget: "foreign-target (Parent B → F, step 4; the step-9 race winner)",
  confirmSibling: "confirm-sibling (Parent B → S, step 6; the step-7 confirm target)",
  reapplySibling: "reapply-sibling (Parent A → S, step 7; expired by the confirm sweep)",
  raceLoser: "race-loser (Parent A → F, step 9a)",
  boundary: "boundary-fixture (Parent A → S, step 10; direct committed write)",
} as const;

type RequestKey = (typeof REQUEST)[keyof typeof REQUEST];

/** Suite-scoped fixture registries — the journey's only module-scope mutables. */
const createdRequestIds = new Map<RequestKey, number>();
const raceUserIds: number[] = [];

/** Fan-out transport spy — installed at the `options.transport` seam of every notify-boundary call. */
const transportSpy = new SpiedFanoutTransport();

/** Registry of committed fixture rows; registration order IS the FK-safe deletion order. */
const tracked = new TrackedFixtures();

function requireState(): JourneyCastState {
  if (state === null) {
    throw new Error("journey state missing: cast was not provisioned");
  }
  return state;
}

function requireRequestId(key: RequestKey): number {
  const id = createdRequestIds.get(key);
  if (id === undefined) {
    throw new Error(`journey state missing: request id "${key}" was not created by an earlier step`);
  }
  return id;
}

/** Every base-cast member's user id — the scope for side-effect and residue probes. */
function castUserIds(s: JourneyCastState): number[] {
  return [
    s.parentA.userId,
    s.parentB.userId,
    s.studentS.userId,
    s.studentF.userId,
    s.studentL.userId,
    s.studentG.userId,
    s.teacher.userId,
    s.admin.userId,
  ];
}

/** Every user id the journey is accountable for (base cast + race cast). */
function allJourneyUserIds(s: JourneyCastState): number[] {
  return [...castUserIds(s), ...raceUserIds];
}

/** The engine call options every journey call passes — transport spied, nothing else injected. */
function callOptions(): NotificationEngineCallOptions {
  return { transport: transportSpy };
}

/** Publish oracle: EXACTLY ONE post-commit publish, addressed to `targetUserId` alone. */
function expectSinglePublish(
  targetUserId: number,
  relatedEntityId: number,
  relatedEntityType: string = PARENT_LINK_RELATED_ENTITY_TYPE
): void {
  expect(transportSpy.publishCount).toBe(1);
  const call = transportSpy.lastCall;
  if (call === null) {
    throw new Error("expected one recorded publish");
  }
  expect(call.userIds).toEqual([targetUserId]);
  expect(call.payload.data.type).toBe(NotificationType.ParentLinkRequest);
  expect(call.payload.data.relatedEntityType).toBe(relatedEntityType);
  expect(call.payload.data.relatedEntityId).toBe(relatedEntityId);
}

/** Silent-path publish oracle: the transport stayed untouched since the last re-arm. */
function expectZeroPublishes(): void {
  expect(transportSpy.publishCount).toBe(0);
  expect(transportSpy.publishedUserIds).toHaveLength(0);
}

/** Oracle: NONE of the listed users carries any parent-link inbox row (fresh parallel reads). */
async function expectEmptyLinkInboxes(userIds: number[]): Promise<void> {
  const inboxes = await Promise.all(userIds.map(linkInboxRowsFor));
  for (const rows of inboxes) {
    expect(rows).toHaveLength(0);
  }
}

/** All persisted inbox rows addressed to one user (fresh read). */
async function inboxRowsFor(userId: number): Promise<NotificationRow[]> {
  return db.select().from(notifications).where(eq(notifications.userId, userId));
}

/** Persisted inbox rows of one user filtered to the parent-link type. */
async function linkInboxRowsFor(userId: number): Promise<NotificationRow[]> {
  const rows = await inboxRowsFor(userId);
  // String-typed constant comparison per linting-rules.md (DB column is a string union, not the enum).
  return rows.filter(row => row.type === PARENT_LINK_NOTIFICATION_TYPE);
}

/** Live pending `parent_link_requests` rows for one student (fresh read). */
async function pendingCountForStudent(studentId: number): Promise<number> {
  return db.$count(
    parentLinkRequests,
    and(eq(parentLinkRequests.studentId, studentId), eq(parentLinkRequests.status, LinkStatus.Pending))
  );
}

/** Fresh read of one request row by id (null when absent). */
async function requestRowById(id: number): Promise<ParentLinkRequestRow | null> {
  const rows = await db.select().from(parentLinkRequests).where(eq(parentLinkRequests.id, id));
  return rows.at(0) ?? null;
}

/** Fresh read of `students.parent_id` for one student. */
async function studentParentId(studentId: number): Promise<number | null> {
  const rows = await db.select({ parentId: students.parentId }).from(students).where(eq(students.id, studentId));
  return rows.at(0)?.parentId ?? null;
}

/** Fresh read of one users row by id (null when absent). */
async function userRowById(id: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows.at(0) ?? null;
}

/** Closed-shape assertion for an outgoing payload row. */
function expectOutgoingShape(row: OutgoingParentLinkRequestReturnType): void {
  expect(Object.keys(row).toSorted(compareStrings)).toEqual(OUTGOING_KEYS);
}

/** Closed-shape assertion for an incoming payload row. */
function expectIncomingShape(row: IncomingParentLinkRequestReturnType): void {
  expect(Object.keys(row).toSorted(compareStrings)).toEqual(INCOMING_KEYS);
}

/**
 * Denial oracle for the typed-conflict arms: catches through the journey
 * helper (never `rejects.toThrow`), pins the DomainError class, the exact
 * error code, and the translated message substring.
 */
async function expectConflictError(
  fn: () => Promise<unknown>,
  code: string,
  translatedCopy: string
): Promise<ConflictError> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(ConflictError);
  if (!(error instanceof ConflictError)) {
    throw new Error(`expected a ConflictError with code ${code}`);
  }
  expect(error.code).toBe(code);
  expect(error.message).toContain(translatedCopy);
  return error;
}

/**
 * Denial oracle for the role/governance re-check arms (REAL resolution — no
 * monkey-patching): the constant ForbiddenError copy for BOTH the role arm
 * and the governed arm (no branch disclosure).
 */
async function expectForbiddenRecheck(fn: () => Promise<unknown>): Promise<void> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(ForbiddenError);
  if (!(error instanceof DomainError)) {
    throw new Error("expected a FORBIDDEN DomainError from the actor re-check");
  }
  expect(error.code).toBe("FORBIDDEN");
  expect(error.message).toContain(errorsTranslations.forbidden);
}

/** Captures the constant-shape NOT_FOUND fingerprint of a denial and pins its copy. */
async function expectNotFoundShape(fn: () => Promise<unknown>): Promise<string> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(NotFoundError);
  if (!(error instanceof NotFoundError)) {
    throw new Error("expected a NotFoundError from the constant-shape denial");
  }
  expect(error.code).toBe("PARENT_LINK_REQUEST_NOT_FOUND");
  expect(error.message).toContain(errorsTranslations.parentLinkRequestNotFound);
  return errorFingerprint(error);
}

/**
 * Splits allSettled outcomes into (fulfilled values, rejection reasons) —
 * the race-shape oracle (the chaos tier's idiom).
 */
function settleRace<T>(outcomes: ReadonlyArray<PromiseSettledResult<T>>): {
  readonly values: T[];
  readonly reasons: unknown[];
} {
  const values: T[] = [];
  const reasons: unknown[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      values.push(outcome.value);
    } else {
      reasons.push(outcome.reason);
    }
  }
  return { values, reasons };
}

/**
 * Walks the Drizzle error cause chain hunting a PostgreSQL driver error code
 * (the `40P01` deadlock detector) — under contention Postgres may abort one
 * waiter; Drizzle masks driver errors behind its generic message, so the
 * code lives on the cause-chain pg error.
 */
function hasPgCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

describe("Journey — student confirmation of the parent link (steps 1–11)", () => {
  beforeAll(async () => {
    // System actor provisions the full cast in ONE committing transaction
    // (commit-or-nothing: a throwing setup leaves nothing behind).
    const provisioned = await db.transaction(async (tx: DBTransaction): Promise<JourneyCastState> => {
      const parentA = await provisionParentActor(tx, { tracked, locale: LOCALE });
      const parentB = await provisionParentActor(tx, { tracked, locale: LOCALE });
      const studentS = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const studentF = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const studentL = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const studentG = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const teacher = await provisionCertifiedTeacherActor(tx, { tracked, locale: LOCALE });
      const admin = await provisionAdminActor(tx, { tracked, locale: LOCALE });

      // Prefix discipline (rule 3) + persisted-locale pin: identity fields
      // carry the per-run prefix; every cast member's PERSISTED locale is
      // `en`, so the recipient-locale copy assertions below are the honest
      // persisted-preference path (never the defaultLocale fallback).
      const actors = [
        { actor: parentA, label: "Parent A", slug: "parent-a" },
        { actor: parentB, label: "Parent B", slug: "parent-b" },
        { actor: studentS, label: "Student S", slug: "student-s" },
        { actor: studentF, label: "Student F", slug: "student-f" },
        { actor: studentL, label: "Student L", slug: "student-l" },
        { actor: studentG, label: "Student G", slug: "student-g" },
        { actor: teacher, label: "Teacher T", slug: "teacher-t" },
        { actor: admin, label: "Admin", slug: "admin" },
      ];
      await Promise.all(
        actors.map(({ actor, label, slug }) =>
          tx
            .update(users)
            .set({
              fullName: `${RUN_PREFIX} ${label}`,
              email: `${RUN_PREFIX}.${slug}@journey.test`,
              locale: LOCALE,
            })
            .where(eq(users.id, actor.userId))
        )
      );

      const ids = [studentS.userId, studentF.userId];
      const studentRows = await tx.select().from(students).where(inArray(students.id, ids));
      const codeById = new Map(studentRows.map(row => [row.id, row.handshakeCode]));
      const sCode = codeById.get(studentS.userId);
      const fCode = codeById.get(studentF.userId);
      if (sCode === undefined || fCode === undefined) {
        throw new Error("journey cast: a provisioned student has no readable handshake code");
      }

      return { parentA, parentB, studentS, studentF, studentL, studentG, teacher, admin, sCode, fCode };
    });
    state = provisioned;

    // Committed fixture controls that own their transactions (the helper
    // contract — the governance write and the pre-link do not run inside the
    // cast's transaction). Honest pre-states, never monkey-patched
    // resolution: G is genuinely suspended; L is genuinely linked to A.
    const governance = await setGovernanceFixture(provisioned.studentG.userId, {
      suspended: true,
      suspendedAt: new Date(Date.now() - 60 * 60 * 1000),
      suspendedPeriodDays: 30,
    });
    expect(governance.suspended).toBe(true);

    const linkedParentId = await linkStudentToParentFixture(provisioned.studentL.userId, provisioned.parentA.userId);
    expect(linkedParentId).toBe(provisioned.parentA.userId);

    // Cast grounding: canonical, unique handshake codes.
    const codes = [provisioned.sCode, provisioned.fCode];
    for (const code of codes) {
      expect(code).toMatch(HANDSHAKE_CODE_PATTERN);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("Step 1 — Parent A requests Student S: ONE pending row (+7d), ONE deep-linked notification row, EXACTLY ONE publish", async () => {
    const s = requireState();
    const created = await ParentLinkRequestService.requestLink(
      s.sCode,
      s.parentA.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    if (created === null) {
      throw new Error("expected a creation payload for the live unlinked target");
    }
    tracked.register(parentLinkRequests, created.id);
    createdRequestIds.set(REQUEST.rejectTarget, created.id);

    // Pending, untouched respondedAt, the +7-day window.
    expect(created.status).toBe(LinkStatus.Pending);
    expect(created.respondedAt).toBeNull();
    const windowMs = created.expiresAt.getTime() - created.createdAt.getTime();
    expect(Math.abs(windowMs - PARENT_LINK_REQUEST_MS)).toBeLessThan(1000);
    expect(PARENT_LINK_REQUEST_TTL_DAYS).toBe(7);

    // Exactly ONE persisted request row for the (A, S) pair, pending.
    expect(await db.$count(parentLinkRequests, eq(parentLinkRequests.id, created.id))).toBe(1);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);

    // Request-creation notification contract: exactly ONE inbox row for the
    // student, bound to the request through the deep-link triple, unread.
    const sInbox = await linkInboxRowsFor(s.studentS.userId);
    expect(sInbox).toHaveLength(1);
    const requestNotification = sInbox.at(0);
    if (requestNotification === undefined) {
      throw new Error("expected the request notification row");
    }
    expect(requestNotification.type).toBe(PARENT_LINK_NOTIFICATION_TYPE);
    expect(requestNotification.relatedEntityType).toBe(PARENT_LINK_RELATED_ENTITY_TYPE);
    expect(requestNotification.relatedEntityId).toBe(created.id);
    expect(requestNotification.isRead).toBe(false);
    // Recipient-locale composition: the student's PERSISTED locale (en).
    const parentARow = await userRowById(s.parentA.userId);
    if (parentARow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(requestNotification.title).toBe(enNotifications.eventParentLinkRequestTitle);
    expect(requestNotification.body).toBe(enNotifications.eventParentLinkRequestBody(parentARow.fullName));

    // NO other cast member observes any state change.
    await expectEmptyLinkInboxes([
      s.parentA.userId,
      s.parentB.userId,
      s.studentF.userId,
      s.studentL.userId,
      s.studentG.userId,
      s.teacher.userId,
      s.admin.userId,
    ]);

    // EXACTLY ONE post-commit publish, addressed to the student alone.
    expectSinglePublish(s.studentS.userId, created.id);
    transportSpy.clear();
  });

  test("Step 2 — Student S lists incoming: Parent A's FULL name, live expiry, pending (service truth)", async () => {
    const s = requireState();
    const incoming = await ParentLinkRequestService.listMyIncoming(s.studentS.userId, LOCALE);
    expect(incoming).toHaveLength(1);
    const row = incoming.at(0);
    if (row === undefined) {
      throw new Error("expected the incoming row");
    }
    expectIncomingShape(row);
    expect(row.id).toBe(requireRequestId(REQUEST.rejectTarget));
    expect(row.status).toBe(LinkStatus.Pending);

    // The deciding student sees the requesting parent's FULL name.
    const parentARow = await userRowById(s.parentA.userId);
    if (parentARow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(row.parentFullName).toBe(parentARow.fullName);

    // Expiry present and live (the card's actionable-input contract).
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Reads never publish.
    expectZeroPublishes();
  });

  test("Step 3 — DENIAL: teacher/admin/parent cannot decide or list; the foreign student gets the constant NOT_FOUND — zero rows, zero notifications", async () => {
    const s = requireState();
    const requestId = requireRequestId(REQUEST.rejectTarget);
    const rowBefore = await requestRowById(requestId);
    if (rowBefore === null) {
      throw new Error("expected the pending request row");
    }

    // Non-student actors on the decision mutation — the REAL role re-check.
    await expectForbiddenRecheck(() =>
      ParentLinkRequestService.respondToLinkRequest(requestId, true, s.teacher.userId, LOCALE, undefined, callOptions())
    );
    await expectForbiddenRecheck(() =>
      ParentLinkRequestService.respondToLinkRequest(requestId, true, s.admin.userId, LOCALE, undefined, callOptions())
    );
    await expectForbiddenRecheck(() =>
      ParentLinkRequestService.respondToLinkRequest(requestId, true, s.parentB.userId, LOCALE, undefined, callOptions())
    );

    // Non-student actors on the incoming read — the same role gate.
    await expectForbiddenRecheck(() => ParentLinkRequestService.listMyIncoming(s.teacher.userId, LOCALE));
    await expectForbiddenRecheck(() => ParentLinkRequestService.listMyIncoming(s.admin.userId, LOCALE));
    await expectForbiddenRecheck(() => ParentLinkRequestService.listMyIncoming(s.parentB.userId, LOCALE));

    // The foreign student (L — a REAL student who is not the addressee):
    // the BOLA constant NOT_FOUND shape, never a role disclosure.
    await expectNotFoundShape(() =>
      ParentLinkRequestService.respondToLinkRequest(
        requestId,
        true,
        s.studentL.userId,
        LOCALE,
        undefined,
        callOptions()
      )
    );

    // Zero rows changed: the request row is byte-stable and still pending.
    const rowAfter = await requestRowById(requestId);
    expect(rowAfter?.status).toBe(rowBefore.status);
    expect(rowAfter?.respondedAt).toBeNull();
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);

    // Zero notification rows: nobody's inbox grew (S still holds exactly the
    // step-1 row; every other cast member holds none).
    expect(await linkInboxRowsFor(s.studentS.userId)).toHaveLength(1);
    await expectEmptyLinkInboxes([
      s.parentA.userId,
      s.parentB.userId,
      s.studentF.userId,
      s.studentL.userId,
      s.studentG.userId,
      s.teacher.userId,
      s.admin.userId,
    ]);
    expectZeroPublishes();
  });

  test("Step 4 — DENIAL (BOLA): foreign ≡ nonexistent requestId — byte-identical constant NOT_FOUND, zero writes", async () => {
    const s = requireState();
    // A REAL request owned by ANOTHER student: Parent B → Student F.
    const foreign = await ParentLinkRequestService.requestLink(
      s.fCode,
      s.parentB.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    if (foreign === null) {
      throw new Error("expected a creation payload for the foreign target");
    }
    tracked.register(parentLinkRequests, foreign.id);
    createdRequestIds.set(REQUEST.foreignTarget, foreign.id);
    expectSinglePublish(s.studentF.userId, foreign.id); // the creation's own boundary
    transportSpy.clear();

    const NONEXISTENT_ID = 999999999;
    const foreignFingerprint = await expectNotFoundShape(() =>
      ParentLinkRequestService.respondToLinkRequest(
        foreign.id,
        true,
        s.studentS.userId,
        LOCALE,
        undefined,
        callOptions()
      )
    );
    const missingFingerprint = await expectNotFoundShape(() =>
      ParentLinkRequestService.respondToLinkRequest(
        NONEXISTENT_ID,
        true,
        s.studentS.userId,
        LOCALE,
        undefined,
        callOptions()
      )
    );

    // Byte-equality across foreign vs absent — no existence oracle.
    expect(foreignFingerprint).toBe(missingFingerprint);

    // Zero writes: the foreign row is untouched and still pending; S's row too.
    const foreignRow = await requestRowById(foreign.id);
    expect(foreignRow?.status).toBe(LinkStatus.Pending);
    expect(foreignRow?.respondedAt).toBeNull();
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(1);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);

    // Zero notification growth on the denial arms.
    expect(await linkInboxRowsFor(s.studentS.userId)).toHaveLength(1);
    expect(await linkInboxRowsFor(s.studentF.userId)).toHaveLength(1);
    expectZeroPublishes();
  });

  test("Step 5 — DENIAL: the governed (suspended) student's respond is the constant ForbiddenError copy with zero side effects", async () => {
    const s = requireState();
    const requestId = requireRequestId(REQUEST.rejectTarget);

    // Harness grounding: G is genuinely suspended (an honest fixture, not a
    // monkey-patched governance state).
    const governedRow = await userRowById(s.studentG.userId);
    if (governedRow === null) {
      throw new Error("fixture governed student vanished mid-journey");
    }
    expect(governedRow.suspended).toBe(true);

    // The governed arm resolves through the SAME real re-check and carries
    // the SAME constant copy as the role arm (no branch disclosure).
    await expectForbiddenRecheck(() =>
      ParentLinkRequestService.respondToLinkRequest(
        requestId,
        true,
        s.studentG.userId,
        LOCALE,
        undefined,
        callOptions()
      )
    );

    // Zero side effects: the request row untouched, no link, no inbox row.
    const row = await requestRowById(requestId);
    expect(row?.status).toBe(LinkStatus.Pending);
    expect(await studentParentId(s.studentG.userId)).toBeNull();
    expect(await studentParentId(s.studentS.userId)).toBeNull();
    expect(await linkInboxRowsFor(s.studentG.userId)).toHaveLength(0);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);
    expectZeroPublishes();
  });

  test("Step 6 — REJECT leg: rejected + respondedAt, parent_id unchanged (NULL), sibling pending untouched, ONE rejection notification in the parent's persisted locale", async () => {
    const s = requireState();
    const requestId = requireRequestId(REQUEST.rejectTarget);

    // The confirm-leg sibling FIRST: Parent B's live pending for S, so
    // "a no to Parent A is not a no to Parent B" has real content.
    const sibling = await ParentLinkRequestService.requestLink(
      s.sCode,
      s.parentB.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    if (sibling === null) {
      throw new Error("expected Parent B's sibling request to be created");
    }
    tracked.register(parentLinkRequests, sibling.id);
    createdRequestIds.set(REQUEST.confirmSibling, sibling.id);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(2);
    expectSinglePublish(s.studentS.userId, sibling.id); // the creation's own boundary
    transportSpy.clear();

    const parentAInboxBefore = await linkInboxRowsFor(s.parentA.userId);

    const rejected = await ParentLinkRequestService.respondToLinkRequest(
      requestId,
      false,
      s.studentS.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    expectIncomingShape(rejected);
    expect(rejected.id).toBe(requestId);
    expect(rejected.status).toBe(LinkStatus.Rejected);
    expect(rejected.respondedAt).not.toBeNull();
    const parentARow = await userRowById(s.parentA.userId);
    if (parentARow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(rejected.parentFullName).toBe(parentARow.fullName);

    // INV-P1: rejection never links — `students.parent_id` unchanged (NULL).
    expect(await studentParentId(s.studentS.userId)).toBeNull();

    // The sibling pending is UNTOUCHED (still pending, never stamped).
    const siblingRow = await requestRowById(sibling.id);
    expect(siblingRow?.status).toBe(LinkStatus.Pending);
    expect(siblingRow?.respondedAt).toBeNull();
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);

    // EXACTLY ONE rejection notification to Parent A (one NEW row since the
    // step began), bound to the rejected request, composed in Parent A's
    // PERSISTED locale.
    const parentAInboxAfter = await linkInboxRowsFor(s.parentA.userId);
    expect(parentAInboxAfter.length - parentAInboxBefore.length).toBe(1);
    const rejectionRows = parentAInboxAfter.filter(row => row.relatedEntityId === requestId);
    expect(rejectionRows).toHaveLength(1);
    const rejectionRow = rejectionRows.at(0);
    if (rejectionRow === undefined) {
      throw new Error("expected the rejection notification row");
    }
    expect(rejectionRow.title).toBe(enNotifications.eventParentLinkRejectedTitle);
    const studentSRow = await userRowById(s.studentS.userId);
    if (studentSRow === null) {
      throw new Error("fixture student row vanished mid-journey");
    }
    expect(rejectionRow.body).toBe(enNotifications.eventParentLinkRejectedBody(studentSRow.fullName));

    // Fanout: exactly ONE post-commit publish to the parent.
    expectSinglePublish(s.parentA.userId, requestId, PARENT_LINK_DECISION_RELATED_ENTITY_TYPE);
    transportSpy.clear();
  });

  test("Step 7 — CONFIRM leg: confirmed row, parent_id = Parent B, ALL sibling pendings expired, ONE acceptance notification", async () => {
    const s = requireState();
    const confirmTargetId = requireRequestId(REQUEST.confirmSibling);

    // INV-P1 probe: the link field is NULL the instant before confirmation.
    expect(await studentParentId(s.studentS.userId)).toBeNull();

    // A fresh sibling pending from Parent A (re-application after rejection
    // is legitimate) so "ALL sibling pendings → expired" has real content.
    const reapply = await ParentLinkRequestService.requestLink(
      s.sCode,
      s.parentA.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    if (reapply === null) {
      throw new Error("expected the re-application to create a fresh pending row");
    }
    tracked.register(parentLinkRequests, reapply.id);
    createdRequestIds.set(REQUEST.reapplySibling, reapply.id);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(2);
    expectSinglePublish(s.studentS.userId, reapply.id); // the creation's own boundary
    transportSpy.clear();

    const parentBInboxBefore = await linkInboxRowsFor(s.parentB.userId);

    const confirmed = await ParentLinkRequestService.respondToLinkRequest(
      confirmTargetId,
      true,
      s.studentS.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    expectIncomingShape(confirmed);
    expect(confirmed.id).toBe(confirmTargetId);
    expect(confirmed.status).toBe(LinkStatus.Confirmed);
    expect(confirmed.respondedAt).not.toBeNull();
    const parentBRow = await userRowById(s.parentB.userId);
    if (parentBRow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(confirmed.parentFullName).toBe(parentBRow.fullName);

    // The winner link write (the ONLY grant of INV-P1): parent_id = Parent B.
    expect(await studentParentId(s.studentS.userId)).toBe(s.parentB.userId);

    // ALL sibling pendings materialized expired: the re-applied row is
    // expired (respondedAt NULL — the sweep never stamps) and zero pendings
    // remain; the step-6 REJECTED row keeps its own terminal state.
    const reapplyRow = await requestRowById(reapply.id);
    expect(reapplyRow?.status).toBe(LinkStatus.Expired);
    expect(reapplyRow?.respondedAt).toBeNull();
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(0);
    const rejectedRow = await requestRowById(requireRequestId(REQUEST.rejectTarget));
    expect(rejectedRow?.status).toBe(LinkStatus.Rejected);

    // EXACTLY ONE acceptance notification to Parent B (one NEW row since the
    // step began), bound to the confirmed request, in his PERSISTED locale.
    const parentBInboxAfter = await linkInboxRowsFor(s.parentB.userId);
    expect(parentBInboxAfter.length - parentBInboxBefore.length).toBe(1);
    const acceptanceRows = parentBInboxAfter.filter(row => row.relatedEntityId === confirmTargetId);
    expect(acceptanceRows).toHaveLength(1);
    const acceptanceRow = acceptanceRows.at(0);
    if (acceptanceRow === undefined) {
      throw new Error("expected the acceptance notification row");
    }
    expect(acceptanceRow.title).toBe(enNotifications.eventParentLinkAcceptedTitle);
    const studentSRow = await userRowById(s.studentS.userId);
    if (studentSRow === null) {
      throw new Error("fixture student row vanished mid-journey");
    }
    expect(acceptanceRow.body).toBe(enNotifications.eventParentLinkAcceptedBody(studentSRow.fullName));

    // Fanout: exactly ONE post-commit publish to the parent.
    expectSinglePublish(s.parentB.userId, confirmTargetId, PARENT_LINK_DECISION_RELATED_ENTITY_TYPE);
    transportSpy.clear();
  });

  test("Step 8 — Parent-side visibility pin: terminal statuses surface while the student name stays masked FOREVER", async () => {
    const s = requireState();
    const studentSRow = await userRowById(s.studentS.userId);
    if (studentSRow === null) {
      throw new Error("fixture student row vanished mid-journey");
    }
    const expectedMask = maskFullName(studentSRow.fullName);

    // Parent B's outgoing surface: the confirmed row is terminal AND masked.
    const parentBOutgoing = await ParentLinkRequestService.listMyOutgoing(s.parentB.userId, LOCALE);
    const confirmedOutgoing = parentBOutgoing.find(row => row.id === requireRequestId(REQUEST.confirmSibling));
    if (confirmedOutgoing === undefined) {
      throw new Error("expected the confirmed row on Parent B's outgoing list");
    }
    expectOutgoingShape(confirmedOutgoing);
    expect(confirmedOutgoing.status).toBe(LinkStatus.Confirmed);
    expect(confirmedOutgoing.respondedAt).not.toBeNull();
    expect(confirmedOutgoing.studentMaskedName).toBe(expectedMask);
    expect(confirmedOutgoing.studentMaskedName).not.toBe(studentSRow.fullName);
    expect(confirmedOutgoing.studentMaskedName).not.toContain(studentSRow.fullName);

    // Parent A's outgoing surface: rejected + expired history, masked alike.
    const parentAOutgoing = await ParentLinkRequestService.listMyOutgoing(s.parentA.userId, LOCALE);
    const rejectedOutgoing = parentAOutgoing.find(row => row.id === requireRequestId(REQUEST.rejectTarget));
    const expiredOutgoing = parentAOutgoing.find(row => row.id === requireRequestId(REQUEST.reapplySibling));
    expect(rejectedOutgoing?.status).toBe(LinkStatus.Rejected);
    expect(expiredOutgoing?.status).toBe(LinkStatus.Expired);
    for (const row of [rejectedOutgoing, expiredOutgoing]) {
      if (row === undefined) {
        throw new Error("expected Parent A's terminal outgoing rows");
      }
      expectOutgoingShape(row);
      expect(row.studentMaskedName).toBe(expectedMask);
    }

    // Reads never publish.
    expectZeroPublishes();
  });

  test("Step 9a — RACE loser collapse (deterministic emulation): after the committed winner confirm, the sibling respond collapses to the typed already-resolved conflict with ZERO loser notifications/publishes", async () => {
    const s = requireState();
    const winnerRequestId = requireRequestId(REQUEST.foreignTarget); // Parent B → F (the race winner)

    // The loser's committed pending: Parent A → F (the second contender).
    const loserPending = await ParentLinkRequestService.requestLink(
      s.fCode,
      s.parentA.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    if (loserPending === null) {
      throw new Error("expected the second contender's pending to be created");
    }
    tracked.register(parentLinkRequests, loserPending.id);
    createdRequestIds.set(REQUEST.raceLoser, loserPending.id);
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(2);
    expectSinglePublish(s.studentF.userId, loserPending.id); // the creation's own boundary
    transportSpy.clear();

    const parentAInboxBefore = await linkInboxRowsFor(s.parentA.userId);

    // Winner: Student F confirms Parent B's request.
    const winner = await ParentLinkRequestService.respondToLinkRequest(
      winnerRequestId,
      true,
      s.studentF.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    expect(winner.id).toBe(winnerRequestId);
    expect(winner.status).toBe(LinkStatus.Confirmed);
    expect(await studentParentId(s.studentF.userId)).toBe(s.parentB.userId);

    // Exactly ONE terminal state per row: the winner's sibling sweep expired
    // the loser's row (respondedAt NULL — the sweep never stamps).
    const loserRow = await requestRowById(loserPending.id);
    expect(loserRow?.status).toBe(LinkStatus.Expired);
    expect(loserRow?.respondedAt).toBeNull();

    // The winner's parent: exactly ONE acceptance notification + one publish.
    const parentBInbox = await linkInboxRowsFor(s.parentB.userId);
    expect(parentBInbox.filter(row => row.relatedEntityId === winnerRequestId)).toHaveLength(1);
    expectSinglePublish(s.parentB.userId, winnerRequestId, PARENT_LINK_DECISION_RELATED_ENTITY_TYPE);
    transportSpy.clear();

    // Loser: the confirm attempt on the expired sibling collapses to the
    // typed conflict — and the loser emits NOTHING.
    await expectConflictError(
      () =>
        ParentLinkRequestService.respondToLinkRequest(
          loserPending.id,
          true,
          s.studentF.userId,
          LOCALE,
          undefined,
          callOptions()
        ),
      "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
      errorsTranslations.parentLinkRequestAlreadyResolved
    );
    expect(await linkInboxRowsFor(s.parentA.userId)).toHaveLength(parentAInboxBefore.length);
    expectZeroPublishes();

    // Exactly one linked parent; no overlapping terminal states remain.
    expect(await studentParentId(s.studentF.userId)).toBe(s.parentB.userId);
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(0);
  });

  // ── Step 9b — TRUE concurrent two-parent confirm race ────────────────────
  // Wholesale-skip guard preserved for the true-race cell (the chaos tier's
  // exact pattern): PGlite is a single-connection WASM Postgres — concurrent
  // transactions from one process cannot interleave on separate connections,
  // so the Promise.allSettled cell runs against real PostgreSQL only. The
  // deterministic loser-collapse semantics are pinned by Step 9a everywhere.

  const describeOnRealPostgres = isPgliteProvider() ? describe.skip : describe;

  describeOnRealPostgres("Step 9b — TRUE concurrent two-parent confirm race (real PostgreSQL)", () => {
    test("two parents' pendings confirmed concurrently: exactly ONE winner link; the loser commits NOTHING and emits ZERO notifications/publishes", async () => {
      const s = requireState();

      // Base-cast isolation snapshot — the race must not leak into it.
      const baseInboxBefore = await Promise.all(castUserIds(s).map(linkInboxRowsFor));

      // Fresh race cast — its own committed provisioning, tracked for the
      // suite teardown, identity fields stamped with the per-run prefix.
      const race = await db.transaction(async (tx: DBTransaction) => {
        const parentC = await provisionParentActor(tx, { tracked, locale: LOCALE });
        const parentD = await provisionParentActor(tx, { tracked, locale: LOCALE });
        const studentR = await provisionStudentActor(tx, { tracked, locale: LOCALE });
        const stamped = [
          { actor: parentC, label: "Race Parent C", slug: "race-parent-c" },
          { actor: parentD, label: "Race Parent D", slug: "race-parent-d" },
          { actor: studentR, label: "Race Student R", slug: "race-student-r" },
        ];
        await Promise.all(
          stamped.map(({ actor, label, slug }) =>
            tx
              .update(users)
              .set({
                fullName: `${RUN_PREFIX} ${label}`,
                email: `${RUN_PREFIX}.${slug}@journey.test`,
                locale: LOCALE,
              })
              .where(eq(users.id, actor.userId))
          )
        );
        return { parentC, parentD, studentR };
      });
      raceUserIds.push(race.parentC.userId, race.parentD.userId, race.studentR.userId);

      // Two committed pendings from two DISTINCT parents for ONE student —
      // the two race cells the concurrent confirms will contend over.
      const expiresAt = new Date(Date.now() + PARENT_LINK_REQUEST_MS);
      const requestC = await db.transaction(tx =>
        ParentLinkRequestRepository.create(
          { parentId: race.parentC.userId, studentId: race.studentR.userId, expiresAt },
          tx
        )
      );
      const requestD = await db.transaction(tx =>
        ParentLinkRequestRepository.create(
          { parentId: race.parentD.userId, studentId: race.studentR.userId, expiresAt },
          tx
        )
      );
      tracked.register(parentLinkRequests, requestC.id);
      tracked.register(parentLinkRequests, requestD.id);

      // Distinct transports per raced call — the loser's silence is proven
      // on ITS OWN transport, independent of the winner's.
      const transportC = new SpiedFanoutTransport();
      const transportD = new SpiedFanoutTransport();
      const outcomes = await Promise.allSettled([
        ParentLinkRequestService.respondToLinkRequest(requestC.id, true, race.studentR.userId, LOCALE, undefined, {
          transport: transportC,
        }),
        ParentLinkRequestService.respondToLinkRequest(requestD.id, true, race.studentR.userId, LOCALE, undefined, {
          transport: transportD,
        }),
      ]);
      const { values, reasons } = settleRace(outcomes);
      expect(values).toHaveLength(1);
      expect(reasons).toHaveLength(1);

      const winner = values.at(0);
      if (winner === undefined) {
        throw new Error("expected exactly one confirmed payload from the race");
      }
      expect(winner.status).toBe(LinkStatus.Confirmed);
      const winnerRequestId = winner.id;
      const winnerParentId = winnerRequestId === requestC.id ? race.parentC.userId : race.parentD.userId;
      const loserRequestId = winnerRequestId === requestC.id ? requestD.id : requestC.id;
      const loserParentId = winnerRequestId === requestC.id ? race.parentD.userId : race.parentC.userId;
      const winnerTransport = winnerRequestId === requestC.id ? transportC : transportD;
      const loserTransport = winnerRequestId === requestC.id ? transportD : transportC;

      // Loser shape: a typed conflict (its claim collapsed against the
      // winner's committed state, or its guarded link write lost the race) —
      // or a 40P01 deadlock abort. BOTH shapes mean it committed nothing;
      // the raw driver error never leaks as a success.
      const loserReason: unknown = reasons.at(0);
      const loserCode = loserReason instanceof ConflictError ? loserReason.code : null;
      if (loserCode === null) {
        expect(hasPgCode(loserReason, "40P01")).toBe(true);
      } else {
        expect(["PARENT_LINK_REQUEST_ALREADY_RESOLVED", "PARENT_LINK_TARGET_ALREADY_LINKED"]).toContain(loserCode);
      }

      // Final state: ONE confirmed row, ONE linked parent, the loser row
      // expired by the winner's sibling sweep, zero pending rows.
      const winnerRow = await requestRowById(winnerRequestId);
      const loserRow = await requestRowById(loserRequestId);
      expect(winnerRow?.status).toBe(LinkStatus.Confirmed);
      expect(winnerRow?.respondedAt).not.toBeNull();
      expect(loserRow?.status).toBe(LinkStatus.Expired);
      expect(loserRow?.respondedAt).toBeNull();
      expect(await studentParentId(race.studentR.userId)).toBe(winnerParentId);
      expect(await pendingCountForStudent(race.studentR.userId)).toBe(0);

      // Zero cross-actor leakage: only the WINNER's parent was notified —
      // the loser's in-tx accepted copy rolled back with its whole unit, and
      // the loser's transport published nothing.
      const winnerInbox = await linkInboxRowsFor(winnerParentId);
      expect(winnerInbox).toHaveLength(1);
      expect(winnerInbox[0]?.relatedEntityId).toBe(winnerRequestId);
      expect(await linkInboxRowsFor(loserParentId)).toHaveLength(0);
      expect(winnerTransport.publishCount).toBe(1);
      expect(loserTransport.publishCount).toBe(0);

      // The base cast's inboxes are untouched by the race cast.
      const baseInboxAfter = await Promise.all(castUserIds(s).map(linkInboxRowsFor));
      expect(baseInboxAfter.map(rows => rows.length)).toEqual(baseInboxBefore.map(rows => rows.length));
    });
  });

  test("Step 10 — BOUNDARY: respond at the expiry instant denies EXPIRED; the read renders Expired WITHOUT writing (service-side render parity)", async () => {
    const s = requireState();
    // The boundary fixture: expiresAt injected AT the boundary instant —
    // every later captured `now` fails the strict `>` liveness predicate.
    // The column is application-written, so committing the instant directly
    // is honest fixture control (the journey-C pattern).
    const sInboxBeforeFixture = (await linkInboxRowsFor(s.studentS.userId)).length;
    const boundary = await db.transaction(async (tx: DBTransaction): Promise<ParentLinkRequestRow> => {
      // DB-CLOCK read — the injected boundary instant is the DATABASE's own
      // `now()` (the clock the strict-`>` claim predicate evaluates against),
      // so the boundary is deterministic regardless of app-host vs DB-host
      // clock drift (FIX-A hardening of the journey-C pattern; the JS-clock
      // injection relied on the two hosts never drifting apart).
      const clock = await tx.execute<{ now: Date }>(sql`select now() as now`);
      const dbNow = clock.rows.at(0)?.now;
      if (dbNow === undefined) {
        throw new Error("boundary fixture could not read the database clock");
      }
      const inserted = await tx
        .insert(parentLinkRequests)
        .values({
          parentId: s.parentA.userId,
          studentId: s.studentS.userId,
          expiresAt: dbNow,
        })
        .returning();
      const row = inserted.at(0);
      if (row === undefined) {
        throw new Error("boundary fixture insert returned no rows");
      }
      return row;
    });
    tracked.register(parentLinkRequests, boundary.id);
    createdRequestIds.set(REQUEST.boundary, boundary.id);

    expect(boundary.status).toBe(LinkStatus.Pending);
    // Grounding, DB-clock on BOTH sides: the injected boundary
    // instant is compared against a FRESH DATABASE `now()` — the same clock
    // the strict-`>` claim predicate evaluates against — never the JS host
    // clock, so app-host vs DB-host skew cannot spuriously fail this cell
    // (matches the DB-clock determinism intent of the fixture read above).
    // Epoch-millis read: raw `execute` rows bypass drizzle's column mapping
    // (timestamptz arrives as text), so the epoch cast keeps the comparison
    // numeric and engine-independent.
    const groundingNowMs = await db.transaction(async (tx: DBTransaction) => {
      const clock = await tx.execute<{ nowMs: string }>(
        sql`select floor(extract(epoch from now()) * 1000)::bigint as "nowMs"`
      );
      const nowMs = Number(clock.rows.at(0)?.nowMs);
      if (!Number.isFinite(nowMs)) {
        throw new Error("boundary grounding could not read the database clock");
      }
      return nowMs;
    });
    expect(boundary.expiresAt.getTime()).toBeLessThanOrEqual(groundingNowMs);
    // The fixture write is SILENT: no notification row for anyone.
    expect(await linkInboxRowsFor(s.studentS.userId)).toHaveLength(sInboxBeforeFixture);
    expectZeroPublishes();

    // RENDER parity (service-side contract): the stored-pending row past its
    // deadline surfaces Expired in the read WITHOUT any write — the lazy
    // materialization fold through `toCanonicalLinkStatus` with strict `>`
    // liveness. (The frontend `displayLinkRequestStatus` twin is
    // frontend-layer-owned and is NEVER imported here; its parity is pinned
    // by the frontend suites, not by this journey.)
    const incoming = await ParentLinkRequestService.listMyIncoming(s.studentS.userId, LOCALE);
    const renderedBoundary = incoming.find(row => row.id === boundary.id);
    expect(renderedBoundary?.status).toBe(LinkStatus.Expired);
    const afterRead = await requestRowById(boundary.id);
    expect(afterRead?.status).toBe(LinkStatus.Pending);

    // WRITE side: the claim predicate (`expires_at > now`) rejects the
    // boundary instant deterministically → typed expiry-class denial.
    await expectConflictError(
      () =>
        ParentLinkRequestService.respondToLinkRequest(
          boundary.id,
          true,
          s.studentS.userId,
          LOCALE,
          undefined,
          callOptions()
        ),
      "PARENT_LINK_REQUEST_EXPIRED",
      errorsTranslations.parentLinkRequestExpired
    );

    // The expiry is MATERIALIZED (the row survives as expired, never
    // deleted), nothing was linked, and the whole path was silent.
    const materialized = await requestRowById(boundary.id);
    expect(materialized?.status).toBe(LinkStatus.Expired);
    expect(materialized?.respondedAt).toBeNull();
    expect(await studentParentId(s.studentS.userId)).toBe(s.parentB.userId);
    expect(await linkInboxRowsFor(s.studentS.userId)).toHaveLength(sInboxBeforeFixture);
    expectZeroPublishes();
  });

  test("Step 11 — NOTIFICATION deep-link data contract: every persisted parent-link row carries the drawer-resolvable (type, relatedEntityType, relatedEntityId) triple", async () => {
    const s = requireState();

    // The student's rows: exactly the three creation notifications (step 1 +
    // the step-6 sibling + the step-7 re-application — the boundary fixture
    // of step 10 is silent by design), each addressed to the student alone,
    // carrying the parent-link type + the related-entity triple, referencing
    // exactly the requests created FOR this student — the (type,
    // relatedEntityType, relatedEntityId) key the drawer route resolution
    // consumes.
    const sInbox = await linkInboxRowsFor(s.studentS.userId);
    expect(sInbox).toHaveLength(3);
    for (const row of sInbox) {
      expect(row.userId).toBe(s.studentS.userId);
      expect(row.type).toBe(PARENT_LINK_NOTIFICATION_TYPE);
      expect(row.relatedEntityType).toBe(PARENT_LINK_RELATED_ENTITY_TYPE);
      expect(row.relatedEntityId).not.toBeNull();
      expect(row.isRead).toBe(false);
    }
    const referencedIds = new Set(sInbox.map(row => row.relatedEntityId));
    expect(referencedIds.has(requireRequestId(REQUEST.rejectTarget))).toBe(true);
    expect(referencedIds.has(requireRequestId(REQUEST.confirmSibling))).toBe(true);
    expect(referencedIds.has(requireRequestId(REQUEST.reapplySibling))).toBe(true);
    expect(referencedIds.size).toBe(3);

    // The parents' outcome rows carry the DECISION refinement with the SAME
    // relatedEntityId values — the notification data contract binds both
    // parties to the same request entity, while the audience-scoped
    // relatedEntityType keeps the parent-side drawer row on the notifications
    // feed (issue #99) instead of the student-only decision route.
    const aInbox = await linkInboxRowsFor(s.parentA.userId);
    const bInbox = await linkInboxRowsFor(s.parentB.userId);
    for (const row of [...aInbox, ...bInbox]) {
      expect(row.type).toBe(PARENT_LINK_NOTIFICATION_TYPE);
      expect(row.relatedEntityType).toBe(PARENT_LINK_DECISION_RELATED_ENTITY_TYPE);
      expect(row.relatedEntityId).not.toBeNull();
    }
    const outcomeEntityIds = [...aInbox, ...bInbox].map(row => row.relatedEntityId);
    expect(outcomeEntityIds).toContain(requireRequestId(REQUEST.rejectTarget));
    expect(outcomeEntityIds).toContain(requireRequestId(REQUEST.confirmSibling));
    expect(outcomeEntityIds).toContain(requireRequestId(REQUEST.foreignTarget));

    // Actor-binding half of the contract: the copy class binds each row to
    // its own party — the student's rows are ALL request-copy rows (the
    // student is never sent an outcome notification) and the parents' rows
    // are ALL outcome-copy rows (a parent is never sent the request
    // notification). A deep-link can only ever open for its own recipient.
    for (const row of sInbox) {
      expect(row.title).toBe(enNotifications.eventParentLinkRequestTitle);
    }
    for (const row of [...aInbox, ...bInbox]) {
      const isOutcomeCopy =
        row.title === enNotifications.eventParentLinkAcceptedTitle ||
        row.title === enNotifications.eventParentLinkRejectedTitle;
      expect(isOutcomeCopy).toBe(true);
    }
  });

  afterAll(async () => {
    const s = state;
    if (s !== null) {
      // Side-effect rows the services created are tracked for teardown too:
      // every persisted inbox row addressed to a journey user is registered
      // LAST, so registration order ⇒ notifications delete BEFORE the
      // request rows, the role-child rows and the users rows.
      const allUserIds = allJourneyUserIds(s);
      const inbox = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(inArray(notifications.userId, allUserIds));
      for (const row of inbox) {
        tracked.register(notifications, row.id);
      }
    }

    // Tracked teardown — deletes run in REVERSE registration order, so the
    // notification and request rows go FIRST, then the role-child rows, then
    // the users rows (the RESTRICT foreign keys of parent_link_requests).
    // Zero-residue verification is load-bearing.
    await tracked.cleanup();

    // Mandatory zero-residue re-probes after teardown — by tracked id set AND
    // by the `jrn_sconfirm_` prefix (nothing with this run's identity remains).
    if (s !== null) {
      const ids = allJourneyUserIds(s);
      if (ids.length > 0) {
        const [userResidue, studentResidue, requestResidue, notificationResidue, prefixResidue] = await Promise.all([
          db.$count(users, inArray(users.id, ids)),
          db.$count(students, inArray(students.id, ids)),
          db.$count(
            parentLinkRequests,
            or(inArray(parentLinkRequests.parentId, ids), inArray(parentLinkRequests.studentId, ids))
          ),
          db.$count(notifications, inArray(notifications.userId, ids)),
          db.$count(users, like(users.email, `${RUN_PREFIX}%`)),
        ]);
        expect(userResidue).toBe(0);
        expect(studentResidue).toBe(0);
        expect(requestResidue).toBe(0);
        expect(notificationResidue).toBe(0);
        expect(prefixResidue).toBe(0);
      }
    }
  });
});
