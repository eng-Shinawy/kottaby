import {
  WorkspacePremiumOutlined as CertificateIcon,
  TimelapseOutlined as ClockIcon,
  PublicOutlined as GlobeIcon,
  MenuBookOutlined as QuranIcon,
  StarRateOutlined as StarRateIcon,
  EmojiEventsOutlined as TrophyIcon,
} from "@mui/icons-material";
import { Box, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SectionBadge } from "@/frontend/views/landing/layout";
import { AchievementCard } from "@/frontend/views/landing/sections/achievements/AchievementCard";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Achievements ────────────────────────────────────────────────────

export function AchievementsSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const items = [
    { icon: <TrophyIcon />, value: t.achievement1Value, label: t.achievement1Label },
    { icon: <CertificateIcon />, value: t.achievement2Value, label: t.achievement2Label },
    { icon: <ClockIcon />, value: t.achievement3Value, label: t.achievement3Label },
    { icon: <StarRateIcon />, value: t.achievement4Value, label: t.achievement4Label },
    { icon: <GlobeIcon />, value: t.achievement5Value, label: t.achievement5Label },
    { icon: <QuranIcon />, value: t.achievement6Value, label: t.achievement6Label },
  ];

  return (
    <Box
      component="section"
      sx={{
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(160deg, var(--mui-palette-primary-dark) 0%, var(--mui-palette-primary-main) 50%, var(--mui-palette-primary-dark) 100%)",
        color: "var(--mui-palette-onPrimary)",
        py: { xs: 8, md: 10 },
      }}
    >
      {/* Subtle pattern overlay */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.04,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 36px, var(--mui-palette-secondary-light) 36px, var(--mui-palette-secondary-light) 38px)",
        }}
      />

      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1 }}>
        {/* Section header */}
        <Stack spacing={1.5} sx={{ mb: 5, maxWidth: 640 }}>
          <SectionBadge label={t.achievementsBadge} />
          <Typography
            variant="h3"
            sx={{ fontWeight: 800, fontSize: { xs: 26, md: 34 }, letterSpacing: "-0.02em", lineHeight: 1.2, m: 0 }}
          >
            {t.achievementsTitle}
          </Typography>
          <Typography variant="body1" sx={{ opacity: 0.85, lineHeight: 1.6, fontSize: 16 }}>
            {t.achievementsSubtitle}
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" },
            gap: 3,
          }}
        >
          {items.map(item => (
            <AchievementCard key={item.label} icon={item.icon} value={item.value} label={item.label} />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
