"use client";

import {
  BadgeOutlined as BadgeIcon,
  EmailOutlined as EmailIcon,
  LanguageOutlined as LanguageIcon,
  PersonOutlined as PersonIcon,
  PhoneOutlined as PhoneIcon,
  PublicOutlined as PublicIcon,
  type SvgIconComponent,
} from "@mui/icons-material";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AuthUser } from "@/frontend/context/AuthContext";
import type { DashboardLabels } from "@/shared/locale/types/dashboard";

interface AccountInfoCardProps {
  readonly user: AuthUser;
  readonly roleLabel: string;
  readonly genderLabel: string | null;
  readonly t: DashboardLabels;
}

/** Account Information card: full name, email, phone, role, country, gender. */
export function AccountInfoCard({ user, roleLabel, genderLabel, t }: Readonly<AccountInfoCardProps>): ReactNode {
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
      })}
    >
      <CardContent sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
          {t.accountInfo}
        </Typography>
        <Stack spacing={2}>
          <InfoRow icon={PersonIcon} label={t.fullName} value={user.fullName} t={t} />
          <InfoRow icon={EmailIcon} label={t.email} value={user.email} t={t} />
          <InfoRow icon={PhoneIcon} label={t.phone} value={user.phone} t={t} />
          <InfoRow icon={BadgeIcon} label={t.role} value={roleLabel} t={t} />
          <InfoRow icon={PublicIcon} label={t.country} value={user.country} t={t} />
          <InfoRow icon={LanguageIcon} label={t.gender} value={genderLabel} t={t} />
        </Stack>
      </CardContent>
    </Card>
  );
}

interface InfoRowProps {
  readonly icon: SvgIconComponent;
  readonly label: string;
  readonly value: string | null | undefined;
  readonly t: DashboardLabels;
}

/** Renders a single labeled value row with a leading icon. */
function InfoRow({ icon: Icon, label, value, t }: Readonly<InfoRowProps>): ReactNode {
  const displayValue = value && value.trim().length > 0 ? value : t.notProvided;
  const isPlaceholder = !value || value.trim().length === 0;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
      <Box sx={theme => ({ color: theme.palette.text.secondary, display: "flex" })}>
        <Icon fontSize="small" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={theme => ({
            display: "block",
            lineHeight: 1.2,
            color: theme.palette.text.secondary,
          })}
        >
          {label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: theme => (isPlaceholder ? theme.palette.text.disabled : theme.palette.text.primary),
          }}
        >
          {displayValue}
        </Typography>
      </Box>
    </Stack>
  );
}
