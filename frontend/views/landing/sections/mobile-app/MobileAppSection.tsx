import {
  CheckCircleOutlined as CheckIcon,
  PhoneAndroid as PhoneAndroidIcon,
  PhoneIphone as PhoneIphoneIcon,
} from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { PhoneMockup } from "@/frontend/views/landing/sections/mobile-app/PhoneMockup";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Mobile App section ──────────────────────────────────────────

export function MobileAppSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const appFeatures = [t.appF1, t.appF2, t.appF3, t.appF4];

  return (
    <SectionWrapper badge={t.appBadge} title={t.appTitle} subtitle={t.appSubtitle} bg="paper">
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 6,
          alignItems: "center",
        }}
      >
        <PhoneMockup />

        <Stack spacing={2.5}>
          {appFeatures.map(feat => (
            <Stack key={feat} direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
              <CheckIcon sx={{ fontSize: 20, color: "var(--mui-palette-secondary-main)", flexShrink: 0, mt: 0.25 }} />
              <Typography variant="body1" sx={{ color: "var(--mui-palette-text-primary)", lineHeight: 1.6 }}>
                {feat}
              </Typography>
            </Stack>
          ))}
          <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
            <Button
              href="#"
              variant="outlined"
              startIcon={<PhoneIphoneIcon />}
              sx={{
                borderColor: "var(--mui-palette-divider)",
                color: "var(--mui-palette-text-primary)",
                textTransform: "none",
                fontWeight: 600,
                borderRadius: 2,
                "&:hover": { borderColor: "var(--mui-palette-secondary-main)" },
              }}
            >
              {t.appCtaAppStore}
            </Button>
            <Button
              href="#"
              variant="outlined"
              startIcon={<PhoneAndroidIcon />}
              sx={{
                borderColor: "var(--mui-palette-divider)",
                color: "var(--mui-palette-text-primary)",
                textTransform: "none",
                fontWeight: 600,
                borderRadius: 2,
                "&:hover": { borderColor: "var(--mui-palette-secondary-main)" },
              }}
            >
              {t.appCtaPlayStore}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </SectionWrapper>
  );
}
