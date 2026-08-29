"use client";

import {
  CheckCircleOutlined as ActiveIcon,
  EventRepeatOutlined as IntervalIcon,
  HourglassTopOutlined as PendingIcon,
  SchoolOutlined as SessionsIcon,
} from "@mui/icons-material";
import { Box, Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";

/**
 * `StudentPlanCard` — one storefront plan tile on the consumer `/plans`
 * page. Presentational ONLY: every fact rendered comes from the canonical
 * ten-field `Plan` row handed in by {@link StudentPlansContainer} (the
 * Apollo `planCatalog` read lives in the container).
 *
 * Value-rendering contract:
 *  - `price` is the server-canonical decimal STRING — rendered verbatim
 *    as the card's visual anchor beside its currency code; NO numeric
 *    coercion, no `toFixed` (same REQ-060 discipline as the admin catalog
 *    table);
 *  - the renewal interval resolves through the namespace's `intervalDays`
 *    title-formatter (locale-owned copy — "Every 30 days" / "كل 30 يومًا");
 *  - lifecycle columns (`isActive` / `deactivatedAt`) are NOT rendered —
 *    the consumer read (`planCatalog`) only ever carries the ACTIVE slice,
 *    so a status chip would be noise on this surface.
 *
 * DEV1-006 Phase A pending state → DEV1-010 full posture map: the
 * container derives ONE posture per plan from the owner-scoped
 * `mySubscriptions` read and the card renders it —
 *  - `pending`  → pending chip + DISABLED CTA relabeled `purchasePendingCta`
 *    (the server fences an unresolved duplicate request);
 *  - `active`   → "Active" chip (informational) + live `renewCta` CTA —
 *    the service deliberately allows an early re-request (renewal
 *    semantics belong to the payment-activation phase), so the card
 *    signals ownership without blocking;
 *  - `renew`    → live `renewCta` CTA (the user's latest history for the
 *    plan is terminal: expired / cancelled / suspended — no chip, the
 *    storefront sells the next cycle);
 *  - `subscribe`→ the default `subscribeCta` CTA, no chip.
 * A disabled button carries the plan title in its aria-label for screen
 * readers (the visible label alone — "Requested" — is not identifying).
 *
 * The CTA delegates to the container's `onSubscribe` callback in EVERY
 * posture — the card never opens dialogs and never mutates; the
 * subscribe + renew flows share the container's request dialog.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens
 * (zero hardcoded hex), `*Outlined` icons, RTL-safe logical composition
 * (flex/grid + gap; no physical margins), every user-facing string
 * resolved from the compile-time `StudentPlansLabels` tree via property
 * access.
 */

/**
 * The per-plan request posture the container derives from the
 * owner-scoped read. Priority order lives container-side:
 * `pending > active > renew > subscribe`.
 */
export type StudentPlanCardPosture = "subscribe" | "pending" | "active" | "renew";

export interface StudentPlanCardProps {
  /** Canonical ten-field plan row (container-owned `planCatalog` payload). */
  readonly plan: PlanCatalogQuery_planCatalog;
  /** Full studentPlans-namespace labels (property access ONLY inside). */
  readonly labels: StudentPlansLabels;
  /** The derived request posture for this plan (see the type's doc). */
  readonly posture: StudentPlanCardPosture;
  /** Card intent: open the subscribe/renew request dialog for this plan. */
  readonly onSubscribe: (plan: PlanCatalogQuery_planCatalog) => void;
}

/** Icon+label/value spec row mirroring the admin table's columns. */
function CardSpecRow({
  Icon,
  label,
  value,
}: Readonly<{ Icon: typeof SessionsIcon; label: string; value: string }>): ReactNode {
  return (
    <Stack spacing={0} sx={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
      <Icon fontSize="small" sx={theme => ({ color: theme.palette.text.secondary })} aria-hidden />
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, minWidth: 64 })}>
        {label}
      </Typography>
      <Typography
        variant="body1"
        sx={theme => ({ fontWeight: 600, textAlign: "end", flex: 1, color: theme.palette.text.primary })}
      >
        {value}
      </Typography>
    </Stack>
  );
}

/** The card's CTA label per posture. */
function ctaLabelOf(posture: StudentPlanCardPosture, labels: StudentPlansLabels): string {
  switch (posture) {
    case "pending":
      return labels.purchasePendingCta;
    case "active":
    case "renew":
      return labels.renewCta;
    default:
      return labels.subscribeCta;
  }
}

export function StudentPlanCard({ plan, labels, posture, onSubscribe }: Readonly<StudentPlanCardProps>): ReactNode {
  const ctaLabel = ctaLabelOf(posture, labels);
  const isPending = posture === "pending";
  const isActive = posture === "active";

  return (
    <Card
      elevation={0}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: isPending ? theme.palette.tertiary : theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
        display: "flex",
        flexDirection: "column",
        transition: theme.transitions.create(["border-color", "transform", "box-shadow"], {
          duration: theme.transitions.duration.short,
        }),
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: theme.palette.shadow.card,
          borderColor: theme.palette.primary.main,
        },
      })}
    >
      <CardContent
        sx={{
          display: "grid",
          gap: 2,
          p: { xs: 2.5, sm: 3 },
          flexGrow: 1,
          gridTemplateRows: "auto auto 1fr auto",
        }}
      >
        {/* Title row — admin-authored content; the grid keeps equal-height
            cards and the title wraps naturally (no ellipsis). A plan with an
            unresolved pending request carries the pending chip INLINE, an
            already-active plan carries the informational Active chip. */}
        <Stack
          spacing={1}
          sx={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}
        >
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            {plan.title}
          </Typography>
          {isPending ? (
            <Chip
              icon={<PendingIcon />}
              label={labels.purchasePendingCta}
              size="small"
              sx={theme => ({
                bgcolor: theme.palette.tertiaryContainer,
                color: theme.palette.onTertiaryContainer,
                "& .MuiChip-icon": { color: theme.palette.onTertiaryContainer },
              })}
              data-testid={`student-plan-pending-chip-${plan.id}`}
            />
          ) : isActive ? (
            <Chip
              icon={<ActiveIcon />}
              label={labels.activeChip}
              size="small"
              aria-label={`${labels.activeChip} — ${plan.title}`}
              sx={theme => ({
                bgcolor: theme.palette.successContainer,
                color: theme.palette.onSuccessContainer,
                "& .MuiChip-icon": { color: theme.palette.onSuccessContainer },
              })}
              data-testid={`student-plan-active-chip-${plan.id}`}
            />
          ) : null}
        </Stack>

        {/* Price — decimal string verbatim + currency code; the storefront's
            visual anchor. */}
        <Stack spacing={0.5} sx={{ flexDirection: "row", alignItems: "baseline", gap: 1 }}>
          <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>
            {plan.price}
          </Typography>
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
            {plan.currency}
          </Typography>
        </Stack>

        {/* Specs — sessions + renewal interval, pinned above the CTA by the
            1fr spacer row so buttons align across the whole grid row. */}
        <Box sx={{ display: "grid", gap: 1, alignContent: "end" }}>
          <Divider sx={{ mb: 0.5 }} />
          <CardSpecRow Icon={SessionsIcon} label={labels.labelSessions} value={String(plan.sessionCount)} />
          <CardSpecRow
            Icon={IntervalIcon}
            label={labels.labelInterval}
            value={labels.intervalDays(plan.intervalDays)}
          />
        </Box>

        {/* CTA — delegates to the container (request dialog) in EVERY
            posture; only the pending posture disables (the server fences
            the duplicate request). The aria-label keeps the plan title
            identifying for screen readers. */}
        <Button
          variant="contained"
          fullWidth
          disabled={isPending}
          onClick={() => onSubscribe(plan)}
          aria-label={`${ctaLabel} — ${plan.title}`}
          sx={{ borderRadius: 2, py: 1 }}
        >
          {ctaLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
