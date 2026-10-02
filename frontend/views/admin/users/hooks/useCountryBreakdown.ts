"use client";

/**
 * useCountryBreakdown — the admin users directory's "users by country"
 * facet data hook (`adminUserCountryBreakdown`). A pure read independent
 * of the listing query: the aggregate has its OWN request (refetched
 * alongside the listing after directory writes), and its failure is
 * ABSORBED — a facet error must not take the directory down, so the hook
 * degrades to the empty shape (the facet renders nothing, exactly like
 * the fresh-directory case) while the listing keeps its own error
 * surface.
 */

import { useQuery } from "@apollo/client/react";
import { adminUserCountryBreakdownQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import type { CountryCode } from "@/shared/constants/countries";
import { countrySeedToCode } from "@/shared/lib/country-code";

/**
 * The facet's chip-window request — mirrors the server default (6) so the
 * wire value is explicit and the mutation refetch reuses the SAME shape.
 */
export const COUNTRY_BREAKDOWN_CHIP_LIMIT = 6;

export function useCountryBreakdown() {
  const { data } = useQuery(adminUserCountryBreakdownQueryDocument, {
    variables: { limit: COUNTRY_BREAKDOWN_CHIP_LIMIT },
    fetchPolicy: "cache-and-network",
  });
  return {
    // The facet's server-resolved buckets + the honest unresolved remainder
    // (empty defaults keep the facet silent until the aggregate arrives).
    countryBuckets: data?.adminUserCountryBreakdown.buckets ?? [],
    countryUnresolvedCount: data?.adminUserCountryBreakdown.unresolvedCount ?? 0,
  };
}

/**
 * Builds the facet's chip handler over the directory's country-filter
 * state. The wire code resolves through the SAME canonical seed bridge
 * the URL seed uses (`countrySeedToCode`: a dataset code resolves to
 * itself; anything else fail-closes to a no-op), and re-activating the
 * ACTIVE chip toggles the filter OFF — the facet composes with the
 * toolbar's country select instead of replacing it. The page-resetting
 * setter wrapper still applies (picking a country restarts the result set
 * at page 1).
 */
export function useCountryFacetSelect(directory: {
  readonly countryFilter: CountryCode | "";
  readonly setCountryFilter: (value: CountryCode | "") => void;
}): (code: string) => void {
  return (code: string) => {
    const resolved = countrySeedToCode(code);
    if (resolved === "") {
      return;
    }
    directory.setCountryFilter(directory.countryFilter === resolved ? "" : resolved);
  };
}
