"use client";

/**
 * useOnboardStudentDraft — the onboarding dialog's close/reload
 * resilience seam: the controlled draft mirrors (debounce-free, one write
 * per edit) into a versioned localStorage slot so an accidental close or
 * a full page reload never costs the admin their typing; the next open
 * restores it and surfaces the restore notice.
 *
 * The initial credential is deliberately NEVER persisted — the slot is
 * readable by anything sharing the origin, so it must never hold a
 * login. The restored form always rehydrates with an empty password.
 *
 * Every stored field re-validates on read (storage is untrusted input):
 * unexpected shapes fall back to their empties, a touched-but-partial
 * draft restores partially, and a malformed slot is dropped rather than
 * crashing the dialog.
 *
 * `lastSavedAt` is the mirror's display stamp (epoch millis): it advances
 * with every edit and on restore, and clears with the draft — the meter
 * row renders it as the quiet "saved at HH:MM" autosave caption.
 */

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_ONBOARD_STUDENT_FORM,
  type OnboardStudentFormState,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";

/** The slot's storage key — versioned so future shapes migrate cleanly. */
const DRAFT_STORAGE_KEY = "admin.onboarding.draft.v1";

/** The persisted shape version this hook reads and writes. */
const DRAFT_VERSION = 1;

/** Every draft field, in one place — the touched check walks exactly these. */
const DRAFT_FIELD_KEYS: readonly (keyof OnboardStudentFormState)[] = [
  "fullName",
  "email",
  "phone",
  "password",
  "gender",
  "country",
  "parentId",
  "planId",
  "paymentMethod",
  "paymentReference",
];

/** The persisted slot: a version stamp, an ISO timestamp, and the form minus the credential. */
interface StoredOnboardingDraft {
  readonly version: number;
  readonly savedAt: string;
  readonly form: Omit<OnboardStudentFormState, "password">;
}

/** Strips the credential before any write — the storage never sees it. */
const stripCredential = (form: OnboardStudentFormState): Omit<OnboardStudentFormState, "password"> => ({
  fullName: form.fullName,
  email: form.email,
  phone: form.phone,
  gender: form.gender,
  country: form.country,
  parentId: form.parentId,
  planId: form.planId,
  paymentMethod: form.paymentMethod,
  paymentReference: form.paymentReference,
});

/** Reads `key` off a parsed JSON object without casting the container. */
const readJsonProperty = (source: object, key: string): unknown =>
  key in source ? Reflect.get(source, key) : undefined;

/** Coerces one stored slot entry of unknown shape back into its string. */
const readStoredString = (value: unknown): string => (typeof value === "string" ? value : "");

/** The safe-integer parent id (anything else reads back "no parent"). */
const readStoredParentId = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

/** Literal-equality narrowing — an unknown token reads back unset. */
const readStoredGender = (value: unknown): OnboardStudentFormState["gender"] => {
  if (value === "Male" || value === "Female" || value === "Other") return value;
  return "";
};

/**
 * Rehydrates a stored slot's form, field by field. The credential NEVER
 * round-trips (see header) — always rehydrates empty.
 */
const rehydrateDraft = (form: object): OnboardStudentFormState => ({
  fullName: readStoredString(readJsonProperty(form, "fullName")),
  email: readStoredString(readJsonProperty(form, "email")),
  phone: readStoredString(readJsonProperty(form, "phone")),
  password: "",
  gender: readStoredGender(readJsonProperty(form, "gender")),
  country: readStoredString(readJsonProperty(form, "country")),
  parentId: readStoredParentId(readJsonProperty(form, "parentId")),
  planId: readStoredString(readJsonProperty(form, "planId")),
  paymentMethod: readStoredString(readJsonProperty(form, "paymentMethod")),
  paymentReference: readStoredString(readJsonProperty(form, "paymentReference")),
});

/** `true` when at least one field sits off its empty — worth restoring. */
const isTouchedDraft = (draft: OnboardStudentFormState): boolean =>
  DRAFT_FIELD_KEYS.some(key => draft[key] !== EMPTY_ONBOARD_STUDENT_FORM[key]);

/** The parsed slot: the rehydrated form + the persisted stamp as epoch millis (NaN-narrowed). */
interface ParsedOnboardingDraft {
  readonly form: OnboardStudentFormState;
  /** The slot's own `savedAt` as epoch millis — the honest "last saved" for a restore. */
  readonly savedAtEpoch: number;
}

/** Narrows the slot's ISO timestamp into epoch millis (`null` when malformed). */
const parseStoredStamp = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
};

/** Best-effort slot removal (nothing depends on it succeeding). */
const dropStoredDraft = (): void => {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Ignore — a stale slot is survivable in every failure mode.
  }
};

/**
 * Reads the stored draft, or `null` when the slot is absent, malformed,
 * or holds an untouched draft (all fields at their empties). A malformed
 * slot is dropped so the next close starts from a clean slate. The
 * returned stamp is the slot's own persist time — reading storage here
 * (a pure parse of stored data) keeps the render-phase restore free of
 * any impure call.
 */
const readStoredDraft = (): ParsedOnboardingDraft | null => {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (readJsonProperty(parsed, "version") !== DRAFT_VERSION) return null;
    const savedAtEpoch = parseStoredStamp(readJsonProperty(parsed, "savedAt"));
    const storedForm = readJsonProperty(parsed, "form");
    if (savedAtEpoch === null || typeof storedForm !== "object" || storedForm === null) return null;
    const form = rehydrateDraft(storedForm);
    if (!isTouchedDraft(form)) return null;
    return { form, savedAtEpoch };
  } catch {
    dropStoredDraft();
    return null;
  }
};

/** The dialog-facing draft controller (state + persistence seams). */
export interface OnboardStudentDraftController {
  readonly form: OnboardStudentFormState;
  /** `true` while the restore notice is visible (a stored draft was restored). */
  readonly draftRestored: boolean;
  /** Epoch millis of the last mirror persist — `null` before the first edit. */
  readonly lastSavedAt: number | null;
  /** The controlled-setter seam — forwards to the form state (persistence rides the mirror effect). */
  readonly updateForm: (update: React.SetStateAction<OnboardStudentFormState>) => void;
  /** Wipes the form, the restore notice, and the persisted slot. */
  readonly clearDraft: () => void;
  /** Hides the restore notice while keeping the draft (typed and persisted). */
  readonly dismissDraftNotice: () => void;
}

export function useOnboardStudentDraft(open: boolean): OnboardStudentDraftController {
  const [form, setForm] = useState<OnboardStudentFormState>(EMPTY_ONBOARD_STUDENT_FORM);
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // Render-phase one-shot restore guard: the FIRST open hydrates from the
  // slot (the React-documented render-phase state adjustment — no effect
  // cascades); later opens follow the dialog's clean-slate seams.
  const [restoredOpen, setRestoredOpen] = useState(false);
  if (open && !restoredOpen) {
    setRestoredOpen(true);
    const stored = readStoredDraft();
    if (stored) {
      setForm(stored.form);
      setDraftRestored(true);
      // The restored stamp is the SLOT's persist time — pure stored data,
      // never a render-time clock read (the render-phase adjustment stays).
      setLastSavedAt(stored.savedAtEpoch);
    }
  }

  // The mirror: every committed form state (post-restore included) lands
  // in the slot with the credential stripped. Writing the emptied form is
  // intentional — it overwrites a stale slot with a nothing-to-restore
  // payload so a stale draft cannot resurrect after a deliberate reset.
  useEffect(() => {
    if (!open || !restoredOpen) return;
    try {
      const slot: StoredOnboardingDraft = {
        version: DRAFT_VERSION,
        savedAt: new Date().toISOString(),
        form: stripCredential(form),
      };
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(slot));
    } catch {
      // Quota/privacy failures degrade to in-memory-only persistence.
    }
  }, [form, open, restoredOpen]);

  const updateForm = useCallback((update: React.SetStateAction<OnboardStudentFormState>) => {
    setForm(update);
    setLastSavedAt(Date.now());
  }, []);

  const clearDraft = useCallback(() => {
    setForm(EMPTY_ONBOARD_STUDENT_FORM);
    setDraftRestored(false);
    setLastSavedAt(null);
    dropStoredDraft();
  }, []);

  const dismissDraftNotice = useCallback(() => setDraftRestored(false), []);

  return { form, draftRestored, lastSavedAt, updateForm, clearDraft, dismissDraftNotice };
}
