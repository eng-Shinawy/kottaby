/**
 * Cross-actor journey — the student "available teachers" directory end-to-end
 * across three real actors, driven through the REAL service layer against the
 * REAL test database. The shared state is the teacher's visibility triple
 * (`teacher.is_online`, `teacher.is_approved`, the teacher's live `started`
 * session); the student is the observer whose browse result changes as the
 * teacher and the session lifecycle move that state.
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - committed fixtures in ONE `beforeAll` `db.transaction(...)` (commit-or-nothing);
 *  - tracked hard-delete in `afterAll` via `TrackedFixtures.cleanup()` — the
 *    completion's notification row is registered LAST so reverse deletion
 *    removes notifications BEFORE `users` (FK-safe by construction);
 *  - post-teardown residue re-probes are mandatory — a leaking `afterAll`
 *    fails the suite;
 *  - NO `runInRollback` around service calls — services own their
 *    transactions (this layer is the documented exception to the
 *    `backend/db/test/` rollback rule);
 *  - honest roles only: every browse call is a real user id; the denial probe
 *    is a REAL teacher user (no `students` row) hitting the genuine
 *    caller-resolution path — nothing monkey-patched;
 *  - the completion's ONE sanctioned side effect (the student confirm-prompt
 *    notification row, published through the notification engine after the
 *    commit) is intercepted at the publish boundary and its persisted row is
 *    registered for tracked teardown;
 *  - every browse/denial step proves side-effect absence by ROW-COUNT DELTAS
 *    scoped to fixture ids plus a ZERO-dispatch assertion on the spied
 *    publish boundary — a browse is a pure point-in-time read.
 *
 * Cast (provisioned in ONE committing `beforeAll` transaction):
 *  - `arabicStudent` — real `users` + `students` rows, country Egypt
 *    (country code EG), Arabic language baseline (no language filter).
 *  - `frenchStudent` — real `users` + `students` rows, NO country pair
 *    (every candidate is a foreign candidate for him) and a French primary
 *    language (the language hard filter applies to him).
 *  - `directoryTeacher` — certified, online, Hafs-certified, Hifz subject,
 *    French-fluent, rated 4.50, Egypt (the acting teacher for the toggle
 *    probes and the non-student caller-miss denial).
 *  - `unratedTeacher` — certified, online, Hafs/Hifz, Egypt, unrated, no
 *    foreign-language fluency (the teacher whose session is started and
 *    completed mid-journey).
 *  - `foreignTeacher` — certified, online, Hafs/Hifz, French-fluent,
 *    rated 5.00, Morocco (the foreign tier).
 *  - `warshTeacher` — certified, online, Warsh-certified (recitation miss).
 *  - `tajweedTeacher` — certified, online, Hafs, Tajweed-only subject
 *    (subject miss).
 *  - `uncertifiedTeacher` — online, Hafs/Hifz, NOT approved (certification
 *    miss).
 *  - `offlineTeacher` — certified, OFFLINE, Hafs/Hifz (availability miss).
 *  - `staleOnlineTeacher` — certified, Hafs/Hifz, `is_online=true` while a
 *    `started` session exists (the stale-flag window — the in-session
 *    exclusion must dominate the flag, never trust it).
 *  - `governedTeacher` — certified, online, Hafs/Hifz, suspended user
 *    (governance miss).
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/teachers/on-demand-matching.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestSession, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import { ConflictError, DomainError, NotFoundError } from "@/backend/lib/errors";
import { assertTeacherNotInActiveSession } from "@/backend/services/classes/session-lifecycle.enforcement";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { TeacherAvailabilityService } from "@/backend/services/teachers/teacher-availability.service";
import { TeacherMatchingService } from "@/backend/services/teachers/teacher-matching.service";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  TeacherMatchingPageReturnType,
  TeacherMatchingSubmitInput,
} from "@/backend/types";
import { RecitationReading } from "@/shared/constants/recitation-reading.enum";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  type JourneyActor,
  journeyPrefix,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/**
 * Default journey locale. Denial assertions pin English translated
 * substrings from the errors namespace; localized-copy parity lives in
 * the service-tier test suite.
 */
const LOCALE_EN = "en" as const;

/**
 * Per-run fixture prefix (`jrn_matching_<8hex>`): embedded in every cast
 * member's display name so repeated or parallel runs never collide and any
 * mid-crash residue stays greppable.
 */
const PREFIX = journeyPrefix("matching");

/** The recitation token every eligible fixture teacher is certified for. */
const HAFS = RecitationReading.HAFS_AN_ASIM;

/** The recitation token NO fixture teacher carries (the empty-browse probe). */
const UNSUPPLIED_READING = RecitationReading.AL_DURI_AN_ABI_AMR;

/** The subject token the browse intent resolves to (the subject vocabulary). */
const HIFZ_SUBJECT = SessionIntent.Hifz;

/** Default page bounds the browse restores for explicit `null` inputs. */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Returns the localized errors bundle for the default journey locale. Used
 * for byte-exact denial-message assertions (never raw keys, never the
 * code echoed into the copy).
 */
function errorsFor() {
  return getServerTranslations(LOCALE_EN).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Runs a service call through a try/catch and returns the rejection — the
 * journey-layer replacement for `expect(...).rejects.toThrow()`. Fails the
 * test when the call resolves successfully (a missing denial is exactly the
 * bug class journeys exist to catch).
 */
async function catchDenial(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected the call to be denied, but it resolved successfully");
}

/**
 * A student actor's browse choices (explicit `null`s restore the defaults).
 * The intent union is the student browse vocabulary — the staff-driven
 * evaluation flow is not a browse intent.
 */
function browseInput(
  recitation: RecitationReading,
  intent: SessionIntent.Hifz | SessionIntent.Tajweed
): TeacherMatchingSubmitInput {
  // Explicit `null`s restore the page/search/rating defaults; `sort` is the
  // non-nullable SDL default (`RATING_DESC`) carried verbatim.
  return {
    recitation,
    intent,
    page: null,
    pageSize: null,
    search: null,
    minRating: null,
    sort: TeacherMatchingSort.RatingDesc,
  };
}

/** The canonical Hafs + Hifz browse every visibility probe uses. */
function hafsHifzBrowse(): TeacherMatchingSubmitInput {
  return browseInput(HAFS, HIFZ_SUBJECT);
}

/** Runs the student browse through the real service (no tx — a pure read). */
async function browse(
  studentUserId: number,
  input: TeacherMatchingSubmitInput
): Promise<TeacherMatchingPageReturnType> {
  return TeacherMatchingService.browseAvailableTeachers(studentUserId, input, LOCALE_EN);
}

/** Ordered id projection of a browse page (the visibility assertion shape). */
function visibleTeacherIds(page: TeacherMatchingPageReturnType): number[] {
  return page.items.map(item => item.id);
}

/** Ids sorted ascending — the deterministic comparison form for id sets. */
function sortedIds(ids: readonly number[]): number[] {
  return [...ids].toSorted((a, b) => a - b);
}

/**
 * Independent read-back oracle — the persisted `teacher.is_online` value for
 * one teacher id (direct Drizzle select on the global `db`, NOT via any
 * service). Used by the in-session lock and release assertions.
 */
async function readTeacherIsOnline(teacherUserId: number): Promise<boolean | null> {
  const [row] = await db.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherUserId));
  return row?.isOnline ?? null;
}

/**
 * The non-session eligibility inputs for one fixture teacher, read straight
 * from the rows (teacher flags + governance flags + the raw JSON token
 * payloads). Powers the session-state eligibility set the oracle-parity
 * anchor compares against — re-derived from the rows, never asserted from
 * provisioning intent.
 */
interface NonSessionEligibilityInputs {
  readonly isOnline: boolean | null;
  readonly isApproved: boolean | null;
  readonly suspended: boolean | null;
  readonly isDeleted: boolean | null;
  readonly isBlocked: boolean | null;
  readonly recitationsRaw: string | null;
  readonly subjectsRaw: string | null;
  readonly hasStartedSession: boolean;
}

/** Reads the non-session eligibility inputs for one teacher (rows joined). */
async function readNonSessionEligibilityInputs(teacherUserId: number): Promise<NonSessionEligibilityInputs | null> {
  const row = (
    await db
      .select({
        isOnline: teacher.isOnline,
        isApproved: teacher.isApproved,
        recitationsRaw: teacher.recitations,
        subjectsRaw: teacher.subjects,
        suspended: users.suspended,
        isDeleted: users.isDeleted,
        isBlocked: users.isBlocked,
      })
      .from(teacher)
      .innerJoin(users, eq(users.id, teacher.id))
      .where(eq(teacher.id, teacherUserId))
  ).at(0);
  if (row === undefined) {
    return null;
  }
  const liveSession = (
    await db
      .select({ teacherId: session.teacherId })
      .from(session)
      .where(and(eq(session.teacherId, teacherUserId), eq(session.status, SessionStatus.Started)))
      .limit(1)
  ).at(0);
  return { ...row, hasStartedSession: liveSession !== undefined };
}

/**
 * Whether one teacher row satisfies EVERY browse predicate EXCEPT the
 * in-session exclusion: certified, governance-clean, and carrying the exact
 * quoted tokens for the browse's recitation and subject — plus an
 * availability flag that is not a manual toggle-off. The in-session lock
 * drives `is_online=false` as part of the session transition itself, so a
 * locked teacher remains session-state-eligible here: his exclusion is
 * attributable to the live session (the session predicate dominates the
 * flag), never to a toggle. A teacher toggled off carries no live session
 * and stays excluded.
 */
function passesNonSessionPredicates(inputs: NonSessionEligibilityInputs): boolean {
  return (
    (inputs.isOnline === true || inputs.hasStartedSession) &&
    inputs.isApproved === true &&
    inputs.suspended !== true &&
    inputs.isDeleted !== true &&
    inputs.isBlocked !== true &&
    (inputs.recitationsRaw ?? "").includes(`"${HAFS}"`) &&
    (inputs.subjectsRaw ?? "").includes(`"${HIFZ_SUBJECT}"`)
  );
}

/**
 * Probes the canonical per-teacher session-state gate for one teacher inside
 * the caller's transaction. Returns `true` only for the genuine
 * in-session conflict; any other rejection is rethrown (the parity anchor
 * must never absorb an unrelated failure).
 */
async function probeOracleInActiveSession(teacherUserId: number, tx: DBTransaction): Promise<boolean> {
  try {
    await assertTeacherNotInActiveSession(teacherUserId, tx);
    return false;
  } catch (error) {
    if (error instanceof ConflictError && rejectionCode(error) === "TEACHER_IN_ACTIVE_SESSION") {
      return true;
    }
    throw error;
  }
}

/**
 * Runs the per-teacher session-state oracle across the whole fixture cast
 * inside ONE read-only transaction and returns the ids it rejects.
 */
async function collectOracleInSessionRejections(teacherUserIds: readonly number[]): Promise<number[]> {
  const rejected: number[] = [];
  await db.transaction(async tx => {
    const probeNext = async (index: number): Promise<void> => {
      if (index >= teacherUserIds.length) {
        return;
      }
      const teacherUserId = teacherUserIds.at(index);
      if (teacherUserId !== undefined && (await probeOracleInActiveSession(teacherUserId, tx))) {
        rejected.push(teacherUserId);
      }
      await probeNext(index + 1);
    };
    await probeNext(0);
  });
  return rejected;
}

/**
 * Re-derives the session-state eligible set from the committed rows: every
 * fixture teacher passing all NON-session predicates. The browse must hide
 * exactly the oracle-rejected subset of THESE teachers — exclusion of anyone
 * else is attributable to a different predicate, not to session state.
 */
async function collectSessionStateEligibleTeachers(teacherUserIds: readonly number[]): Promise<number[]> {
  const eligible: number[] = [];
  const collectNext = async (index: number): Promise<void> => {
    if (index >= teacherUserIds.length) {
      return;
    }
    const teacherUserId = teacherUserIds.at(index);
    if (teacherUserId !== undefined) {
      const inputs = await readNonSessionEligibilityInputs(teacherUserId);
      if (inputs !== null && passesNonSessionPredicates(inputs)) {
        eligible.push(teacherUserId);
      }
    }
    await collectNext(index + 1);
  };
  await collectNext(0);
  return eligible;
}

/**
 * Row-count snapshot of every external-effect surface the browse path could
 * touch: notifications for the whole cast, session rows owned by or
 * referencing cast members, and the teachers' wallet + ledger rows. All
 * counters are scoped to fixture ids so pre-existing shared-DB rows can
 * never satisfy or break a delta.
 */
interface BrowseSideEffectSnapshot {
  readonly castNotificationRows: number;
  readonly castSessionRows: number;
  readonly castWalletRows: number;
  readonly castTeacherTransactionRows: number;
}

/** Captures the side-effect snapshot for the current cast. */
async function browseSideEffectSnapshot(): Promise<BrowseSideEffectSnapshot> {
  const castNotificationRows = await db.$count(
    notifications,
    inArray(notifications.userId, [...studentUserIds, ...teacherUserIds])
  );
  const castSessionRows = await db.$count(
    session,
    or(inArray(session.teacherId, teacherUserIds), inArray(session.studentId, studentUserIds))
  );
  const castWalletRows = await db.$count(wallet, inArray(wallet.teacherId, teacherUserIds));
  const ledgerRows = await db
    .select({ id: teacherTransaction.id })
    .from(teacherTransaction)
    .innerJoin(wallet, eq(teacherTransaction.walletId, wallet.id))
    .where(inArray(wallet.teacherId, teacherUserIds));
  return { castNotificationRows, castSessionRows, castWalletRows, castTeacherTransactionRows: ledgerRows.length };
}

/** Asserts a step produced ZERO deltas on every side-effect counter. */
function expectZeroSideEffectDeltas(before: BrowseSideEffectSnapshot, after: BrowseSideEffectSnapshot): void {
  expect(after.castNotificationRows).toBe(before.castNotificationRows);
  expect(after.castSessionRows).toBe(before.castSessionRows);
  expect(after.castWalletRows).toBe(before.castWalletRows);
  expect(after.castTeacherTransactionRows).toBe(before.castTeacherTransactionRows);
}

/**
 * Installs a recording no-op over the engine's publish contract: no realtime
 * channel is ever touched, and each dispatch is recorded together with the
 * receipts (and their recipient ids) so a step can assert both THAT a
 * publish happened and WHICH users it targeted. Installed once in
 * `beforeAll`, restored in `afterAll`.
 */
function spyPublication(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

/** Every recipient id the spy has recorded so far, in publish order. */
function publishedUserIds(): number[] {
  return (publication?.calls ?? []).flatMap(receipts => receipts.flatMap(receipt => receipt.recipientUserIds));
}

/** How many publish dispatches the spy has recorded so far. */
function publicationCount(): number {
  return publication?.calls.length ?? 0;
}

/**
 * Attribute fixture for one directory teacher (all values are fixture-owned,
 * explicitly field-mapped — no spreads of unvalidated input anywhere).
 * `averageRating` is the decimal STRING the `teacher.average_rating` column
 * stores; `languages` `null` models a teacher with no recorded fluency.
 */
interface TeacherDirectoryProfile {
  readonly label: string;
  readonly country: string;
  readonly countryCode: string;
  readonly recitations: readonly RecitationReading[];
  readonly subjects: readonly string[];
  readonly languages: readonly string[] | null;
  readonly averageRating: string | null;
  readonly isOnline: boolean;
  readonly isApproved: boolean;
  readonly suspended: boolean;
}

/**
 * Serializes a JSON-array column payload exactly the way the quoted-token
 * read path expects: `["a","b"]` — each element anchored by surrounding
 * quotes.
 */
function jsonColumnPayload(tokens: readonly string[]): string {
  return JSON.stringify([...tokens]);
}

/**
 * Provisions one directory teacher inside the suite's committing
 * `beforeAll` transaction: a real `users` row with `role="teacher"`
 * (country pair + governance state via overrides) plus a real `teacher`
 * role-child row carrying the full directory profile via overrides. Both
 * rows are tracked for `afterAll` hard-delete cleanup (the `users` row
 * first, the `teacher` row second — reverse-deletion is FK-safe).
 */
async function provisionDirectoryTeacher(tx: DBTransaction, profile: TeacherDirectoryProfile): Promise<JourneyActor> {
  const user = await createTestUser(tx, {
    role: "teacher",
    fullName: `${PREFIX}-${profile.label}`,
    country: profile.country,
    countryCode: profile.countryCode,
    suspended: profile.suspended,
  });
  const teacherRow = await createTestTeacherRow(tx, user.id, {
    recitations: jsonColumnPayload(profile.recitations),
    subjects: jsonColumnPayload(profile.subjects),
    languages: profile.languages === null ? null : jsonColumnPayload(profile.languages),
    averageRating: profile.averageRating,
    isOnline: profile.isOnline,
    isApproved: profile.isApproved,
  });
  tracked.register(users, user.id);
  tracked.register(teacher, teacherRow.id);
  return { userId: user.id, locale: LOCALE_EN, role: user.role };
}

/**
 * Applies the directory attribute fixture to an ALREADY-provisioned actor
 * (explicit field-mapped updates on the `teacher` and `users` rows — the
 * same fixture-write discipline as the governance flips; no spreads).
 */
async function applyDirectoryProfile(
  tx: DBTransaction,
  teacherUserId: number,
  profile: Omit<TeacherDirectoryProfile, "label" | "isApproved" | "suspended">
): Promise<void> {
  await tx
    .update(teacher)
    .set({
      recitations: jsonColumnPayload(profile.recitations),
      subjects: jsonColumnPayload(profile.subjects),
      languages: profile.languages === null ? null : jsonColumnPayload(profile.languages),
      averageRating: profile.averageRating,
      isOnline: profile.isOnline,
    })
    .where(eq(teacher.id, teacherUserId));
  await tx
    .update(users)
    .set({ country: profile.country, countryCode: profile.countryCode })
    .where(eq(users.id, teacherUserId));
}

/**
 * Applies the caller-side context fixture to an ALREADY-provisioned student
 * actor (explicit field-mapped updates): the country pair drives the browse
 * ordering tier, the primary language drives the language hard filter.
 */
async function applyStudentBrowseProfile(
  tx: DBTransaction,
  studentUserId: number,
  profile: { readonly country: string | null; readonly countryCode: string | null; readonly primaryLanguage: string }
): Promise<void> {
  await tx
    .update(users)
    .set({ country: profile.country, countryCode: profile.countryCode })
    .where(eq(users.id, studentUserId));
  await tx.update(students).set({ primaryLanguage: profile.primaryLanguage }).where(eq(students.id, studentUserId));
}

/**
 * Finds the persisted confirm-prompt notification row the completion wrote
 * for one session's student (polymorphic pointer: `session` + session id).
 * Returns the row (id + type) or `null` when absent — a missing row means
 * the sanctioned side effect never committed, which fails the step.
 */
async function findCompletionPromptRow(
  studentUserId: number,
  sessionId: number
): Promise<{ readonly id: number; readonly type: string } | null> {
  const rows = await db
    .select({ id: notifications.id, type: notifications.type })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, studentUserId),
        eq(notifications.relatedEntityType, "session"),
        eq(notifications.relatedEntityId, sessionId)
      )
    );
  const row = rows[0];
  return row ? { id: row.id, type: row.type } : null;
}

// ─── Journey state (ordered tests share the committed cast) ─────────────

const tracked = new TrackedFixtures();

/**
 * The committed actor cast (assigned once by `beforeAll`). Module-scope
 * `let`s mirror the journey-layer idiom: ordered tests read the same
 * committed rows, and the id arrays scope the side-effect counters to
 * fixture ids only.
 */
let arabicStudent: JourneyActor;
let frenchStudent: JourneyActor;
let directoryTeacher: JourneyActor;
let unratedTeacher: JourneyActor;
let foreignTeacher: JourneyActor;
let warshTeacher: JourneyActor;
let tajweedTeacher: JourneyActor;
let uncertifiedTeacher: JourneyActor;
let offlineTeacher: JourneyActor;
let staleOnlineTeacher: JourneyActor;
let governedTeacher: JourneyActor;
const teacherUserIds: number[] = [];
const studentUserIds: number[] = [];

let publication: ReturnType<typeof spyPublication> | undefined;

/** The session row started (and later completed) for the unrated teacher. */
let completingSessionId = 0;

beforeAll(async () => {
  // ONE committing transaction: provisioning is commit-or-nothing — a
  // throwing setup rolls back and leaves nothing behind. Registration order
  // is FK-safe by construction (`users` row first, role-child row second,
  // session rows after every cast row), so the registry's reverse-deletion
  // sweep deletes children BEFORE their parents.
  await db.transaction(async tx => {
    arabicStudent = await provisionStudentActor(tx, { tracked });
    studentUserIds.push(arabicStudent.userId);
    await applyStudentBrowseProfile(tx, arabicStudent.userId, {
      country: "Egypt",
      countryCode: "EG",
      primaryLanguage: "arabic",
    });

    frenchStudent = await provisionStudentActor(tx, { tracked });
    studentUserIds.push(frenchStudent.userId);
    await applyStudentBrowseProfile(tx, frenchStudent.userId, {
      country: null,
      countryCode: null,
      primaryLanguage: "french",
    });

    directoryTeacher = await provisionCertifiedTeacherActor(tx, { tracked });
    teacherUserIds.push(directoryTeacher.userId);
    await applyDirectoryProfile(tx, directoryTeacher.userId, {
      country: "Egypt",
      countryCode: "EG",
      recitations: [HAFS],
      subjects: [HIFZ_SUBJECT],
      languages: ["french"],
      averageRating: "4.50",
      isOnline: true,
    });

    unratedTeacher = await provisionDirectoryTeacher(tx, {
      label: "unrated",
      country: "Egypt",
      countryCode: "EG",
      recitations: [HAFS],
      subjects: [HIFZ_SUBJECT],
      languages: null,
      averageRating: null,
      isOnline: true,
      isApproved: true,
      suspended: false,
    });
    teacherUserIds.push(unratedTeacher.userId);

    foreignTeacher = await provisionDirectoryTeacher(tx, {
      label: "foreign",
      country: "Morocco",
      countryCode: "MA",
      recitations: [HAFS],
      subjects: [HIFZ_SUBJECT],
      languages: ["french"],
      averageRating: "5.00",
      isOnline: true,
      isApproved: true,
      suspended: false,
    });
    teacherUserIds.push(foreignTeacher.userId);

    warshTeacher = await provisionDirectoryTeacher(tx, {
      label: "warsh",
      country: "Egypt",
      countryCode: "EG",
      recitations: [RecitationReading.WARSH_AN_NAFI],
      subjects: [HIFZ_SUBJECT],
      languages: null,
      averageRating: null,
      isOnline: true,
      isApproved: true,
      suspended: false,
    });
    teacherUserIds.push(warshTeacher.userId);

    tajweedTeacher = await provisionDirectoryTeacher(tx, {
      label: "tajweed",
      country: "Egypt",
      countryCode: "EG",
      recitations: [HAFS],
      subjects: [SessionIntent.Tajweed],
      languages: null,
      averageRating: null,
      isOnline: true,
      isApproved: true,
      suspended: false,
    });
    teacherUserIds.push(tajweedTeacher.userId);

    uncertifiedTeacher = await provisionDirectoryTeacher(tx, {
      label: "uncertified",
      country: "Egypt",
      countryCode: "EG",
      recitations: [HAFS],
      subjects: [HIFZ_SUBJECT],
      languages: null,
      averageRating: null,
      isOnline: true,
      isApproved: false,
      suspended: false,
    });
    teacherUserIds.push(uncertifiedTeacher.userId);

    offlineTeacher = await provisionDirectoryTeacher(tx, {
      label: "offline",
      country: "Egypt",
      countryCode: "EG",
      recitations: [HAFS],
      subjects: [HIFZ_SUBJECT],
      languages: null,
      averageRating: null,
      isOnline: false,
      isApproved: true,
      suspended: false,
    });
    teacherUserIds.push(offlineTeacher.userId);

    staleOnlineTeacher = await provisionDirectoryTeacher(tx, {
      label: "stale-online",
      country: "Egypt",
      countryCode: "EG",
      recitations: [HAFS],
      subjects: [HIFZ_SUBJECT],
      languages: null,
      averageRating: null,
      isOnline: true,
      isApproved: true,
      suspended: false,
    });
    teacherUserIds.push(staleOnlineTeacher.userId);

    governedTeacher = await provisionDirectoryTeacher(tx, {
      label: "governed",
      country: "Egypt",
      countryCode: "EG",
      recitations: [HAFS],
      subjects: [HIFZ_SUBJECT],
      languages: null,
      averageRating: null,
      isOnline: true,
      isApproved: true,
      suspended: true,
    });
    teacherUserIds.push(governedTeacher.userId);

    // The stale-flag window fixture: a `started` session whose teacher row
    // still carries `is_online=true` (the state a release race can leave
    // behind). The in-session exclusion must hide this teacher WITHOUT
    // trusting the flag — registered after the whole cast so reverse
    // deletion removes it before its teacher/student parents.
    const staleSession = await createTestSession(tx, staleOnlineTeacher.userId, arabicStudent.userId, {
      status: SessionStatus.Started,
      sessionType: SessionType.StudentSession,
      startedAt: new Date(),
    });
    tracked.register(session, staleSession.id);
  });

  // No realtime delivery for the whole suite: every publish is recorded.
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();

  // Hard-delete every tracked row in reverse registration order (notification
  // rows FIRST, then session rows, then role-child rows, `users` last —
  // FK-safe by construction) and verify zero residue. A leaking `afterAll`
  // fails the suite loudly.
  await tracked.cleanup();
  await tracked.verifyAllAbsent();
});

describe("Cross-actor journey — on-demand matching directory visibility", () => {
  test("student browse observes exactly the eligible teachers, ordered by country tier then rating", async () => {
    const before = await browseSideEffectSnapshot();
    const publishesBefore = publicationCount();

    const page = await browse(arabicStudent.userId, hafsHifzBrowse());

    // Same-country rated → same-country unrated → foreign (country tier
    // dominates rating: the 5.00-rated foreign teacher sorts LAST).
    expect(visibleTeacherIds(page)).toEqual([directoryTeacher.userId, unratedTeacher.userId, foreignTeacher.userId]);
    expect(page.total).toBe(3);
    expect(page.page).toBe(DEFAULT_PAGE);
    expect(page.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(page.pageCount).toBe(1);

    // The projected card is the closed student-facing shape: parsed float
    // rating (never the raw decimal string), parsed token arrays, no
    // contact/timestamp fields anywhere.
    const firstCard = page.items[0];
    expect(firstCard?.id).toBe(directoryTeacher.userId);
    expect(firstCard?.countryCode).toBe("EG");
    expect(firstCard?.averageRating).toBeCloseTo(4.5);
    expect(firstCard?.recitations).toEqual([HAFS]);
    expect(firstCard?.languages).toEqual(["french"]);
    expect(firstCard?.isOnline).toBe(true);
    expect(Object.keys(firstCard ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [
        "averageRating",
        "country",
        "countryCode",
        "fullName",
        "id",
        "isOnline",
        "languages",
        "recitations",
        "subjects",
      ].toSorted((a, b) => a.localeCompare(b))
    );

    // A browse is a pure read: zero rows written, zero dispatches.
    expect(publicationCount()).toBe(publishesBefore);
    expectZeroSideEffectDeltas(before, await browseSideEffectSnapshot());
  });

  test("teacher toggle to Unavailable removes him from the browse; toggle back to Available restores him", async () => {
    const before = await browseSideEffectSnapshot();
    const publishesBefore = publicationCount();

    const offline = await TeacherAvailabilityService.setAvailability(directoryTeacher.userId, false, LOCALE_EN);
    expect(offline.isOnline).toBe(false);

    // The unavailable teacher vanishes from the SAME student's next browse
    // (the snapshot semantics: each browse re-reads the committed state).
    const afterOff = await browse(arabicStudent.userId, hafsHifzBrowse());
    expect(visibleTeacherIds(afterOff)).toEqual([unratedTeacher.userId, foreignTeacher.userId]);

    const online = await TeacherAvailabilityService.setAvailability(directoryTeacher.userId, true, LOCALE_EN);
    expect(online.isOnline).toBe(true);

    const afterOn = await browse(arabicStudent.userId, hafsHifzBrowse());
    expect(visibleTeacherIds(afterOn)).toEqual([directoryTeacher.userId, unratedTeacher.userId, foreignTeacher.userId]);

    // Toggles and browses are write-free and dispatch-free.
    expect(publicationCount()).toBe(publishesBefore);
    expectZeroSideEffectDeltas(before, await browseSideEffectSnapshot());
  });

  test("a started session hides the teacher from every student's browse (INV-A3) and the session-state oracle agrees", async () => {
    const before = await browseSideEffectSnapshot();
    const publishesBefore = publicationCount();

    // A Scheduled session for the unrated teacher + the Arabic student is
    // created in its OWN committed transaction (fixture insert persists
    // across the test boundary), then transitioned through the REAL session
    // lifecycle service. `startSession` applies the in-session lock that
    // drives `teacher.is_online = false` inside the SAME transaction as the
    // transition.
    const scheduled = await db.transaction(async tx =>
      createTestSession(tx, unratedTeacher.userId, arabicStudent.userId, {
        status: SessionStatus.Scheduled,
        sessionType: SessionType.StudentSession,
        intent: SessionIntent.Hifz,
      })
    );
    completingSessionId = scheduled.id;
    tracked.register(session, completingSessionId);

    await SessionLifecycleService.startSession(unratedTeacher.userId, completingSessionId, LOCALE_EN);

    // INV-S6 lock: the started session drove the flag down.
    expect(await readTeacherIsOnline(unratedTeacher.userId)).toBe(false);

    // The locked teacher disappears from the student's next browse.
    const page = await browse(arabicStudent.userId, hafsHifzBrowse());
    expect(visibleTeacherIds(page)).toEqual([directoryTeacher.userId, foreignTeacher.userId]);

    // The stale-flag window holds the same verdict: `is_online=true` (no
    // lock ever applied to this fixture) does NOT resurface a teacher whose
    // session is still `started` — the session-state check dominates the
    // flag, never the other way around.
    expect(await readTeacherIsOnline(staleOnlineTeacher.userId)).toBe(true);
    expect(visibleTeacherIds(page)).not.toContain(staleOnlineTeacher.userId);

    // Oracle parity: re-derive the session-state eligible set from the
    // committed rows, run the canonical per-teacher gate across the whole
    // cast, and require the browse's session-attributable exclusion set to
    // EQUAL the gate's rejection set — bidirectionally, on the mixed cast
    // (free / in-session / stale-flag / governed / offline / uncertified).
    const sessionEligible = await collectSessionStateEligibleTeachers(teacherUserIds);
    expect(sortedIds(sessionEligible)).toEqual(
      sortedIds([directoryTeacher.userId, unratedTeacher.userId, foreignTeacher.userId, staleOnlineTeacher.userId])
    );

    const oracleRejected = await collectOracleInSessionRejections(teacherUserIds);
    expect(sortedIds(oracleRejected)).toEqual(sortedIds([unratedTeacher.userId, staleOnlineTeacher.userId]));

    const sessionExcluded = sessionEligible.filter(id => !visibleTeacherIds(page).includes(id));
    expect(sortedIds(sessionExcluded)).toEqual(sortedIds(oracleRejected));
    expect(visibleTeacherIds(page).some(id => oracleRejected.includes(id))).toBe(false);

    // Start + browse wrote and dispatched NOTHING. The one sanctioned row
    // delta is the tracked session fixture this test itself committed (the
    // bookkeeping row the lifecycle transitions ride on); no notification,
    // wallet, or ledger row moved anywhere in the cast.
    expect(publicationCount()).toBe(publishesBefore);
    const after = await browseSideEffectSnapshot();
    expect(after.castNotificationRows).toBe(before.castNotificationRows);
    expect(after.castSessionRows).toBe(before.castSessionRows + 1);
    expect(after.castWalletRows).toBe(before.castWalletRows);
    expect(after.castTeacherTransactionRows).toBe(before.castTeacherTransactionRows);
  });

  test("completing the session releases the in-session lock, restores the teacher, and emits exactly one student confirm-prompt", async () => {
    const before = await browseSideEffectSnapshot();
    const publishesBefore = publicationCount();

    const completed = await SessionLifecycleService.completeSession(
      unratedTeacher.userId,
      completingSessionId,
      LOCALE_EN
    );
    expect(completed.id).toBe(completingSessionId);
    expect(completed.status).toBe(SessionStatus.Completed);
    expect(completed.endedAt).not.toBeNull();

    // The release restored the flag — the teacher is online again.
    expect(await readTeacherIsOnline(unratedTeacher.userId)).toBe(true);

    // The ONE sanctioned dispatch: the confirm-prompt receipt, published
    // exactly once AFTER the commit, targeting exactly the session's
    // student — nobody else in the cast.
    expect(publicationCount()).toBe(publishesBefore + 1);
    expect(publishedUserIds().slice(publishesBefore)).toEqual([arabicStudent.userId]);

    // The prompt's persisted row exists for the session's student and is
    // registered for tracked teardown (deleted BEFORE its user in the
    // `afterAll` reverse sweep).
    const promptRow = await findCompletionPromptRow(arabicStudent.userId, completingSessionId);
    expect(promptRow).not.toBeNull();
    expect(promptRow?.type).toBe("session_completion");
    if (promptRow !== null) {
      tracked.register(notifications, promptRow.id);
    }

    // The student's next browse surfaces the teacher again — unrated, but
    // same-country, so still ahead of the higher-rated foreign teacher.
    const page = await browse(arabicStudent.userId, hafsHifzBrowse());
    expect(visibleTeacherIds(page)).toEqual([directoryTeacher.userId, unratedTeacher.userId, foreignTeacher.userId]);

    // Exactly ONE new notification row (the prompt) and nothing else moved
    // anywhere in the cast — no wallet, no ledger, no extra session rows.
    const after = await browseSideEffectSnapshot();
    expect(after.castNotificationRows).toBe(before.castNotificationRows + 1);
    expect(after.castSessionRows).toBe(before.castSessionRows);
    expect(after.castWalletRows).toBe(before.castWalletRows);
    expect(after.castTeacherTransactionRows).toBe(before.castTeacherTransactionRows);
    expect(publicationCount()).toBe(publishesBefore + 1);
  });

  test("a browse no teacher satisfies is an honest empty page, never an error", async () => {
    const before = await browseSideEffectSnapshot();
    const publishesBefore = publicationCount();

    const empty = await browse(arabicStudent.userId, browseInput(UNSUPPLIED_READING, HIFZ_SUBJECT));

    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.page).toBe(DEFAULT_PAGE);
    expect(empty.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(empty.pageCount).toBe(0);

    // The empty page is still a pure read.
    expect(publicationCount()).toBe(publishesBefore);
    expectZeroSideEffectDeltas(before, await browseSideEffectSnapshot());
  });

  test("a French-speaking student browses through the language hard filter; the Arabic baseline still sees everyone", async () => {
    const before = await browseSideEffectSnapshot();
    const publishesBefore = publicationCount();

    // The French student carries NO country pair: every candidate is a
    // foreign candidate, so the rating sort decides — the 5.00-rated
    // French-fluent teacher first, the 4.50-rated one second. The unrated
    // teacher has NO recorded fluency and is fail-closed excluded.
    const frenchPage = await browse(frenchStudent.userId, hafsHifzBrowse());
    expect(visibleTeacherIds(frenchPage)).toEqual([foreignTeacher.userId, directoryTeacher.userId]);
    expect(frenchPage.total).toBe(2);

    // The Arabic-baseline student has NO language filter applied: the same
    // moment's browse still surfaces every eligible teacher, language
    // fluency recorded or not.
    const arabicPage = await browse(arabicStudent.userId, hafsHifzBrowse());
    expect(visibleTeacherIds(arabicPage)).toEqual([
      directoryTeacher.userId,
      unratedTeacher.userId,
      foreignTeacher.userId,
    ]);

    expect(publicationCount()).toBe(publishesBefore);
    expectZeroSideEffectDeltas(before, await browseSideEffectSnapshot());
  });

  test("a teacher caller is denied the student browse with the caller-miss not-found", async () => {
    const before = await browseSideEffectSnapshot();
    const publishesBefore = publicationCount();

    // A REAL teacher user (no `students` row) calling the student browse —
    // the denial fires through the genuine caller-resolution path and
    // discloses nothing.
    const denied = await catchDenial(() => browse(directoryTeacher.userId, hafsHifzBrowse()));

    expect(denied).toBeInstanceOf(NotFoundError);
    expect(rejectionCode(denied)).toBe("STUDENT_NOT_FOUND");
    expect(denied.message).toBe(errorsFor().studentHandshakeNotFound);

    // The denial wrote and dispatched NOTHING.
    expect(publicationCount()).toBe(publishesBefore);
    expectZeroSideEffectDeltas(before, await browseSideEffectSnapshot());
  });
});
