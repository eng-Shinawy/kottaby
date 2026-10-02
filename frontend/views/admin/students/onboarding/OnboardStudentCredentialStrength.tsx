"use client";

/**
 * OnboardStudentCredentialStrength — the quiet strength readout under the
 * onboarding credential input: four segments plus a localized label, both
 * driven by the pure `scoreCredential` scorer. Renders nothing for an
 * empty value (no noise before the admin starts typing), and the label
 * word is the only text — the segments are decorative (aria-hidden).
 */

import { Box, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import {
  CREDENTIAL_STRENGTH_SEGMENT_KEYS,
  type CredentialStrengthLevel,
  scoreCredential,
} from "@/frontend/views/admin/students/onboarding/credentialStrength";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** Level → filled-segment count (the segments ARE the scale). */
const FILLED_SEGMENTS: Record<CredentialStrengthLevel, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 };

/** Level → segment/label tone (error / warning / success — no blue family). */
const STRENGTH_TONE: Record<CredentialStrengthLevel, "error" | "warning" | "success"> = {
  0: "error",
  1: "error",
  2: "warning",
  3: "success",
  4: "success",
};

/** Level → label key into the strength vocabulary (the row's only text). */
const STRENGTH_LABEL_KEY: Record<CredentialStrengthLevel, keyof StudentOnboardingLabels["strength"]> = {
  0: "weak",
  1: "weak",
  2: "fair",
  3: "good",
  4: "strong",
};

/** One quiet segment — filled segments ride their level's tone. */
const segmentSx =
  (filled: boolean, tone: "error" | "warning" | "success"): SxProps<Theme> =>
  theme => ({
    flex: 1,
    height: 4,
    borderRadius: 2,
    bgcolor: filled ? theme.palette[tone].main : theme.palette.action.hover,
    transition: theme.transitions.create("background-color", { duration: theme.transitions.duration.shortest }),
  });

export interface OnboardStudentCredentialStrengthProps {
  /** The credential's live value (scored raw — spaces may be intentional). */
  readonly value: string;
  /** The strength row's localized vocabulary. */
  readonly labels: StudentOnboardingLabels["strength"];
}

export function OnboardStudentCredentialStrength({ value, labels }: OnboardStudentCredentialStrengthProps): ReactNode {
  const level = scoreCredential(value);
  const filled = FILLED_SEGMENTS[level];
  const tone = STRENGTH_TONE[level];
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, mt: 0.75 }}>
      <Box aria-hidden sx={{ display: "flex", flex: 1, gap: 0.75 }}>
        {CREDENTIAL_STRENGTH_SEGMENT_KEYS.map((segmentKey, index) => (
          <Box key={segmentKey} sx={segmentSx(index < filled, tone)} />
        ))}
      </Box>
      <Typography
        variant="caption"
        sx={theme => ({ color: theme.palette[tone].main, fontWeight: 600, whiteSpace: "nowrap" })}
      >
        {labels[STRENGTH_LABEL_KEY[level]]}
      </Typography>
    </Stack>
  );
}
