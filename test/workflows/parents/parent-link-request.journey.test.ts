/**
 * Cross-actor journey — parent→child link request workflow (DEV1-014).
 *
 * Executes the three §2.9 journeys against REAL services on the REAL test
 * database (sequential, actor-attributed steps; later steps observe the
 * shared state earlier steps committed):
 *
 *  - Journey A — request → notify → confirm → linked (steps A1..A8).
 *  - Journey B — reject & cancel, re-application, constant NOT_FOUND denials
 *    from BOTH directions, already-linked zero-notify conflict (steps B1..B7).
 *  - Journey C — expiry & contention: backdated-expiresAt fixture, silent
 *    expiry + persisted `expired` row, and the SEQUENTIAL emulation of the
 *    B12 race loser (second confirm after a committed first confirm →
 *    PARENT_LINK_TARGET_ALREADY_LINKED with the loser claim rolled back).
 *    The TRUE concurrent race proofs are owned by the 5.2 chaos tier.
 *
 * Cast (specs §2.9 actor table + one fresh target the journeys B/C need):
 * Parent A, Parent B, Student S (the contended child), Governed Student G
 * (active suspension), Already-Linked Student L (pre-linked to A), and
 * Student F (fresh reject/cancel/expiry target). Fixture identity fields
 * carry the per-run `jrn_plink_<uuid8>` prefix so repeated or parallel runs
 * never collide and teardown residue is greppable.
 *
 * TEST-FIRST (expected RED state): the service surface does not exist yet.
 * Per the task-2.1 contract, the service module is loaded through a
 * NON-ANALYZABLE dynamic import as the FIRST `beforeAll` statement — so the
 * RED failure mode is exactly `Cannot find module …/parent-link-request.service`
 * thrown BEFORE any fixture write (zero DB residue on the RED run), while
 * `tsgo` stays at 0 errors (a static import of the missing module would break
 * the type-check). The import turns green at tasks 2.3/3.x without edits.
 *
 * Service surface this journey binds to (plan §4.2, verbatim):
 *   backend/services/parents/parent-link-request.service.ts
 *   export namespace ParentLinkRequestService {
 *     requestLink(code, parentActorId, locale, outerTx?, options?): Promise<OutgoingParentLinkRequestReturnType | null>
 *     respondToLinkRequest(requestId, accept, studentActorId, locale, outerTx?, options?): Promise<IncomingParentLinkRequestReturnType>
 *     cancelLinkRequest(requestId, parentActorId, locale, outerTx?): Promise<OutgoingParentLinkRequestReturnType>
 *     listMyOutgoing(parentActorId, locale, tx?): Promise<OutgoingParentLinkRequestReturnType[]>
 *     listMyIncoming(studentActorId, locale, tx?): Promise<IncomingParentLinkRequestReturnType[]>
 *   }
 *
 * Notification boundary (AGENTS.md rule 5): the fan-out transport is SPIED
 * at the `options.transport` injection seam (`SpiedFanoutTransport`) —
 * nothing reaches a real channel. Every notify-boundary publishes EXACTLY
 * once; every denial, the withdrawal, and the expiry path publish ZERO.
 *
 * Denials resolve through the REAL actor re-check (role + governance via the
 * real users rows) — NEVER monkey-patched. Backdated `expiresAt` fixtures
 * are committed DIRECTLY (the column is application-written, so fixture
 * control is honest): REQ-094's silent expiry is proven with a genuinely
 * stale deadline, and the race-window sibling is proven with a genuinely
 * live one.
 *
 * Harness (ledger D5): the shared harness at `test/workflows/helpers/`
 * EXISTS and is REUSED — no helper file is created or modified here.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/backend/lib/errors";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications/notification-engine.service";
import type {
  DBTransaction,
  IncomingParentLinkRequestReturnType,
  OutgoingParentLinkRequestReturnType,
  UserSelectType,
} from "@/backend/types";
import { HANDSHAKE_CODE_PATTERN } from "@/shared/constants/handshake-code.constants";
import { PARENT_LINK_REQUEST_MS, PARENT_LINK_REQUEST_TTL_DAYS } from "@/shared/constants/parent-link-request.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  ANONYMOUS_ACTOR_ID,
  catchJourneyError,
  type JourneyActor,
  linkStudentToParentFixture,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  setGovernanceFixture,
  TrackedFixtures,
} from "@/test/workflows/helpers";

const LOCALE = "en";

/** Translated error copy source — never hardcoded English expectation strings (AGENTS.md rule 6). */
const errorsTranslations = getServerTranslations(LOCALE).errorsTranslations;

/** Per-run identity prefix — `jrn_plink_<uuid8>` on every fixture identity field (rule 3). */
const RUN_PREFIX = `jrn_plink_${randomUUID().slice(0, 8)}`;

/**
 * RED-posture service specifier (task 2.1 contract): a variable-specifier
 * dynamic import keeps `tsgo` at 0 errors while the module is absent. The
 * path is relative to THIS file → `<repo>/backend/services/parents/…`.
 */
const SERVICE_PATH = "../../../backend/services/parents/parent-link-request.service";

/**
 * Locally-declared minimal mirror of the plan §4.2 service-surface contract
 * (documents the binding in-file; the dynamic import is cast to this shape).
 */
interface ParentLinkRequestServiceContract {
  requestLink(
    code: string,
    parentActorId: number,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<OutgoingParentLinkRequestReturnType | null>;
  respondToLinkRequest(
    requestId: number,
    accept: boolean,
    studentActorId: number,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<IncomingParentLinkRequestReturnType>;
  cancelLinkRequest(
    requestId: number,
    parentActorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<OutgoingParentLinkRequestReturnType>;
  listMyOutgoing(
    parentActorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<OutgoingParentLinkRequestReturnType[]>;
  listMyIncoming(
    studentActorId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<IncomingParentLinkRequestReturnType[]>;
}

/** The five §4.2 ops a genuine service surface must expose as functions. */
const REQUIRED_SERVICE_OPS = [
  "requestLink",
  "respondToLinkRequest",
  "cancelLinkRequest",
  "listMyOutgoing",
  "listMyIncoming",
] as const;

/**
 * Assertion-free runtime narrowing of the dynamically imported service
 * surface (linting-rules.md: type guards, never `as`) — every §4.2 op must
 * be a function on the exported namespace object.
 */
function isParentLinkRequestService(value: unknown): value is ParentLinkRequestServiceContract {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return REQUIRED_SERVICE_OPS.every(op => typeof Reflect.get(value, op) === "function");
}

/** Closed outgoing wire shape (plan §4.2 — the parent never sees raw student identity). */
const OUTGOING_KEYS = ["createdAt", "expiresAt", "id", "respondedAt", "status", "studentMaskedName"];

/** Closed incoming wire shape (the student sees the parent's FULL name, nothing else). */
const INCOMING_KEYS = ["createdAt", "expiresAt", "id", "parentFullName", "respondedAt", "status"];

type NotificationRow = typeof notifications.$inferSelect;
type ParentLinkRequestRow = typeof parentLinkRequests.$inferSelect;

/**
 * The parent-link notification type widened to its primitive string value —
 * the DB column infers a string union, so comparisons go through this
 * constant (linting-rules.md no-unsafe-enum-comparison).
 */
const PARENT_LINK_NOTIFICATION_TYPE: string = NotificationType.ParentLinkRequest;

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Byte fingerprint of a denial — REQ-093's constant-shape oracle (code + message only). */
function errorFingerprint(error: DomainError): string {
  return JSON.stringify({ code: error.code, message: error.message });
}

interface JourneyCastState {
  readonly parentA: JourneyActor;
  readonly parentB: JourneyActor;
  readonly studentS: JourneyActor;
  readonly studentG: JourneyActor;
  readonly studentL: JourneyActor;
  readonly studentF: JourneyActor;
  /** Canonical `KSB-` handshake codes, read back from the role-child rows. */
  readonly sCode: string;
  readonly gCode: string;
  readonly lCode: string;
  readonly fCode: string;
  /** Valid-format code derived to match NO students row — the nonexistent-code channel. */
  readonly absentCode: string;
  /** Byte-captured users rows (post prefix-refinement) for fixture-stability assertions. */
  readonly userSnapshots: ReadonlyMap<number, UserSelectType>;
}

let state: JourneyCastState | null = null;
let service: ParentLinkRequestServiceContract | null = null;

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

function requireService(): ParentLinkRequestServiceContract {
  if (service === null) {
    throw new Error("journey state missing: service surface was not loaded");
  }
  return service;
}

/** Every cast member's user id — the scope for side-effect and residue probes. */
function castUserIds(s: JourneyCastState): number[] {
  return [
    s.parentA.userId,
    s.parentB.userId,
    s.studentS.userId,
    s.studentG.userId,
    s.studentL.userId,
    s.studentF.userId,
  ];
}

/** The engine call options every journey call passes — transport spied, nothing else injected. */
function callOptions(): NotificationEngineCallOptions {
  return { transport: transportSpy };
}

/** Publish oracle: EXACTLY ONE post-commit publish, addressed to `targetUserId` alone. */
function expectSinglePublish(targetUserId: number, relatedEntityId: number): void {
  expect(transportSpy.publishCount).toBe(1);
  const call = transportSpy.lastCall;
  if (call === null) {
    throw new Error("expected one recorded publish");
  }
  expect(call.userIds).toEqual([targetUserId]);
  expect(call.payload.data.type).toBe(NotificationType.ParentLinkRequest);
  expect(call.payload.data.relatedEntityType).toBe("parent_link_request");
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

/** Denial oracle for the role/actor re-check arms (REAL resolution — no monkey-patching). */
async function expectRecheckError(
  fn: () => Promise<unknown>,
  errorClass: typeof UnauthorizedError | typeof ForbiddenError,
  code: string,
  translatedCopy: string
): Promise<void> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(errorClass);
  if (!(error instanceof DomainError)) {
    throw new Error(`expected a ${code} DomainError from the actor re-check`);
  }
  expect(error.code).toBe(code);
  expect(error.message).toContain(translatedCopy);
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

describe("Journey — parent→child link request workflow (DEV1-014, journeys A→C)", () => {
  beforeAll(async () => {
    // RED-posture FIRST statement: load the not-yet-existing service module
    // through a non-analyzable specifier. When the surface is absent this
    // throws `Cannot find module …` BEFORE any fixture write — zero DB
    // residue on the RED run (the task-2.1 sanctioned failure mode).
    const mod = await import(SERVICE_PATH);
    const candidate: unknown = mod.ParentLinkRequestService;
    if (!isParentLinkRequestService(candidate)) {
      throw new Error(`${SERVICE_PATH} did not export the ParentLinkRequestService surface`);
    }
    service = candidate;

    // System actor provisions the full cast in ONE committing transaction
    // (commit-or-nothing: a throwing setup leaves nothing behind).
    const provisioned = await db.transaction(async (tx: DBTransaction): Promise<JourneyCastState> => {
      const parentA = await provisionParentActor(tx, { tracked, locale: LOCALE });
      const parentB = await provisionParentActor(tx, { tracked, locale: LOCALE });
      const studentS = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const studentG = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const studentL = await provisionStudentActor(tx, { tracked, locale: LOCALE });
      const studentF = await provisionStudentActor(tx, { tracked, locale: LOCALE });

      // Prefix discipline (rule 3): stamp the per-run `jrn_plink_<uuid8>`
      // prefix onto every fixture identity field (explicit field mapping —
      // never a spread), so parallel runs never collide and teardown residue
      // is greppable by prefix. The helper-generated handshake codes stay
      // canonical `KSB-<8 hex>` (already run-unique by construction).
      const actors = [
        { actor: parentA, label: "Parent A", slug: "parent-a" },
        { actor: parentB, label: "Parent B", slug: "parent-b" },
        { actor: studentS, label: "Student S", slug: "student-s" },
        { actor: studentG, label: "Student G", slug: "student-g" },
        { actor: studentL, label: "Student L", slug: "student-l" },
        { actor: studentF, label: "Student F", slug: "student-f" },
      ];
      await Promise.all(
        actors.map(({ actor, label, slug }) =>
          tx
            .update(users)
            .set({ fullName: `${RUN_PREFIX} ${label}`, email: `${RUN_PREFIX}.${slug}@journey.test` })
            .where(eq(users.id, actor.userId))
        )
      );

      const ids = actors.map(({ actor }) => actor.userId);
      const [userRows, studentRows] = await Promise.all([
        tx.select().from(users).where(inArray(users.id, ids)),
        tx.select().from(students).where(inArray(students.id, ids)),
      ]);
      const userSnapshots = new Map<number, UserSelectType>(userRows.map(row => [row.id, row]));
      const codeById = new Map(studentRows.map(row => [row.id, row.handshakeCode]));
      const sCode = codeById.get(studentS.userId);
      const gCode = codeById.get(studentG.userId);
      const lCode = codeById.get(studentL.userId);
      const fCode = codeById.get(studentF.userId);
      if (sCode === undefined || gCode === undefined || lCode === undefined || fCode === undefined) {
        throw new Error("journey cast: a provisioned student has no readable handshake code");
      }

      // Valid-format code that matches no students row (grounded in Step A4).
      const absentCode = `${sCode.slice(0, -1)}${sCode.slice(-1) === "0" ? "1" : "0"}`;

      return {
        parentA,
        parentB,
        studentS,
        studentG,
        studentL,
        studentF,
        sCode,
        gCode,
        lCode,
        fCode,
        absentCode,
        userSnapshots,
      };
    });
    state = provisioned;

    // Committed fixture controls that own their transactions (the helper
    // contract — the production link flow and admin governance writes do not
    // run inside the cast's transaction). Honest pre-states, never
    // monkey-patched resolution.
    const governance = await setGovernanceFixture(provisioned.studentG.userId, {
      suspended: true,
      suspendedAt: new Date(Date.now() - 60 * 60 * 1000),
      suspendedPeriodDays: 30,
    });
    expect(governance.suspended).toBe(true);

    const linkedParentId = await linkStudentToParentFixture(provisioned.studentL.userId, provisioned.parentA.userId);
    expect(linkedParentId).toBe(provisioned.parentA.userId);

    // Snapshot refresh (honest pre-state): the byte-captured users rows are
    // re-read AFTER the committed governance + link fixtures, so the Step-9
    // fixture-stability probe compares against the TRUE pre-journey rows —
    // including G's active suspension — instead of the pre-governance cast
    // (the governance write is part of the honest pre-journey pre-state).
    const postSetupSnapshots = await db
      .select()
      .from(users)
      .where(inArray(users.id, castUserIds(provisioned)));
    state = { ...provisioned, userSnapshots: new Map(postSetupSnapshots.map(row => [row.id, row])) };
  });

  // ── Journey A — request → notify → confirm → linked ──────────────────────

  test("Journey A · Step 1 — System: the cast is real, canonical, and in its honest pre-state", async () => {
    const s = requireState();
    const codes = [s.sCode, s.gCode, s.lCode, s.fCode];
    for (const code of codes) {
      expect(code).toMatch(HANDSHAKE_CODE_PATTERN);
    }
    expect(new Set(codes).size).toBe(codes.length);

    // Every fixture identity field carries the per-run prefix (greppable + collision-free).
    const ids = castUserIds(s);
    const userRows = await Promise.all(ids.map(userRowById));
    for (const [index, row] of userRows.entries()) {
      if (row === null) {
        throw new Error(`fixture users row ${ids[index]} vanished before the journey started`);
      }
      expect(row.fullName.startsWith(RUN_PREFIX)).toBe(true);
      expect(row.email.startsWith(RUN_PREFIX)).toBe(true);
    }

    // Pre-states: L is pre-linked to Parent A; G is actively governed; every
    // other student is unlinked; the inbox of every cast member is empty.
    expect(await studentParentId(s.studentL.userId)).toBe(s.parentA.userId);
    expect(await studentParentId(s.studentG.userId)).toBeNull();
    expect(await studentParentId(s.studentS.userId)).toBeNull();
    expect(await studentParentId(s.studentF.userId)).toBeNull();
    await expectEmptyLinkInboxes(castUserIds(s));
    const castRequestCount = await db.$count(parentLinkRequests, inArray(parentLinkRequests.parentId, castUserIds(s)));
    expect(castRequestCount).toBe(0);
  });

  test("Journey A · Step 2 — Parent A requests Student S: ONE pending row (+7d), ONE inbox row, EXACTLY ONE publish", async () => {
    const s = requireState();
    const created = await requireService().requestLink(s.sCode, s.parentA.userId, LOCALE, undefined, callOptions());
    if (created === null) {
      throw new Error("expected a creation payload for the live unlinked target");
    }
    tracked.register(parentLinkRequests, created.id);

    // Closed outgoing shape; pending; untouched respondedAt; the +7-day window.
    expectOutgoingShape(created);
    expect(created.status).toBe(LinkStatus.Pending);
    expect(created.respondedAt).toBeNull();
    const windowMs = created.expiresAt.getTime() - created.createdAt.getTime();
    expect(Math.abs(windowMs - PARENT_LINK_REQUEST_MS)).toBeLessThan(1000);
    expect(PARENT_LINK_REQUEST_TTL_DAYS).toBe(7);

    // The student appears ONLY through the deterministic mask — never the raw name.
    const freshStudent = await userRowById(s.studentS.userId);
    if (freshStudent === null) {
      throw new Error("fixture student row vanished mid-journey");
    }
    expect(created.studentMaskedName).not.toBe(freshStudent.fullName);
    expect(created.studentMaskedName).not.toContain(freshStudent.fullName);

    // Exactly ONE persisted request row for the (A, S) pair, pending.
    expect(await db.$count(parentLinkRequests, eq(parentLinkRequests.id, created.id))).toBe(1);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);

    // REQ-090: the student's inbox carries exactly ONE parent-link row bound
    // to the request; NO other cast member observes any state change.
    const sInbox = await linkInboxRowsFor(s.studentS.userId);
    expect(sInbox).toHaveLength(1);
    expect(sInbox[0]?.relatedEntityType).toBe("parent_link_request");
    expect(sInbox[0]?.relatedEntityId).toBe(created.id);
    await expectEmptyLinkInboxes([
      s.parentA.userId,
      s.parentB.userId,
      s.studentG.userId,
      s.studentL.userId,
      s.studentF.userId,
    ]);

    // EXACTLY ONE post-commit publish, addressed to the student alone.
    expectSinglePublish(s.studentS.userId, created.id);
    transportSpy.clear();
  });

  test("Journey A · Step 3 — visibility matrix: outgoing/incoming are self-scoped; the deciding student sees the FULL name", async () => {
    const s = requireState();
    const outgoing = await requireService().listMyOutgoing(s.parentA.userId, LOCALE);
    expect(outgoing).toHaveLength(1);
    expectOutgoingShape(outgoing[0]);
    expect(outgoing[0]?.status).toBe(LinkStatus.Pending);
    expect(outgoing[0]?.respondedAt).toBeNull();

    // Foreign-list invariance: Parent B's own outgoing surface is EMPTY.
    expect(await requireService().listMyOutgoing(s.parentB.userId, LOCALE)).toEqual([]);

    // The deciding student sees the request with Parent A's FULL name.
    const incoming = await requireService().listMyIncoming(s.studentS.userId, LOCALE);
    expect(incoming).toHaveLength(1);
    expectIncomingShape(incoming[0]);
    const parentARow = await userRowById(s.parentA.userId);
    if (parentARow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(incoming[0]?.parentFullName).toBe(parentARow.fullName);
    expect(incoming[0]?.status).toBe(LinkStatus.Pending);

    // Governed / already-linked / fresh students observe nothing.
    expect(await requireService().listMyIncoming(s.studentG.userId, LOCALE)).toEqual([]);
    expect(await requireService().listMyIncoming(s.studentL.userId, LOCALE)).toEqual([]);
    expect(await requireService().listMyIncoming(s.studentF.userId, LOCALE)).toEqual([]);

    // The spy stayed silent — reads never publish.
    expectZeroPublishes();
  });

  test("Journey A · Step 4 — REQ-096 null-collapse: a missing code and the governed code return the SAME null, zero rows, zero publishes", async () => {
    const s = requireState();
    // Harness grounding: the derived probe code matches no students row.
    expect(await db.$count(students, eq(students.handshakeCode, s.absentCode))).toBe(0);

    const miss = await requireService().requestLink(s.absentCode, s.parentB.userId, LOCALE, undefined, callOptions());
    const governed = await requireService().requestLink(s.gCode, s.parentB.userId, LOCALE, undefined, callOptions());
    expect(miss).toBeNull();
    expect(governed).toBeNull();
    // Byte-equality: both arms collapse to the identical no-oracle answer.
    expect(JSON.stringify(miss)).toBe(JSON.stringify(governed));

    // Zero rows, zero inbox growth, zero publishes on BOTH silent arms.
    expect(await db.$count(parentLinkRequests, eq(parentLinkRequests.parentId, s.parentB.userId))).toBe(0);
    expect(await linkInboxRowsFor(s.studentS.userId)).toHaveLength(1);
    expect(await linkInboxRowsFor(s.studentG.userId)).toHaveLength(0);
    expectZeroPublishes();
  });

  test("Journey A · Step 5 — anonymous and cross-role callers are denied by the REAL actor re-check on every op", async () => {
    const s = requireState();
    const svc = requireService();

    // Anonymous (no session) — the service layer's defense-in-depth re-check.
    await expectRecheckError(
      () => svc.requestLink(s.sCode, ANONYMOUS_ACTOR_ID, LOCALE, undefined, callOptions()),
      UnauthorizedError,
      "UNAUTHORIZED",
      errorsTranslations.unauthorized
    );
    await expectRecheckError(
      () => svc.respondToLinkRequest(1, true, ANONYMOUS_ACTOR_ID, LOCALE, undefined, callOptions()),
      UnauthorizedError,
      "UNAUTHORIZED",
      errorsTranslations.unauthorized
    );
    await expectRecheckError(
      () => svc.cancelLinkRequest(1, ANONYMOUS_ACTOR_ID, LOCALE),
      UnauthorizedError,
      "UNAUTHORIZED",
      errorsTranslations.unauthorized
    );
    await expectRecheckError(
      () => svc.listMyOutgoing(ANONYMOUS_ACTOR_ID, LOCALE),
      UnauthorizedError,
      "UNAUTHORIZED",
      errorsTranslations.unauthorized
    );
    await expectRecheckError(
      () => svc.listMyIncoming(ANONYMOUS_ACTOR_ID, LOCALE),
      UnauthorizedError,
      "UNAUTHORIZED",
      errorsTranslations.unauthorized
    );

    // Cross-role (a student calling the parent-only op) — role mismatch denies
    // through the same real re-check.
    await expectRecheckError(
      () => svc.requestLink(s.fCode, s.studentF.userId, LOCALE, undefined, callOptions()),
      ForbiddenError,
      "FORBIDDEN",
      errorsTranslations.forbidden
    );

    // Every denial left zero rows, zero inbox growth, zero publishes.
    expect(await db.$count(parentLinkRequests, inArray(parentLinkRequests.parentId, castUserIds(s)))).toBe(1);
    expect(await linkInboxRowsFor(s.studentF.userId)).toHaveLength(0);
    expectZeroPublishes();
  });

  test("Journey A · Step 6 — REQ-095 duplicate pending: re-request answers PARENT_LINK_ALREADY_PENDING and the inbox stays at ONE", async () => {
    const s = requireState();
    await expectConflictError(
      () => requireService().requestLink(s.sCode, s.parentA.userId, LOCALE, undefined, callOptions()),
      "PARENT_LINK_ALREADY_PENDING",
      errorsTranslations.parentLinkAlreadyPending
    );

    // The student's incoming list STILL shows exactly ONE pending row.
    expect(await requireService().listMyIncoming(s.studentS.userId, LOCALE)).toHaveLength(1);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);
    expectZeroPublishes();
  });

  test("Journey A · Step 7 — Parent B joins the contention: a SECOND live pending for S (the future expiry sibling)", async () => {
    const s = requireState();
    const created = await requireService().requestLink(s.sCode, s.parentB.userId, LOCALE, undefined, callOptions());
    if (created === null) {
      throw new Error("expected Parent B's contention request to be created");
    }
    tracked.register(parentLinkRequests, created.id);

    expectOutgoingShape(created);
    expect(created.status).toBe(LinkStatus.Pending);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(2);
    expect(await requireService().listMyIncoming(s.studentS.userId, LOCALE)).toHaveLength(2);

    // The contender's own outgoing surface shows his row; A's shows hers — self-scoped.
    expect(await requireService().listMyOutgoing(s.parentB.userId, LOCALE)).toHaveLength(1);
    expect(await requireService().listMyOutgoing(s.parentA.userId, LOCALE)).toHaveLength(1);

    // The contender's request notified the student through the same ONE-publish boundary.
    expectSinglePublish(s.studentS.userId, created.id);
    transportSpy.clear();
  });

  test("Journey A · Step 8 — Student S confirms Parent A: winner link, accepted notify, REQ-091 sibling expiry seen by BOTH parents", async () => {
    const s = requireState();
    const aOutgoingBefore = await requireService().listMyOutgoing(s.parentA.userId, LOCALE);
    expect(aOutgoingBefore).not.toHaveLength(0);
    const aRequestId = aOutgoingBefore[0].id;

    const confirmed = await requireService().respondToLinkRequest(
      aRequestId,
      true,
      s.studentS.userId,
      LOCALE,
      undefined,
      callOptions()
    );

    // Closed incoming shape; confirmed; respondedAt stamped; A's FULL name.
    expectIncomingShape(confirmed);
    expect(confirmed.id).toBe(aRequestId);
    expect(confirmed.status).toBe(LinkStatus.Confirmed);
    const parentARow = await userRowById(s.parentA.userId);
    if (parentARow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(confirmed.parentFullName).toBe(parentARow.fullName);
    expect(confirmed.respondedAt).not.toBeNull();

    // The winner write: the student's link field is A's id.
    expect(await studentParentId(s.studentS.userId)).toBe(s.parentA.userId);

    // The parent's notification: accepted copy, bound to the request row.
    const aInbox = await linkInboxRowsFor(s.parentA.userId);
    expect(aInbox).toHaveLength(1);
    expect(aInbox[0]?.relatedEntityType).toBe("parent_link_request");
    expect(aInbox[0]?.relatedEntityId).toBe(aRequestId);
    await expectEmptyLinkInboxes([s.parentB.userId, s.studentG.userId, s.studentL.userId, s.studentF.userId]);
    expectSinglePublish(s.parentA.userId, aRequestId);
    transportSpy.clear();

    // REQ-091 — sibling pendings of the winner's student are terminal, and
    // BOTH parents observe it from their own lists.
    const bOutgoingBefore = await requireService().listMyOutgoing(s.parentB.userId, LOCALE);
    expect(bOutgoingBefore).not.toHaveLength(0);
    const bRequestId = bOutgoingBefore[0].id;
    expect(bRequestId).not.toBe(aRequestId);
    const bOutgoing = await requireService().listMyOutgoing(s.parentB.userId, LOCALE);
    expect(bOutgoing).toHaveLength(1);
    expect(bOutgoing[0]?.status).toBe(LinkStatus.Expired);
    expect(bOutgoing[0]?.id).toBe(bRequestId);
    const aOutgoingAfter = await requireService().listMyOutgoing(s.parentA.userId, LOCALE);
    expect(aOutgoingAfter[0]?.status).toBe(LinkStatus.Confirmed);
    // Sibling visibility from the deciding student's OWN incoming list: rows
    // are selected BY ID (the repo pins created_at DESC ordering, so the
    // later-created sibling sorts first — index selection would read the
    // wrong row). BOTH rows are asserted: A's confirmed, B's expired.
    const sIncoming = await requireService().listMyIncoming(s.studentS.userId, LOCALE);
    expect(sIncoming).toHaveLength(2);
    expect(sIncoming.find(row => row.id === aRequestId)?.status).toBe(LinkStatus.Confirmed);
    expect(sIncoming.find(row => row.id === bRequestId)?.status).toBe(LinkStatus.Expired);

    // The sibling row is MATERIALIZED expired in the database, and zero
    // pending rows remain for S.
    const bRow = await requestRowById(bRequestId);
    expect(bRow?.status).toBe(LinkStatus.Expired);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(0);
  });

  test("Journey A · Step 9 — integrity: zero audit rows, fixture rows byte-stable, uninvolved students untouched", async () => {
    const s = requireState();
    // No audit rows may be attributable to any cast member for the whole flow.
    const auditCount = await db.$count(
      auditLogs,
      or(inArray(auditLogs.actorId, castUserIds(s)), inArray(auditLogs.entityId, castUserIds(s)))
    );
    expect(auditCount).toBe(0);

    // Governance + identity fields of every cast user row are unchanged.
    const freshRows = await Promise.all(castUserIds(s).map(userRowById));
    for (const [index, id] of castUserIds(s).entries()) {
      const snapshot = s.userSnapshots.get(id);
      const fresh = freshRows[index];
      if (snapshot === undefined || fresh === null) {
        throw new Error(`fixture users row ${id} missing during the integrity probe`);
      }
      expect(fresh.fullName).toBe(snapshot.fullName);
      expect(fresh.email).toBe(snapshot.email);
      expect(fresh.role).toBe(snapshot.role);
      expect(fresh.isDeleted).toBe(snapshot.isDeleted);
      expect(fresh.isBlocked).toBe(snapshot.isBlocked);
      expect(fresh.suspended).toBe(snapshot.suspended);
      expect(fresh.suspendedAt).toStrictEqual(snapshot.suspendedAt);
      expect(fresh.suspendedPeriodDays).toBe(snapshot.suspendedPeriodDays);
    }

    // Uninvolved link fields: G null, L still A, F still null.
    expect(await studentParentId(s.studentG.userId)).toBeNull();
    expect(await studentParentId(s.studentL.userId)).toBe(s.parentA.userId);
    expect(await studentParentId(s.studentF.userId)).toBeNull();
  });

  // ── Journey B — reject & cancel ──────────────────────────────────────────

  test("Journey B · Step 10 — Parent A requests Student F (fresh): pending, ONE publish", async () => {
    const s = requireState();
    const created = await requireService().requestLink(s.fCode, s.parentA.userId, LOCALE, undefined, callOptions());
    if (created === null) {
      throw new Error("expected a creation payload for the fresh unlinked target");
    }
    tracked.register(parentLinkRequests, created.id);
    expect(created.status).toBe(LinkStatus.Pending);
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(1);
    expect(await linkInboxRowsFor(s.studentF.userId)).toHaveLength(1);
    expectSinglePublish(s.studentF.userId, created.id);
    transportSpy.clear();
  });

  test("Journey B · Step 11 — Student F rejects: rejected row, rejected notify, parentId stays NULL", async () => {
    const s = requireState();
    const fIncoming = await requireService().listMyIncoming(s.studentF.userId, LOCALE);
    expect(fIncoming).not.toHaveLength(0);
    const fRequestId = fIncoming[0].id;

    // Delta pin: earlier journey steps legitimately notified this parent
    // (Step 8's accepted copy lives in the same inbox), so the rejected-notify
    // property is pinned as EXACTLY ONE NEW parent-link row, bound to THIS
    // request id.
    const parentAInboxBefore = await linkInboxRowsFor(s.parentA.userId);

    const rejected = await requireService().respondToLinkRequest(
      fRequestId,
      false,
      s.studentF.userId,
      LOCALE,
      undefined,
      callOptions()
    );
    expectIncomingShape(rejected);
    expect(rejected.status).toBe(LinkStatus.Rejected);
    expect(rejected.respondedAt).not.toBeNull();
    const parentARow = await userRowById(s.parentA.userId);
    if (parentARow === null) {
      throw new Error("fixture parent row vanished mid-journey");
    }
    expect(rejected.parentFullName).toBe(parentARow.fullName);

    // Rejection never links, and leaves the student's other pendings live
    // ("children choose parents") — here: zero pendings at all.
    expect(await studentParentId(s.studentF.userId)).toBeNull();
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(0);

    // ONE rejected notification to the parent (exactly one NEW row since the
    // step began, bound to the rejected request); ONE publish to the parent.
    const parentAInboxAfter = await linkInboxRowsFor(s.parentA.userId);
    expect(parentAInboxAfter.length - parentAInboxBefore.length).toBe(1);
    expect(parentAInboxAfter.filter(row => row.relatedEntityId === fRequestId)).toHaveLength(1);
    expectSinglePublish(s.parentA.userId, fRequestId);
    transportSpy.clear();

    // Re-responding to the resolved row is the constant ALREADY_RESOLVED shape.
    await expectConflictError(
      () =>
        requireService().respondToLinkRequest(fRequestId, false, s.studentF.userId, LOCALE, undefined, callOptions()),
      "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
      errorsTranslations.parentLinkRequestAlreadyResolved
    );
    expectZeroPublishes();
  });

  test("Journey B · Step 12 — re-application after rejection is legitimate: a FRESH pending row", async () => {
    const s = requireState();
    const reapplied = await requireService().requestLink(s.fCode, s.parentA.userId, LOCALE, undefined, callOptions());
    if (reapplied === null) {
      throw new Error("expected the re-application to create a fresh pending row");
    }
    tracked.register(parentLinkRequests, reapplied.id);
    expect(reapplied.status).toBe(LinkStatus.Pending);

    // Exactly ONE live pending for (A, F) — the rejected row does not block.
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(1);
    // The incoming list is the pair's HISTORY (repo §4.1: all statuses,
    // newest first): the rejected row stays visible beside the fresh pending,
    // pinned by id — never by position.
    const fIncomingAfter = await requireService().listMyIncoming(s.studentF.userId, LOCALE);
    expect(fIncomingAfter).toHaveLength(2);
    expect(fIncomingAfter.find(row => row.id === reapplied.id)?.status).toBe(LinkStatus.Pending);
    expect(fIncomingAfter.find(row => row.id !== reapplied.id)?.status).toBe(LinkStatus.Rejected);
    expectSinglePublish(s.studentF.userId, reapplied.id);
    transportSpy.clear();
  });

  test("Journey B · Step 13 — REQ-093 constant NOT_FOUND from BOTH directions: foreign-id ≡ nonexistent-id, byte-equal", async () => {
    const s = requireState();
    const svc = requireService();
    const reappliedIncoming = await requireService().listMyIncoming(s.studentF.userId, LOCALE);
    expect(reappliedIncoming).not.toHaveLength(0);
    const reappliedId = reappliedIncoming[0].id;
    const NONEXISTENT_ID = 999999999;

    // Student direction: another student's request id, and a nonexistent id.
    const foreignStudentFingerprint = await expectNotFoundShape(() =>
      svc.respondToLinkRequest(reappliedId, true, s.studentS.userId, LOCALE, undefined, callOptions())
    );
    const missingStudentFingerprint = await expectNotFoundShape(() =>
      svc.respondToLinkRequest(NONEXISTENT_ID, true, s.studentF.userId, LOCALE, undefined, callOptions())
    );

    // Parent direction: another parent's request id, and a nonexistent id.
    const foreignParentFingerprint = await expectNotFoundShape(() =>
      svc.cancelLinkRequest(reappliedId, s.parentB.userId, LOCALE)
    );
    const missingParentFingerprint = await expectNotFoundShape(() =>
      svc.cancelLinkRequest(NONEXISTENT_ID, s.parentA.userId, LOCALE)
    );

    // ALL four denials are the SAME constant shape — byte-equal surface.
    const fingerprints = [
      foreignStudentFingerprint,
      missingStudentFingerprint,
      foreignParentFingerprint,
      missingParentFingerprint,
    ];
    for (const fingerprint of fingerprints) {
      expect(fingerprint).toBe(foreignStudentFingerprint);
    }

    // Zero writes observed: the re-application row is untouched and still pending.
    const row = await requestRowById(reappliedId);
    expect(row?.status).toBe(LinkStatus.Pending);
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(1);
    expectZeroPublishes();
  });

  test("Journey B · Step 14 — REQ-092 already-linked target: conflict with ZERO new incoming rows and ZERO notifications", async () => {
    const s = requireState();
    const lInboxBefore = await linkInboxRowsFor(s.studentL.userId);
    await expectConflictError(
      () => requireService().requestLink(s.lCode, s.parentB.userId, LOCALE, undefined, callOptions()),
      "PARENT_LINK_TARGET_ALREADY_LINKED",
      errorsTranslations.parentLinkTargetAlreadyLinked
    );

    // The linked student observes ZERO new incoming rows and ZERO notifications.
    expect(await requireService().listMyIncoming(s.studentL.userId, LOCALE)).toEqual([]);
    expect(await linkInboxRowsFor(s.studentL.userId)).toHaveLength(lInboxBefore.length);
    expect(await studentParentId(s.studentL.userId)).toBe(s.parentA.userId);
    expectZeroPublishes();
  });

  test("Journey B · Step 15 — Parent A withdraws the live pending: silent fold to rejected, ZERO notifications", async () => {
    const s = requireState();
    const reappliedId = (await requireService().listMyOutgoing(s.parentA.userId, LOCALE)).find(
      row => row.status === LinkStatus.Pending
    )?.id;
    if (reappliedId === undefined) {
      throw new Error("expected the live re-application id on Parent A's outgoing list");
    }
    const inboxBefore = await Promise.all(castUserIds(s).map(id => linkInboxRowsFor(id)));

    const withdrawn = await requireService().cancelLinkRequest(reappliedId, s.parentA.userId, LOCALE);
    expectOutgoingShape(withdrawn);
    expect(withdrawn.id).toBe(reappliedId);
    expect(withdrawn.status).toBe(LinkStatus.Rejected);
    expect(withdrawn.respondedAt).not.toBeNull();

    // Withdrawal is SILENT: no inbox row appeared for anyone; no publish.
    const inboxAfter = await Promise.all(castUserIds(s).map(id => linkInboxRowsFor(id)));
    expect(inboxAfter.map(rows => rows.length)).toEqual(inboxBefore.map(rows => rows.length));
    expectZeroPublishes();

    // The target is untouched and the folded row persists as request history.
    expect(await studentParentId(s.studentF.userId)).toBeNull();
    const row = await requestRowById(reappliedId);
    expect(row?.status).toBe(LinkStatus.Rejected);
    expect(
      await db.$count(
        parentLinkRequests,
        and(eq(parentLinkRequests.parentId, s.parentA.userId), eq(parentLinkRequests.studentId, s.studentF.userId))
      )
    ).toBe(2);

    // A's outgoing list now shows the folded row as rejected.
    const aOutgoing = await requireService().listMyOutgoing(s.parentA.userId, LOCALE);
    expect(aOutgoing.find(entry => entry.id === reappliedId)?.status).toBe(LinkStatus.Rejected);
  });

  test("Journey B · Step 16 — cancelling the folded row again is the constant ALREADY_RESOLVED conflict", async () => {
    const s = requireState();
    const foldedId = (await requireService().listMyOutgoing(s.parentA.userId, LOCALE)).find(
      row => row.status === LinkStatus.Rejected
    )?.id;
    if (foldedId === undefined) {
      throw new Error("expected the folded (rejected) request id on Parent A's outgoing list");
    }
    await expectConflictError(
      () => requireService().cancelLinkRequest(foldedId, s.parentA.userId, LOCALE),
      "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
      errorsTranslations.parentLinkRequestAlreadyResolved
    );
    expectZeroPublishes();
  });

  // ── Journey C — expiry & contention ──────────────────────────────────────

  test("Journey C · Step 17 — System: backdated-expiresAt fixture committed DIRECTLY (honest fixture control)", async () => {
    const s = requireState();
    // The student's inbox must be UNCHANGED by the fixture write (silent):
    // pinned as a delta, since earlier journey steps legitimately notified F.
    const fInboxBeforeFixture = (await linkInboxRowsFor(s.studentF.userId)).length;
    // expiresAt is application-written, so committing a stale deadline
    // directly is honest fixture control — REQ-094's genuinely-expired row.
    const backdated = await db.transaction(async (tx: DBTransaction): Promise<ParentLinkRequestRow> => {
      const inserted = await tx
        .insert(parentLinkRequests)
        .values({
          parentId: s.parentB.userId,
          studentId: s.studentF.userId,
          expiresAt: new Date(Date.now() - 60_000),
        })
        .returning();
      const row = inserted.at(0);
      if (row === undefined) {
        throw new Error("backdated fixture insert returned no rows");
      }
      return row;
    });
    tracked.register(parentLinkRequests, backdated.id);

    expect(backdated.status).toBe(LinkStatus.Pending);
    expect(backdated.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(await studentParentId(s.studentF.userId)).toBeNull();
    // The student's inbox must be UNCHANGED by the fixture write (silent).
    expect(await linkInboxRowsFor(s.studentF.userId)).toHaveLength(fInboxBeforeFixture);
    expectZeroPublishes();
  });

  test("Journey C · Step 18 — REQ-094 silent expiry: confirm attempt denies PARENT_LINK_REQUEST_EXPIRED, materializes the row, links nothing", async () => {
    const s = requireState();
    const expiredId = (
      await db.select({ id: parentLinkRequests.id }).from(parentLinkRequests).where(eq(parentLinkRequests.id, -1))
    ).at(0)?.id;
    expect(expiredId).toBeUndefined();

    const staleRow = (
      await db
        .select()
        .from(parentLinkRequests)
        .where(
          and(eq(parentLinkRequests.parentId, s.parentB.userId), eq(parentLinkRequests.studentId, s.studentF.userId))
        )
    ).at(0);
    if (staleRow === undefined) {
      throw new Error("expected the backdated stale pending row");
    }
    const fInboxBefore = (await linkInboxRowsFor(s.studentF.userId)).length;

    await expectConflictError(
      () =>
        requireService().respondToLinkRequest(staleRow.id, true, s.studentF.userId, LOCALE, undefined, callOptions()),
      "PARENT_LINK_REQUEST_EXPIRED",
      errorsTranslations.parentLinkRequestExpired
    );

    // The row persists as `expired` (never deleted), the link field stays
    // NULL, and the whole path was SILENT: zero notifications, zero publishes.
    const materialized = await requestRowById(staleRow.id);
    expect(materialized?.status).toBe(LinkStatus.Expired);
    expect(await studentParentId(s.studentF.userId)).toBeNull();
    expect(await pendingCountForStudent(s.studentF.userId)).toBe(0);
    expect(await linkInboxRowsFor(s.studentF.userId)).toHaveLength(fInboxBefore);
    expectZeroPublishes();
  });

  test("Journey C · Step 19 — sequential race-loser emulation: second confirm after the committed first ⇒ TARGET_ALREADY_LINKED, claim rolled back", async () => {
    const s = requireState();
    // Zero-notify pin: earlier journey steps legitimately populated both
    // parents' inboxes, so the race-loser silence is pinned as a DELTA (no
    // NEW inbox rows for anyone).
    const [aInboxBefore, bInboxBefore] = await Promise.all([
      linkInboxRowsFor(s.parentA.userId),
      linkInboxRowsFor(s.parentB.userId),
    ]);
    // Sequential emulation of the B12 race window: a SECOND live pending for
    // the winner's student, committed directly (the concurrent-window sibling
    // the guarded sibling-expiry could not have seen). The TRUE concurrent
    // race proofs are owned by the 5.2 chaos tier.
    const raceWindowRow = await db.transaction(async (tx: DBTransaction): Promise<ParentLinkRequestRow> => {
      const inserted = await tx
        .insert(parentLinkRequests)
        .values({
          parentId: s.parentB.userId,
          studentId: s.studentS.userId,
          expiresAt: new Date(Date.now() + PARENT_LINK_REQUEST_MS),
        })
        .returning();
      const row = inserted.at(0);
      if (row === undefined) {
        throw new Error("race-window fixture insert returned no rows");
      }
      return row;
    });
    tracked.register(parentLinkRequests, raceWindowRow.id);
    expect(raceWindowRow.status).toBe(LinkStatus.Pending);

    // The loser's confirm: the guarded claim succeeds (pending + live), then
    // the guarded link write finds `students.parent_id` already set → the
    // conflict THROW rolls the claim back — ghost confirmations are impossible.
    await expectConflictError(
      () =>
        requireService().respondToLinkRequest(
          raceWindowRow.id,
          true,
          s.studentS.userId,
          LOCALE,
          undefined,
          callOptions()
        ),
      "PARENT_LINK_TARGET_ALREADY_LINKED",
      errorsTranslations.parentLinkTargetAlreadyLinked
    );

    // Rollback proof: the loser row is STILL pending; the winner link holds;
    // exactly ONE linked parent; zero notifications, zero publishes.
    const loserRow = await requestRowById(raceWindowRow.id);
    expect(loserRow?.status).toBe(LinkStatus.Pending);
    expect(await studentParentId(s.studentS.userId)).toBe(s.parentA.userId);
    expect(await pendingCountForStudent(s.studentS.userId)).toBe(1);
    expect(await linkInboxRowsFor(s.parentA.userId)).toHaveLength(aInboxBefore.length);
    expect(await linkInboxRowsFor(s.parentB.userId)).toHaveLength(bInboxBefore.length);
    expectZeroPublishes();
  });

  afterAll(async () => {
    const s = state;
    if (s !== null) {
      // Side-effect rows the services created are tracked for teardown too:
      // every persisted inbox row addressed to a cast member is registered
      // (registration order ⇒ notifications delete BEFORE the users rows).
      const inbox = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(inArray(notifications.userId, castUserIds(s)));
      for (const row of inbox) {
        tracked.register(notifications, row.id);
      }
    }

    // Tracked teardown — deletes run in REVERSE registration order, so the
    // request/notification rows go FIRST, then the role-child rows, then the
    // users rows (REQ-046 order for the RESTRICT foreign keys of
    // parent_link_requests). Zero-residue verification is load-bearing.
    await tracked.cleanup();

    // Mandatory zero-residue re-probes after teardown — by tracked id set AND
    // by the `jrn_plink_` prefix (nothing with this run's identity remains).
    if (s !== null) {
      const ids = castUserIds(s);
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
  });
});
