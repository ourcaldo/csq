import { type FormEvent, useState } from "react";
import { useSession } from "next-auth/react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { UsersThree, Plus, XCircle, X } from "@phosphor-icons/react";

type Admin = { id: string; email: string; name: string; createdAt: string };
type AdminList = { items: Admin[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AdminsPage() {
  const { data: session } = useSession();
  const { data, loading, error, refresh } = useAdminApi<AdminList>("/api/admin/admins");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const items = data?.items ?? [];
  const myId = session?.user?.id;

  async function createAdmin(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setFormError(null);
    try {
      await adminFetch("/api/admin/admins", "POST", form);
      setShowCreate(false);
      setForm({ email: "", name: "", password: "" });
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menambah admin.");
    } finally {
      setBusy(null);
    }
  }

  async function removeAdmin(id: string) {
    setBusy(id);
    setFormError(null);
    try {
      await adminFetch(`/api/admin/admins?id=${id}`, "DELETE");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus admin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Admin">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">Kelola operator platform</p>
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus size={14} className="mr-1.5" /> Admin Baru
          </Button>
        </div>

        {formError && <Card className="border-red-200 bg-red-50 p-3"><p className="text-sm text-red-700">{formError}</p></Card>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <Card className="animate-pulse p-6"><div className="h-5 w-48 rounded bg-slate-200" /></Card>}

        {!loading && items.length > 0 && (
          <div className="space-y-2">
            {items.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold text-white shadow-sm ${
                      a.id === myId ? "bg-gradient-to-br from-green-500 to-green-700" : "bg-gradient-to-br from-slate-500 to-slate-700"
                    }`}>
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{a.name}</p>
                        {a.id === myId && <Badge variant="outline" className="border-green-200 bg-green-50 text-[9px] font-bold text-green-700 uppercase">Anda</Badge>}
                      </div>
                      <p className="text-xs text-slate-400">{a.email}</p>
                    </div>
                  </div>
                  {a.id !== myId && (
                    <Button variant="outline" size="sm" disabled={busy === a.id}
                      onClick={() => void removeAdmin(a.id)}
                      className="border-red-200 text-red-600 hover:bg-red-50">
                      <XCircle size={14} className="mr-1" /> Hapus
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <Card className="flex flex-col items-center py-16">
            <UsersThree size={40} className="mb-3 text-slate-200" />
            <p className="text-sm text-slate-400">Tidak ada admin</p>
          </Card>
        )}

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <Card className="w-full max-w-md overflow-hidden shadow-2xl">
              <div className="h-1.5 bg-gradient-to-r from-green-500 to-green-700" />
              <div className="p-6">
                <div className="mb-5 flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">Admin Baru</h3>
                  <button onClick={() => setShowCreate(false)} className="text-slate-300 hover:text-slate-500">
                    <X size={18} />
                  </button>
                </div>
                <form onSubmit={createAdmin} className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Email</label>
                    <input className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-green-300 focus:outline-none focus:ring-2 focus:ring-green-100"
                      type="email" required value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="operator@csq.id" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Nama</label>
                    <input className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-green-300 focus:outline-none focus:ring-2 focus:ring-green-100"
                      required value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Nama Operator" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Password</label>
                    <input className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-green-300 focus:outline-none focus:ring-2 focus:ring-green-100"
                      type="password" required minLength={8} value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Minimal 8 karakter" />
                  </div>
                  {formError && <p className="text-sm text-red-600">{formError}</p>}
                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={busy === "create"} className="flex-1">
                      {busy === "create" ? "Menambah..." : "Tambah Admin"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Batal</Button>
                  </div>
                </form>
              </div>
            </Card>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
