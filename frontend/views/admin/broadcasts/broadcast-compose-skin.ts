/**
 * Shared MUI `sx` skins for the broadcast compose surface.
 *
 * Theme-token discipline: every color resolves through `theme.palette.*`
 * (no hex, no rgb, no string palette access); the shared action skin layers
 * the keyboard focus ring onto the ≥44px touch-target floor (RTL-safe — no
 * physical margin/padding direction anywhere).
 */

import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";

/** Confirm/cancel affordances: focus ring + ≥44px touch target. */
export const ACTION_BUTTON_SX = { ...focusVisibleRingSx, minHeight: 44 } as const;

/** Audience radio controls: keyboard focus ring on the radio input. */
export const RADIO_SX = focusVisibleRingSx;

/** Audience radio rows: ≥44px touch-target floor. */
export const AUDIENCE_ROW_SX = { minHeight: 44 } as const;

/** Companion-select option rows: ≥44px touch-target floor. */
export const MENU_ITEM_SX = { minHeight: 44 } as const;

/** Success-snackbar dismiss affordance: focus ring + ≥44px touch-target floor. */
export const SNACKBAR_DISMISS_SX = { ...focusVisibleRingSx, minHeight: 44, minWidth: 44 } as const;
