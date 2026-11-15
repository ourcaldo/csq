import { isValidElement } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { slugifyHeading } from "@/lib/toc";

// Markdown renderer for the hand-written guides. Headings get slug ids so the
// "On this page" TOC can link (and scroll-spy) them.

function nodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(nodeText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return nodeText(children.props.children);
  }
  return "";
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children: content }) => (
            <h2 id={slugifyHeading(nodeText(content))}>{content}</h2>
          ),
          h3: ({ children: content }) => (
            <h3 id={slugifyHeading(nodeText(content))}>{content}</h3>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
