import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { API_OPERATIONS, type ApiOperation } from "./api-contract";

// Generated OpenAPI document (PRD 09). The paths come from API_OPERATIONS in
// api-contract.ts; the route handlers import the same request schemas, so the
// spec and the code cannot drift.

export type OpenApiOperation = {
  summary: string;
  description?: string;
  tags: string[];
  security: Array<Record<string, string[]>>;
  parameters?: Array<{
    name: string;
    in: "path";
    required: boolean;
    description?: string;
    schema: unknown;
  }>;
  requestBody?: {
    required: boolean;
    content: Record<string, { schema: unknown }>;
  };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: unknown }> }
  >;
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string; description?: string }>;
  components: { securitySchemes: Record<string, unknown> };
  paths: Record<string, Record<string, OpenApiOperation>>;
};

const errorSchema = z.object({ code: z.string(), message: z.string() });

function envelope(data?: z.ZodTypeAny): z.ZodTypeAny {
  const failure = z.object({
    success: z.literal(false),
    error: errorSchema,
    data: z.unknown().optional(),
  });
  if (!data) return failure;
  return z.union([z.object({ success: z.literal(true), data }), failure]);
}

function toJsonSchema(schema: z.ZodTypeAny): unknown {
  const result = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  });
  if (!result || typeof result !== "object") return result;
  const { $schema, ...rest } = result;
  void $schema;
  return rest;
}

function operationDocument(op: ApiOperation): OpenApiOperation {
  const responses: OpenApiOperation["responses"] = {};
  for (const [status, response] of Object.entries(op.responses)) {
    if (response.raw) {
      responses[status] = {
        description: response.description,
        content: {
          [response.contentType ?? "application/json"]: { schema: response.raw },
        },
      };
    } else {
      responses[status] = {
        description: response.description,
        content: {
          "application/json": { schema: toJsonSchema(envelope(response.data)) },
        },
      };
    }
  }

  const document: OpenApiOperation = {
    summary: op.summary,
    tags: op.tags,
    security: op.security === "none" ? [] : [{ bearerAuth: [] }],
    responses,
  };
  if (op.description) document.description = op.description;
  if (op.parameters) {
    document.parameters = op.parameters.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      description: p.description,
      schema: toJsonSchema(p.schema),
    }));
  }
  if (op.request) {
    document.requestBody = {
      required: true,
      content: { "application/json": { schema: toJsonSchema(op.request) } },
    };
  }
  return document;
}

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};
  for (const op of API_OPERATIONS) {
    const pathItem = paths[op.path] ?? {};
    pathItem[op.method] = operationDocument(op);
    paths[op.path] = pathItem;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "CSQ API",
      version: "1.0.0",
      description:
        "Tenant-facing product API. Bearer auth: service tokens (internal) or tenant API keys / user access JWTs. Generated from the route contract.",
    },
    servers: [{ url: process.env.API_URL ?? "/" }],
    tags: [
      { name: "Auth", description: "Credential exchange and refresh-token rotation" },
      { name: "Tools", description: "Tool Gateway execution" },
      { name: "Operations", description: "Service-only diagnostics" },
      { name: "Media", description: "Stored media assets" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    paths,
  };
}
