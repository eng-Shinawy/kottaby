"use client";

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ApiStatusIndicator } from "@/frontend/components/ApiStatusIndicator";
import {
  FacebookIcon,
  InstagramIcon,
  TelegramIcon,
  XIcon,
  YoutubeIcon,
} from "@/frontend/components/siteFooter/SocialBrandIcons";
import { SocialIcon } from "@/frontend/components/siteFooter/SocialIcon";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Brand wordmark + tagline + social row + live API status (left footer column). */
export function FooterBrandSection(): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Stack spacing={1.5} sx={{ flex: { md: "1 1 40%" } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box
          aria-hidden
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: "var(--mui-palette-secondary-main)",
          }}
        />
        <Typography sx={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>{t.footerBrandName}</Typography>
      </Stack>
      <Typography variant="body2" sx={{ maxWidth: 320, lineHeight: 1.6, opacity: 0.7, fontSize: 13 }}>
        {t.footerTagline}
      </Typography>

      {/* Social media icons row */}
      <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
        <SocialIcon label={t.footerSocialX}>
          <XIcon />
        </SocialIcon>
        <SocialIcon label={t.footerSocialYoutube}>
          <YoutubeIcon />
        </SocialIcon>
        <SocialIcon label={t.footerSocialInstagram}>
          <InstagramIcon />
        </SocialIcon>
        <SocialIcon label={t.footerSocialTelegram}>
          <TelegramIcon />
        </SocialIcon>
        <SocialIcon label={t.footerSocialFacebook}>
          <FacebookIcon />
        </SocialIcon>
      </Stack>

      {/* Live API status chip — ops-grade detail under the social rail */}
      <ApiStatusIndicator />
    </Stack>
  );
}
