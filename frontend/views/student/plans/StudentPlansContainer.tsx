"use client";

import { useQuery } from "@apollo/client/react";
import { Inventory2Outlined as EmptyStateIcon, ErrorOutlineOutlined as ErrorStateIcon } from "@mui/icons-material";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import { planCatalogQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { StudentPlanCard } from "@/frontend/views/student/plans/StudentPlanCard";
import { StudentPlans, useAppTranslation } from "@/shared/locale";
import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";

/**
 * `StudentPlansContainer` — the client-owned consumer storefront (mounted by
 * the `/plans` server shell; the FIRST consumer-facing DEV1-005 artifact and
 * the DEV1-006 purchase-flow landing strip).
 *
 * Responsibilities:
 *  - DATA: `useQuery(planCatalogQueryDocument)` from `@apollo/client/react` —
 *    the server-enforced consumer read (ANY authenticated role, ACTIVE slice
 *    only; visibility is owned by the service predicate, not this container);
 *  - COPY: `useAppTranslation(StudentPlans)` — property access ONLY, no
 *    `t("key")` string lookups anywhere on this surface;
 *  - STATES: skeleton cards while in flight → localized empty state →
 *    localized error state with retry → the responsive card grid;
 *  - SUBSCRIBE INTENT: card CTAs open ONE shared purchase-notice dialog —
 *    the honest "online subscription coming soon" posture until DEV1-006
 *    lands the real purchase flow. The dialog body interpolates the plan
 *    title through the namespace formatter; its React `key` is kind-prefixed
 *    (audit-CR2 lesson: bare numeric keys collided across sibling mounts).
 *
 * Server hand-off (`labels` prop): the `/plans` shell resolves
 * `getTranslations(locale).studentPlansTranslations` server-side and passes
 * the STRING-KEYED subset (RSC props are serialized — the namespace's two
 * formatter functions cannot cross the boundary, so the page forwards each
 * label via property access and the full tree — formatters included — comes
 * from the client handle below, which the cards consume in-container).
 * Precedent: the admin `/admin/plans` shell ↔ `PlanCatalogContainer` merge.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/**
 * The RSC-serializable slice of {@link StudentPlansLabels} the server shell
 * hands down — every member is a plain string; the two formatter keys
 * (`intervalDays`, `purchaseDialogBody`) are structurally excluded (they
 * cannot cross the server/client boundary and are only consumed client-side).
 */
export type StudentPlansStaticLabels = Pick<
  StudentPlansLabels,
  | "pageTitle"
  | "pageSubtitle"
  | "loading"
  | "emptyStateTitle"
  | "emptyStateBody"
  | "errorStateTitle"
  | "errorStateBody"
  | "errorStateRetry"
  | "labelSessions"
  | "labelInterval"
  | "subscribeCta"
  | "purchaseDialogTitle"
  | "purchaseDialogClose"
>;

export interface StudentPlansContainerProps {
  /**
   * Optional server-resolved label subset (property access on
   * `studentPlansTranslations`). When omitted — client-only mounts, tests —
   * the container resolves the FULL tree through
   * `useAppTranslation(StudentPlans)`.
   */
  readonly labels?: StudentPlansStaticLabels;
}

/** Plan-card loading skeleton — mirrors the real card's outer geometry. */
function PlanCardSkeleton(): ReactNode {
  return (
    <Box
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        p: { xs: 2.5, sm: 3 },
        display: "grid",
        gap: 2,
      })}
      aria-busy="true"
    >
      <Skeleton variant="text" width="70%" height={32} />
      <Skeleton variant="text" width="40%" height={40} />
      <Skeleton variant="rounded" height={52} />
      <Skeleton variant="rounded" height={40} />
    </Box>
  );
}

export function StudentPlansContainer({ labels }: Readonly<StudentPlansContainerProps>): ReactNode {
  const translated = useAppTranslation(StudentPlans);
  const { data, loading, error, refetch } = useQuery(planCatalogQueryDocument);

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies every remaining key — including the
  // two formatters the cards + notice dialog interpolate.
  const t: StudentPlansLabels = { ...translated, ...labels };

  // ── Subscribe-notice dialog state ─────────────────────────────────────────
  const [noticePlan, setNoticePlan] = useState<PlanCatalogQuery_planCatalog | null>(null);

  const openNotice = useCallback((plan: PlanCatalogQuery_planCatalog) => setNoticePlan(plan), []);
  const closeNotice = useCallback(() => setNoticePlan(null), []);

  // ── State branches (error → loading → empty → populated) ──────────────────
  let surface: ReactNode;
  if (error) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        role="alert"
        data-testid="student-plans-error"
      >
        <ErrorStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.error.main })} aria-hidden />
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.errorStateTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
          {t.errorStateBody}
        </Typography>
        <Button variant="outlined" onClick={() => void refetch()} sx={{ borderRadius: 2 }}>
          {t.errorStateRetry}
        </Button>
      </Stack>
    );
  } else if (loading || !data) {
    // `loading || !data` — a settled failure with a cache flush would hand
    // back `data: undefined` alongside `error`; the error branch above has
    // already caught it, so reaching this branch means the read is genuinely
    // without rows to show yet.
    surface = (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
          gap: 2.5,
        }}
        aria-busy="true"
        data-testid="student-plans-loading"
      >
        {[0, 1, 2].map(offset => (
          <PlanCardSkeleton key={`skeleton-${offset}`} />
        ))}
        <Typography
          sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
          aria-live="polite"
        >
          {t.loading}
        </Typography>
      </Box>
    );
  } else if (data.planCatalog.length === 0) {
    surface = (
      <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", py: 8 }} data-testid="student-plans-empty">
        <EmptyStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} aria-hidden />
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.emptyStateTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
          {t.emptyStateBody}
        </Typography>
      </Stack>
    );
  } else {
    surface = (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
          gap: 2.5,
        }}
        data-testid="student-plans-grid"
      >
        {data.planCatalog.map(plan => (
          <StudentPlanCard key={plan.id} plan={plan} labels={t} onSubscribe={openNotice} />
        ))}
      </Box>
    );
  }

  return (
    <>
      {surface}
      {/* ONE shared purchase-notice dialog — every card CTA routes here.
          Kind-prefixed key (audit-CR2): the nonce starts at (and resets to)
          0, and bare numeric keys collided across sibling mounts. */}
      <Dialog
        key={`notice-${noticePlan?.id ?? "idle"}`}
        open={noticePlan !== null}
        onClose={closeNotice}
        aria-labelledby="student-plans-notice-title"
        aria-describedby="student-plans-notice-body"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="student-plans-notice-title" sx={{ fontWeight: 700 }}>
          {t.purchaseDialogTitle}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="student-plans-notice-body">
            {noticePlan === null ? null : t.purchaseDialogBody(noticePlan.title)}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeNotice} variant="contained" sx={{ borderRadius: 2 }}>
            {t.purchaseDialogClose}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
