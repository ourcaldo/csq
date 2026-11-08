import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="id">
      <Head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Inter: body / UI (the admin console uses the tenant dashboard's
            design language - PRD 13). */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="antialiased bg-background text-foreground">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
