"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import { Card, CardContent, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface ProfileCardSectionProps {
  readonly title: string;
  readonly icon?: SvgIconComponent;
  readonly children: ReactNode;
  readonly mb?: number;
}

/**
 * Shared section card scaffold for Profile view cards.
 */
export function ProfileCardSection({
  title,
  icon: Icon,
  children,
  mb = 2,
}: Readonly<ProfileCardSectionProps>): ReactNode {
  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        mb,
      })}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
          {Icon ? <Icon fontSize="small" sx={theme => ({ color: theme.palette.primary.main })} /> : null}
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}
