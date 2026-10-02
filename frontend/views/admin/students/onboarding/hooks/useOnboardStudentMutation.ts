"use client";

/**
 * useOnboardStudentMutation — the direct student onboarding write seam.
 *
 * Wraps the shared onboarding mutation document with the directory
 * refetch contract: every completed onboarding re-fetches the admin
 * students directory (the page behind the dialog) so the fresh row shows
 * up without a manual reload. The refetch variables are the CALLER's live
 * directory page/filter state (passed in, never hardcoded to page 1), the
 * same shape the admin users directory mutations use for their writes.
 *
 * Rejections propagate to the caller — `useOnboardStudentFormFeedback`
 * catches them once and projects the server messages into the dialog;
 * nothing is swallowed here.
 */

import { useMutation } from "@apollo/client/react";
import type {
  AdminOnboardStudentOfflineInput,
  AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment,
  AdminStudentsQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminOnboardStudentWithOfflinePaymentMutationDocument,
  adminStudentsQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin";

export interface OnboardStudentMutation {
  /**
   * Runs the onboarding mutation and awaits its directory refetch;
   * resolves with the mutation payload on success (null when the wire
   * returns without data), rethrows server rejections.
   */
  readonly onboardStudent: (
    input: AdminOnboardStudentOfflineInput
  ) => Promise<AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment | null>;
  /** True while the mutation (or its awaited directory refetch) is in flight. */
  readonly submitting: boolean;
}

export function useOnboardStudentMutation(directoryVariables: AdminStudentsQueryVariables): OnboardStudentMutation {
  // Every completed write re-fetches the directory page the admin is on —
  // one live refetch contract shared by the whole write seam.
  const refetchAfterOnboard = [{ query: adminStudentsQueryDocument, variables: directoryVariables }];

  const [mutate, { loading }] = useMutation(adminOnboardStudentWithOfflinePaymentMutationDocument, {
    refetchQueries: refetchAfterOnboard,
    awaitRefetchQueries: true,
  });

  const onboardStudent = async (input: AdminOnboardStudentOfflineInput) => {
    const result = await mutate({ variables: { input } });
    return result.data?.adminOnboardStudentWithOfflinePayment ?? null;
  };

  return { onboardStudent, submitting: loading };
}
