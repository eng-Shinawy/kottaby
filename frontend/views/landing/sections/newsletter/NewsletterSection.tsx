"use client";

import { CheckCircleOutlined as CheckIcon, MailOutlined as MailIcon } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import { type ReactNode, type SyntheticEvent, useCallback, useState } from "react";
import { NewsletterShell } from "@/frontend/views/landing/layout";
import { NewsletterEmailForm } from "@/frontend/views/landing/sections/newsletter/NewsletterEmailForm";
import { isEmailLike } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Newsletter CTA ──────────────────────────────────────────────────

export function NewsletterSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);

  const handleNewsletterSubmit = useCallback(
    (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!isEmailLike(email)) {
        setError(true);
        return;
      }
      setError(false);
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setSuccess(true);
      }, 1500);
    },
    [email]
  );

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setError(false);
  }, []);

  if (success) {
    return (
      <NewsletterShell>
        <CheckIcon sx={{ fontSize: 48, color: "var(--mui-palette-secondary-main)" }} />
        <Typography
          variant="h3"
          sx={{ fontWeight: 800, fontSize: { xs: 26, md: 34 }, letterSpacing: "-0.02em", lineHeight: 1.2, m: 0 }}
        >
          {t.newsletterSuccess}
        </Typography>
      </NewsletterShell>
    );
  }

  return (
    <NewsletterShell>
      {/* Badge */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 2,
          py: 0.75,
          borderRadius: 99,
          border: "1px solid var(--mui-palette-secondary-main)",
          bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 10%, transparent)",
        }}
      >
        <Box
          aria-hidden
          sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "var(--mui-palette-secondary-light)" }}
        />
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, letterSpacing: "0.12em", color: "var(--mui-palette-secondary-main)" }}
        >
          {t.newsletterBadge}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <MailIcon sx={{ fontSize: 32, color: "var(--mui-palette-secondary-main)" }} />
        <Typography
          variant="h3"
          sx={{ fontWeight: 800, fontSize: { xs: 26, md: 34 }, letterSpacing: "-0.02em", lineHeight: 1.2, m: 0 }}
        >
          {t.newsletterTitle}
        </Typography>
      </Stack>

      <Typography variant="body1" sx={{ color: "var(--mui-palette-text-secondary)", lineHeight: 1.6, fontSize: 16 }}>
        {t.newsletterSubtitle}
      </Typography>

      <NewsletterEmailForm
        email={email}
        error={error}
        loading={loading}
        onSubmit={handleNewsletterSubmit}
        onEmailChange={handleEmailChange}
      />

      <Typography variant="caption" sx={{ opacity: 0.6, mt: 1 }}>
        {t.newsletterDisclaimer}
      </Typography>
    </NewsletterShell>
  );
}
