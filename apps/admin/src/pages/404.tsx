import Link from "next/link";
import Head from "next/head";

// Branded 404 for the operator console.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <Head>
        <title>Page Not Found - CSQ Admin Console</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <p className="font-mono text-xs font-semibold uppercase tracking-widest text-emerald-600">404</p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        The address you opened does not exist. Head back to the console overview.
      </p>
      <Link
        href="/admin"
        className="mt-6 inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700"
      >
        Back to Console
      </Link>
    </div>
  );
}
