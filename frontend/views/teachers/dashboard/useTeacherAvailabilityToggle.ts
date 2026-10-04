"use client";

import { useMutation } from "@apollo/client/react";
import { useCallback, useState } from "react";
import type { MyTeacherAvailabilityQuery_myTeacherAvailability } from "@/frontend/graphql/generated/gql/graphql";
import { setTeacherAvailabilityMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import type { AvailabilityLabels } from "@/shared/locale/types/availability";

/**
 * useTeacherAvailabilityToggle — the availability toggle write path,
 * extracted so `TeacherAvailabilityCard.tsx` stays under the views-tree
 * 150-line file cap (mirrors the `useVerificationPurchase.ts` precedent).
 *
 * Owns the toggle mutation + the outcome lanes:
 *
 * - success → success notice (`updateSuccess`) + background `refetch` so
 *   the card re-reads the post-toggle snapshot (Apollo cache
 *   normalization already overwrote the read entry from the mutation
 *   result — the refetch is the belt-and-braces re-read).
 * - mutation error with code `TEACHER_IN_ACTIVE_SESSION` → inline
 *   `inSessionLockedHint` (the global toast fires automatically via the
 *   error-link map row that maps the code to `errors.teacherInActiveSession`).
 * - any other mutation error → inline `updateGenericError` (the global
 *   toast fires automatically for mapped codes via the error-link map).
 *
 * Raw server `message` values are NEVER surfaced — copy resolves through
 * the compile-time `availability` namespace handles via property access
 * only.
 *
 * Apollo hooks come from `@apollo/client/react` (stateful `useMutation`,
 * never `useMutation`'s `useLazyQuery`-style lazy variant);
 * `useLazyQuery` itself is banned repo-wide.
 */

/** TEACHER_IN_ACTIVE_SESSION mutation rejection code surfaced by the in-session gate. */
const IN_SESSION_REJECTION_CODE = "TEACHER_IN_ACTIVE_SESSION";

/** Snackbar auto-hide cadence shared by the toggle notice lanes. */
export const AVAILABILITY_NOTICE_AUTOHIDE_MS = 5000;

/** Transient notice record rendered through the shared snackbar slot. */
type AvailabilityNotice = {
  readonly message: string;
  readonly severity: "success" | "info" | "error";
};

/** Inline notice record rendered above the toggle affordance. */
type InlineNotice = {
  readonly kind: "generic" | "inSession";
  readonly message: string;
};

/** Wiring the toggle write path needs from the card entry point. */
export interface TeacherAvailabilityToggleWiring {
  /** Refetches the `myTeacherAvailability` query after success / cooldown. */
  readonly refetch: () => Promise<unknown>;
  /** The localized `availability` namespace labels (property access only). */
  readonly labels: AvailabilityLabels;
  /** The current availability snapshot (drives the target toggle direction). */
  readonly current: MyTeacherAvailabilityQuery_myTeacherAvailability;
}

/** The card-facing toggle state + the toggle intent. */
export interface TeacherAvailabilityToggle {
  /** Flips the teacher's online state (no-arg — derives from the current snapshot). */
  readonly toggle: () => Promise<void>;
  /** `true` while the mutation is in flight. */
  readonly toggling: boolean;
  /** The transient snackbar notice (null = idle). */
  readonly notice: AvailabilityNotice | null;
  /** The persistent inline notice (null = no inline error). */
  readonly inline: InlineNotice | null;
  /** Clears the transient snackbar notice. */
  readonly dismissNotice: () => void;
}

/** The toggle write path — see the module docblock. */
export function useTeacherAvailabilityToggle(wiring: TeacherAvailabilityToggleWiring): TeacherAvailabilityToggle {
  const { refetch, labels, current } = wiring;
  const [setTeacherAvailability, { loading: toggling }] = useMutation(setTeacherAvailabilityMutationDocument);
  const [notice, setNotice] = useState<AvailabilityNotice | null>(null);
  const [inline, setInline] = useState<InlineNotice | null>(null);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const mutate = useCallback(
    async (targetOnline: boolean): Promise<void> => {
      // Clear stale notices before the mutation settles so the user sees a
      // clean surface while the in-flight request is pending.
      setInline(null);
      setNotice(null);
      try {
        const result = await setTeacherAvailability({ variables: { isOnline: targetOnline } });
        const payload = result.data?.setTeacherAvailability;
        if (!payload) {
          // Transport-masked settle without data — the same generic lane as
          // the catch arm below (DomainError denials throw and never reach
          // here).
          setInline({ kind: "generic", message: labels.updateGenericError });
          return;
        }
        // Success — Apollo cache normalization already overwrote the read
        // entry from the mutation result (the row carries `id`). The
        // background refetch re-reads the post-toggle snapshot so any
        // cache-eviction edge (a concurrent mutation elsewhere) is
        // reconciled.
        await refetch().catch(() => undefined);
        setInline(null);
        setNotice({ message: labels.updateSuccess, severity: "success" });
      } catch (mutationError: unknown) {
        const code = extractErrorCode(mutationError);
        if (code === IN_SESSION_REJECTION_CODE) {
          // The INV-A2 in-session gate denied the toggle. The inline hint is
          // the persistent visual cue; the global toast surfaces
          // `errors.teacherInActiveSession` automatically via the error-link
          // map row.
          setInline({ kind: "inSession", message: labels.inSessionLockedHint });
          return;
        }
        // Every other code (FORBIDDEN for INV-A1, TEACHER_NOT_FOUND,
        // VALIDATION, transport without a code, …) lands on the generic
        // lane. The mapped codes ALSO fire the global toast via the
        // error-link map; the inline notice is the persistent visual cue.
        setInline({ kind: "generic", message: labels.updateGenericError });
      }
    },
    [setTeacherAvailability, refetch, labels]
  );

  // No-arg toggle — derives the target boolean from the current snapshot so
  // the closure stays memoizable; the card calls `toggle()` directly.
  const toggle = useCallback(async (): Promise<void> => {
    await mutate(!current.isOnline);
  }, [mutate, current]);

  return { toggle, toggling, notice, inline, dismissNotice };
}
