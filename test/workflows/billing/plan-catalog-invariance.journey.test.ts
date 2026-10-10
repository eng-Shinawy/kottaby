/**
 * Cross-actor journey — plan-catalog invariance (catalog mutation never
 * touches existing subscriptions or credited balances).
 *
 * One shared entity — a hifz-lane plan and the subscription it credited —
 * travels the purchase → mutation arc across four REAL actors, proving the
 * catalog's forward-only lifecycle guarantee end to end:
 *
 *  | Step | Actor      | Action                                        | Shared state                                  | Side effects                         |
 *  |------|------------|-----------------------------------------------|-----------------------------------------------|--------------------------------------|
 *  | 1    | System     | provision student S, certified teacher T, admin A, observer O, hifz-lane plan (ONE committing tx) | fixtures committed | tracked ids registered        |
 *  | 2    | Student S  | purchase + confirmed gateway event           | subscription `active`; `balance_hifz = sessionCount`; byte-snapshots captured | pending pair + junction + claim + ONE notification + ONE publish to S |
 *  | 3    | Student S  | attempted plan deactivation through the real admin gate | FORBIDDEN, zero writes                | one bounded FORBIDDEN domain log     |
 *  | 4    | Admin A    | deactivate (`is_active=false`, `deactivated_at`) then edit (title/price) | plan row mutated; credit basis (`sessionCount`, `balanceLane`) intact | ONE Suspend + ONE Update audit row, zero dispatches |
 *  | 5    | Observer O | byte-identity + catalog exclusion             | subscription row byte-identical; credited lane byte-identical; `planCatalog` ABSENT; admin surface still lists the plan | none |
 *  | 6    | Student S  | book ONE session on the credited lane         | booking SUCCEEDS; `heldBalanceLane = hifz`; lane −1 exactly | session + claim + teacher request wave to T ONLY |
 *  | 7    | System     | registry teardown (`afterAll`)               | zero residue                                   | audit rows swept under the sanctioned suspension; immutable ledgers asserted zero-row |
 *
 * The invariance contract under test: a plan's deactivation and its
 * forward-only edits mutate the `plans` row ONLY — the already-activated
 * subscription and the lane it credited stay byte-identical, and the
 * credited value still funds a booking afterwards.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *   never `runInRollback` (the services spawn their own top-level
 *   transactions);
 * - honest actors: real `users` rows + real role-child rows via the
 *   actor-context factory; the deactivation/edit surface is admin-gated by
 *   the real `assertActorAdmin` check — the step-3 denial flows through it,
 *   nothing monkey-patched;
 * - external effects intercepted at the notification boundary: the
 *   `NotificationEngine.publishReceipts` seam is SPIED for the whole
 *   journey (asserting both that a dispatch happened and which userIds it
 *   targeted); the immutable `teacher_transaction` ledger is asserted
 *   zero-row by session anchor, never tracked;
 * - error assertions through `catchJourneyError` + translated substrings —
 *   never `.rejects.toThrow()`;
 * - per-run `jrn_billing_<8hex>` prefix on every fixture name and
 *   idempotency key; cross-actor visibility asserted BOTH directions plus
 *   the admin-gate denial probe.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { toUserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { ForbiddenError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SubscriptionActivationService, SubscriptionPurchaseService } from "@/backend/services";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  PaymentWebhookEvent,
  PlanSelectType,
  SubscriptionSelectType,
  UserSelectType,
} from "@/backend/types";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";
import { withAuditDeleteTriggersSuspended, withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run unique prefix — every fixture name, plan title, and idempotency key. */
const PREFIX = journeyPrefix("billing");

/** Error-copy locale for every service call and denial assertion. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** Notification copy — the confirmation wave composes in the recipient's persisted locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Session count the journey plan grants (the credit amount under test). */
const PLAN_SESSION_COUNT = 7;
/** Activation window of the journey plan (days). */
const PLAN_INTERVAL_DAYS = 30;

/** The admin edit's new title — the catalog row's only free-text mutation. */
const EDITED_TITLE = `${PREFIX} plan retitled`;
/** The admin edit's new price — the catalog row's money mutation. */
const EDITED_PRICE = "250.00";

/** The audit rows' entity anchor for plan catalog mutations. */
const PLAN_AUDIT_ENTITY = "plan";

/** Idempotency keys — one per purchase/booking leg, unique per run. */
const KEY_PURCHASE = `${PREFIX}-key-purchase`;
const KEY_BOOKING = `${PREFIX}-key-booking`;

const tracked = new TrackedFixtures();

/**
 * The fan-out publish spy — installed over the engine's publish boundary
 * (the activation and booking flows publish post-commit through this exact
 * namespace-bound seam; neither service exposes an injected-transport
 * parameter). Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Ledger rows created by the services during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];

let studentS: JourneyActorRow;
let observerO: JourneyActorRow;
let teacherActor: JourneyActor;
let adminActor: JourneyActor;
let planRow: PlanSelectType;

/** The activated subscription's committed id. */
let subscriptionId = 0;
/** The step-2 byte-snapshots the observer step re-proves identical. */
let subscriptionSnapshot: SubscriptionSelectType | null = null;
let lanesSnapshot: StudentBalance | null = null;
/** The plan row as committed before the admin mutation legs. */
let planBeforeAdminLegs: PlanSelectType | null = null;
/** The step-6 booked session's committed id. */
let bookedSessionId = 0;

/** A journey cast member: the actor-context bundle plus its user row. */
interface JourneyActorRow {
  readonly userId: number;
  readonly user: UserSelectType;
}

/** The student balance lanes this journey asserts on (trial is non-nullable). */
interface StudentBalance {
  readonly hifz: number | null;
  readonly tajweed: number | null;
  readonly reviews: number | null;
  readonly trial: number;
}

/**
 * Narrows the step-2 byte-snapshots — every later step depends on them
 * (steps run in declaration order).
 */
function snapshots(): { subscription: SubscriptionSelectType; lanes: StudentBalance } {
  if (subscriptionSnapshot === null || lanesSnapshot === null) {
    throw new Error("journey state: the step-2 byte-snapshots are missing — the purchase step must run first");
  }
  return { subscription: subscriptionSnapshot, lanes: lanesSnapshot };
}

// ─── GraphQL observation harness (in-process — the same schema/scope gate the HTTP boundary runs) ──

const PLAN_CATALOG_SOURCE = `
  query PlanCatalog {
    planCatalog {
      id
      title
    }
  }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Builds the per-request context for a REAL user row — the same shape the
 * context factory produces for an authenticated request (sanitized user,
 * enum-mapped role, propagation-only idempotency key).
 */
function contextFor(user: UserSelectType): Context {
  const { passwordHash: _passwordHash, ...rest } = user;
  const safeUser = { ...rest, preferredRecitation: null };
  const locale = "en";
  const translations = getServerTranslations(locale);
  return {
    locale,
    t: async <K extends keyof Translations>(namespace: K) => translations[namespace],
    requestId: `${PREFIX}-request`,
    idempotencyKey: null,
    user: safeUser,
    safeUser,
    permissions: [],
    isSuperAdmin: user.role === "admin",
    role: toUserRole(user.role),
    cookies: {},
    authCookieOut: [],
  };
}

/** Runs the public catalog query as one caller through the real scope gate. */
async function executePlanCatalogQuery(contextValue: Context) {
  return graphql({
    schema: graphQLSchema,
    source: PLAN_CATALOG_SOURCE,
    contextValue,
  });
}

/** The plan ids one catalog query returned (ID scalars serialize as strings). */
async function planCatalogIdsFor(caller: UserSelectType): Promise<number[]> {
  const result = await executePlanCatalogQuery(contextFor(caller));
  if (result.errors !== undefined && result.errors.length > 0) {
    throw new Error(`journey: the planCatalog query failed for caller ${caller.id}`);
  }
  const data = result.data;
  if (!isRecord(data) || !Array.isArray(data.planCatalog)) {
    throw new Error("journey: the planCatalog query returned no list payload");
  }
  return data.planCatalog.map(entry => {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      throw new Error("journey: a planCatalog entry carries no string id");
    }
    return Number(entry.id);
  });
}

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** Reads one student's live balance lanes. */
async function readBalances(studentUserId: number): Promise<StudentBalance> {
  const rows = await db.select().from(students).where(eq(students.id, studentUserId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("readBalances: student fixture row vanished");
  }
  return {
    hifz: row.balanceHifz,
    tajweed: row.balanceTajweed,
    reviews: row.balanceReviews,
    trial: row.balanceTrial,
  };
}

/** Reads one subscription row by id, failing when absent. */
async function subscriptionRow(subscriptionRowId: number): Promise<SubscriptionSelectType> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionRowId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`subscription row ${subscriptionRowId} vanished`);
  }
  return row;
}

/** Reads one plan row by id, failing when absent. */
async function planRowById(planId: number): Promise<PlanSelectType> {
  const rows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`plan row ${planId} vanished`);
  }
  return row;
}

/** Independent read-back oracle — direct Drizzle count on the inbox. */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** Reads the single notification row of an inbox, failing on any other shape. */
async function soleNotification(userId: number) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new Error(`expected exactly one notification row for user ${userId}, found ${rows.length}`);
  }
  return row;
}

/** Every audit row anchored on the journey's plan, oldest first. */
async function planAnchoredAuditRows(planId: number) {
  return db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityId: auditLogs.entityId,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, PLAN_AUDIT_ENTITY), eq(auditLogs.entityId, planId)))
    .orderBy(auditLogs.id);
}

/** Whether the public active catalog lists the journey's plan. */
async function activeCatalogListsPlan(planId: number): Promise<boolean> {
  const catalog = await PlanCatalogService.listActiveCatalog("en");
  return catalog.some(entry => entry.id === planId);
}

/**
 * Installs a recording stub over `logger.logDomainError` so expected domain
 * rejections stay silent in test output AND become assertable. Callers MUST
 * `stop()` (use try/finally).
 */
function recordDomainLogs(): { codes: string[]; stop: () => void } {
  const codes: string[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    codes.push(ctx?.code ?? "<missing>");
  });
  return { codes, stop: () => spy.mockRestore() };
}

/**
 * Reads the published receipt at one spy call index, failing on any other
 * shape (runtime-guarded — zero casts).
 */
function publishedRecipientUserIds(callIndex: number): readonly unknown[] {
  const published: unknown = publishSpy.mock.calls[callIndex]?.[0];
  if (!Array.isArray(published) || published.length !== 1) {
    throw new Error(`expected exactly one published delivery receipt at call ${callIndex}`);
  }
  const receipt = published[0];
  if (!isRecord(receipt) || !Array.isArray(receipt.recipientUserIds)) {
    throw new Error(`expected the published receipt at call ${callIndex} to carry its recipient ids`);
  }
  return receipt.recipientUserIds;
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

/**
 * Provisions one student cast member through the actor-context factory and
 * re-reads the committed user row (the GraphQL observation harness consumes
 * it).
 */
async function provisionStudent(tx: DBTransaction): Promise<JourneyActorRow> {
  const actor = await provisionStudentActor(tx, { tracked });
  // Persisted EN locale so any notification copy composed for this cast
  // member resolves against the EN bundle this journey asserts on.
  await tx.update(users).set({ locale: "en" }).where(eq(users.id, actor.userId));
  const rows = await tx.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("journey fixture: student user row vanished inside the provisioning transaction");
  }
  return { userId: actor.userId, user: row };
}

beforeAll(async () => {
  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    studentS = await provisionStudent(tx);
    observerO = await provisionStudent(tx);
    teacherActor = await provisionCertifiedTeacherActor(tx, { tracked });
    adminActor = await provisionAdminActor(tx, { tracked });

    planRow = await createTestPlan(tx, {
      title: `${PREFIX} plan`,
      sessionCount: PLAN_SESSION_COUNT,
      price: "200.00",
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, planRow.id);
  });
});

afterAll(async () => {
  publishSpy.mockRestore();

  // 1. Audit rows FIRST — `audit_logs.actor_id` is ON DELETE RESTRICT and
  //    the append-only immutability trigger must be suspended for the
  //    delete (the only sanctioned mutation path). Every catalog mutation
  //    audit row is attributed to the journey admin and anchored on the
  //    journey plan.
  if (adminActor) {
    await withAuditDeleteTriggersSuspended(async () => {
      await db
        .delete(auditLogs)
        .where(
          or(
            eq(auditLogs.actorId, adminActor.userId),
            and(eq(auditLogs.entityType, PLAN_AUDIT_ENTITY), eq(auditLogs.entityId, planRow.id))
          )
        );
    });
  }

  // 2. Immutable payment-ledger teardown leg: the append-only trigger
  //    blocks a plain DELETE, so the sanctioned suspension wraps exactly
  //    this leg.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds))
    );
  }

  // 3. Junction rows (composite PK — no registry entry; swept by
  //    subscription id and re-probed here, ahead of the tracked sweep that
  //    deletes parents).
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

  // 4. Reverse-registration-order hard delete + zero-residue re-probes for
  //    EVERY tracked row (teacher wave → booking claim → session →
  //    notification → purchase claim → payment → subscription → plan →
  //    cast rows).
  await tracked.cleanup();

  // 5. Post-teardown probes — zero residue on the trigger-immutable
  //    surfaces, scoped to the journey's anchors.
  if (adminActor) {
    expect(await db.$count(auditLogs, eq(auditLogs.actorId, adminActor.userId))).toBe(0);
  }
  expect(
    await db.$count(auditLogs, and(eq(auditLogs.entityType, PLAN_AUDIT_ENTITY), eq(auditLogs.entityId, planRow.id)))
  ).toBe(0);
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("INV-PC2: purchase → admin deactivate + edit ⇒ subscription row and credited lane byte-identical; a subsequent booking on the credited lane succeeds", () => {
  test("step 1 — System: cast + hifz-lane plan committed in ONE transaction; the public catalog lists the plan", async () => {
    // 4 actors × (users row + role-child row) + the plan.
    expect(tracked.size).toBe(9);

    // The plan fixture: active, never deactivated, riding the hifz lane.
    expect(planRow.isActive).toBe(true);
    expect(planRow.deactivatedAt).toBeNull();
    expect(planRow.balanceLane).toBe(SubscriptionCreditLane.Hifz);
    expect(planRow.sessionCount).toBe(PLAN_SESSION_COUNT);

    // Fresh student lanes start at zero (trial included) — the credit the
    // journey observes can only come from the activation.
    const lanes = await readBalances(studentS.userId);
    expect(lanes).toEqual({ hifz: 0, tajweed: 0, reviews: 0, trial: 0 });

    // The pre-deactivation catalog premise: BOTH catalog surfaces list the
    // plan — the service the student catalog resolver calls, and the real
    // GraphQL planCatalog query through the authenticated scope gate.
    expect(await activeCatalogListsPlan(planRow.id)).toBe(true);
    const catalogIds = await planCatalogIdsFor(observerO.user);
    expect(catalogIds).toContain(planRow.id);
  });

  test("step 2 — Student S: purchase + confirmed gateway event → subscription active, balance_hifz = sessionCount; byte-snapshots captured; receipt to S only", async () => {
    const windowStart = Date.now() - 2_000;

    const purchase = await SubscriptionPurchaseService.purchase(
      studentS.userId,
      { planId: planRow.id },
      KEY_PURCHASE,
      "en"
    );
    expect(purchase.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(purchase.checkout.provider).toBe(PaymentGateway.Mock);
    subscriptionId = purchase.subscription.id;
    tracked.register(subscriptions, subscriptionId);
    tracked.register(studentPayments, purchase.payment.id);
    ledgerSubscriptionIds.push(subscriptionId);
    ledgerPaymentIds.push(purchase.payment.id);
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claimRows[0].id);
    }

    const event: PaymentWebhookEvent = {
      reference: purchase.checkout.providerReference,
      outcome: "confirmed",
      amount: purchase.payment.amount,
      currency: purchase.payment.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true });

    // The subscription: active, verified, exact interval window.
    const active = await subscriptionRow(subscriptionId);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.planId).toBe(planRow.id);
    expect(active.userId).toBe(studentS.userId);
    expect(active.paymentVerifiedAt).not.toBeNull();
    if (active.startDate === null || active.endDate === null) {
      throw new Error("expected the activated subscription to carry its window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(PLAN_INTERVAL_DAYS * MS_PER_DAY);

    // The credited lane: exactly the plan's full sessionCount on the plan's
    // lane; every sibling lane byte-identical to its zero baseline.
    const lanesAfter = await readBalances(studentS.userId);
    expect(lanesAfter.hifz).toBe(PLAN_SESSION_COUNT);
    expect(lanesAfter.tajweed).toBe(0);
    expect(lanesAfter.reviews).toBe(0);
    expect(lanesAfter.trial).toBe(0);

    // Byte-snapshots — every later step re-proves these identical.
    subscriptionSnapshot = active;
    lanesSnapshot = lanesAfter;

    // ONE persisted notification composed for the purchaser.
    const row = await soleNotification(studentS.userId);
    tracked.register(notifications, row.id);
    expect(row.type).toBe(NotificationType.PaymentConfirmation);
    expect(row.relatedEntityType).toBe("subscription");
    expect(row.relatedEntityId).toBe(subscriptionId);
    expect(row.title).toBe(NOTIFS_EN.eventPaymentConfirmedTitle);
    expect(row.body).toBe(NOTIFS_EN.eventPaymentConfirmedBody(planRow.title));

    // The receipt published strictly post-commit — to Student S ONLY.
    expect(publishSpy.mock.calls).toHaveLength(1);
    expect(publishedRecipientUserIds(0)).toEqual([studentS.userId]);

    // No other cast member's inbox exists.
    expect(await inboxCount(teacherActor.userId)).toBe(0);
    expect(await inboxCount(adminActor.userId)).toBe(0);
    expect(await inboxCount(observerO.userId)).toBe(0);
  });

  test("step 3 — Student S: attempted deactivation through the real admin gate → FORBIDDEN, zero writes anywhere", async () => {
    planBeforeAdminLegs = await planRowById(planRow.id);

    const logs = recordDomainLogs();
    let denial: Error;
    try {
      denial = await catchJourneyError(() =>
        PlanCatalogService.setPlanActiveStatus(planRow.id, false, studentS.userId, "en")
      );
    } finally {
      logs.stop();
    }
    if (!(denial instanceof ForbiddenError)) {
      throw new Error(`expected ForbiddenError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.message).toContain(ERRORS_EN.forbidden);

    // Exactly ONE bounded domain log — never an error storm.
    expect(logs.codes).toEqual(["FORBIDDEN"]);

    // Zero writes: the plan row is byte-identical, the subscription and the
    // credited lane keep their step-2 snapshots, and no audit row was
    // minted (the gate runs before the mutation transaction opens).
    expect(await planRowById(planRow.id)).toEqual(planBeforeAdminLegs);
    expect(await subscriptionRow(subscriptionId)).toEqual(snapshots().subscription);
    expect(await readBalances(studentS.userId)).toEqual(snapshots().lanes);
    expect(await planAnchoredAuditRows(planRow.id)).toEqual([]);
    expect(await db.$count(auditLogs, eq(auditLogs.actorId, studentS.userId))).toBe(0);
  });

  test("step 4 — Admin A: deactivate (is_active=false, deactivated_at) + edit (title/price) → plan row mutated, exactly TWO audit rows, zero dispatches", async () => {
    const publishesBefore = publishSpy.mock.calls.length;

    // Deactivate: the guarded transition flips the flag, stamps the
    // deactivation marker, and leaves every catalog field untouched.
    const deactivated = await PlanCatalogService.setPlanActiveStatus(planRow.id, false, adminActor.userId, "en");
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.deactivatedAt).not.toBeNull();
    expect(deactivated.title).toBe(planRow.title);
    expect(deactivated.sessionCount).toBe(PLAN_SESSION_COUNT);

    // The deactivate leg minted exactly ONE audit row (Suspend), anchored
    // on the plan and attributed to the acting admin.
    let auditRows = await planAnchoredAuditRows(planRow.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actionType).toBe(AuditActionType.Suspend);
    expect(auditRows[0]?.actorId).toBe(adminActor.userId);
    expect(auditRows[0]?.entityId).toBe(planRow.id);

    // Edit: the forward-only field patch rewrites title + price only.
    const edited = await PlanCatalogService.updatePlan(
      planRow.id,
      { title: EDITED_TITLE, price: EDITED_PRICE },
      adminActor.userId,
      "en"
    );
    expect(edited.title).toBe(EDITED_TITLE);
    expect(edited.price).toBe(EDITED_PRICE);
    expect(edited.isActive).toBe(false);
    expect(edited.sessionCount).toBe(PLAN_SESSION_COUNT);
    expect(edited.balanceLane).toBe(SubscriptionCreditLane.Hifz);

    // The deactivated marker survives the edit untouched.
    const deactivatedAtBefore = deactivated.deactivatedAt;
    const storedAfterEdit = await planRowById(planRow.id);
    if (deactivatedAtBefore === null) {
      throw new Error("expected the deactivated plan to carry its deactivation marker");
    }
    expect(storedAfterEdit.deactivatedAt?.getTime()).toBe(deactivatedAtBefore.getTime());

    // The edit leg minted exactly ONE more audit row (Update) — two total.
    auditRows = await planAnchoredAuditRows(planRow.id);
    expect(auditRows).toHaveLength(2);
    expect(auditRows[1]?.actionType).toBe(AuditActionType.Update);
    expect(auditRows[1]?.actorId).toBe(adminActor.userId);

    // Zero dispatches across both catalog mutations.
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 5 — Observer O: subscription row + credited lane byte-identical; planCatalog excludes the plan (PC1 re-proof); admin surface still lists it", async () => {
    // Byte-identity across the whole admin mutation arc: the subscription
    // row and the credited lane are EXACTLY their step-2 snapshots.
    expect(await subscriptionRow(subscriptionId)).toEqual(snapshots().subscription);
    expect(await readBalances(studentS.userId)).toEqual(snapshots().lanes);

    // The catalog flip, both surfaces: the service the student catalog
    // resolver calls, and the real GraphQL planCatalog query — the same
    // observer caller that saw the plan listed at step 1 now sees it ABSENT.
    expect(await activeCatalogListsPlan(planRow.id)).toBe(false);
    const catalogIds = await planCatalogIdsFor(observerO.user);
    expect(catalogIds).not.toContain(planRow.id);

    // The admin surface still lists the deactivated, edited plan —
    // deactivation hides the row from the public catalog only.
    const adminSurface = await PlanCatalogService.listForAdmin({ includeInactive: true }, "en");
    const listed = adminSurface.find(entry => entry.id === planRow.id);
    if (!listed) {
      throw new Error("expected the admin surface to list the deactivated plan");
    }
    expect(listed.title).toBe(EDITED_TITLE);
    expect(listed.price).toBe(EDITED_PRICE);
    expect(listed.isActive).toBe(false);
    expect(listed.deactivatedAt).not.toBeNull();

    // The observer's own world is untouched: zero lanes, zero inbox.
    expect(await readBalances(observerO.userId)).toEqual({ hifz: 0, tajweed: 0, reviews: 0, trial: 0 });
    expect(await inboxCount(observerO.userId)).toBe(0);
    expect(await inboxCount(adminActor.userId)).toBe(0);
    expect(await inboxCount(teacherActor.userId)).toBe(0);
  });

  test("step 6 — Student S: booking on the credited lane SUCCEEDS — the credit survived the deactivation + edit", async () => {
    const snapshot = snapshots();

    const booked = await SessionLifecycleService.createSession(
      studentS.userId,
      { teacherId: teacherActor.userId, intent: SessionIntent.Hifz },
      KEY_BOOKING,
      "en"
    );
    expect(booked.id).toBeGreaterThan(0);
    expect(booked.studentId).toBe(studentS.userId);
    expect(booked.teacherId).toBe(teacherActor.userId);
    expect(booked.status).toBe(SessionStatus.Scheduled);
    expect(booked.intent).toBe(SessionIntent.Hifz);
    expect(booked.feeHeld).toBe(true);
    expect(booked.fee).toBe(SESSION_FEE_HIFZ);
    expect(booked.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    bookedSessionId = booked.id;
    tracked.register(session, booked.id);
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_BOOKING));
    expect(claimRows).toHaveLength(1);
    if (claimRows[0]) {
      tracked.register(sessionRequestIdempotency, claimRows[0].id);
    }

    // The credited lane funded the hold — exactly one unit; every sibling
    // lane byte-identical to the snapshot. The credited value survived the
    // catalog deactivation and the plan edit.
    const lanesAfter = await readBalances(studentS.userId);
    expect(lanesAfter.hifz).toBe((snapshot.lanes.hifz ?? 0) - 1);
    expect(lanesAfter.trial).toBe(snapshot.lanes.trial);
    expect(lanesAfter.tajweed).toBe(snapshot.lanes.tajweed);
    expect(lanesAfter.reviews).toBe(snapshot.lanes.reviews);

    // The subscription row is STILL byte-identical to the step-2 snapshot —
    // the booking debited the lane and never wrote the subscription.
    expect(await subscriptionRow(subscriptionId)).toEqual(snapshot.subscription);

    // The booking's teacher request wave: ONE persisted notification for
    // the teacher, ONE more post-commit publish targeted at the teacher
    // ONLY, and nobody else's inbox grew.
    const teacherRows = await db.select().from(notifications).where(eq(notifications.userId, teacherActor.userId));
    expect(teacherRows).toHaveLength(1);
    if (teacherRows[0]) {
      tracked.register(notifications, teacherRows[0].id);
    }
    expect(publishSpy.mock.calls).toHaveLength(2);
    expect(publishedRecipientUserIds(1)).toEqual([teacherActor.userId]);
    expect(await inboxCount(studentS.userId)).toBe(1);
    expect(await inboxCount(observerO.userId)).toBe(0);
    expect(await inboxCount(adminActor.userId)).toBe(0);

    // The immutable earning ledger holds ZERO rows for this booking — a
    // held fee moves no teacher money (append-only table, asserted
    // zero-row, never tracked).
    expect(await db.$count(teacherTransaction, eq(teacherTransaction.sessionId, bookedSessionId))).toBe(0);
  });
});
