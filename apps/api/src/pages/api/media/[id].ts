import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Public media serving (plan 3.2.1). UNAUTHENTICATED by design: Meta's Cloud
// API fetcher must reach the image over HTTPS, so this route carries the same
// trust level as any hosted marketing image - the unguessable UUID id is the
// access control, rows are immutable, and the bytes are tenant promo imagery.
// Long immutable cache because ids never change content.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const { id } = req.query;
  if (req.method !== "GET" || typeof id !== "string") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // UUID-addressed fetch crosses tenants by design: bypass context
  // (PRD 16 SEC-1).
  const asset = await withSystemContext(async () =>
    prisma.mediaAsset.findUnique({ where: { id } })
  );
  if (!asset) {
    res.status(404).send("Not Found");
    return;
  }

  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Content-Length", String(asset.byteSize));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  // Content-injection hardening (audit run-1): never let a stored asset
  // execute in the browser. nosniff everywhere, and non-image bytes download
  // instead of render even if a script-executable mime slipped into storage.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Audit run-3 (media.inline-svg-any-user-bytes): only rasters render
  // inline - image/svg+xml executes script when navigated to directly.
  if (!INLINE_SAFE.has(asset.mimeType)) {
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  }
  res.end(asset.data);
}

// Inline-safe = raster images only (SVG is a script-executing document).
const INLINE_SAFE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
