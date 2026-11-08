import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";
import { cn } from "@csq/ui/lib/utils";

type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  customerPhone: string | null;
  createdAt: string;
  tenantName?: string;
  adminEmail?: string;
  adminName?: string;
  targetType?: string;
  targetId?: string | null;
};
type AuditData = { items: AuditItem[]; total: number; page: number; pageSize: number };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AuditPage() {
  const [tab, setTab] = useState<"tenant" | "admin">("tenant");
  const url = tab === "admin" ? "/api/admin/audit?auditType=admin" : "/api/admin/audit";
  const { data, loading, error } = useAdminApi<AuditData>(url);
  const items = data?.items ?? [];

  return (
    <AdminShell title="Audit">
      <div className="space-y-4">
        <div className="flex gap-5 border-b border-slate-200">
          {(
            [
              ["tenant", "Aktivitas tenant"],
              ["admin", "Aksi admin"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px border-b-2 pb-2 text-[13px] transition-colors",
                tab === key
                  ? "border-green-700 font-medium text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-2.5 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="panel overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Aksi</th>
                {tab === "tenant" ? (
                  <>
                    <th>Tenant</th>
                    <th>Target</th>
                    <th>Nomor</th>
                  </>
                ) : (
                  <>
                    <th>Admin</th>
                    <th>Target</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-[12px] text-slate-500">
                    {new Date(a.createdAt).toLocaleString("id-ID", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="font-mono text-[11px] text-slate-800">{a.action}</td>
                  {tab === "tenant" ? (
                    <>
                      <td>{a.tenantName}</td>
                      <td className="text-[12px] text-slate-500">
                        {a.entityType}
                        {a.entityId ? ` / ${a.entityId.slice(0, 8)}` : ""}
                      </td>
                      <td className="text-[12px] text-slate-500">{a.customerPhone ?? "-"}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        <p className="font-medium text-slate-900">{a.adminName}</p>
                        <p className="text-[11px] text-slate-400">{a.adminEmail}</p>
                      </td>
                      <td className="text-[12px] text-slate-500">
                        {a.targetType}
                        {a.targetId ? ` / ${a.targetId.slice(0, 8)}` : ""}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={tab === "tenant" ? 5 : 4}
                    className="py-10 text-center text-[13px] text-slate-400"
                  >
                    Belum ada aktivitas.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td
                    colSpan={tab === "tenant" ? 5 : 4}
                    className="py-10 text-center text-[13px] text-slate-400"
                  >
                    Memuat...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > data.pageSize && (
          <p className="text-[11px] text-slate-400">
            Menampilkan {items.length} dari {data.total} entri.
          </p>
        )}
      </div>
    </AdminShell>
  );
}
