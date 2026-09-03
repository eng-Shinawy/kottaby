"use client";

import {
  AutoStoriesOutlined as BookIcon,
  PublicOutlined as GlobeIcon,
  GroupsOutlined as GroupsIcon,
  SchoolOutlined as SchoolIcon,
} from "@mui/icons-material";
import { Box, Container, Stack } from "@mui/material";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { StatBlock } from "@/frontend/views/landing/sections/stats/StatBlock";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Stats bar ───────────────────────────────────────────────────────

export function StatsBar(): ReactNode {
  const t = useAppTranslation(Landing);
  const statsRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = statsRef.current;
    let obs: IntersectionObserver | undefined;
    if (el) {
      obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setInView(true);
            obs?.unobserve(el);
          }
        },
        { threshold: 0.3 }
      );
      obs.observe(el);
    }
    return () => obs?.disconnect();
  }, []);

  const statIcons: ReactNode[] = [
    <SchoolIcon key="t" />,
    <GroupsIcon key="s" />,
    <BookIcon key="b" />,
    <GlobeIcon key="g" />,
  ];

  const stats = [
    { value: t.statsTeachers, label: t.statsTeachersLabel },
    { value: t.statsStudents, label: t.statsStudentsLabel },
    { value: t.statsRecitations, label: t.statsRecitationsLabel },
    { value: t.statsCountries, label: t.statsCountriesLabel },
  ];

  return (
    <Box
      component="section"
      ref={statsRef}
      sx={{
        position: "relative",
        bgcolor: "var(--mui-palette-primary-dark)",
        color: "var(--mui-palette-onPrimary)",
        borderBottom: "1px solid var(--mui-palette-divider)",
      }}
    >
      {/* Subtle geometric pattern overlay (lighter than hero) */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.03,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 32px, var(--mui-palette-secondary-light) 32px, var(--mui-palette-secondary-light) 34px), repeating-linear-gradient(-45deg, transparent, transparent 32px, var(--mui-palette-secondary-light) 32px, var(--mui-palette-secondary-light) 34px)",
        }}
      />
      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 2, sm: 0 }}
          sx={{ py: 3, justifyContent: "space-around", alignItems: "center" }}
        >
          {stats.map((s, idx) => (
            <StatBlock key={s.label} icon={statIcons[idx]} value={s.value} label={s.label} inView={inView} />
          ))}
        </Stack>
      </Container>
    </Box>
  );
}
