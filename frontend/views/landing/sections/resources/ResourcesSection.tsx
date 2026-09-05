import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { ResourceCard } from "@/frontend/views/landing/sections/resources/ResourceCard";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Resources section ───────────────────────────────────────────
export function ResourcesSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const resources = [
    { title: t.resource1Title, category: t.resource1Category, date: t.resource1Date, excerpt: t.resource1Excerpt },
    { title: t.resource2Title, category: t.resource2Category, date: t.resource2Date, excerpt: t.resource2Excerpt },
    { title: t.resource3Title, category: t.resource3Category, date: t.resource3Date, excerpt: t.resource3Excerpt },
  ];
  return (
    <SectionWrapper badge={t.resourcesBadge} title={t.resourcesTitle} subtitle={t.resourcesSubtitle} bg="default">
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 3 }}>
        {resources.map((r, idx) => (
          <ResourceCard
            key={r.title}
            title={r.title}
            category={r.category}
            date={r.date}
            excerpt={r.excerpt}
            index={idx}
          />
        ))}
      </Box>
    </SectionWrapper>
  );
}
