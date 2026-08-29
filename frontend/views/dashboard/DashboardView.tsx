"use client";

import {
  CalendarMonthOutlined as CalendarIcon,
  NotificationsOutlined as NotificationsIcon,
  SchoolOutlined as SchoolIcon,
  SubscriptionsOutlined as SubscriptionsIcon,
  EmojiObjectsOutlined as TipIcon,
  PaymentsOutlined as WalletIcon,
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
import { useAuth } from "@/frontend/hooks/useAuth";
import { Dashboard, useAppTranslation } from "@/shared/locale";

/** Stat card shape — used by the dashboard's placeholder stat strip. */
interface DashboardStat {
  readonly label: string;
  readonly value: string;
  readonly Icon: typeof SchoolIcon;
}

interface DashboardViewProps {
  /**
   * Role-specific content slot mounted between the welcome header and the
   * stat grid (the teacher dashboard passes
   * `<ApplicantStatusCard />` so the lifecycle status card sits above the
   * fold, under the page header). The SERVER composition decides what — if
   * anything — goes here per role; this view adds no client-side gating of
   * its own and other roles pass nothing (slot stays empty).
   */
  readonly statusSlot?: ReactNode;
}

/**
 * DashboardView — landing view shown at `/dashboard`.
 *
 * Renders a welcome header + a 2x2 stat-card grid (placeholders for now —
 * real values will be wired up in subsequent tickets as the Sessions,
 * Subscriptions, Wallet, and Notifications subsystems land).
 *
 * Placeholder stats:
 *  - Sessions Completed: 0 (FR-5)
 *  - Balance: 0 (FR-2.5)
 *  - Upcoming: 0 (FR-5.1)
 *  - Notifications: 0 (FR-9)
 *
 * MUI v9 patterns: `sx` callback only, `*Outlined` icons, theme palette
 * colors. The grid uses `display: grid` with responsive `gridTemplateColumns`.
 */
export function DashboardView({ statusSlot }: Readonly<DashboardViewProps>): ReactNode {
  const t = useAppTranslation(Dashboard);
  const { user } = useAuth();

  const welcomeText = user ? t.welcome(user.fullName) : t.title;

  const stats: readonly DashboardStat[] = [
    { label: t.sessionsCompleted, value: "0", Icon: SchoolIcon },
    { label: t.balance, value: "0", Icon: WalletIcon },
    { label: t.upcoming, value: "0", Icon: CalendarIcon },
    { label: t.notifications, value: "0", Icon: NotificationsIcon },
  ];

  return (
    <Box>
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
          {welcomeText}
        </Typography>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.title}
        </Typography>
      </Stack>

      {statusSlot ? <Box sx={{ mb: 4 }}>{statusSlot}</Box> : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" },
          gap: 2,
        }}
      >
        {stats.map(stat => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </Box>

      <GettingStartedCard />
    </Box>
  );
}

interface StatCardProps {
  readonly stat: DashboardStat;
}

/** Renders a single placeholder stat card. */
function StatCard({ stat }: Readonly<StatCardProps>): ReactNode {
  const { label, value, Icon } = stat;
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Box>
            <Typography
              variant="caption"
              sx={theme => ({
                color: theme.palette.text.secondary,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
              })}
            >
              {label}
            </Typography>
            <Typography
              variant="h4"
              sx={theme => ({
                fontWeight: 700,
                color: theme.palette.text.primary,
                mt: 0.5,
              })}
            >
              {value}
            </Typography>
          </Box>
          <Box
            sx={theme => ({
              width: 44,
              height: 44,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: theme.palette.primaryContainer,
              color: theme.palette.onPrimaryContainer,
              flexShrink: 0,
            })}
          >
            <Icon fontSize="medium" />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Getting-started guide card shown below the stat grid to fill the landing viewport. */
function GettingStartedCard(): ReactNode {
  const t = useAppTranslation(Dashboard);

  const tips: readonly { readonly Icon: typeof SchoolIcon; readonly text: string }[] = [
    { Icon: SchoolIcon, text: t.gettingStartedTipSessions },
    { Icon: SubscriptionsIcon, text: t.gettingStartedTipSubscriptions },
    { Icon: NotificationsIcon, text: t.gettingStartedTipNotifications },
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
