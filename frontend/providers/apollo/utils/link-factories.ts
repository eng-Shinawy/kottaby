"use client";

import { ApolloLink, Observable } from "@apollo/client";
import CryptoJS from "crypto-js";

// Browser-compatible SHA256 function for persisted queries
export const sha256 = async (data: string): Promise<string> => {
  return CryptoJS.SHA256(data).toString();
};

// Observer interface matching RxJS Observable observer
export type ObserverLike<T> = {
  next: (value: T) => void;
  error: (error: unknown) => void;
  complete: () => void;
};

// Helper to create auth link outside component to avoid nesting
export const createAuthLink = (getToken: () => string | null) => {
  return new ApolloLink((operation, forward) => {
    const token = getToken();

    // Additive merge: caller-supplied context headers (e.g. the compose-page
    // idempotency key) ride along with the link-owned writers. The context
    // headers spread FIRST so the fixed keys below always keep the final
    // word on their own keys; a context without headers contributes nothing
    // and the outgoing map stays byte-identical to the pre-merge behavior.
    const contextHeaders = operation.getContext().headers;
    const headers: Record<string, string> = {
      ...contextHeaders,
      "apollo-require-preflight": "true",
      "x-apollo-operation-name": operation.operationName ?? "",
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    operation.setContext({ headers });
    return forward(operation);
  });
};

export const createSuccessHandler =
  (getConnected: () => boolean, setConnected: (v: boolean) => void, observer: ObserverLike<ApolloLink.Result>) =>
  (result: ApolloLink.Result) => {
    if (!getConnected()) {
      setConnected(true);
    }
    observer.next(result);
  };

// Helper to create connectivity link
export const createConnectivityLink = (
  getConnected: () => boolean,
  setConnected: (v: boolean) => void,
  checkConnection: () => Promise<boolean>,
  notifyDisconnected: () => void,
  getServerNotAvailableMessage: () => string
) => {
  const subscribeToRequest = (
    forward: (operation: ApolloLink.Operation) => Observable<ApolloLink.Result>,
    operation: ApolloLink.Operation,
    observer: ObserverLike<ApolloLink.Result>
  ) => {
    return forward(operation).subscribe({
      next: createSuccessHandler(getConnected, setConnected, observer),
      error: e => observer.error(e),
      complete: () => observer.complete(),
    });
  };

  const handleDisconnected = (observer: ObserverLike<ApolloLink.Result>) => {
    notifyDisconnected();
    observer.next({
      data: null,
      errors: [
        {
          message: getServerNotAvailableMessage(),
          extensions: { code: "NETWORK_ERROR", connectivityError: true },
        },
      ],
    } as ApolloLink.Result);
    observer.complete();
  };

  return new ApolloLink((operation, forward) => {
    return new Observable<ApolloLink.Result>(observer => {
      if (getConnected()) {
        subscribeToRequest(forward, operation, observer);
      } else {
        checkConnection()
          .then(connected => {
            if (connected) {
              subscribeToRequest(forward, operation, observer);
            } else {
              handleDisconnected(observer);
            }
            return undefined;
          })
          .catch(e => observer.error(e));
      }
    });
  });
};
