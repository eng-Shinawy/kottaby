/**
 * Admin user-management mappers — raw DB row → canonical return-shape
 * projections, extracted VERBATIM from `user-management.service.ts`
 * (behavior-identical extraction; zero logic change). The `assembleDetail`
 * role-child snapshots live in dedicated builders so each function honors
 * the line-count limit. See `docs/admin/user-management.md`.
 */
import type {
  AdminUserActivityRow,
  AdminUserDetailRow,
  AdminUserDirectoryRow,
  AdminUserStatsRow,
} from "@/backend/db/repo/admin/admin-user.repository";
import { ApplicantStatus, isApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { toGender } from "@/backend/enum/users/gender.enum";
import { toUserRole } from "@/backend/enum/users/user-role.enum";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { toAuditActionType } from "@/backend/services/admin/admin-gate.helpers";
import { normalizeDateOnly, projectChangedFields } from "@/backend/services/admin/user-management.helpers";
import type {
  AdminUserActivityEntryReturnType,
  AdminUserDetailReturnType,
  AdminUserListItemReturnType,
  AdminUserStatsReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Maps a raw directory-wide stats row to the canonical overview return
 * shape (total / governance / role counters + new-this-week count).
 */
export function mapStatsRow(row: AdminUserStatsRow): AdminUserStatsReturnType {
  return {
    totalCount: row.totalCount,
    activeCount: row.activeCount,
    suspendedCount: row.suspendedCount,
    blockedCount: row.blockedCount,
    deletedCount: row.deletedCount,
    adminsCount: row.adminsCount,
    teachersCount: row.teachersCount,
    studentsCount: row.studentsCount,
    parentsCount: row.parentsCount,
    newThisWeekCount: row.newThisWeekCount,
  };
}

/**
 * Maps a raw directory DB row to the canonical directory list return shape.
 * Null-coalesces governance booleans (`?? false`) and guard-validates the
 * stored applicant status (`isApplicantStatus`) — corrupt stored values
 * fail-closed with `APPLICANT_STATUS_CORRUPT`.
 */
export function mapDirectoryRow(row: AdminUserDirectoryRow, locale: string): AdminUserListItemReturnType {
  const tErrors = getServerTranslations(locale).errorsTranslations;

  const role = toUserRole(row.role);
  if (role === null) {
    logger.logDomainError("Directory row carries a corrupt role value", {
      code: "INTERNAL_SERVER_ERROR",
      entity: "user",
      entityId: row.id,
    });
    throw new Error(`Unexpected user role in stored data: ${row.role}`);
  }

  let applicantStatus: ApplicantStatus | null = null;
  if (row.applicantStatus !== null) {
    if (!isApplicantStatus(row.applicantStatus)) {
      logger.logDomainError("Directory row carries a corrupt applicant status", {
        code: "APPLICANT_STATUS_CORRUPT",
        entity: "user",
        entityId: row.id,
      });
      throw new ValidationError("APPLICANT_STATUS_CORRUPT", tErrors.applicantStatusCorrupt);
    }
    applicantStatus = row.applicantStatus;
  }

  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    role,
    gender: row.gender === null ? null : (toGender(row.gender) ?? null),
    dateOfBirth: normalizeDateOnly(row.dateOfBirth),
    country: row.country,
    isDeleted: row.isDeleted ?? false,
    suspended: row.suspended ?? false,
    isBlocked: row.isBlocked ?? false,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    applicantStatus,
    teacherIsApproved: row.teacherIsApproved,
    teacherIsEvaluator: row.teacherIsEvaluator,
    studentHasParentLink: row.studentHasParentLink,
    studentHasActiveSubscription: row.studentHasActiveSubscription,
    parentLinkedChildrenCount: row.parentLinkedChildrenCount,
  };
}

/**
 * Builds the applicant role-child snapshot. Guard-validated via
 * `isApplicantStatus` (fail-closed on corrupt stored values).
 */
function buildApplicantSnapshot(row: AdminUserDetailRow, locale: string): AdminUserDetailReturnType["applicant"] {
  if (row.applicantStatus === null) {
    return null;
  }
  const tErrors = getServerTranslations(locale).errorsTranslations;
  if (!isApplicantStatus(row.applicantStatus)) {
    logger.logDomainError("Detail row carries a corrupt applicant status", {
      code: "APPLICANT_STATUS_CORRUPT",
      entity: "user",
      entityId: row.id,
    });
    throw new ValidationError("APPLICANT_STATUS_CORRUPT", tErrors.applicantStatusCorrupt);
  }
  return {
    id: row.id,
    status: row.applicantStatus,
    verificationAttempts: row.applicantVerificationAttempts ?? 0,
    lastAttemptAt: row.applicantLastAttemptAt,
    cooldownUntil: row.applicantCooldownUntil,
    cooldownActive: false,
    canPurchaseVerification: row.applicantStatus !== ApplicantStatus.Passed,
  };
}

/**
 * Builds the teacher role-child snapshot; `null` when no teacher markers
 * are present on the row.
 */
function buildTeacherSnapshot(row: AdminUserDetailRow): AdminUserDetailReturnType["teacher"] {
  return row.teacherIsApproved === null && row.teacherIsEvaluator === null
    ? null
    : {
        isApproved: row.teacherIsApproved ?? false,
        isEvaluator: row.teacherIsEvaluator ?? false,
        isOnline: row.teacherIsOnline ?? false,
        averageRating: row.teacherAverageRating,
      };
}

/**
 * Builds the student role-child snapshot; `null` when no handshake-code
 * marker is present on the row.
 */
function buildStudentSnapshot(row: AdminUserDetailRow): AdminUserDetailReturnType["student"] {
  return row.studentHandshakeCode === null
    ? null
    : {
        handshakeCode: row.studentHandshakeCode,
        parentId: row.studentParentId,
        primaryLanguage: row.studentPrimaryLanguage,
        anotherLanguage: row.studentAnotherLanguage,
        hasParentLink: row.studentParentId !== null,
        hasActiveSubscription: row.studentHasActiveSubscription ?? false,
        balanceHifz: row.studentBalanceHifz,
        balanceTajweed: row.studentBalanceTajweed,
        balanceReviews: row.studentBalanceReviews,
        balanceTrial: null,
        trialGrantedAt: null,
      };
}

/**
 * Builds the parent role-child snapshot; `null` when no parent row exists.
 */
function buildParentSnapshot(row: AdminUserDetailRow): AdminUserDetailReturnType["parent"] {
  return row.parentRowExists === null || !row.parentRowExists
    ? null
    : {
        linkedChildrenCount: row.parentLinkedChildrenCount ?? 0,
      };
}

/**
 * Assembles the canonical admin detail return shape from a raw detail DB row.
 * Role-child snapshot objects are populated per the user's role; slots for
 * absent role-child rows stay `null`. The applicant status is
 * guard-validated via `isApplicantStatus` (fail-closed on corrupt values).
 */
export function assembleDetail(row: AdminUserDetailRow, locale: string): AdminUserDetailReturnType {
  const role = toUserRole(row.role);
  if (role === null) {
    logger.logDomainError("Detail row carries a corrupt role value", {
      code: "INTERNAL_SERVER_ERROR",
      entity: "user",
      entityId: row.id,
    });
    throw new Error(`Unexpected user role in stored data: ${row.role}`);
  }

  const applicant = buildApplicantSnapshot(row, locale);
  const teacher = buildTeacherSnapshot(row);
  const student = buildStudentSnapshot(row);
  const parent = buildParentSnapshot(row);

  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    role,
    dateOfBirth: normalizeDateOnly(row.dateOfBirth),
    gender: row.gender,
    country: row.country,
    isDeleted: row.isDeleted ?? false,
    deletedAt: row.deletedAt,
    suspended: row.suspended ?? false,
    suspendedAt: row.suspendedAt,
    suspendedPeriodDays: row.suspendedPeriodDays,
    isBlocked: row.isBlocked ?? false,
    blockedAt: row.blockedAt,
    lastActiveAt: row.lastActiveAt,
    locale: row.locale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    applicant,
    teacher,
    student,
    parent,
  };
}

/**
 * Maps a raw `audit_logs` activity row to the canonical activity-timeline
 * entry. Fail-closed on a corrupt stored enum value — surfaces as a
 * resolver error rather than an unsafe cast.
 */
export function mapActivityRow(row: AdminUserActivityRow): AdminUserActivityEntryReturnType {
  const actionType = toAuditActionType(row.actionType);
  if (actionType === null) {
    // Fail-closed on a corrupt stored enum value — surfaces as a
    // resolver error rather than an unsafe cast.
    throw new Error(`Unexpected audit action type: ${row.actionType}`);
  }
  return {
    id: row.id,
    actionType,
    actorName: row.actorName ?? "",
    changedFields: projectChangedFields(row.details),
    createdAt: row.createdAt,
  };
}
