"use client";

import {
  PublishedWithChangesOutlined as ActivateIcon,
  CheckCircleOutlined as ActiveStatusIcon,
  EditOutlined as EditIcon,
  UnpublishedOutlined as InactiveStatusIcon,
  type SvgIconComponent,
} from "@mui/icons-material";
import {
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { type Palette, useTheme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminPlansQuery_adminPlans } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { PlansLabels } from "@/shared/locale/types/plans";

/**
 * `PlanCatalogTable` — the admin plan-catalog data surface (DEV1-005 REQ-062).
 *
 * Presentational ONLY: every fact rendered comes from the canonical ten-field
 * `Plan` rows handed in by {@link PlanCatalogContainer} (the Apollo `adminPlans`
 * read lives in the container, REQ-060). Two layouts from ONE payload:
 *
 *  - `md` and up → full `Table` (title, sessions, price + currency, interval,
 *    status chip, deactivated-at, created-at, row actions);
 *  - below `md` → card-stacked list (each plan becomes a self-contained card
 *    carrying the same fields as label/value pairs) — the RTL-first mobile
 *    experience; the default locale (`ar`) is RTL and the PRIMARY surface.
 *
 * Row lifecycle actions DELEGATE to the container's callback props — this
 * component never opens dialogs and never mutates (Task 4.4 owns
 * PlanFormDialog / PlanStatusConfirmDialog wiring).
 *
 * Value-rendering contract:
 *  - `price` is the server-canonical decimal STRING — rendered verbatim
 *    beside its currency code; NO numeric coercion, no `toFixed` (REQ-060);
 *  - timestamps pass through {@link formatApplicantDate} (the established
 *    locale-aware frontend date util — Arabic-Indic digits under `ar`);
 *  - a null `deactivatedAt` renders a locale-neutral em dash (punctuation,
 *    not copy — labeled only by the {@link PlansLabels.columnDeactivatedAt}
 *    header key added in the 4.4 namespace amendment).
 *
 * Namespace note (Task 4.4 amendment): the timestamp column headers resolve
 * `columnCreatedAt` / `columnDeactivatedAt` (added to the 47-key `plans`
 * namespace) — previously the two columns rendered unlabeled.
 *
 * MUI v9 discipline: `sx`-only styling with theme-palette tokens exclusively
 * (chip colors: success / grey families through `sx` theme callbacks — zero
 * hardcoded hex), `*Outlined` icons, RTL-safe logical composition (flex/grid
 * + gap; no physical margins — `dir=rtl` mirrors automatically), and every
 * user-facing string resolved from the compile-time `PlansLabels` tree via
 * property access.
 */

export interface PlanCatalogTableProps {
  /** Canonical ten-field plan rows (container-owned `adminPlans` payload). */
  readonly plans: ReadonlyArray<AdminPlansQuery_adminPlans>;
  /** Full plans-namespace labels (property access ONLY inside). */
  readonly labels: PlansLabels;
  /** Active app locale — drives timestamp formatting via the shared util. */
  readonly locale: string;
  /** Row intent: open the edit dialog (Task 4.4 wires the dialog). */
  readonly onEditPlan: (plan: AdminPlansQuery_adminPlans) => void;
  /** Row intent: open the activate/deactivate confirmation (Task 4.4). */
  readonly onTogglePlanStatus: (plan: AdminPlansQuery_adminPlans) => void;
}

export function PlanCatalogTable({
  plans,
  labels,
  locale,
  onEditPlan,
  onTogglePlanStatus,
}: Readonly<PlanCatalogTableProps>): ReactNode {
  const theme = useTheme();
  // `md`+ gets the table; below it the card stack. Mirrors the
  // DashboardLayout `useMediaQuery` convention: the server render emits the
  // mobile-first branch, the client re-renders once the viewport is known —
  // no hydration mismatch (same contract as the dashboard sidebar).
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));

  if (isDesktop) {
    return (
      <PlanCatalogDesktopTable
        plans={plans}
        labels={labels}
        locale={locale}
        onEditPlan={onEditPlan}
        onTogglePlanStatus={onTogglePlanStatus}
      />
    );
  }
  return (
    <PlanCatalogMobileCards
      plans={plans}
      labels={labels}
      locale={locale}
      onEditPlan={onEditPlan}
      onTogglePlanStatus={onTogglePlanStatus}
    />
  );
}

// ----------------------------------------------------------------------------
// Desktop table
// ----------------------------------------------------------------------------

interface CatalogLayoutProps {
  readonly plans: ReadonlyArray<AdminPlansQuery_adminPlans>;
  readonly labels: PlansLabels;
  readonly locale: string;
  readonly onEditPlan: (plan: AdminPlansQuery_adminPlans) => void;
  readonly onTogglePlanStatus: (plan: AdminPlansQuery_adminPlans) => void;
}

/** Full-width catalog table (`md`+): one row per plan, actions inline-end. */
function PlanCatalogDesktopTable({
  plans,
  labels,
  locale,
  onEditPlan,
  onTogglePlanStatus,
}: Readonly<CatalogLayoutProps>): ReactNode {
  return (
    <TableContainer
      component={Paper}
      elevation={0}
      data-testid="plan-catalog-table"
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <Table size="medium" aria-label={labels.pageTitle}>
        <TableHead>
          <TableRow>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.columnTitle}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.columnSessionCount}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.columnPrice}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.columnIntervalDays}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.columnStatus}
            </TableCell>
            {/* Timestamp headers — resolved from the plans namespace (4.4
                amendment); no hardcoded header copy. */}
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.columnDeactivatedAt}
            </TableCell>
            <TableCell scope="col" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}>
              {labels.columnCreatedAt}
            </TableCell>
            <TableCell
              scope="col"
              align="right"
              sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 700 })}
            >
              {labels.columnActions}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {plans.map(plan => (
            <TableRow key={plan.id} sx={{ "&:last-child td": { borderBottom: 0 } }}>
              {/* Title — admin-authored content, ellipsis-truncated so a
                  runaway name cannot blow out the row layout. */}
              <TableCell sx={{ maxWidth: 280 }}>
                <Typography variant="body1" noWrap sx={{ fontWeight: 600 }}>
                  {plan.title}
                </Typography>
              </TableCell>
              <TableCell>{plan.sessionCount}</TableCell>
              {/* price + currency: the server-canonical decimal STRING is
                  rendered verbatim — no coercion, no formatting (REQ-060). */}
              <TableCell>
                <Typography variant="body1" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {plan.price} {plan.currency}
                </Typography>
              </TableCell>
              <TableCell>{plan.intervalDays}</TableCell>
              <TableCell>
                <PlanStatusChip isActive={plan.isActive} labels={labels} />
              </TableCell>
              <TableCell>
                <TimestampText iso={plan.deactivatedAt} locale={locale} />
              </TableCell>
              <TableCell>
                <TimestampText iso={plan.createdAt} locale={locale} />
              </TableCell>
              <TableCell align="right">
                <RowActions
                  plan={plan}
                  labels={labels}
                  onEditPlan={onEditPlan}
                  onTogglePlanStatus={onTogglePlanStatus}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Locale-aware timestamp, or a locale-neutral dash for an absent instant. */
function TimestampText({ iso, locale }: { readonly iso: string | null; readonly locale: string }): ReactNode {
  return (
    <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, whiteSpace: "nowrap" })}>
      {iso === null ? "—" : formatApplicantDate(iso, locale)}
    </Typography>
  );
}

// ----------------------------------------------------------------------------
// Mobile card stack
// ----------------------------------------------------------------------------

/** Card-stacked catalog (below `md`): one card per plan, same facts. */
function PlanCatalogMobileCards({
  plans,
  labels,
  locale,
  onEditPlan,
  onTogglePlanStatus,
}: Readonly<CatalogLayoutProps>): ReactNode {
  return (
    <Stack spacing={2} data-testid="plan-catalog-cards">
      {plans.map(plan => (
        <Card
          key={plan.id}
          elevation={0}
          sx={theme => ({
            borderRadius: 3,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            bgcolor: theme.palette.surfaceContainerLow,
            boxShadow: theme.palette.shadow.card,
          })}
        >
          <CardContent sx={{ display: "grid", gap: 1.5, p: { xs: 2.5, sm: 3 } }}>
            <Stack
              spacing={1.5}
              sx={{
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
              }}
            >
              <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
                {plan.title}
              </Typography>
              <PlanStatusChip isActive={plan.isActive} labels={labels} />
            </Stack>
            <SpecRow label={labels.columnSessionCount} value={plan.sessionCount} />
            {/* price string rendered verbatim next to its currency code. */}
            <SpecRow label={labels.columnPrice} value={`${plan.price} ${plan.currency}`} />
            <SpecRow label={labels.columnIntervalDays} value={plan.intervalDays} />
            {/* Lifecycle stamps — labeled metadata footer (labels from the
                4.4 namespace amendment; null deactivatedAt stays unlabeled). */}
            <Box
              sx={theme => ({
                display: "flex",
                flexWrap: "wrap",
                gap: 1,
                borderTop: "1px solid",
                borderColor: theme.palette.outlineVariant,
                pt: 1.5,
              })}
            >
              <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
                {`${labels.columnCreatedAt}: ${formatApplicantDate(plan.createdAt, locale)}`}
              </Typography>
              {plan.deactivatedAt === null ? null : (
                <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
                  {`${labels.columnDeactivatedAt}: ${formatApplicantDate(plan.deactivatedAt, locale)}`}
                </Typography>
              )}
            </Box>
            <RowActions
              plan={plan}
              labels={labels}
              onEditPlan={onEditPlan}
              onTogglePlanStatus={onTogglePlanStatus}
              align="stretch"
            />
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

interface SpecRowProps {
  readonly label: string;
  readonly value: string | number;
}

/** Label/value pair mirroring a table column inside a card. */
function SpecRow({ label, value }: Readonly<SpecRowProps>): ReactNode {
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 600, textAlign: "end" }}>
        {value}
      </Typography>
    </Box>
  );
}

// ----------------------------------------------------------------------------
// Shared row primitives
// ----------------------------------------------------------------------------

interface RowActionsProps {
  readonly plan: AdminPlansQuery_adminPlans;
  readonly labels: PlansLabels;
  readonly onEditPlan: (plan: AdminPlansQuery_adminPlans) => void;
  readonly onTogglePlanStatus: (plan: AdminPlansQuery_adminPlans) => void;
  /** `stretch` spreads the actions across the full card width on mobile. */
  readonly align?: "end" | "stretch";
}

/**
 * Per-plan actions: edit + the lifecycle toggle whose icon/label/tooltip
 * reflect the row's CURRENT state (deactivate an active plan, reactivate a
 * deactivated one). Clicks only DELEGATE — no dialog, no mutation here.
 */
function RowActions({
  plan,
  labels,
  onEditPlan,
  onTogglePlanStatus,
  align = "end",
}: Readonly<RowActionsProps>): ReactNode {
  const toggleLabel = plan.isActive ? labels.actionDeactivate : labels.actionActivate;
  const ToggleIcon: SvgIconComponent = plan.isActive ? InactiveStatusIcon : ActivateIcon;

  return (
    <Stack
      spacing={0.5}
      sx={{ flexDirection: "row", justifyContent: align === "stretch" ? "space-between" : "flex-end", gap: 0.5 }}
    >
      <Tooltip title={labels.actionEdit}>
        <IconButton
          size="small"
          aria-label={labels.actionEdit}
          onClick={() => onEditPlan(plan)}
          sx={theme => ({ color: theme.palette.text.secondary })}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={toggleLabel}>
        <IconButton
          size="small"
          aria-label={toggleLabel}
          onClick={() => onTogglePlanStatus(plan)}
          sx={theme => ({
            color: plan.isActive ? theme.palette.warning.main : theme.palette.success.main,
          })}
        >
          <ToggleIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

interface PlanStatusChipProps {
  readonly isActive: boolean;
  readonly labels: PlansLabels;
}

/**
 * Mode-aware grey pair for the Inactive chip — extracted to keep the `sx`
 * callback free of nested conditionals. Theme-palette tokens only; the
 * light/dark split preserves contrast in both modes without any hex.
 */
function inactiveChipPair(palette: Palette): { readonly background: string; readonly foreground: string } {
  if (palette.mode === "dark") {
    return { background: palette.grey[800], foreground: palette.grey[200] };
  }
  return { background: palette.grey[200], foreground: palette.grey[900] };
}

/**
 * Lifecycle status chip — Active rides the theme's `successContainer`
 * container/on-container pair; Inactive rides the `grey` family resolved by
 * {@link inactiveChipPair} (light/dark contrast preserved, zero hardcoded
 * hex anywhere — REQ-076 palette discipline).
 */
function PlanStatusChip({ isActive, labels }: Readonly<PlanStatusChipProps>): ReactNode {
  const StatusIcon: SvgIconComponent = isActive ? ActiveStatusIcon : InactiveStatusIcon;
  return (
    <Chip
      size="small"
      icon={<StatusIcon fontSize="small" />}
      label={isActive ? labels.statusActive : labels.statusInactive}
      sx={theme => {
        const inactive = inactiveChipPair(theme.palette);
        const background = isActive ? theme.palette.successContainer : inactive.background;
        const foreground = isActive ? theme.palette.onSuccessContainer : inactive.foreground;
        return {
          fontWeight: 600,
          bgcolor: background,
          color: foreground,
          "& .MuiChip-icon": { color: foreground },
        };
      }}
    />
  );
}
