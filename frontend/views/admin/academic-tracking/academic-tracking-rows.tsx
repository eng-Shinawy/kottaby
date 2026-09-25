"use client";

/**
 * Admin academic-tracking dashboard listing — the responsive dispatcher
 * over the settled all-students page: desktop table ≥md, stacked cards
 * below (the admin directory posture). Deep imports only; the container
 * orchestrates state, this component renders the settled data.
 *
 * Honesty rules carried through every cell: an absent latest-position slot
 * renders the localized "none" label, an ungraded track renders the
 * localized "not graded yet" label, a null last-graded stamp renders the
 * em-dash placeholder — the honest states never share a label and no cell
 * ever fabricates a value.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * no MUI style props.
 */

import { ArrowForwardIosOutlined } from "@mui/icons-material";
import { Box, Link as MuiLink, Stack } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminAcademicDashboardQuery_adminAcademicDashboard_items } from "@/frontend/graphql/generated/gql/graphql";
import { parseStudentId } from "@/frontend/views/admin/academic-tracking/academic-tracking-display";
import { AcademicStudentsDesktopTable } from "@/frontend/views/admin/academic-tracking/academic-tracking-listing-tables";
import { academicTrackingDetailRoute } from "@/frontend/views/admin/academic-tracking/academic-tracking-routes";
import { AcademicStudentCard } from "@/frontend/views/admin/academic-tracking/academic-tracking-student-card";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

export interface AcademicStudentsListingProps {
  readonly rows: readonly AdminAcademicDashboardQuery_adminAcademicDashboard_items[];
  readonly labels: AdminAcademicLabels;
  readonly locale: string;
}

/** Per-student drill-down link — fail-closed on a non-numeric wire id. */
function StudentDetailLink({
  rowId,
  fullName,
  labels,
  withChevron,
}: Readonly<{ rowId: string; fullName: string; labels: AdminAcademicLabels; withChevron?: boolean }>): ReactNode {
  const studentId = parseStudentId(rowId);
  if (studentId === null) {
    return null;
  }
  return (
    <MuiLink
      component={Link}
      href={academicTrackingDetailRoute(studentId)}
      aria-label={`${labels.viewDetailAction} ${fullName}`}
      underline="none"
      sx={theme => ({
        color: theme.palette.primary.main,
        fontWeight: 600,
        borderRadius: "6px",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        "&:hover": { color: theme.palette.primary.dark },
      })}
    >
      {labels.viewDetailAction}
      {withChevron ? (
        <ArrowForwardIosOutlined
          sx={theme => ({
            fontSize: 14,
            transform: theme.direction === "rtl" ? "scaleX(-1)" : "none",
          })}
        />
      ) : null}
    </MuiLink>
  );
}

/** The all-students dashboard listing — desktop table ≥md, stacked cards below. */
export function AcademicStudentsListing({ rows, labels, locale }: Readonly<AcademicStudentsListingProps>): ReactNode {
  return (
    <>
      <Box data-testid="academic-tracking-students-table" sx={{ display: { xs: "none", md: "block" } }}>
        <AcademicStudentsDesktopTable
          rows={rows}
          labels={labels}
          locale={locale}
          renderDetailLink={props => StudentDetailLink({ ...props, labels })}
        />
      </Box>
      <Stack spacing={2} data-testid="academic-tracking-student-cards" sx={{ display: { xs: "flex", md: "none" } }}>
        {rows.map(row => (
          <AcademicStudentCard
            key={row.id}
            row={row}
            labels={labels}
            locale={locale}
            renderDetailLink={props => StudentDetailLink({ ...props, labels })}
          />
        ))}
      </Stack>
    </>
  );
}
