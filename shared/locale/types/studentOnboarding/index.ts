/**
 * `studentOnboarding` namespace labels — the admin's direct student
 * onboarding dialog: the student profile fields, the optional parent
 * association (role-filtered picker + selected state), the plan picker
 * (active plans only — counted facts + balance-lane vocabulary), the
 * offline payment method + reference field, the dialog actions, the
 * draft-resilience vocabulary (restore notice + completeness meter), the
 * post-submit success state (parent handoff code + credited balance),
 * and the flow's own validation/rejection copy.
 *
 * Used by:
 *  - the onboarding dialog tree (profile → parent → plan → payment) —
 *    every visible string resolves through `useAppTranslation(StudentOnboarding)`;
 *  - the onboarding service — flow-specific rejection copy resolves
 *    through `getServerTranslations(locale).studentOnboardingTranslations.errors.*`
 *    (ONE-argument server lookup) so every denial surfaces pre-localized.
 *
 * Deliberately NOT duplicated here (single-sourced from their owning
 * namespaces, per reuse-first):
 *  - duplicate-email copy — `authTranslations.emailAlreadyExists`;
 *  - unknown user/plan lookup misses — the `errorsTranslations` not-found
 *    family.
 * The `errors` block below carries ONLY the flow's own domain failures.
 *
 * Scope: chrome + flow copy only — plan titles, parent names, and other
 * entity data render verbatim. The interpolated values are the picked
 * plan's counted fragments and the credited-session/handoff-code values
 * from the mutation payload. No credential copy exists in any locale —
 * the initial password is an input label only; its value renders solely
 * inside its own masked field (the admin may reveal it in place through
 * the field's visibility toggle) and never renders in success or summary
 * copy.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves — the primary parity gate is the
 * `Translations` interface where both leaf consts are typed
 * `StudentOnboardingLabels`; the runtime parity suite walks grouped
 * sub-block leaves depth-first so the zero-dead-key discipline stays
 * enforced for nested blocks). Property access only — never call-by-key.
 */
export interface StudentOnboardingLabels {
  /** The dialog's title. */
  readonly title: string;

  /** The four section captions, in dialog order. */
  readonly sections: {
    /** Student profile (identity fields). */
    readonly profile: string;
    /** Optional parent association. */
    readonly parent: string;
    /** Plan selection (active plans only). */
    readonly plan: string;
    /** Offline payment. */
    readonly payment: string;
  };

  /** The student profile field labels. */
  readonly fields: {
    readonly fullName: string;
    readonly email: string;
    readonly phone: string;
    /** The admin-supplied initial password (label only — the value never renders). */
    readonly password: string;
    /** Accessible label of the credential field's reveal toggle. */
    readonly showPassword: string;
    /** Accessible label of the credential field's mask toggle. */
    readonly hidePassword: string;
    /** Accessible label of the credential field's strong-credential quick-generator. */
    readonly generatePassword: string;
    readonly gender: string;
    readonly country: string;
  };

  /**
   * The credential strength readout vocabulary — the quiet segmented row
   * under the initial-credential input. Four levels, no label prefix
   * (the row's only text is the level word itself).
   */
  readonly strength: {
    /** The scored value sits below the length/variety floor. */
    readonly weak: string;
    /** The scored value passes length but not variety. */
    readonly fair: string;
    /** The scored value passes length and most of the variety ladder. */
    readonly good: string;
    /** The scored value tops the ladder (length + full class variety). */
    readonly strong: string;
  };

  /** The optional parent-association section (picker + selected state). */
  readonly parentSection: {
    /** The unset choice — onboard without a linked parent. */
    readonly none: string;
    /** The picker's in-flight label while the parent page loads. */
    readonly loadingParents: string;
    /** Caption rendered beside the picked parent's identity line. */
    readonly linkedTo: string;
    /** The parent-picker search input placeholder. */
    readonly searchPlaceholder: string;
  };

  /**
   * The picked plan's counted facts + the balance-lane vocabulary — the
   * option/summary line joins these fragments (a caption, not a sentence).
   * Two single-count leaves so each locale owns its CLDR counted form.
   */
  readonly planSection: {
    /** The plan's credited session count ("1 session" / "n sessions"). */
    readonly sessions: (count: number) => string;
    /** The plan's renewal cycle length ("1-day cycle" / "n-day cycle"). */
    readonly intervalDays: (days: number) => string;
    /** Shown in place of the option cards when the active catalog is empty. */
    readonly emptyCatalog: string;
    /** The in-flight label announced while the active-catalog read resolves. */
    readonly loadingPlans: string;
    /** The balance-lane value labels (one slot per credit-lane member). */
    readonly lane: {
      readonly hifz: string;
      readonly tajweed: string;
      readonly reviews: string;
    };
  };

  /** The offline-payment section. */
  readonly paymentSection: {
    /** One slot per supported offline payment method. */
    readonly methods: {
      readonly offlineCash: string;
      readonly bankTransfer: string;
      readonly scholarship: string;
    };
    /** The payment-reference input label. */
    readonly reference: string;
    /** Helper line under the reference input (bounded + unique per subscription). */
    readonly referenceHelper: string;
    /** Accessible label of the scholarship reference quick-generator. */
    readonly generateReference: string;
    /** One-shot notice when a pasted reference was auto-cleaned (spacing stripped). */
    readonly referenceCleaned: string;
  };

  /** Dialog action labels (the shell's confirm/dismiss/in-progress slots). */
  readonly actions: {
    readonly submit: string;
    readonly cancel: string;
    readonly saving: string;
    /** The keyboard shortcut hint rendered beside the action row (locale owns the full string). */
    readonly submitHint: string;
  };

  /**
   * The draft-resilience vocabulary — the restore notice, the
   * completeness meter, and the autosave stamp. The credential never
   * rides the persisted draft, so no line here references it.
   */
  readonly draft: {
    /** The notice shown when a stored draft was restored on open. */
    readonly restored: string;
    /** The notice's clear action — wipes the form and the persisted slot. */
    readonly clear: string;
    /** Accessible label of the completeness meter. */
    readonly progressLabel: string;
    /** The meter's percentage caption ("40% complete" — locale owns its form). */
    readonly progressValue: (percent: number) => string;
    /** The meter's autosave caption ("Saved at 09:15" — the formatted stamp). */
    readonly savedAt: (time: string) => string;
  };

  /** The post-submit success content (handoff to the parent). */
  readonly success: {
    readonly title: string;
    /** The parent handoff line carrying the created handshake code. */
    readonly handshakeCode: (code: string) => string;
    /** The credited-balance line (the plan's session count, always ≥ 1). */
    readonly balanceCredited: (count: number) => string;
    /** Accessible label of the copy-code affordance. */
    readonly copyCode: string;
    /** The transient confirmation after the handshake code is copied. */
    readonly codeCopied: string;
    /** Accessible label of the copy-details affordance (one-shot handoff text). */
    readonly copyDetails: string;
    /** The transient confirmation after the handoff details are copied. */
    readonly detailsCopied: string;
    /** The honest failure hint when every clipboard path is denied. */
    readonly copyFailed: string;
    /** The batch-history caption above the previous onboardings list. */
    readonly recentTitle: string;
    /** The restart affordance — clears the dialog for the next onboarding. */
    readonly onboardAnother: string;
    /** The restart affordance pre-binding the plan just purchased (cohort onboarding). */
    readonly onboardAnotherSamePlan: string;
    /** The success screen's dismiss label. */
    readonly done: string;
  };

  /** Flow-specific rejection copy (resolved pre-write or pre-commit). */
  readonly errors: {
    /** No payment method was picked at submit time. */
    readonly methodRequired: string;
    /** The submitted payment method is not one of the supported offline members. */
    readonly methodNotOffline: string;
    /** The payment reference is empty or exceeds 255 characters after trim. */
    readonly referenceInvalid: string;
    /** The picked plan row is inactive. */
    readonly planInactive: string;
    /** The picked plan credits no balance lane (fail-closed). */
    readonly planLaneUnconfigured: string;
    /** The picked parent user exists but does not carry the parent role. */
    readonly parentRoleInvalid: string;
    /** The picked parent user has no parents row (not linkable yet). */
    readonly parentsRowMissing: string;
    /** The payment reference already identifies another subscription. */
    readonly duplicateReference: string;
  };
}
