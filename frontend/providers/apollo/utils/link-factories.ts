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

/**
 * Outgoing-header writer that stamps the SSR shell's locale onto EVERY
 * browser GraphQL request as `x-app-locale`.
 *
 * WHY THIS LINK EXISTS — the mixed-language drift fix: the GraphQL context
 * factory (`backend/graphql/gqlContextFactory.ts`) resolves the request
 * locale independently of the RSC shell. Before this link, a cookieless
 * visitor (no `NEXT_LOCALE` cookie yet) got an Arabic page shell (the RSC
 * boundary defaults to the canonical `defaultLocale` = "ar") while the
 * GraphQL boundary negotiated `Accept-Language: en-US` from the browser —
 * so every server-composed string (activity captions, localized service
 * errors) rendered in English inside an Arabic page.
 *
 * The link reads the locale lazily at REQUEST time (never during render) so
 * it always carries the value the shell actually rendered with:
 * module-scope init parses the `NEXT_LOCALE` cookie (same source the RSC
 * boundary reads), then a provider effect keeps it in sync with the live
 * `LocaleContext` across in-app switches. Non-browser API clients don't run
 * this link and keep negotiating via cookie → Accept-Language → canonical
 * default on the server.
 *
 * Additive merge, same discipline as the auth link: context headers spread
 * FIRST (so a caller can still pin the header explicitly), then the
 * link-owned key keeps the final word.
 */
export const createLocaleLink = (getLocale: () => string) => {
  return new ApolloLink((operation, forward) => {
    const contextHeaders = operation.getContext().headers;
    const headers: Record<string, string> = {
      ...contextHeaders,
      "x-app-locale": getLocale(),
    };

    operation.setContext({ headers });
    return forward(operation);
  });
};

const createSuccessHandler =
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
