"use client";

import type { ApolloLink } from "@apollo/client";
import { ErrorLink } from "@apollo/client/link/error";
import { handleAuthError, logAuthRedirectEvent } from "@/frontend/providers/apollo/utils/auth-recovery";
import { dispatchMappedGraphQLErrorActions } from "@/frontend/providers/apollo/utils/error-surface";
import { isNetworkError } from "@/frontend/utils/errorUtils";

// Helper to create error link
export type ErrorRoutingDeps = {
  readonly getConnected: () => boolean;
  readonly setConnected: (v: boolean) => void;
  readonly notifyDisconnected: () => void;
};

/**
 * The FULL errorLink callback body, extracted here so the auth double-path,
 * the mapped-action surface dispatch, and the transport connectivity branch
 * are unit-testable without standing up an Apollo Link chain.
 * {@link createErrorLinkHandler} delegates here unchanged.
 */
export function routeApolloLinkError(
  deps: ErrorRoutingDeps,
  error: unknown,
  operation: Pick<ApolloLink.Operation, "operationName" | "query">
): void {
  // Fire-and-forget the async recovery; the ErrorLink callback cannot
  // return a Promise. handleAuthError performs its own redirect + log
  // side-effects synchronously-after-await; Apollo will treat the
  // operation as having an error in the meantime, but recovery is
  // signaled by reFetchObservableQueries rather than by suppressing
  // the per-operation error.
  void handleAuthError(error, operation.operationName);

  // Publish non-auth mapped actions to the UI surface seam.
  // Ordering guarantee: auth recovery dispatch above keeps exclusive
  // ownership of UNAUTHORIZED/UNAUTHENTICATED rows (the mapping skips
  // them here), and the network-error connectivity branch below stays
  // last & verbatim. Fire-and-forget mirrors handleAuthError because
  // the ErrorLink callback cannot await.
  dispatchMappedGraphQLErrorActions(error, operation);

  if (error && isNetworkError(error)) {
    const wasConnected = deps.getConnected();
    logAuthRedirectEvent("[Error Link] Network error detected", { wasConnected });
    deps.setConnected(false);

    if (wasConnected) {
      logAuthRedirectEvent("[Error Link] Connection lost (was previously connected)", {});
    }

    deps.notifyDisconnected();
  }
}

export const createErrorLinkHandler = (
  getConnected: () => boolean,
  setConnected: (v: boolean) => void,
  notifyDisconnected: () => void
) =>
  new ErrorLink(({ error, operation }) =>
    routeApolloLinkError({ getConnected, setConnected, notifyDisconnected }, error, operation)
  );
