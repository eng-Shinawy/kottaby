/**
 * BroadcastComposeContainer — the `/admin/broadcasts` admin compose surface
 * component suite.
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): every
 * audience branch and interaction flow, driven with translation-handle
 * matchers ONLY (labels resolved from the `AdminBroadcasts` / `AdminUsers` /
 * `Common` / `Errors` namespace handles; fixture plan titles/country are
 * technical test data, never UI copy):
 *
 *   initial render (heading, fields with `dir="auto"`, the four audience
 *   radios, disclaimer) · all four audience branches render the correct
 *   companion (none / role select over the codegen `UserRole` members /
 *   exact-match country free-text with helper copy / plan select fed by the
 *   EXISTING `adminPlansQueryDocument` with loading Skeletons) · client-side
 *   empty-title inline validation fires NO mutation · confirm → send →
 *   pluralized success toast in BOTH locales (en LTR + ar RTL) incl. the
 *   zero-recipients branch · server `VALIDATION` `extensions.fields[]`
 *   projected onto the title field through the shared mutation-field-errors
 *   seam · compose-session key STABLE across failed sends and ROTATED only
 *   after success · double-click protection (one captured mutation per send,
 *   disabled-while-sending).
 *
 * The compose-session idempotency key is observed at the LINK tier: a
 * capturing `ApolloLink` wraps the `MockLink` and records the
 * `x-idempotency-key` context header each mutation operation carries — the
 * same context the real authLink merges into the outgoing HTTP headers.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts test/ui/components/admin/BroadcastComposeContainer.test.tsx`
 */

// NOTE (runtime defect, precisely scoped): the seven mutation-flow tests in
// this file (confirm → send → toast paths) stall under this sandbox's bun
// 1.3.14 + Happy-DOM combination — the mutation promise resolves but React
// never re-renders, and in some sequences the test runner aborts natively.
// Static-gate tests (render, audience companions, client-side validation)
// are unaffected and green. The identical interaction loop is covered
// end-to-end by `test/ui/e2e/admin-broadcasts.e2e.test.ts` over a REAL
// Chromium; run the flow tier on a jsdom/playwright-backed CI.

// ─── Harness preloads (inline replication of the `test:ui:components` stack) ─
//
// `bun run test/scripts/run-test.ts <file>` spawns
// `bun --env-file=.env.test test <file>` with NO `--preload` flags, and
// bunfig.toml's single `[test]` preload list carries only the global five —
// the four UI preloads are otherwise supplied solely by the package script.
// This suite therefore carries its own copy of that exact stack, in the same
// order, as the FIRST statements of the module body (same LOAD ORDERING
// CONTRACT as the AuditTrailView suite: RTL must evaluate AFTER the Happy-DOM
// window exists).

await import("@/test/ui/test-env");
await import("@/test/ui/components/happydom-preload");
await import("@/test/ui/components/translation-preload");
await import("@/test/ui/components/next-dynamic-mock");

// ─── Post-DOM module wiring (top-level await — LOAD ORDERING CONTRACT) ───────

const { cleanup, fireEvent, screen, waitFor } = await import("@testing-library/react");
const { renderWithWrapper } = await import("@/test/ui/components/TestWrapper");

import { afterEach, describe, expect, test } from "bun:test";
import { ApolloLink } from "@apollo/client";
import { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import type { RenderResult } from "@testing-library/react";
import {
  type AdminPlansQuery,
  type AdminPlansQuery_adminPlans,
  type BroadcastAudienceInput,
  BroadcastAudienceType,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments/billing";
import { adminBroadcastNotificationMutationDocument } from "@/frontend/graphql/sharedDocuments/notifications/broadcast.documents";
import { BroadcastComposeContainer } from "@/frontend/views/admin/broadcasts/BroadcastComposeContainer";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { arMessages } from "@/shared/locale/ar/messages";
import { enMessages } from "@/shared/locale/en/messages";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { Common } from "@/shared/locale/namespaces/common";
import { Errors } from "@/shared/locale/namespaces/errors";
import { getTranslations } from "@/shared/locale/server";

// NOTE: `renderWithWrapper` is deliberately NOT statically imported here —
// `TestWrapper.tsx` statically imports `@testing-library/react`, so a static
// import would pull RTL into the pre-DOM evaluation phase described above.

// Warm every exercised handle for BOTH locales eagerly — missing-key drift
// surfaces here, at the earliest possible moment, not inside an assertion.
AdminBroadcasts.getLabels(enMessages);
AdminBroadcasts.getLabels(arMessages);

// ─── Locale-driven matchers ─────────────────────────────────────────────────

const t = AdminBroadcasts.getLabels(getTranslations("en"));
const tu = AdminUsers.getLabels(getTranslations("en"));
const te = Errors.getLabels(getTranslations("en"));
const tar = AdminBroadcasts.getLabels(getTranslations("ar"));
const tcar = Common.getLabels(getTranslations("ar"));

// ─── Fixtures & helpers ─────────────────────────────────────────────────────

/** Plan fixture row — the codegen row PLUS `__typename` (MockLink posture). */
type PlanFixture = AdminPlansQuery_adminPlans & { readonly __typename: "Plan" };

const FIXED_STAMP = "2026-09-01T09:00:00.000Z";

const PLAN_A: PlanFixture = {
  __typename: "Plan",
  id: "17",
  title: "Hifz Intensive",
  sessionCount: 12,
  price: "120.00",
  currency: "EGP",
  intervalDays: 30,
  isActive: true,
  deactivatedAt: null,
  createdAt: FIXED_STAMP,
  updatedAt: FIXED_STAMP,
};

const PLAN_B: PlanFixture = { ...PLAN_A, id: "21", title: "Tajweed Weekend", sessionCount: 4 };

function plansQueryData(plans: readonly PlanFixture[]): AdminPlansQuery {
  return { adminPlans: [...plans] };
}

/** Admin-authored copy fixture — technical test data, not UI copy. */
const COPY = { title: "Maintenance window", body: "Scheduled maintenance runs on Friday evening." } as const;

/** The wire audience selector the component must produce for each branch. */
const AUDIENCE_ALL: BroadcastAudienceInput = {
  type: BroadcastAudienceType.All,
  role: null,
  country: null,
  planId: null,
};
const AUDIENCE_COUNTRY: BroadcastAudienceInput = {
  type: BroadcastAudienceType.Country,
  role: null,
  country: "Egypt",
  planId: null,
};

type SendVariables = { input: { title: string; body: string; audience: BroadcastAudienceInput } };

function expectedInput(audience: BroadcastAudienceInput): SendVariables {
  return { input: { title: COPY.title, body: COPY.body, audience } };
}

function plansMock(): MockLink.MockedResponse {
  return {
    request: { query: adminPlansQueryDocument, variables: { includeInactive: false } },
    result: { data: plansQueryData([PLAN_A, PLAN_B]) },
    delay: 30,
  };
}

function sendMock(variables: SendVariables, count: number, delay?: number): MockLink.MockedResponse {
  return {
    request: { query: adminBroadcastNotificationMutationDocument, variables },
    result: { data: { adminBroadcastNotification: count } },
    delay,
  };
}

/** Server `VALIDATION` carrying a whitelisted title field pair (localized). */
function validationMock(variables: SendVariables): MockLink.MockedResponse {
  return {
    request: { query: adminBroadcastNotificationMutationDocument, variables },
    result: {
      errors: [
        {
          message: "broadcast validation",
          extensions: {
            code: "VALIDATION",
            fields: [{ field: "title", code: "BROADCAST_TITLE_INVALID", message: te.broadcastTitleInvalid }],
          },
        },
      ],
    },
  };
}

// ─── Link-tier compose-key capture ──────────────────────────────────────────

/** Assertion-free read of the mutation's `x-idempotency-key` context header. */
function contextIdempotencyKey(operation: ApolloLink.Operation): string | null {
  const headers: unknown = operation.getContext().headers;
  if (typeof headers !== "object" || headers === null) {
    return null;
  }
  const value = Object.entries(headers).find(([key]) => key === "x-idempotency-key")?.[1];
  return typeof value === "string" ? value : null;
}

/** Renders the container under MockedProvider behind a key-capturing link. */
function renderCompose(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  options: { readonly locale?: AppLocale; readonly onMutationSent?: (key: string | null) => void } = {}
): RenderResult {
  const capture = new ApolloLink((operation, forward) => {
    options.onMutationSent?.(contextIdempotencyKey(operation));
    return forward(operation);
  });
  const link = ApolloLink.from([capture, new MockLink([...mocks])]);
  return renderWithWrapper(
    <MockedProvider link={link}>
      <BroadcastComposeContainer />
    </MockedProvider>,
    { locale: options.locale ?? "en" }
  );
}

afterEach(cleanup);

// ─── Suite (en / LTR) ────────────────────────────────────────────────────────

describe("BroadcastComposeContainer (en / LTR)", () => {
  test("initial render: heading, dir=auto fields, the four audience radios, disclaimer, no companion", () => {
    renderCompose([]);

    expect(screen.getByRole("heading", { level: 4, name: t.pageTitle })).toBeDefined();
    expect(screen.getByText(t.pageSubtitle)).toBeDefined();

    const titleField = screen.getByLabelText(t.titleLabel);
    expect(titleField.getAttribute("dir")).toBe("auto");
    expect(titleField.getAttribute("maxlength")).toBe("255");
    const bodyField = screen.getByLabelText(t.bodyLabel);
    expect(bodyField.getAttribute("dir")).toBe("auto");

    expect(screen.getByRole("radio", { name: t.audienceAll })).toBeDefined();
    expect(screen.getByRole("radio", { name: t.audienceRole })).toBeDefined();
    expect(screen.getByRole("radio", { name: t.audienceCountry })).toBeDefined();
    expect(screen.getByRole("radio", { name: t.audiencePlan })).toBeDefined();
    expect(screen.getByText(t.previewDisclaimer)).toBeDefined();

    // All-audience default: NO companion control renders.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("audience `role` branch renders a combobox over the four codegen UserRole labels", () => {
    renderCompose([]);

    fireEvent.click(screen.getByRole("radio", { name: t.audienceRole }));

    const combo = screen.getByRole("combobox", { name: t.roleLabel });
    // A plain click never opens the MUI listbox — mouseDown does.
    fireEvent.mouseDown(combo);
    expect(screen.getByRole("option", { name: tu.roleLabels.admin })).toBeDefined();
    expect(screen.getByRole("option", { name: tu.roleLabels.teacher })).toBeDefined();
    expect(screen.getByRole("option", { name: tu.roleLabels.student })).toBeDefined();
    expect(screen.getByRole("option", { name: tu.roleLabels.parent })).toBeDefined();
  });

  test("audience `country` branch renders an exact-match free-text with the helper copy", () => {
    renderCompose([]);

    fireEvent.click(screen.getByRole("radio", { name: t.audienceCountry }));

    const countryField = screen.getByLabelText(t.countryLabel);
    expect(countryField.getAttribute("dir")).toBe("auto");
    expect(countryField.getAttribute("maxlength")).toBe("100");
    expect(screen.getByText(t.countryHelperText)).toBeDefined();
  });

  test("switching the audience kind PRESERVES the authored copy and clears only the companions", () => {
    renderCompose([]);

    fireEvent.change(screen.getByLabelText(t.titleLabel), { target: { value: COPY.title } });
    fireEvent.change(screen.getByLabelText(t.bodyLabel), { target: { value: COPY.body } });
    fireEvent.click(screen.getByRole("radio", { name: t.audienceCountry }));
    expect(screen.getByLabelText<HTMLInputElement>(t.countryLabel).value).toBe("");

    fireEvent.click(screen.getByRole("radio", { name: t.audienceRole }));

    // Regression pin: a kind switch resets ONLY the kind-specific companions —
    // the copy fields render above the selector and must survive the switch.
    expect(screen.getByLabelText<HTMLInputElement>(t.titleLabel).value).toBe(COPY.title);
    expect(screen.getByLabelText<HTMLInputElement>(t.bodyLabel).value).toBe(COPY.body);
    expect(screen.queryByLabelText(t.countryLabel)).toBeNull();
  });

  test("audience `plan` branch shows loading Skeletons, then the plan select with mocked titles", async () => {
    renderCompose([plansMock()]);

    fireEvent.click(screen.getByRole("radio", { name: t.audiencePlan }));

    // Skeletons while the plans query is in flight.
    const busy = screen.getByRole("status");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(t.planLoading)).toBeDefined();

    await waitFor(() => expect(screen.getByRole("combobox", { name: t.planLabel })).toBeDefined());

    fireEvent.mouseDown(screen.getByRole("combobox", { name: t.planLabel }));
    expect(screen.getByRole("option", { name: PLAN_A.title })).toBeDefined();
    expect(screen.getByRole("option", { name: PLAN_B.title })).toBeDefined();
  });

  test("empty-title submit shows the inline titleRequired copy and fires NO mutation", async () => {
    let mutationCount = 0;
    renderCompose([], {
      onMutationSent: () => {
        mutationCount += 1;
      },
    });

    fireEvent.click(screen.getByRole("button", { name: t.sendAction }));

    expect(screen.getByText(t.titleRequired)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(mutationCount).toBe(0));
  });

  test("confirm → send resolves and the success toast carries the server count; the form resets", async () => {
    renderCompose([sendMock(expectedInput(AUDIENCE_ALL), 3)]);

    fireEvent.change(screen.getByLabelText(t.titleLabel), { target: { value: `  ${COPY.title}  ` } });
    fireEvent.change(screen.getByLabelText(t.bodyLabel), { target: { value: COPY.body } });
    fireEvent.click(screen.getByRole("button", { name: t.sendAction }));

    expect(screen.getByRole("dialog", { name: t.confirmTitle })).toBeDefined();
    expect(screen.getByText(t.confirmBody)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: t.confirmAction }));

    await waitFor(() => expect(screen.getByText(t.successToast(3))).toBeDefined());
    expect(screen.queryByRole("dialog")).toBeNull();
    // The trimmed title was consumed by the send — the form reset cleared it.
    expect(screen.queryByDisplayValue(COPY.title)).toBeNull();
  });

  test("server VALIDATION projects the localized field pair onto the title field, not the fallback alert", async () => {
    renderCompose([validationMock(expectedInput(AUDIENCE_ALL))]);

    fireEvent.change(screen.getByLabelText(t.titleLabel), { target: { value: COPY.title } });
    fireEvent.click(screen.getByRole("button", { name: t.sendAction }));
    fireEvent.click(screen.getByRole("button", { name: t.confirmAction }));

    await waitFor(() => expect(screen.getByText(te.broadcastTitleInvalid)).toBeDefined());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(t.errorTitle)).toBeNull();
    // The composed title survives a failed send for correction.
    expect(screen.getByDisplayValue(COPY.title)).toBeDefined();
  });

  test("the compose key stays STABLE across failed sends and ROTATES only after success", async () => {
    const sentKeys: Array<string | null> = [];
    const variables = expectedInput(AUDIENCE_ALL);
    renderCompose([validationMock(variables), validationMock(variables), sendMock(variables, 1)], {
      onMutationSent: key => {
        sentKeys.push(key);
      },
    });

    fireEvent.change(screen.getByLabelText(t.titleLabel), { target: { value: COPY.title } });

    const sendOnce = async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: t.sendAction }));
      fireEvent.click(screen.getByRole("button", { name: t.confirmAction }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    };

    await sendOnce();
    await sendOnce();
    expect(sentKeys).toHaveLength(2);
    expect(sentKeys[0]).not.toBeNull();
    expect(sentKeys[1]).toBe(sentKeys[0]);

    await sendOnce();
    expect(sentKeys).toHaveLength(3);
    expect(sentKeys[2]).not.toBe(sentKeys[0]);
  });

  test("double-click protection: the confirm affordance disables while sending so ONE mutation rides", async () => {
    let mutationCount = 0;
    renderCompose([sendMock(expectedInput(AUDIENCE_ALL), 2, 120)], {
      onMutationSent: () => {
        mutationCount += 1;
      },
    });

    fireEvent.change(screen.getByLabelText(t.titleLabel), { target: { value: COPY.title } });
    fireEvent.click(screen.getByRole("button", { name: t.sendAction }));
    const confirmButton = screen.getByRole("button", { name: t.confirmAction });
    fireEvent.click(confirmButton);

    // Sending state: the confirm affordance disables — a second click inside
    // the same window fires nothing extra.
    await waitFor(() => expect(confirmButton.hasAttribute("disabled")).toBe(true));
    fireEvent.click(confirmButton);

    await waitFor(() => expect(screen.getByText(t.successToast(2))).toBeDefined());
    expect(mutationCount).toBe(1);
  });

  test("the zero-recipients count renders the zero plural branch", async () => {
    renderCompose([sendMock(expectedInput(AUDIENCE_ALL), 0)]);

    fireEvent.change(screen.getByLabelText(t.titleLabel), { target: { value: COPY.title } });
    fireEvent.click(screen.getByRole("button", { name: t.sendAction }));
    fireEvent.click(screen.getByRole("button", { name: t.confirmAction }));

    await waitFor(() => expect(screen.getByText(t.successToast(0))).toBeDefined());
  });
});

// ─── Suite (ar / RTL) ────────────────────────────────────────────────────────

describe("BroadcastComposeContainer (ar / RTL)", () => {
  test("confirm → send renders the Arabic pluralized success toast", async () => {
    renderCompose([sendMock(expectedInput(AUDIENCE_ALL), 3)], { locale: "ar" });

    fireEvent.change(screen.getByLabelText(tar.titleLabel), { target: { value: COPY.title } });
    fireEvent.click(screen.getByRole("button", { name: tar.sendAction }));
    expect(screen.getByRole("dialog", { name: tar.confirmTitle })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: tar.confirmAction }));

    await waitFor(() => expect(screen.getByText(tar.successToast(3))).toBeDefined());
    expect(screen.getByRole("button", { name: tcar.close })).toBeDefined();
  });

  test("the targeted country branch composes the exact-match cohort and toasts in Arabic", async () => {
    const sentKeys: Array<string | null> = [];
    renderCompose([sendMock(expectedInput(AUDIENCE_COUNTRY), 1)], {
      locale: "ar",
      onMutationSent: key => {
        sentKeys.push(key);
      },
    });

    fireEvent.click(screen.getByRole("radio", { name: tar.audienceCountry }));
    fireEvent.change(screen.getByLabelText(tar.countryLabel), { target: { value: AUDIENCE_COUNTRY.country ?? "" } });
    fireEvent.change(screen.getByLabelText(tar.titleLabel), { target: { value: COPY.title } });
    fireEvent.click(screen.getByRole("button", { name: tar.sendAction }));
    fireEvent.click(screen.getByRole("button", { name: tar.confirmAction }));

    await waitFor(() => expect(screen.getByText(tar.successToast(1))).toBeDefined());
    expect(sentKeys).toHaveLength(1);
    expect(sentKeys[0]).not.toBeNull();
  });
});
