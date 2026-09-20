/**
 * Lessons namespace labels — curriculum (lesson) management under a
 * subscription plan.
 *
 * Used by:
 *  - Admin lessons catalog page (`/admin/lessons`)
 *  - Plan selector feeding the lesson table
 *  - Create/edit lesson dialog
 *  - Delete confirmation dialog
 *  - Admin sidebar navigation
 */
export interface LessonsLabels {
  readonly pageTitle: string;
  readonly pageSubtitle: string;
  readonly planSelectorLabel: string;
  readonly planSelectorPlaceholder: string;
  readonly titleColumn: string;
  readonly createdAtColumn: string;
  readonly actionsColumn: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly createLessonButton: string;
  readonly editLessonButton: string;
  readonly deleteLessonButton: string;
  readonly createLessonDialogTitle: string;
  readonly editLessonDialogTitle: string;
  readonly titleFieldLabel: string;
  readonly titleFieldPlaceholder: string;
  /** Client-side validation: lesson title must be non-empty when trimmed and at most 255 characters. */
  readonly validationTitleMessage: string;
  readonly cancelButton: string;
  readonly saveButton: string;
  readonly savingButton: string;
  readonly confirmDeleteTitle: string;
  readonly confirmDeleteMessage: string;
  readonly confirmButton: string;
  readonly createSuccessToast: string;
  readonly updateSuccessToast: string;
  readonly deleteSuccessToast: string;
  /** Generic form-level failure when the thrown error carries no usable message. */
  readonly unexpectedErrorMessage: string;
  /** Localized page metadata for the admin lessons route. */
  readonly metaTitle: string;
  readonly metaDescription: string;
}
