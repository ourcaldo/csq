// The public base URL for media links - the API service serves
// /api/media/[id] (PRD 23C Phase 7). The Cloud API needs an HTTPS link Meta
// can fetch, so the link must use the API service's domain, not the
// dashboard's.

export function publicMediaUrl(assetId: string): string {
  const base = (process.env.API_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("API_URL is not set - cannot build the public media link");
  return `${base}/api/media/${assetId}`;
}
