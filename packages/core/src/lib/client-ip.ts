// Client-IP extraction for rate limiting (audit run-1,
// apiv1.auth.xff-ratelimit-bypass). The repo's own nginx APPENDS the real
// client IP after any client-supplied X-Forwarded-For values
// ($proxy_add_x_forwarded_for) and also sets X-Real-IP - so the FIRST XFF
// element is attacker-controlled and must never key a rate limit. Trust
// order: X-Real-IP (set by our edge), then the LAST XFF element (the hop our
// proxy added), then "unknown" (shared bucket - fail closed, never spoofable
// into unlimited fresh buckets).
// Accepts the structural subset NextAuth passes to authorize() as well as
// full NextApiRequest.
import type { NextApiRequest } from "next";
type IpHeaders = { headers?: Record<string, unknown> | undefined };

export function clientIp(req: IpHeaders): string {
  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp) return realIp.trim();
  const xff = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (typeof raw === "string" && raw) {
    const hops = raw.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}
