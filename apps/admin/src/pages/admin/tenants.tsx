import { type FormEvent, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import {
  Storefront, Plus, PauseCircle, PlayCircle, UsersThree,
  ChatCircleDots, ChatCircleText, FileArrowUp, X,
} from "@phosphor-icons/react";

type Tenant = {
  id: string; name: string; slug: string; status: string; createdAt: string;
  userCount: number; channelCount: number; conversationCount: number;
  messageCount30d: number; mediaBytes: number;
};
type TenantList = { items: Tenant[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function TenantsPage() {
  const { data, loading, error, refresh } = useAdminApi<TenantList>("/api/admin/tenants");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", ownerEmail: "", ownerName: "", ownerPassword: "" });

  async function createTenant(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setActionError(null);
    try {
      await adminFetch("/api/admin/tenants", "POST", form);
      setShowCreate(false);
      setForm({ name: "", slug: "", ownerEmail: "", ownerName: "", ownerPassword: "" });
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
      <div className="space-y-6">
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Kelola tenant platform</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} weight="bold" className="mr-1.5" />
            Tenant Baru
          </Button>
        </div>

        {actionError && (
          <Card className="border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{actionError}</p>
          </Card>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse p-6">
                <div className="h-5 w-32 rounded bg-slate-200" />
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-12 rounded-lg bg-slate-100" />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Tenant cards */}
        {!loading && items.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((t) => (
              <Card key={t.id} className="overflow-hidden">
                {/* Status bar */}
                <div className={`h-1.5 w-full ${t.status === "ACTIVE" ? "bg-gradient-to-r from-green-400 to-green-600" : "bg-gradient-to-r from-red-400 to-red-600"}`} />

                <div className="p-5">
                  {/* Header */}
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white shadow-sm ${t.status === "ACTIVE" ? "bg-gradient-to-br from-green-500 to-green-700" : "bg-gradient-to-br from-slate-400 to-slate-600"}`}>
                        {t.name.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-semibold text-slate-900">{t.name}</p>
                        <p className="text-xs text-slate-400">{t.slug}</p>
                      </div>
                    </div>
                    <Badge variant={t.status === "ACTIVE" ? "default" : "destructive"} className="text-[10px] font-bold uppercase tracking-wide">
                      {t.status}
                    </Badge>
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                      <UsersThree size={14} className="mx-auto mb-0.5 text-blue-500" />
                      <p className="text-base font-bold text-slate-800">{t.userCount}</p>
                      <p className="text-[9px] font-medium uppercase text-slate-400">User</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                      <ChatCircleDots size={14} className="mx-auto mb-0.5 text-violet-500" />
                      <p className="text-base font-bold text-slate-800">{t.channelCount}</p>
                      <p className="text-[9px] font-medium uppercase text-slate-400">Saluran</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                      <ChatCircleText size={14} className="mx-auto mb-0.5 text-amber-500" />
                      <p className="text-base font-bold text-slate-800">{t.conversationCount}</p>
                      <p className="text-[9px] font-medium uppercase text-slate-400">Chat</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                      <FileArrowUp size={14} className="mx-auto mb-0.5 text-green-500" />
                      <p className="text-base font-bold text-slate-800">{t.messageCount30d}</p>
                      <p className="text-[9px] font-medium uppercase text-slate-400">30d</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <p className="text-[11px] text-slate-300">
                      Sejak {new Date(t.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                    <Button
                      variant={t.status === "ACTIVE" ? "outline" : "default"}
                      size="sm"
                      disabled={busy === t.id}
                      onClick={() => void toggleStatus(t.id, t.status)}
                      className={t.status === "ACTIVE" ? "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" : ""}
                    >
                      {t.status === "ACTIVE" ? (
                        <><PauseCircle size={14} className="mr-1" /> Tangguhkan</>
                      ) : (
                        <><PlayCircle size={14} className="mr-1" /> Aktifkan</>
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && items.length === 0 && (
          <Card className="flex flex-col items-center justify-center py-16">
            <Storefront size={40} className="mb-3 text-slate-200" />
            <p className="text-sm font-medium text-slate-500">Belum ada tenant</p>
            <p className="mb-4 text-xs text-slate-400">Buat tenant pertama untuk mulai mengelola platform</p>
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus size={14} className="mr-1.5" /> Tenant Baru
            </Button>
          </Card>
        )}
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="h-1.5 bg-gradient-to-r from-green-500 to-green-700" />
            <div className="p-6">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-green-700">
                    <Storefront size={20} />
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Tenant Baru</h3>
                    <p className="text-xs text-slate-400">Membuat tenant + akun owner</p>
                  </div>
                </div>
                <button onClick={() => setShowCreate(false)} className="text-slate-300 hover:text-slate-500">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={createTenant} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="t-name">Nama Tenant</Label>
                    <Input id="t-name" required value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Toko Kopi Nusantara" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="t-slug">Slug</Label>
                    <Input id="t-slug" required value={form.slug}
                      onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                      placeholder="toko-kopi" className="font-mono text-sm" />
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-300">Akun Owner</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="t-email">Email</Label>
                      <Input id="t-email" type="email" required value={form.ownerEmail}
                        onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                        placeholder="owner@tokokopi.id" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="t-oname">Nama</Label>
                      <Input id="t-oname" required value={form.ownerName}
                        onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                        placeholder="Budi Santoso" />
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor="t-pass">Password</Label>
                    <Input id="t-pass" type="password" required minLength={8} value={form.ownerPassword}
                      onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                      placeholder="Minimal 8 karakter" />
                  </div>
                </div>
                {actionError && <p className="text-sm text-red-600">{actionError}</p>}
                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={busy === "create"} className="flex-1">
                    {busy === "create" ? "Membuat..." : "Buat Tenant"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Batal</Button>
                </div>
              </form>
            </div>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
