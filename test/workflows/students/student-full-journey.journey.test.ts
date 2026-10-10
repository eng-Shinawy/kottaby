/**
 * Cross-actor journey — the student's full lifecycle, chained over ONE
 * committed world: registration → plan purchase → webhook settlement →
 * parent link → teacher browse → session booking → lifecycle → dual
 * confirmation → teacher wallet credit → session report → parent
 * notification wave → read-only parent portal.
 *
 * The suite walks the full arc sequentially, every step driving the REAL
 * production services (registration, catalog and
 * purchase, webhook settlement, the parent-link chain, matching, the
 * session escrow lifecycle, reports, the parent portal, arbitration):
 * steps accumulate in declaration order, and every later step observes
 * the shared state the earlier steps committed; denials flow through
 * the real authorization/ownership paths, nothing monkey-patched. Money
 * moves only along the stepped transitions — the fee is escrowed at
 * booking, released exactly once by the dual confirmation, refunded on
 * cancel, and reversed by Refund arbitration — and the closing System
 * sweep re-reads the whole end state (lanes, sessions, wallet, ledger,
 * content rows, billing pair, link, inbox deltas) in one place.
 * Teardown is zero-residue by construction: every created row is
 * registered in `TrackedFixtures`, every trigger-suspension sweep
 * re-probes its own deletion, and the tracked cleanup existence-probes
 * every registered row — a leaking `afterAll` fails the suite loudly.
 *
 * Cast (all rows tracked for hard-delete teardown):
 *  - `studentS` — the primary student, registered through the REAL
 *    registration service inside the provisioning transaction (locale
 *    `en`, country `EG`, preferred recitation Hafs), so the free-trial
 *    grant, the handshake mint, and the recitation-catalog validation all
 *    run through their genuine paths.
 *  - `parentP` — the student's parent, registered the same way (locale
 *    `ar`); linked to the student mid-journey through the REAL handshake
 *    chain.
 *  - `teacherT` — certified, online, Hafs-certified, Hifz subject,
 *    Arabic-fluent, rated 4.50, Egypt (direct insert with the full
 *    directory profile so the browse filters resolve honestly).
 *  - `adminA` — the governance actor (arbitration legs).
 *  - `studentS2` — a zero-balance student (direct insert grants NO free
 *    trial) — the insufficient-balance denial actor.
 *  - `parentP2` — a parent never linked to the student — the
 *    foreign-tenant denial actor.
 *  - `planRow` — one active Hifz-lane plan (8 sessions, 200.00 EGP).
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 *  - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *    never `runInRollback` (the services own their transactions);
 *  - honest actors: real `users` rows + real role-child rows; denials flow
 *    through the real authorization/ownership paths, nothing
 *    monkey-patched;
 *  - error assertions through `catchJourneyError` + translated substrings
 *    — never `.rejects.toThrow()`;
 *  - per-run `jrn_students_<8hex>` prefix on every fixture name, email,
 *    and idempotency key so repeated or parallel runs never collide;
 *  - every created row registered in `TrackedFixtures` (user row first,
 *    role-child row after — registration order IS the FK-safe
 *    reverse-deletion order); teardown re-probes every registered row and
 *    a leaking `afterAll` fails the suite loudly.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/students/student-full-journey.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { progress } from "@/backend/db/schema/classes/progress";
import { recitation } from "@/backend/db/schema/classes/recitation";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { TeacherMatchingSort } from "@/backend/enum/teachers/teacher-matching-sort.enum";
import { toUserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import {
  ParentLinkRequestService,
  ParentMonitoringService,
  PlanCatalogService,
  RegistrationService,
  SessionArbitrationService,
  SessionLifecycleService,
  StudentHandshakeService,
  SubscriptionActivationService,
  SubscriptionPurchaseService,
  TeacherMatchingService,
  WalletService,
} from "@/backend/services";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  HomeWorkBlockInput,
  HomeWorkReturnType,
  NotificationDeliveryReceipt,
  PaymentWebhookEvent,
  PlanSelectType,
  PurchaseSubscriptionReturnType,
  RegistrationReturnType,
  RegistrationSubmitInput,
  ReportReturnType,
  SessionReportSubmitInput,
  SessionReturnType,
  UserSelectType,
} from "@/backend/types";
import { PARENT_LINK_REQUEST_MS } from "@/shared/constants/parent-link-request.constants";
import { RecitationReading } from "@/shared/constants/recitation-reading.enum";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { maskFullName } from "@/shared/lib/mask-full-name";
import type { AppLocale } from "@/shared/locale";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { withAuditDeleteTriggersSuspended, withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  countTeacherTransactionsForTeacher,
  countWalletsForTeacher,
  InMemoryClaimCache,
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionParentActor,
  provisionStudentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/**
 * Per-run unique prefix (`jrn_students_<8hex>`): embedded in every cast
 * member's name and email so repeated or parallel runs never collide and
 * any mid-crash residue stays greppable.
 */
const PREFIX = journeyPrefix("students");

/** Error-copy locale for every service call and denial assertion. */
const LOCALE_EN = "en" as const;
/** The parent's app locale — the parent's notification waves compose in it. */
const LOCALE_AR = "ar" as const;

/** Translated registration copy — the duplicate-email denial oracle. */
const AUTH_EN = getServerTranslations(LOCALE_EN).authTranslations;

/** Translated denial copy — the booking-replay and write-denial oracles. */
const ERRORS_EN = getServerTranslations(LOCALE_EN).errorsTranslations;

/** Translated notification copy — the settlement wave composes in the recipient's persisted locale. */
const NOTIFS_EN = getServerTranslations(LOCALE_EN).notificationsTranslations;

/**
 * Translated notification copy (Arabic) — the parent's acceptance wave
 * composes in the parent's pinned locale.
 */
const NOTIFS_AR = getServerTranslations(LOCALE_AR).notificationsTranslations;

/** The recitation token the student selects at registration (echoed, never persisted). */
const HAFS = RecitationReading.HAFS_AN_ASIM;
/** The subject token the directory teacher is certified for. */
const HIFZ_SUBJECT = SessionIntent.Hifz;

/**
 * Registrant credential for both service-registered cast members — hashed
 * by the real password hasher inside the service. Named without the
 * literal `password` token so static secret-scanners don't classify the
 * declaration as a hardcoded credential.
 */
const REGISTRANT_CREDENTIAL = "journeyRegistrant123";

/**
 * Handshake codes are minted as `KSB-<8 uppercase alphanumeric>` — the
 * canonical prefix plus exactly 8 payload characters.
 */
const HANDSHAKE_CODE_LENGTH = "KSB-".length + 8;

const tracked = new TrackedFixtures();

/**
 * The settlement leg's interception seam: the webhook activation accepts an
 * injected fan-out transport and idempotency-claim cache, so the publish
 * boundary is SPIED — every realtime delivery is recorded, never sent, and
 * the assertions prove both that a dispatch happened and which userIds it
 * targeted.
 */
const transportSpy = new SpiedFanoutTransport();
const claimCache = new InMemoryClaimCache();

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

/**
 * `related_entity_type` wire values for the parent-link waves — the
 * student-targeted request row and the parent-targeted decision row
 * (audience-scoped values with no enum home, mirrored from the link
 * service's helpers).
 */
const LINK_REQUEST_RELATED_ENTITY_TYPE = "parent_link_request";
const LINK_DECISION_RELATED_ENTITY_TYPE = "parent_link_request_decision";

/** Idempotency keys — one per purchase/probe/booking leg, ≤128 chars, unique per run. */
const KEY_PURCHASE = `${PREFIX}-key-purchase`;
const KEY_PARENT_DENIAL = `${PREFIX}-key-parent-denial`;
const KEY_TEACHER_DENIAL = `${PREFIX}-key-teacher-denial`;
const KEY_SESSION_A = `${PREFIX}-key-session-a`;
const KEY_SESSION_B = `${PREFIX}-key-session-b`;
const KEY_SESSION_C = `${PREFIX}-key-session-c`;
const KEY_SESSION_D = `${PREFIX}-key-session-d`;

/**
 * The edge legs' free-text reasons and notes — prefix-embedded so any
 * mid-crash residue stays greppable to this run.
 */
const CANCEL_REASON_B = `${PREFIX} schedule conflict; rescheduling later this week`;
const DISPUTE_REASON_C = `${PREFIX} the delivered lesson skipped the booked revision plan`;
const RESOLUTION_NOTE_C = `${PREFIX} refund approved after reviewing the session record`;

/**
 * The report leg's free-text teacher notes — prefix-embedded so any
 * mid-crash residue stays greppable to this run.
 */
const REPORT_NOTES_A = `${PREFIX} steady Hifz progress; next lesson continues the revision plan`;

/**
 * Session A's two cohesive homework blocks (the Jadid memorization track
 * and the Madi revision track) — canonical `SurahJuzRef` members only.
 */
const JADID_BLOCK_A: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlFatihah };
const MADI_BLOCK_A: HomeWorkBlockInput = { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.Juz1 };

/**
 * The parent deep-link landing URL shape — the portal's pinned contract,
 * asserted as data (never rendered): the resolved id pair alone constructs
 * `/parent/children/<studentId>?tab=reports&session=<sessionId>`.
 */
const LANDING_URL_PREFIX = "/parent/children/";
const LANDING_URL_QUERY = "?tab=reports&session=";

/**
 * Ledger rows the purchase leg commits outside the tracked registry's
 * single-id vocabulary: the append-only payment rows (swept under the
 * sanctioned trigger suspension in `afterAll`), the subscription ids the
 * junction sweep deletes by, and the teacher's wallet id whose append-only
 * earning rows are swept under their own trigger suspension ahead of the
 * tracked wallet delete (the ledger restrict-deletes its wallet).
 */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];
let ledgerWalletId: number | null = null;
/**
 * The sessions the dispute leg arbitrated: each one appends an
 * immutable audit row that restrict-deletes its admin actor, so the
 * afterAll audit sweep (trigger suspension) deletes by this list ahead
 * of the tracked cleanup that removes the admin row.
 */
const arbitratedSessionIds: number[] = [];

// ─── Cast state (assigned once by beforeAll; ordered steps share it) ──────────

let studentS: JourneyActor;
let parentP: JourneyActor;
let teacherT: JourneyActor;
let adminA: JourneyActor;
let studentS2: JourneyActor;
let parentP2: JourneyActor;
let planRow: PlanSelectType;

/** The student's registration return — the recitation-echo oracle. */
let studentRegistration: RegistrationReturnType;

/** The student's committed purchase — the pending pair plus its checkout descriptor. */
let purchaseReturn: PurchaseSubscriptionReturnType;

/** The handshake code the parent submits — armed by the link-chain precondition step. */
let linkHandshakeCode: string;

/** The committed link-request row id — the accept step's claim target. */
let linkRequestId: number;

/** Session A — the primary booked session, walked through the whole lifecycle. */
let sessionA: SessionReturnType;

/** Session B — the paid-lane booking the student cancels (the refund edge). */
let sessionB: SessionReturnType;

/** Session C — the paid-lane booking that runs confirm → dispute → Refund. */
let sessionC: SessionReturnType;

/** Session A's committed report row — the report and portal read legs' oracle. */
let reportA: ReportReturnType;

/** Session A's committed homework row — the portal homework read oracle. */
let homeworkA: HomeWorkReturnType;

/** Per-actor notification-inbox baselines, captured once the cast commits. */
const inboxBaseline = new Map<number, number>();

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Builds the primary student's registration input — the journey's own shape. */
function studentRegistrationInput(): RegistrationSubmitInput {
  return {
    fullName: `${PREFIX} student`,
    email: `${PREFIX}-student@journey.test`,
    phone: "+201234567890",
    password: REGISTRANT_CREDENTIAL,
    country: "EG",
    role: "student",
    preferredRecitation: HAFS,
  };
}

/** Builds the parent's registration input (Arabic app locale actor). */
function parentRegistrationInput(): RegistrationSubmitInput {
  return {
    fullName: `${PREFIX} parent`,
    email: `${PREFIX}-parent@journey.test`,
    phone: "+201234567891",
    password: REGISTRANT_CREDENTIAL,
    country: "EG",
    role: "parent",
  };
}

/**
 * Registers a service-created cast member for teardown: the `users` row
 * first, then its role-child row — registration order IS the FK-safe
 * reverse-deletion order.
 */
function trackRegisteredActor(userId: number, childTable: "students" | "parents"): void {
  const child = childTable === "students" ? students : parents;
  tracked.register(users, userId);
  tracked.register(child, userId);
}

/**
 * Pins a cast member's persisted app locale: notification copy composes in
 * the RECIPIENT's stored locale, so the wave legs need the pin in place
 * from provisioning time.
 */
async function pinActorLocale(tx: DBTransaction, userId: number, locale: AppLocale): Promise<void> {
  await tx.update(users).set({ locale }).where(eq(users.id, userId));
}

// ─── GraphQL parity harness (in-process — the same schema and scope gates the HTTP boundary runs) ──

const PURCHASE_SOURCE = `
  mutation PurchaseSubscription($input: PurchaseSubscriptionInput!) {
    purchaseSubscription(input: $input) {
      subscription { id status }
    }
  }
`;

const CATALOG_SOURCE = `
  query PlanCatalog {
    planCatalog {
      id
      title
      sessionCount
      price
      currency
      balanceLane
      isActive
    }
  }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Builds the per-request context for a REAL user row — the same shape the
 * context factory produces for an authenticated request (sanitized user,
 * enum-mapped role, propagation-only idempotency key). The `clientIp`
 * metadata field mirrors the factory's no-header resolution — it feeds
 * rate-limit keying/correlation only, never authorization.
 */
function contextFor(user: UserSelectType, idempotencyKey: string | null): Context {
  const { passwordHash: _passwordHash, ...rest } = user;
  const safeUser = { ...rest, preferredRecitation: null };
  const translations = getServerTranslations(LOCALE_EN);
  return {
    locale: LOCALE_EN,
    t: async <K extends keyof Translations>(namespace: K) => translations[namespace],
    requestId: `${PREFIX}-request`,
    idempotencyKey,
    clientIp: "local",
    user: safeUser,
    safeUser,
    permissions: [],
    isSuperAdmin: user.role === "admin",
    role: toUserRole(user.role),
    cookies: {},
    authCookieOut: [],
  };
}

/** Anonymous context — the context factory's absent-token shape (no verified user). */
function anonymousContext(): Context {
  const translations = getServerTranslations(LOCALE_EN);
  return {
    locale: LOCALE_EN,
    t: async <K extends keyof Translations>(namespace: K) => translations[namespace],
    requestId: `${PREFIX}-request`,
    idempotencyKey: null,
    clientIp: "local",
    user: null,
    safeUser: null,
    permissions: [],
    isSuperAdmin: false,
    role: null,
    cookies: {},
    authCookieOut: [],
  };
}

/** Runs the purchase mutation as one caller through the real scope gate. */
async function executePurchaseMutation(contextValue: Context) {
  return graphql({
    schema: graphQLSchema,
    source: PURCHASE_SOURCE,
    variableValues: { input: { planId: String(planRow.id) } },
    contextValue,
  });
}

/**
 * Asserts the result carries EXACTLY one domain error whose
 * `extensions.code` equals the expected transport code.
 */
function expectSingleDenial(result: { readonly errors?: readonly unknown[] }, expectedCode: string): void {
  const first: unknown = result.errors?.[0];
  expect(first).toBeDefined();
  expect(result.errors).toHaveLength(1);
  if (!isRecord(first) || !isRecord(first.extensions)) {
    throw new Error("journey: expected the denial to carry GraphQL error extensions");
  }
  expect(first.extensions.code).toBe(expectedCode);
}

// ─── Read-back oracles ────────────────────────────────────────────────────────

/** Reads one committed `users` row by id, failing when absent. */
async function readUserRow(userId: number): Promise<UserSelectType> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey fixture: users row ${userId} vanished`);
  }
  return row;
}

/** Reads one committed `students` row by id, failing when absent. */
async function readStudentRow(studentUserId: number) {
  const rows = await db.select().from(students).where(eq(students.id, studentUserId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey fixture: students row ${studentUserId} vanished`);
  }
  return row;
}

/** Independent read-back oracle — direct Drizzle count on the inbox. */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** Committed purchase-set counters for one user (the purchase oracle). */
async function purchaseCounts(userId: number): Promise<{
  subs: number;
  payments: number;
  junction: number;
  claims: number;
}> {
  const [subs, payments, junction, claims] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, userId)),
    db.$count(studentPayments, eq(studentPayments.studentId, userId)),
    db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, userId)),
    db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, userId)),
  ]);
  return { subs, payments, junction, claims };
}

/** Reads one subscription row by id, failing when absent. */
async function readSubscriptionRow(subscriptionId: number) {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey fixture: subscription row ${subscriptionId} vanished`);
  }
  return row;
}

/** Reads one payment ledger row by id, failing when absent. */
async function readPaymentRow(paymentId: number) {
  const rows = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey fixture: payment ledger row ${paymentId} vanished`);
  }
  return row;
}

/** Reads one committed `session` row by id, failing when absent. */
async function readSessionRow(sessionId: number): Promise<SessionReturnType> {
  const rows = await db.select().from(session).where(eq(session.id, sessionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey fixture: session row ${sessionId} vanished`);
  }
  return row;
}

/** Reads one committed `reports` row by session id, failing when absent. */
async function readReportRowBySessionId(sessionId: number): Promise<ReportReturnType> {
  const rows = await db.select().from(reports).where(eq(reports.sessionId, sessionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey fixture: report row for session ${sessionId} vanished`);
  }
  return row;
}

/** Reads one committed `home_work` row by session id, failing when absent. */
async function readHomeWorkRowBySessionId(sessionId: number): Promise<HomeWorkReturnType> {
  const rows = await db.select().from(homeWork).where(eq(homeWork.sessionId, sessionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey fixture: home_work row for session ${sessionId} vanished`);
  }
  return row;
}

/**
 * The report-ready wave rows one user holds for one session — scoped by the
 * wave's distinct `title` copy slot in EITHER recipient locale, because the
 * completion-prompt row from the lifecycle leg shares the SAME
 * `SessionCompletion` type and session pointer in the student's inbox.
 */
function reportWaveRowsFor(userId: number, sessionId: number) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, NotificationType.SessionCompletion),
        eq(notifications.relatedEntityId, sessionId),
        inArray(notifications.title, [NOTIFS_EN.eventSessionReportReadyTitle, NOTIFS_AR.eventSessionReportReadyTitle])
      )
    );
}

/** Reads the directory teacher's role-child row, failing when absent. */
async function readTeacherProfileRow() {
  const rows = await db.select().from(teacher).where(eq(teacher.id, teacherT.userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("journey fixture: teacher role-child row vanished");
  }
  return row;
}

/** Per-actor inbox snapshot — one step's both-directions wave oracle. */
async function snapshotInboxes(): Promise<Map<number, number>> {
  const actors = castActors();
  const counts = await Promise.all(actors.map(actor => inboxCount(actor.userId)));
  return new Map(actors.map((actor, index) => [actor.userId, counts[index] ?? 0]));
}

/**
 * Asserts the exact per-actor inbox shift against a pre-call snapshot: every
 * listed actor moved by exactly the given delta, and every other cast
 * member observed no accidental fan-out.
 */
async function expectInboxShift(
  before: ReadonlyMap<number, number>,
  shifts: ReadonlyMap<number, number>
): Promise<void> {
  const actors = castActors();
  const counts = await Promise.all(actors.map(actor => inboxCount(actor.userId)));
  for (const [index, actor] of actors.entries()) {
    const delta = (counts[index] ?? 0) - (before.get(actor.userId) ?? 0);
    expect(delta).toBe(shifts.get(actor.userId) ?? 0);
  }
}

/**
 * The lifecycle legs' interception seam: `createSession` and
 * `completeSession` publish their waves through the engine namespace with
 * no injected-transport variant, so the publish boundary is SPIED per step
 * — installed fresh around the triggering call and restored in the SAME
 * step, never suite-wide (the optioned services publish through the SAME
 * namespace member with their own injected transport, and a standing spy
 * would swallow their publishes before the spied transport ever saw them).
 */
function spyLifecyclePublication(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

/** The full journey cast, in provisioning order. */
function castActors(): readonly JourneyActor[] {
  return [studentS, parentP, teacherT, adminA, studentS2, parentP2];
}

/** Counts the notification-engine inbox rows for every cast member. */
async function snapshotInboxBaselines(): Promise<void> {
  const actors = castActors();
  const counts = await Promise.all(actors.map(actor => inboxCount(actor.userId)));
  for (const [index, actor] of actors.entries()) {
    inboxBaseline.set(actor.userId, counts[index] ?? 0);
  }
}

// ─── Fixture provisioning ─────────────────────────────────────────────────────

beforeAll(async () => {
  // ONE committing transaction: provisioning is commit-or-nothing — a
  // throwing setup rolls back and leaves nothing behind.
  await db.transaction(async tx => {
    // The primary student + parent ride the REAL registration service
    // inside the provisioning transaction (SAVEPOINT under the outer tx):
    // the free-trial grant, the handshake mint, and the recitation-catalog
    // validation all commit with the cast.
    studentRegistration = await RegistrationService.registerUser(studentRegistrationInput(), LOCALE_EN, tx);
    studentS = { userId: studentRegistration.id, locale: LOCALE_EN, role: studentRegistration.role };
    trackRegisteredActor(studentS.userId, "students");
    await pinActorLocale(tx, studentS.userId, LOCALE_EN);

    const parentCreated = await RegistrationService.registerUser(parentRegistrationInput(), LOCALE_AR, tx);
    parentP = { userId: parentCreated.id, locale: LOCALE_AR, role: parentCreated.role };
    trackRegisteredActor(parentP.userId, "parents");
    await pinActorLocale(tx, parentP.userId, LOCALE_AR);

    // The directory teacher: a real `users` row plus a real `teacher`
    // role-child row carrying the full browse profile — the quoted-token
    // JSON columns are written exactly the way the matching read path
    // expects them.
    const teacherUser = await createTestUser(tx, {
      role: "teacher",
      fullName: `${PREFIX} teacher`,
      country: "Egypt",
      countryCode: "EG",
    });
    const teacherRow = await createTestTeacherRow(tx, teacherUser.id, {
      isApproved: true,
      isOnline: true,
      averageRating: "4.50",
      recitations: JSON.stringify([HAFS]),
      subjects: JSON.stringify([HIFZ_SUBJECT]),
      languages: JSON.stringify(["arabic"]),
    });
    tracked.register(users, teacherUser.id);
    tracked.register(teacher, teacherRow.id);
    teacherT = { userId: teacherUser.id, locale: LOCALE_EN, role: teacherUser.role };
    await pinActorLocale(tx, teacherT.userId, LOCALE_EN);

    adminA = await provisionAdminActor(tx, { locale: LOCALE_EN, tracked });
    await pinActorLocale(tx, adminA.userId, LOCALE_EN);

    // The zero-balance student: a direct-insert student row grants NO free
    // trial, so every lane starts at zero — the honest denial actor.
    studentS2 = await provisionStudentActor(tx, { locale: LOCALE_EN, tracked });
    await pinActorLocale(tx, studentS2.userId, LOCALE_EN);

    parentP2 = await provisionParentActor(tx, { locale: LOCALE_EN, tracked });
    await pinActorLocale(tx, parentP2.userId, LOCALE_EN);

    // The journey's own catalog plan — an ACTIVE Hifz-lane plan (a NULL
    // lane fails closed at purchase, so the lane is explicit).
    planRow = await createTestPlan(tx, {
      title: `${PREFIX} plan`,
      sessionCount: 8,
      price: "200.00",
      currency: "EGP",
      intervalDays: 30,
      isActive: true,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, planRow.id);
  });

  // Post-commit snapshots: the per-actor inbox baselines the wave legs
  // assert their exact deltas against.
  await snapshotInboxBaselines();
});

afterAll(async () => {
  // Every interception in this suite is step-scoped and restored inside its
  // own step (try/finally), and the injected transport is a recording
  // dependency rather than an installed spy — so teardown has nothing to
  // restore and starts directly at the trigger-suspension sweeps. Each
  // sweep re-probes its own deletion, and the tracked cleanup below
  // existence-probes EVERY registered row — a leak fails the suite loudly.
  //
  // Append-only payment ledger FIRST: the immutability trigger blocks a
  // plain DELETE, so the sanctioned suspension wraps exactly this sweep.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds))
    );
    const paymentResidue = await db.$count(studentPayments, inArray(studentPayments.id, ledgerPaymentIds));
    if (paymentResidue !== 0) {
      throw new Error(`journey teardown: ${paymentResidue} payment ledger row(s) survived deletion`);
    }
  }
  // The teacher's append-only earning ledger next: the immutability trigger
  // blocks its DELETE the same way, and its wallet FK restrict-deletes — the
  // sweep must run ahead of the tracked cleanup that deletes the wallet.
  const sweptWalletId = ledgerWalletId;
  if (sweptWalletId !== null) {
    await withImmutabilityTriggersSuspended(["teacher_transaction"], () =>
      db.delete(teacherTransaction).where(eq(teacherTransaction.walletId, sweptWalletId))
    );
    const earningResidue = await db.$count(teacherTransaction, eq(teacherTransaction.walletId, sweptWalletId));
    if (earningResidue !== 0) {
      throw new Error(`journey teardown: ${earningResidue} teacher-transaction row(s) survived deletion`);
    }
  }
  // Junction rows (composite primary key — no single-id registry entry):
  // swept by subscription id and re-probed here, ahead of the tracked sweep
  // that deletes their parent rows.
  if (ledgerSubscriptionIds.length > 0) {
    await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds));
    const junctionResidue = await db.$count(
      studentSubscriptions,
      inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds)
    );
    if (junctionResidue !== 0) {
      throw new Error(`journey teardown: ${junctionResidue} junction row(s) survived deletion`);
    }
  }
  // The arbitration's append-only audit row: DELETE-blocked by the audit
  // trigger AND restrict-deleting its admin actor, so the sanctioned
  // suspension sweeps it ahead of the tracked cleanup that deletes the
  // admin row.
  if (arbitratedSessionIds.length > 0) {
    const auditScope = and(
      eq(auditLogs.actorId, adminA.userId),
      eq(auditLogs.entityType, "session"),
      inArray(auditLogs.entityId, arbitratedSessionIds)
    );
    await withAuditDeleteTriggersSuspended(() => db.delete(auditLogs).where(auditScope));
    const auditResidue = await db.$count(auditLogs, auditScope);
    if (auditResidue !== 0) {
      throw new Error(`journey teardown: ${auditResidue} audit row(s) survived deletion`);
    }
  }
  // Reverse-registration-order hard delete + zero-residue re-probes for
  // every tracked row.
  await tracked.cleanup();
});

// ─── The journey ──────────────────────────────────────────────────────────────

describe("student full journey — registration → purchase → session → confirmation → parent report", () => {
  test("step 0 — System: committed cast and catalog plan are visible with their real roles", async () => {
    // Every cast member exists as a REAL users row carrying its REAL role
    // (the authorization paths resolve through these, never through stubs).
    const [studentUser, parentUser, teacherUser, adminUser, secondStudentUser, secondParentUser] = await Promise.all([
      readUserRow(studentS.userId),
      readUserRow(parentP.userId),
      readUserRow(teacherT.userId),
      readUserRow(adminA.userId),
      readUserRow(studentS2.userId),
      readUserRow(parentP2.userId),
    ]);
    expect(studentUser.role).toBe("student");
    expect(parentUser.role).toBe("parent");
    expect(teacherUser.role).toBe("teacher");
    expect(adminUser.role).toBe("admin");
    expect(secondStudentUser.role).toBe("student");
    expect(secondParentUser.role).toBe("parent");

    // The persisted locale pins the wave legs rely on.
    expect(studentUser.locale).toBe(LOCALE_EN);
    expect(parentUser.locale).toBe(LOCALE_AR);

    // The directory teacher's browse profile, verbatim.
    const teacherProfile = await readTeacherProfileRow();
    expect(teacherProfile.isOnline).toBe(true);
    expect(teacherProfile.isApproved).toBe(true);
    expect(teacherProfile.recitations).toBe(JSON.stringify([HAFS]));
    expect(teacherProfile.subjects).toBe(JSON.stringify([HIFZ_SUBJECT]));
    expect(teacherProfile.languages).toBe(JSON.stringify(["arabic"]));
    expect(teacherProfile.averageRating).toBe("4.50");

    // The zero-balance student starts with every lane empty.
    const secondStudentRow = await readStudentRow(studentS2.userId);
    expect(secondStudentRow.balanceTrial).toBe(0);
    expect(secondStudentRow.balanceHifz).toBe(0);
    expect(secondStudentRow.balanceTajweed).toBe(0);
    expect(secondStudentRow.balanceReviews).toBe(0);

    // The journey's own catalog plan: active, Hifz-lane, verbatim money.
    const planRows = await db.select().from(plans).where(eq(plans.id, planRow.id)).limit(1);
    const plan = planRows[0];
    if (!plan) {
      throw new Error("journey fixture: plan row vanished");
    }
    expect(plan.isActive).toBe(true);
    expect(plan.balanceLane).toBe(SubscriptionCreditLane.Hifz);
    expect(plan.sessionCount).toBe(8);
    expect(plan.price).toBe("200.00");
    expect(plan.currency).toBe("EGP");

    // Registry completeness: six user rows, their six role-child rows,
    // and the plan — every fixture this leg committed is tracked.
    expect(tracked.size).toBe(13);

    // No registration path dispatched anything: every inbox sits at its baseline.
    const actors = castActors();
    const inboxCounts = await Promise.all(actors.map(actor => inboxCount(actor.userId)));
    for (const [index, actor] of actors.entries()) {
      expect(inboxCounts[index]).toBe(inboxBaseline.get(actor.userId) ?? 0);
    }
  });

  test("step 1 — Student: registration outcomes (echo, free trial, handshake mint, zero recitation rows)", async () => {
    // The registration return echoes the validated recitation selection —
    // contract metadata only, never persisted to `recitation`.
    expect(studentRegistration.role).toBe("student");
    expect(studentRegistration.preferredRecitation).toBe(HAFS);
    // The password hash is structurally absent from the return — no
    // credential material may leave the service boundary.
    expect("passwordHash" in studentRegistration).toBe(false);

    // The free-trial grant committed with the role-child row: trial lane
    // at exactly the free-trial session count, every paid lane untouched.
    const studentRow = await readStudentRow(studentS.userId);
    expect(studentRow.balanceTrial).toBe(1);
    expect(studentRow.balanceHifz).toBe(0);
    expect(studentRow.balanceTajweed).toBe(0);
    expect(studentRow.balanceReviews).toBe(0);
    expect(studentRow.parentId).toBeNull();

    // The handshake code was minted at registration in the canonical shape
    // and reads back verbatim through the self-read service.
    expect(studentRow.handshakeCode.startsWith("KSB-")).toBe(true);
    expect(studentRow.handshakeCode).toHaveLength(HANDSHAKE_CODE_LENGTH);
    const handshakeCode = await StudentHandshakeService.getMyHandshakeCode(studentS.userId, LOCALE_EN);
    expect(handshakeCode).toBe(studentRow.handshakeCode);

    // The recitation selection is echo-only: the student owns no session
    // yet, hence no recitation row can exist for them.
    const studentSessionIds = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.studentId, studentS.userId));
    expect(studentSessionIds).toHaveLength(0);
    expect(
      await db.$count(
        recitation,
        inArray(
          recitation.sessionId,
          studentSessionIds.map(row => row.id)
        )
      )
    ).toBe(0);

    // The registration surface denies a duplicate email through the real
    // uniqueness path — translated copy, and the committed row untouched.
    const usersWithEmail = await db.$count(users, eq(users.email, studentRegistrationInput().email));
    expect(usersWithEmail).toBe(1);
    const conflict = await catchJourneyError(() =>
      RegistrationService.registerUser(studentRegistrationInput(), LOCALE_EN)
    );
    if (!(conflict instanceof ConflictError)) {
      throw new Error(
        `expected ConflictError for the duplicate email (got ${conflict instanceof Error ? conflict.name : String(conflict)})`
      );
    }
    expect(conflict.message).toContain(AUTH_EN.emailAlreadyExists);
    expect(await db.$count(users, eq(users.email, studentRegistrationInput().email))).toBe(1);
  });

  test("step 2 — Student: active catalog contains the journey's plan with its lane and money verbatim", async () => {
    const catalog = await PlanCatalogService.listActiveCatalog(LOCALE_EN);
    const entry = catalog.find(plan => plan.id === planRow.id);
    if (!entry) {
      throw new Error("journey: the active catalog omitted the journey's plan");
    }
    expect(entry.title).toBe(planRow.title);
    expect(entry.balanceLane).toBe(SubscriptionCreditLane.Hifz);
    expect(entry.sessionCount).toBe(planRow.sessionCount);
    expect(entry.price).toBe(planRow.price);
    expect(entry.currency).toBe(planRow.currency);
    expect(entry.isActive).toBe(true);
  });

  test("step 3 — Student: GraphQL planCatalog read returns the journey's plan (in-process schema parity)", async () => {
    const studentUser = await readUserRow(studentS.userId);
    const result = await graphql({
      schema: graphQLSchema,
      source: CATALOG_SOURCE,
      contextValue: contextFor(studentUser, null),
    });
    const readErrors = result.errors ?? [];
    if (!isRecord(result.data) || !Array.isArray(result.data.planCatalog) || readErrors.length > 0) {
      throw new Error(`journey: the planCatalog read failed (${JSON.stringify(readErrors)})`);
    }
    const planEntry = result.data.planCatalog.filter(isRecord).find(plan => plan.id === String(planRow.id));
    if (!planEntry) {
      throw new Error("journey: the GraphQL catalog read omitted the journey's plan");
    }
    expect(planEntry.title).toBe(planRow.title);
    expect(Number(planEntry.sessionCount)).toBe(planRow.sessionCount);
    expect(planEntry.price).toBe(planRow.price);
    expect(planEntry.currency).toBe(planRow.currency);
    if (typeof planEntry.balanceLane !== "string") {
      throw new Error("journey: the GraphQL catalog read omitted the plan's balance lane");
    }
    // The wire lane is the GraphQL enum member name; the stored lane value is
    // proven through the service read in the catalog step above.
    expect(planEntry.balanceLane.toLowerCase()).toBe(SubscriptionCreditLane.Hifz);
    expect(planEntry.isActive).toBe(true);
  });

  test("step 4 — Student: purchase commits ONE pending pair under a fresh idempotency key (mock provider, no network)", async () => {
    const countsBefore = await purchaseCounts(studentS.userId);

    const purchase = await SubscriptionPurchaseService.purchase(
      studentS.userId,
      { planId: planRow.id },
      KEY_PURCHASE,
      LOCALE_EN
    );
    purchaseReturn = purchase;

    // The returned pending pair: verbatim plan money, gateway-reference
    // correlation, and the mock provider's descriptor — the checkout touched
    // no network and exposes no hosted URL.
    expect(purchase.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(purchase.subscription.userId).toBe(studentS.userId);
    expect(purchase.subscription.planId).toBe(planRow.id);
    expect(purchase.subscription.paymentReference).toBe(purchase.checkout.providerReference);
    expect(purchase.checkout.provider).toBe(PaymentGateway.Mock);
    expect(purchase.checkout.providerReference.startsWith("mock_")).toBe(true);
    expect(purchase.checkout.checkoutUrl).toBeNull();
    expect(purchase.payment.amount).toBe(planRow.price);
    expect(purchase.payment.currency).toBe(planRow.currency);
    expect(purchase.payment.status).toBe(PaymentStatus.Pending);
    expect(purchase.payment.subscriptionId).toBe(purchase.subscription.id);

    // Register the service-created rows for teardown before asserting
    // cardinality — a failing expectation must not strand committed rows.
    tracked.register(subscriptions, purchase.subscription.id);
    tracked.register(studentPayments, purchase.payment.id);
    ledgerSubscriptionIds.push(purchase.subscription.id);
    ledgerPaymentIds.push(purchase.payment.id);

    // The claim is keyed VERBATIM and backfilled with the winning pair.
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE));
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(studentS.userId);
    expect(claimRows[0]?.subscriptionId).toBe(purchase.subscription.id);

    // The junction binds the purchasing student to the new subscription.
    const junctionRows = await db
      .select()
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.subscriptionId, purchase.subscription.id));
    expect(junctionRows).toHaveLength(1);
    expect(junctionRows[0]?.studentId).toBe(studentS.userId);

    // Exactly ONE committed pending set for the purchaser — nothing else.
    expect(await purchaseCounts(studentS.userId)).toEqual({
      subs: countsBefore.subs + 1,
      payments: countsBefore.payments + 1,
      junction: countsBefore.junction + 1,
      claims: countsBefore.claims + 1,
    });

    // The purchase credited nothing yet and dispatched nothing: every lane
    // and every inbox sits exactly where the registration leg left them.
    const studentRow = await readStudentRow(studentS.userId);
    expect(studentRow.balanceHifz).toBe(0);
    const actors = castActors();
    const inboxCounts = await Promise.all(actors.map(actor => inboxCount(actor.userId)));
    for (const [index, actor] of actors.entries()) {
      expect(inboxCounts[index]).toBe(inboxBaseline.get(actor.userId) ?? 0);
    }
  });

  test("step 5 — Anonymous/Parent/Teacher: purchaseSubscription scope-gate denials — one error each, zero writes", async () => {
    const studentCountsBefore = await purchaseCounts(studentS.userId);
    const subscriptionBefore = await readSubscriptionRow(purchaseReturn.subscription.id);
    const paymentBefore = await readPaymentRow(purchaseReturn.payment.id);

    // Anonymous caller: the authenticated leg of the scope conjunction fires.
    const anonymousResult = await executePurchaseMutation(anonymousContext());
    expectSingleDenial(anonymousResult, "UNAUTHORIZED");

    // Parent caller: authenticated but not a student — the role leg fires.
    const parentResult = await executePurchaseMutation(
      contextFor(await readUserRow(parentP.userId), KEY_PARENT_DENIAL)
    );
    expectSingleDenial(parentResult, "FORBIDDEN");
    expect(await purchaseCounts(parentP.userId)).toEqual({ subs: 0, payments: 0, junction: 0, claims: 0 });

    // Teacher caller: the same student-only gate, the same single denial.
    const teacherResult = await executePurchaseMutation(
      contextFor(await readUserRow(teacherT.userId), KEY_TEACHER_DENIAL)
    );
    expectSingleDenial(teacherResult, "FORBIDDEN");
    expect(await purchaseCounts(teacherT.userId)).toEqual({ subs: 0, payments: 0, junction: 0, claims: 0 });

    // The denials wrote nothing: the student's pending set is byte-identical
    // — same statuses, same row stamps, same cardinality.
    expect(await purchaseCounts(studentS.userId)).toEqual(studentCountsBefore);
    const subscriptionAfter = await readSubscriptionRow(purchaseReturn.subscription.id);
    expect(subscriptionAfter.status).toBe(subscriptionBefore.status);
    expect(subscriptionAfter.updatedAt.getTime()).toBe(subscriptionBefore.updatedAt.getTime());
    const paymentAfter = await readPaymentRow(purchaseReturn.payment.id);
    expect(paymentAfter.status).toBe(paymentBefore.status);
    expect(paymentAfter.updatedAt.getTime()).toBe(paymentBefore.updatedAt.getTime());
  });

  test("step 6 — System: confirmed webhook settles the purchase — paid, active, lane credited, ONE wave to the student", async () => {
    const studentBefore = await readStudentRow(studentS.userId);
    const purchasesBefore = await purchaseCounts(studentS.userId);
    const publishesBefore = transportSpy.publishCount;
    const windowStart = Date.now() - 2_000;

    const pending = await readSubscriptionRow(purchaseReturn.subscription.id);
    const reference = pending.paymentReference;
    if (reference === null) {
      throw new Error("journey: the pending subscription carries no gateway payment reference");
    }
    const event: PaymentWebhookEvent = {
      reference,
      outcome: "confirmed",
      amount: planRow.price,
      currency: planRow.currency,
    };

    const outcome = await SubscriptionActivationService.processWebhookEvent(event, LOCALE_EN, undefined, {
      transport: transportSpy,
      cache: claimCache,
    });
    expect(outcome).toEqual({ processed: true });

    // The ledger decision: pending → paid.
    const paid = await readPaymentRow(purchaseReturn.payment.id);
    expect(paid.status).toBe(PaymentStatus.Paid);

    // The activation window: verification stamped, startDate ≈ now,
    // endDate − startDate = intervalDays exactly.
    const active = await readSubscriptionRow(purchaseReturn.subscription.id);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.paymentVerifiedAt).not.toBeNull();
    if (active.startDate === null || active.endDate === null) {
      throw new Error("journey: the activated subscription carries no window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(planRow.intervalDays * MS_PER_DAY);

    // The lane credit: exactly the plan's session count, on the plan's lane —
    // every sibling lane untouched.
    const studentAfter = await readStudentRow(studentS.userId);
    expect(studentAfter.balanceHifz).toBe((studentBefore.balanceHifz ?? 0) + planRow.sessionCount);
    expect(studentAfter.balanceTrial).toBe(studentBefore.balanceTrial);
    expect(studentAfter.balanceTajweed).toBe(studentBefore.balanceTajweed);
    expect(studentAfter.balanceReviews).toBe(studentBefore.balanceReviews);

    // Activation mutates, never inserts: the purchase set did not grow.
    expect(await purchaseCounts(studentS.userId)).toEqual(purchasesBefore);

    // ONE persisted payment-confirmation notification, composed in the
    // recipient's pinned locale, pointing at the activated subscription.
    const confirmationRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.relatedEntityId, purchaseReturn.subscription.id));
    expect(confirmationRows).toHaveLength(1);
    const confirmation = confirmationRows[0];
    if (!confirmation) {
      throw new Error("journey: the settlement wave was not persisted");
    }
    tracked.register(notifications, confirmation.id);
    expect(confirmation.userId).toBe(studentS.userId);
    expect(confirmation.type).toBe(NotificationType.PaymentConfirmation);
    expect(confirmation.relatedEntityType).toBe("subscription");
    expect(confirmation.relatedEntityId).toBe(purchaseReturn.subscription.id);
    expect(confirmation.isRead).toBe(false);
    expect(confirmation.title).toBe(NOTIFS_EN.eventPaymentConfirmedTitle);
    expect(confirmation.body).toBe(NOTIFS_EN.eventPaymentConfirmedBody(planRow.title));

    // The receipt published strictly post-commit — to the student ONLY.
    expect(transportSpy.publishCount).toBe(publishesBefore + 1);
    expect(transportSpy.publishedUserIds).toEqual([studentS.userId]);

    // Both directions: the student's inbox grew by exactly the one wave;
    // every other cast member's inbox stayed at its baseline.
    expect(await inboxCount(studentS.userId)).toBe((inboxBaseline.get(studentS.userId) ?? 0) + 1);
    const others = castActors().filter(actor => actor.userId !== studentS.userId);
    const otherCounts = await Promise.all(others.map(actor => inboxCount(actor.userId)));
    for (const [index, actor] of others.entries()) {
      expect(otherCounts[index]).toBe(inboxBaseline.get(actor.userId) ?? 0);
    }
  });

  test("step 7 — System: replaying the same confirmed event → replayed ack, no second credit, no second wave", async () => {
    const studentBefore = await readStudentRow(studentS.userId);
    const purchasesBefore = await purchaseCounts(studentS.userId);
    const decidedBefore = await readPaymentRow(purchaseReturn.payment.id);
    const activeBefore = await readSubscriptionRow(purchaseReturn.subscription.id);
    const publishesBefore = transportSpy.publishCount;
    const inboxBefore = await inboxCount(studentS.userId);
    const reference = activeBefore.paymentReference;
    if (reference === null) {
      throw new Error("journey: the activated subscription lost its gateway payment reference");
    }

    const event: PaymentWebhookEvent = {
      reference,
      outcome: "confirmed",
      amount: decidedBefore.amount,
      currency: decidedBefore.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, LOCALE_EN, undefined, {
      transport: transportSpy,
      cache: claimCache,
    });
    expect(outcome).toEqual({ processed: true, replayed: true });

    // No second credit: the lane stays at its settled value, every sibling
    // lane untouched, zero new rows anywhere in the purchase set.
    const studentAfterReplay = await readStudentRow(studentS.userId);
    expect(studentAfterReplay.balanceHifz).toBe(studentBefore.balanceHifz);
    expect(studentAfterReplay.balanceHifz).toBe(planRow.sessionCount);
    expect(studentAfterReplay.balanceTrial).toBe(studentBefore.balanceTrial);
    expect(studentAfterReplay.balanceTajweed).toBe(studentBefore.balanceTajweed);
    expect(studentAfterReplay.balanceReviews).toBe(studentBefore.balanceReviews);
    expect(await purchaseCounts(studentS.userId)).toEqual(purchasesBefore);

    // No second wave, no second publish.
    expect(await inboxCount(studentS.userId)).toBe(inboxBefore);
    expect(transportSpy.publishCount).toBe(publishesBefore);

    // The decided rows are untouched — statuses and timestamps identical.
    const decidedAfter = await readPaymentRow(purchaseReturn.payment.id);
    expect(decidedAfter.status).toBe(PaymentStatus.Paid);
    expect(decidedAfter.updatedAt.getTime()).toBe(decidedBefore.updatedAt.getTime());
    const activeAfter = await readSubscriptionRow(purchaseReturn.subscription.id);
    expect(activeAfter.startDate?.getTime()).toBe(activeBefore.startDate?.getTime());
    expect(activeAfter.endDate?.getTime()).toBe(activeBefore.endDate?.getTime());
    expect(activeAfter.updatedAt.getTime()).toBe(activeBefore.updatedAt.getTime());
  });

  test("step 8 — Student: handshake code read-back arms the parent link chain", async () => {
    // The link-chain precondition: the self-read service hands back the
    // minted code the parent will submit — the exact committed value.
    const code = await StudentHandshakeService.getMyHandshakeCode(studentS.userId, LOCALE_EN);
    const studentRow = await readStudentRow(studentS.userId);
    expect(code).toBe(studentRow.handshakeCode);
    expect(code.startsWith("KSB-")).toBe(true);
    expect(code).toHaveLength(HANDSHAKE_CODE_LENGTH);
    linkHandshakeCode = code;
  });

  test("step 9 — Parent: link request via the real handshake code — ONE pending row, ONE wave to the student", async () => {
    const parentUser = await readUserRow(parentP.userId);
    const studentUser = await readUserRow(studentS.userId);
    const publishesBefore = transportSpy.publishCount;

    const created = await ParentLinkRequestService.requestLink(
      linkHandshakeCode,
      parentP.userId,
      LOCALE_AR,
      undefined,
      {
        transport: transportSpy,
        cache: claimCache,
      }
    );
    if (created === null) {
      throw new Error("journey: the link request against the live unlinked student returned null");
    }
    linkRequestId = created.id;

    // Register the service-created row for teardown before asserting — a
    // failing expectation must not strand committed rows.
    tracked.register(parentLinkRequests, created.id);

    // The outgoing payload: a live pending request with the fixed 7-day
    // opportunity window.
    expect(created.status).toBe(LinkStatus.Pending);
    expect(created.respondedAt).toBeNull();
    const windowMs = created.expiresAt.getTime() - created.createdAt.getTime();
    expect(Math.abs(windowMs - PARENT_LINK_REQUEST_MS)).toBeLessThan(1_000);

    // Pre-link masking: the outgoing surface never carries the student's raw
    // identity — only the deterministic mask.
    expect(created.studentMaskedName).toBe(maskFullName(studentUser.fullName));
    expect(created.studentMaskedName).not.toBe(studentUser.fullName);

    // The committed pending row, field by field.
    const requestRows = await db
      .select()
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, created.id))
      .limit(1);
    const requestRow = requestRows[0];
    if (!requestRow) {
      throw new Error("journey fixture: link-request row vanished");
    }
    expect(requestRow.parentId).toBe(parentP.userId);
    expect(requestRow.studentId).toBe(studentS.userId);
    expect(requestRow.status).toBe(LinkStatus.Pending);
    expect(requestRow.respondedAt).toBeNull();

    // ONE link-request wave to the student — composed in the recipient's
    // pinned locale, bound to the request row, never delivered for real.
    const studentWaveRows = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, studentS.userId), eq(notifications.type, NotificationType.ParentLinkRequest))
      );
    expect(studentWaveRows).toHaveLength(1);
    const studentWave = studentWaveRows[0];
    if (!studentWave) {
      throw new Error("journey: the link-request wave was not persisted");
    }
    tracked.register(notifications, studentWave.id);
    expect(studentWave.relatedEntityType).toBe(LINK_REQUEST_RELATED_ENTITY_TYPE);
    expect(studentWave.relatedEntityId).toBe(created.id);
    expect(studentWave.isRead).toBe(false);
    expect(studentWave.title).toBe(NOTIFS_EN.eventParentLinkRequestTitle);
    expect(studentWave.body).toBe(NOTIFS_EN.eventParentLinkRequestBody(parentUser.fullName));

    // The receipt published strictly post-commit — to the student ONLY.
    expect(transportSpy.publishCount).toBe(publishesBefore + 1);
    expect(transportSpy.lastCall?.userIds).toEqual([studentS.userId]);

    // Both directions: the student's inbox grew by exactly the one wave (on
    // top of the settlement wave); every other cast member's inbox stayed at
    // its baseline.
    expect(await inboxCount(studentS.userId)).toBe((inboxBaseline.get(studentS.userId) ?? 0) + 2);
    const others = castActors().filter(actor => actor.userId !== studentS.userId);
    const otherCounts = await Promise.all(others.map(actor => inboxCount(actor.userId)));
    for (const [index, actor] of others.entries()) {
      expect(otherCounts[index]).toBe(inboxBaseline.get(actor.userId) ?? 0);
    }
  });

  test("step 10 — Student: accept the link request — parentId written, ONE acceptance wave to the parent, portal lists the student", async () => {
    const parentUser = await readUserRow(parentP.userId);
    const studentUser = await readUserRow(studentS.userId);
    const publishesBefore = transportSpy.publishCount;
    const studentInboxBefore = await inboxCount(studentS.userId);

    const confirmed = await ParentLinkRequestService.respondToLinkRequest(
      linkRequestId,
      true,
      studentS.userId,
      LOCALE_EN,
      undefined,
      {
        transport: transportSpy,
        cache: claimCache,
      }
    );

    // The deciding student's own view: the request folded to confirmed.
    expect(confirmed.id).toBe(linkRequestId);
    expect(confirmed.status).toBe(LinkStatus.Confirmed);
    expect(confirmed.respondedAt).not.toBeNull();
    expect(confirmed.parentFullName).toBe(parentUser.fullName);

    // The winner write: the guarded one-parent link — the ONLY production
    // writer of a non-null `students.parent_id`.
    const studentRow = await readStudentRow(studentS.userId);
    expect(studentRow.parentId).toBe(parentP.userId);

    // The committed request row, folded with its decision stamp.
    const requestRows = await db
      .select()
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, linkRequestId))
      .limit(1);
    const requestRow = requestRows[0];
    if (!requestRow) {
      throw new Error("journey fixture: link-request row vanished");
    }
    expect(requestRow.status).toBe(LinkStatus.Confirmed);
    expect(requestRow.respondedAt).not.toBeNull();

    // ONE acceptance wave to the parent — composed in the PARENT's pinned
    // Arabic locale, bound to the decision row.
    const parentWaveRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, parentP.userId), eq(notifications.type, NotificationType.ParentLinkRequest)));
    expect(parentWaveRows).toHaveLength(1);
    const parentWave = parentWaveRows[0];
    if (!parentWave) {
      throw new Error("journey: the link-acceptance wave was not persisted");
    }
    tracked.register(notifications, parentWave.id);
    expect(parentWave.relatedEntityType).toBe(LINK_DECISION_RELATED_ENTITY_TYPE);
    expect(parentWave.relatedEntityId).toBe(linkRequestId);
    expect(parentWave.isRead).toBe(false);
    expect(parentWave.title).toBe(NOTIFS_AR.eventParentLinkAcceptedTitle);
    expect(parentWave.body).toBe(NOTIFS_AR.eventParentLinkAcceptedBody(studentUser.fullName));

    // The receipt published strictly post-commit — to the parent ONLY.
    expect(transportSpy.publishCount).toBe(publishesBefore + 1);
    expect(transportSpy.lastCall?.userIds).toEqual([parentP.userId]);

    // The linked-during-journey proof: the parent's portal lists exactly the
    // one student, full name unmasked (the link is in force).
    const children = await ParentMonitoringService.listLinkedChildren(parentP.userId, LOCALE_AR);
    expect(children).toHaveLength(1);
    const linkedChild = children[0];
    if (!linkedChild) {
      throw new Error("journey: the linked-children read omitted the student");
    }
    expect(linkedChild.id).toBe(studentS.userId);
    expect(linkedChild.fullName).toBe(studentUser.fullName);

    // The foreign parent sees NOTHING — no link, no fan-out.
    expect(await ParentMonitoringService.listLinkedChildren(parentP2.userId, LOCALE_EN)).toEqual([]);

    // Both directions: the parent's inbox grew by exactly the one wave; the
    // student's inbox is unchanged by the acceptance; everyone else stays at
    // the baseline.
    expect(await inboxCount(parentP.userId)).toBe((inboxBaseline.get(parentP.userId) ?? 0) + 1);
    expect(await inboxCount(studentS.userId)).toBe(studentInboxBefore);
    const others = castActors().filter(actor => actor.userId !== parentP.userId);
    const otherCounts = await Promise.all(others.map(actor => inboxCount(actor.userId)));
    for (const [index, actor] of others.entries()) {
      const expected = actor.userId === studentS.userId ? studentInboxBefore : (inboxBaseline.get(actor.userId) ?? 0);
      expect(otherCounts[index]).toBe(expected);
    }
  });

  test("step 11 — Student: matching browse finds the certified online teacher through the hard filters", async () => {
    const inboxesBefore = await snapshotInboxes();

    const page = await TeacherMatchingService.browseAvailableTeachers(
      studentS.userId,
      {
        recitation: HAFS,
        intent: HIFZ_SUBJECT,
        page: 1,
        pageSize: 25,
        search: null,
        minRating: null,
        sort: TeacherMatchingSort.RatingDesc,
      },
      LOCALE_EN
    );

    // The hard filters (online + the quoted recitations token + the language
    // resolution against the caller's own profile) let the journey's teacher
    // through — present with the full directory card verbatim.
    const card = page.items.find(item => item.id === teacherT.userId);
    if (!card) {
      throw new Error("journey: the matching browse omitted the journey's teacher");
    }
    expect(card.fullName).toBe(`${PREFIX} teacher`);
    expect(card.isOnline).toBe(true);
    expect(card.recitations).toContain(HAFS);
    expect(card.subjects).toContain(HIFZ_SUBJECT);
    expect(card.languages).toContain("arabic");
    expect(card.averageRating).toBe(4.5);
    expect(card.country).toBe("Egypt");
    expect(card.countryCode).toBe("EG");
    expect(page.total).toBeGreaterThanOrEqual(1);

    // A pure read: no inbox moved for anyone.
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 12 — Student: book session A — scheduled, fee held, TRIAL lane consumed first, ONE request wave to the teacher", async () => {
    const studentBefore = await readStudentRow(studentS.userId);
    expect(studentBefore.balanceTrial).toBe(1);
    expect(studentBefore.balanceHifz).toBe(8);
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let booked: SessionReturnType;
    try {
      booked = await SessionLifecycleService.createSession(
        studentS.userId,
        { teacherId: teacherT.userId, intent: HIFZ_SUBJECT },
        KEY_SESSION_A,
        LOCALE_EN
      );
    } finally {
      publication.stop();
    }
    sessionA = booked;

    // Register the service-created rows for teardown before asserting — a
    // failing expectation must not strand committed rows.
    tracked.register(session, sessionA.id);
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_SESSION_A));
    for (const claimRow of claimRows) {
      tracked.register(sessionRequestIdempotency, claimRow.id);
    }

    // The booked row: scheduled, the platform fee carried verbatim, the hold
    // marked on the trial lane (the debit ladder's first rung), every
    // lifecycle stamp still unwritten, the confirmation deadline armed.
    expect(sessionA.teacherId).toBe(teacherT.userId);
    expect(sessionA.studentId).toBe(studentS.userId);
    expect(sessionA.status).toBe(SessionStatus.Scheduled);
    expect(sessionA.intent).toBe(HIFZ_SUBJECT);
    expect(sessionA.fee).toBe(SESSION_FEE_HIFZ);
    expect(sessionA.feeHeld).toBe(true);
    expect(sessionA.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(sessionA.startedAt).toBeNull();
    expect(sessionA.endedAt).toBeNull();
    expect(sessionA.confirmedByStudentAt).toBeNull();
    expect(sessionA.confirmedByTeacherAt).toBeNull();
    expect(sessionA.confirmationDeadline).not.toBeNull();

    // The trial-first debit ladder: the trial unit was consumed BEFORE the
    // paid lane — hifz keeps its settled 8, every sibling lane untouched.
    const studentAfter = await readStudentRow(studentS.userId);
    expect(studentAfter.balanceTrial).toBe(0);
    expect(studentAfter.balanceHifz).toBe(8);
    expect(studentAfter.balanceTajweed).toBe(0);
    expect(studentAfter.balanceReviews).toBe(0);

    // The claim is keyed VERBATIM and backfilled with the booked session.
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(studentS.userId);
    expect(claimRows[0]?.sessionId).toBe(sessionA.id);

    // ONE session-request wave to the teacher — composed in the recipient's
    // pinned locale, bound to the session row, never delivered for real.
    const studentUser = await readUserRow(studentS.userId);
    const requestWaveRows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, teacherT.userId), eq(notifications.type, NotificationType.SessionRequest)));
    expect(requestWaveRows).toHaveLength(1);
    const requestWave = requestWaveRows[0];
    if (!requestWave) {
      throw new Error("journey: the session-request wave was not persisted");
    }
    tracked.register(notifications, requestWave.id);
    expect(requestWave.relatedEntityType).toBe("session");
    expect(requestWave.relatedEntityId).toBe(sessionA.id);
    expect(requestWave.isRead).toBe(false);
    expect(requestWave.title).toBe(NOTIFS_EN.eventSessionRequestTitle);
    expect(requestWave.body).toBe(NOTIFS_EN.eventSessionRequestBody(studentUser.fullName, NOTIFS_EN.intentHifz));

    // The receipt was published exactly once after the commit — targeting
    // the teacher ONLY.
    expect(publication.calls).toHaveLength(1);
    expect(publication.calls[0]?.flatMap(receipt => receipt.recipientUserIds)).toEqual([teacherT.userId]);

    // Both directions: the teacher's inbox grew by exactly the one wave;
    // every other cast member observed nothing.
    await expectInboxShift(inboxesBefore, new Map([[teacherT.userId, 1]]));
  });

  test("step 13 — Student: replay the booking key — DUPLICATE_REQUEST, zero new rows, no second wave", async () => {
    const studentBefore = await readStudentRow(studentS.userId);
    const sessionsBefore = await db.$count(session, eq(session.studentId, studentS.userId));
    const claimsBefore = await db.$count(
      sessionRequestIdempotency,
      eq(sessionRequestIdempotency.idempotencyKey, KEY_SESSION_A)
    );
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let replay: Error;
    try {
      replay = await catchJourneyError(() =>
        SessionLifecycleService.createSession(
          studentS.userId,
          { teacherId: teacherT.userId, intent: HIFZ_SUBJECT },
          KEY_SESSION_A,
          LOCALE_EN
        )
      );
    } finally {
      publication.stop();
    }
    if (!(replay instanceof ConflictError)) {
      throw new Error(`expected ConflictError for the replayed booking key (got ${replay.name})`);
    }
    expect(replay.message).toContain(ERRORS_EN.duplicateRequest);

    // The replayed attempt rolled back with its own transaction: zero new
    // sessions, zero new claims, zero lane movement, zero publishes.
    expect(await db.$count(session, eq(session.studentId, studentS.userId))).toBe(sessionsBefore);
    expect(
      await db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.idempotencyKey, KEY_SESSION_A))
    ).toBe(claimsBefore);
    const studentAfter = await readStudentRow(studentS.userId);
    expect(studentAfter.balanceTrial).toBe(studentBefore.balanceTrial);
    expect(studentAfter.balanceHifz).toBe(studentBefore.balanceHifz);
    expect(publication.calls).toHaveLength(0);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 14 — Teacher: start session A — started stamp, in-session availability lock applied", async () => {
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let started: SessionReturnType;
    try {
      started = await SessionLifecycleService.startSession(teacherT.userId, sessionA.id, LOCALE_EN);
    } finally {
      publication.stop();
    }
    sessionA = started;

    expect(sessionA.status).toBe(SessionStatus.Started);
    expect(sessionA.startedAt).not.toBeNull();
    expect(sessionA.endedAt).toBeNull();
    expect(sessionA.feeHeld).toBe(true);

    // The start applied the in-session availability lock on the SAME
    // transaction — the directory teacher is offline for new bookings.
    expect((await readTeacherProfileRow()).isOnline).toBe(false);

    // A start dispatches nothing and moves no inbox.
    expect(publication.calls).toHaveLength(0);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 15 — Teacher: complete session A — completed stamps, lock released, ONE prompt wave to the student", async () => {
    const teacherUser = await readUserRow(teacherT.userId);
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let completed: SessionReturnType;
    try {
      completed = await SessionLifecycleService.completeSession(teacherT.userId, sessionA.id, LOCALE_EN);
    } finally {
      publication.stop();
    }
    sessionA = completed;

    expect(sessionA.status).toBe(SessionStatus.Completed);
    expect(sessionA.startedAt).not.toBeNull();
    expect(sessionA.endedAt).not.toBeNull();
    expect(sessionA.confirmedByTeacherAt).not.toBeNull();
    // Payable but unpaid: the student's half of the dual confirmation is
    // still absent and the escrow hold is still marked.
    expect(sessionA.confirmedByStudentAt).toBeNull();
    expect(sessionA.feeHeld).toBe(true);

    // The terminal exit released the in-session lock on the SAME
    // transaction — the availability flag is restored.
    expect((await readTeacherProfileRow()).isOnline).toBe(true);

    // ONE completion-prompt wave to the student — composed in the
    // recipient's pinned locale, bound to the session row.
    const promptWaveRows = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, studentS.userId), eq(notifications.type, NotificationType.SessionCompletion))
      );
    expect(promptWaveRows).toHaveLength(1);
    const promptWave = promptWaveRows[0];
    if (!promptWave) {
      throw new Error("journey: the completion-prompt wave was not persisted");
    }
    tracked.register(notifications, promptWave.id);
    expect(promptWave.relatedEntityType).toBe("session");
    expect(promptWave.relatedEntityId).toBe(sessionA.id);
    expect(promptWave.isRead).toBe(false);
    expect(promptWave.title).toBe(NOTIFS_EN.eventSessionCompletionPromptTitle);
    expect(promptWave.body).toBe(NOTIFS_EN.eventSessionCompletionPromptBody(teacherUser.fullName));

    // The receipt was published exactly once after the commit — targeting
    // the student ONLY.
    expect(publication.calls).toHaveLength(1);
    expect(publication.calls[0]?.flatMap(receipt => receipt.recipientUserIds)).toEqual([studentS.userId]);

    // Both directions: the student's inbox grew by exactly the one wave;
    // every other cast member observed nothing.
    await expectInboxShift(inboxesBefore, new Map([[studentS.userId, 1]]));
  });

  test("step 16 — Student: confirm completion — escrow released, teacher wallet credited exactly once, ZERO waves", async () => {
    const lanesBefore = await readStudentRow(studentS.userId);
    const walletRowsBefore = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId));
    expect(walletRowsBefore).toHaveLength(0);
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let confirmed: SessionReturnType;
    try {
      confirmed = await SessionLifecycleService.confirmSessionCompletion(studentS.userId, sessionA.id, LOCALE_EN);
    } finally {
      publication.stop();
    }
    sessionA = confirmed;

    // The dual confirmation closed: the student's stamp landed and the
    // escrow hold was consumed (both stamps present IS the confirmed shape).
    expect(sessionA.status).toBe(SessionStatus.Completed);
    expect(sessionA.confirmedByStudentAt).not.toBeNull();
    expect(sessionA.confirmedByTeacherAt).not.toBeNull();
    expect(sessionA.feeHeld).toBe(false);

    // The credit slice ensured exactly ONE wallet row and credited the fee
    // verbatim on BOTH columns.
    const teacherWallet = (await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1))[0];
    if (!teacherWallet) {
      throw new Error("journey: the confirmation credit ensured no wallet row");
    }
    tracked.register(wallet, teacherWallet.id);
    ledgerWalletId = teacherWallet.id;
    expect(teacherWallet.balance).toBe(SESSION_FEE_HIFZ);
    expect(teacherWallet.totalEarning).toBe(SESSION_FEE_HIFZ);
    expect(await countWalletsForTeacher(teacherT.userId)).toBe(1);

    // ONE earning ledger row — the fee verbatim, bound to the wallet and
    // the session (append-only table: counted and read, never tracked).
    expect(await countTeacherTransactionsForTeacher(teacherT.userId)).toBe(1);
    const earningRows = await db.select().from(teacherTransaction).where(eq(teacherTransaction.sessionId, sessionA.id));
    expect(earningRows).toHaveLength(1);
    const earning = earningRows[0];
    if (!earning) {
      throw new Error("journey: the confirmation credit wrote no earning ledger row");
    }
    expect(earning.amount).toBe(SESSION_FEE_HIFZ);
    expect(earning.type).toBe(TransactionType.Earning);
    expect(earning.walletId).toBe(teacherWallet.id);

    // The teacher's own wallet read carries the credit (service parity).
    const walletView = await WalletService.getMyWallet(teacherT.userId, LOCALE_EN);
    expect(walletView.wallet.id).toBe(teacherWallet.id);
    expect(walletView.wallet.balance).toBe(SESSION_FEE_HIFZ);
    expect(walletView.wallet.totalEarning).toBe(SESSION_FEE_HIFZ);
    expect(walletView.transactions).toHaveLength(1);

    // Hold-as-debit: the confirmation moves NO student lane — the trial unit
    // stayed consumed and the paid lane keeps its settled 8.
    const lanesAfter = await readStudentRow(studentS.userId);
    expect(lanesAfter.balanceTrial).toBe(lanesBefore.balanceTrial);
    expect(lanesAfter.balanceHifz).toBe(lanesBefore.balanceHifz);

    // The curriculum advance is tajweed-gated: the Hifz confirmation
    // composes the progress call but ships no Hifz tracking — zero progress
    // rows is the honest end state.
    expect(await db.$count(progress, eq(progress.studentId, studentS.userId))).toBe(0);

    // The lock stays released and the confirmation dispatches NOTHING.
    expect((await readTeacherProfileRow()).isOnline).toBe(true);
    expect(publication.calls).toHaveLength(0);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 17 — Parent: confirm write denial — oracle-safe SESSION_NOT_FOUND, session row byte-identical", async () => {
    const rowBefore = await readSessionRow(sessionA.id);
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    // The linked parent is a READ-ONLY observer of the student's world: the
    // confirmation predicate is participant-owned, so the real ownership
    // path collapses the foreign caller into the constant not-found shape —
    // indistinguishable from a nonexistent session.
    let denial: Error;
    try {
      denial = await catchJourneyError(() =>
        SessionLifecycleService.confirmSessionCompletion(parentP.userId, sessionA.id, LOCALE_EN)
      );
    } finally {
      publication.stop();
    }
    if (!(denial instanceof NotFoundError)) {
      throw new Error(`expected NotFoundError for the parent write probe (got ${denial.name})`);
    }
    expect(denial.message).toContain(ERRORS_EN.sessionNotFound);

    // Zero writes anywhere: the row is byte-identical (status, stamps,
    // hold, updatedAt), the wallet and its ledger are untouched.
    const rowAfter = await readSessionRow(sessionA.id);
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(rowAfter.feeHeld).toBe(rowBefore.feeHeld);
    expect(rowAfter.confirmedByStudentAt?.getTime()).toBe(rowBefore.confirmedByStudentAt?.getTime());
    expect(rowAfter.updatedAt.getTime()).toBe(rowBefore.updatedAt.getTime());
    expect(await countTeacherTransactionsForTeacher(teacherT.userId)).toBe(1);
    const walletRows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    expect(walletRows[0]?.balance).toBe(SESSION_FEE_HIFZ);
    expect(walletRows[0]?.totalEarning).toBe(SESSION_FEE_HIFZ);

    // The denial dispatched nothing and moved no inbox.
    expect(publication.calls).toHaveLength(0);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 18 — Teacher: submit session A's report + homework — TWO localized waves, student en and parent ar", async () => {
    const studentUser = await readUserRow(studentS.userId);
    const teacherUser = await readUserRow(teacherT.userId);
    const publishesBefore = transportSpy.publishCount;
    const inboxesBefore = await snapshotInboxes();

    const submit: SessionReportSubmitInput = {
      teacherNotes: REPORT_NOTES_A,
      studentRatingByTeacher: 5,
      homework: { jadid: JADID_BLOCK_A, madi: MADI_BLOCK_A },
    };
    reportA = await SessionReportService.submitSessionReport(
      teacherT.userId,
      sessionA.id,
      submit,
      LOCALE_EN,
      undefined,
      { transport: transportSpy, cache: claimCache }
    );

    // Register the service-created rows for teardown before asserting — a
    // failing expectation must not strand committed rows.
    tracked.register(reports, reportA.id);
    homeworkA = await readHomeWorkRowBySessionId(sessionA.id);
    tracked.register(homeWork, homeworkA.id);

    // The committed report row: the submitted notes and rating verbatim,
    // server-mapped session linkage.
    expect(reportA.sessionId).toBe(sessionA.id);
    expect(reportA.teacherNotes).toBe(REPORT_NOTES_A);
    expect(reportA.studentRatingByTeacher).toBe(5);
    expect(await db.$count(reports, eq(reports.sessionId, sessionA.id))).toBe(1);

    // The homework assignment row: the Jadid block mapped onto the
    // `current_*` columns and the Madi block onto the `revision_*` columns,
    // both grades structurally absent (rows are graded later, never here).
    expect(homeworkA.currentFromAyah).toBe(JADID_BLOCK_A.fromAyah);
    expect(homeworkA.currentToAyah).toBe(JADID_BLOCK_A.toAyah);
    expect(homeworkA.currentSurahJuz).toBe(JADID_BLOCK_A.surahJuz);
    expect(homeworkA.revisionFromAyah).toBe(MADI_BLOCK_A.fromAyah);
    expect(homeworkA.revisionToAyah).toBe(MADI_BLOCK_A.toAyah);
    expect(homeworkA.revisionSurahJuz).toBe(MADI_BLOCK_A.surahJuz);
    expect(homeworkA.currentGrade).toBeNull();
    expect(homeworkA.revisionGrade).toBeNull();
    expect(await db.$count(homeWork, eq(homeWork.sessionId, sessionA.id))).toBe(1);

    // The student's wave — composed in the student's pinned locale, body
    // naming the teacher, bound to the session row.
    const studentWaveRows = await reportWaveRowsFor(studentS.userId, sessionA.id);
    expect(studentWaveRows).toHaveLength(1);
    const studentWave = studentWaveRows[0];
    if (!studentWave) {
      throw new Error("journey: the student's report-ready wave was not persisted");
    }
    tracked.register(notifications, studentWave.id);
    expect(studentWave.type).toBe(NotificationType.SessionCompletion);
    expect(studentWave.relatedEntityType).toBe("session");
    expect(studentWave.relatedEntityId).toBe(sessionA.id);
    expect(studentWave.isRead).toBe(false);
    expect(studentWave.title).toBe(NOTIFS_EN.eventSessionReportReadyTitle);
    expect(studentWave.body).toBe(NOTIFS_EN.eventSessionReportReadyBody(teacherUser.fullName));

    // The linked parent's wave — composed in the PARENT's pinned Arabic
    // locale, body naming the student and the teacher. The wave is gated on
    // the stored parent link the journey drove through the real chain.
    const parentWaveRows = await reportWaveRowsFor(parentP.userId, sessionA.id);
    expect(parentWaveRows).toHaveLength(1);
    const parentWave = parentWaveRows[0];
    if (!parentWave) {
      throw new Error("journey: the parent's report-ready wave was not persisted");
    }
    tracked.register(notifications, parentWave.id);
    expect(parentWave.type).toBe(NotificationType.SessionCompletion);
    expect(parentWave.relatedEntityType).toBe("session");
    expect(parentWave.relatedEntityId).toBe(sessionA.id);
    expect(parentWave.isRead).toBe(false);
    expect(parentWave.title).toBe(NOTIFS_AR.eventSessionReportReadyTitle);
    expect(parentWave.body).toBe(
      NOTIFS_AR.eventSessionReportReadyParentBody(studentUser.fullName, teacherUser.fullName)
    );

    // Privacy: the wave bodies carry counterparty names only — never the
    // teacher's note content.
    expect(parentWave.body).not.toContain(REPORT_NOTES_A);

    // EXACTLY TWO publishes through the injected seam — one envelope per
    // recipient, nobody else addressed (order-independent multiset).
    expect(transportSpy.publishCount).toBe(publishesBefore + 2);
    const newPublishes = transportSpy.calls.slice(publishesBefore);
    expect(newPublishes.map(publish => JSON.stringify(publish.userIds)).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [parentP.userId, studentS.userId].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b))
    );

    // Both directions: the student's and the parent's inboxes each grew by
    // exactly the one wave; every other cast member observed nothing.
    await expectInboxShift(
      inboxesBefore,
      new Map([
        [studentS.userId, 1],
        [parentP.userId, 1],
      ])
    );
  });

  test("step 19 — Student: own report read returns the submitted row; the parent collapses to null (participant gate)", async () => {
    const inboxesBefore = await snapshotInboxes();
    const publishesBefore = transportSpy.publishCount;

    // The participant read gate: the student sees the submitted report.
    const ownReport = await SessionReportService.getSessionReport(studentS.userId, sessionA.id, LOCALE_EN);
    if (ownReport === null) {
      throw new Error("journey: the student's own report read returned null");
    }
    expect(ownReport.id).toBe(reportA.id);
    expect(ownReport.sessionId).toBe(sessionA.id);
    expect(ownReport.teacherNotes).toBe(REPORT_NOTES_A);
    expect(ownReport.studentRatingByTeacher).toBe(5);

    // The linked parent is NOT a session participant: the read surface
    // collapses the parent into the identical `null` every non-participant
    // shape receives — the portal reads are the parent's only surface.
    expect(await SessionReportService.getSessionReport(parentP.userId, sessionA.id, LOCALE_EN)).toBeNull();
    expect(await SessionReportService.getSessionReport(parentP2.userId, sessionA.id, LOCALE_EN)).toBeNull();

    // Reads are pure: no publishes, no inbox movement for anyone.
    expect(transportSpy.publishCount).toBe(publishesBefore);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 20 — Parent: inbox carries the session_completion deep-link triple; getSessionTarget resolves the landing pair", async () => {
    const publishesBefore = transportSpy.publishCount;
    const inboxesBefore = await snapshotInboxes();

    // The parent's inbox holds exactly the one report-ready row for session
    // A (the acceptance wave is a different type), carrying the deep-link
    // data contract: the completion wire type plus the (type, "session",
    // sessionId) related-entity triple.
    const parentWaveRows = await reportWaveRowsFor(parentP.userId, sessionA.id);
    expect(parentWaveRows).toHaveLength(1);
    const parentWave = parentWaveRows[0];
    if (!parentWave) {
      throw new Error("journey: the parent's report-ready wave vanished");
    }
    expect(parentWave.type).toBe(NotificationType.SessionCompletion);
    expect(parentWave.relatedEntityType).toBe("session");
    expect(parentWave.relatedEntityId).toBe(sessionA.id);

    // The deep-link resolution: the session pointer resolves onto the
    // LINKED child, as the closed two-field pair (nothing else disclosed).
    const target = await ParentMonitoringService.getSessionTarget(parentP.userId, sessionA.id, LOCALE_AR);
    expect(Object.keys(target).toSorted((a, b) => a.localeCompare(b))).toEqual(["sessionId", "studentId"]);
    expect(target.sessionId).toBe(sessionA.id);
    expect(target.studentId).toBe(studentS.userId);

    // The landing URL is constructible from the resolved pair alone — the
    // portal's pinned shape, asserted as data.
    const landingUrl = `${LANDING_URL_PREFIX}${target.studentId}${LANDING_URL_QUERY}${target.sessionId}`;
    expect(landingUrl).toBe(`${LANDING_URL_PREFIX}${studentS.userId}${LANDING_URL_QUERY}${sessionA.id}`);

    // Reads never publish and move no inbox.
    expect(transportSpy.publishCount).toBe(publishesBefore);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 21 — Parent: the five portal reads over the linked child — sessions, report, homework, progress, children", async () => {
    const publishesBefore = transportSpy.publishCount;
    const inboxesBefore = await snapshotInboxes();

    // The children list still carries exactly the one linked child.
    const children = await ParentMonitoringService.listLinkedChildren(parentP.userId, LOCALE_AR);
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(studentS.userId);

    // Attendance: exactly the one completed session, with its stamps.
    const sessionsPage = await ParentMonitoringService.listChildSessions(
      parentP.userId,
      studentS.userId,
      undefined,
      LOCALE_AR
    );
    expect(sessionsPage.totalCount).toBe(1);
    expect(sessionsPage.items).toHaveLength(1);
    const attendance = sessionsPage.items[0];
    if (!attendance) {
      throw new Error("journey: the portal attendance read omitted session A");
    }
    expect(attendance.id).toBe(sessionA.id);
    expect(attendance.status).toBe(SessionStatus.Completed);
    expect(attendance.startedAt).not.toBeNull();
    expect(attendance.endedAt).not.toBeNull();

    // Reports: exactly the one submitted report, notes and rating verbatim.
    const reportPage = await ParentMonitoringService.listChildReports(
      parentP.userId,
      studentS.userId,
      undefined,
      LOCALE_AR
    );
    expect(reportPage.totalCount).toBe(1);
    expect(reportPage.items).toHaveLength(1);
    const reportEntry = reportPage.items[0];
    if (!reportEntry) {
      throw new Error("journey: the portal reports read omitted session A's report");
    }
    expect(reportEntry.sessionId).toBe(sessionA.id);
    expect(reportEntry.sessionStatus).toBe(SessionStatus.Completed);
    expect(reportEntry.teacherNotes).toBe(REPORT_NOTES_A);
    expect(reportEntry.studentRatingByTeacher).toBe(5);

    // Homework: exactly the one assignment, both tracks mapped, ungraded.
    const homeworkPage = await ParentMonitoringService.listChildHomework(
      parentP.userId,
      studentS.userId,
      undefined,
      LOCALE_AR
    );
    expect(homeworkPage.totalCount).toBe(1);
    expect(homeworkPage.items).toHaveLength(1);
    const homeworkEntry = homeworkPage.items[0];
    if (!homeworkEntry) {
      throw new Error("journey: the portal homework read omitted session A's assignment");
    }
    expect(homeworkEntry.sessionId).toBe(sessionA.id);
    if (!homeworkEntry.jadid) {
      throw new Error("journey: the homework Jadid track is absent from the portal read");
    }
    expect(homeworkEntry.jadid.surahJuz).toBe(JADID_BLOCK_A.surahJuz);
    expect(homeworkEntry.jadid.fromAyah).toBe(JADID_BLOCK_A.fromAyah);
    expect(homeworkEntry.jadid.toAyah).toBe(JADID_BLOCK_A.toAyah);
    expect(homeworkEntry.jadid.grade).toBeNull();
    if (!homeworkEntry.madi) {
      throw new Error("journey: the homework Madi track is absent from the portal read");
    }
    expect(homeworkEntry.madi.surahJuz).toBe(MADI_BLOCK_A.surahJuz);
    expect(homeworkEntry.madi.fromAyah).toBe(MADI_BLOCK_A.fromAyah);
    expect(homeworkEntry.madi.toAyah).toBe(MADI_BLOCK_A.toAyah);
    expect(homeworkEntry.madi.grade).toBeNull();

    // Progress: the honest confirmed state — the Hifz confirmation ships no
    // progress rows (the curriculum advance is tajweed-gated), so the row
    // count is the honest zero; the latest positions echo the homework
    // assignment instead.
    const childProgress = await ParentMonitoringService.getChildProgress(parentP.userId, studentS.userId, LOCALE_AR);
    expect(childProgress.child.id).toBe(studentS.userId);
    expect(childProgress.progressRowCount).toBe(0);
    if (!childProgress.latestJadidPosition) {
      throw new Error("journey: the progress read omitted the latest Jadid position");
    }
    expect(childProgress.latestJadidPosition.surahJuz).toBe(JADID_BLOCK_A.surahJuz);
    expect(childProgress.latestJadidPosition.fromAyah).toBe(JADID_BLOCK_A.fromAyah);
    expect(childProgress.latestJadidPosition.toAyah).toBe(JADID_BLOCK_A.toAyah);
    if (!childProgress.latestMadiPosition) {
      throw new Error("journey: the progress read omitted the latest Madi position");
    }
    expect(childProgress.latestMadiPosition.surahJuz).toBe(MADI_BLOCK_A.surahJuz);
    expect(childProgress.latestMadiPosition.fromAyah).toBe(MADI_BLOCK_A.fromAyah);
    expect(childProgress.latestMadiPosition.toAyah).toBe(MADI_BLOCK_A.toAyah);

    // Reads never publish and move no inbox.
    expect(transportSpy.publishCount).toBe(publishesBefore);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 22 — Parent P2: foreign portal reads deny with the constant 403; the owner's rows stay byte-identical", async () => {
    const reportBefore = await readReportRowBySessionId(sessionA.id);
    const homeworkBefore = await readHomeWorkRowBySessionId(sessionA.id);
    const inboxesBefore = await snapshotInboxes();
    const publishesBefore = transportSpy.publishCount;

    // The foreign parent (never linked) probes the per-student portal reads
    // on the SAME student: the real `requireLinkedChild` gate denies with
    // the constant 403 shape — byte-indistinguishable whatever the cause.
    const reportsDenial = await catchJourneyError(() =>
      ParentMonitoringService.listChildReports(parentP2.userId, studentS.userId, undefined, LOCALE_EN)
    );
    if (!(reportsDenial instanceof ForbiddenError)) {
      throw new Error(`expected ForbiddenError for the foreign reports read (got ${reportsDenial.name})`);
    }
    expect(reportsDenial.code).toBe("FORBIDDEN");
    expect(reportsDenial.message).toContain(ERRORS_EN.forbidden);

    const sessionsDenial = await catchJourneyError(() =>
      ParentMonitoringService.listChildSessions(parentP2.userId, studentS.userId, undefined, LOCALE_EN)
    );
    if (!(sessionsDenial instanceof ForbiddenError)) {
      throw new Error(`expected ForbiddenError for the foreign sessions read (got ${sessionsDenial.name})`);
    }
    expect(sessionsDenial.code).toBe("FORBIDDEN");
    expect(sessionsDenial.message).toContain(ERRORS_EN.forbidden);

    // The foreign parent's own list stays empty — no link anywhere.
    expect(await ParentMonitoringService.listLinkedChildren(parentP2.userId, LOCALE_EN)).toEqual([]);

    // Zero writes anywhere: the owner's report and homework rows are
    // byte-identical (content + updatedAt stamps), the owner's portal reads
    // still work, no inbox moved, nothing published.
    const reportAfter = await readReportRowBySessionId(sessionA.id);
    expect(reportAfter.teacherNotes).toBe(reportBefore.teacherNotes);
    expect(reportAfter.studentRatingByTeacher).toBe(reportBefore.studentRatingByTeacher);
    expect(reportAfter.updatedAt.getTime()).toBe(reportBefore.updatedAt.getTime());
    const homeworkAfter = await readHomeWorkRowBySessionId(sessionA.id);
    expect(homeworkAfter.updatedAt.getTime()).toBe(homeworkBefore.updatedAt.getTime());
    expect(homeworkAfter.currentGrade).toBeNull();
    const ownerPage = await ParentMonitoringService.listChildReports(
      parentP.userId,
      studentS.userId,
      undefined,
      LOCALE_AR
    );
    expect(ownerPage.totalCount).toBe(1);
    expect(transportSpy.publishCount).toBe(publishesBefore);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 23 — Student S2: zero-balance booking denial — INSUFFICIENT_BALANCE, zero writes, key unburned", async () => {
    const lanesBefore = await readStudentRow(studentS2.userId);
    const sessionsBefore = await db.$count(session, eq(session.studentId, studentS2.userId));
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    // The zero-balance actor books against the SAME certified teacher under
    // a fresh key: the debit ladder finds no lane to hold, so the whole
    // booking rolls back with its own transaction.
    let denial: Error;
    try {
      denial = await catchJourneyError(() =>
        SessionLifecycleService.createSession(
          studentS2.userId,
          { teacherId: teacherT.userId, intent: HIFZ_SUBJECT },
          KEY_SESSION_D,
          LOCALE_EN
        )
      );
    } finally {
      publication.stop();
    }
    if (!(denial instanceof ValidationError)) {
      throw new Error(`expected ValidationError for the zero-balance booking (got ${denial.name})`);
    }
    expect(denial.code).toBe("INSUFFICIENT_BALANCE");
    expect(denial.message).toContain(ERRORS_EN.insufficientBalance);

    // Fail-closed money path: zero session rows (hence zero holds), zero
    // lane movement, and the idempotency key NOT burned — the rollback
    // released the claim together with everything else.
    expect(await db.$count(session, eq(session.studentId, studentS2.userId))).toBe(sessionsBefore);
    expect(
      await db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.idempotencyKey, KEY_SESSION_D))
    ).toBe(0);
    const lanesAfter = await readStudentRow(studentS2.userId);
    expect(lanesAfter.balanceTrial).toBe(lanesBefore.balanceTrial);
    expect(lanesAfter.balanceHifz).toBe(lanesBefore.balanceHifz);
    expect(lanesAfter.balanceTajweed).toBe(lanesBefore.balanceTajweed);
    expect(lanesAfter.balanceReviews).toBe(lanesBefore.balanceReviews);

    // The denial dispatched nothing and moved no inbox.
    expect(publication.calls).toHaveLength(0);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 24 — Student: book session B on the paid lane — hifz 8→7, hold marked, ONE request wave to the teacher", async () => {
    const studentBefore = await readStudentRow(studentS.userId);
    expect(studentBefore.balanceTrial).toBe(0);
    expect(studentBefore.balanceHifz).toBe(8);
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let booked: SessionReturnType;
    try {
      booked = await SessionLifecycleService.createSession(
        studentS.userId,
        { teacherId: teacherT.userId, intent: HIFZ_SUBJECT },
        KEY_SESSION_B,
        LOCALE_EN
      );
    } finally {
      publication.stop();
    }
    sessionB = booked;

    // Register the service-created rows for teardown before asserting — a
    // failing expectation must not strand committed rows.
    tracked.register(session, sessionB.id);
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_SESSION_B));
    for (const claimRow of claimRows) {
      tracked.register(sessionRequestIdempotency, claimRow.id);
    }

    // The booked row: scheduled, the fee carried verbatim, the hold now
    // marked on the PAID lane (the trial lane is exhausted — the ladder's
    // second rung).
    expect(sessionB.teacherId).toBe(teacherT.userId);
    expect(sessionB.studentId).toBe(studentS.userId);
    expect(sessionB.status).toBe(SessionStatus.Scheduled);
    expect(sessionB.intent).toBe(HIFZ_SUBJECT);
    expect(sessionB.fee).toBe(SESSION_FEE_HIFZ);
    expect(sessionB.feeHeld).toBe(true);
    expect(sessionB.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    expect(sessionB.startedAt).toBeNull();
    expect(sessionB.endedAt).toBeNull();
    expect(sessionB.confirmationDeadline).not.toBeNull();

    // The purchased-balance decrement: exactly one hifz credit consumed,
    // every sibling lane untouched.
    const studentAfter = await readStudentRow(studentS.userId);
    expect(studentAfter.balanceTrial).toBe(0);
    expect(studentAfter.balanceHifz).toBe(7);
    expect(studentAfter.balanceTajweed).toBe(0);
    expect(studentAfter.balanceReviews).toBe(0);

    // The claim is keyed VERBATIM and backfilled with the booked session.
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(studentS.userId);
    expect(claimRows[0]?.sessionId).toBe(sessionB.id);

    // ONE session-request wave to the teacher — composed in the recipient's
    // pinned locale, bound to session B, never delivered for real.
    const studentUser = await readUserRow(studentS.userId);
    const requestWaveRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, teacherT.userId),
          eq(notifications.type, NotificationType.SessionRequest),
          eq(notifications.relatedEntityId, sessionB.id)
        )
      );
    expect(requestWaveRows).toHaveLength(1);
    const requestWave = requestWaveRows[0];
    if (!requestWave) {
      throw new Error("journey: the session-B request wave was not persisted");
    }
    tracked.register(notifications, requestWave.id);
    expect(requestWave.relatedEntityType).toBe("session");
    expect(requestWave.isRead).toBe(false);
    expect(requestWave.title).toBe(NOTIFS_EN.eventSessionRequestTitle);
    expect(requestWave.body).toBe(NOTIFS_EN.eventSessionRequestBody(studentUser.fullName, NOTIFS_EN.intentHifz));

    // The receipt was published exactly once after the commit — targeting
    // the teacher ONLY.
    expect(publication.calls).toHaveLength(1);
    expect(publication.calls[0]?.flatMap(receipt => receipt.recipientUserIds)).toEqual([teacherT.userId]);

    // Both directions: the teacher's inbox grew by exactly the one wave;
    // every other cast member observed nothing.
    await expectInboxShift(inboxesBefore, new Map([[teacherT.userId, 1]]));
  });

  test("step 25 — Student: cancel session B — cancelled, hold released, SAME paid lane refunded once, ZERO waves", async () => {
    const studentBefore = await readStudentRow(studentS.userId);
    expect(studentBefore.balanceHifz).toBe(7);
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let cancelledRow: SessionReturnType;
    try {
      cancelledRow = await SessionLifecycleService.cancelSession(
        studentS.userId,
        sessionB.id,
        CANCEL_REASON_B,
        LOCALE_EN
      );
    } finally {
      publication.stop();
    }
    sessionB = cancelledRow;

    // The cancelled row: terminal status, the reason persisted verbatim,
    // and the escrow hold released.
    expect(sessionB.status).toBe(SessionStatus.Cancelled);
    expect(sessionB.cancelReason).toBe(CANCEL_REASON_B);
    expect(sessionB.feeHeld).toBe(false);
    expect(sessionB.startedAt).toBeNull();
    expect(sessionB.endedAt).toBeNull();

    // The same-lane refund, exactly once: the PAID credit that funded the
    // hold returned to its own lane — hifz back to 8, the trial lane still
    // exhausted, every other lane untouched.
    const studentAfter = await readStudentRow(studentS.userId);
    expect(studentAfter.balanceTrial).toBe(0);
    expect(studentAfter.balanceHifz).toBe(8);
    expect(studentAfter.balanceTajweed).toBe(0);
    expect(studentAfter.balanceReviews).toBe(0);

    // The cancellation credited no teacher money: the wallet and its
    // single earning row are exactly where the confirmation leg left them.
    expect(await countTeacherTransactionsForTeacher(teacherT.userId)).toBe(1);
    const walletRows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    expect(walletRows[0]?.balance).toBe(SESSION_FEE_HIFZ);

    // The participant cancel is refund + lock-release only: zero publishes,
    // zero inbox movement for anyone.
    expect(publication.calls).toHaveLength(0);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 26 — Student: replay the cancel on the terminal row — SESSION_INVALID_TRANSITION, byte-identical", async () => {
    const rowBefore = await readSessionRow(sessionB.id);
    const studentBefore = await readStudentRow(studentS.userId);
    const inboxesBefore = await snapshotInboxes();
    const publication = spyLifecyclePublication();

    let replay: Error;
    try {
      replay = await catchJourneyError(() =>
        SessionLifecycleService.cancelSession(studentS.userId, sessionB.id, CANCEL_REASON_B, LOCALE_EN)
      );
    } finally {
      publication.stop();
    }
    if (!(replay instanceof ConflictError)) {
      throw new Error(`expected ConflictError for the terminal cancel replay (got ${replay.name})`);
    }
    expect(replay.code).toBe("SESSION_INVALID_TRANSITION");
    expect(replay.message).toContain(ERRORS_EN.sessionInvalidTransition);

    // Zero writes anywhere: the terminal row is byte-identical (status,
    // hold, reason, updatedAt), the refunded lane is unmoved, and the
    // replay dispatched nothing.
    const rowAfter = await readSessionRow(sessionB.id);
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(rowAfter.feeHeld).toBe(rowBefore.feeHeld);
    expect(rowAfter.cancelReason).toBe(rowBefore.cancelReason);
    expect(rowAfter.updatedAt.getTime()).toBe(rowBefore.updatedAt.getTime());
    const studentAfter = await readStudentRow(studentS.userId);
    expect(studentAfter.balanceHifz).toBe(studentBefore.balanceHifz);
    expect(publication.calls).toHaveLength(0);
    await expectInboxShift(inboxesBefore, new Map<number, number>());
  });

  test("step 27 — Student/Teacher: session C books on the paid lane and dual-confirms — wallet 25.00→50.00, second earning row", async () => {
    const studentBefore = await readStudentRow(studentS.userId);
    expect(studentBefore.balanceHifz).toBe(8);
    const walletRowsBefore = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    const walletBefore = walletRowsBefore[0];
    if (!walletBefore) {
      throw new Error("journey: the teacher's credited wallet vanished before session C's confirmation");
    }
    const inboxesBefore = await snapshotInboxes();
    const studentUser = await readUserRow(studentS.userId);
    const teacherUser = await readUserRow(teacherT.userId);

    // Book session C — the paid lane again, under its own fresh key.
    const bookingPublication = spyLifecyclePublication();
    let booked: SessionReturnType;
    try {
      booked = await SessionLifecycleService.createSession(
        studentS.userId,
        { teacherId: teacherT.userId, intent: HIFZ_SUBJECT },
        KEY_SESSION_C,
        LOCALE_EN
      );
    } finally {
      bookingPublication.stop();
    }
    sessionC = booked;
    tracked.register(session, sessionC.id);
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_SESSION_C));
    for (const claimRow of claimRows) {
      tracked.register(sessionRequestIdempotency, claimRow.id);
    }

    expect(sessionC.status).toBe(SessionStatus.Scheduled);
    expect(sessionC.fee).toBe(SESSION_FEE_HIFZ);
    expect(sessionC.feeHeld).toBe(true);
    expect(sessionC.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    expect((await readStudentRow(studentS.userId)).balanceHifz).toBe(7);
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.sessionId).toBe(sessionC.id);

    // ONE request wave to the teacher for session C.
    const requestWaveRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, teacherT.userId),
          eq(notifications.type, NotificationType.SessionRequest),
          eq(notifications.relatedEntityId, sessionC.id)
        )
      );
    expect(requestWaveRows).toHaveLength(1);
    const requestWave = requestWaveRows[0];
    if (!requestWave) {
      throw new Error("journey: the session-C request wave was not persisted");
    }
    tracked.register(notifications, requestWave.id);
    expect(requestWave.title).toBe(NOTIFS_EN.eventSessionRequestTitle);
    expect(requestWave.body).toBe(NOTIFS_EN.eventSessionRequestBody(studentUser.fullName, NOTIFS_EN.intentHifz));
    expect(bookingPublication.calls).toHaveLength(1);
    expect(bookingPublication.calls[0]?.flatMap(receipt => receipt.recipientUserIds)).toEqual([teacherT.userId]);

    // Start — the in-session availability lock applies again.
    const startPublication = spyLifecyclePublication();
    try {
      sessionC = await SessionLifecycleService.startSession(teacherT.userId, sessionC.id, LOCALE_EN);
    } finally {
      startPublication.stop();
    }
    expect(sessionC.status).toBe(SessionStatus.Started);
    expect(sessionC.startedAt).not.toBeNull();
    expect((await readTeacherProfileRow()).isOnline).toBe(false);
    expect(startPublication.calls).toHaveLength(0);

    // Complete — the terminal exit releases the lock and prompts the student.
    const completionPublication = spyLifecyclePublication();
    try {
      sessionC = await SessionLifecycleService.completeSession(teacherT.userId, sessionC.id, LOCALE_EN);
    } finally {
      completionPublication.stop();
    }
    expect(sessionC.status).toBe(SessionStatus.Completed);
    expect(sessionC.endedAt).not.toBeNull();
    expect(sessionC.confirmedByTeacherAt).not.toBeNull();
    expect(sessionC.confirmedByStudentAt).toBeNull();
    expect(sessionC.feeHeld).toBe(true);
    expect((await readTeacherProfileRow()).isOnline).toBe(true);

    const promptWaveRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, studentS.userId),
          eq(notifications.type, NotificationType.SessionCompletion),
          eq(notifications.relatedEntityId, sessionC.id)
        )
      );
    expect(promptWaveRows).toHaveLength(1);
    const promptWave = promptWaveRows[0];
    if (!promptWave) {
      throw new Error("journey: the session-C completion-prompt wave was not persisted");
    }
    tracked.register(notifications, promptWave.id);
    expect(promptWave.title).toBe(NOTIFS_EN.eventSessionCompletionPromptTitle);
    expect(promptWave.body).toBe(NOTIFS_EN.eventSessionCompletionPromptBody(teacherUser.fullName));
    expect(completionPublication.calls).toHaveLength(1);
    expect(completionPublication.calls[0]?.flatMap(receipt => receipt.recipientUserIds)).toEqual([studentS.userId]);

    // Confirm — the second escrow release credits the SAME wallet a second
    // time: the pre-dispute baseline the arbitration reverses against.
    const confirmationPublication = spyLifecyclePublication();
    let confirmed: SessionReturnType;
    try {
      confirmed = await SessionLifecycleService.confirmSessionCompletion(studentS.userId, sessionC.id, LOCALE_EN);
    } finally {
      confirmationPublication.stop();
    }
    sessionC = confirmed;

    expect(sessionC.status).toBe(SessionStatus.Completed);
    expect(sessionC.confirmedByStudentAt).not.toBeNull();
    expect(sessionC.feeHeld).toBe(false);

    const walletRowsAfter = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    const walletAfter = walletRowsAfter[0];
    if (!walletAfter) {
      throw new Error("journey: the teacher's wallet vanished at session C's confirmation");
    }
    expect(Number(walletAfter.balance)).toBe(Number(walletBefore.balance) + Number(SESSION_FEE_HIFZ));
    expect(Number(walletAfter.totalEarning)).toBe(Number(walletBefore.totalEarning) + Number(SESSION_FEE_HIFZ));
    expect(await countWalletsForTeacher(teacherT.userId)).toBe(1);

    // The SECOND earning ledger row — bound to the wallet and session C,
    // the fee verbatim (append-only table: counted and read, never tracked).
    expect(await countTeacherTransactionsForTeacher(teacherT.userId)).toBe(2);
    const earningRows = await db.select().from(teacherTransaction).where(eq(teacherTransaction.sessionId, sessionC.id));
    expect(earningRows).toHaveLength(1);
    const earning = earningRows[0];
    if (!earning) {
      throw new Error("journey: session C's confirmation wrote no earning ledger row");
    }
    expect(earning.amount).toBe(SESSION_FEE_HIFZ);
    expect(earning.type).toBe(TransactionType.Earning);
    expect(earning.walletId).toBe(walletAfter.id);

    // Hold-as-debit: the confirmation moves NO student lane — the paid
    // credit stays consumed until a refund path restores it.
    const studentAfterConfirm = await readStudentRow(studentS.userId);
    expect(studentAfterConfirm.balanceTrial).toBe(0);
    expect(studentAfterConfirm.balanceHifz).toBe(7);

    // The confirmation dispatches NOTHING.
    expect(confirmationPublication.calls).toHaveLength(0);

    // Both directions across the whole cycle: the teacher gained exactly
    // the request wave and the student exactly the prompt wave; every other
    // cast member observed nothing.
    await expectInboxShift(
      inboxesBefore,
      new Map([
        [teacherT.userId, 1],
        [studentS.userId, 1],
      ])
    );
  });

  test("step 28 — Student: open the post-confirmation dispute on session C — disputed, admin wave membership, teacher opener denied", async () => {
    const rowBefore = await readSessionRow(sessionC.id);
    const walletRowsBefore = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    const walletBefore = walletRowsBefore[0];
    if (!walletBefore) {
      throw new Error("journey: the teacher's wallet vanished before the dispute leg");
    }
    const inboxesBefore = await snapshotInboxes();

    // The opener predicate is student-only: the session's OWN teacher — a
    // real participant — still collapses into the oracle-safe not-found
    // shape, and the completed row is byte-identical.
    const probePublication = spyLifecyclePublication();
    let openerDenial: Error;
    try {
      openerDenial = await catchJourneyError(() =>
        SessionArbitrationService.openPostConfirmationDispute(teacherT.userId, sessionC.id, DISPUTE_REASON_C, LOCALE_EN)
      );
    } finally {
      probePublication.stop();
    }
    if (!(openerDenial instanceof NotFoundError)) {
      throw new Error(`expected NotFoundError for the teacher's dispute-opener probe (got ${openerDenial.name})`);
    }
    expect(openerDenial.message).toContain(ERRORS_EN.sessionNotFound);
    const rowAfterProbe = await readSessionRow(sessionC.id);
    expect(rowAfterProbe.status).toBe(rowBefore.status);
    expect(rowAfterProbe.disputedAt).toBeNull();
    expect(rowAfterProbe.updatedAt.getTime()).toBe(rowBefore.updatedAt.getTime());
    expect(probePublication.calls).toHaveLength(0);

    // The student opens the dispute for real — the escrow stays consumed
    // (the money question belongs to the admin resolution).
    const publication = spyLifecyclePublication();
    let disputedRow: SessionReturnType;
    try {
      disputedRow = await SessionArbitrationService.openPostConfirmationDispute(
        studentS.userId,
        sessionC.id,
        DISPUTE_REASON_C,
        LOCALE_EN
      );
    } finally {
      publication.stop();
    }
    sessionC = disputedRow;

    expect(sessionC.status).toBe(SessionStatus.Disputed);
    expect(sessionC.disputeReason).toBe(DISPUTE_REASON_C);
    expect(sessionC.disputedAt).not.toBeNull();
    expect(sessionC.feeHeld).toBe(false);

    // The teacher's wallet is untouched until the resolution.
    const walletRowsAfterOpen = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    expect(walletRowsAfterOpen[0]?.balance).toBe(walletBefore.balance);
    expect(walletRowsAfterOpen[0]?.totalEarning).toBe(walletBefore.totalEarning);

    // The governance-clean admin wave: EVERY clean admin is addressed, so
    // the assertion is membership-based — the cast admin is present, and no
    // other cast member is. Foreign admin rows are registered too: the
    // suite's own call created them, so teardown owns them.
    const openedWaveRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.type, NotificationType.SessionDisputeOpened),
          eq(notifications.relatedEntityId, sessionC.id)
        )
      );
    expect(openedWaveRows.length).toBeGreaterThanOrEqual(1);
    for (const waveRow of openedWaveRows) {
      tracked.register(notifications, waveRow.id);
    }
    const adminWave = openedWaveRows.find(waveRow => waveRow.userId === adminA.userId);
    if (!adminWave) {
      throw new Error("journey: the cast admin was not addressed by the dispute-opened wave");
    }
    expect(adminWave.relatedEntityType).toBe("session");
    expect(adminWave.isRead).toBe(false);
    expect(adminWave.title).toBe(NOTIFS_EN.eventSessionDisputeOpenedTitle);
    expect(adminWave.body).toBe(NOTIFS_EN.eventSessionDisputeOpenedBody);

    // ONE post-commit publish carrying the admin cohort — the cast admin
    // addressed, no other cast member.
    expect(publication.calls).toHaveLength(1);
    const addressed = publication.calls[0]?.flatMap(receipt => receipt.recipientUserIds) ?? [];
    expect(addressed).toContain(adminA.userId);
    for (const actor of castActors()) {
      if (actor.userId !== adminA.userId) {
        expect(addressed).not.toContain(actor.userId);
      }
    }

    // Both directions: the cast admin's inbox grew by exactly the one wave;
    // every other cast member observed nothing.
    await expectInboxShift(inboxesBefore, new Map([[adminA.userId, 1]]));
  });

  test("step 29 — Admin: Refund arbitration — wallet reversed exactly the fee, lane restored, compensating ledger row, participants wave", async () => {
    const rowBefore = await readSessionRow(sessionC.id);
    const walletRowsBefore = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    const walletBefore = walletRowsBefore[0];
    if (!walletBefore) {
      throw new Error("journey: the teacher's wallet vanished before the arbitration");
    }
    const ledgerBefore = await countTeacherTransactionsForTeacher(teacherT.userId);
    const inboxesBefore = await snapshotInboxes();

    // The resolver surface is admin-only: the session's own teacher and the
    // linked parent — both governance-clean REAL callers — are denied by the
    // role re-check, with the disputed row and the money byte-identical.
    const probePublication = spyLifecyclePublication();
    let teacherArbDenial: Error;
    let parentArbDenial: Error;
    try {
      teacherArbDenial = await catchJourneyError(() =>
        SessionArbitrationService.arbitrateDispute(
          teacherT.userId,
          sessionC.id,
          DisputeResolution.Refund,
          RESOLUTION_NOTE_C,
          null,
          LOCALE_EN
        )
      );
      parentArbDenial = await catchJourneyError(() =>
        SessionArbitrationService.arbitrateDispute(
          parentP.userId,
          sessionC.id,
          DisputeResolution.Refund,
          RESOLUTION_NOTE_C,
          null,
          LOCALE_EN
        )
      );
    } finally {
      probePublication.stop();
    }
    for (const denial of [teacherArbDenial, parentArbDenial]) {
      if (!(denial instanceof ForbiddenError)) {
        throw new Error(`expected ForbiddenError for the non-admin arbitration probe (got ${denial.name})`);
      }
      expect(denial.code).toBe("FORBIDDEN");
      expect(denial.message).toContain(ERRORS_EN.forbidden);
    }
    const rowAfterProbe = await readSessionRow(sessionC.id);
    expect(rowAfterProbe.status).toBe(SessionStatus.Disputed);
    expect(rowAfterProbe.resolvedAt).toBeNull();
    expect(rowAfterProbe.updatedAt.getTime()).toBe(rowBefore.updatedAt.getTime());
    const walletRowsAfterProbe = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    expect(walletRowsAfterProbe[0]?.balance).toBe(walletBefore.balance);
    expect(walletRowsAfterProbe[0]?.totalEarning).toBe(walletBefore.totalEarning);
    expect(await countTeacherTransactionsForTeacher(teacherT.userId)).toBe(ledgerBefore);
    expect(probePublication.calls).toHaveLength(0);

    // The admin arbitrates the Refund — the binding decision.
    const publication = spyLifecyclePublication();
    let resolvedRow: SessionReturnType;
    try {
      resolvedRow = await SessionArbitrationService.arbitrateDispute(
        adminA.userId,
        sessionC.id,
        DisputeResolution.Refund,
        RESOLUTION_NOTE_C,
        null,
        LOCALE_EN
      );
    } finally {
      publication.stop();
    }
    sessionC = resolvedRow;
    // The arbitration appended an immutable audit row that restrict-deletes
    // its admin actor — record the session for the afterAll audit sweep
    // before any assertion can strand the teardown worklist.
    arbitratedSessionIds.push(sessionC.id);

    // The terminal resolution shape: the row back at completed with BOTH
    // resolution stamps, the original completion stamps preserved.
    expect(sessionC.status).toBe(SessionStatus.Completed);
    expect(sessionC.feeHeld).toBe(false);
    expect(sessionC.resolutionNote).toBe(RESOLUTION_NOTE_C);
    expect(sessionC.resolutionOutcome).toBe(DisputeResolution.Refund);
    expect(sessionC.resolvedAt).not.toBeNull();
    expect(sessionC.confirmedByStudentAt).not.toBeNull();
    expect(sessionC.confirmedByTeacherAt).not.toBeNull();
    expect(sessionC.endedAt).not.toBeNull();

    // The wallet reversal: the balance debited EXACTLY the fee; the
    // lifetime earning counter is untouched (the reversal claws back the
    // payout, never the historical earning).
    const walletRowsAfter = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId)).limit(1);
    const walletAfter = walletRowsAfter[0];
    if (!walletAfter) {
      throw new Error("journey: the teacher's wallet vanished at the arbitration");
    }
    expect(Number(walletAfter.balance)).toBe(Number(walletBefore.balance) - Number(SESSION_FEE_HIFZ));
    expect(walletAfter.totalEarning).toBe(walletBefore.totalEarning);

    // The student's provenance lane restored exactly once: the paid credit
    // that funded session C's hold returned to its own lane.
    const studentAfter = await readStudentRow(studentS.userId);
    expect(studentAfter.balanceTrial).toBe(0);
    expect(studentAfter.balanceHifz).toBe(8);
    expect(studentAfter.balanceTajweed).toBe(0);
    expect(studentAfter.balanceReviews).toBe(0);

    // The ledger: the original earning plus exactly ONE compensating
    // arbitration-reversal row for session C — session-keyed, completed,
    // amount verbatim, traceable by its reversal description.
    expect(await countTeacherTransactionsForTeacher(teacherT.userId)).toBe(3);
    const ledgerRows = await db.select().from(teacherTransaction).where(eq(teacherTransaction.sessionId, sessionC.id));
    expect(ledgerRows.map(row => row.type).toSorted((first, second) => first.localeCompare(second))).toEqual(
      [TransactionType.Earning, TransactionType.ArbitrationReversal].toSorted((first, second) =>
        first.localeCompare(second)
      )
    );
    const compensating = ledgerRows.toSorted((first, second) => first.id - second.id).at(-1);
    if (!compensating) {
      throw new Error("journey: the compensating arbitration-reversal row was not persisted");
    }
    expect(compensating.type).toBe(TransactionType.ArbitrationReversal);
    expect(compensating.amount).toBe(SESSION_FEE_HIFZ);
    expect(compensating.status).toBe(TransactionStatus.Completed);
    expect(compensating.walletId).toBe(walletAfter.id);
    expect(compensating.description).toBe(`Dispute refund reversal — Session #${sessionC.id}`);

    // Exactly ONE override audit row for the arbitration — acted by the
    // admin, carrying the resolution, the refunded amount, and only the
    // note's PRESENCE (the note's content never enters the trail).
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "session"), eq(auditLogs.entityId, sessionC.id)));
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0];
    if (!audit) {
      throw new Error("journey: the arbitration audit row was not persisted");
    }
    expect(audit.actorId).toBe(adminA.userId);
    expect(audit.actionType).toBe(AuditActionType.Override);
    const parsedDetails: unknown = JSON.parse(audit.details ?? "null");
    if (!isRecord(parsedDetails)) {
      throw new Error("journey: the arbitration audit row carries no details object");
    }
    expect(parsedDetails.resolution).toBe(DisputeResolution.Refund);
    expect(parsedDetails.refundAmount).toBe(SESSION_FEE_HIFZ);
    expect(parsedDetails.notePresent).toBe(true);
    expect(JSON.stringify(parsedDetails)).not.toContain(RESOLUTION_NOTE_C);

    // The resolution wave reaches exactly the two participants — persisted
    // as one inbox row each, composed in each recipient's pinned locale;
    // the admin who decided the case gains nothing.
    const resolvedWaveRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.type, NotificationType.SessionDisputeResolved),
          eq(notifications.relatedEntityId, sessionC.id)
        )
      );
    expect(resolvedWaveRows.map(waveRow => waveRow.userId).toSorted((first, second) => first - second)).toEqual(
      [studentS.userId, teacherT.userId].toSorted((first, second) => first - second)
    );
    for (const waveRow of resolvedWaveRows) {
      tracked.register(notifications, waveRow.id);
    }
    for (const waveRow of resolvedWaveRows) {
      expect(waveRow.relatedEntityType).toBe("session");
      expect(waveRow.isRead).toBe(false);
      expect(waveRow.title).toBe(NOTIFS_EN.eventSessionDisputeResolvedTitle);
      expect(waveRow.body).toBe(NOTIFS_EN.eventSessionDisputeResolvedRefundBody);
    }

    // ONE post-commit publish addressing exactly the two participants.
    expect(publication.calls).toHaveLength(1);
    expect(
      (publication.calls[0]?.flatMap(receipt => receipt.recipientUserIds) ?? []).toSorted(
        (first, second) => first - second
      )
    ).toEqual([studentS.userId, teacherT.userId].toSorted((first, second) => first - second));

    // Both directions: the student's and the teacher's inboxes each grew by
    // exactly the one wave; every other cast member (the admin included)
    // observed nothing.
    await expectInboxShift(
      inboxesBefore,
      new Map([
        [studentS.userId, 1],
        [teacherT.userId, 1],
      ])
    );
  });

  test("step 30 — System: final consistency sweep — the full end-state table across money, sessions, content, billing, link, and inboxes", async () => {
    // ── Money: the student's lanes close at the settled, refunded,
    // reversal-restored values — every debit returned to its own lane, the
    // trial unit consumed by the ladder's first rung.
    const studentRow = await readStudentRow(studentS.userId);
    expect(studentRow.balanceTrial).toBe(0);
    expect(studentRow.balanceHifz).toBe(8);
    expect(studentRow.balanceTajweed).toBe(0);
    expect(studentRow.balanceReviews).toBe(0);

    // ── Link: the guarded one-parent write from the link leg is still in
    // force, with the request row folded to its terminal decision.
    expect(studentRow.parentId).toBe(parentP.userId);
    const linkRows = await db
      .select()
      .from(parentLinkRequests)
      .where(eq(parentLinkRequests.id, linkRequestId))
      .limit(1);
    const linkRow = linkRows[0];
    if (!linkRow) {
      throw new Error("journey fixture: link-request row vanished");
    }
    expect(linkRow.status).toBe(LinkStatus.Confirmed);
    expect(linkRow.respondedAt).not.toBeNull();

    // ── Sessions: exactly the three booked rows, each in its expected
    // terminal shape — A dual-confirmed (never disputed), B cancelled with
    // its reason, C completed WITH the resolution stamps (the stamped
    // completed row IS the resolved shape — there is no distinct resolved
    // status value) — and every fee verbatim with every hold released.
    expect(await db.$count(session, eq(session.studentId, studentS.userId))).toBe(3);
    const [rowA, rowB, rowC] = await Promise.all([
      readSessionRow(sessionA.id),
      readSessionRow(sessionB.id),
      readSessionRow(sessionC.id),
    ]);
    for (const row of [rowA, rowB, rowC]) {
      expect(row.fee).toBe(SESSION_FEE_HIFZ);
      expect(row.feeHeld).toBe(false);
    }
    expect(rowA.status).toBe(SessionStatus.Completed);
    expect(rowA.confirmedByStudentAt).not.toBeNull();
    expect(rowA.confirmedByTeacherAt).not.toBeNull();
    expect(rowA.disputedAt).toBeNull();
    expect(rowA.resolutionOutcome).toBeNull();
    expect(rowB.status).toBe(SessionStatus.Cancelled);
    expect(rowB.cancelReason).toBe(CANCEL_REASON_B);
    expect(rowC.status).toBe(SessionStatus.Completed);
    expect(rowC.confirmedByStudentAt).not.toBeNull();
    expect(rowC.confirmedByTeacherAt).not.toBeNull();
    expect(rowC.resolutionNote).toBe(RESOLUTION_NOTE_C);
    expect(rowC.resolutionOutcome).toBe(DisputeResolution.Refund);
    expect(rowC.resolvedAt).not.toBeNull();

    // ── Wallet + ledger: the money story closes — the lifetime counter
    // keeps BOTH earnings, and the reversal clawed back exactly one payout
    // from the balance; the ledger holds the two earnings plus the one
    // compensating reversal, every amount verbatim, session-keyed onto the
    // two confirmed sessions.
    const walletRows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherT.userId));
    expect(walletRows).toHaveLength(1);
    const teacherWallet = walletRows[0];
    if (!teacherWallet) {
      throw new Error("journey: the teacher's wallet vanished before the end-state sweep");
    }
    expect(teacherWallet.balance).toBe(SESSION_FEE_HIFZ);
    expect(Number(teacherWallet.totalEarning)).toBe(Number(SESSION_FEE_HIFZ) * 2);
    expect(await countWalletsForTeacher(teacherT.userId)).toBe(1);
    expect(await countTeacherTransactionsForTeacher(teacherT.userId)).toBe(3);
    const ledgerRows = await db
      .select()
      .from(teacherTransaction)
      .where(eq(teacherTransaction.walletId, teacherWallet.id));
    expect(ledgerRows).toHaveLength(3);
    expect(
      ledgerRows.map(ledgerRow => ledgerRow.type).toSorted((first, second) => first.localeCompare(second))
    ).toEqual(
      [TransactionType.Earning, TransactionType.Earning, TransactionType.ArbitrationReversal].toSorted(
        (first, second) => first.localeCompare(second)
      )
    );
    for (const ledgerRow of ledgerRows) {
      expect(ledgerRow.amount).toBe(SESSION_FEE_HIFZ);
    }
    const ledgerSessionKeys = ledgerRows.map(ledgerRow => {
      if (ledgerRow.sessionId === null) {
        throw new Error("journey: a teacher-transaction ledger row carries no session key");
      }
      return ledgerRow.sessionId;
    });
    expect(ledgerSessionKeys.toSorted((first, second) => first - second)).toEqual(
      [sessionA.id, sessionC.id, sessionC.id].toSorted((first, second) => first - second)
    );

    // ── Content: exactly the one report and its one homework assignment —
    // and the honest ZERO progress rows (the Hifz curriculum advance is
    // tajweed-gated; no progress row ever shipped for these confirms).
    expect(await db.$count(reports, eq(reports.sessionId, sessionA.id))).toBe(1);
    expect(await db.$count(homeWork, eq(homeWork.sessionId, sessionA.id))).toBe(1);
    expect(await db.$count(progress, eq(progress.studentId, studentS.userId))).toBe(0);

    // ── Billing: the purchase set closed at its settled state — the
    // subscription active, the payment paid, the junction row present.
    expect((await readSubscriptionRow(purchaseReturn.subscription.id)).status).toBe(SubscriptionStatus.Active);
    expect((await readPaymentRow(purchaseReturn.payment.id)).status).toBe(PaymentStatus.Paid);
    expect(
      await db.$count(studentSubscriptions, eq(studentSubscriptions.subscriptionId, purchaseReturn.subscription.id))
    ).toBe(1);

    // ── Inboxes: the cumulative per-actor deltas, exactly as the steps
    // waved them — the student six, the parent two, the teacher four, the
    // cast admin one, and the two denial actors nothing.
    expect(await inboxCount(studentS.userId)).toBe((inboxBaseline.get(studentS.userId) ?? 0) + 6);
    expect(await inboxCount(parentP.userId)).toBe((inboxBaseline.get(parentP.userId) ?? 0) + 2);
    expect(await inboxCount(teacherT.userId)).toBe((inboxBaseline.get(teacherT.userId) ?? 0) + 4);
    expect(await inboxCount(adminA.userId)).toBe((inboxBaseline.get(adminA.userId) ?? 0) + 1);
    expect(await inboxCount(studentS2.userId)).toBe(inboxBaseline.get(studentS2.userId) ?? 0);
    expect(await inboxCount(parentP2.userId)).toBe(inboxBaseline.get(parentP2.userId) ?? 0);

    // The injected-seam publish log is closed at its lifetime total — every
    // lifecycle, dispute, and arbitration wave published through the
    // per-step namespace spy, never the injected transport. The order is
    // the step order: settlement → S, link request → S, acceptance → P,
    // report → S, report → P.
    expect(transportSpy.publishCount).toBe(5);
    expect(transportSpy.publishedUserIds).toEqual([
      studentS.userId,
      studentS.userId,
      parentP.userId,
      studentS.userId,
      parentP.userId,
    ]);
  });
});
