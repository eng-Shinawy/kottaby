/**
 * TeacherDirectory namespace labels — the canonical student-facing copy for
 * the on-demand teacher directory browse. The namespace currently seeds the
 * zero-results empty state: when a browse of available teachers matches no
 * eligible teacher, the directory UI renders this line instead of an error.
 *
 * Consumers:
 *  - The sibling teacher-directory browse UI (route + cards + empty state)
 *    renders `noTeachersAvailable` through its own translation hook.
 *  - The namespace is live the moment it is wired into the bundle slices —
 *    no UI consumer is required for it to resolve.
 *
 * The service layer itself is copy-free: it returns the honest empty page
 * (`items: []`, `total: 0`); presentation copy lives exclusively here.
 * Admin-side teacher-directory empty-state copy (`adminTeachers`) is a
 * separate, admin-gated surface and is NOT reused or altered by this
 * namespace.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `teacherDirectory-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface TeacherDirectoryLabels {
  /** Empty-state line rendered when a browse returns zero eligible teachers (rendered by the sibling directory UI). */
  readonly noTeachersAvailable: string;
}
