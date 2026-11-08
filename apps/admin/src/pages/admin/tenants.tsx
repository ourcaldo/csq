import { type FormEvent, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { Storefront, Plus, PauseCircle, PlayCircle } from "@phosphor-icons/react";

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
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Tenant</h2>
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus size={14} className="mr-1.5" /> Tenant Baru
          </Button>
        </div>
        {actionError && <p className="text-sm text-red-600">{actionError}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Memuat...</p>}

        {!loading && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Pengguna</TableHead>
                  <TableHead className="text-center">Saluran</TableHead>
                  <TableHead className="text-center">Percakapan</TableHead>
                  <TableHead className="text-center">Pesan 30d</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{t.name}</p>
                      <p className="text-xs text-slate-400">{t.slug}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === "ACTIVE" ? "default" : "destructive"}>
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{t.userCount}</TableCell>
                    <TableCell className="text-center">{t.channelCount}</TableCell>
                    <TableCell className="text-center">{t.conversationCount}</TableCell>
                    <TableCell className="text-center">{t.messageCount30d}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === t.id}
                        onClick={() => void toggleStatus(t.id, t.status)}
                      >
                        {t.status === "ACTIVE" ? (
                          <><PauseCircle size={14} className="mr-1" /> Tangguhkan</>
                        ) : (
                          <><PlayCircle size={14} className="mr-1" /> Aktifkan</>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-400">
                      <Storefront size={24} className="mx-auto mb-2 text-slate-300" />
                      Belum ada tenant.
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
                <h3 className="mb-4 text-base font-semibold text-slate-900">Tenant Baru</h3>
                <form onSubmit={createTenant} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="t-name">Nama</Label>
                      <Input id="t-name" required value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Toko Kopi Nusantara" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="t-slug">Slug</Label>
                      <Input id="t-slug" required value={form.slug}
                        onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                        placeholder="toko-kopi" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="t-email">Email Owner</Label>
                      <Input id="t-email" type="email" required value={form.ownerEmail}
                        onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                        placeholder="owner@tokokopi.id" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="t-oname">Nama Owner</Label>
                      <Input id="t-oname" required value={form.ownerName}
                        onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                        placeholder="Budi" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="t-pass">Password Owner</Label>
                    <Input id="t-pass" type="password" required minLength={8} value={form.ownerPassword}
                      onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                      placeholder="Minimal 8 karakter" />
                  </div>
                  {actionError && <p className="text-sm text-red-600">{actionError}</p>}
                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={busy === "create"} className="flex-1">
                      {busy === "create" ? "Membuat..." : "Buat Tenant"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                      Batal
                    </Button>
                  </div>
                </form>
              </Card>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
