"use client";

/**
 * AdminStudentDrawerBalancesSection — the student detail drawer's balances
 * section (extracted from `AdminStudentDetailDrawer`): four large stat
 * tiles in the backend's canonical lane order, painted from the same M3
 * container lanes the row badges use: hifz = primary, reviews = secondary,
 * tajweed = success, trial = warning.
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryDrawerSection } from "@/frontend/views/admin/directory-shared/DirectoryDrawerPrimitives";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { type DirectoryTone, toneColors } from "@/frontend/views/admin/users/utils";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

interface StudentDrawerBalancesSectionProps {
  readonly student: StudentDirectoryItem;
  readonly labels: AdminStudentsLabels;
}

export function StudentDrawerBalancesSection({ student, labels }: StudentDrawerBalancesSectionProps): ReactNode {
  return (
    <DirectoryDrawerSection label={labels.drawer.sectionBalances}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
        <BalanceTile tone="primary" label={labels.balances.hifz} value={student.balanceHifz} />
        <BalanceTile tone="secondary" label={labels.balances.reviews} value={student.balanceReviews} />
        <BalanceTile tone="success" label={labels.balances.tajweed} value={student.balanceTajweed} />
        <BalanceTile tone="warning" label={labels.balances.trial} value={student.balanceTrial} />
      </Box>
    </DirectoryDrawerSection>
  );
}

interface BalanceTileProps {
  readonly tone: DirectoryTone;
  readonly label: string;
  readonly value: number;
}

/** One balance stat tile — caption over a large count on the tonal lane. */
function BalanceTile({ tone, label, value }: BalanceTileProps): ReactNode {
  return (
    <Box
      sx={theme => {
        const colors = toneColors(theme, tone);
        return {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.5,
          px: 1.5,
          py: 1.5,
          borderRadius: "12px",
          bgcolor: colors.bg,
          color: colors.fg,
        };
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="h6" component="span" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Box>
  );
}
