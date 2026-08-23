// Reusable document <head> for every page. One source of truth for the site
// name, default description, canonical, Open Graph/Twitter cards, and JSON-LD
// structured data. Dashboard pages pass `noindex` (auth-gated, no index value);
// marketing pages pass structured data.
//
// NEXT_PUBLIC_SITE_URL is optional: when unset, canonical/og:url are omitted so
// we never emit broken absolute URLs in dev. Set it in production.
import Head from "next/head";

export const SITE_NAME = "CSQ";
export const SITE_TAGLINE = "Agen AI WhatsApp untuk UMKM Indonesia";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "";
export const DEFAULT_DESCRIPTION =
  "Platform agen AI self-host untuk UMKM Indonesia. Deploy AI Customer Service di WhatsApp yang memahami data bisnis Anda—baca secara default, tulis dengan izin, bertindak sesuai aturan.";

// Serialize JSON-LD safely: JSON.stringify alone does not escape `<`/`>`/`&`, so
// a string value containing `</script>` could break out of the script tag. We
// escape those characters to their JSON unicode escapes. The input is static,
// developer-authored structured data (never user input), so this is defense in
// depth rather than a sanitizer for untrusted content.
function safeJsonLd(data: Record<string, unknown> | Record<string, unknown>[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

type SeoProps = {
  /** Page title without the site suffix (e.g. "Percakapan"). Omit for the home default. */
  title?: string;
  description?: string;
  /** Canonical path beginning with "/", e.g. "/dashboard/inbox". */
  path?: string;
  ogType?: "website" | "article" | "profile";
  /** Auth-gated/dashboard pages should set this. */
  noindex?: boolean;
  /** Structured data; rendered as application/ld+json. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

export function Seo({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  ogType = "website",
  noindex = false,
  jsonLd,
}: SeoProps) {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — ${SITE_TAGLINE}`;
  const url = SITE_URL && path ? `${SITE_URL}${path}` : undefined;
  const image = SITE_URL ? `${SITE_URL}/og.svg` : undefined;

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {noindex ? (
        <meta name="robots" content="noindex,nofollow" />
      ) : (
        <meta name="robots" content="index,follow" />
      )}
      {url && <link rel="canonical" href={url} />}

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:locale" content="id_ID" />
      {url && <meta property="og:url" content={url} />}
      {image && <meta property="og:image" content={image} />}

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}

      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
        />
      )}
    </Head>
  );
}
