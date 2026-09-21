/**
 * Shared vocabulary of the `/admin/broadcasts` tab strip: the tab union and
 * the stable DOM ids the strip's `Tab` triggers and the container's
 * `tabpanel` hosts reference in their accessibility wiring. Pure plumbing —
 * the labels themselves resolve through `useAppTranslation(AdminBroadcasts)`
 * at the component seams.
 */

/** The broadcast surface's two tabs (values double as MUI `Tab` values). */
export type BroadcastsTab = "history" | "compose";

/** Stable DOM ids of the two tab triggers (the panels' `aria-labelledby`). */
export const TAB_LABEL_IDS = {
  history: "admin-broadcasts-tab-history",
  compose: "admin-broadcasts-tab-compose",
} as const;

/** Stable DOM ids of the two tab panels. */
export const TAB_PANEL_IDS = {
  history: "admin-broadcasts-panel-history",
  compose: "admin-broadcasts-panel-compose",
} as const;
