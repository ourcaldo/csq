import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Empty, PageHead, TableCard } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

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

function Action({ value }: { value: string }) {
  const [prefix, ...rest] = value.split(".");
  const suffix = rest.join(".");
  const tone = value.includes("error") ? "text-bad" : "text-foreground";
  return (
    <span className={`font-mono text-[12.5px] ${tone}`}>
      <span className="text-muted-foreground">{prefix}.</span>
      {suffix}
    </span>
  );
}

export default function AuditPage() {
  const [tab, setTab] = useState<"tenant" | "admin">("tenant");
  const url = tab === "admin" ? "/api/admin/audit?auditType=admin" : "/api/admin/audit";
  const { data, loading, error } = useAdminApi<AuditData>(url);
  const items = data?.items ?? [];

  return (
    <AdminShell title="Audit">
      <PageHead
        eyebrow="Operasi"
        title="Audit"
        sub="Log aktivitas, terbaru di atas"
        action={
          <div className="flex rounded-full bg-card p-1 ring-1 ring-border">
            {(
              [
                ["tenant", "Aktivitas tenant"],
                ["admin", "Aksi admin"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-full px-3 py-1 text-[13px] transition-colors ${
                  tab === key
                    ? "bg-foreground font-medium text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}

      {!loading && items.length === 0 ? (
        <Empty
          title={tab === "admin" ? "Belum ada aksi admin" : "Belum ada aktivitas tenant"}
          hint={
            tab === "admin"
              ? "Setiap perubahan oleh operator tercatat di sini."
              : "Aktivitas agent dan staf akan muncul di sini."
          }
        />
      ) : (
        <TableCard>
          <table className="ledger">
            <thead>
              <tr>
                <th className="w-44">Waktu</th>
                <th>Aksi</th>
                {tab === "tenant" ? (
                  <>
                    <th>Entitas</th>
                    <th>Tenant</th>
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
                  <td className="whitespace-nowrap font-mono text-[12.5px] text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>
                    <Action value={a.action} />
                  </td>
                  {tab === "tenant" ? (
                    <>
                      <td className="text-[12.5px]">
                        {a.entityType}{" "}
                        <span className="font-mono text-muted-foreground">
                          {a.entityId ? `#${a.entityId.slice(0, 8)}` : ""}
                        </span>
                      </td>
                      <td className="text-[12.5px] text-muted-foreground">{a.tenantName}</td>
                      <td className="font-mono text-[12px] text-muted-foreground">
                        {a.customerPhone ?? "-"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <div className="text-[13px] font-medium">{a.adminName}</div>
                        <div className="text-[11.5px] text-muted-foreground">{a.adminEmail}</div>
                      </td>
                      <td className="text-[12.5px] text-muted-foreground">
                        {a.targetType}{" "}
                        <span className="font-mono">
                          {a.targetId ? `#${a.targetId.slice(0, 8)}` : ""}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {loading && (
                <tr>
                  <td
                    colSpan={tab === "tenant" ? 5 : 4}
                    className="py-12 text-center text-[13px] text-muted-foreground"
                  >
                    Memuat...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableCard>
      )}

      {data && data.total > data.pageSize && (
        <p className="mt-3 font-mono text-[11.5px] text-muted-foreground">
          Menampilkan {items.length} dari {data.total} entri
        </p>
      )}
    </AdminShell>
  );
}
