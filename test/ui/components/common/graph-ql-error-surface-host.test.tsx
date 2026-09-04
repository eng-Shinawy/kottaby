/**
 * GraphQLErrorSurfaceHost — render-tier integration test (Pattern 2 per
 * test/ui/AGENTS.md). The host owns the single-slot errorLink listener seam,
 * so the test drives it through the PUBLIC dispatcher
 * (`dispatchMappedGraphQLErrorActions`) with real `CombinedGraphQLErrors`
 * payloads — exactly what Apollo feeds in production — and asserts the
 * localized surfaces that appear.
 *
 * All expected strings resolve through the compile-time translation system
 * (never hardcoded literals).
 *
 * NO history.pushState in this suite: happy-dom treats it as a navigation
 * and wipes the rendered React container (empirically verified — the DOM
 * resets to an empty wrapper div). The dispatcher's login-only path gate
 * already passes on happy-dom's default URL.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { CombinedGraphQLErrors, gql } from "@apollo/client";
import { act, cleanup, screen } from "@testing-library/react";
import { GraphQLErrorSurfaceHost } from "@/frontend/components/ui/GraphQLErrorSurfaceHost";
import { dispatchMappedGraphQLErrorActions } from "@/frontend/providers/apollo/utils";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common } from "@/shared/locale/namespaces/common/common.namespace";
import { Errors } from "@/shared/locale/namespaces/errors/errors.namespace";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

afterEach(cleanup);

/** Publish one error-code action through the production dispatcher (act-flushed). */
function dispatch(code: string, operation: "query" | "mutation", requestId?: string): void {
  act(() => {
    dispatchMappedGraphQLErrorActions(
      new CombinedGraphQLErrors({
        errors: [
          {
            message: "masked wire message — never rendered",
            extensions: { code, ...(requestId === undefined ? {} : { requestId }) },
          },
        ],
      }),
      {
        operationName: operation === "query" ? "ProbeQuery" : "ProbeMutation",
        query: operation === "query" ? gql`query ProbeQuery { _health }` : gql`mutation ProbeMutation { _noop }`,
      }
    );
  });
}

describe("GraphQLErrorSurfaceHost", () => {
  test("en: mutation-context masked INTERNAL_SERVER_ERROR → error toast, correlation id never renders", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("INTERNAL_SERVER_ERROR", "mutation", "req-test-123");

    expect(screen.getByText(labels.internalServerError)).toBeDefined();
    // Correlation guidance: the requestId stays OFF the surface (support reads
    // it from the error-surface logger, not the pixels).
    expect(screen.queryByText("req-test-123")).toBeNull();
    // Close affordance is translated, not hardcoded.
    expect(screen.getByRole("button", { name: Common.getLabels(getTranslations(locale)).close })).toBeDefined();
    // The raw server message NEVER renders (server masking).
    expect(screen.queryByText("masked wire message — never rendered")).toBeNull();
  });

  test("ar: CONFLICT notice → Arabic toast (RTL copy from errors namespace)", () => {
    const locale: AppLocale = "ar";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("CONFLICT", "mutation");

    expect(screen.getByText(labels.conflict)).toBeDefined();
  });

  test("en: query-context FORBIDDEN → pinned PermissionDenied banner with role title + close", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("FORBIDDEN", "query");

    expect(screen.getByText(labels.forbiddenRole)).toBeDefined();
    expect(screen.getByText(labels.forbidden)).toBeDefined();
    expect(screen.getByRole("button", { name: Common.getLabels(getTranslations(locale)).close })).toBeDefined();
  });

  test("en: FORBIDDEN in MUTATION context → toast (not banner)", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("FORBIDDEN", "mutation");

    // Toast path: forbidden copy present…
    expect(screen.getByText(labels.forbidden)).toBeDefined();
    // …while the banner's role title stays absent.
    expect(screen.queryByText(labels.forbiddenRole)).toBeNull();
  });

  test("en: DUPLICATE_REQUEST → neutral info toast (success-equivalent)", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("DUPLICATE_REQUEST", "mutation");

    expect(screen.getByText(labels.duplicateRequest)).toBeDefined();
  });

  test("en: RATE_LIMITED stays threshold-free (oracle resistance)", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("RATE_LIMITED", "mutation");

    const toast = screen.getByText(labels.rateLimitExceeded);
    expect(toast).toBeDefined();
    // Oracle resistance: no numbers/counters anywhere inside the toast copy.
    expect(!/\d/.test(toast.textContent ?? "")).toBe(true);
  });

  test("en: SERVICE_UNAVAILABLE → retryable copy surfaces", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("SERVICE_UNAVAILABLE", "mutation");

    expect(screen.getByText(labels.serviceUnavailable)).toBeDefined();
  });

  test("en: NOT_FOUND family → warning notice copy", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("USER_NOT_FOUND", "query");

    expect(screen.getByText(labels.notFound)).toBeDefined();
  });

  test("en: toast cap — 4th failure evicts the OLDEST toast (max 3 visible)", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    dispatch("CONFLICT", "mutation");
    dispatch("RATE_LIMITED", "mutation");
    dispatch("SERVICE_UNAVAILABLE", "mutation");
    dispatch("USER_NOT_FOUND", "query");

    // Oldest (CONFLICT) evicted; the newer three remain.
    expect(screen.queryByText(labels.conflict)).toBeNull();
    expect(screen.getByText(labels.rateLimitExceeded)).toBeDefined();
    expect(screen.getByText(labels.serviceUnavailable)).toBeDefined();
    expect(screen.getByText(labels.notFound)).toBeDefined();
  });

  test("en: auth-recovery rows NEVER reach the surface host (recovery link owns display)", () => {
    const locale: AppLocale = "en";
    const labels = Errors.getLabels(getTranslations(locale));

    renderWithWrapper(<GraphQLErrorSurfaceHost />, { locale });

    // UNAUTHORIZED maps to the auth-recovery row — the deduped refresh path
    // in providers/apollo/utils.ts owns its UX, so the host must stay silent.
    dispatch("UNAUTHORIZED", "query");

    expect(screen.queryByText(labels.unauthorized)).toBeNull();
    expect(document.body.innerHTML.includes("MuiSnackbar")).toBe(false);
  });
});
