"use client";

import { Box, Typography } from "@mui/material";
import { getPasswordStrength } from "@/frontend/views/auth/register";
import type { AuthLabels } from "@/shared/locale/types/auth";

/**
 * Four-segment password-strength meter (remote visual) rendered beneath the
 * RHF-registered password field. Hidden while the field is empty; consumes
 * the watched value through {@link getPasswordStrength} so labels stay
 * localized and colors stay on palette tokens.
 */
export function PasswordStrengthMeter({ pw, t }: { readonly pw: string; readonly t: AuthLabels }) {
  if (pw.length === 0) return null;
  const { score, label, color } = getPasswordStrength(pw, t);
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: "flex", gap: 0.5, mb: 0.5 }}>
        {[1, 2, 3, 4].map(level => (
          <Box
            key={level}
            sx={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              bgcolor: score >= level ? color : "var(--mui-palette-divider)",
              transition: "background-color 0.3s ease",
              "@media (prefers-reduced-motion: reduce)": {
                transition: "none",
              },
            }}
          />
        ))}
      </Box>
      <Typography variant="caption" sx={{ color, fontWeight: 600, fontSize: 12 }}>
        {label}
      </Typography>
    </Box>
  );
}
