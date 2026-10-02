"use client";

/**
 * useOnboardingPlanOptions — the onboarding dialog's option feeds.
 *
 * Two stateful reads over EXISTING admin-gated documents:
 *   • `planCatalogQueryDocument` — the purchasable plans catalog; the
 *     backend resolves it to ACTIVE plans only, so the option set needs
 *     no client-side filter.
 *   • `adminUsersQueryDocument` — role-filtered to parents, the option
 *     set for the optional parent-association picker.
 *
 * Rows thread through to the dialog props VERBATIM (zero mapping) — the
 * dialog's option props are the codegen-extracted row types themselves.
 *
 * Both reads are SKIP-GATED on `enabled`: the directory surface mounts this
 * hook unconditionally, so the feeds stay off the network until the dialog
 * actually opens (no option traffic for browse-only directory visits).
 * Flipping `enabled` back on executes the reads — the in-flight flags then
 * drive the dialog's loading states, and resolved rows come from cache.
 */

import { useQuery } from "@apollo/client/react";
import {
  type AdminUsersQuery_adminUsers_items,
  type PlanCatalogQuery_planCatalog,
  UserRole,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminUsersQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { planCatalogQueryDocument } from "@/frontend/graphql/sharedDocuments/billing";

export interface OnboardingPlanOptions {
  /** Active catalog plans for the plan picker (backend pre-filtered). */
  readonly planOptions: readonly PlanCatalogQuery_planCatalog[];
  /** True while the catalog read is in flight (empty option set until then). */
  readonly plansLoading: boolean;
  /** Parent-role directory rows for the parent-association picker. */
  readonly parentOptions: readonly AdminUsersQuery_adminUsers_items[];
  /** True while the parents read is in flight (empty option set until then). */
  readonly parentsLoading: boolean;
}

/** Hook arguments. */
export interface UseOnboardingPlanOptionsArgs {
  /** False keeps both option feeds skipped (no network); true runs them. */
  readonly enabled?: boolean;
}

export function useOnboardingPlanOptions({ enabled = true }: UseOnboardingPlanOptionsArgs = {}): OnboardingPlanOptions {
  const plans = useQuery(planCatalogQueryDocument, { skip: !enabled });
  const parents = useQuery(adminUsersQueryDocument, {
    variables: { filters: { role: UserRole.Parent } },
    skip: !enabled,
  });

  return {
    planOptions: plans.data?.planCatalog ?? [],
    plansLoading: plans.loading,
    parentOptions: parents.data?.adminUsers.items ?? [],
    parentsLoading: parents.loading,
  };
}
