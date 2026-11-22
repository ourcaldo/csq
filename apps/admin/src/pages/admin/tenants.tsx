import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, MagnifyingGlass, X } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, Segmented, btnPrimary } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

// Tenant directory (template viewTenants 1:1): instant filter box, segmented
// status filter, inline suspend/activate. Provisioning lives at /admin/tenants/new.

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  userCount: number;
  channelCount: number;
  messageCount30d: number;
};
type TenantList = { items: Tenant[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function TenantsPage() {
  const { data, loading, error } = useAdminApi<TenantList>("/api/admin/tenants");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const n = sessionStorage.getItem("tenant-notice");
    if (n) {
      setNotice(n);
      sessionStorage.removeItem("tenant-notice");
    }
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((t) => {
      const matchesText = !needle || t.name.toLowerCase().includes(needle) || t.slug.includes(needle);
      const matchesStatus = !status || t.status === status;
      return matchesText && matchesStatus;
    });
  }, [data, q, status]);

  return (
    <AdminShell title="Tenants">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Tenant Workspaces</h1>
          <p className="mt-1 text-xs text-slate-500">
            Provision isolated customer workspaces, inspect subscription status, and manage account suspensions.
          </p>
        </div>
        <Link href="/admin/tenants/new" className={btnPrimary()}>
          <Plus size={14} />
          Provision Tenant
        </Link>
      </div>

      {notice && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-muted/80 px-4 py-2.5 text-xs text-slate-800">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="text-slate-400 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by workspace name or slug..."
              className="h-8 w-64 rounded-md border border-slate-300 bg-card pl-8 pr-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <Segmented
            options={[
              { key: "", label: "All" },
              { key: "ACTIVE", label: "Active" },
              { key: "SUSPENDED", label: "Suspended" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </div>
        <span className="font-mono text-[11px] text-slate-400">{filtered.length} workspaces</span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-3 pr-4">Workspace</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Users / Channels</th>
              <th className="hidden px-4 py-3 text-right md:table-cell">30d Messages</th>
              <th className="px-4 py-3">Created</th>
              <th className="py-3 pl-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 border-b border-slate-200">
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                  {error ? "Failed to load tenants." : "No tenant workspaces match your filter criteria."}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50/80">
                <td className="py-3.5 pr-4">
                  <Link
                    href={`/admin/tenants/${t.id}`}
                    className="text-xs font-semibold text-slate-900 hover:text-emerald-700"
                  >
                    {t.name}
                  </Link>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">{t.slug}</p>
                </td>
                <td className="px-4 py-3.5">
                  <StatusLabel tone={t.status === "ACTIVE" ? "ok" : "bad"}>
                    {t.status === "ACTIVE" ? "Active" : "Suspended"}
                  </StatusLabel>
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                  {t.userCount} / {t.channelCount}
                </td>
                <td className="hidden px-4 py-3.5 text-right font-mono text-xs text-slate-900 tabular-nums md:table-cell">
                  {t.messageCount30d.toLocaleString("en-GB")}
                </td>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-500">
                  {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="py-3.5 pl-4 text-right">
                  <Link href={`/admin/tenants/${t.id}`} className="font-semibold text-emerald-700 hover:underline">
                    Inspect
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

