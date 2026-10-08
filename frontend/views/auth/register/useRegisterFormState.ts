"use client";

import { useQuery } from "@apollo/client/react";
import { useController, useForm, useWatch } from "react-hook-form";
import type { Gender, RecitationReading, RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import { recitationReadingsQueryDocument } from "@/frontend/graphql/sharedDocuments/auth/recitation.documents";
import { genderFromSelectValue, type RegisterFormValues, roleFromSelectValue } from "@/frontend/views/auth/register";
import { countryCodeSchema } from "@/shared/lib/country-code";
import type { AuthLabels } from "@/shared/locale/types/auth";

const REGISTER_FORM_DEFAULTS: RegisterFormValues = {
  fullName: "",
  email: "",
  phone: "",
  password: "",
  country: "",
  gender: null,
  role: "",
  preferredRecitation: null,
};

/**
 * Owns the RegisterForm's React Hook Form state: the `useForm` instance
 * (its `control` returned for controller-bound fields like the shared
 * `PhoneFormField`), compiler-safe watched values, the select-field
 * controllers whose
 * `.value` degrades to `string` under tsgo — each select pins its value back
 * through the pure *FromSelectValue tables instead of trusting the raw field
 * value — and the country picker controller, gated inline by the shared
 * country-code schema (no zod resolver: the raw value is validated with
 * `countryCodeSchema.safeParse`, splitting the empty vs non-member copies
 * the same way the registration service does). Also fetches the
 * recitation-reading catalog for the selector.
 */
export function useRegisterFormState(t: AuthLabels) {
  // Fetch the canonical recitation-reading catalog (public query,
  // no auth required). Used to populate the selector dropdown.
  const { data: recitationData, loading: recitationLoading } = useQuery(recitationReadingsQueryDocument);
  const recitationOptions = recitationData?.recitationReadings ?? [];

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<RegisterFormValues>({ defaultValues: REGISTER_FORM_DEFAULTS });

  // Compiler-safe value tracking (IMPLEMENTATION_LEARNINGS §7: useWatch, not watch()).
  const passwordValue = useWatch({ control, name: "password", defaultValue: "" });
  const roleValue = useWatch({ control, name: "role", defaultValue: "" });

  // Select-field controllers. Their `.value` degrades to `string` under tsgo,
  // so each select pins its value back through the pure *FromSelectValue
  // tables above instead of trusting the raw field value.
  const genderField = useController<RegisterFormValues, "gender">({
    control,
    name: "gender",
    defaultValue: null,
  });
  const roleField = useController<RegisterFormValues, "role">({
    control,
    name: "role",
    rules: { required: t.roleRequired },
    defaultValue: "",
  });
  const preferredRecitationField = useController<RegisterFormValues, "preferredRecitation">({
    control,
    name: "preferredRecitation",
    defaultValue: null,
  });
  // Country picker controller. The selector emits the picked ISO code (or
  // "" when cleared); inline validation runs the shared country-code schema
  // on the raw value — empty stays on the required copy, a present value
  // that is not a dataset member falls to the invalid copy. No zod resolver
  // dependency is introduced for this.
  const countryField = useController<RegisterFormValues, "country">({
    control,
    name: "country",
    rules: {
      required: t.countryCodeRequired,
      validate: rawCountry => {
        const value = typeof rawCountry === "string" ? rawCountry : "";
        if (value.trim().length === 0) return t.countryCodeRequired;
        return countryCodeSchema.safeParse(value).success ? true : t.countryCodeInvalid;
      },
    },
    defaultValue: "",
  });

  // Pin the checker-degraded string values back to their GraphQL unions via
  // the pure *FromSelectValue tables (assertion-free both directions).
  const selectedGender: Gender | "" =
    typeof genderField.field.value === "string" ? (genderFromSelectValue(genderField.field.value) ?? "") : "";
  const selectedRole: RegisterPublicRole | "" =
    typeof roleField.field.value === "string" ? roleFromSelectValue(roleField.field.value) : "";
  // Catalog values come straight from the typed GraphQL query result — the
  // same Record-lookup trick keyed by their own wire strings keeps the
  // degraded comparison enum-safe without any assertion.
  const recitationByValue: Record<string, RecitationReading> = {};
  for (const reading of recitationOptions) {
    recitationByValue[reading] = reading;
  }
  const selectedRecitation: RecitationReading | "" =
    typeof preferredRecitationField.field.value === "string"
      ? (recitationByValue[preferredRecitationField.field.value] ?? "")
      : "";

  return {
    control,
    errors,
    isSubmitting,
    handleSubmit,
    register,
    setError,
    passwordValue,
    roleValue,
    genderField,
    roleField,
    preferredRecitationField,
    countryField,
    selectedGender,
    selectedRole,
    selectedRecitation,
    recitationOptions,
    recitationLoading,
  };
}
