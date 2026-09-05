"use client";

import { useMutation } from "@apollo/client/react";
import { resolveSessionDisputeMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { isNotFoundErrorFamily, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * useResolveSessionDispute — the mutation + error-classification seam of the
 * `ResolveDisputeDialog` arbitration flow (DEV3-005 R-104, plan §3.2).
 *
 * Mutation behavior (NO refetch):
 *
 * | Outcome (extensions.code)                     | Behavior |
 * |-----------------------------------------------|----------|
 * | success                                       | `update` FILTERS the resolved row out of EVERY stored `adminDisputedSessions` variant and DECREMENTS its honest `totalCount` — the row leaves the queue WITHOUT a refetch; the returned `Session!` payload auto-merges the terminal status onto the entity. `onResolved` up to the dialog → success snackbar. |
 * | `SESSION_NOT_FOUND` (not-found family)        | `onSessionMissing` → error snackbar; the row STAYS (a raced concurrent arbitration is the honest explanation — no eviction arm on an admin surface) |
 * | `SESSION_INVALID_TRANSITION`                  | `onInvalidTransition` → error snackbar (another admin resolved it first); the row stays |
 * | `VALIDATION` (e.g. Complete on never-started) | `onFailure(errors.validation)` → error snackbar; the dialog stays open for a corrected choice |
 * | `FORBIDDEN`                                   | `onFailure(errors.forbidden)` → error snackbar; the dialog stays open |
 * | masked `INTERNAL_SERVER_ERROR` / anything else| `onFailure(sessions.genericError)` → error snackbar; the dialog stays open |
 *
 * The code classification runs through `extractErrorCode` +
 * `normalizeGraphQLErrorCode` (the single transport contract); the server
 * `message` is NEVER echoed.
 */

/** Unmapped lifecycle-reject code (the mapping table defines NO row for it). */
const SESSION_INVALID_TRANSITION_CODE = "SESSION_INVALID_TRANSITION";

/** `__typename` of the normalized `Session` cache entity. */
const SESSION_TYPE_NAME = "Session";

/** The admin queue field whose stored variants converge on arbitration. */
const ADMIN_DISPUTED_FIELD = "adminDisputedSessions";

/**
 * Reads the Apollo `Reference` wire id from a normalized cache entry WITHOUT
 * a dangling-underscore member access — the `__ref` wire property is
 * protocol-owned (not ours to rename), so it is scanned through the entry's
 * own enumerable entries instead.
 */
function referenceIdOf(item: object): string | undefined {
  for (const [key, value] of Object.entries(item)) {
    if (key === "__ref" && typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

/**
 * Filters one resolved session out of a stored `adminDisputedSessions`
 * payload and decrements its honest `totalCount` — the queue converges
 * WITHOUT any refetch and the count stays honest (the resolved row is no
 * longer awaiting arbitration).
 */
function removeSessionFromAdminQueue(
  existing: unknown,
  removedEntityId: string | undefined,
  sessionId: string
): unknown {
  if (typeof existing !== "object" || existing === null || !("items" in existing)) return existing;
  const items = existing.items;
  if (!Array.isArray(items)) return existing;
  const filteredItems = items.filter(item => {
    if (typeof item !== "object" || item === null) return true;
    // Normalized storage: dangling `Reference` entries match on the
    // protocol-mandated `__ref` wire id (scanned — see {@link referenceIdOf}).
    if ("__ref" in item) {
      return removedEntityId === undefined || referenceIdOf(item) !== removedEntityId;
    }
    // Non-normalized storage (defensive): raw payloads carry `id`.
    if ("id" in item) return item.id !== sessionId;
    return true;
  });
  // IDEMPOTENCE GUARD — `cache.modify` may re-invoke this modifier after
  // its own write's broadcast; returning a fresh object EVERY invocation
  // would re-write (≠ by reference) → re-broadcast → re-invoke → an
  // unbounded write loop. When nothing matched, hand back the SAME
  // reference so the write layer sees no change and the cycle terminates.
  if (filteredItems.length === items.length) return existing;
  const next: Record<string, unknown> = { ...existing, items: filteredItems };
  if ("totalCount" in existing && typeof existing.totalCount === "number") {
    // The honest total shrinks WITH the row — a resolved dispute is no
    // longer awaiting arbitration (the count stays honest without a
    // refetch; clamped at zero defensively).
    next.totalCount = Math.max(0, existing.totalCount - 1);
  }
  return next;
}

interface UseResolveSessionDisputeArgs {
  /** Id of the disputed session being arbitrated. */
  readonly sessionId: string;
  /** Success — the queue cache already dropped the row. */
  readonly onResolved: (sessionId: string) => void;
  /** `SESSION_NOT_FOUND` — error snackbar; the row stays (see the docblock). */
  readonly onSessionMissing: (sessionId: string) => void;
  /** `SESSION_INVALID_TRANSITION` — error snackbar; the row stays. */
  readonly onInvalidTransition: (sessionId: string) => void;
  /** Everything else — error toast; the dialog stays open for a retry. */
  readonly onFailure: (message: string) => void;
}

/**
 * Owns the `resolveSessionDispute` mutation for one arbitration: the cache
 * convergence `update` arm (queue filter + honest-count decrement) and the
 * extensions-code classification that routes EVERY outcome to the dialog's
 * snackbar callbacks. Returns the mutation trigger plus its in-flight flag.
 */
export function useResolveSessionDispute({
  sessionId,
  onResolved,
  onSessionMissing,
  onInvalidTransition,
  onFailure,
}: Readonly<UseResolveSessionDisputeArgs>) {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);

  const [resolveDispute, { loading }] = useMutation(resolveSessionDisputeMutationDocument, {
    // Cache CONVERGENCE on success — the resolved row leaves EVERY stored
    // variant of the admin queue (items filtered + honest totalCount
    // decremented) and the returned `Session!` payload auto-merges the
    // terminal status onto the entity. NO refetch, NO evict/gc (the entity
    // stays cached — only the queue membership changes).
    update(cache, { data }) {
      const resolved = data?.resolveSessionDispute;
      if (!resolved) return;
      const removedEntityId = cache.identify({ __typename: SESSION_TYPE_NAME, id: resolved.id });
      cache.modify({
        id: "ROOT_QUERY",
        fields: {
          [ADMIN_DISPUTED_FIELD]: (existing: unknown) =>
            removeSessionFromAdminQueue(existing, removedEntityId, resolved.id),
        },
      });
    },
    onCompleted: data => {
      onResolved(data.resolveSessionDispute.id);
    },
    onError: error => {
      const rawCode = extractErrorCode(error);
      const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);

      if (isNotFoundErrorFamily(code)) {
        onSessionMissing(sessionId);
        return;
      }
      if (code === SESSION_INVALID_TRANSITION_CODE) {
        onInvalidTransition(sessionId);
        return;
      }
      if (code === "VALIDATION") {
        onFailure(te.validation);
        return;
      }
      if (code === "FORBIDDEN") {
        onFailure(te.forbidden);
        return;
      }
      onFailure(t.genericError);
    },
  });

  return { resolveDispute, loading };
}
