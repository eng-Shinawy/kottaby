"use client";

import { useQuery } from "@apollo/client/react";
import { ContentCopyOutlined as ContentCopyIcon, TagOutlined as TagIcon } from "@mui/icons-material";
import { Alert, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { myHandshakeCodeQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";
import { CodeChip } from "@/frontend/views/students/dashboard/CodeChip";
import { CopyOutcomeNotice } from "@/frontend/views/students/dashboard/CopyOutcomeNotice";
import { LoadingSkeleton } from "@/frontend/views/students/dashboard/LoadingSkeleton";
import { useCopyOutcome } from "@/frontend/views/students/dashboard/useCopyOutcome";
import { Errors, HandshakeCode, useAppTranslation } from "@/shared/locale";

/** Copy affordance metrics — comfortable ≥44px touch target. */
const copyButtonSx = { minHeight: 44, px: 3 } as const;

/**
 * HandshakeCodeCard — the student's own "Your Handshake Code" card mounted
 * above the fold on `/student/dashboard`.
 *
 * Self-contained client component: NO props, NO client-side role logic — the
 * page-level server guards remain the ONLY authorization boundary and the
 * zero-argument `myHandshakeCode` query answers identity server-side; every
 * rendered fact comes straight from the payload.
 *
 * Render branches:
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | query in flight | Skeleton card (`aria-busy`) |
 * | 2 | error code `UNAUTHORIZED` / `FORBIDDEN` | shared `PermissionDeniedFallback` — never bare `null` |
 * | 3 | error code `STUDENT_NOT_FOUND` | inline `Alert` carrying `errors.studentHandshakeNotFound` (own-row miss edge) |
 * | 4 | any other transport error | inline `Alert` carrying `errors.internalServerError` |
 * | 5 | code resolved | title + description + LTR-isolated code chip + copy affordance + `aria-live` outcome notice |
 *
 * Copy affordance: `navigator.clipboard.writeText` inside try/catch — success
 * announces the localized confirmation (self-clearing), failure announces the
 * localized fallback notice (sticky until the next attempt, instructing the
 * user to copy manually).
 *
 * MUI v9 discipline: `sx`-only styling (no direct style props), colors
 * exclusively through `theme.palette.*` callbacks, `*Outlined` icons only,
 * RTL-safe logical composition, and every user-facing string resolved through
 * compile-time i18n handles (`useAppTranslation(HandshakeCode)` property
 * access — NEVER `t('key')`).
 */
export function HandshakeCodeCard(): ReactNode {
  const t = useAppTranslation(HandshakeCode);
  const te = useAppTranslation(Errors);
  const { copyOutcome, setCopyOutcome } = useCopyOutcome();
  const { data, loading, error } = useQuery(myHandshakeCodeQueryDocument);

  // Branch 1 — in flight: skeleton placeholder announces busy semantics.
  if (loading) {
    return <LoadingSkeleton />;
  }

  // Branches 2–4 — settled failures: denial class vs own-row miss vs generic.
  if (error) {
    const code = extractErrorCode(error);
    if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
      return <PermissionDeniedFallback />;
    }
    const failureCopy = code === "STUDENT_NOT_FOUND" ? te.studentHandshakeNotFound : te.internalServerError;
    return (
      <CardShell testId="handshake-code-card">
        <Alert severity="error" variant="outlined">
          {failureCopy}
        </Alert>
      </CardShell>
    );
  }

  const handshakeCode = data?.myHandshakeCode;

  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (typeof handshakeCode !== "string") {
    return <LoadingSkeleton />;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(handshakeCode);
      setCopyOutcome("copied");
    } catch {
      // Clipboard API unavailable or denied — surface the manual-copy notice.
      setCopyOutcome("failed");
    }
  };

  // Branch 5 — the code, presented as an LTR-isolated atom with a copy CTA.
  return (
    <CardShell testId="handshake-code-card">
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <TagIcon fontSize="small" sx={theme => ({ color: theme.palette.primary.main })} />
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          {t.yourCodeTitle}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {t.yourCodeDescription}
      </Typography>
      <Stack
        spacing={2}
        sx={{
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
        }}
      >
        <CodeChip code={handshakeCode} />
        <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={handleCopy} sx={{ ...copyButtonSx }}>
          {t.copyCode}
        </Button>
      </Stack>
      <CopyOutcomeNotice outcome={copyOutcome} copiedText={t.codeCopied} failedText={t.copyFailed} />
    </CardShell>
  );
}
