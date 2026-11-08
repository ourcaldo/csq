import type { NextApiRequest, NextApiResponse } from "next";

// GET /api/v1/openapi - the OpenAPI scaffold for the token realm (PRD 23C
// Phase 7). Hand-maintained at the current surface size; generation from
// route schemas becomes worth it when the surface grows.

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
): void {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  res.status(200).json({
    openapi: "3.0.3",
    info: {
      title: "CSQ API",
      version: "1.0.0",
      description:
        "Tenant-facing product API. Bearer auth: service tokens (internal) or tenant API keys (minted from the dashboard).",
    },
    servers: [{ url: process.env.API_URL ?? "/" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/auth/token": {
        post: {
          summary: "Exchange email + password for an access JWT + refresh token (5 req/min/IP)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Token pair",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      accessToken: { type: "string" },
                      refreshToken: { type: "string" },
                      tokenType: { type: "string", enum: ["Bearer"] },
                      expiresIn: { type: "integer" },
                    },
                  },
                },
              },
            },
            "401": { description: "Invalid credentials" },
            "429": { description: "Rate limited" },
          },
        },
      },
      "/api/v1/auth/refresh": {
        post: {
          summary: "Rotate a refresh token for a fresh pair (old token is revoked)",
          responses: {
            "200": { description: "New token pair" },
            "401": { description: "Invalid, expired, or already-rotated token" },
          },
        },
      },
      "/api/v1/auth/logout": {
        post: {
          summary: "Revoke a refresh token (idempotent)",
          responses: { "200": { description: "Revoked" } },
        },
      },
      "/api/v1/tools": {
        get: {
          summary: "List registered tools",
          responses: { "200": { description: "Tool summaries" } },
        },
      },
      "/api/v1/tools/{tool}": {
        post: {
          summary: "Execute a tool (tenant API key required)",
          parameters: [
            { name: "tool", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["agentId", "params"],
                  properties: {
                    agentId: { type: "string", format: "uuid" },
                    params: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Tool result" },
            "403": { description: "Permission denied or approval required" },
            "429": { description: "Rate limited (60 req/min per key)" },
          },
        },
      },
      "/api/v1/webhook-diag": {
        get: {
          summary: "Recent webhook rejection diagnostics (service token only)",
          responses: { "200": { description: "Diagnostic entries" } },
        },
      },
    },
  });
}
