import { type FormEvent, useState } from "react";
import { useSession } from "next-auth/react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { UsersThree, Plus, XCircle } from "@phosphor-icons/react";

type Admin = {
  id: string; email: string; name: string; createdAt: string;
};

type AdminList = { items: Admin[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AdminsPage() {
  const { data: session } = useSession();
  const { data, loading, error, refresh } = useAdminApi<AdminList>("/api/admin/admins");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", password: "" });

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

  const items = data?.items ?? [];
  const myId = session?.user?.id;

  return (
    <AdminShell title="Admin">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Admin</h2>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} className="mr-1.5" /> Admin Baru
          </Button>
        </div>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Memuat...</p>}

        {!loading && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium text-slate-900">
                      {a.name}
                      {a.id === myId && <Badge variant="outline" className="ml-2 text-xs">Anda</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{a.email}</TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {new Date(a.createdAt).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell>
                      {a.id !== myId && (
                        <Button variant="outline" size="sm" disabled={busy === a.id}
                          onClick={() => void removeAdmin(a.id)}>
                          <XCircle size={14} className="mr-1" /> Hapus
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-400">
                      <UsersThree size={24} className="mx-auto mb-2 text-slate-300" />
                      Tidak ada admin.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        )}

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md p-6">
              <h3 className="mb-4 text-base font-semibold text-slate-900">Admin Baru</h3>
              <form onSubmit={createAdmin} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Email</label>
                  <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    type="email" required value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="operator@csq.id" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Nama</label>
                  <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    required value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Nama Operator" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Password</label>
                  <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
            </Card>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
