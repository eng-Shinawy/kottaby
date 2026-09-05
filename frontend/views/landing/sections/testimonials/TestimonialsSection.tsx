"use client";

import { Box, Stack } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import { SectionWrapper, TestimonialNavButton } from "@/frontend/views/landing/layout";
import { TestimonialSlide } from "@/frontend/views/landing/sections/testimonials/TestimonialSlide";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Testimonials ────────────────────────────────────────────────────

export function TestimonialsSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const [current, setCurrent] = useState(0);
  const testimonials = [
    { quote: t.testimonial1Quote, name: t.testimonial1Name, role: t.testimonial1Role },
    { quote: t.testimonial2Quote, name: t.testimonial2Name, role: t.testimonial2Role },
    { quote: t.testimonial3Quote, name: t.testimonial3Name, role: t.testimonial3Role },
  ];
  const total = testimonials.length;

  const handlePrev = useCallback(() => {
    setCurrent(prev => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrent(prev => Math.min(total - 1, prev + 1));
  }, [total]);

  return (
    <SectionWrapper
      badge={t.testimonialsBadge}
      title={t.testimonialsTitle}
      subtitle={t.testimonialsSubtitle}
      bg="default"
    >
      <Box sx={{ position: "relative" }}>
        {/* Previous button */}
        <TestimonialNavButton side="left" label={t.testimonialPrev} onClick={handlePrev} disabled={current === 0} />

        {/* Next button */}
        <TestimonialNavButton
          side="right"
          label={t.testimonialNext}
          onClick={handleNext}
          disabled={current === total - 1}
        />

        {/* Carousel viewport */}
        <Box sx={{ overflow: "hidden" }}>
          <Box
            sx={{
              display: "flex",
              transition: "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
              transform: `translateX(-${current * 100}%)`,
            }}
          >
            {testimonials.map(item => (
              <TestimonialSlide key={item.name} quote={item.quote} name={item.name} role={item.role} />
            ))}
          </Box>
        </Box>

        {/* Dot indicators */}
        <Stack direction="row" spacing={1} sx={{ justifyContent: "center", mt: 3 }}>
          {testimonials.map((_item, idx) => (
            <Box
              key={_item.name}
              component="button"
              type="button"
              onClick={() => setCurrent(idx)}
              aria-label={`Testimonial ${idx + 1}`}
              sx={{
                width: idx === current ? 24 : 8,
                height: 8,
                borderRadius: 99,
                bgcolor: idx === current ? "var(--mui-palette-secondary-main)" : "transparent",
                border: idx === current ? "none" : "2px solid var(--mui-palette-secondary-main)",
                transition: "all 0.3s ease",
                cursor: "pointer",
              }}
            />
          ))}
        </Stack>
      </Box>
    </SectionWrapper>
  );
}
