import { useMutation } from "@apollo/client/react";
import type { MockLink } from "@apollo/client/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useEffect, useState } from "react";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { adminSetUserPasswordMutationDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { type AdminUserChangePasswordTarget, ChangeUserPasswordDialog } from "@/frontend/views/admin/users/dialogs";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces";

/**
 * Storybook surface for `ChangeUserPasswordDialog` — the admin credential
 * dialog shared by the directory kebab menu and the user-detail hero.
 *
 * The dialog itself is presentational (labels + target + callbacks), but
 * the harness wires a REAL `useMutation` against
 * `adminSetUserPasswordMutationDocument` on `StoryApolloProvider` and lets
 * rejections PROPAGATE out of `onSubmit` (the dialog's no-try/catch
 * contract) so the error variants run the full MockLink round trip:
 *  - the field-error variant rejects with
 *    `extensions.fields[{ field: "password", code: "PASSWORD_TOO_SHORT" }]` —
 *    exactly the transport shape `useAdminUserFormFeedback` projects into the
 *    password field's inline `helperText` (the dialog stays open);
 *  - the form-error variant rejects field-less (a `FORBIDDEN` denial) and
 *    lands in the dialog's top-level Alert.
 * One-shot DOM drivers (type / tick / submit) run against the dialog portal
 * once after mount so controlled-field values land as real React state —
 * the filled variants must satisfy the dialog's client-side credential
 * checks (min length + confirm match) before the round trip can fire; the
 * ConfirmMismatch variant deliberately types a DIVERGENT confirm value so
 * the client-side guard rejects the submit before any transport call (the
 * mock is never reached).
 */

const TARGET_USER: AdminUserChangePasswordTarget = {
  id: 42,
  fullName: "Yusuf Al-Amin",
};

/**
 * The demo credential typed into both fields of the filled variants — long
 * enough to pass the dialog's client-side length check, so the submit
 * variants actually reach the mocked transport round trip.
 */
const DEMO_CREDENTIAL = "StoryTempPass24";

/**
 * The divergent confirm value of the mismatch variant — valid length, so
 * ONLY the confirm-match guard trips and the mutation never fires.
 */
const MISMATCHED_CONFIRM = "StoryTempPass25";

/** Successful credential write (post-write `AdminUserDetail` payload). */
function setCredentialSuccessMock(mustChangePassword: boolean): MockLink.MockedResponse {
  return {
    request: {
      query: adminSetUserPasswordMutationDocument,
      variables: { id: TARGET_USER.id, input: { password: DEMO_CREDENTIAL, mustChangePassword } },
    },
    result: {
      data: {
        adminSetUserPassword: {
          __typename: "AdminUserDetail",
          id: TARGET_USER.id,
          role: UserRole.Teacher,
          isDeleted: false,
          suspended: false,
          isBlocked: false,
          mustChangePassword,
          applicant: null,
          teacher: null,
        },
      },
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/**
 * Server VALIDATION field error on the password field — the `fields` payload
 * shape `extractFieldErrors` reduces to `{ password: message }` for the
 * inline helperText.
 */
const CREDENTIAL_FIELD_ERROR_MOCK: MockLink.MockedResponse = {
  request: {
    query: adminSetUserPasswordMutationDocument,
    variables: { id: TARGET_USER.id, input: { password: DEMO_CREDENTIAL, mustChangePassword: false } },
  },
  result: {
    errors: [
      {
        message: "Password must be at least 8 characters.",
        extensions: {
          code: "VALIDATION",
          fields: [
            {
              field: "password",
              code: "PASSWORD_TOO_SHORT",
              message: "Password must be at least 8 characters.",
            },
          ],
        },
      },
    ],
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Field-less FORBIDDEN denial — no `fields` payload, so the top-level Alert renders. */
const CREDENTIAL_FORBIDDEN_MOCK: MockLink.MockedResponse = {
  request: {
    query: adminSetUserPasswordMutationDocument,
    variables: { id: TARGET_USER.id, input: { password: DEMO_CREDENTIAL, mustChangePassword: false } },
  },
  result: {
    errors: [
      {
        message: "FORBIDDEN (masked transport surface)",
        extensions: { code: "FORBIDDEN" },
      },
    ],
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
};

/** Types into a React-controlled field through the prototype's value setter. */
function typeIntoField(field: HTMLInputElement, value: string): void {
  // The prototype-level Reflect.set bypasses React's instance value-tracker
  // (the direct element assignment is deduped away) so the dispatched input
  // event really lands as a controlled change.
  Reflect.set(window.HTMLInputElement.prototype, "value", value, field);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** One timed interaction step of the one-shot driver. */
interface DriverStep {
  readonly delayMs: number;
  readonly run: () => void;
}

function queryDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

/** Types the demo credential into both credential fields (document order). */
function fillCredentialFields(): void {
  const fields = queryDialog()?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? [];
  for (const field of fields) typeIntoField(field, DEMO_CREDENTIAL);
}

/**
 * Types the demo credential into the NEW password field and a DIFFERENT
 * value into the confirm field — the mismatch variant's pre-flight tripwire.
 */
function fillMismatchedCredentialFields(): void {
  const fields = queryDialog()?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? [];
  const [newField, confirmField] = fields;
  if (newField) typeIntoField(newField, DEMO_CREDENTIAL);
  if (confirmField) typeIntoField(confirmField, MISMATCHED_CONFIRM);
}

/** Ticks the force-reset checkbox once. */
function clickForceResetCheckbox(): void {
  queryDialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
}

/** Clicks the footer button whose text equals the given label. */
function clickDialogButton(label: string): void {
  const buttons = [...(queryDialog()?.querySelectorAll("button") ?? [])];
  buttons.find(button => button.textContent === label)?.click();
}

interface DialogHarnessProps {
  readonly mocks: readonly MockLink.MockedResponse[];
  readonly loading?: boolean;
  /** Type both credential fields once after mount (filled variants). */
  readonly autoFill?: boolean;
  /** Type new + a DIVERGENT confirm value once after mount (mismatch variant). */
  readonly autoFillMismatch?: boolean;
  /** Tick the force-reset checkbox once after mount. */
  readonly autoCheck?: boolean;
  /** Click the submit button once after mount (error-projection variants). */
  readonly autoSubmit?: boolean;
}

/**
 * Harness — keeps the mutation on the harness side (mirroring the page
 * wiring), and drives optional one-shot DOM interactions for the variants
 * whose interest IS a post-interaction state (filled fields, ticked
 * checkbox, projected server errors). Clicks/typing run against the dialog
 * portal once after mount on staggered timers.
 *
 * Two layers are REQUIRED: `useMutation` must run in a component that is a
 * DESCENDANT of `StoryApolloProvider` — hooks called by the component that
 * renders the provider itself see no Apollo context (invariant violation).
 */
function DialogHarness({ mocks, ...innerProps }: DialogHarnessProps): ReactNode {
  return (
    <StoryApolloProvider mocks={mocks}>
      <DialogHarnessInner {...innerProps} />
    </StoryApolloProvider>
  );
}

function DialogHarnessInner({
  loading = false,
  autoFill = false,
  autoFillMismatch = false,
  autoCheck = false,
  autoSubmit = false,
}: Omit<DialogHarnessProps, "mocks">): ReactNode {
  const [setUserPassword] = useMutation(adminSetUserPasswordMutationDocument);
  const [settingCredential, setSettingCredential] = useState(false);
  const labels = useAppTranslation(AdminUsers);

  useEffect(() => {
    if (!autoFill && !autoFillMismatch && !autoCheck && !autoSubmit) return undefined;
    const steps: DriverStep[] = [];
    if (autoFill) steps.push({ delayMs: 300, run: fillCredentialFields });
    if (autoFillMismatch) steps.push({ delayMs: 300, run: fillMismatchedCredentialFields });
    if (autoCheck) steps.push({ delayMs: 450, run: clickForceResetCheckbox });
    if (autoSubmit) {
      steps.push({
        delayMs: 600,
        run: () => clickDialogButton(labels.changePasswordDialog.submit),
      });
    }
    const timerIds = steps.map(step => window.setTimeout(step.run, step.delayMs));
    return () => {
      timerIds.forEach(timerId => {
        window.clearTimeout(timerId);
      });
    };
  }, [autoFill, autoFillMismatch, autoCheck, autoSubmit, labels]);

  return (
    <ChangeUserPasswordDialog
      labels={labels}
      user={TARGET_USER}
      loading={loading || settingCredential}
      onClose={() => {
        // The canvas has no dialog-target state to clear — the story keeps
        // the dialog open so close/submit outcomes stay inspectable.
      }}
      onSubmit={async input => {
        // The NO-try/catch contract applies — rejections propagate into the
        // dialog's feedback seam (inline field errors / top-level Alert).
        setSettingCredential(true);
        try {
          await setUserPassword({ variables: { id: TARGET_USER.id, input } });
        } finally {
          setSettingCredential(false);
        }
      }}
    />
  );
}

const meta = {
  title: "Admin/Change User Password Dialog",
  component: DialogHarness,
  parameters: {
    layout: "fullscreen",
    controls: { exclude: ["mocks", "loading", "autoFill", "autoFillMismatch", "autoCheck", "autoSubmit"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DialogHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty form — both credential fields blank, force-reset flag off by default. */
export const Default: Story = {
  args: { mocks: [setCredentialSuccessMock(false)] },
};

/** Both credential fields typed (the harness types them once after mount). */
export const Filled: Story = {
  args: { mocks: [setCredentialSuccessMock(false)], autoFill: true },
};

/** Force-reset checkbox ticked — the helper line under it stays visible. */
export const RequireResetChecked: Story = {
  args: { mocks: [setCredentialSuccessMock(true)], autoCheck: true },
};

/**
 * Server field-error projection: the harness fills + submits once, the
 * mutation rejects with a VALIDATION `fields` payload on `password`
 * (`PASSWORD_TOO_SHORT`), and the message renders as inline `helperText`
 * under the password field — dialog stays open for correction.
 */
export const FieldErrorTooShort: Story = {
  args: { mocks: [CREDENTIAL_FIELD_ERROR_MOCK], autoFill: true, autoSubmit: true },
};

/**
 * Field-less denial projection: the mutation rejects with `FORBIDDEN` (no
 * `fields` payload) and the message lands in the dialog's top-level Alert.
 */
export const FormErrorForbidden: Story = {
  args: { mocks: [CREDENTIAL_FORBIDDEN_MOCK], autoFill: true, autoSubmit: true },
};

/**
 * Client-side confirm-mismatch channel: the harness types a DIVERGENT
 * confirm value and submits once. The dialog's pre-flight guard rejects the
 * submit BEFORE the mutation — the success mock below is never reached —
 * and the mismatch copy renders as inline `helperText` under the confirm
 * field while the dialog stays open for correction.
 */
export const ConfirmMismatch: Story = {
  args: { mocks: [setCredentialSuccessMock(false)], autoFillMismatch: true, autoSubmit: true },
};

/** In-flight submit — both footer buttons disabled while the mutation runs. */
export const Submitting: Story = {
  args: { mocks: [setCredentialSuccessMock(false)], loading: true },
};
