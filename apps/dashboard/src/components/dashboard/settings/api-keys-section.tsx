// API keys section of the tenant Settings page (OWNER-only - the parent
// guards rendering; the BFF routes are OWNER-only server-side too). Mint,
// list, and revoke tokens for the /api/v1 realm. The plaintext token is
// shown exactly ONCE, at mint - afterwards only its sha256 hash exists.
// PRD 03 amendment 2026-11-15: the tenant-side UI for the mint routes that
// shipped in PRD 23C Phase 7.
import { useState } from "react";
import type { FormEvent } from "react";
import { Key, WarningCircle, Copy, ArrowSquareOut } from "@phosphor-icons/react";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { StateNotice } from "@/components/dashboard/state-notice";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Separator } from "@csq/ui/components/ui/separator";

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

export function ApiKeysSection({ apiDocsUrl }: { apiDocsUrl: string }) {
  const { data, loading, error, refresh } = useApi<KeysData>(
    "/api/dashboard/api-keys"
  );

  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const items = data?.items ?? [];

  async function mint(e: FormEvent) {
    e.preventDefault();
    if (minting || !name.trim()) return;
    setMinting(true);
    setFormError(null);
    setCopied(false);
    try {
      const r = await apiSend<MintResult>("/api/dashboard/api-keys", "POST", {
        name: name.trim(),
      });
      setMinted(r);
      setName("");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat kunci.");
    } finally {
      setMinting(false);
    }
  }

  async function revoke(id: string) {
    if (revoking) return;
    if (!window.confirm("Cabut kunci ini? Akses API yang memakainya langsung ditolak.")) {
      return;
    }
    setRevoking(id);
    setFormError(null);
    try {
      await apiSend(`/api/dashboard/api-keys/${id}`, "DELETE");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mencabut kunci.");
    } finally {
      setRevoking(null);
    }
  }

  async function copyToken() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <Separator className="my-4" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Key size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Kunci API</p>
            <p className="text-sm text-slate-500">
              Kunci untuk akses programatik ke API CSQ, dipakai sebagai Bearer
              token.
            </p>
          </div>
        </div>
        {apiDocsUrl && (
          <a
            href={apiDocsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            Dokumentasi API <ArrowSquareOut size={12} />
          </a>
        )}
      </div>

      {error && <StateNotice variant="error" message={error} />}
      {formError && <StateNotice variant="error" message={formError} />}

      {minted && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2 text-sm text-amber-800">
            <WarningCircle size={16} className="mt-0.5 shrink-0" />
            <span>
              Token untuk <strong>{minted.name}</strong> hanya ditampilkan sekali.
              Salin dan simpan sekarang - setelah ini tidak bisa dilihat lagi.
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-slate-800">
              {minted.token}
            </code>
            <Button type="button" variant="outline" onClick={() => void copyToken()}>
              <Copy size={14} />
              {copied ? "Tersalin" : "Salin"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMinted(null)}>
              Sembunyikan
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={mint} className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Label htmlFor="apikey-name">Nama kunci</Label>
          <Input
            id="apikey-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            placeholder="mis. Integrasi Toko Online"
            className="h-9"
          />
        </div>
        <Button type="submit" disabled={minting || !name.trim()}>
          {minting ? "Membuat..." : "Buat Kunci"}
        </Button>
      </form>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Memuat kunci...</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          Belum ada kunci. Buat kunci pertama untuk mulai memakai API.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Nama</th>
                <th className="py-2 pr-4 font-medium">Prefix</th>
                <th className="py-2 pr-4 font-medium">Dibuat</th>
                <th className="py-2 pr-4 font-medium">Terakhir dipakai</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium text-slate-900">{k.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                    {k.prefix}...
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-500">{when(k.createdAt)}</td>
                  <td className="py-2 pr-4 text-xs text-slate-500">{when(k.lastUsedAt)}</td>
                  <td className="py-2 pr-4">
                    <BadgeStatus tone={k.revokedAt ? "neutral" : "green"}>
                      {k.revokedAt ? "Dicabut" : "Aktif"}
                    </BadgeStatus>
                  </td>
                  <td className="py-2 text-right">
                    {!k.revokedAt && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={revoking === k.id}
                        onClick={() => void revoke(k.id)}
                        className="h-8 px-3 text-xs text-red-600 hover:text-red-700"
                      >
                        {revoking === k.id ? "Mencabut..." : "Cabut"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
