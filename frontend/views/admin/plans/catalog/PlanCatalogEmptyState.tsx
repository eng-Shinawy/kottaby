/**
 * PlanCatalogEmptyState — Accessible empty state with Create CTA for the admin plan catalog.
 *
 * Extracted from PlanCatalogTable (Task 4.3).
 *  - Theme-callback token styling (zero hardcoded hex/strings)
 */

"use client";

import { VerifiedOutlined as EmptyIcon } from "@mui/icons-material";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

export interface PlanCatalogEmptyStateProps {
  readonly onCreateNew: () => void;
}

export function PlanCatalogEmptyState({ onCreateNew }: PlanCatalogEmptyStateProps): React.ReactElement {
  const t = useAppTranslation(Plans);

  return (
    <Paper
      elevation={0}
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        p: 6,
        textAlign: "center",
        backgroundColor: theme.palette.background.paper,
      })}
    >
      <Stack sx={{ alignItems: "center", gap: 2 }}>
        <EmptyIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t.emptyTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 400 })}>
          {t.emptyDescription}
        </Typography>
        <Button variant="contained" onClick={onCreateNew} sx={{ mt: 1 }}>
          {t.createPlanButton}
        </Button>
      </Stack>
    </Paper>
  );
}
