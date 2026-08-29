/**
 * AuditLogContainer + AuditTrailTable — component suite (admin /audit trail
 * viewer, DEV3-020 Phase 1 round).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): the
 * container's settled-state matrix is rendered across BOTH locales (Arabic
 * RTL first — the app's default), with the trail data supplied by
 * `adminAuditLogs` mocks carrying FUNCTION variable matchers exactly as
 * the container issues them (the container ALWAYS sends the full variable
 * set; undefined-valued keys must not gate the match):
 *
 *   skeleton (in flight) · populated trail table · empty trail ·
 *   load failure + retry
 *
 * Filter-flow cells:
 *  - the actor-id draft accepts digits only; Apply commits the draft —
 *    the follow-up query fires with `actorId: 77` and the container
 *    renders the filtered page (draft→applied→variables contract);
 *  - the date-range fence: an inverted from/to keeps Apply blocked
 *    (the follow-up query never fires — mocked, so it would throw).
 *
 * Plus a single-tier delegation cell: `AuditTrailTable` rendered directly
 * with spied callbacks — prev is disabled at offset 0, next enables only
 * when a further page exists (pagination derives from the SERVER total,
 * never local row counts).
 *
 * Details-popover cells (style-polish round):
 *  - the details cell renders a TRUNCATED single-line preview beside an
 *    icon-only expand trigger whose accessible name resolves the dedicated
 *    `detailsExpandAriaLabel` key (both locales), and rows WITHOUT details
 *    render no trigger at all;
 *  - clicking the trigger opens the table's ONE shared popover carrying the
 *    titled panel + the FULL pretty-printed JSON (a known payload's id is
 *    asserted visible) — never one popover per row.
 *
 * Translation discipline (mirrors `PaymentVerificationContainer.test.tsx`):
 * assertions reference ONLY label objects resolved through
 * `Audit.getLabels(getTranslations(locale))` — zero hardcoded
 * Arabic/English UI copy. Fixture data (ASCII names/emails, ISO stamps,
 * machine codes) is test-owned payload, not UI copy.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AdminAuditLogsQuery_adminAuditLogs_items } from "@/frontend/graphql/generated/gql/graphql";
import { adminAuditLogsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { AuditLogContainer, AuditTrailTable } from "@/frontend/views/admin/audit";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Audit as AuditNs } from "@/shared/locale/namespaces/audit";
import { getTranslations } from "@/shared/locale/server";
import type { AuditLabels } from "@/shared/locale/types/audit";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

/** Deterministic trail-row builder mirroring the wire selection. */
function entryFixture(
  overrides?: Partial<AdminAuditLogsQuery_adminAuditLogs_items>
): AdminAuditLogsQuery_adminAuditLogs_items {
  return {
    id: "501",
    actionType: "create",
    entityType: "plans",
    entityId: 42,
    details: '{"code":"PLAN_CREATED","planId":42}',
    createdAt: "2026-08-20T10:00:00.000Z",
    actor: { id: "9", fullName: "Admin One", email: "admin.one@test.local" },
    ...overrides,
  };
}

const ROW_A = entryFixture();
const ROW_B = entryFixture({
  id: "502",
  actionType: "update",
  entityType: "subscriptions",
  entityId: null,
  details: null,
  createdAt: "2026-08-25T11:30:00.000Z",
  actor: { id: "10", fullName: "Admin Two", email: "admin.two@test.local" },
});

/** The raw serialized blob (call sites assert detail-BEARING fixtures — null fails loudly). */
function rawDetailsOf(details: string | null): string {
  if (details === null) {
    throw new Error("rawDetailsOf: fixture details must be non-null");
  }
  return details;
}

/** The in-cell truncated preview (mirrors the table's 24-char + ellipsis). */
function detailsPreviewOf(details: string | null): string {
  // Call sites only assert detail-BEARING fixtures; a null here is a test
  // bug and must fail loudly, not masquerade as a preview string.
  if (details === null) {
    throw new Error("detailsPreviewOf: fixture details must be non-null");
  }
  return `${details.slice(0, 24)}…`;
}

/**
 * `adminAuditLogs` mock answering with the page envelope for the given
 * totals. The variable matcher matches on the pagination envelope only —
 * the container always sends the full variable set with undefined-valued
 * optional filters, and a value-equality match would gate on those keys.
 */
function pageMock(
  items: AdminAuditLogsQuery_adminAuditLogs_items[],
  total: number,
  variables: Record<string, unknown> = { limit: 20, offset: 0 }
): MockLink.MockedResponse {
  return {
    request: {
      query: adminAuditLogsQueryDocument,
      variables: vars =>
        (vars.limit ?? undefined) === variables.limit && (vars.offset ?? undefined) === variables.offset,
    },
    result: {
      data: {
        adminAuditLogs: {
          items,
          total,
          limit: (variables.limit as number) ?? 20,
          offset: (variables.offset as number) ?? 0,
          __typename: "AdminAuditLogConnection",
        },
      },
    },
  };
}

/** `adminAuditLogs` mock matching an APPLIED actor filter (limit 20, offset 0). */
function filteredPageMock(items: AdminAuditLogsQuery_adminAuditLogs_items[], total: number): MockLink.MockedResponse {
  return {
    request: {
      query: adminAuditLogsQueryDocument,
      variables: vars => (vars.actorId ?? undefined) === 77 && vars.limit === 20 && vars.offset === 0,
    },
    result: {
      data: {
        adminAuditLogs: {
          items,
          total,
          limit: 20,
          offset: 0,
          __typename: "AdminAuditLogConnection",
        },
      },
    },
  };
}

/** Permanently in-flight mock (MockLink never settles `delay: Infinity`). */
function pendingPageMock(): MockLink.MockedResponse {
  return { request: { query: adminAuditLogsQueryDocument }, delay: Infinity };
}

/** Scoped-deny mock — matches ANY variable envelope, authored exactly where
 * the transport puts `extensions.code`. The function matcher is required:
 * the container sends the FULL variable set (undefined-valued optional
 * filters included), which value-equality against `{}` would reject. */
function deniedPageMock(): MockLink.MockedResponse {
  return {
    request: { query: adminAuditLogsQueryDocument, variables: () => true },
    result: {
      errors: [{ message: "FORBIDDEN (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
    },
  };
}

function renderContainer(mocks: MockLink.MockedResponse[], locale: AppLocale): void {
  renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <AuditLogContainer />
    </MockedProvider>,
    { locale }
  );
}

afterEach(() => {
  cleanup();
});

// ----------------------------------------------------------------------------
// Container — settled-state matrix
// ----------------------------------------------------------------------------

describe("AuditLogContainer — settled states (ar, the default RTL surface)", () => {
  const t = AuditNs.getLabels(getTranslations("ar"));

  test("renders the populated trail table with actor, action chip, entity, and details", async () => {
    renderContainer([pageMock([ROW_A, ROW_B], 2)], "ar");

    await waitFor(() => {
      expect(screen.getByTestId("audit-trail-table")).toBeDefined();
    });
    // The narrow actor summary — name AND email, never a bare id.
    expect(screen.getByText("Admin One")).toBeDefined();
    expect(screen.getByText("admin.one@test.local")).toBeDefined();
    // The localized action chip + entity family (machine codes localized).
    expect(screen.getAllByText(t.actionCreate).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.entityPlans).length).toBeGreaterThan(0);
    // The LTR details JSON rides the row as a TRUNCATED preview (the full
    // blob moved into the expand popover — style-polish round).
    expect(screen.queryByText(rawDetailsOf(ROW_A.details))).toBeNull();
    expect(screen.getByText(detailsPreviewOf(ROW_A.details))).toBeDefined();
    // A null details cell renders the locale-neutral dash (no trigger).
    expect(screen.getAllByText(t.detailsEmpty).length).toBeGreaterThan(0);
    // Exactly ONE trigger — only the detail-bearing row carries it.
    expect(screen.getAllByRole("button", { name: t.detailsExpandAriaLabel })).toHaveLength(1);
    // The truthful pagination window: 1–2 of 2.
    expect(screen.getByText(t.pageInfo(1, 2, 2))).toBeDefined();
  });

  test("renders the loading skeleton while the read is in flight", () => {
    renderContainer([pendingPageMock()], "ar");
    expect(screen.getByTestId("audit-trail-loading")).toBeDefined();
  });

  test("renders the localized empty state for a trail with no entries", async () => {
    renderContainer([pageMock([], 0)], "ar");
    await waitFor(() => {
      expect(screen.getByTestId("audit-trail-empty")).toBeDefined();
    });
    expect(screen.getByText(t.emptyStateTitle)).toBeDefined();
    expect(screen.getByText(t.emptyStateBody)).toBeDefined();
  });

  test("renders the localized error state with a working retry", async () => {
    renderContainer([deniedPageMock(), pageMock([ROW_A], 1)], "ar");
    await waitFor(() => {
      expect(screen.getByTestId("audit-trail-error")).toBeDefined();
    });
    expect(screen.getByText(t.errorStateTitle)).toBeDefined();
    fireEvent.click(screen.getByText(t.errorStateRetry));
    await waitFor(() => {
      expect(screen.getByTestId("audit-trail-table")).toBeDefined();
    });
  });
});

describe("AuditLogContainer — settled states (en)", () => {
  const t = AuditNs.getLabels(getTranslations("en"));

  test("renders the populated trail table with the English pagination window", async () => {
    renderContainer([pageMock([ROW_A, ROW_B], 2)], "en");
    await waitFor(() => {
      expect(screen.getByTestId("audit-trail-table")).toBeDefined();
    });
    expect(screen.getByText(t.pageInfo(1, 2, 2))).toBeDefined();
    expect(screen.getAllByText(t.actionUpdate).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.entitySubscriptions).length).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------------------
// Container — filter flow (draft → applied → variables)
// ----------------------------------------------------------------------------

describe("AuditLogContainer — filter flow", () => {
  const t = AuditNs.getLabels(getTranslations("ar"));

  test("Apply commits the actor-id draft — the follow-up query fires with actorId 77", async () => {
    const filtered = entryFixture({
      id: "900",
      actionType: "reactivate",
      details: '{"code":"SUBSCRIPTION_PAYMENT_VERIFIED"}',
      actor: { id: "77", fullName: "Admin Seventy", email: "admin77@test.local" },
    });
    renderContainer([pageMock([ROW_A, ROW_B], 2), filteredPageMock([filtered], 1)], "ar");

    await waitFor(() => {
      expect(screen.getByTestId("audit-trail-table")).toBeDefined();
    });

    // The actor-id input: digits only survive the draft. (MUI TextField
    // without `type` renders a plain text input — resolved by LABEL, the
    // established exact-text contract; the date fields render spinbuttons
    // and must not be mistaken for it.)
    const actorInput = screen.getByLabelText(t.labelActorId);
    if (!(actorInput instanceof HTMLInputElement)) {
      throw new Error("actor filter input not found");
    }
    fireEvent.change(actorInput, { target: { value: "77x" } });
    expect(actorInput.value).toBe("77");

    fireEvent.click(screen.getByTestId("audit-filters-apply"));

    await waitFor(() => {
      expect(screen.getByText("Admin Seventy")).toBeDefined();
    });
    expect(screen.getAllByText(t.actionReactivate).length).toBeGreaterThan(0);
  });

  test("an inverted date range keeps Apply blocked (the follow-up query never fires)", async () => {
    // ONE mock only — the filtered follow-up does not exist; if Apply fired,
    // MockLink would surface an unmatched-request error and break the render.
    renderContainer([pageMock([ROW_A], 1)], "ar");
    await waitFor(() => {
      expect(screen.getByTestId("audit-trail-table")).toBeDefined();
    });

    const fromInput = screen.getAllByLabelText(t.labelDateFrom)[0];
    const toInput = screen.getAllByLabelText(t.labelDateTo)[0];
    if (!(fromInput instanceof HTMLInputElement) || !(toInput instanceof HTMLInputElement)) {
      throw new Error("date filter inputs not found");
    }
    fireEvent.change(fromInput, { target: { value: "2026-09-01" } });
    fireEvent.change(toInput, { target: { value: "2026-08-01" } });

    // The inline validation copy is visible and the query was NOT refired —
    // the table still shows the unfiltered row.
    expect(screen.getByText(t.invalidDateRange)).toBeDefined();
    expect(screen.getByText("Admin One")).toBeDefined();
  });
});

// ----------------------------------------------------------------------------
// AuditTrailTable — delegation tier
// ----------------------------------------------------------------------------

describe("AuditTrailTable — delegation tier", () => {
  const t = AuditNs.getLabels(getTranslations("en"));

  test("pagination buttons disable when no further page exists and forward clicks to callbacks", () => {
    const onPrev = mock(() => {});
    const onNext = mock(() => {});
    renderWithWrapper(
      <AuditTrailTable
        items={[ROW_A]}
        labels={t}
        locale="en"
        offset={0}
        limit={20}
        total={1}
        onPrev={onPrev}
        onNext={onNext}
        busy={false}
      />,
      { locale: "en" }
    );

    const prev = screen.getByText(t.paginationPrev).closest("button");
    const next = screen.getByText(t.paginationNext).closest("button");
    // offset 0 → prev disabled; offset+limit (20) covers total 1 → next disabled.
    expect(prev?.disabled).toBe(true);
    expect(next?.disabled).toBe(true);
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  test("next enables when a further page exists and forwards the click to onNext", () => {
    const onNext = mock(() => {});
    renderWithWrapper(
      <AuditTrailTable
        items={[ROW_A, ROW_B]}
        labels={t}
        locale="en"
        offset={0}
        limit={2}
        total={5}
        onPrev={() => {}}
        onNext={onNext}
        busy={false}
      />,
      { locale: "en" }
    );
    const next = screen.getByText(t.paginationNext).closest("button");
    expect(next?.disabled).toBe(false);
    if (!next) {
      throw new Error("next button not found");
    }
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------------------
// Details popover — truncated preview + shared expand popover (style polish)
// ----------------------------------------------------------------------------

/** Renders the table directly with the given rows (delegation-tier style). */
function renderTable(items: AdminAuditLogsQuery_adminAuditLogs_items[], labels: AuditLabels, locale: AppLocale): void {
  renderWithWrapper(
    <AuditTrailTable
      items={items}
      labels={labels}
      locale={locale}
      offset={0}
      limit={20}
      total={items.length}
      onPrev={() => {}}
      onNext={() => {}}
      busy={false}
    />,
    { locale }
  );
}

describe("AuditTrailTable — details column popover (style-polish round)", () => {
  test("truncated preview + accessible expand trigger (ar, the default RTL surface)", () => {
    const t = AuditNs.getLabels(getTranslations("ar"));
    renderTable([ROW_A, ROW_B], t, "ar");

    // The raw blob is gone from the row; the 24-char preview rides it instead.
    expect(screen.queryByText(rawDetailsOf(ROW_A.details))).toBeNull();
    expect(screen.getByText(detailsPreviewOf(ROW_A.details))).toBeDefined();
    // The icon-only trigger resolves the dedicated aria-label key.
    const trigger = screen.getByRole("button", { name: t.detailsExpandAriaLabel });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Only the detail-bearing row carries a trigger (null details → dash only).
    expect(screen.getAllByRole("button", { name: t.detailsExpandAriaLabel })).toHaveLength(1);
    expect(screen.getAllByText(t.detailsEmpty).length).toBeGreaterThan(0);
  });

  test("truncated preview + accessible expand trigger (en)", () => {
    const t = AuditNs.getLabels(getTranslations("en"));
    renderTable([ROW_A, ROW_B], t, "en");

    expect(screen.queryByText(rawDetailsOf(ROW_A.details))).toBeNull();
    expect(screen.getByText(detailsPreviewOf(ROW_A.details))).toBeDefined();
    expect(screen.getByRole("button", { name: t.detailsExpandAriaLabel })).toBeDefined();
  });

  test("clicking the trigger opens ONE shared popover with the pretty-printed payload", async () => {
    const t = AuditNs.getLabels(getTranslations("en"));
    const rowC = entryFixture({
      id: "503",
      actionType: "update",
      details: '{"code":"PLAN_UPDATED","planId":42,"titleChanged":true}',
    });
    renderTable([ROW_A, rowC, ROW_B], t, "en");

    // Two detail-bearing rows → two triggers, zero popovers before the click.
    const triggers = screen.getAllByRole("button", { name: t.detailsExpandAriaLabel });
    expect(triggers).toHaveLength(2);
    expect(screen.queryByText(t.detailsPopoverTitle)).toBeNull();

    fireEvent.click(triggers[0] ?? document.body);

    // The titled panel opens with the FULL pretty-printed JSON — the known
    // payload's id value is visible inside it.
    await waitFor(() => {
      expect(screen.getByText(t.detailsPopoverTitle)).toBeDefined();
    });
    expect(screen.getByText(/"planId":\s*42/)).toBeDefined();
    // ONE popover instance for the whole table (never one per row).
    expect(screen.getAllByText(t.detailsPopoverTitle)).toHaveLength(1);
    // aria-expanded flips on the triggered row only. NOTE: role queries can
    // no longer see the triggers after the popover opens (MUI's Modal
    // aria-hides the app container) — the pre-click node references stay
    // valid because React updates the same DOM nodes in place.
    expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(triggers[1]?.getAttribute("aria-expanded")).toBe("false");
  });

  test("rows without details render no trigger at all", () => {
    const t = AuditNs.getLabels(getTranslations("en"));
    renderTable([ROW_B], t, "en");

    expect(screen.queryByRole("button", { name: t.detailsExpandAriaLabel })).toBeNull();
    expect(screen.getByText(t.detailsEmpty)).toBeDefined();
  });
});
