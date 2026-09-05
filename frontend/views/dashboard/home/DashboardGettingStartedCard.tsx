"use client";

import {
  NotificationsOutlined as NotificationsIcon,
  SchoolOutlined as SchoolIcon,
  SubscriptionsOutlined as SubscriptionsIcon,
  EmojiObjectsOutlined as TipIcon,
} from "@mui/icons-material";
import {
  Box,
  Card,
  CardContent,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { useAuth } from "@/frontend/hooks/auth";
import { Dashboard, useAppTranslation } from "@/shared/locale";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

/** Maps the account role enum to the role-specific bullet copy block. */
const ROLE_COPY_KEY: Record<UserRole, keyof DashboardLabels["gettingStartedTips"]> = {
  [UserRole.Student]: "student",
  [UserRole.Teacher]: "teacher",
  [UserRole.Admin]: "admin",
  [UserRole.Parent]: "parent",
};

/** Getting-started guide card shown below the stat grid to fill the landing viewport. */
export function DashboardGettingStartedCard(): ReactNode {
  const t = useAppTranslation(Dashboard);
  const { user } = useAuth();

  const copy = t.gettingStartedTips[user ? ROLE_COPY_KEY[user.role] : "student"];

  const tips: readonly { readonly Icon: typeof SchoolIcon; readonly text: string }[] = [
    { Icon: SchoolIcon, text: copy.sessions },
    { Icon: SubscriptionsIcon, text: copy.subscriptions },
    { Icon: NotificationsIcon, text: copy.notifications },
  ];

  return (
    <Card
      elevation={0}
      sx={theme => ({
        mt: 3,
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1 }}>
          <Box
            sx={theme => ({
              width: 36,
              height: 36,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: theme.palette.secondaryContainer,
              color: theme.palette.onSecondaryContainer,
              flexShrink: 0,
            })}
          >
            <TipIcon fontSize="small" />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {t.gettingStartedTitle}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, mb: 2 })}>
          {t.gettingStartedBody}
        </Typography>
        <Divider sx={theme => ({ borderColor: theme.palette.outlineVariant, mb: 1 })} />
        <List disablePadding>
          {tips.map(({ Icon, text }) => (
            <ListItem key={text} sx={{ px: 0, py: 1 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Box
                  sx={theme => ({
                    width: 32,
                    height: 32,
                    borderRadius: 1.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: theme.palette.primaryContainer,
                    color: theme.palette.onPrimaryContainer,
                  })}
                >
                  <Icon fontSize="small" />
                </Box>
              </ListItemIcon>
              <ListItemText primary={text} slotProps={{ primary: { sx: { fontSize: "0.875rem", lineHeight: 1.5 } } }} />
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}
