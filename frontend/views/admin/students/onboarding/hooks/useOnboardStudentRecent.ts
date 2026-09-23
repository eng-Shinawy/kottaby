"use client";

/**
 * useOnboardStudentRecent — the back-to-back onboarding memory seam: a
 * versioned localStorage slot keeps the LAST few onboarded students
 * (identity + parent handoff code + credited sessions) so an admin
 * running a batch can re-copy any recent handoff code without leaving
 * the dialog — the success screen lists them under the live one.
 *
 * Trust model — identical to the draft slot (`useOnboardStudentDraft`):
 * storage is origin-readable, so the initial credential is structurally
 * absent (it never enters the payload this hook sees), and every stored
 * entry re-validates on read through narrowing helpers (zero type
 * assertions); malformed entries drop, a malformed slot clears.
 */

import { useCallback, useState } from "react";
import type { AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment } from "@/frontend/graphql/generated/gql/graphql";

/** The slot's storage key — versioned so future shapes migrate cleanly. */
const RECENT_STORAGE_KEY = "admin.onboarding.recent.v1";

/** The persisted shape version this hook reads and writes. */
const RECENT_VERSION = 1;

/** The history cap — old entries fall off the front (newest-first slot). */
const RECENT_CAP = 5;

/** One remembered onboarding, as the success screen renders it. */
export interface RecentOnboardingEntry {
  readonly fullName: string;
  readonly email: string;
  readonly handshakeCode: string;
  readonly creditedSessions: number;
  /** ISO timestamp of the onboarding (display/telemetry only). */
  readonly savedAt: string;
}

/** The persisted slot: a version stamp and the newest-first entry list. */
interface StoredRecentOnboardings {
  readonly version: number;
  readonly entries: readonly RecentOnboardingEntry[];
}

/** Reads `key` off a parsed JSON object without casting the container. */
const readJsonProperty = (source: object, key: string): unknown =>
  key in source ? Reflect.get(source, key) : undefined;

/** Narrows one stored entry of unknown shape, or `null` on any mismatch. */
const readStoredEntry = (value: unknown): RecentOnboardingEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const fullName = readJsonProperty(value, "fullName");
  const email = readJsonProperty(value, "email");
  const handshakeCode = readJsonProperty(value, "handshakeCode");
  const creditedSessions = readJsonProperty(value, "creditedSessions");
  const savedAt = readJsonProperty(value, "savedAt");
  if (typeof fullName !== "string" || typeof email !== "string") return null;
  if (typeof handshakeCode !== "string" || handshakeCode.length === 0) return null;
  if (typeof creditedSessions !== "number" || !Number.isSafeInteger(creditedSessions)) return null;
  if (typeof savedAt !== "string") return null;
  return { fullName, email, handshakeCode, creditedSessions, savedAt };
};

/** Narrows the parsed slot into the valid newest-first entry list. */
const readStoredEntries = (parsed: unknown): readonly RecentOnboardingEntry[] => {
  if (typeof parsed !== "object" || parsed === null) return [];
  if (readJsonProperty(parsed, "version") !== RECENT_VERSION) return [];
  const rawEntries = readJsonProperty(parsed, "entries");
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries.flatMap(entry => {
    const narrowed = readStoredEntry(entry);
    return narrowed ? [narrowed] : [];
  });
};

/** Reads the slot, dropping it silently when malformed or unreachable. */
const readRecentOnboardings = (): readonly RecentOnboardingEntry[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    return readStoredEntries(JSON.parse(raw));
  } catch {
    try {
      window.localStorage.removeItem(RECENT_STORAGE_KEY);
    } catch {
      // A stale slot is survivable in every failure mode.
    }
    return [];
  }
};

/** Projects the mutation payload onto the persisted (credential-free) entry. */
const buildEntry = (
  result: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment
): RecentOnboardingEntry => ({
  fullName: result.student.fullName,
  email: result.student.email,
  handshakeCode: result.handshakeCode,
  creditedSessions: result.creditedSessions,
  savedAt: new Date().toISOString(),
});

/** The success-screen-facing controller (state + the record seam). */
export interface OnboardStudentRecentController {
  /** The remembered onboardings, newest first (already capped). */
  readonly recent: readonly RecentOnboardingEntry[];
  /**
   * Event-seam recorder — call once per successful onboarding (beside the
   * caller's own success state write); dedupes by handoff code, caps the
   * list, and persists.
   */
  readonly recordOnboarding: (
    result: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment
  ) => void;
}

export function useOnboardStudentRecent(): OnboardStudentRecentController {
  // The slot loads ONCE per mount — the directory container mounts this
  // hook beside the dialog, and every record seam refreshes the state.
  const [recent, setRecent] = useState<readonly RecentOnboardingEntry[]>(() => readRecentOnboardings());

  const recordOnboarding = useCallback(
    (result: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment) => {
      setRecent(previous => {
        const entry = buildEntry(result);
        const withoutDuplicate = previous.filter(item => item.handshakeCode !== entry.handshakeCode);
        const next = [entry, ...withoutDuplicate].slice(0, RECENT_CAP);
        try {
          const slot: StoredRecentOnboardings = { version: RECENT_VERSION, entries: next };
          window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(slot));
        } catch {
          // Quota/privacy failures degrade to in-memory-only persistence.
        }
        return next;
      });
    },
    []
  );

  return { recent, recordOnboarding };
}
