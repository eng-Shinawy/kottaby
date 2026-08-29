"use client";

import { useMutation } from "@apollo/client/react";
import { SaveOutlined as SaveIcon } from "@mui/icons-material";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import type {
  AdminPlansQuery,
  AdminPlansQuery_adminPlans,
  AdminPlansQueryVariables,
  UpdatePlanInput,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminPlansQueryDocument,
  createPlanMutationDocument,
  updatePlanMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { applyProjectedFieldErrors, projectMutationFieldErrors } from "@/frontend/lib/mutationFieldErrors";
import { Errors, useAppTranslation } from "@/shared/locale";
import type { PlansLabels } from "@/shared/locale/types/plans";

/**
 * `PlanFormDialog` — the shared create/edit plan dialog (DEV1-005 REQ-012,
 * REQ-043, REQ-050, REQ-063), mounted by `PlanCatalogContainer`.
 *
 * Mode discrimination: `plan === null` ⇒ CREATE (full `CreatePlanInput` from
 * blank fields); `plan != null` ⇒ EDIT — fields prefill the canonical row and
 * submission builds a PARTIAL `UpdatePlanInput` patch.
 *
 * Partial-patch contract (codegen `avoidOptionals: true`): every optional
 * GraphQL input key is EMITTED as a required key typed `| null | undefined`,
 * so untouched keys are carried as `undefined` — JSON serialization drops
 * them (⇒ unsent) and the server's partial-update judge sees only what the
 * user actually changed. NEVER send `null` for an untouched field.
 *
 * Client-side validation is LIGHT-TOUCH ONLY (REQ-050): the title is trimmed
 * and numeric strings collapse through {@link toWireInt} — unparseable
 * integers wire as `0` so the rejection lands on the server's localized
 * VALIDATION judge (`extensions.fields[]`) instead of dying in the GraphQL
 * `Int` serializer as a masked transport error. Currency is passed through
 * verbatim (`maxLength: 3` input hint) — the `/^[A-Z]{3}$/` judge owns the
 * error, so a lowercase code surfaces a real localized field error.
 *
 * Per-field error mapping (Ruling B): `extensions.fields[]` (`{field, code,
 * message}`) rides errors whose TOP-LEVEL `extensions.code` is `VALIDATION` —
 * mapping keys off `extensions.fields`, never the top-level code. Each
 * entry's `message` is already server-localized: it is rendered verbatim
 * under the matching TextField (`error` + `helperText`; MUI InputBase sets
 * `aria-invalid={!!error}`), with the whitelisted five-field guard skipping
 * any unknown wire path. Fallback copy (no usable `fields[]`) resolves
 * through the `errors` namespace by machine code.
 *
 * Error-class posture:
 *  - `VALIDATION` + `fields[]` → per-field errors above (NO alert);
 *  - `VALIDATION` without usable `fields[]` → inline Alert (`errors.validation`);
 *  - `PLAN_NOT_FOUND` → inline Alert (`errors.planNotFound`);
 *  - `FORBIDDEN` / `UNAUTHORIZED` → NOT handled locally — the global
 *    errorLink posture owns them (mutation FORBIDDEN → global toast,
 *    UNAUTHORIZED → deduped auth recovery); catching-and-toasting here would
 *    double-report;
 *  - masked `INTERNAL_SERVER_ERROR` + anything unmapped → inline Alert with
 *    the plans-namespace `toastActionFailed` copy (the global host adds the
 *    masked toast + correlation id — established surface posture).
 *
 * Double-submit mitigation (REQ-043): the submit button carries BOTH
 * `loading={pending}` (spinner adornment) and `disabled={pending}` (native
 * attribute) while a mutation is in flight, and the handler re-checks.
 *
 * No-change UX (documented decision): in EDIT mode with zero effective
 * changes the submit button is DISABLED (cleaner than closing with a
 * "no changes" toast — the affordance states itself, and the server's
 * `planPatchEmpty` reject stays as defense-in-depth). CREATE is always
 * submittable.
 *
 * Fresh-state contract: the CONTAINER remounts this dialog per opening via a
 * monotonic React `key` (see PlanCatalogContainer) — form/field-error/alert
 * state therefore initializes exactly once from the seed row with no
 * setState-in-effect resets. A dialog mounted with `open` flipped while
 * mounted keeps its input (not the container's flow).
 *
 * MUI v9 discipline: `sx`-only styling through theme tokens, `*Outlined`
 * icons, full-width action buttons on mobile, zero hardcoded strings/colors.
 */

/** The five plan-form field paths the server may reject (`fields[].field`). */
const PLAN_FORM_FIELDS = ["title", "sessionCount", "price", "currency", "intervalDays"] as const;

type PlanFormField = (typeof PLAN_FORM_FIELDS)[number];

/** Whitelist guard — unknown wire paths never reach the form (server input). */
function isPlanFormField(field: string): field is PlanFormField {
  return (PLAN_FORM_FIELDS as readonly string[]).includes(field);
}

interface PlanFormState {
  readonly title: string;
  readonly sessionCount: string;
  readonly price: string;
  readonly currency: string;
  readonly intervalDays: string;
}

type PlanFieldErrors = Readonly<Record<PlanFormField, string | undefined>>;

const EMPTY_FORM: PlanFormState = { title: "", sessionCount: "", price: "", currency: "", intervalDays: "" };

function emptyFieldErrors(): Record<PlanFormField, string | undefined> {
  return { title: undefined, sessionCount: undefined, price: undefined, currency: undefined, intervalDays: undefined };
}

/**
 * Edits prefill from the canonical row — `sessionCount`/`intervalDays` as
 * their string forms, `price` as the server-canonical decimal STRING verbatim
 * (never a float — REQ-060).
 */
function seedFormOf(plan: AdminPlansQuery_adminPlans): PlanFormState {
  return {
    title: plan.title,
    sessionCount: String(plan.sessionCount),
    price: plan.price,
    currency: plan.currency,
    intervalDays: String(plan.intervalDays),
  };
}

/**
 * Wires a numeric input STRING to the GraphQL `Int` type. Integers (incl.
 * negatives — the server judges the sign) pass through; anything else
 * collapses to `0`, which the server's count judge rejects with the
 * field-localized `PLAN_*_INVALID` message.
 */
function toWireInt(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 0;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export interface PlanFormDialogProps {
  /** Mount state — the container owns open/close. */
  readonly open: boolean;
  /** Edit-mode seed row; `null` ⇒ create mode. */
  readonly plan: AdminPlansQuery_adminPlans | null;
  /** Full plans-namespace labels (container's merged tree — property access). */
  readonly labels: PlansLabels;
  /** Dismiss intent (cancel button / backdrop / escape). */
  readonly onClose: () => void;
  /**
   * Success hand-off with the canonical RETURNING row (create or update).
   * The container closes the dialog and raises the localized success toast;
   * the Apollo cache has already converged via the id-normalized payload.
   */
  readonly onSaved: (plan: AdminPlansQuery_adminPlans) => void;
}

export function PlanFormDialog({ open, plan, labels, onClose, onSaved }: Readonly<PlanFormDialogProps>): ReactNode {
  const errorsT = useAppTranslation(Errors);

  const [form, setForm] = useState<PlanFormState>(plan === null ? EMPTY_FORM : seedFormOf(plan));
  const [fieldErrors, setFieldErrors] = useState<PlanFieldErrors>(emptyFieldErrors());
  const [alertCopy, setAlertCopy] = useState<string | null>(null);

  const isEdit = plan !== null;

  // Edit-mode dirtiness (trimmed compare): false ⇒ submit disabled (the
  // documented no-change UX). Create mode is always submittable.
  const dirty = useMemo(() => {
    if (plan === null) return true;
    const seed = seedFormOf(plan);
    return (
      form.title.trim() !== seed.title ||
      form.sessionCount.trim() !== seed.sessionCount ||
      form.price.trim() !== seed.price ||
      form.currency.trim() !== seed.currency ||
      form.intervalDays.trim() !== seed.intervalDays
    );
  }, [form, plan]);

  const [createPlan, { loading: creating }] = useMutation(createPlanMutationDocument, {
    // CREATE list-append: the canonical row is normalized to `Plan:<id>`,
    // but the `adminPlans` list reference must be extended for the new row
    // to appear WITHOUT a refetch (update/status mutations converge purely
    // through normalization onto existing refs). The watched query is the
    // container's exact `adminPlans({ includeInactive: true })` read.
    update(cache, { data }) {
      const created = data?.createPlan;
      if (!created) return;
      cache.updateQuery<AdminPlansQuery, AdminPlansQueryVariables>(
        { query: adminPlansQueryDocument, variables: { includeInactive: true } },
        previous => (previous === null ? previous : { ...previous, adminPlans: [...previous.adminPlans, created] })
      );
    },
  });
  const [updatePlan, { loading: updating }] = useMutation(updatePlanMutationDocument);
  const pending = creating || updating;

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return; // REQ-043 belt (the disabled button is the brace)

    setFieldErrors(emptyFieldErrors());
    setAlertCopy(null);

    const title = form.title.trim();
    const price = form.price.trim();
    const currency = form.currency.trim();

    try {
      if (plan === null) {
        const result = await createPlan({
          variables: {
            input: {
              title,
              sessionCount: toWireInt(form.sessionCount),
              price,
              currency,
              intervalDays: toWireInt(form.intervalDays),
            },
          },
        });
        const created = result.data?.createPlan;
        if (created) onSaved(created);
        return;
      }

      // PARTIAL patch — untouched keys stay `undefined` (JSON-dropped ⇒
      // unsent; never `null` — the avoidOptionals codegen nuance).
      const input: UpdatePlanInput = {
        title: title !== plan.title ? title : undefined,
        sessionCount: form.sessionCount.trim() !== String(plan.sessionCount) ? toWireInt(form.sessionCount) : undefined,
        price: price !== plan.price ? price : undefined,
        currency: currency !== plan.currency ? currency : undefined,
        intervalDays: form.intervalDays.trim() !== String(plan.intervalDays) ? toWireInt(form.intervalDays) : undefined,
      };
      const result = await updatePlan({ variables: { id: plan.id, input } });
      const updated = result.data?.updatePlan;
      if (updated) onSaved(updated);
    } catch (mutationError) {
      mapMutationError(mutationError);
    }
  };

  /** Error-class posture (see module docblock) — sets field errors or the alert. */
  function mapMutationError(error: unknown): void {
    const nextErrors = emptyFieldErrors();
    const applied = applyProjectedFieldErrors(projectMutationFieldErrors(error), isPlanFormField, (field, pair) => {
      nextErrors[field] = pair.message;
    });
    if (applied > 0) {
      setFieldErrors(nextErrors);
      return;
    }
    const code = extractErrorCode(error);
    if (code === "PLAN_NOT_FOUND") {
      setAlertCopy(errorsT.planNotFound);
      return;
    }
    // Global errorLink posture owns these — never caught-and-toasted here.
    if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
      return;
    }
    if (code === "VALIDATION") {
      setAlertCopy(errorsT.validation);
      return;
    }
    setAlertCopy(labels.toastActionFailed);
  }

  const fieldSx = { width: "100%" } as const;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      // Dialog sizes to its content (no fixed-height paper) so the longer
      // Arabic copy never truncates.
      slotProps={{ paper: { sx: theme => ({ borderRadius: 3, boxShadow: theme.palette.shadow.card }) } }}
    >
      <DialogTitle component="h2" sx={{ fontWeight: 700 }}>
        {isEdit ? labels.editDialogTitle : labels.createDialogTitle}
      </DialogTitle>
      <Box component="form" noValidate onSubmit={handleSubmit}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} useFlexGap>
            {alertCopy !== null && (
              <Alert severity="error" variant="outlined" data-testid="plan-form-alert">
                {alertCopy}
              </Alert>
            )}
            {/* Plan name — admin-authored content (NOT a translation key). */}
            <TextField
              label={labels.fieldTitle}
              placeholder={labels.fieldTitlePlaceholder}
              value={form.title}
              onChange={event => setForm(previous => ({ ...previous, title: event.target.value }))}
              error={fieldErrors.title !== undefined}
              helperText={fieldErrors.title}
              fullWidth
              autoFocus
            />
            <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
              <TextField
                label={labels.fieldSessionCount}
                placeholder={labels.fieldSessionCountPlaceholder}
                value={form.sessionCount}
                onChange={event => setForm(previous => ({ ...previous, sessionCount: event.target.value }))}
                error={fieldErrors.sessionCount !== undefined}
                helperText={fieldErrors.sessionCount}
                inputMode="numeric"
                sx={fieldSx}
              />
              {/* Price is a TEXT input (decimal STRING on the wire — REQ-060). */}
              <TextField
                label={labels.fieldPrice}
                placeholder={labels.fieldPricePlaceholder}
                value={form.price}
                onChange={event => setForm(previous => ({ ...previous, price: event.target.value }))}
                error={fieldErrors.price !== undefined}
                helperText={fieldErrors.price}
                inputMode="decimal"
                sx={fieldSx}
              />
              <TextField
                label={labels.fieldCurrency}
                placeholder={labels.fieldCurrencyPlaceholder}
                value={form.currency}
                onChange={event => setForm(previous => ({ ...previous, currency: event.target.value }))}
                error={fieldErrors.currency !== undefined}
                helperText={fieldErrors.currency}
                slotProps={{ htmlInput: { maxLength: 3 } }}
                sx={fieldSx}
              />
              <TextField
                label={labels.fieldIntervalDays}
                placeholder={labels.fieldIntervalDaysPlaceholder}
                value={form.intervalDays}
                onChange={event => setForm(previous => ({ ...previous, intervalDays: event.target.value }))}
                error={fieldErrors.intervalDays !== undefined}
                helperText={fieldErrors.intervalDays}
                inputMode="numeric"
                sx={fieldSx}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexDirection: { xs: "column-reverse", sm: "row" }, gap: 1, px: 3, pb: 3 }}>
          <Button variant="text" onClick={onClose} sx={{ width: { xs: "100%", sm: "auto" } }}>
            {labels.cancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            startIcon={<SaveIcon />}
            loading={pending}
            loadingPosition="start"
            disabled={pending || (isEdit && !dirty)}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            {pending ? labels.submitting : labels.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
