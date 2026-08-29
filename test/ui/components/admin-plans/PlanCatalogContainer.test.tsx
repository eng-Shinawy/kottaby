/**
 * PlanCatalogContainer + PlanCatalogTable — component suite (DEV1-005 4.3).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): the
 * container's settled-state matrix is rendered across BOTH locales
 * (Arabic RTL first — the app's default), with the catalog data supplied by
 * `adminPlans` mocks carrying `variables: { includeInactive: true }` exactly
 * as the container issues them:
 *
 *   skeleton (in flight) · populated table (active + inactive rows) ·
 *   empty catalog + create CTA · load failure + retry
 *
 * Plus two single-tier cells:
 *  - TABLE delegation tier — `PlanCatalogTable` rendered directly with
 *    spied callbacks: row actions forward the EXACT plan object to
 *    `onEditPlan` / `onTogglePlanStatus` (the Task 4.4 dialog boundary);
 *  - SERVER HAND-OFF tier — the container's `labels` prop (the RSC-safe
 *    string subset the Task 4.2 page passes) overrides the client-side
 *    `useAppTranslation(Plans)` handle.
 *
 * Translation discipline (mirrors `ApplicantStatusCard.test.tsx`): assertions
 * reference ONLY label objects resolved through
 * `Plans.getLabels(getTranslations(locale))` — zero hardcoded Arabic/English
 * UI copy. Fixture data (ASCII plan titles, price strings, ISO stamps) is
 * test-owned payload, not UI copy; the expected timestamp is recomputed with
 * a local `Intl.DateTimeFormat` clone of the documented util options.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AdminPlansQuery_adminPlans } from "@/frontend/graphql/generated/gql/graphql";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { PlanCatalogContainer, PlanCatalogTable } from "@/frontend/views/admin/plans";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Plans as PlansNs } from "@/shared/locale/namespaces/plans";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

/** Deterministic ten-field plan row builder mirroring the REQ-060 shape. */
function planFixture(overrides?: Partial<AdminPlansQuery_adminPlans>): AdminPlansQuery_adminPlans {
  return {
    id: "1",
    title: "Hifz Jadid — Full Memorization Plan",
    sessionCount: 8,
    price: "250.00",
    currency: "USD",
    intervalDays: 30,
    isActive: true,
    deactivatedAt: null,
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

const ACTIVE_ROW = planFixture();
const INACTIVE_ROW = planFixture({
  id: "2",
  title: "Legacy Tajweed Plan 2025",
  sessionCount: 4,
  price: "150.00",
  intervalDays: 14,
  isActive: false,
  deactivatedAt: "2026-02-01T12:30:00.000Z",
  createdAt: "2025-11-20T08:00:00.000Z",
  updatedAt: "2026-02-01T12:30:00.000Z",
});

/** `adminPlans` mock answering with `variables: { includeInactive: true }`. */
function adminPlansMock(rows: AdminPlansQuery_adminPlans[]): MockLink.MockedResponse {
  return {
    request: { query: adminPlansQueryDocument, variables: { includeInactive: true } },
    result: { data: { adminPlans: rows } },
  };
}

/** Permanently in-flight mock (MockLink never settles `delay: Infinity`). */
function pendingAdminPlansMock(): MockLink.MockedResponse {
  return { request: { query: adminPlansQueryDocument, variables: { includeInactive: true } }, delay: Infinity };
}

/** Scoped-deny mock authored exactly where the transport puts `extensions.code`. */
function deniedAdminPlansMock(): MockLink.MockedResponse {
  return {
    request: { query: adminPlansQueryDocument, variables: { includeInactive: true } },
    result: {
      errors: [{ message: "FORBIDDEN (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
    },
  };
}

function renderContainer(mocks: MockLink.MockedResponse[], locale: AppLocale): void {
  renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <PlanCatalogContainer />
    </MockedProvider>,
    { locale }
  );
}

/** Recomputes the shared util's stamp independently (byte-consistency probe). */
function expectedStamp(iso: string, locale: AppLocale): string {
  const formatter = new Intl.DateTimeFormat(locale === "en" ? "en" : "ar", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(iso));
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the settled-state
// matrix while every case stays independently readable.
for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = PlansNs.getLabels(getTranslations(locale));

  describe(`PlanCatalogContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("query in flight renders the busy skeleton — no settled copy leaks", () => {
      renderContainer([pendingAdminPlansMock()], locale);

      const skeleton = screen.getByTestId("plan-catalog-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByText(t.loading)).toBeDefined();
      // No settled-state copy may appear while the query is in flight.
      expect(screen.queryByTestId("plan-catalog-table")).toBeNull();
      expect(screen.queryByTestId("plan-catalog-empty")).toBeNull();
      expect(screen.queryByTestId("plan-catalog-error")).toBeNull();
    });

    test("populated catalog renders both status chips + row fields from query data", async () => {
      renderContainer([adminPlansMock([ACTIVE_ROW, INACTIVE_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByText(t.statusActive)).toBeDefined();
      });
      // Chips render from the payload's isActive — both lifecycle states.
      expect(screen.getByText(t.statusInactive)).toBeDefined();
      // Row field values: titles, decimal price STRING + currency verbatim,
      // session counts as-is (no coercion on any of them).
      expect(screen.getByText(ACTIVE_ROW.title)).toBeDefined();
      expect(screen.getByText(INACTIVE_ROW.title)).toBeDefined();
      expect(screen.getByText(`${ACTIVE_ROW.price} ${ACTIVE_ROW.currency}`)).toBeDefined();
      expect(screen.getByText(`${INACTIVE_ROW.price} ${INACTIVE_ROW.currency}`)).toBeDefined();
      expect(screen.getByText(String(ACTIVE_ROW.sessionCount))).toBeDefined();
      expect(screen.getByText(String(INACTIVE_ROW.sessionCount))).toBeDefined();
      // createdAt / deactivatedAt go through the locale-aware date util.
      expect(screen.getByText(expectedStamp(ACTIVE_ROW.createdAt, locale))).toBeDefined();
      expect(screen.getByText(expectedStamp(INACTIVE_ROW.deactivatedAt ?? "", locale))).toBeDefined();
      // Row actions: every row edits; the toggle label reflects the row's
      // CURRENT lifecycle state (deactivate active, activate inactive).
      expect(screen.getAllByRole("button", { name: t.actionEdit })).toHaveLength(2);
      expect(screen.getByRole("button", { name: t.actionDeactivate })).toBeDefined();
      expect(screen.getByRole("button", { name: t.actionActivate })).toBeDefined();
      // Honesty probe: the create CTA belongs to the header/empty states,
      // not to a populated table.
      expect(screen.getAllByRole("button", { name: t.createButton })).toHaveLength(1);
    });

    test("empty catalog renders the localized empty state with a create CTA", async () => {
      renderContainer([adminPlansMock([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("plan-catalog-empty")).toBeDefined();
      });
      expect(screen.getByText(t.emptyStateTitle)).toBeDefined();
      expect(screen.getByText(t.emptyStateBody)).toBeDefined();
      const createCta = screen.getByRole("button", { name: t.createButton });
      expect(createCta.getAttribute("disabled")).toBeNull();
      // No table skeleton/rows may accompany the empty state.
      expect(screen.queryByTestId("plan-catalog-table")).toBeNull();
    });

    test("load failure renders the localized error state with retry", async () => {
      renderContainer([deniedAdminPlansMock()], locale);

      await waitFor(() => {
        expect(screen.getByTestId("plan-catalog-error")).toBeDefined();
      });
      expect(screen.getByText(t.errorStateTitle)).toBeDefined();
      expect(screen.getByText(t.errorStateBody)).toBeDefined();
      expect(screen.getByRole("button", { name: t.errorStateRetry })).toBeDefined();
      // A failure never renders catalog rows or the empty-state invitation.
      expect(screen.queryByTestId("plan-catalog-table")).toBeNull();
      expect(screen.queryByTestId("plan-catalog-empty")).toBeNull();
    });
  });
}

// ============================================================================
// TABLE delegation tier — the Task 4.4 dialog boundary
// ============================================================================

describe("PlanCatalogTable — row actions delegate the exact plan to the 4.4 callbacks", () => {
  test("edit + per-status toggle forward the clicked row object", () => {
    const t = PlansNs.getLabels(getTranslations("en"));
    const onEditPlan = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    const onTogglePlanStatus = mock((_plan: AdminPlansQuery_adminPlans) => undefined);

    renderWithWrapper(
      <PlanCatalogTable
        plans={[ACTIVE_ROW, INACTIVE_ROW]}
        labels={t}
        locale="en"
        onEditPlan={onEditPlan}
        onTogglePlanStatus={onTogglePlanStatus}
      />,
      { locale: "en" }
    );

    // Direct table render at the harness viewport (1024 ≥ md) → real table.
    const table = screen.getByRole("table", { name: t.pageTitle });
    expect(table).toBeDefined();
    // Null deactivatedAt renders the locale-neutral dash (table branch only).
    expect(screen.getByText("—")).toBeDefined();

    fireEvent.click(screen.getAllByRole("button", { name: t.actionEdit })[0] ?? window);
    expect(onEditPlan).toHaveBeenCalledTimes(1);
    expect(onEditPlan).toHaveBeenCalledWith(ACTIVE_ROW);

    fireEvent.click(screen.getByRole("button", { name: t.actionDeactivate }));
    expect(onTogglePlanStatus).toHaveBeenCalledTimes(1);
    expect(onTogglePlanStatus).toHaveBeenCalledWith(ACTIVE_ROW);

    fireEvent.click(screen.getByRole("button", { name: t.actionActivate }));
    expect(onTogglePlanStatus).toHaveBeenCalledTimes(2);
    expect(onTogglePlanStatus).toHaveBeenCalledWith(INACTIVE_ROW);
  });
});

// ============================================================================
// 4.4 DIALOG WIRING — the container's intents open the real dialogs (en)
// ============================================================================

describe("PlanCatalogContainer — 4.4 dialog wiring (create / edit / status intents)", () => {
  const t = PlansNs.getLabels(getTranslations("en"));

  test("create CTA opens PlanFormDialog in create mode; cancel closes it", async () => {
    renderContainer([adminPlansMock([])], "en");

    await waitFor(() => {
      expect(screen.getByTestId("plan-catalog-empty")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: t.createButton }));

    const dialog = await waitFor(() => {
      const el = screen.getByText(t.createDialogTitle);
      expect(el).toBeDefined();
      return el;
    });
    // Create mode: the title field starts BLANK (no seed row).
    const title = screen.getByLabelText(t.fieldTitle);
    if (!(title instanceof HTMLInputElement)) throw new Error("title field must be an input");
    expect(title.value).toBe("");
    expect(dialog).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: t.cancel }));
    await waitFor(() => {
      expect(screen.queryByText(t.createDialogTitle)).toBeNull();
    });
  });

  test("row edit opens a PREFILLED edit dialog; toggle opens the status confirm", async () => {
    renderContainer([adminPlansMock([ACTIVE_ROW])], "en");

    await waitFor(() => {
      expect(screen.getByText(ACTIVE_ROW.title)).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: t.actionEdit }));
    const title = screen.getByLabelText(t.fieldTitle);
    if (!(title instanceof HTMLInputElement)) throw new Error("title field must be an input");
    expect(title.value).toBe(ACTIVE_ROW.title);
    expect(screen.getByText(t.editDialogTitle)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: t.cancel }));

    fireEvent.click(screen.getByRole("button", { name: t.actionDeactivate }));
    const confirmTitle = await waitFor(() => {
      const el = screen.getByText(t.deactivateConfirmTitle);
      expect(el).toBeDefined();
      return el;
    });
    expect(screen.getByText(t.deactivateConfirmBody(ACTIVE_ROW.title))).toBeDefined();
    expect(confirmTitle).toBeDefined();
  });
});

// ============================================================================
// SERVER HAND-OFF tier — the RSC-safe labels prop from the Task 4.2 page
// ============================================================================

describe("PlanCatalogContainer — server-resolved labels prop overrides the client handle", () => {
  test("the string subset the page passes wins over useAppTranslation(Plans)", async () => {
    const t = PlansNs.getLabels(getTranslations("en"));
    const SERVER_EMPTY_TITLE = `${t.emptyStateTitle} (server hand-off)`;

    renderWithWrapper(
      <MockedProvider mocks={[adminPlansMock([])]}>
        <PlanCatalogContainer
          labels={{
            createButton: t.createButton,
            columnTitle: t.columnTitle,
            columnSessionCount: t.columnSessionCount,
            columnPrice: t.columnPrice,
            columnIntervalDays: t.columnIntervalDays,
            columnStatus: t.columnStatus,
            columnActions: t.columnActions,
            actionEdit: t.actionEdit,
            actionActivate: t.actionActivate,
            actionDeactivate: t.actionDeactivate,
            statusActive: t.statusActive,
            statusInactive: t.statusInactive,
            loading: t.loading,
            emptyStateTitle: SERVER_EMPTY_TITLE,
            emptyStateBody: t.emptyStateBody,
            errorStateTitle: t.errorStateTitle,
            errorStateBody: t.errorStateBody,
            errorStateRetry: t.errorStateRetry,
          }}
        />
      </MockedProvider>,
      { locale: "en" }
    );

    await waitFor(() => {
      expect(screen.getByTestId("plan-catalog-empty")).toBeDefined();
    });
    expect(screen.getByText(SERVER_EMPTY_TITLE)).toBeDefined();
    // The un-overridden client-handle copy still renders for the body.
    expect(screen.getByText(t.emptyStateBody)).toBeDefined();
  });
});
