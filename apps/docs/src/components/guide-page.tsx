import type { GetStaticProps } from "next";
import { DocsShell } from "@/components/docs-shell";
import { Markdown } from "@/components/markdown";
import { extractToc } from "@/lib/toc";
import { getDocsNav } from "@/lib/docs-data";
import type { DocsNav } from "@/lib/docs-data";
import { GUIDES } from "@/content/guides";
import type { Guide } from "@/content/guides";

// Shared renderer + getStaticProps factory for the hand-written guide pages.

type GuideProps = { nav: DocsNav; guide: Guide };

export function guideStaticProps(key: keyof typeof GUIDES): GetStaticProps<GuideProps> {
  return async () => ({
    props: { nav: getDocsNav(), guide: GUIDES[key] },
  });
}

export function GuidePage({ nav, guide }: GuideProps) {
  const toc = extractToc(guide.markdown);
  return (
    <DocsShell
      nav={nav}
      eyebrow={guide.eyebrow}
      title={guide.title}
      description={guide.description}
      toc={toc}
      copyText={guide.markdown}
    >
      <Markdown>{guide.markdown}</Markdown>
    </DocsShell>
  );
}
