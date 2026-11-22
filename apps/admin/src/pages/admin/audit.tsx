import { Fragment, useState } from "react";
import { Funnel } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

// Immutable audit trail (template viewAudit 1:1): tab switch between tenant
// activity and operator actions, text filter, expandable before/after diffs.

type AuditItem = {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string | null;
  customerPhone?: string | null;
  tenantName?: string;
  adminEmail?: string;
  adminName?: string | null;
  targetType?: string;
  targetId?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  createdAt: string;
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function Action({ value }: { value: string }) {
  const [prefix, ...rest] = value.split(".");
  const suffix = rest.join(".");
  return (
    <span className={`font-mono text-xs font-medium ${suffix.includes("error") ? "text-red-600" : "text-slate-900"}`}>
      <span className="text-slate-400">{prefix}.</span>
      {suffix}
    </span>
  );
}

export default function AuditPage() {
  const [tab, setTab] = useState<"tenant" | "admin">("tenant");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, loading, error } = useAdminApi<{ items: AuditItem[]; total: number }>(
    `/api/admin/audit?auditType=${tab}`
  );

  const items = (data?.items ?? []).filter((r) =>
    !q || r.action.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <AdminShell title="Audit Log">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Immutable Audit Trail</h1>
          <p className="mt-1 text-xs text-slate-500">
            Chronological record of tenant mutations and super-admin control plane operations.
          </p>
        </div>
        <div className="relative">
          <Funnel size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter event or actor..."
            className="h-8 w-56 rounded-md border border-slate-300 bg-card pl-8 pr-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between border-b border-slate-200">
        <div className="flex gap-6">
          <button
            type="button"
            onClick={() => {
              setTab("tenant");
              setExpanded(null);
            }}
            className={`tab-btn ${tab === "tenant" ? "active" : ""}`}
          >
            Tenant Activity
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("admin");
              setExpanded(null);
            }}
            className={`tab-btn ${tab === "admin" ? "active" : ""}`}
          >
            Operator Actions
          </button>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          Showing {items.length} of {data?.total ?? 0} entries
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-3 pr-4">Timestamp</th>
              <th className="px-4 py-3">Event</th>
              {tab === "tenant" ? (
                <>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Tenant</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3">Target</th>
                </>
              )}
              <th className="py-3 pl-4 text-right">Diff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 border-b border-slate-200">
            {loading && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-xs text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {items.map((r) => {
              const isOpen = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap py-3.5 pr-4 font-mono text-slate-500">
                      {new Date(r.createdAt).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3.5">
                      <Action value={r.action} />
                    </td>
                    {tab === "tenant" ? (
                      <>
                        <td className="px-4 py-3.5 text-slate-800">{r.entityType ?? "-"}</td>
                        <td className="px-4 py-3.5 text-slate-500">
                          {r.tenantName} <span className="font-mono text-[11px]">({r.customerPhone ?? "-"})</span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3.5">
                          <span className="font-semibold text-slate-900">{r.adminName ?? "-"}</span>{" "}
                          <span className="font-mono text-[11px] text-slate-400">{r.adminEmail ?? ""}</span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">
                          {r.targetType} {r.targetId ? <span className="font-mono">#{r.targetId.slice(0, 8)}</span> : null}
                        </td>
                      </>
                    )}
                    <td className="py-3.5 pl-4 text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        {isOpen ? "Close" : "Values"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/80">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 font-mono text-[10px] font-semibold uppercase text-slate-400">Before</p>
                            <pre className="rounded border border-slate-200 bg-card p-2.5 font-mono text-[11px] text-slate-600">
                              {r.beforeValue ? JSON.stringify(r.beforeValue, null, 2) : "null"}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 font-mono text-[10px] font-semibold uppercase text-slate-400">After</p>
                            <pre className="rounded border border-slate-200 bg-card p-2.5 font-mono text-[11px] text-slate-800">
                              {r.afterValue ? JSON.stringify(r.afterValue, null, 2) : "null"}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-xs text-slate-400">
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
