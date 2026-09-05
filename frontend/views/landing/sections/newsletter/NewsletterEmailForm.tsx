import { Box, Button, CircularProgress, TextField as MuiTextField, Stack } from "@mui/material";
import type { ReactNode, SyntheticEvent } from "react";
import { ctaShimmerSx } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Newsletter email input + submit row. */
export function NewsletterEmailForm({
  email,
  error,
  loading,
  onSubmit,
  onEmailChange,
}: Readonly<{
  email: string;
  error: boolean;
  loading: boolean;
  onSubmit: (e: SyntheticEvent<HTMLFormElement>) => void;
  onEmailChange: (value: string) => void;
}>): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Box component="form" onSubmit={onSubmit} sx={{ width: "100%", mt: 1 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <MuiTextField
          fullWidth
          placeholder={t.newsletterPlaceholder}
          value={email}
          onChange={e => onEmailChange(e.target.value)}
          variant="outlined"
          type="email"
          size="small"
          error={error}
          helperText={error ? t.newsletterError : undefined}
          sx={{
            bgcolor: "var(--mui-palette-background-default)",
            borderRadius: 2,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              "& fieldset": {
                borderColor: error ? "var(--mui-palette-error-main)" : "var(--mui-palette-divider)",
                transition: "border-color 0.2s ease, box-shadow 0.2s ease",
              },
              "&:hover fieldset": {
                borderColor: error ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
              },
              "&.Mui-focused fieldset": {
                borderColor: error ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
                ...(error
                  ? {}
                  : {
                      animation: "pulseInputBorder 2s ease-in-out infinite",
                      "@keyframes pulseInputBorder": {
                        "0%, 100%": { boxShadow: "0 0 0 0 rgba(184,115,51,0.3)" },
                        "50%": { boxShadow: "0 0 0 4px rgba(184,115,51,0.08)" },
                      },
                    }),
              },
            },
          }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={loading}
          sx={{ ...ctaShimmerSx, px: 3, whiteSpace: "nowrap" }}
        >
          {loading ? <CircularProgress size={20} color="inherit" /> : t.newsletterButton}
        </Button>
      </Stack>
    </Box>
  );
}
