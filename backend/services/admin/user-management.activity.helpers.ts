/**
 * Admin user-management ACTIVITY read helper — the per-user audit-timeline
 * loader extracted VERBATIM from `AdminUserManagementService.getUserActivity`
 * (behavior-identical extraction; zero logic change) so the service module
 * stays within the repo's `max-lines` lint tier. The service namespace
 * wrapper keeps the BFLA actor gate, the defensive id validation, and the
 * limit resolution; this module owns everything AFTER those guards:
 * existence re-check (honest `USER_NOT_FOUND`), the bounded repo read, and
 * the locale-bound caption composition over the RAW details (the wire never
 * carries them — BOPLA).
 */
import { AdminUserRepository } from "@/backend/db/repo";
import { NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { composeActivityCaption } from "@/backend/services/admin/user-management.helpers";
import { mapActivityRow } from "@/backend/services/admin/user-management.mappers";
import type { AdminUserActivityEntryReturnType, DBTransaction } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Entity label passed to `NotFoundError` — yields code `USER_NOT_FOUND`. */
const USER_ENTITY = "USER";

/**
 * Loads + maps the newest-first `audit_logs` rows recorded ABOUT the target
 * user (`entity_type = 'user' AND entity_id = :userId`) with the acting
 * admin's display name and the defensively projected `changedFields` list
 * per entry. A missing id logs (ids + codes only — no PII) and throws
 * `NotFoundError(USER_ENTITY, …)` → `USER_NOT_FOUND` (same contract as
 * `getUserDetail`).
 */
export async function loadUserActivityTimeline(
  userId: number,
  locale: string,
  resolvedLimit: number,
  outerTx?: DBTransaction
): Promise<AdminUserActivityEntryReturnType[]> {
  const userExists = await AdminUserRepository.existsById(userId, outerTx);
  if (!userExists) {
    logger.logDomainError("Admin user activity lookup: user not found", {
      code: "USER_NOT_FOUND",
      entity: "user",
      entityId: userId,
    });
    throw new NotFoundError(USER_ENTITY, getServerTranslations(locale).errorsTranslations.adminUsers.userNotFound);
  }

  const rows = await AdminUserRepository.getActivity(userId, resolvedLimit, outerTx);
  // Locale-bound caption composition runs over the RAW details (the wire
  // never carries them — BOPLA): applicant lifecycle rows surface a human
  // caption, everything else stays captionless.
  const activityLabels = getServerTranslations(locale).adminUsersTranslations.activity;
  return rows.map(row => {
    const entry = mapActivityRow(row);
    // `Object.assign` builds the captioned entry (the no-map-spread-
    // compliant form of `{ ...entry, caption }` — identical keys/values,
    // one fresh object per row, the uncaptioned mapper output discarded).
    return Object.assign({}, entry, {
      caption: composeActivityCaption(row.details, entry.actionType, activityLabels),
    });
  });
}
