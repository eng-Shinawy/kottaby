/**
 * usePlanForm — Form state, client-side validation, and submit wiring for the
 * plan create/edit dialog.
 *
 * Extracted from PlanFormDialog (Task 4.4).
 *  - Client & server validation with field-level error messages
 *  - React 19 synthetic form submit handling
 */

"use client";

import { useState } from "react";
import type { AdminPlansQuery, CreatePlanInput } from "@/frontend/graphql/generated/gql/graphql";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanFormState {
  readonly title: string;
  readonly sessionCount: string;
  readonly price: string;
  readonly currency: string;
  readonly intervalDays: string;
}

export type PlanFormErrors = {
  -readonly [K in keyof PlanFormState]?: string;
};

export interface UsePlanFormOptions {
  readonly plan: PlanItem | null;
  readonly serverFieldErrors?: Record<string, string>;
  readonly onSubmit: (input: CreatePlanInput) => Promise<void>;
}

function buildInitialPlanForm(plan: PlanItem | null): PlanFormState {
  if (plan) {
    return {
      title: plan.title,
      sessionCount: String(plan.sessionCount),
      price: plan.price,
      currency: plan.currency,
      intervalDays: String(plan.intervalDays),
    };
  }
  return {
    title: "",
    sessionCount: "10",
    price: "250.00",
    currency: "EGP",
    intervalDays: "30",
  };
}

export function usePlanForm({ plan, serverFieldErrors, onSubmit }: UsePlanFormOptions): {
  readonly form: PlanFormState;
  readonly dialogTitle: string;
  readonly handleChange: (field: keyof PlanFormState) => (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly handleSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly fieldError: (field: keyof PlanFormState) => string | undefined;
} {
  const t = useAppTranslation(Plans);

  const [form, setForm] = useState<PlanFormState>(() => buildInitialPlanForm(plan));

  const [clientErrors, setClientErrors] = useState<PlanFormErrors>({});

  const isEdit = Boolean(plan);
  const dialogTitle = isEdit ? t.editPlanDialogTitle : t.createPlanDialogTitle;

  const handleChange = (field: keyof PlanFormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [field]: event.target.value }));
    if (clientErrors[field]) {
      setClientErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const validate = (): boolean => {
    const errors: PlanFormErrors = {};
    const trimmedTitle = form.title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 100) {
      errors.title = t.validationTitleMessage;
    }

    // Full-value numeric conversion (never `parseInt`): "1.5" and "1abc" must
    // both be rejected instead of silently truncating to 1 (CodeRabbit fix).
    const sessionCountNum = Number(form.sessionCount);
    if (!Number.isInteger(sessionCountNum) || sessionCountNum <= 0) {
      errors.sessionCount = t.validationSessionCountMessage;
    }

    const priceTrimmed = form.price.trim();
    const priceRegex = /^\d+(\.\d{1,2})?$/;
    // Non-negative per the plan contract (price >= 0.00 — "0.00" is a valid
    // free plan); the server CHECK/service layer remains the authority.
    if (!priceRegex.test(priceTrimmed) || Number.parseFloat(priceTrimmed) < 0) {
      errors.price = t.validationPriceMessage;
    }

    const currencyTrimmed = form.currency.trim().toUpperCase();
    if (currencyTrimmed.length !== 3) {
      errors.currency = t.validationCurrencyMessage;
    }

    const intervalDaysNum = Number(form.intervalDays);
    if (!Number.isInteger(intervalDaysNum) || intervalDaysNum <= 0) {
      errors.intervalDays = t.validationIntervalDaysMessage;
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }

    await onSubmit({
      title: form.title.trim(),
      // validate() has already guaranteed whole-number conversions; reuse the
      // exact same conversion instead of a second (truncating) parseInt.
      sessionCount: Number(form.sessionCount),
      price: form.price.trim(),
      currency: form.currency.trim().toUpperCase(),
      intervalDays: Number(form.intervalDays),
    });
  };

  const fieldError = (field: keyof PlanFormState): string | undefined => {
    return clientErrors[field] ?? serverFieldErrors?.[field];
  };

  return { form, dialogTitle, handleChange, handleSubmit, fieldError };
}
