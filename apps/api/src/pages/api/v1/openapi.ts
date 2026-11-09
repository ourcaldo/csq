import type { NextApiRequest, NextApiResponse } from "next";
import { buildOpenApiDocument } from "@/lib/openapi";

// GET /api/v1/openapi - generated from apps/api/src/lib/api-contract.ts.
// The route handlers import the same request schemas, so adding or changing a
// schema updates the spec with it. No hand-written path objects.

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
): void {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json(buildOpenApiDocument());
}
