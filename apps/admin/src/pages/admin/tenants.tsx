import { type FormEvent, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusDot } from "@/components/status-dot";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Plus, X } from "@phosphor-icons/react";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  userCount: number;
  channelCount: number;
  conversationCount: number;
  messageCount30d: number;
  mediaBytes: number;
};
type TenantList = { items: Tenant[] };

const EMPTY_FORM = { name: "", slug: "", ownerEmail: "", ownerName: "", ownerPassword: "" };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function TenantsPage() {
  const { data, loading, error, refresh } = useAdminApi<TenantList>("/api/admin/tenants");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  async function createTenant(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setActionError(null);
    try {
      await adminFetch("/api/admin/tenants", "POST", form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal membuat tenant.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus(id: string, current: string) {
    setBusy(id);
    setActionError(null);
    try {
      await adminFetch(`/api/admin/tenants/${id}`, "POST", {
        action: current === "ACTIVE" ? "suspend" : "activate",
      });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <AdminShell title="Tenant">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-slate-500">
            {items.length} tenant terdaftar di platform.
          </p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} weight="bold" className="mr-1.5" />
            Tenant baru
          </Button>
        </div>

        {actionError && (
          <div className="rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-2.5 text-[13px] text-red-700">
            {actionError}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-2.5 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="panel overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Status</th>
                <th className="text-right">Pengguna</th>
                <th className="text-right">Saluran</th>
                <th className="text-right">Percakapan</th>
                <th className="text-right">Pesan 30h</th>
                <th>Dibuat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <p className="font-medium text-slate-900">{t.name}</p>
                    <p className="text-[11px] text-slate-400">{t.slug}</p>
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone={t.status === "ACTIVE" ? "ok" : "bad"} />
                      {t.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{t.userCount}</td>
                  <td className="text-right tabular-nums">{t.channelCount}</td>
                  <td className="text-right tabular-nums">{t.conversationCount}</td>
                  <td className="text-right tabular-nums">{t.messageCount30d}</td>
                  <td className="whitespace-nowrap text-[12px] text-slate-500">
                    {new Date(t.createdAt).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="text-right">
                    <button
                      disabled={busy === t.id}
                      onClick={() => void toggleStatus(t.id, t.status)}
                      className={
                        t.status === "ACTIVE"
                          ? "text-[12px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          : "text-[12px] font-medium text-green-700 hover:text-green-800 disabled:opacity-50"
                      }
                    >
                      {t.status === "ACTIVE" ? "Tangguhkan" : "Aktifkan"}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-[13px] text-slate-400">
                    Belum ada tenant. Buat tenant pertama untuk mulai.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-[13px] text-slate-400">
                    Memuat...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 pt-16">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900">Tenant baru</h2>
                <p className="text-[11px] text-slate-400">Membuat tenant dan akun owner.</p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={createTenant} className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-name">Nama tenant</Label>
                  <Input
                    id="t-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Toko Kopi Nusantara"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-slug">Slug</Label>
                  <Input
                    id="t-slug"
                    required
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                    placeholder="toko-kopi"
                    className="font-mono text-[13px]"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400">
                  Akun owner
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="t-email">Email</Label>
                    <Input
                      id="t-email"
                      type="email"
                      required
                      value={form.ownerEmail}
                      onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                      placeholder="owner@tokokopi.id"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="t-oname">Nama</Label>
                    <Input
                      id="t-oname"
                      required
                      value={form.ownerName}
                      onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                      placeholder="Budi Santoso"
                    />
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="t-pass">Password</Label>
                  <Input
                    id="t-pass"
                    type="password"
                    required
                    minLength={8}
                    value={form.ownerPassword}
                    onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                    placeholder="Minimal 8 karakter"
                  />
                </div>
              </div>

              {actionError && <p className="text-[13px] text-red-600">{actionError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Membuat..." : "Buat tenant"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
