"use client";

/**
 * TeacherApplicationStepper — the custom 3-node stepper of the
 * teacher-application card on the admin user DETAIL page (extracted from
 * `TeacherApplicationCard.tsx`).
 *
 * Submitted → Under Review → Certified: filled primary circle with check
 * for completed steps, a primary-ring circle with the review eye for the
 * current step, a neutral circle for pending steps, and an
 * `errorContainer` circle on the certified node for a failed application.
 * Connectors sit at the third-mark percentages (16.6%/50%) via logical
 * insets so the track mirrors under RTL.
 *
 * State machine → node states: Pending/InEvaluation leave step 2 current;
 * Passed completes all three; Failed completes 1–2 and paints step 3 in the
 * error family. An applicant row exists only after submission, so step 1 is
 * always done.
 */

import {
  WorkspacePremiumOutlined as CertifiedIcon,
  CheckOutlined as CheckIcon,
  VisibilityOutlined as ReviewIcon,
} from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { ApplicantStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type TeacherApplicationLabels = AdminUsersLabels["detail"]["teacherApplication"];

/** Stepper node state derived from the applicant lifecycle status. */
type StepState = "done" | "current" | "pending" | "error";

const STEP_CIRCLE_SIZE = 32;

interface StepCircleStyle {
  readonly bgcolor: string;
  readonly iconColor: string;
  readonly border?: string;
}

/** Step circle paint per state — every color from the theme palette. */
function stepCircleStyle(theme: Theme, state: StepState): StepCircleStyle {
  switch (state) {
    case "done":
      return { bgcolor: theme.palette.primary.main, iconColor: theme.palette.onPrimary };
    case "current":
      return {
        bgcolor: theme.palette.background.paper,
        iconColor: theme.palette.primary.main,
        border: `2px solid ${theme.palette.primary.main}`,
      };
    case "error":
      return { bgcolor: theme.palette.errorContainer, iconColor: theme.palette.onErrorContainer };
    default:
      return { bgcolor: theme.palette.surfaceContainerHighest, iconColor: theme.palette.onSurfaceVariant };
  }
}

/** Under-node label color per state (current = primary 600-weight). */
function stepLabelColor(theme: Theme, state: StepState): string {
  switch (state) {
    case "done":
      return theme.palette.text.primary;
    case "current":
      return theme.palette.primary.main;
    case "error":
      return theme.palette.error.main;
    default:
      return theme.palette.text.secondary;
  }
}

interface StepNodeProps {
  readonly state: StepState;
  readonly icon: ReactNode;
  readonly label: string;
}

/** One stepper node: state-painted circle with the label centered beneath it. Completed steps render the check. */
function StepNode({ state, icon, label }: StepNodeProps): ReactNode {
  return (
    <Stack sx={{ alignItems: "center", gap: 0.75 }}>
      <Box
        sx={theme => {
          const style = stepCircleStyle(theme, state);
          return {
            width: STEP_CIRCLE_SIZE,
            height: STEP_CIRCLE_SIZE,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: style.bgcolor,
            color: style.iconColor,
            ...(style.border ? { border: style.border } : {}),
            "& > svg": { fontSize: 18 },
          };
        }}
      >
        {state === "done" ? <CheckIcon /> : icon}
      </Box>
      <Typography
        variant="caption"
        sx={theme => ({
          fontWeight: state === "current" ? 600 : 500,
          color: stepLabelColor(theme, state),
          textAlign: "center",
        })}
      >
        {label}
      </Typography>
    </Stack>
  );
}

/** Connector color after the review node — mirrors the certified-node state. */
function reviewConnectorColor(theme: Theme, certified: StepState): string {
  if (certified === "done") return theme.palette.primary.main;
  if (certified === "error") return theme.palette.error.main;
  return theme.palette.divider;
}

interface ApplicationStepperProps {
  readonly status: ApplicantStatus;
  readonly labels: TeacherApplicationLabels;
}

export function ApplicationStepper({ status, labels }: ApplicationStepperProps): ReactNode {
  let reviewState: StepState = "pending";
  let certifiedState: StepState = "pending";
  if (status === ApplicantStatus.Pending || status === ApplicantStatus.InEvaluation) {
    reviewState = "current";
  } else if (status === ApplicantStatus.Passed) {
    reviewState = "done";
    certifiedState = "done";
  } else if (status === ApplicantStatus.Failed) {
    reviewState = "done";
    certifiedState = "error";
  }
  return (
    <Box sx={{ position: "relative", mt: 3 }}>
      {/* Connectors: thirds-marks (1/6 → 1/2 and 1/2 → 5/6) — the middle of
          each equal grid column — via logical insets for RTL mirroring. */}
      <Box
        aria-hidden
        sx={theme => ({
          position: "absolute",
          top: (STEP_CIRCLE_SIZE - 2) / 2,
          insetInlineStart: "16.6667%",
          width: "33.3333%",
          height: 2,
          bgcolor: theme.palette.primary.main,
        })}
      />
      <Box
        aria-hidden
        sx={theme => ({
          position: "absolute",
          top: (STEP_CIRCLE_SIZE - 2) / 2,
          insetInlineStart: "50%",
          width: "33.3333%",
          height: 2,
          bgcolor: reviewConnectorColor(theme, certifiedState),
        })}
      />
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", position: "relative" }}>
        <StepNode state="done" icon={<CheckIcon />} label={labels.stepSubmitted} />
        <StepNode state={reviewState} icon={<ReviewIcon />} label={labels.stepUnderReview} />
        <StepNode state={certifiedState} icon={<CertifiedIcon />} label={labels.stepCertified} />
      </Box>
    </Box>
  );
}
