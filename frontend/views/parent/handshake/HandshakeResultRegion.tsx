"use client";

import { SearchOffOutlined as SearchOffIcon } from "@mui/icons-material";
import { Alert, Card, CardContent, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { HandshakeResultState } from "@/frontend/views/parent/handshake/deriveHandshakeResultState";
import { HandshakeCodeResultCard } from "@/frontend/views/parent/handshake/HandshakeCodeResultCard";

export interface HandshakeResultRegionProps {
  readonly state: HandshakeResultState;
  /** Localized generic failure copy (`errors.internalServerError`). */
  readonly genericErrorCopy: string;
  /** Localized neutral not-found heading. */
  readonly notFoundTitle: string;
  /** Localized neutral not-found body. */
  readonly notFoundDescription: string;
}

/**
 * The result region below the form — renders exactly one outcome state per
 * the state machine (nothing at all while idle, and nothing beyond the field
 * error while the server re-judges the format).
 */
export function HandshakeResultRegion(props: Readonly<HandshakeResultRegionProps>): ReactNode {
  switch (props.state.kind) {
    case "found":
      return <HandshakeCodeResultCard maskedName={props.state.maskedName} linkable={props.state.linkable} />;
    case "searching":
      return <SearchingSkeleton />;
    case "not-found":
      return <NotFoundState title={props.notFoundTitle} description={props.notFoundDescription} />;
    case "generic-error":
      return (
        <Alert severity="error" variant="outlined">
          {props.genericErrorCopy}
        </Alert>
      );
    default:
      return null;
  }
}

/** Searching state — result-region skeleton (mirrors the card skeleton rhythm). */
function SearchingSkeleton(): ReactNode {
  return (
    <Card
      elevation={0}
      aria-busy="true"
      data-testid="handshake-discovery-searching"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>
        <Skeleton variant="text" sx={{ fontSize: "1.5rem", maxWidth: 260 }} />
        <Skeleton variant="rounded" sx={{ height: 48, maxWidth: 220, borderRadius: 2 }} />
        <Skeleton variant="text" sx={{ maxWidth: 380 }} />
      </CardContent>
    </Card>
  );
}

interface NotFoundStateProps {
  readonly title: string;
  readonly description: string;
}

/**
 * Not-found state — a NEUTRAL inline surface (a discovery miss is a
 * first-class UI state, not a failure): NO `Alert`, no error palette, no
 * alert semantics — palette-neutral card tokens with secondary text.
 */
function NotFoundState({ title, description }: Readonly<NotFoundStateProps>): ReactNode {
  return (
    <Card
      elevation={0}
      data-testid="handshake-discovery-not-found"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <SearchOffIcon fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} />
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {description}
        </Typography>
      </CardContent>
    </Card>
  );
}
