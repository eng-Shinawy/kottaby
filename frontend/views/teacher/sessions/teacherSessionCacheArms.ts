/**
 * Teacher sessions — cache eviction, mutation error arms, and the
 * lifecycle affordance matrix.
 *
 * Extracted verbatim from `TeacherSessionsContainer` (the max-lines split):
 * the not-found cache eviction (filter + evict + gc, NO refetch), the
 * shared `onError` router for BOTH lifecycle mutations (the container
 * docblock's outcome table), and the lifecycle → affordance matrix feeding
 * `SessionRow`'s `actions` prop. Module-scope functions keep the container
 * a state+callbacks orchestrator with stable wiring.
 */

import type { ApolloCache } from "@apollo/client";
import {
  type MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import {
  isNotFoundErrorFamily,
  mapGraphQLErrorByCode,
  normalizeGraphQLErrorCode,
} from "@/frontend/providers/apollo/error-link.map";
import type { SessionRowAction } from "@/frontend/views/student/sessions/SessionRow";
import {
  type ContainerNotice,
  dropRowAlert,
  type InFlightSlots,
  isInFlight,
  SESSION_INVALID_TRANSITION_CODE,
  SESSION_TYPE_NAME,
  TEACHER_NOT_CERTIFIED_CODE,
} from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * Removes the missing session from the cached `myTeacherSessions` lists
 * (filter the reference out of every stored variant), evicts the entity and
 * garbage-collects — the list converges WITHOUT any refetch. Pattern copy of
 * the student dialog's not-found arm, retargeted at the teacher list field
 * (the 4.2 carry-forward sanctions pattern-copying container-level wiring
 * while the row/chips/dialog components are imported).
 */
export function evictSessionFromTeacherLists(cache: ApolloCache, sessionId: string): void {
  const removedEntityId = cache.identify({ __typename: SESSION_TYPE_NAME, id: sessionId });
  cache.modify({
    id: "ROOT_QUERY",
    fields: {
      // Applies to EVERY stored variant of the field (args-serialized
      // storeFieldNames match their bare field name in `modify`).
      myTeacherSessions(existing: unknown) {
        if (typeof existing !== "object" || existing === null || !("items" in existing)) return existing;
        const items = existing.items;
        if (!Array.isArray(items)) return existing;
        return {
          ...existing,
          items: items.filter(item => {
            if (typeof item !== "object" || item === null) return true;
            // Normalized storage: dangling `Reference` entries carry `__ref`
            // (bracket access — the Apollo wire property is underscore-prefixed).
            if ("__ref" in item) {
              const reference: unknown = item.__ref;
              return typeof reference === "string" ? reference !== removedEntityId : true;
            }
            // Non-normalized storage (defensive): raw payloads carry `id`.
            if ("id" in item) return item.id !== sessionId;
            return true;
          }),
        };
      },
    },
  });
  if (removedEntityId !== undefined) {
    cache.evict({ id: removedEntityId });
  }
  cache.gc();
}

/** Wiring every lifecycle-mutation `onError` arm needs from the container. */
export interface LifecycleMutationErrorWiring {
  readonly cache: ApolloCache;
  readonly sessionId: string;
  readonly t: SessionsLabels;
  readonly te: ErrorsLabels;
  readonly clearInFlight: () => void;
  readonly setRowAlerts: (
    updater: (prev: Readonly<Record<string, string>>) => Readonly<Record<string, string>>
  ) => void;
  readonly setNotice: (notice: ContainerNotice) => void;
}

/**
 * Shared onError arm for BOTH lifecycle mutations: clears the caller's
 * per-kind in-flight slot, then routes the classified outcome (the class
 * docblock's outcome table) — not-found family → teacher-list eviction +
 * error snackbar; `DUPLICATE_REQUEST` → informational snackbar;
 * `SESSION_INVALID_TRANSITION` / `TEACHER_NOT_CERTIFIED` → row-scoped
 * inline alert; `FORBIDDEN` → error snackbar; everything else → the
 * generic error snackbar.
 */
export function handleLifecycleMutationError(mutationError: unknown, wiring: LifecycleMutationErrorWiring): void {
  wiring.clearInFlight();
  const rawCode = extractErrorCode(mutationError);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
  if (isNotFoundErrorFamily(code)) {
    // The container owns the teacher-list eviction — the row has already
    // left the list when the snackbar lands.
    evictSessionFromTeacherLists(wiring.cache, wiring.sessionId);
    wiring.setRowAlerts(prev => dropRowAlert(prev, wiring.sessionId));
    wiring.setNotice({ message: wiring.te.sessionNotFound, severity: "error" });
    return;
  }
  const action = mapGraphQLErrorByCode(code, { contextKind: "mutation", hasForm: false });
  if (action?.duplicateSuccessEquivalent === true) {
    wiring.setNotice({ message: wiring.t.duplicateBookingInfo, severity: "info" });
    return;
  }
  if (code === SESSION_INVALID_TRANSITION_CODE) {
    wiring.setRowAlerts(prev => ({ ...prev, [wiring.sessionId]: wiring.te.sessionInvalidTransition }));
    return;
  }
  if (code === TEACHER_NOT_CERTIFIED_CODE) {
    wiring.setRowAlerts(prev => ({ ...prev, [wiring.sessionId]: wiring.te.teacherNotCertified }));
    return;
  }
  if (action?.kind === "toast" && action.messageKey === "forbidden") {
    wiring.setNotice({ message: wiring.te.forbidden, severity: "error" });
    return;
  }
  wiring.setNotice({ message: wiring.t.genericError, severity: "error" });
}

/** Wiring the affordance matrix needs to build one row's `SessionRowAction[]`. */
export interface TeacherActionsWiring {
  readonly t: SessionsLabels;
  readonly inFlightSlots: InFlightSlots;
  readonly onStart: (sessionId: string) => void;
  readonly onComplete: (sessionId: string) => void;
}

/**
 * Lifecycle → affordance matrix: Start on `Scheduled`, Complete on `Started`,
 * NOTHING on terminal rows. Each descriptor disables while ITS OWN row+kind
 * slot is in flight (`isInFlight` over the per-row slot book) — sibling rows
 * and the other action kind stay interactive.
 */
export function teacherActionsForSession(
  session: MyTeacherSessionsQuery_myTeacherSessions_items,
  wiring: TeacherActionsWiring
): ReadonlyArray<SessionRowAction> {
  const actions: SessionRowAction[] = [];
  if (session.status === SessionStatus.Scheduled) {
    actions.push({
      id: "start",
      label: wiring.t.startSession,
      disabled: isInFlight(wiring.inFlightSlots, session.id, "start"),
      onIntent: wiring.onStart,
    });
  }
  if (session.status === SessionStatus.Started) {
    actions.push({
      id: "complete",
      label: wiring.t.completeSession,
      disabled: isInFlight(wiring.inFlightSlots, session.id, "complete"),
      onIntent: wiring.onComplete,
    });
  }
  return actions;
}

/**
 * Rewrites the transitioned fields onto the normalized `Session:<id>`
 * entity (belt-and-braces over the automatic normalized merge of the
 * returned `Session!` payload) — the ONE cache-normalize shape shared by
 * the start/complete mutation `update` callbacks. NO refetch.
 */
export function rewriteSessionFields(
  cache: ApolloCache,
  sessionId: string,
  fields: Readonly<Record<string, unknown>>
): void {
  cache.modify({
    id: cache.identify({ __typename: SESSION_TYPE_NAME, id: sessionId }),
    fields: Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, () => value])),
  });
}
