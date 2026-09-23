/**
 * StudentOnboardingService tests — the admin direct-onboarding flow
 * (offline method whitelist, required payment reference, plan gating,
 * optional parent-association gating, the single-transaction write set,
 * the exactly-two audit rows, and the duplicate email/reference
 * constraint arbitration) against the live database on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling admin suites apply):
 *  - Every case runs inside `runInRollback`; the `tx` is propagated to
 *    the service as its `outerTx` seam so the whole flow executes as a
 *    SAVEPOINT on the caller's transaction.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - NO `expect(...).rejects.toThrow()` — every induced denial is
 *    asserted through a try/catch helper, never through a pinned
 *    rejection inside the rollback wrapper.
 *  - Log seams are SPIED (never real output assertions): every spy is
 *    tracked and restored per test (bun reuses ONE mock per object+method
 *    pair until restored).
 *
 * Coverage map:
 *  - Tier 1 (role gate): the admin-only service denies a student, a
 *    teacher, and a parent actor (each with its REAL user id) with the
 *    localized FORBIDDEN copy, and an anonymous caller with the localized
 *    UNAUTHORIZED copy — every denial leaves all six write tables
 *    untouched and mints zero audit rows.
 *  - Tier 2 (pre-write denials): a gateway payment method (paymob,
 *    stripe), an empty-after-trim reference, an over-length reference, an
 *    unknown plan, an inactive plan, a lane-less plan, an unknown parent
 *    user, a non-parent link target, and a parent-role user without its
 *    role-child row each reject with the flow's own localized copy (or
 *    the canonical not-found codes) BEFORE any write — anchor-scoped
 *    table-count snapshots prove zero movement.
 *  - Tier 3 (happy paths + boundaries): offline cash, bank transfer with
 *    a parent link, and scholarship all commit the full five-table write
 *    set inside the caller's transaction — student detail snapshot (fresh
 *    handshake, credited lane, dormant trial, link state), active
 *    subscription with recorded payment evidence and a fresh one-interval
 *    window, exactly one junction row, the exactly-two admin-attributed
 *    audit rows with ids-only details, and a zero payments-ledger delta.
 *    Boundaries: a 255-character reference commits, a trimmed reference
 *    is stored trimmed, and the second onboarding reusing either a
 *    committed email or a committed reference conflicts through the
 *    UNIQUE constraints with the original holder untouched.
 *  - Tier 4 (chaos/abuse): a vanished-row response from the guarded
 *    parent link (stubbed seam probe) fails the whole transaction loud —
 *    zero residual rows for the attempt — and the audit `details` vocabulary is
 *    pinned to ids/enums/counts only (no identity or credential material
 *    ever enters the trail).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { and, count, eq, inArray, or } from "drizzle-orm";
import { StudentRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestParent, createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ConflictError, DomainError, NotFoundError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { StudentOnboardingService } from "@/backend/services/admin/student-onboarding.service";
import type { AdminOnboardStudentSubmitInput, DBTransaction, PlanSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Milliseconds per day — the fresh subscription window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Fresh-window read skew tolerance for the service-minted now-anchored instants. */
const FRESH_WINDOW_SKEW_MS = 60_000;

/** The audit entity anchors the two onboarding rows carry. */
const USER_ENTITY = "user";
const SUBSCRIPTION_ENTITY = "subscription";

/** The handshake-code format (`KSB-` + 8 uppercase alphanumeric). */
const HANDSHAKE_CODE_PATTERN = /^KSB-[0-9A-F]{8}$/;

/** The admin-set initial credential fixture (weak, well-known, test-only). */
const ONBOARDED_CREDENTIAL = "OnboardedCast#2026";

/** Sentinel actorId expressing an anonymous caller (the admin gate ladder). */
const ANONYMOUS_ACTOR_ID = 0;

/** The one-argument locale tree for the default test locale. */
function translations() {
  return getServerTranslations("en");
}

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until it is restored, so
 * an unrestored mock keeps accumulating `mock.calls` across tests and
 * poisons later call-count assertions — every spy is registered here and
 * restored by the file-level `afterEach`.
 */
const trackedSpies: Array<{ restore(): void }> = [];

function trackSpy<T extends { mockRestore(): void }>(spy: T): T {
  trackedSpies.push({ restore: () => spy.mockRestore() });
  return spy;
}

afterEach(() => {
  for (const entry of trackedSpies) {
    entry.restore();
  }
  trackedSpies.length = 0;
});

/**
 * The identity anchors one test owns: every attempted onboarding's email
 * and payment reference (each carries a fresh random UUID, so no peer
 * worker can ever mint a row with them), the plan ids the attempts target,
 * and the actor ids the flow would attribute audit rows to. Peer workers
 * commit fixtures into the SHARED test database while a test runs, so the
 * zero-movement oracle counts only anchor-carrying rows — a peer's commits
 * can never drift an anchored count the way they drift a whole-table
 * COUNT(*).
 */
interface AttemptAnchors {
  readonly emails: readonly string[];
  readonly paymentReferences: readonly string[];
  readonly planIds: readonly number[];
  readonly actorIds: readonly number[];
}

/** Collects the anchor keys of one test's attempted onboardings + fixtures. */
function attemptAnchors(options: {
  readonly actorId: number;
  readonly inputs: readonly AdminOnboardStudentSubmitInput[];
  readonly planIds?: readonly number[];
}): AttemptAnchors {
  return {
    emails: options.inputs.map(input => input.email),
    paymentReferences: options.inputs.map(input => input.paymentReference),
    planIds: options.planIds ?? [],
    actorIds: [options.actorId],
  };
}

/** Row counts across every table the flow may write (the zero-movement oracle). */
interface WriteCounts {
  readonly users: number;
  readonly students: number;
  readonly subscriptions: number;
  readonly junction: number;
  readonly auditLogs: number;
  readonly studentPayments: number;
}

/**
 * The student-payments ledger rows anchored to one set of subscription
 * references — the ledger can only ever grow for an attempt through the
 * subscription that attempt created, so a reference-scoped join proves no
 * ledger rows were minted without racing peer workers' committed payments.
 */
async function countStudentPaymentsForReferences(tx: DBTransaction, references: readonly string[]): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(studentPayments)
    .innerJoin(subscriptions, eq(studentPayments.subscriptionId, subscriptions.id))
    .where(inArray(subscriptions.paymentReference, [...references]));
  return row?.value ?? 0;
}

/**
 * One zero-movement snapshot: the anchored counts PLUS the anchors that
 * produced them, so `expectZeroMovement` can re-read the exact same
 * anchored view without carrying the anchors separately at every call site.
 */
interface WriteCountsSnapshot {
  readonly anchors: AttemptAnchors;
  readonly counts: WriteCounts;
}

/**
 * Counts the rows that carry ONE test's anchors on the caller's
 * transaction — the rows an attempted onboarding could only ever add to.
 * A pre/post diff of these counts proves the attempt moved nothing, and
 * unlike a whole-table COUNT(*) it stays blind to rows committed by
 * concurrently running peer test files.
 */
async function snapshotWriteCounts(tx: DBTransaction, anchors: AttemptAnchors): Promise<WriteCountsSnapshot> {
  const attemptUserFilter = inArray(users.email, [...anchors.emails]);
  const attemptSubscriptionFilter = or(
    inArray(subscriptions.paymentReference, [...anchors.paymentReferences]),
    ...anchors.planIds.map(planId => eq(subscriptions.planId, planId))
  );

  const [userCount] = await tx.select({ value: count() }).from(users).where(attemptUserFilter);
  const [studentCount] = await tx
    .select({ value: count() })
    .from(students)
    .innerJoin(users, eq(students.id, users.id))
    .where(attemptUserFilter);
  const [subscriptionCount] = await tx.select({ value: count() }).from(subscriptions).where(attemptSubscriptionFilter);
  const [junctionCount] = await tx
    .select({ value: count() })
    .from(studentSubscriptions)
    .innerJoin(subscriptions, eq(studentSubscriptions.subscriptionId, subscriptions.id))
    .where(attemptSubscriptionFilter);
  const [auditCount] = await tx
    .select({ value: count() })
    .from(auditLogs)
    .where(inArray(auditLogs.actorId, [...anchors.actorIds]));
  const paymentCount = await countStudentPaymentsForReferences(tx, anchors.paymentReferences);

  return {
    anchors,
    counts: {
      users: userCount?.value ?? 0,
      students: studentCount?.value ?? 0,
      subscriptions: subscriptionCount?.value ?? 0,
      junction: junctionCount?.value ?? 0,
      auditLogs: auditCount?.value ?? 0,
      studentPayments: paymentCount,
    },
  };
}

/** Audit rows anchored on one entity (the exactly-two-rows oracle). */
async function readAuditsForEntity(tx: DBTransaction, entityType: string, entityId: number) {
  return tx
    .select({
      actionType: auditLogs.actionType,
      actorId: auditLogs.actorId,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)));
}

/** Audit rows WRITTEN BY one actor (the denial-zero-attribution oracle). */
async function countAuditsForActor(tx: DBTransaction, actorId: number): Promise<number> {
  return tx.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

/** One admin actor (the only role the service's gate accepts). */
async function createAdmin(tx: DBTransaction): Promise<number> {
  const admin = await createTestUser(tx, { role: "admin" });
  return admin.id;
}

/** One lane-bearing plan (the Hifz lane, 8 sessions, 30-day interval). */
async function createLaneBearingPlan(
  tx: DBTransaction,
  overrides: Partial<PlanSelectType> = {}
): Promise<PlanSelectType> {
  return createTestPlan(tx, {
    sessionCount: 8,
    intervalDays: 30,
    price: "200.00",
    balanceLane: SubscriptionCreditLane.Hifz,
    ...overrides,
  });
}

/** One parent link target: the users row PLUS its role-child row. */
async function createParentWithRow(tx: DBTransaction): Promise<number> {
  const parent = await createTestUser(tx, { role: "parent" });
  await createTestParent(tx, parent.id);
  return parent.id;
}

/** Per-test run tag — keeps emails and payment references collision-free. */
let runTag = 0;

/** Builds one onboarding submit input — explicit field-by-field, never a spread. */
function buildOnboardInput(overrides: Partial<AdminOnboardStudentSubmitInput> = {}): AdminOnboardStudentSubmitInput {
  runTag += 1;
  return {
    fullName: `Onboarded Student ${runTag}`,
    email: `onboarded-${runTag}-${crypto.randomUUID().slice(0, 8)}@service.test`,
    phone: "+20100444000",
    password: ONBOARDED_CREDENTIAL,
    gender: undefined,
    country: "Egypt",
    parentId: null,
    planId: 0,
    paymentMethod: PaymentGateway.OfflineCash,
    paymentReference: `SVC-REF-${runTag}-${crypto.randomUUID().slice(0, 8)}`,
    ...overrides,
  };
}

/**
 * Try/catch rejection helper (never `.rejects.toThrow()` inside
 * `runInRollback` — deadlocks). Returns the caught `Error`; fails the
 * test when the call resolves successfully.
 */
async function expectServiceError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught === null) {
    throw new Error("expectServiceError: expected the call to throw, but it resolved successfully");
  }
  if (!(errorCaught instanceof Error)) {
    throw new Error(`expectServiceError: caught non-Error throw: ${JSON.stringify(errorCaught)}`);
  }
  return errorCaught;
}

/** Type-guard read of a caught rejection's `extensions.code` (the typed DomainError contract). */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/** Pins a caught denial to exactly the expected code + translated message. */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
}

/** Asserts a denial moved NOTHING: every anchored write-table count is unchanged. */
async function expectZeroMovement(tx: DBTransaction, before: WriteCountsSnapshot): Promise<void> {
  const after = await snapshotWriteCounts(tx, before.anchors);
  expect(after.counts).toEqual(before.counts);
}

/**
 * The shared happy-path oracle: asserts the full committed shape of one
 * onboarding leg — detail snapshot, subscription row, junction row, the
 * exactly-two admin-attributed audit rows with ids-only details, the
 * zero payments-ledger delta, and the return contract.
 */
async function assertCommittedLeg(options: {
  readonly tx: DBTransaction;
  readonly adminId: number;
  readonly plan: PlanSelectType;
  readonly result: Awaited<ReturnType<typeof StudentOnboardingService.onboardStudentWithOfflinePayment>>;
  readonly expectedMethod: PaymentGateway;
  readonly expectedReference: string;
  readonly expectedParentId: number | null;
  readonly paymentsBefore: number;
}): Promise<void> {
  const { tx, adminId, plan, result, expectedMethod, expectedReference, expectedParentId, paymentsBefore } = options;

  // Return contract: the plan's lane credited exactly one session count.
  expect(result.creditedLane).toBe(SubscriptionCreditLane.Hifz);
  expect(result.creditedSessions).toBe(plan.sessionCount);
  expect(result.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
  expect(result.subscription.status).toBe(SubscriptionStatus.Active);
  expect(result.subscription.paymentMethod).toBe(expectedMethod);
  expect(result.subscription.paymentReference).toBe(expectedReference);

  // Student detail snapshot: fresh handshake, credited lane, dormant
  // trial, and the expected link state — same-transaction fresh.
  expect(result.student.role).toBe(UserRole.Student);
  const snapshot = result.student.student;
  if (!snapshot) {
    throw new Error("assertCommittedLeg: the returned detail carries no student snapshot");
  }
  expect(snapshot.handshakeCode).toBe(result.handshakeCode);
  expect(snapshot.parentId).toBe(expectedParentId);
  expect(snapshot.hasParentLink).toBe(expectedParentId !== null);
  // `hasActiveSubscription` is time-gated against the transaction clock
  // (`now()` pins to the transaction START, which precedes the mid-transaction
  // window), so inside this rollback the flag honestly reads false — the
  // post-commit read-back that proves the flag flips true is pinned by the
  // journey suite's admin read-back step.
  expect(snapshot.balanceHifz).toBe(plan.sessionCount);
  expect(snapshot.balanceTajweed).toBe(0);
  expect(snapshot.balanceReviews).toBe(0);
  // The detail projection keeps the trial lane dormant (the mapper nulls
  // both trial observables until the trial schema delta lands).
  expect(snapshot.balanceTrial).toBeNull();
  expect(snapshot.trialGrantedAt).toBeNull();

  // Subscription row: active, evidence columns recorded, fresh window.
  const [subscriptionRow] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, result.subscription.id))
    .limit(1);
  if (!subscriptionRow) {
    throw new Error("assertCommittedLeg: the committed subscription row vanished");
  }
  expect(subscriptionRow.userId).toBe(result.student.id);
  expect(subscriptionRow.planId).toBe(plan.id);
  expect(subscriptionRow.status).toBe(SubscriptionStatus.Active);
  expect(subscriptionRow.paymentMethod).toBe(expectedMethod);
  expect(subscriptionRow.paymentReference).toBe(expectedReference);
  if (!subscriptionRow.paymentVerifiedAt || !subscriptionRow.startDate || !subscriptionRow.endDate) {
    throw new Error("assertCommittedLeg: the offline evidence or window is missing");
  }
  expect(Math.abs(subscriptionRow.paymentVerifiedAt.getTime() - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
  expect(Math.abs(subscriptionRow.startDate.getTime() - Date.now())).toBeLessThan(FRESH_WINDOW_SKEW_MS);
  expect(subscriptionRow.endDate.getTime() - subscriptionRow.startDate.getTime()).toBe(plan.intervalDays * MS_PER_DAY);

  // Exactly one junction row for the fresh student.
  const junctionRows = await tx
    .select({ subscriptionId: studentSubscriptions.subscriptionId })
    .from(studentSubscriptions)
    .where(eq(studentSubscriptions.studentId, result.student.id));
  expect(junctionRows).toHaveLength(1);
  expect(junctionRows[0]?.subscriptionId).toBe(result.subscription.id);

  // Exactly TWO audit rows, both attributed to the acting admin — the
  // user Create row minted inside createUser, and the subscription
  // Create row minted by the flow.
  const userAudits = await readAuditsForEntity(tx, USER_ENTITY, result.student.id);
  expect(userAudits).toHaveLength(1);
  const userAudit = userAudits[0];
  expect(userAudit?.actionType).toBe(AuditActionType.Create);
  expect(userAudit?.actorId).toBe(adminId);
  expect(userAudit?.details).toBe('{"role":"student"}');

  const subscriptionAudits = await readAuditsForEntity(tx, SUBSCRIPTION_ENTITY, result.subscription.id);
  expect(subscriptionAudits).toHaveLength(1);
  const subscriptionAudit = subscriptionAudits[0];
  expect(subscriptionAudit?.actionType).toBe(AuditActionType.Create);
  expect(subscriptionAudit?.actorId).toBe(adminId);
  const details: unknown = JSON.parse(subscriptionAudit?.details ?? "{}");
  expect(details).toEqual({
    studentUserId: result.student.id,
    planId: plan.id,
    parentId: expectedParentId,
    paymentMethod: expectedMethod,
    paymentReference: expectedReference,
    creditedLane: SubscriptionCreditLane.Hifz,
    creditedSessions: plan.sessionCount,
  });
  expect((subscriptionAudit?.details ?? "").length).toBeLessThanOrEqual(2000);

  // The target student authors nothing — attribution belongs to the admin.
  expect(await countAuditsForActor(tx, result.student.id)).toBe(0);

  // The payments ledger never moved for this attempt's subscriptions.
  expect(await countStudentPaymentsForReferences(tx, [expectedReference])).toBe(paymentsBefore);
}

describe("StudentOnboardingService.onboardStudentWithOfflinePayment", () => {
  describe("tier 1 — the admin-only actor gate (real ids, zero writes)", () => {
    test("a student actor is forbidden with the localized copy and zero movement", async () => {
      await runInRollback(async tx => {
        const student = await createTestUser(tx, { role: "student" });
        const input = buildOnboardInput();
        const before = await snapshotWriteCounts(tx, attemptAnchors({ actorId: student.id, inputs: [input] }));
        const logSpy = trackSpy(spyOn(logger, "logDomainError"));

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, student.id, "en", tx)
        );

        expectDomainDenial(error, "FORBIDDEN", translations().errorsTranslations.forbidden);
        await expectZeroMovement(tx, before);
        expect(logSpy).toHaveBeenCalled();
      });
    });

    test("a teacher actor is forbidden with the localized copy and zero movement", async () => {
      await runInRollback(async tx => {
        const teacher = await createTestUser(tx, { role: "teacher" });
        const input = buildOnboardInput();
        const before = await snapshotWriteCounts(tx, attemptAnchors({ actorId: teacher.id, inputs: [input] }));

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, teacher.id, "en", tx)
        );

        expectDomainDenial(error, "FORBIDDEN", translations().errorsTranslations.forbidden);
        await expectZeroMovement(tx, before);
      });
    });

    test("a parent actor is forbidden with the localized copy and zero movement", async () => {
      await runInRollback(async tx => {
        const parent = await createTestUser(tx, { role: "parent" });
        const input = buildOnboardInput();
        const before = await snapshotWriteCounts(tx, attemptAnchors({ actorId: parent.id, inputs: [input] }));

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, parent.id, "en", tx)
        );

        expectDomainDenial(error, "FORBIDDEN", translations().errorsTranslations.forbidden);
        await expectZeroMovement(tx, before);
        expect(await countAuditsForActor(tx, parent.id)).toBe(0);
      });
    });

    test("an anonymous caller is unauthorized with the localized copy", async () => {
      await runInRollback(async tx => {
        const input = buildOnboardInput();
        const before = await snapshotWriteCounts(tx, attemptAnchors({ actorId: ANONYMOUS_ACTOR_ID, inputs: [input] }));

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, ANONYMOUS_ACTOR_ID, "en", tx)
        );

        expect(error).toBeInstanceOf(UnauthorizedError);
        expectDomainDenial(error, "UNAUTHORIZED", translations().errorsTranslations.unauthorized);
        await expectZeroMovement(tx, before);
      });
    });
  });

  describe("tier 2 — the pre-write denial ladder (every denial is zero-write)", () => {
    test("a gateway payment method is rejected with the offline-whitelist copy", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const paymobInput = buildOnboardInput({ planId: plan.id, paymentMethod: PaymentGateway.Paymob });
        const stripeInput = buildOnboardInput({ planId: plan.id, paymentMethod: PaymentGateway.Stripe });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [paymobInput, stripeInput], planIds: [plan.id] })
        );

        const paymobError = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(paymobInput, adminId, "en", tx)
        );
        const stripeError = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(stripeInput, adminId, "en", tx)
        );

        for (const error of [paymobError, stripeError]) {
          expect(error).toBeInstanceOf(ValidationError);
          expectDomainDenial(error, "VALIDATION", translations().studentOnboardingTranslations.errors.methodNotOffline);
        }

        await expectZeroMovement(tx, before);
      });
    });

    test("an empty-after-trim reference is rejected with the reference copy", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const input = buildOnboardInput({ planId: plan.id, paymentReference: "   " });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expectDomainDenial(error, "VALIDATION", translations().studentOnboardingTranslations.errors.referenceInvalid);
        await expectZeroMovement(tx, before);
      });
    });

    test("a 256-character reference is rejected; the column ceiling is 255", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const input = buildOnboardInput({ planId: plan.id, paymentReference: "R".repeat(256) });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expectDomainDenial(error, "VALIDATION", translations().studentOnboardingTranslations.errors.referenceInvalid);
        await expectZeroMovement(tx, before);
      });
    });

    test("an unknown plan is a PLAN_NOT_FOUND denial", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const input = buildOnboardInput({ planId: 98_765_432 });
        const before = await snapshotWriteCounts(tx, attemptAnchors({ actorId: adminId, inputs: [input] }));

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expect(error).toBeInstanceOf(NotFoundError);
        expectDomainDenial(error, "PLAN_NOT_FOUND", translations().errorsTranslations.planCatalog.planNotFound);
        await expectZeroMovement(tx, before);
      });
    });

    test("an inactive plan is rejected with the flow's localized copy", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx, { isActive: false });
        const input = buildOnboardInput({ planId: plan.id });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expectDomainDenial(error, "VALIDATION", translations().studentOnboardingTranslations.errors.planInactive);
        await expectZeroMovement(tx, before);
      });
    });

    test("a lane-less plan fails closed with the localized lane copy", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createTestPlan(tx, { balanceLane: null });
        const input = buildOnboardInput({ planId: plan.id });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expectDomainDenial(
          error,
          "VALIDATION",
          translations().studentOnboardingTranslations.errors.planLaneUnconfigured
        );
        await expectZeroMovement(tx, before);
      });
    });

    test("an unknown parent user is a USER_NOT_FOUND denial", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const input = buildOnboardInput({ planId: plan.id, parentId: 98_765_432 });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expect(error).toBeInstanceOf(NotFoundError);
        expectDomainDenial(error, "USER_NOT_FOUND", translations().errorsTranslations.adminUsers.userNotFound);
        await expectZeroMovement(tx, before);
      });
    });

    test("a non-parent link target is rejected with the role copy", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const notAParent = await createTestUser(tx, { role: "teacher" });
        const input = buildOnboardInput({ planId: plan.id, parentId: notAParent.id });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expectDomainDenial(error, "VALIDATION", translations().studentOnboardingTranslations.errors.parentRoleInvalid);
        await expectZeroMovement(tx, before);
      });
    });

    test("a parent-role user without its role-child row is rejected with the row copy", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const parentWithoutRow = await createTestUser(tx, { role: "parent" });
        const input = buildOnboardInput({ planId: plan.id, parentId: parentWithoutRow.id });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        expectDomainDenial(error, "VALIDATION", translations().studentOnboardingTranslations.errors.parentsRowMissing);
        await expectZeroMovement(tx, before);
      });
    });
  });

  describe("tier 3 — happy paths, boundaries, and constraint arbitration", () => {
    test("offline cash onboards an unlinked student: full five-table write set, two audit rows, zero ledger movement", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const input = buildOnboardInput({ planId: plan.id, paymentMethod: PaymentGateway.OfflineCash });
        const paymentsBefore = await countStudentPaymentsForReferences(tx, [input.paymentReference]);

        const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx);

        await assertCommittedLeg({
          tx,
          adminId,
          plan,
          result,
          expectedMethod: PaymentGateway.OfflineCash,
          expectedReference: input.paymentReference,
          expectedParentId: null,
          paymentsBefore,
        });
      });
    });

    test("bank transfer links the parent in the same transaction and surfaces the link on the returned snapshot", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const parentId = await createParentWithRow(tx);
        const input = buildOnboardInput({ planId: plan.id, paymentMethod: PaymentGateway.BankTransfer, parentId });
        const paymentsBefore = await countStudentPaymentsForReferences(tx, [input.paymentReference]);

        const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx);

        await assertCommittedLeg({
          tx,
          adminId,
          plan,
          result,
          expectedMethod: PaymentGateway.BankTransfer,
          expectedReference: input.paymentReference,
          expectedParentId: parentId,
          paymentsBefore,
        });

        const [studentRow] = await tx.select().from(students).where(eq(students.id, result.student.id)).limit(1);
        expect(studentRow?.parentId).toBe(parentId);
      });
    });

    test("scholarship accepts a 255-character reference at the column ceiling", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const input = buildOnboardInput({
          planId: plan.id,
          paymentMethod: PaymentGateway.Scholarship,
          paymentReference: `S${crypto.randomUUID().slice(0, 8)}-${"R".repeat(245)}`,
        });
        const paymentsBefore = await countStudentPaymentsForReferences(tx, [input.paymentReference]);
        expect(input.paymentReference).toHaveLength(255);

        const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx);

        await assertCommittedLeg({
          tx,
          adminId,
          plan,
          result,
          expectedMethod: PaymentGateway.Scholarship,
          expectedReference: input.paymentReference,
          expectedParentId: null,
          paymentsBefore,
        });
      });
    });

    test("a padded reference is stored trimmed", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const reference = `TRIM-${crypto.randomUUID().slice(0, 8)}`;
        const input = buildOnboardInput({ planId: plan.id, paymentReference: `  ${reference}  ` });

        const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx);

        expect(result.subscription.paymentReference).toBe(reference);
      });
    });

    test("a duplicate email conflicts through the unique constraint with the localized auth copy", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const first = buildOnboardInput({ planId: plan.id });

        await StudentOnboardingService.onboardStudentWithOfflinePayment(first, adminId, "en", tx);

        const second = buildOnboardInput({ planId: plan.id, email: first.email });
        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(second, adminId, "en", tx)
        );

        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(translations().authTranslations.emailAlreadyExists);

        // The first student is the sole holder of the email.
        const holders = await tx.select({ id: users.id }).from(users).where(eq(users.email, first.email));
        expect(holders).toHaveLength(1);
      });
    });

    test("a duplicate payment reference conflicts with the flow's copy and the original holder stays coherent", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const first = buildOnboardInput({ planId: plan.id, paymentMethod: PaymentGateway.OfflineCash });

        const firstResult = await StudentOnboardingService.onboardStudentWithOfflinePayment(first, adminId, "en", tx);

        const second = buildOnboardInput({ planId: plan.id, paymentReference: first.paymentReference });
        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(second, adminId, "en", tx)
        );

        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(translations().studentOnboardingTranslations.errors.duplicateReference);

        // The duplicate rolled back: exactly one subscription holds the
        // reference, and it belongs to the first onboarding.
        const holders = await tx
          .select({ id: subscriptions.id, userId: subscriptions.userId, reference: subscriptions.paymentReference })
          .from(subscriptions)
          .where(eq(subscriptions.paymentReference, first.paymentReference));
        expect(holders).toHaveLength(1);
        expect(holders[0]?.id).toBe(firstResult.subscription.id);
        expect(holders[0]?.userId).toBe(firstResult.student.id);
        expect(holders[0]?.reference).toBe(first.paymentReference);
      });
    });

    test("two onboardings mint pairwise-distinct handshake codes", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);

        const first = await StudentOnboardingService.onboardStudentWithOfflinePayment(
          buildOnboardInput({ planId: plan.id }),
          adminId,
          "en",
          tx
        );
        const second = await StudentOnboardingService.onboardStudentWithOfflinePayment(
          buildOnboardInput({ planId: plan.id }),
          adminId,
          "en",
          tx
        );

        expect(first.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
        expect(second.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
        expect(first.handshakeCode).not.toBe(second.handshakeCode);
      });
    });
  });

  describe("tier 4 — chaos and audit-vocabulary abuse probes", () => {
    test("a vanished-row response from the guarded parent link fails the transaction loud with zero residue", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const parentId = await createParentWithRow(tx);
        const input = buildOnboardInput({ planId: plan.id, paymentMethod: PaymentGateway.BankTransfer, parentId });
        const before = await snapshotWriteCounts(
          tx,
          attemptAnchors({ actorId: adminId, inputs: [input], planIds: [plan.id] })
        );
        trackSpy(spyOn(StudentRepository, "linkParentIfUnlinked").mockImplementation(async () => null));

        const error = await expectServiceError(() =>
          StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx)
        );

        // A fresh student row cannot carry a parent link — the zero-row
        // collapse is an invariant breach that must surface as the typed
        // conflict and roll back EVERYTHING (identity stage included).
        expect(error).toBeInstanceOf(ConflictError);
        expect(error.message).toBe(translations().errorsTranslations.conflict);
        await expectZeroMovement(tx, before);
      });
    });

    test("the audit details never carry identity or credential material", async () => {
      await runInRollback(async tx => {
        const adminId = await createAdmin(tx);
        const plan = await createLaneBearingPlan(tx);
        const input = buildOnboardInput({ planId: plan.id });

        const result = await StudentOnboardingService.onboardStudentWithOfflinePayment(input, adminId, "en", tx);

        const auditProbes = await Promise.all([
          readAuditsForEntity(tx, USER_ENTITY, result.student.id),
          readAuditsForEntity(tx, SUBSCRIPTION_ENTITY, result.subscription.id),
        ]);
        for (const row of auditProbes.flat()) {
          const details = row.details ?? "";
          expect(details.length).toBeLessThanOrEqual(2000);
          expect(details).not.toContain(input.email);
          expect(details).not.toContain(input.fullName);
          expect(details).not.toContain(ONBOARDED_CREDENTIAL);
          expect(details).not.toContain(input.phone);
        }
      });
    });
  });
});
