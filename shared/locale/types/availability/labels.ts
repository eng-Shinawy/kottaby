/**
 * Availability namespace labels — the teacher-facing availability card on
 * `/teacher/dashboard`: the toggle that controls whether the teacher's
 * profile is open to new session requests (`teacher.is_online`).
 *
 * Used by:
 *  - `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx`
 *    (`useAppTranslation(Availability)` with property access).
 *  - Server Components rendering the card via
 *    `await getTranslations(locale)` → property access.
 *
 * Error copy is NOT duplicated here — the toggle reuses the three existing
 * `errors` namespace keys (`teacherNotCertified`, `teacherInActiveSession`,
 * `teacherNotFound`) through the shared error-link map so the denial
 * vocabulary can never fork between the card and the rest of the app.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `availability-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface AvailabilityLabels {
  /** Card heading — the availability card title on the teacher dashboard. */
  readonly cardTitle: string;
  /** CTA button label — toggle the teacher's status to Available (open to sessions). */
  readonly toggleToAvailableCta: string;
  /** CTA button label — toggle the teacher's status to Unavailable (closed to sessions). */
  readonly toggleToUnavailableCta: string;
  /**
   * Pre-emptive hint rendered when the teacher is NOT certified
   * (`isApproved !== true`) and so cannot toggle Available. Pure copy — the
   * server-side 403 is the defense-in-depth backstop using the existing
   * `errors.teacherNotCertified` key; this hint is the client-side affordance.
   */
  readonly certificationRequiredHint: string;
  /**
   * Locked-card hint rendered when the teacher is currently in a started
   * session and the toggle is therefore disabled. Pure copy — the
   * server-side 409 surfaces the existing `errors.teacherInActiveSession`
   * key; no session id is ever disclosed here.
   */
  readonly inSessionLockedHint: string;
  /** Success notice raised after the availability mutation settles successfully. */
  readonly updateSuccess: string;
  /**
   * Generic failure notice for every unmapped availability rejection code.
   * Raw server messages are never echoed through it; the structured codes
   * (`TEACHER_IN_ACTIVE_SESSION`, `FORBIDDEN`, `TEACHER_NOT_FOUND`,
   * `VALIDATION`) are surfaced via the error-link map, not via this slot.
   */
  readonly updateGenericError: string;
  /** Error-state heading rendered when the initial availability read fails (query rejection). */
  readonly loadErrorNotice: string;
}
