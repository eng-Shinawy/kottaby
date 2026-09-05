"use client";

import { LinkOffOutlined as LinkOffIcon, PersonSearchOutlined as PersonSearchIcon } from "@mui/icons-material";
import { Card, CardContent, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { HandshakeCode, useAppTranslation } from "@/shared/locale";

interface HandshakeCodeResultCardProps {
  /** Server-computed masked name of the found student (first grapheme per name part). */
  readonly maskedName: string;
  /** `true` when the student has no parent yet (`parentId IS NULL`, computed server-side). */
  readonly linkable: boolean;
}

/**
 * HandshakeCodeResultCard — the found-student confirmation card of the parent
 * discovery page.
 *
 * The payload carries EXACTLY `maskedName` + `linkable` (the query selects
 * nothing else), so this card can only ever present the sanctioned masked
 * confirmation: the masked name, a `linkable`-driven title + description, and
 * NOTHING ELSE — no ids, no contacts, and deliberately NO link-request CTA
 * (that action belongs to the link-request feature; rendering even a disabled
 * placeholder is out of scope here).
 *
 * The masked name renders through the natural document direction — masked
 * Arabic names read RTL natively; only the code atom elsewhere in this
 * feature needs LTR isolation.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * `*Outlined` icons, logical properties for RTL mirroring.
 */
export function HandshakeCodeResultCard(props: Readonly<HandshakeCodeResultCardProps>): ReactNode {
  const t = useAppTranslation(HandshakeCode);
  const Icon = props.linkable ? PersonSearchIcon : LinkOffIcon;
  const title = props.linkable ? t.foundTitle : t.alreadyLinkedTitle;
  const description = props.linkable ? t.canLinkDescription : t.alreadyLinkedDescription;

  return (
    <Card
      elevation={0}
      data-testid="handshake-discovery-result"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Icon fontSize="small" sx={theme => ({ color: theme.palette.primary.main })} />
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
        </Stack>
        <Typography
          variant="h5"
          component="p"
          // Bidi isolation (D8 browser-QA note): the masked name is always
          // first-strong (first grapheme of each name part + neutral
          // asterisks) — `dir="auto"` resolves Latin-initial masks to LTR and
          // Arabic-initial masks to RTL, and isolates the neutrals from the
          // surrounding RTL shell (mirrors OutgoingLinkRequestCard).
          dir="auto"
          sx={theme => ({
            px: 2.5,
            py: 1.5,
            borderRadius: 2,
            width: "fit-content",
            maxWidth: "100%",
            bgcolor: theme.palette.primaryContainer,
            color: theme.palette.onPrimaryContainer,
          })}
        >
          {props.maskedName}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {description}
        </Typography>
      </CardContent>
    </Card>
  );
}
