"use client";

import { Avatar, Card, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MyLinkedChildrenQuery_myLinkedChildren } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { childInitial } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";

const ROOT_SKELETON_KEYS: readonly string[] = ["children-skeleton-1", "children-skeleton-2", "children-skeleton-3"];

export function ChildrenListSkeleton(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="parent-children-loading" sx={{ gap: 2 }}>
      {ROOT_SKELETON_KEYS.map(key => (
        <Card
          key={key}
          variant="outlined"
          sx={theme => ({
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            padding: { xs: 2, sm: 2.5 },
            borderRadius: 2,
            borderColor: theme.palette.border.main,
            transition: theme.transitions.create(["box-shadow", "border-color"], {
              duration: theme.transitions.duration.shorter,
            }),
          })}
        >
          <Skeleton variant="circular" sx={{ width: 44, height: 44 }} />
          <Stack sx={{ gap: 0.5, flex: 1 }}>
            <Skeleton variant="text" sx={{ fontSize: "1rem", maxWidth: 200 }} />
            <Skeleton variant="text" sx={{ fontSize: "0.875rem", maxWidth: 140 }} />
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

export function ChildCard({
  child,
  locale,
  onSelect,
}: Readonly<{
  child: MyLinkedChildrenQuery_myLinkedChildren;
  locale: string;
  onSelect: (childId: string) => void;
}>): ReactNode {
  return (
    <Card
      variant="outlined"
      component="button"
      type="button"
      data-testid="parent-child-card"
      onClick={() => onSelect(child.id)}
      sx={theme => ({
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        padding: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderColor: theme.palette.border.main,
        bgcolor: "transparent",
        cursor: "pointer",
        textAlign: "start",
        position: "relative",
        overflow: "hidden",
        transition: theme.transitions.create(["box-shadow", "border-color", "transform"], {
          duration: theme.transitions.duration.short,
        }),
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          bgcolor: theme.palette.primary.main,
          opacity: 0,
          transition: theme.transitions.create("opacity", {
            duration: theme.transitions.duration.short,
          }),
        },
        "&:hover": {
          borderColor: theme.palette.primary.main,
          boxShadow: theme.shadows[4],
          transform: "translateY(-2px)",
        },
        "&:hover::before": {
          opacity: 1,
        },
        "&:focus-visible": {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <Avatar
        sx={theme => ({
          width: 44,
          height: 44,
          fontSize: "1.25rem",
          fontWeight: 700,
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          flexShrink: 0,
        })}
      >
        {childInitial(child.fullName)}
      </Avatar>
      <Stack sx={{ gap: 0.5, flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" component="span" dir="auto" sx={{ fontWeight: 700 }}>
          {child.fullName}
        </Typography>
        <Typography variant="body2" component="span" dir="auto" sx={theme => ({ color: theme.palette.text.secondary })}>
          {formatApplicantDate(child.createdAt, locale)}
        </Typography>
      </Stack>
    </Card>
  );
}
