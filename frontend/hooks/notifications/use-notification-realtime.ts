"use client";

import { useApolloClient } from "@apollo/client/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_CONCURRENT_TOASTS, startNotificationRealtimeSession } from "@/frontend/hooks/notifications";
import { Notifications, useAppTranslation } from "@/shared/locale";

/**
 * `useNotificationRealtime` — the realtime notification client hook
 * (REQ-063d): owns ONE WebSocket per mounted authenticated shell, merges
 * incoming pushes into the Apollo cache, and surfaces a localized toast per
 * fresh arrival.
 *
 * Lifecycle contract (REQ-025 / the 2.8 sidecar close-code vocabulary):
 *  - Handshake rides the httpOnly `access_token` cookie automatically (the
 *    browser attaches it because the sidecar URL shares the app origin's
 *    host) — NO token is ever read, stored, or sent by JavaScript.
 *  - Reconnect backoff: 1s → 2s → 4s … capped at 30s, ±20% jitter.
 *  - Close `4401` (unauthenticated) / `4009` (superseded by a newer tab)
 *    ABORT retrying — the auth-recovery surface owns re-authentication,
 *    and the newest tab owns the socket.
 *  - Every other close (4429 throttled, 1013 overloaded, 1001 shutdown,
 *    abnormal) backs off and reconnects; a RE-connect fires the catch-up
 *    refetch (`myNotifications` page 1 + `myUnreadNotificationCount`) so a
 *    dropped push can never become persistent divergence.
 *  - Unmount closes the socket deterministically with `1000` and removes
 *    every registered listener — remounts never duplicate sockets,
 *    listeners, or toasts (REQ-067).
 *
 * Degradation (REQ-064): a sidecar that is down, rejecting handshakes, or
 * unreachable is SILENT — no toasts, no banners; the existing polling
 * posture remains the floor. At most one client-side `logger.warn` per
 * disconnected episode (plus one for abort closes).
 *
 * State: local React refs/state ONLY (no stores, no persist — the socket
 * handle is non-serializable). Connection state never escapes the hook;
 * only the transient toast queue does (the toast surface is shell-mounted
 * UI, not connection state).
 *
 * The pure helpers (backoff curve, frame guard, type maps) live in
 * `use-notification-realtime.helpers.ts`, the Apollo cache merge in
 * `use-notification-realtime.cache.ts`, and the socket session itself in
 * `use-notification-realtime.socket.ts`.
 */

/** One visible realtime toast (pre-localized message + monotonic id). */
export interface RealtimeNotificationToast {
  readonly id: number;
  readonly message: string;
}

/** The hook's public surface — the transient toast queue and its dismiss. */
export interface UseNotificationRealtimeResult {
  readonly toasts: readonly RealtimeNotificationToast[];
  readonly dismissToast: (toastId: number) => void;
}

/**
 * Opens the notification realtime socket for the enclosing authenticated
 * shell. Mount ONCE per shell (the dashboard layout) — never per page — so
 * at most ONE socket exists per tab (REQ-067).
 */
export function useNotificationRealtime(): UseNotificationRealtimeResult {
  const client = useApolloClient();
  const t = useAppTranslation(Notifications);

  const [toasts, setToasts] = useState<readonly RealtimeNotificationToast[]>([]);
  const nextToastIdRef = useRef(0);

  // Latest-translation seam: the socket session is mount-scoped, while the
  // locale can change mid-connection — the message handler reads the labels
  // through this ref (updated in an effect, never during render).
  const labelsRef = useRef(t);
  useEffect(() => {
    labelsRef.current = t;
  }, [t]);

  const enqueueToast = useCallback((message: string) => {
    // Monotonic id computed OUTSIDE the state updater (StrictMode can invoke
    // an updater twice — the updater itself stays pure).
    const toastId = ++nextToastIdRef.current;
    setToasts(prev => {
      const appended = [...prev, { id: toastId, message }];
      // Drop the OLDEST entries first — newest arrivals stay visible.
      return appended.slice(Math.max(0, appended.length - MAX_CONCURRENT_TOASTS));
    });
  }, []);

  const dismissToast = useCallback((toastId: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== toastId));
  }, []);

  const readLabels = useCallback(() => labelsRef.current, []);

  useEffect(
    () => startNotificationRealtimeSession({ client, readLabels, enqueueToast }),
    [client, readLabels, enqueueToast]
  );

  return { toasts, dismissToast };
}
