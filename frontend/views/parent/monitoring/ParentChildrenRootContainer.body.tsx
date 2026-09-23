"use client";

import { GroupOutlined, LinkOutlined } from "@mui/icons-material";
import { Box, Button, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { MyLinkedChildrenQuery_myLinkedChildren } from "@/frontend/graphql/generated/gql/graphql";
import { ChildCard, ChildrenListSkeleton } from "@/frontend/views/parent/monitoring/ParentChildrenRootContainer.parts";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

export function renderChildrenBody(
  children: readonly MyLinkedChildrenQuery_myLinkedChildren[] | undefined,
  error: unknown,
  loading: boolean,
  te: { readonly internalServerError: string },
  commonT: { readonly retry: string },
  t: ParentMonitoringLabels,
  locale: string,
  onSelect: (childId: string) => void,
  onHandshake: () => void,
  refetch: () => Promise<unknown>
): ReactNode {
  if (children === undefined) {
    return error === undefined ? (
      <ChildrenListSkeleton />
    ) : (
      <ErrorRetryAlert
        title={te.internalServerError}
        retryLabel={commonT.retry}
        retryPending={loading}
        onRetry={() => {
          void refetch();
        }}
      >
        <Typography variant="body2">{t.loadErrorBody}</Typography>
      </ErrorRetryAlert>
    );
  }
  if (children.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          minHeight: { xs: "55vh", sm: "60vh" },
          width: "100%",
        }}
      >
        <IconCircleEmptyState
          testId="parent-children-empty"
          icon={<GroupOutlined sx={{ fontSize: 36 }} />}
          title={t.childrenEmptyTitle}
          body={t.childrenEmptyBody}
        />
        <Button
          variant="outlined"
          startIcon={<LinkOutlined />}
          onClick={onHandshake}
          sx={theme => ({ borderColor: theme.palette.primary.main })}
        >
          {t.childrenEmptyCta}
        </Button>
      </Box>
    );
  }
  return (
    <Box
      component="output"
      aria-label={t.portalPageTitle}
      data-testid="parent-children-list"
      sx={{ display: "grid", gap: 2 }}
    >
      {children.map(child => (
        <ChildCard key={child.id} child={child} locale={locale} onSelect={onSelect} />
      ))}
    </Box>
  );
}
