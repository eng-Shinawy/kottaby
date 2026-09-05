"use client";

import { SearchOutlined as SearchIcon } from "@mui/icons-material";
import { Button, Card, CardContent, Stack, TextField } from "@mui/material";
import type { ReactNode } from "react";
import { HandshakeCode, useAppTranslation } from "@/shared/locale";

/** Comfortable ≥44px touch target for the submit affordance. */
const submitButtonSx = { minHeight: 44, px: 3 } as const;

interface HandshakeCodeSearchFormProps {
  /** Raw field value (controlled input — the container owns the state). */
  readonly codeInput: string;
  /** Inline field error: client-side format failure OR server `VALIDATION` re-judgment. */
  readonly error: boolean;
  /** Controlled input change handler. */
  readonly onCodeInputChange: (value: string) => void;
  /** Submit attempt handler — the container normalizes + validates. */
  readonly onSubmit: () => void;
}

/**
 * HandshakeCodeSearchForm — the code search form of the parent discovery
 * page.
 *
 * Purely presentational + controlled: the container owns every piece of
 * state (input value, error flag) so the SAME inline error surface renders
 * for a client-side format failure and for the server's `VALIDATION`
 * re-judgment — both teach the format only (`invalidFormat` copy; the
 * placeholder inside it is masked, never a working code).
 *
 * Accessibility: the field carries `aria-invalid` while an error is showing
 * (the error styling + helper text pair with it), and an EMPTY submit is a
 * normal submit (no `required` attr) so the inline helper — not the browser's
 * bubble — teaches the expected shape.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * `*Outlined` icons, `React.SubmitEvent` handler typing (never `FormEvent`).
 */
export function HandshakeCodeSearchForm(props: Readonly<HandshakeCodeSearchFormProps>): ReactNode {
  const t = useAppTranslation(HandshakeCode);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSubmit();
  };

  return (
    <Card
      elevation={0}
      component="form"
      onSubmit={handleSubmit}
      noValidate
      data-testid="handshake-discovery-form"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack
          spacing={2}
          sx={{
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "stretch", sm: "center" },
          }}
        >
          <TextField
            label={t.inputLabel}
            value={props.codeInput}
            onChange={event => props.onCodeInputChange(event.target.value)}
            error={props.error}
            helperText={props.error ? t.invalidFormat : undefined}
            fullWidth
            autoComplete="off"
            slotProps={{
              // `KSB-XXXXXXXX` is a Latin code atom — isolate it LTR even
              // inside the RTL Arabic layout (caret, placeholder and typed
              // content keep a single left-to-right reading order), while the
              // field label/helper keep the ambient direction.
              htmlInput: { "aria-invalid": props.error, dir: "ltr" },
            }}
          />
          <Button
            type="submit"
            variant="contained"
            startIcon={<SearchIcon />}
            sx={{ ...submitButtonSx, flexShrink: 0 }}
          >
            {t.searchAction}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
