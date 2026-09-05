import { Box } from "@mui/material";
import type { ReactNode } from "react";

/** Progress skeleton card in the phone mockup. */
export function PhoneProgressCard(): ReactNode {
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
          height: 5,
          width: "70%",
          borderRadius: 0.5,
          bgcolor: "var(--mui-palette-text-secondary)",
          opacity: 0.3,
          mb: 1,
        }}
      />
      <Box
        sx={{
          height: 4,
          width: "50%",
          borderRadius: 0.5,
          bgcolor: "var(--mui-palette-text-secondary)",
          opacity: 0.2,
          mb: 1.5,
        }}
      />
      <Box sx={{ height: 4, borderRadius: 2, bgcolor: "var(--mui-palette-divider)" }}>
        <Box
          sx={{
            width: "60%",
            height: "100%",
            borderRadius: 2,
            background: "linear-gradient(90deg, var(--mui-palette-secondary-main), var(--mui-palette-secondary-light))",
          }}
        />
      </Box>
    </Box>
  );
}
