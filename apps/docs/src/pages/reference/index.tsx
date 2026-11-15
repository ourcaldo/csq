import type { GetStaticProps } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import { getDocsNav, referenceHref, API_BASE_URL } from "@/lib/docs-data";
import type { DocsNav } from "@/lib/docs-data";
import { API_OPERATIONS } from "@csq/core/lib/api-contract";

// API reference overview: endpoints grouped by tag. The data is prepared in
// getStaticProps as plain objects (the client bundle never sees the contract
// module or its zod schemas).

type OverviewItem = { title: string; href: string; method: string; path: string };
type OverviewGroup = { tag: string; items: OverviewItem[] };
type Props = { nav: DocsNav; overview: OverviewGroup[] };

const TAG_ORDER = ["Auth", "Tools", "Messages", "Media", "Operations", "Webhooks"];

export const getStaticProps: GetStaticProps<Props> = async () => {
  const overview: OverviewGroup[] = [];
  for (const tag of TAG_ORDER) {
    const ops = API_OPERATIONS.filter((op) => op.tags.includes(tag));
    if (ops.length === 0) continue;
    overview.push({
      tag,
      items: ops.map((op) => ({
        title: op.summary,
        href: referenceHref(op),
        method: op.method,
        path: op.path,
      })),
    });
  }
  return { props: { nav: getDocsNav(), overview } };
};

export default function ReferenceIndex({ nav, overview }: Props) {
  const toc = overview.map((g) => ({
    level: 2 as const,
    text: g.tag,
    id: g.tag.toLowerCase(),
  }));

  return (
    <DocsShell
      nav={nav}
      eyebrow="API reference"
      title="API reference"
      description={`Every endpoint in the CSQ product API. Base URL: ${API_BASE_URL}`}
      toc={toc}
    >
      <div className="prose">
        {overview.map((group) => (
          <section key={group.tag}>
            <h2 id={group.tag.toLowerCase()}>{group.tag}</h2>
            <div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-item"
                  style={{ padding: "10px 12px", border: "1px solid var(--border)", margin: "8px 0" }}
                >
                  <span className={`method-chip ${item.method}`}>{item.method.toUpperCase()}</span>
                  <span className="truncate" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}>
                    {item.path}
                  </span>
                  <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12.5 }}>
                    {item.title}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DocsShell>
  );
}
