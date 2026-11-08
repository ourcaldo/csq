import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { ClipboardText } from "@phosphor-icons/react";

type AuditItem = {
  id: string; action: string; entityType: string; entityId: string | null;
  customerPhone: string | null; createdAt: string;
  tenantName?: string; agentId?: string | null;
  adminEmail?: string; adminName?: string;
  targetType?: string; targetId?: string | null;
  beforeValue?: unknown; afterValue?: unknown;
};

type AuditData = { items: AuditItem[]; total: number; page: number; pageSize: number };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AuditPage() {
  const [tab, setTab] = useState<"tenant" | "admin">("tenant");
  const url = tab === "admin"
    ? "/api/admin/audit?auditType=admin"
    : "/api/admin/audit";
  const { data, loading, error } = useAdminApi<AuditData>(url);

  const items = data?.items ?? [];

  return (
    <AdminShell title="Audit">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Audit</h2>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setTab("tenant")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "tenant" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Aktivitas Tenant
            </button>
            <button
              onClick={() => setTab("admin")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "admin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Aksi Admin
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Memuat...</p>}

        {!loading && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  {tab === "tenant" ? (
                    <>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Aksi</TableHead>
                      <TableHead>Entitas</TableHead>
                      <TableHead>Waktu</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>Operator</TableHead>
                      <TableHead>Aksi</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Waktu</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.id}>
                    {tab === "tenant" ? (
                      <>
                        <TableCell className="text-sm">{a.tenantName ?? "-"}</TableCell>
                        <TableCell><code className="text-xs">{a.action}</code></TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {a.entityType}{a.entityId ? ` / ${a.entityId.slice(0, 8)}...` : ""}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {new Date(a.createdAt).toLocaleString("id-ID")}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>
                          <p className="text-sm font-medium">{a.adminName}</p>
                          <p className="text-xs text-slate-400">{a.adminEmail}</p>
                        </TableCell>
                        <TableCell><code className="text-xs">{a.action}</code></TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {a.targetType}{a.targetId ? ` / ${a.targetId.slice(0, 8)}...` : ""}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {new Date(a.createdAt).toLocaleString("id-ID")}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-slate-400">
                      <ClipboardText size={24} className="mx-auto mb-2 text-slate-300" />
                      Belum ada aktivitas.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        )}
        {data && data.total > data.pageSize && (
          <p className="text-center text-xs text-slate-400">
            Menampilkan {items.length} dari {data.total} entri
          </p>
        )}
      </div>
    </AdminShell>
  );
}
