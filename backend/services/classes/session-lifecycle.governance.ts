/**
 * SessionLifecycleService — governance re-checks (module extraction,
 * behavior-identical): the defense-in-depth re-assertion of the platform
 * login/SSR fail-closed gate at the service boundary.
 *
 * The login/SSR boundary enforces the same gate — these checks are the
 * second layer for callers holding still-valid tokens whose account was
 * deleted/blocked/suspended (or, for the arbitration surface, demoted)
 * AFTER login: the DB row is the authority, never the token. Denials are
 * the typed `ForbiddenError` (`extensions.code` = `FORBIDDEN`, 403 per
 * the error-code taxonomy) — the authorization class for an authorization
 * denial, never the Conflict class.
 *
 * The public surface stays the `SessionLifecycleService` namespace in
 * `session-lifecycle.service.ts`. Nothing in this module is part of the
 * public API.
 */

import { UserRepository } from "@/backend/db/repo";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ForbiddenError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The admin role widened to a plain string: the user row's `role` is the
 * raw pg-enum string union, so the arbitration caller's defense-in-depth
 * role re-assertion compares against the enum member's string identity —
 * the vocabulary still flows from the enum.
 */
const USER_ADMIN_ROLE: string = UserRole.Admin;

/**
 * Re-asserts the platform governance gate for a caller at the service
 * boundary (deleted/blocked/suspended accounts are denied; a vanished
 * caller fails closed). The denial is a typed `ForbiddenError`.
 */
export async function assertActorGovernanceClean(
  actorUserId: number,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"],
  tx?: DBTransaction
): Promise<void> {
  const actor = await UserRepository.findById(actorUserId, tx);
  if (!actor || actor.isDeleted || actor.isBlocked || actor.suspended) {
    logger.logDomainError("Session action denied: caller account is governed", {
      code: "FORBIDDEN",
      entity: "session",
      entityId: actorUserId,
    });
    throw new ForbiddenError(t.forbidden);
  }
}

/**
 * Re-asserts the FULL arbitration authorization for a caller at the
 * service boundary: the account must be governance-clean AND hold the
 * admin role. The GraphQL scope gate enforces the same role leg — this
 * is the defense-in-depth layer for still-valid tokens held by an
 * account that was demoted or governed after login (the DB row is the
 * authority, never the token). The denial is the typed `ForbiddenError`.
 */
export async function assertAdminGovernanceClean(
  actorUserId: number,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"],
  tx?: DBTransaction
): Promise<void> {
  const actor = await UserRepository.findById(actorUserId, tx);
  if (!actor || actor.isDeleted || actor.isBlocked || actor.suspended) {
    logger.logDomainError("Session arbitration denied: caller account is governed", {
      code: "FORBIDDEN",
      entity: "session",
      entityId: actorUserId,
    });
    throw new ForbiddenError(t.forbidden);
  }
  if (actor.role !== USER_ADMIN_ROLE) {
    logger.logDomainError("Session arbitration denied: caller is not an admin", {
      code: "FORBIDDEN",
      entity: "session",
      entityId: actorUserId,
    });
    throw new ForbiddenError(t.forbidden);
  }
}
