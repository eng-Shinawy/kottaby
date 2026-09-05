/**
 * planCatalogFormatting — Presentation formatting helpers for the admin plan catalog.
 *
 * Extracted from PlanCatalogTable (Task 4.3).
 */

/**
 * Format an ISO date string for display; falls back to the localized empty
 * label for missing values and to the raw string for unparseable input.
 */
export function formatPlanDate(dateStr: string | null | undefined, emptyLabel: string): string {
  if (!dateStr) return emptyLabel;
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}
