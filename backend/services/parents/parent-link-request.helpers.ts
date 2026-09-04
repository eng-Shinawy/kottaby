/**
 * Module-private helpers for `ParentLinkRequestService`.
 *
 * Extracted from the service file to honor the repo's max-lines budgets
 * (oxlint `max-lines` 300 / `max-lines-per-function` 75 — see
 * `oxlint.config.mts`); every function here is an implementation detail of
 * the parent-link request workflow and is deliberately NOT re-exported by
 * the `parents` barrel (the public surface stays
 * `ParentLinkRequestService.{requestLink, respondToLinkRequest,
 * cancelLinkRequest, listMyOutgoing, listMyIncoming}`).
 *
 * Conventions follow the repo's service-helper precedent
 * (`shared/user-provisioning.helpers.ts`, `students/student-handshake.helpers.ts`):
 * pure orchestration over repositories + the notification engine, localized
 * copy via `getServerTranslations`, bounded `logDomainError` contexts, and
 * cross-layer imports only via `@/backend/db/repo` (repos) — never raw
 * schema/table access.
 */
import {
  type IncomingParentLinkRequestRow,
  type OutgoingParentLinkRequestRow,
  ParentLinkRequestRepository,
  StudentRepository,
  UserRepository,
} from "@/backend/db/repo";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { isLinkStatus, LinkStatus } from "@/backend/enum/shared/link-status.enum";
import { toUserRole, type UserRole } from "@/backend/enum/users/user-role.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  NotificationEngine,
  type NotificationEngineCallOptions,
} from "@/backend/services/notifications/notification-engine.service";
import { isUniqueViolation } from "@/backend/services/shared/user-provisioning.helpers";
import { isGovernanceExcludedFromDiscovery } from "@/backend/services/students/student-handshake.helpers";
import type {
  DBQueryExecutor,
  DBTransaction,
  IncomingParentLinkRequestReturnType,
  NotificationDeliveryReceipt,
  NotificationReturnType,
  OutgoingParentLinkRequestReturnType,
  ParentLinkRequestSelectType,
  UserSelectType,
} from "@/backend/types";
import { PARENT_LINK_REQUEST_MS } from "@/shared/constants/parent-link-request.constants";
import { maskFullName } from "@/shared/lib/mask-full-name";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Entity label passed to `NotFoundError` — the code is auto-generated as
 * `PARENT_LINK_REQUEST_NOT_FOUND` (entity name, never the full code).
 */
export const PARENT_LINK_REQUEST_ENTITY = "PARENT_LINK_REQUEST";

/** Literal `related_entity_type` for every parent-link notification. */
export const PARENT_LINK_RELATED_ENTITY_TYPE = "parent_link_request";

/**
 * The three zero-row claim/withdrawal collapse verdicts — classified
 * READ-ONLY inside the transaction unit (no-oracle collapse: missing ≡ foreign).
 */
export type UnclaimableDenial = "not-found" | "already-resolved" | "expired";

/** Internal insert outcome for `requestLink`'s transaction unit (the pipeline's discovery-through-insert steps). */
export type PendingInsertOutcome = {
  created: ParentLinkRequestSelectType;
  studentId: number;
  targetFullName: string;
};

/** Internal emit outcome — the in-tx receipt plus the resolved recipient locale. */
export type RequestEmitOutcome = { receipt: NotificationDeliveryReceipt; recipientLocale: string };

/**
 * `requestLink`'s transaction unit, first half (everything up to the
 * insert): target discovery by handshake code, the null-collapse
 * (missing ≡ governed — byte-identical `null`, zero rows/notifications/
 * publishes), the already-linked and already-pending conflicts, the
 * field-by-field insert wrapped in the 23505 cause-chain traversal (the
 * partial unique index is the duplicate-pending race arbiter).
 *
 * ONE captured `now` governs the discovery liveness check AND the derived
 * `expiresAt` (`now + PARENT_LINK_REQUEST_MS`) — deterministic within the
 * call. Any non-23505 repository failure propagates unmasked.
 */
export async function insertPendingRequestTx(
  normalizedCode: string,
  parentActorId: number,
  locale: string,
  tx: DBTransaction
): Promise<PendingInsertOutcome | null> {
  const t = getServerTranslations(locale).errorsTranslations;
  const now = new Date(); // ONE captured instant for this call.

  const target = await StudentRepository.findLinkTargetByHandshakeCode(normalizedCode, tx);
  if (target === null || isGovernanceExcludedFromDiscovery(target, now)) {
    // Null collapse — a missing code and a governed child are the
    // SAME null: zero rows, zero notifications, zero publishes.
    return null;
  }

  if (target.parentId !== null) {
    logger.logDomainError("Parent-link request rejected: target student is already linked", {
      code: "PARENT_LINK_TARGET_ALREADY_LINKED",
      entity: "students",
      entityId: target.studentId,
      locale,
    });
    throw new ConflictError("PARENT_LINK_TARGET_ALREADY_LINKED", t.parentLinkTargetAlreadyLinked);
  }

  const pending = await ParentLinkRequestRepository.findPendingByPair(parentActorId, target.studentId, tx);
  if (pending !== null) {
    logger.logDomainError("Parent-link request rejected: a live pending request already exists for the pair", {
      code: "PARENT_LINK_ALREADY_PENDING",
      entity: "parent_link_requests",
      entityId: pending.id,
      locale,
    });
    throw new ConflictError("PARENT_LINK_ALREADY_PENDING", t.parentLinkAlreadyPending);
  }

  let created: ParentLinkRequestSelectType;
  try {
    created = await ParentLinkRequestRepository.create(
      {
        parentId: parentActorId,
        studentId: target.studentId,
        expiresAt: new Date(now.getTime() + PARENT_LINK_REQUEST_MS),
      },
      tx
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The partial unique index is the final arbiter of the
      // duplicate-pending race — the losing insert maps to the SAME
      // conflict as the pre-check.
      logger.logDomainError("Parent-link request rejected: duplicate pending lost on the unique arbiter", {
        code: "PARENT_LINK_ALREADY_PENDING",
        entity: "parent_link_requests",
        locale,
      });
      throw new ConflictError("PARENT_LINK_ALREADY_PENDING", t.parentLinkAlreadyPending);
    }
    // Any other repository failure is NOT a domain conflict — it
    // propagates unmasked (never swallowed into a domain shape).
    throw error;
  }

  return { created, studentId: target.studentId, targetFullName: target.fullName };
}

/**
 * `requestLink`'s transaction unit, second half: the recipient-locale copy
 * composition and the IN-TX `emitForUser` (single-writer notifications —
 * NO publish inside the transaction, engine §3.3/§3.1). The recipient is
 * the student, in the student's persisted locale (`defaultLocale` when
 * unset); the body names the requesting parent (the sanctioned
 * decision-maker disclosure). The publish belongs to the service AFTER its
 * commit — this helper never publishes.
 */
export async function emitRequestNotificationTx(
  studentId: number,
  requestId: number,
  actorFullName: string,
  tx: DBTransaction,
  options?: NotificationEngineCallOptions
): Promise<RequestEmitOutcome> {
  // Recipient locale at the EMITTER (engine §3.3): the student's
  // persisted preference, `defaultLocale` when unset.
  const locales = await UserRepository.findLocalesByIds([studentId], tx);
  const recipientLocale = locales.get(studentId) ?? defaultLocale;
  const recipientCopy = getServerTranslations(recipientLocale).notificationsTranslations;

  const emitted = await NotificationEngine.emitForUser(
    {
      userId: studentId,
      type: NotificationType.ParentLinkRequest,
      title: recipientCopy.eventParentLinkRequestTitle,
      body: recipientCopy.eventParentLinkRequestBody(actorFullName),
      relatedEntityType: PARENT_LINK_RELATED_ENTITY_TYPE,
      relatedEntityId: requestId,
    },
    recipientLocale,
    tx,
    options
  );
  if (!isDeliveryReceipt(emitted)) {
    throw new Error("ParentLinkRequestService.requestLink: in-tx emit returned a row instead of the receipt");
  }

  return { receipt: emitted, recipientLocale };
}

/**
 * Fresh actor re-check — ONE gate used by every mutation and read.
 *
 * Re-resolves the actor with `UserRepository.findById` on the caller's
 * executor (uncommitted rollback-fixture visibility included), then:
 *  - non-positive / non-safe-integer id or missing row → `UnauthorizedError`
 *    (the anonymous sentinel `0` is the production "no session" shape);
 *  - role mismatch → `ForbiddenError`;
 *  - when `enforceGovernance` is set (every MUTATION), a deleted, blocked, or
 *    actively-suspended actor → `ForbiddenError` with the SAME constant copy
 *    and the SAME log fingerprint as the role arm (no branch disclosure).
 *    The relaxed READ path skips the governance arm: a governed actor's
 *    self-scoped history stays visible to him (the lists are self-scoped by
 *    the verified id regardless of request payloads).
 *
 * EVERY denial: exactly ONE bounded `logDomainError` (`entity: "users"`),
 * ZERO writes, ZERO notifications — the check runs before any transaction
 * opens on the mutation paths.
 *
 * The fetched row's `passwordHash` column is structurally present but is
 * NEVER read, logged, or returned — the canonical never-touch-this-field
 * discipline.
 */
export async function requireActor(
  actorId: number,
  expectedRole: UserRole,
  locale: string,
  tx: DBQueryExecutor | undefined,
  enforceGovernance: boolean
): Promise<UserSelectType> {
  const t = getServerTranslations(locale).errorsTranslations;

  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    logger.logDomainError("Parent-link operation denied: unauthenticated actor", {
      code: "UNAUTHORIZED",
      entity: "users",
      entityId: actorId,
      locale,
    });
    throw new UnauthorizedError(t.unauthorized);
  }

  const actor = await UserRepository.findById(actorId, tx);
  if (actor === null) {
    logger.logDomainError("Parent-link operation denied: unauthenticated actor", {
      code: "UNAUTHORIZED",
      entity: "users",
      entityId: actorId,
      locale,
    });
    throw new UnauthorizedError(t.unauthorized);
  }

  if (toUserRole(actor.role) !== expectedRole) {
    logger.logDomainError("Parent-link operation denied: actor failed the re-check", {
      code: "FORBIDDEN",
      entity: "users",
      entityId: actorId,
      locale,
    });
    throw new ForbiddenError(t.forbidden);
  }

  if (enforceGovernance && (actor.isDeleted || actor.isBlocked || actor.suspended)) {
    // Constant copy — the three governed arms are indistinguishable.
    logger.logDomainError("Parent-link operation denied: actor failed the re-check", {
      code: "FORBIDDEN",
      entity: "users",
      entityId: actorId,
      locale,
    });
    throw new ForbiddenError(t.forbidden);
  }

  return actor;
}

/**
 * Classifies a zero-row claim/withdrawal collapse — READ-ONLY (zero writes).
 *
 * `findById` is the oracle: a missing row and a row owned by someone else are
 * the SAME verdict (foreign ≡ nonexistent, byte-shaped, never an
 * id-enumeration oracle); a non-`pending` row is `already-resolved`; a row
 * still `pending` failed ONLY the liveness predicate → `expired`. The stored
 * status passes the fail-closed `toCanonicalLinkStatus` guard BEFORE the
 * comparison (a corrupt value is an internal invariant violation, never a
 * misclassification). The denial itself is raised by `raiseUnclaimableDenial`
 * AFTER the transaction boundary so the expiry fold can survive the
 * throw on the own-commit path.
 */
export async function classifyUnclaimableRequest(
  requestId: number,
  actorId: number,
  direction: "student" | "parent",
  tx: DBTransaction
): Promise<UnclaimableDenial> {
  const row = await ParentLinkRequestRepository.findById(requestId, tx);
  const owned = row !== null && (direction === "student" ? row.studentId === actorId : row.parentId === actorId);
  if (!owned) {
    return "not-found";
  }

  if (toCanonicalLinkStatus(row.status, row.id) !== LinkStatus.Pending) {
    return "already-resolved";
  }

  // Pending but unclaimable ⇒ the strict liveness predicate failed.
  return "expired";
}

/**
 * Raises the classified denial — ALWAYS throws (the resolved type is
 * `never`); exactly ONE `logDomainError` per denial.
 *
 * On the `expired` arm the expiry fold (`markExpiredIfPending`, idempotent
 * by predicate) runs FIRST in a unit that SURVIVES the throw: a fresh
 * committed transaction when this call owns the commit, a savepoint released
 * into the caller's executor otherwise (the caller's commit decides). The
 * fold is the denial's ONLY write — zero rows across `students`,
 * `notifications`, and `audit_logs` on every arm.
 */
export async function raiseUnclaimableDenial(
  requestId: number,
  denial: UnclaimableDenial,
  locale: string,
  outerTx: DBTransaction | undefined
): Promise<never> {
  const t = getServerTranslations(locale).errorsTranslations;

  if (denial === "expired") {
    await withTransaction(outerTx, tx => ParentLinkRequestRepository.markExpiredIfPending(requestId, tx));
    logger.logDomainError("Parent-link transition denied: request expired before the claim", {
      code: "PARENT_LINK_REQUEST_EXPIRED",
      entity: "parent_link_requests",
      entityId: requestId,
      locale,
    });
    throw new ConflictError("PARENT_LINK_REQUEST_EXPIRED", t.parentLinkRequestExpired);
  }

  if (denial === "already-resolved") {
    logger.logDomainError("Parent-link transition denied: request already resolved", {
      code: "PARENT_LINK_REQUEST_ALREADY_RESOLVED",
      entity: "parent_link_requests",
      entityId: requestId,
      locale,
    });
    throw new ConflictError("PARENT_LINK_REQUEST_ALREADY_RESOLVED", t.parentLinkRequestAlreadyResolved);
  }

  logger.logDomainError("Parent-link transition denied: request id does not resolve for the actor", {
    code: "PARENT_LINK_REQUEST_NOT_FOUND",
    entity: "parent_link_requests",
    entityId: requestId,
    locale,
  });
  throw new NotFoundError(PARENT_LINK_REQUEST_ENTITY, t.parentLinkRequestNotFound);
}

/**
 * Assertion-free narrowing of the engine's emit union: the IN-TX branch of
 * `emitForUser` always resolves to the delivery receipt (the row variant is
 * the own-transaction convenience path this service never uses).
 */
export function isDeliveryReceipt(
  value: NotificationDeliveryReceipt | NotificationReturnType
): value is NotificationDeliveryReceipt {
  return "recipientUserIds" in value;
}

/**
 * Fail-closed re-application of the canonical `LinkStatus` mirror over the
 * raw stored value (pgEnum-backed in practice; the guard is defense-in-depth
 * for raw-SQL read paths). A corrupt stored value is an internal invariant
 * violation — it NEVER carries the row's unvalidated status to the wire.
 */
export function toCanonicalLinkStatus(raw: ParentLinkRequestSelectType["status"], requestId: number): LinkStatus {
  if (isLinkStatus(raw)) {
    return raw;
  }
  logger.logDomainError("Parent-link read rejected: stored link status failed the enum guard", {
    code: "PARENT_LINK_REQUEST_STATUS_CORRUPT",
    entity: "parent_link_requests",
    entityId: requestId,
    locale: "en",
  });
  throw new Error(`ParentLinkRequestService: corrupt link_status value on request ${requestId}`);
}

/**
 * Outgoing render-mapping: the student appears ONLY through the deterministic
 * `maskFullName` mask; a stored `pending` row whose deadline has lapsed
 * (strict `expiresAt <= now`) surfaces `LinkStatus.Expired` WITHOUT writing
 * (read purity); timestamps stay verbatim.
 */
export function mapOutgoing(row: OutgoingParentLinkRequestRow, now: Date): OutgoingParentLinkRequestReturnType {
  const status = toCanonicalLinkStatus(row.status, row.id);
  return {
    id: row.id,
    status: status === LinkStatus.Pending && row.expiresAt.getTime() <= now.getTime() ? LinkStatus.Expired : status,
    studentMaskedName: maskFullName(row.studentFullName),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
  };
}

/**
 * Incoming render-mapping: the requesting parent appears through his FULL
 * display name (the deciding student must know who asks); expiry mapping and
 * enum fail-closing exactly like `mapOutgoing`.
 */
export function mapIncoming(row: IncomingParentLinkRequestRow, now: Date): IncomingParentLinkRequestReturnType {
  const status = toCanonicalLinkStatus(row.status, row.id);
  return {
    id: row.id,
    status: status === LinkStatus.Pending && row.expiresAt.getTime() <= now.getTime() ? LinkStatus.Expired : status,
    parentFullName: row.parentFullName,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
  };
}
