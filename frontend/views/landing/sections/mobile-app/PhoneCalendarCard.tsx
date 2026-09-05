import { Box } from "@mui/material";
import type { ReactNode } from "react";

/** Calendar skeleton card in the phone mockup. */
export function PhoneCalendarCard(): ReactNode {
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        border: "1px solid var(--mui-palette-divider)",
        bgcolor: "var(--mui-palette-background-paper)",
      }}
    >
      <Box
        sx={{
          height: 4,
          width: "40%",
          borderRadius: 0.5,
          bgcolor: "var(--mui-palette-text-secondary)",
          opacity: 0.3,
          mb: 1,
        }}
      />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 0.5,
        }}
      >
        {["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3"].map(id => (
          <Box
            key={id}
            sx={{
              height: 16,
              borderRadius: 0.5,
              border: "1px solid var(--mui-palette-divider)",
              bgcolor:
                id === "b2" ? "color-mix(in srgb, var(--mui-palette-secondary-main) 15%, transparent)" : "transparent",
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
