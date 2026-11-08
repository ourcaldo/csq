import { type FormEvent, useState } from "react";
import { useSession } from "next-auth/react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Plus, X } from "@phosphor-icons/react";

type Admin = { id: string; email: string; name: string; createdAt: string };
type AdminList = { items: Admin[] };

const EMPTY_FORM = { email: "", name: "", password: "" };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AdminsPage() {
  const { data: session } = useSession();
  const { data, loading, error, refresh } = useAdminApi<AdminList>("/api/admin/admins");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const items = data?.items ?? [];
  const myId = session?.user?.id;

  async function createAdmin(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setFormError(null);
    try {
      await adminFetch("/api/admin/admins", "POST", form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
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
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-slate-500">{items.length} operator platform.</p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} weight="bold" className="mr-1.5" />
            Admin baru
          </Button>
        </div>

        {(formError || error) && (
          <div className="rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-2.5 text-[13px] text-red-700">
            {formError ?? error}
          </div>
        )}

        <div className="panel overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Ditambahkan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="font-medium text-slate-900">{a.name}</span>
                    {a.id === myId && (
                      <span className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">
                        Anda
                      </span>
                    )}
                  </td>
                  <td className="text-[12px] text-slate-600">{a.email}</td>
                  <td className="whitespace-nowrap text-[12px] text-slate-500">
                    {new Date(a.createdAt).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="text-right">
                    {a.id !== myId && (
                      <button
                        disabled={busy === a.id}
                        onClick={() => void removeAdmin(a.id)}
                        className="text-[12px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-[13px] text-slate-400">
                    Tidak ada admin.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-[13px] text-slate-400">
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
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="text-[14px] font-semibold text-slate-900">Admin baru</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={createAdmin} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="a-email">Email</Label>
                <Input
                  id="a-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="operator@csq.id"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-name">Nama</Label>
                <Input
                  id="a-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Nama operator"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-pass">Password</Label>
                <Input
                  id="a-pass"
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Minimal 8 karakter"
                />
              </div>
              {formError && <p className="text-[13px] text-red-600">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Menambah..." : "Tambah admin"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
