"use client";

import { useNotifications } from "@toolpad/core/useNotifications";
import { type RefObject, useCallback, useEffect } from "react";
import { Common, useAppTranslation } from "@/shared/locale";

// Configuration
const CONNECTIVITY_CHECK_URL = "/api/graphql";
const CONNECTIVITY_CHECK_TIMEOUT = 5000;
export const MIN_CHECK_INTERVAL = 2000;

export const getReconnectionDelay = (attempt: number): number | null => {
  if (attempt === 0) return 2000;
  if (attempt === 1) return 5000;
  const delay = 5000 + (attempt - 1) * 5000;
  if (delay > 30000) return null;
  return delay;
};

export const fetchConnectivityStatus = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_CHECK_TIMEOUT);

  const response = await fetch(CONNECTIVITY_CHECK_URL, {
    method: "HEAD",
    credentials: "include",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "apollo-require-preflight": "true",
    },
    signal: controller.signal,
  }).catch(() => ({ ok: false, status: 0 }));

  clearTimeout(timeoutId);
  return (response as { ok: boolean }).ok;
};

export const useDisconnectNotifier = (
  isConnectedRef: RefObject<boolean>,
  reconnectAttemptRef: RefObject<number>,
  checkConnectivity: () => Promise<boolean>
) => {
  const notifications = useNotifications();
  const t = useAppTranslation(Common);

  return useCallback(() => {
    if (!isConnectedRef.current) {
      notifications.show(`${t.serverConnectionLost}. ${t.checkNetworkConnection}.`, {
        severity: "error",
        autoHideDuration: 5000,
        actionText: t.retry,
        onAction: () => {
          reconnectAttemptRef.current = 0;
          void checkConnectivity().then(connected => {
            if (connected) {
              notifications.show(t.connectionRestored, {
                severity: "success",
                autoHideDuration: 3000,
              });
            }
            return undefined;
          });
        },
      });
    }
  }, [notifications, checkConnectivity, t, isConnectedRef, reconnectAttemptRef]);
};

export const useInitialConnectivityCheck = (checkConnectivity: () => Promise<boolean>) => {
  // Initial check
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void checkConnectivity();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [checkConnectivity]);
};

export const useAutoReconnect = (
  isConnected: boolean,
  initialCheckDone: boolean,
  checkConnectivity: () => Promise<boolean>,
  reconnectTimeoutRef: RefObject<NodeJS.Timeout | null>,
  reconnectAttemptRef: RefObject<number>
) => {
  // Automatic reconnection
  useEffect(() => {
    if (isConnected || !initialCheckDone) {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    } else {
      const attemptReconnect = async (): Promise<void> => {
        const connected = await checkConnectivity();
        if (connected) {
          reconnectAttemptRef.current = 0;
          return undefined;
        }
        reconnectAttemptRef.current += 1;
        scheduleReconnect();
      };

      const scheduleReconnect = () => {
        const delay = getReconnectionDelay(reconnectAttemptRef.current);
        if (delay === null) return;
        reconnectTimeoutRef.current = setTimeout(() => void attemptReconnect(), delay);
      };

      scheduleReconnect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [isConnected, initialCheckDone, checkConnectivity, reconnectTimeoutRef, reconnectAttemptRef]);
};

export const useOnlineOfflineListeners = (
  checkConnectivity: () => Promise<boolean>,
  setConnected: (connected: boolean) => void,
  notifyIfDisconnected: () => void
) => {
  // Online/offline listeners
  useEffect(() => {
    let onlineTimeout: NodeJS.Timeout;
    const handleOnline = () => {
      clearTimeout(onlineTimeout);
      onlineTimeout = setTimeout(() => void checkConnectivity(), 500);
    };
    const handleOffline = () => {
      clearTimeout(onlineTimeout);
      setConnected(false);
      notifyIfDisconnected();
    };

    globalThis.addEventListener("online", handleOnline);
    globalThis.addEventListener("offline", handleOffline);
    return () => {
      globalThis.removeEventListener("online", handleOnline);
      globalThis.removeEventListener("offline", handleOffline);
      clearTimeout(onlineTimeout);
    };
  }, [checkConnectivity, notifyIfDisconnected, setConnected]);
};
