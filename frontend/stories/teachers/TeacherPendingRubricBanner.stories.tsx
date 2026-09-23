import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { TeacherPendingRubricBanner } from "@/frontend/views/teacher/sessions/TeacherPendingRubricBanner";

/**
 * Storybook surface for `TeacherPendingRubricBanner` — the teacher
 * sessions page's action-needed strip. Purely presentational: the count
 * and the active flag drive every visual state (idle vs engaged tint, the
 * count line's plural rules, the icon tilt + trailing engaged check), and
 * `onToggle` stays an unwired no-op. The banner renders in the app only
 * while the pending set is non-empty, so there is deliberately no
 * zero-count story — an empty pending set is the container's "no banner"
 * branch, not a banner state. The `ToggleInteraction` story additionally
 * exercises the toggle behavior itself — the `aria-pressed` flip and the
 * idle↔active hint-copy swap both ways — through a tiny stateful wrapper,
 * asserted locale-independently (the copy resolves through
 * `useAppTranslation`, so the play checks before/after differences instead
 * of hardcoded literals).
 */

/**
 * Stateful mount for the toggle-interaction story — in the app the container
 * owns the filter state, and the bare banner is purely presentational, so the
 * play function needs an `onToggle` that actually flips `active` back.
 */
function ToggleInteractionHarness({ count }: Readonly<{ count: number }>): ReactNode {
  const [active, setActive] = useState(false);
  return <TeacherPendingRubricBanner count={count} active={active} onToggle={() => setActive(previous => !previous)} />;
}

const meta = {
  title: "Teachers/Pending Rubric Banner",
  component: TeacherPendingRubricBanner,
  parameters: {
    layout: "centered",
    controls: { exclude: ["onToggle"] },
  },
  decorators: [
    Story => (
      <Box sx={{ width: { xs: 320, sm: 480 }, p: 2 }}>
        <Story />
      </Box>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof TeacherPendingRubricBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several pending evaluations, filter idle — the banner's resting look. */
export const FivePendingIdle: Story = {
  args: { count: 5, active: false, onToggle: () => {} },
};

/** Several pending evaluations, filter ACTIVE — engaged tint + both echoes. */
export const FivePendingActive: Story = {
  args: { count: 5, active: true, onToggle: () => {} },
};

/** A single pending evaluation (the singular plural rule), idle. */
export const SinglePendingIdle: Story = {
  args: { count: 1, active: false, onToggle: () => {} },
};

/** A single pending evaluation, filter ACTIVE. */
export const SinglePendingActive: Story = {
  args: { count: 1, active: true, onToggle: () => {} },
};

/**
 * Toggle interaction — pressing flips `aria-pressed` and swaps the hint copy
 * both ways. The copy resolves through `useAppTranslation`, so the play
 * asserts locale-independently: `aria-pressed` directly, and the hint swap
 * as a before/after difference on the hint line's text (no hardcoded
 * English literals).
 */
export const ToggleInteraction: Story = {
  args: { count: 3, active: false, onToggle: () => {} },
  render: ({ count }) => <ToggleInteractionHarness count={count} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByTestId("teacher-pending-rubric-banner");
    // The hint line is the banner's SECOND Typography span (after the count
    // line); reading its textContent keeps the assertions locale-free.
    const hintCopy = (): string | null => {
      const lines = banner.querySelectorAll(".MuiTypography-root");
      return lines[lines.length - 1]?.textContent ?? null;
    };

    const idleHint = hintCopy();
    void expect(idleHint).toBeTruthy();
    void expect(banner).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(banner);
    void expect(banner).toHaveAttribute("aria-pressed", "true");
    void expect(hintCopy()).not.toBe(idleHint);

    await userEvent.click(banner);
    void expect(banner).toHaveAttribute("aria-pressed", "false");
    void expect(hintCopy()).toBe(idleHint);
  },
};
