/**
 * Shared MUI `sx` skins for the audit-trail surfaces.
 *
 * Theme-token discipline: every color/shadow resolves through
 * `theme.palette.*` (no hex, no rgb, no string palette access). The card skin
 * is shared by the skeleton, empty-state and results cards; the body-cell
 * skin keeps the trail's hairline separators start-aligned and top-anchored
 * (RTL-safe — no physical margin/padding direction anywhere).
 */

import type { CSSObject, Theme } from "@mui/material/styles";
import type { AuditActionType } from "@/frontend/graphql/generated/gql/graphql";

/** Shared card skin for the results/empty/skeleton surfaces. */
export function surfaceCardSx(theme: Theme): CSSObject {
  return {
    borderRadius: "12px",
    border: `1px solid ${theme.palette.border.light}`,
    boxShadow: theme.palette.shadow.card,
    overflow: "hidden",
    width: "100%",
  };
}

/** Shared body-cell skin: hairline separators, start-aligned, top-anchored. */
export function bodyCellSx(theme: Theme): CSSObject {
  return {
    borderBottom: `1px solid ${theme.palette.border.light}`,
    padding: theme.spacing(1.5, 1),
    textAlign: "start",
    verticalAlign: "top",
  };
}

/**
 * Fixed-pitch stack for the trail's id atoms (entity-id cell, mono account
 * links) — the CodeChip convention: a LITERAL system stack (the JetBrains
 * Mono variable is never mounted in the app shell, so a `var()` reference
 * degrades to the inherited body font). Shared so the row and the link
 * component cannot drift.
 */
export const AUDIT_MONO_FONT_FAMILY =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' as const;

/**
 * Trail-row skin: an every-other-row tint (the zebra lane that keeps wide
 * fixed-layout tables scannable) plus the hover lift. The hover pseudo-class
 * raises the selector's specificity above the flat zebra background, so a
 * hovered zebra row reliably flips to the interaction lane; the 120ms ease
 * keeps the hand-off felt rather than flickered.
 */
export function trailRowSx(theme: Theme, zebra: boolean): CSSObject {
  return {
    backgroundColor: zebra ? theme.palette.surfaceContainerLow : "transparent",
    transition: "background-color 120ms ease",
    "&:hover": { backgroundColor: theme.palette.action.hover },
  };
}

/** Semantic container-pair keys the action chips tint through. */
type ActionChipTone = "secondary" | "success" | "error" | "warning";

/**
 * Action → tone map for the trail's action chips. One chip per action TYPE
 * is not scannable when every pill wears the same tint; the mapping gives
 * the eye semantic anchors without inventing new copy:
 *
 *  - `create` → success (a thing came into existence);
 *  - `delete` / `suspend` → error (governance-weighted, caution first);
 *  - `override` / `adjust` → warning (a hand reached into the record);
 *  - `update` / `reactivate` → secondary (the neutral default, unchanged).
 */
const ACTION_TONE_BY_TYPE: Record<AuditActionType, ActionChipTone> = {
  Create: "success",
  Update: "secondary",
  Delete: "error",
  Reactivate: "secondary",
  Override: "warning",
  Adjust: "warning",
  Suspend: "error",
};

/**
 * Container/onContainer palette token keys per tone key — literal token names
 * (not the whole `keyof palette` union) so the `theme.palette[...]` lookup
 * resolves to a `string` that satisfies the chip's Color/BackgroundColor slots.
 */
type ContainerBgKey = "secondaryContainer" | "successContainer" | "errorContainer" | "warningContainer";
type ContainerFgKey = "onSecondaryContainer" | "onSuccessContainer" | "onErrorContainer" | "onWarningContainer";

/** The container/onContainer palette tokens per tone key. */
const TONE_CONTAINER_KEYS: Record<ActionChipTone, { bg: ContainerBgKey; fg: ContainerFgKey }> = {
  secondary: { bg: "secondaryContainer", fg: "onSecondaryContainer" },
  success: { bg: "successContainer", fg: "onSuccessContainer" },
  error: { bg: "errorContainer", fg: "onErrorContainer" },
  warning: { bg: "warningContainer", fg: "onWarningContainer" },
};

/**
 * Shared action-chip skin — the pill geometry plus the tone-mapped
 * container pair. Byte-shared by the desktop row and the mobile card so the
 * two renderers cannot drift (the jscpd clone gate watches this fragment).
 */
export function actionChipSx(theme: Theme, actionType: AuditActionType): CSSObject {
  const tone = TONE_CONTAINER_KEYS[ACTION_TONE_BY_TYPE[actionType]];
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: theme.spacing(0.25, 1.25),
    borderRadius: 999,
    backgroundColor: theme.palette[tone.bg],
    color: theme.palette[tone.fg],
    fontSize: 13,
    fontWeight: 600,
  };
}
