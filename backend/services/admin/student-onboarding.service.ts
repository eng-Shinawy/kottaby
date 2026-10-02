/**
 * StudentOnboardingService — the admin direct-onboarding flow: one gated
 * call provisions a student identity AND activates a plan subscription
 * with an admin-recorded offline payment, atomically.
 *
 * Write set (exactly five tables, ONE transaction):
 *  `users` + `students` (through the shared user-creation single writer,
 *  which also mints the user audit `Create` row), the optional
 *  `students.parent_id` link, the `active` subscription with its offline
 *  payment evidence, the student↔subscription junction row, and the
 *  subscription audit `Create` row — two audit rows total per committed
 *  onboarding, both attributed to the acting admin. The `student_payments`
 *  ledger is never touched: this flow records already-collected money as
 *  subscription evidence columns, not as ledger rows.
 *
 * Denial ladder (every denial is ZERO-write and ZERO-audit — the guard
 * pre-checks run BEFORE the transaction opens):
 *  - anonymous actor → `UnauthorizedError`; non-admin actor →
 *    `ForbiddenError` (the defense-in-depth BFLA gate);
 *  - gateway payment method → localized validation error (the offline
 *    whitelist is the flow's own gate; gateway members belong to the
 *    checkout lifecycle);
 *  - payment reference empty/over-length after trim → localized
 *    validation error (the reference is required for every offline
 *    method — it is the human idempotency token);
 *  - unknown plan → `PLAN_NOT_FOUND`; inactive plan or a plan without a
 *    configured balance lane → localized validation error (fail-closed —
 *    the flow never guesses a credit lane);
 *  - unknown parent user → `USER_NOT_FOUND`; non-parent role or a parent
 *    user without its role-child row → localized validation error;
 *  - duplicate email and duplicate payment reference are arbitrated by
 *    their UNIQUE constraints inside the transaction (never a pre-check
 *    SELECT) and surface as localized conflicts.
 *
 * Disciplines: field-by-field input mapping (no spread of a caller
 * payload ever reaches a write path); `tx` propagated to EVERY repository
 * call; expected rejections logged via `logger.logDomainError` (never
 * `console.*`); all copy resolved through the one-argument
 * `getServerTranslations(locale)` compile-time tree; the returned student
 * detail is a same-transaction fresh read, so it reflects the parent
 * link, the active subscription, and the credited lane.
 */

import {
  ParentRepository,
  PlanRepository,
  StudentRepository,
  SubscriptionRepository,
  UserRepository,
} from "@/backend/db/repo";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError, translateDbError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  assertLinkableParent,
  assertOfflinePaymentMethod,
  assertOnboardablePlan,
  buildOnboardAuditDetails,
  buildOnboardSubscriptionInsert,
  mapToCreateUserInput,
  normalizePaymentReference,
  type OnboardablePlan,
} from "@/backend/services/admin/student-onboarding.helpers";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import {
  buildSubscriptionAuditContract,
  subscriptionCreditLaneMemberOf,
  toSubscriptionAdminReturnType,
} from "@/backend/services/billing/subscription-admin.helpers";
import type {
  AdminOnboardStudentReturnType,
  AdminOnboardStudentSubmitInput,
  AdminStudentSnapshotReturnType,
  AdminUserDetailReturnType,
  DBTransaction,
  SubscriptionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** Entity label passed to `NotFoundError` — yields code `PLAN_NOT_FOUND`. */
const PLAN_ENTITY = "PLAN";

/** Entity label passed to `NotFoundError` — yields code `USER_NOT_FOUND`. */
const USER_ENTITY = "USER";

/** The label slices the flow's private guards need, resolved once per call. */
interface OnboardingCopy {
  readonly tErrors: ErrorsLabels;
  readonly tOnboarding: StudentOnboardingLabels;
}

/**
 * Pre-transaction plan guard: resolves the plan row (unknown id ⇒
 * `PLAN_NOT_FOUND`) and asserts it is catalog-active with a configured
 * balance lane (localized validation denials, fail-closed on the lane).
 */
async function findOnboardablePlan(
  planId: number,
  copy: OnboardingCopy,
  outerTx?: DBTransaction
): Promise<OnboardablePlan> {
  const plan = await PlanRepository.findById(planId, outerTx);
  if (!plan) {
    logger.logDomainError("Student onboarding denied: plan not found", {
      code: "PLAN_NOT_FOUND",
      entity: "plans",
      entityId: planId,
    });
    throw new NotFoundError(PLAN_ENTITY, copy.tErrors.planCatalog.planNotFound);
  }
  assertOnboardablePlan(plan, copy.tOnboarding.errors);
  return plan;
}

/**
 * Pre-transaction parent-target guard: the referenced user must exist
 * (unknown id ⇒ `USER_NOT_FOUND`), carry the parent role, and own the
 * `parents` role-child row the guarded link writes against.
 */
async function assertParentAssociationTarget(
  parentId: number,
  copy: OnboardingCopy,
  outerTx?: DBTransaction
): Promise<void> {
  const parentUser = await UserRepository.findById(parentId, outerTx);
  if (!parentUser) {
    logger.logDomainError("Student onboarding denied: parent user not found", {
      code: "USER_NOT_FOUND",
      entity: "user",
      entityId: parentId,
    });
    throw new NotFoundError(USER_ENTITY, copy.tErrors.adminUsers.userNotFound);
  }
  const parentsRow = await ParentRepository.findById(parentId, outerTx);
  assertLinkableParent(parentUser, parentsRow, copy.tOnboarding.errors);
}

/** The in-transaction plan snapshot plus its resolved credit-lane member. */
interface InTxPlan {
  readonly plan: Pick<OnboardablePlan, "id" | "intervalDays" | "sessionCount">;
  readonly lane: SubscriptionCreditLane;
}

/**
 * In-transaction authoritative plan re-read (the advisory pre-tx read
 * does not anchor the writes): the window arithmetic and the credit key
 * on the transaction's own snapshot, so a concurrent deactivation
 * serializes behind this read instead of slipping through stale state.
 *
 * @returns The re-verified plan plus its resolved credit-lane member.
 */
async function resolveInTxPlan(planId: number, copy: OnboardingCopy, tx: DBTransaction): Promise<InTxPlan> {
  const plan = await PlanRepository.findById(planId, tx);
  if (!plan) {
    logger.logDomainError("Student onboarding denied: plan vanished before the in-transaction re-read", {
      code: "PLAN_NOT_FOUND",
      entity: "plans",
      entityId: planId,
    });
    throw new NotFoundError(PLAN_ENTITY, copy.tErrors.planCatalog.planNotFound);
  }
  assertOnboardablePlan(plan, copy.tOnboarding.errors);
  const lane = subscriptionCreditLaneMemberOf(plan.balanceLane, copy.tErrors);
  return { plan, lane };
}

/**
 * Guards the optional parent link: a freshly created student row cannot
 * carry a parent link, so a zero-row guarded update is an invariant
 * breach, not a lost race — fail loud and roll the transaction back.
 */
async function linkParentOrFail(
  studentUserId: number,
  parentId: number,
  copy: OnboardingCopy,
  tx: DBTransaction
): Promise<void> {
  const linked = await StudentRepository.linkParentIfUnlinked(studentUserId, parentId, tx);
  if (!linked) {
    logger.logDomainError("Student onboarding failed: fresh student row rejected the guarded parent link", {
      code: "CONFLICT",
      entity: "students",
      entityId: studentUserId,
    });
    throw new ConflictError(copy.tErrors.conflict);
  }
}

/**
 * Settles the subscription-side writes in order: the offline-twin insert
 * (active row with the recorded payment evidence — a duplicate reference
 * arbitrates through the partial unique index), the lane credit of
 * exactly one session count, and the junction row.
 *
 * @returns The freshly inserted subscription row.
 */
async function settleOfflineSubscription(options: {
  readonly studentUserId: number;
  readonly plan: Pick<OnboardablePlan, "id" | "intervalDays" | "sessionCount">;
  readonly lane: SubscriptionCreditLane;
  readonly input: AdminOnboardStudentSubmitInput;
  readonly paymentReference: string;
  readonly onboardingInstant: Date;
  readonly copy: OnboardingCopy;
  readonly tx: DBTransaction;
}): Promise<SubscriptionSelectType> {
  const subscription = await SubscriptionRepository.insertSubscription(
    buildOnboardSubscriptionInsert(
      options.studentUserId,
      { id: options.plan.id, intervalDays: options.plan.intervalDays, balanceLane: options.lane },
      { paymentMethod: options.input.paymentMethod, paymentReference: options.paymentReference },
      options.onboardingInstant
    ),
    options.tx
  );

  const credited = await StudentRepository.creditLaneBalance(
    options.studentUserId,
    options.lane,
    options.plan.sessionCount,
    options.tx
  );
  if (!credited) {
    logger.logDomainError("Student onboarding failed: student row vanished before the lane credit", {
      code: "USER_NOT_FOUND",
      entity: "students",
      entityId: options.studentUserId,
    });
    throw new NotFoundError(USER_ENTITY, options.copy.tErrors.adminUsers.userNotFound);
  }

  await options.tx.insert(studentSubscriptions).values({
    studentId: options.studentUserId,
    subscriptionId: subscription.id,
  });

  return subscription;
}

/** The fresh detail plus its guaranteed student snapshot. */
interface FreshStudentDetail {
  readonly detail: AdminUserDetailReturnType;
  readonly snapshot: AdminStudentSnapshotReturnType;
}

/**
 * Freshens the student detail at the end of the write sequence: the
 * returned snapshot reflects the parent link, the active subscription,
 * and the credited balance — the read-back surfaces never lag the
 * committed writes.
 */
async function resolveFreshStudentDetail(
  studentUserId: number,
  actorId: number,
  locale: string,
  copy: OnboardingCopy,
  tx: DBTransaction
): Promise<FreshStudentDetail> {
  const detail = await AdminUserManagementService.getUserDetail(studentUserId, locale, actorId, tx);
  const snapshot = detail.student;
  if (!snapshot) {
    logger.logDomainError("Student onboarding failed: fresh student detail carries no student snapshot", {
      code: "USER_NOT_FOUND",
      entity: "students",
      entityId: studentUserId,
    });
    throw new NotFoundError(USER_ENTITY, copy.tErrors.adminUsers.userNotFound);
  }
  return { detail, snapshot };
}

export namespace StudentOnboardingService {
  /**
   * Onboards one student with an offline-settled plan activation.
   *
   * `actorId` is the acting admin (typed parameter — the GraphQL layer
   * injects `ctx.user.id`, never client input). `outerTx` is the
   * composition seam: when provided, every write joins the caller's
   * transaction as a savepoint; otherwise the flow commits its own
   * top-level transaction.
   *
   * @returns The fresh student detail, the active subscription with its
   *   recorded offline payment evidence, the plan lane credited, the
   *   session count credited, and the minted handshake code.
   */
  export async function onboardStudentWithOfflinePayment(
    input: AdminOnboardStudentSubmitInput,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminOnboardStudentReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const t = getServerTranslations(locale);
    const copy: OnboardingCopy = { tErrors: t.errorsTranslations, tOnboarding: t.studentOnboardingTranslations };

    // ── Pre-transaction guards (zero writes on any denial) ────────────────

    assertOfflinePaymentMethod(input.paymentMethod, copy.tOnboarding.errors);
    const paymentReference = normalizePaymentReference(input.paymentReference, copy.tOnboarding.errors);
    await findOnboardablePlan(input.planId, copy, outerTx);
    if (input.parentId !== null && input.parentId !== undefined) {
      await assertParentAssociationTarget(input.parentId, copy, outerTx);
    }

    // ── ONE transaction — every repository call receives tx ───────────────

    try {
      return await withTransaction(outerTx, async tx => {
        // Identity stage through the user-creation single writer: users
        // row, students row with the in-tx handshake-collision retry and
        // NO trial grant, the user audit Create row, and the same-tx
        // detail read. Duplicate email arbitrates through the email
        // unique constraint → localized conflict.
        const created = await AdminUserManagementService.createUser(mapToCreateUserInput(input), actorId, locale, tx);
        const studentUserId = created.id;

        const { plan, lane } = await resolveInTxPlan(input.planId, copy, tx);
        const onboardingInstant = new Date();

        if (input.parentId !== null && input.parentId !== undefined) {
          await linkParentOrFail(studentUserId, input.parentId, copy, tx);
        }

        const subscription = await settleOfflineSubscription({
          studentUserId,
          plan,
          lane,
          input,
          paymentReference,
          onboardingInstant,
          copy,
          tx,
        });

        // Audit row #2 (the user Create row was minted inside createUser):
        // ids/enums/counts only — never contact fields or credentials.
        await AuditService.createAuditLog(
          buildSubscriptionAuditContract(
            actorId,
            AuditActionType.Create,
            subscription.id,
            buildOnboardAuditDetails({
              studentUserId,
              planId: plan.id,
              parentId: input.parentId ?? null,
              paymentMethod: input.paymentMethod,
              paymentReference,
              creditedLane: lane,
              creditedSessions: plan.sessionCount,
            })
          ),
          tx
        );

        const { detail, snapshot } = await resolveFreshStudentDetail(studentUserId, actorId, locale, copy, tx);

        return {
          student: detail,
          subscription: toSubscriptionAdminReturnType(subscription, copy.tErrors),
          creditedLane: lane,
          creditedSessions: plan.sessionCount,
          handshakeCode: snapshot.handshakeCode,
        };
      });
    } catch (error) {
      // Duplicate payment reference (23505 on the partial unique) →
      // localized conflict. DomainErrors — createUser's email conflict,
      // the handshake budget, every typed denial above — pass through
      // untranslated.
      throw translateDbError(error, copy.tOnboarding.errors.duplicateReference);
    }
  }
}
