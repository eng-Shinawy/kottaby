import { PhoneOutlined } from "@mui/icons-material";
import { Box, InputAdornment, Stack } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useState } from "react";
import { PhoneInput } from "@/frontend/components/ui/PhoneInput";

/**
 * Storybook surface for `PhoneInput` — the shared `tel` field behind the register
 * form, the admin create/edit dialogs, and student onboarding.
 *
 * The Default story mirrors only the `name`-only member of the register
 * form's React Hook Form `{...register("phone")}` spread — the change/blur
 * handlers and ref are not expressible as Storybook args — while the
 * controlled `value`/`onChange` shape the admin surfaces bind to their own
 * form state is demonstrated by the `WithValue` and `RtlContext` stories
 * (via the controlled harness). The stories also pin the error/helper-line
 * contract and the bidi guarantee — the phone value stays
 * laid out left-to-right even inside a right-to-left (Arabic) container. The
 * preview shell is locale-aware too: the toolbar `locale` global flips the whole
 * document between LTR and RTL.
 */

/** Controlled harness — mirrors the admin dialogs' `value` + `onChange` form-state binding. */
function ControlledPhoneInput({ initialValue, label }: Readonly<{ initialValue: string; label?: string }>): ReactNode {
  const [phone, setPhone] = useState(initialValue);
  return <PhoneInput label={label} value={phone} onChange={event => setPhone(event.target.value)} />;
}

const meta = {
  title: "Form/PhoneInput",
  component: PhoneInput,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PhoneInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty field bound by name only — mirrors the `name` member of the register form's `{...register("phone")}` spread (the RHF change/blur handlers and ref cannot be expressed as Storybook args). */
export const Default: Story = {
  args: {
    name: "phone",
    label: "Phone number",
    fullWidth: true,
    startAdornment: (
      <InputAdornment position="start">
        <PhoneOutlined fontSize="small" />
      </InputAdornment>
    ),
  },
};

/** Mandatory field — the floating label carries the required asterisk. */
export const Required: Story = {
  args: {
    name: "phone",
    label: "Phone number",
    required: true,
    fullWidth: true,
  },
};

/** Controlled with a prefilled value — typing routes through the harness state. */
export const WithValue: Story = {
  render: () => <ControlledPhoneInput initialValue="+201234567890" label="Phone number" />,
};

/** Validation failure — error styling, `aria-invalid`, and the polite live-region helper line. */
export const ErrorState: Story = {
  args: {
    label: "Phone number",
    error: true,
    helperText: "Please enter a valid phone number.",
    fullWidth: true,
  },
};

/** Disabled field. */
export const Disabled: Story = {
  args: {
    label: "Phone number",
    disabled: true,
    fullWidth: true,
  },
};

/**
 * RTL container — the field sits inside a `dir="rtl"` region (like a section of an
 * Arabic page) while the phone value itself still renders left-to-right: the
 * component pins `dir: "ltr"` on the underlying `<input>` regardless of its
 * surroundings.
 */
export const RtlContext: Story = {
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
        <ControlledPhoneInput initialValue="+201234567890" label="رقم الهاتف" />
      </Stack>
    </Box>
  ),
};
