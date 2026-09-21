"use client";

import { FilterListOutlined as FilterIcon } from "@mui/icons-material";
import { TextField as MuiTextField } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { RecitationGrid } from "@/frontend/views/landing/sections/recitations/RecitationGrid";
import { Landing, useAppTranslation } from "@/shared/locale";

const RECITATIONS = [
  { name: "Hafs ʿan ʿĀṣim", lowerName: "hafs ʿan ʿāṣim", arabic: "حفص عن عاصم", popular: true },
  { name: "Shuʿba ʿan ʿĀṣim", lowerName: "shuʿba ʿan ʿāṣim", arabic: "شعبة عن عاصم" },
  { name: "Qālūn ʿan Nāfiʿ", lowerName: "qālūn ʿan nāfiʿ", arabic: "قالون عن نافع" },
  { name: "Warsh ʿan Nāfiʿ", lowerName: "warsh ʿan nāfiʿ", arabic: "ورش عن نافع" },
  { name: "al-Dūrī ʿan Abī ʿAmr", lowerName: "al-dūrī ʿan abī ʿamr", arabic: "الدوري عن أبي عمرو" },
  { name: "al-Sūsī ʿan Abī ʿAmr", lowerName: "al-sūsī ʿan abī ʿamr", arabic: "السوسي عن أبي عمرو" },
  { name: "Hishām ʿan Ibn ʿĀmir", lowerName: "hishām ʿan ibn ʿāmir", arabic: "هشام عن ابن عامر" },
  { name: "Ibn Dhakwān ʿan Ibn ʿĀmir", lowerName: "ibn dhakwān ʿan ibn ʿāmir", arabic: "ابن ذكوان عن ابن عامر" },
  { name: "Khalaf ʿan Ḥamzah", lowerName: "khalaf ʿan ḥamzah", arabic: "خلف عن حمزة" },
  { name: "al-Dūrī ʿan al-Kisāʾī", lowerName: "al-dūrī ʿan al-kisāʾī", arabic: "الدوري عن الكسائي" },
] as const;

// ─── Recitations showcase ────────────────────────────────────────────

export function RecitationsSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return RECITATIONS.filter(r => r.lowerName.includes(q) || r.arabic.includes(q));
  }, [search]);

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
