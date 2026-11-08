import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { ClipboardText, ShieldCheck } from "@phosphor-icons/react";

type AuditItem = {
  id: string; action: string; entityType: string; entityId: string | null;
  customerPhone: string | null; createdAt: string;
  tenantName?: string;
  adminEmail?: string; adminName?: string;
  targetType?: string; targetId?: string | null;
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
      <div className="space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("tenant")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${tab === "tenant" ? "bg-white text-slate-900 shadow-md shadow-slate-200/50 ring-1 ring-slate-200" : "text-slate-400 hover:bg-white/50 hover:text-slate-600"}`}
          >
            <ClipboardText size={15} /> Aktivitas Tenant
          </button>
          <button
            onClick={() => setTab("admin")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${tab === "admin" ? "bg-white text-slate-900 shadow-md shadow-slate-200/50 ring-1 ring-slate-200" : "text-slate-400 hover:bg-white/50 hover:text-slate-600"}`}
          >
            <ShieldCheck size={15} /> Aksi Admin
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Card key={i} className="animate-pulse p-4"><div className="h-4 w-64 rounded bg-slate-200" /></Card>)}
          </div>
        )}

        {!loading && (
          <Card className="overflow-hidden">
            <div className="divide-y divide-slate-50">
              {items.map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50/50">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    {tab === "tenant" ? <ClipboardText size={14} /> : <ShieldCheck size={14} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <code className="text-xs font-semibold text-slate-800">{a.action}</code>
                      {tab === "tenant" && (
                        <span className="text-xs text-slate-400">{a.tenantName}</span>
                      )}
                      {tab === "admin" && (
                        <span className="text-xs font-medium text-slate-600">{a.adminName}</span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      {tab === "tenant"
                        ? `${a.entityType}${a.entityId ? ` / ${a.entityId.slice(0, 8)}...` : ""}${a.customerPhone ? ` / ${a.customerPhone}` : ""}`
                        : `${a.targetType}${a.targetId ? ` / ${a.targetId.slice(0, 8)}...` : ""}`
                      }
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-300">
                    {new Date(a.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
            {items.length === 0 && (
              <div className="flex flex-col items-center py-16">
                <ClipboardText size={36} className="mb-3 text-slate-200" />
                <p className="text-sm text-slate-400">Belum ada aktivitas</p>
              </div>
            )}
          </Card>
        )}

        {data && data.total > data.pageSize && (
          <p className="text-center text-xs text-slate-300">
            Menampilkan {items.length} dari {data.total} entri
          </p>
        )}
      </div>
    </AdminShell>
  );
}
