import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusDot } from "@/components/status-dot";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  tenantName: string;
  tenantSlug: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
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
      <div className="space-y-4">
        <p className="text-[13px] text-slate-500">
          {active} aktif, {items.length - active} dicabut. Kunci dibuat tenant dari dashboard
          mereka.
        </p>

        {error && (
          <div className="rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-2.5 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="panel overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Prefix</th>
                <th>Tenant</th>
                <th>Terakhir dipakai</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium text-slate-900">{k.name}</td>
                  <td className="font-mono text-[11px]">{k.prefix}...</td>
                  <td>
                    <p>{k.tenantName}</p>
                    <p className="text-[11px] text-slate-400">{k.tenantSlug}</p>
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-slate-500">
                    {k.lastUsedAt
                      ? new Date(k.lastUsedAt).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "Belum pernah"}
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone={k.revokedAt ? "idle" : "ok"} />
                      {k.revokedAt ? "Dicabut" : "Aktif"}
                    </span>
                  </td>
                  <td className="text-right">
                    {!k.revokedAt && (
                      <button
                        disabled={busy === k.id}
                        onClick={() => void revoke(k.id)}
                        className="text-[12px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        Cabut
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[13px] text-slate-400">
                    Belum ada kunci API.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[13px] text-slate-400">
                    Memuat...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
