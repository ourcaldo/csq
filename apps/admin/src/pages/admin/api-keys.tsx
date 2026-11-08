import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { Key, XCircle } from "@phosphor-icons/react";

type ApiKey = {
  id: string; name: string; prefix: string;
  tenantName: string; tenantSlug: string;
  lastUsedAt: string | null; revokedAt: string | null; createdAt: string;
};

type KeyList = { items: ApiKey[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function ApiKeysPage() {
  const { data, loading, error, refresh } = useAdminApi<KeyList>("/api/admin/api-keys");
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(id);
    try {
      await adminFetch(`/api/admin/api-keys?id=${id}`, "DELETE");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <AdminShell title="Kunci API">
      <div className="mx-auto max-w-6xl space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Kunci API</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Memuat...</p>}

        {!loading && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Terakhir Dipakai</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium text-slate-900">{k.name}</TableCell>
                    <TableCell>
                      <p className="text-sm">{k.tenantName}</p>
                      <p className="text-xs text-slate-400">{k.tenantSlug}</p>
                    </TableCell>
                    <TableCell><code className="text-xs">{k.prefix}...</code></TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("id-ID") : "Belum pernah"}
                    </TableCell>
                    <TableCell>
                      {k.revokedAt ? (
                        <Badge variant="destructive">REVOKED</Badge>
                      ) : (
                        <Badge variant="default">AKTIF</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!k.revokedAt && (
                        <Button variant="outline" size="sm" disabled={busy === k.id}
                          onClick={() => void revoke(k.id)}>
                          <XCircle size={14} className="mr-1" /> Cabut
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-400">
                      <Key size={24} className="mx-auto mb-2 text-slate-300" />
                      Belum ada kunci API.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
