import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { RecitationReading } from "@/frontend/graphql/generated/gql/graphql";
import { RecitationSelector, type RecitationSelectorProps } from "@/frontend/views/auth/register";
import { useAppTranslation } from "@/shared/locale/client";
import { Recitation } from "@/shared/locale/namespaces";

/**
 * Labels resolve through the real locale context — the toolbar's ar/en
 * toggle switches them live (previously both leaf bundles were hardcoded,
 * so variants stayed fixed-language regardless of the toolbar).
 */
function RecitationSelectorHarness(props: Omit<RecitationSelectorProps, "labels" | "onChange">): ReactNode {
  const labels = useAppTranslation(Recitation);
  return <RecitationSelector {...props} labels={labels} onChange={() => {}} />;
}

const meta = {
  title: "Auth/RecitationSelector",
  component: RecitationSelectorHarness,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    value: "",
    options: Object.values(RecitationReading),
    loading: false,
  },
  argTypes: {
    value: {
      control: "select",
      options: ["", ...Object.values(RecitationReading)],
    },
  },
} satisfies Meta<typeof RecitationSelectorHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

const allReadings = Object.values(RecitationReading);

export const Default: Story = {
  args: {
    value: "",
    options: allReadings,
    loading: false,
  },
};

export const WithSelection: Story = {
  args: {
    value: RecitationReading.HafsAnAsim,
    options: allReadings,
    loading: false,
  },
};

export const Loading: Story = {
  args: {
    value: "",
    options: [],
    loading: true,
  },
};
