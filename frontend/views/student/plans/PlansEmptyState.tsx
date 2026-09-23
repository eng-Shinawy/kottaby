"use client";

import InventoryOutlined from "@mui/icons-material/InventoryOutlined";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { PLANS_EMPTY_TEST_ID } from "@/frontend/views/student/plans/plansViewIds";
import { useAppTranslation } from "@/shared/locale/client";
import { Checkout } from "@/shared/locale/namespaces/checkout";

export interface PlansEmptyStateProps {
  readonly onRefresh: () => void;
}

/**
 * PlansEmptyState — the accessible empty-catalog state: a decorative icon
 * in a tinted circle atop the localized empty title + body copy (the
 * shared `IconCircleEmptyState` rhythm, scoped to the catalog view) and a
 * low-emphasis re-check CTA.
 */
export function PlansEmptyState({ onRefresh }: Readonly<PlansEmptyStateProps>): React.ReactElement {
  const t = useAppTranslation(Checkout);

  return (
    <Paper
      data-testid={PLANS_EMPTY_TEST_ID}
      elevation={0}
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        paddingX: 6,
        paddingTop: 6,
        paddingBottom: 5,
        textAlign: "center",
        backgroundColor: theme.palette.background.paper,
        width: "100%",
        maxWidth: 640,
        alignSelf: "center",
      })}
    >
      <Stack sx={{ alignItems: "center", gap: 2 }}>
        <Typography
          aria-hidden
          component="span"
          sx={theme => ({
            width: 72,
            height: 72,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            bgcolor: theme.palette.secondaryContainer,
            color: theme.palette.onSecondaryContainer,
          })}
        >
          <InventoryOutlined sx={{ fontSize: 36 }} />
        </Typography>
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.emptyTitle}
        </Typography>
        <Typography
          variant="body2"
          sx={theme => ({
            color: theme.palette.text.secondary,
            maxWidth: 460,
            textAlign: "center",
            textWrap: "balance",
          })}
        >
          {t.emptyBody}
        </Typography>
        <Button
          variant="text"
          color="secondary"
          size="small"
          onClick={onRefresh}
          sx={theme => ({
            minHeight: 44,
            px: 2.5,
            border: 1,
            borderColor: alpha(theme.palette.secondary.main, 0.6),
            borderRadius: 2,
          })}
        >
          {t.emptyActionButton}
        </Button>
      </Stack>
    </Paper>
  );
}
