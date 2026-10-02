/**
 * Tone → color resolvers for the notification surfaces' category tinting —
 * ONE definition site so the row's leading disc (`NotificationRowTypeAvatar`)
 * and the row's type chip echo the SAME Material-You container pair and can
 * never drift. Resolved through the RUNTIME theme (sx theme callbacks), so
 * both the light and the dark palette tint correctly.
 *
 * Leaf module: framework-free constants only — every consumer stays inside
 * an sx theme callback and imports nothing beyond these pure functions.
 */

import type { Theme } from "@mui/material/styles";
import type { NotificationTypeTone } from "@/frontend/views/notifications/utils";

/** The tone's container tint (disc backgrounds, soft chip fills). */
export function toneContainerColor(theme: Theme, tone: NotificationTypeTone): string {
  if (tone === "info") return theme.palette.infoContainer;
  if (tone === "success") return theme.palette.successContainer;
  if (tone === "warning") return theme.palette.warningContainer;
  if (tone === "error") return theme.palette.errorContainer;
  return theme.palette.primaryContainer;
}

/** The tone's on-container color (glyphs riding the container tint). */
export function toneOnContainerColor(theme: Theme, tone: NotificationTypeTone): string {
  if (tone === "info") return theme.palette.onInfoContainer;
  if (tone === "success") return theme.palette.onSuccessContainer;
  if (tone === "warning") return theme.palette.onWarningContainer;
  if (tone === "error") return theme.palette.onErrorContainer;
  return theme.palette.onPrimaryContainer;
}
