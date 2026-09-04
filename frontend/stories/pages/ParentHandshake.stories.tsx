import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { userEvent, within } from "storybook/test";
import { findStudentByHandshakeCodeQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { DashboardStoryFrame, StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { HandshakeDiscoveryContainer } from "@/frontend/views/parent/handshake";
import { useAppTranslation } from "@/shared/locale/client";
import { HandshakeCode } from "@/shared/locale/namespaces";

/**
 * Storybook surface for `app/(dashboard)/parent/handshake/page.tsx` — the
 * parent-side student discovery flow (`HandshakeDiscoveryContainer`).
 *
 * The query is gated behind a validated-code submit (`skipToken` until the
 * client-side format gate passes), so the component mounts idle with ZERO
 * network operations; the `Default` story drives the search through a real
 * play function (typing the lowercase code also exercises the trim/uppercase
 * normalization) and awaits the masked, linkable result card. The `Empty`
 * story is the no-code idle state — the page description above the form IS
 * the sanctioned empty surface (no result region renders at all).
 *
 * Mocks ride the shared `StoryApolloProvider` (real Apollo client on MockLink
 * with the production cache, `keyFields: false` normalization for the
 * embedded `HandshakeCodeLookup` payload). The server-translated page shell
 * labels resolve through `useAppTranslation` so the toolbar locale toggle
 * switches them live, just like the interactive labels.
 */

/** Canonical fixture code — proven valid by `shared/constants` guards. */
const FIXTURE_CODE = "KSB-4F7A2C91";

/** Mock of the linkable lookup response (reusable across re-searches). */
function linkableLookupMock(): MockLink.MockedResponse {
  return {
    request: { query: findStudentByHandshakeCodeQueryDocument, variables: { code: FIXTURE_CODE } },
    result: {
      data: {
        findStudentByHandshakeCode: {
          __typename: "HandshakeCodeLookup",
          maskedName: "Ahmed M.",
          linkable: true,
        },
      },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

function HandshakeStory({ mocks }: Readonly<{ mocks: MockLink.MockedResponse[] }>): ReactNode {
  const labels = useAppTranslation(HandshakeCode);
  return (
    <StoryApolloProvider mocks={mocks}>
      <DashboardStoryFrame>
        <HandshakeDiscoveryContainer pageTitle={labels.pageTitle} pageDescription={labels.pageDescription} />
      </DashboardStoryFrame>
    </StoryApolloProvider>
  );
}

const meta = {
  title: "Pages/Parent/Handshake",
  component: HandshakeStory,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof HandshakeStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Valid linkable code — the play function types the code (lowercase, so the
 * normalization gate folds it to the canonical uppercase form) and submits;
 * the link resolves to the masked found-student card with can-link copy.
 */
export const Default: Story = {
  args: { mocks: [linkableLookupMock()] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), FIXTURE_CODE.toLowerCase());
    // The submit button's accessible name resolves through the locale context
    // (the toolbar toggles en/ar live), so the play targets the role — this
    // story renders exactly one button.
    await userEvent.click(canvas.getByRole("button"));
    await canvas.findByTestId("handshake-discovery-result");
    // The programmatic click leaves the submit button `Mui-focusVisible`,
    // which pins an endless TouchRipple pulsate child over the button (a
    // translucent band across the fill in screenshots). Releasing focus
    // restores the solid contained fill a mouse user would see.
    const active = canvasElement.ownerDocument.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  },
};

/**
 * Empty / no-code state — the idle surface before any search: shell, form,
 * and NO result region (the skip gate guarantees zero network operations).
 */
export const Empty: Story = {
  args: { mocks: [] },
};
