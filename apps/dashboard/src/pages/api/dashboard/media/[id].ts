import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";

// Authenticated media serving (audit run-2, public-media-route-serves-
// contact-avatar-pii): serves avatar and other tenant-owned media to the
// tenant's own session, enforcing tenantId equality - unlike the public
// UUID-only /api/media/[id] on the api service, which stays reserved for
// campaign/promo assets that Meta's fetcher must reach. Session-gated bytes
// never enter a public cache.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const { id } = req.query;
  if (req.method !== "GET" || typeof id !== "string") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  // The asset must belong to the caller's tenant.
  const asset = await withTenantContext(tenantId, async () =>
    prisma.mediaAsset.findUnique({ where: { id } })
  );
  if (!asset || asset.tenantId !== tenantId) {
    res.status(404).send("Not Found");
    return;
  }

  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Content-Length", String(asset.byteSize));
  // Private cache: authenticated bytes, never a shared proxy cache.
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Audit run-3 (media.inline-svg-any-user-bytes): only rasters render
  // inline. image/svg+xml is an HTML document that executes script under the
  // dashboard origin when navigated to directly - everything outside the
  // raster set is forced to download.
  if (!INLINE_SAFE.has(asset.mimeType)) {
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  }
  res.end(asset.data);
}

// Inline-safe = raster images only. SVG (and any polyglot labeled image/*)
// is never on this list.
const INLINE_SAFE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
