"use client";

import { Box, Button, Card, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

interface SignInPromptCardProps {
  readonly t: DashboardLabels;
  readonly loginLabel: string;
}

/** Renders the sign-in prompt shown when no current user is authenticated. */
export function SignInPromptCard({ t, loginLabel }: Readonly<SignInPromptCardProps>): ReactNode {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "60vh",
        p: 3,
      }}
    >
      <Card
        elevation={0}
        sx={theme => ({
          maxWidth: 400,
          width: "100%",
          textAlign: "center",
          p: 4,
          borderRadius: 3,
          border: "1px solid",
          borderColor: theme.palette.outlineVariant,
        })}
      >
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
          {t.signInPromptTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, mb: 3 })}>
          {t.signInPromptBody}
        </Typography>
        <Button variant="contained" href="/login" fullWidth>
          {loginLabel}
        </Button>
      </Card>
    </Box>
  );
}
