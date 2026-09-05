"use client";

import { ContentCopy as CopyIcon, Share as ShareIcon } from "@mui/icons-material";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Copy / Share action row for the verse of the day. */
export function VerseActions(): ReactNode {
  const t = useAppTranslation(Landing);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${t.verseArabic}\n${t.verseTranslation}\n${t.verseReference}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: no-op if clipboard API fails
    }
  }, [t.verseArabic, t.verseTranslation, t.verseReference]);

  const handleShare = useCallback(async () => {
    const shareText = `${t.verseArabic}\n${t.verseTranslation}\n${t.verseReference}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: t.verseBadge, text: shareText });
      } catch {
        // User cancelled or share failed
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback: no-op
      }
    }
  }, [t.verseArabic, t.verseTranslation, t.verseReference, t.verseBadge]);

  return (
    <Stack direction="row" spacing={1} sx={{ mt: -1 }}>
      <IconButton
        onClick={handleCopy}
        size="small"
        aria-label={t.verseCopy}
        sx={{
          color: "var(--mui-palette-secondary-light)",
          "&:hover": { bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-light) 15%, transparent)" },
        }}
      >
        <CopyIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <Typography
        variant="caption"
        sx={{
          color: "var(--mui-palette-secondary-light)",
          opacity: copied ? 1 : 0.7,
          lineHeight: 2.5,
          fontWeight: copied ? 600 : 400,
        }}
      >
        {copied ? t.verseCopied : t.verseCopy}
      </Typography>
      <Box sx={{ width: 8 }} />
      <IconButton
        onClick={handleShare}
        size="small"
        aria-label={t.verseShare}
        sx={{
          color: "var(--mui-palette-secondary-light)",
          "&:hover": { bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-light) 15%, transparent)" },
        }}
      >
        <ShareIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <Typography variant="caption" sx={{ color: "var(--mui-palette-secondary-light)", opacity: 0.7, lineHeight: 2.5 }}>
        {t.verseShare}
      </Typography>
    </Stack>
  );
}
