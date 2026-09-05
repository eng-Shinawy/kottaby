"use client";

/**
 * CreateUserInfoCallout — the info callout of the admin "create user" dialog
 * (extracted from `CreateUserDialog.tsx`), presenting the applicant-status
 * and admin-account restriction copy at the end of the form.
 */

import { InfoOutlined as InfoIcon } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface CreateUserInfoCalloutProps {
  readonly text: string;
}

/** Info callout — applicant status + admin-account restriction. */
export function CreateUserInfoCallout({ text }: CreateUserInfoCalloutProps): ReactNode {
  return (
    <Box
      sx={theme => ({
        display: "flex",
        alignItems: "flex-start",
        gap: 1.5,
        p: 2,
        borderRadius: "10px",
        backgroundColor: theme.palette.surfaceContainerHigh,
        borderInlineStart: `4px solid ${theme.palette.info.main}`,
      })}
    >
      <InfoIcon sx={theme => ({ fontSize: 20, color: theme.palette.info.main })} />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.onSurface })}>
        {text}
      </Typography>
    </Box>
  );
}
