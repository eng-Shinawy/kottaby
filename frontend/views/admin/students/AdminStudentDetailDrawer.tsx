"use client";

/**
 * AdminStudentDetailDrawer — the per-student detail side-drawer of the
 * admin student directory, opened by clicking a desktop row / mobile card
 * or through the per-row view-details quick action.
 *
 * The drawer is mostly PRESENTATIONAL: it renders only fields the
 * directory item already carries (no extra queries, no mutations) grouped
 * in section cards — identity, balances, parent placement, languages,
 * free trial, and record. The ONE exception is the subscription-
 * management section (below balances), which hosts its own admin-only
 * read + lifecycle mutations via `SubscriptionAdminSection` — the page is
 * `withPageAuth([Admin])`-gated, so that section never renders elsewhere.
 * Every caption comes from the `AdminStudents` namespace; data
 * values render verbatim.
 *
 * Layout: the shell, the shared section primitives and the shared
 * identity/record sections live in `frontend/views/admin/directory-shared/`
 * (`DirectoryDetailDrawer` / `DirectoryDrawerPrimitives` /
 * `DirectoryDrawer{Identity,Record}Section`); the two domain sections live
 * beside this file (`AdminStudentDrawer{Balances,Placement}Section.tsx`);
 * this module keeps the student composition plus the two thin chip
 * sections.
 *
 * RTL/bidi: Latin names/emails/phones are pinned with the HTML `dir="ltr"`
 * ATTRIBUTE + `unicodeBidi: isolate` — a CSS `direction` rule MUST NOT be
 * added (stylis-plugin-rtl flips it and clips the string's head), the same
 * recipe the directory rows and the users detail page use.
 *
 * MUI v9 discipline: `sx`-only styling, colors via theme callbacks,
 * `*Outlined` icons.
 */

import type { ReactNode } from "react";
import { DirectoryDetailDrawer } from "@/frontend/views/admin/directory-shared/DirectoryDetailDrawer";
import { DirectoryDrawerIdentitySection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerIdentitySection";
import { DirectoryDrawerSection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import { DirectoryDrawerRecordSection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerRecordSection";
import { StudentDrawerBalancesSection } from "@/frontend/views/admin/students/AdminStudentDrawerBalancesSection";
import { StudentDrawerPlacementSection } from "@/frontend/views/admin/students/AdminStudentDrawerPlacementSection";
import {
  type StudentDirectoryItem,
  StudentLanguageChips,
  StudentTrialContent,
} from "@/frontend/views/admin/students/AdminStudentRowCells";
import { SubscriptionAdminSection } from "@/frontend/views/admin/students/subscriptions/SubscriptionAdminSection";
import type { AppLocale } from "@/shared/locale";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

/** Role lane for the drawer avatar (expression-passed — matches the rows). */
const STUDENT_AVATAR_ROLE = "Student" as const;

interface AdminStudentDetailDrawerProps {
  /** Whether the drawer is open (the container keeps the item mounted through the exit transition). */
  readonly open: boolean;
  /** The selected student — `null` before the first open. */
  readonly student: StudentDirectoryItem | null;
  readonly labels: AdminStudentsLabels;
  readonly locale: AppLocale;
  /** Close callback (Escape, backdrop click, close button). */
  readonly onClose: () => void;
  /** Invoked after the drawer's copy-email action resolves (drives the shared snackbar). */
  readonly onCopyEmail?: () => void;
}

export function AdminStudentDetailDrawer({
  open,
  student,
  labels,
  locale,
  onClose,
  onCopyEmail,
}: AdminStudentDetailDrawerProps): ReactNode {
  if (student === null) {
    return null;
  }
  return (
    <DirectoryDetailDrawer
      open={open}
      onClose={onClose}
      title={labels.drawer.detailsTitle}
      closeLabel={labels.drawer.close}
    >
      <DirectoryDrawerIdentitySection
        sectionLabel={labels.drawer.sectionIdentity}
        name={student.name}
        email={student.email}
        avatarRole={STUDENT_AVATAR_ROLE}
        copyEmailLabel={labels.quickActions.copyEmail}
        emailCopiedLabel={labels.quickActions.emailCopied}
        phoneLabel={labels.fields.phone}
        phone={student.phone}
        countryLabel={labels.fields.country}
        country={student.country}
        joinedLabel={labels.headers.joined}
        createdAt={student.createdAt}
        locale={locale}
        onCopyEmail={onCopyEmail}
      />
      <StudentDrawerBalancesSection student={student} labels={labels} />
      <SubscriptionAdminSection key={String(student.id)} userId={student.id} />
      <StudentDrawerPlacementSection student={student} labels={labels} />
      <StudentDrawerLanguagesSection student={student} labels={labels} />
      <StudentDrawerTrialSection student={student} labels={labels} locale={locale} />
      <DirectoryDrawerRecordSection
        sectionLabel={labels.drawer.sectionRecord}
        idLabel={labels.fields.id}
        id={student.id}
        viewProfileLabel={labels.quickActions.viewProfile}
      />
    </DirectoryDetailDrawer>
  );
}

interface StudentDrawerLanguagesSectionProps {
  readonly student: StudentDirectoryItem;
  readonly labels: AdminStudentsLabels;
}

/** Languages section — the primary + another chips (em-dash when unset). */
function StudentDrawerLanguagesSection({ student, labels }: StudentDrawerLanguagesSectionProps): ReactNode {
  return (
    <DirectoryDrawerSection label={labels.drawer.sectionLanguages}>
      <StudentLanguageChips student={student} />
    </DirectoryDrawerSection>
  );
}

interface StudentDrawerTrialSectionProps {
  readonly student: StudentDirectoryItem;
  readonly labels: AdminStudentsLabels;
  readonly locale: AppLocale;
}

/** Trial section — the granted chip + timestamp, or the honest em-dash. */
function StudentDrawerTrialSection({ student, labels, locale }: StudentDrawerTrialSectionProps): ReactNode {
  return (
    <DirectoryDrawerSection label={labels.drawer.sectionTrial}>
      <StudentTrialContent student={student} locale={locale} labels={labels} />
    </DirectoryDrawerSection>
  );
}
