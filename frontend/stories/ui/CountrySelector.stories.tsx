import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useState } from "react";
import { CountrySelector, type CountrySelectorProps } from "@/frontend/components/ui/CountrySelector";
import type { CountryCode } from "@/shared/constants/countries";
import { isValidCountryCode } from "@/shared/lib/country-code";
import { useAppTranslation } from "@/shared/locale/client";
import { Auth } from "@/shared/locale/namespaces/auth";
import { CountrySelector as CountrySelectorNs } from "@/shared/locale/namespaces/countrySelector";

/**
 * The component reads its own namespace copy (placeholder, empty state) and
 * takes the consumer-facing label/error text as props — the toolbar's ar/en
 * toggle switches the namespace copy live, mirroring the register form.
 */
function CountrySelectorHarness({
  initialValue = "",
  ...props
}: Omit<CountrySelectorProps, "label" | "value" | "onChange"> & {
  readonly initialValue?: CountryCode | "";
}): ReactNode {
  const t = useAppTranslation(CountrySelectorNs);
  const [value, setValue] = useState<CountryCode | "">(initialValue);
  return (
    <CountrySelector
      {...props}
      label={t.fieldLabel}
      value={value}
      onChange={code => {
        setValue(isValidCountryCode(code) ? code : "");
      }}
    />
  );
}

/** Error copy mirrors what the register form's validation would pass. */
function ErrorStateRender(): ReactNode {
  const auth = useAppTranslation(Auth);
  return <CountrySelectorHarness error helperText={auth.countryCodeRequired} />;
}

const meta = {
  title: "Form/CountrySelector",
  component: CountrySelectorHarness,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    disabled: false,
    error: false,
    required: true,
  },
  argTypes: {
    initialValue: {
      control: "select",
      options: ["", "EG", "SA", "AE", "PS", "US"],
    },
  },
} satisfies Meta<typeof CountrySelectorHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSelection: Story = {
  args: {
    initialValue: "EG",
  },
};

/**
 * The admin dialog grid pattern: the host draws its own visible label above
 * the field, the selector drops the floating label and keeps the accessible
 * name via the input's aria-label.
 */
export const HostDrawnLabel: Story = {
  args: {
    hideLabel: true,
  },
};

/**
 * The toolbar grammar: the floating label stays pinned in the outline notch
 * even while the field is empty, so the selector reads like the shrunk
 * filter selects beside it.
 */
export const PinnedToolbarLabel: Story = {
  args: {
    shrinkLabel: true,
  },
};

export const ErrorState: Story = {
  render: () => <ErrorStateRender />,
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
