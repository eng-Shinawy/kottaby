"use client";

import { Box, Button, Stack } from "@mui/material";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { FaqAccordionItem } from "@/frontend/views/landing/sections/faq/FaqAccordionItem";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── FAQ ─────────────────────────────────────────────────────────────

export function FaqSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const faqList = useMemo(
    () => [
      { id: "faq-1", q: t.faq1Question, a: t.faq1Answer, num: "01" },
      { id: "faq-2", q: t.faq2Question, a: t.faq2Answer, num: "02" },
      { id: "faq-3", q: t.faq3Question, a: t.faq3Answer, num: "03" },
      { id: "faq-4", q: t.faq4Question, a: t.faq4Answer, num: "04" },
      { id: "faq-5", q: t.faq5Question, a: t.faq5Answer, num: "05" },
    ],
    [
      t.faq1Question,
      t.faq1Answer,
      t.faq2Question,
      t.faq2Answer,
      t.faq3Question,
      t.faq3Answer,
      t.faq4Question,
      t.faq4Answer,
      t.faq5Question,
      t.faq5Answer,
    ]
  );

  const allExpanded = expandedIds.size === faqList.length;
  const handleToggleAll = useCallback(() => {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(faqList.map(f => f.id)));
    }
  }, [allExpanded, faqList]);

  const handleAccordionChange = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <SectionWrapper badge={t.faqBadge} title={t.faqTitle} subtitle={t.faqSubtitle} bg="paper">
      <Stack spacing={2} sx={{ maxWidth: 800, mx: "auto" }}>
        <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
          <Button
            size="small"
            onClick={handleToggleAll}
            sx={{
              color: "var(--mui-palette-secondary-main)",
              textTransform: "none",
              fontWeight: 600,
              fontSize: 13,
              p: 0.5,
              "&:hover": { bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 8%, transparent)" },
            }}
          >
            {allExpanded ? t.faqCollapseAll : t.faqExpandAll}
          </Button>
        </Stack>
        <Box>
          {faqList.map(faq => (
            <FaqAccordionItem
              key={faq.id}
              num={faq.num}
              question={faq.q}
              answer={faq.a}
              expanded={expandedIds.has(faq.id)}
              onChange={() => handleAccordionChange(faq.id)}
            />
          ))}
        </Box>
      </Stack>
    </SectionWrapper>
  );
}
