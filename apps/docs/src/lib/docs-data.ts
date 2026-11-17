import { z } from "zod";
import { API_OPERATIONS, type ApiOperation } from "@csq/core/lib/api-contract";
import { buildOpenApiDocument } from "@csq/core/lib/openapi-doc";

// Server-side data for the docs app (imported from getStaticProps only).
// Nav and reference pages derive from the SAME API contract and OpenAPI
// document the api service serves, so the docs cannot drift from the code.

export const API_BASE_URL =
  process.env.API_URL ?? "https://csq-api.onrender.com";
export const DASHBOARD_URL =
  process.env.DASHBOARD_URL ?? "https://csq-dashboard.onrender.com";

export type NavLink = { title: string; href: string; method?: string };
export type NavGroup = { label: string; items: NavLink[] };
export type DocsNav = { guides: NavGroup[]; reference: NavGroup[]; all: NavLink[] };

const TAG_ORDER = ["Auth", "Tools", "Messages", "Pipeline", "Media", "Operations", "Webhooks"];

export function tagSlug(tag: string): string {
  return tag.toLowerCase();
}

export function referenceHref(op: ApiOperation): string {
  const tag = op.tags[0] ?? "operations";
  return `/reference/${tagSlug(tag)}/${op.slug}`;
}

export function getDocsNav(): DocsNav {
  const guides: NavGroup[] = [
    {
      label: "Get started",
      items: [
        { title: "Introduction", href: "/" },
        { title: "Quickstart", href: "/quickstart" },
      ],
    },
    {
      label: "Authentication",
      items: [
        { title: "API keys", href: "/authentication" },
        { title: "User sessions", href: "/sessions" },
      ],
    },
    {
      label: "Guides",
      items: [
        { title: "Sending messages", href: "/messages" },
        { title: "Managing the pipeline", href: "/pipeline" },
        { title: "Errors & limits", href: "/errors" },
      ],
    },
  ];
  const reference: NavGroup[] = [];
  for (const tag of TAG_ORDER) {
    const ops = API_OPERATIONS.filter((op) => op.tags.includes(tag));
    if (ops.length === 0) continue;
    reference.push({
      label: tag,
      items: ops.map((op) => ({
        // The path is the readable label for endpoint nav entries (long
        // summaries truncate); the method chip disambiguates shared paths.
        title: op.path,
        href: referenceHref(op),
        method: op.method,
      })),
    });
  }
  return {
    guides,
    reference,
    all: [
      ...guides.flatMap((g) => g.items),
      ...reference.flatMap((g) => g.items),
    ],
  };
}

// JSON-serializable slice of the generated OpenAPI document for one endpoint,
// pre-humanized in getStaticProps: examples + field tables instead of raw
// JSON Schema dumps (a schema wall is not documentation).
export type FieldRow = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  depth: number;
};
export type HumanSchema = {
  fields: FieldRow[];
  example: unknown;
  raw: unknown;
};
export type ReferenceResponse = {
  status: string;
  description: string;
  contentType?: string;
  human?: HumanSchema;
};
export type ReferenceParam = {
  name: string;
  required: boolean;
  description?: string;
  schema: unknown;
};
export type ReferencePageData = {
  slug: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  tag: string;
  auth: "none" | "bearer" | "service";
  params: ReferenceParam[];
  request?: HumanSchema;
  responses: ReferenceResponse[];
};

// JSON Schema shape we care about when humanizing (zodToJsonSchema output).
const schemaShape = z.object({
  type: z.string().optional(),
  format: z.string().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  items: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
  additionalProperties: z.unknown().optional(),
});
type SchemaNode = z.infer<typeof schemaShape>;

function resolveNode(schema: unknown): SchemaNode {
  const parsed = schemaShape.safeParse(schema);
  if (!parsed.success) return {};
  const node = parsed.data;
  // The response envelope is a union (success | error): show the success
  // branch - errors follow the documented error envelope.
  const branch = node.anyOf?.[0] ?? node.oneOf?.[0];
  if (branch !== undefined) return resolveNode(branch);
  return node;
}

function typeLabel(schema: unknown): string {
  const node = resolveNode(schema);
  if (node.enum && node.enum.length > 0) {
    return node.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  if (node.type === "array") return `array<${typeLabel(node.items)}>`;
  if (node.type === "string") {
    return node.format ? `string (${node.format})` : "string";
  }
  if (node.type === "object") return "object";
  if (node.type === "number" || node.type === "integer" || node.type === "boolean") {
    return node.type;
  }
  return "any";
}

function walkFields(
  node: SchemaNode,
  prefix: string,
  parentRequired: string[] | undefined,
  depth: number,
  out: FieldRow[]
): void {
  if (node.type === "object" && node.properties) {
    for (const [key, value] of Object.entries(node.properties)) {
      const child = resolveNode(value);
      const name = prefix ? `${prefix}.${key}` : key;
      out.push({
        name,
        type: typeLabel(child),
        required: parentRequired?.includes(key) ?? false,
        ...(child.description ? { description: child.description } : {}),
        depth,
      });
      if (depth < 3) walkFields(child, name, child.required, depth + 1, out);
    }
    return;
  }
  if (node.type === "array") {
    const items = resolveNode(node.items);
    if (items.type === "object") {
      walkFields(items, `${prefix}[]`, items.required, depth, out);
    }
  }
}

export function humanizeSchema(schema: unknown): HumanSchema {
  const node = resolveNode(schema);
  const fields: FieldRow[] = [];
  walkFields(node, "", node.required, 0, fields);
  return { fields, example: exampleFromSchema(node), raw: schema };
}

export function getAllReferencePaths(): Array<{ tag: string; slug: string }> {
  return API_OPERATIONS.map((op) => ({
    tag: tagSlug(op.tags[0] ?? "operations"),
    slug: op.slug,
  }));
}

export function getReferencePage(
  tagSlugValue: string,
  slug: string
): ReferencePageData | null {
  const op = API_OPERATIONS.find(
    (o) => o.slug === slug && tagSlug(o.tags[0] ?? "operations") === tagSlugValue
  );
  if (!op) return null;
  const spec = buildOpenApiDocument();
  const doc = spec.paths[op.path]?.[op.method];
  if (!doc) return null;
  const requestSchema = doc.requestBody?.content["application/json"]?.schema;
  // Next refuses to serialize explicit `undefined` props - omit empty keys.
  const page: ReferencePageData = {
    slug: op.slug,
    method: op.method,
    path: op.path,
    summary: op.summary,
    tag: op.tags[0] ?? "",
    auth: op.security,
    params: (doc.parameters ?? []).map((p) => ({
      name: p.name,
      required: p.required,
      ...(p.description ? { description: p.description } : {}),
      schema: p.schema,
    })),
    responses: Object.entries(doc.responses).map(([status, resp]) => {
      const jsonContent = resp.content?.["application/json"];
      const textContent = Object.entries(resp.content ?? {}).find(
        ([type]) => type !== "application/json"
      );
      return {
        status,
        description: resp.description,
        ...(jsonContent ? { human: humanizeSchema(jsonContent.schema) } : {}),
        ...(textContent && !jsonContent ? { contentType: textContent[0] } : {}),
      };
    }),
  };
  if (op.description) page.description = op.description;
  if (requestSchema !== undefined) page.request = humanizeSchema(requestSchema);
  return page;
}

// Minimal example body from a JSON schema, for the curl snippet and the
// "Example request" block.
export function exampleFromSchema(schema: unknown): unknown {
  const node = resolveNode(schema);
  if (node.enum && node.enum.length > 0) return node.enum[0];
  if (node.type === "object") {
    const out: Record<string, unknown> = {};
    if (node.properties) {
      for (const [key, value] of Object.entries(node.properties)) {
        out[key] = exampleFromSchema(value);
      }
    }
    return out;
  }
  if (node.type === "array") return [exampleFromSchema(node.items)];
  if (node.type === "string") return "...";
  if (node.type === "number" || node.type === "integer") return 0;
  if (node.type === "boolean") return true;
  return null;
}

export function buildCurl(page: ReferencePageData): string {
  const path = page.path.replace(/\{([^}]+)\}/g, (_m, name: string) =>
    `YOUR_${name.toUpperCase()}`
  );
  const lines = [`curl -X ${page.method.toUpperCase()} "${API_BASE_URL}${path}"`];
  if (page.auth !== "none") {
    lines.push(`  -H "Authorization: Bearer $CSQ_API_KEY"`);
  }
  if (page.request) {
    lines.push(`  -H "Content-Type: application/json"`);
    const body = JSON.stringify(page.request.example, null, 2);
    lines.push(`  -d '${body.replace(/\n/g, "\n  ")}'`);
  }
  return lines.join(" \\\n");
}
