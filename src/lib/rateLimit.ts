/* Per-key sliding-window limiter for serverless API routes. State lives in
   memory, so it only protects a single warm function instance - not a
   distributed guarantee across Vercel's scale-out, but a real backstop
   against a runaway client loop or a single abusive account, which is the
   actual threat model for a 2-person app's one quota-metered route. Stored on
   globalThis so `next dev`'s hot-reload doesn't reset it on every edit. */

type Hit = number[];

const globalForRateLimit = globalThis as unknown as {
  __albiverseRateLimitHits?: Map<string, Hit>;
};

const hits =
  globalForRateLimit.__albiverseRateLimitHits ??
  (globalForRateLimit.__albiverseRateLimitHits = new Map<string, Hit>());

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  const existing = hits.get(key) ?? [];
  const recent = existing.filter((t) => t > windowStart);

  if (recent.length >= limit) {
    const retryAfterSeconds = Math.ceil((recent[0] + windowMs - now) / 1000);
    hits.set(key, recent);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}
