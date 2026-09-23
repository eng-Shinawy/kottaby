"use client";

/**
 * Shared form-dialog atoms for the admin student drawer's subscription
 * dialogs (extend / renew / cancel / change plan): thin locale-shaped
 * wrappers over the cross-surface atoms
 * (`frontend/views/admin/shared/dialogFormAtoms`) with the drawer's
 * narrower `xs` dialog. The prop vocabulary (dismiss/submit labels, the
 * suites' submitTestId) stays local so the four dialogs' import surface
 * is untouched by the shared extraction.
 */

import type { ReactNode } from "react";
import { AdminDialogActionsPair, AdminFormDialog } from "@/frontend/views/admin/shared/dialogFormAtoms";

interface SubscriptionFormDialogProps {
  /** Whether the dialog is mounted-open. */
  readonly open: boolean;
  /** Dismiss intent (dismiss Button / backdrop click / Escape). */
  readonly onClose: () => void;
  /** True while the section's mutation is in flight — dismissal gated. */
  readonly loading: boolean;
  /** The validated submit intent — the paper hosts the form element. */
  readonly onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  /** The dialog title's DOM id (the `aria-labelledby` target). */
  readonly titleId: string;
  /** The localized dialog title. */
  readonly title: string;
  /** The dialog body (fields + copy + server-error alert). */
  readonly children: ReactNode;
  /** The action row (typically {@link SubscriptionDialogActions}). */
  readonly actions: ReactNode;
}

/** The gated form-dialog shell: Dialog + title + grid content (actions passed through). */
export function SubscriptionFormDialog(props: Readonly<SubscriptionFormDialogProps>): ReactNode {
  return <AdminFormDialog {...props} maxWidth="xs" />;
}

interface SubscriptionDialogActionsProps {
  /** Dismiss intent — the cancel affordance (disabled while loading). */
  readonly onClose: () => void;
  /** True while the section's mutation is in flight. */
  readonly loading: boolean;
  /** Localized Common-namespace dismiss label. */
  readonly dismissLabel: string;
  /** Localized confirm/submit label. */
  readonly submitLabel: string;
  /** The submit affordance's testid (the suites drive it). */
  readonly submitTestId: string;
  /**
   * Extra disable condition beyond `loading` (e.g. an invalid days count
   * or no eligible target plan) — the submit stays available for
   * gated-then-corrected submits.
   */
  readonly submitDisabled?: boolean;
  /** Submit palette — the destructive cancel arm uses `error`. */
  readonly submitColor?: "primary" | "error";
}

/** The shared dismiss/submit action pair of the subscription dialogs. */
export function SubscriptionDialogActions(props: Readonly<SubscriptionDialogActionsProps>): ReactNode {
  return <AdminDialogActionsPair {...props} />;
}
