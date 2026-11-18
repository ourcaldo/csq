// SSRF guard for server-side fetches of user-supplied destinations
// (security audit run-1, finding apiv1.messages.media-ssrf and
// smtp-ssrf-port-probe). Centralized so every outbound caller applies the
// same policy: http(s) only, no loopback/private/link-local/metadata
// addresses, validated AFTER DNS resolution and on every redirect hop.
import dns from "node:dns/promises";
import net from "node:net";

function isBlockedIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80") || // link-local
      lower.startsWith("fc") ||
      lower.startsWith("fd") || // unique local
      lower.startsWith("ff") // multicast
    );
  }
  if (!net.isIPv4(ip)) return true; // unparseable = blocked
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast/reserved
  );
}

// Resolve a hostname (or validate a literal IP) and reject non-public
// addresses. Throws on anything that cannot be resolved to a public unicast.
export async function assertPublicHttpHost(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must be http(s).");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("Host is not a public address.");
    return url;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0) throw new Error("Host cannot be resolved.");
  if (addrs.some((r) => isBlockedIp(r.address))) {
    throw new Error("Host is not a public address.");
  }
  return url;
}

// Fetch a user-supplied URL with the SSRF policy enforced on every hop:
// redirects are followed MANUALLY so each destination is re-validated
// before the connection is made (undici's automatic redirect-following
// would bypass the guard after the first hop).
export async function safeFetch(
  rawUrl: string,
  opts: { timeoutMs: number; maxRedirects?: number }
): Promise<Response> {
  let url = rawUrl;
  const maxRedirects = opts.maxRedirects ?? 3;
  for (let hop = 0; ; hop++) {
    const validated = await assertPublicHttpHost(url);
    const res = await fetch(validated, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location || hop >= maxRedirects) {
        throw new Error("Destination did not return content.");
      }
      url = new URL(location, validated).toString();
      continue;
    }
    return res;
  }
}
