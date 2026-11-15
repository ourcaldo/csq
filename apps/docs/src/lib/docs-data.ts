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

const TAG_ORDER = ["Auth", "Tools", "Media", "Operations", "Webhooks"];

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
      items: [{ title: "Errors & limits", href: "/errors" }],
    },
  ];
  const reference: NavGroup[] = [];
  for (const tag of TAG_ORDER) {
    const ops = API_OPERATIONS.filter((op) => op.tags.includes(tag));
    if (ops.length === 0) continue;
    reference.push({
      label: tag,
      items: ops.map((op) => ({
        title: op.summary,
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

// JSON-serializable slice of the generated OpenAPI document for one endpoint.
export type ReferenceResponse = {
  status: string;
  description: string;
  schema?: unknown;
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
  requestSchema?: unknown;
  responses: ReferenceResponse[];
};

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
      const schema = resp.content?.["application/json"]?.schema;
      return {
        status,
        description: resp.description,
        ...(schema !== undefined ? { schema } : {}),
      };
    }),
  };
  if (op.description) page.description = op.description;
  if (requestSchema !== undefined) page.requestSchema = requestSchema;
  return page;
}

// Minimal example body from a JSON schema, for the curl snippet.
const schemaShape = z.object({
  type: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  items: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
});

export function exampleFromSchema(schema: unknown): unknown {
  const parsed = schemaShape.safeParse(schema);
  if (!parsed.success) return {};
  const s = parsed.data;
  if (s.enum && s.enum.length > 0) return s.enum[0];
  if (s.type === "object" && s.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(s.properties)) {
      out[key] = exampleFromSchema(value);
    }
    return out;
  }
  if (s.type === "array") return [exampleFromSchema(s.items)];
  if (s.type === "string") return "...";
  if (s.type === "number" || s.type === "integer") return 0;
  if (s.type === "boolean") return true;
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
  if (page.requestSchema) {
    lines.push(`  -H "Content-Type: application/json"`);
    const body = JSON.stringify(exampleFromSchema(page.requestSchema), null, 2);
    lines.push(`  -d '${body.replace(/\n/g, "\n  ")}'`);
  }
  return lines.join(" \\\n");
}
