import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

export const studentOnboardingEn: StudentOnboardingLabels = {
  title: "Onboard student",
  sections: {
    profile: "Student profile",
    parent: "Parent (optional)",
    plan: "Plan",
    payment: "Offline payment",
  },
  fields: {
    fullName: "Full name",
    email: "Email",
    phone: "Phone",
    phoneInvalid: "Please enter a valid phone number.",
    password: "Initial password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    generatePassword: "Generate a strong password",
    gender: "Gender",
    country: "Country",
  },
  strength: {
    weak: "Weak",
    fair: "Fair",
    good: "Good",
    strong: "Strong",
  },
  parentSection: {
    none: "No parent — link later",
    loadingParents: "Loading parents…",
    linkedTo: "Linked to",
    searchPlaceholder: "Search parents by name or email",
  },
  planSection: {
    sessions: count => (count === 1 ? "1 session" : `${count} sessions`),
    intervalDays: days => (days === 1 ? "1-day cycle" : `${days}-day cycle`),
    emptyCatalog: "No active plans are available yet. A plan must be active before a student can be onboarded.",
    loadingPlans: "Loading active plans…",
    lane: {
      hifz: "Hifz (Memorization)",
      tajweed: "Tajweed (Recitation)",
      reviews: "Reviews (Assessment)",
    },
  },
  paymentSection: {
    methods: {
      offlineCash: "Offline cash",
      bankTransfer: "Bank transfer",
      scholarship: "Scholarship",
    },
    reference: "Payment reference",
    referenceHelper: "The receipt or transfer number, 1–255 characters — must be unique per subscription.",
    generateReference: "Generate a scholarship reference",
    referenceCleaned: "The reference was cleaned automatically (extra spacing removed).",
  },
  actions: {
    submit: "Onboard student",
    cancel: "Cancel",
    saving: "Saving…",
    submitHint: "Ctrl + Enter to submit",
  },
  draft: {
    restored: "Restored your unsaved draft.",
    clear: "Clear draft",
    progressLabel: "Onboarding details completeness",
    progressValue: percent => `${percent}% complete`,
    savedAt: time => `Saved at ${time}`,
  },
  success: {
    title: "Student onboarded",
    handshakeCode: code => `Handshake code for the parent: ${code}`,
    balanceCredited: count =>
      count === 1
        ? "1 session credited to the student's balance."
        : `${count} sessions credited to the student's balance.`,
    copyCode: "Copy code",
    codeCopied: "Code copied",
    copyDetails: "Copy handoff details",
    detailsCopied: "Details copied",
    copyFailed: "Copy failed — select the text and copy it manually.",
    recentTitle: "Onboarded recently",
    onboardAnother: "Onboard another student",
    onboardAnotherSamePlan: "Another on this plan",
    done: "Done",
  },
  errors: {
    methodRequired: "Choose an offline payment method.",
    methodNotOffline: "The selected payment method is not supported for direct onboarding.",
    referenceInvalid: "Enter a payment reference between 1 and 255 characters.",
    planInactive: "The selected plan is no longer active. Choose a different plan.",
    planLaneUnconfigured:
      "The selected plan cannot credit a session balance because its balance lane is not configured.",
    parentRoleInvalid: "The selected account is not a parent account.",
    parentsRowMissing: "The selected parent account is not set up for linking yet.",
    duplicateReference: "This payment reference is already used by another subscription.",
  },
};
