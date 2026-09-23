/**
 * AdminApplicantRowCells — the shared cell-level components for the admin
 * applicant-queue surfaces (desktop table + mobile card list).
 *
 * Both surfaces render the SAME semantic content per row — lifecycle status
 * chip, governance pills, attempts count, last-attempt timestamp, cooldown
 * (date or cooling-down chip), joined timestamp — so the rendering lives in
 * this component family and each surface composes it.
 *
 * Structure (mirrors the users directory split):
 *  - `AdminApplicantIdentityCell` → the desktop-only identity `TableCell`
 *    (avatar + name PROFILE LINK + email + copy-email quick action) and the
 *    explicit view-profile quick action; also exports
 *    `ApplicantDirectoryItem` (the queue list-item row type).
 *  - `AdminApplicantStatusCells` → status content (lifecycle chip +
 *    governance pills).
 *  - `AdminApplicantDetailCells` → content-only detail cells (attempts,
 *    last attempt, cooldown, joined).
 *
 * Every color is resolved through a `sx` theme callback against the M3
 * container/`on<Color>Container` pairs; pills paint through the shared
 * `TonalChip` + `toneColors` utilities imported from the users directory
 * (single tonal-lane mapping across the admin domain).
 *
 * Layout: the implementation is split across the sibling modules above;
 * this entry stays the public barrel — consumers import from here only.
 */

export {
  ApplicantAttemptsText,
  ApplicantCooldownContent,
  ApplicantJoinedText,
  ApplicantLastAttemptText,
} from "@/frontend/views/admin/teachers/AdminApplicantDetailCells";
export {
  type ApplicantDirectoryItem,
  ApplicantIdentityCell,
  ViewProfileButton,
} from "@/frontend/views/admin/teachers/AdminApplicantIdentityCell";
export { ApplicantStatusStack } from "@/frontend/views/admin/teachers/AdminApplicantStatusCells";
