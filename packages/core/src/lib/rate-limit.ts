// Fixed-window in-memory rate limiter (PRD 23C Phase 7: sec-rate-limiting).
// Per-instance only - correct at one instance per service (the current
// topology) and honest about it; a shared-store limiter comes with SaaS
// scale. Keys are caller-chosen (per-IP, per-token).
// shortcut: per-instance only, fine while each service runs one instance

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    // Evict expired entries instead of clearing the whole map (audit run-1
    // hardening): clear() let one high-cardinality caller reset every honest
    // user's window. Insertion-ordered Map: first entries are the oldest.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (buckets.size <= 4000) break;
        if (v.resetAt <= now) buckets.delete(k);
      }
      while (buckets.size > 5000) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
