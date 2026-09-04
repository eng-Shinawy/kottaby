import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { DashboardStoryFrame } from "@/frontend/stories/lib/storyHarness";
// Direct file import — the `@/frontend/views/dashboard` barrel drags
// `withPageAuth` (server-only, `pg`-backed) into the Storybook bundle.
import { ComingSoonView } from "@/frontend/views/dashboard/layout/ComingSoonView";

/**
 * Storybook surface for `ComingSoonView` — the placeholder rendered by the
 * catch-all `app/(dashboard)/[feature]/page.tsx` for dashboard routes whose
 * real page hasn't been built yet.
 *
 * The component is translation-only: it reads the `Dashboard` namespace via
 * `useAppTranslation` (provided by the global Storybook locale decorator) and
 * maps the `feature` route segment to a localized display name. No GraphQL —
 * so no Apollo story client is needed. The harness only adds the dashboard
 * shell's content frame (`DashboardStoryFrame`) around the view.
 */

/** Wraps the view in the dashboard shell's content frame. */
function ComingSoonHarness({ feature }: Readonly<{ feature: string }>): ReactNode {
  return (
    <DashboardStoryFrame>
      <ComingSoonView feature={feature} />
    </DashboardStoryFrame>
  );
}

const meta = {
  title: "Pages/Coming Soon",
  component: ComingSoonHarness,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ComingSoonHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Representative dashboard feature ("sessions" → localized "Sessions" label). */
export const Default: Story = {
  args: { feature: "sessions" },
};
