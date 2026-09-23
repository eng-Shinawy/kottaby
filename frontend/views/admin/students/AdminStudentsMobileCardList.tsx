"use client";

/**
 * AdminStudentsMobileCardList — the mobile (< md) rendering of the admin
 * student directory, rendered on the shared `DirectoryMobileCardList` (a
 * vertical stack of per-student cards with a 16px gap and the 96px
 * `paddingBlockEnd` gap before the pagination card).
 *
 * Loading renders stable-key skeleton cards (announced through the
 * localized loading label); the empty state wraps `AdminStudentsEmptyState`
 * in a card.
 */

import type { ReactNode } from "react";
import { DirectoryMobileCardList } from "@/frontend/views/admin/directory-shared/DirectoryMobileCardList";
import { AdminStudentMobileCard } from "@/frontend/views/admin/students/AdminStudentMobileCard";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { AdminStudentsEmptyState } from "@/frontend/views/admin/students/AdminStudentsEmptyState";
import { ADMIN_STUDENTS_SKELETON_KEYS } from "@/frontend/views/admin/students/adminStudentsDirectory.helpers";
import { useAppLocale } from "@/shared/locale";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

interface AdminStudentsMobileCardListProps {
  readonly labels: AdminStudentsLabels;
  readonly items: readonly StudentDirectoryItem[];
  readonly loading: boolean;
  readonly hasFilters: boolean;
  /** Invoked after any card's copy-email action resolves (drives the snackbar). */
  readonly onCopyEmail?: () => void;
  /** Opens the detail drawer for a card (the directory owns the drawer). */
  readonly onViewDetails?: (student: StudentDirectoryItem) => void;
  /** Lowercased emails of the admin's recent onboardings (the chip match). */
  readonly recentEmails?: ReadonlySet<string>;
  /** Highlight mode — cards outside the recent set render in the quiet lane. */
  readonly highlightRecent?: boolean;
}

export function AdminStudentsMobileCardList(props: AdminStudentsMobileCardListProps): ReactNode {
  const locale = useAppLocale();
  return (
    <DirectoryMobileCardList
      loading={props.loading}
      loadingLabel={props.labels.loading}
      skeletonKeys={ADMIN_STUDENTS_SKELETON_KEYS}
      empty={<AdminStudentsEmptyState labels={props.labels} hasFilters={props.hasFilters} />}
      cards={props.items.map(student => (
        <AdminStudentMobileCard
          key={student.id}
          labels={props.labels}
          student={student}
          locale={locale}
          onCopyEmail={props.onCopyEmail}
          onViewDetails={props.onViewDetails}
          recentEmails={props.recentEmails}
          highlight={props.highlightRecent === true}
        />
      ))}
    />
  );
}
