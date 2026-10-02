/**
 * User-management ACTIVITY helpers — both extracted tiers of the admin
 * recent-activity pipeline, colocated so the service and the helpers
 * modules each stay inside the repo's oxlint `max-lines` budget:
 *  - the caption tier: the pure audit-`details` readers
 *    (`projectChangedFields`, `composeActivityCaption`) extracted verbatim
 *    from `user-management.helpers.ts` (behavior-identical move; zero
 *    logic change — only a new home for the timeline caption tier).
 *  - the read tier: the per-user audit-timeline loader
 *    (`loadUserActivityTimeline`) extracted VERBATIM from
 *    `AdminUserManagementService.getUserActivity`. The service namespace
 *    wrapper keeps the BFLA actor gate, the defensive id validation, and
 *    the limit resolution; this module owns everything AFTER those guards:
 *    existence re-check (honest `USER_NOT_FOUND`), the bounded repo read,
 *    and the locale-bound caption composition over the RAW details (the
 *    wire never carries them — BOPLA).
 */
import { AdminUserRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { mapActivityRow } from "@/backend/services/admin/user-management.mappers";
import type { AdminUserActivityEntryReturnType, DBTransaction } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Defensively projects the `changedFields` array out of a raw audit
 * `details` JSON string. Returns `null` for every non-conforming shape
 * (unparseable JSON, non-object root, missing key, non-array value, or a
 * fully-filtered non-string member set) — the timeline still renders the
 * action + actor + timestamp. Only string members survive; nothing is
 * echoed unvalidated (BOPLA discipline on read-back).
 */
export function projectChangedFields(details: string | null): readonly string[] | null {
  if (!details) return null;
  try {
    const parsed: unknown = JSON.parse(details);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = (parsed as { changedFields?: unknown }).changedFields;
    if (!Array.isArray(candidate)) return null;
    const fields = candidate.filter((entry): entry is string => typeof entry === "string");
    return fields.length > 0 ? fields : null;
  } catch {
    return null;
  }
}

/** Positive-integer day-count guard for caption payload members (null otherwise). */
function captionDaysOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** Per-action override caption; a rejecting override appends its stamped cooldown length. */
function overrideCaptionOf(record: Record<string, unknown>, labels: AdminUsersLabels["activity"]): string | null {
  if (record.action === "certify") return labels.captionCertify;
  if (record.action === "grant_re_evaluation") return labels.captionGrantReEvaluation;
  if (record.action !== "reject") return null;
  const days = captionDaysOf(record.cooldownDays);
  return days === null ? labels.captionReject : `${labels.captionReject} · ${labels.captionCooldownDays(days)}`;
}

/**
 * Narrows an unknown parsed member to a plain object (arrays excluded).
 * The `no-unsafe-type-assertion`-compliant escape hatch (same `value is Type`
 * predicate pattern as `backend/db/client.ts`): the JSON.parse result is
 * runtime-validated here instead of trusted via an `as Record<string, unknown>`
 * cast, preserving the exact checks the previous assertion implicitly relied on.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Composes the human-readable caption for one recent-activity timeline
 * entry from its raw audit `details` JSON — the localized rendering of the
 * teacher-applicant lifecycle payloads (cooldown extension, evaluation
 * override) that carry no `changedFields` key.
 *
 * Recognized shapes (the audit writers' own contracts):
 *  - an Override row whose `action` is `certify` / `reject` /
 *    `grant_re_evaluation` → the per-action caption; a rejecting override
 *    additionally appends the stamped cooldown length when its
 *    `cooldownDays` is a positive integer.
 *  - an Adjust row whose `additionalDays` is a positive integer → the
 *    cooldown-extension caption.
 * Any other action type, malformed / truncated / non-object JSON, unknown
 * action values, or non-numeric day members degrade to `null` — the
 * timeline renders the action label + actor + timestamp regardless (BOPLA
 * on read-back: never echo unvalidated payload shapes). The `user`-entity
 * Update rows already surface their `changedFields` list, so they stay
 * captionless here.
 */
function composeActivityCaption(
  details: string | null,
  actionType: AuditActionType,
  labels: AdminUsersLabels["activity"]
): string | null {
  if (!details) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const record = parsed;
  if (actionType === AuditActionType.Override) return overrideCaptionOf(record, labels);
  if (actionType === AuditActionType.Adjust) {
    const days = captionDaysOf(record.additionalDays);
    return days === null ? null : labels.captionCooldownExtended(days);
  }
  return null;
}

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
