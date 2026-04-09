"use client";

import { useEffect, useMemo, useState } from "react";

const DISMISS_KEY = "otc-checker:pwa-install-dismissed-at";
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function readDismissedAt() {
  if (typeof window === "undefined") {
    return 0;
  }

  const rawValue = window.localStorage.getItem(DISMISS_KEY);
  const parsedValue = Number(rawValue ?? "0");

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

export function usePwaInstallState() {
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(() => readDismissedAt());
  const [checkedAt, setCheckedAt] = useState(() => (typeof window === "undefined" ? 0 : Date.now()));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const syncInstalled = () => {
      const iosStandalone = Boolean(
        (window.navigator as Navigator & { standalone?: boolean }).standalone,
      );
      setIsInstalled(mediaQuery.matches || iosStandalone);
    };

    syncInstalled();
    mediaQuery.addEventListener("change", syncInstalled);

    return () => mediaQuery.removeEventListener("change", syncInstalled);
  }, []);

  const isDismissed = useMemo(() => {
    if (!dismissedAt || !checkedAt) {
      return false;
    }

    return checkedAt - dismissedAt < DISMISS_WINDOW_MS;
  }, [checkedAt, dismissedAt]);

  return {
    isInstalled,
    isDismissed,
    showInstallPrompt: !isInstalled && !isDismissed,
    dismissInstallPrompt() {
      if (typeof window === "undefined") {
        return;
      }

      const nextDismissedAt = Date.now();
      window.localStorage.setItem(DISMISS_KEY, String(nextDismissedAt));
      setDismissedAt(nextDismissedAt);
      setCheckedAt(nextDismissedAt);
    },
  };
}
