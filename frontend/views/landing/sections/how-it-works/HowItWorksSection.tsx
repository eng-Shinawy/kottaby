"use client";

import { Box } from "@mui/material";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { HowItWorkStep } from "@/frontend/views/landing/sections/how-it-works/HowItWorkStep";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── How it works ───────────────────────────────────────────────────

export function HowItWorksSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const steps = [
    { num: "1", title: t.howStep1Title, body: t.howStep1Body },
    { num: "2", title: t.howStep2Title, body: t.howStep2Body },
    { num: "3", title: t.howStep3Title, body: t.howStep3Body },
  ];

  const inViewRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [inViewState, setInViewState] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    for (let i = 0; i < steps.length; i++) {
      const el = inViewRefs.current[i];
      if (!el) continue;
      const obs = new IntersectionObserver(
        ([entry]) => {
          setInViewState(prev => ({ ...prev, [i]: entry.isIntersecting }));
        },
        { threshold: 0.5 }
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => {
      for (const o of observers) o.disconnect();
    };
  }, [steps.length]);

  return (
    <SectionWrapper badge={t.howBadge} title={t.howTitle} subtitle={t.howSubtitle} bg="default">
      <Box sx={{ position: "relative" }}>
        {/* Connecting line between step circles — md+ only */}
        <Box
          aria-hidden
          sx={{
            display: { xs: "none", md: "block" },
            position: "absolute",
            top: 27,
            left: "16.67%",
            right: "16.67%",
            height: 2,
            bgcolor: "var(--mui-palette-secondary-main)",
            opacity: 0.25,
            zIndex: 0,
          }}
        />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
            gap: 3,
          }}
        >
          {steps.map((s, idx) => (
            <HowItWorkStep
              key={s.num}
              num={s.num}
              title={s.title}
              body={s.body}
              active={inViewState[idx]}
              circleRef={(el: HTMLDivElement | null) => {
                inViewRefs.current[idx] = el;
              }}
            />
          ))}
        </Box>
      </Box>
    </SectionWrapper>
  );
}
