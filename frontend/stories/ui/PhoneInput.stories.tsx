import { Box, Stack } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { expect, userEvent, within } from "storybook/test";
import { PhoneFormField, type PhoneFormFieldProps } from "@/frontend/components/ui/PhoneFormField";
import { PhoneInput, type PhoneInputProps } from "@/frontend/components/ui/PhoneInput";

/**
 * Storybook surface for `PhoneInput` — the two-slot phone field (flag +
 * calling-code prefix adornment, national number input) with the attached
 * country picker.
 *
 * Every story runs through the controlled harness: the component's value
 * contract is E.164 (`"+201234567890"`), a partial prefix (`"+20"`), or
 * `null` when empty, so the harness binds `value`/`onChangeAction` to local
 * state exactly like the admin dialogs and register form do. The preview
 * shell is locale-aware: the toolbar `locale` global flips the whole document
 * between LTR and RTL, and the `Rtl` story mirrors an explicit RTL container.
 */

type PhoneInputStoryProps = Readonly<
  Omit<PhoneInputProps, "value" | "onChangeAction"> & { readonly initialValue?: string | null }
>;

/** Controlled harness — binds the E.164 value contract to local state. */
function PhoneInputStory({ initialValue = null, ...props }: PhoneInputStoryProps): ReactNode {
  const [phone, setPhone] = useState<string | null>(initialValue);
  return (
    <Box sx={{ width: 400, p: 2 }}>
      <PhoneInput value={phone} onChangeAction={setPhone} {...props} />
    </Box>
  );
}

const meta = {
  title: "Form/PhoneInput",
  component: PhoneInputStory,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PhoneInputStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty field on the default (EG) region — the register form's starting state. */
export const Default: Story = {
  args: {
    defaultRegion: "EG",
    initialValue: null,
  },
};

/** Controlled with a full E.164 value — flag, prefix, and formatted national number all render. */
export const WithValue: Story = {
  args: {
    defaultRegion: "EG",
    initialValue: "+201234567890",
  },
};

/** Country picker opened via the flag button — attached list anchored under the field. */
export const WithCountryPickerOpen: Story = {
  args: {
    defaultRegion: "EG",
    initialValue: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The attached list renders in a MUI portal on the document body — outside
    // the canvas root — so the listbox assertion must query the page scope.
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole("button"));
    await expect(await page.findByRole("listbox")).toBeVisible();
  },
};

/** Incomplete number — the live invalid-phone hint appears under the field. */
export const InvalidPhone: Story = {
  args: {
    defaultRegion: "EG",
    initialValue: "+20123",
  },
};

/** Consumer/server error — passed-in copy takes precedence over the live hint. */
export const ServerError: Story = {
  args: {
    defaultRegion: "EG",
    initialValue: null,
    error: true,
    helperText: "This phone number is already registered.",
  },
};

/** Mandatory field — the floating label carries the required asterisk. */
export const Required: Story = {
  args: {
    defaultRegion: "EG",
    initialValue: null,
    required: true,
  },
};

/** Disabled field — both slots and the country picker are inert. */
export const Disabled: Story = {
  args: {
    defaultRegion: "EG",
    initialValue: "+201234567890",
    disabled: true,
  },
};

/**
 * RTL container — the field sits inside a `dir="rtl"` region (like an Arabic
 * page section) while the flag, prefix, and number still read left-to-right:
 * the component wraps the field in `dir="ltr"` regardless of surroundings.
 */
export const Rtl: Story = {
  render: () => (
    <Box
      dir="rtl"
      sx={theme => ({
        p: 2,
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
      })}
    >
      <Stack spacing={2} sx={{ maxWidth: 400 }}>
        <PhoneInputStory initialValue="+201234567890" label="رقم الهاتف" />
      </Stack>
    </Box>
  ),
};

type PhoneFormValues = { readonly phone: string };

/** React Hook Form binder harness — the admin dialogs' `<PhoneFormField name control/>` shape. */
function PhoneFormFieldStory(): ReactNode {
  const { control } = useForm<PhoneFormValues>({ defaultValues: { phone: "+201234567890" } });
  const fieldProps: Omit<PhoneFormFieldProps<PhoneFormValues>, "name" | "control"> = {
    label: "Phone number",
    fullWidth: true,
  };
  return (
    <Box sx={{ width: 400, p: 2 }}>
      <PhoneFormField name="phone" control={control} {...fieldProps} />
    </Box>
  );
}

/**
 * React Hook Form binder — the controller projects RHF's string field onto
 * the component's E.164 contract (`""` ↔ `null`) and back.
 */
export const ReactHookForm: Story = {
  render: () => <PhoneFormFieldStory />,
};
