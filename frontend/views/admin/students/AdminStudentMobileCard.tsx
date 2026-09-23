"use client";

/**
 * AdminStudentMobileCard — one per-student card of the mobile directory
 * list, composed from the shared directory mobile-card primitives
 * (`DirectoryMobileCard` shell + header atoms + email row + detail rows):
 *  - header as a 3-track grid (`auto minmax(0,1fr) auto`): 44px role-tinted
 *    avatar, the single-line ellipsized NAME (the shared bidi ellipsis
 *    recipe), and a trailing column stacking the joined timestamp caption
 *    above the explicit view-details quick action (read-only directory —
 *    no kebab menu; the card click and the quick action both open the
 *    detail drawer);
 *  - FULL-WIDTH email row immediately BELOW the header grid (above the
 *    divider): the email + copy-email quick action live in their own row
 *    spanning the whole card instead of squeezing into the header's middle
 *    track (at 390px that track is ~180px and long addresses wrapped
 *    mid-word into 2–3 ragged lines — QA-verified);
 *  - hairline divider;
 *  - strict two-column body rows (label at inline-start in `text.secondary`,
 *    value flexing to the inline-end edge, 500 weight): Balances, Parent,
 *    Languages, Trial.
 */

import type { ReactNode } from "react";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { DirectoryMobileCard } from "@/frontend/views/admin/directory-shared/DirectoryMobileCard";
import {
  DirectoryMobileCardAction,
  DirectoryMobileCardCaption,
  DirectoryMobileCardName,
} from "@/frontend/views/admin/directory-shared/DirectoryMobileCardHeader";
import { DirectoryMobileDetailRow } from "@/frontend/views/admin/directory-shared/DirectoryMobileDetailRow";
import { DirectoryMobileEmailRow } from "@/frontend/views/admin/directory-shared/DirectoryMobileEmailRow";
import { StudentParentContent } from "@/frontend/views/admin/students/AdminStudentParentContent";
import {
  StudentBalancesBadges,
  type StudentDirectoryItem,
  StudentLanguageChips,
  StudentTrialContent,
} from "@/frontend/views/admin/students/AdminStudentRowCells";
import { StudentRecentOnboardingChip } from "@/frontend/views/admin/students/StudentRecentOnboardingChip";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

/** Role lane for directory avatars (expression-passed — a `role` string
 * attribute would trip the ARIA role lint against a component prop). */
const STUDENT_AVATAR_ROLE = "Student" as const;

interface AdminStudentMobileCardProps {
  readonly labels: AdminStudentsLabels;
  readonly student: StudentDirectoryItem;
  readonly locale: "ar" | "en";
  /** Invoked after the email copy resolves successfully (drives the snackbar). */
  readonly onCopyEmail?: () => void;
  /** Opens the detail drawer for this card (the directory owns the drawer). */
  readonly onViewDetails?: (student: StudentDirectoryItem) => void;
  /** Lowercased emails of the admin's recent onboardings (the chip match). */
  readonly recentEmails?: ReadonlySet<string>;
  /** Highlight mode — dims this card unless the student was recently onboarded. */
  readonly highlight?: boolean;
}

export function AdminStudentMobileCard({
  labels,
  student,
  locale,
  onCopyEmail,
  onViewDetails,
  recentEmails,
  highlight,
}: AdminStudentMobileCardProps): ReactNode {
  const joinedCaption = formatApplicantDate(student.createdAt, locale);
  const recentlyOnboarded = recentEmails?.has(student.email.toLowerCase()) === true;
  const openDetails = onViewDetails === undefined ? undefined : () => onViewDetails(student);
  return (
    <DirectoryMobileCard
      quiet={highlight === true && !recentlyOnboarded}
      avatarName={student.name}
      avatarRole={STUDENT_AVATAR_ROLE}
      onClick={openDetails}
      name={<DirectoryMobileCardName name={student.name} />}
      trailing={
        <>
          {recentlyOnboarded ? <StudentRecentOnboardingChip labels={labels} /> : null}
          <DirectoryMobileCardCaption caption={joinedCaption} />
          {openDetails !== undefined && (
            <DirectoryMobileCardAction
              tooltipLabel={labels.drawer.viewDetails}
              ariaLabel={labels.drawer.viewDetails}
              onClick={openDetails}
            />
          )}
        </>
      }
      identity={
        <DirectoryMobileEmailRow
          email={student.email}
          copyEmailLabel={labels.quickActions.copyEmail}
          emailCopiedLabel={labels.quickActions.emailCopied}
          onCopyEmail={onCopyEmail}
        />
      }
      rows={
        <>
          <DirectoryMobileDetailRow label={labels.headers.balances}>
            <StudentBalancesBadges student={student} labels={labels} />
          </DirectoryMobileDetailRow>
          <DirectoryMobileDetailRow label={labels.headers.parent}>
            <StudentParentContent student={student} labels={labels} />
          </DirectoryMobileDetailRow>
          <DirectoryMobileDetailRow label={labels.headers.languages}>
            <StudentLanguageChips student={student} />
          </DirectoryMobileDetailRow>
          <DirectoryMobileDetailRow label={labels.headers.trial}>
            <StudentTrialContent student={student} locale={locale} labels={labels} />
          </DirectoryMobileDetailRow>
        </>
      }
    />
  );
}
