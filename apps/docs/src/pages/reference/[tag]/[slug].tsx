import type { GetStaticPaths, GetStaticProps } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import {
  buildCurl,
  getAllReferencePaths,
  getDocsNav,
  getReferencePage,
} from "@/lib/docs-data";
import type { DocsNav, FieldRow, HumanSchema, ReferencePageData } from "@/lib/docs-data";
import type { TocItem } from "@/lib/toc";

// One page per API operation, generated from the contract. Schemas render
// HUMAN-first: a generated example plus a field table (type / required /
// description); the raw JSON Schema stays available behind a toggle for
// tooling users. A schema dump is not documentation.

type PageLink = { href: string; title: string };
type Props = {
  nav: DocsNav;
  page: ReferencePageData;
  curl: string;
  prev: PageLink | null;
  next: PageLink | null;
};

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: getAllReferencePaths().map((p) => ({ params: { tag: p.tag, slug: p.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps<Props> = async (ctx) => {
  const tag = String(ctx.params?.tag ?? "");
  const slug = String(ctx.params?.slug ?? "");
  const page = getReferencePage(tag, slug);
  if (!page) return { notFound: true };
  const nav = getDocsNav();
  const all = getAllReferencePaths();
  const index = all.findIndex((p) => p.tag === tag && p.slug === slug);
  const link = (p: { tag: string; slug: string } | undefined): PageLink | null => {
    if (!p) return null;
    const item = nav.all.find((l) => l.href === `/reference/${p.tag}/${p.slug}`);
    return item ? { href: item.href, title: item.title } : null;
  };
  return {
    props: {
      nav,
      page,
      curl: buildCurl(page),
      prev: link(all[index - 1]),
      next: link(all[index + 1]),
    },
  };
};

const AUTH_TEXT: Record<ReferencePageData["auth"], string> = {
  none: "No authentication required.",
  bearer:
    "Requires a Bearer token: a tenant API key or a user access JWT. Send it as Authorization: Bearer <token> - see API keys for how to mint one.",
  service:
    "Requires a platform service token. Tenant API keys and user access JWTs are rejected.",
};

function FieldTable({ fields }: { fields: FieldRow[] }) {
  return (
    <table className="ref-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Required</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.name}>
            <td>
              <code style={{ paddingLeft: f.depth * 14 }}>{f.name}</code>
            </td>
            <td className="type-cell">{f.type}</td>
            <td>{f.required ? "yes" : "no"}</td>
            <td>{f.description ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="schema-label">{label}</div>
      <div className="ref-code">
        <code>{JSON.stringify(value, null, 2)}</code>
      </div>
    </div>
  );
}

function RawSchema({ human }: { human: HumanSchema }) {
  return (
    <details className="raw-schema">
      <summary>Raw JSON Schema</summary>
      <div className="ref-code">
        <code>{JSON.stringify(human.raw, null, 2)}</code>
      </div>
    </details>
  );
}

export default function ReferenceEndpointPage({ nav, page, curl, prev, next }: Props) {
  const toc: TocItem[] = [{ level: 2, text: "Authentication", id: "authentication" }];
  if (page.params.length > 0) toc.push({ level: 2, text: "Parameters", id: "parameters" });
  if (page.request) toc.push({ level: 2, text: "Request body", id: "request-body" });
  toc.push({ level: 2, text: "Responses", id: "responses" });
  toc.push({ level: 2, text: "Example", id: "example" });

  return (
    <DocsShell
      nav={nav}
      eyebrow={`API reference / ${page.tag}`}
      title={page.summary}
      description={page.description}
      toc={toc}
      copyText={curl}
    >
      <div className="endpoint-line">
        <span className={`method-big ${page.method}`}>{page.method.toUpperCase()}</span>
        <span className="path-big">{page.path}</span>
      </div>

      <section className="ref-section">
        <h2 id="authentication">Authentication</h2>
        <p className="prose" style={{ margin: 0 }}>
          <span className="badge">
            {page.auth === "none" ? "No auth" : page.auth === "service" ? "Service token" : "Bearer token"}
          </span>{" "}
          {AUTH_TEXT[page.auth]}
        </p>
      </section>

      {page.params.length > 0 && (
        <section className="ref-section">
          <h2 id="parameters">Parameters</h2>
          <table className="ref-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {page.params.map((p) => (
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
        </section>
      )}

      {page.request ? (
        <section className="ref-section">
          <h2 id="request-body">Request body</h2>
          {page.request.fields.length > 0 && <FieldTable fields={page.request.fields} />}
          <JsonBlock label="Example request" value={page.request.example} />
          <RawSchema human={page.request} />
        </section>
      ) : null}

      <section className="ref-section">
        <h2 id="responses">Responses</h2>
        {page.responses.map((resp) => (
          <div key={resp.status}>
            <div className="status-line">
              <span className={`status-code ${resp.status.startsWith("2") ? "ok" : "err"}`}>
                {resp.status}
              </span>
              <span className="status-desc">{resp.description}</span>
            </div>
            {resp.human ? (
              <>
                <JsonBlock label="Example response" value={resp.human.example} />
                {resp.human.fields.length > 0 && <FieldTable fields={resp.human.fields} />}
                <RawSchema human={resp.human} />
              </>
            ) : null}
            {resp.contentType ? (
              <p className="muted-note">
                Plain text response ({resp.contentType}).
              </p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="ref-section">
        <h2 id="example">Example</h2>
        <div className="ref-code">
          <code>{curl}</code>
        </div>
      </section>

      {(prev || next) && (
        <div className="prevnext">
          {prev && (
            <Link href={prev.href}>
              <div className="label">Previous</div>
              <div className="title">{prev.title}</div>
            </Link>
          )}
          {next && (
            <Link href={next.href} className="next">
              <div className="label">Next</div>
              <div className="title">{next.title}</div>
            </Link>
          )}
        </div>
      )}
    </DocsShell>
  );
}
