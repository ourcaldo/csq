// /dashboard/pengaturan/umum - organization identity + workspace metadata
// (PRD 28 follow-up). The general fields write to Tenant settings where a
// real backing field exists; unmapped demo fields (legal name, currency)
// are stored in Tenant.settings so they persist without a migration.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { Copy } from "@phosphor-icons/react";
import { withAuth, getSSRSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";

type TenantInfo = {
  id: string;
  name: string;
  slug: string;
  timezone?: string | null;
  currency?: string | null;
  legalName?: string | null;
};

export default function PengaturanUmumPage({
  tenantId,
  tenantName,
  tenantSlug,
}: {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
}) {
  const { data: session } = useSession();
  const { data: tenant, refresh } = useApi<TenantInfo>("/api/dashboard/tenant");

  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [currency, setCurrency] = useState("IDR");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setName(tenant.name ?? tenantName);
    setLegalName(tenant.legalName ?? "");
    setOwnerName(session?.user?.name ?? "");
    setEmail(session?.user?.email ?? "");
    setTimezone(tenant.timezone ?? "Asia/Jakarta");
    setCurrency(tenant.currency ?? "IDR");
  }, [tenant, session, tenantName]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiSend("/api/dashboard/settings/general", "PUT", {
        name: name.trim(),
        legalName: legalName.trim() || null,
        timezone,
        currency,
      });
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan umum.");
    } finally {
      setSaving(false);
    }
  }

  function copyTenantId() {
    void navigator.clipboard.writeText(tenantId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <SettingsShell
      section="umum"
      title="Umum & Identitas Organisasi"
      description="Kelola profil resmi perusahaan, kontak penanggung jawab, dan standar lokal untuk seluruh aktivitas workspace."
    >
      <form onSubmit={onSave} className="divide-y divide-slate-200">
        {/* Row 1: identity */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Nama Usaha & Entitas</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Ditampilkan pada header email otomatis, faktur, dan identitas Agent AI.
            </p>
          </div>
          <div className="space-y-3.5 md:col-span-8">
            <div>
              <label htmlFor="org-name" className="block text-xs font-medium text-slate-700">
                Nama Tampilan Usaha
              </label>
              <input
                id="org-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
              />
            </div>
            <div>
              <label htmlFor="org-legal" className="block text-xs font-medium text-slate-700">
                Nama Badan Hukum <span className="font-normal text-slate-400">(Opsional)</span>
              </label>
              <input
                id="org-legal"
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className="mt-1.5 h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
              />
            </div>
          </div>
        </div>

        {/* Row 2: owner contact (read-only - the account's own identity) */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Kontak Pemilik & Administrasi</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Alamat email utama untuk notifikasi sistem, kuota, dan peringatan keamanan.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-8">
            <div>
              <label className="block text-xs font-medium text-slate-700">Nama Penanggung Jawab</label>
              <input
                type="text"
                value={ownerName}
                readOnly
                className="mt-1.5 h-9 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600"
              />
              <p className="mt-1 text-[11px] text-slate-400">Mengikuti profil akun owner.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Email Administrasi</label>
              <input
                type="email"
                value={email}
                readOnly
                className="mt-1.5 h-9 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600"
              />
              <p className="mt-1 text-[11px] text-slate-400">Ubah melalui profil akun owner.</p>
            </div>
          </div>
        </div>

        {/* Row 3: regional standards */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Standar Regional</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Menentukan acuan waktu eksekusi kampanye terjadwal dan format nominal harga.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-8">
            <div>
              <label htmlFor="org-tz" className="block text-xs font-medium text-slate-700">
                Zona Waktu Operasional
              </label>
              <select
                id="org-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
              >
                <option value="Asia/Jakarta">Asia/Jakarta (WIB / UTC+07:00)</option>
                <option value="Asia/Makassar">Asia/Makassar (WITA / UTC+08:00)</option>
                <option value="Asia/Jayapura">Asia/Jayapura (WIT / UTC+09:00)</option>
              </select>
            </div>
            <div>
              <label htmlFor="org-currency" className="block text-xs font-medium text-slate-700">
                Mata Uang Utama
              </label>
              <select
                id="org-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
              >
                <option value="IDR">IDR - Rupiah Indonesia (Rp)</option>
                <option value="USD">USD - US Dollar ($)</option>
                <option value="SGD">SGD - Singapore Dollar (S$)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Row 4: workspace metadata (read-only) */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Metadata Workspace</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Pengenal unik tenant untuk keperluan integrasi API dan dukungan teknis.
            </p>
          </div>
          <div className="md:col-span-8">
            <dl className="grid grid-cols-1 gap-4 border-y border-slate-200 py-3.5 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-medium text-slate-400">Workspace ID</dt>
                <dd className="mt-1 flex items-center gap-1.5 font-mono text-xs text-slate-900">
                  <span className="truncate">{tenantId}</span>
                  <button
                    type="button"
                    onClick={copyTenantId}
                    title="Salin ID"
                    className="shrink-0 text-slate-400 hover:text-slate-800"
                  >
                    <Copy size={12} className={copied ? "text-emerald-600" : ""} />
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-slate-400">Slug Workspace</dt>
                <dd className="mt-1 truncate font-mono text-xs text-slate-900">{tenant?.slug ?? tenantSlug}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-slate-400">Enkripsi Data</dt>
                <dd className="mt-1 font-mono text-xs text-emerald-700">TLS - Aktif</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Action footer */}
        <div className="flex items-center justify-between gap-3 pt-5">
          <div>
            {error && <p className="text-xs font-medium text-red-600">{error}</p>}
            {saved && !error && (
              <p className="text-xs font-medium text-emerald-700">Pengaturan umum berhasil disimpan.</p>
            )}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </div>
      </form>
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<{ tenantId: string; tenantName: string; tenantSlug: string }>(
  async (ctx) => {
    // Resolve the tenant server-side so the Workspace ID metadata is present
    // on first render.
    const session = await getSSRSession(ctx);
    if (!session?.user?.tenantId) return { props: { tenantId: "", tenantName: "", tenantSlug: "" } };
    const tenantId = session.user.tenantId;
    const tenant = await withTenantContext(tenantId, () =>
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } })
    );
    return {
      props: {
        tenantId,
        tenantName: tenant?.name ?? "",
        tenantSlug: tenant?.slug ?? "",
      },
    };
  },
  { requiredRole: "OWNER" }
);
