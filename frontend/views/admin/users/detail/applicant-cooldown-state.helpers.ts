/**
 * Cooldown-state display mapping for the applicant snapshot card on the
 * admin user DETAIL page.
 *
 * The derived `ApplicantCooldownState` read-model (pure compute from
 * `cooldown_until` + now, single-source with the applicant-facing profile)
 * resolves to a tone-labeled chip so an administrator can read the
 * re-purchase gate at a glance:
 *
 *  - `Active`   → warning lane: the cooldown still blocks verification
 *                 purchases until the stored instant;
 *  - `Expired`  → info lane: the instant has passed and the re-purchase
 *                 gate is open again;
 *  - `None`     → neutral lane: no cooldown was ever recorded (or it was
 *                 cleared on certification).
 *
 * The mapping is pure so both the desktop stats panel and any future
 * renderer share one vocabulary.
 */

import { ApplicantCooldownState } from "@/frontend/graphql/generated/gql/graphql";
import type { DetailTone } from "@/frontend/views/admin/users/detail/UserDetailPrimitives";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** The tone lane an active cooldown paints — the re-purchase gate is closed. */
const ACTIVE_TONE: DetailTone = "warning";
/** The tone lane a lapsed cooldown paints — the gate reopened. */
const EXPIRED_TONE: DetailTone = "info";
/** The tone lane for no recorded cooldown. */
const NONE_TONE: DetailTone = "neutral";

/** Tone + localized label pair rendered by the stats panel's state cell. */
export interface CooldownStateChip {
  readonly tone: DetailTone;
  readonly label: string;
}

/**
 * Resolve the display chip for a cooldown state.
 *
 * @param state            the derived state from the applicant snapshot
 * @param cooldownStateLabels the localized display values
 *     (`detail.applicantCooldownState`)
 * @returns the tone/label pair — Active reads as the warning lane (the
 *     re-purchase gate is closed), Expired as informational (the gate
 *     reopened), and anything else as the neutral no-cooldown lane
 */
export function cooldownStateChipOf(
  state: ApplicantCooldownState,
  cooldownStateLabels: AdminUsersLabels["detail"]["applicantCooldownState"]
): CooldownStateChip {
  if (state === ApplicantCooldownState.Active) {
    return { tone: ACTIVE_TONE, label: cooldownStateLabels.active };
  }
  if (state === ApplicantCooldownState.Expired) {
    return { tone: EXPIRED_TONE, label: cooldownStateLabels.expired };
  }
  return { tone: NONE_TONE, label: cooldownStateLabels.none };
}

/**
 * Value color lane for the COOLDOWN-UNTIL stats cell — mirrors the chip's
 * liveness semantics so the expiry instant and the state chip read as one
 * unit (an ACTIVE gate tints the date warning; a lapsed one tints it info;
 * a never-cooled applicant keeps the plain text color).
 */
export function cooldownValueToneOf(state: ApplicantCooldownState): "default" | "warning" | "info" {
  if (state === ApplicantCooldownState.Active) return "warning";
  if (state === ApplicantCooldownState.Expired) return "info";
  return "default";
}
