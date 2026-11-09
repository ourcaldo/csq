import { buildOpenApiDocument } from "../apps/api/src/lib/openapi";

// Self-check for the generated OpenAPI contract (PRD 09). Run with:
//   npm run check:openapi
// Fails when a path, security rule, or request schema disappears, so the spec
// cannot silently drift from the API surface.

const doc = buildOpenApiDocument();
const requiredPaths = [
  "/api/v1/auth/token",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/tools",
  "/api/v1/tools/{tool}",
  "/api/v1/webhook-diag",
  "/api/media/{id}",
];

for (const path of requiredPaths) {
  if (!doc.paths[path]) throw new Error(`missing OpenAPI path: ${path}`);
}

const token = doc.paths["/api/v1/auth/token"].post;
if (!token) throw new Error("missing POST /api/v1/auth/token");
if (token.security.length !== 0) throw new Error("auth/token must be public");
if (!token.requestBody) throw new Error("auth/token needs a request schema");
if (!token.responses["200"]?.content) throw new Error("auth/token needs a 200 schema");

const tools = doc.paths["/api/v1/tools"].get;
if (!tools) throw new Error("missing GET /api/v1/tools");
if (tools.security.length === 0) throw new Error("tools must require bearer auth");

const execute = doc.paths["/api/v1/tools/{tool}"].post;
if (!execute) throw new Error("missing POST /api/v1/tools/{tool}");
if (!execute.requestBody) throw new Error("tools execute needs a request schema");
if (!execute.responses["403"]) throw new Error("tools execute needs a 403 response");

const media = doc.paths["/api/media/{id}"].get;
if (!media) throw new Error("missing GET /api/media/{id}");
if (media.security.length !== 0) throw new Error("media must be public");

const serialized = JSON.stringify(doc);
if (!serialized.includes('"openapi":"3.0.3"')) {
  throw new Error("unexpected OpenAPI version");
}

console.log(
  `openapi ok: ${Object.keys(doc.paths).length} paths, ${serialized.length} bytes`
);
