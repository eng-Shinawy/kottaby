import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Curriculum Roadmap ─────────────────────────────────────────────

export function CurriculumSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const steps = [
    { num: "01", title: t.curriculumStep1, desc: t.curriculumStep1Desc },
    { num: "02", title: t.curriculumStep2, desc: t.curriculumStep2Desc },
    { num: "03", title: t.curriculumStep3, desc: t.curriculumStep3Desc },
    { num: "04", title: t.curriculumStep4, desc: t.curriculumStep4Desc },
    { num: "05", title: t.curriculumStep5, desc: t.curriculumStep5Desc },
  ];

  return (
    <SectionWrapper badge={t.curriculumBadge} title={t.curriculumTitle} subtitle={t.curriculumSubtitle} bg="default">
      <Box sx={{ position: "relative", maxWidth: 720, mx: "auto" }}>
        {/* Vertical timeline line */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            insetInlineStart: 23,
            width: 2,
            bgcolor: "var(--mui-palette-secondary-main)",
            opacity: 0.25,
          }}
        />

        <Stack spacing={4}>
          {steps.map(step => (
            <Stack
              key={step.num}
              direction="row"
              spacing={3}
              sx={{
                alignItems: "flex-start",
                position: "relative",
              }}
            >
              {/* Numbered circle */}
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "var(--mui-palette-secondary-main)",
                  color: "var(--mui-palette-onSecondary)",
                  fontSize: 16,
                  fontWeight: 800,
                  flexShrink: 0,
                  boxShadow: "0 4px 12px rgba(184,115,51,0.25)",
                  zIndex: 1,
                }}
              >
                {step.num}
              </Box>
              {/* Content card */}
              <Box
                sx={{
                  flex: 1,
                  p: 3,
                  borderRadius: 2,
                  bgcolor: "var(--mui-palette-background-paper)",
                  border: "1px solid var(--mui-palette-divider)",
                  transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
                  "&:hover": {
                    borderColor: "var(--mui-palette-secondary-main)",
                    boxShadow: "0 4px 16px rgba(184,115,51,0.08)",
                    transform: "translateX(4px)",
                  },
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 17, mb: 0.5 }}>
                  {step.title}
                </Typography>
                <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)", lineHeight: 1.6 }}>
                  {step.desc}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Box>
    </SectionWrapper>
  );
}
