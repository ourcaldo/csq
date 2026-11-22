import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel } from "@/components/console";
import { confirmAction } from "@/components/confirm-dialog";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// API keys (template viewApiKeys 1:1): cross-tenant tokens, revoke through
// the shared destructive confirm dialog.

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

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function ApiKeysPage() {
  const { data, loading, error, refresh } = useAdminApi<{ items: ApiKey[] }>("/api/admin/api-keys");
  const [busy, setBusy] = useState<string | null>(null);

  const items = data?.items ?? [];
  const activeCount = items.filter((k) => !k.revokedAt).length;

  function askRevoke(k: ApiKey) {
    confirmAction({
      title: "Revoke Tenant API Key",
      desc: (
        <>
          Revoke <strong>{k.name}</strong> (<code className="font-mono text-xs">{k.prefix}...</code>) for {k.tenantName}?
          Requests using this token will immediately fail with 401 Unauthorized.
        </>
      ),
      btnLabel: "Revoke Token",
      onConfirm: () => {
        setBusy(k.id);
        void adminFetch(`/api/admin/api-keys?id=${k.id}`, "DELETE")
          .then(() => {
            showToast(`API Key ${k.prefix} revoked`);
            refresh();
          })
          .finally(() => setBusy(null));
      },
    });
  }

  return (
    <AdminShell title="API Keys">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Tenant API Keys</h1>
          <p className="mt-1 text-xs text-slate-500">
            Inspect active Bearer integration tokens across workspaces and revoke compromised credentials.
          </p>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="font-semibold text-emerald-700">{activeCount} Active</span>
          <span className="text-slate-400">{items.length - activeCount} Revoked</span>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-3 pr-4">Key Label</th>
              <th className="px-4 py-3">Prefix</th>
              <th className="px-4 py-3">Workspace</th>
              <th className="px-4 py-3">Last Activity</th>
              <th className="px-4 py-3">Status</th>
              <th className="py-3 pl-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 border-b border-slate-200">
            {loading && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {items.map((k) => (
              <tr key={k.id} className="hover:bg-slate-50/80">
                <td className="py-3.5 pr-4 text-xs font-semibold text-slate-900">{k.name}</td>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{k.prefix}...</td>
                <td className="px-4 py-3.5">
                  <p className="text-xs font-medium text-slate-800">{k.tenantName}</p>
                  <p className="font-mono text-[11px] text-slate-400">{k.tenantSlug}</p>
                </td>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-500">
                  {k.lastUsedAt
                    ? new Date(k.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                    : "Never"}
                </td>
                <td className="px-4 py-3.5">
                  <StatusLabel tone={k.revokedAt ? "off" : "ok"}>{k.revokedAt ? "Revoked" : "Active"}</StatusLabel>
                </td>
                <td className="py-3.5 pl-4 text-right">
                  {!k.revokedAt ? (
                    <button
                      type="button"
                      disabled={busy === k.id}
                      onClick={() => askRevoke(k)}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
                    >
                      Revoke
                    </button>
                  ) : (
                    <span className="text-xs text-slate-300">-</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
