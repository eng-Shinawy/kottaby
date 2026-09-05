import { ExpandMore } from "@mui/icons-material";
import { Accordion, AccordionDetails, AccordionSummary, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** One numbered FAQ accordion item. */
export function FaqAccordionItem({
  num,
  question,
  answer,
  expanded,
  onChange,
}: Readonly<{
  num: string;
  question: string;
  answer: string;
  expanded: boolean;
  onChange: () => void;
}>): ReactNode {
  return (
    <Accordion
      disableGutters
      expanded={expanded}
      onChange={onChange}
      sx={{
        bgcolor: "var(--mui-palette-background-paper)",
        border: "1px solid var(--mui-palette-divider)",
        borderRadius: "8px !important",
        "&:before": { display: "none" },
        "&:first-of-type": { mt: 0 },
        "& + &": { mt: 1.5 },
        transition: "box-shadow 0.2s ease",
        "&.Mui-expanded": {
          boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
          margin: 0,
          "& + &": { mt: 1.5 },
        },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMore sx={{ color: "var(--mui-palette-secondary-main)" }} />}
        sx={{
          "& .MuiAccordionSummary-content": { my: 2 },
        }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", flex: 1 }}>
          <Typography
            variant="overline"
            sx={{
              fontWeight: 800,
              fontSize: 14,
              color: "var(--mui-palette-secondary-main)",
              lineHeight: 1,
              letterSpacing: "0.02em",
              flexShrink: 0,
            }}
          >
            {num}
          </Typography>
          <Typography sx={{ fontWeight: 600, fontSize: 16, lineHeight: 1.4 }}>{question}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails
        sx={{
          variant: "body2",
          lineHeight: 1.7,
          color: "var(--mui-palette-text-secondary)",
          px: 3,
          pb: 3,
        }}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.7, color: "var(--mui-palette-text-secondary)", pl: 5.5 }}>
          {answer}
        </Typography>
      </AccordionDetails>
    </Accordion>
  );
}
