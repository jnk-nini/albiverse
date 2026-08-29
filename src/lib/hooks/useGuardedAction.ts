"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Wraps an interaction handler so it can't be re-fired while still in flight,
 * and enforces a short cooldown after it finishes. Use on any button that hits
 * Supabase or the network (submit/upload/delete/etc.) to stop double-clicks and
 * rapid-fire taps from spamming requests.
 */
export function useGuardedAction<Args extends unknown[]>(
  action: (...args: Args) => void | Promise<void>,
  cooldownMs = 500
) {
  const [isBusy, setIsBusy] = useState(false);
  const lastRunRef = useRef(0);

  const run = useCallback(
    async (...args: Args) => {
      const now = Date.now();
      if (isBusy || now - lastRunRef.current < cooldownMs) return;

      lastRunRef.current = now;
      setIsBusy(true);
      try {
        await action(...args);
      } finally {
        setIsBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, cooldownMs]
  );

  return [run, isBusy] as const;
}
