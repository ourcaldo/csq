import Link from "next/link";
import { Seo } from "@csq/ui/components/seo";

// Branded 404 - the only dashboard route that renders without a session.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <Seo title="Halaman Tidak Ditemukan" noindex />
      <p className="font-mono text-xs font-semibold uppercase tracking-widest text-green-600">404</p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
        Halaman tidak ditemukan
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        Alamat yang Anda buka tidak ada atau sudah dipindahkan. Kembali ke dashboard untuk melanjutkan.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-10 items-center rounded-lg bg-green-600 px-4 text-sm font-semibold text-white transition hover:bg-green-700"
      >
        Kembali ke Dashboard
      </Link>
    </div>
  );
}
