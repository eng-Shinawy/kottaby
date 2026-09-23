"use client";

import { Box, ListItemIcon, ListItemText, MenuItem, Select, Skeleton, Stack, Typography } from "@mui/material";
import Avatar from "@mui/material/Avatar";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import type { ReactNode } from "react";
import type { MyLinkedChildrenQuery_myLinkedChildren } from "@/frontend/graphql/generated/gql/graphql";
import { childInitial } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";

/**
 * DetailHeader — the child-detail page band: page title + subtitle on the
 * start side, the child switcher and the refresh button composed on the end
 * side (stacked under the title on xs viewports). Extracted from the
 * container to keep both files under the line-count lint budget.
 */
export function DetailHeader({
  title,
  subtitle,
  switcher,
  refreshButton,
}: Readonly<{
  readonly title: ReactNode;
  readonly subtitle: ReactNode;
  readonly switcher: ReactNode;
  readonly refreshButton: ReactNode;
}>): ReactNode {
  return (
    <Box
      className="portal-header"
      sx={theme => ({
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "stretch", sm: "center" },
        gap: { xs: 1.5, sm: 2 },
        borderBottom: 2,
        borderColor: theme.palette.primary.main,
        paddingBottom: 2,
      })}
    >
      <Box component="header" sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
          {subtitle}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {switcher}
        {refreshButton}
      </Box>
    </Box>
  );
}

export function ChildSwitcher({
  linkedChildren,
  currentId,
  label,
  loading,
  onChange,
}: Readonly<{
  linkedChildren: readonly MyLinkedChildrenQuery_myLinkedChildren[];
  currentId: string;
  label: string;
  loading: boolean;
  onChange: (childId: string) => void;
}>): ReactNode {
  if (loading) {
    return (
      <Stack data-testid="parent-child-switcher-loading" sx={{ gap: 0.5 }}>
        <Skeleton variant="text" sx={{ fontSize: "0.75rem", maxWidth: 80 }} />
        <Skeleton variant="rectangular" sx={{ height: 56, maxWidth: 320, borderRadius: 2 }} />
      </Stack>
    );
  }

  const currentChild = linkedChildren.find(c => c.id === currentId);

  return (
    <FormControl
      variant="outlined"
      fullWidth
      sx={{ maxWidth: 320, "& .MuiOutlinedInput-root": { borderRadius: 2, py: 0.5, minHeight: 56 } }}
    >
      <InputLabel id="parent-child-switcher-label">{label}</InputLabel>
      <Select
        labelId="parent-child-switcher-label"
        label={label}
        value={currentId}
        data-testid="parent-child-switcher"
        onChange={event => {
          onChange(event.target.value);
        }}
        renderValue={() => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
            <Avatar
              sx={theme => ({
                width: 32,
                height: 32,
                fontSize: "0.85rem",
                fontWeight: 700,
                bgcolor: theme.palette.primary.main,
                color: theme.palette.onPrimary,
                flexShrink: 0,
              })}
            >
              {currentChild ? childInitial(currentChild.fullName) : "?"}
            </Avatar>
            <Typography
              component="span"
              dir="auto"
              sx={theme => ({
                fontWeight: 600,
                color: theme.palette.text.primary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              })}
            >
              {currentChild?.fullName ?? "?"}
            </Typography>
          </Box>
        )}
      >
        {linkedChildren.map(child => (
          <MenuItem key={child.id} value={child.id} sx={{ py: 1 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Avatar
                sx={theme => ({
                  width: 32,
                  height: 32,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  bgcolor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                })}
              >
                {childInitial(child.fullName)}
              </Avatar>
            </ListItemIcon>
            <ListItemText>
              <Typography component="span" dir="auto" sx={{ fontWeight: 600 }}>
                {child.fullName}
              </Typography>
            </ListItemText>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
