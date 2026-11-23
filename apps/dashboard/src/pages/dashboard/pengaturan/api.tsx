// /dashboard/pengaturan/api - API key management (reference section 5).
// Same API as the old ApiKeysSection; new presentation: issue bar, one-time
// secret reveal banner, ledger table, revoke confirm modal, cURL snippet.
import { useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { ArrowUpRight, Plus, X } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
type KeysData = { items: KeyRow[] };
type MintResult = { id: string; name: string; prefix: string; token: string };

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function PengaturanApiPage({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { data, loading, error, refresh } = useApi<KeysData>("/api/dashboard/api-keys");

  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<KeyRow | null>(null);

  const items = data?.items ?? [];

  async function mint(e: FormEvent) {
    e.preventDefault();
    if (minting || !name.trim()) return;
    setMinting(true);
    setFormError(null);
    setCopied(false);
    try {
      const r = await apiSend<MintResult>("/api/dashboard/api-keys", "POST", { name: name.trim() });
      setMinted(r);
      setName("");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat kunci.");
    } finally {
      setMinting(false);
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke || revoking) return;
    setRevoking(pendingRevoke.id);
    setFormError(null);
    try {
      await apiSend(`/api/dashboard/api-keys/${pendingRevoke.id}`, "DELETE");
      setPendingRevoke(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mencabut kunci.");
    } finally {
      setRevoking(null);
    }
  }

  function copyToken() {
    if (!minted) return;
    void navigator.clipboard.writeText(minted.token).then(() => setCopied(true));
  }

  const curlExample = `curl -X GET "${apiBaseUrl}/v1/contacts" \\
  -H "Authorization: Bearer csq_YOUR_TOKEN" \\
  -H "Accept: application/json"`;

  return (
    <SettingsShell
      section="api"
      title="Kunci Akses API"
      description="Kelola token autentikasi Bearer untuk integrasi sistem eksternal (ERP, POS, atau webhook kustom) dengan REST API CSQ."
      headerExtra={
        <a
          href="https://csq-docs.onrender.com"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline"
        >
          <span>Referensi API v1</span>
          <ArrowUpRight size={12} />
        </a>
      }
    >
      {/* Token creation bar */}
      <form onSubmit={mint} className="flex flex-col gap-2.5 border-b border-slate-200 py-5 sm:flex-row sm:items-center">
        <input
          type="text"
          maxLength={64}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Label kunci baru (contoh: Sinkronisasi POS Kasir)"
          className="h-9 max-w-sm flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
        />
        <button
          type="submit"
          disabled={minting}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-green-600 px-4 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Plus size={14} />
          {minting ? "Menerbitkan..." : "Terbitkan Kunci Baru"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {formError && <p className="mt-4 text-sm text-red-600">{formError}</p>}

      {/* One-time secret banner */}
      {minted && (
        <div className="mt-5 border-l-2 border-amber-500 bg-amber-50/70 py-3 pl-4 pr-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-amber-900">
              Token untuk <strong>{minted.name}</strong> hanya ditampilkan satu kali. Salin sekarang sebelum menutup peringatan ini.
            </p>
            <button type="button" onClick={() => setMinted(null)} className="text-amber-700 hover:text-amber-950">
              <X size={14} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900">
              {minted.token}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              {copied ? "Tersalin" : "Salin Token"}
            </button>
          </div>
        </div>
      )}

      {/* Keys ledger */}
      <div className="mt-6 overflow-x-auto">
        {loading ? (
          <p className="text-sm text-slate-500">Memuat kunci...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada kunci. Terbitkan kunci pertama untuk mulai memakai API.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="pb-2.5 pr-4">Label Kunci</th>
                <th className="px-4 pb-2.5">Prefix</th>
                <th className="px-4 pb-2.5">Diterbitkan</th>
                <th className="px-4 pb-2.5">Aktivitas Terakhir</th>
                <th className="px-4 pb-2.5">Status</th>
                <th className="pb-2.5 pl-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {items.map((k) => (
                <tr key={k.id} className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-medium text-slate-900">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{k.prefix}...</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{when(k.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{when(k.lastUsedAt)}</td>
                  <td className="px-4 py-3">
                    {k.revokedAt ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                        Dicabut
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Aktif
                      </span>
                    )}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => setPendingRevoke(k)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Cabut
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Developer integration snippet */}
      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800">Contoh Autentikasi Request</span>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(curlExample)}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
          >
            Salin cURL
          </button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200">
          {curlExample}
        </pre>
      </div>

      {/* Revoke confirmation modal */}
      {pendingRevoke && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingRevoke(null);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">Cabut Kunci Akses API</h3>
            </div>
            <p className="px-5 py-4 text-xs leading-relaxed text-slate-600">
              Apakah Anda yakin ingin mencabut kunci <strong>{pendingRevoke.name}</strong>{" "}
              (<code className="font-mono text-xs">{pendingRevoke.prefix}...</code>)? Semua permintaan API yang
              menggunakan token ini akan segera ditolak dengan kode{" "}
              <code className="font-mono text-xs">401 Unauthorized</code>.
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setPendingRevoke(null)}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void confirmRevoke()}
                disabled={revoking !== null}
                className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {revoking !== null ? "Mencabut..." : "Cabut Sekarang"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<{ apiBaseUrl: string }>(
  async (ctx) => {
    const apiBase = (process.env.API_URL ?? "").replace(/\/$/, "");
    const fallback = (
      process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`
    ).replace(/\/$/, "");
    return { props: { apiBaseUrl: apiBase || fallback } };
  },
  { requiredPermission: "apikeys.kelola" }
);
