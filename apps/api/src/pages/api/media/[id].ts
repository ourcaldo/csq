import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";

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

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) {
    res.status(404).send("Not Found");
    return;
  }

  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Content-Length", String(asset.byteSize));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(asset.data);
}
