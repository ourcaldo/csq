import type { GetServerSideProps } from "next";
import Head from "next/head";
import { buildOpenApiDocument, type OpenApiDocument, type OpenApiOperation } from "@/lib/openapi";

// Public API documentation (owner request 2026-11-15). A human-readable
// rendering of the SAME generated OpenAPI document served at
// /api/v1/openapi - the page and the raw JSON cannot drift, and there is no
// hand-written copy to maintain. Public by design: the spec carries no
// secrets. Docs language is English (developer-facing surface).

type DocProps = { doc: OpenApiDocument };

export const getServerSideProps: GetServerSideProps<DocProps> = async () => ({
  props: { doc: JSON.parse(JSON.stringify(buildOpenApiDocument())) },
});

const METHOD_COLORS: Record<string, string> = {
  GET: "#0f766e",
  POST: "#1d4ed8",
  DELETE: "#b91c1c",
  PUT: "#7c3aed",
  PATCH: "#b45309",
};

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #fafaf9; color: #1c1917; line-height: 1.55; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 40px 20px 80px; }
  a { color: #1d4ed8; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #78716c; }
  h1 { font-size: 28px; letter-spacing: -0.02em; margin: 6px 0 8px; }
  .sub { color: #57534e; font-size: 14px; max-width: 640px; }
  .meta { margin: 18px 0 0; font-size: 12.5px; color: #78716c; display: flex; flex-wrap: wrap; gap: 14px; }
  .meta code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #1c1917; background: #f5f5f4; border: 1px solid #e7e5e4; border-radius: 6px; padding: 2px 6px; font-size: 12px; }
  h2 { font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #78716c; margin: 44px 0 4px; border-top: 1px solid #e7e5e4; padding-top: 28px; }
  .tag-desc { font-size: 13px; color: #78716c; margin: 0 0 16px; }
  .op { background: #ffffff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 16px 18px; margin: 14px 0; }
  .op-line { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .method { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 6px; color: #fff; }
  .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; font-weight: 500; }
  .op-summary { font-size: 13.5px; color: #57534e; margin: 6px 0 0; }
  .op-desc { font-size: 13px; color: #78716c; margin: 6px 0 0; }
  .badge { display: inline-block; font-size: 11px; color: #78716c; border: 1px solid #e7e5e4; border-radius: 999px; padding: 1px 8px; margin-top: 8px; }
  table.params { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 12.5px; }
  table.params th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #78716c; border-bottom: 1px solid #e7e5e4; padding: 6px 8px; }
  table.params td { border-bottom: 1px solid #f5f5f4; padding: 6px 8px; vertical-align: top; }
  .schema-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #78716c; margin: 14px 0 4px; }
  pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f5f5f4; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px; overflow-x: auto; margin: 0; }
  .resp-status { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 700; margin: 10px 0 2px; }
  .curl { background: #1c1917; color: #fafaf9; border-radius: 8px; padding: 14px; font-size: 12.5px; overflow-x: auto; }
  .curl .c { color: #a8a29e; }
  footer { margin-top: 48px; font-size: 12px; color: #a8a29e; border-top: 1px solid #e7e5e4; padding-top: 16px; }
`;

function Schema({ label, schema }: { label: string; schema: unknown }) {
  return (
    <div>
      <p className="schema-label">{label}</p>
      <pre>{JSON.stringify(schema, null, 2)}</pre>
    </div>
  );
}

function Operation({ method, op, path }: { method: string; op: OpenApiOperation; path: string }) {
  const color = METHOD_COLORS[method.toUpperCase()] ?? "#57534e";
  return (
    <div className="op">
      <div className="op-line">
        <span className="method" style={{ background: color }}>
          {method.toUpperCase()}
        </span>
        <span className="path">{path}</span>
      </div>
      <p className="op-summary">{op.summary}</p>
      {op.description && <p className="op-desc">{op.description}</p>}
      {op.security.length === 0 && <span className="badge">no auth</span>}

      {op.parameters && op.parameters.length > 0 && (
        <table className="params">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Required</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {op.parameters.map((p) => (
              <tr key={p.name}>
                <td>
                  <code>{p.name}</code>
                </td>
                <td>{p.required ? "yes" : "no"}</td>
                <td>{p.description ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {op.requestBody && (
        <Schema
          label="Request body (application/json)"
          schema={op.requestBody.content["application/json"].schema}
        />
      )}

      {Object.entries(op.responses).map(([status, resp]) => (
        <div key={status}>
          <p className="resp-status">
            {status} - {resp.description}
          </p>
          {resp.content?.["application/json"] && (
            <Schema label="Response" schema={resp.content["application/json"].schema} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function ApiDocumentationPage({ doc }: DocProps) {
  const baseUrl = doc.servers[0]?.url ?? "";
  const tagOrder = [
    ...doc.tags.map((t) => t.name),
    ...Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods))
      .map((op) => op.tags[0])
      .filter((tag): tag is string => Boolean(tag))
      .filter((tag, i, arr) => !doc.tags.some((t) => t.name === tag) && arr.indexOf(tag) === i),
  ];

  return (
    <>
      <Head>
        <title>CSQ API Documentation</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{CSS}</style>
      <div className="wrap">
          <p className="eyebrow">CSQ Platform</p>
          <h1>{doc.info.title}</h1>
          <p className="sub">{doc.info.description}</p>
          <div className="meta">
            <span>
              Base URL: <code>{baseUrl}</code>
            </span>
            <span>
              Version: <code>{doc.info.version}</code>
            </span>
            <span>
              Raw spec: <code>/api/v1/openapi</code>
            </span>
          </div>

          <h2>Authentication</h2>
          <p className="tag-desc">
            All authenticated endpoints expect a Bearer token in the
            <code> Authorization</code> header. Tenant API keys are created in the CSQ
            dashboard under <b>Settings &rarr; Kunci API</b> (the full token is shown exactly
            once, at creation). User access JWTs come from <code>POST /api/v1/auth/token</code>.
          </p>
          <pre className="curl">
            <span className="c"># List the available tools with a tenant API key</span>
            {`\ncurl -H "Authorization: Bearer YOUR_API_KEY" \\\n  ${baseUrl}/api/v1/tools`}
          </pre>

          {tagOrder.map((tag) => {
            const ops: Array<{ method: string; path: string; op: OpenApiOperation }> = [];
            for (const [path, methods] of Object.entries(doc.paths)) {
              for (const [method, op] of Object.entries(methods)) {
                if (op.tags.includes(tag)) ops.push({ method, path, op });
              }
            }
            if (ops.length === 0) return null;
            const tagDesc = doc.tags.find((t) => t.name === tag)?.description;
            return (
              <section key={tag}>
                <h2>{tag}</h2>
                {tagDesc && <p className="tag-desc">{tagDesc}</p>}
                {ops.map(({ method, path, op }) => (
                  <Operation key={`${method}-${path}`} method={method} path={path} op={op} />
                ))}
              </section>
            );
          })}

          <footer>
            This document is generated from the API route contract - the page and
            the raw OpenAPI JSON at <code>/api/v1/openapi</code> always match.
          </footer>
      </div>
    </>
  );
}
