import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { TestimonialAuthor } from "@/frontend/views/landing/sections/testimonials/TestimonialAuthor";
import { TestimonialStars } from "@/frontend/views/landing/sections/testimonials/TestimonialStars";

/** One full-width carousel slide with the testimonial card. */
export function TestimonialSlide({
  quote,
  name,
  role,
}: Readonly<{ quote: string; name: string; role: string }>): ReactNode {
  return (
    <Box
      sx={{
        minWidth: "100%",
        display: "flex",
        justifyContent: "center",
        px: { xs: 1, md: 6 },
      }}
    >
      <Box
        sx={{
          position: "relative",
          p: 4,
          borderRadius: 3,
          bgcolor: "var(--mui-palette-background-paper)",
          border: "1px solid var(--mui-palette-divider)",
          maxWidth: 500,
          width: "100%",
          transition: "border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease",
          overflow: "hidden",
          "&:hover": {
            borderColor: "var(--mui-palette-secondary-main)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            transform: "translateY(-4px)",
            "&::before": { opacity: 1 },
            "& .testimonialQuote": { opacity: 0.35 },
          },
          "&::before": {
            content: '""',
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "50%",
            background:
              "linear-gradient(to bottom, color-mix(in srgb, var(--mui-palette-secondary-main) 0.08), transparent)",
            opacity: 0,
            transition: "opacity 0.3s ease",
            pointerEvents: "none",
          },
        }}
      >
        {/* Decorative quotation mark */}
        <Typography
          aria-hidden
          className="testimonialQuote"
          sx={{
            position: "absolute",
            top: 8,
            left: 12,
            fontSize: 80,
            lineHeight: 1,
            fontWeight: 800,
            color: "var(--mui-palette-secondary-main)",
            opacity: 0.15,
            pointerEvents: "none",
            userSelect: "none",
            transition: "opacity 0.3s ease",
          }}
        >
          “
        </Typography>

        <TestimonialStars />

        <Typography
          variant="body1"
          sx={{
            fontStyle: "italic",
            lineHeight: 1.7,
            mb: 2.5,
            position: "relative",
            zIndex: 1,
          }}
        >
          {quote}
        </Typography>

        {/* Copper divider */}
        <Box
          aria-hidden
          sx={{
            width: 40,
            height: 2,
            bgcolor: "var(--mui-palette-secondary-main)",
            mb: 2,
          }}
        />

        <TestimonialAuthor name={name} role={role} />
      </Box>
    </Box>
  );
}
