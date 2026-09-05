import {
  AutoStoriesOutlined as BookIcon,
  CheckCircleOutlined as CheckIcon,
  PaymentsOutlined as PaymentsIcon,
  ScheduleOutlined as ScheduleIcon,
  SecurityOutlined as SecurityIcon,
  TrendingUpOutlined as TrendingIcon,
} from "@mui/icons-material";
import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { FeatureCard } from "@/frontend/views/landing/sections/features/FeatureCard";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Features ────────────────────────────────────────────────────────

export function FeaturesSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const features = [
    { icon: <CheckIcon />, title: t.featureVerifiedTitle, body: t.featureVerifiedBody },
    { icon: <BookIcon />, title: t.featureRecitationsTitle, body: t.featureRecitationsBody },
    { icon: <TrendingIcon />, title: t.featureProgressTitle, body: t.featureProgressBody },
    { icon: <SecurityIcon />, title: t.featureSecureTitle, body: t.featureSecureBody },
    { icon: <ScheduleIcon />, title: t.featureSchedulingTitle, body: t.featureSchedulingBody },
    { icon: <PaymentsIcon />, title: t.featurePaymentsTitle, body: t.featurePaymentsBody },
  ];

  return (
    <SectionWrapper badge={t.featuresBadge} title={t.featuresTitle} subtitle={t.featuresSubtitle} bg="default">
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(circle, var(--mui-palette-secondary-main) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          opacity: 0.04,
          pointerEvents: "none",
        }}
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" },
          gap: 3,
        }}
      >
        {features.map(f => (
          <FeatureCard key={f.title} icon={f.icon} title={f.title} body={f.body} />
        ))}
      </Box>
    </SectionWrapper>
  );
}
