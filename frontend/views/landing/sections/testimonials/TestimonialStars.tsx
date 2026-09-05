import { Star } from "@mui/icons-material";
import { Stack } from "@mui/material";
import type { ReactNode } from "react";

/** Five-star rating row for a testimonial card. */
export function TestimonialStars(): ReactNode {
  return (
    <Stack direction="row" spacing={0.25} sx={{ mb: 2, position: "relative", zIndex: 1 }}>
      <Star sx={{ fontSize: 18, color: "var(--mui-palette-secondary-main)" }} />
      <Star sx={{ fontSize: 18, color: "var(--mui-palette-secondary-main)" }} />
      <Star sx={{ fontSize: 18, color: "var(--mui-palette-secondary-main)" }} />
      <Star sx={{ fontSize: 18, color: "var(--mui-palette-secondary-main)" }} />
      <Star sx={{ fontSize: 18, color: "var(--mui-palette-secondary-main)" }} />
    </Stack>
  );
}
