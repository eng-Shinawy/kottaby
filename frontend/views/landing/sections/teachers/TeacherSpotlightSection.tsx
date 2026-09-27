import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { TeacherCard } from "@/frontend/views/landing/sections/teachers/TeacherCard";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Teacher Spotlight section ───────────────────────────────────
export function TeacherSpotlightSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const teachers = [
    {
      name: t.teacher1Name,
      specialty: t.teacher1Specialty,
      location: t.teacher1Location,
      sessions: 1240,
      rating: 4.9,
      initial: "A",
    },
    {
      name: t.teacher2Name,
      specialty: t.teacher2Specialty,
      location: t.teacher2Location,
      sessions: 870,
      rating: 4.8,
      initial: "M",
    },
    {
      name: t.teacher3Name,
      specialty: t.teacher3Specialty,
      location: t.teacher3Location,
      sessions: 650,
      rating: 5.0,
      initial: "I",
    },
    {
      name: t.teacher4Name,
      specialty: t.teacher4Specialty,
      location: t.teacher4Location,
      sessions: 2100,
      rating: 4.9,
      initial: "H",
    },
  ];
  return (
    <SectionWrapper badge={t.teachersBadge} title={t.teachersTitle} subtitle={t.teachersSubtitle} bg="paper">
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr 1fr" },
          gap: 3,
          // Emitted once here so the per-index TeacherCard classes don't
          // each carry their own copy of the keyframes.
          "@keyframes staggerFadeIn": {
            "0%": { opacity: 0, transform: "translateY(16px)" },
            "100%": { opacity: 1, transform: "translateY(0)" },
          },
        }}
      >
        {teachers.map((teacher, idx) => (
          <TeacherCard key={teacher.name} teacher={teacher} index={idx} />
        ))}
      </Box>
    </SectionWrapper>
  );
}
