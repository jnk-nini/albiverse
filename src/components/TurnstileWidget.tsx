"use client";

/* ============================================================================
   CLOUDFLARE TURNSTILE — the CAPTCHA gate on signup/login

   Right now anyone can create unlimited free Albiverse accounts with zero
   friction - the actual open door once this app takes public signups. This
   widget renders NOTHING at all when NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't
   set, so shipping it is safe today: the form just won't send a
   captchaToken, which Supabase Auth ignores completely until its own
   "Enable CAPTCHA protection" toggle (Auth settings > Bot and Abuse
   Protection) is turned on. Once both the env var and that toggle are set,
   it's live - no other code changes needed.

   Hand-rolled against Cloudflare's own script rather than pulling in
   @marsidev/react-turnstile - it's a script tag and three callbacks, not
   worth a dependency for.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Turnstile."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export default function TurnstileWidget({
  onToken,
  resetKey,
}: {
  onToken: (token: string | null) => void;
  /* Bump this (e.g. after a failed submit) to force a fresh challenge -
     Turnstile tokens are single-use and expire after a couple of minutes. */
  resetKey?: string | number;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            setFailed(true);
            onToken(null);
          },
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
    // Deliberately re-runs only when the site key itself changes, not on
    // every render — see the resetKey effect below for re-challenges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  useEffect(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onToken(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!siteKey) return null;

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <div ref={containerRef} />
      {failed && (
        <p className="text-[10px] text-red-700 font-mono">
          Verification widget failed to load — refresh and try again.
        </p>
      )}
    </div>
  );
}
