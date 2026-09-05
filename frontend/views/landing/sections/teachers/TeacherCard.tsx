import { Button, Stack } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
import { TeacherCardHead } from "@/frontend/views/landing/sections/teachers/TeacherCardHead";
import { TeacherCardStats } from "@/frontend/views/landing/sections/teachers/TeacherCardStats";
import { Landing, useAppTranslation } from "@/shared/locale";

interface TeacherCardData {
  readonly name: string;
  readonly specialty: string;
  readonly location: string;
  readonly sessions: number;
  readonly rating: number;
  readonly initial: string;
}

/** One teacher spotlight card with stagger-in animation. */
export function TeacherCard({ teacher, index }: Readonly<{ teacher: TeacherCardData; index: number }>): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <Stack
      spacing={2}
      sx={{
        p: 3,
        borderRadius: 3,
        bgcolor: "var(--mui-palette-background-default)",
        border: "1px solid var(--mui-palette-divider)",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease",
        "&:hover": {
          borderColor: "var(--mui-palette-secondary-main)",
          boxShadow: "0 12px 32px rgba(184,115,51,0.12)",
          transform: "translateY(-4px)",
          "&::before": { opacity: 1 },
        },
        "&:active": { transform: "translateY(-2px) scale(0.98)" },
        "&::before": {
          content: '""',
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "40%",
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--mui-palette-secondary-main) 0.06), transparent)",
          opacity: 0,
          transition: "opacity 0.3s ease",
          pointerEvents: "none",
        },
        animation: `staggerFadeIn 0.5s ease ${index * 0.1}s both`,
        "@keyframes staggerFadeIn": {
          "0%": { opacity: 0, transform: "translateY(16px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <TeacherCardHead teacher={teacher} />
      <TeacherCardStats sessions={teacher.sessions} rating={teacher.rating} />
      <Button
        component={Link}
        href="/register"
        variant="outlined"
        fullWidth
        size="small"
        sx={{
          position: "relative",
          zIndex: 1,
          mt: "auto",
          borderColor: "var(--mui-palette-secondary-main)",
          color: "var(--mui-palette-secondary-main)",
          fontWeight: 700,
          textTransform: "none",
          borderRadius: 2,
          transition: "all 0.2s ease",
          "&:hover": {
            bgcolor: "var(--mui-palette-secondary-main)",
            color: "var(--mui-palette-onSecondary)",
            borderColor: "var(--mui-palette-secondary-main)",
          },
        }}
      >
        {t.teacherBookSession}
      </Button>
    </Stack>
  );
}
