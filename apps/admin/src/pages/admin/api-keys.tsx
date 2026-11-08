import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
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
  const items = data?.items ?? [];
  const active = items.filter((k) => !k.revokedAt).length;

  async function revoke(id: string) {
    setBusy(id);
    try {
      await adminFetch(`/api/admin/api-keys?id=${id}`, "DELETE");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Kunci API">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-2">
            <Key size={14} className="text-green-600" />
            <span className="text-sm font-bold text-green-700">{active} Aktif</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2">
            <XCircle size={14} className="text-slate-400" />
            <span className="text-sm font-bold text-slate-500">{items.length - active} Dicabut</span>
          </div>
        </div>

        {error && <Card className="border-red-200 bg-red-50 p-3"><p className="text-sm text-red-700">{error}</p></Card>}
        {loading && <div className="space-y-2">{[1, 2].map((i) => <Card key={i} className="animate-pulse p-5"><div className="h-5 w-40 rounded bg-slate-200" /></Card>)}</div>}

        {!loading && items.length > 0 && (
          <div className="space-y-2">
            {items.map((k) => (
              <Card key={k.id} className={`p-4 ${k.revokedAt ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      k.revokedAt ? "bg-slate-100 text-slate-300" : "bg-gradient-to-br from-slate-700 to-slate-900 text-white"
                    }`}>
                      <Key size={18} />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{k.name}</p>
                        {!k.revokedAt && <Badge variant="default" className="text-[9px] font-bold uppercase">AKTIF</Badge>}
                        {k.revokedAt && <Badge variant="destructive" className="text-[9px] font-bold uppercase">REVOKED</Badge>}
                      </div>
                      <p className="text-xs text-slate-400">
                        <code className="font-mono">{k.prefix}...</code>
                        <span className="mx-1">/</span>
                        {k.tenantName}
                        <span className="mx-1">/</span>
                        {k.lastUsedAt ? `Dipakai ${new Date(k.lastUsedAt).toLocaleDateString("id-ID")}` : "Belum pernah dipakai"}
                      </p>
                    </div>
                  </div>
                  {!k.revokedAt && (
                    <Button variant="outline" size="sm" disabled={busy === k.id}
                      onClick={() => void revoke(k.id)}
                      className="border-red-200 text-red-600 hover:bg-red-50">
                      <XCircle size={14} className="mr-1" /> Cabut
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <Card className="flex flex-col items-center py-16">
            <Key size={40} className="mb-3 text-slate-200" />
            <p className="text-sm text-slate-400">Belum ada kunci API</p>
            <p className="text-xs text-slate-300">Tenant membuat kunci dari dashboard mereka</p>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
