// Heading extraction for the "On this page" table of contents. Parses
// markdown h2/h3 lines, skipping fenced code blocks.

export type TocItem = { level: 2 | 3; text: string; id: string };

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inCode = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!match) continue;
    items.push({
      level: match[1].length === 2 ? 2 : 3,
      text: match[2].trim(),
      id: slugifyHeading(match[2]),
    });
  }
  return items;
}
