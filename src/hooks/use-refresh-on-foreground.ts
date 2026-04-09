"use client";

import { useEffect, useRef } from "react";

export function useRefreshOnForeground(refresh: () => void) {
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    function triggerRefresh() {
      const now = Date.now();

      if (now - lastRefreshAtRef.current < 300) {
        return;
      }

      lastRefreshAtRef.current = now;
      refresh();
    }

    function handleFocus() {
      triggerRefresh();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        triggerRefresh();
      }
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);
}
