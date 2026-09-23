/**
 * AdminTeacherRowCells — the shared cell-level components for the admin
 * teacher directory surfaces (desktop table + mobile card list).
 *
 * Both surfaces render the SAME semantic content per row — approval pill,
 * presence dot, governance pills, rating, subject chips, evaluator chip,
 * joined timestamp — so the rendering lives in this component family and
 * each surface composes it.
 *
 * Structure (mirrors the users directory split):
 *  - `AdminTeacherIdentityCell` → the desktop-only identity `TableCell`
 *    (avatar + name + email + copy-email quick action; NO profile link —
 *    this directory is read-only) and the explicit view-details quick
 *    action; also exports `TeacherDirectoryItem` (the directory list-item
 *    row type).
 *  - `AdminTeacherStatusCells` → status content (approval pill + presence
 *    + governance pills).
 *  - `AdminTeacherDetailCells` → content-only detail cells (rating,
 *    subject chips, evaluator chip, joined timestamp).
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
  TeacherEvaluatorChip,
  TeacherJoinedText,
  TeacherRatingText,
  TeacherSubjectsChips,
} from "@/frontend/views/admin/teachers/AdminTeacherDetailCells";
export {
  type TeacherDirectoryItem,
  TeacherIdentityCell,
} from "@/frontend/views/admin/teachers/AdminTeacherIdentityCell";
export {
  TeacherApprovalPill,
  TeacherGovernancePills,
  TeacherPresenceLabel,
  TeacherStatusStack,
} from "@/frontend/views/admin/teachers/AdminTeacherStatusCells";
