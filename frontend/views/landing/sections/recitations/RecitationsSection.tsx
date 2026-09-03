"use client";

import { FilterListOutlined as FilterIcon } from "@mui/icons-material";
import { TextField as MuiTextField } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { RecitationGrid } from "@/frontend/views/landing/sections/recitations/RecitationGrid";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Recitations showcase ────────────────────────────────────────────

export function RecitationsSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const [search, setSearch] = useState("");

  const recitations = useMemo(
    () => [
      { name: "Hafs ʿan ʿĀṣim", arabic: "حفص عن عاصم", popular: true },
      { name: "Shuʿba ʿan ʿĀṣim", arabic: "شعبة عن عاصم" },
      { name: "Qālūn ʿan Nāfiʿ", arabic: "قالون عن نافع" },
      { name: "Warsh ʿan Nāfiʿ", arabic: "ورش عن نافع" },
      { name: "al-Dūrī ʿan Abī ʿAmr", arabic: "الدوري عن أبي عمرو" },
      { name: "al-Sūsī ʿan Abī ʿAmr", arabic: "السوسي عن أبي عمرو" },
      { name: "Hishām ʿan Ibn ʿĀmir", arabic: "هشام عن ابن عامر" },
      { name: "Ibn Dhakwān ʿan Ibn ʿĀmir", arabic: "ابن ذكوان عن ابن عامر" },
      { name: "Khalaf ʿan Ḥamzah", arabic: "خلف عن حمزة" },
      { name: "al-Dūrī ʿan al-Kisāʾī", arabic: "الدوري عن الكسائي" },
    ],
    []
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return recitations;
    return recitations.filter(r => r.name.toLowerCase().includes(q) || r.arabic.includes(q));
  }, [search, recitations]);

  return (
    <SectionWrapper badge={t.recitationsBadge} title={t.recitationsTitle} subtitle={t.recitationsSubtitle} bg="paper">
      {/* Search field */}
      <MuiTextField
        fullWidth
        placeholder={t.recitationSearchPlaceholder}
        value={search}
        onChange={e => setSearch(e.target.value)}
        variant="outlined"
        size="small"
        sx={{
          maxWidth: 400,
          mb: 3,
          bgcolor: "var(--mui-palette-background-default)",
          borderRadius: 2,
          "& .MuiOutlinedInput-root": {
            borderRadius: 2,
            "& fieldset": {
              borderColor: "var(--mui-palette-divider)",
            },
            "&:hover fieldset": {
              borderColor: "var(--mui-palette-secondary-main)",
            },
          },
        }}
        slotProps={{
          input: {
            startAdornment: <FilterIcon sx={{ mr: 1, color: "var(--mui-palette-text-secondary)", fontSize: 20 }} />,
          },
        }}
      />

      <RecitationGrid filtered={filtered} noResultsLabel={t.recitationNoResults} />
    </SectionWrapper>
  );
}
