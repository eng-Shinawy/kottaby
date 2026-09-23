"use client";

/**
 * StudentRecentOnboardingChip — the directory row's "recently onboarded"
 * flag: a compact success-lane chip (the shared `TonalChip`) with a tooltip
 * pointing at the onboarding dialog's handoff-code history. Desktop rows
 * render it beside the student's name; mobile cards lead their trailing
 * stack with it. Purely presentational — the caller owns the email match.
 */

import { Box, Tooltip } from "@mui/material";
import type { ReactNode } from "react";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

interface StudentRecentOnboardingChipProps {
  readonly labels: Pick<AdminStudentsLabels, "recentlyOnboarded">;
}

export function StudentRecentOnboardingChip({ labels }: StudentRecentOnboardingChipProps): ReactNode {
  return (
    <Box sx={{ display: "inline-flex", flexShrink: 0 }}>
      {/* The span bridge gives the Tooltip a DOM child to attach to — the
          tonal chip is a styled MUI Chip without a ref forward. */}
      <Tooltip title={labels.recentlyOnboarded.tooltip} placement="top" enterDelay={350} arrow>
        <span>
          <TonalChip tone="success" label={labels.recentlyOnboarded.chip} />
        </span>
      </Tooltip>
    </Box>
  );
}
