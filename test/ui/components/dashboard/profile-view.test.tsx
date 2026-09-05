/**
 * ProfileView — language preference card component suite
 * (R2-users-locale-b, tasks D2/D3).
 *
 * Happy DOM + Apollo tier (`test/ui/components`): a REAL `ApolloClient` on
 * `MockLink` + `createApolloCache()` (production type policies — the
 * notification-badge suite precedent) with a recording `ApolloLink` ahead of
 * the mock so the exact WIRE variables of every fired operation are
 * asserted at the LINK level. The app-wide switch flow (POST /api/set-locale
 * + router.refresh()) runs through the stubbed-fetch + mocked-router
 * conventions of the LocaleSwitcher suite:
 *
 *   card rendering (own-language option labels, effective-locale selection,
 *   translated card title/group label/notice, aria wiring — en + ar) ·
 *   switch flow (updateMyLocale fired with the WIRE enum value "Ar"/"En"
 *   mapped from the app locale, me-query cache write-through, set-locale
 *   POST payload, router refresh) · failure path (localized inline error,
 *   selection reverted to the effective locale, NO cookie POST, NO refresh) ·
 *   persisted-value caption (account locale differing from the active UI
 *   locale is named; equal/unset shows the generic notice).
 *
 * Translation discipline: every rendered string resolves through
 * `Dashboard.getLabels(getTranslations(locale))` — ZERO hardcoded UI copy.
 * Fixture names/emails and the own-language option labels ("English" /
 * "العربية" — deliberately NOT translated) are technical test data.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApolloClient, ApolloLink } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { MockLink } from "@apollo/client/testing";
import { cleanup, type RenderResult, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext, type AuthContextType } from "@/frontend/context/AuthContext";
import { type MeQuery_me, UserRole, AppLocale as WireAppLocale } from "@/frontend/graphql/generated/gql/graphql";
import { meQueryDocument, updateMyLocaleMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import { ProfileView } from "@/frontend/views/dashboard/profile";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Dashboard } from "@/shared/locale/namespaces/dashboard";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";
import { testNavigationState } from "@/test/ui/components/translation-preload";

// ─── Fetch double (the LocaleSwitcher-suite convention) ─────────────────────

interface CapturedFetch {
  readonly url: string;
  readonly init?: RequestInit;
}

const originalFetch = globalThis.fetch;

/** Fetch double: records every call, answers `200 {}` — never touches network. */
function capturingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let url: string = "<Request-object>";
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.href;
  fetchCalls.push({ url, init });
  return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
}

let fetchCalls: CapturedFetch[] = [];

afterAll(() => {
  // Restore happy-dom's fetch so later files in this process are unaffected.
  globalThis.fetch = originalFetch;
});

// ─── Fixtures & helpers ─────────────────────────────────────────────────────

const FIXTURE_EMAIL = "profile-fixture@example.test";

/**
 * Codegen `me` row PLUS `__typename` — MockLink passes `result.data` through
 * AS-IS (Apollo does not synthesize `__typename` on mocked results), and
 * without it the cache cannot normalize the `User:id` entry the language
 * card's cache write-through targets (the notifications-feed suite
 * precedent).
 */
type MeUserFixture = MeQuery_me & { readonly __typename: "User" };

/** Deterministic normalized `me` user (all fields the document selects). */
function meUser(overrides?: Partial<MeUserFixture>): MeUserFixture {
  return {
    __typename: "User",
    id: 1,
    email: FIXTURE_EMAIL,
    fullName: "Profile Fixture",
    phone: null,
    country: null,
    gender: null,
    locale: null,
    role: UserRole.Admin,
    preferredRecitation: null,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
    ...overrides,
  };
}

/** One recorded GraphQL operation flowing through the client's link chain. */
interface CapturedOperation {
  readonly operationName: string | undefined;
  readonly variables: Record<string, unknown>;
}

/**
 * Builds a test client whose recording link fronts the given mocks — the
 * recorder is the WIRE-variable assertion seam (the badge-suite counting-link
 * precedent).
 */
function createProfileClient(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  initialUser?: MeUserFixture
): {
  client: ApolloClient;
  operations: CapturedOperation[];
} {
  const operations: CapturedOperation[] = [];
  const recorder = new ApolloLink((operation, forward) => {
    operations.push({ operationName: operation.operationName, variables: operation.variables });
    return forward(operation);
  });
  const cache = createApolloCache();
  if (initialUser) {
    cache.writeQuery({
      query: meQueryDocument,
      data: { me: initialUser },
    });
  }
  const client = new ApolloClient({
    link: ApolloLink.from([recorder, new MockLink([...mocks])]),
    cache,
    defaultOptions: { query: { errorPolicy: "none" } },
  });
  return { client, operations };
}

/** Creates an AuthContext value with the given user fixture. */
function makeAuthContext(user: MeUserFixture): AuthContextType {
  return {
    user,
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: async () => false,
    logout: () => undefined,
  };
}

/** The `me` query mock answering with the given persisted locale. */
function meMock(user: MeUserFixture): MockLink.MockedResponse {
  return {
    request: { query: meQueryDocument },
    result: { data: { me: user } },
  };
}

/** The `updateMyLocale` mutation mock answering with the given WIRE locale. */
function updateLocaleMock(wireLocale: WireAppLocale): MockLink.MockedResponse {
  return {
    request: { query: updateMyLocaleMutationDocument, variables: { locale: wireLocale } },
    result: {
      data: { updateMyLocale: { __typename: "User", id: 1, email: FIXTURE_EMAIL, locale: wireLocale } },
    },
  };
}

/** Renders the profile under the real Apollo client + the shared TestWrapper. */
function renderProfile(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  locale: AppLocale,
  initialUser: MeUserFixture = meUser()
): RenderResult & { client: ApolloClient; operations: CapturedOperation[] } {
  const { client, operations } = createProfileClient(mocks, initialUser);
  const authCtx = makeAuthContext(initialUser);
  const renderResult = renderWithWrapper(
    <ApolloProvider client={client}>
      <AuthContext.Provider value={authCtx}>
        <ProfileView />
      </AuthContext.Provider>
    </ApolloProvider>,
    { locale }
  );
  return { ...renderResult, client, operations };
}

beforeEach(() => {
  fetchCalls = [];
  testNavigationState.refreshCount = 0;
  // Silent-network posture: resolve instantly, capture for assertions.
  // Reflect.set keeps the swap assertion-free (oxlint no-unsafe-type-assertion).
  Reflect.set(globalThis, "fetch", capturingFetch);
});

afterEach(cleanup);

// ─── Card rendering (both locales) ──────────────────────────────────────────

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = Dashboard.getLabels(getTranslations(locale));

  describe(`ProfileView language card (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("renders with the effective locale selected, own-language options, translated labels + aria wiring", async () => {
      renderProfile([meMock(meUser())], locale);

      // Card title is translated; the two options render in their OWN
      // language (language-picker convention — NOT translated).
      await waitFor(() => {
        expect(screen.getByText(t.preferences)).toBeDefined();
      });
      const selectedLabel = locale === "ar" ? "العربية" : "English";
      const unselectedLabel = locale === "ar" ? "English" : "العربية";
      expect(screen.getByRole("button", { name: selectedLabel }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: unselectedLabel }).getAttribute("aria-pressed")).toBe("false");

      // The group carries the translated accessible label.
      const group = screen.getByRole("group", { name: t.language });
      expect(group).toBeDefined();

      // Unset account preference ⇒ the generic saved-to-account notice.
      expect(screen.getByText(t.languageNotice)).toBeDefined();
    });
  });
}

// ─── Switch flow (link-level WIRE assertion + app-wide switch) ──────────────

describe("ProfileView language card switch flow", () => {
  test("switching fires updateMyLocale with the WIRE enum value, writes the me cache, POSTs the cookie and refreshes", async () => {
    const { client, operations } = renderProfile([meMock(meUser()), updateLocaleMock(WireAppLocale.Ar)], "en");
    const user = userEvent.setup();

    const arabicOption = await waitFor(() => {
      const option = screen.getByRole("button", { name: "العربية" });
      expect(option).toBeDefined();
      return option;
    });
    await user.click(arabicOption);

    // The app-wide switch ran: set-locale POST with the APP locale payload…
    await waitFor(() => {
      expect(fetchCalls).toHaveLength(1);
    });
    expect(fetchCalls[0]?.url).toBe("/api/set-locale");
    expect(fetchCalls[0]?.init?.method?.toUpperCase()).toBe("POST");
    const sentBody = fetchCalls[0]?.init?.body;
    expect(typeof sentBody === "string" && JSON.parse(sentBody).locale === "ar").toBe(true);
    expect(testNavigationState.refreshCount).toBe(1);

    // …and the mutation fired with the WIRE enum value (app "ar" → wire "Ar").
    const localeMutation = operations.find(operation => operation.operationName === "UpdateMyLocale");
    expect(localeMutation).toBeDefined();
    expect(localeMutation?.variables).toEqual({ locale: WireAppLocale.Ar });

    // The me-query cache now carries the persisted account value.
    const cachedMe = client.cache.readQuery({ query: meQueryDocument });
    expect(cachedMe?.me?.locale).toBe(WireAppLocale.Ar);
  });

  test("failure surfaces the localized inline error and reverts — no cookie POST, no refresh", async () => {
    renderProfile(
      [
        meMock(meUser()),
        {
          request: { query: updateMyLocaleMutationDocument, variables: { locale: WireAppLocale.Ar } },
          result: {
            errors: [{ message: "masked transport surface", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
          },
        },
      ],
      "en"
    );
    const t = Dashboard.getLabels(getTranslations("en"));
    const user = userEvent.setup();

    const arabicOption = await waitFor(() => {
      const option = screen.getByRole("button", { name: "العربية" });
      expect(option).toBeDefined();
      return option;
    });
    await user.click(arabicOption);

    await waitFor(() => {
      expect(screen.getByText(t.languageUpdateFailed)).toBeDefined();
    });

    // Selection reverted to the (unchanged) effective locale…
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "العربية" }).getAttribute("aria-pressed")).toBe("false");
    // …and the app-wide switch NEVER ran.
    expect(fetchCalls).toHaveLength(0);
    expect(testNavigationState.refreshCount).toBe(0);
  });

  test("persisted account value differing from the effective locale is named in the caption", async () => {
    const t = Dashboard.getLabels(getTranslations("en"));
    const arUser = meUser({ locale: WireAppLocale.Ar });
    renderProfile([meMock(arUser)], "en", arUser);

    // Account says "ar" while the active UI locale is "en" — the caption
    // names the SAVED preference (in its own language), not the generic notice.
    await waitFor(() => {
      expect(screen.getByText(t.languageSaved("العربية"))).toBeDefined();
    });
    expect(screen.queryByText(t.languageNotice)).toBeNull();
  });

  test("persisted account value equal to the effective locale shows the generic notice", async () => {
    const t = Dashboard.getLabels(getTranslations("en"));
    renderProfile([meMock(meUser({ locale: WireAppLocale.En }))], "en");

    await waitFor(() => {
      expect(screen.getByText(t.languageNotice)).toBeDefined();
    });
    expect(screen.queryByText(t.languageSaved("English"))).toBeNull();
  });
});
